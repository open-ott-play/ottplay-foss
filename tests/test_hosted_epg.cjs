"use strict";
// Real Worker, gzip decoder, XML parser and IndexedDB. No network provider required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const zlib = require("node:zlib");
const vm = require("node:vm");
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
// Exercise the shipped parser's cumulative limit at a small boundary instead
// of allocating a half-gigabyte feed in every CI run. Today's 457 MB public
// feed has 648 MB of cumulative UTF-16 strings and used to fail this check.
const parseDeclaration = workerFactory.body.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name.text === "parse"
);
const textDeclaration = parseDeclaration.body.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name.text === "text"
);
const bytesDeclaration = workerFactory.body.statements.find(
    (node) =>
        ts.isFunctionDeclaration(node) && node.name.text === "xmlByteLength"
);
const limitSource = ts.transpileModule(
    bytesDeclaration.getText(workerAst) +
        "\n" +
        textDeclaration.getText(workerAst),
    { compilerOptions: { target: ts.ScriptTarget.ES5 } }
).outputText;
for (const chunks of [
    ["<tv>", "ascii programme data".repeat(100), "</tv>"],
    ["Программа передач", "日本語", "😀", "</tv>"],
]) {
    const limit = Buffer.byteLength(chunks.join(""), "utf8");
    const written = [];
    const accept = new Function(
        "XML_LIMIT",
        "parser",
        "var decoded = 0;\n" + limitSource + "\nreturn text;"
    )(limit, { write: (chunk) => written.push(chunk) });
    for (const chunk of chunks) accept(chunk);
    assert.deepEqual(
        written,
        chunks,
        "valid UTF-8 bytes fit exactly within the configured XML limit"
    );
    assert.throws(
        () => accept("x"),
        /EPG_XML_LIMIT/,
        "the actual input limit still rejects one extra byte"
    );
}
// Exercise the shipped accounting/limits without allocating hundreds of MiB.
// The standard 1,565-channel feed currently retains 134,648,412 estimated bytes,
// just beyond the former 128 MiB limit, while each transaction remains bounded.
const retainedSource = ts.transpileModule(
    workerFactory.body.statements
        .filter(
            (node) =>
                ts.isVariableStatement(node) &&
                node.declarationList.declarations.some((declaration) =>
                    [
                        "CACHE_BYTES",
                        "CHANNEL_BYTES",
                        "CHANNEL_RECORDS",
                    ].includes(declaration.name.getText(workerAst))
                )
        )
        .map((node) => node.getText(workerAst))
        .join("\n") +
        "\n" +
        parseDeclaration.body.statements
            .find((node) =>
                node.getText(workerAst).startsWith("parser.onclosetag =")
            )
            .getText(workerAst),
    { compilerOptions: { target: ts.ScriptTarget.ES5 } }
).outputText;
function retainFixture(overrides = {}) {
    const initial = {
        channelBytes: 0,
        channelRecords: 0,
        pendingBytes: 0,
        retainedBytes: 0,
        retainedRecords: 0,
        ...overrides,
    };
    return new Function(
        "initial",
        "var retainedBytes = initial.retainedBytes, retainedRecords = initial.retainedRecords, " +
            "pendingBytes = initial.pendingBytes, depth = 2, generation = 'fixture', sourceIndex = 0, retained = 0, " +
            "pending = {}, parser = {}, channelSizes = {'fixture|0|channel': {bytes: initial.channelBytes, rows: initial.channelRecords}}, " +
            "records = {end: function() {return {kind: 'programme', value: {id: 'channel', title: '', desc: '', begin: 1, end: 2}};}};\n" +
            retainedSource +
            "\nparser.onclosetag('programme'); return {bytes: retainedBytes, rows: retainedRecords, limit: CACHE_BYTES};"
    )(initial);
}
const cacheLimit = 192 * 1024 * 1024;
assert.equal(retainFixture().limit, cacheLimit);
assert.equal(retainFixture({ retainedBytes: 134648412 - 80 }).bytes, 134648412);
assert.equal(
    retainFixture({ retainedBytes: cacheLimit - 80 }).bytes,
    cacheLimit
);
assert.throws(
    () => retainFixture({ retainedBytes: cacheLimit - 79 }),
    /EPG_CACHE_LIMIT/
);
assert.equal(retainFixture({ retainedRecords: 299999 }).rows, 300000);
assert.throws(
    () => retainFixture({ retainedRecords: 300000 }),
    /EPG_CACHE_LIMIT/
);
for (const [property, boundary, cost, error] of [
    ["channelBytes", 8 * 1024 * 1024, 80, /EPG_CHANNEL_LIMIT/],
    ["channelRecords", 20000, 1, /EPG_CHANNEL_LIMIT/],
    ["pendingBytes", 4 * 1024 * 1024, 80, /EPG_BATCH_LIMIT/],
]) {
    assert.doesNotThrow(() => retainFixture({ [property]: boundary - cost }));
    assert.throws(
        () => retainFixture({ [property]: boundary - cost + 1 }),
        error
    );
}
// Repeated XMLTV declarations may add aliases but must neither replace the
// first metadata entry nor consume the distinct-channel budget again.
{
    const channelFixture = new Function(
        "var parser = {}, metadata = Object.create(null), metadataCount = 0, " +
            "aliases = [], indexed = false, depth = 2, row, " +
            "records = {end: function() { return {kind: 'channel', value: row}; }};\n" +
            retainedSource +
            "\nreturn {accept: function(id, name) {row = {id: id, names: [name]}; parser.onclosetag('channel');}, " +
            "metadata: metadata, aliases: aliases};"
    )();
    channelFixture.accept("first", "First name");
    channelFixture.accept("first", "Another alias");
    assert.equal(channelFixture.metadata.first.names[0], "First name");
    assert.deepEqual(channelFixture.aliases.slice(0, 2), [
        ["first", "First name"],
        ["first", "Another alias"],
    ]);
    for (let index = 1; index < 16384; index++)
        channelFixture.accept("channel" + index, "Channel " + index);
    assert.equal(Object.keys(channelFixture.metadata).length, 16384);
    assert.doesNotThrow(() => channelFixture.accept("first", "At capacity"));
    assert.throws(
        () => channelFixture.accept("one-too-many", "Overflow"),
        /EPG_CHANNEL_LIMIT/
    );
}
// Drive the actual download/cleanup functions with a deterministic XHR clock.
// Long transfers and stalled sockets must have different deadlines, without
// making the browser suite wait ten minutes for a timeout regression.
const downloadSource = ts.transpileModule(
    ["clearDownload", "fail", "close", "fetchSource"]
        .map((name) =>
            workerFactory.body.statements
                .find(
                    (node) =>
                        ts.isFunctionDeclaration(node) &&
                        node.name.text === name
                )
                .getText(workerAst)
        )
        .join("\n") +
        "\n" +
        workerFactory.body.statements
            .find((node) =>
                node.getText(workerAst).startsWith("env.onmessage =")
            )
            .getText(workerAst),
    { compilerOptions: { target: ts.ScriptTarget.ES5 } }
).outputText;
function downloadFixture() {
    let now = 0,
        nextTimer = 0;
    const timers = new Map(),
        requests = [];
    const env = {
        clearInterval(id) {
            timers.delete(id);
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        location: { protocol: "https:" },
        postMessage() {},
        setTimeout(callback, delay) {
            const id = ++nextTimer;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        XMLHttpRequest: class {
            constructor() {
                this.aborts = 0;
                requests.push(this);
            }
            open() {}
            send() {
                // Model the browser's total XHR timeout; progress cannot reset it.
                this.deadline = env.setTimeout(() => {
                    if (this.ontimeout) this.ontimeout();
                }, this.timeout);
            }
            abort() {
                this.aborts++;
                env.clearTimeout(this.deadline);
                // Abort can synchronously trigger error delivery on older hosts.
                if (this.onerror) this.onerror();
            }
            progress(loaded, total = 1000000) {
                if (this.onprogress) this.onprogress({ loaded, total });
            }
            finish(status = 200) {
                env.clearTimeout(this.deadline);
                this.status = status;
                this.response = new ArrayBuffer(8);
                if (this.onload) this.onload();
            }
        },
    };
    const worker = new Function(
        "env",
        "var request = null, downloadTimer = null, loading = true, closed = false, " +
            "source = -1, downloaded = 0, total = 0, httpStatus = 0, phase = 'download', " +
            "timer = null, database = null, active = {}, scheduled = 0, parsed = 0, " +
            "messages = [], WIRE_LIMIT = 96 * 1024 * 1024, " +
            "configuration = { refreshMs: 7200000 };\n" +
            "function release(done) { if (done) done(true); }\nfunction progress() {}\n" +
            "function send(value) { if (!closed) messages.push(value); }\n" +
            "function schedule() { scheduled++; }\n" +
            "function parse() { parsed++; }\n" +
            downloadSource +
            "\nreturn { start: function() { fetchSource('https://fixture.test/feed.gz', 0, {}, function() {}); }, " +
            "fail: fail, messages: messages, state: function() { return {scheduled: scheduled, parsed: parsed, active: active, downloaded: downloaded, total: total}; } };"
    )(env);
    worker.start();
    return {
        ...worker,
        advance(milliseconds) {
            const end = now + milliseconds;
            while (true) {
                const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
                if (!next || next[1].due > end) break;
                now = next[1].due;
                timers.delete(next[0]);
                next[1].callback();
            }
            now = end;
        },
        close() {
            env.onmessage({ data: { type: "close" } });
        },
        requests,
        timers,
    };
}
function stoppedDownload(fixture, code, schedules = 1) {
    assert.equal(fixture.messages.length, code ? 1 : 0);
    if (code) {
        assert.equal(fixture.messages[0].code, code);
        assert.equal(
            fixture.messages[0].cached,
            true,
            "last good cache survives"
        );
    }
    assert.equal(fixture.state().scheduled, schedules);
    assert.equal(fixture.timers.size, 0, "no download timer survives cleanup");
    for (const name of ["onload", "onerror", "ontimeout", "onprogress"])
        assert.equal(fixture.requests[0][name], null);
    fixture.advance(600000);
    assert.equal(fixture.messages.length, code ? 1 : 0, "no late timeout");
}
{
    const f = downloadFixture();
    f.advance(59000);
    f.requests[0].progress(1);
    f.advance(59000);
    assert.equal(
        f.messages.length,
        0,
        "a delayed first byte renews the idle budget"
    );
    f.requests[0].finish();
    assert.equal(f.state().parsed, 1);
    stoppedDownload(f, null, 0);
}
{
    const f = downloadFixture();
    for (let index = 1; index <= 7; index++) {
        f.advance(30000);
        f.requests[0].progress(index * 1000);
    }
    assert.equal(
        f.messages.length,
        0,
        "active download survives the former 180s deadline"
    );
    f.requests[0].finish();
    assert.equal(f.state().parsed, 1);
    stoppedDownload(f, null, 0);
}
for (const [first, next] of [
    [0, 0],
    [1, 1],
    [2, 1],
]) {
    const f = downloadFixture();
    f.requests[0].progress(first, 0);
    for (let index = 0; index < 5; index++) {
        f.advance(10000);
        f.requests[0].progress(next, 0);
        assert.equal(
            f.state().downloaded,
            first,
            "downloaded byte count remains monotonic"
        );
        assert.equal(
            f.state().total,
            0,
            "unknown content length stays unknown"
        );
    }
    f.advance(10000);
    assert.equal(
        f.requests[0].aborts,
        1,
        "unchanged/zero/regressing-byte events cannot prevent an idle timeout"
    );
    stoppedDownload(f, "EPG_TIMEOUT");
}
{
    const f = downloadFixture();
    const old = f.requests[0];
    const callbacks = [old.onload, old.onerror, old.ontimeout, old.onprogress];
    f.fail("EPG_STORAGE_FAILED");
    f.start();
    const current = f.requests[1];
    for (const callback of callbacks)
        callback({ loaded: 100000001, total: 100000001 });
    assert.equal(
        f.messages.length,
        1,
        "stale terminal/progress callbacks cannot fail a retry"
    );
    assert.equal(
        f.state().downloaded,
        0,
        "stale progress cannot mutate a retry"
    );
    assert.equal(
        current.aborts,
        0,
        "a stale callback cannot abort the new request"
    );
    f.advance(59000);
    current.progress(10);
    f.advance(59000);
    current.finish();
    assert.equal(
        f.state().parsed,
        1,
        "retry retains its own live callbacks and timer"
    );
    assert.equal(f.timers.size, 0);
    f.advance(600000);
    assert.equal(f.messages.length, 1);
}
{
    const f = downloadFixture();
    for (let index = 1; index <= 10; index++) {
        f.advance(59000);
        f.requests[0].progress(index);
    }
    assert.equal(f.messages.length, 0);
    f.advance(10000);
    assert.equal(
        f.requests[0].aborts,
        1,
        "active traffic still has a 600s total deadline"
    );
    stoppedDownload(f, "EPG_TIMEOUT");
}
for (const failure of ["network", "http", "wire", "storage", "close"]) {
    const f = downloadFixture();
    if (failure === "network") f.requests[0].onerror();
    if (failure === "http") f.requests[0].finish(503);
    if (failure === "wire") f.requests[0].progress(96 * 1024 * 1024 + 1);
    if (failure === "storage") f.fail("EPG_STORAGE_FAILED");
    if (failure === "close") f.close();
    stoppedDownload(
        f,
        {
            close: null,
            http: "EPG_HTTP",
            network: "EPG_NETWORK",
            storage: "EPG_STORAGE_FAILED",
            wire: "EPG_WIRE_LIMIT",
        }[failure],
        failure === "close" || failure === "storage" ? 0 : 1
    );
}
console.log(
    "PASS hosted EPG download deadlines: first byte, increasing progress, idle, total time and cleanup"
);
// A pending failure release and a later close must join the same transaction.
const releaseSource = ts.transpileModule(
    ["release", "close"]
        .map((name) =>
            workerFactory.body.statements
                .find(
                    (node) =>
                        ts.isFunctionDeclaration(node) &&
                        node.name.text === name
                )
                .getText(workerAst)
        )
        .join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES5 } }
).outputText;
for (const outcome of ["commit", "abort", "throw", "no-owner", "no-database"]) {
    let transactions = 0,
        deleted = 0,
        closedConnections = 0;
    const messages = [],
        read = { result: { owner: "fixture" } };
    const tx = {
        objectStore: () => ({ delete: () => deleted++, get: () => read }),
    };
    const env = {
        clearInterval() {},
        clearTimeout() {},
        postMessage(value) {
            messages.push(value);
        },
    };
    const database =
        outcome === "no-database"
            ? null
            : {
                  close() {
                      closedConnections++;
                  },
              };
    const fixture = new Function(
        "env",
        "database",
        "transaction",
        "owner",
        "var leaseTimer=null, timer=null, releasing=false, released=[], closed=false, loading=true; " +
            "function clearDownload() {}\n" +
            releaseSource +
            "\nreturn {release:release,close:close};"
    )(
        env,
        database,
        () => {
            transactions++;
            if (outcome === "throw") throw new Error("InvalidStateError");
            return tx;
        },
        outcome === "no-owner" ? "" : "fixture"
    );
    if (outcome === "commit" || outcome === "abort") {
        fixture.release(); // failure started releasing before close arrived
        fixture.close();
        assert.equal(transactions, 1);
        assert.equal(
            messages.length,
            0,
            "pending release cannot acknowledge early"
        );
        read.onsuccess();
        assert.equal(deleted, 1);
        if (outcome === "commit") tx.oncomplete();
        else tx.onabort();
    } else assert.doesNotThrow(() => fixture.close());
    assert.equal(closedConnections, database ? 1 : 0);
    assert.equal(
        messages.length,
        outcome === "abort" || outcome === "throw" ? 0 : 1,
        "only a successful release/no-owner close acknowledges; failures use the bridge fallback"
    );
}
// The actual bridge under a controlled clock: close acknowledgement, fallback,
// stale callbacks, generation deduplication and per-refresh diagnostic timing.
const bridgeSource = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/hosted/epg.ts"), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES5 } }
).outputText;
function bridgeFixture() {
    let now = 1000000,
        timer = 0,
        notifications = 0,
        invalidations = 0;
    const timeouts = new Map(),
        workers = [];
    const host = {
        _: (value) => value,
        __OTTPLAY_HOSTED__: {
            epg: {
                source: "https://fixture.test/feed.gz",
                workerUrl: "/hosted/epg-worker.js",
            },
            version: 1,
        },
        __ottClassicGuide: {
            invalidate() {
                invalidations++;
            },
        },
        clearInterval() {},
        clearTimeout(id) {
            timeouts.delete(id);
        },
        setInterval() {
            return 0;
        },
        setTimeout(callback, delay) {
            const id = ++timer;
            timeouts.set(id, { callback, due: now + delay });
            return id;
        },
        Worker: function () {
            this.messages = [];
            this.postMessage = (value) => this.messages.push(value);
            this.terminate = () => {
                this.terminated = true;
            };
            workers.push(this);
        },
    };
    vm.runInNewContext(bridgeSource, {
        Date: { now: () => now },
        window: host,
    });
    const session = host.__ottHostedEpg.open(
        [{ id: "18", name: "Fixture" }],
        () => notifications++
    );
    return {
        advance(milliseconds) {
            now += milliseconds;
            for (const [id, value] of timeouts)
                if (value.due <= now) {
                    timeouts.delete(id);
                    value.callback();
                }
        },
        counts: () => [notifications, invalidations],
        diagnostics: host.__ottHostedEpg.diagnostics,
        host,
        send(value, worker = workers[workers.length - 1]) {
            worker.onmessage({ data: value });
        },
        session,
        workers,
    };
}
{
    const f = bridgeFixture(),
        old = f.workers[0],
        stale = old.onmessage;
    f.session.retry();
    assert.equal(
        old.terminated,
        undefined,
        "lease release precedes termination"
    );
    assert.equal(
        f.workers.length,
        1,
        "replacement waits for the close acknowledgement"
    );
    stale({ data: { mappings: {}, type: "ready" } });
    assert.deepEqual(
        f.counts(),
        [0, 0],
        "old attempt is immediately invalidated"
    );
    f.send({ type: "closed" }, old);
    assert.equal(old.terminated, true);
    assert.equal(f.workers.length, 2);
    f.session.close();
    f.advance(1000);
    assert.equal(
        f.workers[1].terminated,
        true,
        "wedged close is bounded to one second"
    );
    assert.equal(f.diagnostics().phase, "idle");
}
{
    const f = bridgeFixture();
    const ready = {
        fetched: 1,
        generation: "retained",
        mappings: { 18: {} },
        type: "ready",
    };
    f.send(ready);
    // Exercise the same GuideService used by ClassicGuide: a cancelled hosted
    // query projects a miss and schedules a later retry until invalidation.
    const context = vm.createContext({ window: f.host });
    require("./helpers/shared-core-runtime.cjs")(context, { vendorOnly: true });
    require("./helpers/private-runtime.cjs")(context, "src/guide/service.ts");
    const reference = {
        channelId: "18",
        id: "18",
        sourceId: "fixture",
        token: {},
    };
    const service = f.host.__ottGuideService.create({
        capacity: () => 0,
        clearTimer: f.host.clearTimeout,
        context: () => "fixture",
        current: () => true,
        decode: (_ref, rows) => rows || [],
        fetch: (_ref, done) => f.session.guide("18", done),
        nextCount: () => 1,
        now: () => 100,
        select: (rows, now, count) =>
            f.host.OttPlayCore.guideScheduleSelection(rows, now, count),
        timer: f.host.setTimeout,
    });
    const invalidate = f.host.__ottClassicGuide.invalidate;
    f.host.__ottClassicGuide.invalidate = (warm) => {
        invalidate(warm);
        service.invalidate(warm);
    };
    service.subscribe(reference, () => {});
    f.advance(0);
    assert.equal(f.workers[0].messages.at(-1).type, "guide");
    f.session.retry();
    assert.equal(service.field(reference, "missing"), true);
    assert(
        service.field(reference, "retryAt") > 100,
        "cancelled query leaves a real miss throttle"
    );
    f.send({ type: "closed" });
    f.send({ ...ready, stale: true });
    f.advance(0);
    const query = f.workers[1].messages.at(-1);
    assert.equal(
        query.type,
        "guide",
        "retained generation after retry immediately refetches cancelled guide"
    );
    f.send({
        query: query.query,
        rows: [
            {
                description: "",
                end: 110,
                id: "programme",
                start: 90,
                title: "Retained guide",
            },
        ],
        type: "guide",
    });
    assert.equal(service.field(reference, "title"), "Retained guide");
    f.send({ ...ready, stale: true });
    assert.deepEqual(
        f.counts(),
        [2, 2],
        "each attempt accepts the cache once, not on every lease poll"
    );
    service.dispose();
    f.session.close();
}
{
    const f = bridgeFixture();
    f.session.retry();
    f.session.retry();
    assert.equal(f.workers.length, 1, "rapid retries share the pending close");
    f.session.close();
    f.send({ type: "closed" });
    f.advance(1000);
    assert.equal(f.workers.length, 1, "close cancels every pending restart");
}
{
    const f = bridgeFixture();
    f.advance(20000);
    const ready = {
        fetched: 1020000,
        generation: "first",
        mappings: { 18: {} },
        records: 1,
        type: "ready",
    };
    f.send(ready);
    assert.equal(f.diagnostics().finished - f.diagnostics().started, 20000);
    f.advance(7200000);
    f.send({ phase: "cache", type: "progress" });
    const started = f.diagnostics().started;
    for (let n = 0; n < 3; n++) {
        f.send({ ...ready, stale: true });
        f.send({ phase: "waiting", type: "progress" });
        f.advance(1000);
        f.send({ phase: "cache", type: "progress" });
    }
    assert.deepEqual(
        f.counts(),
        [1, 1],
        "unchanged generation does not rebuild guide mappings"
    );
    assert.equal(
        f.diagnostics().started,
        started,
        "waiting belongs to the same refresh"
    );
    f.send(ready);
    assert.equal(
        f.diagnostics().phase,
        "ready",
        "fresh/stale transitions still update status"
    );
    f.send({ ...ready, generation: "second" });
    assert.deepEqual(
        f.counts(),
        [2, 2],
        "new generation invalidates even with the same timestamp"
    );
    f.send({
        cached: true,
        code: "EPG_HTTP",
        httpStatus: 503,
        phase: "download",
        type: "error",
    });
    f.advance(7200000);
    f.send({ phase: "cache", type: "progress" });
    assert.equal(
        f.diagnostics().started - started,
        7203000,
        "scheduled recovery resets elapsed time"
    );
    f.session.close();
}
{
    const f = bridgeFixture();
    f.send({ fetched: 1, mappings: {}, type: "ready" });
    f.send({ fetched: 1, mappings: {}, type: "ready" });
    f.send({ fetched: 2, mappings: {}, type: "ready" });
    assert.deepEqual(
        f.counts(),
        [2, 2],
        "older Worker readiness uses its fetched timestamp"
    );
    f.session.close();
}
console.log(
    "PASS hosted EPG bridge close/retry, generation notifications and refresh elapsed time"
);
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
    calls = 0,
    holdFeed = false;
