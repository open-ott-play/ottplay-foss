const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync("src/commands/remote-provider-diagnostics.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
const context = { Date: { now: () => 1000 }, exports: {} };
vm.runInNewContext(code, context);
const snapshot = (host) =>
    JSON.parse(
        JSON.stringify(
            context.exports.providerDiagnosticsSnapshot(host, "runtime-1")
        )
    );
const secret = "https://private.invalid/config-token/movie-id";
function fixture() {
    const value = {
        catalog: {
            autoPages: true,
            busy: false,
            loadedCount: 1500,
            nextCursor: 1550,
            selectedIndex: 4,
            view: "streams",
        },
        lookup: {
            addonCount: 2,
            ageMs: 500,
            failedAddons: 1,
            id: 2,
            movieIdKind: "imdb",
            playableCount: 0,
            skippedAddons: 1,
            state: "failed",
            unsupportedCount: 0,
        },
        requests: [
            {
                addonIndex: 1,
                ageMs: 300,
                durationMs: 90,
                httpStatus: 400,
                id: 1,
                lookupId: 2,
                outcome: "http_error",
                responseBytes: null,
                stage: "stream",
            },
        ],
        requestsDropped: 0,
    };
    const host = {
        __ottActiveProviderDriver: {
            catalogBrowser: { diagnostics: () => value },
            id: "torrent",
        },
    };
    return { host, value };
}
test("provider observation retains request evidence without reading private fields or mutating the producer", () => {
    const { host, value } = fixture();
    for (const record of [
        value,
        value.catalog,
        value.lookup,
        ...value.requests,
    ]) {
        Object.defineProperty(record, "url", {
            get: () => assert.fail("private field read"),
        });
        record.token = secret;
    }
    host.fetch = host.setTimeout = () => assert.fail("side effect");
    const result = snapshot(host);
    assert.equal(result.available, true);
    assert.equal(result.runtime, "runtime-1");
    assert.equal(result.capturedAt, 1000);
    assert.equal(result.provider, "torrent");
    assert.equal(result.lookup.state, "failed");
    assert.equal(result.requests[0].httpStatus, 400);
    assert.equal(JSON.stringify(result).includes(secret), false);
    result.requests[0].httpStatus = 200;
    result.catalog.loadedCount = 0;
    assert.equal(value.requests[0].httpStatus, 400);
    assert.equal(value.catalog.loadedCount, 1500);
});
test("unavailable, replaced and throwing producers return explicit unavailable evidence", () => {
    const { host } = fixture();
    const unavailable = snapshot({});
    assert.deepEqual(unavailable, {
        available: false,
        capturedAt: 1000,
        catalog: null,
        lookup: null,
        provider: null,
        requests: [],
        requestsDropped: 0,
        runtime: "runtime-1",
        version: 1,
    });
    host.__ottActiveProviderDriver.id = "plex";
    assert.deepEqual(snapshot(host), unavailable);
    host.__ottActiveProviderDriver.id = "torrent";
    host.__ottActiveProviderDriver.catalogBrowser.diagnostics = () => {
        throw Error(secret);
    };
    assert.deepEqual(snapshot(host), unavailable);
    host.__ottActiveProviderDriver.catalogBrowser.diagnostics = () => {
        host.__ottActiveProviderDriver =
            fixture().host.__ottActiveProviderDriver;
        return fixture().value;
    };
    assert.deepEqual(snapshot(host), unavailable);
});
test("invalid or uncorrelated observations fail closed instead of exporting arbitrary producer data", () => {
    const mutations = [
        (v) => {
            v.catalog.view = secret;
        },
        (v) => {
            v.catalog.loadedCount = Infinity;
        },
        (v) => {
            v.lookup.ageMs = -1;
        },
        (v) => {
            v.lookup.addonCount = 9;
        },
        (v) => {
            v.lookup.state = secret;
        },
        (v) => {
            v.requests[0].httpStatus = 999;
        },
        (v) => {
            v.requests[0].addonIndex = 2;
        },
        (v) => {
            v.requests[0].lookupId = 1;
        },
        (v) => {
            v.requests[0].durationMs = 0.5;
        },
        (v) => {
            v.requests[0].outcome = secret;
        },
        (v) => {
            v.requests.push({ ...v.requests[0] });
        },
        (v) => {
            v.requests = Array.from({ length: 17 }, (_, i) => ({
                ...v.requests[0],
                id: i,
            }));
        },
        (v) => {
            v.lookup = null;
        },
        (v) => {
            v.requestsDropped = NaN;
        },
    ];
    for (const mutate of mutations) {
        const { host, value } = fixture();
        mutate(value);
        assert.deepEqual(snapshot(host), snapshot({}));
    }
});
test("catalog-only observation preserves unavailability of lookup and timing fields", () => {
    const { host, value } = fixture();
    value.lookup = null;
    value.requests = [];
    assert.equal(snapshot(host).available, true);
    assert.equal(snapshot(host).lookup, null);
    value.catalog = null;
    assert.equal(snapshot(host).available, true);
    assert.equal(snapshot(host).catalog, null);
    value.catalog = fixture().value.catalog;
    value.lookup = fixture().value.lookup;
    value.requests = fixture().value.requests;
    value.requests[0].httpStatus = null;
    value.requests[0].durationMs = null;
    assert.equal(snapshot(host).requests[0].httpStatus, null);
    assert.equal(snapshot(host).requests[0].durationMs, null);
});
test("provider fields are captured once and only validated values are returned", () => {
    const { host, value } = fixture();
    const expected = snapshot(host);
    for (const key of ["catalog", "lookup", "requests", "requestsDropped"]) {
        const original = value[key];
        let reads = 0;
        Object.defineProperty(value, key, {
            get: () => (++reads === 1 ? original : secret),
        });
    }
    assert.deepEqual(snapshot(host), expected);
});
test("sparse request arrays and replaced producers cannot bypass projection", () => {
    const { host, value } = fixture();
    value.requests = Array(1);
    assert.deepEqual(snapshot(host), snapshot({}));
    value.requests = fixture().value.requests;
    value.requests.map = () => [secret];
    assert.equal(snapshot(host).requests[0].httpStatus, 400);
    Object.defineProperty(value, "requestsDropped", {
        get: () => {
            host.__ottActiveProviderDriver = null;
            return 0;
        },
    });
    assert.deepEqual(snapshot(host), snapshot({}));
});
