"use strict";
// Real dedicated Worker, XHR and IndexedDB; every response is a local fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { chromium } = require("playwright");
const { artifacts } = require("../scripts/hosted-epg.cjs");
const root = path.resolve(__dirname, "..");
const generated = artifacts();
const bridge = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/hosted/epg.ts"), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES5 } }
).outputText;
const publicSource = "https://cdn.epg.one/epg2.xml.gz";
const profile = {
    apiBase: "/epg/v1",
    mode: "server",
    serverWorkerUrl: "/epg-server.js",
    source: publicSource,
    sourceId: "epg-one",
    workerUrl: "/epg-worker.js",
};
// Routing is tested at the actual bridge boundary without fetching any XMLTV.
for (const [urls, expected] of [
    [undefined, "server"],
    [[publicSource], "server"],
    [["http://epg.one/epg2.xml.gz"], "server"],
    [["https://epg.it999.ru/epg2.xml.gz"], "server"],
    [[publicSource + "?token=private"], "client"],
    [["https://private.invalid/paid.xml.gz"], "client"],
    [["https://private.invalid/paid.xml.gz", publicSource], "client"],
    [[publicSource, "https://private.invalid/paid.xml.gz"], "client"],
]) {
    const created = [];
    const messages = [];
    const timeouts = [];
    const host = {
        _: (s) => s,
        __OTTPLAY_HOSTED__: { epg: profile, version: 1 },
        clearInterval() {},
        clearTimeout() {},
        setInterval() {},
        setTimeout(callback, delay) {
            if (delay >= 15000) timeouts.push(callback);
        },
        Worker: function (url) {
            created.push(url);
            this.postMessage = (value) => messages.push(value);
            this.terminate = () => {};
        },
    };
    vm.runInNewContext(bridge, { window: host });
    const session = host.__ottHostedEpg.open(
        [{ id: "18", name: "REN", xmltv_urls: urls }],
        () => {}
    );
    assert.deepEqual(created, [
        "/epg-" + (expected === "server" ? "server" : "worker") + ".js",
    ]);
    assert.equal(host.__ottHostedEpg.diagnostics().transport, expected);
    assert.equal(host.__OTT_HOSTED_EPG_SERVER_VERSION__, 1);
    let expired = false;
    session.guide("18", (rows) => {
        assert.equal(rows, null);
        expired = true;
    });
    timeouts[0]();
    assert(expired);
    assert.equal(
        messages.filter((value) => value.type === "cancel").length,
        expected === "server" ? 1 : 0
    );
    session.close();
}

// Cancellation can synchronously drain queued hits when IndexedDB is absent.
// Exercise the emitted worker itself with controllable XHR completions.
{
    const posted = [];
    const held = [];
    const env = {
        clearTimeout() {},
        postMessage(value) {
            posted.push(value);
        },
        setTimeout() {
            return 1;
        },
        XMLHttpRequest: function () {
            this.open = (method, url) => {
                this.method = method;
                this.url = url;
            };
            this.setRequestHeader = () => {};
            this.send = (body) => {
                this.body = body;
                held.push(this);
            };
            this.abort = () => {
                this.aborted = true;
                if (this.onabort) this.onabort();
            };
        },
    };
    vm.runInNewContext(generated["epg-server.js"].toString(), { self: env });
    const send = (value) => env.onmessage({ data: value });
    const respond = (xhr, value) => {
        xhr.status = 200;
        xhr.responseText = JSON.stringify(value);
        xhr.onload();
    };
    const envelope = {
        fetchedAt: Date.now(),
        generation: "cancel-cache",
        source: "epg-one",
        version: 1,
    };
    const ids = ["A", "C", "D", "E", "B"];
    send({
        apiBase: "/epg/v1",
        channels: ids.map((id) => ({
            archiveHours: 48,
            id,
            name: id,
            tvgId: id,
            tvgName: "",
        })),
        sourceId: "epg-one",
        type: "load",
    });
    respond(held[0], {
        ...envelope,
        mappings: Object.fromEntries(
            ids.map((id) => [id, { channelId: id, logo: "", shift: 0 }])
        ),
        refreshMs: 7200000,
        stale: false,
    });
    send({ id: "B", query: "warm", type: "guide" });
    respond(held[1], {
        ...envelope,
        rows: [
            {
                descr: "Complete",
                icon: "",
                name: "Programme",
                time: Math.floor(Date.now() / 1000),
                time_to: Math.floor(Date.now() / 1000) + 3600,
            },
        ],
    });
    ids.slice(0, 4).forEach((id) => send({ id, query: id, type: "guide" }));
    send({ id: "B", query: "cached", type: "guide" });
    assert.equal(held.length, 6);
    assert.doesNotThrow(() => send({ query: "A", type: "cancel" }));
    assert.equal(
        held.length,
        6,
        "queued B was served from memory, without another GET"
    );
    assert.equal(
        posted.filter(
            (value) => value.type === "guide" && value.query === "cached"
        ).length,
        1
    );
    assert.equal(
        posted.filter((value) => value.type === "guide" && value.query === "A")
            .length,
        0
    );
    assert.equal(held[2].aborted, true);
    send({ type: "close" });
}

