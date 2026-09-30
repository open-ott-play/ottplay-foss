const assert = require("node:assert/strict");
const { fixture } = require("./test_port_vod.cjs");
const { sourceFunctions } = require("./test_port_vod.cjs");
const vm = require("node:vm");
const plain = (value) => JSON.parse(JSON.stringify(value));
let groups = 0;
function test(name, run) {
    run();
    groups++;
    console.log("PASS " + name);
}

test("Scalar navigation reads and highlights never copy a catalog", () => {
    require("./helpers/media-read-cost.cjs").assertMediaReadContract(fixture());
});

test("Scoped internal snapshots detach metadata and preserve full public snapshots", () => {
    const c = fixture();
    require("./helpers/media-read-cost.cjs").trackMediaSnapshots(c);
    let reads = 0;
    let rendered;
    const library = c.__ottMediaLibrary.create({
        describe: (rows) => rows,
        items: () => [],
        load: (route, done) =>
            done([
                {
                    payload: {
                        get title() {
                            reads++;
                            return route.title;
                        },
                    },
                    ref: { itemId: route.title, sourceId: "scope-fixture" },
                    title: route.title,
                },
            ]),
        render: (view) => {
            rendered = view;
        },
    });
    library.open({ kind: "catalog", target: "parent", title: "Parent" });
    library.open({ kind: "catalog", target: "child", title: "Child" });
    assert.equal(rendered.frames[0].items.length, 0);
    assert.equal(rendered.frame.items[0].title, "Child");
    reads = 0;
    const navigation = library.snapshot("none");
    assert.equal(reads, 0, "Navigation reads no ancestor or current payloads");
    navigation.frame.route.title = "Poisoned route";
    const current = library.snapshot("current");
    assert.equal(reads, 1, "Current scope reads only the visible page");
    assert.equal(current.frame.route.title, "Child");
    current.frame.items[0].payload.title = "Poisoned current item";
    reads = 0;
    const all = library.snapshot();
    assert.equal(reads, 2, "Public default still detaches every page");
    assert.equal(all.frames[0].items[0].payload.title, "Parent");
    assert.equal(all.frame.items[0].payload.title, "Child");
});

test("Filter and paging copy costs exclude ancestor payloads at catalog scale", () => {
    const { mediaFilterCost } = require("./helpers/media-filter-cost.cjs");
    for (const rows of [300, 1000]) {
        const depth = 6;
        const cost = mediaFilterCost({ depth, rows, samples: 1 });
        assert(
            cost.filterOpen.objects <= depth * 4,
            "Opening the editor must copy only page metadata"
        );
        assert(
            cost.show.objects <= rows * 19 + depth * 4,
            "Rendering must detach current UI and provider projections only"
        );
        assert(
            cost.filterApplyAndClear.objects <= rows * 30 + depth * 40,
            "Refiltering must not clone retained parent pages"
        );
        assert(
            cost.nextAndBack.objects <= rows * 50 + depth * 40,
            "Paging cost must not include prior pages' payloads"
        );
    }
});

test("Facade highlight and screen release read revision without detached snapshots", () => {
    const c = fixture();
    const counts = require("./helpers/media-read-cost.cjs").trackMediaSnapshots(
        c
    );
    c.showPage = () => c.__ottClassicScreenPort.commitList();
    c.catalogs[""] = Array.from({ length: 1000 }, (_, id) => ({
        id,
        stream_url: id + ".mp4",
        title: "Movie " + id,
    }));
    c.mediaList(null);
    const revision = c.__ottMedia.snapshot().revision;
    const original = c.__ottMedia.capture();
    counts.reset();
    c.__ottMedia.highlight(999, revision);
    assert.equal(counts.snapshots, 0);
    assert.equal(
        counts.selects,
        0,
        "highlight does not request a detached item"
    );
    assert.equal(original(), false);
    const selected = c.__ottMedia.snapshot();
    assert.equal(selected.frame.selected, 999);
    c.__ottMedia.highlight(1, revision - 1);
    assert.equal(c.__ottMedia.snapshot().frame.selected, 999);
    counts.reset();
    c.__ottMedia.favorite(selected.frame.items[999].payload);
    assert.equal(
        counts.snapshots,
        1,
        "favorite captures its navigation context once"
    );
    assert.equal(c.documentState().favorites[0].itemId, "provider:999");
    counts.reset();
    c.__ottClassicScreenPort.listOwner().close();
    assert.equal(
        counts.snapshots,
        0,
        "screen cleanup compares only scalar revision"
    );
    assert.notEqual(c.__ottMedia.snapshot().revision, revision);
});

test("Owned frames restore selection and ignore poisoned UI projections", () => {
    const c = fixture();
    c.mediaList(null);
    c.selectMedia(1);
    c.mediaUrls = [-1, -2];
    c.mediaNames = ["poison"];
    c.mediaSelects = [99];
    c.mediaKeyHandler(c.keys.RETURN);
    assert.equal(c.listArray[1].title, "Folder");
    assert.equal(c.selIndex, 1);
    assert.equal(c.__ottMedia.snapshot().frame.route.kind, "catalog");
    c.listArray[1].title = "mutated renderer";
    c.__ottMedia.show();
    assert.equal(c.listArray[1].title, "Folder");
    c.selIndex = 0;
    c.detailListActionFn();
    c.closeList();
    c.mediaList(null);
    assert.equal(
        c.selIndex,
        0,
        "Highlight is an owned input and survives closing/reopening"
    );
});

test("Cold history re-resolves origin and resumes stable ID after signed URL changes", () => {
    const first = fixture();
    first.catalogs[""] = [
        { id: 42, stream_url: "old-token.mp4", title: "Film" },
    ];
    first.mediaList(null);
    first.selectMedia(0);
    first.setCurrent(0, -1);
    const cold = fixture();
    Object.assign(cold.stored, first.stored);
    cold.catalogs[""] = [
        { id: 42, stream_url: "new-token.mp4", title: "Renamed film" },
    ];
    cold.mediaList(null);
    cold.selectMedia(
        cold.listArray.findIndex((item) => item.__ottMediaRoute === "history")
    );
    cold.selectMedia(0);
    assert(
        cold.calls.some(
            (call) => call[0] === "play" && call[1] === "new-token.mp4"
        )
    );
    cold.confirm();
    assert.deepEqual(cold.calls.at(-1), ["seek", 120]);
    assert.equal(cold.documentState().history.length, 1);
    assert.equal(cold.documentState().history[0].payload.title, "Renamed film");
});

