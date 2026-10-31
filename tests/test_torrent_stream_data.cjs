const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const source = fs.readFileSync(
    path.join(__dirname, "../src/provider/torrent-stream-data.ts"),
    "utf8"
);
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
const copy = (v) => JSON.parse(JSON.stringify(v));
const first = "https://addon.example/config/manifest.json";
const second = "https://second.example/manifest.json";
const movie = { id: "tmdb:movie:10378", imdbId: "tt1254207" };
const direct = {
    name: "Big Buck Bunny",
    url: "https://media.example/BigBuckBunny.mp4",
};
const digest = (t) => crypto.createHash("sha256").update(t).digest("hex");
const manifest = (extra = {}) => ({
    id: "org.example.bbb",
    idPrefixes: ["tt"],
    name: "BBB",
    resources: ["stream"],
    types: ["movie"],
    ...extra,
});
function fixture(options = {}) {
    let urls = options.urls === undefined ? [first] : options.urls;
    let time = 0,
        next = 0,
        changes = 0;
    const timers = new Map(),
        requests = [],
        results = [];
    const forbidden = () =>
        assert.fail("Lookup must not use engine or storage");
    const host = {
        __ottMediaCompanion: { ensure: forbidden },
        crypto: options.noCrypto ? undefined : crypto.webcrypto,
        localStorage: { getItem: forbidden },
    };
    vm.runInNewContext(compiled, { Uint8Array, URL, window: host });
    const api = host.__ottTorrentStreamData.create({
        addons: () => urls,
        clearTimeout(id) {
            timers.delete(id);
        },
        now: () => time,
        onContextChanged: () => changes++,
        request(url, done) {
            const r = { aborted: 0, done, url };
            requests.push(r);
            return () => r.aborted++;
        },
        setTimeout(callback, delay) {
            const id = ++next;
            timers.set(id, { at: time + delay, callback });
            return id;
        },
        sha256: options.nativeHash
            ? undefined
            : options.sha256 || ((text, done) => done(null, digest(text))),
    });
    return {
        api,
        get changes() {
            return changes;
        },
        lookup(v = movie) {
            return api.lookup(v, (r) => results.push(copy(r)));
        },
        requests,
        results,
        setUrls(v) {
            urls = v;
        },
        tick(ms = 0) {
            time += ms;
            for (const [id, timer] of [...timers])
                if (timer.at <= time && timers.delete(id)) timer.callback();
        },
    };
}
function finish(f, streams = [direct], data = manifest()) {
    f.requests[0].done(null, data);
    f.requests[1].done(null, { streams });
    return f.results[0];
}
test("ES5 isolated factory; no addons makes no network or engine call", () => {
    acorn.parse(compiled, { ecmaVersion: 5 });
    assert.doesNotMatch(source, /^export\s/m);
    const f = fixture({ urls: "[]" });
    f.lookup();
    f.tick();
    assert.deepEqual(f.results, [{ error: "no_addons", ok: false }]);
    assert.equal(f.requests.length, 0);
});
test("configured paths trim and dedupe; invalid URL and byte limits fail", () => {
    const f = fixture({ urls: JSON.stringify([` ${first}/ `, first]) });
    f.lookup();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, first);
    for (const urls of [
        "{}",
        "[null]",
        Array(9).fill(first),
        [first + "?key=x"],
        ["http://example.com/manifest.json"],
        ["https://u:p@x/manifest.json"],
        ["https://x/%0a/manifest.json"],
        ["https://x/%zz/manifest.json"],
        ["https://x/" + "а".repeat(2100) + "/manifest.json"],
    ]) {
        const b = fixture({ urls });
        b.lookup();
        b.tick();
        assert.equal(b.results[0].error, "invalid_request");
        assert.equal(b.requests.length, 0);
    }
});
test("exact movie IDs and resource-specific prefix/type override", () => {
    for (const id of [
        "tmdb:movie:10378\n",
        "tmdb:tv:10378",
        "tt1254207",
        "tmdb:movie:0",
    ]) {
        const f = fixture();
        f.lookup({ id });
        f.tick();
        assert.equal(f.results[0].error, "invalid_request");
    }
    const f = fixture();
    f.lookup({ id: movie.id });
    finish(
        f,
        [direct],
        manifest({
            resources: [
                { idPrefixes: ["tmdb:"], name: "stream", types: ["movie"] },
            ],
            types: ["series"],
        })
    );
    assert.equal(
        f.requests[1].url,
        "https://addon.example/config/stream/movie/tmdb%3A10378.json"
    );
    const all = fixture();
    all.lookup({ id: movie.id });
    finish(
        all,
        [direct],
        manifest({ resources: [{ name: "stream", types: ["movie"] }] })
    );
    assert.equal(all.results[0].items.length, 1);
    const no = fixture();
    no.lookup({ id: movie.id });
    no.requests[0].done(null, manifest());
    assert.equal(no.requests.length, 1);
    assert.equal(no.results[0].unsupportedCount, 1);
});
test("IMDb URL and opaque IDs stay stable without caching stream responses", () => {
    const f = fixture();
    f.lookup();
    const r = finish(f, [{ ...direct, name: "<b>BBB</b>" }]);
    assert.equal(
        f.requests[1].url,
        "https://addon.example/config/stream/movie/tt1254207.json"
    );
    assert.equal(r.items[0].title, "<b>BBB</b>");
    assert.match(r.items[0].id, /^stremio:[a-f0-9]{64}$/);
    f.lookup();
    assert.equal(f.requests.length, 3);
    f.requests[2].done(null, { streams: [direct] });
    assert.equal(f.results[1].items[0].id, r.items[0].id);
    f.tick(300000);
    f.lookup();
    assert.equal(f.requests[3].url, first);
});
test("torrent trackers normalize but different indices and largest selection remain distinct", () => {
    const f = fixture();
    f.lookup();
    const h = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
    const b = {
        infoHash: h,
        sources: [
            "tracker:udp://x:80/a",
            "tracker:https://x/a",
            "tracker:udp://x:80/a",
            "dht:" + h,
        ],
    };
    const r = finish(f, [{ ...b, fileIdx: 0 }, { ...b, fileIdx: 1 }, b]);
    assert.equal(r.items.length, 3);
    assert.equal(new Set(r.items.map((i) => i.id)).size, 3);
    assert.equal(r.items[0].fileIndex, 0);
    assert.equal(r.items[2].fileSelection, "largest");
    assert.equal(
        r.items[0].source,
        "magnet:?xt=urn:btih:" +
            h.toLowerCase() +
            "&tr=" +
            encodeURIComponent("https://x/a") +
            "&tr=" +
            encodeURIComponent("udp://x:80/a")
    );
});
test("exact payload dedupe follows configured order and retains signed URL variants", () => {
    const f = fixture({ urls: [first, second] });
    f.lookup();
    f.requests[1].done(null, manifest({ id: "second" }));
    f.requests[2].done(null, { streams: [direct] });
    f.requests[0].done(null, manifest());
    f.requests[3].done(null, {
        streams: [
            direct,
            { ...direct, url: direct.url + "?token=one" },
            { ...direct, url: direct.url + "?token=two" },
        ],
    });
    assert.equal(f.results[0].items.length, 3);
    assert.equal(f.results[0].items[0].addon.id, "org.example.bbb");
});
test("unsupported DRM, headers and external media are not playable", () => {
    const f = fixture();
    f.lookup();
    const bad = [
        { externalUrl: direct.url },
        { ytId: "abc" },
        { ...direct, headers: {} },
        { ...direct, behaviorHints: { proxyHeaders: {} } },
        { ...direct, drm: {} },
        { ...direct, behaviorHints: { licenseUrl: "https://x" } },
        { ...direct, url: "file:///tmp/x" },
        { ...direct, url: "https://u:p@x/movie" },
        { ...direct, url: "https://x/movie|Referer=x" },
        { ...direct, infoHash: "a".repeat(40) },
        { fileIdx: -1, infoHash: "a".repeat(40) },
        { infoHash: "a".repeat(40), sources: ["tracker:javascript:alert(1)"] },
        { infoHash: "a".repeat(40) + "\n" },
    ];
    const r = finish(f, [
        ...bad,
        {
            ...direct,
            behaviorHints: { notWebReady: true },
            url: "http://x/movie.m3u8",
        },
    ]);
    assert.equal(r.items.length, 1);
    assert.equal(r.unsupportedCount, bad.length);
});
test("empty, unavailable and partial-failure outcomes differ", () => {
    const e = fixture();
    e.lookup();
    assert.deepEqual(finish(e, []), {
        failedAddons: 0,
        items: [],
        ok: true,
        unsupportedCount: 0,
    });
    const f = fixture();
    f.lookup();
    f.requests[0].done(new Error("private endpoint"));
    assert.deepEqual(f.results, [{ error: "unavailable", ok: false }]);
    const p = fixture({ urls: [first, second] });
    p.lookup();
    p.requests[1].done(true);
    p.requests[0].done(null, manifest());
    p.requests[2].done(null, { streams: [direct] });
    assert.equal(p.results[0].failedAddons, 1);
});
test("cancel, replacement, settings and disposal fence late callbacks", () => {
    const f = fixture();
    f.lookup();
    const stale = f.requests[0];
    const stop = f.lookup();
    assert.equal(stale.aborted, 1);
    stale.done(null, manifest());
    assert.equal(f.requests.length, 2);
    stop();
    f.requests[1].done(null, manifest());
    assert.equal(f.results.length, 0);
    f.lookup();
    f.setUrls([second]);
    f.requests[2].done(null, manifest());
    assert.equal(f.changes, 1);
    assert.equal(f.results.length, 0);
    assert.equal(f.requests[2].aborted, 1);
    f.requests[2].done(null, manifest());
    assert.equal(f.changes, 1);
    f.lookup();
    f.api.dispose();
    f.requests[3].done(null, manifest());
    assert.equal(f.results.length, 0);
    f.lookup();
    assert.equal(f.requests.length, 4);
});
test("timeouts detect configuration changes and abort exactly once", () => {
    const f = fixture();
    f.lookup();
    f.setUrls("[]");
    f.tick(15000);
    assert.equal(f.changes, 1);
    assert.equal(f.results.length, 0);
    assert.equal(f.requests[0].aborted, 1);
    const n = fixture();
    n.lookup();
    n.tick(15000);
    assert.equal(n.results[0].error, "unavailable");
    assert.equal(n.requests[0].aborted, 1);
});
test("response size and schema limits fail closed", () => {
    for (const r of [
        "x".repeat(65537),
        "{",
        [],
        manifest({ resources: [{ name: "stream", types: null }] }),
    ]) {
        const f = fixture();
        f.lookup();
        f.requests[0].done(null, r);
        assert.equal(f.results[0].error, "unavailable");
    }
    for (const streams of [
        Array(101).fill(direct),
        [{ ...direct, description: "x".repeat(262144) }],
        null,
    ]) {
        const f = fixture();
        f.lookup();
        assert.equal(finish(f, streams).error, "unavailable");
    }
});
test("digest is cancellable and bounded; collisions cannot select another source", () => {
    const pending = [];
    const f = fixture({ sha256: (text, done) => pending.push({ done, text }) });
    f.lookup();
    finish(f);
    f.setUrls("[]");
    pending[0].done(null, digest(pending[0].text));
    assert.equal(f.results.length, 0);
    assert.equal(f.changes, 1);
    const c = fixture({ sha256: (_t, done) => done(null, "a".repeat(64)) });
    c.lookup();
    assert.equal(
        finish(c, [direct, { ...direct, url: direct.url + "?x=1" }]).error,
        "unavailable"
    );
    const b = fixture({ sha256: () => {} });
    b.lookup();
    finish(b);
    b.tick(45000);
    assert.equal(b.results[0].error, "unavailable");
});
test("native WebCrypto yields deterministic opaque identity", async () => {
    const f = fixture({ nativeHash: true });
    f.lookup();
    finish(f);
    for (let i = 0; !f.results.length && i < 50; i++)
        await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(
        f.results[0].items[0].id,
        "stremio:" +
            digest(
                JSON.stringify([
                    first,
                    JSON.stringify(["url", direct.url, null]),
                ])
            )
    );
});
test("generic IMDb and opaque custom metadata IDs select their original resource IDs", () => {
    for (const [id, raw] of [
        ["imdb:movie:tt1254207", "tt1254207"],
        ["stremio:movie:custom%3Asome%2Fid", "custom:some/id"],
    ]) {
        const f = fixture();
        f.lookup({ id });
        finish(f, [direct], manifest({ idPrefixes: undefined }));
        assert.equal(
            f.requests[1].url,
            "https://addon.example/config/stream/movie/" +
                encodeURIComponent(raw) +
                ".json"
        );
    }
    const bad = fixture();
    bad.lookup({ id: "stremio:movie:custom%3asome" });
    bad.tick();
    assert.equal(bad.results[0].error, "invalid_request");
});
test("native URL validation matches IDN/config paths and invalid ports", () => {
    for (const url of [
        "https://täst.example/config/manifest.json",
        "https://addon.example/a|b/manifest.json",
        "https://addon.example/%7B%22key%22%3A%22x%20y%22%7D/manifest.json",
    ]) {
        const f = fixture({ urls: [url] });
        f.lookup();
        assert.equal(f.requests[0].url, url);
    }
    const bad = fixture({
        urls: ["https://addon.example:99999/manifest.json"],
    });
    bad.lookup();
    bad.tick();
    assert.equal(bad.results[0].error, "invalid_request");
});
test("missing WebCrypto fails without weak persistent IDs", () => {
    const f = fixture({ nativeHash: true, noCrypto: true });
    f.lookup();
    assert.equal(finish(f).error, "unavailable");
});
test("combined result count and normalized byte limits remain bounded", () => {
    for (const mode of ["count", "bytes"]) {
        const f = fixture({
            urls: [first, second, "https://third.example/manifest.json"],
        });
        f.lookup();
        for (let a = 0; a < 3; a++)
            f.requests[a].done(null, manifest({ id: "addon" + a }));
        for (let a = 0; a < 3; a++)
            f.requests[3 + a].done(null, {
                streams: Array.from(
                    { length: mode === "count" ? 100 : 80 },
                    (_, i) => ({
                        description: mode === "bytes" ? "d".repeat(600) : "",
                        name: "Movie",
                        url:
                            "https://media.example/" +
                            a +
                            "/" +
                            i +
                            (mode === "bytes" ? "x".repeat(2000) : ""),
                    })
                ),
            });
        assert.equal(f.results[0].error, "limit_exceeded");
    }
});
test("settings JSON is bounded to the shared 4096-byte wire limit", () => {
    const base = JSON.stringify([first]);
    const exact = fixture({
        urls: base + " ".repeat(4096 - Buffer.byteLength(base)),
    });
    exact.lookup();
    assert.equal(exact.requests.length, 1);
    const tooBig = fixture({
        urls: base + " ".repeat(4097 - Buffer.byteLength(base)),
    });
    tooBig.lookup();
    tooBig.tick();
    assert.equal(tooBig.results[0].error, "invalid_request");
    const urls = Array.from(
        { length: 8 },
        (_, i) =>
            "https://addon.example/" +
            i +
            "/" +
            "p".repeat(500) +
            "/manifest.json"
    );
    const array = fixture({ urls });
    array.lookup();
    array.tick();
    assert.equal(array.results[0].error, "invalid_request");
});
