const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");

const source = fs.readFileSync(
    path.join(__dirname, "../src/provider/torrent-discovery-data.ts"),
    "utf8"
);
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
const copy = (value) => JSON.parse(JSON.stringify(value));
function fixture(onContextChanged, generic = false) {
    let time = 0,
        nextTimer = 0,
        language = "ru-RU",
        endpoint = "";
    const timers = new Map(),
        requests = [];
    const manual = '{"schema":1,"id":"mine","name":"Torrent","entries":[]}';
    const forbidden = () =>
        assert.fail("Metadata must not touch storage or engine");
    const host = {
        __ottMediaCompanion: { ensure: forbidden },
        localStorage: { getItem: forbidden, setItem: forbidden },
        stbGetItem: forbidden,
        stbSetItem: forbidden,
        torrentcfg: manual,
    };
    vm.runInNewContext(compiled, { exports: {}, window: host });
    const instance = host.__ottTorrentDiscoveryData.create({
        addonBaseUrl: () => endpoint,
        apiPath: (tail) => "https://owned.example/tmdb/s/" + tail,
        clearTimeout: (id) => timers.delete(id),
        language: () => language,
        now: () => time,
        onContextChanged,
        request(url, done) {
            if (
                !generic &&
                endpoint &&
                url === endpoint.replace(/\/+$/, "") + "/manifest.json"
            ) {
                done(null, {
                    catalogs: ["tmdb.top", "tmdb.latest", "tmdb.search"].map(
                        (id) => ({ id, type: "movie" })
                    ),
                    resources: ["catalog", "meta"],
                    types: ["movie"],
                });
                return () => {};
            }
            const request = { aborted: 0, done, url };
            requests.push(request);
            return () => request.aborted++;
        },
        setTimeout(callback, delay) {
            const id = ++nextTimer;
            timers.set(id, { at: time + delay, callback });
            return id;
        },
    });
    return {
        host,
        instance,
        manual,
        requests,
        setEndpoint(value) {
            endpoint = value;
        },
        setLanguage(value) {
            language = value;
        },
        tick(amount = 0) {
            time += amount;
            for (const [id, timer] of [...timers])
                if (timer.at <= time && timers.delete(id)) timer.callback();
        },
    };
}
function movie(id = 603, additions = {}) {
    return {
        id,
        original_title: "The Matrix",
        overview: "Описание",
        poster_path: "/poster.jpg",
        release_date: "1999-03-31",
        title: "Матрица",
        ...additions,
    };
}
function page(items = [movie()], current = 1, total = 1) {
    return { page: current, results: items, total_pages: total };
}

