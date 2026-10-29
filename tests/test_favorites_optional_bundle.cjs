"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const {
    assembleClassic,
    CLASSIC_MODULES,
    CLASSIC_OPTIONAL_BUNDLES,
    CLASSIC_MAIN_MODULES,
} = require("../scripts/classic-bundle.cjs");
const modules = [
    "commands/favorites-document-json",
    "commands/favorites-transfer",
    "commands/favorites-recovery",
    "settings/favorites-bindings",
    "settings/favorites-operation-receipts",
    "settings/favorites-recovery-codec",
    "media/favorites-plex-codec",
    "media/favorites-plex-document",
    "channels/favorites-plex-references",
    "media/favorites-transfer-port",
    "settings/global-favorites-bindings",
    "settings/favorites-current-plex-host",
    "plugins/favorites-transfer-runtime",
    "settings/global-favorites-portable",
    "settings/global-favorites",
    "settings/global-favorites-facade",
    "settings/global-favorites-receipt-codec",
    "settings/global-favorites-receipts",
    "settings/global-favorites-recovery",
    "commands/global-favorites-protocol",
    "media/global-favorites-identities",
    "media/global-favorites-providers",
    "media/global-favorites-router",
    "media/global-favorites-navigation",
    "media/global-favorites-player",
    "media/global-favorites-view",
    "media/global-favorites-capture",
    "media/global-favorites-migration",
    "commands/global-favorites-items",
    "media/global-favorites-host",
];
test("production registration keeps exact optional graph and main-owned dispatcher/storage", () => {
    assert.deepEqual(
        CLASSIC_OPTIONAL_BUNDLES["favorites-transfer"],
        modules.map((name) => "build/" + name + ".js")
    );
    assert.equal(CLASSIC_OPTIONAL_BUNDLES["favorites-transfer"].length, 30);
    assert(
        CLASSIC_MAIN_MODULES.includes(
            "build/commands/remote-favorites-transfer.js"
        )
    );
    for (const name of modules)
        assert(!CLASSIC_MAIN_MODULES.includes("build/" + name + ".js"));
    for (const name of [
        "build/storage/index.js",
        "build/storage/favorites-physical-storage.js",
        "build/utils/lzstring.js",
    ])
        assert(CLASSIC_MAIN_MODULES.includes(name));
});
test("optional favorites asset links without entry storage and loads without touching player state", () => {
    const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), "ott-favorites-bundle-")
    );
    try {
        for (const name of modules) {
            const file = path.join(temporary, "build", name + ".js");
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const source = fs.readFileSync(
                path.join(__dirname, "../src", name + ".ts"),
                "utf8"
            );
            fs.writeFileSync(
                file,
                ts.transpileModule(source, {
                    compilerOptions: {
                        module: ts.ModuleKind.ES2015,
                        removeComments: true,
                        target: ts.ScriptTarget.ES5,
                    },
                }).outputText
            );
        }
        const assembled = assembleClassic(
            temporary,
            CLASSIC_OPTIONAL_BUNDLES["favorites-transfer"]
        );
        require("acorn").parse(assembled, { ecmaVersion: 5 });
        const published = {};
        const player = new Proxy(published, {
            get(_target, key) {
                throw new Error("Asset load read player state: " + String(key));
            },
            set(target, key, value) {
                assert(
                    /^__ottFavorites/.test(String(key)) ||
                        key === "__ottGlobalFavoritesFactory",
                    "Unexpected global export " + String(key)
                );
                target[key] = value;
                return true;
            },
        });
        vm.runInNewContext(
            assembled,
            { Promise, Uint8Array, window: player },
            { timeout: 1000 }
        );
        assert.equal(
            typeof published.__ottFavoritesTransferRuntime.create,
            "function"
        );
        assert.equal(
            typeof published.__ottFavoritesCurrentPlexHost.create,
            "function"
        );
        assert.equal(
            typeof published.__ottGlobalFavoritesFactory.create,
            "function"
        );
        assert.equal(
            fs.existsSync(path.join(temporary, "build/storage/index.js")),
            false
        );
        assert.equal(
            fs.existsSync(path.join(temporary, "build/utils/lzstring.js")),
            false
        );
    } finally {
        fs.rmSync(temporary, { force: true, recursive: true });
    }
});

