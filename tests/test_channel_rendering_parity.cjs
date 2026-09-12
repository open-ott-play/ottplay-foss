process.on("uncaughtException", (error) => {
    console.error(
        error.stack
            .split("\n")
            .filter((line) => line.length < 500)
            .join("\n")
    );
    process.exitCode = 1;
});
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const bundles = {
    capacitor: "dist/dist/stbPlayer.js",
    server: "dist/stbPlayer.js",
    tauri: "src-tauri/frontend/dist/stbPlayer.js",
};
const styles = {
    capacitor: "dist/stbPlayer/1280.css",
    server: "stbPlayer/1280.css",
    tauri: "src-tauri/frontend/stbPlayer/1280.css",
};
for (const profile of ["tauri", "capacitor"]) {
    assert.equal(
        read(bundles[profile]),
        read(bundles.server),
        profile + ": staged player matches server"
    );
    assert.equal(
        read(styles[profile]),
        read(styles.server),
        profile + ": staged stylesheet matches server"
    );
}

// Exercise the shipped classic script with real DOM/CSS and bundled jQuery.
// Network, media, and asynchronous boot are deliberately not started.
for (const profile of ["server", "tauri", "capacitor"]) {
    const dom = new JSDOM(
        "<!doctype html><html><head></head><body>" +
            [
                "list",
                "listIn",
                "listCaption",
                "listPodval",
                "listDetail",
                "listPopUp",
                "info1",
                "numprog",
                "testFont",
                "list_osd",
                "list_window",
            ]
                .map((id) => '<div id="' + id + '"></div>')
                .join("") +
            "</body></html>",
        { runScripts: "outside-only", url: "https://player.example/" }
    );
    const w = dom.window;
    w.setTimeout = w.setInterval = w.requestAnimationFrame = () => 1;
    w.confirm = () => false;
    w.console = { debug() {}, error() {}, info() {}, log() {}, warn() {} };
    const nativeSleep = [];
    const media = {
        allowSleep: async () => {
            nativeSleep.push("allow");
            return { ok: true };
        },
        getVolume: async () => ({ ok: true, volume: 37 }),
        preventSleep: async () => {
            nativeSleep.push("prevent");
            return { ok: true };
        },
        stopBackgroundAudio: async () => ({ ok: true }),
    };
    if (profile === "capacitor")
        w.Capacitor = { Plugins: { MobileNativeMedia: media } };
    if (profile === "tauri")
        w.__TAURI__ = {
            core: {
                invoke: async (command) => {
                    if (command === "allow_sleep") nativeSleep.push("allow");
                    if (command === "prevent_sleep")
                        nativeSleep.push("prevent");
                    return { ok: true };
                },
            },
        };
    w.eval(read("js/jquery-1.11.1.min.js"));
    vm.runInContext(read(bundles[profile]), dom.getInternalVMContext(), {
        timeout: 10000,
    });
    const style = w.document.createElement("style");
    style.textContent = read(styles[profile]);
    w.document.head.appendChild(style);
    w.uiInit();
    vm.runInContext(
        `
        listDetail = document.getElementById('listDetail'); listPodval = document.getElementById('listPodval');
        catsArray = ['Test']; cats = { Test: ['one', 'two'] };
        channels = { one: {channel_name: 'News', name: 'Current bulletin', rec: 1,
            time: Date.now()/1000 - 60, time_to: Date.now()/1000 + 60},
            two: {channel_name: 'Films', name: 'Current film', rec: 0,
            time: Date.now()/1000 - 60, time_to: Date.now()/1000 + 60} };
        window.channels = window.chanels = channels;
        getCurProgData = function() { return true; };
        getChannelPicon = function() { return 'https://images.example/logo.png'; };
        settings.pageSize = 25; settings.noSmall = 1;
        sShowNum = sShowName = sShowPikon = sShowProgress = sShowProgram = sShowArchive = 1;
        sPSchannels = 1; parentPIN = ''; parentalArray = ['two'];
        sSHLcolor = '120,100'; sSHLcolSel = '240,100'; sSHLcolorB = '255,0';
        window.sSHLcolor = sSHLcolor; window.sSHLcolSel = sSHLcolSel;
        window.sSHLcolorB = sSHLcolorB;
        setColor(); _channelsList(0, 0);
    `,
        dom.getInternalVMContext(),
        { timeout: 10000 }
    );
    const row = w.document.getElementById("it0");
    assert.ok(row, profile + ": provider populated visible channel row");
    assert.match(row.textContent, /News.*Current bulletin/);
    assert.equal(
        w.document.getElementById("pnone").style.color,
        "rgb(0, 255, 0)"
    );
    assert.equal(
        w.document.getElementById("prone").style.backgroundColor,
        "rgb(0, 255, 0)"
    );
    assert.equal(row.style.backgroundColor, "rgb(0, 0, 128)");
    assert.ok(row.querySelector(".img"));
    assert.ok(row.querySelector('[style*="background-color:lime"]'));
    assert.equal(
        w.document.getElementById("it1").firstElementChild.style.color,
        "rgb(170, 0, 0)"
    );
    if (profile === "capacitor") assert.equal(w.MobileNativeMedia, media);
    w.eval("window.sSHLcolor = '0,100'; setColor(); _channelsList(0, 1);");
    assert.equal(
        w.document.getElementById("pntwo").style.color,
        "rgb(255, 0, 0)"
    );
    assert.equal(w.document.getElementById("it0").style.backgroundColor, "");
    assert.equal(
        w.document.getElementById("it1").style.backgroundColor,
        "rgb(0, 0, 128)"
    );
    w.eval(
        "window.sShowName = window.sShowPikon = window.sShowProgram = window.sShowProgress = window.sShowArchive = 0; _channelsList(0, 0);"
    );
    assert.equal(w.document.querySelector("#listIn .img"), null);
    assert.equal(
        w.document.querySelector('#listIn [style*="background-color\:lime"]'),
        null
    );
    assert.equal(w.document.querySelector("#listIn .progress_div"), null);
    assert.equal(w.document.getElementById("pnone"), null);
    assert.doesNotMatch(
        w.document.getElementById("it0").textContent,
        /News|Current bulletin/
    );
    // Exercise new Settings functions through the linked, emitted global ABI.
    w.optionsList = () => {};
    w.showShift = () => {};
    w.settingsButtons();
    const seekRows = w.listArray.filter((item) =>
        /Rewind step/.test(item.name)
    );
    assert.equal(seekRows.length, 3);
    for (const item of seekRows) item.val = 3; // Actual menu index -> 20 seconds.
    w.listArray[w.listArray.length - 1].values();
    assert.equal(w.s13dur, 20);
    assert.equal(w.s46dur, 20);
    assert.equal(w.s79dur, 20);
    const exported = JSON.parse(w.exportSettings());
    assert.equal(exported.settings.seek13Duration, 20);
    assert.equal(exported.settings.seek46Duration, 20);
    assert.equal(exported.settings.seek79Duration, 20);
    w.setPlayerMode(2);
    assert.equal(w.playerMode, 2);

    // Real native wrapper bodies must use the shared standby state. A timeout
    // captured before POWER may run after cancellation but must never wake it.
    const playback = w.document.createElement("video");
    playback.id = "video";
    playback.src = "https://media.example/channel.m3u8";
    let pauses = 0;
    // jsdom has the real element/attribute API but no media decoder.
    playback.pause = () => {
        pauses++;
    };
    w.document.body.appendChild(playback);
    w.video = playback;
    const timers = new Map();
    let timerId = 0;
    let starts = 0;
    w.setTimeout = (callback, ms) => {
        timers.set(++timerId, { callback, ms });
        return timerId;
    };
    w.clearTimeout = (id) => timers.delete(id);
    w.startPlayer = () => {
        starts++;
    };
    w.eval("settings.sleepTimeout = 1; setSleepTimeout();");
    const pending = [...timers.values()].find(
        (timer) => timer.ms === 30 * 60 * 1000
    );
    assert.ok(pending);
    w.stbToggleStandby();
    assert.equal(w.stbIsStandby(), true);
    pending.callback();
    assert.equal(w.stbIsStandby(), true);
    assert.equal(starts, 0);
    assert.equal(pauses, 1);
    assert.equal(playback.hasAttribute("src"), false);
    assert.equal(timers.size, 0);
    w.stbToggleStandby();
    assert.equal(w.stbIsStandby(), false);
    assert.equal(starts, 1);
    const rearmed = [...timers.values()].find(
        (timer) => timer.ms === 30 * 60 * 1000
    );
    assert.ok(rearmed);
    rearmed.callback();
    assert.equal(w.stbIsStandby(), true);
    assert.equal(starts, 1);
    assert.deepEqual(
        nativeSleep,
        profile === "server" ? [] : ["allow", "prevent", "allow"]
    );
    dom.window.close();
    console.log(
        "OK: " +
            profile +
            " classic channel renderer theme, selection and content settings"
    );
}
