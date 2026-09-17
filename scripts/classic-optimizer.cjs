const { createHash } = require("node:crypto");
const { parse } = require("acorn");
const { minify } = require("terser");
const { version: engineVersion } = require("terser/package.json");

function classicOptimizerMetadata() {
    // Device/provider scripts load later and may read or replace any global.
    // Menu preferences also persist callback.name; arity is part of the ABI.
    // Return fresh options because Terser may normalize its input options.
    return {
        contracts: {
            classicGlobals: true,
            functionArity: true,
            functionNames: true,
            propertyNames: true,
            sourceText: false,
        },
        engine: "terser",
        engineVersion,
        options: {
            compress: {
                defaults: true,
                drop_console: false,
                drop_debugger: false,
                keep_fargs: true,
                passes: 1,
                pure_getters: false,
                toplevel: false,
                // Terser documents typeof rewrites as unsafe on IE <= 10.
                typeofs: false,
                unsafe: false,
            },
            ecma: 5,
            format: { comments: false, webkit: true },
            ie8: true,
            keep_classnames: true,
            keep_fnames: true,
            mangle: { eval: false, properties: false, toplevel: false },
            module: false,
            safari10: true,
            toplevel: false,
        },
        schema: 1,
    };
}

function classicGlobals(source) {
    const ast = parse(source, { ecmaVersion: 5, sourceType: "script" });
    const names = new Set();
    function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "FunctionDeclaration") {
            names.add(node.id.name);
            return;
        }
        if (node.type === "FunctionExpression") return;
        if (node.type === "VariableDeclaration") {
            for (const declaration of node.declarations)
                names.add(declaration.id.name);
        }
        // Include hoisted var declarations inside top-level control flow,
        // without treating catch parameters or function locals as globals.
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
        }
    }
    visit(ast);
    return Array.from(names).sort();
}

function sha256(source) {
    return createHash("sha256").update(source, "utf8").digest("hex");
}

async function optimizeClassic(source) {
    if (typeof source !== "string")
        throw new TypeError("Classic optimizer requires an ES5 source string");
    const globalNames = classicGlobals(source);
    const metadata = classicOptimizerMetadata();
    const result = await minify(source, metadata.options);
    if (typeof result.code !== "string")
        throw new Error("Classic optimizer produced no JavaScript");
    const outputGlobals = new Set(classicGlobals(result.code));
    const missing = globalNames.filter((name) => !outputGlobals.has(name));
    if (missing.length)
        throw new Error(
            "Classic optimizer removed globals: " + missing.join(", ")
        );
    return {
        code: result.code,
        report: {
            globalNames,
            inputBytes: Buffer.byteLength(source, "utf8"),
            inputSha256: sha256(source),
            optimizer: classicOptimizerMetadata(),
            outputBytes: Buffer.byteLength(result.code, "utf8"),
            outputSha256: sha256(result.code),
        },
    };
}

module.exports = { classicOptimizerMetadata, optimizeClassic };
