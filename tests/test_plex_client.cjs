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
        intervals = new Map(),
        timers = new Map();
    let next = 0,
        clock = Date.now(),
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
        clearTimeout(id) {
            timers.delete(id);
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
        setTimeout(run) {
            timers.set(++next, run);
            return next;
        },
    };
    const helpers = vm.createContext({});
    vm.runInContext(
        sourceFunctions("src/utils/helpers.ts", ["metadataText"]),
        helpers
    );
    const context = {
        Date: { now: () => clock },
        exports: {},
        require: () => helpers,
        window: host,
    };
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
        advance(milliseconds) {
            clock += milliseconds;
        },
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
        tick() {
            const pending = [...timers.values()];
            timers.clear();
            pending.forEach((run) => run());
        },
        timers,
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
    assert.equal(f.host.mediaRecords[0].title, "Browse folders");
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

test("catalog labels stay nonblank without exposing filesystem parents or changing paging", () => {
    const f = fixture();
    f.client.load(
        { path: "/library/sections/1/all", plexSource: source },
        () => {}
    );
    last(f).reply({
        MediaContainer: {
            Metadata: [
                {
                    name: " Name\t label ",
                    ratingKey: "1",
                    title: " \n ",
                    type: "movie",
                },
                {
                    originalTitle: " Original ",
                    ratingKey: "2",
                    titleSort: "Sort",
                    type: "movie",
                },
                { ratingKey: "3", titleSort: " Sort ", type: "movie" },
                {
                    Media: [{ Part: [{ file: "/private/parents/File.mp4" }] }],
                    ratingKey: "4",
                    type: "movie",
                },
                {
                    Media: [
                        { Part: [{ file: "C:\\private\\parents\\Other.mkv" }] },
                    ],
                    ratingKey: "5",
                    type: "movie",
                },
                {
                    Media: [
                        {
                            Part: [
                                { file: "https://host.invalid/private/token" },
                            ],
                        },
                    ],
                    ratingKey: "6",
                    type: "movie",
                },
                { key: "/library/sections/1/folder?parent=2", title: "\t" },
                { ratingKey: "7", title: "", type: "episode" },
            ],
            size: 8,
            totalSize: 9,
        },
    });
    assert.deepEqual(
        Array.from(f.host.mediaRecords, (row) => row.title),
        [
            "Browse folders",
            "Name label",
            "Original",
            "Sort",
            "File.mp4",
            "Other.mkv",
            "Untitled",
            "Untitled folder",
            "Untitled",
            "Next",
        ]
    );
    assert.equal(f.host.mediaRecords.at(-1).playlist_url.offset, 8);
    assert.equal(
        f.host.mediaRecords[7].playlist_url.path,
        "/library/sections/1/folder?parent=2"
    );
    assert(!JSON.stringify(f.host.mediaRecords).includes("private"));
    f.client.load("", () => {});
    last(f).reply({
        MediaContainer: {
            Directory: [{ key: "1", title: "  ", type: "movie" }],
        },
    });
    assert.equal(
        f.host.mediaRecords[0].title,
        "Untitled folder",
        "an unnamed movie library is a directory, not a playable movie"
    );
});

test("collection capability uses the same flat route contract as collection", () => {
    const f = fixture();
    for (const target of [
        "",
        null,
        undefined,
        { path: "/library/sections", plexSource: source },
        { offset: 200, path: "/library/sections/1/all", plexSource: source },
        { path: "/library/sections/1/folder?parent=17", plexSource: source },
        { path: "/library/metadata/42/children", plexSource: source },
    ]) {
        assert.equal(f.client.canCollect(target), true);
        const count = f.requests.length;
        let result;
        f.client.collect(target, (value) => (result = value));
        assert.equal(f.requests.length, count + 1);
        last(f).reply({ MediaContainer: { size: 0, totalSize: 0 } });
        assert.equal(result.error, undefined);
    }
    for (const target of [
        "plexsearch?search=film",
        { path: "/hubs/search", plexSource: source, query: "film" },
        { path: "/library/metadata/42", plexSource: source },
        { path: "/library/parts/1/file.mp4", plexSource: source },
        { path: "/library/sections/1/all", plexSource: "other" },
        {
            path: "/library/sections/1/all?X-Plex-Token=other",
            plexSource: source,
        },
    ]) {
        const count = f.requests.length;
        assert.equal(f.client.canCollect(target), false);
        let result;
        f.client.collect(target, (value) => (result = value));
        assert.equal(result.error, "Unable to load playlist");
        assert.equal(f.requests.length, count);
    }
});

