const CLASSIC_MODULES = [
    "build/polyfills/runtime.js",
    "build/polyfills/index.js",
    "build/compatibility/legacy-names.js",
    "build/shared/wire-contracts.js",
    "build/utils/lzstring.js",
    "build/storage/index.js",
    "build/localization/index.js",
    "build/settings/cloud-codec.js",
    "build/settings/cloud.js",
    "build/settings/library-backup.js",
    "build/settings/store.js",
    "build/settings/index.js",
    "build/settings/editor.js",
    "build/settings/transfer-ui.js",
    "build/utils/helpers.js",
    "build/utils/encoding.js",
    "build/utils/qrcode.js",
    "build/channels/types.js",
    "build/channels/channel-references.js",
    "build/channels/favorites-lists.js",
    "build/provider/source-identity.js",
    "build/access/session.js",
    "build/access/classic-adapter.js",
    "build/playback/session.js",
    "build/playback/journal.js",
    "build/playback/classic-adapter.js",
    "build/playback/archive.js",
    "build/playback/classic-archive.js",
    "build/channels/library.js",
    "build/channels/classic-library.js",
    "build/media/library.js",
    "build/media/journal.js",
    "build/media/classic-adapter.js",
    "build/guide/service.js",
    "build/guide/reminders.js",
    "build/guide/screen.js",
    "build/guide/classic-service.js",
    "build/guide/classic-screen.js",
    "build/guide/classic-reminders.js",
    "build/channels/index.js",
    "build/debug/playback-debug.js",
    "build/core/auto-playback.js",
    "build/core/native-hls.js",
    "build/device/adapter.js",
    "build/device/media-backend.js",
    "build/device/media-session.js",
    "build/device/native-pip.js",
    "build/core/index.js",
    "build/swop/index.js",
    "build/ui/screen-controller.js",
    "build/ui/input-router.js",
    "build/ui/classic-screen-port.js",
    "build/ui/menu-registry.js",
    "build/ui/index.js",
    "build/keyhandler/index.js",
    "build/provider/runtime.js",
    "build/provider/driver-profiles.js",
    "build/provider/channel-catalog.js",
    "build/provider/stalker-driver.js",
    "build/provider/catalog-drivers.js",
    "build/provider/catalog-xml.js",
    "build/provider/media-catalog.js",
    "build/provider/playlist-drivers.js",
    "build/provider/edem-driver.js",
    "build/provider/m3u-settings.js",
    "build/provider/m3u-driver.js",
    "build/provider/drivers.js",
    "build/provider/index.js",
    "build/commands/index.js",
    "build/app/init.js",
    "build/app/device.js",
    "build/settings/sleepTimer.js",
    "build/plugins/native-bridge.js",
    "build/plugins/web-fallback.js",
    "build/plugins/jquery-bridge.js",
    "build/plugins/native-http.js",
    "build/plugins/local-http-remote.js",
    "build/plugins/command-server.js",
    "build/plugins/mobile-native-media.js",
    "build/plugins/dash-exo-player.js",
    "build/plugins/m3u-proxy.js",
    "build/plugins/stalker-portal.js",
    "build/plugins/vportal.js",
    "build/index.js",
];
// Explicitly audited implementation boundaries; all other modules retain the
// legacy bare-global ABI. These modules publish their API as window properties
// and execute immediately at their original position in CLASSIC_MODULES.
const CLASSIC_PRIVATE_MODULES = Object.freeze({
    "build/access/classic-adapter.js": Object.freeze(["window.__ottParental"]),
    "build/access/session.js": Object.freeze(["window.__ottAccessSession"]),
    "build/channels/channel-references.js": Object.freeze([
        "window.__ottChannelReferences",
    ]),
    "build/channels/classic-library.js": Object.freeze([
        "window.__ottChannels",
    ]),
    "build/channels/library.js": Object.freeze(["window.__ottChannelLibrary"]),
    "build/debug/playback-debug.js": Object.freeze(["window.__ottDebug"]),
    "build/device/adapter.js": Object.freeze(["window.__ottDeviceAdapter"]),
    "build/device/media-backend.js": Object.freeze([
        "window.__ottMediaBackend",
    ]),
    "build/device/media-session.js": Object.freeze([
        "window.__ottOsMediaSession",
    ]),
    "build/device/native-pip.js": Object.freeze(["window.__ottNativePip"]),
    "build/guide/classic-reminders.js": Object.freeze([
        "window.__ottClassicReminders",
    ]),
    "build/guide/classic-screen.js": Object.freeze([
        "window.__ottClassicGuideScreen",
    ]),
    "build/guide/classic-service.js": Object.freeze([
        "window.__ottClassicGuide",
    ]),
    "build/guide/reminders.js": Object.freeze(["window.__ottReminderService"]),
    "build/guide/screen.js": Object.freeze(["window.__ottGuideScreen"]),
    "build/guide/service.js": Object.freeze(["window.__ottGuideService"]),
    "build/media/classic-adapter.js": Object.freeze(["window.__ottMedia"]),
    "build/media/journal.js": Object.freeze(["window.__ottMediaJournal"]),
    "build/media/library.js": Object.freeze(["window.__ottMediaLibrary"]),
    "build/playback/archive.js": Object.freeze(["window.__ottArchiveSession"]),
    "build/playback/classic-adapter.js": Object.freeze([
        "window.__ottClassicPlayback",
    ]),
    "build/playback/classic-archive.js": Object.freeze([
        "window.__ottClassicArchive",
    ]),
    "build/playback/journal.js": Object.freeze(["window.__ottPlaybackJournal"]),
    "build/playback/session.js": Object.freeze(["window.__ottPlaybackSession"]),
    "build/provider/catalog-drivers.js": Object.freeze([
        "window.__ottCatalogDrivers",
    ]),
    "build/provider/catalog-xml.js": Object.freeze(["window.__ottCatalogXml"]),
    "build/provider/channel-catalog.js": Object.freeze([
        "window.__ottChannelCatalog",
    ]),
    "build/provider/driver-profiles.js": Object.freeze([
        "window.__ottProviderDriverProfiles",
    ]),
    "build/provider/drivers.js": Object.freeze(["window.__ottProviderDrivers"]),
    "build/provider/edem-driver.js": Object.freeze(["window.__ottEdemDriver"]),
    "build/provider/m3u-driver.js": Object.freeze(["window.__ottM3uDriver"]),
    "build/provider/m3u-settings.js": Object.freeze([
        "window.__ottM3uSettings",
    ]),
    "build/provider/media-catalog.js": Object.freeze([
        "window.__ottMediaCatalog",
    ]),
    "build/provider/playlist-drivers.js": Object.freeze([
        "window.__ottPlaylistDrivers",
    ]),
    "build/provider/runtime.js": Object.freeze(["window.__ottProviderRuntime"]),
    "build/provider/source-identity.js": Object.freeze([
        "window.__ottSourceIdentity",
    ]),
    "build/provider/stalker-driver.js": Object.freeze([
        "window.__ottStalkerDriver",
    ]),
    "build/settings/cloud-codec.js": Object.freeze([
        "window.__ottCloudSettingsCodec",
    ]),
    "build/settings/library-backup.js": Object.freeze([
        "window.__ottLibraryBackup",
    ]),
    "build/ui/classic-screen-port.js": Object.freeze([
        "window.__ottClassicScreenPort",
        "window.__ottScreens",
    ]),
    "build/ui/input-router.js": Object.freeze(["window.__ottInputRouter"]),
    "build/ui/menu-registry.js": Object.freeze(["window.__ottMenuRegistry"]),
    "build/ui/screen-controller.js": Object.freeze([
        "window.__ottScreenController",
    ]),
});
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

