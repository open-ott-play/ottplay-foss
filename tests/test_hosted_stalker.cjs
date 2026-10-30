"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");

const upstream = "https://portal.test/server/load.php";
const route = { path: "/stalker/fixture-portal", upstream };
const deployment = (routes = [route]) => ({ stalker: { routes }, version: 1 });
const movie = {
    cmd: "ffmpeg https://media.test/movie.mp4",
    id: "50",
    name: "Fixture movie",
};

function setup(options = {}) {
    const f = fixture({
        stalkerstalker_data: JSON.stringify({
            mac: "02:00:00:00:00:01",
            portal: options.portal || "https://portal.test/c/",
        }),
    });
    const timers = new Map();
    let nextTimer = 0;
    Object.assign(f.host, {
        __ottSourceIdentity: { media: () => "stalker@fixture" },
        clearTimeout: (id) => timers.delete(id),
        location: {
            href: "https://player.test/app/",
            origin: "https://player.test",
        },
        setTimeout: (callback, delay) => {
            timers.set(++nextTimer, { callback, delay });
            return nextTimer;
        },
        URL,
    });
    if (Object.hasOwn(options, "hosted"))
        f.host.__OTTPLAY_HOSTED__ = options.hosted;
    if (options.native) f.host[options.native] = {};
    f.driver = f.mount("stalker");
    f.events = [];
    f.load = () =>
        f.driver.load((catalog, error) => f.events.push({ catalog, error }));
    f.request = () => {
        const settings = f.requests.at(-1).settings;
        return settings.type === "GET" ? settings : JSON.parse(settings.data);
    };
    f.params = () => new URL(f.request().url).searchParams;
    f.respond = (js) => f.requests.at(-1).resolve({ js });
    f.page = (data) => f.respond({ data, total_items: data.length });
    f.tick = () => {
        const entry = [...timers].find(([, value]) => value.delay === 0);
        if (!entry) return false;
        timers.delete(entry[0]);
        entry[1].callback();
        return true;
    };
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

function loadLive(f) {
    f.load();
    f.respond({ token: "fixture-token" });
    f.respond({ id: "1", status: "0" });
    f.respond([{ id: "1", title: "Live" }]);
    f.page([
        {
            cmd: "ffmpeg http://localhost/ch/42_",
            id: "42",
            name: "Fixture live",
            use_http_tmp_link: 1,
        },
    ]);
    assert.equal(f.events[0].error, undefined);
    assert.deepEqual(Array.from(f.events[0].catalog.ids), [42]);
}

test("actual mounted driver routes live, VOD and fresh links through the named hosted path", () => {
    const f = setup({
        hosted: deployment([
            {
                path: "/stalker/other",
                upstream: "https://other.test/portal.php",
            },
            route,
        ]),
    });
    loadLive(f);
    let live;
    f.driver.resolveStream(f.driver.stream(42), (value) => (live = value));
    assert.equal(f.params().get("action"), "create_link");
    f.respond({ cmd: "ffmpeg https://media.test/live.m3u8" });
    assert.equal(live, "https://media.test/live.m3u8");
    let guide;
    f.driver.guide(42, (value) => (guide = value));
    assert.equal(f.params().get("action"), "get_short_epg");
    f.respond([]);
    assert(guide);

    f.driver.startMedia();
    assert.equal(f.params().get("type"), "vod");
    f.respond([{ id: "7", title: "Movies" }]);
    assert(f.tick());
    f.page([movie]);
    assert(f.tick());
    const media = f.driver.mediaClient();
    const saved = media.persist(f.mediaRows()[0].__ottMediaItem);
    let resolved;
    media.resolve(saved, (value) => (resolved = value));
    f.respond([{ id: "7", title: "Movies" }]);
    f.page([movie]);
    assert.equal(f.params().get("action"), "create_link");
    f.respond({ cmd: "ffmpeg https://media.test/fresh.mp4" });
    assert.equal(resolved.stream_url, "https://media.test/fresh.mp4");

    for (const { settings } of f.requests) {
        assert.equal(settings.url, route.path);
        assert.equal(settings.type, "POST");
        assert.equal(settings.contentType, "application/json");
        const envelope = JSON.parse(settings.data);
        assert.deepEqual(Object.keys(envelope).sort(), ["headers", "url"]);
        assert.equal(envelope.url.split("?")[0], upstream);
        assert.equal(typeof envelope.headers.Cookie, "string");
        assert(!settings.url.includes("fixture-token"));
    }
    f.driver.dispose();
});

test("the shipped core alone normalizes the configured portal into the exact endpoint", () => {
    for (const [portal, endpoint] of [
        ["https://portal.test/c/", upstream],
        [
            "https://portal.test/stalker_portal/c/",
            "https://portal.test/stalker_portal/server/load.php",
        ],
        ["https://portal.test/portal.php", "https://portal.test/portal.php"],
    ]) {
        const f = setup({
            hosted: deployment([{ ...route, upstream: endpoint }]),
            portal,
        });
        f.load();
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].settings.url, route.path);
        assert.equal(f.request().url.split("?")[0], endpoint);
        f.driver.dispose();
    }
});

