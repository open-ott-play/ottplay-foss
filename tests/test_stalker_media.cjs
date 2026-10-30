"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fixture = require("./helpers/stalker-driver-fixture.cjs");
const { integrationFixture } = require("./helpers/provider-driver-fixture.cjs");
const { declarations } = require("./helpers/playlist-fixture.cjs");
const privateRuntime = require("./helpers/private-runtime.cjs");
const vm = require("node:vm");
const ts = require("typescript");

function setup(live = {}) {
    const f = fixture({
        config: { mac: "02:00:00:00:00:01", portal: "https://portal.test/c/" },
    });
    const timers = new Map();
    let sequence = 0;
    f.host.setTimeout = (callback, delay) => {
        timers.set(++sequence, { callback, delay });
        return sequence;
    };
    f.host.clearTimeout = (id) => timers.delete(id);
    f.ports.sourceIdentity = () => "stalker@fixture";
    f.events = [];
    f.driver.load((catalog, error) => f.events.push({ catalog, error }));
    f.request = () => JSON.parse(f.requests.at(-1).settings.data);
    f.params = () => new URL(f.request().url).searchParams;
    f.respond = (js) => f.requests.at(-1).done({ js });
    f.page = (rows, total = rows.length) =>
        f.respond({ data: rows, total_items: total });
    f.tick = () => {
        const entry = [...timers].find(([, value]) => value.delay === 0);
        if (!entry) return false;
        timers.delete(entry[0]);
        entry[1].callback();
        return true;
    };
    f.expire = () => {
        const entry = [...timers].find(([, value]) => value.delay > 0);
        assert(entry, "owned deadline exists");
        timers.delete(entry[0]);
        entry[1].callback();
    };
    f.respond({ token: "fixture-token" });
    f.respond({ id: "1", status: "0" });
    f.respond([{ id: "1", title: "Live" }]);
    f.page([
        {
            cmd: "https://media.test/live.m3u8",
            id: "42",
            name: "Live 42",
            use_http_tmp_link: 0,
            ...live,
        },
    ]);
    f.mediaRows = () =>
        f.events
            .flatMap(
                (event) =>
                    event.catalog?.ids.map(
                        (id) => event.catalog.channels[id]
                    ) || []
            )
            .filter((row) => row.__ottMediaItem);
    return f;
}
const movie = (id = "42", name = "Movie") => ({
    cmd: "ffmpeg https://media.test/movie.mp4",
    description: "<b>provider text</b>",
    id,
    name,
    screenshot_uri: "/poster.jpg",
});

test("live publishes before media; each completed category appends playable rows", () => {
    const f = setup();
    assert.equal(f.events.length, 1);
    assert.deepEqual(Array.from(f.events[0].catalog.ids), [42]);
    assert.equal(f.requests.length, 4);
    f.driver.startMedia();
    assert.equal(f.params().get("action"), "get_categories");
    f.respond([
        { id: "a", title: "Films" },
        { id: "b", title: "More" },
    ]);
    f.tick();
    assert.equal(f.params().get("category"), "a");
    f.page([movie()]);
    assert.equal(
        f.mediaRows().length,
        1,
        "first leaf precedes remaining traversal"
    );
    const first = f.mediaRows()[0];
    assert(
        first.ch_id !== 42,
        "media numeric ID cannot collide with live raw ID"
    );
    assert.equal(
        first.__ottMediaItem.logo_30x30,
        "https://portal.test/poster.jpg"
    );
    assert(!first.__ottMediaItem.description.includes("<b>provider"));
    assert(first.__ottMediaItem.description.includes("&lt;b&gt;provider"));
    let live;
    const count = f.requests.length;
    f.driver.resolveStream(f.driver.stream(42), (url) => {
        live = url;
    });
    assert.equal(live, "https://media.test/live.m3u8");
    assert.equal(
        f.requests.length,
        count,
        "VOD raw ID did not replace live direct-link metadata"
    );
    f.tick();
    f.page([movie("42", "Another movie")]);
    f.tick();
    assert.equal(f.driver.catalogLoading(), false);
    assert.equal(f.driver.catalogError(), false);
    const rows = f.mediaRows();
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].__ottStalkerMediaKey, rows[1].__ottStalkerMediaKey);
    assert.notEqual(rows[0].itemId, rows[1].itemId);
});

