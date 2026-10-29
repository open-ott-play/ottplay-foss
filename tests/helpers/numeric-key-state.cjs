const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const compiler = require("typescript");

// The extracted handler shares these real module initializers. Read the
// tested source, so the same fixture works before and after global navigation.
function numericKeyState() {
    const text = fs.readFileSync(
        path.resolve(__dirname, "../../src/key-handler/index.ts"),
        "utf8"
    );
    const ast = compiler.createSourceFile(
        "keys.ts",
        text,
        compiler.ScriptTarget.Latest,
        true
    );
    const names = new Set(["globalNumber", "nProg", "numTimeout", "numProgEl"]);
    const statements = ast.statements.filter(
        (node) =>
            compiler.isVariableStatement(node) &&
            node.declarationList.declarations.some(
                (row) =>
                    compiler.isIdentifier(row.name) && names.has(row.name.text)
            )
    );
    const found = new Set(
        statements.flatMap((node) =>
            node.declarationList.declarations
                .filter((row) => compiler.isIdentifier(row.name))
                .map((row) => row.name.text)
        )
    );
    const main = ast.statements.find(
        (node) =>
            compiler.isFunctionDeclaration(node) &&
            node.name?.text === "handleMainKey"
    );
    assert(main, "actual main key handler exists");
    const required = ["nProg", "numTimeout", "numProgEl"];
    if (/\bglobalNumber\b/.test(main.getText(ast)))
        required.push("globalNumber");
    for (const name of required)
        assert(found.has(name), "actual numeric binding " + name);
    return compiler.transpileModule(
        statements.map((node) => node.getText(ast)).join("\n"),
        {
            compilerOptions: {
                module: compiler.ModuleKind.None,
                target: compiler.ScriptTarget.ES5,
            },
        }
    ).outputText;
}

module.exports = numericKeyState;
