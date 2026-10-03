"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const {
    fixture,
    integrationFixture,
} = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
const root = path.resolve(__dirname, "..");
const plugin = ts.createSourceFile(
    "plex.ts",
    fs.readFileSync(path.join(root, "src/plugins/plex.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const normalize = plugin.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "normalizePlexConfig"
);
assert(normalize);
const config = {
    address: "https://plex.example:32400",
    playback: "auto",
    token: "private-server-token",
};
let count = 0;
function test(name, body) {
    body();
    count++;
    console.log("PASS " + name);
}
function create(initial = {}, integration = false) {
    const f = integration
        ? integrationFixture("plex", initial)
        : fixture(initial);
    f.host.URL = URL;
    runtime(f.host, "src/plugins/plex-auth.ts");
    runtime(f.host, "src/provider/source-identity.ts");
    vm.runInContext(
        ts.transpileModule(normalize.getText(plugin).replace(/^export /, ""), {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText + "\nwindow.__ottPlex={normalize:normalizePlexConfig};",
        f.host
    );
    const clients = [],
        signIns = [],
        probes = [],
        opened = [];
    let cancellations = 0;
    f.host.__ottPlex.create = (configuration, options) => {
        const client = {
            cancel() {},
            configuration,
            connect(done) {
                this.ready = done;
                return () => {};
            },
            dispose() {
                this.disposed++;
            },
            disposed: 0,
            load() {},
            options,
            ready: null,
            resolve() {},
            stableRequests: true,
        };
        clients.push(client);
        return client;
    };
    f.host.__ottPlexAuth = {
        cancel() {
            cancellations++;
        },
        connect(server, callbacks) {
            const probe = { callbacks, canceled: false, server };
            probes.push(probe);
            return () => {
                probe.canceled = true;
            };
        },
        routing: f.host.__ottPlexAuth.routing,
        start(callbacks, options) {
            signIns.push({ callbacks, options });
        },
    };
    f.host.open = (...args) => opened.push(args);
    runtime(f.host, "src/provider/plex-driver.ts");
    const driver = f.mount("plex");
    f.host.duneAddSettings(0);
    function enter(index) {
        f.host.selIndex = index;
        f.host.listKeyHandler(f.host.keys.ENTER);
    }
    return {
        ...f,
        get cancellations() {
            return cancellations;
        },
        clients,
        driver,
        enter,
        opened,
        probes,
        get reloads() {
            return f.reloads;
        },
        signIns,
    };
}

const remoteCode = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/commands/remote-requests.ts"), "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
function remote(f) {
    f.host.exports = {};
    f.host.require = (name) => {
        if (name === "../provider")
            return {
                checkProviderUrl: (url) => f.host.checkProviderUrl(url),
                isProviderAllowed: () => f.remoteAllowed !== false,
            };
        assert(
            [
                "../utils/caseless",
                "./index",
                "./remote-profiles",
                "./remote-restart",
                "./remote-archive",
            ].includes(name)
        );
        return {};
    };
    assert.equal(f.host.__ottActiveProviderDriver, f.driver);
    vm.runInContext(remoteCode, f.host);
    return (settings, extra = {}) => {
        let result;
        f.host.exports.executeRemoteRequest(
            {
                action: "provider_settings",
                params: { provider: "plex", settings, ...extra },
            },
            (value) => {
                result = JSON.parse(JSON.stringify(value));
            }
        );
        return result;
    };
}

test("Plex is a managed library provider and incomplete setup does not report empty TV success", () => {
    const f = create({ m3uArr: "untouched" });
    assert.equal(f.driver.capabilities.libraryOnly, true);
    assert.equal(f.driver.capabilities.media, true);
    assert.equal(f.driver.capabilities.guide, false);
    let completed = 0;
    f.host.getChannelsArray(() => completed++);
    assert.equal(completed, 0);
    assert.equal(f.clients.length, 0);
    assert.equal(f.driver.libraryReady(), false);
    assert.equal(f.host.listCaption.innerHTML, "Plex settings");
    assert.equal(f.saved.get("m3uArr"), "untouched");
});

test("Library readiness waits for authenticated connection and publishes the native catalogue client", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    let completed = 0;
    f.host.getChannelsArray(() => completed++);
    assert.equal(f.driver.libraryReady(), false);
    assert.equal(completed, 0);
    assert.equal(f.clients.length, 1);
    assert(!f.clients[0].options.sourceId.includes(config.token));
    assert(!f.clients[0].options.sourceId.includes(config.address));
    assert(f.clients[0].options.isCurrent());
    f.clients[0].ready();
    assert.equal(f.driver.libraryReady(), true);
    assert.equal(completed, 1);
    assert.equal(f.host.providerMediaClient, f.clients[0]);
    assert.equal(f.host.getMediaArray, f.clients[0].load);
    assert.equal(f.host.cList.length, 0);
});

test("Manual edits mask the token and save only the local Plex profile", () => {
    const untouched = {
        edmedFavorites: "existing-favorites",
        m3um3uArr: "existing-playlists",
        ottplayprov: "m3u",
    };
    const f = create({ ...untouched, plexcfg: JSON.stringify(config) });
    f.host.__ottEditProvider();
    assert(!f.host.listArray.join(" ").includes(config.token));
    assert(f.host.listArray[2].includes("********"));
    f.enter(2);
    assert.equal(f.edits.at(-1).password, true);
    f.host.editvar = " new-server-token ";
    f.host.setEdit();
    f.enter(1);
    f.host.editvar = " https://new.example:32400/ ";
    f.host.setEdit();
    f.enter(3);
    f.enter(5);
    assert.deepEqual(JSON.parse(f.saved.get("plexcfg")), {
        address: "https://new.example:32400",
        playback: "original",
        token: "new-server-token",
    });
    for (const [key, value] of Object.entries(untouched))
        assert.equal(f.saved.get(key), value);
    assert.equal(f.reloads, 1);
    assert(!f.host.popupArray.join(" ").includes("new-server-token"));
});

test("Invalid manual configuration cannot overwrite the saved profile", () => {
    const before = JSON.stringify(config);
    const f = create({ plexcfg: before });
    f.host.__ottEditProvider();
    f.enter(1);
    f.host.editvar = "https://user:secret@example.test/?token=private";
    f.host.setEdit();
    f.enter(5);
    assert.equal(f.saved.get("plexcfg"), before);
    assert.equal(f.reloads, 0);
    assert.equal(f.errors.length, 1);
    assert(!f.errors.join(" ").includes("secret"));
});

test("Connection failure keeps the library unready and displays a sanitized recoverable editor", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    let completed = 0;
    f.host.getChannelsArray(() => completed++);
    f.clients[0].ready("private upstream response " + config.token);
    assert.equal(completed, 0);
    assert.equal(f.driver.libraryReady(), false);
    assert.equal(f.clients[0].disposed, 1);
    assert.equal(f.host.listCaption.innerHTML, "Plex settings");
    assert(!f.errors.join(" ").includes(config.token));
});

test("Provider changes invalidate pending connection results and stale editor callbacks", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    let completed = 0;
    f.host.getChannelsArray(() => completed++);
    f.host.__ottEditProvider();
    f.enter(2);
    const staleEdit = f.host.setEdit;
    const previous = f.saved.get("plexcfg");
    f.mount("demo");
    f.host.editvar = "unwanted-token";
    staleEdit();
    f.clients[0].ready();
    assert.equal(completed, 0);
    assert.equal(f.clients[0].options.isCurrent(), false);
    assert.equal(f.clients[0].disposed, 1);
    assert.equal(f.saved.get("plexcfg"), previous);
    assert.equal(f.host.__ottActiveProviderDriver.id, "demo");
    assert.notEqual(f.host.providerMediaClient, f.clients[0]);
});

test("Reload retires the previous client and does not publish a replacement before connection succeeds", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    f.host.getChannelsArray(() => {});
    f.clients[0].ready();
    f.host.getChannelsArray(() => {});
    assert.equal(f.clients[0].disposed, 1);
    assert.equal(f.host.providerMediaClient, null);
    assert.equal(f.host.getMediaArray, null);
    assert.equal(f.driver.libraryReady(), false);
    f.clients[1].ready();
    assert.equal(f.host.providerMediaClient, f.clients[1]);
});

