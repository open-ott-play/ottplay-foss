const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function functions(file, names) {
    const ast = ts.createSourceFile(
        file,
        read(file),
        ts.ScriptTarget.Latest,
        true
    );
    const selected = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    );
    assert.equal(selected.length, names.length);
    return ts.transpileModule(
        selected
            .map((node) => node.getText(ast).replace(/^export /, ""))
            .join("\n"),
        { compilerOptions: { target: ts.ScriptTarget.ES5 } }
    ).outputText;
}

const touchCode = functions("src/keyhandler/index.ts", [
    "capacitorOnly",
    "isNativeTouchEditor",
    "handleTouchStart",
    "handleTouchMove",
    "body_handleTouchEnd",
    "checkTap",
    "getDirection",
]);

function touchFixture(platform) {
    const calls = [];
    const w = {
        _doKey: (key) => calls.push(["key", key]),
        alert: () => {},
        keys: { DOWN: 40, ENTER: 13, LEFT: 37, RIGHT: 39, SETUP: 192, UP: 38 },
        MouseEvent: function (type, options) {
            Object.assign(this, { type }, options);
        },
        tCount: undefined,
        touch_locked: false,
        touch_min_sensX: 60,
        touch_min_sensY: 40,
        xDown: null,
        xMove1: null,
        xUp: null,
        yDown: null,
        yMove1: null,
        yUp: null,
    };
    w.window = w;
    if (platform === "capacitor") w.Capacitor = {};
    if (platform === "tauri") w.__TAURI__ = {};
    vm.createContext(w);
    require("./helpers/screen-runtime.cjs")(w);
    vm.runInContext(touchCode, w);
    return { calls, w };
}

// Same target and coordinates must reach the same click path in every shell,
// regardless of the previously highlighted menu/channel item.
for (const platform of ["browser", "tauri", "capacitor"]) {
    for (const [id, tagName, x, y] of [
        ["it8", "DIV", 200, 220],
        ["menu-action", "BUTTON", 20, 20],
        ["osk-key", "SPAN", 320, 600],
        ["edge", "DIV", 0, 0],
    ]) {
        const { w, calls } = touchFixture(platform);
        const touch = { clientX: x, clientY: y, screenX: x, screenY: y };
        const target = {
            dispatchEvent(e) {
                calls.push([e.type, id, e.clientX, e.clientY, e.bubbles]);
            },
            id,
            tagName,
        };
        let prevented = 0;
        w.handleTouchStart({
            preventDefault() {
                prevented++;
            },
            target,
            touches: [touch],
        });
        w.body_handleTouchEnd({
            changedTouches: [touch],
            preventDefault() {
                prevented++;
            },
            target,
            touches: [],
        });
        assert.deepEqual(
            calls,
            [["click", id, x, y, true]],
            platform + " tap " + id
        );
        assert.equal(
            prevented,
            2,
            "suppress compatibility click so activation happens once"
        );
        assert.equal(w.xDown, null);
    }
}

for (const target of [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { parentElement: { isContentEditable: true } },
]) {
    const { w, calls } = touchFixture("capacitor");
    const event = {
        preventDefault() {
            assert.fail("must leave native editor touch default intact");
        },
        target,
        touches: [{ screenX: 20, screenY: 30 }],
    };
    w.handleTouchStart(event);
    w.handleTouchMove(event);
    w.body_handleTouchEnd({ ...event, touches: [] });
    assert.deepEqual(calls, []);
}

{
    const { w, calls } = touchFixture("capacitor");
    w.handleTouchStart({
        preventDefault() {},
        touches: [{ screenX: 20, screenY: 30 }],
    });
    w.handleTouchMove({
        preventDefault() {},
        touches: [{ screenX: 160, screenY: 30 }],
    });
    w.body_handleTouchEnd({
        changedTouches: [],
        preventDefault() {},
        touches: [],
    });
    assert.equal(calls.length, 1, "swipe emits a remote key, not a click");
}

// The native editor exception must not bypass touchscreen lock or its unlock gesture.
for (const fingers of [1, 4]) {
    const { w } = touchFixture("capacitor");
    w.touch_locked = true;
    let prevented = 0;
    w.handleTouchStart({
        preventDefault() {
            prevented++;
        },
        target: { tagName: "INPUT" },
        touches: Array.from({ length: fingers }, () => ({
            screenX: 20,
            screenY: 30,
        })),
    });
    assert.equal(prevented, 1);
    assert.equal(w.touch_locked, fingers !== 4);
}