test("nested series retain path/adult policy and resolve a fresh leaf before playback", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([{ censored: 1, id: "7", title: "Series" }]);
    f.tick();
    f.page([{ id: "20", is_series: 1, name: "Show" }]);
    f.tick();
    f.page([{ id: "2", is_season: 1, name: "Season 2" }]);
    f.tick();
    f.page([movie("42", "Episode")]);
    f.tick();
    const payload = f.mediaRows()[0].__ottMediaItem;
    assert.equal(payload.adult, 1);
    const media = f.driver.mediaClient();
    const saved = media.persist(payload);
    const json = JSON.stringify(saved);
    for (const forbidden of [
        "fixture-token",
        "media.test",
        "portal.test",
        "02:00:",
        "portalGeneration",
        "cmd",
    ])
        assert(!json.includes(forbidden));
    let result;
    media.resolve(saved, (value) => {
        result = value;
    });
    assert.equal(f.params().get("action"), "get_categories");
    f.respond([{ censored: 1, id: "7", title: "Renamed series" }]);
    f.page([{ id: "20", is_series: 1, name: "Show" }]);
    f.page([{ id: "2", is_season: 1, name: "Season 2" }]);
    f.page([
        {
            ...movie("42", "Fresh episode"),
            cmd: "ffmpeg https://media.test/fresh.mp4",
        },
    ]);
    assert.equal(f.params().get("action"), "create_link");
    assert.equal(f.params().get("cmd"), "ffmpeg https://media.test/fresh.mp4");
    f.respond({ cmd: "ffmpeg https://media.test/resolved.mp4" });
    assert.equal(result.stream_url, "https://media.test/resolved.mp4");
    assert.equal(result.adult, 1);
});

test("malformed/repeated pages fail the scan without clearing published live or media", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([
        { id: "a", title: "First" },
        { id: "b", title: "Broken" },
    ]);
    f.tick();
    f.page([movie()]);
    f.tick();
    f.page([movie("90")], 3);
    f.page([movie("90")], 3);
    assert.equal(f.driver.catalogLoading(), false);
    assert.equal(f.driver.catalogError(), true);
    assert.equal(f.mediaRows().length, 1);
    assert.equal(f.events[0].catalog.channels[42].channel_name, "Live 42");
});

test("deadline and profile retirement abort pending media and reject late callbacks", () => {
    for (const timeout of [false, true]) {
        const f = setup();
        f.driver.startMedia();
        const pending = f.requests.at(-1);
        const before = f.events.length;
        if (timeout) f.expire();
        else f.driver.dispose();
        assert.equal(pending.aborts, 1);
        pending.done({ js: [{ id: "a", title: "Late" }] });
        assert.equal(f.tick(), false);
        assert.equal(f.events.length, before);
        assert.equal(f.driver.catalogLoading(), false);
        if (timeout) assert.equal(f.driver.catalogError(), true);
    }
});

test("cycle in nested folders is bounded; no folder is published as a playable leaf", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([{ id: "a", title: "Series" }]);
    f.tick();
    f.page([{ id: "20", is_series: 1, name: "Loop" }]);
    f.tick();
    f.page([{ id: "20", is_series: 1, name: "Loop" }]);
    f.tick();
    assert.equal(f.driver.catalogLoading(), false);
    assert.equal(f.driver.catalogError(), true);
    assert.equal(f.mediaRows().length, 0);
});

test("removed or forged saved references cannot reuse an old playable URL", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([{ id: "a", title: "Films" }]);
    f.tick();
    f.page([movie()]);
    f.tick();
    const media = f.driver.mediaClient();
    const saved = media.persist(f.mediaRows()[0].__ottMediaItem);
    let resolved = "pending";
    media.resolve(saved, (value) => {
        resolved = value;
    });
    f.respond([{ id: "a", title: "Films" }]);
    f.page([]);
    assert.equal(resolved, null);
    const count = f.requests.length;
    media.resolve(
        { request: { url: "https://unconfigured.invalid" } },
        (value) => {
            resolved = value;
        }
    );
    assert.equal(resolved, null);
    assert.equal(f.requests.length, count);
});

