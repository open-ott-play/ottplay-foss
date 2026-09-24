"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const privateRuntime = require("./helpers/private-runtime.cjs");
const captured = require("./fixtures/xtream/legacy.json");
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture(initial = {}) {
    const saved = new Map(Object.entries(initial));
    const calls = [],
        requests = [],
        errors = [],
        edits = [];
    let reloads = 0;
    const host = {
        _: (value) => value,
        alert: (message) => errors.push(message),
        browserName: () => "browser",
        btnDiv: () => "",
        cats: {},
        catsArray: [],
        chanels: {},
        checkProviderUrl: () => true,
        cList: [],
        host: "https://relay.test",
        keys: { ENTER: 13, RETURN: 27 },
        launch_id: "#launch",
        listCaption: {},
        listDetail: {},
        listPodval: {},
        loadChannels: () => reloads++,
        noProvParam() {},
        popupActions: [],
        popupArray: [],
        popupDetail: [],
        popupList: (index) => calls.push(["popup", index]),
        showEditKey: (key, password) => edits.push({ key, password }),
        showPage() {},
        stbDelItem: (key) => saved.delete(key),
        stbGetItem: (key) => (saved.has(key) ? saved.get(key) : null),
        stbSetItem: (key, value) => saved.set(key, String(value)),
        strRETURN: "Return",
    };
    const jquery = () => ({ append() {}, hide() {} });
    const ajax = (settings) => {
        let done, fail;
        const request = {
            abort() {
                this.aborts++;
                if (fail) fail();
            },
            aborts: 0,
            done(callback) {
                done = callback;
                return this;
            },
            fail(callback) {
                fail = callback;
                return this;
            },
            reject() {
                fail();
            },
            // Intentionally uncooperative: callbacks can still arrive after abort.
            resolve(value) {
                done(value);
            },
            settings,
        };
        requests.push(request);
        calls.push(settings.url);
        return request;
    };
    jquery.ajax = ajax;
    host.$ = jquery;
    host.window = host;
    vm.createContext(host);
    require("./helpers/shared-core-runtime.cjs")(host, { vendorOnly: true });
    privateRuntime(host, "src/provider/runtime.ts");
    privateRuntime(host, "src/provider/driver-profiles.ts");
    privateRuntime(host, "src/provider/drivers.ts");
    // The checked-in identity codec is shared with existing channel bookmarks.
    const encoding = fs.readFileSync(
        path.join(__dirname, "../src/utils/encoding.ts"),
        "utf8"
    );
    vm.runInContext(
        ts
            .transpileModule(encoding, {
                compilerOptions: {
                    module: ts.ModuleKind.ES2015,
                    target: ts.ScriptTarget.ES5,
                },
            })
            .outputText.replace(/^export /gm, ""),
        host
    );
    require("./helpers/english-source-fixture.cjs").attachSourceAliases(host);
    const lifetime = host.__ottProviderRuntime.createRegistry();
    function mount(id) {
        return host.__ottProviderDrivers.mount(host, id, lifetime.activate(id));
    }
    return {
        ajax,
        calls,
        edits,
        errors,
        host,
        lifetime,
        mount,
        get reloads() {
            return reloads;
        },
        requests,
        saved,
    };
}
const config = {
    password: "x?&",
    server: "https://xc.test/folder",
    username: "a/b",
};
const stored = (value = config) => ({
    xtreamxtream_data: JSON.stringify(value),
});
let assertions = 0;
function test(name, run) {
    run();
    assertions++;
    console.log("PASS provider drivers: " + name);
}

test("registry only resolves explicit drivers and does not accept prototype names", () => {
    const f = fixture();
    const registry = f.host.__ottProviderDrivers.registry;
    assert.deepEqual(
        Array.from(registry.ids()),
        Array.from(f.host.__ottProviderDriverProfiles, (profile) => profile.id)
    );
    assert.equal(registry.ids().length, 35);
    assert.equal(registry.has("constructor"), false);
    assert.equal(registry.has("m3u"), false);
    assert.throws(() => registry.register("demo", () => {}), /Duplicate/);
    assert.throws(() => registry.create("m3u", {}, {}), /Unsupported/);
});

