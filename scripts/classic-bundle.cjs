const CLASSIC_MODULES = [
    "build/polyfills/index.js",
    "build/utils/lzstring.js",
    "build/storage/index.js",
    "build/localization/index.js",
    "build/settings/cloud.js",
    "build/settings/index.js",
    "build/utils/helpers.js",
    "build/utils/encoding.js",
    "build/utils/qrcode.js",
    "build/channels/types.js",
    "build/channels/favorites-lists.js",
    "build/channels/search.js",
    "build/channels/index.js",
    "build/debug/playback-debug.js",
    "build/core/index.js",
    "build/swop/index.js",
    "build/ui/index.js",
    "build/keyhandler/index.js",
    "build/provider/index.js",
    "build/commands/index.js",
    "build/app/init.js",
    "build/app/device.js",
    "build/settings/sleepTimer.js",
    "build/plugins/native-bridge.js",
    "build/plugins/native-http.js",
    "build/plugins/local-http-remote.js",
    "build/plugins/mobile-native-media.js",
    "build/plugins/dash-exo-player.js",
    "build/plugins/m3u-proxy.js",
    "build/plugins/stalker-portal.js",
    "build/index.js",
];
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// These modules deliberately share a classic-script global ABI. Resolve actual
// import symbols instead of dropping import lines and leaving aliases undefined.
function assembleClassic(root, modules) {
    const files = modules.map((file) => path.resolve(root, file));
    const included = new Set(files);
    for (const file of files) {
        if (!fs.existsSync(file))
            throw new Error("Required bundle module missing: " + file);
    }
    const options = {
        allowJs: true,
        checkJs: false,
        module: ts.ModuleKind.ES2015,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        noEmit: true,
        noLib: true,
        target: ts.ScriptTarget.ES5,
        types: [],
    };
    const program = ts.createProgram(files, options);
    const checker = program.getTypeChecker();
    const host = ts.createCompilerHost(options);
    const sources = files.map((file) => program.getSourceFile(file));
    // app/state is an ESM-only mirror; index.ts owns these arrays for provider ABI.
    // Every deliberate bridge is enumerated and checked against emitted declarations.
    const bridges = new Map([
        [
            path.resolve(root, "build/app/state.js"),
            new Set(["popupActions", "popupArray", "popupDetail"]),
        ],
    ]);
    const globals = new Set();
    for (const source of sources) {
        for (const statement of source.statements) {
            if (
                (ts.isFunctionDeclaration(statement) ||
                    ts.isClassDeclaration(statement)) &&
                statement.name
            )
                globals.add(statement.name.text);
            if (ts.isVariableStatement(statement))
                for (const declaration of statement.declarationList
                    .declarations) {
                    if (ts.isIdentifier(declaration.name))
                        globals.add(declaration.name.text);
                }
        }
    }
    const allText = sources.map((source) => source.text).join("\n");
    const readers = new Map();
    function reader(name) {
        if (!readers.has(name)) {
            let id = "__ottReadImport" + readers.size;
            while (
                allText.includes(id) ||
                Array.from(readers.values()).includes(id)
            )
                id += "_";
            readers.set(name, id);
        }
        return readers.get(name) + "()";
    }
    const linked = sources.map((source) => {
        const edits = [];
        const aliases = new Map();
        function replace(node, text) {
            edits.push({ end: node.end, start: node.getStart(source), text });
        }
        for (const statement of source.statements) {
            if (ts.isImportDeclaration(statement)) {
                const specifier = statement.moduleSpecifier.text;
                const resolved = ts.resolveModuleName(
                    specifier,
                    source.fileName,
                    options,
                    host
                ).resolvedModule;
                const bridge =
                    resolved &&
                    bridges.get(path.resolve(resolved.resolvedFileName));
                if (
                    !specifier.startsWith(".") ||
                    !resolved ||
                    (!included.has(path.resolve(resolved.resolvedFileName)) &&
                        !bridge)
                ) {
                    throw new Error(
                        source.fileName +
                            ": runtime import is not in CLASSIC_MODULES: " +
                            specifier
                    );
                }
                const clause = statement.importClause;
                if (!clause && bridge)
                    throw new Error(
                        source.fileName +
                            ": ESM-only state cannot be imported for side effects"
                    );
                if (clause) {
                    if (
                        clause.name ||
                        (clause.namedBindings &&
                            !ts.isNamedImports(clause.namedBindings))
                    ) {
                        throw new Error(
                            source.fileName +
                                ": classic modules require named imports: " +
                                specifier
                        );
                    }
                    for (const entry of clause.namedBindings?.elements || []) {
                        const alias = checker.getSymbolAtLocation(entry.name);
                        if (bridge) {
                            const name = (entry.propertyName || entry.name)
                                .text;
                            if (!bridge.has(name) || !globals.has(name))
                                throw new Error(
                                    source.fileName +
                                        ": missing explicit classic bridge: " +
                                        name
                                );
                            if (entry.name.text !== name)
                                aliases.set(alias, name);
                            continue;
                        }
                        const target = alias && checker.getAliasedSymbol(alias);
                        const declaration = target && target.valueDeclaration;
                        if (
                            !declaration ||
                            !declaration.name ||
                            !ts.isIdentifier(declaration.name) ||
                            !included.has(
                                path.resolve(
                                    declaration.getSourceFile().fileName
                                )
                            )
                        ) {
                            throw new Error(
                                source.fileName +
                                    ": unresolved classic import: " +
                                    entry.name.text
                            );
                        }
                        if (entry.name.text !== declaration.name.text)
                            aliases.set(alias, declaration.name.text);
                    }
                }
                replace(statement, "");
            } else if (ts.isExportDeclaration(statement)) {
                if (statement.moduleSpecifier) {
                    const resolved = ts.resolveModuleName(
                        statement.moduleSpecifier.text,
                        source.fileName,
                        options,
                        host
                    ).resolvedModule;
                    if (
                        !resolved ||
                        !included.has(path.resolve(resolved.resolvedFileName))
                    ) {
                        throw new Error(
                            source.fileName +
                                ": re-export target missing from CLASSIC_MODULES"
                        );
                    }
                }
                replace(statement, "");
            } else if (ts.isExportAssignment(statement)) {
                throw new Error(
                    source.fileName + ": classic modules require named exports"
                );
            } else {
                for (const modifier of statement.modifiers || []) {
                    if (modifier.kind === ts.SyntaxKind.ExportKeyword)
                        replace(modifier, "");
                    if (modifier.kind === ts.SyntaxKind.DefaultKeyword)
                        throw new Error(
                            source.fileName + ": unsupported default export"
                        );
                }
            }
        }
        function visit(node) {
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
                return;
            if (ts.isIdentifier(node)) {
                const shorthand =
                    ts.isShorthandPropertyAssignment(node.parent) &&
                    node.parent.name === node;
                const symbol = shorthand
                    ? checker.getShorthandAssignmentValueSymbol(node.parent)
                    : checker.getSymbolAtLocation(node);
                const target = aliases.get(symbol);
                if (target) {
                    // A reader preserves live values and cannot capture a same-named
                    // function parameter in the importing module. It needs no ES2015 API.
                    const read = reader(target);
                    replace(
                        node,
                        shorthand ? node.text + ": " + read : "(" + read + ")"
                    );
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
        let text = source.text;
        for (const edit of edits.sort((a, b) => b.start - a.start))
            text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
        return text;
    });
    const prelude = Array.from(
        readers,
        ([name, id]) => "function " + id + "() { return " + name + "; }"
    ).join("\n");
    return prelude + "\n" + linked.join("\n");
}

module.exports = { assembleClassic, CLASSIC_MODULES };
