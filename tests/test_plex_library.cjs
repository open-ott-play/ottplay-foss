const assert = require("node:assert/strict");
const vm = require("node:vm");
const { fixture, sourceFunctions } = require("./test_port_vod.cjs");

function create() {
    const c = fixture();
    const loads = [];
    const resolutions = [];
    c.p_pref = "plex";
    c.sFavorites = 1;
    c.cList = [];
    c.stbGetItem = (key) => c.stored[key] ?? null;
    c.getMediaArray = (target, done) => {
        loads.push(target);
        const depth = Number(target?.depth || 0);
        c.mediaName = depth ? "Folder " + depth : "Plex";
        c.mediaRecords =
            depth < 4
                ? [
                      {
                          playlist_url: { depth: depth + 1 },
                          title: "Folder " + (depth + 1),
                      },
                  ]
                : [
                      {
                          itemId: "42",
                          request: { path: "/library/metadata/42" },
                          title: "Film",
                      },
                  ];
        done();
    };
    c.providerMediaClient = {
        cancel() {},
        persist(payload) {
            delete payload.stream_url;
            delete payload.__ottPlexPlayback;
            return payload;
        },
        resolve(payload, done) {
            resolutions.push(payload.request.path);
            done({
                ...payload,
                __ottPlexPlayback: { type: "file" },
                stream_url:
                    "https://plex.invalid/library/parts/42/video.mp4?X-Plex-Token=secret",
            });
        },
        stableRequests: true,
        stop() {},
    };
    vm.runInContext(sourceFunctions("src/ui/index.ts", ["popMedia"]), c);
    return { c, loads, resolutions };
}

function configureBoot(c) {
    c.__ottActiveProviderDriver = {
        capabilities: { libraryOnly: true },
        id: "plex",
        libraryReady: () => true,
    };
    c.__ottCommandChannelLoad = {};
    c._pendingProvId = "plex";
    c.providerIds = ["demo", "m3u", "stalker", "plex"];
    c.launch_id = "#launch";
    c.clearBootHide = () => {};
    c.playChannel = () =>
        assert.fail("library providers must not start a TV channel");
    c.restoreContinueWatch = () =>
        assert.fail("TV bookmarks are not a Plex library entry point");
    vm.runInContext(
        sourceFunctions("src/channels/index.ts", ["onChannelsLoaded"]),
        c
    );
}

function saveLast(c, position) {
    const sourceId = c.__ottMedia.sourceId();
    c.stored["mediaJournal.v1:" + sourceId] = JSON.stringify({
        favorites: [],
        history: [
            {
                itemId: "provider:42",
                payload: {
                    itemId: "42",
                    request: { path: "/library/metadata/42" },
                    title: "Saved film",
                },
                position,
                sourceId,
            },
        ],
        sourceId,
        version: 1,
    });
}

{
    const { c, loads, resolutions } = create();
    c.popMedia();
    for (let depth = 1; depth <= 4; depth++) {
        c.selectMedia(0);
        assert.equal(c.__ottMedia.snapshot().frames.length, depth + 1);
        assert.equal(c.mediaName, "Folder " + depth);
    }
    c.__ottMedia.back();
    assert.equal(c.mediaName, "Folder 3");
    assert.equal(c.__ottMedia.snapshot().frame.selected, 0);
    c.selectMedia(0);
    c.selectMedia(0);
    assert.equal(resolutions.length, 1);
    const journalKey = Object.keys(c.stored).find((key) =>
        key.startsWith("mediaJournal.v1:")
    );
    const journal = JSON.parse(c.stored[journalKey]);
    assert.equal(
        journal.history[0].payload.request.path,
        "/library/metadata/42"
    );
    assert(!c.stored[journalKey].includes("secret"));
    assert(!c.stored[journalKey].includes("stream_url"));
    const previousLoads = loads.length;
    c.__ottMedia.open(-1);
    c.selectMedia(0);
    assert.equal(resolutions.length, 2);
    assert.equal(
        loads.length,
        previousLoads,
        "history resolves stable metadata directly without traversing old folders"
    );
}

{
    const { c } = create();
    configureBoot(c);
    c.onChannelsLoaded();
    assert.equal(c.stored.ottplayprov, "plex");
    assert.equal(c._pendingProvId, "");
    assert.equal(c.listArray[0].title, "Folder 1");
    assert(!JSON.stringify(c.elements).includes("Channel list not received"));
    assert(!c.calls.some((call) => call[0] === "popup"));
}

// A new JS runtime restores a stable Plex ID without browsing its former
// folder, then starts at the exact sub-minute position without prompting.
for (const position of [12.375, 125.875]) {
    const { c, loads, resolutions } = create();
    configureBoot(c);
    saveLast(c, position);
    const plays = [];
    c.stbPlay = (url, start) => plays.push({ start, url });
    c.onChannelsLoaded();
    assert.deepEqual(resolutions, ["/library/metadata/42"]);
    assert.equal(loads.length, 0);
    assert.equal(plays.length, 1);
    assert.equal(plays[0].start, position);
    assert(plays[0].url.includes("/library/parts/42/video.mp4"));
    assert.equal(c.__ottClassicPlayback.snapshot().position, position);
    assert.equal(c.documentState().history[0].position, position);
    assert(!c.calls.some((call) => call[0] === "confirm"));
    assert(!JSON.stringify(c.stored).includes("secret"));
    assert(!JSON.stringify(c.stored).includes("stream_url"));
}

// A failed fresh lookup opens the ordinary library. Failure from a retired
// boot must never replace a newer page, playback intent, client or account.
for (const action of [
    "fail",
    "stop",
    "navigate",
    "driver",
    "client",
    "load",
    "source",
]) {
    const { c, loads } = create();
    configureBoot(c);
    saveLast(c, 28.25);
    let complete;
    c.providerMediaClient.resolve = (_, done) => {
        complete = done;
    };
    c.onChannelsLoaded();
    assert.equal(typeof complete, "function");
    assert.equal(loads.length, 0);
    if (action === "stop") {
        c.__ottMedia.cancelAuto();
        c.__ottClassicPlayback.command({ type: "stop" });
    }
    if (action === "navigate") c.popMedia();
    if (action === "driver")
        c.__ottActiveProviderDriver = { ...c.__ottActiveProviderDriver };
    if (action === "client")
        c.providerMediaClient = { ...c.providerMediaClient };
    if (action === "load") c.__ottCommandChannelLoad = {};
    if (action === "source") c.p_pref = "another-account";
    const previousLoads = loads.length;
    complete(null);
    assert.equal(
        loads.length,
        previousLoads + (action === "fail" ? 1 : 0),
        action
    );
    assert(!c.calls.some((call) => call[0] === "play"), action);
}

console.log(
    "PASS Plex library integration: nested navigation, private history, exact cold resume and owned library-only boot"
);
