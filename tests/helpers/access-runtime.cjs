/** Load the real private authorization boundary for extracted ABI fixtures. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
module.exports = function accessRuntime(context) {
    const host = context.window || context;
    if (host.__ottParental) return;
    if (
        !host.OttPlayCore ||
        typeof host.OttPlayCore.utf16Dual32Fingerprint !== "function"
    ) {
        if (vm.isContext(context))
            require("./shared-core-runtime.cjs")(context, {
                vendorOnly: true,
            });
        else {
            const bundle = fs.readFileSync(
                path.resolve(__dirname, "../../vendor/ottplay-core.js"),
                "utf8"
            );
            // Use the actual browser realm; shadow only UMD loader arguments.
            host.eval(
                "(function(exports,module,define){\n" +
                    bundle +
                    "\n}).call(this);"
            );
            host.OttPlayCore = host["play.ott:ottplay-shared-core"];
        }
    }
    require("./pin-runtime.cjs")(context);
    for (const file of [
        "provider/source-identity",
        "access/session",
        "access/classic-adapter",
    ]) {
        const filename = path.resolve(__dirname, "../../src/" + file + ".ts");
        const code =
            "(function(){" +
            ts.transpileModule(fs.readFileSync(filename, "utf8"), {
                compilerOptions: {
                    module: ts.ModuleKind.None,
                    target: ts.ScriptTarget.ES5,
                },
            }).outputText +
            "\n})();";
        if (vm.isContext(context)) vm.runInContext(code, context, { filename });
        else host.eval(code);
    }
};