test("Plex account sign-in shows the short code, escapes server names and persists only the selected server credential", () => {
    const f = create({ m3ucfg: "untouched" });
    f.host.__ottEditProvider();
    f.enter(0);
    assert.equal(f.signIns[0].options.code, true);
    const callbacks = f.signIns[0].callbacks;
    callbacks.onPin({
        code: "ABCD",
        expiresAt: Date.now() + 60000,
        url: "https://plex.tv/link/?pin=ABCD",
    });
    assert.equal(f.opened[0][0], "https://plex.tv/link/?pin=ABCD");
    assert(f.host.listArray.join(" ").includes("ABCD"));
    const server = {
        connections: [{ url: config.address }],
        id: "server-one",
        name: "Home <script>",
        token: "selected-private-token",
    };
    callbacks.onServers([server]);
    assert(f.host.listArray[0].includes("&lt;script&gt;"));
    assert(!f.host.listArray.join(" ").includes(server.token));
    f.enter(0);
    assert.equal(f.probes.length, 1);
    assert.equal(f.probes[0].server, server);
    f.probes[0].callbacks.onConnected({
        token: server.token,
        url: config.address,
    });
    assert.deepEqual(JSON.parse(f.saved.get("plexcfg")), {
        ...config,
        account: {
            connections: [
                {
                    local: false,
                    relay: false,
                    secure: true,
                    url: config.address,
                },
            ],
            id: server.id,
        },
        token: server.token,
    });
    assert.equal(f.saved.get("m3ucfg"), "untouched");
    assert.equal(f.reloads, 1);
    assert.equal(f.cancellations, 1);
});

