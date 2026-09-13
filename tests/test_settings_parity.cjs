const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function selectedSource(file, functions, assignments = [], variables = []) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    return ast.statements
        .filter(
            (node) =>
                (ts.isFunctionDeclaration(node) &&
                    functions.includes(node.name?.text)) ||
                (ts.isVariableStatement(node) &&
                    node.declarationList.declarations.some((item) =>
                        variables.includes(item.name.getText(ast))
                    )) ||
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
    "stbOptions",
    "settingsInterface",
    "settingsLists",
    "settingsChannels",
    "settingsInfobar",
    "settingsButtons",
    "settingsMenu",
    "settingsManage",
    "parentControlSetup",
];
function fixture(
    profile = "server",
    limited = false,
    distribution = "full",
    device
) {
    const stored = new Map();
    const storage = {
        get: (key) => stored.get(key) ?? null,
        getI(key, fallback) {
            const value = Number.parseInt(stored.get(key), 10);
            return Number.isNaN(value) ? fallback : value;
        },
        set: (key, value) => stored.set(key, String(value)),
        setI: (key, value) => stored.set(key, String(value)),
    };
    const elements = new Map();
    const timers = new Map();
    let nextTimer = 1;
    const calls = [];
    const w = {
        _: (text) => text,
        $() {
            return {
                append() {
                    return this;
                },
                is: () => true,
            };
        },
        backColorDialog() {},
        beginPortChannelIdMigration() {},
        btnDiv() {
            return "";
        },
        bufferSizes: ["auto", "1", "2"],
        channels: {},
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
        finishPortChannelIdMigration() {},
        getChanelsArray: (done) => done(),
        getMediaArray() {},
        Hls: {
            isSupported() {
                return true;
            },
        },
        invalidateEpgCache() {},
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
        launch_id: "#launch",
        nofun() {},
        onChanelsLoaded() {},
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
        providerGetItem: (key) => storage.get("provider:" + key),
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
    if (device !== undefined) w.ott_device = device;
    if (profile === "tauri") w.__TAURI__ = {};
    if (profile === "tauri-internals") w.__TAURI_INTERNALS__ = {};
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
    const policy = compile(
        selectedSource(
            "src/provider/index.ts",
            ["isPlayDistribution"],
            [],
            ["providerDistribution"]
        )
    );
    const distributionMarker = 'var providerDistribution = "full";';
    assert.equal(
        policy.split(distributionMarker).length,
        2,
        "actual provider profile declaration"
    );
    assert(["full", "play"].includes(distribution));
    vm.runInContext(
        policy.replace(
            distributionMarker,
            'var providerDistribution = "' + distribution + '";'
        ),
        w
    );
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
            selectedSource(
                "src/core/index.ts",
                [
                    "cancelCoreAutoPlayback",
                    "getDefaultPlayerMode",
                    "isOttplayTestWebView",
                    "normalizePlayerMode",
                    "setPlayerMode",
                    "setPlayer",
                ],
                [],
                ["_coreAutoCancel", "_corePipAutoCancel", "playerModeNames"]
            )
        ),
        w
    );
    vm.runInContext(
        compile(
            selectedSource("src/storage/index.ts", ["providerGetNum"]) +
                "\n" +
                selectedSource("src/provider/index.ts", ["loadChannels"])
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
    vm.runInContext(
        "window.settings = settings; applySettingsToWindow(settings);",
        w
    );
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

// LG Left opens Menu by default even when the shared HTML5 core exposes volume
// APIs. This is a platform default only: existing explicit mappings stay intact.
const leftDefaultFailures = [];
for (const device of [
    "lg/webos",
    "lg/netcast",
    "pc",
    "pc2",
    "nodejs",
    "android",
    "mag",
    "samsung/tizen",
    "samsung/maple",
    undefined,
]) {
    for (const limited of [false, true]) {
        const { w, stored, typed } = fixture("server", limited, "full", device);
        const expected = device?.startsWith("lg/") ? 1 : 14;
        try {
            assert.equal(typed().alFun, expected, "Initial default");
            assert.equal(
                w.defaultSettings().alFun,
                expected,
                "Factory reset default"
            );
            assert.equal(
                w.defaultSettings().arFun,
                13,
                "Right stays unchanged"
            );
            vm.runInContext("applySettingsToWindow(loadSettings());", w);
            assert.equal(typed().alFun, expected, "Absent stored Left mapping");
            assert.equal(w.sALfun, expected, "Legacy global matches settings");
            assert.equal(
                stored.has("sALfun"),
                false,
                "Reading defaults does not persist them"
            );

            for (const invalid of ["", "NaN", "invalid"]) {
                stored.set("sALfun", invalid);
                vm.runInContext("applySettingsToWindow(loadSettings());", w);
                assert.equal(
                    typed().alFun,
                    expected,
                    "Invalid stored mapping: " + invalid
                );
                assert.equal(
                    stored.get("sALfun"),
                    invalid,
                    "Loading does not rewrite stored preferences"
                );
            }
            for (const explicit of [0, 1, 4, 14, 19]) {
                stored.set("sALfun", String(explicit));
                vm.runInContext("applySettingsToWindow(loadSettings());", w);
                assert.equal(
                    typed().alFun,
                    explicit,
                    "Keep explicit action " + explicit
                );
                assert.equal(w.sALfun, explicit);
                assert.equal(
                    w.defaultSettings().alFun,
                    expected,
                    "Factory defaults ignore current preferences"
                );
                vm.runInContext("saveSettings(settings); loadSettings();", w);
                assert.equal(
                    typed().alFun,
                    explicit,
                    "Explicit action survives a save/reload"
                );
                assert.equal(stored.get("sALfun"), String(explicit));
            }
            stored.clear();
            vm.runInContext("applySettingsToWindow(loadSettings());", w);
            assert.equal(
                typed().alFun,
                expected,
                "Cleared settings restore platform default"
            );
        } catch (error) {
            leftDefaultFailures.push(
                String(device) +
                    " / volume API " +
                    !limited +
                    ": " +
                    error.message
            );
        }
    }
}
for (const device of ["lg/webos", "lg/netcast"]) {
    const { w, typed } = fixture();
    assert.equal(
        typed().alFun,
        14,
        "Settings can initialize before device is known"
    );
    w.ott_device = device;
    try {
        vm.runInContext("applySettingsToWindow(loadSettings());", w);
        assert.equal(
            typed().alFun,
            1,
            "Device detection before settings load updates the fallback"
        );
        assert.equal(
            w.defaultSettings().alFun,
            1,
            "Factory defaults read current device"
        );
    } catch (error) {
        leftDefaultFailures.push(
            device + " / late device detection: " + error.message
        );
    }
}
assert.equal(leftDefaultFailures.length, 0, leftDefaultFailures.join("\n"));
const noWindowSettings = vm.createContext({});
vm.runInContext(
    compile(fs.readFileSync(path.join(root, "src/settings/index.ts"), "utf8")),
    noWindowSettings
);
assert.equal(
    noWindowSettings.defaultSettings().alFun,
    14,
    "Settings remain usable without a browser window"
);
console.log(
    "OK: LG Left defaults to Menu, other platforms retain volume and explicit mappings survive save/reset"
);

// webOS hides engine details in both menus and ignores an old manual preference
// at runtime, while preserving it in storage for another platform.
for (const device of ["lg/webos", "lg/netcast", "pc"]) {
    for (const limited of [false, true]) {
        for (const preference of [null, 0, 1, 2, 3]) {
            const { w, stored, typed } = fixture(
                "server",
                limited,
                "full",
                device
            );
            if (preference !== null)
                stored.set("provider:sPlayers", String(preference));
            w.loadChannels();
            if (device === "lg/webos") {
                assert.equal(w.playerMode, 3, "webOS runtime always uses Auto");
                assert.equal(w.sPlayers, 3);
                assert.equal(typed().players, 3);
            }
            for (const menu of ["stbOptions", "settingsInterface"]) {
                w[menu]();
                assert.equal(
                    w.listArray.some(
                        (row) => row.name === "Type of player for streaming"
                    ),
                    device !== "lg/webos",
                    device + " " + menu + ": player choice visibility"
                );
                assert.equal(w.listArray, w.listDataArray);
                const buffer = w.listArray.find(
                    (row) => row.name === "Buffer Size, s"
                );
                const nextBuffer = (w.sBufSize + 1) % buffer.values.length;
                buffer.val = nextBuffer;
                const editor = w.listArray.find((row) => row.name === "Editor");
                if (editor) editor.val = 1;
                save(w);
                assert.equal(
                    w.sBufSize,
                    nextBuffer,
                    "Buffer row remains aligned after removing the engine row"
                );
                assert.equal(stored.get("sBufSize"), String(nextBuffer));
                if (editor)
                    assert.equal(
                        w.sEditor,
                        1,
                        "Previous row still saves correctly"
                    );
                if (device === "lg/webos") {
                    assert.equal(w.playerMode, 3);
                    assert.equal(
                        stored.get("provider:sPlayers"),
                        preference === null ? undefined : String(preference),
                        "Hidden choice must not overwrite a saved preference"
                    );
                }
            }
        }
    }
}
console.log(
    "OK: webOS engine selector hidden in both menus; Auto and neighbouring saves preserved; PC/NetCast choices retained"
);

// Defaults apply per provider. Manual choices retain their original numeric
// values, and both settings entry points can persist Auto without a restart.
for (const profile of [
    "server",
    "tauri",
    "tauri-internals",
    "capacitor-android",
    "capacitor-ios",
]) {
    const { w, stored, typed } = fixture(profile);
    const isTauri = profile.startsWith("tauri");
    const choices = ["html5", "hls.js", "shaka"];
    if (isTauri) choices.push("auto");
    w.loadChannels();
    assert.equal(w.sPlayers, isTauri ? 3 : 0, profile + ": provider default");
    assert.equal(
        w.playerMode,
        isTauri ? 3 : 1,
        "Auto remains selected while legacy platforms keep their HLS fallback"
    );
    assert.equal(typed().players, w.sPlayers, "typed preference stays in sync");
    assert.equal(
        stored.has("provider:sPlayers"),
        false,
        "default is not persisted"
    );
    for (const menu of ["stbOptions", "settingsInterface"]) {
        w[menu]();
        let row = w.listArray.find(
            (item) => item.name === "Type of player for streaming"
        );
        assert.deepEqual(
            Array.from(row.values),
            choices,
            profile + ": choices"
        );
        assert.equal(
            row.val,
            w.sPlayers,
            "menu shows loaded provider preference"
        );
        row.val = 2;
        save(w);
        assert.equal(typed().players, 2, menu + ": typed choice follows save");
        if (isTauri) {
            w[menu]();
            row = w.listArray.find(
                (item) => item.name === "Type of player for streaming"
            );
            row.val = 3;
            save(w);
            assert.equal(
                w.playerMode,
                3,
                menu + ": Auto is selected immediately"
            );
            assert.equal(stored.get("provider:sPlayers"), "3");
            assert.equal(typed().players, 3);
            w.loadChannels();
            assert.equal(w.sPlayers, 3, "Auto survives provider reload");
        }
    }
    for (const explicit of [0, 1, 2]) {
        stored.set("provider:sPlayers", String(explicit));
        w.loadChannels();
        assert.equal(w.sPlayers, explicit, profile + ": stored preference");
        assert.equal(w.playerMode, explicit, "stored engine remains explicit");
        assert.equal(typed().players, explicit);
    }
    if (!isTauri) {
        stored.set("provider:sPlayers", "3");
        w.loadChannels();
        assert.equal(
            w.sPlayers,
            1,
            "imported Auto uses HLS when native HLS is unavailable"
        );
        assert.equal(w.playerMode, 1);
        assert.equal(typed().players, 1);
        assert.equal(
            stored.get("provider:sPlayers"),
            "3",
            "import remains intact"
        );
    }
    stored.delete("provider:sPlayers");
    w.loadChannels();
    assert.equal(
        w.sPlayers,
        isTauri ? 3 : 0,
        "next provider gets its own default"
    );
}

// A Tauri export can be imported into browsers with or without native HLS.
// These media fixtures deliberately omit track APIs, as Firefox does.
for (const nativeHls of [false, true]) {
    for (const supportedHls of [false, true]) {
        const { w, stored, typed } = fixture("server");
        w.video.canPlayType = () => (nativeHls ? "probably" : "");
        w.Hls.isSupported = () => supportedHls;
        stored.set("provider:sPlayers", "3");
        w.loadChannels();
        const expected = !nativeHls && supportedHls ? 1 : 0;
        assert.equal(
            w.sPlayers,
            expected,
            "Imported Auto uses a supported mode"
        );
        assert.equal(w.playerMode, expected, "Effective engine matches menu");
        assert.equal(typed().players, expected, "Typed engine matches menu");
        assert.equal(stored.get("provider:sPlayers"), "3");
        w.setPlayerMode(3);
        assert.equal(
            w.playerMode,
            expected,
            "Direct mode selection is consistent"
        );
        for (const explicit of [0, 1, 2]) {
            stored.set("provider:sPlayers", String(explicit));
            w.loadChannels();
            assert.equal(
                w.playerMode,
                explicit,
                "Explicit modes stay unchanged"
            );
            assert.equal(w.sPlayers, explicit);
            assert.equal(typed().players, explicit);
        }
    }
}

// Full and Play use the same production renderer and real distribution helper.
// Every action is present, matching the actual window aliases, so undefined
// fixture functions cannot accidentally make the Play filter hide extra rows.
for (const distribution of ["full", "play"]) {
    const { w, stored, calls } = fixture(
        "capacitor-android",
        false,
        distribution
    );
    for (const action of [
        "cloudSendSettings",
        "cloudLoadSettings",
        "exportSettingsUI",
        "importSettingsUI",
        "edit_dealer",
        "edit_dealer_remote",
        "loadOpt",
        "saveOpt",
    ])
        w[action] = () => calls.push(action);
    let confirmClear;
    w.confirmBox = (_message, yes) => {
        confirmClear = yes;
    };
    w.stbClearAllItems = () => {
        calls.push("clear");
        stored.clear();
    };
    w.restart = () => calls.push("restart");
    stored.set("saved-provider-setting", "preserved");
    w.settingsManage();
    const fullRows = [
        "Save settings to storage",
        "Load settings from storage",
        "Save settings",
        "Load settings",
        "",
        "Export settings",
        "Import settings",
        "",
        "Clear settings",
        "",
        "Enter Provider Code",
        "Enter Provider Code on PC or Phone",
        "Debug HUD",
    ];
    const playRows = [
        "Save settings to storage",
        "Save settings",
        "",
        "Export settings",
        "",
        "Clear settings",
        "",
        "Debug HUD",
    ];
    assert.deepEqual(
        Array.from(w.listArray, (item) => item.name),
        distribution === "play" ? playRows : fullRows,
        distribution + " exact management menu"
    );
    assert.equal(
        w.listDataArray,
        w.listArray,
        distribution + " renders its final filtered rows"
    );
    if (distribution === "play") {
        for (const action of [
            w.edit_dealer,
            w.edit_dealer_remote,
            w.cloudLoadSettings,
            w.importSettingsUI,
            w.loadOpt,
        ])
            assert(
                !w.listArray.some((item) => item.action === action),
                "Play cannot invoke activation/import through any management row"
            );
    }
    function choose(label) {
        w.selIndex = w.listArray.findIndex((item) => item.name === label);
        assert(w.selIndex >= 0, label + " remains available");
        assert.equal(w.listKeyHandlerFn(w.keys.ENTER), true);
    }
    choose("Export settings");
    choose("Save settings to storage");
    assert.deepEqual(calls, ["exportSettingsUI", "saveOpt"]);
    assert.equal(stored.get("saved-provider-setting"), "preserved");
    choose("Clear settings");
    assert.equal(
        typeof confirmClear,
        "function",
        "clear still requires confirmation"
    );
    assert.equal(stored.size, 1, "opening confirmation cannot clear settings");
    confirmClear();
    assert.deepEqual(calls.slice(-2), ["clear", "restart"]);
    assert.equal(stored.size, 0);
    w.listKeyHandlerFn(w.keys.RETURN);
    assert.equal(calls[calls.length - 1], "options");
}
console.log(
    "OK: Android Full management unchanged; Play hides activation and every load/import route while export, save and confirmed clear remain"
);

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
    assert.equal(
        typed().localHttpEnabled,
        0,
        `${profile}: HTTP remote is opt-in`
    );
    assert.equal(typed().localHttpDeviceCode, "");
    assert.equal(w.sLocalHttpEnabled, 0);
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
        sLocalHttpDeviceCode: "a".repeat(64),
        sLocalHttpEnabled: 1,
        sNoColorKeys: 1,
        sPSoptions: 1,
        sRfun: 4,
    });
    const exported = JSON.parse(w.exportSettings());
    assert.equal(exported.settings.rFun, 4);
    assert.equal(
        Object.hasOwn(exported.settings, "localHttpEnabled"),
        false,
        "exports cannot grant HTTP access on another device"
    );
    assert.equal(
        Object.hasOwn(exported.settings, "localHttpDeviceCode"),
        false,
        "exports cannot disclose the local credential"
    );
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
    assert.equal(
        typed().localHttpEnabled,
        1,
        "explicit local consent survives restart"
    );
    assert.equal(typed().localHttpDeviceCode, "a".repeat(64));
    w.importSettings(
        JSON.stringify({
            ...exported,
            settings: {
                ...exported.settings,
                localHttpDeviceCode: "injected",
                localHttpEnabled: 1,
            },
        })
    );
    assert.equal(
        typed().localHttpDeviceCode,
        "a".repeat(64),
        "import cannot replace this device's credential"
    );
    stored.set("sLocalHttpEnabled", "0");
    stored.set("sLocalHttpDeviceCode", "");
    vm.runInContext("applySettingsToWindow(loadSettings());", w);
    w.importSettings(
        JSON.stringify({
            ...exported,
            settings: {
                ...exported.settings,
                localHttpDeviceCode: "injected",
                localHttpEnabled: 1,
            },
        })
    );
    assert.equal(
        typed().localHttpEnabled,
        0,
        "import cannot enable HTTP access"
    );
    assert.equal(typed().localHttpDeviceCode, "");
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