// Main-window drag exclusions and the body click bands must use the same
// viewport geometry. Execute both production paths against real DOM targets.
const bandCode = functions("src/keyhandler/index.ts", [
    "ottBandViewportHeight",
    "ottBottomInfoBandStart",
    "body_onClick",
]);
const indexAst = ts.createSourceFile(
    "src/index.ts",
    read("src/index.ts"),
    ts.ScriptTarget.Latest,
    true
);
const dragBindings = new Set([
    "STRIP_ID",
    "NO_DRAG_SEL",
    "DRAG_SEL",
    "SURFACE_OK_SEL",
    "isDragHandle",
]);
const dragDeclarations = [];
function visitDragDeclarations(node) {
    if (ts.isVariableDeclaration(node) && dragBindings.has(node.name.text)) {
        dragDeclarations.push("var " + node.getText(indexAst) + ";");
    }
    ts.forEachChild(node, visitDragDeclarations);
}
visitDragDeclarations(indexAst);
assert.equal(dragDeclarations.length, dragBindings.size);
const dragCode = ts.transpileModule(dragDeclarations.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES5 },
}).outputText;

for (const [innerHeight, viewportHeight, documentHeight, expected] of [
    [800, 600, 5000, 600],
    [600, 800, 5000, 600],
    [800, undefined, 5000, 800],
    [0, 300, 5000, 300],
    [0, 0, 640, 640],
    [0, undefined, 0, 0],
]) {
    const dom = new JSDOM(
        '<!doctype html><html><body><video id="video"></video><button>Menu</button><div id="ott-tauri-drag-strip"></div></body></html>',
        { runScripts: "outside-only" }
    );
    try {
        const w = dom.window;
        require("./helpers/screen-runtime.cjs")(w);
        const calls = [];
        w.innerHeight = innerHeight;
        w.visualViewport =
            viewportHeight === undefined
                ? undefined
                : { height: viewportHeight };
        Object.defineProperty(w.document.documentElement, "clientHeight", {
            value: documentHeight,
        });
        w.document.body.getBoundingClientRect = () => {
            throw new Error(
                "body dimensions must not define the visible viewport"
            );
        };
        w.keys = { ENTER: 13 };
        w._doKey = (key) => calls.push(key);
        w.popupList = () => calls.push("popup");
        w.showChannelInfo = () => calls.push("info");
        w.listOverlayOpen = () => !!w.isListVisible;
        w.eval(bandCode + "\n" + dragCode);
        assert.equal(w.ottBandViewportHeight(), expected);
        const video = w.document.getElementById("video");
        if (!expected) {
            w.body_onClick({ clientY: 100 });
            assert.deepEqual(
                calls,
                [],
                "missing dimensions do not invent a click band"
            );
            continue;
        }
        const bottom = w.ottBottomInfoBandStart(expected);
        assert.equal(bottom, expected - Math.max(expected * 0.3, 140));
        for (const [y, action, draggable] of [
            [expected * 0.2 - 1, "popup", true],
            [expected * 0.2, 13, true],
            [bottom, 13, true],
            [bottom + 1, "info", false],
        ]) {
            calls.length = 0;
            let prevented = 0;
            let stopped = 0;
            w.body_onClick({
                clientY: y,
                preventDefault() {
                    prevented++;
                },
                stopPropagation() {
                    stopped++;
                },
            });
            assert.deepEqual(calls, [action]);
            assert.equal(prevented, action === "info" ? 1 : 0);
            assert.equal(stopped, action === "info" ? 1 : 0);
            assert.equal(w.isDragHandle(video, y), draggable);
        }
        assert.equal(
            w.isDragHandle(w.document.querySelector("button"), 10),
            false
        );
        assert.equal(
            w.isDragHandle(
                w.document.getElementById("ott-tauri-drag-strip"),
                10
            ),
            true
        );
        w.__ottTauriNativeFs = true;
        assert.equal(w.isDragHandle(video, 10), false);
        w.__ottTauriNativeFs = false;
        w.isListVisible = true;
        calls.length = 0;
        w.body_onClick({ clientY: bottom + 1 });
        assert.deepEqual(calls, []);
        assert.equal(w.isDragHandle(video, 10), false);
        w.isListVisible = false;
        for (const flag of [
            "__ottTauriSuppressClick",
            "__ottInfoBandFromMouseUp",
        ]) {
            w[flag] = true;
            w.body_onClick({ clientY: bottom + 1 });
            assert.deepEqual(
                calls,
                [],
                "drag release and mouseup handling suppress duplicate clicks"
            );
            w[flag] = false;
        }
    } finally {
        dom.window.close();
    }
}
console.log(
    "OK: shared native drag/click geometry, viewport fallbacks, exact boundaries and overlay exclusions"
);