test("Back cancels sign-in and rejects delayed PIN, discovery and connection callbacks", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    f.host.__ottEditProvider();
    f.enter(0);
    const callbacks = f.signIns[0].callbacks;
    callbacks.onServers([{ name: "Home", token: "private" }]);
    f.enter(0);
    const connected = f.probes[0].callbacks;
    f.host.listKeyHandler(f.host.keys.RETURN);
    callbacks.onPin({ code: "LATE", url: "https://plex.tv/link/?pin=LATE" });
    callbacks.onServers([{ name: "Late server" }]);
    connected.onConnected({
        token: "late-token",
        url: "https://unwanted.example",
    });
    assert.equal(f.cancellations, 1);
    assert.equal(f.reloads, 0);
    assert.equal(f.opened.length, 0);
    assert.deepEqual(JSON.parse(f.saved.get("plexcfg")), config);
    assert.equal(f.host.listCaption.innerHTML, "Plex settings");
});

test("Native sign-in opens the allowlisted system-browser command and provider retirement cancels polling", () => {
    const f = create();
    const commands = [];
    f.host.__TAURI__ = {
        core: {
            invoke: (...args) => {
                commands.push(args);
                return Promise.resolve();
            },
        },
    };
    f.host.__ottEditProvider();
    f.enter(0);
    const callbacks = f.signIns[0].callbacks;
    callbacks.onPin({ code: "ABCD", url: "https://plex.tv/link/?pin=ABCD" });
    assert.deepEqual(JSON.parse(JSON.stringify(commands)), [
        ["open_plex_sign_in", { url: "https://plex.tv/link/?pin=ABCD" }],
    ]);
    assert.equal(f.opened.length, 0);
    f.mount("demo");
    callbacks.onServers([{ name: "Late server" }]);
    assert.equal(f.cancellations, 1);
    assert.equal(f.host.__ottActiveProviderDriver.id, "demo");
    assert.equal(f.probes.length, 0);
});

const accountConfig = {
    ...config,
    account: {
        connections: [
            { local: true, url: config.address },
            { local: false, url: "https://remote.plex.direct" },
        ],
        id: "server-one",
    },
};