test("Back cancels history URL resolution and its late response cannot start playback", () => {
    const c = fixture();
    c.catalogs[""] = [{ id: 42, stream_url: "old.mp4", title: "Film" }];
    c.mediaList(null);
    c.selectMedia(0);
    c.setCurrent(0, -1);
    c.mediaList(null);
    c.selectMedia(
        c.listArray.findIndex((item) => item.__ottMediaRoute === "history")
    );
    const original = c.getMediaArray;
    let pending;
    // Keep the same provider resource identity; its transport becomes asynchronous.
    c.catalogs[""] = [{ id: 42, stream_url: "fresh.mp4", title: "Film" }];
    const provider = function (target, done) {
        if (pending === false) {
            pending = done;
            return;
        }
        original(target, done);
    };
    c.getMediaArray = provider;
    c.mediaList(null);
    c.selectMedia(
        c.listArray.findIndex((item) => item.__ottMediaRoute === "history")
    );
    pending = false;
    const plays = c.calls.filter((call) => call[0] === "play").length;
    c.selectMedia(0);
    assert.equal(typeof pending, "function");
    c.mediaKeyHandler(c.keys.RETURN);
    c.mediaRecords = c.catalogs[""];
    pending();
    assert.equal(c.calls.filter((call) => call[0] === "play").length, plays);
});

test("Provider resolve port is owned, one-shot and revoked by Back", () => {
    const c = fixture();
    let done,
        cancelled = 0;
    c.providerMediaClient = {
        cancel() {
            cancelled++;
        },
        resolve(item, next) {
            done = next;
        },
    };
    c.mediaList(null);
    c.selectMedia(1);
    c.selectMedia(0);
    c.mediaKeyHandler(c.keys.RETURN);
    done({ id: 8, stream_url: "late.mp4", title: "Late" });
    assert(!c.calls.some((call) => call[0] === "play"));
    assert(cancelled > 0);
    c.selectMedia(0);
    const current = done;
    current({ id: 9, stream_url: "ready.mp4", title: "Ready" });
    current({ id: 9, stream_url: "twice.mp4", title: "Again" });
    assert.equal(c.calls.filter((call) => call[0] === "play").length, 1);
});

test("Same account source survives stream URL renewal, distinct account and slot do not share", () => {
    const c = fixture();
    let user = "alice";
    c.p_pref = "xt";
    c.__ottActiveProviderDriver = {
        credentials: () => ({
            password: "pw",
            server: "https://portal.invalid",
            username: user,
        }),
    };
    c._playMedia({ id: 1, stream_url: "a.mp4", title: "Movie" });
    c.setCurrent(0, -1);
    const alice = c.__ottMedia.sourceId();
    user = "bob";
    c._playMedia({ id: 1, stream_url: "b.mp4", title: "Movie" });
    const bob = c.__ottMedia.sourceId();
    assert.notEqual(alice, bob);
    assert.equal(c.documentState().history[0].position, 0);
    assert.equal(
        JSON.parse(c.stored["mediaJournal.v1:" + alice]).history[0].position,
        125.9
    );
    c.p_pref = "m3u";
    c.m3uArr = {
        active: 0,
        M3Us: [
            { medSourceId: "a", www: "https://one.invalid" },
            { medSourceId: "b", www: "https://two.invalid" },
        ],
    };
    c._playMedia({ id: 1, stream_url: "zero.mp4", title: "Slot0" });
    const zero = c.__ottMedia.sourceId();
    c.m3uArr.active = 1;
    c._playMedia({ id: 1, stream_url: "one.mp4", title: "Slot1" });
    assert.notEqual(zero, c.__ottMedia.sourceId());
    assert.equal(c.documentState().history[0].position, 0);
});

test("Legacy adoption marker prevents account switch importing another account history", () => {
    const c = fixture();
    let account = "a";
    c.p_pref = "xt";
    c.__ottActiveProviderDriver = {
        credentials: () => ({
            password: "pw",
            server: "portal",
            username: account,
        }),
    };
    c.stored.medHistory = JSON.stringify([
        { current: 99, id: 11, stream_url: "old", title: "Legacy" },
    ]);
    c.mediaList(null);
    assert.equal(c.documentState().history.length, 1);
    account = "b";
    c.mediaList(null);
    assert.equal(c.documentState(), null);
    c._playMedia({ id: 12, stream_url: "own", title: "Own" });
    assert.equal(c.documentState().history.length, 1);
    assert.equal(c.documentState().history[0].payload.title, "Own");
});

test("Unavailable history entry never falls back to its expired URL", () => {
    const c = fixture();
    c.catalogs[""] = [{ id: 1, stream_url: "old", title: "Removed" }];
    c.mediaList(null);
    c.selectMedia(0);
    c.setCurrent(0, -1);
    c.catalogs[""] = [];
    c.mediaList(null);
    c.selectMedia(
        c.listArray.findIndex((item) => item.__ottMediaRoute === "history")
    );
    const count = c.calls.filter((call) => call[0] === "play").length;
    c.selectMedia(0);
    assert.equal(c.calls.filter((call) => call[0] === "play").length, count);
    assert(
        c.calls.some(
            (call) =>
                call[0] === "message" && call[1].includes("no longer available")
        )
    );
});

test("Same-title episodes retain separate provider/request identities", () => {
    const c = fixture();
    c._playMedia({
        request: { cmd: "play", episode: 1 },
        stream_url: "one",
        title: "Same",
    });
    c.setCurrent(0, -1);
    c._playMedia({
        request: { cmd: "play", episode: 2 },
        stream_url: "two",
        title: "Same",
    });
    assert.equal(c.documentState().history.length, 2);
    c._playMedia({
        request: { cmd: "play", episode: 1 },
        stream_url: "renewed",
        title: "Same",
    });
    c.confirm();
    assert.deepEqual(c.calls.at(-1), ["seek", 120]);
    assert.equal(c.documentState().history.length, 2);
});

test("Incremental provider page publication is accepted only for its frame", () => {
    const c = fixture();
    let completion;
    c.getMediaArray = (_route, done) => {
        completion = done;
        c.mediaRecords = [{ id: 1, stream_url: "old", title: "Loading" }];
        done();
    };
    c.mediaList(null);
    completion.publish(
        [{ id: 1, stream_url: "ready", title: "Ready" }],
        "Page",
        0
    );
    assert.equal(c.listArray[0].title, "Ready");
    const old = completion;
    c.mediaList("another");
    old.publish([{ id: 1, stream_url: "stale", title: "Stale" }]);
    assert.equal(c.listArray[0].title, "Loading");
});

