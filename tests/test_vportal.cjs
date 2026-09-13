const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const helpersSource = fs.readFileSync(
    path.join(root, "src/utils/helpers.ts"),
    "utf8"
);
const helpersAst = ts.createSourceFile(
    "helpers.ts",
    helpersSource,
    ts.ScriptTarget.Latest,
    true
);
const helperText = helpersAst.statements
    .filter(
        (node) =>
            ts.isFunctionDeclaration(node) &&
            ["metadataText", "metadataImageUrl"].includes(node.name?.text)
    )
    .map((node) => node.getText(helpersAst))
    .join("\n");
const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/plugins/vportal.ts"), "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
const helpers = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(helperText, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText,
    helpers
);
const link = "portal::[key:fixture-private-key]http://portal.example/api/v1/";

function fixture(overrides = {}, options = {}) {
    const requests = [],
        alerts = [],
        played = [],
        dom = {};
    let active = true,
        client,
        selected,
        stopped = 0;
    const w = {
        _: (text) => text,
        _mediaLoadState: {},
        _playMedia(item) {
            client.cancel();
            played.push(item);
        },
        alert: (text) => alerts.push(text),
        closeList() {
            client.cancel();
            w._mediaLoadState = {};
        },
        host: "https://ott.example",
        keys: { ENTER: 4, EXIT: 2, RETURN: 1, STOP: 3 },
        medHistory: [],
        mediaName: "",
        mediaRecords: [],
        showSelectBox(index, labels, done, timeout) {
            assert.equal(
                timeout,
                -1,
                "Quality waits for explicit confirmation"
            );
            w.closeList();
            selected = { done, index, labels };
            w.selectBoxKeyHandler = (code) => {
                if (code === w.keys.ENTER) done(selected.index);
                return true;
            };
        },
        sPageSize: 30,
        stbStop() {
            stopped++;
            client.cancel();
        },
        ...overrides,
    };
    w.$ = (selector) => {
        dom[selector] ||= { text: "", visible: false };
        return {
            hide() {
                dom[selector].visible = false;
                return this;
            },
            html(text) {
                dom[selector].text = text;
                return this;
            },
            show() {
                dom[selector].visible = true;
                return this;
            },
        };
    };
    w.$.ajax = (options) => {
        const request = {
            abort() {
                this.aborted = true;
                options.error({}, "abort");
                options.complete();
            },
            fail() {
                options.error({ responseText: "fixture-private-key" }, "error");
                options.complete();
            },
            options,
            receive(value) {
                options.success(value);
                options.complete();
            },
        };
        requests.push(request);
        return request;
    };
    const context = { exports: {}, require: () => helpers.exports, window: w };
    vm.runInNewContext(compiled, context);
    client = context.exports.createVPortalClient(link, {
        isCurrent: () => active,
        title: "Fixture Library",
        ...options,
    });
    return {
        alerts,
        client,
        dom,
        parse: context.exports.parseVPortalLink,
        played,
        requests,
        selection: () => selected,
        setActive(value) {
            active = value;
        },
        stopped: () => stopped,
        w,
    };
}

{
    const f = fixture();
    assert.equal(f.parse(link).url, "http://portal.example/api/v1/");
    assert.equal(
        f.parse(" portal::%5Bkey:abc%5Dhttps://portal.example/api/%5Bid%5D/ ")
            .url,
        "https://portal.example/api/%5Bid%5D/"
    );
    for (const invalid of [
        "portal:[key:x]https://portal.example/api/",
        "portal::[key:]https://portal.example/api/",
        "portal::[key:x]file:///api/",
        "portal::[key:x]https://user:pass@portal.example/",
        "portal::[key:x]https://portal.example/#fragment",
        "portal::[key:x]https://portal.example/ trailing",
        "portal::[key:x\u0000]https://portal.example/",
        "portal::[key:x][https://portal.example/]",
        null,
    ])
        assert.equal(f.parse(invalid), null);
}

