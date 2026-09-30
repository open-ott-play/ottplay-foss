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
    c.__ottActiveProviderDriver = {
        capabilities: { libraryOnly: true },
        libraryReady: () => true,
    };
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
    c.onChannelsLoaded();
    assert.equal(c.stored.ottplayprov, "plex");
    assert.equal(c._pendingProvId, "");
    assert.equal(c.listArray[0].title, "Folder 1");
    assert(!JSON.stringify(c.elements).includes("Channel list not received"));
    assert(!c.calls.some((call) => call[0] === "popup"));
}

console.log(
    "PASS Plex library integration: nested navigation, back selection, private history, stable replay and library-only boot"
);
