"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const acorn = require("acorn");
const {
    assembleClassic,
    CLASSIC_MAIN_MODULES,
    CLASSIC_OPTIONAL_BUNDLES,
    CLASSIC_PROVIDER_BUNDLES,
} = require("../scripts/classic-bundle.cjs");

const root = path.resolve(__dirname, "..");
// TypeScript emits one self-installing initializer per module that needs a
// helper. Sharing one definition per bundle keeps the helper out of every
// module's payload; a second copy means the linker silently stopped linking.
const COMPILER_HELPERS = new Set([
    "__addDisposableResource",
    "__assign",
    "__asyncDelegator",
    "__asyncGenerator",
    "__asyncValues",
    "__await",
    "__awaiter",
    "__classPrivateFieldGet",
    "__classPrivateFieldIn",
    "__classPrivateFieldSet",
    "__createBinding",
    "__decorate",
    "__disposeResources",
    "__esDecorate",
    "__exportStar",
    "__extends",
    "__generator",
    "__importDefault",
    "__importStar",
    "__makeTemplateObject",
    "__metadata",
    "__param",
    "__propKey",
    "__read",
    "__rest",
    "__rewriteRelativeImportExtension",
    "__runInitializers",
    "__setFunctionName",
    "__spreadArray",
    "__spreadArrays",
    "__values",
]);

function helperCopies(source) {
    const tree = acorn.parse(source, { ecmaVersion: 5 });
    const counts = new Map();
    for (const statement of tree.body) {
        if (statement.type !== "VariableDeclaration") continue;
        for (const declaration of statement.declarations) {
            if (declaration.id.type !== "Identifier") continue;
            const name = declaration.id.name;
            if (!COMPILER_HELPERS.has(name)) continue;
            counts.set(name, (counts.get(name) || 0) + 1);
        }
    }
    return counts;
}

const bundles = [
    ["entry", CLASSIC_MAIN_MODULES],
    ...Object.entries(CLASSIC_PROVIDER_BUNDLES).map(([kind, files]) => [
        "provider-" + kind,
        files,
    ]),
    ...Object.entries(CLASSIC_OPTIONAL_BUNDLES).map(([name, files]) => [
        "optional-" + name,
        files,
    ]),
];

test("the copy counter sees a repeated compiler helper", () => {
    const copies = helperCopies(
        "var __awaiter = 1; function user() { return __awaiter; }\n" +
            "var __awaiter = 2;"
    );
    assert.equal(copies.get("__awaiter"), 2);
    assert.equal(helperCopies("var __ottListResizeTimer = 1;").size, 0);
});

test("every production bundle ships at most one copy of a compiler helper", () => {
    for (const [name, files] of bundles) {
        const copied = helperCopies(assembleClassic(root, files));
        for (const [helper, count] of copied)
            assert.ok(
                count <= 1,
                name +
                    ": " +
                    helper +
                    " is declared " +
                    count +
                    " times; the classic linker must share one copy per bundle"
            );
    }
});
