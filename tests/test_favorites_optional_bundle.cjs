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
function assertUniqueBindings(source, selected) {
    const tree = require("acorn").parse(source, { ecmaVersion: 5 });
    const counts = new Map();
    function record(name) {
        if (
            name === "__awaiter" ||
            name === "__generator" ||
            name === "__spreadArray"
        )
            return;
        if (!selected || selected.includes(name))
            counts.set(name, (counts.get(name) || 0) + 1);
    }
    function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "FunctionDeclaration") {
            record(node.id.name);
            return;
        }
        if (node.type === "FunctionExpression") return;
        if (node.type === "VariableDeclaration")
            for (const declaration of node.declarations)
                record(declaration.id.name);
        for (const key of Object.keys(node)) {
            const child = node[key];
            if (Array.isArray(child)) child.forEach(visit);
            else if (child && typeof child === "object") visit(child);
        }
    }
    visit(tree);
    for (const [name, count] of counts)
        assert.equal(count, 1, "Shared classic binding: " + name);
    if (selected)
        for (const name of selected)
            assert.equal(
                counts.get(name),
                1,
                "Missing classic binding: " + name
            );
}
test("shared-scope guard rejects function and storage-key collisions", () => {
    assert.throws(
        () =>
            assertUniqueBindings(
                "function canonical() {} function canonical() {}"
            ),
        /Shared classic binding: canonical/
    );
    assert.throws(
        () => assertUniqueBindings('var KEY = "first"; var KEY = "second";'),
        /Shared classic binding: KEY/
    );
    assertUniqueBindings(
        "function first() { var local; } function second() { var local; }"
    );
});
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
test("optional favorites asset links without entry storage and loads without touching player state", async () => {
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
        assertUniqueBindings(assembled);
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
        const realm = { Promise, Uint8Array, window: player };
        vm.runInNewContext(assembled, realm, { timeout: 1000 });
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
        // Exercise the actual flattened factories after every module initialized.
        // These keys and validators used to be overwritten by unrelated modules.
        const raw = new Map([
            ["favorites-receipts.v1", "scoped-receipt-sentinel"],
            ["favorites-global-receipts.v1", "global-receipt-sentinel"],
        ]);
        const writes = [];
        const grant = {
            current: () => true,
            read: (key) => raw.get(key) ?? null,
            exclusive: async (work) => work(grant),
            compareAndSwap(key, before, after, current) {
                if (!current() || (raw.get(key) ?? null) !== before)
                    return "conflict";
                writes.push(key);
                raw.set(key, after);
                return "confirmed";
            },
        };
        const sha256 = async (value) =>
            require("node:crypto")
                .createHash("sha256")
                .update(value)
                .digest("hex");
        const codec = realm.createGlobalFavoritesPortableCodec();
        const store = realm.createGlobalFavoritesStore({
            capture: () => grant,
            current: () => true,
            canWrite: () => true,
            sha256,
            uuid: () => "11111111-1111-4111-8111-111111111111",
            codec,
        });
        const before = await store.snapshot();
        const entry = {
            title: "Shared scope",
            origin: {
                provider: "m3u",
                profile: "Profile",
                subprofile: null,
                sourceAlias: "Source",
            },
            locator: { kind: "channel", channelId: "channel-1" },
        };
        assert.equal(
            (
                await store.mutate(before.revision, {
                    op: "put",
                    entries: [entry],
                })
            ).outcome,
            "verified"
        );
        assert.deepEqual(writes, ["remoteFavorites.v1"]);
        assert.equal(
            raw.get("favorites-receipts.v1"),
            "scoped-receipt-sentinel"
        );
        assert.equal(
            raw.get("favorites-global-receipts.v1"),
            "global-receipt-sentinel"
        );
        const protocol = realm.createGlobalFavoritesProtocol({
            runtime: () => "runtime-1",
            current: () => true,
            now: () => 1000,
            authorized: () => true,
            codec,
            store,
            sha256,
            uuid: () => "22222222-2222-4222-8222-222222222222",
            locatorKinds: ["channel"],
            captureContext: async () => ({
                revision: await sha256("context"),
                current: () => true,
            }),
            committer: {
                qualify: async () => {},
                canWrite: () => false,
                blocker: () => "policy_denied",
            },
            facade: {
                exportSnapshot: async () => ({
                    document: await store.portableSnapshot(),
                    current: () => true,
                }),
            },
            base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
        });
        const described = await protocol.execute(
            { op: "describe", runtime: "runtime-1" },
            100,
            60
        );
        assert.equal(described.export.entries, 1);
        assert.equal(described.write_ready, false);
        const exported = await protocol.execute(
            {
                op: "export",
                runtime: "runtime-1",
                snapshot_id: described.export.snapshot_id,
                offset: 0,
                max_bytes: 65536,
            },
            200,
            60
        );
        assert.deepEqual(
            JSON.parse(
                Buffer.from(exported.data_base64, "base64").toString("utf8")
            ),
            { version: 1, entries: [entry] }
        );
        const invalid = await protocol.execute(
            { op: "describe", runtime: "runtime-1" },
            0,
            60
        );
        assert.equal(invalid.error, "envelope_too_large");
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
        const optional = assembleClassic(
            temporary,
            CLASSIC_OPTIONAL_BUNDLES["favorites-transfer"]
        );
        const optionalTree = require("acorn").parse(optional, {
            ecmaVersion: 5,
        });
        const optionalNames = optionalTree.body
            .flatMap((node) =>
                node.type === "FunctionDeclaration"
                    ? [node.id.name]
                    : node.type === "VariableDeclaration"
                      ? node.declarations.map((entry) => entry.id.name)
                      : []
            )
            .filter(
                (name) =>
                    name !== "__awaiter" &&
                    name !== "__generator" &&
                    name !== "__spreadArray"
            );
        assertUniqueBindings(output + "\n" + optional, [
            ...new Set([
                "ensureGlobalFavorites",
                "ensureRemoteGlobalFavorites",
                ...optionalNames,
            ]),
        ]);
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
