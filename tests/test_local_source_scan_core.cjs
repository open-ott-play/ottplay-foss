"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const realm = vm.createContext({ exports: {} });
realm.window = realm;
require("./helpers/shared-core-runtime.cjs")(realm, { vendorOnly: true });
const compiled = ts.transpileModule(
    fs.readFileSync(
        path.join(__dirname, "../src/offline/playback-selection.ts"),
        "utf8"
    ),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
vm.runInContext(compiled, realm);
const sourceScan = realm.exports.localSourceScan;
const scan = (generation, state = "complete") => ({
    generation,
    sourceId: "selected",
    state,
});

test("local source protocol keeps omitted legacy, advertised pending and host record identity distinct", () => {
    assert.equal(sourceScan({}, "selected"), null);
    const pending = sourceScan({ sourceScans: [] }, "selected");
    assert.equal(pending.generation, 0);
    assert.equal(pending.state, "pending");
    const record = scan(1);
    assert.equal(
        sourceScan(
            { sourceScans: [null, { sourceId: "other" }, record] },
            "selected"
        ),
        record
    );
    assert.equal(
        sourceScan({ sourceScans: [{ sourceId: "other" }] }, "selected")
            .generation,
        0
    );
});

test("local source protocol rejects duplicate, malformed and unsafe matching records", () => {
    const rejected = (catalog) =>
        assert.throws(
            () => sourceScan(catalog, "selected"),
            (error) => error.localMediaCode === "catalog_unavailable"
        );
    for (const sourceScans of [null, false, {}, "legacy"])
        rejected({ sourceScans });
    rejected({ sourceScans: [scan(1), scan(1)] });
    for (const generation of [
        undefined,
        null,
        false,
        true,
        "1",
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        9007199254740992,
    ])
        rejected({ sourceScans: [scan(generation)] });
    assert.equal(
        sourceScan({ sourceScans: [scan(9007199254740991)] }, "selected")
            .generation,
        9007199254740991
    );
    for (const state of [null, "", "Complete", "future"])
        rejected({ sourceScans: [scan(1, state)] });
    for (const state of ["pending", "scanning", "complete", "error"])
        assert.equal(
            sourceScan({ sourceScans: [scan(1, state)] }, "selected").state,
            state
        );
});
