/* Execute the shipped PiP document/player with controlled native/media boundaries. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, reject, resolve };
}

function fixture(script, options = {}) {
    const dom = new JSDOM(
        options.html ||
            "<!doctype html><html><head></head><body></body></html>",
        {
            runScripts: "outside-only",
            url: "http://tauri.localhost/pip.html#73",
        }
    );
    const w = dom.window;
    const calls = [];
    const requests = [];
    const plays = [];
    const hlsInstances = [];
    const shakaInstances = [];
    const timers = new Map();
    const paused = new WeakMap();
    let timerId = 0;
    let readyState = options.readyState || "complete";
    Object.defineProperty(w.document, "readyState", { get: () => readyState });
    w.document.addEventListener(
        "DOMContentLoaded",
        (event) => {
            if (readyState === "loading") event.stopImmediatePropagation();
        },
        true
    );
    w.setTimeout = (callback, delay) => {
        timers.set(++timerId, { callback, delay, repeat: false });
        return timerId;
    };
    w.setInterval = (callback, delay) => {
        timers.set(++timerId, { callback, delay, repeat: true });
        return timerId;
    };
    w.clearTimeout = w.clearInterval = (id) => timers.delete(id);
    Object.defineProperty(w.HTMLMediaElement.prototype, "paused", {
        get() {
            return paused.get(this) !== false;
        },
    });
    w.HTMLMediaElement.prototype.canPlayType = () =>
        options.nativeHls ? "probably" : "";
    w.HTMLMediaElement.prototype.play = function () {
        assert.equal(
            this.muted,
            true,
            "The second-channel decoder must be muted before play"
        );
        assert.equal(
            this.defaultMuted,
            true,
            "Mute must survive source reloads"
        );
        const pending = deferred();
        const video = this;
        const record = {
            ...pending,
            resolve(value) {
                paused.set(video, false);
                pending.resolve(value);
            },
            src: video.getAttribute("src"),
            video,
        };
        plays.push(record);
        calls.push(["play", video.id]);
        return pending.promise;
    };
    w.HTMLMediaElement.prototype.pause = function () {
        paused.set(this, true);
        calls.push(["pause", this.id]);
    };
    w.HTMLMediaElement.prototype.load = function () {
        calls.push(["load", this.id]);
    };
    class Hls {
        static Events = {
            ERROR: "hlsError",
            MANIFEST_PARSED: "hlsManifestParsed",
            MEDIA_ATTACHED: "hlsMediaAttached",
        };
        static isSupported() {
            return options.hlsSupported !== false;
        }
        constructor() {
            this.handlers = new Map();
            this.destroyed = false;
            hlsInstances.push(this);
        }
        on(event, callback) {
            if (!this.handlers.has(event)) this.handlers.set(event, []);
            this.handlers.get(event).push(callback);
        }
        off(event, callback) {
            this.handlers.set(
                event,
                (this.handlers.get(event) || []).filter((fn) => fn !== callback)
            );
        }
        loadSource(url) {
            this.url = url;
        }
        attachMedia(video) {
            this.video = video;
        }
        destroy() {
            this.destroyed = true;
        }
        emit(event, data) {
            for (const callback of this.handlers.get(event) || [])
                callback(event, data);
        }
        queued(event, data) {
            // A callback already queued by a decoder can run after destroy/off.
            const callbacks = [...(this.handlers.get(event) || [])];
            return () => callbacks.forEach((callback) => callback(event, data));
        }
    }
    if (!options.noHls) w.Hls = Hls;
    if (options.shaka) {
        class Player {
            static isBrowserSupported() {
                return true;
            }
            constructor() {
                assert.equal(
                    arguments.length,
                    0,
                    "modern Shaka uses explicit attachment"
                );
                this.attached = deferred();
                shakaInstances.push(this);
            }
            attach(media) {
                this.media = media;
                return this.attached.promise;
            }
            load(url) {
                this.url = url;
                return Promise.resolve();
            }
            addEventListener() {}
            destroy() {
                this.destroyed = true;
                return Promise.resolve();
            }
        }
        w.shaka = { Player, polyfill: { installAll() {} } };
    }
    const invoke = (command, args) => {
        const pending = deferred();
        calls.push(["invoke", command, args]);
        requests.push({ ...pending, args, command });
        if (args && args.event && args.event !== "ready") pending.resolve(null);
        return pending.promise;
    };
    const nativeWindow = {
        startDragging() {
            calls.push(["drag"]);
            return options.dragReject
                ? Promise.reject(new Error("drag unavailable"))
                : Promise.resolve();
        },
    };
    w.__TAURI__ = {
        core: { invoke },
        window: { getCurrentWindow: () => nativeWindow },
    };
    w.__TAURI_INTERNALS__ = { invoke };
    const errors = [];
    w.console = {
        ...console,
        error: (...args) => errors.push(args),
        warn: (...args) => errors.push(args),
    };
    const run = () => w.eval(script);
    run();
    return {
        calls,
        close() {
            dom.window.close();
        },
        dom,
        errors,
        fireTimers() {
            const pending = [...timers.entries()];
            for (const [id, timer] of pending) {
                if (!timers.has(id)) continue;
                if (!timer.repeat) timers.delete(id);
                timer.callback();
            }
        },
        Hls,
        hlsInstances,
        mouse(target, type, extra = {}) {
            const event = new w.MouseEvent(type, {
                bubbles: true,
                button: 0,
                buttons: type === "mouseup" ? 0 : 1,
                cancelable: true,
                clientX: 200,
                clientY: 120,
                ...extra,
            });
            target.dispatchEvent(event);
            return event;
        },
        plays,
        ready() {
            readyState = "complete";
            w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
        },
        requests,
        run,
        shakaInstances,
        timers,
        w,
    };
}

async function run() {
    const script = read("src-tauri/pip/pip-player.js");
    const html = read("src-tauri/pip/pip.html");
    const cases = [];
    const test = (name, options, check) => cases.push({ check, name, options });
    const request = (session, url, extra = {}) => ({
        instance: 73,
        session,
        url,
        ...extra,
    });
    const direct = (session) =>
        request(session, `https://fixture.invalid/channel-${session}.mp4`);
    const hls = (session) =>
        request(
            session,
            `https://fixture.invalid/channel-${session}.m3u8?token=fixture`
        );
    const events = (f, name) =>
        f.requests.filter(
            (call) =>
                call.command === "pip_player_event" && call.args.event === name
        );
    const ready = (f, value = null) => {
        const pending = events(f, "ready");
        assert.equal(
            pending.length,
            1,
            "One native ready handshake per document"
        );
        assert.equal(pending[0].args.instance, 73);
        assert.equal(pending[0].args.session, 0);
        pending[0].resolve(value);
    };
    const video = (f) => f.w.document.getElementById("ottplay-pip-video");
    const loadHls = async (f) => {
        const scripts = [
            ...f.w.document.querySelectorAll("script[src]"),
        ].filter((node) => /hls\.min\.js/.test(node.src));
        assert.equal(
            scripts.length,
            1,
            "Concurrent HLS requests share one bundled decoder script"
        );
        assert.equal(
            new URL(scripts[0].src).origin,
            "http://tauri.localhost",
            "PiP decoder must load from the permitted local origin"
        );
        f.w.Hls = f.Hls;
        scripts[0].dispatchEvent(new f.w.Event("load"));
        await settle();
    };
    const manifest = (f, engine) => {
        engine.emit(f.Hls.Events.MEDIA_ATTACHED);
        engine.emit(f.Hls.Events.MANIFEST_PARSED);
    };

    test("DOM and native ready precede the first decoder", {
        readyState: "loading",
    }, async (f) => {
        await settle();
        assert.equal(events(f, "ready").length, 0);
        assert.equal(f.plays.length, 0);
        f.ready();
        await settle();
        assert.equal(
            f.plays.length,
            0,
            "Native desired state is still pending"
        );
        ready(f, direct(1));
        await settle();
        assert.equal(f.plays.length, 1);
        assert.equal(video(f).src, direct(1).url);
        assert.equal(video(f).controls, false);
        assert.equal(f.w.document.querySelectorAll("video").length, 1);
    });
    test("late ready reply cannot replace a newer session", {}, async (f) => {
        f.w.__ottplayPip.play(direct(2));
        ready(f, direct(1));
        await settle();
        assert.equal(f.plays.length, 1);
        assert.equal(video(f).src, direct(2).url);
    });
    test("duplicate and older sessions cannot reload a decoder", {}, async (f) => {
        ready(f, direct(2));
        await settle();
        const current = video(f);
        f.w.__ottplayPip.play(direct(2));
        f.w.__ottplayPip.play(direct(1));
        await settle();
        assert.equal(f.plays.length, 1);
        assert.equal(video(f), current);
    });
    test("another window instance cannot commandeer the document", {}, async (f) => {
        ready(f);
        f.w.__ottplayPip.play({ ...direct(1), instance: 74 });
        await settle();
        assert.equal(f.plays.length, 0);
    });
    test("only the current video playing event acknowledges success", {}, async (f) => {
        ready(f, direct(1));
        await settle();
        f.plays[0].resolve();
        await settle();
        assert.equal(
            events(f, "playing").length,
            0,
            "play() resolution does not prove visible media playback"
        );
        video(f).dispatchEvent(new f.w.Event("playing"));
        assert.equal(events(f, "playing").length, 1);
        assert.equal(events(f, "playing")[0].args.session, 1);
        assert.equal(events(f, "playing")[0].args.instance, 73);
    });
    test("stopped ready session stays retired", {}, async (f) => {
        f.w.__ottplayPip.play(direct(2));
        f.w.__ottplayPip.stop();
        ready(f, direct(1));
        f.w.__ottplayPip.play(direct(2));
        await settle();
        assert.equal(f.plays.length, 1);
        assert.equal(video(f)?.getAttribute("src") || "", "");
    });
    test("current Shaka attaches before load and ignores attachment after stop", {
        shaka: true,
    }, async (f) => {
        ready(
            f,
            request(1, "https://fixture.invalid/first.mpd", { engine: 2 })
        );
        await settle();
        const first = f.shakaInstances[0];
        assert.equal(first.url, undefined);
        first.attached.resolve();
        await settle();
        assert.equal(first.url, "https://fixture.invalid/first.mpd");
        assert.equal(f.plays.length, 1);
        f.w.__ottplayPip.play(
            request(2, "https://fixture.invalid/stopped.mpd", { engine: 2 })
        );
        const next = f.shakaInstances[1];
        f.w.__ottplayPip.stop();
        next.attached.resolve();
        await settle();
        assert.equal(next.url, undefined);
        assert.equal(f.plays.length, 1);
        assert.equal(next.destroyed, true);
    });
    test("HLS waits for manifest and loads the bundled decoder", {
        noHls: true,
    }, async (f) => {
        ready(f, hls(1));
        await settle();
        assert.equal(f.plays.length, 0);
        await loadHls(f);
        const engine = f.hlsInstances[0];
        assert.ok(
            engine,
            "Bundled HLS must be attached to the requested video"
        );
        engine.emit(f.Hls.Events.MEDIA_ATTACHED);
        assert.equal(engine.url, hls(1).url);
        assert.equal(f.plays.length, 0);
        engine.emit(f.Hls.Events.MANIFEST_PARSED);
        assert.equal(f.plays.length, 1);
        assert.equal(f.plays[0].video, video(f));
    });
    test("late decoder script after stop cannot resurrect playback", {
        noHls: true,
    }, async (f) => {
        ready(f, hls(1));
        await settle();
        f.w.__ottplayPip.stop();
        await loadHls(f);
        assert.equal(f.hlsInstances.length, 0);
        assert.equal(f.plays.length, 0);
        assert.equal(events(f, "error").length, 0);
    });
    test("latest request owns a shared pending decoder load", {
        noHls: true,
    }, async (f) => {
        ready(f, hls(1));
        await settle();
        f.w.__ottplayPip.play(hls(2));
        await loadHls(f);
        assert.equal(f.hlsInstances.length, 1);
        const engine = f.hlsInstances[0];
        manifest(f, engine);
        assert.equal(engine.url, hls(2).url);
        assert.equal(f.plays.length, 1);
        assert.equal(f.plays[0].video, video(f));
    });
    test("already queued old HLS manifest cannot play after replacement", {}, async (f) => {
        ready(f, hls(1));
        await settle();
        const old = f.hlsInstances[0];
        const queued = old.queued(f.Hls.Events.MANIFEST_PARSED);
        f.w.__ottplayPip.play(hls(2));
        await settle();
        assert.equal(old.destroyed, true);
        queued();
        assert.equal(f.plays.length, 0);
        manifest(f, f.hlsInstances[1]);
        assert.equal(f.plays.length, 1);
        assert.equal(f.plays[0].video, video(f));
    });
    test("switching HLS to direct playback releases the old decoder", {}, async (f) => {
        ready(f, hls(1));
        await settle();
        const engine = f.hlsInstances[0];
        const oldVideo = video(f);
        const queued = engine.queued(f.Hls.Events.MANIFEST_PARSED);
        f.w.__ottplayPip.play(direct(2));
        await settle();
        queued();
        assert.equal(engine.destroyed, true);
        assert.equal(oldVideo.paused, true);
        assert.equal(f.plays.length, 1);
        assert.notEqual(video(f), oldVideo);
        assert.equal(video(f).src, direct(2).url);
    });
    test("a reloaded document consumes current desired state and retires the old decoder", {}, async (f) => {
        ready(f, hls(1));
        await settle();
        const engine = f.hlsInstances[0];
        const queued = engine.queued(f.Hls.Events.MANIFEST_PARSED);
        f.w.dispatchEvent(new f.w.Event("pagehide"));
        const reloaded = fixture(script, { html });
        try {
            ready(reloaded, direct(2));
            await settle();
            queued();
            assert.equal(engine.destroyed, true);
            assert.equal(f.plays.length, 0);
            assert.equal(reloaded.plays.length, 1);
            assert.equal(video(reloaded).src, direct(2).url);
            video(reloaded).dispatchEvent(new reloaded.w.Event("playing"));
            assert.equal(events(reloaded, "playing")[0].args.session, 2);
        } finally {
            reloaded.close();
        }
    });
    for (const outcome of ["resolve", "reject"]) {
        test(`old play ${outcome} and media events cannot mutate the new session`, {}, async (f) => {
            ready(f, direct(1));
            await settle();
            const old = f.plays[0];
            f.w.__ottplayPip.play(direct(2));
            await settle();
            const current = video(f);
            assert.notEqual(
                current,
                old.video,
                "Each source owns its own media element"
            );
            old[outcome](new Error("obsolete stream failed"));
            old.video.dispatchEvent(new f.w.Event("playing"));
            old.video.dispatchEvent(new f.w.Event("error"));
            await settle();
            assert.equal(events(f, "playing").length, 0);
            assert.equal(events(f, "error").length, 0);
            assert.equal(video(f), current);
            assert.equal(current.src, direct(2).url);
        });
    }
    test("current playback rejection reports one failure without stream credentials", {}, async (f) => {
        const url =
            "https://fixture.invalid/private.mp4?password=must-not-report";
        ready(f, request(1, url));
        await settle();
        f.plays[0].reject(new Error(url));
        await settle();
        assert.equal(events(f, "error").length, 1);
        assert.equal(events(f, "error")[0].args.session, 1);
        assert.equal(
            JSON.stringify(events(f, "error")[0].args).includes(
                "must-not-report"
            ),
            false
        );
    });
    test("native HLS uses the same muted, acknowledged media lifecycle", {
        nativeHls: true,
    }, async (f) => {
        ready(f, { ...hls(1), engine: 0 });
        await settle();
        assert.equal(f.hlsInstances.length, 0);
        assert.equal(f.plays.length, 1);
        assert.equal(video(f).src, hls(1).url);
        video(f).dispatchEvent(new f.w.Event("playing"));
        assert.equal(events(f, "playing").length, 1);
    });
    for (const event of ["pagehide"]) {
        test(`${event} tears down owned decoder and retires queued callbacks`, {}, async (f) => {
            ready(f, hls(1));
            await settle();
            const engine = f.hlsInstances[0];
            const current = video(f);
            const queued = engine.queued(f.Hls.Events.MANIFEST_PARSED);
            f.w.dispatchEvent(new f.w.Event(event));
            queued();
            current.dispatchEvent(new f.w.Event("playing"));
            current.dispatchEvent(new f.w.Event("error"));
            await settle();
            assert.equal(engine.destroyed, true);
            assert.equal(current.getAttribute("src") || "", "");
            assert.equal(current.paused, true);
            assert.equal(f.plays.length, 0);
            assert.equal(events(f, "playing").length, 0);
            assert.equal(events(f, "error").length, 0);
        });
    }
    test("a Rust stop barrier rejects every cancelled pending session", {}, async (f) => {
        f.w.__ottplayPip.stop(10);
        ready(f, direct(1));
        f.w.__ottplayPip.play(direct(9));
        await settle();
        assert.equal(f.plays.length, 0);
        f.w.__ottplayPip.play(direct(11));
        await settle();
        assert.equal(f.plays.length, 1);
        assert.equal(video(f).src, direct(11).url);
    });
    test("a delayed numeric stop cannot destroy a newer playback session", {}, async (f) => {
        ready(f, hls(3));
        await settle();
        const engine = f.hlsInstances[0];
        const current = video(f);
        f.w.__ottplayPip.stop(2);
        assert.equal(engine.destroyed, false);
        assert.equal(video(f), current);
        manifest(f, engine);
        assert.equal(f.plays.length, 1);
        current.dispatchEvent(new f.w.Event("playing"));
        assert.equal(events(f, "playing")[0].args.session, 3);
    });
    test("a stop barrier preserves a later request returned by the ready handshake", {}, async (f) => {
        f.w.__ottplayPip.stop(2);
        ready(f, direct(3));
        await settle();
        assert.equal(f.plays.length, 1);
        assert.equal(video(f).src, direct(3).url);
    });
    test("fatal HLS errors retire the decoder and report one failure", {}, async (f) => {
        ready(f, hls(1));
        await settle();
        const engine = f.hlsInstances[0];
        const lateFatal = engine.queued(f.Hls.Events.ERROR, { fatal: true });
        engine.emit(f.Hls.Events.ERROR, { fatal: false });
        assert.equal(events(f, "error").length, 0);
        lateFatal();
        lateFatal();
        assert.equal(engine.destroyed, true);
        assert.equal(events(f, "error").length, 1);
        assert.equal(events(f, "error")[0].args.session, 1);
    });
    test("failed bundled script loads can be retried by the next request", {
        noHls: true,
    }, async (f) => {
        ready(f, hls(1));
        await settle();
        const failed = f.w.document.querySelector('script[src*="hls.min.js"]');
        assert.ok(failed);
        failed.dispatchEvent(new f.w.Event("error"));
        await settle();
        assert.equal(events(f, "error").length, 1);
        assert.equal(f.plays.length, 0);
        f.w.__ottplayPip.play(hls(2));
        await loadHls(f);
        manifest(f, f.hlsInstances[0]);
        assert.equal(f.plays.length, 1);
        assert.equal(f.hlsInstances[0].url, hls(2).url);
    });
    test("the video, status and empty plane all start native dragging", {}, async (f) => {
        ready(f, direct(1));
        await settle();
        const targets = [
            video(f),
            f.w.document.getElementById("ottplay-pip-status"),
            f.w.document.body,
            f.w.document.documentElement,
        ];
        for (const target of targets) {
            assert.ok(target);
            const before = f.calls.filter((call) => call[0] === "drag").length;
            f.mouse(target, "mousedown");
            f.mouse(target, "mousemove", { clientX: 250, clientY: 200 });
            f.mouse(target, "mouseup");
            await settle();
            assert.equal(
                f.calls.filter((call) => call[0] === "drag").length,
                before + 1,
                target.tagName + " starts exactly one native drag"
            );
        }
    });
    test("right/middle clicks and double-click do not drag or request fullscreen", {}, async (f) => {
        ready(f);
        for (const button of [1, 2])
            f.mouse(f.w.document.body, "mousedown", { button });
        f.mouse(f.w.document.body, "dblclick", { detail: 2 });
        await settle();
        assert.equal(f.calls.filter((call) => call[0] === "drag").length, 0);
        assert.deepEqual(
            f.requests.map((call) => call.command),
            ["pip_player_event"]
        );
    });
    test("reevaluating the bootstrap does not duplicate ready or drag handlers", {}, async (f) => {
        ready(f, direct(1));
        await settle();
        const controller = f.w.__ottplayPip;
        f.run();
        f.mouse(video(f), "mousedown");
        await settle();
        assert.equal(f.w.__ottplayPip, controller);
        assert.equal(events(f, "ready").length, 1);
        assert.equal(f.plays.length, 1);
        assert.equal(f.calls.filter((call) => call[0] === "drag").length, 1);
    });

    test("demo repeats, while a subsequent ordinary stream does not inherit looping", {}, async (f) => {
        ready(f, { ...direct(1), loop: true });
        await settle();
        const demo = video(f);
        assert.equal(demo.loop, true);
        f.w.__ottplayPip.play(direct(2));
        await settle();
        assert.equal(demo.paused, true);
        assert.equal(demo.hasAttribute("src"), false);
        assert.equal(video(f).loop, false);
        assert.notEqual(video(f), demo);
        // A late request cannot restore a retired demo decoder or its loop.
        f.w.__ottplayPip.play({ ...direct(1), loop: true });
        await settle();
        assert.equal(video(f).loop, false);
        assert.equal(f.plays.length, 2);
    });

    let failures = 0;
    for (const { check, name, options } of cases) {
        let f;
        try {
            f = fixture(script, { html, ...options });
            await check(f);
            console.log(`PASS PiP window: ${name}`);
        } catch (error) {
            failures++;
            console.error(`FAIL PiP window: ${name}: ${error.stack || error}`);
        } finally {
            if (f) f.close();
        }
    }
    assert.equal(
        failures,
        0,
        `${failures}/${cases.length} production PiP window scenarios failed`
    );
    console.log(`PASS all ${cases.length} production PiP window scenarios`);
}

module.exports = run;
// Allows a separate historical-source probe to reuse exactly the same DOM/media
// boundary model without changing the production bootstrap under test.
module.exports.fixture = fixture;
if (require.main === module) {
    run().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