test("movies and clips retain title filtering while episode and track sequence markers remain unchanged", () => {
    const rows = ["movie", "clip", "episode", "track"].map((type, index) => ({
        ratingKey: String(index + 1),
        title: type,
        type,
    }));
    for (const path of [
        "/library/sections/1/all",
        "/library/sections/1/folder?parent=17",
        "/library/metadata/42/children",
    ]) {
        const f = fixture();
        f.client.load({ path, plexSource: source }, () => {});
        last(f).reply({ MediaContainer: { Metadata: rows } });
        const playable = f.host.mediaRecords.filter((record) => record.request);
        assert.equal(playable.length, 4);
        assert.deepEqual(
            Array.from(playable, (record) => record.__ottMediaSequence),
            [false, false, true, true]
        );
    }
    for (const target of ["", "plexsearch?search=film"]) {
        const f = fixture();
        f.client.load(target, () => {});
        last(f).reply({ MediaContainer: { Metadata: rows } });
        const playable = f.host.mediaRecords.filter((record) => record.request);
        assert.equal(playable.length, 4);
        assert.deepEqual(
            Array.from(playable, (record) => record.__ottMediaSequence),
            [false, false, true, true]
        );
    }
});

test("collection starts at zero, deduplicates flat playable pages and does not disturb a visible load", () => {
    const f = fixture();
    f.client.load("", () => {});
    const navigation = last(f);
    const projection = f.host.mediaRecords;
    let result;
    f.client.collect(
        {
            offset: 400,
            path: "/library/sections/1/folder?parent=17",
            plexSource: source,
        },
        (value) => (result = value)
    );
    assert.equal(last(f).options.headers["X-Plex-Container-Start"], "0");
    assert.equal(parsed(f).searchParams.get("parent"), "17");
    assert.equal(navigation.aborted, false);
    last(f).reply({
        MediaContainer: {
            Metadata: [
                { ratingKey: "42", title: "Film", type: "movie" },
                { key: "/library/sections/1/folder?parent=18", title: "Child" },
                { ratingKey: "43", title: "Episode", type: "episode" },
            ],
            offset: 0,
            size: 3,
            totalSize: 5,
        },
    });
    assert.equal(result, undefined);
    assert.equal(f.host.mediaRecords, projection);
    f.tick();
    assert.equal(last(f).options.headers["X-Plex-Container-Start"], "3");
    last(f).reply({
        MediaContainer: {
            Metadata: [
                { ratingKey: "43", title: "Duplicate", type: "episode" },
                { ratingKey: "44", title: "Track", type: "track" },
            ],
            offset: 3,
            size: 2,
            totalSize: 5,
        },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(
        Array.from(result.items, (row) => row.request.path),
        ["/library/metadata/42", "/library/metadata/43", "/library/metadata/44"]
    );
    assert(
        result.items.every(
            (row) => row.stream_url === "plex:request" && !row.playlist_url
        )
    );
    assert.deepEqual(
        Array.from(result.records, (row) => row.title),
        ["Film", "Child", "Episode", "Track"]
    );
    assert.deepEqual(
        Array.from(result.items, (row) => row.__ottMediaSequence),
        [false, true, true]
    );
    assert.equal(
        result.records[1].playlist_url.path,
        "/library/sections/1/folder?parent=18"
    );
    assert.equal(
        f.requests.length,
        3,
        "does not recurse into the child directory"
    );
    navigation.reply({
        MediaContainer: {
            Directory: [{ key: "1", title: "Library", type: "movie" }],
        },
    });
    assert.equal(
        f.host.mediaRecords[0].title,
        "Library",
        "collection did not invalidate the navigation revision"
    );
});

test("complete catalog records retain deduplicated subfolders and omit synthetic navigation", () => {
    const f = fixture();
    const child = { key: "/library/metadata/10", title: "Child", type: "show" };
    let result;
    f.client.collect(
        { path: "/library/sections/1/all", plexSource: source },
        (value) => (result = value)
    );
    last(f).reply({
        MediaContainer: {
            Metadata: [
                { ratingKey: "42", title: "First", type: "movie" },
                child,
                { key: "/library/metadata/11", title: "Browse folders" },
            ],
            offset: 0,
            size: 3,
            totalSize: 6,
        },
    });
    assert.equal(result, undefined, "Never expose a partial folder");
    f.tick();
    last(f).reply({
        MediaContainer: {
            Metadata: [
                { ...child, title: "Duplicate child" },
                { ratingKey: "43", title: "Second", type: "clip" },
                { key: "/library/metadata/12", title: "Next" },
            ],
            offset: 3,
            size: 3,
            totalSize: 6,
        },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(
        Array.from(result.records, (record) => record.title),
        ["First", "Child", "Browse folders", "Second", "Next"],
        "Real folders with navigation-like titles must remain visible"
    );
    assert.deepEqual(
        Array.from(result.items, (record) => record.request.path),
        ["/library/metadata/42", "/library/metadata/43"]
    );
    const folders = result.records.filter((record) => record.playlist_url);
    assert.deepEqual(
        Array.from(folders, (record) => record.playlist_url.path),
        [
            "/library/metadata/10/children",
            "/library/metadata/11/children",
            "/library/metadata/12/children",
        ]
    );
    assert(folders.every((record) => record.playlist_url.offset === undefined));
    assert.equal(f.requests.length, 2, "Collection never visits child folders");
    assert(!JSON.stringify(result).includes(token));

    const root = fixture();
    root.client.collect("", (value) => (result = value));
    last(root).reply({
        MediaContainer: {
            Directory: [
                { key: "1", title: "Movies", type: "movie" },
                { key: "2", title: "Shows", type: "show" },
            ],
            size: 2,
            totalSize: 2,
        },
    });
    assert.equal(result.items.length, 0);
    assert.deepEqual(
        Array.from(result.records, (record) => record.title),
        ["Movies", "Shows"]
    );
    assert(
        result.records.every(
            (record) => typeof record.playlist_url === "object"
        )
    );
});

test("unknown totals require an empty terminal page and incomplete collections never return partial items", () => {
    const target = { path: "/library/sections/1/all", plexSource: source };
    const row = { ratingKey: "42", title: "Film", type: "movie" };
    const f = fixture();
    let result;
    f.client.collect(target, (value) => (result = value));
    last(f).reply({ MediaContainer: { Metadata: [row], size: 1 } });
    assert.equal(
        result,
        undefined,
        "short pages without a total do not prove completeness"
    );
    f.tick();
    assert.equal(last(f).options.headers["X-Plex-Container-Start"], "1");
    last(f).reply({ MediaContainer: { Metadata: [], size: 0 } });
    assert.equal(result.items.length, 1);
    for (const broken of [
        { Metadata: [row], offset: 0, size: 1, totalSize: 2 }, // repeated page/ignored offset
        { Metadata: [], offset: 1, size: 0, totalSize: 2 }, // promised data missing
        {
            Metadata: [{ ...row, ratingKey: "43" }],
            offset: 1,
            size: 1,
            totalSize: 3,
        }, // snapshot changes
        { Metadata: [row], offset: 1, size: 2, totalSize: 2 }, // inconsistent size
    ]) {
        const g = fixture();
        let failed;
        g.client.collect(target, (value) => (failed = value));
        last(g).reply({
            MediaContainer: {
                Metadata: [row],
                offset: 0,
                size: 1,
                totalSize: 2,
            },
        });
        g.tick();
        last(g).reply({ MediaContainer: broken });
        assert.equal(failed.error, "Unable to load playlist");
        assert.equal(failed.items.length, 0);
        assert.equal(failed.records.length, 0);
        assert.equal(g.timers.size, 0);
    }
    const g = fixture();
    let failed;
    g.client.collect(target, (value) => (failed = value));
    last(g).reply({
        MediaContainer: { Metadata: [row], size: 1, totalSize: 100001 },
    });
    assert.equal(failed.items.length, 0);
    assert.equal(failed.error, "Unable to load playlist");
});

test("collection cancellation, profile retirement and overlapping requests suppress late results", () => {
    const target = {
        path: "/library/metadata/10/children",
        plexSource: source,
    };
    const page = {
        MediaContainer: {
            Metadata: [{ ratingKey: "42", title: "Episode", type: "episode" }],
            size: 1,
            totalSize: 2,
        },
    };
    for (const method of [
        "returned",
        "dispose",
        "pagehide",
        "guard",
        "supersede",
    ]) {
        const f = fixture();
        let callbacks = 0,
            allowed = true;
        const cancel = f.client.collect(
            target,
            () => callbacks++,
            () => allowed
        );
        const request = last(f);
        if (method === "returned") cancel();
        if (method === "dispose") f.client.dispose();
        if (method === "pagehide") f.events.get("pagehide")();
        if (method === "guard") allowed = false;
        if (method === "supersede") f.client.collect(target, () => {});
        request.reply(page);
        f.tick();
        assert.equal(callbacks, 0, method);
        assert.equal(request.aborted, true, method);
    }
    const f = fixture();
    let callbacks = 0;
    const cancel = f.client.collect(target, () => callbacks++);
    last(f).reply(page);
    assert.equal(f.timers.size, 1);
    cancel();
    f.tick();
    assert.equal(f.requests.length, 1);
    assert.equal(callbacks, 0);
    assert.equal(f.host.mediaName, "untouched");
});

test("collection transport errors and unsupported targets fail safely without partial queues", () => {
    const f = fixture();
    let result;
    f.client.collect(
        { path: "/library/sections/1/all", plexSource: source },
        (value) => (result = value)
    );
    last(f).fail();
    assert.equal(result.error, "Unable to load playlist");
    assert.equal(result.items.length, 0);
    assert(!JSON.stringify(result).includes(token));
    for (const target of [
        "plexsearch?search=film",
        { path: "/hubs/search", plexSource: source, query: "film" },
        { path: "/library/parts/1/file", plexSource: source },
        { path: "/library/sections/1/all", plexSource: "other" },
    ]) {
        const count = f.requests.length;
        f.client.collect(target, (value) => (result = value));
        assert.equal(result.error, "Unable to load playlist");
        assert.equal(f.requests.length, count);
    }
});

test("collection time, page and retained data budgets fail closed", () => {
    const target = { path: "/library/sections/1/all", plexSource: source };
    const timed = fixture();
    let expired;
    timed.client.collect(target, (value) => (expired = value));
    assert.equal(last(timed).options.timeout, 30000);
    timed.advance(120001);
    last(timed).reply({ MediaContainer: { size: 0, totalSize: 0 } });
    assert.equal(expired.error, "Unable to load playlist");
    assert.equal(expired.items.length, 0);

    const paged = fixture();
    let limited;
    paged.client.collect(target, (value) => (limited = value));
    for (let index = 0; index < 1000; index++) {
        last(paged).reply({
            MediaContainer: {
                Directory: [
                    { key: "/library/metadata/" + index, title: "Folder" },
                ],
                offset: index,
                size: 1,
                totalSize: 1001,
            },
        });
        paged.tick();
    }
    assert.equal(limited.error, "Unable to load playlist");
    assert.equal(limited.items.length, 0);
    assert.equal(paged.requests.length, 1000);

    const large = fixture();
    let overflow;
    large.client.collect(target, (value) => (overflow = value));
    for (let index = 0; index < 2; index++) {
        last(large).reply({
            MediaContainer: {
                Metadata: [
                    {
                        ratingKey: String(index + 1),
                        summary: "x".repeat(5 * 1024 * 1024),
                        title: "Film",
                        type: "movie",
                    },
                ],
                offset: index,
                size: 1,
                totalSize: 2,
            },
        });
        large.tick();
    }
    assert.equal(overflow.error, "Unable to load playlist");
    assert.equal(overflow.items.length, 0);
    assert.equal(overflow.records.length, 0);
});

test("retained folder metadata shares the collection byte budget and never escapes as a partial catalog", () => {
    const f = fixture();
    let result;
    f.client.collect(
        { path: "/library/sections/1/folder?parent=17", plexSource: source },
        (value) => (result = value)
    );
    for (let index = 0; index < 2; index++) {
        last(f).reply({
            MediaContainer: {
                Directory: [
                    {
                        key:
                            "/library/sections/1/folder?parent=" + (index + 18),
                        summary: "x".repeat(5 * 1024 * 1024),
                        title: "Child " + index,
                    },
                ],
                offset: index,
                size: 1,
                totalSize: 2,
            },
        });
        f.tick();
    }
    assert.equal(result.error, "Unable to load playlist");
    assert.equal(result.records.length, 0);
    assert.equal(result.items.length, 0);
    assert.equal(f.timers.size, 0);
});

test("synchronous collection responses yield between pages and navigation cancellation stays separate", () => {
    const f = fixture();
    const pages = [];
    f.host.$.ajax = (options) => {
        const offset = Number(options.headers["X-Plex-Container-Start"]);
        pages.push(offset);
        options.success({
            MediaContainer: {
                Metadata: [
                    {
                        ratingKey: String(offset + 1),
                        title: "Film",
                        type: "movie",
                    },
                ],
                offset,
                size: 1,
                totalSize: 2,
            },
        });
        return {
            abort: () => assert.fail("completed request must not be aborted"),
        };
    };
    let result;
    f.client.collect(
        { path: "/library/sections/1/all", plexSource: source },
        (value) => (result = value)
    );
    assert.deepEqual(pages, [0]);
    f.client.cancel();
    f.tick();
    assert.deepEqual(pages, [0, 1]);
    assert.equal(result.items.length, 2);
    assert.equal(f.host.mediaName, "untouched");
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

test("resolution failures return null once so cold restore can fall back to its catalog", () => {
    const cases = [
        { item: null },
        { item: { ...film, plexSource: "another-account" } },
        { item: { ...film, request: { path: "/library/metadata/../admin" } } },
        { reply: { MediaContainer: {} } },
        { reply: metadata({ Part: [] }) },
        {
            reply: metadata({
                Part: [{ key: "https://foreign.invalid/file" }],
            }),
        },
        { reply: "<!DOCTYPE MediaContainer><MediaContainer/>" },
        { fail: true },
        { decision: { MediaContainer: { transcodeDecisionCode: 2001 } } },
        { decision: "<broken" },
        { decisionFail: true },
    ];
    for (const scenario of cases) {
        const f = fixture();
        const resolved = [];
        f.client.resolve(
            Object.hasOwn(scenario, "item") ? scenario.item : film,
            (value) => resolved.push(value)
        );
        if (Object.hasOwn(scenario, "item")) {
            assert.equal(f.requests.length, 0);
        } else {
            const metadataRequest = last(f);
            if (scenario.fail) metadataRequest.fail();
            else if (scenario.decision || scenario.decisionFail) {
                metadataRequest.reply(metadata());
                const decision = last(f);
                if (scenario.decisionFail) decision.fail();
                else decision.reply(scenario.decision);
                assert.equal(
                    parsed(f).pathname,
                    "/video/:/transcode/universal/stop"
                );
                decision.fail();
                decision.reply({
                    MediaContainer: { transcodeDecisionCode: 1001 },
                });
            } else metadataRequest.reply(scenario.reply);
            metadataRequest.fail();
            metadataRequest.reply(metadata());
        }
        assert.deepEqual(resolved, [null]);
        assert.deepEqual(f.messages, ["Plex connection failed"]);
        assert.equal(f.intervals.size, 0);
        assert(!JSON.stringify(f.messages).includes(token));
        assert.equal(f.host.mediaName, "untouched");
        assert.deepEqual(f.host.mediaRecords, ["untouched"]);
    }
});

test("resolution fallback cannot run after cancellation, replacement, retirement or reentrant navigation", () => {
    for (const decisionStage of [false, true]) {
        for (const action of [
            "cancel",
            "replace",
            "retire",
            "dispose",
            "pagehide",
        ]) {
            const f = fixture();
            let callbacks = 0;
            f.client.resolve(film, () => callbacks++);
            if (decisionStage) last(f).reply(metadata());
            const pending = last(f);
            if (action === "replace") f.client.load("", () => {});
            else if (action === "retire") f.retire();
            else if (action === "pagehide") f.events.get("pagehide")();
            else f.client[action]();
            pending.fail();
            pending.reply(
                decisionStage
                    ? { MediaContainer: { transcodeDecisionCode: 2001 } }
                    : { MediaContainer: {} }
            );
            assert.equal(callbacks, 0, action);
            assert.equal(f.messages.length, 0, action);
            assert.equal(f.intervals.size, 0, action);
        }
    }
    const f = fixture();
    let callbacks = 0;
    f.host.infoBox = () => f.retire();
    f.client.resolve(film, () => callbacks++);
    last(f).fail();
    assert.equal(
        callbacks,
        0,
        "the visible failure retired the source before fallback"
    );
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
test("cursor rows are explicit and selected folder titles override generic server labels", () => {
    const f = fixture();
    f.client.load(
        {
            path: "/library/sections/1/folder?parent=9",
            plexSource: source,
            title: "Actual folder",
        },
        () => {}
    );
    last(f).reply({
        MediaContainer: {
            Directory: [
                { key: "/library/sections/1/folder?parent=10", title: "Next" },
            ],
            size: 1,
            title1: "Folder",
            title2: "Folder",
            totalSize: 2,
        },
    });
    assert.equal(f.host.mediaName, "Actual folder");
    assert.equal(f.host.mediaRecords[0].__ottMediaNext, undefined);
    const next = f.host.mediaRecords[1];
    assert.equal(next.__ottMediaNext, true);
    assert.equal(next.playlist_url.title, "Actual folder");
    let following;
    f.client.page(next.playlist_url, (value) => (following = value));
    last(f).reply({
        MediaContainer: {
            Directory: [
                {
                    key: "/library/sections/1/folder?parent=11",
                    title: "Same name",
                },
                {
                    key: "/library/sections/1/folder?parent=12",
                    title: "Same name",
                },
            ],
            offset: 1,
            size: 2,
            totalSize: 3,
        },
    });
    assert.equal(following.items.length, 2);
    assert.notEqual(
        following.items[0].playlist_url.path,
        following.items[1].playlist_url.path
    );
    assert(!following.items.some((row) => row.__ottMediaNext));
    f.client.collect(
        { path: "/library/sections/1/all", plexSource: source },
        (value) => {
            assert(!value.records.some((row) => row.__ottMediaNext));
        }
    );
    last(f).reply({
        MediaContainer: {
            Metadata: [{ ratingKey: "1", title: "Film", type: "movie" }],
            size: 1,
            totalSize: 1,
        },
    });
});

test("quiet pages do not mutate navigation or cancel resolve and full collection", () => {
    const f = fixture({ playback: "original" });
    const target = {
        offset: 200,
        path: "/library/sections/1/all",
        plexSource: source,
        title: "Chosen folder",
    };
    let paged, played, collected;
    f.client.page(target, (value) => (paged = value));
    const page = last(f);
    assert.equal(page.options.headers["X-Plex-Container-Start"], "200");
    assert.equal(page.options.headers["X-Plex-Container-Size"], "200");
    f.client.resolve(film, (value) => (played = value));
    const resolve = last(f);
    f.client.collect({ ...target, offset: 0 }, (value) => (collected = value));
    const collect = last(f);
    page.reply({
        MediaContainer: {
            Metadata: [{ ratingKey: "43", title: "Following", type: "movie" }],
            offset: 200,
            size: 1,
            title2: "Folder",
            totalSize: 202,
        },
    });
    resolve.reply(metadata());
    collect.reply({ MediaContainer: { Metadata: [], size: 0, totalSize: 0 } });
    assert.equal(paged.items[0].request.path, "/library/metadata/43");
    assert.equal(paged.items[1].__ottMediaNext, true);
    assert.equal(paged.items[1].playlist_url.title, "Chosen folder");
    assert(played.stream_url);
    assert.equal(collected.items.length, 0);
    assert(!page.aborted && !resolve.aborted && !collect.aborted);
    assert.deepEqual(f.host.mediaRecords, ["untouched"]);
    assert.equal(f.host.mediaName, "untouched");
    assert.deepEqual(f.messages, []);
});

test("page errors are terminal and sanitized while cancellation or source retirement suppress late callbacks", () => {
    const target = {
        offset: 200,
        path: "/library/sections/1/all",
        plexSource: source,
    };
    for (const action of [
        "cancel",
        "supersede",
        "dispose",
        "pagehide",
        "retire",
    ]) {
        const f = fixture();
        let callbacks = 0;
        const cancel = f.client.page(target, () => callbacks++);
        const pending = last(f);
        if (action === "cancel") cancel();
        if (action === "supersede") f.client.page(target, () => {});
        if (action === "dispose") f.client.dispose();
        if (action === "pagehide") f.events.get("pagehide")();
        if (action === "retire") f.retire();
        pending.reply({ MediaContainer: {} });
        pending.fail();
        assert.equal(callbacks, 0, action);
        if (action !== "retire") assert(pending.aborted, action);
        assert.deepEqual(f.messages, []);
    }
    for (const reply of [
        null,
        "invalid " + token,
        { MediaContainer: { Metadata: [], offset: 0 } },
    ]) {
        const f = fixture();
        const values = [];
        f.client.page(target, (value) => values.push(value));
        if (reply === null) last(f).fail();
        else last(f).reply(reply);
        last(f).fail();
        assert.equal(values.length, 1);
        assert.equal(values[0].items.length, 0);
        assert(values[0].error);
        assert(!JSON.stringify(values).includes(token));
        assert.deepEqual(f.messages, []);
    }
    const retired = fixture();
    retired.client.dispose();
    retired.client.page(target, () => assert.fail("disposed page callback"));
    assert.equal(retired.requests.length, 0);
});

test("independent search paging reuses the flattened snapshot without publishing globals", () => {
    const f = fixture();
    f.client.load("plexsearch?search=Find", () => {});
    last(f).reply({
        MediaContainer: {
            Hub: [
                {
                    Metadata: Array.from({ length: 205 }, (_, i) => ({
                        ratingKey: String(i),
                        title: "Found " + i,
                        type: "movie",
                    })),
                },
            ],
        },
    });
    const before = JSON.stringify(f.host.mediaRecords);
    const cursor = f.host.mediaRecords.find(
        (row) => row.__ottMediaNext
    ).playlist_url;
    let result;
    f.client.page(cursor, (value) => (result = value));
    assert.equal(result.items.length, 5);
    assert(!result.items.some((row) => row.__ottMediaNext));
    assert.equal(f.requests.length, 1);
    assert.equal(JSON.stringify(f.host.mediaRecords), before);
});

test("page abort reentry preserves the newer page and never dispatches the interrupted request", () => {
    const f = fixture();
    const target = {
        offset: 200,
        path: "/library/sections/1/all",
        plexSource: source,
    };
    f.client.page(target, () => assert.fail("old page"));
    const old = last(f);
    const abort = old.abort.bind(old);
    let latest;
    old.abort = () => {
        abort();
        f.client.page({ ...target, offset: 600 }, (value) => (latest = value));
    };
    f.client.page({ ...target, offset: 400 }, () =>
        assert.fail("interrupted page")
    );
    assert.equal(f.requests.length, 2);
    assert.equal(parsed(f).searchParams.get("X-Plex-Container-Start"), "600");
    last(f).reply({ MediaContainer: { offset: 600, size: 0, totalSize: 600 } });
    assert.equal(latest.items.length, 0);
});

console.log(`PASS Plex client (${passed} scenarios)`);
