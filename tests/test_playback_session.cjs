const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const sharedCore = require("./helpers/shared-core-runtime.cjs");
const root = path.resolve(__dirname, "..");
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
    let nextTimer = 0;
    const timers = new Map();
    const cancelled = new Set();
    const effects = [];
    const stored = {};
    const c = {
        _: (text) => text,
        _prog100: { name: "Programme" },
        catIndex: 0,
        cats: { one: [101, 202, 303], two: [101, 303] },
        catsArray: ["one", "two"],
        channels: { 101: { rec: 24 }, 202: { rec: 48 }, 303: { rec: 0 } },
        clearTimeout: (id) => {
            cancelled.add(id);
        },
        console,
        curList: [101, 202, 303],
        Date: class extends Date {
            static now() {
                return 1000000000;
            }
        },
        formatSeekOffset: String,
        medHistory: [],
        p_pref: "source-a",
        playArchive: (epoch) => effects.push(["archive", epoch]),
        playChannel: (category, index) =>
            effects.push(["live", category, index]),
        playTime: 0,
        playType: 0,
        prevArr: [],
        primaryIndex: 0,
        providerGetItem: (key) => stored[key],
        providerSetItem: (key, value) => {
            stored[key] = value;
        },
        setTimeout: (callback) => {
            const id = ++nextTimer;
            timers.set(id, callback);
            return id;
        },
        settings: { prevCount: 4 },
        sFavorites: 0,
        showChannelInfo: () => {},
        showShift: (text) => effects.push(["message", text]),
        sInfoRew: 0,
        stbGetLen: () => 600,
        stbGetPosTime: () => 125.9,
        stbSetPosTime: (position) => effects.push(["seek", position]),
        timeShift: (offset) => effects.push(["timeshift", offset]),
    };
    c.window = c;
    vm.createContext(c);
    sharedCore(c);
    c.effects = effects;
    c.stored = stored;
    c.flush = () => {
        const jobs = [...timers];
        timers.clear();
        for (const [id, callback] of jobs) if (!cancelled.has(id)) callback();
    };
    c.late = () => {
        for (const callback of timers.values()) callback();
        timers.clear();
    };
    return c;
}

function include(c, file, names) {
    const ast = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const functions = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    );
    assert.equal(functions.length, names.length);
    const code = ts
        .transpileModule(
            functions.map((node) => node.getText(ast)).join("\n"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.ES2015,
                    target: ts.ScriptTarget.ES5,
                },
            }
        )
        .outputText.replace(/^export /gm, "");
    vm.runInContext(code, c);
}

// Classic view remains usable, but history identity is no longer a category index.
{
    const c = fixture();
    include(c, "src/channels/index.ts", ["setCurrent", "shiftArchive"]);
    c.prevArr = [
        { c: 0, ci: 202, i: 1, marker: "destination" },
        { c: 0, ci: 303, i: 2, marker: "keep" },
    ];
    c.setCurrent(0, 1); // Omitted archive flag must mean live, just like false.
    assert.deepEqual(
        plain(c.prevArr).map((row) => row.ci),
        [101, 303]
    );
    assert.equal(c.prevArr[1].marker, "keep");
    assert.equal(c.primaryIndex, 1);
    assert.equal(c.curList, c.cats.one);
    assert.equal(c.stored.primaryIndex, "1");
    assert.equal(JSON.parse(c.stored.continueWatch).channelId, 202);
    c.primaryIndex = 0;
    c.prevArr = [{ c: 0, ci: 303, i: 2 }];
    c.setCurrent(1, 0); // Same channel in another category is not a departure.
    assert.deepEqual(
        plain(c.prevArr).map((row) => row.ci),
        [303]
    );
    assert.equal(c.catIndex, 1);
}

// The classic channel journal excludes VOD before applying its capacity.
{
    const c = fixture();
    c.settings.prevCount = 0; // One previous channel.
    c.prevArr = [{ c: 0, ci: 303, i: 2 }];
    c.medHistory = [{ current: 0, stream_url: "movie.mp4" }];
    c.playType = -1e11;
    c.__ottClassicPlayback.select(0, -1);
    assert.deepEqual(
        plain(c.prevArr).map((row) => row.ci),
        [303]
    );
    assert.equal(c.medHistory[0].current, 125);
    assert.equal(JSON.parse(c.stored.medHistory)[0].current, 125);
    assert.equal(c.stored.primaryIndex, undefined);
    assert.equal(c.stored.continueWatch, undefined);
    c.sFavorites = -1;
    delete c.stored.medHistory;
    c.__ottClassicPlayback.select(0, -1);
    assert.equal(c.stored.medHistory, undefined);
}

// Finite platform channel files use media seeking but retain channel history.
{
    const c = fixture();
    c.playType = -99999999999;
    c.medHistory = [{ current: 11, stream_url: "unrelated.mp4" }];
    c.__ottClassicPlayback.select(0, 1);
    assert.equal(c.prevArr[0].ci, 101);
    assert.equal(c.medHistory[0].current, 11);
    assert.equal(c.stored.medHistory, undefined);
}

// Archive history stores an absolute resume time and preserves old input objects.
{
    const c = fixture();
    c.playType = 990000;
    c.playTime = 90;
    const previous = { c: 0, ci: 303, extra: "opaque", i: 2, t: 980000 };
    c.prevArr = [previous, { ci: 404, t: "bad" }, null, { ci: 505, t: -10 }];
    c.__ottClassicPlayback.select(0, 1);
    assert.equal(c.prevArr[0].t, 990090);
    assert.equal(c.prevArr.length, 2);
    assert.equal(c.prevArr[1].extra, "opaque");
    assert.equal(previous.t, 980000);
    // The v1 bookmark contract still refers to the outgoing playback mode.
    assert.equal(JSON.parse(c.stored.continueWatch).mode, "archive");
}

