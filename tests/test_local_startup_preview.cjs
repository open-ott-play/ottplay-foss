"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const test = require("node:test");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
function setup(options = {}) {
    const f = fixture();
    const h = f.host;
    h.document = { cookie: "", getElementById: () => null };
    h.localStorage = {
        getItem: (key) => (f.saved.has(key) ? f.saved.get(key) : null),
        key: (at) => [...f.saved.keys()][at] || null,
        get length() {
            return f.saved.size;
        },
        removeItem: (key) => f.saved.delete(key),
        setItem: (key, value) => f.saved.set(key, String(value)),
    };
    h.exports = {};
    vm.runInContext(
        ts.transpileModule(fs.readFileSync("src/storage/index.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        h
    );
    h.stbGetItem = h.exports.stbGetItem;
    h.stbSetItem = h.exports.stbSetItem;
    h.stbDelItem = h.exports.stbDelItem;
    require("./helpers/shared-core-runtime.cjs")(h);
    Object.assign(h, {
        catIndex: 0,
        channels: {},
        clearTimeout() {},
        curList: [],
        forcePlay: true,
        medHistory: [],
        p_pref: "offline",
        playTime: 0,
        playType: 0,
        prevArr: [],
        primaryIndex: 0,
        setInterval() {},
        setTimeout() {},
        settings: { prevCount: 2 },
    });
    const savedId = options.legacy ? "" : "local-saved";
    if (savedId)
        f.saved.set(
            "offlinechannelLibrary:offline",
            JSON.stringify({ selected: { itemId: "channel:" + savedId } })
        );
    f.saved.set("offlineprimaryIndex", "3450");
    f.saved.set(
        "offlineplaybackJournal",
        JSON.stringify({
            bookmark: {
                channelId: savedId || "legacy-numeric",
                groupId: "system:all",
                kind: "live",
                position: 147,
            },
            channelReferences: 1,
            history: [],
            sourceId: "offline",
            updatedAt: Date.now(),
            version: 2,
        })
    );
    let progress, finish;
    h.__ottLocalMedia = {
        libraryIdentity: () =>
            options.mode === "browser" ? "browser-test" : "native-test",
        playbackList(callback) {
            progress = callback;
            return new Promise((resolve) => (finish = resolve));
        },
        startupSource: () =>
            options.unknownSource ? undefined : "selected-source",
        takeImportSelection: () => (options.imported ? "local-saved" : ""),
    };
    if (options.kiosk) h.__ottKiosk = { enabled: () => true };
    const driver = f.mount("offline"),
        plays = [];
    const playback = h.__ottClassicPlayback;
    h.playChannel = (category, at, _pip, _unused, resume) => {
        const list = h.cats[h.catsArray[category]],
            id = list[at];
        const generation = playback.snapshot().generation;
        playback.command({
            automatic: _unused === true,
            channelId: id,
            position: resume?.position || 0,
            type: "live",
        });
        if (playback.snapshot().generation === generation) return false;
        h.catIndex = category;
        h.primaryIndex = at;
        h.curList = list;
        h.providerSetItem("primaryIndex", String(at));
        const state = playback.snapshot();
        playback.command({
            duration: 600,
            generation: state.generation,
            position: resume?.position || 0,
            type: "playing",
        });
        plays.push({ id, position: resume?.position || 0 });
        return true;
    };
    h.__ottCoreBackendPeek = () => ({
        current: () => ({
            active: () => true,
            snapshot: () => ({ phase: playback.snapshot().phase }),
        }),
    });
    const snapshots = [];
    driver.load((catalog, error) => {
        assert.equal(error, undefined);
        snapshots.push(catalog);
        if (!catalog.incremental) {
            h.channels = { ...catalog.channels };
            h.cList = Array.from(catalog.ids);
            h.catsArray = ["All"];
            h.cats = { All: h.cList };
            h.curList = h.cList;
            const id = catalog.selectedId || h.cList[0];
            if (id) h.playChannel(0, h.cList.indexOf(id));
        } else {
            for (const id of catalog.ids)
                if (!h.channels[id]) {
                    h.channels[id] = catalog.channels[id];
                    h.cList.push(id);
                }
        }
    });
    const rawBefore = new Map(f.saved);
    const first = {
        id: "first",
        name: "First.mp4",
        sourceId: "selected-source",
        url: "blob:first",
    };
    const wanted = {
        id: "saved",
        name: "Saved.mp4",
        sourceId: "selected-source",
        url: "blob:saved",
    };
    function value(items, scanning = true) {
        return {
            items,
            scanning,
            sourceScans: [
                {
                    generation: 1,
                    sourceId: "selected-source",
                    state: scanning ? "scanning" : "complete",
                },
            ],
            sources: [
                { available: true, id: "selected-source", kind: "folder" },
            ],
        };
    }
    return {
        ...f,
        driver,
        finish: (v) => finish(v),
        first,
        h,
        playback,
        plays,
        progress: (v) => progress(v),
        rawBefore,
        snapshots,
        value,
        wanted,
    };
}
test("first selected-source prefix plays immediately and restores the sealed stable target once", async () => {
    const f = setup();
    f.progress(
        f.value([
            {
                id: "other",
                name: "Other.mp4",
                sourceId: "other",
                url: "blob:other",
            },
            f.first,
        ])
    );
    assert.deepEqual(f.plays, [{ id: "local-first", position: 0 }]);
    assert.equal(
        f.snapshots.length,
        1,
        "first playback does not wait for complete catalog/legacy index3450"
    );
    assert.deepEqual(
        [...f.saved],
        [...f.rawBefore],
        "preview cannot overwrite the saved cursor"
    );
    f.progress(f.value([f.first, f.wanted]));
    assert.deepEqual(f.plays, [
        { id: "local-first", position: 0 },
        { id: "local-saved", position: 147 },
    ]);
    f.progress(f.value([f.first, f.wanted]));
    f.finish(f.value([f.first, f.wanted], false));
    await Promise.resolve();
    assert.equal(f.plays.length, 2);
    assert.equal(f.h.ottpStorage.localPlayback.active(), false);
});
test("completing without the target commits the current preview; partial disposal preserves the original", async () => {
    for (const complete of [false, true]) {
        const f = setup();
        f.progress(f.value([f.first]));
        f.playback.command({
            duration: 600,
            generation: f.playback.snapshot().generation,
            position: 19,
            type: "position",
        });
        assert.deepEqual([...f.saved], [...f.rawBefore]);
        if (complete) {
            f.finish(f.value([f.first], false));
            await Promise.resolve();
        } else f.driver.dispose();
        const bookmark = JSON.parse(
            f.saved.get("offlineplaybackJournal")
        ).bookmark;
        assert.equal(
            bookmark.channelId,
            complete ? "local-first" : "local-saved"
        );
        assert.equal(bookmark.position, complete ? 19 : 147);
    }
});
test("kiosk and explicit imported file choices keep their pinned selection", () => {
    for (const options of [{ kiosk: true }, { imported: true }]) {
        const f = setup(options);
        f.progress(f.value([f.first]));
        assert.equal(f.plays.length, 0);
        assert.equal(f.h.ottpStorage.localPlayback.active(), false);
        f.driver.dispose();
    }
});
test("manual file selection, pause and seek commit the preview and prevent a late jump", () => {
    for (const intent of ["select", "pause", "seek"]) {
        const f = setup();
        const next = {
            id: "next",
            name: "Next.mp4",
            sourceId: "selected-source",
            url: "blob:next",
        };
        f.progress(f.value([f.first, next]));
        f.playback.command({
            duration: 600,
            generation: f.playback.snapshot().generation,
            position: 19,
            type: "position",
        });
        if (intent === "select")
            f.h.playChannel(0, f.h.cList.indexOf("local-next"));
        else {
            assert.equal(f.driver.commitStartupPreview(), true);
            f.playback.command({
                duration: 600,
                generation: f.playback.snapshot().generation,
                position: intent === "seek" ? 29 : 19,
                type: intent === "pause" ? "pause" : "position",
            });
        }
        assert.equal(f.h.ottpStorage.localPlayback.active(), false);
        const before = f.plays.length;
        f.progress(f.value([f.first, next, f.wanted]));
        assert.equal(f.plays.length, before);
        f.playback.checkpointNow();
        assert.equal(
            JSON.parse(f.saved.get("offlineplaybackJournal")).bookmark
                .channelId,
            intent === "select" ? "local-next" : "local-first"
        );
        f.driver.dispose();
    }
});
test("stop, source change, scan replacement and partial cancellation never jump or persist fallback", () => {
    for (const changed of ["stop", "paused", "source", "scan", "cancel"]) {
        const f = setup();
        f.progress(f.value([f.first]));
        if (changed === "stop") {
            f.h.forcePlay = false;
            f.playback.command({ type: "stop" });
        }
        if (changed === "paused")
            f.playback.command({
                generation: f.playback.snapshot().generation,
                type: "pause",
            });
        if (changed === "source") f.h.p_pref = "another";
        if (changed === "cancel")
            f.progress({ ...f.value([f.first]), cancelled: true });
        const arrived = f.value([f.first, f.wanted]);
        if (changed === "scan") arrived.sourceScans[0].generation = 2;
        f.progress(arrived);
        assert.equal(f.plays.length, 1);
        assert.deepEqual([...f.saved], [...f.rawBefore]);
        f.driver.dispose();
        assert.deepEqual([...f.saved], [...f.rawBefore]);
    }
});
test("legacy index preview never invents a numeric restore target on browser/native", async () => {
    for (const mode of ["browser", "native"]) {
        const f = setup({ legacy: true, mode });
        f.progress(f.value([f.first]));
        assert.equal(f.plays[0].id, "local-first");
        f.progress(f.value([f.first, f.wanted]));
        assert.equal(f.plays.length, 1);
        f.finish(f.value([f.first, f.wanted], false));
        await Promise.resolve();
        assert.equal(f.h.ottpStorage.localPlayback.active(), true);
        assert.deepEqual(
            [...f.saved],
            [...f.rawBefore],
            "unreliable numeric-only cursor stays protected until explicit intent"
        );
        f.driver.dispose();
    }
});
test("an unknown or unmounted source cannot preview a different available folder", () => {
    const f = setup({ unknownSource: true });
    f.progress({
        ...f.value([
            {
                id: "other",
                name: "Other.mp4",
                sourceId: "other",
                url: "blob:other",
            },
        ]),
        sources: [
            { available: false, id: "selected-source", kind: "folder" },
            { available: true, id: "other", kind: "folder" },
        ],
    });
    assert.equal(f.plays.length, 0);
    assert.equal(f.h.ottpStorage.localPlayback.active(), false);
    f.driver.dispose();
});
test("automatic EOF-next retains restoration, but a subsequent manual pause cancels it", () => {
    for (const pause of [false, true]) {
        const f = setup();
        const next = {
            id: "next",
            name: "Next.mp4",
            sourceId: "selected-source",
            url: "blob:next",
        };
        f.progress(f.value([f.first, next]));
        f.playback.command({ type: "stop" });
        f.h.playChannel(0, f.h.cList.indexOf("local-next"), false, true);
        assert.equal(f.h.ottpStorage.localPlayback.active(), true);
        assert.deepEqual(
            [...f.saved],
            [...f.rawBefore],
            "automatic next cannot commit provisional cursor"
        );
        if (pause) {
            assert.equal(f.driver.commitStartupPreview(), true);
            f.playback.command({
                generation: f.playback.snapshot().generation,
                type: "pause",
            });
        }
        f.progress(f.value([f.first, next, f.wanted]));
        assert.equal(f.plays.length, pause ? 2 : 3);
        assert.deepEqual(
            f.plays.at(-1),
            pause
                ? { id: "local-next", position: 0 }
                : { id: "local-saved", position: 147 }
        );
        f.driver.dispose();
    }
});