test("Domain abort reentry cannot pop or publish the replacement navigation", () => {
    const c = fixture(),
        frames = [];
    let library, pending;
    const item = {
        payload: {},
        ref: { itemId: "i", sourceId: "s" },
        title: "Item",
    };
    library = c.__ottMediaLibrary.create({
        describe: () => [item],
        items: () => [item],
        load: (_route, done) => {
            pending = done;
            return () =>
                library.open({ kind: "favorites", title: "Replacement" }, true);
        },
        render: (view) => frames.push(view),
    });
    library.open({ kind: "catalog", target: "old", title: "Old" });
    library.close();
    pending([{}]);
    assert.equal(library.snapshot().frame.route.title, "Replacement");
    assert.equal(frames.length, 1);
});

test("Future or malformed journal versions are not overwritten; failed writes retain state", () => {
    const c = fixture();
    for (const raw of ['{"version":42}', "{broken"]) {
        const values = { "mediaJournal.v1:s": raw };
        let writes = 0;
        const journal = c.__ottMediaJournal.create({
            core: c.OttPlayCore,
            importRows: () => [],
            limit: () => 20,
            read: (key) => values[key] || null,
            sourceId: "s",
            write: () => writes++,
        });
        assert.equal(journal.read().writable, false);
        assert.equal(
            journal.change("visit", {
                itemId: "i",
                payload: {},
                position: 0,
                sourceId: "s",
            }),
            false
        );
        assert.equal(writes, 0);
    }
    const values = {};
    let fail = false;
    const journal = c.__ottMediaJournal.create({
        core: c.OttPlayCore,
        importRows: () => [],
        limit: () => 20,
        read: (key) => values[key] || null,
        sourceId: "s",
        write: (key, value) => {
            if (fail) throw Error("quota");
            values[key] = value;
        },
    });
    journal.read();
    fail = true;
    assert.equal(
        journal.change("visit", {
            itemId: "i",
            payload: {},
            position: 0,
            sourceId: "s",
        }),
        false
    );
    assert.equal(journal.read().document.history.length, 0);
});

test("Copying metadata never executes prototype setters or shares nested data", () => {
    const c = fixture();
    const data = JSON.parse(
        '{"__proto__":{"polluted":true},"nested":{"value":1}}'
    );
    const detached = c.__ottMediaLibrary.copy(data);
    detached.nested.value = 2;
    assert.equal(data.nested.value, 1);
    assert.equal({}.polluted, undefined);
    assert.equal(
        Object.prototype.hasOwnProperty.call(detached, "__proto__"),
        true
    );
    assert.deepEqual(plain(detached.__proto__), { polluted: true });
});

test("Metadata copies isolate sibling references and cut only ancestor cycles", () => {
    const c = fixture();
    const shared = { value: 1 };
    const source = { array: [shared], first: shared, second: shared };
    source.self = source;
    shared.parent = source;
    const seen = Object.freeze([]);
    const copy = c.__ottMediaLibrary.copy(source, seen);
    assert.equal(copy.self, undefined);
    assert.equal(copy.first.parent, undefined);
    assert.equal(copy.second.value, 1);
    assert.notEqual(copy.first, copy.second);
    assert.notEqual(copy.first, copy.array[0]);
    copy.first.value = 2;
    assert.equal(copy.second.value, 1);
    assert.equal(shared.value, 1);
    assert.equal(seen.length, 0);
});

test("Actual Edem lazy-page codec publishes detached updates without global-array ownership", () => {
    const { edemFixture } = require("./helpers/edem-driver-fixture.cjs");
    const f = edemFixture();
    f.mount("edem");
    f.host.sPageSize = 0.2;
    let rows,
        updates = 0;
    const done = () => {
        rows = f.host.mediaRecords;
        f.host.mediaRecords = [];
    };
    done.publish = (next, _title, selected) => {
        rows = next;
        updates++;
        assert.equal(selected, 3);
    };
    f.host.getMediaArray("", done);
    f.requests[0].resolve({
        count: 6,
        items: [{ title: "One", type: "stream" }, { type: "next" }],
        type: "category",
    });
    f.host.selIndex = 3;
    rows[3].description();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve({
        items: [
            { title: "Two", type: "stream" },
            { title: "Three", type: "stream" },
        ],
    });
    assert.equal(updates, 1);
    assert.equal(rows[3].title, "Three");
    assert.equal(f.host.mediaRecords.length, 0);
    f.host.selIndex = 5;
    rows[5].description();
    f.host.providerMediaClient.cancel();
    f.requests[2].resolve({ items: [{ title: "Stale", type: "stream" }] });
    assert.equal(updates, 1);
});

test("Actual VPortal quality resolver retains parent ownership and starts only selected quality", () => {
    for (const action of ["accept", "back", "replace"]) {
        const c = fixture(),
            requests = [];
        vm.runInContext(
            sourceFunctions("src/plugins/vportal.ts", [
                "parseVPortalLink",
                "createVPortalClient",
            ]),
            c
        );
        c.$.ajax = (options) => {
            const request = { abort() {}, options };
            requests.push(request);
            return request;
        };
        c.closeList = () => {
            c.__ottClassicScreenPort.closeList();
            c.cancelMediaLoad();
        };
        c.showPage = () => c.__ottClassicScreenPort.commitList();
        c.providerMediaClient = c.createVPortalClient(
            "portal::[key:fixture]https://portal.test/api"
        );
        c.getMediaArray = c.providerMediaClient.load;
        const reply = (index, data) => {
            requests[index].options.success(data);
            requests[index].options.complete();
        };
        c.mediaList(null);
        reply(0, {
            items: [
                {
                    request: { cmd: "play", id: 42 },
                    title: "Film",
                    type: "stream",
                },
            ],
            type: "category",
        });
        const parent = c.__ottClassicScreenPort.listOwner();
        c.selectMedia(0);
        reply(1, {
            url: "https://low",
            variants: { high: "https://high", low: "https://low" },
        });
        assert.equal(c.calls.filter((call) => call[0] === "play").length, 0);
        assert(parent.active());
        const saved = c.selectBoxKeyHandler;
        if (action === "back") {
            saved(c.keys.RETURN);
            saved(c.keys.ENTER);
            assert(parent.active());
            assert.equal(
                c.calls.filter((call) => call[0] === "play").length,
                0
            );
        } else if (action === "replace") {
            c.listArray = [{ title: "Other screen" }];
            c.listDataArray = c.listArray;
            c.showPage();
            saved(c.keys.ENTER);
            assert(!parent.active());
            assert.equal(
                c.calls.filter((call) => call[0] === "play").length,
                0
            );
        } else {
            saved(c.keys.LEFT);
            saved(c.keys.ENTER);
            assert(
                c.calls.some(
                    (call) => call[0] === "play" && call[1] === "https://high"
                )
            );
            assert.equal(c.documentState().history.length, 1);
        }
    }
});