test("Account startup resolves a reachable endpoint without changing server/account history identity", () => {
    const f = create({ plexcfg: JSON.stringify(accountConfig) });
    const identity = f.host.__ottSourceIdentity.media(f.host);
    f.host.getChannelsArray(() => {});
    assert.equal(f.clients.length, 0);
    assert.equal(f.probes[0].server.id, "server-one");
    assert.equal(f.probes[0].server.connections.length, 2);
    assert.equal(f.probes[0].server.token, config.token);
    f.probes[0].callbacks.onConnected({ url: "https://remote.plex.direct" });
    assert.equal(
        f.clients[0].configuration.address,
        "https://remote.plex.direct"
    );
    assert.equal(f.clients[0].options.sourceId, identity);
    f.clients[0].ready();
    assert.equal(f.host.__ottSourceIdentity.media(f.host), identity);
    assert.equal(JSON.parse(f.saved.get("plexcfg")).address, config.address);
    f.saved.set(
        "plexcfg",
        JSON.stringify({
            ...accountConfig,
            address: "https://another-endpoint.example",
        })
    );
    f.host.getChannelsArray(() => {});
    f.probes[1].callbacks.onConnected({ url: config.address });
    assert.equal(f.clients[1].options.sourceId, identity);
    f.saved.set(
        "plexcfg",
        JSON.stringify({ ...accountConfig, token: "another-resource-token" })
    );
    assert.notEqual(f.host.__ottSourceIdentity.media(f.host), identity);
});

test("Editing and provider retirement cancel endpoint discovery and reject late callbacks", () => {
    const f = create({ plexcfg: JSON.stringify(accountConfig) });
    f.host.getChannelsArray(() => {});
    f.host.__ottEditProvider();
    assert.equal(f.probes[0].canceled, true);
    f.host.getChannelsArray(() => {});
    f.probes[0].callbacks.onConnected({ url: config.address });
    assert.equal(f.clients.length, 0);
    f.mount("demo");
    assert.equal(
        f.probes[1].canceled,
        true,
        "stale callback cannot discard the new cancellation handle"
    );
    f.probes[1].callbacks.onConnected({ url: config.address });
    assert.equal(f.clients.length, 0);
});

test("Opening settings also retires a discovered endpoint whose catalogue connection is still pending", () => {
    const f = create({ plexcfg: JSON.stringify(accountConfig) });
    let completed = 0;
    f.host.getChannelsArray(() => completed++);
    f.probes[0].callbacks.onConnected({ url: "https://remote.plex.direct" });
    f.host.__ottEditProvider();
    assert.equal(f.clients[0].disposed, 1);
    f.clients[0].ready();
    assert.equal(completed, 0);
    assert.equal(f.driver.libraryReady(), false);
    assert.equal(f.host.providerMediaClient, null);
});

test("Playback-only edits preserve account routing; manual server/token edits remove it", () => {
    for (const field of ["server", "password"]) {
        const f = create({ plexcfg: JSON.stringify(accountConfig) });
        const draft = f.driver.credentials();
        draft.mode = 2;
        f.driver.saveCredentials(draft);
        assert.equal(
            JSON.parse(f.saved.get("plexcfg")).account.id,
            "server-one"
        );
        assert.equal(JSON.parse(f.saved.get("plexcfg")).playback, "compatible");
        draft[field] =
            field === "server" ? "https://manual.example" : "manual-token";
        f.driver.saveCredentials(draft);
        assert.equal(JSON.parse(f.saved.get("plexcfg")).account, undefined);
        f.host.getChannelsArray(() => {});
        assert.equal(f.probes.length, 0);
        assert.equal(f.clients.length, 1);
    }
});