for (const [index, row] of captured.cases.entries())
    test("Xtream captured catalog " + index, () => {
        const f = fixture(stored(row.input.config || config));
        f.mount("xtream");
        let callbacks = 0;
        f.host.getChanelsArray(() => callbacks++);
        assert.equal(f.host.$.ajax, f.ajax);
        f.requests[0].resolve(row.input.account);
        assert.deepEqual(
            clone({
                callbacks,
                calls: f.calls,
                channels: f.host.chanels,
                errors: f.errors,
                groupOrder: f.host.catsArray,
                groups: f.host.cats,
                ids: f.host.cList,
            }),
            row.expected
        );
        assert.equal(
            f.host.getMediaArray,
            null,
            "standalone Xtream retains its existing live-only media capability"
        );
    });

for (const [index, row] of captured.guide.entries())
    test("Xtream captured short guide " + index, () => {
        const f = fixture(stored({ ...config, server: "https://xc.test" }));
        f.mount("xtream");
        f.host.getChanelsArray(() => {});
        f.requests[0].resolve({
            live_streams: [{ name: "Guide channel", stream_id: "42" }],
        });
        const id = f.host.cList[0];
        let result;
        f.host.getEPGchanel(id, (_id, data) => {
            result = { data, id: "channel" };
        });
        f.requests[1].resolve(row.input);
        assert.deepEqual(
            clone({ calls: f.calls.slice(1), output: result }),
            row.expected
        );
    });

test("instance replacement aborts old catalog/guide and delayed responses cannot revive them", () => {
    const f = fixture(stored());
    const old = f.mount("xtream");
    let completions = 0;
    old.load(() => completions++);
    f.mount("demo");
    assert.equal(f.requests[0].aborts, 1);
    f.host.getChanelsArray(() => completions++);
    f.requests[0].resolve({
        live_streams: [{ name: "Obsolete", stream_id: 1 }],
    });
    assert.equal(completions, 1);
    assert.deepEqual(Array.from(f.host.cList), [900000001, 900000002]);
    assert.equal(old.stream(1), "");
    const current = f.mount("xtream");
    current.load(() => completions++);
    f.requests[1].resolve({
        live_streams: [{ name: "Current", stream_id: 42 }],
    });
    const channel = f.host.xxHash32S("Current", true);
    current.guide(channel, () => completions++);
    f.mount("demo");
    assert.equal(f.requests[2].aborts, 1);
    f.requests[2].resolve({ epg_listings: [] });
    assert.equal(completions, 2);
});

test("catalog reload, credential save and dispose retire pending requests", () => {
    const f = fixture(stored());
    const driver = f.mount("xtream");
    let count = 0;
    driver.load(() => count++);
    driver.load(() => count++);
    assert.equal(f.requests[0].aborts, 1);
    f.requests[0].resolve({ live_streams: [] });
    assert.equal(count, 0);
    driver.saveCredentials({ ...config, username: "new" });
    assert.equal(f.requests[1].aborts, 1);
    f.requests[1].resolve({ live_streams: [] });
    driver.load(() => count++);
    assert(f.requests[2].settings.url.includes("username=new"));
    driver.dispose();
    f.requests[2].resolve({ live_streams: [] });
    assert.equal(count, 0);
});

test("demo scopes storage and exposes identical playable catalog without transport", () => {
    const f = fixture({ m3um3uArr: "private playlist" });
    const driver = f.mount("demo");
    f.host.providerSetItem("primaryIndex", "1");
    assert.equal(f.saved.get("demoprimaryIndex"), "1");
    assert.equal(f.saved.get("m3um3uArr"), "private playlist");
    f.host.getChanelsArray(() => {});
    f.host.getChanelsArray(() => {});
    assert.deepEqual(Array.from(f.host.cList), [900000001, 900000002]);
    assert.equal(
        driver.stream(900000001),
        "https://liminal-sketch-vv8r.here.now/demo/pattern.mp4"
    );
    assert.equal(
        driver.stream(900000002),
        "https://liminal-sketch-vv8r.here.now/demo/pattern.m3u8"
    );
    assert.deepEqual(f.requests, []);
    assert.equal(f.host.$.ajax, f.ajax);
});