let helperSignatures;
function emittedHelperSignatures() {
    if (!helperSignatures) {
        // Compare with this compiler's output, rather than assuming that a name
        // or a function-shaped initializer identifies a TypeScript helper.
        const emitted = ts.transpileModule(
            "export async function helperFixture(value: unknown) { return await value; }",
            {
                compilerOptions: {
                    module: ts.ModuleKind.ES2015,
                    removeComments: true,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText;
        const source = ts.createSourceFile(
            "typescript-helpers.js",
            emitted,
            ts.ScriptTarget.ES5,
            true,
            ts.ScriptKind.JS
        );
        helperSignatures = new Map();
        for (const statement of source.statements) {
            const name = helperName(statement);
            if (name) helperSignatures.set(name, helperSignature(statement));
        }
    }
    return helperSignatures;
}

const helperPrinter = ts.createPrinter({ removeComments: true });
function helperSignature(statement) {
    return helperPrinter.printNode(
        ts.EmitHint.Unspecified,
        statement,
        statement.getSourceFile()
    );
}

function helperName(statement) {
    if (
        !ts.isVariableStatement(statement) ||
        statement.declarationList.declarations.length !== 1
    )
        return undefined;
    const name = statement.declarationList.declarations[0].name;
    return ts.isIdentifier(name) &&
        (name.text === "__awaiter" || name.text === "__generator")
        ? name.text
        : undefined;
}

function duplicateHelpers(sources, checker) {
    const signatures = emittedHelperSignatures();
    const occurrences = new Map();
    const emitted = new Set();
    for (const source of sources) {
        for (const statement of source.statements) {
            const name = helperName(statement);
            if (name && helperSignature(statement) === signatures.get(name)) {
                if (!occurrences.has(name)) occurrences.set(name, []);
                occurrences.get(name).push(statement);
                emitted.add(statement);
            }
        }
    }
    const duplicates = new Set(
        Array.from(occurrences)
            .filter(([, statements]) => statements.length > 1)
            .map(([name]) => name)
    );
    if (!duplicates.size) return new Set();

    function isSharedBinding(node) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent)
            ? checker.getShorthandAssignmentValueSymbol(node.parent)
            : checker.getSymbolAtLocation(node);
        return (
            !symbol ||
            (symbol.declarations || []).some((declaration) => {
                // Parameters, local variables and named function expressions
                // do not share the classic script's top-level helper binding.
                if (ts.isFunctionExpression(declaration)) return false;
                for (
                    let owner = declaration.parent;
                    owner;
                    owner = owner.parent
                ) {
                    if (ts.isFunctionLike(owner)) return false;
                    if (ts.isSourceFile(owner)) return true;
                }
                return false;
            })
        );
    }
    function hasDynamicCodeReference(node) {
        if (
            ts.isIdentifier(node) &&
            (node.text === "eval" || node.text === "Function")
        ) {
            const parent = node.parent;
            const propertyKey =
                (ts.isPropertyAssignment(parent) ||
                    ts.isMethodDeclaration(parent) ||
                    ts.isGetAccessorDeclaration(parent) ||
                    ts.isSetAccessorDeclaration(parent)) &&
                parent.name === node;
            if (!propertyKey && isSharedBinding(node)) return true;
        }
        return ts.forEachChild(node, hasDynamicCodeReference) || false;
    }
    // Known dynamic-code entry points (including aliases and indirect eval)
    // can reset a shared helper between initializers. Their source is unknown,
    // so retain the original fallbacks. This is not a general host-effect proof.
    if (sources.some(hasDynamicCodeReference)) return new Set();
    function conflict(source, name) {
        throw new Error(
            source.fileName + ": conflicting classic TypeScript helper: " + name
        );
    }
    for (const source of sources) {
        function visit(node) {
            if (emitted.has(node)) return;
            if (
                ts.isPropertyAccessExpression(node) ||
                ts.isElementAccessExpression(node)
            ) {
                const property = ts.isPropertyAccessExpression(node)
                    ? node.name.text
                    : ts.isStringLiteral(node.argumentExpression)
                      ? node.argumentExpression.text
                      : undefined;
                const target = node.expression;
                if (
                    duplicates.has(property) &&
                    (target.kind === ts.SyntaxKind.ThisKeyword ||
                        (ts.isIdentifier(target) &&
                            ["window", "self", "globalThis", "global"].includes(
                                target.text
                            ) &&
                            isSharedBinding(target)))
                )
                    conflict(source, property);
            }
            if (ts.isIdentifier(node) && duplicates.has(node.text)) {
                const parent = node.parent;
                const propertyName =
                    (ts.isPropertyAccessExpression(parent) &&
                        parent.name === node) ||
                    ((ts.isPropertyAssignment(parent) ||
                        ts.isMethodDeclaration(parent)) &&
                        parent.name === node);
                const helperCall =
                    ts.isCallExpression(parent) && parent.expression === node;
                // Compiler call sites are safe. An assignment, alternate global
                // declaration or escaping reference could make a later fallback
                // initializer observable, so fail closed instead of removing it.
                if (!propertyName && !helperCall && isSharedBinding(node))
                    conflict(source, node.text);
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
    // Keep the first initialization in its original position: preceding code
    // and a pre-existing global helper must see the same execution order.
    return new Set(
        Array.from(occurrences.values()).flatMap((items) => items.slice(1))
    );
}

// The manifest is data, not executable build configuration. Only public classic
// bindings are lowered; property names and lexical shadow bindings stay intact.
function classicLegacyNames(root, sources) {
    const source = sources.find(
        (item) =>
            path.resolve(item.fileName) ===
            path.resolve(root, "build/compatibility/legacy-names.js")
    );
    const names = new Map();
    if (!source) return names;
    let initializer;
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (
                ts.isIdentifier(declaration.name) &&
                declaration.name.text === "legacyPlayerBindings"
            )
                initializer = declaration.initializer;
        }
    }
    if (!initializer || !ts.isArrayLiteralExpression(initializer))
        throw new Error("Classic legacy-name manifest must be a literal array");
    const legacy = new Set();
    for (const entry of initializer.elements) {
        if (
            !ts.isArrayLiteralExpression(entry) ||
            entry.elements.length !== 2 ||
            !entry.elements.every((item) => ts.isStringLiteral(item))
        )
            throw new Error("Invalid classic legacy-name entry");
        const [canonical, previous] = entry.elements.map((item) => item.text);
        if (
            !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(canonical) ||
            !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(previous) ||
            canonical === previous ||
            names.has(canonical) ||
            legacy.has(previous)
        )
            throw new Error("Conflicting classic legacy-name entry");
        names.set(canonical, previous);
        legacy.add(previous);
    }
    for (const name of names.keys()) {
        if (legacy.has(name))
            throw new Error("Chained classic legacy names are unsupported");
    }
    return names;
}

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
    const privateFiles = new Set(
        Object.keys(CLASSIC_PRIVATE_MODULES).map((file) =>
            path.resolve(root, file)
        )
    );
    const isPrivate = (source) =>
        privateFiles.has(path.resolve(source.fileName));
    const legacyNames = classicLegacyNames(root, sources);
    const loweredGlobals = new Set(legacyNames.values());
    // A private module's compiler helpers belong to its own function scope.
    const redundantHelpers = duplicateHelpers(
        sources.filter((source) => !isPrivate(source)),
        checker
    );
    const privateNames = new Set();
    for (const source of sources.filter(isPrivate)) {
        for (const statement of source.statements) {
            if (
                ts.isImportDeclaration(statement) ||
                ts.isExportAssignment(statement) ||
                ts.isExportDeclaration(statement) ||
                (statement.modifiers || []).some(
                    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
                )
            )
                throw new Error(
                    source.fileName +
                        ": private classic module must publish window properties, not module bindings"
                );
        }
        function collectPrivateNames(node) {
            if (ts.isFunctionDeclaration(node)) {
                if (node.name) privateNames.add(node.name.text);
                return;
            }
            if (ts.isFunctionLike(node)) return;
            if (
                ts.isVariableDeclaration(node) &&
                !ts.isCatchClause(node.parent) &&
                ts.isIdentifier(node.name)
            )
                privateNames.add(node.name.text);
            ts.forEachChild(node, collectPrivateNames);
        }
        collectPrivateNames(source);
    }
    // Catch ordinary static dependencies on a newly private implementation.
    // Dynamic property names remain part of the explicit boundary audit.
    for (const source of sources.filter((source) => !isPrivate(source))) {
        function visitPrivateReference(node) {
            if (ts.isIdentifier(node) && privateNames.has(node.text)) {
                const symbol = checker.getSymbolAtLocation(node);
                if (
                    symbol?.declarations?.length &&
                    symbol.declarations.every((declaration) =>
                        isPrivate(declaration.getSourceFile())
                    )
                )
                    throw new Error(
                        source.fileName +
                            ": reference to private classic binding: " +
                            node.text
                    );
            }
            if (
                ts.isPropertyAccessExpression(node) ||
                ts.isElementAccessExpression(node)
            ) {
                const name = ts.isPropertyAccessExpression(node)
                    ? node.name.text
                    : ts.isStringLiteral(node.argumentExpression)
                      ? node.argumentExpression.text
                      : undefined;
                if (
                    privateNames.has(name) &&
                    ts.isIdentifier(node.expression) &&
                    ["window", "self", "globalThis", "global"].includes(
                        node.expression.text
                    ) &&
                    !(
                        checker.getSymbolAtLocation(node.expression)
                            ?.declarations || []
                    ).some((declaration) => {
                        for (
                            let owner = declaration.parent;
                            owner;
                            owner = owner.parent
                        ) {
                            if (ts.isFunctionLike(owner)) return true;
                            if (ts.isSourceFile(owner)) return false;
                        }
                        return false;
                    })
                )
                    throw new Error(
                        source.fileName +
                            ": reference to private classic binding: " +
                            name
                    );
            }
            ts.forEachChild(node, visitPrivateReference);
        }
        visitPrivateReference(source);
    }
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
        if (isPrivate(source)) continue;
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
    for (const [canonical, legacy] of legacyNames) {
        if (globals.has(canonical) && globals.has(legacy))
            throw new Error(
                "Classic canonical/legacy declarations collide: " + canonical
            );
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
            if (redundantHelpers.has(statement)) {
                replace(statement, "");
            } else if (ts.isImportDeclaration(statement)) {
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
                if (
                    clause &&
                    privateFiles.has(path.resolve(resolved.resolvedFileName))
                )
                    throw new Error(
                        source.fileName +
                            ": cannot import bindings from a private classic module"
                    );
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
                        const emittedName =
                            legacyNames.get(declaration.name.text) ||
                            declaration.name.text;
                        if (entry.name.text !== emittedName)
                            aliases.set(alias, emittedName);
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
                const parent = node.parent;
                const propertyName =
                    (ts.isPropertyAccessExpression(parent) &&
                        parent.name === node) ||
                    ((ts.isPropertyAssignment(parent) ||
                        ts.isMethodDeclaration(parent) ||
                        ts.isGetAccessorDeclaration(parent) ||
                        ts.isSetAccessorDeclaration(parent)) &&
                        parent.name === node) ||
                    (ts.isBindingElement(parent) &&
                        parent.propertyName === node) ||
                    ts.isLabeledStatement(parent) ||
                    ts.isBreakStatement(parent) ||
                    ts.isContinueStatement(parent);
                function isSharedDeclaration(declaration) {
                    for (
                        let owner = declaration.parent;
                        owner;
                        owner = owner.parent
                    ) {
                        if (ts.isFunctionLike(owner)) return false;
                        if (ts.isSourceFile(owner)) return !isPrivate(owner);
                    }
                    return false;
                }
                const legacy = !propertyName && legacyNames.get(node.text);
                if (
                    !target &&
                    legacy &&
                    (!symbol ||
                        (symbol.declarations || []).some(isSharedDeclaration))
                ) {
                    const captured = checker.resolveName(
                        legacy,
                        node,
                        ts.SymbolFlags.Value,
                        false
                    );
                    const localCapture = (captured?.declarations || []).some(
                        (declaration) => !isSharedDeclaration(declaration)
                    );
                    if (localCapture) {
                        const write =
                            (ts.isBinaryExpression(parent) &&
                                parent.left === node &&
                                parent.operatorToken.kind >=
                                    ts.SyntaxKind.FirstAssignment &&
                                parent.operatorToken.kind <=
                                    ts.SyntaxKind.LastAssignment) ||
                            ((ts.isPrefixUnaryExpression(parent) ||
                                ts.isPostfixUnaryExpression(parent)) &&
                                (parent.operator ===
                                    ts.SyntaxKind.PlusPlusToken ||
                                    parent.operator ===
                                        ts.SyntaxKind.MinusMinusToken)) ||
                            ((ts.isForInStatement(parent) ||
                                ts.isForOfStatement(parent)) &&
                                parent.initializer === node);
                        if (write)
                            throw new Error(
                                "Classic legacy write would capture a local binding: " +
                                    legacy
                            );
                        const read = reader(legacy);
                        replace(
                            node,
                            shorthand
                                ? node.text + ": " + read
                                : "(" + read + ")"
                        );
                    } else {
                        replace(
                            node,
                            shorthand ? node.text + ": " + legacy : legacy
                        );
                    }
                }
                if (target) {
                    const captured = checker.resolveName(
                        target,
                        node,
                        ts.SymbolFlags.Value,
                        false
                    );
                    const localCapture = (captured?.declarations || []).some(
                        (declaration) => !isSharedDeclaration(declaration)
                    );
                    // An unshadowed legacy global is already a live binding.
                    // Keep the reader only where lowering would capture a local.
                    if (loweredGlobals.has(target) && !localCapture) {
                        replace(
                            node,
                            shorthand ? node.text + ": " + target : target
                        );
                        return;
                    }
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
        // call(this) preserves the classic script's top-level receiver. Do not
        // defer initialization or add strict mode: both would change behavior.
        return isPrivate(source)
            ? "(function () {\n" + text + "\n}).call(this);"
            : text;
    });
    const prelude = Array.from(
        readers,
        ([name, id]) => "function " + id + "() { return " + name + "; }"
    ).join("\n");
    return prelude + "\n" + linked.join("\n");
}

module.exports = { assembleClassic, CLASSIC_MODULES, CLASSIC_PRIVATE_MODULES };
