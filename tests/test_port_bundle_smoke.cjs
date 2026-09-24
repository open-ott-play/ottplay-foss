const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const {
    checkBundleIdentifiers,
} = require("../scripts/check-bundle-identifiers.cjs");

const publicFixture = `
    function startPlayer() {} var popupActions = [];
    function noProvParam() {} function optionsList() {}
    function makeRedefinable(name, get, set) {
        Object.defineProperty(window, name, { get: get, set: set });
    }
    makeRedefinable("listKeyHandler", function () {}, function (value) {});
    window.chanels = [];
`;
checkBundleIdentifiers(publicFixture);
checkBundleIdentifiers(
    publicFixture.replace("window.chanels = []", "var chanels = []")
);
assert.throws(
    () =>
        checkBundleIdentifiers(
            publicFixture.replace(
                "window.chanels = []",
                "(function () { var chanels = []; })()"
            )
        ),
    /chanels/,
    "A function-local declaration must not satisfy browser global publication"
);
assert.throws(
    () => checkBundleIdentifiers(JSON.stringify(publicFixture) + ";"),
    /Missing classic global/,
    "Identifier strings alone do not establish the plugin ABI"
);
assert.throws(
    () => checkBundleIdentifiers("(function () {" + publicFixture + "})();"),
    /Missing classic global/,
    "Locally scoped names cannot satisfy the bare-global ABI"
);
assert.throws(
    () =>
        checkBundleIdentifiers(
            publicFixture.replace("window.chanels = []", "other.chanels = []")
        ),
    /chanels/,
    "An unrelated object property cannot satisfy a window publication"
);

// No network requests or media decoding run. Selected controller timers are
// driven explicitly through fake host ports after loading the complete artifact.
const bundlePath = path.resolve(
    process.argv[2] || path.join(__dirname, "../dist/stbPlayer.js")
);
const bundle = fs.readFileSync(bundlePath, "utf8");
checkBundleIdentifiers(bundle);
const globalNames = new Set();
function collectGlobals(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration") {
        globalNames.add(node.id.name);
        return;
    }
    if (
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
    )
        return;
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier")
        globalNames.add(node.id.name);
    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach(collectGlobals);
        else if (child && typeof child === "object") collectGlobals(child);
    }
}
collectGlobals(acorn.parse(bundle, { ecmaVersion: 5 }));
const fixtureTimers = new WeakMap();

