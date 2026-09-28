"use strict";
// Real Worker, gzip decoder, XML parser and IndexedDB. No network provider required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const zlib = require("node:zlib");
const ts = require("typescript");
const { chromium } = require("playwright");
const { artifacts } = require("../scripts/hosted-epg.cjs");
const root = path.resolve(__dirname, "..");
const generated = artifacts();
const workerAst = ts.createSourceFile(
    "epg-worker.ts",
    fs.readFileSync(path.join(root, "src/hosted/epg-worker.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const workerFactory = workerAst.statements.find(
    (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name.text === "createHostedEpgWorker"
);
const cleanupDeclaration = workerFactory.body.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name.text === "cleanup"
);
const cleanupSource = ts.transpileModule(
    cleanupDeclaration.getText(workerAst),
    {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
const now = Math.floor(Date.now() / 1000);
const stamp = (offset) =>
    new Date((now + offset) * 1000)
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14) + " +0000";
const programme = (offset, end, title, description = "", id = "18") =>
    `<programme channel="${id}" start="${stamp(offset)}" stop="${stamp(end)}"><title>${title}</title><desc>${description}</desc></programme>`;
const header =
    '<?xml version="1.0"?><!DOCTYPE tv SYSTEM "http://feed.test/inert.dtd"><tv><channel id="18"><display-name>РЕН ТВ HD</display-name><display-name>РЕН ТВ</display-name><icon src="https://example.test/ren.png"/></channel>';
const base =
    header +
    programme(-360000, -356400, "Archive") +
    programme(-3600, 3600, "Now &amp; next") +
    programme(3600, 7200, "Later") +
    "</tv>";
let body = zlib.gzipSync(base),
    status = 200,
    calls = 0;
const server = http.createServer((request, response) => {
    const name = new URL(request.url, "http://fixture").pathname;
    if (name === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>Hosted EPG tests</title>");
        return;
    }
    if (name === "/feed.gz") {
        calls++;
        response.statusCode = status;
        response.end(body);
        return;
    }
    if (name.startsWith("/hosted/") && generated[name.slice(8)]) {
        response.setHeader("Content-Type", "text/javascript");
        response.end(generated[name.slice(8)]);
        return;
    }
    const source =
        name === "/js/ottplay-core.js"
            ? "vendor/ottplay-core.js"
            : name === "/js/runtime-polyfills.js"
              ? "js/runtime-polyfills.js"
              : null;
    if (source) {
        response.setHeader("Content-Type", "text/javascript");
        response.end(fs.readFileSync(path.join(root, source)));
        return;
    }
    response.statusCode = 404;
    response.end();
});
(async () => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto("http://127.0.0.1:" + server.address().port);
        // Execute the actual cleanup function over real IndexedDB at the exact
        // race boundary, without timer-dependent interleaving of two downloads.
        const cleanupRaces = await page.evaluate(async (source) => {
            const results = [];
            for (const scenario of [
                "stale-pointer",
                "lost-owner",
                "expired-owner",
            ]) {
                const name = "epg-cleanup-race-" + scenario;
                const database = await new Promise((resolve, reject) => {
                    const opening = indexedDB.open(name, 1);
                    opening.onupgradeneeded = () => {
                        opening.result.createObjectStore("meta", {
                            keyPath: "key",
                        });
                        opening.result.createObjectStore("rows", {
                            keyPath: "key",
                        });
                    };
                    opening.onsuccess = () => resolve(opening.result);
                    opening.onerror = () => reject(opening.error);
                });
                await new Promise((resolve, reject) => {
                    const tx = database.transaction(
                        ["meta", "rows"],
                        "readwrite"
                    );
                    tx.objectStore("meta").put({
                        generation: "new",
                        key: "active",
                        signature: "fixture",
                    });
                    tx.objectStore("meta").put({
                        key: "lease",
                        owner:
                            scenario === "lost-owner"
                                ? "replacement"
                                : "holder",
                        until:
                            Date.now() +
                            (scenario === "expired-owner" ? -1000 : 60000),
                    });
                    for (const generation of ["old", "new", "orphan"])
                        tx.objectStore("rows").put({
                            generation,
                            key: generation,
                        });
                    tx.oncomplete = resolve;
                    tx.onabort = () => reject(tx.error);
                });
                const scopes = [];
                const outcome = await new Promise((resolve) => {
                    const cleanup = new Function(
                        "transaction",
                        "owner",
                        "signature",
                        "fail",
                        "schedule",
                        source + "\nreturn cleanup;"
                    )(
                        (stores, write) => {
                            scopes.push(stores);
                            return database.transaction(
                                stores,
                                write ? "readwrite" : "readonly"
                            );
                        },
                        "holder",
                        "fixture",
                        (code) => resolve({ code }),
                        () => {}
                    );
                    // The old implementation accepted the stale value from load.
                    // Passing it here makes the regression fail against that code.
                    if (cleanup.length === 2)
                        cleanup("old", () => resolve({ code: null }));
                    else cleanup(() => resolve({ code: null }));
                });
                const keys = await new Promise((resolve) => {
                    const tx = database.transaction(["rows"], "readonly"),
                        read = tx.objectStore("rows").getAllKeys();
                    read.onsuccess = () => resolve(read.result);
                });
                database.close();
                results.push({ keys, outcome, scenario, scopes });
            }
            return results;
        }, cleanupSource);
        assert.deepEqual(
            cleanupRaces[0].keys,
            ["new"],
            "cleanup retains the committed pointer, not load's stale snapshot"
        );
        for (const race of cleanupRaces.slice(1)) {
            assert.equal(race.outcome.code, "EPG_LEASE_LOST", race.scenario);
            assert.deepEqual(
                race.keys,
                ["new", "old", "orphan"],
                "unowned cleanup must not delete any rows"
            );
        }
        assert.deepEqual(
            cleanupRaces[0].scopes,
            [["meta", "rows"]],
            "lease, pointer and deletion share one transaction"
        );
        await page.evaluate(() => {
            window.messages = [];
            window.makeWorker = function () {
                if (window.worker) window.worker.terminate();
                window.messages = [];
                window.worker = new Worker("/hosted/epg-worker.js");
                window.worker.onmessage = (event) => {
                    if (event.data.cacheName)
                        window.cacheName = event.data.cacheName;
                    window.messages.push(event.data);
                };
                window.worker.onerror = (event) =>
                    window.messages.push({
                        code: event.message,
                        type: "fatal",
                    });
            };
            window.waitMessage = function (type) {
                return new Promise((resolve, reject) => {
                    const started = Date.now();
                    const interval = setInterval(() => {
                        const at = window.messages.findIndex(
                            (m) => m.type === type || m.type === "fatal"
                        );
                        if (at >= 0) {
                            clearInterval(interval);
                            resolve(window.messages.splice(at, 1)[0]);
                        } else if (Date.now() - started > 30000) {
                            clearInterval(interval);
                            reject(
                                new Error(
                                    "Worker timeout: " +
                                        type +
                                        JSON.stringify(window.messages)
                                )
                            );
                        }
                    }, 5);
                });
            };
            window.configure = function () {
                const source = location.origin + "/feed.gz";
                worker.postMessage({
                    channels: [
                        {
                            archiveHours: 168,
                            id: "long",
                            name: "РЕН ТВ HD",
                            sources: [source],
                            tvgId: "18",
                            tvgName: "",
                        },
                        {
                            archiveHours: 24,
                            id: "short",
                            name: "РЕН ТВ +2",
                            sources: [source],
                            tvgId: "18",
                            tvgName: "",
                        },
                    ].concat(window.extraChannels || []),
                    refreshMs: 7200000,
                    sources: [source],
                    type: "load",
                });
            };
            window.getGuide = async function (id) {
                worker.postMessage({ id, query: id, type: "guide" });
                return (await waitMessage("guide")).rows;
            };
            window.expire = function (name) {
                return new Promise((resolve, reject) => {
                    const opening = indexedDB.open(name || window.cacheName, 1);
                    opening.onsuccess = () => {
                        const db = opening.result,
                            tx = db.transaction(["meta"], "readwrite"),
                            store = tx.objectStore("meta");
                        const read = store.get("active");
                        read.onsuccess = () => {
                            const value = read.result;
                            value.fetched = 0;
                            store.put(value);
                        };
                        tx.oncomplete = () => {
                            db.close();
                            resolve();
                        };
                        tx.onabort = () => reject(new Error("expire failed"));
                    };
                });
            };
            makeWorker();
            configure();
        });
        const ready = await page.evaluate(() => waitMessage("ready"));
        assert.equal(ready.stale, false);
        let long = await page.evaluate(() => getGuide("long"));
        let short = await page.evaluate(() => getGuide("short"));
        assert.equal(long.length, 3);
        assert.equal(short.length, 2);
        assert.equal(long[1].name, "Now & next");
        assert.equal(
            short[0].time,
            long[1].time + 7200,
            "regional shift exactly once"
        );
        assert.equal(ready.mappings.long.logo, "https://example.test/ren.png");

        const before = calls;
        await page.evaluate(() => {
            makeWorker();
            configure();
        });
        await page.evaluate(() => waitMessage("ready"));
        assert.equal(calls, before, "fresh cache avoids another full download");

        for (const failure of [
            "truncated-gzip",
            "invalid-xml",
            "entities",
            "network",
        ]) {
            await page.evaluate(() => expire());
            status = failure === "network" ? 503 : 200;
            body =
                failure === "truncated-gzip"
                    ? zlib.gzipSync(base).subarray(0, -8)
                    : failure === "invalid-xml"
                      ? zlib.gzipSync(base.slice(0, -5))
                      : failure === "entities"
                        ? zlib.gzipSync(
                              '<!DOCTYPE tv [<!ENTITY secret "external">]><tv/>'
                          )
                        : body;
            await page.evaluate(() => {
                makeWorker();
                configure();
            });
            assert.equal(
                (await page.evaluate(() => waitMessage("ready"))).stale,
                true
            );
            const error = await page.evaluate(() => waitMessage("error"));
            assert.equal(error.cached, true, failure);
            long = await page.evaluate(() => getGuide("long"));
            assert.equal(
                long.length,
                3,
                failure + " must preserve good snapshot"
            );
        }

        // Two same-origin workers are independent tabs. Only one owns a refresh;
        // both read the newly committed pointer even when their in-memory state is old.
        status = 200;
        body = zlib.gzipSync(base);
        const beforeConcurrent = calls;
        await page.evaluate(() => {
            const source = location.origin + "/feed.gz";
            window.pairInput = {
                channels: [
                    {
                        archiveHours: 168,
                        id: "concurrent",
                        name: "РЕН ТВ HD",
                        sources: [source],
                        tvgId: "18",
                        tvgName: "",
                    },
                ],
                refreshMs: 7200000,
                sources: [source],
                type: "load",
            };
            window.pair = [0, 1].map(() => {
                const value = {
                    messages: [],
                    worker: new Worker("/hosted/epg-worker.js"),
                };
                value.worker.onmessage = (event) =>
                    value.messages.push(event.data);
                value.worker.postMessage(window.pairInput);
                return value;
            });
            window.pairWait = (index, type) =>
                new Promise((resolve, reject) => {
                    const started = Date.now(),
                        interval = setInterval(() => {
                            const messages = window.pair[index].messages,
                                at = messages.findIndex((m) => m.type === type);
                            if (at >= 0) {
                                clearInterval(interval);
                                resolve(messages.splice(at, 1)[0]);
                            } else if (Date.now() - started > 30000) {
                                clearInterval(interval);
                                reject(new Error("pair timeout"));
                            }
                        }, 10);
                });
        });
        const pairReady = await page.evaluate(() =>
            Promise.all([pairWait(0, "ready"), pairWait(1, "ready")])
        );
        assert.equal(
            calls,
            beforeConcurrent + 1,
            "concurrent tabs coalesce source downloads"
        );
        await page.evaluate((name) => expire(name), pairReady[0].cacheName);
        body = zlib.gzipSync(base.replace("Now &amp; next", "Refreshed"));
        await page.evaluate(() => pair[1].worker.postMessage(pairInput));
        await page.evaluate(() => pairWait(1, "ready")); // stale pointer
        await page.evaluate(() => pairWait(1, "ready")); // replacement
        const refreshed = await page.evaluate(async () => {
            pair[0].worker.postMessage({
                id: "concurrent",
                query: 1,
                type: "guide",
            });
            const value = await pairWait(0, "guide");
            pair.forEach((item) => item.worker.terminate());
            return value.rows;
        });
        assert.equal(
            refreshed[1].name,
            "Refreshed",
            "old tab follows new atomic pointer after cleanup"
        );
        assert.equal(
            (await page.evaluate(() => getGuide("long"))).length,
            3,
            "different playlist cache is isolated"
        );

        // More than the former 50,000-programme policy. Every admitted record survives.
        status = 200;
        let large = header;
        for (let i = 1; i <= 20; i++)
            large += `<channel id="extra${i}"><display-name>Extra ${i}</display-name></channel>`;
        large +=
            Array.from({ length: 50001 }, (_, i) =>
                programme(
                    -1800,
                    1800,
                    "Entry " + i,
                    "",
                    i % 21 ? "extra" + (i % 21) : "18"
                )
            ).join("") + "</tv>";
        body = zlib.gzipSync(large);
        await page.evaluate(() => {
            window.extraChannels = Array.from({ length: 20 }, (_, i) => ({
                archiveHours: 168,
                id: "extra" + (i + 1),
                name: "Extra " + (i + 1),
                sources: [location.origin + "/feed.gz"],
                tvgId: "extra" + (i + 1),
                tvgName: "",
            }));
        });
        await page.evaluate(() => {
            makeWorker();
            configure();
        });
        await page.evaluate(() => waitMessage("ready")); // replacement committed
        const size = await page.evaluate(async () => {
            let total = (await getGuide("long")).length;
            for (let i = 1; i <= 20; i++)
                total += (await getGuide("extra" + i)).length;
            return total;
        });
        assert.equal(size, 50001, "no silent programme cap");
        await page.evaluate(() => expire());
        body = zlib.gzipSync(
            header +
                Array.from({ length: 20001 }, (_, i) =>
                    programme(-1800, 1800, "Overload " + i)
                ).join("") +
                "</tv>"
        );
        await page.evaluate(() => {
            makeWorker();
            configure();
        });
        await page.evaluate(() => waitMessage("ready"));
        assert.equal(
            (await page.evaluate(() => waitMessage("error"))).code,
            "EPG_CHANNEL_LIMIT"
        );
        assert.equal(
            (await page.evaluate(() => getGuide("long"))).length,
            Math.ceil(50001 / 21),
            "explicit size failure preserves good snapshot"
        );
        console.log(
            "PASS hosted EPG: actual ES5 worker/IndexedDB, cache refresh, gzip/XML corruption, entity rejection, archive windows, shifts, 50k+ records"
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
