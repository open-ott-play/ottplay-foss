const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parse } = require("acorn");
const code = fs.readFileSync(
    path.join(__dirname, "../devices/pc2/device.js"),
    "utf8"
);
parse(code, { ecmaVersion: 5 });
function emitter(target = {}) {
    const handlers = {};
    target.on = (name, cb) => (handlers[name] ||= []).push(cb);
    target.off = (name, cb) => {
        handlers[name] = (handlers[name] || []).filter((value) => value !== cb);
    };
    target.emit = (name) => [...(handlers[name] || [])].forEach((cb) => cb());
    target.handlers = handlers;
    return target;
}
function fixture() {
    let open;
    const engineMedia = {
        addEventListener(name, callback) {
            (this.listeners[name] ||= []).push(callback);
        },
        autoplay: true,
        listeners: {},
        style: {},
    };
    const ready = [],
        sources = [],
        players = [],
        events = [],
        preferences = [];
    const w = {
        _: (value) => value,
        __ottCoreTransport: {
            configure(value) {
                open = value.engine;
            },
        },
        $() {
            return { hide() {}, show() {}, text() {} };
        },
        addEventListener() {},
        applyChannelPreference(name, cb) {
            preferences.push({ cb, name });
        },
        setPipPosition() {},
        version: "fixture",
        videojs(media) {
            const audio = emitter([
                { enabled: true, label: "English", language: "en" },
                { enabled: false, label: "Deutsch", language: "de" },
            ]);
            const text = emitter([
                { kind: "metadata", mode: "hidden" },
                {
                    kind: "subtitles",
                    label: "English",
                    language: "en",
                    mode: "disabled",
                },
            ]);
            const player = emitter({
                addClass() {},
                audioTracks: () => audio,
                currentTime(value) {
                    if (value !== undefined) player.position = value;
                    return player.position || 0;
                },
                duration: () => 30,
                error() {},
                isPaused: true,
                loop() {},
                media,
                muted() {},
                pause() {
                    player.isPaused = true;
                },
                paused: () => player.isPaused,
                // Old media.play() returns void.
                play() {
                    player.plays++;
                    player.isPaused = false;
                },
                plays: 0,
                ready(cb) {
                    ready.push(cb);
                },
                readyState: () =>
                    player.readyLevel || (player.metadata ? 1 : 0),
                tech() {
                    return tech;
                },
                textTracks: () => text,
                updateSourceCaches_() {},
            });
            const tech = {
                clearTracks() {},
                disposeSourceHandler() {
                    player.releases = (player.releases || 0) + 1;
                },
                reset() {},
                setSource(source) {
                    sources.push(source);
                },
            };
            players.push(player);
            return player;
        },
    };
    w.window = w;
    vm.runInNewContext(code, w);
    return {
        engineMedia,
        events,
        open(url = "https://fixture.test/live", lane = "main", position) {
            return open(
                { lane, position, url },
                (event) => events.push(event),
                { style: {} }
            );
        },
        openRequest(request, event) {
            return open(request, event, engineMedia);
        },
        players,
        preferences,
        ready,
        sources,
        w,
    };
}
{
    const f = fixture(),
        timers = new Map();
    let serial = 0;
    const label = {
            removeAttribute() {},
            setAttribute() {},
            style: {},
            textContent: "",
        },
        spinner = { style: {} };
    f.w.document = {
        getElementById: (id) =>
            ({
                buffering: spinner,
                video_res: label,
            })[id] || null,
    };
    f.w.setTimeout = (fn, ms) => {
        timers.set(++serial, { fn, ms });
        return serial;
    };
    f.w.clearTimeout = (id) => timers.delete(id);
    const ts = require("typescript");
    vm.runInNewContext(
        ts.transpileModule(
            fs.readFileSync(
                path.join(__dirname, "../src/core/playback-feedback.ts"),
                "utf8"
            ),
            {
                compilerOptions: { target: ts.ScriptTarget.ES5 },
            }
        ).outputText,
        f.w
    );
    const lease = f.openRequest(
        { url: "https://fixture.test/film.mp4" },
        () => {}
    );
    f.ready[0]();
    f.players[0].readyLevel = 4;
    f.engineMedia.currentTime = 0;
    for (const callback of f.engineMedia.listeners.loadstart) callback();
    f.engineMedia.currentTime = 1;
    for (const callback of f.engineMedia.listeners.timeupdate) callback();
    assert.equal(timers.size, 0);
    lease.resume();
    lease.resume();
    assert.equal(
        timers.size,
        0,
        "Video.js repeated Play does not create feedback timeout"
    );
    assert.equal(label.textContent, "");
    lease.pause();
    lease.resume();
    assert.equal(
        [...timers.values()].filter((timer) => timer.ms >= 30000).length,
        1,
        "Video.js pause/resume starts one deadline"
    );
    lease.dispose();
    assert.equal(timers.size, 0);
}