function fixture(profile) {
    const elements = new Map();
    const listeners = [];
    let timerId = 0;
    const timers = new Map();
    function element(name) {
        if (elements.has(name)) return elements.get(name);
        const e = {
            addEventListener(...args) {
                listeners.push([name, ...args]);
            },
            appendChild(child) {
                this.children.push(child);
                child.parentNode = this;
                return child;
            },
            attributes: {},
            blur() {},
            childNodes: [],
            children: [],
            classList: {
                add() {},
                contains() {
                    return false;
                },
                remove() {},
                toggle() {},
            },
            click() {},
            clientHeight: 720,
            clientWidth: 1280,
            dispatchEvent() {
                return true;
            },
            focus() {},
            getAttribute(key) {
                return this.attributes[key] || null;
            },
            getBoundingClientRect() {
                return {
                    bottom: 720,
                    height: 720,
                    left: 0,
                    right: 1280,
                    top: 0,
                    width: 1280,
                };
            },
            getElementsByTagName() {
                return [];
            },
            id: name,
            innerHTML: "",
            insertBefore(child) {
                return this.appendChild(child);
            },
            nodeType: 1,
            offsetHeight: 720,
            offsetWidth: 1280,
            querySelectorAll() {
                return [];
            },
            removeAttribute(key) {
                delete this.attributes[key];
            },
            removeChild(child) {
                this.children = this.children.filter((x) => x !== child);
                return child;
            },
            removeEventListener() {},
            scrollTop: 0,
            setAttribute(key, value) {
                this.attributes[key] = String(value);
            },
            style: {},
            tagName: name.toUpperCase(),
            textContent: "",
            value: "",
        };
        elements.set(name, e);
        return e;
    }
    const document = {
        activeElement: null,
        addEventListener(...args) {
            listeners.push(["document", ...args]);
        },
        body: element("body"),
        cookie: "",
        createElement: (tag) => element(tag),
        documentElement: element("html"),
        getElementById: (id) => element(id),
        getElementsByTagName: (tag) =>
            tag === "head" ? [element("head")] : [],
        head: element("head"),
        querySelector: () => null,
        querySelectorAll: () => [],
        readyState: "complete",
        removeEventListener() {},
        title: "",
    };
    function jquery(selector) {
        const el =
            typeof selector === "string"
                ? element(selector.replace(/^#/, ""))
                : selector || element("body");
        const chain = {
            0: el,
            css() {
                return arguments.length > 1 || typeof arguments[0] === "object"
                    ? this
                    : "";
            },
            each(callback) {
                callback.call(el, 0, el);
                return this;
            },
            get(i) {
                return i === undefined ? [el] : el;
            },
            height: () => 720,
            html(value) {
                return arguments.length ? this : "";
            },
            is: () => false,
            length: 1,
            offset: () => ({ left: 0, top: 0 }),
            position: () => ({ left: 0, top: 0 }),
            text(value) {
                return arguments.length ? this : "";
            },
            val(value) {
                return arguments.length ? this : "";
            },
            width: () => 1280,
        };
        for (const name of [
            "on",
            "off",
            "bind",
            "unbind",
            "click",
            "ready",
            "show",
            "hide",
            "toggle",
            "append",
            "prepend",
            "appendTo",
            "remove",
            "empty",
            "attr",
            "removeAttr",
            "addClass",
            "removeClass",
            "toggleClass",
            "find",
            "children",
            "parent",
            "eq",
            "first",
            "last",
            "focus",
            "blur",
            "trigger",
            "scrollTop",
            "animate",
            "stop",
            "fadeIn",
            "fadeOut",
            "prop",
            "data",
        ]) {
            chain[name] = function () {
                return this;
            };
        }
        return chain;
    }
    jquery.extend = Object.assign;
    jquery.isArray = Array.isArray;
    jquery.parseJSON = JSON.parse;
    jquery.each = (object, fn) =>
        Object.keys(object).forEach((key) => fn(key, object[key]));
    jquery.ajax = () => ({ abort() {} });
    jquery.get = jquery.post = jquery.getJSON = jquery.ajax;
    const storage = {};
    const w = {
        __av: "smoke",
        __cv: "smoke",
        $: jquery,
        addEventListener(...args) {
            listeners.push(["window", ...args]);
        },
        alert() {},
        clearInterval(id) {
            timers.delete(id);
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        close() {},
        confirm: () => false,
        console: { debug() {}, error() {}, info() {}, log() {}, warn() {} },
        deviceUUID: "smoke-device",
        document,
        focus() {},
        getComputedStyle: () => ({
            display: "block",
            getPropertyValue: () => "",
        }),
        host_ott: "http://localhost",
        innerHeight: 720,
        innerWidth: 1280,
        jQuery: jquery,
        localStorage: {
            clear: () => {
                for (const key of Object.keys(storage)) delete storage[key];
            },
            getItem: (key) => storage[key] ?? null,
            removeItem: (key) => {
                delete storage[key];
            },
            setItem: (key, value) => {
                storage[key] = String(value);
            },
        },
        location: {
            hash: "",
            host: "localhost",
            hostname: "localhost",
            href: "http://localhost/",
            origin: "http://localhost",
            pathname: "/",
            protocol: "http:",
            search: "",
        },
        navigator: {
            language: "en",
            onLine: true,
            platform: "STB",
            userAgent: "Legacy STB smoke",
        },
        open() {},
        ott_device: "pc",
        removeEventListener() {},
        screen: {
            availHeight: 720,
            availWidth: 1280,
            height: 720,
            width: 1280,
        },
        setInterval(fn, delay) {
            timers.set(++timerId, { delay, fn });
            return timerId;
        },
        setTimeout(fn, delay) {
            timers.set(++timerId, { delay, fn });
            return timerId;
        },
    };
    if (profile === "capacitor-fallback") w.Capacitor = { Plugins: {} };
    if (profile === "capacitor-native") {
        w.Capacitor = {
            Plugins: {
                DashExoPlayer: {
                    isDashSupported: () => Promise.resolve({ ok: true }),
                },
                MobileNativeMedia: {
                    getVolume: () => Promise.resolve({ ok: true, volume: 37 }),
                },
            },
        };
    }
    w.window = w;
    w.self = w;
    w.globalThis = w;
    // Browsers create nonconfigurable Window properties for global var/function
    // declarations. Node's contextified sandbox can otherwise allow accessors to
    // replace an uninitialized declaration, producing a VM-only recursion.
    for (const name of globalNames) {
        Object.defineProperty(w, name, {
            configurable: false,
            enumerable: true,
            value: w[name],
            writable: true,
        });
    }
    vm.createContext(w);
    if (profile === "legacy") {
        vm.runInContext(
            `
            Promise = undefined; Map = undefined; Set = undefined; WeakMap = undefined;
            WeakSet = undefined; Symbol = undefined; Reflect = undefined; Proxy = undefined;
            Number.isFinite = undefined; Number.isNaN = undefined; Number.isInteger = undefined;
            Number.parseInt = undefined; Number.parseFloat = undefined; Object.assign = undefined;
            delete String.prototype.includes; delete String.prototype.startsWith;
            delete String.prototype.endsWith; delete String.prototype.repeat;
            delete Array.prototype.findIndex; delete Array.prototype.find;
            delete Array.prototype.includes; Array.from = undefined;
            Object.entries = undefined; Object.values = undefined;
            TextEncoder = undefined; performance = undefined;
        `,
            w
        );
    }
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, "../js/runtime-polyfills.js"),
            "utf8"
        ),
        w
    );
    require("./helpers/shared-core-runtime.cjs")(w, { vendorOnly: true });
    for (const api of [
        "__ottPlaybackSession",
        "__ottPlaybackJournal",
        "__ottProviderDrivers",
        "__ottProviderDriverProfiles",
        "__ottClassicPlayback",
        "__ottProviderRuntime",
    ])
        assert.equal(
            w[api],
            undefined,
            "fixture must not inject private source API " + api
        );
    fixtureTimers.set(w, timers);
    return w;
}

