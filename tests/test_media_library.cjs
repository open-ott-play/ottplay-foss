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
    assert.equal(f.listArray.length, 0);
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

console.log(`PASS MediaLibrary/MediaJournal ${groups} scenario groups`);
