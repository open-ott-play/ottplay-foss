import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Exercise the actual source with the same classic-global semantics as the
// production concat bundle, without a browser, network, or wall-clock sleeps.
function source(file: string, names?: string[]): string {
    const text = fs.readFileSync(path.join(root, "src", file), "utf8");
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const code = names
        ? ast.statements
              .filter(
                  (n) =>
                      ts.isFunctionDeclaration(n) &&
                      names.includes(n.name?.text || "")
              )
              .map((n) => n.getText(ast))
              .join("\n")
        : text;
    return ts
        .transpileModule(code, {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.split("\n")
        .filter(
            (line) =>
                !line.trim().startsWith("import ") && !/^export\s*\{/.test(line)
        )
        .map((line) => line.replace(/^export /, ""))
        .join("\n");
}

function fixture() {
    let id = 0;
    const intervals = new Map<number, { fn: () => void; ms: number }>();
    const timeouts = new Map<number, { fn: () => void; ms: number }>();
    const calls: any[] = [];
    const chain = {
        css() {
            return this;
        },
        hide() {
            return this;
        },
        html() {
            return this;
        },
        show() {
            return this;
        },
        text() {
            return this;
        },
    };
    const w: any = {
        _: (s: string) => s,
        $: () => chain,
        $i1: chain,
        catIndex: 1,
        clearInterval(n: number) {
            intervals.delete(n);
        },
        clearTimeout(n: number) {
            timeouts.delete(n);
        },
        console: { error() {}, log() {}, warn() {} },
        document: {
            body: { style: {} },
            getElementById() {
                return { innerHTML: "" };
            },
        },
        execCHarr() {},
        fileArchive: false,
        keys: {
            DOWN: 40,
            ENTER: 13,
            LEFT: 37,
            N0: 48,
            N1: 49,
            N2: 50,
            N3: 51,
            N4: 52,
            N5: 53,
            N6: 54,
            N7: 55,
            N8: 56,
            N9: 57,
            PAUSE: 19,
            PLAY: 80,
            RIGHT: 39,
            UP: 38,
        },
        nProg: "",
        playTime: 0,
        playType: 0,
        primaryIndex: 2,
        s10resum: 1,
        s13dur: 15,
        s46dur: 60,
        s79dur: 300,
        setInterval(fn: () => void, ms: number) {
            intervals.set(++id, { fn, ms });
            return id;
        },
        setTimeout(fn: () => void, ms: number) {
            timeouts.set(++id, { fn, ms });
            return id;
        },
        settings: { okFun: 0 },
        tCount: 1,
        touch_locked: false,
        touch_min_sensX: 100,
        touch_min_sensY: 50,
        xDown: 100,
        xMove1: 100,
        xUp: 100,
        yDown: 100,
        yMove1: 100,
        yUp: 100,
    };
    w.window = w;
    vm.createContext(w);
    vm.runInContext(source("core/index.ts"), w);
    vm.runInContext(
        source("ui/index.ts", ["initBackgroundIntervals", "_t2"]),
        w
    );
    vm.runInContext(
        source("keyhandler/index.ts", [
            "toggleMainPlayback",
            "handleMainKey",
            "handleTouchMove",
            "getDirection",
            "keyHandler",
            "body_handleTouchEnd",
            "checkTap",
            "capacitorOnly",
        ]),
        w
    );
    w.video = {
        canPlayType() {
            return "probably";
        },
        currentTime: 0,
        pause() {
            this.paused = true;
        },
        paused: true,
        play() {
            this.paused = false;
            this.playCalls++;
            return Promise.resolve();
        },
        playCalls: 0,
        removeAttribute() {
            this.src = "";
        },
        src: "",
    };
    for (const name of [
        "showShift",
        "showChanelInfo",
        "playArchive",
        "shiftArchive",
        "numberProg",
        "mediaList",
        "channelsList",
        "epgList",
        "liveStop",
        "_doKey",
        "keyFun",
    ]) {
        w[name] = (...args: any[]) => calls.push([name, ...args]);
    }
    return {
        calls,
        intervals,
        key(code: number) {
            w.handleMainKey(code, {
                preventDefault() {},
                stopPropagation() {},
            });
        },
        tick() {
            [...intervals.values()]
                .filter((t) => t.ms === 1000)
                .forEach((t) => t.fn());
        },
        timeouts,
        w,
    };
}

{
    const f = fixture();
    f.w.initBackgroundIntervals();
    f.w.playType = 1700000000;
    f.w.stbPlay("archive.m3u8");
    f.tick();
    assert.equal(f.w.playTime, 1, "archive time must advance once per second");
    f.w.stbPause();
    f.tick();
    assert.equal(f.w.playTime, 1, "paused archive must not advance");
    f.w.stbPlay("other-archive.m3u8");
    f.tick();
    assert.equal(
        f.w.playTime,
        2,
        "switching stream must not create a second clock"
    );
}

for (const supported of [false, undefined]) {
    const { w } = fixture();
    w.playerMode = 1;
    if (supported !== undefined) w.Hls = { isSupported: () => supported };
    w.stbPlay("native.m3u8", 42);
    assert.equal(w.video.src, "native.m3u8");
    assert.equal(
        w.video.playCalls,
        1,
        "native fallback must start when HLS is unavailable"
    );
    assert.equal(
        w.video.currentTime,
        42,
        "native fallback must retain requested position"
    );
}

function installHls(w: any) {
    const players: any[] = [];
    class Hls {
        static isSupported = () => true;
        static Events = {
            AUDIO_TRACKS_UPDATED: "audio",
            ERROR: "error",
            MANIFEST_PARSED: "manifest",
        };
        static ErrorTypes = { MEDIA_ERROR: "media", NETWORK_ERROR: "network" };
        events: Record<string, (...args: any[]) => void> = {};
        url = "";
        levels: any[] = [];
        destroyed = false;
        constructor() {
            players.push(this);
        }
        loadSource(url: string) {
            this.url = url;
        }
        attachMedia() {}
        recoverMediaError() {}
        on(event: string, callback: (...args: any[]) => void) {
            this.events[event] = callback;
        }
        destroy() {
            this.destroyed = true;
        }
    }
    w.Hls = Hls;
    w.playerMode = 1;
    return players;
}

for (const action of ["switch", "stop"]) {
    const f = fixture();
    const players = installHls(f.w);
    f.w.stbPlay("A.m3u8");
    const old = players[0];
    old.events.error(null, {
        details: "manifestParsingError",
        fatal: true,
        type: "network",
    });
    assert.equal(f.timeouts.size, 1);
    const staleRetry = [...f.timeouts.values()][0].fn;
    if (action === "switch") f.w.stbPlay("B.m3u8");
    else f.w.stbStop();
    assert.equal(f.timeouts.size, 0, "obsolete reconnect must be cancelled");
    staleRetry(); // Also reject callbacks already queued before cancellation.
    old.events.manifest();
    old.events.error(null, {
        details: "manifestParsingError",
        fatal: true,
        type: "network",
    });
    assert.deepEqual(
        players.map((p) => p.url),
        action === "switch" ? ["A.m3u8", "B.m3u8"] : ["A.m3u8"]
    );
    assert.equal(
        f.w.video.playCalls,
        0,
        "stale manifest must not resume playback"
    );
}

{
    const f = fixture();
    const players = installHls(f.w);
    f.w.stbPlay("retry.m3u8");
    const fatal = {
        details: "manifestParsingError",
        fatal: true,
        type: "network",
    };
    players[0].events.error(null, fatal);
    const retry = [...f.timeouts.entries()][0];
    f.timeouts.delete(retry[0]);
    retry[1].fn();
    assert.deepEqual(
        players.map((p) => p.url),
        ["retry.m3u8", "retry.m3u8"]
    );
    players[1].events.error(null, fatal);
    assert.equal(
        f.timeouts.size,
        0,
        "the active session still gets only one parse retry"
    );
}

{
    const f = fixture();
    const players = installHls(f.w);
    f.w.stbPlay("HLS.m3u8", 35);
    assert.equal(f.w.video.playCalls, 0);
    players[0].events.manifest();
    assert.equal(f.w.video.playCalls, 1);
    assert.equal(f.w.video.currentTime, 35);
}

{
    const f = fixture();
    f.w.playType = 1700000000;
    f.w.playTime = 120;
    f.key(f.w.keys.PLAY);
    assert.deepEqual(f.calls.at(-1), ["playArchive", 1700000110]);
    f.calls.length = 0;
    f.w.s10resum = 0;
    f.key(f.w.keys.N0);
    assert.deepEqual(f.calls.at(-1), ["playArchive", 1700000120]);
    f.calls.length = 0;
    f.w.fileArchive = true;
    f.key(f.w.keys.PLAY);
    assert.equal(
        f.w.video.playCalls,
        1,
        "file archives should resume their current stream"
    );
    assert.ok(!f.calls.some((c) => c[0] === "playArchive"));
}

{
    const f = fixture();
    f.w.playType = -1e11;
    f.w.stbPlay("movie.mp4");
    f.key(f.w.keys.N1);
    assert.deepEqual(f.calls.at(-1), ["shiftArchive", -15]);
    f.key(f.w.keys.ENTER);
    assert.deepEqual(f.calls.at(-1), ["mediaList", null]);
    f.key(f.w.keys.N0);
    assert.equal(f.w.video.paused, true);
    f.key(f.w.keys.ENTER);
    assert.equal(
        f.w.video.paused,
        false,
        "ENTER resumes an explicitly paused movie"
    );
    f.w.playType = 0;
    f.calls.length = 0;
    f.key(f.w.keys.N1);
    assert.deepEqual(f.calls, [["numberProg", 1]]);
    f.w.keys.N1 = 8; // Android platform mapping, rather than ASCII.
    f.key(8);
    assert.deepEqual(f.calls.at(-1), ["numberProg", 1]);
}

{
    const f = fixture();
    const move = (x: number, y: number) =>
        f.w.handleTouchMove({
            preventDefault() {},
            touches: [{ screenX: x, screenY: y }],
        });
    move(101, 100);
    move(199, 100);
    assert.deepEqual(f.calls, [], "touch jitter must not dispatch remote keys");
    move(201, 100);
    assert.deepEqual(f.calls, [["_doKey", f.w.keys.RIGHT]]);
    move(202, 100);
    assert.equal(
        f.calls.length,
        1,
        "a new swipe must cross the threshold again"
    );
    move(202, 151);
    assert.deepEqual(f.calls.at(-1), ["_doKey", f.w.keys.DOWN]);
}
// ES5-capable media engines may have no Promise global and return void from play().
for (const route of ["manifest", "native recovery"]) {
    const f = fixture();
    const players = installHls(f.w);
    f.w.Promise = undefined;
    f.w.video.play = function () {
        this.paused = false;
        this.playCalls++;
    };
    f.w.stbPlay("legacy-engine.m3u8", 35);
    if (route === "manifest") {
        players[0].events.manifest();
        assert.equal(
            f.w.video.currentTime,
            35,
            "void play() must not interrupt the seek"
        );
    } else {
        const fatal = {
            details: "bufferAppendError",
            fatal: true,
            type: "media",
        };
        players[0].events.error(null, fatal);
        players[0].events.error(null, fatal);
        assert.equal(f.w.video.src, "legacy-engine.m3u8");
    }
    assert.equal(f.w.video.playCalls, 1);
}

{
    const f = fixture();
    f.w.$ = (selector: string) => ({ is: () => selector === "#listEdit" });
    f.w.handleEditKey = (code: number) => f.calls.push(["edit", code]);
    for (const key of [{ keyCode: 13 }, { which: 27 }]) {
        f.w.keyHandler({
            ...key,
            preventDefault() {},
            stopPropagation() {},
            target: { tagName: "INPUT" },
        });
    }
    assert.deepEqual(
        f.calls,
        [
            ["edit", 13],
            ["edit", 27],
        ],
        "legacy keyCode/which must confirm and cancel editors"
    );
}

{
    const f = fixture();
    f.w.MouseEvent = undefined;
    f.w.document.createEvent = (kind: string) => {
        assert.equal(kind, "MouseEvents");
        return {
            initMouseEvent(...args: any[]) {
                Object.assign(this, {
                    bubbles: args[1],
                    clientX: args[7],
                    clientY: args[8],
                    type: args[0],
                });
            },
        };
    };
    let dispatched: any;
    f.w.body_handleTouchEnd({
        changedTouches: [{ clientX: 25, clientY: 45 }],
        preventDefault() {},
        target: {
            dispatchEvent(event: any) {
                dispatched = event;
            },
        },
        touches: [],
    });
    assert.equal(dispatched.type, "click");
    assert.equal(dispatched.bubbles, true);
    assert.equal(dispatched.clientX, 25);
    assert.equal(dispatched.clientY, 45);
}

console.log(
    "OK: playback clocks, native/HLS lifecycle, transport keys, touch thresholds, and legacy media/input events"
);
