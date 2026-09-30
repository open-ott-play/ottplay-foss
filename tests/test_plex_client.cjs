const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { sourceFunctions } = require("./test_port_vod.cjs");
const root = path.resolve(__dirname, "..");
const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/plugins/plex.ts"), "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
const xmlParser = new JSDOM().window.DOMParser;
const token = "fixture-private-plex-token";
const source = "plex:fixture-account";
const film = {
    plexSource: source,
    request: { path: "/library/metadata/42" },
    stream_url: "plex:request",
    title: "Fixture",
};
function metadata(overrides = {}) {
    return {
        MediaContainer: {
            Metadata: [
                {
                    Media: [
                        {
                            audioCodec: "aac",
                            container: "mp4",
                            height: 1080,
                            Part: [{ key: "/library/parts/1/file.mp4" }],
                            videoCodec: "h264",
                            width: 1920,
                            ...overrides,
                        },
                    ],
                    ratingKey: "42",
                    type: "movie",
                },
            ],
        },
    };
}
function fixture(config = {}, capabilities = {}) {
    const requests = [],
        events = new Map(),
        keepalive = [],
        messages = [],
        intervals = new Map();
    let next = 0,
        active = true;
    const host = {
        $: {
            ajax(options) {
                const request = {
                    abort() {
                        this.aborted = true;
                        options.error?.({}, "abort");
                        options.complete?.();
                    },
                    aborted: false,
                    fail() {
                        options.error?.({ responseText: token }, "error");
                        options.complete?.();
                    },
                    options,
                    reply(data) {
                        options.success?.(data);
                        options.complete?.();
                    },
                };
                requests.push(request);
                return request;
            },
        },
        addEventListener(event, listener) {
            events.set(event, listener);
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        DOMParser: xmlParser,
        document: {
            createElement: () => ({
                canPlayType: capabilities.native || (() => ""),
            }),
        },
        fetch(url, options) {
            keepalive.push({ options, url });
            return {
                then(resolve) {
                    resolve?.();
                },
            };
        },
        Hls: { isSupported: () => capabilities.hls !== false },
        infoBox(message) {
            messages.push(message);
        },
        MediaSource: { isTypeSupported: capabilities.mse || (() => false) },
        mediaName: "untouched",
        mediaRecords: ["untouched"],
        removeEventListener(event, listener) {
            if (events.get(event) === listener) events.delete(event);
        },
        setInterval(run, delay) {
            intervals.set(++next, { delay, run });
            return next;
        },
    };
    const helpers = vm.createContext({});
    vm.runInContext(
        sourceFunctions("src/utils/helpers.ts", ["metadataText"]),
        helpers
    );
    const context = { exports: {}, require: () => helpers, window: host };
    vm.runInNewContext(compiled, context);
    const api = {
        createPlexClient: host.__ottPlex.create,
        normalizePlexConfig: host.__ottPlex.normalize,
    };
    const client = api.createPlexClient(
        { address: "https://plex.invalid", token, ...config },
        { isCurrent: () => active, sourceId: source }
    );
    return {
        api,
        client,
        events,
        host,
        intervals,
        keepalive,
        messages,
        requests,
        retire() {
            active = false;
        },
    };
}
let passed = 0;
function test(name, run) {
    run();
    console.log("PASS Plex client: " + name);
    passed++;
}
function last(f) {
    return f.requests.at(-1);
}
function parsed(f) {
    return new URL(last(f).options.url);
}

test("configuration is explicit, normalized and refuses embedded credentials or ambiguous addresses", () => {
    const f = fixture();
    for (const address of [
        "//plex.invalid",
        "file:///library",
        "http://user:password@plex.invalid",
        "http://plex.invalid?token=hidden",
        "http://plex.invalid/../admin",
        "http://plex.invalid/#fragment",
        "http://plex.invalid:0",
        "http://plex.invalid:65536",
        "http://[::1]:99999",
    ])
        assert.equal(f.api.normalizePlexConfig({ address, token }), null);
    assert.equal(
        f.api.normalizePlexConfig({
            address: "http://plex.invalid",
            token: "a\nb",
        }),
        null
    );
    assert.equal(
        f.api.normalizePlexConfig({
            server: " http://plex.invalid:32400/ ",
            token,
        }).address,
        "http://plex.invalid:32400"
    );
    assert.equal(
        f.api.normalizePlexConfig({
            address: "https://plex.invalid",
            playback: "unknown",
            token,
        }).playback,
        "auto"
    );
});

test("connect authenticates directly and cached sections do not mutate another catalog", () => {
    const f = fixture();
    let connected = false;
    f.client.connect((error) => {
        assert.equal(error, undefined);
        connected = true;
    });
    assert.equal(parsed(f).origin, "https://plex.invalid");
    assert.equal(parsed(f).pathname, "/library/sections");
    assert.equal(parsed(f).searchParams.get("X-Plex-Token"), token);
    last(f).reply(
        '<MediaContainer size="1"><Directory key="1" title="Fixture library" type="movie"/></MediaContainer>'
    );
    assert.equal(connected, true);
    assert.deepEqual(f.host.mediaRecords, ["untouched"]);
    f.client.load("", () => {});
    assert.equal(f.requests.length, 1);
    assert.equal(
        f.host.mediaRecords[0].playlist_url.path,
        "/library/sections/1/all"
    );
    assert(!JSON.stringify(f.host.mediaRecords).includes(token));
    const second = fixture({
        address: "http://other.invalid:32400",
        token: "different-private-token",
    });
    second.client.connect(() => {});
    assert.equal(parsed(second).origin, "http://other.invalid:32400");
    assert.equal(
        parsed(second).searchParams.get("X-Plex-Token"),
        "different-private-token"
    );
    assert.equal(parsed(f).origin, "https://plex.invalid");
});

test("JSON and XML folders recurse through Plex keys and shows/seasons retain stable IDs", () => {
    const f = fixture();
    f.client.load(
        { path: "/library/sections/1/all", plexSource: source },
        () => {}
    );
    last(f).reply({
        MediaContainer: {
            Directory: [
                { key: "/library/metadata/10", title: "Series", type: "show" },
            ],
        },
    });
    assert.equal(
        f.host.mediaRecords[0].playlist_url.path,
        "/library/sections/1/folder"
    );
    assert.equal(
        f.host.mediaRecords[1].playlist_url.path,
        "/library/metadata/10/children"
    );
    f.client.load(f.host.mediaRecords[0].playlist_url, () => {});
    last(f).reply({
        MediaContainer: {
            Metadata: [
                {
                    key: "/library/sections/1/folder?parent=17",
                    title: "Nested & folder",
                },
            ],
        },
    });
    f.client.load(f.host.mediaRecords[0].playlist_url, () => {});
    assert.equal(parsed(f).searchParams.get("parent"), "17");
    assert.equal(last(f).options.headers["X-Plex-Container-Start"], "0");
    last(f).reply(
        '<MediaContainer><Video ratingKey="42" title="Episode" summary="&lt;script&gt;not HTML&lt;/script&gt;" type="episode"/></MediaContainer>'
    );
    assert.equal(f.host.mediaRecords[0].request.path, "/library/metadata/42");
    assert.equal(f.host.mediaRecords[0].__ottMediaSequence, true);
    assert(!f.host.mediaRecords[0].description.includes("<script>"));
});

test("search pages flattened hub media locally and metadata uses PMS pagination headers", () => {
    const f = fixture();
    f.client.load("plexsearch?search=two%20words", () => {});
    assert.equal(parsed(f).searchParams.get("query"), "two words");
    assert.equal(parsed(f).searchParams.get("limit"), "200");
    assert.equal(last(f).options.headers["X-Plex-Container-Start"], "0");
    assert.equal(last(f).options.headers["X-Plex-Container-Size"], "1000");
    last(f).reply({
        MediaContainer: {
            Hub: [
                {
                    Metadata: Array.from({ length: 200 }, (_, index) => ({
                        ratingKey: String(index + 1),
                        title: "Fixture",
                        type: "movie",
                    })),
                },
                {
                    Metadata: [
                        { ratingKey: "201", title: "Last", type: "movie" },
                    ],
                },
            ],
            size: 2,
            totalSize: 2,
        },
    });
    assert.equal(f.host.mediaRecords.length, 201);
    const next = f.host.mediaRecords.at(-1).playlist_url;
    assert.equal(next.offset, 200);
    assert.equal(next.query, "two words");
    f.client.load(next, () => {});
    assert.equal(
        f.requests.length,
        1,
        "next search page reuses one bounded hub snapshot"
    );
    assert.equal(f.host.mediaRecords.length, 1);
    assert.equal(f.host.mediaRecords[0].request.path, "/library/metadata/201");
    f.client.load(
        { offset: 200, path: "/library/sections/1/all", plexSource: source },
        () => {}
    );
    assert.equal(last(f).options.headers["X-Plex-Container-Start"], "200");
    assert.equal(last(f).options.headers["X-Plex-Container-Size"], "200");
    last(f).reply({
        MediaContainer: {
            Metadata: [{ ratingKey: "202", title: "Last", type: "movie" }],
            size: 1,
            totalSize: 202,
        },
    });
    assert.equal(f.host.mediaRecords[0].request.path, "/library/metadata/202");
    assert.equal(f.host.mediaRecords.at(-1).playlist_url.offset, 201);
});

test("stale loads, retired profiles, unsafe keys and XML failures cannot publish or leak errors", () => {
    const f = fixture();
    let completed = 0;
    f.client.load("", () => completed++);
    const stale = last(f);
    f.client.load(
        { path: "/library/sections/1/all", plexSource: source },
        () => completed++
    );
    stale.reply({
        MediaContainer: { Directory: [{ key: "1", title: "stale" }] },
    });
    assert.equal(completed, 0);
    last(f).reply("<!DOCTYPE MediaContainer><MediaContainer/>");
    assert.equal(completed, 1);
    assert(!JSON.stringify(f.messages).includes(token));
    for (const path of [
        "//attacker.invalid/library/metadata/1",
        "/library/metadata/../admin",
        "/library/metadata/%2e%2e/admin",
        "/library/metadata/42?X-Plex-Token=leaked",
    ])
        f.client.load({ path, plexSource: source }, () => {});
    assert.equal(f.requests.length, 2);
    f.client.load("", () => completed++);
    f.retire();
    last(f).reply({ MediaContainer: {} });
    assert.equal(completed, 1);
});

test("native original admission resolves a fresh authenticated stream and persists only stable metadata", () => {
    const f = fixture({}, { native: () => "probably" });
    let played;
    f.client.resolve(film, (value) => (played = value));
    last(f).reply(metadata());
    assert.equal(f.requests.length, 1);
    assert.equal(played.__ottPlexPlayback.type, "file");
    assert.equal(played.__ottNativeFile, true);
    assert.equal(
        new URL(played.stream_url).searchParams.get("X-Plex-Token"),
        token
    );
    const saved = f.client.persist({
        ...played,
        nested: { artwork: played.stream_url, safe: "metadata" },
    });
    assert.equal(saved.stream_url, undefined);
    assert.equal(saved.__ottPlexPlayback, undefined);
    assert.equal(saved.request.path, film.request.path);
    assert.equal(saved.nested.safe, "metadata");
    assert(!JSON.stringify(saved).includes(token));
    f.client.resolve(saved, (value) => (played = value));
    last(f).reply(
        metadata({ Part: [{ key: "/library/parts/2/renewed.mp4" }] })
    );
    assert.equal(
        new URL(played.stream_url).pathname,
        "/library/parts/2/renewed.mp4"
    );
});

test("unknown native codec falls back to negotiated HLS and cancellation owns the nested decision request", () => {
    const f = fixture();
    let played = false;
    f.client.resolve(film, () => (played = true));
    last(f).reply(metadata());
    const decision = last(f);
    assert.equal(parsed(f).pathname, "/video/:/transcode/universal/decision");
    f.client.cancel();
    assert.equal(
        decision.aborted,
        true,
        "metadata completion must not clear its nested request owner"
    );
    decision.reply({ MediaContainer: { transcodeDecisionCode: 1001 } });
    assert.equal(played, false);
    assert.equal(f.intervals.size, 0);
    assert.equal(parsed(f).pathname, "/video/:/transcode/universal/stop");
});

test("HEVC HLS preserves source resolution only when the actual MSE codec is supported", () => {
    for (const [supported, hls] of [
        [false, true],
        [true, false],
        [true, true],
    ]) {
        const f = fixture({}, { hls, mse: () => supported });
        let played;
        f.client.resolve(film, (value) => {
            played = value;
        });
        last(f).reply(
            metadata({
                audioCodec: "opus",
                container: "mkv",
                height: 2160,
                videoCodec: "hevc",
                width: 3840,
            })
        );
        assert.equal(
            parsed(f).searchParams.get("videoResolution"),
            supported && hls ? "3840x2160" : "1920x1080"
        );
        assert.equal(
            parsed(f).searchParams.has("X-Plex-Client-Profile-Extra"),
            supported && hls
        );
        if (supported && hls)
            assert.equal(
                parsed(f).searchParams.get("X-Plex-Client-Profile-Extra"),
                "add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mp4&videoCodec=h264,hevc&audioCodec=aac&replace=true)"
            );
        last(f).reply({ MediaContainer: { transcodeDecisionCode: 1001 } });
        assert.equal(
            played.__ottPlexPlayback.engine,
            supported && hls ? "mse" : undefined
        );
        f.client.dispose();
    }
});

test("HLS heartbeat survives browsing, never overlaps, stops on replacement and cannot revive disposed playback", () => {
    const f = fixture();
    let played;
    f.client.resolve(film, (item) => (played = item));
    last(f).reply(metadata());
    const id = parsed(f).searchParams.get("session");
    last(f).reply({ MediaContainer: { transcodeDecisionCode: 1001 } });
    assert.equal(played.__ottPlexPlayback.type, "hls");
    assert.equal(new URL(played.stream_url).searchParams.get("session"), id);
    const timer = [...f.intervals.values()][0];
    assert.equal(timer.delay, 30000);
    f.client.load("", () => {});
    last(f).reply({ MediaContainer: {} });
    timer.run();
    const ping = last(f);
    const count = f.requests.length;
    timer.run();
    assert.equal(f.requests.length, count);
    f.client.stop("https://unrelated.invalid/video");
    assert.equal(f.intervals.size, 1);
    f.client.resolve(film, () => {});
    assert.equal(ping.aborted, true);
    assert.equal(f.intervals.size, 0);
    assert.equal(parsed(f).pathname, "/video/:/transcode/universal/stop");
    assert.equal(parsed(f).searchParams.get("session"), id);
    last(f).reply("");
    assert.equal(parsed(f).pathname, "/library/metadata/42");
    f.client.dispose();
    const disposed = f.requests.length;
    timer.run();
    assert.equal(f.requests.length, disposed);
});

test("explicit Original bypasses uncertain probes and connection failures expose fixed text only", () => {
    const f = fixture({ playback: "original" });
    let played;
    f.client.resolve(film, (item) => (played = item));
    last(f).reply(
        metadata({ audioCodec: "opus", container: "mkv", videoCodec: "hevc" })
    );
    assert.equal(played.__ottPlexPlayback.mime, "video/x-matroska");
    assert.equal(f.requests.length, 1);
    let error;
    f.client.connect((message) => (error = message));
    last(f).fail();
    assert.equal(error, "Plex connection failed");
    assert(!JSON.stringify(f.messages).includes(token));
});

test("pagehide releases only its owned session with a credential-free keepalive GET and dispose removes handler", () => {
    const f = fixture();
    f.client.resolve(film, () => {});
    last(f).reply(metadata());
    const session = parsed(f).searchParams.get("session");
    last(f).reply({ MediaContainer: { transcodeDecisionCode: 1001 } });
    const before = f.requests.length;
    f.events.get("pagehide")();
    assert.equal(f.intervals.size, 0);
    assert.equal(f.requests.length, before);
    assert.equal(f.keepalive.length, 1);
    assert.equal(
        new URL(f.keepalive[0].url).pathname,
        "/video/:/transcode/universal/stop"
    );
    assert.equal(
        new URL(f.keepalive[0].url).searchParams.get("session"),
        session
    );
    assert.equal(f.keepalive[0].options.credentials, "omit");
    assert.equal(f.keepalive[0].options.keepalive, true);
    assert.equal(f.keepalive[0].options.method, "GET");
    f.events.get("pagehide")();
    assert.equal(f.keepalive.length, 1);
    f.client.dispose();
    assert.equal(f.events.has("pagehide"), false);
});
console.log(`PASS Plex client (${passed} scenarios)`);
