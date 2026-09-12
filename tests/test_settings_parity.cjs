const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function selectedSource(file, functions, assignments = []) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    return ast.statements
        .filter(
            (node) =>
                (ts.isFunctionDeclaration(node) &&
                    functions.includes(node.name?.text)) ||
                (ts.isExpressionStatement(node) &&
                    ts.isBinaryExpression(node.expression) &&
                    assignments.includes(
                        node.expression.left.getText(ast).replace("window.", "")
                    ))
        )
        .map((node) => node.getText(ast))
        .join("\n");
}
function compile(source) {
    return ts
        .transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES2018,
            },
        })
        .outputText.replace(/^import .*$/gm, "")
        .replace(/^export /gm, "");
}
const menus = [
    "settingsInterface",
    "settingsLists",
    "settingsChannels",
    "settingsInfobar",
    "settingsButtons",
    "settingsMenu",
    "settingsManage",
    "parentControlSetup",
];
function fixture(profile = "server", limited = false) {
    const stored = new Map();
    const storage = {
        get: (key) => stored.get(key) ?? null,
        getI: (key, fallback) =>
            stored.has(key) ? Number.parseInt(stored.get(key), 10) : fallback,
        set: (key, value) => stored.set(key, String(value)),
        setI: (key, value) => stored.set(key, String(value)),
    };
    const elements = new Map();
    const timers = new Map();
    let nextTimer = 1;
    const calls = [];
    const w = {
        _: (text) => text,
        backColorDialog() {},
        btnDiv() {
            return "";
        },
        bufferSizes: ["auto", "1", "2"],
        clearTimeout(id) {
            timers.delete(id);
        },
        closeList() {},
        colorDialog() {},
        console,
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, { innerHTML: "" });
                return elements.get(id);
            },
        },
        getMediaArray() {},
        Hls: {
            isSupported() {
                return true;
            },
        },
        keys: {
            ENTER: 13,
            GREEN: 71,
            LEFT: 37,
            N0: 48,
            N2: 50,
            PAUSE: 81,
            PLAY: 80,
            PREV: 83,
            RETURN: 27,
            RIGHT: 39,
            RW: 82,
        },
        nofun() {},
        optIndexOf() {
            return 0;
        },
        optionsList() {
            calls.push("options");
        },
        parentAccess: true,
        playerMode: 0,
        playerModeNames: ["html5", "hls.js", "shaka"],
        popupActions: [
            function channels() {},
            function epg() {},
            function noProvParam() {},
        ],
        popupArray: ["Channels", "EPG", "Provider"],
        providerGetJson: () => [],
        providerHasItemValue(key) {
            return stored.has("provider:" + key);
        },
        providerSetItem: (key, value) => storage.set("provider:" + key, value),
        selColorDialog() {},
        selectProvaider() {},
        setAutorun() {},
        setColor() {},
        setEditor() {},
        setFontSize() {
            calls.push("font");
        },
        setListPos() {
            calls.push("position");
        },
        setPipPosBuf() {},
        setTimeout(callback, ms) {
            const id = nextTimer++;
            timers.set(id, { callback, ms });
            return id;
        },
        setTimezone() {},
        showEditKey2() {},
        showPage() {},
        showShift() {},
        stbClearAllItems() {},
        stbGetAllItems() {},
        stbGetVolume() {},
        stbIsStandby() {
            return false;
        },
        stbPlayPip() {},
        stbSetBuffer() {},
        stbSetItem: storage.set,
        stbSetOsdOpacity() {},
        stbToggleAspectRatio() {},
        stbToggleAudioTrack() {},
        stbToggleStandby() {
            calls.push("standby");
        },
        stbToggleSubtitle() {},
        storage,
        video: {
            canPlayType() {
                return "";
            },
        },
    };
    w.noProvParam = w.popupActions[2];
    if (profile === "tauri") w.__TAURI__ = {};
    if (profile.startsWith("capacitor"))
        w.Capacitor = {
            getPlatform: () => (profile.endsWith("ios") ? "ios" : "android"),
        };
    if (limited) {
        for (const key of [
            "stbPlayPip",
            "stbGetVolume",
            "stbSetOsdOpacity",
            "showEditKey2",
            "getMediaArray",
            "stbClearAllItems",
        ])
            delete w[key];
        delete w.keys.RW;
        delete w.keys.PREV;
    }
    w.window = w;
    vm.createContext(w);
    vm.runInContext(
        compile(
            selectedSource("src/channels/index.ts", ["parentControlSetup"])
        ),
        w
    );

    vm.runInContext(
        compile(
            fs.readFileSync(path.join(root, "src/settings/index.ts"), "utf8")
        ),
        w
    );
    vm.runInContext(
        compile(
            selectedSource(
                "src/index.ts",
                [
                    "setListArrays",
                    "applySettingsToWindow",
                    "pullSettingsFromWindow",
                ],
                ["_setSetup", "saveIfChanged", ...menus]
            )
        ),
        w
    );
    vm.runInContext(
        compile(
            selectedSource("src/core/index.ts", ["setPlayerMode", "setPlayer"])
        ),
        w
    );
    vm.runInContext(
        compile(
            fs.readFileSync(
                path.join(root, "src/settings/sleepTimer.ts"),
                "utf8"
            )
        ),
        w
    );
    vm.runInContext("applySettingsToWindow(settings);", w);
    // Channel flags are normally initialized from provider storage by loadChannels.
    Object.assign(w, {
        sNextCountL: 1,
        sPreview: 0,
        sShowArchive: 1,
        sShowDescr: 1,
        sShowName: 1,
        sShowNum: 1,
        sShowPikon: 1,
        sShowProgram: 1,
        sShowProgress: 1,
    });
    return {
        calls,
        stored,
        timers,
        typed: () => vm.runInContext("settings", w),
        w,
    };
}
function save(w) {
    w.listKeyHandlerFn(w.keys.GREEN);
}

