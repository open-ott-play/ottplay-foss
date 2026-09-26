const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const assertMenuRuntime = require("./helpers/menu-runtime.cjs");

const source = fs.readFileSync(
    path.join(__dirname, "../src/ui/menu-registry.ts"),
    "utf8"
);
const code = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2015,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
acorn.parse(code, { ecmaVersion: 5 });
const host = vm.createContext({});
host.window = host;
vm.runInContext("(function(){" + code + "})();", host);
assertMenuRuntime(host.__ottMenuRegistry);
console.log(
    "PASS menu: localization, playback query bounds, provider callbacks, dynamic keys and ES5"
);