function assertPrivateRuntime(w, profile) {
    for (const [api, method] of [
        ["__ottPlaybackSession", "create"],
        ["__ottPlaybackJournal", "create"],
        ["__ottProviderDrivers", "createRegistry"],
        ["__ottProviderDrivers", "mount"],
        ["__ottClassicPlayback", "select"],
        ["__ottClassicPlayback", "shift"],
        ["__ottClassicPlayback", "cancel"],
        ["__ottProviderRuntime", "createRegistry"],
        ["__ottProviderRuntime", "createClassicAdapter"],
    ]) {
        assert.equal(
            typeof w[api]?.[method],
            "function",
            profile + ": bundle initializes " + api + "." + method
        );
    }
    assert.equal(typeof w.__ottProviderRuntime.classic.replace, "function");
    assert(Array.isArray(w.__ottProviderDriverProfiles));
    assert.deepEqual(
        Array.from(w.__ottProviderDrivers.registry.ids()),
        Array.from(w.__ottProviderDriverProfiles, (profile) => profile.id)
    );
    for (const name of [
        "createPlaybackJournal",
        "createDriverRegistry",
        "providerDriverRegistry",
        "createDemoDriver",
        "createXtreamDriver",
        "createOperatorDriver",
        "providerDriverProfiles",
        "createDriverTransport",
        "mountProviderDriver",
        "createPlaybackSessionController",
        "classicPlaybackController",
        "classicPlaybackRuntime",
        "classicPlaybackSelect",
        "createProviderRegistry",
        "createClassicProviderAdapter",
    ]) {
        assert.equal(
            vm.runInContext("typeof " + name, w),
            "undefined",
            profile + ": private implementation leaked: " + name
        );
    }
    // Also catch a renamed top-level leak after optimizer-local mangling.
    for (const implementation of [
        w.__ottPlaybackSession.create,
        w.__ottPlaybackJournal.create,
        w.__ottProviderDrivers.createRegistry,
        w.__ottProviderDrivers.mount,
        w.__ottClassicPlayback.select,
        w.__ottProviderRuntime.createRegistry,
        w.__ottProviderRuntime.createClassicAdapter,
    ]) {
        assert(
            !Object.keys(w).some((key) => w[key] === implementation),
            profile + ": private implementation exposed as bare global"
        );
    }
}