for (const profile of [
    "server",
    "tauri",
    "capacitor-android",
    "capacitor-ios",
]) {
    for (const limited of [false, true]) {
        for (const menu of menus) {
            const { w, stored } = fixture(profile, limited);
            w[menu]();
            assert.ok(w.listArray.length > 2, `${profile}: ${menu} populated`);
            assert.equal(
                w.listDataArray,
                w.listArray,
                `${menu}: renderer sees current rows`
            );
            for (const row of w.listArray) {
                assert.equal(typeof w.getListItem(row, 0), "string");
                if (Array.isArray(row.values)) {
                    assert.ok(
                        Number.isInteger(row.val) &&
                            row.val >= 0 &&
                            row.val < row.values.length,
                        `${menu}: valid selection ${row.name}`
                    );
                }
            }
            w.listKeyHandlerFn(w.keys.RETURN);
            assert.equal(stored.size, 0, `${menu}: cancel does not persist`);
        }
    }
    const saveCases = [
        [
            "settingsLists",
            ["sNoSmall", "sPageSize", "sFontShift", "sListPos", "sShowScroll"],
        ],
        [
            "settingsInfobar",
            [
                "sInfoTimeout",
                "sInfoSlide",
                "sInfoSwitch",
                "sInfoChange",
                "sInfoRew",
                "sThumbnail",
            ],
        ],
        [
            "settingsChannels",
            [
                "sShowNum",
                "sShowPikon",
                "sShowName",
                "sShowProgram",
                "sShowProgress",
                "sShowArchive",
                "sShowDescr",
                "sPreview",
                "sNextCountL",
                "sFavorites",
            ],
        ],
        [
            "settingsButtons",
            [
                "sArrowFun",
                "sRewFun",
                "sPNFun",
                "sALfun",
                "sARfun",
                "sAUfun",
                "sADfun",
                "sRWfun",
                "sFFfun",
                "sPREVfun",
                "sNEXTfun",
                "sRfun",
                "sGfun",
                "sYfun",
                "sBfun",
                "sEfun",
                "sOkfun",
            ],
        ],
    ];
    for (const [menu, keys] of saveCases) {
        const current = fixture(profile).w;
        current[menu]();
        const expected = keys.map((key, index) => {
            const row = current.listArray[index];
            row.val = (row.val + 1) % row.values.length;
            return (
                row.val +
                (key === "sPageSize" ? 10 : key === "sInfoTimeout" ? 3 : 0)
            );
        });
        save(current);
        keys.forEach((key, index) =>
            assert.equal(
                current[key],
                expected[index],
                `${menu}: ${key} applies selected value`
            )
        );
    }
    const parental = fixture(profile);
    parental.w.parentControlSetup();
    parental.w.listArray[1].val = 0;
    parental.w.listArray[2].val = 1;
    parental.w.listArray[3].val = 1;
    save(parental.w);
    assert.equal(parental.stored.get("sPSchannels"), "0");
    assert.equal(parental.stored.get("sPSoptions"), "1");
    assert.equal(parental.typed().psProvs, 1);
    const { w, stored, typed, timers } = fixture(profile);
    w.settingsButtons();
    save(w);
    assert.deepEqual(
        [w.s13dur, w.s46dur, w.s79dur],
        [15, 180, 600],
        "unchanged save preserves seconds"
    );
    const durations = [
        5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 3600,
    ];
    for (let index = 0; index < durations.length; index++) {
        w.settingsButtons();
        const rows = w.listArray.filter((row) =>
            row.name.startsWith("Rewind step")
        );
        rows.forEach((row) => {
            row.val = index;
        });
        save(w);
        assert.deepEqual(
            [w.s13dur, w.s46dur, w.s79dur],
            [durations[index], durations[index], durations[index]]
        );
        assert.equal(stored.get("s13dur"), String(durations[index]));
        assert.equal(typed().seek13Duration, durations[index]);
    }
    w.settingsInterface();
    w.listArray.find((row) => row.name === "Type of player for streaming").val =
        2;
    w.listArray.find((row) => row.name === "Sleep timer").val = 1;
    save(w);
    assert.equal(w.playerMode, 2, "actual engine mode changes");
    assert.equal(stored.get("provider:sPlayers"), "2");
    assert.equal(
        [...timers.values()][0].ms,
        1800000,
        "save immediately rearms 30-minute timer"
    );
    w.settingsMenu();
    w.listArray[0].val = 1;
    save(w);
    assert.deepEqual(Array.from(typed().hideMenus), ["channels"]);
    vm.runInContext("applySettingsToWindow(loadSettings());", w);
    assert.deepEqual(
        Array.from(w.sHideMenus),
        ["channels"],
        "hidden menu survives restart"
    );
    // Editing a parental/remote value followed by export or another bulk save must not overwrite it.
    Object.assign(w, {
        parentPIN: "9876",
        sLocalCmdUrl: "https://example.invalid/local",
        sNoColorKeys: 1,
        sPSoptions: 1,
        sRfun: 4,
    });
    const exported = JSON.parse(w.exportSettings());
    assert.equal(exported.settings.rFun, 4);
    assert.equal(exported.settings.noColorKeys, 1);
    assert.equal(exported.settings.psOptions, 1);
    assert.equal(exported.settings.parentPin, "9876");
    assert.equal(
        exported.settings.localCmdUrl,
        "https://example.invalid/local"
    );
    vm.runInContext("saveSettings(settings); loadSettings();", w);
    assert.equal(typed().rFun, 4);
    assert.equal(typed().parentPin, "9876");
}
for (const bad of [-1, 1, 2, 7, 999, Number.NaN]) {
    const { w, stored } = fixture();
    for (const key of ["s13dur", "s46dur", "s79dur"])
        stored.set(key, String(bad));
    vm.runInContext("applySettingsToWindow(loadSettings());", w);
    assert.deepEqual([w.s13dur, w.s46dur, w.s79dur], [15, 180, 600]);
    // The menu also protects against invalid values introduced by an old adapter.
    Object.assign(w, { s13dur: bad, s46dur: bad, s79dur: bad });
    w.settingsButtons();
    save(w);
    assert.deepEqual([w.s13dur, w.s46dur, w.s79dur], [15, 180, 600]);
}
const { w, timers, calls } = fixture();
for (const [index, minutes] of [0, 30, 60, 120, 180].entries()) {
    vm.runInContext(`settings.sleepTimeout = ${index}; setSleepTimeout();`, w);
    assert.equal(timers.size, minutes ? 1 : 0);
    if (minutes) assert.equal([...timers.values()][0].ms, minutes * 60000);
}
[...timers.values()][0].callback();
assert.equal(calls.filter((call) => call === "standby").length, 1);
vm.runInContext("settings.sleepTimeout = 0; setSleepTimeout();", w);
assert.equal(timers.size, 0, "disable cancels pending timer");
const limited = fixture("server", true).w;
limited.settingsManage();
assert.ok(limited.listArray.some((row) => row.name === "Export settings"));
assert.ok(!limited.listArray.some((row) => row.name === "Clear settings"));
console.log(
    "OK: Settings submenu population, save/cancel, duration/engine application and persistence across four platform profiles"
);