test("Remote Plex first setup requires one atomic pair and returns only saved metadata", () => {
    const f = create({ m3um3uArr: "other-profile" });
    const call = remote(f);
    for (const settings of [
        { server: config.address },
        { token: config.token },
    ]) {
        assert.equal(call(settings).status, "rejected");
        assert.equal(f.saved.has("plexcfg"), false);
        assert.equal(f.reloads, 0);
    }
    const result = call({
        server: "https://[2001:db8::1]:32400/plex/",
        token: config.token,
    });
    assert.deepEqual(result, {
        data: { fields: ["server", "token"], provider: "plex", saved: true },
        status: "ok",
    });
    assert.deepEqual(JSON.parse(f.saved.get("plexcfg")), {
        address: "https://[2001:db8::1]:32400/plex",
        playback: "auto",
        token: config.token,
    });
    assert.equal(f.saved.get("m3um3uArr"), "other-profile");
    assert.equal(f.reloads, 1);
    assert.equal(
        f.driver.libraryReady(),
        false,
        "saving does not claim authenticated readiness"
    );
    assert.equal(f.clients.length, 0);
});
test("Remote partial Plex edits preserve mode and the other credential, clear routing and retire the library", () => {
    for (const field of ["server", "token"]) {
        const initial = { ...accountConfig, playback: "compatible" };
        const f = create({ plexcfg: JSON.stringify(initial) });
        const call = remote(f);
        f.host.getChannelsArray(() => {});
        f.probes[0].callbacks.onConnected({ url: config.address });
        const oldClient = f.clients[0];
        oldClient.ready();
        assert.equal(f.driver.libraryReady(), true);
        const value =
            field === "server"
                ? "https://manual.example:65535/base"
                : "replacement-token";
        const result = call({ [field]: value });
        // Only the fixed metadata projection may leave the player.
        assert.deepEqual(result, {
            data: { fields: [field], provider: "plex", saved: true },
            status: "ok",
        });
        const stored = JSON.parse(f.saved.get("plexcfg"));
        assert.deepEqual(stored, {
            address: field === "server" ? value : initial.address,
            playback: "compatible",
            token: field === "token" ? value : initial.token,
        });
        if (field === "server") {
            const endpoint = new URL(stored.address);
            assert.equal(endpoint.origin, "https://manual.example:65535");
            assert.equal(endpoint.pathname, "/base");
            assert.equal(endpoint.username, "");
            assert.equal(endpoint.password, "");
            assert.equal(endpoint.search, "");
            assert.equal(endpoint.hash, "");
        }
        assert.equal(oldClient.disposed, 1);
        assert.equal(f.driver.libraryReady(), false);
        assert.equal(f.host.providerMediaClient, null);
        oldClient.ready();
        assert.equal(
            f.driver.libraryReady(),
            false,
            "retired connection cannot restore the library"
        );
        assert.equal(f.reloads, 1);
    }
});
test("Remote Plex rejects malformed fields, unsafe URLs and raw token whitespace before save or reload", () => {
    const f = create({ plexcfg: JSON.stringify(accountConfig) });
    const call = remote(f);
    let saves = 0;
    const save = f.driver.saveCredentials;
    f.driver.saveCredentials = (value) => {
        saves++;
        return save(value);
    };
    const before = f.saved.get("plexcfg");
    const invalid = [
        null,
        [],
        {},
        false,
        "server",
        { server: 1 },
        { token: 1 },
        { password: "alias" },
        { address: config.address },
        { mode: "original" },
        { server: "x".repeat(8193) },
        { token: "x".repeat(1025) },
        { token: "" },
        ...[
            " token",
            "token ",
            "a b",
            "a\tb",
            "a\nb",
            "a\u0000b",
            "a\u007fb",
            "a\u00a0b",
        ].map((token) => ({ token })),
        ...[
            "",
            "ftp://plex.test",
            "https://user:pass@plex.test",
            "https://plex.test?token=secret",
            "https://plex.test/#secret",
            "https://plex.test/base/../path",
            "https://plex.test/%2e%2e/path",
            "https://plex.test:0",
            "https://plex.test:65536",
            "https://plex.test:999999",
            "https://[::::]:32400",
            "https://plex.test/a b",
            "https://plex.test/a\\b",
        ].map((server) => ({ server })),
    ];
    for (const settings of invalid) {
        const result = call(settings);
        assert.equal(result.status, "rejected", JSON.stringify(settings));
        assert.equal(
            saves,
            0,
            "invalid settings must not reach the driver save operation"
        );
        assert.equal(f.saved.get("plexcfg"), before);
        assert.equal(f.reloads, 0);
        assert.equal(JSON.stringify(result).includes(config.token), false);
    }
    assert.equal(
        call({ token: config.token }, { extra: "unsupported" }).status,
        "rejected"
    );
    assert.equal(saves, 0);
});
test("Remote Plex retains provider, URL policy and parental guards and does not reload a failed save", () => {
    const f = create({ plexcfg: JSON.stringify(accountConfig) });
    const call = remote(f);
    let saves = 0;
    const save = f.driver.saveCredentials;
    f.driver.saveCredentials = (value) => {
        saves++;
        return save(value);
    };
    assert.equal(
        call({ token: "replacement" }, { provider: "xtream" }).status,
        "rejected"
    );
    f.remoteAllowed = false;
    assert.equal(call({ token: "replacement" }).status, "rejected");
    f.remoteAllowed = true;
    f.host.__ottParental = { needs: (scope) => scope === "settings" };
    assert.equal(call({ token: "replacement" }).status, "rejected");
    f.host.__ottParental = { needs: () => false };
    f.host.checkProviderUrl = () => false;
    assert.equal(call({ token: "replacement" }).status, "rejected");
    f.host.checkProviderUrl = () => true;
    assert.equal(saves, 0);
    f.driver.saveCredentials = () => false;
    assert.equal(call({ token: "replacement" }).status, "rejected");
    assert.equal(f.reloads, 0);
    f.driver.saveCredentials = save;
    assert.equal(call({ token: accountConfig.token }).status, "ok");
    assert.equal(
        JSON.parse(f.saved.get("plexcfg")).account.id,
        "server-one",
        "same credential preserves account routing"
    );
});