test("Disabled persistence can be re-enabled without poisoning the journal and retired resume prompts cannot seek", () => {
    const c = fixture();
    c.sFavorites = -1;
    c.mediaList(null);
    c.selectMedia(0);
    assert(
        !Object.keys(c.stored).some((key) => key.indexOf("mediaJournal") === 0)
    );
    c.__ottClassicPlayback.command({ type: "stop" });
    c.sFavorites = 0;
    c._playMedia({ id: 5, stream_url: "enabled.mp4", title: "Enabled" });
    c.setCurrent(0, -1);
    c.__ottClassicPlayback.command({ type: "stop" });
    c._playMedia({ id: 5, stream_url: "renewed.mp4", title: "Enabled" });
    assert.equal(c.documentState().history[0].itemId, "provider:5");
    const seeks = c.calls.filter((call) => call[0] === "seek").length;
    c.__ottClassicPlayback.command({ type: "stop" });
    c.confirm();
    assert.equal(c.calls.filter((call) => call[0] === "seek").length, seeks);
});

test("Actual Edem portal ownership changes source identity without issuing transport", () => {
    const { edemFixture } = require("./helpers/edem-driver-fixture.cjs");
    const f = edemFixture(),
        c = fixture();
    f.driver = f.mount("edem");
    c.__ottActiveProviderDriver = f.driver;
    c.p_pref = "ed";
    const before = c.__ottMedia.sourceId(),
        count = f.requests.length;
    const television = c.__ottClassicPlayback.sourceId();
    assert.equal(c.__ottMedia.sourceId(), before);
    f.driver.saveSettings({
        ...f.driver.settings(),
        portal: "portal::[key:replacement]https://portal.test/api",
    });
    assert.notEqual(c.__ottMedia.sourceId(), before);
    assert.equal(c.__ottClassicPlayback.sourceId(), television);
    assert.equal(f.requests.length, count);
});

test("Screen replacement owns pending media while internal rendering and quality suspension preserve it", () => {
    const c = fixture();
    let cleanups = [];
    const replace = () => {
        const old = cleanups;
        cleanups = [];
        old.forEach((fn) => fn());
    };
    c.__ottClassicScreenPort = {
        listOwner: () => ({ own: (fn) => cleanups.push(fn) }),
    };
    const render = c.__ottRenderMedia;
    c.__ottRenderMedia = (view) => {
        replace();
        render(view);
    };
    c.mediaList(null);
    c.selectMedia(1);
    assert.equal(c.__ottMedia.snapshot().frame.route.target, "catalog.xml");
    const original = c.getMediaArray;
    let callback;
    c.getMediaArray = (url, done) => {
        if (url === "pending") callback = done;
        else original(url, done);
    };
    c.mediaList(null);
    c.requestMediaList("pending");
    assert(callback.isCurrent());
    replace();
    assert(!callback.isCurrent());
    c.mediaRecords = [{ stream_url: "late.mp4", title: "Stale" }];
    callback();
    assert(!c.listArray.some((row) => row.title === "Stale"));
});

test("Rejected nonthrowing writes cannot publish journal changes or claim imported data", () => {
    const c = fixture(),
        values = {};
    let reject = false;
    const journal = c.__ottMediaJournal.create({
        core: c.OttPlayCore,
        importRows: () => [],
        limit: () => 20,
        read: (key) => values[key] || null,
        sourceId: "s",
        write: (key, value) => {
            if (!reject) values[key] = value;
        },
    });
    journal.read();
    reject = true;
    assert.equal(
        journal.change("favorite", {
            itemId: "i",
            payload: {},
            position: 0,
            sourceId: "s",
        }),
        false
    );
    assert.equal(journal.read().document.favorites.length, 0);
    const f = fixture();
    f.stored.medHistory = JSON.stringify([
        { stream_url: "old.mp4", title: "Old" },
    ]);
    f.providerSetItem = () => {};
    f.mediaList(-1);
    assert.equal(f.listArray.length, 1);
    assert.equal(f.listArray[0].__ottMediaFilter, true);
    assert(
        !Object.keys(f.stored).some(
            (key) => key.indexOf("mediaJournalLegacyOwner") === 0
        )
    );
});

test("Synchronous source replacement during storage reads cannot publish the old account projections", () => {
    const c = fixture();
    const replacement = [{ title: "Replacement" }];
    const get = c.providerGetItem;
    c.providerGetItem = (key) => {
        if (key.indexOf("mediaJournal.v1:") === 0) {
            c.p_pref = "replacement";
            c.medHistory = replacement;
            c.medFavorites = replacement;
        }
        return get(key);
    };
    c.mediaList(-1);
    assert.equal(c.medHistory, replacement);
    assert.equal(c.medFavorites, replacement);
    assert(
        !Object.keys(c.stored).some((key) => key.indexOf("mediaJournal") === 0)
    );
});

function episodeFixture(ids = [30, 2, 11]) {
    const c = fixture();
    c.catalogs[""] = ids.map((id) => ({
        __ottMediaSequence: true,
        id,
        request: { fid: id },
        title: "Episode " + id,
    }));
    c.catalogs[""].splice(1, 0, {
        playlist_url: "elsewhere",
        title: "Navigation",
    });
    c.resolutions = [];
    c.providerMediaClient = {
        cancel() {},
        resolve(item, done, automatic) {
            c.resolutions.push({ automatic, item });
            const resolved = {
                ...item,
                stream_url:
                    item.id +
                    "-" +
                    (c.fixedUrls ? 1 : c.resolutions.length) +
                    ".mp4",
            };
            if (c.defer) c.pendingEpisode = () => done(resolved);
            else done(resolved);
        },
    };
    c.closeList = () => c.__ottMedia.cancel();
    c.stbStop = () => {
        c.__ottMedia.cancelAuto();
        c.__ottClassicPlayback.command({ type: "stop" });
    };
    c.finishEpisode = () => {
        c.__ottClassicPlayback.command({ type: "stop" });
        c.__ottMedia.ended(c.__ottClassicPlayback.snapshot().generation);
    };
    c.mediaList(null);
    c.selectMedia(0);
    return c;
}

