"use strict";
const assert = require("node:assert/strict");
const { File } = require("node:buffer");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const acorn = require("acorn");

function load(path, imports = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    vm.runInNewContext(code, {
        exports,
        URL,
        TextDecoder,
        require(name) {
            assert.ok(name in imports, name);
            return imports[name];
        },
    });
    return exports;
}
const media = load("src/offline/dropped-video.ts");
const playlists = load("src/offline/dropped-playlist.ts", {
    "./dropped-video": media,
});
const plugin = load("src/plugins/local-drop.ts", {
    "../offline/dropped-video": media,
    "../offline/dropped-playlist": playlists,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(native = false) {
    const listeners = new Map(),
        timers = new Map(),
        requests = [],
        revoked = [],
        messages = [],
        played = [];
    let seq = 0,
        subscription,
        current,
        removed = 0,
        readyCalls = 0;
    const w = {
        _: (x) => x,
        __ottActiveProviderDriver: {},
        __ottCommandChannelLoad: {},
        __ottKiosk: { enabled: () => false, locked: () => false },
        __ottLocalMedia: {
            playDroppedVideo(catalog, admitted, release) {
                assert.equal(admitted(), true);
                if (w.refuse) throw new Error("rejected");
                current?.release();
                current = { admitted, catalog, release };
                played.push(current);
            },
        },
        __ottParental: { needs: () => false },
        __ottStandby: { blocked: () => false },
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(callback);
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        document: { createElement: () => ({ canPlayType: () => "probably" }) },
        File,
        removeEventListener(name, callback) {
            listeners.get(name)?.delete(callback);
        },
        setTimeout(callback) {
            const id = ++seq;
            timers.set(id, callback);
            return id;
        },
        showShift(text) {
            messages.push(text);
        },
        URL: {
            createObjectURL(file) {
                assert.ok(file instanceof File);
                return "blob:" + ++seq;
            },
            revokeObjectURL(url) {
                revoked.push(url);
            },
        },
    };
    if (native)
        w.__TAURI__ = {
            core: {
                invoke(command, args) {
                    if (command === "local_media_drop_ready") {
                        readyCalls++;
                        assert.deepEqual(Object.keys(args), []);
                        return Promise.resolve();
                    }
                    if (command === "local_media_release_drop") {
                        revoked.push(args.grant);
                        return Promise.resolve();
                    }
                    assert.equal(command, "local_media_take_drop");
                    assert.deepEqual(Object.keys(args), ["grant"]);
                    return new Promise((resolve, reject) =>
                        requests.push({ grant: args.grant, reject, resolve })
                    );
                },
            },
            event: {
                listen(name, callback) {
                    assert.equal(name, "local-media-drop");
                    subscription = callback;
                    return Promise.resolve(() => removed++);
                },
            },
        };
    const api = plugin.installLocalDrop(w);
    function event(type, files = [], types = ["Files"]) {
        const e = {
            dataTransfer: { files, types },
            preventDefault() {
                this.prevented = true;
            },
            prevented: false,
            stopPropagation() {
                this.stopped = true;
            },
            stopped: false,
        };
        for (const callback of listeners.get(type) || []) callback(e);
        return e;
    }
    return {
        api,
        event,
        grant: (value) => subscription({ payload: { grant: value } }),
        listeners,
        messages,
        played,
        readyCalls: () => readyCalls,
        removed: () => removed,
        requests,
        revoked,
        timers,
        w,
    };
}
function file(name = "video.mp4") {
    return new File(["video"], name, { type: "video/mp4" });
}
function catalog(id) {
    return {
        items: [{ id, sourceId: id, url: "http://127.0.0.1/media/" + id }],
        sources: [{ id }],
    };
}

test("file gesture plays the exact File via Local and prevents browser navigation", () => {
    const f = fixture();
    const over = f.event("dragover");
    assert.equal(over.prevented, true);
    assert.equal(over.dataTransfer.dropEffect, "copy");
    const dropped = f.event("drop", [file()]);
    assert.equal(dropped.prevented, true);
    assert.equal(dropped.stopped, true);
    assert.equal(f.played.length, 1);
    assert.equal(f.played[0].catalog.items[0].name, "video.mp4");
    assert.equal(f.revoked.length, 0);
    assert.equal(f.event("drop", [], ["text/plain"]).prevented, false);
});
test("M3U drop opens ordered HTTP streams as a temporary queue without object URLs", async () => {
    const f = fixture();
    const playlist = new File(
        [
            "#EXTM3U\n#EXTINF:-1,News\nhttps://example.test/live.m3u8?token=one\n#EXTINF:90,Film\nhttp://example.test/movie.mp4\n",
        ],
        "channels.m3u8"
    );
    f.event("drop", [playlist]);
    await flush();
    assert.equal(f.played.length, 1);
    assert.deepEqual(
        Array.from(f.played[0].catalog.items, (item) => item.name),
        ["News", "Film"]
    );
    assert.deepEqual(
        Array.from(f.played[0].catalog.items, (item) => item.url),
        [
            "https://example.test/live.m3u8?token=one",
            "http://example.test/movie.mp4",
        ]
    );
    assert.deepEqual(f.revoked, []);
    assert.equal(f.timers.size, 0);
});
test("late playlist reads cannot replace a newer video drop or a new provider generation", async () => {
    for (const invalidate of [
        (f) => f.event("drop", [file("newer.mp4")]),
        (f) => {
            f.w.__ottCommandChannelLoad = {};
        },
        (f) => {
            f.w.__ottKiosk = { enabled: () => true };
        },
        (f) => f.api.dispose(),
        (f) => {
            for (const callback of [...f.timers.values()]) callback();
        },
    ]) {
        const f = fixture();
        let complete;
        const playlist = new File(
            ["#EXTM3U\nhttps://example.test/late.mp4"],
            "late.m3u"
        );
        Object.defineProperty(playlist, "arrayBuffer", {
            value: () =>
                new Promise((resolve) => {
                    complete = resolve;
                }),
        });
        Object.defineProperty(playlist, "text", {
            value: () =>
                new Promise((resolve) => {
                    complete = (value) =>
                        resolve(new TextDecoder().decode(value));
                }),
        });
        f.event("drop", [playlist]);
        await flush();
        assert.equal(typeof complete, "function");
        invalidate(f);
        complete(
            new TextEncoder().encode("#EXTM3U\nhttps://example.test/late.mp4")
                .buffer
        );
        await flush();
        assert.equal(
            f.played.some((p) =>
                p.catalog.items.some(
                    (item) => item.url === "https://example.test/late.mp4"
                )
            ),
            false
        );
        assert.equal(f.timers.size, 0);
    }
});
test("invalid playlist does not stop the current queue and errors never expose private data", async () => {
    const f = fixture();
    f.event("drop", [file("old.mp4")]);
    f.event("drop", [
        new File(["#EXTM3U\nfile:///private/passwords.mp4"], "invalid.m3u"),
    ]);
    await flush();
    assert.equal(f.played.length, 1);
    assert.equal(f.played[0].admitted(), true);
    assert.deepEqual(f.revoked, []);
    assert.ok(f.messages.length);
    assert.equal(f.messages.join(" ").includes("/private/"), false);
});
test("ordered batch drops replace the prior queue while invalid batches preserve it", () => {
    const f = fixture();
    f.event("drop", [file("z-first.mp4"), file("a-second.mp4")]);
    const first = f.played[0];
    const firstURLs = Array.from(first.catalog.items, (item) => item.url);
    assert.deepEqual(
        Array.from(first.catalog.items, (item) => item.name),
        ["z-first.mp4", "a-second.mp4"]
    );
    assert.equal(first.catalog.sources.length, 1);
    f.event("drop", [file(), file("no.txt")]);
    f.event(
        "drop",
        Array.from({ length: 129 }, () => file())
    );
    assert.equal(f.played.length, 1);
    assert.equal(first.admitted(), true);
    assert.equal(f.revoked.length, 0);
    f.event("drop", [file("next.mp4"), file("next.mp4")]);
    assert.equal(f.played.length, 2);
    const next = f.played[1];
    assert.equal(next.catalog.items.length, 2);
    assert.notEqual(next.catalog.items[0].id, next.catalog.items[1].id);
    assert.notEqual(first.catalog.sources[0].id, next.catalog.sources[0].id);
    assert.equal(first.admitted(), false);
    assert.equal(next.admitted(), true);
    assert.deepEqual(f.revoked, firstURLs);
    first.release();
    assert.deepEqual(f.revoked, firstURLs);
    f.api.dispose();
    assert.deepEqual(f.revoked, [
        ...firstURLs,
        ...Array.from(next.catalog.items, (item) => item.url),
    ]);
});
test("kiosk, standby and parental gates stop drop before reading or allocation", () => {
    for (const [key, value] of [
        ["__ottKiosk", { enabled: () => true }],
        ["__ottStandby", { blocked: () => true }],
        ["__ottParental", { needs: () => true }],
    ]) {
        const f = fixture();
        f.w[key] = value;
        f.w.URL.createObjectURL = () => assert.fail("blocked allocation");
        assert.equal(f.event("dragover").dataTransfer.dropEffect, "none");
        assert.equal(f.event("drop", [file()]).prevented, true);
        assert.equal(f.played.length, 0);
    }
});
test("rejected Local handoff releases the whole new batch and retains previous admission", () => {
    const f = fixture();
    f.event("drop", [file(), file()]);
    f.w.refuse = true;
    f.event("drop", [file("next.mp4"), file("last.mp4")]);
    assert.equal(f.played.length, 1);
    assert.equal(f.played[0].admitted(), true);
    assert.deepEqual(f.revoked, ["blob:3", "blob:4"]);
    assert.equal(f.messages.at(-1), "Local source unavailable");
});
test("late URL allocation failure releases partial batch without replacing current playback", () => {
    const f = fixture();
    f.event("drop", [file("current.mp4")]);
    const createURL = f.w.URL.createObjectURL;
    let attempts = 0;
    f.w.URL.createObjectURL = (value) => {
        if (++attempts === 3) throw new Error("private-path");
        return createURL(value);
    };
    f.event("drop", [file(), file(), file()]);
    assert.equal(attempts, 3);
    assert.equal(f.played.length, 1);
    assert.equal(f.played[0].admitted(), true);
    assert.deepEqual(f.revoked, ["blob:2", "blob:3"]);
    assert.equal(f.messages.at(-1), "Unsupported source");
});
test("drop errors use audited translated keys for failure, unsupported type and oversized batches", () => {
    const context = {};
    vm.runInNewContext(fs.readFileSync("locales/russian.js", "utf8"), context);
    const f = fixture();
    const translated = [];
    f.w._ = (key) => {
        assert.ok(
            Object.hasOwn(context.keyStrings, key),
            "Canonical translated key: " + key
        );
        translated.push(key);
        return context.keyStrings[key];
    };
    f.event(
        "drop",
        Array.from({ length: 129 }, () => file())
    );
    f.event("drop", [file("unsupported.txt")]);
    f.w.refuse = true;
    f.event("drop", [file()]);
    assert.deepEqual(translated, [
        "Unsupported source",
        "Unsupported source",
        "Local source unavailable",
    ]);
    assert.deepEqual(
        f.messages,
        translated.map((key) => context.keyStrings[key])
    );
    assert.ok(f.messages.every((text, i) => text !== translated[i]));
});
test("playlist failures translate every safe diagnostic and redact unknown native errors", async () => {
    const context = {};
    vm.runInNewContext(fs.readFileSync("locales/russian.js", "utf8"), context);
    const cases = [
        [
            { droppedPlaylistCode: "playlist_hls_local_unsupported" },
            "Local HLS manifests are not supported; use an HTTP(S) manifest URL",
        ],
        [
            { droppedPlaylistCode: "playlist_local_unavailable" },
            "Playlist local files must be dropped together with the playlist",
        ],
        [
            { droppedPlaylistCode: "playlist_unsupported" },
            "Playlist contains unsupported sources",
        ],
        [
            { droppedPlaylistCode: "playlist_invalid" },
            "Playlist is empty or invalid",
        ],
        [
            { droppedPlaylistCode: "playlist_link_blocked" },
            "Playlist link is not public",
        ],
        [
            { droppedPlaylistCode: "playlist_link_unavailable" },
            "Playlist link could not be loaded",
        ],
        [
            { droppedPlaylistCode: "playlist_limit" },
            "Playlist is too large",
        ],
        ["Dropped playlist must be UTF-8", "Playlist must use UTF-8"],
        [
            "Local HLS manifests are not supported; add the HTTP(S) manifest URL as a playlist entry",
            "Local HLS manifests are not supported; use an HTTP(S) manifest URL",
        ],
        [
            "Dropped playlist exceeds the 8 MiB file or 16 MiB batch limit",
            "Playlist is too large",
        ],
        [
            "Dropped playlists exceed 20000 entries or 128 local files",
            "Playlist is too large",
        ],
        [
            "Dropped playlist contains no playable entries",
            "Playlist is empty or invalid",
        ],
        [
            "Dropped playlist contains an invalid entry",
            "Playlist is empty or invalid",
        ],
        [
            new Error("https://private.test/token /private/secret.m3u"),
            "Unsupported source",
        ],
        [
            { droppedPlaylistCode: "toString", message: "/private/secret.m3u" },
            "Unsupported source",
        ],
    ];
    for (const [error, expected] of cases) {
        const f = fixture(true);
        const keys = [];
        f.w._ = (key) => {
            assert.ok(Object.hasOwn(context.keyStrings, key));
            keys.push(key);
            return context.keyStrings[key];
        };
        f.grant("grant-errors-1234567890");
        f.requests[0].reject(error);
        await flush();
        assert.deepEqual(keys, [expected]);
        assert.deepEqual(f.messages, [context.keyStrings[expected]]);
        assert.notEqual(f.messages[0], expected);
        assert.equal(f.messages[0].includes("/private/"), false);
        assert.equal(f.messages[0].includes("private.test"), false);
        assert.equal(f.played.length, 0);
    }
    const fallback = fixture(true);
    fallback.w._ = undefined;
    fallback.grant("grant-errors-1234567890");
    fallback.requests[0].reject("Dropped playlist must be UTF-8");
    await flush();
    assert.deepEqual(fallback.messages, ["Playlist must use UTF-8"]);
});
test("a playlist link that stayed one stream shows its reason once", async () => {
    for (const [notice, expected] of [
        ["playlist_link_blocked", "Playlist link is not public"],
        ["playlist_link_unavailable", "Playlist link could not be loaded"],
    ]) {
        const f = fixture(true);
        f.grant("grant-notice-1234567890");
        f.requests[0].resolve({ ...catalog("notice"), notice });
        await flush();
        assert.equal(f.played.length, 1);
        assert.deepEqual(f.messages, [expected]);
    }
    const plain = fixture(true);
    plain.grant("grant-notice-1234567890");
    plain.requests[0].resolve(catalog("plain"));
    await flush();
    assert.equal(plain.played.length, 1);
    assert.deepEqual(plain.messages, [], "a plain stream drop stays silent");
});
test("native consumes only opaque OS grants and ignores duplicate DOM file delivery", async () => {
    const f = fixture(true);
    f.event("drop", [file()]);
    assert.equal(f.played.length, 0);
    f.grant("grant-1234567890123456");
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve(catalog("one"));
    await flush();
    assert.equal(f.played.length, 1);
    f.api.dispose();
    await flush();
    assert.deepEqual(f.revoked, ["grant-1234567890123456"]);
    assert.equal(f.removed(), 1);
});
test("late native A cannot replace B or revoke its grant", async () => {
    const f = fixture(true);
    f.grant("grant-A-1234567890123456");
    f.grant("grant-B-1234567890123456");
    f.requests[1].resolve(catalog("B"));
    await flush();
    f.requests[0].resolve(catalog("A"));
    await flush();
    assert.equal(f.played.length, 1);
    assert.equal(f.played[0].catalog.items[0].id, "B");
    assert.deepEqual(f.revoked, ["grant-A-1234567890123456"]);
    assert.equal(f.timers.size, 0);
});
test("provider change while native take is pending releases grant without playback", async () => {
    const f = fixture(true);
    f.grant("grant-1234567890123456");
    f.w.__ottCommandChannelLoad = {};
    f.requests[0].resolve(catalog("stale"));
    await flush();
    assert.equal(f.played.length, 0);
    assert.equal(f.revoked.length, 1);
    assert.equal(f.timers.size, 0);
});
test("native cold-start drop survives the initial driver mounting in its captured generation", async () => {
    const f = fixture(true);
    f.w.__ottActiveProviderDriver = null;
    f.w.__ottDesktopOpenReady = true;
    f.api.ready();
    await flush();
    assert.equal(f.readyCalls(), 1);
    const generation = f.w.__ottCommandChannelLoad;
    f.grant("grant-cold-1234567890123456");
    // loadProv already committed this generation; its optional provider script
    // now finishes mounting before the native file classification returns.
    f.w.__ottActiveProviderDriver = { id: "m3u" };
    assert.equal(f.w.__ottCommandChannelLoad, generation);
    f.requests[0].resolve(catalog("cold"));
    await flush();
    assert.equal(f.played.length, 1);
    assert.equal(f.played[0].catalog.items[0].id, "cold");
    assert.deepEqual(f.revoked, []);
    assert.equal(f.timers.size, 0);
});
test("native queued file can open after startup with no configured provider", async () => {
    const f = fixture(true);
    f.w.__ottActiveProviderDriver = null;
    f.w.__ottDesktopOpenReady = true;
    f.api.ready();
    await flush();
    assert.equal(
        f.readyCalls(),
        1,
        "readiness must not require a configured provider"
    );
    f.grant("grant-empty-1234567890123456");
    f.requests[0].resolve(catalog("empty"));
    await flush();
    assert.equal(f.played.length, 1);
    assert.deepEqual(f.revoked, []);
    assert.equal(f.timers.size, 0);
});
test("policy changes during a native take still reject its same-generation result", async () => {
    for (const [key, value] of [
        ["__ottKiosk", { enabled: () => true }],
        ["__ottKiosk", { enabled: () => false, locked: () => true }],
        ["__ottStandby", { blocked: () => true }],
        ["__ottParental", { needs: () => true }],
    ]) {
        const f = fixture(true);
        f.w.__ottActiveProviderDriver = null;
        f.grant("grant-policy-1234567890123456");
        f.w.__ottActiveProviderDriver = { id: "m3u" };
        f.w[key] = value;
        f.requests[0].resolve(catalog("blocked"));
        await flush();
        assert.equal(f.played.length, 0);
        assert.deepEqual(f.revoked, ["grant-policy-1234567890123456"]);
        assert.equal(f.timers.size, 0);
    }
});
test("native take timeout is bounded and late completion remains cancelled", async () => {
    const f = fixture(true);
    f.grant("grant-1234567890123456");
    for (const callback of [...f.timers.values()]) callback();
    f.requests[0].resolve(catalog("late"));
    await flush();
    assert.equal(f.played.length, 0);
    assert.deepEqual(f.revoked, ["grant-1234567890123456"]);
});
test("installation is idempotent and teardown cancels delayed native subscription", async () => {
    const f = fixture(true);
    assert.equal(plugin.installLocalDrop(f.w), f.api);
    assert.equal(f.listeners.get("drop").size, 1);
    f.api.dispose();
    f.api.dispose();
    await flush();
    assert.equal(f.listeners.get("drop").size, 0);
    assert.equal(f.removed(), 1);
});
test("native queued files wait for both the startup generation and event subscription", async () => {
    const f = fixture(true);
    f.api.ready();
    await flush();
    assert.equal(f.readyCalls(), 0);
    f.w.__ottDesktopOpenReady = true;
    f.api.ready();
    f.api.ready();
    await flush();
    assert.equal(f.readyCalls(), 1);
    const early = fixture(true);
    early.w.__ottDesktopOpenReady = true;
    early.api.ready();
    assert.equal(early.readyCalls(), 0);
    await flush();
    assert.equal(early.readyCalls(), 1);
    const retired = fixture(true);
    retired.w.__ottDesktopOpenReady = true;
    retired.api.dispose();
    await flush();
    assert.equal(retired.readyCalls(), 0);
});
test("returning from browser back-forward cache permits a new drop without reviving the old file", () => {
    const f = fixture();
    f.event("drop", [file()]);
    for (const callback of [...f.listeners.get("pagehide")])
        callback({ persisted: true });
    assert.equal(f.listeners.get("drop").size, 0);
    assert.equal(f.revoked.length, 1);
    for (const callback of [...f.listeners.get("pageshow")])
        callback({ persisted: true });
    assert.equal(f.listeners.get("drop").size, 1);
    assert.equal(f.listeners.get("pageshow").size, 0);
    f.event("drop", [file("again.mp4")]);
    assert.equal(f.played.length, 2);
    assert.equal(f.played[0].admitted(), false);
    assert.equal(f.played[1].admitted(), true);
});
