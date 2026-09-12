/* Actual native PiP shims: deferred native replies must obey the latest play/stop. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");

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
        "const origPlayPip = window.stbPlayPip;",
        "// Capacitor Mode C: full-window fullscreen."
    ),
    Tauri: between(
        "// Tauri Mode B: native always-on-top PiP window",
        "window.setSleepTimeout = setSleepTimeout;"
    ),
};

function fixture(platform) {
    const nativeCalls = [];
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
        cap: {
            playPip: ({ url }) => nativePlay(url),
            stopPip: nativeStop,
        },
        console: { warn() {} },
        document: {
            getElementById(id) {
                assert.equal(id, "videopip");
                return { style };
            },
        },
        Promise,
        setPipPosition() {},
        stbPlayPip(url) {
            cssPlays.push(url);
            style.display = `css:${url}`;
        },
        stbStopPip() {
            cssStops++;
            style.display = "stopped";
        },
        tauriInvoke(command, args) {
            if (command === "play_pip") return nativePlay(args.url);
            assert.equal(command, "stop_pip");
            return nativeStop();
        },
    };
    c.window = c;
    vm.runInNewContext(snippets[platform], c, {
        filename: `actual-${platform}-pip.js`,
    });
    return {
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
    };
}
// Drain the real Promise queue; no sleeps, native runtimes or network required.
const settle = () => new Promise((resolve) => setImmediate(resolve));
const tests = [];
function test(name, run) {
    tests.push({ name, run });
}

for (const platform of Object.keys(snippets)) {
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
