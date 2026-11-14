"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    ts = require("typescript"),
    acorn = require("acorn");
const files = [
    "src/commands/remote-requests.ts",
    "src/commands/global-favorites.ts",
    "src/media/global-favorites-host.ts",
    "src/commands/remote-favorites.ts",
    "src/commands/global-favorites-protocol.ts",
    "src/commands/global-favorites-items.ts",
    "src/settings/global-favorites.ts",
    "src/settings/global-favorites-facade.ts",
    "src/settings/global-favorites-receipts.ts",
    "src/settings/global-favorites-recovery.ts",
    "src/settings/global-favorites-receipt-codec.ts",
    "src/settings/favorites-operation-receipts.ts",
];
for (const name of files) {
    const source = fs.readFileSync(path.join(__dirname, "..", name), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
        reportDiagnostics: true,
    });
    assert.equal(
        compiled.diagnostics.length,
        0,
        name +
            ": " +
            compiled.diagnostics
                .map((x) => ts.flattenDiagnosticMessageText(x.messageText, " "))
                .join("; ")
    );
    acorn.parse(compiled.outputText, { ecmaVersion: 5 });
}
console.log("PASS actual owned source syntax and emitted ES5");

// A provider/profile can be ready while its prior real decoder is still starting.
const vm = require("node:vm");
const {
    currentMixedPlaybackReady,
    installPlaybackObservation,
    selectUnresolvedFavorite,
} = require("./helpers/global-mixed-browser.cjs");
function playbackObservationFixture() {
    class Media {
        constructor() {
            this.currentSrc = "http://127.0.0.1:4179/mixed/media/two.mp4";
            this.currentTime = 1;
            this.ended = false;
            this.paused = false;
            this.readyState = 4;
            this.frames = 2;
        }
        getVideoPlaybackQuality() {
            return { totalVideoFrames: this.frames };
        }
    }
    const media = new Media(),
        listeners = [],
        generation = { value: 17 },
        calls = [],
        owner = {
            active: () => true,
            diagnosticMedia: () => ({ media }),
            id: 3,
        },
        window = {
            __ottActiveProviderDriver: { id: "m3u" },
            __ottClassicPlayback: {
                snapshot: () => ({ generation: generation.value }),
            },
            __ottCoreBackendPeek: () => ({ current: () => owner }),
            keys: { ENTER: 13 },
            listArray: ["unresolved"],
            listKeyHandlerFn: () => ({ status: "missing" }),
            stbPlay(...args) {
                calls.push({ args, receiver: this });
                return "original-result";
            },
        },
        scope = {
            HTMLMediaElement: Media,
            document: {
                addEventListener: (kind, listener) => {
                    assert.equal(kind, "playing");
                    listeners.push(listener);
                },
            },
            window,
        };
    const run = (fn, arg) => {
        scope.arg = arg;
        return vm.runInNewContext("(" + fn.toString() + ")(arg)", scope);
    };
    run(installPlaybackObservation);
    return {
        calls,
        generation,
        media,
        owner,
        ready: () => run(currentMixedPlaybackReady),
        select: () => run(selectUnresolvedFavorite, "unresolved"),
        signal: (target = media) => listeners[0]({ target }),
        staleMedia: () => new Media(),
        window,
    };
}
const observation = playbackObservationFixture();
assert.equal(
    observation.ready(),
    false,
    "media flags alone cannot admit observation"
);
// Exact old failure shape: no launch, but a previously requested decoder emits playing late.
observation.window.__mixedObserved = [];
observation.signal();
assert.equal(observation.calls.length, 0);
assert.equal(observation.window.__mixedObserved.length, 1);
assert.equal(observation.ready(), true);
observation.select();
assert.equal(observation.window.__mixedObserved.length, 0);
assert.equal(observation.window.__mixedPlayCalls, 0);
assert.equal(observation.calls.length, 0);

observation.owner.id++;
assert.equal(
    observation.ready(),
    false,
    "a replaced owner needs its own playing event"
);
observation.signal(observation.staleMedia());
assert.equal(
    observation.ready(),
    false,
    "another media element cannot admit the current owner"
);
observation.signal();
assert.equal(observation.ready(), true);
observation.generation.value++;
assert.equal(
    observation.ready(),
    false,
    "a new playback generation needs its own playing event"
);
observation.signal();
assert.equal(observation.ready(), true);
for (const [key, value] of [
    ["paused", true],
    ["ended", true],
    ["currentTime", 0],
    ["frames", 0],
    ["readyState", 1],
]) {
    const before = observation.media[key];
    observation.media[key] = value;
    assert.equal(observation.ready(), false, key);
    observation.media[key] = before;
}
const fallback = playbackObservationFixture(),
    receiver = {};
fallback.signal();
fallback.window.listKeyHandlerFn = (key) => {
    assert.equal(key, 13);
    fallback.window.result = fallback.window.stbPlay.call(
        receiver,
        "synthetic-fallback",
        42
    );
};
fallback.select();
assert.equal(fallback.window.__mixedPlayCalls, 1);
assert.equal(fallback.calls.length, 1);
assert.equal(fallback.calls[0].receiver, receiver);
assert.deepEqual(fallback.calls[0].args, ["synthetic-fallback", 42]);
assert.equal(fallback.window.result, "original-result");
assert.throws(() => assert.equal(fallback.window.__mixedPlayCalls, 0));
assert.equal(
    fallback.window.__mixedObserved.length,
    0,
    "launch detection does not wait for a DOM playing event"
);
console.log(
    "PASS decoder observation boundary and transparent fallback negative controls"
);
