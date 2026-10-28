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
    "settings/favorites-current-plex-host",
    "plugins/favorites-transfer-runtime",
];
test("production registration keeps exact optional graph and main-owned dispatcher/storage", () => {
    assert.deepEqual(
        CLASSIC_OPTIONAL_BUNDLES["favorites-transfer"],
        modules.map((name) => "build/" + name + ".js")
    );
    assert.equal(CLASSIC_OPTIONAL_BUNDLES["favorites-transfer"].length, 12);
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
                assert.match(String(key), /^__ottFavorites/);
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