// Execute actual shared standby functions and both native wrapper bodies. Only
// native APIs/DOM/playback are mocked; the production state and timer logic run.
const indexText = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");
const indexAst = ts.createSourceFile(
    "index.ts",
    indexText,
    ts.ScriptTarget.Latest,
    true
);
const standbyWrappers = [];
function collectStandby(node) {
    if (
        ts.isBinaryExpression(node) &&
        node.left.getText(indexAst) === "window.stbToggleStandby" &&
        ts.isFunctionExpression(node.right)
    ) {
        standbyWrappers.push(node.getText(indexAst));
    }
    ts.forEachChild(node, collectStandby);
}
collectStandby(indexAst);
assert.equal(standbyWrappers.length, 2);
for (const profile of [
    "server",
    "tauri",
    "capacitor-android",
    "capacitor-ios",
]) {
    const { w, timers, calls } = fixture(profile);
    w.document.body = { style: {} };
    w.stbStop = () => calls.push("stop");
    w.startPlayer = () => calls.push("start");
    vm.runInContext("var _standby = false;", w);
    vm.runInContext(
        compile(
            selectedSource("src/core/index.ts", [
                "stbIsStandby",
                "stbToggleStandby",
            ])
        ),
        w
    );
    const original = w.stbToggleStandby;
    w.orig = original;
    w.origStandby = original;
    w.tauriInvoke = (command) => {
        calls.push(command);
        return Promise.resolve({ ok: true });
    };
    w.cap = {
        allowSleep: () => {
            calls.push("allow_sleep");
            return Promise.resolve();
        },
        preventSleep: () => {
            calls.push("prevent_sleep");
            return Promise.resolve();
        },
    };
    if (profile !== "server")
        vm.runInContext(
            compile(standbyWrappers[profile === "tauri" ? 0 : 1]),
            w
        );
    // A device override must still be used by the inactivity callback.
    const platformToggle = w.stbToggleStandby;
    let dispatches = 0;
    w.stbToggleStandby = () => {
        dispatches++;
        platformToggle();
    };
    vm.runInContext("settings.sleepTimeout = 1; setSleepTimeout();", w);
    const oldCallback = [...timers.values()][0].callback;
    w.stbToggleStandby();
    assert.equal(w.stbIsStandby(), true);
    assert.equal(timers.size, 0, "manual standby cancels inactivity timer");
    oldCallback();
    assert.equal(
        w.stbIsStandby(),
        true,
        "queued timeout cannot wake manual standby"
    );
    assert.equal(calls.filter((call) => call === "start").length, 0);
    w.stbToggleStandby();
    assert.equal(w.stbIsStandby(), false);
    assert.equal(timers.size, 1, "waking rearms inactivity timer");
    [...timers.values()][0].callback();
    assert.equal(w.stbIsStandby(), true);
    assert.equal(dispatches, 3, "timeout honors the current platform override");
    if (profile !== "server")
        assert.deepEqual(
            calls.filter((call) => call.endsWith("_sleep")),
            ["allow_sleep", "prevent_sleep", "allow_sleep"]
        );
}
console.log(
    "OK: inactivity never wakes manual standby; native wake locks follow actual shared state"
);