test("Episode completion preserves provider order, resolves fresh URLs and loops last to first", () => {
    const c = episodeFixture();
    c.settings.stopPlay = true;
    const first = c.__ottMedia.current();
    c.__ottClassicPlayback.command({
        duration: 600,
        position: 599,
        type: "position",
    });
    c.__ottMedia.checkpoint(first.ref, 599, true);
    c.finishEpisode();
    assert.equal(
        c.documentState().history.find((row) => row.itemId === first.ref.itemId)
            .position,
        0,
        "The next episode's departure checkpoint cannot restore the completed position"
    );
    c.finishEpisode();
    c.finishEpisode();
    assert.deepEqual(
        c.resolutions.map((row) => row.item.id),
        [30, 2, 11, 30]
    );
    assert.deepEqual(
        c.resolutions.map((row) => row.automatic),
        [false, true, true, true]
    );
    assert.deepEqual(
        c.calls.filter((row) => row[0] === "play").map((row) => row[1]),
        ["30-1.mp4", "2-2.mp4", "11-3.mp4", "30-4.mp4"]
    );
    assert(
        !c.calls.some((row) => row[0] === "confirm"),
        "automatic restarts do not prompt to resume"
    );
    assert.equal(
        c.documentState().history.find((row) => row.itemId === first.ref.itemId)
            .position,
        0
    );
});

test("Automatic episode completion preserves a reopened browsing menu", () => {
    const c = episodeFixture();
    const browsing = [{ title: "Reopened browsing menu" }];
    c.listArray = c.listDataArray = browsing;
    c.closeList = () => {
        c.__ottMedia.cancelAuto();
        assert.fail("Automatic playback must not dismiss the current menu");
    };
    c.finishEpisode();
    assert.deepEqual(
        c.resolutions.map((row) => row.item.id),
        [30, 2]
    );
    assert.strictEqual(c.listArray, browsing);
    assert.strictEqual(c.listDataArray, browsing);
    assert.equal(c.calls.filter((row) => row[0] === "play").length, 2);
});

test("A synchronous Stop during the next episode's journal write cancels its playback", () => {
    const c = fixture();
    const write = c.providerSetItem;
    let armed = false;
    c.providerSetItem = (key, value) => {
        write(key, value);
        if (
            armed &&
            key.startsWith("mediaJournal.v1:") &&
            JSON.parse(value).history[0]?.itemId === "provider:2"
        ) {
            armed = false;
            c.__ottMedia.cancelAuto();
            c.__ottClassicPlayback.command({ type: "stop" });
        }
    };
    c.catalogs[""] = [
        { __ottMediaSequence: true, id: 1, stream_url: "one.mp4" },
        { __ottMediaSequence: true, id: 2, stream_url: "two.mp4" },
    ];
    c.mediaList(null);
    c.selectMedia(0);
    const first = c.__ottMedia.current();
    armed = true;
    c.__ottClassicPlayback.command({ type: "stop" });
    c.__ottMedia.ended(c.__ottClassicPlayback.snapshot().generation);
    assert.equal(armed, false, "The cancellation ran inside the journal write");
    assert.strictEqual(c.__ottMedia.current(), first);
    assert.equal(c.calls.filter((row) => row[0] === "play").length, 1);
});

test("Single episode loops; ordinary films and saved collections never become episode queues", () => {
    const single = episodeFixture([7]);
    single.finishEpisode();
    assert.deepEqual(
        single.resolutions.map((row) => row.item.id),
        [7, 7]
    );
    const movie = fixture();
    movie.mediaList(null);
    movie.selectMedia(0);
    movie.__ottClassicPlayback.command({ type: "stop" });
    movie.__ottMedia.ended(movie.__ottClassicPlayback.snapshot().generation);
    assert.equal(movie.calls.filter((row) => row[0] === "play").length, 1);
    for (const collection of [-1, -2]) {
        const c = episodeFixture();
        c.__ottMedia.favorite(c.__ottMedia.current().payload);
        c.mediaList(collection);
        c.selectMedia(0);
        const count = c.resolutions.length;
        c.finishEpisode();
        assert.equal(c.resolutions.length, count);
    }
});

test("Duplicate completion, Stop, Back, source replacement and manual selection revoke auto resolve", () => {
    for (const cancel of ["stop", "back", "source", "select"]) {
        const c = episodeFixture();
        c.defer = true;
        c.finishEpisode();
        const done = c.pendingEpisode;
        const generation = c.__ottClassicPlayback.snapshot().generation;
        c.__ottMedia.ended(generation);
        assert.equal(c.resolutions.length, 2, "completion dispatches once");
        if (cancel === "stop") c.stbStop();
        else if (cancel === "back") c.__ottMedia.back();
        else if (cancel === "source") c.providerGetItem = () => null;
        else {
            c.defer = false;
            c.__ottMedia.select(3);
        }
        const plays = c.calls.filter((row) => row[0] === "play").length;
        done();
        assert.equal(
            c.calls.filter((row) => row[0] === "play").length,
            plays,
            cancel
        );
    }
});

test("Auto-next respects parental access and Stop or navigation revokes a pending PIN", () => {
    for (const action of ["allow", "stop", "back"]) {
        const c = fixture();
        c.catalogs[""] = [
            { __ottMediaSequence: true, id: 1, stream_url: "one.mp4" },
            {
                __ottMediaSequence: true,
                adult: 1,
                id: 2,
                stream_url: "two.mp4",
            },
        ];
        c.mediaList(null);
        c.selectMedia(0);
        c.__ottClassicPlayback.command({ type: "stop" });
        c.__ottMedia.ended(c.__ottClassicPlayback.snapshot().generation);
        assert.equal(typeof c.unlock, "function");
        assert.equal(c.calls.filter((row) => row[0] === "play").length, 1);
        if (action === "stop") c.__ottMedia.cancelAuto();
        if (action === "back") c.__ottMedia.back();
        c.parentAccess = true;
        c.unlock();
        assert.equal(
            c.calls.filter((row) => row[0] === "play").length,
            action === "allow" ? 2 : 1
        );
    }
});

function applyTitleFilter(c, value) {
    c.__ottMedia.filter();
    c.editvar = value;
    c.setEdit();
}

