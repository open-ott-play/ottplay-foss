// Desktop keys must keep their PC meaning when OTT starts a remote Plex queue.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const filename = "src/key-handler/index.ts";
const source = ts.createSourceFile(
    filename,
    fs.readFileSync(path.join(root, filename), "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const names = new Set([
    "tryKeyboardSeek",
    "tryKeyboardRandom",
    "installKeyboardSeek",
    "cancelNativeListInertia",
    "keyHandler",
    "handleMainKey",
    "keyFun",
]);
const code = ts
    .transpileModule(
        source.statements
            .filter(
                (node) =>
                    ts.isFunctionDeclaration(node) && names.has(node.name?.text)
            )
            .map((node) => node.getText(source))
            .join("\n"),
        {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        }
    )
    .outputText.replace(/^export /gm, "");

function fixture(platform = "pc", phase = "playing", target = true) {
    const dom = new JSDOM('<body><video tabindex="0"></video><input></body>', {
        runScripts: "outside-only",
    });
    const w = dom.window;
    const calls = [];
    let screen = null;
    const map = { 37: "left", 38: "up", 39: "right", 40: "down" };
    Object.assign(w, {
        __ottClassicPlayback: {
            snapshot: () => ({
                phase,
                target: target ? { kind: "live" } : null,
            }),
        },
        __ottClassicScreenPort: {
            dispatch(code, event, main) {
                if (screen) calls.push(["screen", screen.kind, code]);
                else main({ code });
            },
            normalize: (code) => ({ code, id: map[code] }),
            reconcile() {},
            screens: { current: () => screen },
        },
        __ottInputRouter: {
            binding: (value) =>
                ({ 13: "volume.increase", 14: "volume.decrease" })[value],
        },
        __ottMedia: {
            current: () => ({ ref: { sourceId: "plex@remote" } }),
            skip: (delta) => calls.push(["skip", delta]),
        },
        __ottTauriNativeFs: true,
        $: () => ({ is: () => false }),
        changeVolume: (delta) => calls.push(["volume", delta]),
        keys: { DOWN: 40, LEFT: 37, RIGHT: 39, UP: 38 },
        nativeListInertia: null,
        ott_device: platform,
        playType: -1e11,
        setSleepTimeout() {},
        settings: { adFun: 18, alFun: 14, arFun: 13, auFun: 19 },
        shiftArchive: (delta) => calls.push(["seek", delta]),
        stbEventToKeyCode: (event) =>
            event.keyCode ||
            event.which ||
            { ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38 }[
                event.key
            ],
        sVolumeStep: 5,
    });
    w.eval(code);
    w.installKeyboardSeek();
    w.installKeyboardSeek();
    w.addEventListener("keydown", w.keyHandler);
    const video = w.document.querySelector("video");
    // WebKit's native video controls can consume the bubble phase.
    video.addEventListener("keydown", (event) => event.stopPropagation());
    return {
        calls,
        close: () => w.close(),
        screen: (value) => {
            screen = value;
        },
        send(key, destination = w.document.body, modifiers = {}) {
            const event = new w.KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                code: key,
                key,
                keyCode: {
                    ArrowDown: 40,
                    ArrowLeft: 37,
                    ArrowRight: 39,
                    ArrowUp: 38,
                }[key],
                ...modifiers,
            });
            destination.dispatchEvent(event);
            return event;
        },
        video,
        w,
    };
}

let checks = 0;
function test(name, run) {
    run();
    checks++;
    console.log("PASS desktop Plex arrows: " + name);
}

for (const platform of ["pc", "pc2"]) {
    for (const phase of [
        "playing",
        "paused",
        "loading",
        "buffering",
        "stopped",
        "idle",
        "error",
    ]) {
        for (const focusedVideo of [false, true]) {
            test(
                platform +
                    " " +
                    phase +
                    (focusedVideo ? " video focus" : " document focus"),
                () => {
                    const f = fixture(platform, phase);
                    try {
                        const destination = focusedVideo
                            ? f.video
                            : f.w.document.body;
                        assert.equal(
                            f.send("ArrowLeft", destination).defaultPrevented,
                            true,
                            "native controls must not also seek"
                        );
                        assert.equal(
                            f.send("ArrowRight", destination).defaultPrevented,
                            true,
                            "native controls must not also seek"
                        );
                        assert.deepEqual(
                            f.calls,
                            [
                                ["volume", -5],
                                ["volume", 5],
                            ],
                            "plain arrows never seek or skip the Plex queue"
                        );
                    } finally {
                        f.close();
                    }
                }
            );
        }
    }
    test(
        platform + " missing primary target uses desktop main fallback",
        () => {
            const f = fixture(platform, "idle", false);
            try {
                f.send("ArrowLeft");
                f.send("ArrowRight");
                assert.deepEqual(f.calls, [
                    ["volume", -5],
                    ["volume", 5],
                ]);
            } finally {
                f.close();
            }
        }
    );
    test(platform + " legacy which dispatch keeps remote Plex volume", () => {
        const f = fixture(platform, "loading", false);
        try {
            for (const which of [37, 39]) {
                f.w.keyHandler({
                    preventDefault() {},
                    stopPropagation() {},
                    which,
                });
            }
            assert.deepEqual(f.calls, [
                ["volume", -5],
                ["volume", 5],
            ]);
        } finally {
            f.close();
        }
    });
    test(
        platform + " no media or target preserves configured arrow actions",
        () => {
            const f = fixture(platform, "idle", false);
            try {
                f.w.__ottMedia.current = () => null;
                f.w.__ottInputRouter.binding = (value) =>
                    ({
                        13: "archive.minute-forward",
                        14: "archive.minute-back",
                    })[value];
                f.send("ArrowLeft");
                f.send("ArrowRight");
                assert.deepEqual(f.calls, [
                    ["seek", -60],
                    ["seek", 60],
                ]);
            } finally {
                f.close();
            }
        }
    );
    test(
        platform + " modifier seeks and queue navigation keep their meanings",
        () => {
            const f = fixture(platform);
            try {
                for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
                    f.send("ArrowLeft", f.video, { [modifier]: true });
                    f.send("ArrowRight", f.video, { [modifier]: true });
                }
                assert.deepEqual(f.calls.splice(0), [
                    ["seek", -10],
                    ["seek", 10],
                    ["seek", -10],
                    ["seek", 10],
                    ["seek", -10],
                    ["seek", 10],
                ]);
                f.send("ArrowUp");
                f.send("ArrowDown");
                assert.deepEqual(f.calls, [
                    ["skip", 1],
                    ["skip", -1],
                ]);
            } finally {
                f.close();
            }
        }
    );
    test(
        platform + " open menus and native text input retain their arrows",
        () => {
            const f = fixture(platform);
            try {
                f.screen({ kind: "list" });
                f.send("ArrowLeft");
                f.send("ArrowRight");
                assert.deepEqual(f.calls.splice(0), [
                    ["screen", "list", 37],
                    ["screen", "list", 39],
                ]);
                f.screen(null);
                const input = f.w.document.querySelector("input");
                input.focus();
                assert.equal(
                    f.send("ArrowLeft", input).defaultPrevented,
                    false
                );
                assert.deepEqual(f.calls, []);
            } finally {
                f.close();
            }
        }
    );
}

test("TV remote Plex arrows keep seeking", () => {
    const f = fixture("lg/webos", "loading");
    try {
        f.send("ArrowLeft");
        f.send("ArrowRight");
        assert.deepEqual(f.calls, [
            ["seek", -10],
            ["seek", 10],
        ]);
    } finally {
        f.close();
    }
});
console.log(checks + " desktop Plex keyboard scenarios passed");
