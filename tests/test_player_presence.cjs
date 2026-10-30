"use strict";
const assert = require("node:assert/strict"),
    test = require("node:test");
const { load, plain } = require("./helpers/player-presence.cjs");
const { readPlayerState } = load("src/commands/player-state.ts");
const info = {
    platform: "tauri",
    runtime: "page-example",
    standby: false,
    version: "1.1.62",
};
function fixture(kind = "live", provider = "m3u", reader = readPlayerState) {
    let state = {
        duration: 300,
        generation: 7,
        phase: "playing",
        position: 12.5,
        target: {
            channelId: kind === "vod" ? "movie42" : "7",
            kind,
            sourceId: provider + ":fixture",
        },
    };
    const channel = {
        channel_name: "Confirmed channel",
        password: "secret",
        stream_url: "https://private.invalid/?token=secret",
    };
    const media = {
        payload: {
            path: "/Users/private/movie.mp4",
            request: { url: "https://private.invalid/?token=secret" },
            title: "Confirmed movie",
        },
        ref: { itemId: "movie42", sourceId: provider + ":fixture" },
    };
    const handle = {
        active: () => true,
        id: 5,
        snapshot: () => ({ duration: 300, phase: "playing", position: 12.5 }),
    };
    const w = {
        __ottActiveProviderDriver: { id: provider },
        __ottClassicPlayback: {
            context: () => ({ isCurrentBackend: () => true }),
            snapshot: () => state,
        },
        __ottCoreBackendPeek: () => ({ current: () => handle }),
        __ottMedia: { current: () => media },
        __ottSourceIdentity: {
            current: () => provider + ":fixture",
            media: () => provider + ":fixture",
        },
        _playSession: 11,
        channelIndex: 2,
        channels: { 7: channel, 9: { channel_name: "Only highlighted" } },
        cList: [3, 7, 9],
        stbGetVolume: () => 50,
    };
    return {
        change: (changes) => {
            state = { ...state, ...changes };
        },
        channel,
        handle,
        media,
        read: (extra = {}) => plain(reader(w, { ...info, ...extra })),
        state: () => state,
        w,
    };
}
function noIdentity(value) {
    for (const name of ["title", "media_id", "channel_number"])
        assert.equal(value.playback[name], null, name);
}
test("confirmed current live metadata excludes highlighted rows and private payload fields", () => {
    const result = fixture().read();
    assert.deepEqual(Object.keys(result).sort(), [
        "playback",
        "player",
        "runtime",
    ]);
    assert.deepEqual(Object.keys(result.playback).sort(), [
        "channel_number",
        "duration",
        "kind",
        "media_id",
        "position",
        "provider",
        "state",
        "title",
        "volume",
    ]);
    assert.equal(result.playback.title, "Confirmed channel");
    assert.equal(result.playback.channel_number, 2);
    assert.equal(result.playback.media_id, "7");
    assert.equal(result.playback.state, "playing");
    assert.equal(result.playback.position, 12.5);
    assert.equal(result.playback.volume, 50);
    assert.ok(
        !/private|secret|token|highlighted/i.test(JSON.stringify(result))
    );
});
test("confirmed VOD uses the owned media reference, not channel selection", () => {
    const result = fixture("vod", "plex").read();
    assert.equal(result.playback.title, "Confirmed movie");
    assert.equal(result.playback.media_id, "movie42");
    assert.equal(result.playback.channel_number, null);
    assert.equal(result.playback.provider, "plex");
    assert.ok(!/private|secret|token/i.test(JSON.stringify(result)));
});
test("legacy M3U playback confirms the actual channel without modern backend hooks", () => {
    const f = fixture();
    delete f.w.__ottCoreBackendPeek;
    delete f.w.__ottClassicPlayback.context;
    f.change({ phase: "loading" });
    noIdentity(f.read({ platform: "webos" }));
    f.change({ phase: "playing" });
    const result = f.read({ platform: "webos" });
    assert.equal(result.player.platform, "webos");
    assert.equal(result.playback.title, "Confirmed channel");
    assert.equal(result.playback.media_id, "7");
    assert.equal(result.playback.provider, "m3u");
    assert.equal(result.playback.state, "playing");
});
test("paused and buffering keep the same confirmed owner; pending replacement does not", () => {
    const f = fixture("vod", "plex");
    f.change({ phase: "paused" });
    noIdentity(f.read());
    f.change({ phase: "playing" });
    assert.equal(f.read().playback.title, "Confirmed movie");
    f.change({ phase: "paused" });
    assert.equal(f.read().playback.title, "Confirmed movie");
    f.change({ phase: "loading" });
    assert.equal(f.read().playback.state, "buffering");
    assert.equal(f.read().playback.title, "Confirmed movie");
    f.change({
        generation: 8,
        target: { ...f.state().target, channelId: "pending99" },
    });
    noIdentity(f.read());
});
test("newly loading targets are not published as playing media", () => {
    const f = fixture("vod", "plex");
    f.change({ phase: "loading" });
    const result = f.read();
    assert.equal(result.playback.state, "loading");
    noIdentity(result);
    assert.equal(result.playback.position, null);
    assert.equal(result.playback.duration, null);
});
test("standby and inactive transitions clear previously confirmed identity", () => {
    for (const phase of ["idle", "stopped", "ended"]) {
        const f = fixture();
        f.read();
        f.change({ phase });
        const result = f.read();
        noIdentity(result);
        assert.equal(result.playback.kind, "none");
        assert.equal(result.playback.position, null);
    }
    const f = fixture();
    f.read();
    const result = f.read({ standby: true });
    noIdentity(result);
    assert.equal(result.player.standby, true);
    assert.equal(result.playback.state, "standby");
    f.change({ phase: "paused" });
    noIdentity(f.read());
});
test("standby state is reported only when the player confirms standby", () => {
    const f = fixture();
    f.change({ phase: "standby" });
    const awake = f.read({ standby: false });
    assert.equal(awake.player.standby, false);
    assert.equal(awake.playback.state, "unknown");
    noIdentity(awake);
    const asleep = f.read({ standby: true });
    assert.equal(asleep.player.standby, true);
    assert.equal(asleep.playback.state, "standby");
    noIdentity(asleep);
});
test("a changed source or current media owner cannot reuse confirmed metadata", () => {
    const f = fixture("vod", "plex");
    f.read();
    f.change({ phase: "paused" });
    f.w.__ottMedia.current = () => ({ ...f.media });
    noIdentity(f.read());
    const live = fixture();
    live.read();
    live.w.__ottSourceIdentity.current = () => "other:source";
    noIdentity(live.read());
});
test("Local titles expose only the basename for channel and VOD representations", () => {
    for (const kind of ["live", "vod"])
        for (const name of [
            "Opening.mp4",
            "Family/Opening.mp4",
            "Family\\Opening.mp4",
        ]) {
            const f = fixture(kind, "offline");
            f.channel.channel_name = name;
            f.media.payload.title = name;
            const result = f.read();
            assert.equal(
                result.playback.title,
                "Opening.mp4",
                kind + " basename"
            );
            assert.ok(
                !/Private|private|Volumes|Family/.test(JSON.stringify(result))
            );
        }
});
test("URL, credential, control and oversized metadata cannot leak as display titles", () => {
    for (const title of [
        "https://private.invalid/?token=secret",
        "file:///Users/private/movie.mp4",
        "/Users/private/movie.mp4",
        "C:\\Private\\movie.mp4",
        "Authorization: Bearer secret",
        "token=secret",
        "password=secret",
        "movie\u0000secret",
        "\tOrdinary title",
        "Ordinary title\n",
        "🎬".repeat(65),
        "\ud800",
    ]) {
        const f = fixture("vod", "plex");
        f.media.payload.title = title;
        assert.equal(
            f.read().playback.title,
            null,
            "sensitive or invalid title must be omitted"
        );
    }
});
test("Unicode category C cannot disguise private URL and path labels", () => {
    const prefixes = [
        "\u200b", // zero-width format
        "\u202e", // bidi format
        "\udb40\udc01", // supplementary format U+E0001
        "\ud80d\udc3f", // supplementary format U+1343F
        "\ue000", // private use
        "\udb80\udc00", // supplementary private use U+F0000
        "\u0378", // unassigned
        "\udbff\udfff", // noncharacter U+10FFFF
    ];
    const privateLabels = [
        "https://private.invalid/?token=secret",
        "/Users/private/movie.mp4",
        "\\private\\movie.mp4",
        "~/private/movie.mp4",
        "C:\\private\\movie.mp4",
    ];
    for (const prefix of prefixes)
        for (const label of privateLabels) {
            // The controller strips every category C character before classification.
            const title = prefix + " " + label;
            assert.equal(title.replace(/\p{C}/gu, "").trim(), label);
            for (const kind of ["live", "vod"]) {
                const f = fixture(kind, kind === "live" ? "m3u" : "plex");
                f.channel.channel_name = title;
                f.media.payload.title = title;
                assert.equal(f.read().playback.title, null);
            }
            const platform = fixture().read({ platform: title }).player
                .platform;
            const version = fixture().read({ version: title }).player.version;
            assert.equal(platform, "unknown");
            assert.equal(version, "unknown");
        }
    for (const marker of prefixes)
        for (const title of [
            "https:" + marker + "//private.invalid/stream",
            "C" + marker + ":\\private\\movie.mp4",
            "to" + marker + "ken=secret",
        ]) {
            const f = fixture("vod", "plex");
            f.media.payload.title = title;
            assert.equal(f.read().playback.title, null);
        }
});
test("ordinary Unicode display titles and internal punctuation remain usable", () => {
    for (const title of [
        "AC/DC",
        "Новости",
        "日本語の映画",
        "ニュース/ライブ",
        "🎬 Premiere",
        "👩‍💻 Workshop",
        "\u200bBreaking news",
    ]) {
        const f = fixture("vod", "plex");
        f.media.payload.title = title;
        assert.equal(f.read().playback.title, title);
    }
});
test("ES5 engines without Unicode property escapes use the private-label fallback", () => {
    let featureProbes = 0;
    function LegacyRegExp(pattern, flags) {
        if (String(pattern).includes("\\p{")) {
            featureProbes++;
            throw new SyntaxError("Unicode property escapes unavailable");
        }
        return new RegExp(pattern, flags);
    }
    const { readPlayerState: legacyRead } = load(
        "src/commands/player-state.ts",
        { RegExp: LegacyRegExp }
    );
    for (const title of [
        "\ue000/Users/private/movie.mp4",
        "https:\udb80\udc00//private.invalid/stream",
        "C\u0378:\\private\\movie.mp4",
        "to\u200bken=secret",
    ]) {
        const f = fixture("vod", "plex", legacyRead);
        f.media.payload.title = title;
        assert.equal(f.read().playback.title, null);
    }
    const ordinary = fixture("vod", "plex", legacyRead);
    ordinary.media.payload.title = "Новости 🎬";
    assert.equal(ordinary.read().playback.title, "Новости 🎬");
    assert.equal(featureProbes, 1, "feature detection is cached");
});
test("invalid numeric and identifier fields become explicit nulls", () => {
    for (const value of [
        NaN,
        Infinity,
        -1,
        Number.MAX_SAFE_INTEGER + 1,
        true,
        "12",
    ]) {
        const f = fixture();
        f.change({ duration: value, position: value });
        const result = f.read();
        assert.equal(result.playback.position, null);
        assert.equal(result.playback.duration, null);
    }
    const f = fixture("vod", "plex");
    f.media.ref.itemId = "private:locator";
    f.change({ target: { ...f.state().target, channelId: "private:locator" } });
    assert.equal(f.read().playback.media_id, null);
    for (const volume of [-1, 101, Infinity, "50"]) {
        f.w.stbGetVolume = () => volume;
        assert.equal(f.read().playback.volume, null);
    }
});
test("read failures do not revive another host's confirmed proof", () => {
    const first = fixture();
    first.read();
    const second = fixture();
    second.change({ phase: "paused" });
    noIdentity(second.read());
    first.w.__ottClassicPlayback.snapshot = () => {
        throw new Error("private payload");
    };
    const result = first.read();
    noIdentity(result);
    assert.equal(result.playback.state, "unknown");
});
test("loss of the current main backend or playback context retires confirmed metadata", () => {
    for (const loseOwner of [
        (f) => {
            f.handle.active = () => false;
        },
        (f) => {
            f.w.__ottCoreBackendPeek = () => ({ current: () => null });
        },
        (f) => {
            f.w.__ottClassicPlayback.context = () => ({
                isCurrentBackend: () => false,
            });
        },
        (f) => {
            f.w.__ottCoreBackendPeek = () => {
                throw new Error("unavailable");
            };
        },
    ]) {
        const f = fixture();
        assert.equal(f.read().playback.title, "Confirmed channel");
        loseOwner(f);
        noIdentity(f.read());
    }
});
test("replacing the main backend while paused needs new playing confirmation", () => {
    const f = fixture();
    f.read();
    f.change({ phase: "paused" });
    f.w.__ottCoreBackendPeek = () => ({
        current: () => ({ ...f.handle, id: 6 }),
    });
    noIdentity(f.read());
});
test("absolute Local paths are omitted rather than converted to display text", () => {
    for (const kind of ["live", "vod"])
        for (const title of [
            "/Volumes/private/Opening.mp4",
            "C:\\Private\\Opening.mp4",
            "file:///private/Opening.mp4",
        ]) {
            const f = fixture(kind, "offline");
            f.channel.channel_name = title;
            f.media.payload.title = title;
            assert.equal(f.read().playback.title, null);
        }
});
test("metadata getter cannot publish a source or generation replaced during projection", () => {
    for (const change of [
        (f) => f.change({ generation: f.state().generation + 1 }),
        (f) =>
            f.change({
                target: { ...f.state().target, sourceId: "other:source" },
            }),
    ]) {
        const f = fixture("vod", "plex");
        f.read();
        Object.defineProperty(f.media.payload, "title", {
            get() {
                change(f);
                return "Stale title";
            },
        });
        noIdentity(f.read());
    }
});