test("Title filter matches series and films while preserving navigation across pages and Back", () => {
    const c = fixture();
    c.catalogs[""] = [{ playlist_url: "series", title: "Cartoon series" }];
    c.catalogs.series = [
        { __ottMediaFilterable: true, playlist_url: "cats", title: "Три кота" },
        {
            __ottMediaFilterable: true,
            playlist_url: "other",
            title: "Другой сериал",
        },
        { stream_url: "movie.mp4", title: "Три кота: фильм" },
        { stream_url: "other.mp4", title: "Другой фильм" },
        { playlist_url: "page2", title: "Next" },
        { playlist_url: "search", search_on: 1, title: "Search" },
    ];
    c.catalogs.page2 = [
        { __ottMediaFilterable: true, playlist_url: "other2", title: "Другие" },
        { playlist_url: "page3", title: "Next" },
    ];
    c.catalogs.page3 = [
        {
            __ottMediaFilterable: true,
            playlist_url: "more",
            title: "ТРИ КОТА — новое",
        },
    ];
    c.mediaList(null);
    applyTitleFilter(c, "  ТРИ   КОТ  ");
    c.selectMedia(0);
    assert.deepEqual(plain(c.listArray.map((row) => row.title)), [
        "Три кота",
        "Три кота: фильм",
        "Next",
        "Search",
        "Filter: ТРИ   КОТ",
    ]);
    c.selectMedia(2);
    assert.deepEqual(plain(c.listArray.map((row) => row.title)), [
        "Next",
        "Filter: ТРИ   КОТ",
    ]);
    c.selectMedia(0);
    assert.equal(c.listArray[0].title, "ТРИ КОТА — новое");
    c.__ottMedia.back();
    c.__ottMedia.back();
    assert.equal(c.__ottMedia.snapshot().filter, "ТРИ   КОТ");
    assert.equal(c.listArray.length, 5);
    const fetches = c.calls.filter((call) => call[0] === "fetch").length;
    applyTitleFilter(c, "");
    assert.equal(
        c.listArray.length,
        7,
        "clear restores the already loaded full page"
    );
    assert.equal(c.calls.filter((call) => call[0] === "fetch").length, fetches);
});

test("Filter preserves selected identity, rejects stale editors and resets with the source", () => {
    const c = fixture();
    c.catalogs[""] = [
        { id: 1, stream_url: "a", title: "Other" },
        { id: 2, stream_url: "b", title: "Ёжик" },
    ];
    c.mediaList(null);
    c.__ottMedia.highlight(1, c.__ottMedia.snapshot().revision);
    applyTitleFilter(c, "еж");
    assert.equal(c.__ottMedia.snapshot().frame.selected, 0);
    assert.equal(c.listArray[0].id, 2);
    c.__ottMedia.filter();
    const stale = c.setEdit;
    applyTitleFilter(c, "other");
    c.editvar = "stale";
    stale();
    assert.equal(c.__ottMedia.snapshot().filter, "other");
    c.__ottMedia.filter();
    const retired = c.setEdit;
    c.providerGetItem = () => null;
    c.mediaList(null);
    c.editvar = "retired";
    retired();
    assert.equal(c.__ottMedia.snapshot().filter, "");
    assert.equal(c.listArray[0].title, "Other");
    const filter = c.listArray.find((row) => row.__ottMediaFilter);
    c.__ottMedia.favorite(filter);
    assert.equal(c.medFavorites.length, 0);
});

test("Filtering retains incremental page ownership and never leaks the unfiltered catalog", () => {
    const c = fixture();
    let publish;
    c.getMediaArray = (_target, done) => {
        publish = done.publish;
        c.mediaRecords = [
            { id: 1, stream_url: "a", title: "Other" },
            { id: 2, stream_url: "b", title: "Match" },
        ];
        done();
    };
    c.mediaList(null);
    applyTitleFilter(c, "match");
    publish(
        [
            { id: 1, stream_url: "a", title: "Other" },
            { id: 3, stream_url: "c", title: "Match fresh" },
        ],
        "Updated",
        1
    );
    assert.equal(c.listArray[0].id, 3);
    assert.equal(
        c.__ottMedia.snapshot().frame.selected,
        0,
        "provider raw selection maps to its filtered item"
    );
    const view = c.__ottMedia.snapshot();
    assert.equal(view.frame.catalog, undefined);
    assert.equal(c.mediaRecords.filter((row) => row.stream_url).length, 2);
    assert(!c.mediaRecords.some((row) => row.__ottMediaFilter));
    c.listArray[0].title = "Poisoned projection";
    applyTitleFilter(c, "");
    assert.equal(c.listArray[1].title, "Match fresh");
});

test("Applying a filter cancels a pending manual resolver and rejects its late result", () => {
    const c = fixture();
    let pending;
    let cancellations = 0;
    c.providerMediaClient = {
        cancel() {
            cancellations++;
        },
        resolve(_item, done) {
            pending = done;
        },
    };
    c.catalogs[""] = [
        { id: 1, stream_url: "first.mp4", title: "First" },
        { id: 2, stream_url: "other.mp4", title: "Other" },
    ];
    c.mediaList(null);
    c.selectMedia(0);
    const before = cancellations;
    applyTitleFilter(c, "other");
    assert(cancellations > before, "The pending transport is cancelled");
    assert.equal(pending.isCurrent(), false);
    pending({ id: 1, stream_url: "late.mp4", title: "First" });
    assert.equal(c.calls.filter((call) => call[0] === "play").length, 0);
    assert.equal(c.listArray[0].id, 2);
});

test("Incremental provider appends retain hidden media without copying view controls", () => {
    const c = fixture();
    let publish;
    c.getMediaArray = (_target, done) => {
        publish = done.publish;
        c.mediaRecords = [
            { id: 1, stream_url: "a", title: "Other" },
            { id: 2, stream_url: "b", title: "Match" },
        ];
        done();
    };
    c.mediaList(null);
    applyTitleFilter(c, "match");
    assert.deepEqual(plain(c.mediaRecords.map((row) => row.id)), [1, 2]);
    c.mediaRecords.push({ id: 3, stream_url: "c", title: "Match fresh" });
    publish(c.mediaRecords, "Updated", 2);
    for (const route of ["history", "favorites"])
        assert.equal(
            c.listArray.filter((row) => row.__ottMediaRoute === route).length,
            1,
            "Incremental results must not duplicate " + route
        );
    assert.equal(c.listArray.filter((row) => row.__ottMediaFilter).length, 1);
    assert.equal(c.__ottMedia.snapshot().frame.selected, 1);
    assert.equal(c.listArray[1].id, 3);
    applyTitleFilter(c, "");
    assert.deepEqual(
        plain(c.listArray.filter((row) => row.id).map((row) => row.id)),
        [1, 2, 3]
    );
});

test("Title filtering leaves explicit episodes and their autoplay order intact", () => {
    const c = episodeFixture();
    c.stbStop();
    applyTitleFilter(c, "Episode 30");
    assert.deepEqual(
        plain(
            c.listArray
                .filter((row) => row.__ottMediaSequence)
                .map((row) => row.id)
        ),
        [30, 2, 11]
    );
    c.selectMedia(0);
    c.finishEpisode();
    c.finishEpisode();
    assert.deepEqual(
        c.resolutions.slice(-3).map((row) => row.item.id),
        [30, 2, 11]
    );
});

