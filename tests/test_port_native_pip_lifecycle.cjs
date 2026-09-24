/* Actual native PiP shims: deferred native replies must obey the latest play/stop. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(
    process.argv[2] || path.join(__dirname, "../src/index.ts"),
    "utf8"
);

function between(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert(start >= 0 && end > start, "Production PiP block markers exist");
    return ts.transpileModule(source.slice(start, end), {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
}
const snippets = {
    Capacitor: between(
        "const capacitorHost = (window as any).Capacitor;",
        "(window as any).__ottOsMediaSession.create"
    ),
    Tauri: between(
        "// Native PiP is a decoder port;",
        "window.setSleepTimeout = setSleepTimeout;"
    ),
};

function fixture(platform, capacitorPlatform = "ios") {
    const nativeCalls = [];
    const boundsCalls = [];
    const requests = [];
    const cssPlays = [];
    const displays = [];
    let cssStops = 0;
    let display = "existing-css-player";
    const style = {};
    Object.defineProperty(style, "display", {
        get: () => display,
        set(value) {
            display = value;
            displays.push(value);
        },
    });
    function nativePlay(url) {
        nativeCalls.push(["play", url]);
        let resolve;
        let reject;
        const promise = new Promise((yes, no) => {
            resolve = yes;
            reject = no;
        });
        requests.push({ reject, resolve, url });
        return promise;
    }
    function nativeStop() {
        nativeCalls.push(["stop"]);
        return Promise.resolve();
    }
    const c = {
        __TAURI__: {},
        Capacitor: { getPlatform: () => capacitorPlatform },
        cap: {
            playPip: ({ url, loop }) => {
                const result = nativePlay(url);
                requests.at(-1).loop = loop;
                return result;
            },
            stopPip: nativeStop,
        },
        console: { warn() {} },
        document: {
            getElementById(id) {
                assert.equal(id, "videopip");
                return { style };
            },
        },
        location: { href: "https://fixture.invalid/" },
        Promise,
        playerMode: 2,
        setPipPosition() {},
        sPipPos: 3,
        sPipSize: 1,
        stbPlayPip(url) {
            cssPlays.push(url);
            style.display = `css:${url}`;
        },
        stbStopPip() {
            cssStops++;
            style.display = "stopped";
        },
        tauriInvoke(command, args) {
            if (command === "play_pip") {
                const result = nativePlay(args.url);
                requests.at(-1).engine = args.engine;
                requests.at(-1).loop = args.loop;
                return result;
            }
            if (command === "set_pip_bounds") {
                boundsCalls.push({ position: args.position, size: args.size });
                return Promise.resolve();
            }
            assert.equal(command, "stop_pip");
            return nativeStop();
        },
        URL,
    };
    c.window = c;
    vm.createContext(c);
    for (const file of ["media-backend", "native-pip"])
        require("./helpers/private-runtime.cjs")(
            c,
            "src/device/" + file + ".ts"
        );
    const effects = {};
    c.__ottCoreTransport = {
        configure: (value) => Object.assign(effects, value),
    };
    const cssPlay = c.stbPlayPip,
        cssStop = c.stbStopPip;
    function cssLease(request) {
        cssPlay(request.url);
        return {
            dispose: cssStop,
            pause() {},
            resume() {},
            sample: () => ({
                duration: NaN,
                paused: false,
                position: 0,
                ready: 2,
            }),
            seek() {},
        };
    }
    const backend = c.__ottMediaBackend.create({
        clearInterval() {},
        context: () => null,
        emit() {},
        open(request) {
            if (effects.pip) {
                cssStop();
                return effects.pip.open(request, () => cssLease(request));
            }
            return cssLease(request);
        },
        setInterval() {
            return 1;
        },
    });
    c.stbPlayPip = (url) => backend.open({ lane: "pip", url });
    c.stbStopPip = () => backend.stop("pip");
    vm.runInContext(snippets[platform], c, {
        filename: `actual-${platform}-pip.js`,
    });
    return {
        boundsCalls,
        cssPlays,
        get cssStops() {
            return cssStops;
        },
        displays,
        nativeCalls,
        play: (url) => c.stbPlayPip(url),
        requests,
        stop: () => c.stbStopPip(),
        succeed: (request) =>
            request.resolve(
                platform === "Capacitor" ? { ok: true } : undefined
            ),
        window: c,
    };
}
// Drain the real Promise queue; no sleeps, native runtimes or network required.
const settle = () => new Promise((resolve) => setImmediate(resolve));
const tests = [];
function test(name, run) {
    tests.push({ name, run });
}

for (const platform of ["Capacitor", "Tauri"]) {
    test(`${platform}: reentrant failure reporting cannot start a retired CSS fallback`, async () => {
        const f = fixture(platform);
        f.play("old");
        await settle();
        f.window.console.warn = () => {
            f.window.console.warn = () => {};
            f.play("new");
        };
        f.requests[0].reject(new Error("old decoder failed"));
        await settle();
        assert.deepEqual(
            f.cssPlays,
            [],
            "failure reporting replaced the owner before fallback"
        );
        assert.equal(f.requests.length, 2);
    });
}

// Capacitor bridge operations remain serialized: an OS command cannot cancel a
// previous in-flight bridge operation. Tauri's Rust controller owns cancellation
// and waits for actual media playback, so its JS commands must not form a queue.
for (const platform of ["Capacitor"]) {
    const results = ["success", "failure", "unsupported"];
    for (const result of results) {
        test(`${platform}: stop during native play (${result})`, async () => {
            const f = fixture(platform);
            f.play("A");
            await settle();
            assert.equal(f.requests.length, 1);
            f.stop();
            const afterStop = f.displays.length;
            assert.deepEqual(
                f.nativeCalls,
                [["play", "A"]],
                "Native stop must wait for in-flight native play"
            );
            if (result === "failure")
                f.requests[0].reject(new Error("native failure"));
            else if (result === "unsupported")
                f.requests[0].resolve({ ok: false });
            else f.succeed(f.requests[0]);
            await settle();
            assert.deepEqual(
                f.cssPlays,
                [],
                "Stopped native work must never restart the CSS decoder"
            );
            assert.equal(
                f.displays.length,
                afterStop,
                "Late native success must not hide or mutate the stopped UI"
            );
            assert.deepEqual(
                f.nativeCalls,
                [["play", "A"], ["stop"]],
                "Queued stop executes after native play settles"
            );
        });
    }
    for (const oldResult of ["success", "failure"]) {
        test(`${platform}: A → B with late A ${oldResult}`, async () => {
            const f = fixture(platform);
            f.play("A");
            assert.equal(
                f.cssStops,
                1,
                "New native play synchronously stops a previous CSS decoder"
            );
            await settle();
            f.play("B");
            assert.equal(f.cssStops, 2);
            await settle();
            assert.deepEqual(
                f.nativeCalls,
                [["play", "A"]],
                "B waits for A's native settlement"
            );
            const afterB = f.displays.length;
            if (oldResult === "failure")
                f.requests[0].reject(new Error("A failed"));
            else f.succeed(f.requests[0]);
            await settle();
            assert.deepEqual(
                f.cssPlays,
                [],
                "A's late failure cannot start its obsolete CSS fallback"
            );
            assert.equal(
                f.displays.length,
                afterB,
                "A's late success cannot hide B's pending UI"
            );
            assert.deepEqual(f.nativeCalls, [
                ["play", "A"],
                ["play", "B"],
            ]);
            f.succeed(f.requests[1]);
            await settle();
            assert.equal(
                f.displays.at(-1),
                "none",
                "Only current native success hides the CSS layer"
            );
        });
    }
    test(`${platform}: obsolete queued plays are skipped`, async () => {
        const f = fixture(platform);
        f.play("A");
        f.play("B");
        f.play("C");
        await settle();
        assert.deepEqual(f.nativeCalls, [["play", "C"]]);
        f.succeed(f.requests[0]);
        await settle();
        assert.deepEqual(f.cssPlays, []);
    });
    test(`${platform}: play → stop → play preserves native command order`, async () => {
        const f = fixture(platform);
        f.play("A");
        await settle();
        f.stop();
        f.play("B");
        await settle();
        assert.deepEqual(f.nativeCalls, [["play", "A"]]);
        f.succeed(f.requests[0]);
        await settle();
        assert.deepEqual(f.nativeCalls, [
            ["play", "A"],
            ["stop"],
            ["play", "B"],
        ]);
        f.succeed(f.requests[1]);
        await settle();
        assert.deepEqual(f.cssPlays, []);
    });
    for (const failure of ["reject", "unsupported"]) {
        test(`${platform}: current ${failure} falls back exactly once`, async () => {
            const f = fixture(platform);
            f.play("A");
            await settle();
            if (failure === "reject")
                f.requests[0].reject(new Error("current failure"));
            else f.requests[0].resolve({ ok: false });
            await settle();
            assert.deepEqual(f.cssPlays, ["A"]);
            assert.equal(f.displays.at(-1), "css:A");
            f.stop();
            await settle();
            assert.deepEqual(
                f.cssPlays,
                ["A"],
                "Stopping fallback must not restart it"
            );
            assert.equal(f.displays.at(-1), "stopped");
        });
    }
}

const absolute = (value) => new URL(value, "https://fixture.invalid/").href;
for (const result of ["success", "failure", "unsupported"]) {
    test(`Tauri: stop cancels pending actual-playback wait (${result})`, async () => {
        const f = fixture("Tauri");
        f.play("A");
        await settle();
        assert.equal(f.requests.length, 1);
        f.stop();
        await settle();
        assert.deepEqual(
            f.nativeCalls,
            [["play", absolute("A")], ["stop"]],
            "Native cancellation must dispatch before playback acknowledgement"
        );
        const afterStop = f.displays.length;
        if (result === "failure") f.requests[0].reject(new Error("cancelled"));
        else if (result === "unsupported") f.requests[0].resolve({ ok: false });
        else f.succeed(f.requests[0]);
        await settle();
        assert.equal(f.displays.length, afterStop);
        assert.deepEqual(f.cssPlays, []);
        assert.deepEqual(f.boundsCalls, []);
    });
}
for (const result of ["success", "failure", "unsupported"]) {
    test(`Tauri: B immediately supersedes pending A (${result})`, async () => {
        const f = fixture("Tauri");
        f.play("A");
        await settle();
        f.play("B");
        await settle();
        assert.deepEqual(
            f.nativeCalls,
            [
                ["play", absolute("A")],
                ["play", absolute("B")],
            ],
            "The latest source must reach Rust while the previous decoder is pending"
        );
        const afterB = f.displays.length;
        if (result === "failure") f.requests[0].reject(new Error("superseded"));
        else if (result === "unsupported") f.requests[0].resolve({ ok: false });
        else f.succeed(f.requests[0]);
        await settle();
        assert.equal(f.displays.length, afterB);
        assert.deepEqual(f.cssPlays, []);
        assert.deepEqual(f.boundsCalls, []);
        f.succeed(f.requests[1]);
        await settle();
        assert.equal(f.displays.at(-1), "none");
        assert.deepEqual(
            f.boundsCalls,
            [{ position: 3, size: 1 }],
            "Only the current visible PiP receives the user's saved bounds"
        );
    });
}
test("Tauri: play → stop → play reaches Rust without waiting for old media", async () => {
    const f = fixture("Tauri");
    f.play("A");
    f.stop();
    f.play("B");
    await settle();
    assert.deepEqual(f.nativeCalls, [
        ["play", absolute("A")],
        ["stop"],
        ["play", absolute("B")],
    ]);
    f.succeed(f.requests[1]);
    await settle();
    const afterB = f.displays.length;
    f.requests[0].reject(new Error("A cancelled late"));
    await settle();
    assert.equal(f.displays.length, afterB);
    assert.deepEqual(f.cssPlays, []);
    assert.equal(f.boundsCalls.length, 1);
});
for (const failure of ["reject", "unsupported"]) {
    test(`Tauri: current ${failure} preserves the existing CSS fallback`, async () => {
        const f = fixture("Tauri");
        f.play("A");
        await settle();
        if (failure === "reject")
            f.requests[0].reject(new Error("decoder did not start"));
        else f.requests[0].resolve({ ok: false });
        await settle();
        assert.deepEqual(f.cssPlays, ["A"]);
        assert.equal(f.displays.at(-1), "css:A");
        assert.deepEqual(f.boundsCalls, []);
        f.stop();
        await settle();
        assert.equal(f.displays.at(-1), "stopped");
    });
}
test("Tauri: native request preserves engine and resolves a relative playlist URL", async () => {
    const f = fixture("Tauri");
    f.window.location.href = "https://fixture.invalid/player/index.html";
    f.window.playerMode = 3;
    f.play("../streams/list.m3u8?token=literal%2Bvalue");
    await settle();
    assert.equal(
        f.requests[0].url,
        "https://fixture.invalid/streams/list.m3u8?token=literal%2Bvalue"
    );
    assert.equal(f.requests[0].engine, 3);
});
test("Capacitor Android second-channel PiP never invokes Activity PiP", async () => {
    const f = fixture("Capacitor", "android");
    f.play("requested-A.m3u8");
    f.play("requested-B.m3u8");
    f.stop();
    await settle();
    assert.deepEqual(f.nativeCalls, []);
    assert.deepEqual(f.cssPlays, ["requested-A.m3u8", "requested-B.m3u8"]);
    assert.equal(
        f.cssStops,
        2,
        "replacement and final stop each release their CSS lease"
    );
    assert.equal(f.displays.at(-1), "stopped");
});

for (const mode of [1, 2]) {
    test(`Tauri: demo MP4 uses direct looping playback while preserving mode ${mode}`, async () => {
        const f = fixture("Tauri");
        f.window.playerMode = mode;
        f.window.ottplayDemoActive = true;
        f.play(
            "https://liminal-sketch-vv8r.here.now/demo/pattern.mp4?version=1"
        );
        await settle();
        assert.equal(f.requests[0].engine, 0);
        assert.equal(f.requests[0].loop, true);
        assert.equal(f.window.playerMode, mode);
        f.play("https://liminal-sketch-vv8r.here.now/demo/pattern.m3u8");
        await settle();
        assert.equal(f.requests[1].engine, mode);
        assert.equal(f.requests[1].loop, true);
        f.window.ottplayDemoActive = false;
        f.play("https://provider.invalid/movie.mp4");
        await settle();
        assert.equal(f.requests[2].engine, mode);
        assert.equal(f.requests[2].loop, false);
        assert.equal(f.window.playerMode, mode);
    });
}

test("Capacitor iOS: shared HTTPS demo loops and real streams clear the native flag", async () => {
    const f = fixture("Capacitor", "ios");
    const base = "https://liminal-sketch-vv8r.here.now/demo/";
    f.window.ottplayDemoActive = true;
    for (const file of ["pattern.mp4", "pattern.m3u8"]) {
        f.play(base + file);
        await settle();
        const request = f.requests.at(-1);
        assert.equal(request.url, base + file);
        assert.equal(request.loop, true);
        f.succeed(request);
        await settle();
    }
    f.window.ottplayDemoActive = false;
    f.play("https://provider.invalid/live.m3u8");
    await settle();
    assert.equal(f.requests.at(-1).loop, false);
    assert.equal(f.requests.at(-1).url, "https://provider.invalid/live.m3u8");
    assert.deepEqual(f.cssPlays, []);
});

(async () => {
    let failures = 0;
    for (const { name, run } of tests) {
        try {
            await run();
            console.log(`PASS ${name}`);
        } catch (error) {
            failures++;
            console.error(`FAIL ${name}: ${error.message}`);
        }
    }
    assert.equal(
        failures,
        0,
        `${failures}/${tests.length} actual native PiP lifecycle scenarios failed`
    );
    console.log(
        `PASS all ${tests.length} actual native PiP lifecycle scenarios`
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
