const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const policyPath = path.join(
    root,
    "src-tauri/examples/favorites-storage-smoke/provider-storage-validation.js"
);
const policyHost = { window: {} };
vm.runInNewContext(fs.readFileSync(policyPath, "utf8"), policyHost);
const policy = policyHost.window.nativeProviderTargetValidation;
const lzHost = { exports: {} };
const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/utils/lzstring.ts"), "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
        reportDiagnostics: true,
    }
);
assert.equal(compiled.diagnostics.length, 0);
vm.runInNewContext(compiled.outputText, lzHost);
const lz = lzHost.exports;
const marker = "\x01LZ\x01";
let cases = 0;
for (const kind of ["tv", "media"]) {
    const expected = policy.expected[kind];
    assert(expected.length > 8192);
    const raw = marker + lz.compress(expected);
    const decoded = lz.decompress(raw.slice(marker.length));
    assert.equal(decoded, expected);
    assert(raw.length < expected.length);
    assert.equal(policy.validate(kind, decoded, raw), true);
    const wrong = JSON.stringify({
        padding: "different".repeat(1024),
        title: "wrong-json",
    });
    const wrongRaw = marker + lz.compress(wrong);
    assert.throws(
        () => policy.validate(kind, expected, expected),
        /not stored through the actual LZ/
    );
    assert.throws(() => policy.validate(kind, raw, raw), /exact original JSON/);
    assert.throws(
        () => policy.validate(kind, wrong, wrongRaw),
        /exact original JSON/
    );
    assert.throws(
        () => policy.validate(kind, expected, marker + expected),
        /did not become shorter/
    );
    assert.throws(
        () => policy.validate(kind, expected, raw.slice(1)),
        /not stored through the actual LZ/
    );
    cases += 6;
}
console.log(
    "PASS native provider compression acceptance: " +
        cases +
        " actual-LZ positive/negative cases; no native runtime qualification"
);
