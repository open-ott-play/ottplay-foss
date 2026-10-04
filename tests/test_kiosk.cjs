const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
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
console.log(
    "Kiosk admission, recovery, persistence, remote replacement and input tests passed"
);