const heldResponses = new Set();
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
        if (holdFeed) {
            heldResponses.add(response);
            response.on("close", () => heldResponses.delete(response));
            response.write(body.subarray(0, 10));
        } else response.end(body);
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
                        opening.result
                            .createObjectStore("rows", {
                                keyPath: "key",
                            })
                            .createIndex("generation", "generation");
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
                        for (const batch of [0, 1])
                            tx.objectStore("rows").put({
                                generation,
                                key: generation + ":" + batch,
                                rows: [{ descr: "Full programme description" }],
                            });
                    tx.oncomplete = resolve;
                    tx.onabort = () => reject(tx.error);
                });
                const scopes = [];
                // Cleaning a generation must not deserialize its programme data.
                const valueDescriptor = Object.getOwnPropertyDescriptor(
                    IDBCursorWithValue.prototype,
                    "value"
                );
                let valuesRead = 0;
                Object.defineProperty(IDBCursorWithValue.prototype, "value", {
                    ...valueDescriptor,
                    get() {
                        valuesRead++;
                        return valueDescriptor.get.call(this);
                    },
                });
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
                Object.defineProperty(
                    IDBCursorWithValue.prototype,
                    "value",
                    valueDescriptor
                );
                const keys = await new Promise((resolve) => {
                    const tx = database.transaction(["rows"], "readonly"),
                        read = tx.objectStore("rows").getAllKeys();
                    read.onsuccess = () => resolve(read.result);
                });
                database.close();
                results.push({ keys, outcome, scenario, scopes, valuesRead });
            }
            return results;
        }, cleanupSource);
        assert.deepEqual(
            cleanupRaces[0].keys,
            ["new:0", "new:1"],
            "cleanup retains the committed pointer, not load's stale snapshot"
        );
        for (const race of cleanupRaces.slice(1)) {
            assert.equal(race.outcome.code, "EPG_LEASE_LOST", race.scenario);
            assert.deepEqual(
                race.keys,
                ["new:0", "new:1", "old:0", "old:1", "orphan:0", "orphan:1"],
                "unowned cleanup must not delete any rows"
            );
        }
        assert.deepEqual(
            cleanupRaces[0].scopes,
            [["meta", "rows"]],
            "lease, pointer and deletion share one transaction"
        );
        assert.equal(
            cleanupRaces[0].valuesRead,
            0,
            "generation cleanup reads keys without cloning programme descriptions"
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
        const phases = await page.evaluate(() =>
            messages.filter((m) => m.type === "progress")
        );
        assert(phases.some((m) => m.phase === "cache"));
        assert(
            phases.some(
                (m) => m.phase === "download" && m.loaded > 0 && m.source === 0
            )
        );
        assert(
            phases.some(
                (m) =>
                    m.phase === "parse" && m.loaded === m.total && m.records > 0
            )
        );
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
            if (failure === "network") {
                assert.equal(error.code, "EPG_HTTP");
                assert.equal(error.httpStatus, 503);
                assert.equal(error.phase, "download");
                assert.equal(error.source, 0);
            }
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

        // A close acknowledgement means the lease transaction has committed.
        // Version changes during both download and parsing stop all continuations.
        holdFeed = true;
        await page.evaluate(() => {
            makeWorker();
            worker.postMessage({ ...pairInput, force: true });
        });
        await page.waitForFunction(() =>
            messages.some((m) => m.phase === "download")
        );
        await page.evaluate(() => worker.postMessage({ type: "close" }));
        assert.equal(
            (await page.evaluate(() => waitMessage("closed"))).type,
            "closed"
        );
        const leaseAfterClose = await page.evaluate(
            (name) =>
                new Promise((resolve, reject) => {
                    const request = indexedDB.open(name, 1);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const db = request.result,
                            tx = db.transaction("meta"),
                            read = tx.objectStore("meta").get("lease");
                        tx.oncomplete = () => {
                            db.close();
                            resolve(read.result || null);
                        };
                    };
                }),
            pairReady[0].cacheName
        );
        assert.equal(
            leaseAfterClose,
            null,
            "close releases rather than waiting 30 seconds for expiry"
        );
        for (const phase of ["download", "parse"]) {
            holdFeed = phase === "download";
            if (!holdFeed)
                body = zlib.gzipSync(
                    header +
                        Array.from({ length: 10000 }, (_, i) =>
                            programme(
                                -1800,
                                1800,
                                "Version change " + i,
                                "description ".repeat(50)
                            )
                        ).join("") +
                        "</tv>"
                );
            await page.evaluate(() => {
                makeWorker();
                worker.postMessage({ ...pairInput, force: true });
            });
            await page.waitForFunction(
                (value) => messages.some((m) => m.phase === value),
                phase
            );
            await page.evaluate((name) => {
                window.storageDeleted = new Promise((resolve, reject) => {
                    const request = indexedDB.deleteDatabase(name);
                    request.onsuccess = () => resolve(true);
                    request.onerror = () => reject(request.error);
                });
            }, pairReady[0].cacheName);
            const changed = await page.evaluate(() => waitMessage("error"));
            assert.equal(changed.code, "EPG_STORAGE_CHANGED", phase);
            assert.equal(changed.phase, phase);
            assert.equal(
                (await page.evaluate(() => waitMessage("closed"))).type,
                "closed"
            );
            assert.equal(await page.evaluate(() => storageDeleted), true);
            await page.waitForTimeout(100); // queued parser/transaction continuations must remain inert
            assert.equal(
                await page.evaluate(
                    () =>
                        messages.filter(
                            (m) =>
                                m.type === "fatal" ||
                                m.type === "error" ||
                                (m.type === "ready" && !m.stale)
                        ).length
                ),
                0
            );
        }
        holdFeed = false;

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
        // Oversized records from an older/corrupt cache fail the read without
        // continuing an already-aborted cursor or throwing a Worker error.
        await page.evaluate(
            () =>
                new Promise((resolve, reject) => {
                    const opening = indexedDB.open(window.cacheName, 1);
                    opening.onsuccess = () => {
                        const db = opening.result;
                        const tx = db.transaction(
                            ["meta", "rows"],
                            "readwrite"
                        );
                        const read = tx.objectStore("meta").get("active");
                        read.onsuccess = () => {
                            const cursor = tx
                                .objectStore("rows")
                                .index("channel")
                                .openCursor(
                                    IDBKeyRange.only(
                                        read.result.mappings.long.channel
                                    )
                                );
                            cursor.onsuccess = () => {
                                const item = cursor.result;
                                const value = item.value;
                                value.rows = Array(20001).fill(value.rows[0]);
                                item.update(value);
                            };
                        };
                        tx.oncomplete = () => {
                            db.close();
                            resolve();
                        };
                        tx.onabort = () => reject(tx.error);
                    };
                    opening.onerror = () => reject(opening.error);
                })
        );
        assert.equal(await page.evaluate(() => getGuide("long")), null);
        assert.ok(
            (await page.evaluate(() => getGuide("extra1"))).length > 0,
            "oversized cache read must leave the Worker responsive without errors"
        );
        // The actual bridge/UI must retain an actionable error after the boot
        // screen is hidden, without displaying credentials in source URLs.
        await page.goto("http://127.0.0.1:" + server.address().port);
        await page.addScriptTag({
            path: path.join(root, "js/jquery-1.11.1.min.js"),
        });
        await page.evaluate(() => {
            document.body.innerHTML =
                '<div id="launch" style="display:none"></div><div id="listCaption"></div><div id="listAbout"></div><div id="footer"></div>';
            window._ = (value, arg) => value.replace("%1", String(arg));
            window.keys = { DOWN: 40, ENTER: 13, EXIT: 27, RETURN: 8, UP: 38 };
            window.listFooter = document.getElementById("footer");
            window.saveListPanelState = () => {};
            window.restoreListPanelState = () => {};
            window.renderButtonHint = (_key, _label, title) => title;
            window.showShift = (value) => {
                window.lastNotice = value;
            };
            window.__OTTPLAY_HOSTED__ = {
                epg: {
                    source:
                        location.origin + "/feed.gz?token=private-source-test",
                    workerUrl: "/hosted/epg-worker.js",
                },
                version: 1,
            };
        });
        await page.addScriptTag({
            content: ts.transpileModule(
                fs.readFileSync(path.join(root, "src/hosted/epg.ts"), "utf8"),
                { compilerOptions: { target: ts.ScriptTarget.ES5 } }
            ).outputText,
        });
        status = 503;
        await page.evaluate(() => {
            window.epgSession = __ottHostedEpg.open(
                [{ channel_name: "РЕН ТВ HD", id: "diagnostics", rec: 168 }],
                () => {},
                (value) => $("#launch").append(value)
            );
        });
        await page.waitForFunction(
            () => __ottHostedEpg.diagnostics().phase === "error"
        );
        await page.evaluate(() => __ottHostedEpg.showDiagnostics());
        let details = await page.locator("#listAbout").innerText();
        assert.match(details, /HTTP 503/);
        assert.match(details, /EPG_HTTP/);
        assert(!details.includes("private-source-test"));
        assert.match(await page.evaluate(() => lastNotice), /EPG diagnostics/);
        status = 200;
        body = zlib.gzipSync(base);
        await page.getByRole("button", { name: "Retry EPG download" }).click();
        await page.waitForFunction(
            () => __ottHostedEpg.diagnostics().phase === "ready",
            null,
            { timeout: 45000 }
        );
        await page.waitForFunction(() =>
            document
                .getElementById("listAbout")
                .textContent.includes("EPG channels: 1/1")
        );
        details = await page.locator("#listAbout").innerText();
        assert.match(details, /EPG programmes: 3/);
        assert(!details.includes("EPG_HTTP"));
        const beforeRetry = calls;
        await page.evaluate(() => aboutKeyHandler(keys.ENTER));
        await page.waitForFunction(
            () => __ottHostedEpg.diagnostics().phase === "ready",
            null,
            { timeout: 45000 }
        );
        assert.equal(
            calls,
            beforeRetry + 1,
            "remote retry refreshes even a fresh cache"
        );
        await page.evaluate(() => aboutKeyHandler(keys.RETURN));
        assert.equal(await page.locator("#listAbout").isVisible(), false);
        await page.evaluate(() => {
            epgSession.close();
            window.Worker = undefined;
            epgSession = __ottHostedEpg.open(
                [{ id: "unsupported", name: "РЕН ТВ HD" }],
                () => {}
            );
            __ottHostedEpg.showDiagnostics();
        });
        assert.match(
            await page.locator("#listAbout").innerText(),
            /EPG_WORKER/
        );
        assert.match(
            await page.locator("#listAbout").innerText(),
            /Playback will stop/
        );
        await page.evaluate(() => {
            window.restarts = 0;
            window.restart = () => {
                restarts++;
            };
        });
        await page
            .getByRole("button", { exact: true, name: "Restart player" })
            .click();
        assert.equal(
            await page.evaluate(() => restarts),
            1,
            "restart requires an explicit action"
        );
        await page.evaluate(() => aboutKeyHandler(keys.RETURN));
        assert.equal(
            await page.evaluate(() => restarts),
            1,
            "Back only closes diagnostics"
        );
        await page.evaluate(() => {
            epgSession.close();
            window.fakeWorkers = [];
            window.Worker = function () {
                fakeWorkers.push(this);
                this.postMessage = (value) => {
                    if (value.type === "close")
                        this.onmessage({ data: { type: "closed" } });
                };
                this.terminate = () => {};
            };
            epgSession = __ottHostedEpg.open(
                [{ id: "race", name: "Fixture" }],
                () => {}
            );
            __ottHostedEpg.showDiagnostics();
            // The visible Retry label must not silently become destructive.
            fakeWorkers[0].onerror();
            document.querySelector("#listAbout button").click();
        });
        assert.equal(
            await page.evaluate(() => restarts),
            1,
            "stale Retry activation only updates its label"
        );
        assert.equal(
            await page
                .getByRole("button", { exact: true, name: "Restart player" })
                .count(),
            1
        );
        assert.match(
            await page.locator("#footer").innerText(),
            /Restart player/
        );
        await page.evaluate(() => aboutKeyHandler(keys.ENTER));
        assert.equal(
            await page.evaluate(() => restarts),
            2,
            "remote OK invokes the advertised restart"
        );
        await page.evaluate(() => {
            fakeWorkers[0].onmessage({
                data: { fetched: 1, mappings: {}, type: "ready" },
            });
            aboutKeyHandler(keys.ENTER);
        });
        assert.equal(
            await page.evaluate(() => restarts),
            2,
            "stale Restart activation cannot restart a recovered player"
        );
        assert.equal(
            await page.evaluate(() => fakeWorkers.length),
            1,
            "mode change only renders the new action"
        );
        await page.evaluate(() => aboutKeyHandler(keys.ENTER));
        assert.equal(
            await page.evaluate(() => fakeWorkers.length),
            2,
            "recovered mode retains normal retry"
        );
        await page.evaluate(() => {
            aboutKeyHandler(keys.RETURN);
            epgSession.close();
        });
        await page.evaluate(() => {
            window.Worker = function () {
                this.postMessage = () => {};
                this.terminate = () => {
                    window.stalledTerminated = true;
                };
            };
            epgSession = __ottHostedEpg.open(
                [{ id: "stalled", name: "РЕН ТВ HD" }],
                () => {}
            );
            const clock = Date.now;
            window.restoreClock = () => {
                Date.now = clock;
            };
            Date.now = () => clock() + 61000;
        });
        await page.waitForFunction(
            () => __ottHostedEpg.diagnostics().code === "EPG_STALLED"
        );
        await page.waitForFunction(() => window.stalledTerminated === true);
        await page.evaluate(() => {
            restoreClock();
            epgSession.close();
        });
        console.log(
            "PASS hosted EPG: actual ES5 worker/IndexedDB, cache refresh, gzip/XML corruption, archive windows, 50k+ records, visible diagnostics and remote retry"
        );
    } finally {
        await browser.close();
        for (const response of heldResponses) response.destroy();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
