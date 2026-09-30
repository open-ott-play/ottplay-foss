/* Actual VPortal transport, native media adapter, journal and menus with a NAS installation. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { fixture, sourceFunctions } = require("./test_port_vod.cjs");
const root = path.resolve(__dirname, "..");
const sourceId = "nas:fixture-library";
const descriptor = {
    api: "/nas/api",
    enabled: true,
    sourceId,
    title: "Synology",
};
const film = {
    request: { cmd: "play", id: "42" },
    title: "Тестовый фильм",
    type: "stream",
};
function create(overrides = {}) {
    const c = fixture();
    Object.assign(
        c,
        {
            location: { protocol: "https:", host: "player.invalid" },
            sPageSize: 30,
        },
        overrides
    );
    c.stbGetItem = (key) => c.stored[key] ?? null;
    const requests = [];
    c.$.ajax = (options) => {
        const request = {
            options,
            aborted: false,
            abort() {
                request.aborted = true;
                if (options.error) options.error({}, "abort");
                if (options.complete) options.complete();
            },
            reply(value) {
                if (options.success) options.success(value);
                if (options.complete) options.complete();
            },
        };
        requests.push(request);
        return request;
    };
    const source = fs.readFileSync(
        path.join(root, "src/plugins/vportal.ts"),
        "utf8"
    );
    vm.runInContext(
        ts
            .transpileModule(source, {
                compilerOptions: {
                    target: ts.ScriptTarget.ES5,
                    module: ts.ModuleKind.ES2015,
                },
            })
            .outputText.replace(/^import .*$/gm, "")
            .replace(/^export /gm, ""),
        c
    );
    vm.runInContext(sourceFunctions("src/ui/index.ts", ["popMedia"]), c);
    const nas = c.__ottNasLibrary;
    function discover(config = descriptor) {
        nas.init();
        requests.at(-1).reply(config);
    }
    function open(items = [film]) {
        nas.open();
        requests
            .at(-1)
            .reply({ items, title: "Synology", type: "videoportal" });
    }
    return { c, discover, nas, open, requests };
}
let passed = 0;
function test(name, run) {
    run();
    console.log("PASS NAS library: " + name);
    passed++;
}

test("same-origin discovery is optional, credential-free and bounded", () => {
    const f = create();
    for (const endpoint of [
        "//attacker.invalid",
        "//attacker",
        "/\\attacker",
        "/nas/api?redirect=1",
    ])
        assert.equal(
            f.c.createVPortalClient("", { directEndpoint: endpoint }),
            null
        );
    f.nas.init();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.url, "/nas/config");
    assert.equal(f.requests[0].options.timeout, 5000);
    assert.equal(f.nas.available(), false);
    f.requests[0].reply(descriptor);
    assert.equal(f.nas.available(), true);
    assert.equal(JSON.stringify(f.c.stored), "{}");
    const provider = f.c.getMediaArray;
    const playback = f.c.playMedia;
    f.open();
    assert.equal(f.requests.at(-1).options.url, "/nas/api");
    assert.deepEqual(JSON.parse(f.requests.at(-1).options.data), {
        app: "ott-play",
        limit: 300,
    });
    assert.equal(f.c.getMediaArray, provider);
    assert.equal(f.c.playMedia, playback);
    assert.equal(f.c.__ottMedia.sourceId(), sourceId);
    assert.equal(f.c.listArray[0].title, film.title);
});

test("late discovery and invalid endpoint cannot publish or redirect requests", () => {
    const f = create();
    f.nas.init();
    const stale = f.requests[0];
    f.nas.init();
    assert.equal(stale.aborted, true);
    stale.reply(descriptor);
    assert.equal(f.nas.available(), false);
    f.requests[1].reply({ ...descriptor, api: "https://attacker.invalid/api" });
    assert.equal(f.nas.available(), false);
    f.discover({ ...descriptor, enabled: false });
    assert.equal(f.nas.available(), false);
    f.discover({ ...descriptor, sourceId: "<unsafe>" });
    assert.equal(f.nas.available(), false);
    for (const settings of [
        { location: { protocol: "file:" } },
        { __TAURI__: {} },
        { Capacitor: { isNativePlatform: () => true } },
    ]) {
        const native = create(settings);
        native.nas.init();
        assert.equal(native.requests.length, 0);
    }
});

test("one click resolves compatible default without a quality dialog", () => {
    const f = create();
    f.discover();
    f.open();
    f.c.showSelectBox = () =>
        assert.fail("NAS default must play without another choice");
    let providerCancelled = 0;
    f.c.providerMediaClient = { cancel: () => providerCancelled++ };
    f.c.selectMedia(0);
    assert.deepEqual(JSON.parse(f.requests.at(-1).options.data), {
        app: "ott-play",
        cmd: "play",
        id: "42",
    });
    f.requests.at(-1).reply({
        url: "https://player.invalid/nas/hls/signed/master.m3u8",
        variants: {
            Original: "https://player.invalid/nas/stream/signed/original.mkv",
            Compatible: "https://player.invalid/nas/hls/signed/master.m3u8",
        },
    });
    assert(
        f.c.calls.some(
            (call) => call[0] === "play" && call[1].includes("master.m3u8")
        )
    );
    assert.equal(
        providerCancelled,
        0,
        "NAS playback does not cancel the TV media client"
    );
    const journal = JSON.parse(
        f.c.stored["installation:mediaJournal.v1:" + sourceId]
    );
    assert.equal(journal.history.length, 1);
    assert.equal(journal.history[0].sourceId, sourceId);
    assert.equal(f.c.stored["mediaJournal.v1:" + sourceId], undefined);
});

test("provider changes preserve NAS ownership and returning restores untouched provider ports", () => {
    const f = create();
    f.discover();
    f.open([
        {
            type: "category",
            title: "Series",
            request: { cmd: "folder", id: "8" },
        },
    ]);
    f.c.selectMedia(0);
    const pending = f.requests.at(-1);
    const replacement = (target, done) => {
        f.c.mediaRecords = [{ title: "Provider", stream_url: "provider.mp4" }];
        done();
    };
    f.c.p_pref = "new-provider";
    f.c.getMediaArray = replacement;
    f.c.providerGetItem = () => "";
    f.c.providerSetItem = () =>
        assert.fail("NAS journal must not write provider storage");
    pending.reply({ type: "category", items: [film] });
    assert.equal(f.c.listArray[0].title, film.title);
    assert.equal(f.c.__ottMedia.sourceId(), sourceId);
    f.c.popMedia();
    assert.equal(f.c.listArray[0].title, "Provider");
    assert.equal(f.c.getMediaArray, replacement);
    assert.equal(f.c.__ottMedia.sourceId(), "new-provider");
    assert.equal(f.nas.available(), true);
});

test("restoring provider or closing NAS revokes delayed catalog and playback", () => {
    const f = create();
    f.discover();
    f.nas.open();
    const pending = f.requests.at(-1);
    f.c.popMedia();
    assert.equal(pending.aborted, true);
    pending.reply({ type: "videoportal", items: [film] });
    assert.equal(f.c.listArray[0].title, "Movie");
    f.open();
    f.c.selectMedia(0);
    const resolver = f.requests.at(-1);
    f.c.mediaKeyHandler(f.c.keys.RETURN);
    resolver.reply({ url: "https://player.invalid/late.mp4" });
    assert(!f.c.calls.some((call) => call[0] === "play"));
    f.nas.dispose();
    assert.equal(f.nas.available(), false);
});

test("NAS history survives cold start and provider changes, renewing signed URLs", () => {
    const first = create();
    first.c.stored.medHistory = JSON.stringify([
        { title: "Private provider", stream_url: "provider.mp4" },
    ]);
    first.discover();
    first.open();
    first.c.selectMedia(0);
    first.requests.at(-1).reply({ url: "https://player.invalid/old.mp4" });
    first.c.__ottMedia.checkpoint(first.c.__ottMedia.current().ref, 125, true);
    const cold = create({ p_pref: "other-provider" });
    Object.assign(cold.c.stored, first.c.stored);
    cold.discover();
    cold.open();
    cold.c.selectMedia(
        cold.c.listArray.findIndex((item) => item.__ottMediaRoute === "history")
    );
    assert.equal(cold.c.listArray[0].title, film.title);
    assert(!cold.c.listArray.some((item) => item.title === "Private provider"));
    cold.c.selectMedia(0);
    cold.requests.at(-1).reply({
        type: "videoportal",
        items: [{ ...film, title: "Renamed film" }],
    });
    assert.equal(JSON.parse(cold.requests.at(-1).options.data).cmd, "play");
    cold.requests.at(-1).reply({ url: "https://player.invalid/fresh.mp4" });
    assert(
        cold.c.calls.some(
            (call) => call[0] === "play" && call[1].endsWith("fresh.mp4")
        )
    );
    cold.c.confirm();
    assert.deepEqual(cold.c.calls.at(-1), ["seek", 120]);
});

test("switching media sources flushes the confirmed playback position", () => {
    const f = create();
    f.discover();
    f.open();
    f.c.selectMedia(0);
    f.requests.at(-1).reply({ url: "https://player.invalid/film.mp4" });
    f.c.__ottClassicPlayback.command({ type: "position", position: 137 });
    const state = f.c.__ottClassicPlayback.snapshot();
    assert.equal(state.position, 137);
    f.c.popMedia();
    const journal = JSON.parse(
        f.c.stored["installation:mediaJournal.v1:" + sourceId]
    );
    assert.equal(journal.history[0].position, 137);
});

test("standalone NAS is available in popup with no provider; labels are escaped", () => {
    const f = create();
    f.c.getMediaArray = null;
    f.c.popupActions = [];
    f.c.popupArray = [];
    f.c.popupDetail = [];
    f.discover({ ...descriptor, title: "NAS <img src=x>" });
    const menu = f.c.__ottMenuRegistry.open(f.c, "media.nas");
    assert.equal(menu.rows.length, 1);
    assert.equal(menu.rows[0].id, "media.nas");
    assert.equal(menu.rows[0].name, "NAS &lt;img src=x&gt;");
    menu.invoke("media.nas");
    assert.equal(f.requests.at(-1).options.url, "/nas/api");
    f.c.sHideMenus = ["media.nas"];
    assert.equal(f.c.__ottMenuRegistry.open(f.c).rows.length, 0);
});

test("discovery refreshes the no-provider settings page without mutating its options", () => {
    const f = create();
    const c = f.c;
    const chooseProvider = () => {};
    Object.assign(c, {
        findOptionIndex: () => -1,
        isPlayDistribution: () => false,
        listCaptionElement: {},
        listDetail: {},
        listFooter: {},
        optionsArr: [{ action: chooseProvider, name: "Provider" }],
        prependMenuButtonHint: () => {},
        providerSelectionUnlockCount: 0,
        showProviderSelection: chooseProvider,
        sNoNumbersKeys: 1,
        strRETURN: "Return",
        strTools: "Tools",
        toggleProviderSelectionVisibility: () => {},
    });
    vm.runInContext(
        sourceFunctions("src/provider/index.ts", ["optionsList"]),
        c
    );
    c.optionsList();
    assert.equal(c.listArray.length, 1);
    f.discover();
    assert.equal(c.listArray[0], "Synology");
    assert.equal(c.listArray.length, 2);
    assert.equal(
        c.optionsArr.length,
        1,
        "installation entry is only in the detached rendered menu"
    );
    assert.equal(
        c.selIndex,
        1,
        "discovery preserves focus on the user's existing option"
    );
    c.selIndex = 0;
    c.listKeyHandlerFn(c.keys.ENTER);
    assert.equal(f.requests.at(-1).options.url, "/nas/api");
});

const firstStop = "https://player.invalid/nas/stream/first.signature/media.bin";
const secondStop =
    "https://player.invalid/nas/stream/second.signature/media.bin";
function startSession(
    f,
    stop = firstStop,
    url = "https://player.invalid/first.m3u8"
) {
    f.discover();
    f.open();
    f.c.selectMedia(0);
    f.requests.at(-1).reply({ stop, url });
}

test("NAS switching awaits session release; browsing and cancel keep playback alive", () => {
    const f = create();
    startSession(f);
    const started = f.requests.length;
    f.c.cancelMediaLoad();
    f.nas.open();
    assert.equal(
        f.requests.length,
        started,
        "opening/closing lists preserves the playing session"
    );
    f.c.settings.stopPlay = 1;
    f.c.stbStop = () => f.c.__ottClassicPlayback.command({ type: "stop" });
    f.c.selectMedia(0);
    const release = f.requests.at(-1);
    assert.equal(release.options.type, "GET");
    assert.equal(release.options.url, "/nas/stream/first.signature/media.bin");
    assert.equal(
        f.requests.length,
        started + 1,
        "new resolve waits for stop completion"
    );
    release.reply("");
    assert.equal(f.requests.at(-1).options.type, "POST");
    f.requests
        .at(-1)
        .reply({ stop: secondStop, url: "https://player.invalid/second.m3u8" });
    assert(
        f.c.calls.some(
            (call) => call[0] === "play" && call[1].includes("second.m3u8")
        )
    );
    assert.equal(
        f.requests.filter((request) =>
            request.options.url.includes("second.signature")
        ).length,
        0,
        "internal stbStop of the old target cannot release the newly resolved session"
    );
    f.c.__ottClassicPlayback.command({ type: "stop" });
    assert.equal(
        f.requests.at(-1).options.url,
        "/nas/stream/second.signature/media.bin"
    );
    const stopped = f.requests.length;
    f.c.__ottClassicPlayback.command({ type: "stop" });
    assert.equal(f.requests.length, stopped, "manual Stop is idempotent");
});

test("actual source replacement and disposal release NAS even while browsing provider media", () => {
    const f = create();
    startSession(f);
    f.c.popMedia();
    const count = f.requests.length;
    f.c.__ottClassicPlayback.command({ type: "live", channelId: "1" });
    assert.equal(f.requests.length, count + 1);
    assert.equal(
        f.requests.at(-1).options.url,
        "/nas/stream/first.signature/media.bin"
    );
    const second = create();
    startSession(second);
    second.nas.dispose();
    assert.equal(
        second.requests.at(-1).options.url,
        "/nas/stream/first.signature/media.bin"
    );
});

test("canceled and accepted-but-unplayed responses release only their own signed session", () => {
    const f = create();
    f.discover();
    f.open();
    f.c.selectMedia(0);
    const stale = f.requests.at(-1);
    f.c.cancelMediaLoad();
    stale.reply({ stop: firstStop, url: "https://player.invalid/late.m3u8" });
    assert.equal(
        f.requests.at(-1).options.url,
        "/nas/stream/first.signature/media.bin"
    );
    assert(!f.c.calls.some((call) => call[0] === "play"));
    f.requests.at(-1).reply("");
    f.nas.open();
    f.c.selectMedia(0);
    const accepted = f.requests.at(-1);
    accepted.options.success({
        stop: secondStop,
        url: "https://player.invalid/unplayed.m3u8",
    });
    f.c.cancelMediaLoad();
    accepted.options.complete();
    assert.equal(
        f.requests.at(-1).options.url,
        "/nas/stream/second.signature/media.bin"
    );
    assert(!f.c.calls.some((call) => call[0] === "play"));
});

test("release failures unblock the next resolve and Stop cannot revive a canceled selection", () => {
    const f = create();
    startSession(f);
    f.nas.open();
    f.c.selectMedia(0);
    const release = f.requests.at(-1);
    assert.equal(release.options.timeout, 5000);
    release.options.complete(); // Timeout/error completion is best-effort, never a permanent queue lock.
    assert.equal(f.requests.at(-1).options.type, "POST");
    const next = f.requests.at(-1);
    next.reply({ stop: secondStop, url: "https://player.invalid/second.m3u8" });
    f.nas.open();
    f.c.selectMedia(0);
    const secondRelease = f.requests.at(-1);
    f.c.__ottClassicPlayback.command({ type: "stop" });
    const count = f.requests.length;
    secondRelease.reply("");
    assert.equal(
        f.requests.length,
        count,
        "retired waiter cannot issue a new playback request"
    );
});

test("cleanup never follows off-origin or unsigned arbitrary stop URLs", () => {
    for (const stop of [
        "https://attacker.invalid/nas/stream/first.signature/media.bin",
        "https://player.invalid.evil/nas/stream/first.signature/media.bin",
        "https://player.invalid/admin/delete",
        "//player.invalid/nas/stream/first.signature/media.bin",
    ]) {
        const f = create();
        startSession(f, stop);
        const count = f.requests.length;
        f.nas.dispose();
        assert.equal(f.requests.length, count);
    }
});

console.log(`PASS NAS library (${passed} integrated scenarios)`);
