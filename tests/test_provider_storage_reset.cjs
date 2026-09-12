/* Use one classic-script scope, as the shipped concatenated bundle does. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.join(__dirname, "..");
const methods = ["GetItem", "HasItem", "HasItemValue", "SetItem", "DelItem"];
const aliasNames = methods.map((method) => "_provider" + method);

function declarations(file, names) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const selected = [];
    const found = [];
    for (const node of ast.statements) {
        if (ts.isFunctionDeclaration(node) && node.body) {
            const name = node.name.text;
            if (!names || names.includes(name)) {
                selected.push(node.getText(ast).replace(/^export\s+/, ""));
                found.push(name);
            }
        } else if (ts.isVariableStatement(node)) {
            for (const entry of node.declarationList.declarations) {
                const name = entry.name.getText(ast);
                if (entry.initializer && (!names || names.includes(name))) {
                    selected.push("var " + entry.getText(ast) + ";");
                    found.push(name);
                }
            }
        }
    }
    if (names) {
        for (const name of names)
            assert(found.includes(name), file + ": " + name);
    }
    return { code: selected.join("\n"), names: found };
}

const lz = declarations("src/utils/lzstring.ts");
const storage = declarations("src/storage/index.ts");
const code = process.argv.includes("--bundle")
    ? declarations("dist/stbPlayer.js", [
          ...lz.names,
          ...storage.names,
          "__spreadArray",
          "loadProv",
          ...aliasNames,
      ]).code
    : [
          lz.code,
          storage.code,
          declarations("src/provider/index.ts", ["loadProv"]).code,
          declarations("src/index.ts", aliasNames).code,
      ].join("\n");

const saved = new Map();
let firstRuns = 0;
const context = {
    $() {
        return {
            append() {
                return this;
            },
            hide() {
                return this;
            },
            is: () => true,
        };
    },
    arrayProvaiders: [],
    console,
    firstRun() {
        firstRuns++;
    },
    launch_id: "#launch",
    localStorage: {
        getItem: (key) => (saved.has(key) ? saved.get(key) : null),
        removeItem: (key) => saved.delete(key),
        setItem: (key, value) => saved.set(key, String(value)),
    },
    location: { search: "" },
    popupActions: [],
    popupArray: [],
    popupDetail: [],
    savedPopup: {
        popupActions: [() => {}],
        popupArray: ["Menu"],
        popupDetail: [""],
        ver: "fixture",
    },
};
context.window = context;
vm.createContext(context);
vm.runInContext(
    ts.transpileModule(code, {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText,
    context
);

// First-run reset and repeated reloads must restore originals after provider overrides.
for (let round = 0; round < 3; round++) {
    if (round) {
        for (const method of methods) {
            context["provider" + method] = () => {
                throw new Error(
                    "Previous provider implementation must be discarded"
                );
            };
        }
    }
    context.loadProv();
    assert.equal(firstRuns, round + 1);
    context.setProviderPrefix("provider-" + round + ":");
    assert.equal(context.providerHasItem("missing"), false);
    assert.equal(context.providerGetItem("missing"), null);
    context.providerSetItem("empty", "");
    assert.equal(context.providerHasItem("empty"), true);
    assert.equal(context.providerHasItemValue("empty"), false);
    const value = "EPG history Кириллица ".repeat(50);
    context.providerSetItem("history", value);
    assert.equal(context.providerGetItem("history"), value);
    assert.equal(context.providerHasItemValue("history"), true);
    assert(
        saved.get("provider-" + round + ":history").startsWith("\x01LZ\x01")
    );
    context.providerDelItem("history");
    assert.equal(context.providerHasItem("history"), false);
    assert.equal(context.providerHasItemValue("history"), false);
}
console.log(
    "PASS provider storage reset: first run + 2 reloads, all 5 helpers"
);
