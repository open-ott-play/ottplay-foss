const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
function compile(file) {
    return ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
}

function fixture() {
    const dom = new JSDOM(
        `<!doctype html><body>
            <video id="video"></video>
            <div id="info1" style="display:none">
                <div id="descr"><div id="programm_name2"></div><div id="programm_descr"></div></div>
                <div id="picon"></div>
                <div id="channel">
                    <div id="channel_number">7</div>
                    <div id="channel_name">BBC One</div>
                    <div id="progress_div">
                        <div id="progress_r"></div>
                        <div id="progress" style="width:25%"></div>
                        <span id="progress_span"><span></span></span>
                    </div>
                    <div id="begin_time">20:00</div>
                    <div id="programm_name">Evening News</div>
                    <div id="end_time">+15</div>
                    <div id="nbegin_time">20:30</div>
                    <div id="nprogramm_name">Weather</div>
                </div>
                <div id="data"><div id="video_res"></div></div>
            </div>
            <div id="permanentTime"></div>
            <div id="list"></div>
        </body>`,
        { runScripts: "outside-only", url: "https://example.invalid/player/" }
    );
    const w = dom.window;
    const calls = [];
    const record =
        (name) =>
        (...args) =>
            calls.push([name, ...args]);
    Object.assign(w, {
        _: (value) => value,
        __ottClassicPlayback: {
            command: record("command"),
            snapshot: () => ({
                phase: "playing",
                target: { archiveStart: 0, channelId: "7", kind: "live" },
            }),
        },
        __ottClassicScreenPort: {
            screens: { current: () => null },
        },
        __ottInterfaceModeState: { effective: 1, status: "modern" },
        catIndex: 3,
        channelsList: record("channelsList"),
        clearInterval: w.clearInterval.bind(w),
        clearTimeout: w.clearTimeout.bind(w),
        forcePlay: true,
        infoBarHide: record("infoBarHide"),
        isListVisible: false,
        keys: {
            DOWN: 40,
            ENTER: 13,
            EXIT: 27,
            LEFT: 37,
            RETURN: 8,
            RIGHT: 39,
            UP: 38,
        },
        pauseLivePlayback: record("pauseLivePlayback"),
        playArchive: record("playArchive"),
        playChannel: record("playChannel"),
        playTime: 0,
        playType: 0,
        popupList: record("popupList"),
        primaryIndex: 2,
        s10resum: 0,
        setInterval: w.setInterval.bind(w),
        setTimeout: w.setTimeout.bind(w),
        settings: { interfaceMode: 1 },
        shiftArchive: record("shiftArchive"),
        showChannelInfo: record("showChannelInfo"),
        showShift: record("showShift"),
        sInterfaceMode: 1,
        stbAudioTracksExists: () => true,
        stbContinue: record("stbContinue"),
        stbGetLen: () => 600,
        stbGetPosTime: () => 120,
        stbIsPlaying: () => true,
        stbPause: record("stbPause"),
        stbSubtitleExists: () => 1,
        stbToFullScreen: record("stbToFullScreen"),
        stbToggleAspectRatio: record("stbToggleAspectRatio"),
        stbToggleAudioTrack: record("stbToggleAudioTrack"),
        stbToggleMute: record("stbToggleMute"),
        stbToggleSubtitle: record("stbToggleSubtitle"),
    });
    w.eval(compile("src/ui/modern-player.ts"));
    const api = w.__ottModernPlayerFactory(w);
    return {
        api,
        calls,
        dom,
        progress: w.document.getElementById("progress_div"),
        progressHome: w.document.getElementById("channel"),
        w,
    };
}

