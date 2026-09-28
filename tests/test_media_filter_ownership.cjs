const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture } = require("./test_port_vod.cjs");

function applyFilter(c, value) {
    c.__ottMedia.filter();
    c.editvar = value;
    c.setEdit();
}

function visibleIds(c) {
    return Array.from(
        c.listArray.filter((row) => row.id),
        (row) => row.id
    );
}

test("Navigation during resolver cancellation discards the interrupted filter edit", () => {
    const c = fixture();
    let replaceOnCancel = false;
    c.catalogs[""] = [
        { id: 1, stream_url: "a.mp4", title: "Other" },
        { id: 2, stream_url: "b.mp4", title: "Match" },
    ];
    c.catalogs.child = [
        { id: 3, stream_url: "c.mp4", title: "Other child" },
        { id: 4, stream_url: "d.mp4", title: "Match child" },
    ];
    c.providerMediaClient = {
        cancel() {
            if (!replaceOnCancel) return;
            replaceOnCancel = false;
            c.__ottMedia.open("child");
        },
        resolve() {},
    };
    c.mediaList(null);
    c.selectMedia(0);
    c.__ottMedia.filter();
    c.editvar = "match";
    replaceOnCancel = true;
    c.setEdit();
    assert.equal(c.__ottMedia.snapshot().frame.route.target, "child");
    assert.equal(c.__ottMedia.snapshot().filter, "");
    assert.deepEqual(visibleIds(c), [3, 4]);
    c.__ottMedia.back();
    assert.equal(c.__ottMedia.snapshot().filter, "");
    assert.deepEqual(visibleIds(c), [1, 2]);
});

test("A highlight from before refilter cannot change selection in the new projection", () => {
    const c = fixture();
    c.catalogs[""] = [
        { id: 1, stream_url: "a.mp4", title: "Other" },
        { id: 2, stream_url: "b.mp4", title: "Match A" },
        { id: 3, stream_url: "c.mp4", title: "Match B" },
    ];
    c.mediaList(null);
    const staleRevision = c.__ottMedia.snapshot().revision;
    applyFilter(c, "match");
    assert.equal(c.__ottMedia.snapshot().frame.selected, 0);
    c.__ottMedia.highlight(1, staleRevision);
    assert.equal(c.__ottMedia.snapshot().frame.selected, 0);
    c.__ottMedia.highlight(1, c.__ottMedia.snapshot().revision);
    assert.equal(c.__ottMedia.snapshot().frame.selected, 1);
});

test("Incremental replacement at the same selected index revokes an old PIN intent", () => {
    const c = fixture();
    let publish;
    c.getMediaArray = (_target, done) => {
        publish = done.publish;
        c.mediaRecords = [
            { adult: 1, id: 1, stream_url: "old.mp4", title: "Old" },
        ];
        done();
    };
    c.sPSchannels = 1;
    c.parentPIN = "1234";
    c.parentAccess = false;
    c.mediaList(null);
    c.selectMedia(0);
    const oldApproval = c.unlock;
    assert.equal(typeof oldApproval, "function");
    publish(
        [{ adult: 1, id: 2, stream_url: "new.mp4", title: "New" }],
        "Updated",
        0
    );
    assert.equal(c.listArray[0].id, 2);
    oldApproval();
    assert.equal(c.calls.filter((call) => call[0] === "play").length, 0);
});

test("Committing a filter revokes a pending autoplay PIN without changing episode membership", () => {
    const c = fixture();
    c.catalogs[""] = [
        {
            __ottMediaSequence: true,
            id: 1,
            stream_url: "one.mp4",
            title: "One",
        },
        {
            __ottMediaSequence: true,
            adult: 1,
            id: 2,
            stream_url: "two.mp4",
            title: "Two",
        },
    ];
    c.sPSchannels = 1;
    c.parentPIN = "1234";
    c.parentAccess = false;
    c.mediaList(null);
    c.selectMedia(0);
    c.__ottClassicPlayback.command({ type: "stop" });
    c.__ottMedia.ended(c.__ottClassicPlayback.snapshot().generation);
    const oldApproval = c.unlock;
    assert.equal(typeof oldApproval, "function");
    applyFilter(c, "unrelated title");
    assert.deepEqual(visibleIds(c), [1, 2]);
    oldApproval();
    assert.equal(c.calls.filter((call) => call[0] === "play").length, 1);
});

test("Favorite removal cannot overwrite navigation opened during its journal write", () => {
    const c = fixture();
    const write = c.providerSetItem;
    let navigateDuringWrite = false;
    c.providerSetItem = (key, value) => {
        write(key, value);
        if (navigateDuringWrite && key.startsWith("mediaJournal.v1:")) {
            navigateDuringWrite = false;
            c.__ottMedia.open("child");
        }
    };
    c.catalogs[""] = [{ id: 1, stream_url: "a.mp4", title: "Favorite" }];
    c.catalogs.child = [{ id: 2, stream_url: "b.mp4", title: "Child" }];
    c.mediaList(null);
    c.__ottMedia.favorite(c.listArray[0]);
    c.__ottMedia.open(-2);
    navigateDuringWrite = true;
    c.__ottMedia.favorite(c.listArray[0]);
    assert.equal(c.documentState().favorites.length, 0);
    assert.equal(c.__ottMedia.snapshot().frame.route.target, "child");
    assert.deepEqual(visibleIds(c), [2]);
});