// Missing startup channels and malformed stored rows never create invalid visits.
{
    const c = fixture();
    c.cats = {};
    c.catsArray = [];
    c.prevArr = {};
    c.__ottClassicPlayback.select(0, 0);
    assert.deepEqual(plain(c.prevArr), []);
}

// Debounce adds intents within one session; the observation at execution is fresh.
{
    const c = fixture();
    c.playType = -1e11;
    c.__ottClassicPlayback.shift(15);
    c.__ottClassicPlayback.shift(30);
    c.flush();
    assert.deepEqual(
        c.effects.filter((row) => row[0] === "seek"),
        [["seek", 170.9]]
    );
    c.effects.length = 0;
    c.__ottClassicPlayback.shift(-6e6);
    assert.deepEqual(
        c.effects.filter((row) => row[0] === "seek"),
        [["seek", 0]]
    );
    c.effects.length = 0;
    c.__ottClassicPlayback.shift(1000);
    c.flush();
    assert.equal(
        c.effects.some((row) => row[0] === "seek"),
        false
    );
}

// Epoch-based archive seeking, live rewind, and crossing the live edge.
{
    const c = fixture();
    c.__ottClassicPlayback.shift(-30);
    c.flush();
    assert(c.effects.some((row) => row[0] === "timeshift" && row[1] === 30));
    c.effects.length = 0;
    c.playType = 999900;
    c.playTime = 20;
    c.__ottClassicPlayback.shift(30);
    c.flush();
    assert(c.effects.some((row) => row[0] === "archive" && row[1] === 999950));
    c.__ottClassicPlayback.shift(200);
    c.flush();
    assert(c.effects.some((row) => row[0] === "live"));
}

// Delayed callbacks cannot survive cancellation even if a timer fires after clearTimeout.
for (const change of [
    (c) => c.__ottClassicPlayback.cancel(),
    (c) => c.__ottClassicPlayback.select(0, 1),
    (c) => {
        c.p_pref = "source-b";
    },
    (c) => {
        c.primaryIndex = 2;
    },
    (c) => {
        c.channels = { ...c.channels };
        c.cats = { ...c.cats };
    },
    (c) => {
        c.channels[101] = { rec: 48 };
    },
    (c) => {
        c.cats.one = [...c.cats.one];
    },
]) {
    const c = fixture();
    c.__ottClassicPlayback.shift(-30);
    change(c);
    c.late();
    assert.equal(
        c.effects.some((row) =>
            ["timeshift", "seek", "archive", "live"].includes(row[0])
        ),
        false
    );
}

// A real timeShift callback is admitted once, and cannot switch a replacement source.
for (const replacement of [null, "catalog", "channel", "list"]) {
    const c = fixture();
    include(c, "src/channels/index.ts", ["timeShift", "setCurrent"]);
    let reply;
    c.getChannelEpgCached = (_id, callback) => {
        reply = callback;
    };
    c.setCurProg = () => {};
    c.curProg = 0;
    c.timeShift(30);
    if (replacement === "catalog") c.channels = { ...c.channels };
    if (replacement === "channel") c.channels[101] = { rec: 48 };
    if (replacement === "list") c.cats.one = [...c.cats.one];
    reply(101, [
        { descr: "", name: "Current", time: 999000, time_to: 1001000 },
    ]);
    reply(101, []);
    assert.equal(
        c.effects.filter((row) => row[0] === "archive").length,
        replacement ? 0 : 1
    );
}

// Live pause owns its asynchronous EPG work as well as the later media effect.
{
    const c = fixture();
    include(c, "src/channels/index.ts", ["liveStop"]);
    let reply;
    c.getChannelEpgCached = (_id, callback) => {
        reply = callback;
    };
    c.stbIsPlaying = () => true;
    c.stbPause = () => c.effects.push(["pause"]);
    c.setCurProg = () => {};
    c.liveStop();
    c.__ottClassicPlayback.cancel();
    reply(101, []);
    assert.equal(c.playType, 0);
    assert.equal(c.effects.length, 0);
}

// Stop really invalidates the private controller before touching media objects.
{
    const c = fixture();
    include(c, "src/core/index.ts", [
        "stbStop",
        "clearCorePlaybackStateEvents",
    ]);
    c._corePlaybackStateCleanup = null;
    c.video = { pause() {}, removeAttribute() {} };
    c._playSession = 0;
    c.hlsInstance = null;
    for (const name of [
        "cancelLiveRestart",
        "cancelCoreSeek",
        "cancelCoreAutoPlayback",
        "cancelCoreNativeHls",
        "resetCoreNativeBitrate",
        "setCoreDemoMute",
        "destroyCoreShaka",
        "clearPlayTimeInterval",
    ])
        c[name] = () => {};
    c.__ottClassicPlayback.shift(-30);
    c.stbStop();
    c.late();
    assert.equal(
        c.effects.some((row) => row[0] === "timeshift"),
        false
    );
}

// Production TS lowering remains valid for old browser grammars.
for (const file of ["session.ts", "classic-adapter.ts"]) {
    const source = fs.readFileSync(
        path.join(root, "src/playback", file),
        "utf8"
    );
    const compiled = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
    acorn.parse(compiled, { ecmaVersion: 5 });
}
console.log(
    "PASS playback sessions: history, VOD/native files, archive clocks, migration records, stale seeks/EPG and stop ownership"
);