test("Saving the Filter row focuses the first matching media instead of the control", () => {
    const c = fixture();
    c.catalogs[""] = [
        { id: 1, stream_url: "a", title: "Other" },
        { id: 2, stream_url: "b", title: "Match" },
    ];
    c.mediaList(null);
    c.selectMedia(c.listArray.findIndex((row) => row.__ottMediaFilter));
    c.editvar = "match";
    c.setEdit();
    assert.equal(c.__ottMedia.snapshot().frame.selected, 0);
    assert.equal(c.listArray[0].id, 2);
    c.selectMedia(c.listArray.findIndex((row) => row.__ottMediaFilter));
    c.editvar = "";
    c.setEdit();
    assert.equal(c.__ottMedia.snapshot().frame.selected, 0);
    assert.equal(c.listArray[0].id, 1);
});

test("Saved episode entries remain filterable in history and favorites", () => {
    const c = episodeFixture();
    c.finishEpisode();
    c.__ottMedia.favorite(c.listArray.find((row) => row.id === 30));
    c.__ottMedia.favorite(c.listArray.find((row) => row.id === 2));
    for (const target of [-1, -2]) {
        c.__ottMedia.open(target);
        applyTitleFilter(c, "Episode 30");
        assert.deepEqual(
            plain(c.listArray.filter((row) => row.id).map((row) => row.id)),
            [30]
        );
        applyTitleFilter(c, "no matching title");
        assert.equal(c.listArray.length, 1);
        assert.equal(c.listArray[0].__ottMediaFilter, true);
        applyTitleFilter(c, "");
        assert.equal(c.listArray.filter((row) => row.id).length, 2);
    }
});

test("Independent NAS leases preserve foreground catalogs while automatic episodes resolve", () => {
    for (const catalogFirst of [false, true]) {
        const c = fixture(),
            requests = [],
            timers = new Map();
        let timerId = 0,
            catalogs = 0;
        const played = [];
        c.location = { host: "player.test", protocol: "https:" };
        c.__OTTPLAY_HOSTED__ = { version: 1, vportal: { routes: [] } };
        c.setInterval = (run) => {
            timers.set(++timerId, run);
            return timerId;
        };
        c.clearInterval = (id) => timers.delete(id);
        vm.runInContext(
            sourceFunctions("src/plugins/vportal.ts", [
                "parseVPortalLink",
                "createVPortalClient",
            ]),
            c
        );
        c.$.ajax = (options) => {
            const request = {
                abort() {
                    this.aborted = true;
                    options.error?.({}, "abort");
                    options.complete?.();
                },
                aborted: false,
                options,
                reply(data) {
                    options.success?.(data);
                    options.complete?.();
                },
            };
            requests.push(request);
            return request;
        };
        const source = "nas:independent",
            client = c.createVPortalClient("", {
                directEndpoint: "/nas/api",
                preferDefault: true,
                sourceId: source,
            });
        const payload = (id) => ({
            request: { cmd: "play", id },
            title: "Episode",
            vportalSource: source,
        });
        const lease = (id) => ({
            heartbeat:
                "https://player.test/nas/stream/ping" + id + ".sig/media.ts",
            stop: "https://player.test/nas/stream/stop" + id + ".sig/media.ts",
            url:
                "https://player.test/nas/stream/video" + id + ".sig/media.m3u8",
        });
        client.resolve(payload(1), (item) => played.push(item));
        requests.at(-1).reply(lease(1));
        client.load(
            { request: { cmd: "browse" }, vportalSource: source },
            () => catalogs++
        );
        const catalog = requests.at(-1);
        client.resolve(payload(2), (item) => played.push(item), true);
        assert.equal(catalog.aborted, false);
        assert.equal(
            requests.at(-1).options.url,
            "/nas/stream/stop1.sig/media.ts"
        );
        assert.equal(timers.size, 0);
        requests.at(-1).reply("");
        const episode = requests.at(-1);
        assert.equal(
            episode.options.url,
            "/nas/api",
            "An installation keeps its explicit endpoint on hosted pages"
        );
        assert.equal(JSON.parse(episode.options.data).key, undefined);
        const catalogReply = () =>
            catalog.reply({ items: [], type: "category" });
        if (catalogFirst) catalogReply();
        episode.reply(lease(2));
        if (!catalogFirst) catalogReply();
        assert.equal(catalogs, 1);
        assert.equal(played.length, 2);
        assert.equal(timers.size, 1);
        client.cancelAutomatic();
        assert.equal(
            timers.size,
            1,
            "Automatic cancellation preserves admitted playback"
        );
        client.resolve(payload(3), (item) => played.push(item));
        requests.at(-1).reply("");
        const foreground = requests.at(-1);
        foreground.options.success(lease(3));
        const count = requests.length;
        client.cancelAutomatic();
        assert.equal(
            requests.length,
            count,
            "A pending foreground lease does not belong to the automatic request lane"
        );
        foreground.options.complete();
        assert.equal(played.length, 3);
        assert.equal(timers.size, 1);
        client.dispose();
        assert.equal(timers.size, 0);
        assert.equal(
            requests.at(-1).options.url,
            "/nas/stream/stop3.sig/media.ts"
        );
    }
});

function remoteQueueFixture() {
    const c = fixture();
    c.commandChannelsReady = false;
    c.resolutions = [];
    c.replies = [];
    c.providerMediaClient = {
        cancel() {},
        cancelAutomatic() {},
        resolve(item, done, automatic) {
            c.resolutions.push({ automatic, item });
            const playable = {
                ...item,
                stream_url: item.id + "-" + c.resolutions.length + ".mp4",
            };
            c.completeResolve = () => done(playable);
            if (!c.deferResolve) c.completeResolve();
        },
        search(query, done, guard) {
            c.searchQuery = query;
            c.completeSearch = (items, error) => {
                if (guard()) done({ error, items });
            };
            return () => {
                c.searchCancelled = true;
            };
        },
    };
    vm.runInContext(
        sourceFunctions("src/commands/remote-requests.ts", [
            "executeRemoteRequest",
        ]),
        c
    );
    c.requestQueue = (action = "vportal", query = "  Фильм  ") =>
        c.executeRemoteRequest({ action, params: { query } }, (reply) =>
            c.replies.push(plain(reply))
        );
    c.finishItem = () => {
        c.__ottClassicPlayback.command({ type: "stop" });
        c.__ottMedia.ended(c.__ottClassicPlayback.snapshot().generation);
    };
    return c;
}

