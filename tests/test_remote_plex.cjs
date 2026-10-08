const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { fixture, sourceFunctions } = require("./test_port_vod.cjs");
const plain = (x) => JSON.parse(JSON.stringify(x));
const contract = JSON.parse(
    fs.readFileSync("contracts/plex-queue-v1.json", "utf8")
);
function compile(file) {
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
const module_ = {};
vm.runInNewContext(compile("src/commands/remote-plex.ts"), {
    Date,
    exports: module_,
});
function setup() {
    const c = fixture();
    const timers = new Map();
    c.setTimeout = (fn, ms) => {
        const key = {};
        timers.set(key, { fn, ms });
        return key;
    };
    c.clearTimeout = (key) => timers.delete(key);
    c.addEventListener = () => {};
    c.removeEventListener = () => {};
    c.stored.plexcfg = JSON.stringify({
        address: "https://plex.invalid",
        playback: "original",
        token: "synthetic-only",
    });
    c.stbGetItem = (key) => c.stored[key] || null;
    c.__ottPlexAuth = { routing: () => null };
    c.p_pref = "m3u";
    c.commandChannelsReady = true;
    c.__ottActiveProviderDriver = { id: "m3u" };
    c.sPSchannels = 1;
    c.parentPIN = "1234";
    c.parentAccess = false;
    c.__ottParental = { needs: () => true };
    const requests = [];
    c.$.ajax = (options) => {
        const req = {
            ...options,
            abort() {
                this.aborted = true;
            },
            aborted: false,
        };
        requests.push(req);
        return req;
    };
    vm.runInNewContext(compile("src/plugins/plex.ts"), c);
    vm.runInNewContext(compile("src/plugins/plex-queue.ts"), c);
    const queue = module_.remotePlexQueue(c, "runtime-fixture");
    function call(op, ids, extra = {}) {
        const result = { replies: [] };
        result.cancel = queue.execute(
            {
                params: {
                    op,
                    runtime: "runtime-fixture",
                    ...(ids ? { ids } : {}),
                    ...extra,
                },
            },
            (r) => result.replies.push(plain(r))
        );
        return result;
    }
    function reply(items = []) {
        const request = requests.shift();
        assert(request, "Expected a Plex request");
        request.success({ MediaContainer: { Metadata: items } });
        if (request.complete) request.complete();
        return request;
    }
    const item = (id, title = "Film " + id) => ({
        Media: [
            {
                container: "mp4",
                Part: [{ key: "/library/parts/" + id + "/file.mp4" }],
            },
        ],
        ratingKey: id,
        title,
        type: "movie",
    });
    function prepare(ids) {
        reply();
        reply(
            ids
                .slice()
                .reverse()
                .map((id) => item(id))
        );
    }
    function resolve(id) {
        reply([item(id)]);
    }
    function end() {
        c.__ottClassicPlayback.command({ type: "stop" });
        c.__ottMedia.ended(c.__ottClassicPlayback.snapshot().generation);
    }
    return {
        c,
        call,
        end,
        item,
        prepare,
        queue,
        reply,
        requests,
        resolve,
        timers,
    };
}
let groups = 0;
function test(name, fn) {
    fn();
    groups++;
    console.log("PASS " + name);
}
test("explicit saved Plex queue preserves provider until preflight, starts at zero, advances exactly and stops", () => {
    const h = setup();
    const ids = ["78777", "78776", "78775"];
    const originalProvider = h.c.__ottActiveProviderDriver;
    const saved = h.c.stored.plexcfg;
    const preview = { ch_id: "preview-tv" };
    h.c.previewChan = preview;
    h.c.previewTimer = h.c.setTimeout(() => {}, 500);
    const close = h.c.closeList;
    const closed = [];
    h.c.closeList = (restorePip) => {
        closed.push(restorePip);
        assert.equal(h.c.previewChan, null);
        if (typeof close === "function") close(restorePip);
    };
    const request = h.call("play", ids);
    assert.equal(h.c.previewChan, preview);
    assert.equal(h.timers.has(h.c.previewTimer), true);
    assert.equal(h.queue.snapshot().state, "preparing");
    assert.equal(h.c.calls.filter((x) => x[0] === "play").length, 0);
    h.prepare(ids);
    assert.equal(h.c.calls.filter((x) => x[0] === "play").length, 0);
    h.resolve(ids[0]);
    assert.equal(request.replies[0].status, "ok");
    assert.deepEqual(closed, [false]);
    assert.equal(h.timers.has(h.c.previewTimer), false);
    assert.equal(h.queue.snapshot().state, "playing");
    assert.equal(h.queue.snapshot().index, 0);
    assert.equal(h.c.__ottClassicPlayback.snapshot().position, 0);
    h.c.__ottMedia.cycleRepeat();
    h.c.__ottMedia.toggleShuffle();
    assert.equal(h.c.__ottMedia.current().sequence.repeat, "off");
    h.end();
    h.resolve(ids[1]);
    assert.equal(h.queue.snapshot().index, 1);
    h.end();
    h.resolve(ids[2]);
    assert.equal(h.queue.snapshot().index, 2);
    h.end();
    assert.equal(h.queue.snapshot().state, "ended");
    assert.equal(h.queue.snapshot().active, true);
    assert.equal(h.requests.length, 0);
    assert.equal(h.c.calls.filter((x) => x[0] === "play").length, 3);
    assert.equal(h.c.__ottActiveProviderDriver, originalProvider);
    assert.equal(h.c.p_pref, "m3u");
    assert.equal(h.c.stored.plexcfg, saved);
    assert.equal(h.call("next").replies[0].status, "rejected");
    const previous = h.call("previous");
    h.prepare(ids);
    h.resolve(ids[1]);
    assert.equal(previous.replies[0].status, "ok");
    assert.equal(h.queue.snapshot().index, 1);
    h.call("stop");
    assert.equal(h.queue.snapshot().state, "idle");
    assert.equal(h.queue.snapshot().active, false);
});
test("manual sibling arrows retain the remote queue identity and exact stop boundary", () => {
    const h = setup();
    const ids = ["1", "2", "3"];
    h.call("play", ids);
    h.prepare(ids);
    h.resolve("1");
    h.c.__ottMedia.skip(-1);
    assert.equal(
        h.requests.length,
        0,
        "The first item has no previous sibling"
    );
    h.c.__ottMedia.skip(1);
    h.resolve("2");
    assert.deepEqual(plain(h.queue.snapshot().ids), ids);
    assert.equal(h.queue.snapshot().active, true);
    assert.equal(h.queue.snapshot().index, 1);
    assert.equal(h.queue.snapshot().state, "playing");
    h.c.__ottMedia.cycleRepeat();
    h.c.__ottMedia.toggleShuffle();
    assert.equal(h.c.__ottMedia.current().sequence.repeat, "off");
    h.c.__ottMedia.skip(-1);
    h.resolve("1");
    assert.equal(h.queue.snapshot().index, 0);
    h.c.__ottMedia.skip(1);
    h.resolve("2");
    h.end();
    h.resolve("3");
    assert.equal(h.queue.snapshot().index, 2);
    h.c.__ottMedia.skip(1);
    assert.equal(
        h.requests.length,
        0,
        "The final item does not wrap on an arrow"
    );
    h.end();
    assert.equal(h.queue.snapshot().state, "ended");
    assert.equal(h.requests.length, 0);
});
test("a failed arrow resolution still reports failure to the owning remote queue", () => {
    const h = setup();
    h.call("play", ["1", "2", "3"]);
    h.prepare(["1", "2", "3"]);
    h.resolve("1");
    h.c.__ottMedia.skip(1);
    h.resolve("2");
    h.c.__ottMedia.skip(1);
    h.reply([]);
    assert.equal(h.queue.snapshot().state, "error");
    assert.equal(
        h.c.__ottMedia.current().payload.request.path,
        "/library/metadata/2"
    );
});
test("Fullscreen arrows follow the playing Plex source without changing the selected provider", () => {
    for (const provider of ["m3u", "vportal", "stalker"]) {
        const h = setup();
        h.c.p_pref = provider;
        h.c.__ottActiveProviderDriver = { id: provider };
        const selected = h.c.__ottActiveProviderDriver;
        vm.runInContext(
            sourceFunctions("src/key-handler/index.ts", [
                "handleMainKey",
                "keyFun",
            ]),
            h.c
        );
        h.c.settings.auFun = 19;
        h.c.settings.adFun = 18;
        h.c.settings.alFun = 14;
        h.c.settings.arFun = 13;
        h.c.sVolumeStep = 5;
        const seeks = [];
        const volumes = [];
        h.c.shiftArchive = (seconds) => seeks.push(seconds);
        h.c.changeVolume = (delta) => volumes.push(delta);
        const press = (key) =>
            h.c.handleMainKey(key, {
                preventDefault() {},
                stopPropagation() {},
            });
        h.call("play", ["1", "2", "3"]);
        h.prepare(["1", "2", "3"]);
        h.resolve("1");
        press(h.c.keys.LEFT);
        press(h.c.keys.RIGHT);
        assert.deepEqual(seeks.splice(0), [-10, 10]);
        assert.deepEqual(volumes, []);
        assert.equal(h.requests.length, 0);
        assert.equal(h.queue.snapshot().index, 0);
        press(h.c.keys.UP);
        assert.equal(
            h.requests.length,
            1,
            provider + " must resolve the next Plex video"
        );
        h.resolve("2");
        assert.equal(h.queue.snapshot().index, 1);
        press(h.c.keys.DOWN);
        h.resolve("1");
        assert.equal(h.queue.snapshot().index, 0);
        assert.deepEqual(seeks, []);
        assert.equal(h.c.p_pref, provider);
        assert.equal(h.c.__ottActiveProviderDriver, selected);

        h.call("stop");
        h.c._playMedia({
            id: "own-video",
            stream_url: "own-video.mp4",
            title: "Own video",
        });
        press(h.c.keys.UP);
        press(h.c.keys.DOWN);
        assert.deepEqual(
            seeks,
            [60, -60],
            "The selected provider's own video keeps configured seeking"
        );
        press(h.c.keys.LEFT);
        press(h.c.keys.RIGHT);
        assert.deepEqual(volumes, [-5, 5]);
    }
});
test("preview validates order without publishing, resolving streams or modifying saved settings", () => {
    const h = setup();
    const originalSource = h.c.__ottMedia.sourceId();
    const before = JSON.stringify(h.c.stored);
    const request = h.call("preview", ["2", "1"]);
    h.prepare(["2", "1"]);
    assert.deepEqual(request.replies[0].data.ids, ["2", "1"]);
    assert.deepEqual(request.replies[0].data.titles, ["Film 2", "Film 1"]);
    assert.equal(request.replies[0].data.state, "ready");
    assert.equal(h.queue.snapshot().state, "idle");
    assert.equal(h.c.__ottMedia.sourceId(), originalSource);
    assert.equal(JSON.stringify(h.c.stored), before);
    assert.equal(h.requests.length, 0);
});
test("startup readiness rejects playback but preserves preview and Plex-only providers", () => {
    const h = setup();
    h.c.commandChannelsReady = false;
    assert.equal(h.call("play", ["1"]).replies[0].status, "rejected");
    assert.equal(h.requests.length, 0);
    assert.equal(h.queue.retained(), false);
    assert.equal(h.call("status").replies[0].data.state, "idle");
    const preview = h.call("preview", ["1"]);
    h.prepare(["1"]);
    assert.equal(preview.replies[0].data.state, "ready");
    assert.equal(h.call("play", ["1"]).replies[0].status, "rejected");
    h.c.__ottActiveProviderDriver = {
        capabilities: { libraryOnly: true },
        id: "plex",
    };
    h.c.p_pref = "plex";
    h.c.cList = [];
    h.c.commandChannelsReady = true;
    const play = h.call("play", ["1"]);
    h.prepare(["1"]);
    h.resolve("1");
    assert.equal(
        play.replies[0].status,
        "ok",
        "A ready Plex-only provider needs no TV channels"
    );
});
test("a catalog reload during Plex preparation cannot commit late playback", () => {
    const h = setup();
    const play = h.call("play", ["1"]);
    h.c.commandChannelsReady = false;
    const stale = h.reply();
    assert.equal(play.replies.length, 0);
    assert.equal(h.c.calls.filter((x) => x[0] === "play").length, 0);
    const deadline = [...h.timers.values()].find((timer) => timer.ms === 35000);
    assert(deadline, "Lost readiness still has a bounded execution deadline");
    deadline.fn();
    assert.equal(play.replies[0].status, "rejected");
    h.c.commandChannelsReady = true;
    stale.success({ MediaContainer: {} });
    assert.equal(play.replies.length, 1);
    assert.equal(h.c.calls.filter((x) => x[0] === "play").length, 0);
    assert.equal(h.queue.retained(), false);
});
test("failed replacement preflight preserves an already playing queue and client", () => {
    const h = setup();
    h.call("play", ["1", "2"]);
    h.prepare(["1", "2"]);
    h.resolve("1");
    const current = h.c.__ottMedia.current();
    const failed = h.call("play", ["3"]);
    h.reply();
    h.reply([]);
    assert.equal(failed.replies[0].status, "rejected");
    assert.equal(h.c.__ottMedia.current(), current);
    assert.deepEqual(plain(h.queue.snapshot().ids), ["1", "2"]);
    h.end();
    h.resolve("2");
    assert.equal(h.queue.snapshot().index, 1);
});
test("refused or throwing dispatch restores exact old runtime and its natural EOS", () => {
    for (const mode of ["refuse", "throw", "prepare-only", "prepare-same-id"]) {
        const h = setup();
        h.call("play", ["1", "2"]);
        h.prepare(["1", "2"]);
        h.resolve("1");
        const previous = h.c.__ottMedia.current();
        const previousState = plain(h.c.__ottClassicPlayback.snapshot());
        const play = h.c._playMedia;
        h.c._playMedia = (payload) => {
            if (mode === "throw")
                throw new Error("synthetic admission refusal");
            if (mode === "prepare-only" || mode === "prepare-same-id")
                h.c.__ottMedia.prepare(payload, payload.stream_url);
        };
        const ids = mode === "prepare-same-id" ? ["1", "4"] : ["3", "4"];
        const replacement = h.call("play", ids);
        h.prepare(ids);
        h.resolve(ids[0]);
        assert.equal(replacement.replies.length, 1, mode);
        assert.equal(replacement.replies[0].status, "rejected", mode);
        assert.equal(h.c.__ottMedia.current(), previous, mode);
        assert.deepEqual(
            plain(h.c.__ottClassicPlayback.snapshot()),
            previousState,
            mode
        );
        assert.deepEqual(plain(h.queue.snapshot().ids), ["1", "2"], mode);
        h.c._playMedia = play;
        h.end();
        h.resolve("2");
        assert.equal(h.queue.snapshot().index, 1, mode);
        assert.equal(h.queue.snapshot().state, "playing", mode);
    }
});
test("an exception after decoder dispatch cannot restore stale queue ownership", () => {
    const h = setup();
    h.call("play", ["1", "2"]);
    h.prepare(["1", "2"]);
    h.resolve("1");
    const prior = h.c.__ottMedia.current();
    const play = h.c._playMedia;
    h.c._playMedia = (...args) => {
        play(...args);
        throw new Error("synthetic post-dispatch failure");
    };
    const request = h.call("play", ["3", "4"]);
    h.prepare(["3", "4"]);
    h.resolve("3");
    assert.equal(request.replies[0].status, "ok");
    assert.notEqual(h.c.__ottMedia.current(), prior);
    assert.deepEqual(plain(h.queue.snapshot().ids), ["3", "4"]);
    assert.equal(h.queue.snapshot().state, "playing");
    h.c._playMedia = play;
    h.end();
    h.resolve("4");
    assert.equal(h.queue.snapshot().index, 1);
});
test("preview and status cannot interrupt pending play, and a failed draft does not own TV", () => {
    const h = setup();
    const playing = h.call("play", ["1"]);
    const pending = h.requests[0];
    const preview = h.call("preview", ["2"]);
    assert.equal(preview.replies[0].status, "rejected");
    assert.equal(pending.aborted, false);
    assert.equal(h.call("status").replies[0].data.state, "preparing");
    h.prepare(["1"]);
    h.resolve("1");
    assert.equal(playing.replies[0].status, "ok");
    const missing = setup();
    missing.c.stored.plexcfg = "";
    assert.equal(missing.call("play", ["1"]).replies[0].status, "rejected");
    assert.equal(missing.queue.snapshot().state, "error");
    assert.equal(missing.queue.snapshot().active, false);
    assert.deepEqual(plain(missing.queue.snapshot().ids), []);
    assert.equal(missing.queue.snapshot().index, null);
    assert.equal(missing.queue.retained(), false);
    assert.equal(missing.call("next").replies[0].status, "rejected");
});
test("lazy failure and cancellation remain inactive and preview preserves the error", () => {
    const h = setup();
    const factory = h.c.__ottPlexQueueFactory;
    h.c.__ottPlexQueueFactory = null;
    let ready, reject;
    h.c.__ottProviderAssets = {
        classic: {
            ensure(_p, _h, _v, _owner, ok, fail) {
                ready = ok;
                reject = fail;
            },
        },
    };
    const pending = h.call("play", ["1"]);
    assert.equal(h.queue.retained(), true);
    reject();
    const failed = plain(h.queue.snapshot());
    assert.equal(failed.active, false);
    assert.equal(failed.state, "error");
    assert.equal(failed.index, null);
    assert.deepEqual(failed.ids, []);
    assert.equal(h.queue.retained(), false);
    assert.equal(pending.replies[0].status, "rejected");
    const preview = h.call("preview", ["2"]);
    assert.deepEqual(plain(h.queue.snapshot()), failed);
    h.c.__ottPlexQueueFactory = factory;
    ready();
    h.prepare(["2"]);
    assert.equal(preview.replies[0].data.state, "ready");
    assert.deepEqual(plain(h.queue.snapshot()), failed);
    const cancelled = setup();
    cancelled.c.__ottPlexQueueFactory = null;
    cancelled.c.__ottProviderAssets = { classic: { ensure() {} } };
    cancelled.call("play", ["1"]).cancel();
    assert.equal(cancelled.queue.snapshot().state, "error");
    assert.equal(cancelled.queue.snapshot().active, false);
    assert.equal(cancelled.queue.retained(), false);
});
test("policy changes during preflight cancel admission, and stopping an old queue cannot stop new TV", () => {
    const h = setup();
    const request = h.call("play", ["1"]);
    h.c.parentAccess = true;
    h.c.__ottParental.needs = () => false;
    h.reply();
    h.reply([{ ...h.item("1"), adult: 1 }]);
    h.c.parentAccess = false;
    h.c.__ottParental.needs = () => true;
    h.resolve("1");
    assert.equal(h.c.calls.filter((x) => x[0] === "play").length, 0);
    request.cancel();
    const playing = setup();
    playing.call("play", ["1"]);
    playing.prepare(["1"]);
    playing.resolve("1");
    playing.c.__ottClassicPlayback.command({
        channelId: "tv",
        sourceId: "m3u",
        type: "live",
    });
    const stopped = playing.c.calls.filter((x) => x[0] === "stop").length;
    playing.call("stop");
    assert.equal(
        playing.c.calls.filter((x) => x[0] === "stop").length,
        stopped
    );
});
test("cancel, timeout, changed provider and expired requests cannot start later", () => {
    for (const action of ["cancel", "timeout", "provider", "config"]) {
        const h = setup();
        const request = h.call("play", ["1"]);
        if (action === "cancel") request.cancel();
        if (action === "timeout")
            [...h.timers.values()].find((x) => x.ms === 35000).fn();
        if (action === "provider")
            h.c.__ottActiveProviderDriver = { id: "other" };
        if (action === "config") h.c.stored.plexcfg = "{}";
        h.reply();
        assert.equal(h.c.calls.filter((x) => x[0] === "play").length, 0);
        assert.equal(h.requests.length, 0);
    }
    const h = setup();
    const replies = [];
    h.queue.execute(
        {
            expires_at: 1,
            params: { ids: ["1"], op: "play", runtime: "runtime-fixture" },
        },
        (x) => replies.push(x)
    );
    assert.equal(replies[0].status, "rejected");
    assert.equal(h.requests.length, 0);
});
test("canonical IDs, bounded titles and exact runtime are enforced", () => {
    for (const ids of [
        ["0"],
        ["01"],
        ["1.0"],
        [1],
        [],
        Array(101).fill("1"),
        ["1".repeat(21)],
    ]) {
        const h = setup();
        assert.equal(h.call("play", ids).replies[0].status, "rejected");
        assert.equal(h.requests.length, 0);
    }
    const h = setup();
    assert.equal(
        h.call("play", ["1"], { runtime: "wrong" }).replies[0].status,
        "rejected"
    );
    const ids = Array.from({ length: 100 }, (_, i) => String(i + 1));
    const preview = h.call("preview", ids);
    h.reply();
    h.reply(ids.map((id) => h.item(id, "🙂".repeat(200) + "\ud800")));
    assert.equal(preview.replies[0].data.titles.length, 100);
    assert(
        preview.replies[0].data.titles.every((x) => Buffer.byteLength(x) <= 512)
    );
});
test("shared contract capability and maximum escaped preview stay bounded", () => {
    const h = setup();
    assert.deepEqual(plain(h.queue.capability), contract.capability);
    const ids = Array.from({ length: contract.max_items }, (_, i) =>
        String(i + 1)
    );
    const preview = h.call("preview", ids);
    h.reply();
    h.reply(ids.map((id) => h.item(id, '"'.repeat(512))));
    assert(
        Buffer.byteLength(JSON.stringify(preview.replies[0].data)) <
            contract.max_preview_result_bytes
    );
    for (const file of [
        "src/commands/remote-plex.ts",
        "src/plugins/plex-queue.ts",
    ]) {
        const source = fs.readFileSync(file, "utf8");
        for (const match of source.matchAll(
            /"((?:Plex |One or more Plex |Player context |Unlock parental |Kiosk mode)[^"\n]*\.)"/g
        ))
            assert(contract.errors.includes(match[1]), match[1]);
    }
});
console.log("PASS Plex queue: " + groups + " behavior groups");