// Execute JS extracted from each actual native bridge, with the actual loaded
// device keymap and actual TS dispatch chain. No OS or native player is mocked
// as successful by these assertions.
const dispatch = functions("src/keyhandler/index.ts", [
    "dispatchKey",
    "keyHandler",
    "handleMainKey",
]);
const nativeSources = {
    android: read(
        "android/app/src/main/java/play/ott/foss/MediaPlaybackService.kt"
    ),
    ios: read("ios/App/App/Plugins/MobileNativeMedia.swift"),
    tauri: read("src-tauri/src/commands/media_session.rs"),
};
function nativeScript(platform, action) {
    const text = nativeSources[platform];
    const string = '"(?:\\\\.|[^"\\\\])*"';
    let match;
    if (platform === "tauri") {
        match = text.match(
            new RegExp(
                "const JS_" +
                    action.toUpperCase() +
                    ": &str = (" +
                    string +
                    ");"
            )
        );
    } else {
        const method =
            platform === "ios"
                ? {
                      next: "nextTrack",
                      pause: "pause",
                      play: "play",
                      prev: "previousTrack",
                      stop: "stop",
                  }[action] + "Command.addTarget"
                : "fun drive" +
                  action[0].toUpperCase() +
                  action.slice(1) +
                  "()";
        const block = text.slice(text.indexOf(method));
        match = block.match(
            new RegExp(
                (platform === "ios" ? "evalVideoJS" : "evalOnWebView") +
                    "\\(\\s*(" +
                    string +
                    ")"
            )
        );
    }
    assert.ok(match, platform + " " + action);
    return JSON.parse(match[1]);
}

for (const platform of Object.keys(nativeSources)) {
    for (const device of ["pc", "android"]) {
        const calls = [];
        const w = {
            isEditMode: false,
            isSelectBox: false,
            keyFun: (v) => calls.push(v),
            settings: { nextFun: 13, prevFun: 14 },
            stbContinue: () => calls.push("continue"),
            stbEventToKeyCode: (e) => e.keyCode,
            stbIsPlaying: () => false,
            stbPause: () => calls.push("pause"),
            stbStop: () => calls.push("stop"),
            version: "",
        };
        w.window = w;
        vm.createContext(w);
        require("./helpers/screen-runtime.cjs")(w);
        vm.runInContext(
            read("stb/" + device + "/stb.js") +
                "\n" +
                dispatch +
                "\nwindow._doKey=dispatchKey;",
            w
        );
        for (const action of ["next", "prev", "play", "pause", "stop"])
            vm.runInContext(nativeScript(platform, action), w);
        assert.deepEqual(
            calls,
            [13, 14, "continue", "pause", "stop"],
            platform + "/" + device
        );
    }
}

// Explicit OS Play must be idempotent even though the legacy stbContinue API
// toggles. Execute the actual core methods to avoid hiding this with a spy.
const coreControls = functions("src/core/index.ts", [
    "setCoreDemoMute",
    "isCoreThenable",
    "playCoreMedia",
    "cancelCoreSeek",
    "cancelCoreAutoPlayback",
    "cancelCoreNativeHls",
    "destroyCoreShaka",
    "resetCoreNativeBitrate",
    "stbContinue",
    "stbPause",
    "stbStop",
    "getCoreMediaBackend",
    "openCoreEngineLease",
    "stopCoreEngine",
    "stbIsPlaying",
]);
for (const platform of Object.keys(nativeSources)) {
    let destroyed = 0;
    const w = {
        _coreAutoCancel: null,
        _coreDemoMute: null,
        _coreNativeAttempt: 0,
        _coreNativeHls: null,
        _coreNativeHlsCleanup: null,
        _corePendingSeek: null,
        _corePipSession: 0,
        _coreShakaTeardown: null,
        _inLiveRestart: false,
        _playSession: 0,
        cancelLiveRestart() {},
        clearInterval() {},
        clearPlayTimeInterval() {},
        coreDeviceEffects: {},
        coreMediaBackend: null,
        hlsInstance: {
            destroy() {
                destroyed++;
            },
        },
        setInterval() {
            return 1;
        },
        video: {
            pause() {
                this.paused = true;
            },
            paused: true,
            play() {
                this.paused = false;
            },
            removeAttribute() {},
        },
    };
    w.window = w;
    vm.createContext(w);
    require("./helpers/screen-runtime.cjs")(w);
    require("./helpers/private-runtime.cjs")(w, "src/device/media-backend.ts");
    w.startCoreEngine = () => {
        w._playSession++;
    };
    vm.runInContext(coreControls, w);
    w.getCoreMediaBackend().open({ url: "fixture.mp4" });
    for (let i = 0; i < 2; i++)
        vm.runInContext(nativeScript(platform, "play"), w);
    assert.equal(w.video.paused, false, platform + " repeated explicit Play");
    for (let i = 0; i < 2; i++)
        vm.runInContext(nativeScript(platform, "pause"), w);
    assert.equal(w.video.paused, true, platform + " explicit Pause");
    assert.equal(w.forcePlay, false);
    vm.runInContext(nativeScript(platform, "stop"), w);
    assert.equal(destroyed, 1, platform + " Stop tears down HLS");
    assert.equal(w._playSession, 2);
}

// Run the shipped dedicated PiP document, including the pre-play mute assertion,
// asynchronous native/media lifecycle, decoder callbacks and frameless dragging.
require("./test_tauri_pip_window.cjs")()
    .then(() =>
        console.log(
            "OK: native touch targets/editor defaults, device media actions, TS lifecycle and silent Tauri PiP"
        )
    )
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
