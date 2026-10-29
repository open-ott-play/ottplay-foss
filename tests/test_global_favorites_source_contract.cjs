"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    ts = require("typescript"),
    acorn = require("acorn");
const files = [
    "src/commands/remote-requests.ts",
    "src/commands/global-favorites.ts",
    "src/media/global-favorites-host.ts",
    "src/commands/remote-favorites.ts",
    "src/commands/global-favorites-protocol.ts",
    "src/commands/global-favorites-items.ts",
    "src/settings/global-favorites.ts",
    "src/settings/global-favorites-facade.ts",
    "src/settings/global-favorites-receipts.ts",
    "src/settings/global-favorites-recovery.ts",
    "src/settings/global-favorites-receipt-codec.ts",
    "src/settings/favorites-operation-receipts.ts",
];
for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES5,
            module: ts.ModuleKind.CommonJS,
        },
        reportDiagnostics: true,
    });
    assert.equal(
        compiled.diagnostics.length,
        0,
        name +
            ": " +
            compiled.diagnostics
                .map((x) => ts.flattenDiagnosticMessageText(x.messageText, " "))
                .join("; ")
    );
    acorn.parse(compiled.outputText, { ecmaVersion: 5 });
}
console.log("PASS actual owned source syntax and emitted ES5");
