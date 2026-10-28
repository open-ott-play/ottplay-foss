// Use the actual optional-transfer admission path in legacy dispatcher fixtures.
// Unknown dependencies remain the caller's responsibility; no caps are fabricated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const files = {
    "../storage/index": "src/storage/index.ts",
    "../utils/helpers": "src/utils/helpers.ts",
    "../utils/lzstring": "src/utils/lzstring.ts",
    "./remote-favorites-transfer": "src/commands/remote-favorites-transfer.ts",
    "./remote-feature": "src/commands/remote-feature.ts",
};
module.exports = function dependency(name, host, environment = {}) {
    if (!Object.hasOwn(files, name)) return null;
    const exports = {};
    const output = ts.transpileModule(
        fs.readFileSync(path.resolve(__dirname, "../..", files[name]), "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    acorn.parse(output, { ecmaVersion: 5 });
    vm.runInNewContext(output, {
        ...environment,
        exports,
        require: (next) => {
            const value = dependency(next, host, environment);
            assert(value, "Unexpected transfer fixture dependency: " + next);
            return value;
        },
        window: host,
    });
    return exports;
};