function exercisePlaybackRuntime(w, profile) {
    const timers = fixtureTimers.get(w);
    const stored = new Map();
    const positions = [];
    const archives = [];
    const overrides = {
        _prog100: { name: "Current program" },
        catIndex: 0,
        cats: { All: [1, 2] },
        catsArray: ["All"],
        channels: {
            1: { channel_name: "One", rec: 24 },
            2: { channel_name: "Two", rec: 24 },
        },
        curList: [1, 2],
        medHistory: [{ stream_url: "https://media.invalid/movie.mp4" }],
        p_pref: "artifact-fixture:",
        playArchive: (start) => archives.push(start),
        playTime: 0,
        playType: 0,
        prevArr: [],
        primaryIndex: 0,
        providerGetItem: (key) => stored.get(key) || null,
        providerSetItem: (key, value) => stored.set(key, value),
        settings: { ...w.settings, prevCount: 2 },
        sFavorites: 0,
        showShift() {},
        sInfoRew: 0,
        stbGetLen: () => 120,
        stbGetPosTime: () => 40,
        stbSetPosTime: (position) => positions.push(position),
    };
    const saved = new Map(Object.keys(overrides).map((key) => [key, w[key]]));
    function delayedShift(...deltas) {
        const before = new Set(timers.keys());
        deltas.forEach((delta) => w.shiftArchive(delta));
        const pending = [...timers].filter(
            ([id, timer]) => !before.has(id) && timer.delay === 500
        );
        assert.equal(
            pending.length,
            1,
            profile + ": built shiftArchive owns one delayed operation"
        );
        return pending[0];
    }
    function fire([id, timer]) {
        timers.delete(id);
        timer.fn();
    }
    try {
        for (const [key, value] of Object.entries(overrides)) w[key] = value;
        w.curList = w.cats.All;
        // Execute the real bundled entrypoint, codec, controller and Kotlin core.
        w.setCurrent(0, 1, false);
        assert.equal(w.primaryIndex, 1);
        assert.equal(w.curList, w.cats.All);
        assert.deepEqual(
            Array.from(w.prevArr, (visit) => visit.ci),
            [1]
        );
        assert.equal(stored.get("primaryIndex"), "1");
        assert.equal(JSON.parse(stored.get("continueWatch")).channelId, 2);
        const journal = JSON.parse(stored.get("playbackJournal"));
        assert.equal(
            journal.version,
            2,
            profile + ": real setCurrent writes the canonical journal"
        );
        assert.equal(journal.sourceId, "artifact-fixture:");
        assert.equal(journal.history[0].channelId, "1");
        assert.equal(journal.history[0].kind, "live");
        w.__ottClassicPlayback.command({ channelId: 2, type: "live" });
        const checkpoint = JSON.parse(stored.get("playbackJournal"));
        assert.equal(checkpoint.bookmark.channelId, "2");
        assert.equal(checkpoint.bookmark.kind, "live");

        w.playType = -1e11;
        const combined = delayedShift(5, 7);
        assert.deepEqual(positions, [], profile + ": seek waits for debounce");
        fire(combined);
        assert.deepEqual(
            positions,
            [52],
            profile + ": actual typed controller combines offsets"
        );

        const cancelled = delayedShift(10);
        w.__ottClassicPlayback.cancel();
        assert.equal(timers.has(cancelled[0]), false);
        fire(cancelled); // A browser callback may already have entered its task queue.
        assert.deepEqual(
            positions,
            [52],
            profile + ": cancellation rejects queued callback"
        );

        const changedSelection = delayedShift(10);
        w.setCurrent(0, 0, false);
        fire(changedSelection);
        assert.deepEqual(
            positions,
            [52],
            profile + ": built setCurrent retires pending seek"
        );
        assert.equal(
            w.medHistory[0].current,
            40,
            profile + ": leaving VOD persists position"
        );

        const changedCatalog = delayedShift(10);
        w.channels = {
            1: { channel_name: "Replacement", rec: 24 },
            2: { channel_name: "Two", rec: 24 },
        };
        fire(changedCatalog);
        assert.deepEqual(
            positions,
            [52],
            profile + ": same channel ID in new catalog cannot accept old seek"
        );

        const archiveStart = Math.floor(Date.now() / 1000) - 600;
        w.playType = archiveStart;
        w.playTime = 30;
        fire(delayedShift(15));
        assert.deepEqual(
            archives,
            [archiveStart + 45],
            profile + ": archive planning reaches the host effect port"
        );
    } finally {
        w.__ottClassicPlayback.cancel();
        for (const [key, value] of saved) w[key] = value;
    }
}

