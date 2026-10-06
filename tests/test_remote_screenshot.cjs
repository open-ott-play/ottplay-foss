const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function emit(file) {
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
let wallClock = 1800000000000;
const exports_ = {};
vm.runInNewContext(emit("src/plugins/remote-screenshot.ts"), {
    Date: { now: () => wallClock },
    exports: exports_,
    URL,
});
const install = exports_.installRemoteScreenshot;
const plain = (x) => JSON.parse(JSON.stringify(x));
const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=";
const image = {
    height: 1,
    image: png,
    source: "player-view",
    video: "unknown",
    width: 1,
};
function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, reject, resolve };
}
function harness(native = true, extra = {}) {
    let now = 1000,
        revision = 1,
        protectedUI = false;
    let config = {
        address: "https://controller.example",
        enabled: true,
        token: "D".repeat(32),
    };
    const timers = new Map(),
        calls = [],
        observers = [];
    const nativeReply = deferred();
    let screenshot = () => Promise.resolve({ ...image });
    const doc = {
        documentElement: {},
        hidden: false,
        querySelectorAll: () =>
            protectedUI ? [{ getClientRects: () => [1] }] : [],
    };
    const w = {
        __ottClassicScreenPort: { revision: () => revision },
        addEventListener: (event, fn) => calls.push([event, fn]),
        atob: (x) => Buffer.from(x, "base64").toString("binary"),
        cancelAnimationFrame() {},
        clearTimeout: (id) => timers.delete(id),
        document: doc,
        getComputedStyle: () => ({ visibility: "visible" }),
        MutationObserver: class {
            constructor(fn) {
                this.fn = fn;
                observers.push(this);
            }
            observe() {}
            disconnect() {
                this.dead = true;
            }
        },
        performance: { now: () => now },
        requestAnimationFrame: (fn) => {
            fn();
            return 1;
        },
        setTimeout: (fn, ms) => {
            const id = {};
            timers.set(id, { fn, ms });
            return id;
        },
        ...extra,
    };
    if (native)
        w.__TAURI__ = {
            core: {
                invoke: (command, args) => {
                    calls.push(command);
                    assert.deepEqual(plain(args), {});
                    return command === "screenshot_capabilities"
                        ? nativeReply.promise
                        : screenshot();
                },
            },
        };
    const statuses = [];
    const hook = install(w, {
        getConfig: () => config,
        onStatus: (x) => statuses.push(plain(x)),
    });
    return {
        accept: async () => {
            nativeReply.resolve({ source: "player-view", supported: true });
            await tick();
        },
        advance: (value) => (now += value),
        calls,
        capture: () => new Promise((resolve) => hook.capture(resolve)),
        config: (value) => (config = { ...config, ...value }),
        hook,
        mutations: () =>
            observers.forEach((o) => {
                if (!o.dead) o.fn();
            }),
        nativeReply,
        protected: (yes) => (protectedUI = yes),
        revise: () => revision++,
        screenshot: (value) => (screenshot = value),
        statuses,
        timeout: (ms) => {
            for (const [id, t] of timers) {
                if (t.ms === ms) {
                    timers.delete(id);
                    t.fn();
                    return;
                }
            }
            throw Error("missing timer " + ms);
        },
        timers,
        w,
        wall: (value) => (wallClock += value),
    };
}
let count = 0;
async function test(name, fn) {
    await fn();
    count++;
    console.log("PASS " + name);
}
(async () => {
    await test("native probe is read-only and requires a separate local grant", async () => {
        const h = harness();
        assert.equal(h.hook.snapshot().state, "unsupported");
        await h.accept();
        assert.deepEqual(plain(h.hook.snapshot()), {
            source: "player-view",
            state: "permission_required",
        });
        assert.equal((await h.capture()).status, "rejected");
        assert.equal(
            h.calls.filter((c) => c === "capture_screenshot").length,
            0
        );
        h.hook.grant(false);
        assert.equal(h.hook.status().enabled, false);
        h.w.__ottRemoteInputActive = true;
        h.hook.grant(true);
        assert.equal(h.hook.status().enabled, false);
        h.w.__ottRemoteInputActive = false;
        h.hook.grant(true);
        assert.equal(h.hook.snapshot().state, "ready");
        assert.deepEqual(plain((await h.capture()).data), image);
    });
    await test("permission expires, is not persistent, and binds exact controller", async () => {
        for (const change of [
            (h) => h.advance(600001),
            (h) => h.wall(600001),
            (h) => h.wall(-1),
            (h) => h.config({ token: "E".repeat(32) }),
            (h) => h.config({ enabled: false }),
            (h) => h.config({ address: "https://other.example" }),
            (h) => {
                h.w.__TAURI__ = {};
            },
            (h) => h.hook.configurationChanged(),
        ]) {
            const h = harness();
            await h.accept();
            h.hook.grant(true);
            change(h);
            assert.equal((await h.capture()).status, "rejected");
            assert.equal(h.calls.includes("capture_screenshot"), false);
        }
        const h = harness();
        await h.accept();
        h.config({ address: "http://controller.example" });
        h.hook.grant(true);
        assert.equal(h.hook.status().enabled, false);
        assert.match(h.hook.status().message, /HTTPS/);
    });
    await test("PIN/forms/protected UI are rejected before and after native capture", async () => {
        const h = harness();
        await h.accept();
        h.hook.grant(true);
        h.protected(true);
        assert.equal((await h.capture()).status, "rejected");
        assert.equal(h.calls.includes("capture_screenshot"), false);
        h.protected(false);
        const d = deferred();
        h.screenshot(() => d.promise);
        const pending = h.capture();
        h.protected(true);
        h.mutations();
        h.protected(false);
        d.resolve(image);
        assert.equal((await pending).status, "rejected");
    });
    await test("late image after revocation, UI transition or background never returns pixels", async () => {
        for (const change of [
            (h) => h.hook.stop(),
            (h) => h.revise(),
            (h) => {
                h.w.document.hidden = true;
            },
            (h) => h.config({ token: "E".repeat(32) }),
        ]) {
            const h = harness();
            await h.accept();
            h.hook.grant(true);
            const d = deferred();
            h.screenshot(() => d.promise);
            const pending = h.capture();
            change(h);
            d.resolve(image);
            const result = await pending;
            assert.equal(result.status, "rejected");
            assert.equal(JSON.stringify(result).includes(png), false);
        }
    });
    await test("single flight and timeout keep pending native callbacks bounded", async () => {
        const h = harness();
        await h.accept();
        h.hook.grant(true);
        const d = deferred();
        h.screenshot(() => d.promise);
        const first = h.capture();
        assert.equal((await h.capture()).status, "rejected");
        h.timeout(12000);
        assert.equal((await first).status, "rejected");
        assert.equal((await h.capture()).status, "rejected");
        d.resolve(image);
        await tick();
        h.screenshot(() => Promise.resolve(image));
        assert.equal((await h.capture()).status, "ok");
    });
    await test("cancelled request discards callback and new capture waits for native drain", async () => {
        const h = harness();
        await h.accept();
        h.hook.grant(true);
        const d = deferred();
        h.screenshot(() => d.promise);
        let replies = 0;
        const cancel = h.hook.capture(() => replies++);
        cancel();
        assert.equal((await h.capture()).status, "rejected");
        d.resolve(image);
        await tick();
        assert.equal(replies, 0);
    });
    await test("native output is bounded, dimension checked and cannot carry metadata injection", async () => {
        for (const bad of [
            { ...image, width: 2 },
            { ...image, width: 1281 },
            { ...image, image: png + "junk" },
            { ...image, image: "x".repeat(1398108) },
            { ...image, source: "display" },
            { ...image, video: "included" },
            { ...image, secret: "never relay" },
            { ...image, image: Buffer.from("not PNG").toString("base64") },
        ]) {
            const h = harness();
            await h.accept();
            h.hook.grant(true);
            h.screenshot(() => Promise.resolve(bad));
            assert.equal((await h.capture()).status, "rejected");
        }
    });
    await test("browser capture never prompts remotely and stale/late selection is stopped", async () => {
        const d = deferred();
        let prompts = 0,
            stopped = 0;
        const h = harness(false, {
            ImageCapture: class {
                grabFrame() {}
            },
            isSecureContext: true,
            navigator: {
                mediaDevices: {
                    getDisplayMedia: (options) => {
                        prompts++;
                        assert.equal(options.audio, false);
                        return d.promise;
                    },
                },
            },
        });
        assert.equal(h.hook.snapshot().state, "permission_required");
        assert.equal((await h.capture()).status, "rejected");
        assert.equal(prompts, 0);
        h.hook.grant(true);
        assert.equal(prompts, 1);
        h.hook.stop();
        d.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
        await tick();
        assert.equal(stopped, 1);
        assert.equal(h.hook.status().enabled, false);
    });
    await test("unsupported or insecure browser has no pretend image fallback", async () => {
        for (const extra of [
            {},
            {
                isSecureContext: false,
                navigator: {
                    mediaDevices: {
                        getDisplayMedia: () => {
                            throw Error("unexpected");
                        },
                    },
                },
            },
        ]) {
            const h = harness(false, extra);
            assert.equal(h.hook.snapshot().state, "unsupported");
            h.hook.grant(true);
            assert.equal(h.hook.status().enabled, false);
        }
    });
    await test("browser source frame is new, closes bitmaps and permits retry after stop or timeout", async () => {
        const frames = [];
        let stops = 0,
            closed = 0;
        const track = {
            addEventListener() {},
            getSettings: () => ({ displaySurface: "browser" }),
            muted: false,
            readyState: "live",
            stop() {
                stops++;
                this.readyState = "ended";
            },
        };
        const stream = {
            active: true,
            getAudioTracks: () => [],
            getTracks: () => [track],
            getVideoTracks: () => [track],
        };
        const h = harness(false, {
            ImageCapture: class {
                grabFrame() {
                    const d = deferred();
                    frames.push(d);
                    return d.promise;
                }
            },
            isSecureContext: true,
            navigator: {
                mediaDevices: {
                    getDisplayMedia: () => {
                        track.readyState = "live";
                        return Promise.resolve(stream);
                    },
                },
            },
        });
        h.w.document.createElement = () => ({
            getContext: () => ({ drawImage() {} }),
            height: 0,
            toDataURL: () => "data:image/png;base64," + png,
            width: 0,
        });
        const bitmap = () => ({ close: () => closed++, height: 1, width: 1 });
        h.hook.grant(true);
        await tick();
        assert.equal(h.hook.snapshot().state, "ready");
        const first = h.capture();
        assert.equal(frames.length, 1);
        frames[0].resolve(bitmap());
        assert.equal((await first).data.source, "browser-tab");
        assert.equal(closed, 1);
        const pending = h.hook.capture(() => {
            throw Error("cancelled image escaped");
        });
        h.hook.stop();
        h.hook.grant(true);
        await tick();
        const next = h.capture();
        frames[1].resolve(bitmap());
        await tick();
        assert.equal(
            (await h.capture()).status,
            "rejected",
            "old callback must not clear newer busy capture"
        );
        frames[2].resolve(bitmap());
        assert.equal((await next).status, "ok");
        const timed = h.capture();
        h.timeout(12000);
        assert.equal((await timed).status, "rejected");
        h.hook.stop();
        h.hook.grant(true);
        await tick();
        const retried = h.capture();
        frames[3].resolve(bitmap());
        frames[4].resolve(bitmap());
        assert.equal((await retried).status, "ok");
        assert.equal(closed, 5);
        assert.ok(stops >= 2);
        h.hook.stop();
        pending();
    });
    await test("RPC requires the exact runtime and never adds permission", async () => {
        const commandExports = {};
        vm.runInNewContext(emit("src/commands/remote-screenshot.ts"), {
            exports: commandExports,
            require: () => ({
                remotePlayerInfo: () => ({ runtime: "runtime-1" }),
            }),
        });
        const h = harness();
        await h.accept();
        const exec = commandExports.executeRemoteScreenshot;
        function run(params) {
            return new Promise((resolve) => exec(h.w, params, resolve));
        }
        for (const params of [
            {},
            { runtime: "stale" },
            { extra: 1, runtime: "runtime-1" },
            [],
        ])
            assert.equal((await run(params)).status, "rejected");
        assert.equal((await run({ runtime: "runtime-1" })).status, "rejected");
        h.hook.grant(true);
        const result = await run({ runtime: "runtime-1" });
        assert.equal(result.status, "ok");
        assert.equal(result.data.runtime, "runtime-1");
        assert.equal(result.data.mime, "image/png");
        assert.equal(result.data.image, png);
        assert.equal(typeof result.data.captured_at, "number");
    });
    console.log("PASS remote screenshots: " + count + " behavior groups");
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