test("mount yields until the live catalog is installed and owns its timer", () => {
    const f = setup();
    const before = f.requests.length;
    f.host.__ottStalkerDriver.mountMedia(f.host, f.driver, f.owner);
    assert.equal(f.requests.length, before);
    assert.equal(f.host.providerMediaClient, f.driver.mediaClient());
    f.tick();
    assert.equal(f.params().get("type"), "vod");
    f.registry.dispose();
    assert.equal(f.host.providerMediaClient, null);
});

test("stable media keys survive reload and category renaming", () => {
    const keys = [];
    for (const name of ["Original", "Renamed"]) {
        const f = setup();
        f.driver.startMedia();
        f.respond([{ id: "a", title: name }]);
        f.tick();
        f.page([movie("42", name)]);
        f.tick();
        keys.push(f.mediaRows()[0].__ottStalkerMediaKey);
        f.driver.dispose();
    }
    assert.equal(keys[0], keys[1]);
});

test("depth, oversized identity and duplicate folders terminate within bounds", () => {
    const deep = setup();
    deep.driver.startMedia();
    deep.respond([{ id: "a", title: "Series" }]);
    for (let i = 0; i < 8; i++) {
        deep.tick();
        deep.page([{ id: String(i), is_series: 1, name: "Nested" }]);
    }
    assert.equal(deep.driver.catalogLoading(), false);
    assert.equal(deep.driver.catalogError(), true);
    assert(deep.requests.length < 20);
    const large = setup();
    large.driver.startMedia();
    large.respond([{ id: "a".repeat(300), title: "Films" }]);
    large.tick();
    large.page([movie()]);
    assert.equal(large.driver.catalogError(), true);
    assert.equal(large.mediaRows().length, 0);
    const duplicate = setup();
    duplicate.driver.startMedia();
    duplicate.respond([
        { id: "a", title: "Films" },
        { id: "a", title: "Films" },
    ]);
    duplicate.tick();
    duplicate.page([movie()]);
    duplicate.tick();
    assert.equal(duplicate.mediaRows().length, 1);
    assert.equal(duplicate.driver.catalogLoading(), false);
});

test("VOD discovery preserves the token and concurrent live link and guide operations", () => {
    const f = setup({
        cmd: "ffmpeg http://localhost/ch/42_",
        use_http_tmp_link: 1,
    });
    let live, guide;
    f.driver.resolveStream(f.driver.stream(42), (url) => {
        live = url;
    });
    const link = f.requests.at(-1);
    f.driver.guide(42, (value) => {
        guide = value;
    });
    const epg = f.requests.at(-1);
    f.driver.startMedia();
    f.respond([{ id: "a", title: "Films" }]);
    f.tick();
    f.page([movie()]);
    f.tick();
    link.done({ js: { cmd: "ffmpeg https://media.test/fresh-live.m3u8" } });
    epg.done({ js: [] });
    assert.equal(live, "https://media.test/fresh-live.m3u8");
    assert.notEqual(guide, undefined);
    for (const request of f.requests.slice(1)) {
        assert.equal(
            JSON.parse(request.settings.data).headers.Authorization,
            "Bearer fixture-token"
        );
    }
});

test("playback resolution owns a deadline and a profile switch invalidates pending PIN", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([{ censored: 1, id: "a", title: "Films" }]);
    f.tick();
    f.page([movie()]);
    f.tick();
    const media = f.driver.mediaClient(),
        saved = media.persist(f.mediaRows()[0].__ottMediaItem);
    let result = "pending";
    media.resolve(saved, (value) => {
        result = value;
    });
    const request = f.requests.at(-1);
    f.expire();
    assert.equal(result, null);
    assert.equal(request.aborts, 1);
    let admit;
    const host = {
        __ottParental: { needs: () => true },
        enterPinAndSetAccess: (yes) => {
            admit = yes;
        },
    };
    media.attach(host);
    result = "pending";
    media.resolve(saved, (value) => {
        result = value;
    });
    f.respond([{ censored: 1, id: "a", title: "Films" }]);
    f.page([movie()]);
    assert.equal(typeof admit, "function");
    const count = f.requests.length;
    f.driver.dispose();
    host.__ottParental.needs = () => false;
    admit();
    assert.equal(result, "pending");
    assert.equal(f.requests.length, count);
});