function exerciseProviderRuntime(profile) {
    // A fresh full artifact realm keeps this startup test independent of both
    // previous smoke overrides and any source-module bootstrap.
    const w = fixture(profile);
    vm.runInContext(bundle, w, { filename: bundlePath, timeout: 5000 });
    assertPrivateRuntime(w, profile);
    w.document.createTextNode = (text) => ({ nodeType: 3, textContent: text });
    const stored = new Map([
        ["ottplayprov", "demo"],
        [
            "xtreamxtream_data",
            JSON.stringify({
                password: "secret",
                server: "https://account.test",
                username: "viewer",
            }),
        ],
    ]);
    const requests = [],
        scripts = [],
        errors = [];
    let completed = 0,
        ajaxWrites = 0;
    const ajax = (settings) => {
        let success, failure;
        const request = {
            abort() {
                this.aborts++;
                if (failure) failure();
            },
            aborts: 0,
            done(callback) {
                success = callback;
                return this;
            },
            fail(callback) {
                failure = callback;
                return this;
            },
            reject() {
                failure();
            },
            resolve(value) {
                success(value);
            },
            settings,
        };
        requests.push(request);
        return request;
    };
    let currentAjax = ajax;
    Object.defineProperty(w.$, "ajax", {
        configurable: true,
        get: () => currentAjax,
        set(value) {
            ajaxWrites++;
            currentAjax = value;
        },
    });
    Object.assign(w, {
        _: (value) => value,
        beginPortChannelIdMigration() {},
        cancelMediaLoad() {},
        cancelPortChannelIdMigration() {},
        closeList() {},
        console: {
            debug() {},
            error: (error) => errors.push(error),
            info() {},
            log() {},
            warn() {},
        },
        finishPortChannelIdMigration() {},
        getDefaultPlayerMode: () => 0,
        getScriptDOM: (url) => scripts.push(url),
        invalidateEpgCache() {},
        normalizePlayerMode: (value) => value,
        onChannelsLoaded: () => completed++,
        removeOption() {},
        restoreDemoMute() {},
        savedPopup: {
            popupActions: [
                w.toggleProviderSettingsVisibility,
                () => {},
                w.optionsList,
            ],
            popupArray: ["", "", "Settings"],
            popupDetail: ["", "", "Settings"],
            ver: "artifact",
        },
        setPlayer() {},
        setPlayerMode() {},
        stbDelItem: (key) => stored.delete(key),
        stbGetItem: (key) => (stored.has(key) ? stored.get(key) : null),
        stbIsPlaying: () => false,
        stbSetItem: (key, value) => stored.set(key, String(value)),
        stbStopPip() {},
    });
    w.loadProv();
    assert.equal(w.__ottActiveProviderDriver.id, "demo");
    assert.equal(
        completed,
        1,
        profile + ": built demo route completes channel startup"
    );
    assert.equal(w.commandChannelsReady, true);
    assert.deepEqual(Array.from(w.cList), [900000001, 900000002]);
    assert.equal(
        w.getChannelUrl(w.cList[0]),
        "https://liminal-sketch-vv8r.here.now/demo/pattern.mp4"
    );
    assert.deepEqual(scripts, []);
    assert.equal(requests.length, 0);
    stored.set("ottplayprov", "xtream");
    w.loadProv("xtream");
    assert.equal(w.__ottActiveProviderDriver.id, "xtream");
    assert.equal(requests.length, 1);
    assert.equal(w.commandChannelsReady, false);
    assert.equal(
        requests[0].settings.url,
        "https://account.test/player_api.php?username=viewer&password=secret"
    );
    requests[0].resolve({
        live_streams: [{ name: "Artifact channel", stream_id: 7 }],
    });
    assert.equal(completed, 2);
    assert.equal(w.commandChannelsReady, true);
    assert.equal(
        w.getChannelUrl(w.cList[0]),
        "https://account.test/live/viewer/secret/7.m3u8"
    );
    w.loadChannels();
    assert.equal(requests.length, 2);
    w.loadProv("demo");
    assert.equal(requests[1].aborts, 1);
    requests[1].resolve({
        live_streams: [{ name: "Obsolete account", stream_id: 8 }],
    });
    assert.equal(completed, 3);
    assert.equal(w.commandChannelsReady, true);
    assert.deepEqual(Array.from(w.cList), [900000001, 900000002]);
    if (w.__ottProviderDrivers.registry.has("all4you")) {
        stored.set(
            "all4youcfg",
            JSON.stringify({
                m3u: "",
                pass: "secret",
                server: "https://generic.test",
                user: "account",
            })
        );
        stored.set("ottplayprov", "all4you");
        w.loadProv("all4you");
        assert.equal(requests.length, 3);
        requests[2].reject();
        assert.equal(
            requests.length,
            4,
            profile + ": generic API failure starts playlist fallback"
        );
        requests[3].reject();
        assert.equal(requests.length, 5);
        assert.equal(requests[4].settings.method, "post");
        assert(requests[4].settings.url.endsWith("/m3u/cp.php"));
        requests[4].resolve(
            '#EXTM3U\n#EXTINF:-1 group-title="Generic",Fallback channel\nhttps://media.test/generic\n'
        );
        assert.equal(completed, 4);
        assert.equal(w.getChannelUrl(w.cList[0]), "https://media.test/generic");
        w.loadChannels();
        w.loadProv("demo");
        assert.equal(requests[5].aborts, 1);
        requests[5].reject();
        assert.equal(
            requests.length,
            6,
            profile + ": retired generic failure cannot start a fallback"
        );
        assert.equal(completed, 5);
        assert.deepEqual(Array.from(w.cList), [900000001, 900000002]);
    }
    assert.deepEqual(
        scripts,
        [],
        profile + ": registered drivers never execute provider scripts"
    );
    assert.equal(
        ajaxWrites,
        0,
        profile + ": registered drivers never patch the ajax host port"
    );
    assert.deepEqual(errors, []);
    console.log(
        "OK: actual classic bundle " +
            profile +
            " instance provider startup/cancellation"
    );
}

