const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parse } = require("acorn");
const code = fs.readFileSync(path.join(__dirname, "../stb/pc2/stb.js"), "utf8");
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
    const ready = [],
        sources = [],
        players = [],
        events = [],
        preferences = [];
    const w = {
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
                readyState: () => (player.metadata ? 1 : 0),
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
        events,
        open(url = "https://fixture.test/live", lane = "main", position) {
            return open(
                { lane, position, url },
                (event) => events.push(event),
                { style: {} }
            );
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
    assert.equal(lease.sample().position, 8);
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
const fallback = { version: "fixture" };
fallback.window = fallback;
vm.runInNewContext(code, fallback);
assert.equal(
    fallback.keys.PLAY,
    80,
    "A missing library retains PC keyboard navigation"
);
console.log(
    "PASS pc2 engine: ES5, request cancellation, pause/seek, tracks, PiP, formats and missing-vendor fallback"
);
