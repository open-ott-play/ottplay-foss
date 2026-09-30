"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
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
function create(initial = {}) {
    const f = fixture(initial);
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

console.log("Plex provider: " + count + " scenarios passed");