{
    const f = fixture(),
        feedback = [];
    f.w.__ottPlaybackFeedback = {
        begin: (paused) => feedback.push(paused ? "paused" : "begin"),
        bind: () => feedback.push("bind"),
        fail: () => feedback.push("fail"),
        stop: () => feedback.push("stop"),
        visible: () => false,
    };
    const lease = f.open();
    assert.deepEqual(feedback, ["bind", "begin"]);
    lease.pause();
    assert.equal(
        feedback.at(-1),
        "stop",
        "pause before Video.js ready clears startup deadline"
    );
    f.ready[0]();
    assert.equal(f.players[0].plays, 0);
    lease.resume();
    assert.equal(feedback.at(-1), "begin");
    f.players[0].emit("error");
    assert.equal(feedback.at(-1), "fail");
    lease.dispose();
    assert.equal(feedback.at(-1), "stop");
    const beforePip = feedback.length;
    const pip = f.open("https://fixture.test/pip", "pip");
    pip.pause();
    pip.resume();
    pip.dispose();
    assert.equal(feedback.length, beforePip, "PiP must not own main feedback");
}

{
    const f = fixture();
    let owner = null;
    f.w.__ottCoreBackend = () => ({ current: () => owner });
    assert.equal(f.w.stbAudioTracksExists(), false);
    assert.equal(f.w.stbSubtitleExists(), 0);
    // A playback command invalidates the old engine before the next one opens.
    owner = { tracks: () => null };
    assert.equal(f.w.stbAudioTracksExists(), false);
    assert.equal(f.w.stbSubtitleExists(), 0);
    owner = f.open();
    f.ready[0]();
    assert.equal(f.w.stbAudioTracksExists(), true);
    assert.equal(f.w.stbSubtitleExists(), 1);
    owner.dispose();
}
{
    const f = fixture(),
        first = f.open();
    first.resume();
    assert.equal(
        f.players[0].plays,
        0,
        "Do not queue Video.js play before ready"
    );
    first.dispose();
    const second = f.open("https://fixture.test/current.m3u8");
    f.ready.forEach((cb) => cb());
    assert.equal(
        f.sources.length,
        1,
        "Disposed ready callbacks cannot attach the previous source"
    );
    assert.equal(f.sources[0].src, "https://fixture.test/current.m3u8");
    assert.equal(
        f.players.length,
        1,
        "Reuse the HTML tech instead of replacing the core DOM element"
    );
    assert.equal(f.players[0].plays, 1);
    second.dispose();
    second.dispose();
    assert.equal(f.players[0].releases, 2, "Exactly one release per request");
    f.players[0].emit("playing");
    assert.equal(
        f.events.length,
        0,
        "Released listeners cannot mutate playback state"
    );
}
{
    const f = fixture(),
        lease = f.open("https://fixture.test/archive.m3u8", "main", 8);
    lease.resume();
    lease.pause();
    assert.equal(
        f.players[0].plays,
        0,
        "Resume before ready only records intent"
    );
    f.ready[0]();
    assert.equal(
        f.players[0].plays,
        0,
        "Ready must respect a pause made before the source attached"
    );
    f.players[0].metadata = true;
    f.players[0].emit("loadedmetadata");
    assert.equal(
        lease.sample().position,
        0,
        "Metadata must not seek before the first MSE buffers can play"
    );
    f.players[0].readyLevel = 3;
    f.players[0].emit("canplay");
    assert.equal(lease.sample().position, 8);
    f.players[0].position = 9;
    f.players[0].emit("canplay");
    assert.equal(lease.sample().position, 9, "Apply startup resume only once");
    lease.resume();
    assert.equal(f.players[0].plays, 1);
    lease.seek(12);
    assert.equal(lease.sample().position, 12);
    lease.seek(-1);
    assert.equal(lease.sample().position, 12);
    assert.deepEqual(
        Array.from(lease.tracks("subtitle"), (track) => track.id),
        [2],
        "Exclude metadata without changing stored track indexes"
    );
    lease.selectTrack("subtitle", 2);
    assert.equal(f.players[0].textTracks()[1].mode, "showing");
    lease.selectTrack("subtitle", 0);
    assert.equal(f.players[0].textTracks()[1].mode, "disabled");
    assert.equal(f.players[0].textTracks()[0].mode, "hidden");
    lease.selectTrack("audio", 1);
    assert.equal(f.players[0].audioTracks()[1].enabled, true);
    lease.selectTrack("audio", 200);
    assert.equal(f.players[0].audioTracks()[1].enabled, true);
    lease.dispose();
    const next = f.open();
    f.ready[1]();
    f.preferences.forEach((item) => item.cb(0));
    assert.equal(
        f.players[0].audioTracks()[1].enabled,
        true,
        "Delayed settings restoration cannot act on the next source"
    );
    next.dispose();
}
{
    const f = fixture();
    const first = f.open("https://fixture.test/old.m3u8", "main", 8);
    const player = f.players[0];
    player.readyLevel = 4;
    first.seek(12);
    assert.equal(
        player.currentTime(),
        0,
        "Do not seek before source attachment"
    );
    f.ready[0]();
    player.readyLevel = 1;
    player.emit("loadedmetadata");
    first.seek(15);
    player.readyLevel = 2;
    player.emit("canplay");
    assert.equal(
        player.currentTime(),
        0,
        "Keep seek intent while decoding starts"
    );
    player.readyLevel = 3;
    player.emit("canplay");
    assert.equal(player.currentTime(), 15, "The latest pending user seek wins");
    player.readyLevel = 2;
    first.seek(18);
    assert.equal(
        player.currentTime(),
        18,
        "A user can seek out of a later buffering stall after initial readiness"
    );
    first.dispose();
    const blocked = f.open("https://fixture.test/blocked.m3u8", "main", 22);
    f.ready[1]();
    player.readyLevel = 1;
    player.emit("loadedmetadata");
    blocked.dispose();
    const next = f.open("https://fixture.test/new.m3u8", "main", 4);
    f.ready[2]();
    player.readyLevel = 3;
    player.emit("canplay");
    assert.equal(
        player.currentTime(),
        4,
        "Cancelled seeks cannot affect the next source"
    );
    next.dispose();
}
{
    const f = fixture();
    require("./helpers/private-runtime.cjs")(
        vm.createContext(f.w),
        "src/device/media-backend.ts"
    );
    const backend = f.w.__ottMediaBackend.create({
        clearInterval() {},
        context: () => ({ generation: 1, kind: "vod", position: 8 }),
        emit() {},
        open: f.openRequest,
        setInterval: () => 1,
    });
    backend.open({ url: "https://fixture.test/movie.m3u8" });
    f.ready[0]();
    const player = f.players[0];
    player.readyLevel = 2;
    player.position = 8;
    player.emit("playing");
    backend.current().pause();
    assert.equal(backend.restart().paused, true);
    assert.equal(f.w.forcePlay, false);
    f.ready[1]();
    player.emit("loadedmetadata");
    assert.equal(player.media.autoplay, false);
    assert.equal(
        player.plays,
        1,
        "a deferred Video.js ready callback cannot autoplay a paused restart"
    );
    assert.equal(backend.current().snapshot().phase, "paused");
    // Video.js/native controls may bypass the backend resume method.
    player.play();
    player.emit("playing");
    assert.equal(
        player.paused(),
        false,
        "the first native Play must remain playing"
    );
    assert.equal(backend.current().snapshot().phase, "playing");
    backend.dispose();
}
{
    const f = fixture(),
        main = f.open(),
        pip = f.open("https://fixture.test/pip.m3u8", "pip");
    f.ready.forEach((cb) => cb());
    pip.dispose();
    assert.equal(
        f.players[0].releases,
        undefined,
        "PiP teardown cannot release the main decoder"
    );
    main.dispose();
}
{
    const f = fixture(),
        lease = f.open();
    f.ready[0]();
    f.players[0].position = 120;
    f.players[0].metadata = true;
    f.players[0].emit("loadedmetadata");
    assert.equal(
        lease.sample().position,
        120,
        "Live startup must keep the selected live edge"
    );
    f.players[0].readyLevel = 3;
    lease.seek(0);
    assert.equal(
        lease.sample().position,
        0,
        "An explicit seek to zero must still work"
    );
    lease.dispose();
}
for (const [suffix, type] of [
    ["LIVE.M3U8?t=1", "application/x-mpegURL"],
    ["watch/123", "application/x-mpegURL"],
    ["film.mpd", "application/dash+xml"],
    ["film.mp4#t=2", "video/mp4"],
    ["film.webm", "video/webm"],
]) {
    const f = fixture(),
        lease = f.open("https://fixture.test/" + suffix);
    f.ready[0]();
    assert.equal(f.sources[0].type, type);
    lease.dispose();
}
{
    const f = fixture();
    const owner = { __ottExplicitTracks: {}, active: () => true };
    let current = owner;
    f.w.__ottCoreBackend = () => ({ current: () => current });
    const lease = f.open();
    f.ready[0]();
    const player = f.players[0];
    player.emit("loadedmetadata");
    const oldPreference = f.preferences.find((entry) => entry.name === "aSubs");
    // Local media may have no per-channel preference target. The explicit Off
    // choice still belongs to this public backend handle for its whole life.
    owner.__ottExplicitTracks.subtitle = 1;
    const tracks = player.textTracks();
    let mode = "showing",
        writes = 0;
    Object.defineProperty(tracks[1], "mode", {
        get: () => mode,
        set(value) {
            mode = value;
            writes++;
            tracks.emit("change");
        },
    });
    oldPreference.cb(2);
    assert.equal(mode, "disabled", "late preference cannot undo explicit Off");
    assert.equal(
        writes,
        1,
        "restoring Off is safe when writes synchronously emit change"
    );
    player.emit("loadedmetadata");
    tracks.emit("change");
    assert.equal(
        writes,
        1,
        "unchanged track mode is not rewritten on replay/change"
    );
    tracks.push({ kind: "captions", label: "Late captions", mode: "showing" });
    tracks.emit("addtrack");
    assert.equal(
        tracks[2].mode,
        "disabled",
        "late automatic captions stay Off"
    );
    assert.equal(tracks[0].mode, "hidden", "metadata tracks are untouched");
    const staleChange = tracks.handlers.change[0];
    current = { __ottExplicitTracks: { subtitle: 3 }, active: () => true };
    mode = "showing";
    staleChange();
    assert.equal(
        mode,
        "showing",
        "old lease does not borrow replacement choices"
    );
    lease.dispose();
    assert.equal(
        tracks.handlers.change.length,
        0,
        "dispose removes text change listener"
    );
    assert.equal(player.audioTracks().handlers.change.length, 0);
    staleChange();
    assert.equal(mode, "showing", "queued retired callbacks have no authority");
}
{
    const f = fixture();
    const owner = {
        __ottExplicitTracks: { audio: 1, subtitle: 3 },
        active: () => true,
    };
    f.w.__ottCoreBackend = () => ({ current: () => owner });
    const lease = f.open();
    f.ready[0]();
    const player = f.players[0];
    const audio = player.audioTracks();
    let enabled = [false, true],
        audioWrites = 0;
    audio.forEach((track, index) =>
        Object.defineProperty(track, "enabled", {
            get: () => enabled[index],
            set(value) {
                enabled[index] = value;
                audioWrites++;
                audio.emit("change");
            },
        })
    );
    player.emit("loadedmetadata");
    assert.equal(
        audio[0].enabled,
        true,
        "encoded explicit audio index zero is preserved"
    );
    assert.equal(audio[1].enabled, false);
    assert.equal(
        audioWrites,
        2,
        "only changed audio flags are written despite synchronous change events"
    );
    assert.equal(
        player.textTracks()[1].mode,
        "showing",
        "positive explicit subtitle is restored"
    );
    assert.equal(
        f.preferences.length,
        0,
        "explicit choices precede automatic preferences"
    );
    enabled = [false, true];
    audio.emit("change");
    assert.equal(audio[0].enabled, true);
    assert.equal(audio[1].enabled, false);
    assert.equal(audioWrites, 4);
    audio.emit("change");
    assert.equal(
        audioWrites,
        4,
        "stable audio selection does not loop or rewrite"
    );
    lease.dispose();
}
const fallback = { version: "fixture" };
fallback.window = fallback;
vm.runInNewContext(code, fallback);
assert.equal(
    fallback.keys.PLAY,
    80,
    "A missing library retains PC keyboard navigation"
);
for (const paused of [false, true]) {
    const f = fixture();
    const lease = f.openRequest({ url: "relative.mp4" }, () => {});
    f.ready.shift()();
    Object.assign(f.engineMedia, {
        currentTime: 7.5,
        duration: 30,
        paused,
        readyState: 3,
        seekable: { end: () => 30, length: 1, start: () => 0 },
    });
    f.players[0].position = 20; // The public player cache is not decoder time.
    assert.equal(lease.relativeSample().position, 7.5);
    assert.equal(lease.relativeSeek(12.5, paused), true);
    assert.equal(f.players[0].position, 12.5);
    assert.equal(f.w.forcePlay, !paused);
    assert.equal(f.engineMedia.paused, paused);
    assert.equal(lease.relativeSeek(31, paused), false);
    lease.dispose();
    assert.equal(lease.relativeSample(), null);
    assert.equal(lease.relativeSeek(1, paused), false);
}
console.log(
    "PASS pc2 engine: ES5, request cancellation, pause/seek, tracks, PiP, formats and missing-vendor fallback"
);