{
    const f = fixture();
    let completed = 0;
    f.client.load("", () => completed++);
    assert.equal(completed, 0, "Root request stays asynchronous");
    const request = f.requests[0];
    assert.equal(request.options.url, "https://ott.example/vportal/api");
    assert.equal(request.options.async, undefined);
    assert.equal(
        request.options.contentType,
        "application/json; charset=UTF-8"
    );
    assert.deepEqual(JSON.parse(request.options.data), {
        params: { app: "ott-play", key: "fixture-private-key", limit: 300 },
        url: "http://portal.example/api/v1/",
    });
    request.receive({
        controls: {
            filters: [
                {
                    items: [{ request: { year: 2026 }, title: "2026" }],
                    title: "Year",
                },
            ],
            search: true,
        },
        items: [
            {
                request: { cmd: "category", id: 4 },
                title: "Movies",
                type: "category",
            },
            {
                request: { cmd: "series", id: 5 },
                title: "Show",
                type: "multistream",
            },
            {
                description: "<img src=x onerror=bad()>",
                img: "javascript:alert(1)",
                request: { cmd: "play", id: 6 },
                title: "<script>bad</script>",
                type: "stream",
            },
            { type: "next" },
        ],
        type: "videoportal",
    });
    assert.equal(completed, 1);
    assert.equal(f.w.mediaName, "Fixture Library");
    assert.equal(f.w.mediaRecords.length, 6);
    const stream = f.w.mediaRecords[2];
    assert.equal(
        stream.stream_url,
        "vportal:request",
        "Request-only entries must be selectable"
    );
    assert.equal(stream.logo_30x30, "");
    assert(!stream.description.includes("<script>"));
    assert(!stream.description.includes("<img"));
    const next = f.w.mediaRecords[3];
    assert.equal(next.playlist_url.request.offset, 3);
    const filters = f.w.mediaRecords[5];
    f.client.load(filters.playlist_url, () => completed++);
    assert.equal(
        f.requests.length,
        1,
        "Filter menus do not fetch a remote URL"
    );
    f.client.load(f.w.mediaRecords[0].playlist_url, () => completed++);
    assert.equal(f.w.mediaRecords[0].title, "2026");
    f.client.load(f.w.mediaRecords[0].playlist_url, () => completed++);
    assert.equal(JSON.parse(f.requests[1].options.data).params.year, 2026);
    f.requests[1].receive({ items: [], type: "category" });
    f.client.load(next.playlist_url, () => {});
    assert.equal(JSON.parse(f.requests[2].options.data).params.offset, 3);
}

for (const native of [
    { __TAURI__: {} },
    { Capacitor: { isNativePlatform: () => true } },
]) {
    const f = fixture(native);
    f.client.load("", () => {});
    assert.equal(f.requests[0].options.url, "http://portal.example/api/v1/");
    assert.equal(f.requests[0].options.vportalRequest, true);
    assert.equal(
        JSON.parse(f.requests[0].options.data).key,
        "fixture-private-key"
    );
}
{
    const f = fixture({ Capacitor: { isNativePlatform: () => false } });
    f.client.load("", () => {});
    assert.equal(f.requests[0].options.url, "https://ott.example/vportal/api");
}

for (const query of [
    "Игра престолов",
    "a=b & c+d",
    "100%",
    "%D0%",
    "%ZZ + = &",
]) {
    const f = fixture();
    f.client.load("search?search=" + encodeURIComponent(query), () => {});
    assert.equal(JSON.parse(f.requests[0].options.data).params.query, query);
    f.requests[0].receive({ items: [], type: "category" });
    assert.equal(f.w.mediaName, "[" + query + "]");
}

{
    const f = fixture();
    let done = 0;
    const callback = () => done++;
    callback.isCurrent = () => false;
    f.client.load("", callback);
    assert.equal(f.requests.length, 0);
    callback.isCurrent = () => true;
    f.client.load("", callback);
    callback.isCurrent = () => false;
    f.requests[0].fail();
    assert.equal(f.alerts.length, 0, "Stale errors stay silent");
    assert.equal(done, 0);
    f.client.load("", () => done++);
    f.client.load("search?search=new", () => done++);
    assert(f.requests[1].aborted);
    f.requests[2].receive({
        items: [
            {
                title: "New",
                type: "stream",
                url: "https://cdn.example/new.mp4",
            },
        ],
        type: "category",
    });
    f.requests[1].receive({
        items: [
            {
                title: "Old",
                type: "stream",
                url: "https://cdn.example/old.mp4",
            },
        ],
        type: "category",
    });
    assert.equal(f.w.mediaRecords[0].title, "New");
    assert.equal(done, 1);
    f.client.load("", () => done++);
    f.setActive(false);
    f.requests[3].receive({ items: [], type: "category" });
    assert.equal(done, 1, "Settings/provider changes invalidate callback");
    assert.equal(f.w.mediaRecords[0].title, "New");
}