test("Remote Plex uses real loadChannels for initial setup and partial edits without calling stale playlist loaders", () => {
    for (const stalePlaylist of [false, true]) {
        const f = create({}, true);
        const call = remote(f);
        let unrelatedReloads = 0;
        assert.equal(typeof f.host.loadPlaylist, "undefined");
        if (stalePlaylist) f.host.loadPlaylist = () => unrelatedReloads++;
        assert.equal(
            call({ server: config.address, token: config.token }).status,
            "ok"
        );
        assert.equal(
            f.clients.length,
            1,
            "real loadChannels starts authenticated Plex connection"
        );
        assert.equal(f.driver.libraryReady(), false);
        f.clients[0].ready();
        assert.equal(f.driver.libraryReady(), true);
        assert.equal(f.host.providerMediaClient, f.clients[0]);
        for (const settings of [
            { token: "new-token" },
            { server: "https://new.example" },
        ]) {
            const old = f.clients.at(-1);
            const previousCount = f.clients.length;
            assert.equal(call(settings).status, "ok");
            assert.equal(old.disposed, 1);
            assert.equal(f.clients.length, previousCount + 1);
            assert.equal(f.driver.libraryReady(), false);
            old.ready();
            assert.equal(f.driver.libraryReady(), false);
            const next = f.clients.at(-1);
            assert.equal(next.configuration.token, "new-token");
            next.ready();
            assert.equal(f.driver.libraryReady(), true);
            assert.equal(f.host.providerMediaClient, next);
        }
        assert.equal(
            f.clients.at(-1).configuration.address,
            "https://new.example"
        );
        assert.equal(unrelatedReloads, 0);
    }
});
test("Remote Plex refuses to retire a library when its owned settings, normalization or reload entry point is unavailable", () => {
    for (const missing of ["saveRemoteSettings", "normalize", "loadChannels"]) {
        const f = create({ plexcfg: JSON.stringify(config) });
        const call = remote(f);
        f.host.getChannelsArray(() => {});
        f.clients[0].ready();
        const before = f.saved.get("plexcfg");
        if (missing === "saveRemoteSettings")
            delete f.driver.saveRemoteSettings;
        if (missing === "normalize") delete f.host.__ottPlex.normalize;
        if (missing === "loadChannels") delete f.host.loadChannels;
        let unrelatedReloads = 0;
        f.host.loadPlaylist = () => unrelatedReloads++;
        assert.equal(call({ token: "new-token" }).status, "rejected");
        assert.equal(f.saved.get("plexcfg"), before);
        assert.equal(f.clients[0].disposed, 0);
        assert.equal(f.driver.libraryReady(), true);
        assert.equal(unrelatedReloads, 0);
    }
});
test("An old Plex owner's external settings method cannot save or reload after provider replacement", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    const saveRemoteSettings = f.driver.saveRemoteSettings;
    f.mount("m3u");
    const before = f.saved.get("plexcfg");
    assert.equal(
        typeof saveRemoteSettings({
            provider: "plex",
            settings: { token: "new-token" },
        }),
        "string"
    );
    assert.equal(f.saved.get("plexcfg"), before);
    assert.equal(f.reloads, 0);
});

