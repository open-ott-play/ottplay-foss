const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");
function load(file, globals = {}) {
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    const context = { exports: {}, ...globals };
    vm.runInNewContext(code, context);
    return context.exports;
}
const casing = load("src/utils/caseless.ts");
const { createKiosk } = load("src/plugins/kiosk.ts", { require: () => casing });
function rig(storage = {}) {
    let time = 0,
        position = 0,
        source = "m3u:0@one",
        playing = false,
        tick,
        fail = false;
    const played = [],
        events = {};
    const w = {
        __ottActiveProviderDriver: { id: "m3u" },
        __ottSourceIdentity: { current: () => source },
        cats: { all: ["a", "b"] },
        catsArray: ["all"],
        channels: {
            a: { channel_name: "Первый" },
            b: { channel_name: "Новости" },
        },
        cList: ["a", "b"],
        commandChannelsReady: true,
        curList: ["a", "b"],
        document: {
            addEventListener: (name, fn) => {
                events[name] = fn;
            },
        },
        performance: { now: () => time },
        playChannel: (c, i) => {
            const id = w.cats[w.catsArray[c]][i];
            if (!kiosk.admit(id)) return;
            played.push(id);
            w.curList = w.cats[w.catsArray[c]];
            w.primaryIndex = i;
        },
        primaryIndex: 0,
        setInterval: (fn) => {
            tick = fn;
            return 1;
        },
        stbGetItem: (key) => storage[key],
        stbGetPosTime: () => {
            if (fail) throw Error("decoder");
            return position;
        },
        stbIsPlaying: () => playing,
        stbSetItem: (key, value) => {
            storage[key] = value;
        },
    };
    const kiosk = createKiosk(w);
    w.__ottKiosk = kiosk;
    kiosk.init();
    function request(params) {
        let result;
        kiosk.request(params, (r) => {
            result = r;
        });
        return result;
    }
    return {
        advance: (seconds, progress = false) => {
            for (let i = 0; i < seconds; i++) {
                time += 1000;
                if (progress) position++;
                tick();
            }
        },
        events,
        fail: (value) => {
            fail = value;
        },
        kiosk,
        play: (value) => {
            playing = value;
        },
        played,
        request,
        source: (value) => {
            source = value;
        },
        storage,
        w,
    };
}
{
    const r = rig();
    assert.equal(r.request({ mode: "on" }).data.state, "waiting");
    r.advance(30, true);
    assert.deepEqual(r.played, []);
    r.w.playChannel(0, 1);
    assert.equal(r.kiosk.snapshot().channel.id, "b");
    r.w.playChannel(0, 0);
    assert.deepEqual(r.played, ["b"]);
    assert.equal(
        r.request({ mode: "on" }).data.state,
        "locked",
        "on cannot accidentally re-arm"
    );
    r.advance(9);
    assert.equal(r.played.length, 1);
    r.advance(1);
    assert.deepEqual(r.played, ["b", "b"]);
    r.advance(10);
    assert.equal(r.played.length, 3);
    r.play(true);
    r.advance(60, true);
    assert.equal(r.played.length, 3, "healthy playback must not restart");
    r.advance(10);
    assert.equal(r.played.length, 4, "stalled decoder restarts");
    r.fail(true);
    r.advance(10);
    assert.equal(
        r.played.length,
        5,
        "throwing health API must not disable retries"
    );
    r.fail(false);
    r.w.cats.all = ["b", "a"];
    r.advance(10);
    assert.equal(r.played.at(-1), "b", "track IDs across reordered lists");
    const count = r.played.length;
    r.source("m3u:1@other");
    r.advance(20);
    assert.equal(r.played.length, count);
    assert.equal(r.kiosk.snapshot().health, "source-unavailable");
    r.source("m3u:0@one");
    delete r.w.channels.b;
    r.advance(10);
    assert.equal(r.played.length, count);
    assert.equal(r.kiosk.snapshot().health, "channel-unavailable");
    r.request({ mode: "off" });
    r.advance(30);
    assert.equal(r.played.length, count);
    assert.equal(r.kiosk.enabled(), false);
}
{
    const r = rig();
    assert.equal(r.request({ mode: "on", query: "новости" }).status, "ok");
    assert.deepEqual(r.played, ["b"]);
    assert.equal(r.request({ mode: "set", query: "1" }).data.channel.id, "a");
    assert.deepEqual(r.played, ["b", "a"]);
    assert.equal(
        r.request({ mode: "set", query: "missing" }).status,
        "rejected"
    );
    assert.equal(r.kiosk.snapshot().channel.id, "a");
    let blocked = 0;
    r.events.click({
        preventDefault: () => blocked++,
        stopImmediatePropagation: () => blocked++,
    });
    assert.equal(blocked, 2);
    const restored = rig(r.storage);
    assert.equal(restored.kiosk.locked(), true);
    restored.w.playChannel(0, 1);
    assert.deepEqual(restored.played, []);
    restored.advance(10);
    assert.deepEqual(restored.played, ["a"]);
    // The policy stays enabled independently of remote connectivity.
    restored.w.__ottCommandServer = { status: () => ({ enabled: false }) };
    restored.advance(10);
    assert.deepEqual(restored.played, ["a", "a"]);
    restored.request({ mode: "off" });
    assert.equal(rig(r.storage).kiosk.enabled(), false);
}
{
    const r = rig();
    r.w.channels.a.channel_name = "Новости HD";
    r.w.channels.b.channel_name = "Новости";
    assert.equal(
        r.request({ mode: "on", query: "НОВОСТИ" }).data.channel.id,
        "a",
        "the first substring match wins over a later exact name"
    );
    assert.equal(
        r.request({ mode: "set", query: "2" }).data.channel.id,
        "b",
        "catalogue numbers still select the requested row"
    );
    assert.equal(
        r.request({ mode: "set", query: "ВоСт" }).data.channel.id,
        "a",
        "remote replacement uses the first case-insensitive substring match too"
    );
    r.w.channels.b.channel_name = "Новости HD";
    assert.equal(
        r.request({ mode: "set", query: "Новости HD" }).data.channel.id,
        "a",
        "duplicate full names select the first row"
    );
    r.w.cList = ["b", "a"];
    r.advance(10);
    assert.equal(
        r.played.at(-1),
        "a",
        "recovery retains the pinned ID instead of searching again"
    );
    assert.equal(
        r.request({ mode: "set", query: "новости" }).data.channel.id,
        "b",
        "a new request follows current catalogue order, not category order"
    );
    r.w.cats.all = ["a"];
    assert.equal(
        r.request({ mode: "set", query: "новости" }).status,
        "rejected",
        "an unavailable first match must not silently select the second match"
    );
    assert.equal(r.kiosk.snapshot().channel.id, "b");
    r.w.cats.all = ["a", "b"];
    r.w.ifParentalAccessChId = (id) => id === "b";
    assert.equal(
        r.request({ mode: "set", query: "новости" }).status,
        "rejected",
        "a protected first match must not silently select another channel"
    );
}
{
    const r = rig();
    r.w.ifParentalAccessChId = () => true;
    assert.equal(r.request({ mode: "on", query: "1" }).status, "rejected");
    assert.equal(r.kiosk.enabled(), false);
    r.w.ifParentalAccessChId = () => false;
    r.w.stbSetItem = () => {
        throw Error("quota");
    };
    assert.equal(r.request({ mode: "on", query: "1" }).status, "rejected");
    assert.equal(r.kiosk.enabled(), false);
    assert.deepEqual(r.played, []);
}
for (const params of [
    null,
    [],
    {},
    { mode: "other" },
    { mode: "set" },
    { mode: "off", query: "1" },
    { extra: 1, mode: "status" },
    { mode: "on", query: "" },
    { mode: "on", query: 1 },
    { mode: "on", query: "я".repeat(513) },
    { mode: "on", query: "\ud800" },
    { mode: "on", query: "a\n" },
]) {
    const r = rig();
    assert.equal(r.request(params).status, "rejected");
    assert.equal(r.kiosk.enabled(), false);
}
// Execute the real live-playback entry point with effects instrumented: blocked
// channels must not stop a decoder, cancel requests or alter the selection.
const index = fs.readFileSync("src/index.ts", "utf8");
const ast = ts.createSourceFile(
    "index.ts",
    index,
    ts.ScriptTarget.Latest,
    true
);
function declaration(name) {
    return ast.statements
        .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
        .getText(ast);
}
{
    const r = rig();
    r.request({ mode: "on", query: "1" });
    let cancelled = 0;
    r.w.__ottMedia = { cancelRequest: () => cancelled++ };
    const code = ts.transpileModule(declaration("_playChannel"), {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
    const context = {
        cats: r.w.cats,
        catsArray: r.w.catsArray,
        console,
        window: r.w,
    };
    vm.createContext(context);
    vm.runInContext(code, context);
    context._playChannel(0, 1);
    assert.equal(cancelled, 0);
}
{
    const r = rig();
    r.request({ mode: "on" });
    const code = ts.transpileModule(declaration("_playMedia"), {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
    const context = { window: r.w };
    vm.createContext(context);
    vm.runInContext(code, context);
    context._playMedia({ stream_url: "https://wrong.example" }, true); // returns before any VOD side effect
}
function diagnosticKiosk(
    markup = '<button id="remoteDiagnosticsIndicator">Remote diagnostics · Stop</button>'
) {
    const dom = new JSDOM(
        "<body>" + markup + '<button id="settings">Settings</button></body>'
    );
    const w = dom.window;
    const storedPolicy = JSON.stringify({
        channel: { id: "one", name: "One" },
        provider: "m3u",
        source: "fixture",
    });
    let stopped = 0;
    let bubbled = 0;
    let statusListener;
    const authority = {
        enabled: true,
        pending: false,
        sessionId: "capture-one",
        state: "active",
        trusted: true,
    };
    w.stbGetItem = () => storedPolicy;
    w.__ottSourceIdentity = { current: () => "fixture" };
    w.setInterval = () => 1;
    w.__ottRemoteDiagnostics = {
        status: () => ({ ...authority }),
        stopSession() {
            stopped++;
            delete authority.sessionId;
            authority.state = "ready";
            authority.message =
                "Remote control authorizes diagnostics. Ready for an operator.";
            if (statusListener) statusListener({ ...authority });
        },
    };
    const kiosk = createKiosk(w);
    w.__ottKiosk = kiosk;
    kiosk.init();
    for (const name of [
        "click",
        "pointerdown",
        "mousedown",
        "touchstart",
        "wheel",
        "keydown",
    ]) {
        w.document.addEventListener(name, () => bubbled++);
        w.document
            .getElementById("settings")
            .addEventListener(name, () => bubbled++);
        w.document
            .getElementById("remoteDiagnosticsIndicator")
            .addEventListener(name, () => bubbled++);
    }
    return {
        authority,
        bubbled: () => bubbled,
        dom,
        kiosk,
        onStatus(listener) {
            statusListener = listener;
        },
        stopped: () => stopped,
        storedPolicy,
        w,
    };
}
{
    const r = diagnosticKiosk();
    r.w._ = (value) => value;
    const controller = r.w.__ottRemoteDiagnostics;
    let render;
    const context = {
        createCommandServerTransport: () => () => {},
        document: r.w.document,
        installDiagnosticsController(_window, options) {
            render = options.onStatus;
            r.onStatus(render);
            return controller;
        },
        PLAYER_VERSION: "test",
        settings: {},
        window: r.w,
    };
    vm.createContext(context);
    vm.runInContext(
        ts.transpileModule(declaration("initRemoteDiagnostics"), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        context
    );
    context.initRemoteDiagnostics();
    render({ enabled: false, state: "disabled" });
    render({
        enabled: true,
        message:
            "Remote control authorizes diagnostics. Ready for an operator.",
        state: "ready",
        trusted: true,
    });
    assert.equal(
        r.w.document.getElementById("remoteDiagnosticsIndicator"),
        null,
        "an idle authorized connection must not show a capture stop control"
    );
    render({
        ...r.authority,
        message: "Remote diagnostics is collecting for this connection.",
    });
    const button = r.w.document.getElementById("remoteDiagnosticsIndicator");
    button.addEventListener("click", () =>
        assert.fail("kiosk cannot leak a stop click")
    );
    const event = new r.w.Event("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    assert.equal(r.stopped(), 1);
    assert.equal(event.defaultPrevented, true);
    assert.equal(
        r.w.document.getElementById("remoteDiagnosticsIndicator"),
        null
    );
    assert.equal(r.authority.enabled, true);
    assert.equal(r.authority.trusted, true);
    assert.equal(r.authority.sessionId, undefined);
    assert.equal(r.bubbled(), 0);
    assert.equal(r.kiosk.locked(), true);
    assert.equal(r.kiosk.snapshot().channel.id, "one");
    assert.equal(r.w.stbGetItem("__ottKioskV1"), r.storedPolicy);
    r.dom.window.close();
}
for (const state of [
    { sessionId: undefined, state: "ready" },
    { sessionId: undefined, state: "suspended" },
    { pending: true, sessionId: undefined, state: "storage-error" },
    { sessionId: "stale-capture", state: "ready" },
    { sessionId: "", state: "active" },
    { sessionId: "invalid id", state: "active" },
    { sessionId: 42, state: "active" },
]) {
    const r = diagnosticKiosk();
    Object.assign(r.authority, state);
    assert.equal(
        r.kiosk.stopDiagnostics(),
        false,
        "no active session means STOP must not restart an idle authorized runtime"
    );
    assert.equal(r.stopped(), 0);
    assert.equal(r.authority.trusted, true);
    assert.equal(r.kiosk.locked(), true);
    r.dom.window.close();
}
for (const type of ["click", "pointerdown", "mousedown", "touchstart"]) {
    const r = diagnosticKiosk();
    const button = r.w.document.getElementById("remoteDiagnosticsIndicator");
    const event = new r.w.Event(type, { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    assert.equal(
        r.stopped(),
        1,
        type + " must stop capture through the live controller"
    );
    assert.equal(event.defaultPrevented, true);
    assert.equal(
        r.bubbled(),
        0,
        "capture stop cannot invoke onclick, settings or delegated handlers"
    );
    assert.equal(r.kiosk.locked(), true);
    assert.equal(r.kiosk.snapshot().channel.id, "one");
    assert.equal(r.w.stbGetItem("__ottKioskV1"), r.storedPolicy);
    button.dispatchEvent(
        new r.w.Event("click", { bubbles: true, cancelable: true })
    );
    assert.equal(
        r.stopped(),
        1,
        "compatibility mouse/click events cannot stop the same capture twice"
    );
    r.dom.window.close();
}
for (const key of ["Enter", " "]) {
    const r = diagnosticKiosk();
    const button = r.w.document.getElementById("remoteDiagnosticsIndicator");
    button.focus();
    const event = new r.w.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
    });
    button.dispatchEvent(event);
    assert.equal(
        r.stopped(),
        1,
        "focused stop control stays keyboard accessible"
    );
    assert.equal(event.defaultPrevented, true);
    assert.equal(r.bubbled(), 0);
    assert.equal(r.kiosk.locked(), true);
    r.dom.window.close();
}
{
    const r = diagnosticKiosk();
    r.w.document
        .getElementById("settings")
        .dispatchEvent(
            new r.w.Event("click", { bubbles: true, cancelable: true })
        );
    r.w.document
        .getElementById("remoteDiagnosticsIndicator")
        .dispatchEvent(
            new r.w.Event("wheel", { bubbles: true, cancelable: true })
        );
    assert.equal(
        r.stopped(),
        0,
        "other controls and scrolling do not affect support"
    );
    assert.equal(r.bubbled(), 0);
    assert.equal(r.kiosk.locked(), true);
    r.dom.window.close();
    const wrongElement = diagnosticKiosk(
        '<div id="remoteDiagnosticsIndicator">Unrelated element</div>'
    );
    wrongElement.w.document
        .getElementById("remoteDiagnosticsIndicator")
        .dispatchEvent(
            new wrongElement.w.Event("click", {
                bubbles: true,
                cancelable: true,
            })
        );
    assert.equal(
        wrongElement.stopped(),
        0,
        "a matching ID alone is not the stop button"
    );
    assert.equal(wrongElement.bubbled(), 0);
    wrongElement.dom.window.close();
}
{
    const source = fs.readFileSync("src/key-handler/index.ts", "utf8");
    const parsed = ts.createSourceFile(
        "key-handler.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const handler = parsed.statements
        .find(
            (node) =>
                ts.isFunctionDeclaration(node) &&
                node.name?.text === "keyHandler"
        )
        .getText(parsed);
    const r = diagnosticKiosk();
    r.w.__ottDevice = {
        eventToKeyCode: (event) => (event.key === "MediaStop" ? 83 : 37),
    };
    const context = {
        cancelNativeListInertia: () => {},
        exports: {},
        keys: { MUTE: 173, STOP: 83, VOL_DOWN: 174, VOL_UP: 175 },
        window: r.w,
    };
    vm.runInNewContext(
        ts.transpileModule(handler, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        context
    );
    const unrelated = new r.w.KeyboardEvent("keydown", {
        cancelable: true,
        key: "ArrowLeft",
    });
    context.exports.keyHandler(unrelated);
    assert.equal(r.stopped(), 0);
    assert.equal(unrelated.defaultPrevented, true);
    const stop = new r.w.KeyboardEvent("keydown", {
        cancelable: true,
        key: "MediaStop",
        keyCode: 413,
    });
    context.exports.keyHandler(stop);
    assert.equal(
        r.stopped(),
        1,
        "device-mapped STOP stops capture without requiring DOM focus"
    );
    assert.equal(stop.defaultPrevented, true);
    assert.equal(r.kiosk.locked(), true);
    assert.equal(r.kiosk.snapshot().channel.id, "one");
    assert.equal(r.w.stbGetItem("__ottKioskV1"), r.storedPolicy);
    context.exports.keyHandler(stop);
    assert.equal(r.stopped(), 1);
    r.dom.window.close();
}
console.log(
    "Kiosk admission, recovery, persistence, remote replacement and input tests passed"
);

// VPortal has no TV channel list: lock the current request-backed media queue.
{
    const r = rig();
    const source = "vportal:0@one";
    r.source(source);
    r.w.__ottActiveProviderDriver = { id: "vportal" };
    r.w.cList = [];
    r.w.curList = [];
    const records = [0, 1].map((i) => ({
        __ottMediaRef: { itemId: "episode:" + i, sourceId: source },
        request: { episode: i },
        title: "Episode " + i,
        vportalSource: source,
    }));
    let selection = { index: 0, position: 12, records, source };
    const restored = [];
    let looped = 0;
    let ended = false;
    r.w.__ottMedia = {
        current: () => ({
            ended: ended,
            ref: selection.records[selection.index].__ottMediaRef,
        }),
        keepKioskLoop: () => looped++,
        kioskSelection: () => selection,
        restoreKiosk: (value, guard) => {
            restored.push({ guard, value });
            return true;
        },
        sourceId: () => source,
    };
    r.w.__ottClassicPlayback = {
        snapshot: () => ({
            position: selection.position,
            target: {
                channelId:
                    selection.records[selection.index].__ottMediaRef.itemId,
                kind: "vod",
                sourceId: source,
            },
        }),
    };
    const result = r.request({ mode: "on" });
    assert.equal(result.status, "ok");
    assert.equal(result.data.state, "locked");
    assert.equal(result.data.channel, null);
    assert.equal(result.data.media.total, 2);
    assert.equal(looped, 1);
    assert.equal(
        r.kiosk.allowed("a"),
        false,
        "TV cannot enter a VPortal kiosk"
    );
    assert.equal(
        r.kiosk.allowedMedia(records[1].__ottMediaRef),
        true,
        "next episode remains allowed"
    );
    assert.equal(
        r.kiosk.allowedMedia({ itemId: "unrelated", sourceId: source }),
        false
    );
    assert(
        !JSON.stringify(result).includes("request"),
        "wire status does not expose media requests"
    );
    r.advance(59);
    assert.equal(restored.length, 0, "slow native startup gets its full grace");
    r.advance(2);
    assert.equal(restored.length, 1);
    r.play(true);
    r.advance(20, true);
    assert.equal(restored.length, 1, "healthy VOD never restarts");
    for (const failure of ["write", "readback", "mismatch"]) {
        const write = r.w.stbSetItem;
        const read = r.w.stbGetItem;
        const persisted = r.storage.__ottKioskV1;
        selection.position += 10;
        r.w.stbSetItem = (key, value) => {
            if (failure === "write") throw Error("quota");
            if (failure !== "mismatch") write(key, value);
        };
        r.w.stbGetItem = (key) => {
            if (failure === "readback") throw Error("storage unavailable");
            return read(key);
        };
        // Brief buffering is still below the playback watchdog threshold.
        // A failed position checkpoint must not masquerade as a decoder error.
        r.advance(6);
        assert.equal(r.kiosk.snapshot().health, "playing", failure);
        assert.equal(restored.length, 1, failure + " does not restart video");
        if (failure !== "readback")
            assert.equal(r.storage.__ottKioskV1, persisted);
        r.w.stbSetItem = write;
        r.w.stbGetItem = read;
        r.advance(6, true);
        assert.equal(
            JSON.parse(r.storage.__ottKioskV1).media.position,
            selection.position,
            failure + " retries and persists the latest position after recovery"
        );
        assert.equal(r.kiosk.snapshot().health, "playing");
        assert.equal(restored.length, 1);
    }
    ended = true;
    r.play(false);
    r.advance(20);
    assert.equal(
        restored.length,
        1,
        "slow next-episode resolution receives startup grace"
    );
    ended = false;
    r.play(true);
    selection = { index: 1, position: 3, records, source };
    r.advance(6, true);
    assert.equal(
        JSON.parse(r.storage.__ottKioskV1).media.index,
        1,
        "episode cursor persists"
    );
    assert.equal(r.kiosk.snapshot().media.index, 1);
    const reloaded = rig(r.storage);
    reloaded.source(source);
    reloaded.w.__ottActiveProviderDriver = { id: "vportal" };
    reloaded.w.__ottMedia = r.w.__ottMedia;
    assert.equal(reloaded.kiosk.restoreMedia(), true);
    assert.equal(restored.at(-1).value.index, 1);
    const guard = restored.at(-1).guard;
    assert.equal(guard(), true);
    reloaded.request({ mode: "off" });
    assert.equal(guard(), false, "unlock invalidates delayed resume");
    r.w.__ottMedia.sourceId = () => "vportal:1@two";
    r.advance(60);
    assert.equal(
        r.kiosk.snapshot().health,
        "source-unavailable",
        "same IDs on another profile cannot play"
    );
    r.request({ mode: "off" });
    assert.equal(r.kiosk.allowedMedia(null), true);
}
{
    const r = rig();
    r.w.__ottActiveProviderDriver = { id: "vportal" };
    r.w.__ottMedia = {
        kioskSelection: () => null,
        sourceId: () => "vportal:0",
    };
    assert.equal(
        r.request({ mode: "on" }).status,
        "rejected",
        "empty library cannot masquerade as a locked video"
    );
    assert.equal(r.kiosk.enabled(), false);
}
console.log(
    "VPortal kiosk persistence, episode admission, startup grace and cancellation passed"
);