test("actual MAIN assembly rejects every optional UTF-8 edge without adding optional code to MAIN", () => {
    const temporary = fs.mkdtempSync(
        path.join(os.tmpdir(), "ott-favorites-main-")
    );
    const root = path.resolve(__dirname, "..");
    const emitted = new Set();
    function emit(relative, resolvedInput) {
        if (emitted.has(relative)) return;
        emitted.add(relative);
        const input =
            resolvedInput ||
            (relative.startsWith("build/")
                ? path.join(
                      root,
                      "src",
                      relative.slice(6).replace(/\.js$/, ".ts")
                  )
                : path.join(root, relative));
        const raw = fs.readFileSync(input, "utf8");
        const output = input.endsWith(".ts")
            ? ts.transpileModule(raw, {
                  compilerOptions: {
                      module: ts.ModuleKind.ES2015,
                      removeComments: true,
                      target: ts.ScriptTarget.ES5,
                  },
              }).outputText
            : raw;
        const file = path.join(temporary, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, output);
        const parsed = ts.createSourceFile(
            file,
            output,
            ts.ScriptTarget.Latest,
            true
        );
        for (const statement of parsed.statements) {
            const specifier = statement.moduleSpecifier;
            if (
                !specifier ||
                !ts.isStringLiteral(specifier) ||
                !specifier.text.startsWith(".")
            )
                continue;
            const resolved = ts.resolveModuleName(
                specifier.text,
                input,
                {
                    allowJs: true,
                    moduleResolution: ts.ModuleResolutionKind.Node10,
                },
                ts.sys
            ).resolvedModule;
            assert(
                resolved,
                "Unresolved actual runtime import: " +
                    input +
                    " -> " +
                    specifier.text
            );
            const resolvedSource = path.resolve(resolved.resolvedFileName);
            const nativeRelative = path.relative(root, resolvedSource);
            assert(
                !nativeRelative.startsWith("..") &&
                    !path.isAbsolute(nativeRelative),
                "Runtime dependency outside repository"
            );
            const sourceRelative = nativeRelative.split(path.sep).join("/");
            assert(
                !sourceRelative.endsWith(".d.ts"),
                "Runtime dependency resolved to declaration only"
            );
            const target = sourceRelative.startsWith("src/")
                ? "build/" + sourceRelative.slice(4).replace(/\.tsx?$/, ".js")
                : sourceRelative;
            emit(target, resolvedSource);
        }
    }
    try {
        // Materialize actual source modules, including resolution-only bridge targets.
        // Assembly membership remains the real production MAIN allowlist.
        for (const name of CLASSIC_MODULES) emit(name);
        const output = assembleClassic(temporary, CLASSIC_MAIN_MODULES);
        require("acorn").parse(output, { ecmaVersion: 5 });
        for (const wrapper of [
            "remote-favorites-global",
            "remote-favorites-global-items",
            "remote-favorites-global-recovery",
        ]) {
            const file = path.join(
                temporary,
                "build/commands",
                wrapper + ".js"
            );
            const original = fs.readFileSync(file, "utf8");
            try {
                fs.writeFileSync(
                    file,
                    'import { utf8Encode } from "./favorites-document-json";\n' +
                        original +
                        '\nutf8Encode("{}");\n'
                );
                assert.throws(
                    () => assembleClassic(temporary, CLASSIC_MAIN_MODULES),
                    /runtime import is not in CLASSIC_MODULES: \.\/favorites-document-json/
                );
            } finally {
                fs.writeFileSync(file, original);
            }
        }
    } finally {
        fs.rmSync(temporary, { force: true, recursive: true });
    }
});