async function main() {
    // The bundle reassigns ott_device after HTML boot has already detected it.
    // Exercise that assignment with the webOS TV 25 UA published by LG:
    // https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine
    const webosUA =
        "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.270 Safari/537.36 WebAppManager";
    for (const [pathname, userAgent, expected] of [
        ["/", webosUA, "lg/webos"],
        ["/", "webOS TV", "lg/webos"],
        ["/f/lg/webos", "Unknown browser", "lg/webos"],
        ["/f/lg/webos/", "Unknown browser", "lg/webos"],
        ["/f/lg/netcast/", webosUA, "lg/netcast"],
        ["/f/samsung/tizen/", webosUA, "samsung/tizen"],
        ["/f/samsung/maple/", "Unknown browser", "samsung/maple"],
        ["/f/dune/", webosUA, "dune"],
        ["/", "Unknown browser", "pc"],
    ]) {
        const w = fixture("modern");
        w.location.pathname = pathname;
        w.location.href = w.location.origin + pathname;
        w.navigator.userAgent = userAgent;
        w.ott_device = expected;
        vm.runInContext(bundle, w, { filename: bundlePath, timeout: 5000 });
        assert.equal(
            w.ott_device,
            expected,
            pathname + ": bundle must preserve the boot device selection"
        );
        // This is the device URL requested by HTML after the bundle's onload.
        const adapterPath = "stb/" + w.ott_device + "/stb.js";
        const adapter = fs.readFileSync(
            path.join(__dirname, "..", adapterPath),
            "utf8"
        );
        vm.runInContext(adapter, w, { filename: adapterPath });
        if (expected === "lg/webos") {
            assert.equal(w.keys.RETURN, 461, "Load the LG Back key mapping");
        }
    }
    console.log(
        "OK: actual classic bundle retains LG UA and nested device routes"
    );

    for (const profile of [
        "legacy",
        "modern",
        "capacitor-fallback",
        "capacitor-native",
    ]) {
        const w = fixture(profile);
        try {
            vm.runInContext(bundle, w, { filename: bundlePath, timeout: 5000 });
        } catch (error) {
            throw new Error(
                profile + " bundle execution failed: " + error.message,
                { cause: error }
            );
        }
        assertPrivateRuntime(w, profile);
        if (profile === "modern" || profile === "legacy") {
            exercisePlaybackRuntime(w, profile);
            exerciseProviderRuntime(profile);
        }
        for (const name of [
            "startPlayer",
            "stbInit",
            "stbPlay",
            "stbStop",
            "keyHandler",
            "playArchive",
            "playChannel",
            "playMedia",
            "showSelectBox",
            "handleCommand",
            "settingsCommands",
            "resolveNativePlugin",
            "noProvParam",
            "optionsList",
        ]) {
            assert.equal(
                typeof w[name],
                "function",
                profile + ": missing global " + name
            );
        }
        assert.equal(
            Array.isArray(w.popupActions),
            true,
            profile + ": public popup action table"
        );
        assert.equal(
            w.chanels,
            w.channels,
            profile + ": legacy channel alias keeps the actual table"
        );
        assert.ok(
            w.optionsArr.some(
                (item) =>
                    item.name === "Remote control" &&
                    item.action === w.settingsCommands
            ),
            profile + ": final options wiring must execute"
        );
        assert.equal(
            Array.isArray(w.listDataArray),
            true,
            profile + ": listDataArray must remain an array"
        );
        for (const name of [
            "listKeyHandlerFn",
            "getListItemFn",
            "detailListActionFn",
            "aboutKeyHandler",
        ]) {
            assert.ok(
                w[name] === null || typeof w[name] === "function",
                profile +
                    ": callback " +
                    name +
                    " has been replaced with a wrapper object"
            );
        }
        const callback = function () {
            return true;
        };
        w.listKeyHandler = callback;
        assert.equal(
            w.listKeyHandlerFn,
            callback,
            profile + ": public list callback must reach its backing global"
        );
        w.listKeyHandlerFn = null;
        assert.equal(
            w.listKeyHandler,
            null,
            profile + ": reverse list callback alias must stay synchronized"
        );
        w.getListItemFn = callback;
        assert.equal(
            w.getListItem,
            callback,
            profile + ": item renderer alias must stay synchronized"
        );
        w.detailListAction = callback;
        assert.equal(
            w.detailListActionFn,
            callback,
            profile + ": detail callback alias must stay synchronized"
        );
        for (const pair of w.legacyPlayerBindings) {
            assert.equal(
                w[pair[0]],
                w[pair[1]],
                profile + ": shared naming alias " + pair[0]
            );
        }
        const originalProvider = w.getChannelsArray;
        vm.runInContext(
            "function getChanelsArray() { return 'provider override'; }",
            w
        );
        assert.equal(w.getChannelsArray(), "provider override");
        w.getChannelsArray = originalProvider;
        assert.equal(w.getChanelsArray, originalProvider);
        const originalChannels = w.channels;
        const replacementChannels = { 123: { name: "Alias fixture" } };
        w.chanels = replacementChannels;
        assert.equal(w.channels, replacementChannels);
        w.channels = originalChannels;
        assert.equal(w.chanels, originalChannels);
        for (const name of [
            "MobileNativeMedia",
            "DashExoPlayer",
            "M3UProxy",
            "StalkerPortal",
        ]) {
            assert.equal(
                typeof w[name],
                "object",
                profile + ": missing native bridge " + name
            );
        }
        vm.runInContext(
            `
            if (typeof Number.isFinite !== "function" || !Number.isFinite(2) || Number.isFinite("2")) throw Error("Number polyfills");
            if (Object.assign({}, { x: 1 }).x !== 1 || !"abc".includes("b")) throw Error("Object/String polyfills");
            if ([4, 5].findIndex(function (n) { return n === 5; }) !== 1) throw Error("Array polyfill");
        `,
            w
        );
        // This function comes from channels' renamed core import in the real output.
        // A stripped import used to leave videoElement unresolved here.
        const originalVideo = w.video;
        const originalSetPosition = w.stbSetPosTime;
        const originalLength = w.stbGetLen;
        const originalPlayType = w.playType;
        const positions = [];
        w.video = { currentTime: 0 };
        w.stbSetPosTime = (position) => positions.push(position);
        w.stbGetLen = () => 120;
        w.playType = 1700000000;
        w.seekArchive(42);
        assert.deepEqual(
            positions,
            [42],
            "Actual bundle resolves renamed mutable imports"
        );
        w.video = originalVideo;
        w.stbSetPosTime = originalSetPosition;
        w.stbGetLen = originalLength;
        w.playType = originalPlayType;
        if (profile === "legacy") {
            assert.equal(
                typeof w.Promise,
                "function",
                "shared bootstrap supplies Promise before generic STB startup"
            );
        } else {
            const dash = await w.DashExoPlayer.isDashSupported();
            const media = await w.MobileNativeMedia.getVolume();
            if (profile === "capacitor-native") {
                assert.equal(
                    w.MobileNativeMedia,
                    w.Capacitor.Plugins.MobileNativeMedia
                );
                assert.equal(
                    w.DashExoPlayer,
                    w.Capacitor.Plugins.DashExoPlayer
                );
                assert.equal(dash.ok, true);
                assert.equal(media.volume, 37);
            } else {
                assert.equal(dash.ok, false);
                assert.equal(dash.unsupported, true);
                assert.equal(media.ok, false);
                assert.equal(media.unsupported, true);
            }
        }
        console.log(
            "OK: actual classic bundle " +
                profile +
                " profile, globals and native bridges"
        );
    }
}
main().catch((error) => {
    console.error(error.message);
    if (error.cause)
        console.error(
            String(error.cause.stack).split("\n").slice(-8).join("\n")
        );
    process.exitCode = 1;
});