test("Remote VPortal queue loops every result in order with fresh URLs and no resume or quality prompt", () => {
    for (const ids of [[30, 2, 11], [7]]) {
        const c = remoteQueueFixture();
        c.requestQueue();
        assert.equal(c.searchQuery, "Фильм");
        assert.equal(c.resolutions.length, 0, "Wait for the complete search");
        c.completeSearch(
            ids.map((id) => ({ id, request: { id }, title: "Фильм " + id }))
        );
        assert.equal(
            c.replies.length,
            1,
            JSON.stringify({
                calls: c.calls,
                resolutions: c.resolutions,
                state: c.__ottClassicPlayback.snapshot(),
            })
        );
        assert.deepEqual(c.replies[0], {
            data: {
                dispatched: true,
                items: ids.map((id, index) => ({
                    number: index + 1,
                    title: "Фильм " + id,
                })),
                loop: true,
                total: ids.length,
            },
            status: "ok",
        });
        for (let n = 0; n < ids.length; n++) c.finishItem();
        assert.deepEqual(
            c.resolutions.map((row) => row.item.id),
            [...ids, ids[0]]
        );
        assert(c.resolutions.every((row) => row.automatic));
        assert.equal(
            c.calls.filter((row) => row[0] === "play").length,
            ids.length + 1
        );
        assert(
            !c.calls.some((row) => row[0] === "confirm" || row[0] === "pin")
        );
        assert(!JSON.stringify(c.replies).includes(".mp4"));
    }
});

test("Remote VPortal list-only and empty or failed searches never start a queue", () => {
    const listing = remoteQueueFixture();
    listing.requestQueue("vportal_search");
    listing.completeSearch([
        {
            id: 1,
            request: { key: "not-public" },
            stream_url: "https://private.invalid/video?token=secret",
            title: "Film",
        },
    ]);
    assert.deepEqual(listing.replies, [
        {
            data: { items: [{ number: 1, title: "Film" }], total: 1 },
            status: "ok",
        },
    ]);
    assert.equal(listing.resolutions.length, 0);
    for (const error of [undefined, "provider URL and key must not leak"]) {
        const c = remoteQueueFixture();
        c.requestQueue();
        c.completeSearch([], error);
        assert.equal(c.replies[0].status, "rejected");
        assert.equal(c.resolutions.length, 0);
        assert(!JSON.stringify(c.replies).includes("must not leak"));
    }
});

test("A replacement remote queue restarts its shared first item and advances through the new selection", () => {
    const c = remoteQueueFixture();
    c.fixedUrls = true;
    for (const ids of [
        [1, 2],
        [1, 3],
    ]) {
        c.requestQueue();
        c.completeSearch(
            ids.map((id) => ({ id, request: { id }, title: "Film " + id }))
        );
    }
    assert.equal(c.replies.length, 2);
    assert.equal(c.calls.filter((row) => row[0] === "play").length, 2);
    c.finishItem();
    assert.deepEqual(
        c.resolutions.map((row) => row.item.id),
        [1, 1, 3]
    );
});

test("Repeated Stop while already stopped cancels a pending remote search", () => {
    const c = remoteQueueFixture();
    c.__ottClassicPlayback.reconcile();
    c.__ottClassicPlayback.command({ type: "stop" });
    c.requestQueue();
    const generation = c.__ottClassicPlayback.snapshot().generation;
    c.__ottMedia.cancelAuto();
    c.__ottClassicPlayback.command({ type: "stop" });
    assert.equal(c.__ottClassicPlayback.snapshot().generation, generation);
    c.completeSearch([{ id: 1, request: { id: 1 }, title: "Film" }]);
    assert.equal(c.resolutions.length, 0);
    assert.equal(c.replies.length, 0);
    assert.equal(c.calls.filter((row) => row[0] === "play").length, 0);
});

test("Oversized remote queue metadata is rejected before playback dispatch", () => {
    const c = remoteQueueFixture();
    c.requestQueue();
    c.completeSearch([
        { id: 1, request: { id: 1 }, title: "я".repeat(500000) },
    ]);
    assert.equal(c.replies[0].status, "rejected");
    assert.match(c.replies[0].data.error, /more specific/);
    assert.equal(c.resolutions.length, 0);
});

test("Remote VPortal validates queries and rejects unavailable or parental-locked queues", () => {
    for (const query of ["", "   ", "я".repeat(513), "\ud800"]) {
        const c = remoteQueueFixture();
        c.requestQueue("vportal", query);
        assert.equal(c.replies[0].status, "rejected");
        assert.equal(c.searchQuery, undefined);
    }
    const missing = remoteQueueFixture();
    delete missing.providerMediaClient.search;
    missing.requestQueue();
    assert.equal(missing.replies[0].status, "unsupported");
    const locked = remoteQueueFixture();
    locked.requestQueue();
    locked.completeSearch([
        { adult: 1, id: 1, request: { id: 1 }, title: "Film" },
    ]);
    assert.equal(locked.replies[0].status, "rejected");
    assert.equal(locked.resolutions.length, 0);
    assert(!locked.calls.some((row) => row[0] === "pin"));
});

test("Remote request cancellation, Stop and source replacement block late search and stream replies", () => {
    for (const at of ["search", "resolve"]) {
        for (const action of ["cancel", "stop", "source"]) {
            const c = remoteQueueFixture();
            c.deferResolve = true;
            const cancel = c.requestQueue();
            if (at === "resolve")
                c.completeSearch([
                    { id: 1, request: { id: 1 }, title: "Film" },
                ]);
            if (action === "cancel") cancel();
            if (action === "stop") {
                c.__ottMedia.cancelAuto();
                c.__ottClassicPlayback.command({ type: "stop" });
            }
            if (action === "source") c.providerMediaClient = {};
            if (at === "search")
                c.completeSearch([
                    { id: 1, request: { id: 1 }, title: "Film" },
                ]);
            else c.completeResolve();
            assert.equal(
                c.calls.filter((row) => row[0] === "play").length,
                0,
                at + ": " + action
            );
            assert.equal(c.replies.length, 0);
        }
    }
});

test("A remote queue's direct-URL identity retains its provider page when reloaded from history", () => {
    const c = remoteQueueFixture();
    c.requestQueue();
    const origin = {
        kind: "catalog",
        target: "provider-page",
        title: "Provider page",
    };
    c.completeSearch([
        {
            __ottMediaOrigin: origin,
            stream_url: "old.mp4",
            title: "Same title",
        },
    ]);
    const original = c.__ottMedia.current().ref.itemId;
    c.__ottMedia.checkpoint(c.__ottMedia.current().ref, 150, true);
    c.catalogs["provider-page"] = [
        { stream_url: "renewed.mp4", title: "Same title" },
    ];
    c.mediaList(-1);
    c.selectMedia(0);
    assert.equal(c.__ottMedia.current().ref.itemId, original);
    assert.equal(
        c.resolutions.length,
        2,
        "History found the item in its originating page"
    );
});

console.log(`PASS MediaLibrary/MediaJournal ${groups} scenario groups`);
require("./test_media_filter_ownership.cjs");