test("expired responses cannot publish before a delayed timeout callback runs", () => {
    const f = setup();
    let now = 1000;
    f.ports.now = () => now;
    f.driver.startMedia();
    f.respond([{ id: "a", title: "Films" }]);
    f.tick();
    now += 121;
    f.page([movie()]);
    assert.equal(f.mediaRows().length, 0);
    assert.equal(f.driver.catalogError(), true);
    const g = setup();
    g.ports.now = () => now;
    g.driver.startMedia();
    g.respond([{ id: "a", title: "Films" }]);
    g.tick();
    g.page([movie()]);
    g.tick();
    const media = g.driver.mediaClient();
    let resolved = "pending";
    media.resolve(media.persist(g.mediaRows()[0].__ottMediaItem), (value) => {
        resolved = value;
    });
    now += 61;
    g.respond([{ id: "a", title: "Films" }]);
    assert.equal(resolved, null);
    assert.equal(g.params().get("action"), "get_categories");
});

test("a PIN prompt cannot rebind playback to another branch's duplicate leaf ID", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([
        { censored: 1, id: "a", title: "Films" },
        { id: "b", title: "Other" },
    ]);
    f.tick();
    f.page([movie()]);
    f.tick();
    const background = f.requests.at(-1),
        media = f.driver.mediaClient();
    const saved = media.persist(f.mediaRows()[0].__ottMediaItem);
    let admit,
        locked = true,
        result;
    media.attach({
        __ottParental: { needs: () => locked },
        enterPinAndSetAccess: (yes) => {
            admit = yes;
        },
    });
    media.resolve(saved, (value) => {
        result = value;
    });
    f.respond([
        { censored: 1, id: "a", title: "Films" },
        { id: "b", title: "Other" },
    ]);
    f.page([{ ...movie(), cmd: "ffmpeg https://media.test/right.mp4" }]);
    background.done({
        js: {
            data: [{ ...movie(), cmd: "ffmpeg https://media.test/wrong.mp4" }],
            total_items: 1,
        },
    });
    locked = false;
    admit();
    assert.equal(f.params().get("cmd"), "ffmpeg https://media.test/right.mp4");
    f.respond({ cmd: "ffmpeg https://media.test/right-resolved.mp4" });
    assert.equal(result.stream_url, "https://media.test/right-resolved.mp4");
});

test("a timed-out callback can start a new resolution without old cleanup aborting it", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([{ id: "a", title: "Films" }]);
    f.tick();
    f.page([movie()]);
    f.tick();
    const media = f.driver.mediaClient(),
        saved = media.persist(f.mediaRows()[0].__ottMediaItem);
    let result;
    media.resolve(saved, (value) => {
        assert.equal(value, null);
        media.resolve(saved, (next) => {
            result = next;
        });
    });
    f.expire();
    assert.equal(f.requests.at(-1).aborts, 0);
    f.respond([{ id: "a", title: "Films" }]);
    f.page([movie()]);
    f.respond({ cmd: "ffmpeg https://media.test/after-timeout.mp4" });
    assert.equal(result.stream_url, "https://media.test/after-timeout.mp4");
});

