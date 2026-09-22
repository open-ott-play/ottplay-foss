/* Bootstrap the shipped vendor artifact in the fixture's own JavaScript realm. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const filename = path.resolve(__dirname, "../../vendor/ottplay-core.js");
const script = new vm.Script(fs.readFileSync(filename, "utf8"), { filename });
module.exports = function sharedCoreRuntime(context) {
    assert(
        vm.isContext(context),
        "Pass the actual context used by the host fixture"
    );
    const saved = {};
    // The browser artifact must use its browser export even in a CommonJS test.
    for (const key of ["exports", "module", "define"]) {
        saved[key] = Object.getOwnPropertyDescriptor(context, key);
        Object.defineProperty(context, key, {
            configurable: true,
            value: undefined,
            writable: true,
        });
    }
    try {
        script.runInContext(context);
    } finally {
        for (const key of Object.keys(saved)) {
            if (saved[key]) Object.defineProperty(context, key, saved[key]);
            else delete context[key];
        }
    }
    const core = context["play.ott:ottplay-shared-core"];
    assert(core, "Vendor browser export is present");
    (context.window || context).OttPlayCore = core;
    return core;
};