test("missing, malformed, duplicate and nonmatching hosted configuration never sends a request", () => {
    const invalid = [
        null,
        false,
        0,
        "",
        [],
        {},
        { ...deployment(), version: 2 },
        { ...deployment(), version: "1" },
        { version: 1 },
        { stalker: null, version: 1 },
        { stalker: { routes: {} }, version: 1 },
        deployment([]),
        deployment([null]),
        deployment([{ ...route, upstream: null }]),
        deployment([route, { ...route }]),
        deployment([route, { ...route, path: "/stalker/second" }]),
        deployment([
            { ...route, upstream: "https://other.test/server/load.php" },
        ]),
        deployment([{ ...route, upstream: upstream + "?type=itv" }]),
        deployment([{ ...route, upstream: upstream + "/" }]),
        deployment([
            { ...route, upstream: "https://PORTAL.test/server/load.php" },
        ]),
        ...[
            null,
            "",
            "/stalker/",
            "/stalker/api",
            "/stalker/Upper",
            "/stalker/two--names",
            "/stalker/name/",
            "/stalker/name?x=1",
            "/stalker/name\n",
            "/stalker/name\r",
            "/stalker/name\u2028",
            "https://relay.test/stalker/name",
            "//relay.test/stalker/name",
            "/stalker/" + "a".repeat(65),
        ].map((path) => deployment([{ ...route, path }])),
    ];
    for (const hosted of invalid) {
        const f = setup({ hosted });
        f.load();
        assert.equal(f.requests.length, 0, JSON.stringify(hosted));
        assert.equal(f.events.length, 1);
        assert.deepEqual(Array.from(f.events[0].catalog.ids), []);
        assert.equal(f.events[0].error, "stalker-connect");
        f.driver.dispose();
    }
});

test("hosted route and name bounds match the named relay configuration", () => {
    const maximum = [
        ...Array.from({ length: 31 }, (_, index) => ({
            path: "/stalker/fixture-" + index,
            upstream: "https://portal-" + index + ".test/portal.php",
        })),
        { ...route, path: "/stalker/" + "a".repeat(64) },
    ];
    const accepted = setup({ hosted: deployment(maximum) });
    accepted.load();
    assert.equal(accepted.requests.length, 1);
    assert.equal(accepted.requests[0].settings.url, maximum[31].path);
    accepted.driver.dispose();
    const rejected = setup({
        hosted: deployment([
            ...maximum,
            {
                path: "/stalker/extra",
                upstream: "https://extra.test/portal.php",
            },
        ]),
    });
    rejected.load();
    assert.equal(rejected.requests.length, 0);
    assert.equal(rejected.events[0].error, "stalker-connect");
    rejected.driver.dispose();
});

test("ordinary self-host and native transports retain their existing request contracts", () => {
    const web = setup();
    web.load();
    assert.equal(
        web.requests[0].settings.url,
        "https://relay.test/stalker/api"
    );
    assert.equal(web.requests[0].settings.type, "POST");
    assert.equal(web.request().url.split("?")[0], upstream);
    web.driver.dispose();
    for (const native of ["Capacitor", "__TAURI__"]) {
        const f = setup({ hosted: null, native });
        f.load();
        const settings = f.requests[0].settings;
        assert.equal(settings.type, "GET");
        assert.equal(settings.url.split("?")[0], upstream);
        assert.equal(settings.data, undefined);
        assert.equal(typeof settings.headers.Cookie, "string");
        f.driver.dispose();
    }
});

test("hosted routing leaves the separate legacy JSON-RPC dialect unchanged", () => {
    for (const hosted of [null, deployment()]) {
        const f = setup({ hosted, portal: "https://portal.test/" });
        f.load();
        assert.equal(f.requests.length, 1);
        const settings = f.requests[0].settings;
        assert.equal(settings.url, "https://portal.test/stalker_portal/api/");
        assert.equal(settings.type, "POST");
        assert.deepEqual(JSON.parse(settings.data), {
            id: 1,
            jsonrpc: "2.0",
            method: "handshake",
            params: { mac: "02:00:00:00:00:01" },
        });
        f.driver.dispose();
    }
    for (const portal of [
        "https://portal.test/c/",
        "https://portal.test/stalker_portal/c/",
        "https://portal.test/portal.php",
        "https://portal.test/server/load.php",
    ]) {
        const f = setup({ hosted: null, portal });
        f.load();
        assert.equal(f.requests.length, 0, "classic cannot use legacy POST");
        assert.equal(f.events[0].error, "stalker-connect");
        f.driver.dispose();
    }
});

test("route removal during a session refuses the next request without transport fallback", () => {
    const f = setup({ hosted: deployment() });
    f.load();
    f.host.__OTTPLAY_HOSTED__ = null;
    f.respond({ token: "fixture-token" });
    assert.equal(f.requests.length, 1);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].error, "stalker-connect");
    f.driver.dispose();
});

test("retiring hosted live and VOD requests aborts once and rejects late results", () => {
    for (const media of [false, true]) {
        const f = setup({ hosted: deployment() });
        if (media) {
            loadLive(f);
            f.driver.startMedia();
        } else f.load();
        const pending = f.requests.at(-1);
        const requestCount = f.requests.length;
        const eventCount = f.events.length;
        f.lifetime.dispose();
        assert.equal(pending.aborts, 1);
        pending.resolve({
            js: media ? [{ id: "7", title: "Late" }] : { token: "late" },
        });
        pending.reject();
        assert.equal(f.requests.length, requestCount);
        assert.equal(f.events.length, eventCount);
        assert.equal(f.tick(), false);
    }
});
