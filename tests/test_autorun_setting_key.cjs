"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
for (const file of ["src/core/index.ts", "devices/legacy-core.js"]) {
    const source = fs.readFileSync(file, "utf8"),
        ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find(
        (node) =>
            ts.isFunctionDeclaration(node) && node.name?.text === "setAutorun"
    );
    assert(fn, file);
    const code = ts.transpileModule(fn.getText(ast).replace(/^export /, ""), {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
    for (const [canonical, legacy, expected] of [
        [null, null, 0],
        [null, "1", 1],
        ["0", "1", 0],
        ["1", "0", 1],
        ["invalid", "1", 0],
    ]) {
        let starts = 0;
        const context = {
            console: { log() {} },
            startPlayer: () => starts++,
            stbGetItem: (key) => (key === "sAutorun" ? canonical : legacy),
        };
        context.window = context;
        vm.runInNewContext(code + "\nsetAutorun();", context);
        assert.equal(starts, expected, file + ": " + canonical + "/" + legacy);
    }
}
console.log(
    "PASS autorun compatibility: registered key wins, legacy fallback only when absent, no OS startup claim"
);