{
    const f = fixture();
    const item = {
        request: { cmd: "play", id: 1 },
        stream_url: "vportal:request",
        title: "Film",
    };
    f.w.medHistory = [
        { ...item, current: 120, stream_url: "https://cdn.example/old.mp4" },
    ];
    f.client.play(item);
    assert.equal(f.played.length, 0);
    f.requests[0].receive({
        type: "stream",
        url: "https://cdn.example/low.mp4",
        variants: {
            high: "https://cdn.example/high.mp4",
            low: "https://cdn.example/low.mp4",
        },
    });
    assert.equal(f.played.length, 0, "Resolution waits for quality selection");
    f.selection().index = f.selection().labels.indexOf("high");
    f.w.selectBoxKeyHandler(f.w.keys.ENTER);
    assert.equal(f.played.length, 1);
    assert.equal(f.played[0].stream_url, "https://cdn.example/high.mp4");
    assert.notEqual(
        f.played[0],
        item,
        "Playback receives a copy so core can compare the history URL"
    );
    assert.equal(item.stream_url, "vportal:request");
    assert.equal(f.w.medHistory[0].current, 120);
    assert.equal(f.w.medHistory[0].stream_url, "https://cdn.example/old.mp4");
    f.client.play(item);
    f.w.dialogBoxKeyHandler(f.w.keys.STOP);
    f.requests[1].receive({
        type: "stream",
        url: "https://cdn.example/late.mp4",
    });
    assert.equal(f.played.length, 1, "Stop cancels delayed playback");
    assert.equal(f.stopped(), 1);
}

{
    const f = fixture();
    const item = {
        request: { app: "bad-override", cmd: "play", key: "bad-override" },
        stream_url: "https://cdn.example/expired.mp4",
        title: "Film",
    };
    f.client.play(item);
    assert.equal(
        JSON.parse(f.requests[0].options.data).params.key,
        "fixture-private-key"
    );
    assert.equal(JSON.parse(f.requests[0].options.data).params.app, "ott-play");
    f.requests[0].receive({
        description: "echo fixture-private-key",
        type: "error",
    });
    assert.equal(
        f.played.length,
        0,
        "A failed resolution must not use an expired URL"
    );
    assert.deepEqual(f.alerts, ["VPortal request failed"]);
    f.client.play(item);
    f.requests[1].receive({
        url: "https://cdn.example/low.mp4",
        variants: {
            high: "https://cdn.example/high.mp4",
            low: "https://cdn.example/low.mp4",
        },
    });
    const lateSelect = f.selection().done;
    f.w.selectBoxKeyHandler(f.w.keys.RETURN);
    lateSelect(1);
    assert.equal(
        f.played.length,
        0,
        "A departed quality picker cannot start playback"
    );
    f.client.dispose();
    f.client.play(item);
    f.client.load("", () => {
        throw new Error("Disposed client completed");
    });
    assert.equal(f.requests.length, 2);
}

{
    const f = fixture({}, { sourceId: "source-a" });
    f.client.load("", () => {});
    f.requests[0].receive({
        controls: {
            filters: [
                {
                    items: [{ request: { year: 2026 }, title: "2026" }],
                    title: "Year",
                },
            ],
        },
        items: [
            { request: { cmd: "play" }, title: "Film", type: "stream" },
            { request: { cmd: "folder" }, title: "Folder", type: "category" },
            { type: "next" },
        ],
        type: "videoportal",
    });
    assert.equal(f.w.mediaRecords[0].vportalSource, "source-a");
    assert.equal(f.w.mediaRecords[1].playlist_url.vportalSource, "source-a");
    assert.equal(f.w.mediaRecords[2].playlist_url.vportalSource, "source-a");
    f.client.load(f.w.mediaRecords[3].playlist_url, () => {});
    assert.equal(f.w.mediaRecords[0].playlist_url.vportalSource, "source-a");
    f.client.load(f.w.mediaRecords[0].playlist_url, () => {});
    assert.equal(f.w.mediaRecords[0].playlist_url.vportalSource, "source-a");
    f.client.play({
        request: { cmd: "play" },
        title: "Old",
        vportalSource: "source-b",
    });
    f.client.load(
        { request: { cmd: "folder" }, vportalSource: "source-b" },
        () => {}
    );
    f.client.play({ request: { cmd: "play" }, title: "Unmarked history" });
    assert.equal(
        f.requests.length,
        1,
        "Old portal source requests are never sent with a new key"
    );
    assert.equal(f.alerts.length, 3);
}

console.log(
    "PASS VPortal parser, browser/native JSON transport, catalogue controls and paging, asynchronous lifecycle, quality and secret-safe failures"
);