test("credentials editor masks, trims and saves only at explicit save; cancel is inert", () => {
    const f = fixture(stored());
    f.mount("xtream");
    f.host.popupActions = [f.host.noProvParam, () => {}];
    f.host.popupArray = ["", ""];
    f.host.popupDetail = ["", ""];
    f.host.duneAddSettings(1);
    assert.equal(f.host.popupArray[1], "Xtream Codes settings: xc.test (a/b)");
    const edit = f.host.popupActions[1];
    edit();
    assert.equal(f.host.listArray[2], "Password: ********");
    f.host.selIndex = 2;
    f.host.listKeyHandler(f.host.keys.ENTER);
    assert.equal(f.edits[0].password, true);
    f.host.editvar = "  different password  ";
    f.host.setEdit();
    f.host.listKeyHandler(f.host.keys.RETURN);
    assert.equal(
        JSON.parse(f.saved.get("xtreamxtream_data")).password,
        config.password
    );
    edit();
    f.host.selIndex = 0;
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.editvar = " https://changed.test ";
    f.host.setEdit();
    f.host.selIndex = 4;
    f.host.listKeyHandler(f.host.keys.ENTER);
    assert.equal(
        JSON.parse(f.saved.get("xtreamxtream_data")).server,
        "https://changed.test"
    );
    assert.equal(
        f.host.popupArray[1],
        "Xtream Codes settings: changed.test (a/b)"
    );
    assert.equal(f.reloads, 1);
    edit();
    f.host.selIndex = 1;
    f.host.listKeyHandler(f.host.keys.ENTER);
    const retiredEdit = f.host.setEdit;
    const retiredKey = f.host.listKeyHandler;
    f.mount("demo");
    f.host.editvar = "stale";
    retiredEdit();
    f.host.selIndex = 4;
    retiredKey(f.host.keys.ENTER);
    assert.equal(
        JSON.parse(f.saved.get("xtreamxtream_data")).username,
        config.username
    );
    assert.equal(f.reloads, 1);
});

test("missing credentials and blocked URL open settings without network or completion", () => {
    for (const initial of [{}, stored()]) {
        const f = fixture(initial);
        f.host.checkProviderUrl = () => false;
        f.mount("xtream");
        let count = 0;
        f.host.getChanelsArray(() => count++);
        assert.equal(f.host.listCaption.innerHTML, "Xtream Codes Provider");
        assert.equal(count, 0);
        assert.equal(f.requests.length, 0);
    }
});