test("Classic keeps the shared footer and creates no overlay", () => {
    const f = fixture();
    try {
        f.w.settings.interfaceMode = 0;
        f.w.sInterfaceMode = 0;
        f.w.__ottInterfaceModeState.effective = 0;
        f.api.refresh();
        assert.equal(f.api.state().active, false);
        assert.equal(f.w.document.getElementById("modernPlayer"), null);
        assert.equal(f.progress.parentNode, f.progressHome);
        assert.equal(
            f.w.document.body.classList.contains("modern-player-ready"),
            false
        );
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("Modern moves the shared scrubber and mirrors live programme state", () => {
    const f = fixture();
    try {
        f.api.refresh();
        assert.equal(f.api.state().active, true);
        assert(f.w.document.body.classList.contains("modern-player-ready"));
        assert.equal(f.progress.parentNode.className, "modern-player-track");
        assert.equal(f.progress.getAttribute("role"), "slider");
        const overlay = f.w.document.getElementById("modernPlayer");
        assert(overlay);
        assert.equal(overlay.hidden, true);

        f.w.document.getElementById("info1").style.display = "block";
        f.api.sync();
        assert.equal(overlay.hidden, false);
        assert.equal(f.api.state().open, true);
        assert.equal(
            f.w.document.querySelector(".modern-player-kicker").textContent,
            "Live"
        );
        assert.equal(
            f.w.document.querySelector(".modern-player-title").textContent,
            "Evening News"
        );
        assert.equal(
            f.w.document.querySelector(".modern-player-meta").textContent,
            "BBC One · #7"
        );
        assert.equal(
            f.w.document.querySelector(".modern-player-next").textContent,
            "20:30 · Weather"
        );
        assert.equal(
            f.w.document.querySelector(".modern-player-elapsed").textContent,
            "20:00"
        );
        assert.equal(
            f.w.document.querySelector(".modern-player-remaining").textContent,
            "+15 min"
        );
        assert.equal(f.progress.getAttribute("aria-valuenow"), "25");
        assert.equal(
            f.w.document
                .querySelector('[data-modern-player-action="play"]')
                .getAttribute("aria-label"),
            "Pause"
        );
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("transport buttons call the shared playback boundaries", () => {
    const f = fixture();
    try {
        f.api.refresh();
        f.w.document.getElementById("info1").style.display = "block";
        f.api.sync();
        const click = (id) =>
            f.w.document
                .querySelector(`[data-modern-player-action="${id}"]`)
                .click();
        click("rewind");
        click("forward");
        click("mute");
        click("audio");
        click("subtitle");
        click("aspect");
        click("list");
        assert.deepEqual(
            f.calls.filter(([name]) =>
                [
                    "shiftArchive",
                    "stbToggleMute",
                    "stbToggleAudioTrack",
                    "stbToggleSubtitle",
                    "stbToggleAspectRatio",
                    "channelsList",
                    "infoBarHide",
                ].includes(name)
            ),
            [
                ["shiftArchive", -10],
                ["shiftArchive", 10],
                ["stbToggleMute"],
                ["stbToggleAudioTrack"],
                ["stbToggleSubtitle"],
                ["stbToggleAspectRatio"],
                ["infoBarHide"],
                ["channelsList", 3, 2],
            ]
        );
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("play/pause preserves live and finite playback ownership", () => {
    const f = fixture();
    try {
        f.api.refresh();
        f.w.document.getElementById("info1").style.display = "block";
        f.api.sync();
        f.w.document
            .querySelector('[data-modern-player-action="play"]')
            .click();
        assert.deepEqual(f.calls, [
            ["pauseLivePlayback"],
            ["showChannelInfo", 1],
        ]);

        f.calls.length = 0;
        f.w.playType = 1000;
        f.w.__ottClassicPlayback.snapshot = () => ({
            phase: "playing",
            target: {
                archiveStart: 1000,
                channelId: "7",
                kind: "archive",
                position: 90,
            },
        });
        f.api.sync();
        f.w.document
            .querySelector('[data-modern-player-action="play"]')
            .click();
        assert.deepEqual(f.calls.slice(0, 2), [
            ["showShift", "Pause"],
            ["showChannelInfo", 2],
        ]);
        assert.equal(f.calls[2][0], "command");
        assert.equal(f.calls[2][1].type, "pause");
        assert.deepEqual(f.calls[3], ["stbPause"]);

        f.calls.length = 0;
        f.w.stbIsPlaying = () => false;
        f.api.sync();
        f.w.document
            .querySelector('[data-modern-player-action="play"]')
            .click();
        assert.deepEqual(f.calls, [
            ["showShift", "Play"],
            ["infoBarHide"],
            ["playArchive", 1090],
        ]);
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("D-pad walks the scrubber and action rail without losing the shared keys", () => {
    const f = fixture();
    try {
        f.api.refresh();
        f.w.document.getElementById("info1").style.display = "block";
        f.api.sync();
        const key = (name) =>
            f.w.dispatchEvent(
                new f.w.KeyboardEvent("keydown", { bubbles: true, key: name })
            );
        key("ArrowLeft");
        assert.deepEqual(f.calls, [
            ["shiftArchive", -10],
            ["showChannelInfo", 1],
        ]);
        // The timeline consumes the seek, not the Classic volume shortcut.
        assert.equal(f.progress, f.w.document.activeElement);

        f.calls.length = 0;
        key("ArrowDown");
        assert.equal(
            f.w.document.activeElement.getAttribute(
                "data-modern-player-action"
            ),
            "play"
        );
        key("ArrowRight");
        assert.equal(
            f.w.document.activeElement.getAttribute(
                "data-modern-player-action"
            ),
            "rewind"
        );
        key("Enter");
        assert.deepEqual(f.calls, [
            ["showChannelInfo", 1],
            ["showChannelInfo", 1],
            ["shiftArchive", -10],
            ["showChannelInfo", 1],
        ]);

        f.calls.length = 0;
        key("ArrowUp");
        assert.equal(f.progress, f.w.document.activeElement);
        key("Escape");
        assert.deepEqual(f.calls, [["showChannelInfo", 1], ["infoBarHide"]]);
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("live tabs, status and next programme stay text-safe", () => {
    const f = fixture();
    try {
        f.w.document.getElementById("programm_descr").textContent =
            "Shared description";
        f.w.document.getElementById("video_res").textContent =
            "Stream connection failed";
        f.w.document.getElementById("video_res").setAttribute("role", "button");
        f.api.refresh();
        f.w.document.getElementById("info1").style.display = "block";
        f.api.sync();
        assert.equal(
            f.w.document.querySelector(".modern-player-summary").textContent,
            "Shared description"
        );
        const status = f.w.document.querySelector(".modern-player-status");
        assert.equal(status.textContent, "Stream connection failed");
        assert(status.classList.contains("modern-player-status-action"));
        assert.equal(status.hidden, false);
        const details = f.w.document.querySelector(
            '[data-modern-player-action="details"]'
        );
        assert.equal(details.hidden, false);
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("dialogs and number entry own input above the overlay", () => {
    const f = fixture();
    try {
        f.api.refresh();
        f.w.document.getElementById("info1").style.display = "block";
        f.api.sync();
        assert.equal(f.api.state().open, true);
        const dialog = f.w.document.createElement("div");
        dialog.id = "dialogbox";
        dialog.style.display = "block";
        f.w.document.body.appendChild(dialog);

        f.api.sync();
        assert.equal(f.api.state().open, false);
        assert.equal(f.w.document.getElementById("modernPlayer").hidden, true);
        f.calls.length = 0;
        f.w.dispatchEvent(
            new f.w.KeyboardEvent("keydown", {
                bubbles: true,
                key: "ArrowLeft",
            })
        );
        assert.deepEqual(f.calls, []);

        dialog.style.display = "none";
        f.api.sync();
        assert.equal(f.api.state().open, true);
        assert.equal(f.w.document.getElementById("modernPlayer").hidden, false);
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("a live stream without guide data does not show an empty scrubber", () => {
    const f = fixture();
    try {
        f.api.refresh();
        f.w.document.getElementById("begin_time").textContent = "";
        f.w.document.getElementById("end_time").textContent = "";
        f.w._prog100 = null;
        f.w.document.getElementById("info1").style.display = "block";
        f.api.sync();
        const timeline = f.w.document.querySelector(".modern-player-timeline");
        assert.equal(timeline.hidden, true);

        f.w.document.getElementById("begin_time").textContent = "20:00";
        f.w.document.getElementById("end_time").textContent = "+15";
        f.w._prog100 = {
            time: Date.now() / 1000 - 600,
            time_to: Date.now() / 1000 + 900,
        };
        f.api.sync();
        assert.equal(timeline.hidden, false);
        assert.equal(
            f.w.document.querySelector(".modern-player-elapsed").textContent,
            "20:00"
        );
        assert.equal(
            f.w.document.querySelector(".modern-player-remaining").textContent,
            "+15 min"
        );
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});

test("leaving Modern restores the Classic footer and clears listeners", () => {
    const f = fixture();
    try {
        f.api.refresh();
        assert.equal(f.progress.parentNode.className, "modern-player-track");
        f.w.settings.interfaceMode = 0;
        f.w.sInterfaceMode = 0;
        f.w.__ottInterfaceModeState.effective = 0;
        f.api.refresh();
        assert.equal(f.api.state().active, false);
        assert.equal(f.w.document.getElementById("modernPlayer"), null);
        assert.equal(f.progress.parentNode, f.progressHome);
        assert.equal(f.progress.hasAttribute("role"), false);
        assert.equal(
            f.w.document.body.classList.contains("modern-player-ready"),
            false
        );
        // A later Classic key event is no longer swallowed by the overlay.
        f.w.document.getElementById("info1").style.display = "block";
        f.w.dispatchEvent(
            new f.w.KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
        );
        assert.deepEqual(f.calls, []);
    } finally {
        f.api.destroy();
        f.dom.window.close();
    }
});
