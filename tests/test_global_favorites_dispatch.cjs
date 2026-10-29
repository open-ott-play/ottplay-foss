"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript");
const { fixture, sourceFunctions } = require("./test_port_vod.cjs");
const source = fs.readFileSync("src/media/global-favorites-player.ts", "utf8"),
    ast = ts.createSourceFile(
        "player.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
let play;
(function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "play")
        play = node;
    else ts.forEachChild(node, find);
})(ast);
assert(play);
function setup(pin = false) {
    const c = fixture(),
        pending = [],
        cancels = [];
    let admitted = true,
        pinContinue;
    c.p_pref = "plex";
    c.__ottActiveProviderDriver = {
        id: "plex",
        capabilities: { mediaPlaylist: true },
    };
    c.channels = {
        "plex-row-0": {
            __ottMediaItem: {
                id: 42,
                title: "Movie",
                adult: pin ? 1 : 0,
                request: { path: "/library/metadata/42" },
            },
            channel_name: "Movie",
            logo: "",
            rec: 0,
        },
    };
    c.cats = { All: ["plex-row-0"] };
    c.catsArray = ["All"];
    c.curList = c.cats.All;
    c.cList = c.curList;
    c.catIndex = 0;
    c.primaryIndex = 0;
    c.parentalArray = [];
    c.__ottParental = { needs: () => false };
    c.__ottChannels = {
        capture: () => ({
            active: () => true,
            category: () => 0,
            members: () => c.cats.All.slice(),
        }),
        index: () => 0,
        group: () => "system:all",
        select() {},
    };
    if (process.env.OTT_TEST_DROP_CALLBACK === "1") {
        const original = c.__ottMedia.playChannel;
        c.__ottMedia.playChannel = function () {
            const args = Array.from(arguments);
            args[5] = undefined;
            return original.apply(this, args);
        };
    }
    c.ifParentalAccessChId = () => false;
    c.playChannel = c._playChannel;
    c.parentPIN = pin ? "1234" : "*";
    c.parentAccess = !pin;
    c.enterPinAndSetAccess = (proceed) => {
        pinContinue = proceed;
    };
    c.providerMediaClient = {
        cancel() {},
        cancelAutomatic() {},
        stableRequests: true,
        resolve(item, done) {
            pending.push({ item, done });
        },
    };
    const scope = vm.createContext({
        w: c,
        Promise,
        same: () => admitted,
        pendingOperations: cancels,
        expectedDispatch: null,
        playbackItem: null,
    });
    vm.runInContext(
        ts.transpileModule(play.getText(ast), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        scope
    );
    return {
        c,
        pending,
        cancels,
        play: () =>
            scope.play(
                {
                    id: "plex-row-0",
                    group: 0,
                    index: 0,
                    locator: {
                        kind: "plex-media",
                        serverId: "fixture-pms",
                        ratingKey: "42",
                    },
                },
                () => admitted
            ),
        authorize() {
            c.parentAccess = true;
            pinContinue();
        },
        cancel() {
            admitted = false;
            cancels.forEach((fn) => fn());
        },
        resolve() {
            const p = pending[0];
            p.done({ ...p.item, stream_url: "film42.mp4" });
        },
    };
}
let phase = "setup";
async function main() {
    const f = setup(true);
    let settled = false,
        settlementCount = 0;
    const result = f.play().then((value) => {
        settled = true;
        settlementCount++;
        return value;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(f.pending.length, 0, "real PIN authorization is deferred");
    f.authorize();
    await Promise.resolve();
    assert.equal(f.pending.length, 1);
    assert.equal(
        settled,
        false,
        "accepted catalogue request is not dispatch completion"
    );
    assert.equal(f.c.calls.filter((row) => row[0] === "play").length, 0);
    phase = "delayed-success";
    f.resolve();
    assert.equal(await result, true);
    assert.equal(f.c.calls.filter((row) => row[0] === "play").length, 1);
    assert.equal(f.c.__ottClassicPlayback.snapshot().target.kind, "vod");
    assert.equal(
        f.c.__ottClassicPlayback.snapshot().target.channelId,
        "provider:42"
    );
    f.resolve();
    await Promise.resolve();
    assert.equal(
        settlementCount,
        1,
        "duplicate resolver callback cannot settle a second time"
    );
    const failed = setup();
    const failure = failed.play();
    phase = "delayed-failure";
    failed.pending[0].done(null);
    assert.equal(await failure, false);
    assert.equal(failed.c.calls.filter((row) => row[0] === "play").length, 0);
    const stale = setup();
    const stopped = stale.play();
    phase = "cancelled-resolver";
    assert.equal(stale.pending.length, 1);
    stale.cancel();
    stale.resolve();
    assert.equal(await stopped, false);
    assert.equal(
        stale.c.calls.filter((row) => row[0] === "play").length,
        0,
        "late resolver after cancellation cannot dispatch"
    );
    const denied = setup(true);
    const deniedResult = denied.play();
    phase = "cancelled-pin";
    denied.cancel();
    denied.authorize();
    assert.equal(await deniedResult, false);
    assert.equal(
        denied.pending.length,
        0,
        "cancelled authorization cannot start resolver"
    );
    const superseded = setup();
    const old = superseded.play(),
        newer = superseded.play();
    phase = "supersession";
    superseded.pending[0].done({
        ...superseded.pending[0].item,
        stream_url: "old.mp4",
    });
    assert.equal(
        superseded.c.calls.filter((row) => row[0] === "play").length,
        0
    );
    superseded.pending[1].done({
        ...superseded.pending[1].item,
        stream_url: "new.mp4",
    });
    assert.equal(await newer, true);
    superseded.cancel();
    assert.equal(await old, false);
    assert.equal(
        superseded.c.calls.filter((row) => row[0] === "play").length,
        1
    );
    const manual = setup();
    manual.c.__ottGlobalFavorites = {
        navigation: { retire: () => manual.cancel() },
    };
    manual.c.getCoreMediaBackend = () => ({ stop() {} });
    vm.runInContext(
        sourceFunctions("src/core/index.ts", ["stopCorePlayback", "stbStop"]),
        manual.c
    );
    const manualResult = manual.play();
    phase = "manual-stop";
    manual.c.stbStop();
    manual.resolve();
    assert.equal(await manualResult, false);
    assert.equal(manual.c.calls.filter((row) => row[0] === "play").length, 0);
    console.log(
        "PASS public catalogue bridge: delayed success/failure, supersession, cancel, stop and duplicate callbacks"
    );
}
let completed = false;
const watchdog = setTimeout(() => {
    console.error("FAIL dispatch test did not complete: " + phase);
    process.exitCode = 1;
}, 3000);
process.once("beforeExit", () => {
    if (!completed) {
        console.error("FAIL incomplete dispatch assertions");
        process.exitCode = 1;
    }
});
main().then(
    () => {
        completed = true;
        clearTimeout(watchdog);
    },
    (error) => {
        completed = true;
        clearTimeout(watchdog);
        console.error(error);
        process.exitCode = 1;
    }
);