function pendingAccountSignIn(f) {
    f.host.__ottEditProvider();
    f.enter(0);
    const server = {
        connections: [{ url: config.address }],
        id: "old-account",
        name: "Old account",
        token: "old-account-token",
    };
    const signIn = f.signIns.at(-1);
    signIn.callbacks.onServers([server]);
    f.enter(0);
    return { probe: f.probes.at(-1), server, signIn };
}
test("Successful remote Plex save cancels pending sign-in and rejects late account callbacks", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    const call = remote(f);
    const pending = pendingAccountSignIn(f);
    const cancels = f.cancellations;
    assert.equal(
        call({ server: "https://new.example", token: "remote-token" }).status,
        "ok"
    );
    assert.equal(f.cancellations, cancels + 1);
    const saved = f.saved.get("plexcfg");
    const screen = f.host.listArray.slice();
    pending.probe.callbacks.onConnected({
        token: pending.server.token,
        url: config.address,
    });
    pending.signIn.callbacks.onServers([pending.server]);
    pending.signIn.callbacks.onPin({
        code: "STALE",
        url: "https://app.plex.tv/auth#stale",
    });
    pending.probe.callbacks.onError();
    assert.equal(f.saved.get("plexcfg"), saved);
    assert.equal(JSON.parse(saved).token, "remote-token");
    assert.equal(f.reloads, 1);
    assert.deepEqual(f.host.listArray, screen);
});
test("Successful remote Plex save invalidates an old manual draft while a new UI editor still saves normally", () => {
    const f = create({ plexcfg: JSON.stringify(config) });
    const call = remote(f);
    f.host.__ottEditProvider();
    f.enter(2);
    const oldSetter = f.host.setEdit;
    const oldHandler = f.host.listKeyHandler;
    assert.equal(call({ token: "remote-token" }).status, "ok");
    f.host.editvar = "stale-draft-token";
    oldSetter();
    f.host.selIndex = 5;
    assert.equal(oldHandler(f.host.keys.ENTER), false);
    assert.equal(JSON.parse(f.saved.get("plexcfg")).token, "remote-token");
    assert.equal(f.reloads, 1);
    f.host.__ottEditProvider();
    f.enter(2);
    f.host.editvar = "fresh-ui-token";
    f.host.setEdit();
    f.enter(5);
    assert.equal(JSON.parse(f.saved.get("plexcfg")).token, "fresh-ui-token");
    assert.equal(f.reloads, 2);
});
test("Rejected remote Plex saves preserve pending account sign-in and stored credentials", () => {
    for (const failure of ["invalid", "save", "reload"]) {
        const f = create({ plexcfg: JSON.stringify(config) });
        const call = remote(f);
        const pending = pendingAccountSignIn(f);
        const save = f.driver.saveCredentials;
        const load = f.host.loadChannels;
        const before = f.saved.get("plexcfg");
        const cancels = f.cancellations;
        if (failure === "save") f.driver.saveCredentials = () => false;
        if (failure === "reload") delete f.host.loadChannels;
        assert.equal(
            call({
                token: failure === "invalid" ? "bad token" : "remote-token",
            }).status,
            "rejected"
        );
        assert.equal(f.saved.get("plexcfg"), before);
        assert.equal(f.cancellations, cancels);
        assert.equal(f.reloads, 0);
        f.driver.saveCredentials = save;
        f.host.loadChannels = load;
        pending.probe.callbacks.onConnected({
            token: pending.server.token,
            url: config.address,
        });
        assert.equal(
            JSON.parse(f.saved.get("plexcfg")).token,
            pending.server.token
        );
        assert.equal(
            f.reloads,
            1,
            "the original UI flow remains valid after rejection"
        );
    }
});

console.log("Plex provider: " + count + " scenarios passed");
