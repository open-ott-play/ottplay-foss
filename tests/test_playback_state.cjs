const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const sharedCore = require("./helpers/shared-core-runtime.cjs");
const root = path.resolve(__dirname, "..");

function include(c, file, names) {
    const ast = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const nodes = ast.statements.filter(
        (n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)
    );
    assert.equal(nodes.length, names.length);
    const code = ts
        .transpileModule(nodes.map((n) => n.getText(ast)).join("\n"), {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.replace(/^export /gm, "");
    vm.runInContext(code, c);
}

function fixture() {
    const values = {};
    const listeners = {};
    const video = {
        addEventListener(name, callback) {
            (listeners[name] ||= []).push(callback);
        },
        currentTime: 0,
        duration: 600,
        paused: true,
        readyState: 0,
        removeEventListener(name, callback) {
            listeners[name] = (listeners[name] || []).filter(
                (v) => v !== callback
            );
        },
    };
    const c = {
        _corePlaybackStateCleanup: null,
        _playSession: 1,
        catIndex: 0,
        cats: { News: [101, 202] },
        catsArray: ["News"],
        channels: { 101: { rec: 24 }, 202: { rec: 48 } },
        clearTimeout() {},
        console,
        curList: [101, 202],
        Date,
        document: { getElementById: () => null },
        m3uArr: {
            active: 0,
            M3Us: [
                {
                    medSourceId: "one",
                    www: "https://one.invalid/?private=secret",
                },
                { medSourceId: "two", www: "https://two.invalid/" },
            ],
        },
        medHistory: [],
        p_pref: "source",
        playTime: 0,
        playType: 0,
        prevArr: [],
        primaryIndex: 0,
        providerGetItem: (key) => values[key],
        providerSetItem: (key, value) => {
            values[key] = value;
        },
        setTimeout() {},
        settings: { prevCount: 2 },
        sFavorites: 0,
        stbGetLen: () => video.duration,
        stbGetPosTime: () => video.currentTime,
        video,
    };
    c.window = c;
    vm.createContext(c);
    sharedCore(c);
    c.api = c.__ottClassicPlayback;
    c.values = values;
    c.openMedia = (item) => {
        const media = c.__ottMedia.prepare(item, item.stream_url);
        c.api.command({
            channelId: media.ref.itemId,
            item: media.item,
            type: "vod",
        });
    };
    c.mediaPosition = () =>
        JSON.parse(values["mediaJournal.v1:" + c.__ottMedia.sourceId()])
            .history[0].position;
    c.listeners = listeners;
    c.emit = (name) => [...(listeners[name] || [])].forEach((cb) => cb());
    return c;
}

// The normal command path owns kind/identity; observations keep generation stable.
{
    const c = fixture();
    assert.equal(c.api.snapshot().target.kind, "live");
    assert.deepEqual(
        c.values,
        {},
        "Adopting a compatibility projection never checkpoints startup"
    );
    c.api.command({
        archiveStart: 1700000000,
        channelId: 101,
        type: "archive",
    });
    c.api.command({ type: "playing" });
    c.api.command({ position: 42, type: "position" });
    const initial = c.api.snapshot();
    assert.equal(initial.target.kind, "archive");
    assert.equal(initial.target.archiveStart, 1700000000);
    assert.equal(initial.position, 42);
    assert.equal(c.playType, 1700000000);
    assert.equal(c.playTime, 42);
    initial.target.channelId = "mutated";
    initial.historyTarget.kind = "vod";
    assert.equal(c.api.snapshot().target.channelId, "101");
    assert.equal(c.api.snapshot().historyTarget.kind, "archive");
    assert.equal(c.api.snapshot().generation, initial.generation);
    c.api.command({ type: "pause" });
    assert.equal(c.api.snapshot().phase, "paused");
    c.api.command({ type: "stop" });
    c.api.command({ type: "playing" });
    c.api.command({ position: 99, type: "position" });
    assert.equal(c.api.snapshot().phase, "stopped");
    assert.equal(c.api.snapshot().position, 42);
    c.api.command({ channelId: 202, type: "live" });
    assert.equal(c.api.snapshot().target.kind, "live");
    assert.equal(c.playType, 0);
}

// Old provider writes enter through explicit reconciliation once, without durable writes.
{
    const c = fixture();
    c.api.snapshot();
    c.playType = 1700000050;
    c.playTime = 9;
    const adopted = c.api.reconcile();
    assert.equal(adopted.target.kind, "archive");
    assert.equal(adopted.position, 9);
    assert.equal(c.api.reconcile().generation, adopted.generation);
    assert.deepEqual(c.values, {});
}

// A new item cannot borrow the previous engine's position while attachment is pending.
{
    const c = fixture();
    const item = { current: 0, stream_url: "new.mp4" };
    c.video.currentTime = 125.9;
    c.openMedia(item);
    assert.equal(c.api.snapshot().phase, "loading");
    assert.equal(c.api.snapshot().position, 0);
    c.api.select(0, -1);
    assert.equal(
        item.current,
        0,
        "Unstarted departure does not persist previous source progress"
    );
    assert.equal(c.mediaPosition(), 0);
    c.api.command({ type: "playing" });
    c.api.select(0, -1);
    assert.equal(
        c.mediaPosition(),
        125.9,
        "A started backend supplies departure progress"
    );
}

// Media-origin events are generation-bound; native finite-channel detection is reclassification.
{
    const c = fixture();
    include(c, "src/core/index.ts", [
        "clearCorePlaybackStateEvents",
        "bindCorePlaybackStateEvents",
        "stbIsPlaying",
    ]);
    include(c, "src/index.ts", ["checkMedia"]);
    c.mediaCheckTimer = null;
    c.updateMediaInfoDisplay = () => {};
    c.api.command({ channelId: 101, type: "live" });
    c.bindCorePlaybackStateEvents(c.video, c._playSession);
    c.video.paused = false;
    c.video.readyState = 2;
    c.emit("playing");
    const generation = c.api.snapshot().generation;
    c.checkMedia();
    assert.equal(
        c.api.snapshot().generation,
        generation,
        "Finite detection keeps backend ownership"
    );
    assert.equal(c.api.snapshot().target.kind, "vod");
    assert.equal(c.api.snapshot().target.channelId, "channel:101");
    assert.equal(c.api.snapshot().historyTarget.kind, "live");
    c.video.currentTime = 80;
    c.emit("timeupdate");
    assert.equal(c.api.snapshot().position, 80);
    c.video.paused = true;
    c.emit("pause");
    assert.equal(c.api.snapshot().phase, "paused");
    const old = Object.fromEntries(
        Object.entries(c.listeners).map(([k, v]) => [k, [...v]])
    );
    c.api.command({
        channelId: "next.mp4",
        item: { stream_url: "next.mp4" },
        type: "vod",
    });
    c._playSession++;
    c.bindCorePlaybackStateEvents(c.video, c._playSession);
    c.video.currentTime = 211;
    c.video.paused = false;
    for (const name of ["playing", "timeupdate", "pause"])
        for (const cb of old[name] || []) cb();
    assert.equal(c.api.snapshot().phase, "loading");
    assert.equal(c.api.snapshot().position, 0);
    c.video.readyState = 0;
    c.emit("playing");
    assert.equal(
        c.api.snapshot().phase,
        "loading",
        "Unready replacement cannot admit stale playing event"
    );
    c.video.currentTime = 0;
    c.video.readyState = 2;
    c.emit("playing");
    assert.equal(c.api.snapshot().phase, "playing");
    c.api.command({ type: "stop" });
    c.emit("playing");
    c.emit("timeupdate");
    assert.equal(c.api.snapshot().phase, "stopped");
}

// The periodic native bridge cannot mark the old Shaka backend as a new attached source.
{
    const c = fixture();
    include(c, "src/core/index.ts", ["stbIsPlaying"]);
    include(c, "src/ui/index.ts", ["initBackgroundIntervals", "_t2"]);
    const timers = [];
    c.setInterval = (cb) => timers.push(cb);
    c.openMedia({ stream_url: "pending.mp4", title: "Pending" });
    c.video.currentTime = 220;
    c.video.readyState = 4;
    c.video.paused = false;
    c.initBackgroundIntervals();
    timers[0]();
    assert.equal(c.api.snapshot().phase, "loading");
    assert.equal(c.api.snapshot().position, 0);
    assert.equal(c.mediaPosition(), 0);
}

// Seeking inside one archive file rebinds the retained backend without mixing its file offset with archive time.
{
    const c = fixture();
    include(c, "src/core/index.ts", [
        "clearCorePlaybackStateEvents",
        "bindCorePlaybackStateEvents",
        "stbSetPosTime",
    ]);
    c.seekCoreMedia = (position) => {
        c.video.currentTime = position;
    };
    c.api.command({
        archiveStart: 1700000000,
        channelId: 101,
        type: "archive",
    });
    c.bindCorePlaybackStateEvents(c.video, c._playSession);
    c.video.paused = false;
    c.video.readyState = 2;
    c.emit("playing");
    c.api.command({
        archiveStart: 1700000100,
        channelId: 101,
        type: "archive",
    });
    c.stbSetPosTime(120);
    assert.equal(c.api.snapshot().phase, "playing");
    assert.equal(
        c.api.snapshot().position,
        0,
        "Backend file offset is not logical archive elapsed time"
    );
    c.video.paused = true;
    c.emit("pause");
    assert.equal(c.api.snapshot().phase, "paused");
}

// Remote pause/resume also updates owned state when a native adapter replaces core methods.
{
    const c = fixture();
    include(c, "src/keyhandler/index.ts", ["toggleMainPlayback"]);
    c._ = (text) => text;
    c.stbIsPlaying = () => !c.video.paused;
    c.stbPause = () => {
        c.video.paused = true;
    };
    c.stbContinue = () => {
        c.video.paused = false;
    };
    c.api.command({ channelId: "native.mp4", type: "vod" });
    c.api.command({ type: "playing" });
    c.video.paused = false;
    c.toggleMainPlayback();
    assert.equal(c.api.snapshot().phase, "paused");
    c.toggleMainPlayback();
    assert.equal(c.api.snapshot().phase, "playing");
    c.api.command({
        archiveStart: 1700000000,
        channelId: 101,
        type: "archive",
    });
    c.api.command({ type: "pause" });
    c.api.command({ position: 45, type: "position" });
    c.video.paused = true;
    c.s10resum = true;
    let epoch;
    c.playArchive = (value) => {
        epoch = value;
    };
    c.toggleMainPlayback();
    assert.equal(epoch, 1700000035);
}

// Polling a backend value first cannot suppress its next durable position report.
{
    const c = fixture();
    let now = 1700000000000;
    c.Date = class extends Date {
        static now() {
            return now;
        }
    };
    include(c, "src/core/index.ts", [
        "clearCorePlaybackStateEvents",
        "bindCorePlaybackStateEvents",
    ]);
    c.openMedia({ stream_url: "progress.mp4", title: "Progress" });
    c.bindCorePlaybackStateEvents(c.video, c._playSession);
    c.video.paused = false;
    c.video.readyState = 2;
    c.emit("playing");
    now += 6000;
    c.video.currentTime = 37;
    assert.equal(c.api.snapshot().position, 37);
    c.emit("timeupdate");
    assert.equal(c.mediaPosition(), 37);
}

// Playlist identity is slot-scoped; private URLs/config fingerprints do not enter domain IDs.
for (const mutate of [
    (c) => {
        c.m3uArr.active = 1;
    },
    (c) => {
        c.m3uArr.M3Us[0] = { ...c.m3uArr.M3Us[0] };
    },
    (c) => {
        c.m3uArr.M3Us[0].www = "https://replacement.invalid/";
    },
]) {
    const c = fixture();
    c.p_pref = "m3u";
    c.api.command({ channelId: 101, type: "live" });
    assert.equal(
        c.api.snapshot().target.sourceId,
        c.__ottSourceIdentity.current(c)
    );
    let effects = 0;
    const callback = c.api.guard(() => effects++);
    mutate(c);
    callback();
    assert.equal(effects, 0);
}
for (const vod of [false, true]) {
    const c = fixture();
    c.p_pref = "m3u";
    if (vod) c.openMedia({ id: 41, stream_url: "movie.mp4", title: "Film" });
    else c.api.command({ channelId: 101, type: "live" });
    let effects = 0;
    const callback = c.api.guard(() => effects++);
    c.m3uArr.M3Us[0].medSourceId = "replacement";
    c.medSourceId = "replacement";
    callback();
    assert.equal(
        effects,
        vod ? 0 : 1,
        "Media-only source change affects VOD ownership but preserves TV"
    );
}
{
    const c = fixture();
    c.p_pref = "m3u";
    c.api.command({ channelId: 101, type: "live" });
    let effects = 0;
    const callback = c.api.guard(() => effects++);
    c.m3uArr.M3Us[0].medSourceId = "replacement";
    c.medSourceId = "replacement";
    callback();
    assert.equal(
        effects,
        1,
        "media portal changes preserve live channel ownership"
    );
}
{
    const c = fixture();
    c.p_pref = "m3u";
    let effects = 0;
    const callback = c.api.guard(() => effects++);
    c.m3uArr.active = "0";
    callback();
    callback();
    assert.equal(
        effects,
        1,
        "Equivalent slot representations retain one-shot ownership"
    );
}

// Backgrounding persists actual archive/VOD semantics and respects reset suspension.
for (const kind of ["archive", "vod"]) {
    const c = fixture();
    include(c, "src/index.ts", ["body_onUnload"]);
    include(c, "src/channels/index.ts", ["setCurrent"]);
    const item = { stream_url: "movie.mp4" };

    if (kind === "vod") c.openMedia(item);
    else
        c.api.command(
            kind === "archive"
                ? { archiveStart: 1700000000, channelId: 101, type: kind }
                : { channelId: item.stream_url, item, type: kind }
        );
    c.api.command({ type: "playing" });
    c.video.currentTime = 30;
    c.api.command({ position: 30, type: "position" });
    c.prevArr = [{ c: 0, ci: 202, i: 1 }];
    c.body_onUnload();
    assert.equal(c.prevArr.length, 1);
    assert.equal(
        c.prevArr[0].ci,
        202,
        "Backgrounding does not insert the current channel into previous history"
    );
    assert.equal(
        kind === "vod"
            ? c.mediaPosition()
            : JSON.parse(c.values.playbackJournal).bookmark.position,
        30,
        "Visibility forces the last position despite the periodic throttle"
    );
    assert.equal(c.api.snapshot().target.kind, kind);
    assert.equal(c.api.snapshot().position, 30);
    if (kind === "archive")
        assert.equal(JSON.parse(c.values.playbackJournal).bookmark.kind, kind);
    c.api.suspendPersistence();
    for (const key of Object.keys(c.values)) delete c.values[key];
    c.body_onUnload();
    c.api.command({ type: "stop" });
    assert.deepEqual(
        c.values,
        {},
        "Hidden/unload/stop cannot resurrect reset persistence"
    );
}
console.log(
    "PASS: owned playback state, media-event lifetime, M3U scope, loading position, and visibility persistence"
);