async function main() {
    let browser;
    let state;
    const errors = [];
    const requests = [];
    const pending = [];
    const baseRow = (name = "Full programme") => ({
        descr: "Complete description — not a shortened bootstrap.",
        icon: "",
        name,
        time: Math.floor((Date.now() + (state.timeOffset || 0)) / 1000) - 600,
        time_to:
            Math.floor((Date.now() + (state.timeOffset || 0)) / 1000) + 3600,
    });
    const reset = () => {
        state = {
            emptyGuide: false,
            generation: "generation-1",
            guideDelay: false,
            guideErrors: [],
            malformedRows: false,
            matchError: false,
            matchGenerations: [],
            peak: 0,
            running: 0,
            stale: false,
            timeOffset: 0,
        };
        requests.length = 0;
    };
    reset();
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://fixture.invalid");
        function json(code, value) {
            if (res.destroyed) return;
            res.writeHead(code, {
                "Cache-Control": "no-store",
                "Content-Type": "application/json",
            });
            res.end(JSON.stringify(value));
        }
        if (url.pathname === "/") {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<!doctype html><title>Hosted EPG server fixture</title>");
        } else if (
            url.pathname === "/epg-server.js" ||
            url.pathname === "/epg-server-no-idb.js" ||
            url.pathname === "/epg-server-clock.js"
        ) {
            res.writeHead(200, { "Content-Type": "application/javascript" });
            const disabled = url.pathname.includes("no-idb")
                ? 'Object.defineProperty(self,"indexedDB",{value:{open:function(){throw new Error("fixture unavailable");}}});\n'
                : url.pathname.includes("clock")
                  ? "var fixtureNow=Date.now;Date.now=function(){return fixtureNow()+7201000;};\n"
                  : "";
            res.end(disabled + generated["epg-server.js"]);
        } else if (url.pathname === "/epg/v1/match") {
            let body = "";
            for await (const data of req) body += data;
            const value = JSON.parse(body);
            requests.push({
                body: value,
                bytes: Buffer.byteLength(body),
                method: req.method,
                path: url.pathname,
            });
            if (state.matchError) {
                json(503, {
                    error: { code: "EPG_NOT_READY" },
                    source: "epg-one",
                    version: 1,
                });
                return;
            }
            state.generation =
                state.matchGenerations.shift() || state.generation;
            const mappings = Object.fromEntries(
                value.channels.map((row) => [
                    row.id,
                    {
                        channelId: row.tvgId || row.id,
                        logo: "",
                        shift: row.name.includes("+3") ? 10800 : 0,
                    },
                ])
            );
            json(200, {
                fetchedAt: Date.now(),
                generation: state.generation,
                mappings,
                refreshMs: 7200000,
                source: "epg-one",
                stale: state.stale,
                version: 1,
            });
        } else if (url.pathname === "/epg/v1/programmes") {
            requests.push({
                method: req.method,
                path: url.pathname,
                query: Object.fromEntries(url.searchParams),
            });
            state.running++;
            state.peak = Math.max(state.peak, state.running);
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                state.running--;
            };
            res.once("close", release);
            const respond = () => {
                release();
                const code = state.guideErrors.shift();
                if (code) {
                    if (code === 409) state.generation += "-next";
                    json(code, {
                        error: {
                            code:
                                code === 409
                                    ? "EPG_GENERATION"
                                    : "EPG_NOT_READY",
                        },
                        source: "epg-one",
                        version: 1,
                    });
                } else {
                    const row = baseRow();
                    const shift = Number(url.searchParams.get("shift"));
                    row.time += shift;
                    row.time_to += shift;
                    if (state.malformedRows) row.time_to = row.time;
                    row.unexpectedField = "must not enter a cached guide";
                    json(200, {
                        fetchedAt: Date.now(),
                        generation: state.generation,
                        rows: state.emptyGuide ? [] : [row],
                        source: "epg-one",
                        version: 1,
                    });
                }
            };
            if (state.guideDelay) pending.push(respond);
            else respond();
        } else {
            errors.push("Unexpected request: " + url.pathname);
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        await context.route("**/*", (route) => {
            if (
                route
                    .request()
                    .url()
                    .startsWith(origin + "/")
            )
                return route.continue();
            errors.push("External request attempted");
            return route.abort();
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(origin);
        const install = async () => {
            await page.addScriptTag({ content: bridge });
            await page.evaluate((profile) => {
                window._ = (text) => text;
                window.__OTTPLAY_HOSTED__ = { epg: profile, version: 1 };
                window.invalidations = 0;
                window.__ottClassicGuide = {
                    invalidate() {
                        window.invalidations++;
                    },
                };
                window.openGuide = function (rows, overrides) {
                    window.notifications = [];
                    window.results = {};
                    window.__OTTPLAY_HOSTED__.epg = Object.assign(
                        {},
                        profile,
                        overrides
                    );
                    window.session = window.__ottHostedEpg.open(
                        rows,
                        (mappings) => window.notifications.push(mappings)
                    );
                };
                window.getGuide = (id) =>
                    new Promise((resolve) => window.session.guide(id, resolve));
            }, profile);
        };
        await install();
        const channels = (id) => [
            {
                epg: id,
                id,
                name: "REN HD",
                rec: 48,
                stream: "https://private.invalid/media?token=secret",
            },
        ];
        const open = async (rows, overrides = {}) => {
            await page.evaluate(
                ([rows, overrides]) => window.openGuide(rows, overrides),
                [rows, overrides]
            );
            await page.waitForFunction(
                () => window.__ottHostedEpg.diagnostics().phase === "ready"
            );
        };
        const get = (id) => page.evaluate((id) => window.getGuide(id), id);
        const close = () => page.evaluate(() => window.session.close());
        const guideRequests = () =>
            requests.filter((row) => row.path.endsWith("programmes"));
        const matchRequests = () =>
            requests.filter((row) => row.path.endsWith("match"));

        await open(channels("18"));
        const first = await get("18");
        assert.equal(first.length, 1);
        assert.equal(first[0].descr, baseRow().descr);
        assert.deepEqual(Object.keys(first[0]).sort(), [
            "descr",
            "icon",
            "name",
            "time",
            "time_to",
        ]);
        const match = matchRequests()[0].body;
        assert.deepEqual(Object.keys(match).sort(), [
            "channels",
            "source",
            "version",
        ]);
        assert.deepEqual(Object.keys(match.channels[0]).sort(), [
            "id",
            "name",
            "tvgId",
            "tvgName",
        ]);
        assert(!JSON.stringify(match).includes("private"));
        assert.deepEqual(guideRequests()[0].query, {
            channelId: "18",
            generation: "generation-1",
            hours: "48",
            shift: "0",
        });
        assert.deepEqual(await get("18"), first);
        assert.equal(
            guideRequests().length,
            1,
            "accepted full guide is reused"
        );

        // Close/reopen uses genuine persisted IndexedDB rows immediately while
        // background matching is unavailable; no raw XMLTV or fallback GET.
        await close();
        reset();
        state.matchError = true;
        await page.reload();
        await install();
        await page.evaluate((rows) => window.openGuide(rows), channels("18"));
        await page.waitForFunction(() => window.notifications.length > 0);
        assert.deepEqual(await get("18"), first);
        assert.equal(guideRequests().length, 0);
        await page.waitForFunction(
            () => window.__ottHostedEpg.diagnostics().code === "EPG_HTTP"
        );
        assert.equal(
            await page.evaluate(
                () => window.__ottHostedEpg.diagnostics().cached
            ),
            true
        );
        await close();

        const catalogue = (count, prefix) =>
            Array.from({ length: count }, (_, i) => channels(prefix + i)[0]);
        reset();
        await open(catalogue(3000, "catalogue-"));
        assert.deepEqual(
            matchRequests().map((row) => row.body.channels.length),
            [2048, 952]
        );
        assert.equal(await page.evaluate(() => window.notifications.length), 1);
        assert.equal(
            await page.evaluate(
                () => Object.keys(window.notifications[0]).length
            ),
            3000
        );
        assert.equal((await get("catalogue-2999")).length, 1);
        await close();

        reset();
        await open(
            catalogue(400, "unicode-").map((row) => ({
                ...row,
                name: "界".repeat(512),
                tn: "😀".repeat(256),
            }))
        );
        assert(
            matchRequests().length > 1,
            "UTF8 metadata splits before the 512KiB server limit"
        );
        assert.equal(
            matchRequests().reduce(
                (sum, row) => sum + row.body.channels.length,
                0
            ),
            400
        );
        assert(
            matchRequests().every(
                (row) =>
                    row.bytes <= 500 * 1024 && row.body.channels.length <= 2048
            )
        );
        assert.equal(
            await page.evaluate(
                () => Object.keys(window.notifications[0]).length
            ),
            400
        );
        await close();

        reset();
        state.matchGenerations = [
            "generation-1",
            "generation-2",
            "generation-2",
            "generation-2",
        ];
        await open(catalogue(3000, "restart-"));
        assert.equal(
            matchRequests().length,
            4,
            "one complete restart on generation drift between batches"
        );
        assert.equal(
            await page.evaluate(() => window.notifications.length),
            1,
            "partial batch mappings never become visible"
        );
        assert.equal(
            await page.evaluate(
                () => Object.keys(window.notifications[0]).length
            ),
            3000
        );
        assert.equal((await get("restart-2999")).length, 1);
        assert.equal(guideRequests()[0].query.generation, "generation-2");
        await close();

        reset();
        state.matchGenerations = [
            "generation-1",
            "generation-2",
            "generation-3",
            "generation-4",
        ];
        await page.evaluate(
            (rows) => window.openGuide(rows),
            catalogue(3000, "unstable-")
        );
        await page.waitForFunction(
            () => window.__ottHostedEpg.diagnostics().code === "EPG_GENERATION"
        );
        assert.equal(
            matchRequests().length,
            4,
            "a second generation drift stops instead of looping"
        );
        assert.equal(await page.evaluate(() => window.notifications.length), 0);
        await close();

        reset();
        await open([{ ...channels("profile-a")[0], epg: "shared-canonical" }]);
        const sharedGuide = await get("profile-a");
        await close();
        await open([{ ...channels("profile-b")[0], epg: "shared-canonical" }]);
        assert.deepEqual(await get("profile-b"), sharedGuide);
        assert.equal(
            matchRequests().length,
            2,
            "a different local profile matches independently"
        );
        assert.equal(
            guideRequests().length,
            1,
            "the fixed-source canonical guide is reusable across profiles"
        );
        await close();

        reset();
        await open(channels("no-idb"), {
            serverWorkerUrl: "/epg-server-no-idb.js",
        });
        assert.equal((await get("no-idb")).length, 1);
        assert.equal((await get("no-idb")).length, 1);
        assert.equal(
            guideRequests().length,
            1,
            "IDB unavailable still has bounded memory cache"
        );
        await close();

        reset();
        await open([{ ...channels("shifted")[0], name: "REN +3" }]);
        const shifted = await get("shifted");
        assert.equal(guideRequests()[0].query.shift, "10800");
        assert(Math.abs(shifted[0].time - (baseRow().time + 10800)) <= 1);
        assert(Math.abs(shifted[0].time_to - (baseRow().time_to + 10800)) <= 1);
        await close();

        reset();
        await open(channels("recover"));
        state.guideErrors = [503];
        assert.equal(await get("recover"), null);
        await page.waitForFunction(
            () => window.__ottHostedEpg.diagnostics().phase === "error"
        );
        assert.equal(
            await page.evaluate(
                () => window.__ottHostedEpg.diagnostics().cached
            ),
            false,
            "mappings alone are not a saved programme guide"
        );
        assert.equal((await get("recover")).length, 1);
        await page.waitForFunction(
            () => window.__ottHostedEpg.diagnostics().phase === "ready"
        );
        assert.equal(
            await page.evaluate(() => window.__ottHostedEpg.diagnostics().code),
            ""
        );
        await close();

        reset();
        await open(channels("invalid"));
        state.malformedRows = true;
        assert.equal(await get("invalid"), null);
        assert.equal(await get("invalid"), null);
        assert.equal(
            guideRequests().length,
            2,
            "malformed rows never poison the accepted cache"
        );
        assert.equal(
            await page.evaluate(() => window.__ottHostedEpg.diagnostics().code),
            "EPG_RESPONSE"
        );
        await close();

        reset();
        await open(channels("generation"));
        state.guideErrors = [409];
        assert.equal((await get("generation")).length, 1);
        assert.equal(matchRequests().length, 2);
        assert.equal(guideRequests().length, 2);
        assert.equal(guideRequests()[1].query.generation, "generation-1-next");
        assert.equal(await page.evaluate(() => window.notifications.length), 2);
        await close();

        reset();
        await open(channels("bounded-409"));
        state.guideErrors = [409, 409];
        assert.equal(await get("bounded-409"), null);
        assert.equal(matchRequests().length, 2);
        assert.equal(guideRequests().length, 2, "generation retry cannot loop");
        await close();

        reset();
        state.stale = true;
        await open(channels("stale"));
        assert.equal(
            await page.evaluate(
                () => window.__ottHostedEpg.diagnostics().sourceStale
            ),
            true
        );
        assert.equal((await get("stale")).length, 1);
        const count = await page.evaluate(() => window.notifications.length);
        await page.evaluate(() => window.session.retry());
        await page.waitForFunction(
            () => window.__ottHostedEpg.diagnostics().phase === "ready"
        );
        assert.equal(
            await page.evaluate(() => window.notifications.length),
            count + 1,
            "retry accepts cache generation once, same response does not re-invalidate"
        );
        await close();

        reset();
        await open(
            Array.from({ length: 7 }, (_, i) => channels("queue-" + i)[0])
        );
        state.guideDelay = true;
        const batch = page.evaluate(() =>
            Promise.all(
                [
                    "queue-0",
                    "queue-0",
                    "queue-1",
                    "queue-2",
                    "queue-3",
                    "queue-4",
                    "queue-5",
                    "queue-6",
                ].map(window.getGuide)
            )
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(pending.length, 4);
        assert.equal(state.peak, 4);
        pending.splice(0).forEach((done) => done());
        await new Promise((resolve) => setTimeout(resolve, 150));
        pending.splice(0).forEach((done) => done());
        const batchRows = await batch;
        assert.equal(batchRows.length, 8);
        assert.equal(
            guideRequests().length,
            7,
            "same-channel in-flight queries coalesce"
        );
        assert.deepEqual(batchRows[0], batchRows[1]);
        await close();

        reset();
        await open(
            Array.from({ length: 30 }, (_, i) => channels("evict-" + i)[0])
        );
        for (let i = 0; i < 30; i++)
            assert.equal((await get("evict-" + i)).length, 1);
        const stored = await page.evaluate(
            () =>
                new Promise((resolve, reject) => {
                    const opening = indexedDB.open(
                        "ottplay-hosted-epg-server-v1",
                        1
                    );
                    opening.onerror = () => reject(opening.error);
                    opening.onsuccess = () => {
                        const db = opening.result;
                        const tx = db.transaction(
                            ["cache", "usage"],
                            "readonly"
                        );
                        const count = tx.objectStore("cache").count();
                        const usage = tx.objectStore("usage").getAll();
                        const records = tx.objectStore("cache").getAll();
                        tx.oncomplete = () => {
                            db.close();
                            resolve({
                                count: count.result,
                                records: records.result,
                                usage: usage.result,
                            });
                        };
                    };
                })
        );
        assert.equal(
            stored.count,
            25,
            "one active snapshot plus 24 guides across all previous profiles"
        );
        assert.equal(stored.usage.length, 24);
        assert(
            stored.records
                .filter((record) => Array.isArray(record.rows))
                .every((record) => !Object.hasOwn(record, "signature")),
            "guide records never duplicate unbounded playlist metadata"
        );
        assert.equal(
            stored.records.filter((record) =>
                Object.hasOwn(record, "signature")
            ).length,
            1,
            "only the active mapping snapshot stores the exact profile signature"
        );
        assert(
            stored.usage.reduce((sum, entry) => sum + entry.bytes, 0) <=
                32 * 1024 * 1024
        );
        assert(
            stored.usage.every(
                (entry) => Object.keys(entry).sort().join() === "bytes,used"
            ),
            "eviction scans metadata only"
        );
        await close();

        reset();
        state.emptyGuide = true;
        await open(
            Array.from({ length: 24 }, (_, i) => channels("empty-" + i)[0])
        );
        for (let i = 0; i < 24; i++)
            assert.deepEqual(await get("empty-" + i), []);
        const emptyEntries = await page.evaluate(
            () =>
                new Promise((resolve) => {
                    const opening = indexedDB.open(
                        "ottplay-hosted-epg-server-v1",
                        1
                    );
                    opening.onsuccess = () => {
                        const db = opening.result;
                        const tx = db.transaction(["usage"], "readonly");
                        const all = tx.objectStore("usage").getAll();
                        tx.oncomplete = () => {
                            db.close();
                            resolve(all.result);
                        };
                    };
                })
        );
        assert.equal(
            emptyEntries.length,
            24,
            "empty valid guides consume zero row bytes, not 8MB each"
        );
        assert(emptyEntries.every((entry) => entry.bytes === 0));
        await close();

        reset();
        await open(channels("timeout"));
        state.guideDelay = true;
        assert.equal(await get("timeout"), null);
        await page.waitForFunction(
            () => window.__ottHostedEpg.diagnostics().code === "EPG_TIMEOUT"
        );
        assert.equal(guideRequests().length, 1);
        pending.splice(0).forEach((done) => done());
        await close();

        reset();
        await open(
            Array.from({ length: 20 }, (_, i) => channels("deadline-" + i)[0])
        );
        state.guideDelay = true;
        const expiredRows = await page.evaluate(() =>
            Promise.all(
                Array.from({ length: 20 }, (_, i) =>
                    window.getGuide("deadline-" + i)
                )
            )
        );
        assert(expiredRows.every((rows) => rows === null));
        const expiredRequestCount = guideRequests().length;
        assert(
            expiredRequestCount <= 16,
            "last queued consumers expire before another 12s request can start"
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(
            guideRequests().length,
            expiredRequestCount,
            "expired queued jobs never leak delayed requests"
        );
        assert.equal(
            state.running,
            0,
            "all active timed-out XHRs have been aborted"
        );
        pending.splice(0).forEach((done) => done());
        await close();

        reset();
        await open(channels("closed"));
        state.guideDelay = true;
        await page.evaluate(() =>
            window.session.guide("closed", (rows) => {
                window.results.late = rows;
            })
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await close();
        pending.splice(0).forEach((done) => done());
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
            await page.evaluate(() => window.results.late),
            undefined,
            "late response after close is ignored"
        );
        assert.equal(
            await page.evaluate(
                () => window.__ottHostedEpg.diagnostics().phase
            ),
            "idle"
        );
        reset();
        await open(channels("clock"));
        const beforeClock = await get("clock");
        await close();
        state.timeOffset = 7201000;
        state.stale = true;
        await open(channels("clock"), {
            serverWorkerUrl: "/epg-server-clock.js",
        });
        const afterClock = await get("clock");
        assert.equal(
            guideRequests().length,
            2,
            "same-generation history-only cache expires after 2h"
        );
        assert(afterClock[0].time >= beforeClock[0].time + 7200);
        assert.equal(matchRequests()[1].body.source, "epg-one");
        await close();

        assert.deepEqual(errors, []);
        await context.close();
        console.log(
            "PASS hosted server EPG: private metadata projection, real Worker/IndexedDB, reload outage cache, global metadata-only eviction, storage failure, bounded generation retry, stale data, shifted full rows, malformed response/recovery, request coalescing/concurrency/deadlines, UTF8 catalogue batches, atomic bounded rematch, cache freshness, timeout/close and custom-source routing"
        );
    } finally {
        if (browser) await browser.close();
        pending.splice(0).forEach((done) => done());
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
