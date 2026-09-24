const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Run the actual private implementation in the same realm as each host fixture.
module.exports = function privateRuntime(context, relativeFile) {
    const filename = path.resolve(__dirname, "../..", relativeFile);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    vm.runInContext("(function () {\n" + source + "\n}).call(this);", context, {
        filename,
    });
};