test("publishes an isolated ES5 factory without touching manual catalog or engine", () => {
    acorn.parse(compiled, { ecmaVersion: 5 });
    const f = fixture();
    assert.equal(typeof f.instance.load, "function");
    assert.equal(f.host.torrentcfg, f.manual);
    assert.equal(f.requests.length, 0);
    assert.equal(source.includes("torrent-catalog-codec"), false);
});
test("direct lists, search and details carry locale and stable movie identity", () => {
    const f = fixture();
    let result;
    f.instance.load("popular", null, (v) => (result = copy(v)));
    assert.match(
        f.requests[0].url,
        /\/tmdb\/s\/movie\/popular\?language=ru-RU/
    );
    f.requests[0].done(null, page([movie()], 1, 5));
    assert.deepEqual(result, {
        items: [
            {
                description: "Описание",
                id: "tmdb:movie:603",
                language: "ru-RU",
                poster: "https://image.tmdb.org/t/p/w342/poster.jpg",
                title: "Матрица",
                year: "1999",
            },
        ],
        next: 2,
        ok: true,
    });
    f.instance.load("new", 2, () => {});
    assert.match(f.requests[1].url, /movie\/now_playing/);
    assert.match(f.requests[1].url, /page=2/);
    f.instance.search("Матрица & Neo", null, () => {});
    assert.equal(
        new URL(f.requests[2].url).searchParams.get("query"),
        "Матрица & Neo"
    );
    f.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    assert.match(
        f.requests[3].url,
        /movie\/603\?language=ru-RU&append_to_response=external_ids$/
    );
    f.requests[3].done(null, movie());
    assert.equal(result.item.id, "tmdb:movie:603");
    assert.equal(Object.hasOwn(result.item, "stream_url"), false);
    assert.equal(Object.hasOwn(result.item, "playable"), false);
    assert.equal(f.host.torrentcfg, f.manual);
});
test("genres are localized; genre browsing does not filter original language", () => {
    const f = fixture();
    let result;
    f.instance.categories((v) => (result = copy(v)));
    assert.match(f.requests[0].url, /genre\/movie\/list\?language=ru-RU$/);
    f.requests[0].done(null, { genres: [{ id: 28, name: "Боевик" }] });
    assert.deepEqual(
        result.categories.map((v) => v.id),
        ["popular", "new", "genre:28"]
    );
    assert.equal(result.categories[2].title, "Боевик");
    f.instance.load("genre:28", null, () => {});
    assert.match(f.requests[1].url, /discover\/movie/);
    assert.equal(
        new URL(f.requests[1].url).searchParams.get("with_genres"),
        "28"
    );
    assert.equal(
        new URL(f.requests[1].url).searchParams.has("with_original_language"),
        false
    );
});
test("new search, explicit cancel and disposal suppress late callbacks", () => {
    const f = fixture(),
        received = [];
    f.instance.search("old", null, (v) => received.push(v));
    f.instance.search("new", null, (v) => received.push(v));
    assert.equal(f.requests[0].aborted, 1);
    f.requests[0].done(null, page());
    assert.equal(received.length, 0);
    f.requests[1].done(null, page());
    assert.equal(received.length, 1);
    const stop = f.instance.details("tmdb:movie:604", (v) => received.push(v));
    stop();
    f.requests[2].done(null, movie(604));
    assert.equal(received.length, 1);
    f.instance.categories((v) => received.push(v));
    f.instance.dispose();
    f.requests[3].done(null, { genres: [] });
    f.instance.load("popular", null, () => assert.fail("disposed"));
    f.tick(20000);
    assert.equal(received.length, 1);
    assert.equal(f.requests.length, 4);
});
test("language and source changes fence responses and invalidate locale caches", () => {
    const f = fixture();
    let received = 0;
    f.instance.load("popular", null, () => received++);
    f.setLanguage("en-US");
    f.requests[0].done(null, page());
    assert.equal(received, 0);
    f.instance.load("popular", null, () => received++);
    assert.match(f.requests[1].url, /language=en-US/);
    f.requests[1].done(null, page());
    f.instance.load("popular", null, () => received++);
    f.tick();
    assert.equal(f.requests.length, 2);
    assert.equal(received, 2);
    f.setLanguage("ru-RU");
    f.instance.load("popular", null, () => received++);
    assert.equal(f.requests.length, 3);
    f.setEndpoint("https://addon.example");
    f.requests[2].done(null, page());
    assert.equal(received, 2);
    f.instance.load("popular", null, () => received++);
    assert.match(f.requests[3].url, /^https:\/\/addon.example\//);
});
test("missing translation uses original title and leaves missing description empty", () => {
    const f = fixture();
    let result;
    f.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    f.requests[0].done(null, movie(603, { overview: null, title: "" }));
    assert.equal(result.item.title, "The Matrix");
    assert.equal(result.item.description, "");
    assert.equal(f.requests.length, 1);
    assert.equal(result.item.id, "tmdb:movie:603");
});
test("explicit addon base uses selected locale, translated genres and metadata only", () => {
    const f = fixture();
    f.setEndpoint("https://addon.example/prefix/");
    let result;
    f.instance.search("Матрица", null, (v) => (result = copy(v)));
    const url = new URL(f.requests[0].url);
    assert.deepEqual(
        JSON.parse(decodeURIComponent(url.pathname.split("/")[2])),
        { language: "ru-RU" }
    );
    assert.match(url.pathname, /catalog\/movie\/tmdb.search/);
    f.requests[0].done(null, {
        metas: [
            {
                description: "Русское описание",
                id: "tmdb:603",
                name: "Матрица",
                poster: "https://images.example/image.jpg",
                releaseInfo: "1999",
                streams: [{ url: "https://ignored.example/video" }],
                type: "movie",
            },
        ],
    });
    assert.equal(result.items[0].id, "tmdb:movie:603");
    assert.equal(result.items[0].description, "Русское описание");
    assert.equal(result.next, null);
    assert.equal(Object.hasOwn(result.items[0], "streams"), false);
    f.instance.categories((v) => (result = copy(v)));
    f.tick();
    f.requests[1].done(null, {
        catalogs: [
            {
                extra: [{ name: "genre", options: ["Боевик", "Драма"] }],
                id: "tmdb.top",
                type: "movie",
            },
        ],
    });
    f.instance.load(result.categories[2].id, 2, () => {});
    f.tick();
    assert.match(f.requests[2].url, /skip=20&genre=/);
    assert.equal(
        decodeURIComponent(f.requests[2].url.split("genre=")[1]),
        "Боевик.json"
    );
    f.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    f.tick();
    assert.match(f.requests[3].url, /meta\/movie\/tmdb:603.json$/);
    f.requests[3].done(null, {
        meta: { id: "tmdb:603", name: "Матрица", type: "movie" },
    });
    assert.equal(result.item.id, "tmdb:movie:603");
});
test("503 and deadline remain errors, not successful empty catalogs", () => {
    const f = fixture(),
        results = [];
    f.instance.load("popular", null, (v) => results.push(copy(v)));
    f.requests[0].done({ status: 503 });
    assert.deepEqual(results[0], { error: "unavailable", ok: false });
    f.instance.load("popular", null, (v) => results.push(copy(v)));
    f.tick(15000);
    assert.deepEqual(results[1], { error: "timeout", ok: false });
    assert.equal(f.requests[1].aborted, 1);
    f.requests[1].done(null, page());
    assert.equal(results.length, 2);
});
test("rejects oversized, malformed, wrong-identity and overlong pages", () => {
    const f = fixture();
    for (const data of [
        "{",
        null,
        [],
        { unrelated: [] },
        page([movie()], 2),
        page(Array.from({ length: 101 }, (_, i) => movie(i + 1))),
        page([movie(603, { original_title: "", title: "" })]),
        page([movie("603\n")]),
        { ...page(), padding: "ю".repeat(262144) },
    ]) {
        let result;
        f.instance.load("popular", null, (v) => (result = copy(v)));
        f.requests.at(-1).done(null, data);
        assert.deepEqual(result, { error: "invalid_response", ok: false });
    }
    let result;
    f.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    f.requests.at(-1).done(null, movie(604));
    assert.deepEqual(result, { error: "invalid_response", ok: false });
});
test("invalid inputs send nothing; unsafe artwork never becomes an image URL", () => {
    const f = fixture(),
        results = [];
    for (const id of ["tt0133093", "tmdb:movie:603\n", "tmdb:movie:0"]) {
        f.instance.details(id, (v) => results.push(copy(v)));
        f.tick();
    }
    for (const cursor of [0, -1, 501, 1.5]) {
        f.instance.load("popular", cursor, (v) => results.push(copy(v)));
        f.tick();
    }
    f.instance.search("x".repeat(257), null, (v) => results.push(copy(v)));
    f.tick();
    for (const endpoint of [
        "http://addon.example",
        "https://user@addon.example",
        "https://addon.example/?key=x",
        "javascript:alert(1)",
    ]) {
        f.setEndpoint(endpoint);
        f.instance.load("popular", null, (v) => results.push(copy(v)));
        f.tick();
    }
    assert.equal(results.length, 12);
    assert.ok(results.every((v) => !v.ok && v.error === "invalid_request"));
    assert.equal(f.requests.length, 0);
    f.setEndpoint("https://addon.example");
    let result;
    f.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    f.requests[0].done(null, {
        meta: {
            id: "tmdb:603",
            name: "<img onerror=evil()>",
            poster: "javascript:evil()",
        },
    });
    assert.equal(result.item.poster, "");
    assert.equal(result.item.title, "<img onerror=evil()>");
    assert.equal(f.host.torrentcfg, f.manual);
});
test("cache has bounded LRU count and expiry; callers cannot mutate cached values", () => {
    const f = fixture();
    let result;
    for (let id = 1; id <= 33; id++) {
        f.instance.details("tmdb:movie:" + id, (v) => (result = v));
        f.requests.at(-1).done(null, movie(id));
    }
    f.instance.details("tmdb:movie:33", (v) => (result = v));
    f.tick();
    assert.equal(f.requests.length, 33);
    result.item.title = "changed";
    f.instance.details("tmdb:movie:33", (v) => (result = v));
    f.tick();
    assert.equal(result.item.title, "Матрица");
    f.instance.details("tmdb:movie:1", () => {});
    assert.equal(f.requests.length, 34);
    f.requests.at(-1).done(null, movie(1));
    f.tick(300000);
    f.instance.details("tmdb:movie:33", () => {});
    assert.equal(f.requests.length, 35);
});
test("cache byte budget evicts large pages before the entry limit", () => {
    const f = fixture();
    for (let p = 1; p <= 7; p++) {
        let result;
        f.instance.load("popular", p, (value) => (result = value));
        f.requests.at(-1).done(
            null,
            page(
                Array.from({ length: 20 }, (_, i) =>
                    movie(p * 100 + i, { overview: "界".repeat(7000) })
                ),
                p,
                10
            )
        );
        assert.equal(result.ok, true);
    }
    f.instance.load("popular", 1, () => {});
    assert.equal(f.requests.length, 8);
});

test("all shipped interface locale tags survive without an English fallback", () => {
    const exports = {};
    const compiledAssets = ts.transpileModule(
        fs.readFileSync(
            path.join(__dirname, "../src/localization/assets.ts"),
            "utf8"
        ),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    vm.runInNewContext(compiledAssets, { exports });
    const f = fixture();
    for (const code of Object.keys(exports.languageNames)) {
        const language = exports.languageLocaleTag(code);
        f.setLanguage(language);
        f.instance.load("popular", null, () => {});
        assert.equal(
            new URL(f.requests.at(-1).url).searchParams.get("language"),
            language,
            code
        );
    }
    for (const [input, expected] of [
        ["zh_hant_tw", "zh-Hant-TW"],
        ["FIL_ph", "fil-PH"],
        ["es-419", "es-419"],
    ]) {
        f.setLanguage(input);
        f.instance.load("popular", null, () => {});
        assert.equal(
            new URL(f.requests.at(-1).url).searchParams.get("language"),
            expected
        );
    }
});

test("addon search has no fake pagination when upstream ignores skip", () => {
    const f = fixture();
    f.setEndpoint("https://addon.example");
    let result;
    f.instance.search("Matrix", null, (v) => (result = copy(v)));
    f.requests[0].done(null, {
        metas: Array.from({ length: 20 }, (_, i) => ({
            id: "tmdb:" + (i + 1),
            name: "Title",
        })),
    });
    assert.equal(result.next, null);
    f.instance.search("Matrix", 2, (v) => (result = copy(v)));
    f.tick();
    f.tick();
    assert.deepEqual(result, { error: "invalid_request", ok: false });
    assert.equal(f.requests.length, 1);
});

test("addon base validation rejects manifest resources and malformed paths", () => {
    const f = fixture();
    for (const endpoint of [
        "https://addon.example/manifest.json",
        "https://addon.example/manifest%2ejson",
        "https://addon.example/%zz",
        "https://addon.example/%00",
        "https://addon.example/%09",
        "https://addon.example/%0a",
        "https://addon.example/%7f",
        "https://addon.example/%5c",
        "https://addon.example/raw path",
        "https://addon.example/raw\tpath",
        " https://addon.example/config",
        "https://addon.example/config\n",
        "https://user:pass@addon.example/config",
        "https://addon.example/config?key=value",
        "https://addon.example/config#fragment",
    ]) {
        f.setEndpoint(endpoint);
        let result;
        f.instance.load("popular", null, (v) => (result = copy(v)));
        f.tick();
        assert.deepEqual(result, { error: "invalid_request", ok: false });
    }
    assert.equal(f.requests.length, 0);
    f.setEndpoint("HTTPS://addon.example");
    f.instance.load("popular", null, () => {});
    assert.equal(f.requests.length, 1);
});

test("encoded addon configuration remains opaque in manifest and catalog requests", () => {
    for (const origin of ["https://addon.example", "http://localhost:7000"]) {
        const f = fixture(undefined, true);
        const base =
            origin +
            "/%7b%22name%22%3a%22A%20B%22%2c%22token%22%3a%22a%2fb%3fc%23d%22%7d";
        f.setEndpoint(base);
        let result;
        f.instance.load("popular", null, (value) => (result = copy(value)));
        assert.equal(f.requests[0]?.url, base + "/manifest.json");
        f.requests[0].done(null, genericManifest);
        assert.equal(
            f.requests[1].url,
            base + "/catalog/movie/open%20movies/skip=0.json"
        );
        f.requests[1].done(null, { metas: [bunny] });
        assert.equal(result.items[0].id, "imdb:movie:tt1254207");
    }
});

test("a changed interface locale notifies once across pending lanes without stale metadata", () => {
    let changes = 0;
    const f = fixture(() => changes++);
    const stale = () => assert.fail("old metadata must stay suppressed");
    f.instance.load("popular", null, stale);
    f.instance.categories(stale);
    f.instance.details("tmdb:movie:603", stale);
    f.setLanguage("uk");
    f.requests[0].done(null, page());
    f.requests[1].done(null, { genres: [] });
    f.requests[2].done(null, movie());
    f.tick(15000);
    assert.equal(changes, 1);
    assert.deepEqual(
        f.requests.map((r) => r.aborted),
        [1, 1, 1]
    );
    assert.equal(
        f.requests.length,
        3,
        "observer alone must not activate a provider"
    );
    assert.equal(f.host.torrentcfg, f.manual);
});

test("settings changes detected at the deadline notify once and abort once", () => {
    let changes = 0;
    const f = fixture(() => changes++);
    f.instance.load("popular", null, () => assert.fail("stale timeout"));
    f.setEndpoint("https://addon.example");
    f.tick(15000);
    assert.equal(changes, 1);
    assert.equal(f.requests[0].aborted, 1);
    f.requests[0].done(null, page());
    f.tick(15000);
    assert.equal(changes, 1);
    assert.equal(f.requests.length, 1);
});

test("context observer can reload the current page without recursive invalidations", () => {
    let changes = 0,
        current;
    const f = fixture(() => {
        changes++;
        f.instance.load("popular", null, (result) => (current = copy(result)));
    });
    f.instance.load("popular", null, () => assert.fail("stale result"));
    f.setLanguage("fr");
    f.requests[0].done(null, page());
    assert.equal(changes, 1);
    assert.equal(f.requests.length, 2);
    assert.match(f.requests[1].url, /language=fr/);
    f.requests[1].done(null, page([movie(603, { title: "Matrix" })]));
    assert.equal(current.items[0].language, "fr");
    assert.equal(changes, 1);
    f.tick(15000);
    assert.equal(f.requests.length, 2);
});

test("initial, equivalent, explicit and disposed contexts do not emit observer events", () => {
    let changes = 0;
    const f = fixture(() => changes++);
    let result;
    f.instance.load("popular", null, (value) => (result = value));
    f.setLanguage("RU_ru");
    f.requests[0].done(null, page());
    assert.equal(result.ok, true);
    assert.equal(changes, 0);
    f.setLanguage("de");
    f.instance.load("popular", null, () => {});
    f.requests[1].done(null, page());
    assert.equal(
        changes,
        0,
        "an explicit new request already handles its context"
    );
    f.instance.details("tmdb:movie:603", () => assert.fail("disposed"));
    f.instance.dispose();
    f.setLanguage("ja");
    f.requests[2].done(null, movie());
    f.tick(15000);
    assert.equal(changes, 0);
});

test("invalid changed settings settle through the observer without sending to that endpoint", () => {
    let changes = 0;
    const f = fixture(() => changes++);
    f.instance.load("popular", null, () => assert.fail("stale metadata"));
    f.setEndpoint("http://invalid.example");
    f.requests[0].done(null, page());
    assert.equal(changes, 1);
    let result;
    f.instance.load("popular", null, (value) => (result = copy(value)));
    f.tick();
    assert.deepEqual(result, { error: "invalid_request", ok: false });
    assert.equal(changes, 1);
    assert.equal(f.requests.length, 1);
});

test("details preserve validated IMDb identity without changing catalog IDs", () => {
    const f = fixture();
    let result;
    f.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    f.requests[0].done(
        null,
        movie(603, { external_ids: { imdb_id: "tt0133093" } })
    );
    assert.equal(result.item.id, "tmdb:movie:603");
    assert.equal(result.item.imdbId, "tt0133093");
    const addon = fixture();
    addon.setEndpoint("https://metadata.example");
    addon.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    addon.requests[0].done(null, {
        meta: { id: "tmdb:603", imdb_id: "tt0133093", name: "Matrix" },
    });
    assert.equal(result.item.imdbId, "tt0133093");
    const invalid = fixture();
    invalid.instance.details("tmdb:movie:603", (v) => (result = copy(v)));
    invalid.requests[0].done(null, movie(603, { imdb_id: "tt0133093\n" }));
    assert.equal(Object.hasOwn(result.item, "imdbId"), false);
});

const genericManifest = {
    catalogs: [
        {
            extra: [{ name: "skip" }],
            id: "open movies",
            name: "Открытые фильмы",
            type: "movie",
        },
        {
            extra: [{ isRequired: true, name: "search" }],
            id: "find",
            name: "Поиск",
            type: "movie",
        },
        { id: "not-movies", type: "series" },
        {
            extra: [{ isRequired: true, name: "token" }],
            id: "needs-login",
            type: "movie",
        },
    ],
    idPrefixes: ["tt", "custom:"],
    resources: ["catalog", "meta"],
    types: ["movie"],
};
function genericFixture() {
    const f = fixture(undefined, true);
    f.setEndpoint("https://movies.example/addon");
    return f;
}
const bunny = {
    description: "Blender open movie",
    id: "tt1254207",
    name: "Big Buck Bunny",
    releaseInfo: "2008",
    type: "movie",
};
test("generic manifests expose actual movie catalogs and advertised search", () => {
    const f = genericFixture();
    let result;
    f.instance.categories((v) => (result = copy(v)));
    assert.equal(
        f.requests[0].url,
        "https://movies.example/addon/manifest.json"
    );
    f.requests[0].done(null, genericManifest);
    assert.deepEqual(result, {
        categories: [
            {
                id: "catalog:open%20movies",
                searchSupported: false,
                title: "Открытые фильмы",
            },
        ],
        mode: "stremio",
        ok: true,
        searchSupported: true,
    });
    assert.equal(f.requests.length, 1);
});
test("generic pages carry real catalog identity, IMDb IDs and exact offset pagination", () => {
    const f = genericFixture();
    let result;
    f.instance.load("popular", null, (v) => (result = copy(v)));
    f.requests[0].done(null, genericManifest);
    assert.equal(
        f.requests[1].url,
        "https://movies.example/addon/catalog/movie/open%20movies/skip=0.json"
    );
    f.requests[1].done(null, { metas: [bunny] });
    assert.equal(result.items[0].id, "imdb:movie:tt1254207");
    assert.equal(result.items[0].imdbId, "tt1254207");
    assert.equal(result.next, 1);
    assert.equal(result.mode, "stremio");
    assert.equal(result.catalog.id, "catalog:open%20movies");
    f.instance.load(result.catalog.id, result.next, (v) => (result = copy(v)));
    f.tick();
    assert.equal(
        f.requests[2].url,
        "https://movies.example/addon/catalog/movie/open%20movies/skip=1.json"
    );
    f.requests[2].done(null, { metas: [] });
    assert.equal(result.next, null);
});
test("generic search uses only advertised catalog and does not invent locale config", () => {
    const f = genericFixture();
    let result;
    f.instance.search("Кролик & друзья", null, (v) => (result = copy(v)));
    f.requests[0].done(null, genericManifest);
    assert.equal(
        f.requests[1].url,
        "https://movies.example/addon/catalog/movie/find/search=" +
            encodeURIComponent("Кролик & друзья") +
            ".json"
    );
    f.requests[1].done(null, { metas: [bunny] });
    assert.equal(result.next, null);
    const none = genericFixture();
    none.instance.search("Bunny", null, (v) => (result = copy(v)));
    none.requests[0].done(null, {
        ...genericManifest,
        catalogs: [genericManifest.catalogs[0]],
    });
    none.tick();
    assert.equal(result.ok, false);
    assert.equal(none.requests.length, 1);
});
test("generic custom IDs round-trip through metadata resource and reject wrong identity", () => {
    const f = genericFixture();
    let result;
    const custom = { ...bunny, id: "custom:some/ид" };
    f.instance.load("popular", null, (v) => (result = copy(v)));
    f.requests[0].done(null, genericManifest);
    f.requests[1].done(null, { metas: [custom] });
    const id = result.items[0].id;
    assert.equal(id, "stremio:movie:" + encodeURIComponent(custom.id));
    f.instance.details(id, (v) => (result = copy(v)));
    f.tick();
    assert.equal(
        f.requests[2].url,
        "https://movies.example/addon/meta/movie/" +
            encodeURIComponent(custom.id) +
            ".json"
    );
    f.requests[2].done(null, { meta: custom });
    assert.equal(result.item.id, id);
    f.instance.details("imdb:movie:tt1254207", (v) => (result = copy(v)));
    f.tick();
    f.requests[3].done(null, { meta: custom });
    assert.equal(result.error, "invalid_response");
});
test("generic unadvertised meta, malformed manifests and cancelled discovery stop before resource", () => {
    const no = genericFixture();
    let result;
    no.instance.details("imdb:movie:tt1254207", (v) => (result = copy(v)));
    no.requests[0].done(null, { ...genericManifest, resources: ["catalog"] });
    no.tick();
    assert.equal(result.ok, false);
    assert.equal(no.requests.length, 1);
    const bad = genericFixture();
    bad.instance.categories((v) => (result = copy(v)));
    bad.requests[0].done(null, { catalogs: [], resources: null });
    assert.equal(result.error, "invalid_response");
    const cancelled = genericFixture();
    const stop = cancelled.instance.load("popular", null, () =>
        assert.fail("stale")
    );
    stop();
    cancelled.requests[0].done(null, genericManifest);
    assert.equal(cancelled.requests.length, 1);
});
test("HTTP metadata bases allow exact literal loopback without DNS normalization", () => {
    for (const authority of [
        "localhost",
        "LOCALHOST:7000",
        "127.0.0.1:7000",
        "[::1]:7000",
    ]) {
        const f = fixture(undefined, true);
        const base = "http://" + authority + "/config";
        f.setEndpoint(base);
        f.instance.categories(() => {});
        assert.equal(f.requests[0].url, base + "/manifest.json");
    }
    for (const authority of [
        "localhost.evil",
        "a.localhost",
        "localhost.",
        "127.0.0.2",
        "127.1",
        "2130706433",
        "0x7f000001",
        "127.000.0.1",
        "[0:0:0:0:0:0:0:1]",
        "u:p@localhost",
        "localhost:99999",
    ]) {
        const f = fixture(undefined, true);
        f.setEndpoint("http://" + authority);
        let result;
        f.instance.categories((v) => (result = v));
        f.tick();
        assert.equal(f.requests.length, 0, authority);
        assert.equal(result.error, "invalid_request", authority);
    }
});
test("loopback metadata base retains the exact 4096-byte setting boundary", () => {
    const prefix = "http://localhost/";
    for (const length of [4096, 4097]) {
        const f = fixture(undefined, true);
        f.setEndpoint(prefix + "p".repeat(length - prefix.length));
        let result;
        f.instance.categories((v) => (result = v));
        f.tick();
        if (length === 4096) assert.equal(f.requests.length, 1);
        else {
            assert.equal(f.requests.length, 0);
            assert.equal(result.error, "invalid_request");
        }
    }
});
