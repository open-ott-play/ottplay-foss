"use strict";
const {
    createMainPorts,
} = require("./helpers/global-favorites-main-ports.cjs");
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript");
const { createHash } = require("node:crypto"),
    { fixture } = require("./helpers/provider-driver-fixture.cjs");
function moduleAt(file, deps = {}, window = {}) {
    const exports = {};
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        {
            exports,
            require: (name) => {
                if (!(name in deps)) throw Error(name);
                return deps[name];
            },
            window,
            URL,
            Promise,
            Object,
            Array,
            JSON,
            Math,
            Number,
            String,
            Error,
            isFinite,
        }
    );
    return exports;
}
const identities = moduleAt("src/media/global-favorites-identities.ts"),
    selectors = moduleAt("src/settings/global-favorites-bindings.ts"),
    builtins = moduleAt("src/media/global-favorites-providers.ts");
function actualPortal(w) {
    const ast = ts.createSourceFile(
            "helpers.ts",
            fs.readFileSync("src/utils/helpers.ts", "utf8"),
            ts.ScriptTarget.Latest,
            true
        ),
        helpers = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(
            ast.statements
                .filter(
                    (n) =>
                        ts.isFunctionDeclaration(n) &&
                        ["metadataText", "metadataImageUrl"].includes(
                            n.name?.text
                        )
                )
                .map((n) => n.getText(ast))
                .join("\n"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText,
        helpers
    );
    const caseless = { exports: {} };
    vm.runInNewContext(
        require("./helpers/localization-runtime.cjs").localizationRuntime(),
        caseless
    );
    caseless.require = () => caseless;
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/utils/caseless.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        caseless
    );
    return moduleAt(
        "src/plugins/vportal.ts",
        {
            "../utils/caseless": caseless.exports,
            "../utils/helpers": helpers.exports,
        },
        w
    );
}
async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}
async function main() {
    const registryHost = fixture().host;
    const supported = new Set([
        "demo",
        "m3u",
        "vportal",
        "plex",
        "offline",
        "stalker",
        "xtream",
        "operator",
        "xtream-fallback",
        "named-playlist",
        "playlist",
        "catalog",
        "edem",
    ]);
    for (const row of registryHost.__ottProviderDriverProfiles) {
        assert(
            supported.has(row.kind),
            "new built-in kind needs an explicit Favorites adapter"
        );
        assert.equal(
            builtins.globalFavoriteBuiltin(
                registryHost,
                builtins.globalFavoriteProviderName(row.id)
            ).id,
            row.id
        );
    }
    const collision = {
        __ottProviderDriverProfiles: [{ id: "a.b" }, { id: "a/b" }],
    };
    assert.equal(
        builtins.globalFavoriteBuiltin(collision, "a-b"),
        null,
        "unknown hyphen lookalike remains unresolved"
    );
    assert.equal(builtins.globalFavoriteBuiltin(collision, "a.b").id, "a.b");
    assert.equal(builtins.globalFavoriteBuiltin(collision, "a/b").id, "a/b");
    const values = new Map([
        [
            "xtreamxtream_data",
            JSON.stringify({
                server: "https://fixture.test",
                username: "user",
                password: "secret",
            }),
        ],
    ]);
    const context = {
        ...registryHost,
        stbGetItem: (key) => values.get(key) || null,
    };
    const xtream = builtins.globalFavoriteBuiltin(context, "xtream");
    assert.equal(
        builtins.globalFavoriteBuiltinChoices(context, xtream).length,
        1
    );
    assert.equal(
        builtins.globalFavoriteBuiltinChoices(context, xtream)[0].profile,
        "Xtream Codes"
    );
    assert(
        !JSON.stringify(
            builtins.globalFavoriteBuiltinChoices(context, xtream)
        ).includes("secret"),
        "public choices never expose credentials"
    );
    for (const withLive of [true, false]) {
        const f = fixture({
            m3um3uArr: JSON.stringify({
                active: 0,
                M3Us: [
                    { name: "One", www: "https://one.test/list", rechours: 0 },
                    {
                        name: "Two",
                        www: withLive ? "https://two.test/list" : "",
                        rechours: 0,
                        medUrl: "portal::[key:fixture]https://portal.test/api/",
                        medSourceId: "embedded",
                    },
                ],
            }),
        });
        const w = f.host,
            timers = new Map(),
            requests = [];
        let tid = 0,
            plays = 0;
        w.URL = URL;
        w.setTimeout = (fn) => {
            timers.set(++tid, fn);
            return tid;
        };
        w.clearTimeout = (id) => timers.delete(id);
        w.__ottSourceIdentity = {
            current: () => "m3u:" + (w.m3uArr?.active || 0),
            media: () => "media:" + (w.m3uArr?.active || 0),
        };
        const ajax = w.$.ajax;
        w.$.ajax = (options) => {
            if (!options.success) return ajax(options);
            const row = {
                options,
                abort() {
                    options.error?.({}, "abort");
                    options.complete?.();
                },
                receive(value) {
                    options.success(value);
                    options.complete?.();
                },
            };
            requests.push(row);
            return row;
        };
        actualPortal(w);
        const driver = f.mount("m3u");
        w.commandChannelsReady = false;
        w.__ottCommandChannelLoad = {};
        w.__ottStandby = { blocked: () => false };
        w.__ottKiosk = { enabled: () => false };
        w.__ottParental = { needs: () => false };
        w.loadPlaylist = () => {
            w.commandChannelsReady = false;
            w.__ottCommandChannelLoad = {};
            w.getChannelsArray(() => {
                w.commandChannelsReady = true;
            });
        };
        const player = moduleAt(
            "src/media/global-favorites-player.ts",
            {
                "../settings/global-favorites-bindings": selectors,
                "./global-favorites-identities": identities,
                "./global-favorites-providers": builtins,
            },
            w
        ).createGlobalFavoritesPlayer(w, {
            ...createMainPorts(w),
            current: () => true,
            sha256: async (text) =>
                createHash("sha256").update(text).digest("hex"),
            bindings: { list: () => ({ entries: [] }) },
        });
        const origin = {
                provider: "m3u",
                profile: "Two",
                subprofile: null,
                sourceAlias: "Two",
            },
            locator = { kind: "vportal-media", idField: "id", id: "42" };
        const target = await player.choiceTarget(
            origin,
            {
                label: "Two",
                profile: "Two",
                alias: "Two",
                provider: "m3u",
                slot: 1,
            },
            locator
        );
        assert(target);
        const pending = player.activate(target, () => true);
        await flush();
        assert.equal(driver.configuration().active, 1);
        assert(w.__ottEmbeddedVPortal?.current());
        if (withLive)
            f.requests[0].resolve(
                '#EXTM3U\n#EXTINF:-1 tvg-id="tv",TV\nhttps://stream.test/tv\n'
            );
        else {
            assert.equal(f.requests.length, 0);
            assert.equal(driver.capabilities.libraryOnly, true);
            assert(driver.libraryReady());
        }
        for (const [id, fn] of [...timers]) {
            timers.delete(id);
            fn();
        }
        await flush();
        const session = await pending;
        const selected = session.resolve(locator, () => true);
        assert.equal(requests.length, 1);
        requests[0].receive({
            type: "category",
            items: [
                {
                    title: "Folder",
                    type: "category",
                    request: { cmd: "folder" },
                },
            ],
        });
        assert.equal(requests.length, 2);
        requests[1].receive({
            type: "category",
            items: [
                {
                    id: 42,
                    title: "Film",
                    type: "stream",
                    request: { cmd: "play", id: 42 },
                },
            ],
        });
        const resolved = await selected;
        assert(resolved && resolved.available);
        assert.equal(resolved.items[0].title, "Film");
        assert.equal(resolved.items[0].vportalSource, "media:1");
        w.__ottMedia = {
            playOrderedQueue(items, index, label, a, current, done) {
                assert(current());
                assert.equal(items[0].title, "Film");
                plays++;
                done();
            },
        };
        assert.equal(await session.play(resolved, () => true), true);
        assert.equal(plays, 1);
        session.complete();
    }
    for (const mode of [
        "public",
        "invalid",
        "platform",
        "cancel",
        "stale",
        "scope",
    ]) {
        const f = fixture({
            m3um3uArr: JSON.stringify({
                active: 0,
                M3Us: [
                    { name: "One", www: "https://one.test/list", rechours: 0 },
                    {
                        name: "Two",
                        www: "",
                        rechours: 0,
                        medUrl:
                            mode === "invalid"
                                ? "portal::bad"
                                : "portal::[key:fixture]https://portal.test/api/",
                    },
                ],
            }),
        });
        const w = f.host;
        actualPortal(w);
        const driver = f.mount("m3u");
        let loads = 0;
        w.loadPlaylist = () => loads++;
        const provider = {
            isProviderAllowed: () => true,
            checkProviderUrl: () => mode !== "platform",
        };
        const profiles = moduleAt(
            "src/commands/remote-profiles.ts",
            { "../provider": provider },
            w
        );
        const raw = w.stbGetItem("m3um3uArr"),
            expected = JSON.stringify(driver.configuration());
        let result;
        if (mode === "scope")
            w.__ottActiveProviderDriver = {
                id: "offline",
                request() {
                    throw Error("must not dispatch offline");
                },
            };
        if (mode === "public")
            profiles.handleRemoteProfiles(
                { action: "profile", params: { number: 2 } },
                (value) => {
                    result = value;
                },
                () => true
            );
        else
            profiles.selectGlobalMediaProfile(
                driver,
                mode === "stale" ? expected + " " : expected,
                1,
                (value) => {
                    result = value;
                },
                () => mode !== "cancel"
            );
        assert.equal(result.status, "rejected", mode);
        assert.equal(driver.configuration().active, 0, mode);
        assert.equal(
            w.stbGetItem("m3um3uArr"),
            raw,
            mode + " writes no configuration"
        );
        assert.equal(loads, 0, mode + " starts no load/play");
        if (mode === "public")
            assert.equal(
                result.data.error,
                "Configure this profile's playlist before selecting it."
            );
    }
    console.log(
        "PASS unchanged public empty-playlist rejection and internal invalid/platform/cancel/stale guards without writes or loads"
    );
    console.log(
        "PASS actual M3U profile handoff + actual embedded VPortal recursive client + exact film dispatch (TV and media-only profiles)"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