test("a VOD-only account initializes the actual channel library without stealing an open input", () => {
    const f = integrationFixture("stalker", {
        stalkerstalker_data: JSON.stringify({
            mac: "02:00:00:00:00:01",
            portal: "https://portal.test/c/",
        }),
    });
    const w = f.host;
    w.URL = URL;
    w.sFavorites = 0;
    w.setCurrent = () => {};
    privateRuntime(w, "src/channels/library.ts");
    privateRuntime(w, "src/channels/classic-library.ts");
    vm.runInContext(
        ts.transpileModule(
            declarations("src/channels/index.ts")
                .find((entry) => entry.name === "onChannelsLoaded")
                .text.replace(/^export /, ""),
            {
                compilerOptions: { target: ts.ScriptTarget.ES5 },
            }
        ).outputText,
        w
    );
    let mounts = 0,
        startupCallbacks = 0,
        plays = 0;
    const mount = w.__ottChannels.mount;
    const onLoaded = w.onChannelsLoaded;
    w.__ottChannels.mount = (...args) => {
        mounts++;
        return mount(...args);
    };
    w.playChannel = () => {
        plays++;
    };
    w.onChanelsLoaded = () => {
        startupCallbacks++;
        onLoaded();
    };
    const respond = (js) => f.requests.at(-1).resolve({ js });
    w.loadProv();
    respond({ token: "fixture-token" });
    respond({ id: "1", status: "0" });
    respond([{ id: "1", title: "Live" }]);
    respond({ data: [], total_items: 0 });
    assert.equal(mounts, 0);
    assert.equal(startupCallbacks, 1);
    // The user has opened an editor after the initial empty live result.
    const input = { selectionStart: 6, value: "unfinished input" };
    w.document.activeElement = input;
    const owned = {
        active: () => true,
        foreground: () => true,
        kind: "editor",
    };
    w.__ottClassicScreenPort = {
        listOwner: () => null,
        screens: { current: () => owned },
    };
    w.$("#dialogbox").html(input).show();
    const dialog = f.panels["#dialogbox"];
    f.advanceTimers(0);
    respond([
        { id: "a", title: "Films" },
        { id: "b", title: "More" },
    ]);
    f.advanceTimers(0);
    respond({ data: [movie()], total_items: 1 });
    assert.equal(mounts, 1, "first media batch initializes the real library");
    assert.equal(startupCallbacks, 1, "startup is not replayed");
    assert.equal(plays, 0, "late media does not autoplay");
    assert.equal(dialog.visible, true);
    assert.equal(dialog.html, input);
    assert.equal(input.value, "unfinished input");
    assert.equal(input.selectionStart, 6);
    assert.equal(w.document.activeElement, input);
    assert.equal(w.__ottClassicScreenPort.screens.current(), owned);
    const first = w.cList[0];
    assert.deepEqual(Array.from(w.cats.All), [first]);
    assert.deepEqual(Array.from(w.cats.Films), [first]);
    assert.equal(
        w.__ottChannels
            .group(w.catsArray.indexOf("Films"))
            .startsWith("stalker-category:"),
        true
    );
    f.advanceTimers(0);
    respond({ data: [movie("43", "Second")], total_items: 1 });
    f.advanceTimers(0);
    assert.equal(mounts, 1, "later media batches append to that library");
    assert.equal(w.cats.All.length, 2);
    assert.equal(w.cats.More.length, 1);
    assert.equal(dialog.visible, true);
    assert.equal(dialog.html, input);
    let opened;
    w.channelsList = (category, index) => {
        opened = { category, index };
    };
    assert.equal(w.__ottChannels.browse("system:all", false), true);
    assert.equal(opened.category, w.catsArray.indexOf("All"));
    assert.equal(opened.index, 0);
});

test("fresh playback metadata retains the host's attested channel launch reference", () => {
    const f = setup();
    f.driver.startMedia();
    f.respond([{ id: "a", title: "Films" }]);
    f.tick();
    f.page([movie()]);
    f.tick();
    const media = f.driver.mediaClient();
    const saved = media.persist(f.mediaRows()[0].__ottMediaItem);
    const reference = {
        itemId: "provider:" + saved.itemId,
        sourceId: "stalker@fixture",
    };
    saved.__ottMediaRef = reference;
    let result;
    media.resolve(saved, (value) => {
        result = value;
    });
    reference.sourceId = "mutated-after-dispatch";
    saved.request.id = "mutated-after-dispatch";
    f.respond([{ id: "a", title: "Films" }]);
    f.page([movie()]);
    f.respond({ cmd: "ffmpeg https://media.test/playing.mp4" });
    assert(result, "the request uses its admitted snapshot");
    assert.equal(result.__ottMediaRef.sourceId, "stalker@fixture");
    assert.equal(result.__ottMediaRef.itemId, "provider:" + result.itemId);
    assert.notEqual(result.__ottMediaRef, reference);
    assert.equal(result.stream_url, "https://media.test/playing.mp4");
    const fresh = media.persist(result);
    for (const wrong of [
        { itemId: "provider:" + result.itemId, sourceId: "stalker@another" },
        { itemId: "provider:another", sourceId: "stalker@fixture" },
    ]) {
        const count = f.requests.length;
        media.resolve({ ...fresh, __ottMediaRef: wrong }, (value) => {
            result = value;
        });
        assert.equal(result, null);
        assert.equal(f.requests.length, count);
    }
});