function integrationFixture(id) {
    const f = fixture({ ...stored(), ottplayprov: id });
    const w = f.host;
    const scripts = [],
        timers = new Map();
    let nextTimer = 0,
        completed = 0,
        ajaxWrites = 0;
    let ajax = w.$.ajax;
    Object.defineProperty(w.$, "ajax", {
        get: () => ajax,
        set(value) {
            ajaxWrites++;
            ajax = value;
        },
    });
    const jquery = w.$;
    const hostQuery = () => {
        const chain = {
            append() {
                return chain;
            },
            attr() {
                return chain;
            },
            css() {
                return chain;
            },
            hide() {},
            is: () => true,
            on() {
                return chain;
            },
        };
        return chain;
    };
    Object.defineProperty(hostQuery, "ajax", {
        get: () => jquery.ajax,
        set(value) {
            jquery.ajax = value;
        },
    });
    w.$ = hostQuery;
    Object.assign(w, {
        __av: "test",
        __cv: "test",
        beginPortChannelIdMigration() {},
        cancelMediaLoad() {},
        cancelPortChannelIdMigration() {},
        clearTimeout: (id) => timers.delete(id),
        console: {
            error: (error) => {
                throw error;
            },
            log() {},
            warn() {},
        },
        delOption() {},
        document: {
            createTextNode: (value) => value,
            getElementById: () => null,
        },
        edit_dealer() {},
        epgCash: 0,
        finishPortChannelIdMigration() {},
        firstRun: () => {
            throw new Error("unexpected firstRun");
        },
        getDefaultPlayerMode: () => 0,
        getScriptDOM: (url, ready) => scripts.push({ ready, url }),
        host: "https://player.test",
        invalidateEpgCache() {},
        location: { search: "" },
        normalizePlayerMode: (value) => value,
        onChanelsLoaded: () => completed++,
        optIndexOf: () => -1,
        optionsArr: [],
        optionsList() {},
        providerGetJson: (key, fallback) => {
            const value = w.providerGetItem(key);
            return value === null ? fallback : JSON.parse(value);
        },
        providerGetNum: (key, fallback) => {
            const value = w.providerGetItem(key);
            return value === null ? fallback : Number(value);
        },
        restoreDemoMute() {},
        savedPopup: {
            popupActions: [w.noProvParam, () => {}, w.optionsList],
            popupArray: ["", "", "Settings"],
            popupDetail: ["", "", "Settings"],
            ver: "test",
        },
        selectProvaider() {},
        setPlayerMode() {},
        setTimeout: (callback) => {
            const id = ++nextTimer;
            timers.set(id, callback);
            return id;
        },
    });
    const file = path.join(__dirname, "../src/provider/index.ts");
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const names = [
        "loadProv",
        "loadChannels",
        "syncFromWindow",
        "isProviderAllowed",
        "isPlayDistribution",
        "checkProviderUrl",
    ];
    const functions = source.statements
        .filter(
            (node) =>
                ts.isFunctionDeclaration(node) &&
                names.includes(node.name?.text)
        )
        .map((node) => node.getText(source).replace(/^export /, ""));
    functions.unshift(
        'var providerDistribution = "full", providerIds = ["demo", "xtream", "m3u"];'
    );
    vm.runInContext(
        ts.transpileModule(functions.join("\n"), {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        w
    );
    require("./helpers/english-source-fixture.cjs").attachSourceAliases(w);
    return {
        ...f,
        get ajaxWrites() {
            return ajaxWrites;
        },
        get completed() {
            return completed;
        },
        scripts,
        timers,
    };
}

test("actual loadProv/loadChannels use instance paths without script evaluation or ajax scope patching", () => {
    const f = integrationFixture("xtream");
    f.host.loadProv();
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.scripts, []);
    assert.equal(f.ajaxWrites, 0);
    assert.equal(f.host.commandChannelsReady, false);
    f.requests[0].resolve({ live_streams: [{ name: "Live", stream_id: 7 }] });
    assert.equal(f.completed, 1);
    assert.equal(f.host.commandChannelsReady, true);
    assert.equal(
        f.host.getChannelUrl(f.host.cList[0]),
        "https://xc.test/folder/live/a%2Fb/x%3F%26/7.m3u8"
    );
    const oldLoad = f.host.getChanelsArray;
    f.host.loadChannels();
    assert.equal(f.requests.length, 2);
    f.host.loadProv("demo");
    assert.equal(f.requests[1].aborts, 1);
    assert.equal(f.completed, 2);
    assert.equal(f.host.commandChannelsReady, true);
    const snapshot = clone(f.host.chanels);
    f.requests[1].resolve({ live_streams: [{ name: "Stale", stream_id: 8 }] });
    oldLoad(() => {
        throw new Error("retired loader completed");
    });
    assert.deepEqual(clone(f.host.chanels), snapshot);
    assert.equal(f.completed, 2);
    assert.equal(f.ajaxWrites, 0);
    assert.deepEqual(f.scripts, []);
    // Unconverted paths remain explicitly classic and still use their real loader.
    f.saved.set("ottplayprov", "m3u");
    f.host.loadProv("m3u");
    assert.equal(f.host.__ottActiveProviderDriver, null);
    assert.equal(f.scripts[0].url, "https://player.test/prov/m3u/prov.js?test");
});

test("driver-owned channels cannot be changed by classic view normalization", () => {
    const f = fixture(stored());
    const driver = f.mount("xtream");
    f.host.getChanelsArray(() => {});
    f.requests[0].resolve({ live_streams: [{ name: "Live", stream_id: 7 }] });
    const id = f.host.cList[0];
    const original = driver.stream(id);
    f.host.chanels[id].url = "https://mutated.test";
    f.host.chanels[id].epg = "other";
    f.host.chanels[id].category.name = "Modified";
    assert.equal(driver.stream(id), original);
    driver.guide(id, () => {});
    assert(f.requests[1].settings.url.includes("stream_id=7"));
});

test("failed reload and replaced credentials cannot resurrect a previous account catalog", () => {
    for (const changeAccount of [false, true]) {
        const f = fixture(stored());
        const driver = f.mount("xtream");
        f.host.getChanelsArray(() => {});
        f.requests[0].resolve({
            live_streams: [{ name: "Old account", stream_id: 42 }],
        });
        const oldId = f.host.cList[0];
        if (changeAccount)
            driver.saveCredentials({
                password: "secret",
                server: "https://new.test",
                username: "new",
            });
        f.host.cList = [];
        f.host.chanels = {};
        f.host.getChanelsArray(() => {});
        f.requests[1].reject();
        assert.deepEqual(Array.from(f.host.cList), []);
        assert.deepEqual(clone(f.host.chanels), {});
        assert.equal(driver.stream(oldId), "");
        assert.deepEqual(f.errors, ["Failed to connect to Xtream API server"]);
        f.requests[1].resolve({
            live_streams: [{ name: "Late", stream_id: 10 }],
        });
        assert.deepEqual(Array.from(f.host.cList), []);
    }
});

test("all33 operator instances reproduce660 captured catalogs, fallback sequences and malformed-response contracts", () => {
    const baseline = require("./fixtures/operator/sessions-before-core.json");
    const audit = fixture().host.__ottProviderDriverProfiles.filter(
        (profile) => profile.kind === "operator"
    );
    assert.equal(audit.length, 33);
    let compared = 0;
    for (const row of baseline.cases) {
        for (const outcome of row.outcomes) {
            for (const file of outcome.providers) {
                const id = file.slice("prov/".length, -"/prov.js".length);
                const profile = audit.find((item) => item.id === id);
                assert(
                    profile,
                    "every captured generic profile is registered: " + id
                );
                const config = row.input.config || {
                    m3u: "https://operator.test/fallback.m3u",
                    pass: "x?&",
                    server: "https://operator.test/base",
                    user: "a/b",
                };
                const f = fixture({
                    [profile.prefix + "cfg"]: JSON.stringify(config),
                });
                const driver = f.mount(id);
                let callbacks = 0,
                    failure = null;
                try {
                    f.host.getChannelsArray(() => callbacks++);
                    for (let index = 0; index < f.requests.length; index++) {
                        const request = f.requests[index],
                            settings = request.settings;
                        if (settings.dataType === "json") {
                            if (row.input.apiFailed) request.reject();
                            else request.resolve(row.input.account);
                        } else if (
                            settings.method === "post"
                                ? row.input.proxyFailed
                                : row.input.playlistFailed
                        )
                            request.reject();
                        else
                            request.resolve(
                                row.input.playlist ||
                                    '#EXTM3U\n#EXTINF:-1 tvg-id="m" group-title="Playlist",Fallback\nhttps://stream.test/m\n'
                            );
                    }
                } catch (error) {
                    failure = { message: error.message, name: error.name };
                }
                const result = clone({
                    callbacks,
                    calls: f.requests.map(({ settings }) => ({
                        data: settings.data || null,
                        dataType: settings.dataType || null,
                        method: settings.method || settings.type || "GET",
                        timeout: settings.timeout,
                        url: settings.url,
                    })),
                    channels: f.host.channels,
                    config: driver.configuration(),
                    errors: f.errors,
                    failure,
                    groupOrder: f.host.catsArray,
                    groups: f.host.cats,
                    ids: f.host.cList,
                });
                assert.deepEqual(
                    result,
                    outcome.expected,
                    id + ": " + row.name
                );
                assert.equal(f.host.$.ajax, f.ajax);
                compared++;
            }
        }
    }
    assert.equal(compared, 660);
});

test("generic cancellation rejects stale success/failure at API, direct playlist and proxy stages", () => {
    for (const stage of [0, 1, 2]) {
        const f = fixture({
            d_maxtvcfg: JSON.stringify({
                m3u: "",
                pass: "secret",
                server: "https://operator.test",
                user: "viewer",
            }),
        });
        f.mount("d/maxtv");
        let completed = 0;
        f.host.getChannelsArray(() => completed++);
        for (let index = 0; index < stage; index++) f.requests[index].reject();
        const retired = f.requests[stage];
        const count = f.requests.length;
        f.mount("demo");
        f.host.getChannelsArray(() => completed++);
        assert.equal(retired.aborts, 1);
        retired.reject();
        retired.resolve(
            stage
                ? "#EXTM3U\n#EXTINF:-1,Stale\nhttps://old.test/live\n"
                : { live_streams: [{ name: "Stale", stream_id: 1 }] }
        );
        assert.equal(
            f.requests.length,
            count,
            "retired failure cannot launch next fallback stage"
        );
        assert.equal(completed, 1);
        assert.deepEqual(Array.from(f.host.cList), [900000001, 900000002]);
        assert.deepEqual(f.errors, []);
    }
});

test("all33 profiles retain cfg namespace, four-field editor, empty guide and media capability", () => {
    const profiles = fixture().host.__ottProviderDriverProfiles.filter(
        (profile) => profile.kind === "operator"
    );
    for (const profile of profiles) {
        const config = {
            extra: "preserved",
            m3u: "https://playlist.test/old.m3u",
            pass: "secret",
            server: "https://operator.test",
            user: "original",
        };
        const f = fixture({
            [profile.prefix + "cfg"]: JSON.stringify(config),
            foreigncfg: "untouched",
        });
        const driver = f.mount(profile.id);
        f.host.popupActions = [f.host.noProvParam, () => {}];
        f.host.popupArray = ["", ""];
        f.host.popupDetail = ["", ""];
        f.host.duneAddSettings(1);
        assert.equal(f.host.p_pref, profile.prefix);
        assert.equal(
            f.host.popupArray[1],
            profile.title + " settings: operator.test (original)"
        );
        const edit = f.host.popupActions[1];
        edit();
        assert.equal(f.host.listCaption.innerHTML, profile.title);
        assert.equal(f.host.listArray.length, 6);
        assert.equal(f.host.listArray[2], "Password: ********");
        f.host.selIndex = 3;
        f.host.listKeyHandler(f.host.keys.ENTER);
        f.host.editvar = " https://playlist.test/new.m3u ";
        f.host.setEdit();
        f.host.listKeyHandler(f.host.keys.RETURN);
        assert.equal(
            JSON.parse(f.saved.get(profile.prefix + "cfg")).m3u,
            config.m3u
        );
        edit();
        f.host.selIndex = 3;
        f.host.listKeyHandler(f.host.keys.ENTER);
        f.host.editvar = " https://playlist.test/new.m3u ";
        f.host.setEdit();
        f.host.selIndex = 5;
        f.host.listKeyHandler(f.host.keys.ENTER);
        assert.deepEqual(JSON.parse(f.saved.get(profile.prefix + "cfg")), {
            ...config,
            m3u: "https://playlist.test/new.m3u",
        });
        assert.equal(f.saved.get("foreigncfg"), "untouched");
        assert.equal(f.reloads, 1);
        let guide = "not called";
        driver.guide("whatever", (value) => {
            guide = value;
        });
        assert.equal(guide, null);
        assert.equal(f.requests.length, 0);
        assert.equal(f.host.getMediaArray, null);
        assert.equal(driver.capabilities.media, false);
        assert.equal(driver.archive("unknown", 100, 200), "");
    }
});

console.log(
    "PASS typed provider instances: " +
        assertions +
        " cases; no network/decoder claim"
);
