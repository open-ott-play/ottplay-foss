import {
    readLegacySettingsFields,
    writeLegacySettingsFields,
} from "../compatibility/legacy-names";
/**
 * Player preferences and their persistent compatibility keys.
 *
 * Loaded from persistent storage on startup (see `loadSettings`) and
 * persisted on change (see `saveSettings`). The `PlayerSettings` interface
 * defines every tunable parameter exposed to the user via the settings UI.
 */
import { storage } from "../storage/index";
import {
    createSettingsStore,
    type SettingDefinition,
    type SettingsDraft,
} from "./store";

// The polyfill preserves this getter so "system" also restores native DST rules.
const systemTimezoneOffset =
    (Date as any).nativeGetTimezoneOffset || Date.prototype.getTimezoneOffset;

/** Apply the legacy timezone menu index; zero restores the system timezone. */
export function applyTimezoneSetting(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index > 25) index = 0;
    var hours = index <= 13 ? index - 1 : 13 - index;
    var offset =
        index === 0 ? systemTimezoneOffset.call(new Date()) : -60 * hours;
    if (typeof (Date as any).setTimezoneOffset === "function") {
        (Date as any).setTimezoneOffset(offset);
    }
    return index;
}

/**
 * All player configuration parameters.
 *
 * Each property corresponds to a stored key (prefixed with `s` or stored
 * verbatim) that is read from / written to the `storage` adapter.
 *
 * @property noSmall           - Disable small screen optimisation (0/1).
 * @property stopPlay          - Stop playback on certain events (0/1).
 * @property pipSize           - Picture-in-picture size mode.
 * @property pipPosition       - Picture-in-picture screen position.
 * @property pageSize          - Number of items per page in channel list.
 * @property fontShift         - Font size adjustment shift.
 * @property fontSize          - Base font size index.
 * @property arrowFun          - Remote arrow key function mapping.
 * @property rewFun            - Rewind button function mapping.
 * @property pnFun             - P+/P- button function mapping.
 * @property rFun              - Red (R) colour key function mapping.
 * @property gFun              - Green (G) colour key function mapping.
 * @property yFun              - Yellow (Y) colour key function mapping.
 * @property bFun              - Blue (B) colour key function mapping.
 * @property alFun             - Left arrow function mapping.
 * @property arFun             - Right arrow function mapping.
 * @property auFun             - Up arrow function mapping.
 * @property adFun             - Down arrow function mapping.
 * @property rwFun             - Rewind key function mapping.
 * @property ffFun             - Fast-forward key function mapping.
 * @property prevFun           - Previous channel / track function mapping.
 * @property nextFun           - Next channel / track function mapping.
 * @property eFun              - Exit / back function mapping.
 * @property okFun             - OK / select function mapping.
 * @property seek13Duration    - Short skip duration (seconds).
 * @property seek46Duration    - Medium skip duration (seconds).
 * @property seek79Duration    - Long skip duration (seconds).
 * @property noColorKeys       - Disable colour-key shortcuts (0/1).
 * @property noNumbersKeys     - Disable numeric key shortcuts (0/1).
 * @property timezone          - UTC offset override (applied via polyfill).
 * @property sleepTimeout      - Inactivity sleep timer menu index (off, 30m, 1h, 2h, 3h).
 * @property epgRemindMinutes  - Minutes before an EPG timer to show a reminder OSD (0 = off).
 * @property volumeStep        - Volume increment per key press (%).
 * @property infoTimeout       - Info OSD auto-hide timeout (seconds).
 * @property infoSlide         - Info OSD slide animation enabled (0/1).
 * @property infoSwitch        - Info OSD channel-switch enabled (0/1).
 * @property infoChange        - Info OSD on programme change (0/1).
 * @property infoRew           - Info OSD during rewind/ff (0/1).
 * @property thumbnail         - Show channel thumbnail/preview (0/1).
 * @property osdOpacity        - OSD background opacity level.
 * @property listPosition      - Remember list scroll position (0/1).
 * @property editor            - Enable channel editor (0/1).
 * @property showNumber        - Show channel number in list (0/1).
 * @property channelLogoMode   - Channel logo layout: hidden, square, or portrait (0/1/2).
 * @property showName          - Show channel name (0/1).
 * @property showProgress      - Show progress bar (0/1).
 * @property showArchive       - Show archive indicator (0/1).
 * @property showScroll        - Show scrollbar (0/1).
 * @property showDescription   - Show programme description (0/1).
 * @property showProgram       - Show programme title (0/1).
 * @property preview           - Preview window mode (0/1/2).
 * @property nextCount         - Number of next programmes to show.
 * @property nextCountList     - Number of next programmes in list view.
 * @property favorites         - Enable favourites filtering (0/1).
 * @property permanentTime     - Always show time in OSD (0/1).
 * @property resumeWithTenSecondRewind - Rewind ten seconds when resuming (0/1).
 * @property prevCount         - Number of previous programmes shown.
 * @property medCount          - Media item count threshold.
 * @property psChannels        - Provider-switch channel mapping (0/1).
 * @property psOptions         - Provider-switch options (0/1).
 * @property requirePinForProviderSelection - Require a PIN to select a provider (0/1).
 * @property hdmiSupport       - Enable HDMI-CEC support (0/1).
 * @property autorun           - Auto-start on boot (0/1).
 * @property players           - Player type selection.
 * @property bufSize           - Buffer size in KB.
 * @property useGraphicalIndicators - Use graphical icons for yes/no/off (0/1).
 * @property parentPin         - Parental control PIN code.
 * @property hideMenus         - List of menu IDs to hide.
 * @property highlightColorSel - Selected item highlight colour (HSL H,S).
 * @property highlightColor    - Default highlight colour (HSL H,S).
 * @property highlightColorB   - Background highlight colour (HSL H,S).
 */
export interface PlayerSettings {
    adFun: number;
    alFun: number;
    arFun: number;
    arrowFun: number;
    auFun: number;
    autorun: number;
    bFun: number;
    bufSize: number;
    channelLogoMode: number;
    commandServerAddress: string;
    commandServerEnabled: number;
    commandServerToken: string;
    deviceUuid: string;
    editor: number;
    eFun: number;
    epgRemindMinutes: number;
    favorites: number;
    ffFun: number;
    fontShift: number;
    fontSize: number;
    gFun: number;
    hdmiSupport: number;
    hideMenus: string[];
    highlightColor: string;
    highlightColorB: string;
    highlightColorSel: string;
    infoChange: number;
    infoRew: number;
    infoSlide: number;
    infoSwitch: number;
    infoTimeout: number;
    listPosition: number;
    localCmdUrl: string;
    localHttpDeviceCode: string;
    localHttpEnabled: number;
    medCount: number;
    nextCount: number;
    nextCountList: number;
    nextFun: number;
    noColorKeys: number;
    noNumbersKeys: number;
    noSmall: number;
    okFun: number;
    osdOpacity: number;
    pageSize: number;
    parentPin: string;
    permanentTime: number;
    pipPosition: number;
    pipSize: number;
    players: number;
    pnFun: number;
    prevCount: number;
    prevFun: number;
    preview: number;
    psChannels: number;
    psOptions: number;
    requirePinForProviderSelection: number;
    resumeWithTenSecondRewind: number;
    rewFun: number;
    rFun: number;
    rwFun: number;
    seek13Duration: number;
    seek46Duration: number;
    seek79Duration: number;
    showArchive: number;
    showDescription: number;
    showName: number;
    showNumber: number;
    showProgram: number;
    showProgress: number;
    showScroll: number;
    sleepTimeout: number;
    stopPlay: number;
    swopBaseUrl: string;
    thumbnail: number;
    timezone: number;
    useGraphicalIndicators: number;
    volumeStep: number;
    yFun: number;
}

/** The LG playback shortcut opens Menu even when shared software volume exists. */
function defaultLeftArrowAction(): number {
    const device =
        typeof window !== "undefined" ? (window as any).ott_device : "";
    return device === "lg/webos" || device === "lg/netcast" ? 1 : 14;
}

/**
 * Return the factory-default `PlayerSettings` object for the selected device.
 *
 * @returns A `PlayerSettings` instance with all default values.
 *
 * @remarks
 * Device shortcuts are selected before stored user overrides are loaded.
 */
export function defaultSettings(): PlayerSettings {
    return {
        adFun: 16,
        alFun: defaultLeftArrowAction(),
        arFun: 13,
        arrowFun: 0,
        auFun: 15,
        autorun: 0,
        bFun: 9,
        bufSize: 0,
        channelLogoMode: 1,
        commandServerAddress: "",
        commandServerEnabled: 0,
        commandServerToken: "",
        deviceUuid: "",
        editor: 0,
        eFun: 0,
        epgRemindMinutes: 5,
        favorites: 0,
        ffFun: 19,
        fontShift: 4,
        fontSize: 4,
        gFun: 0,
        hdmiSupport: 0,
        hideMenus: [],
        highlightColor: "50,85",
        highlightColorB: "255,0",
        highlightColorSel: "240,25",
        infoChange: 1,
        infoRew: 1,
        infoSlide: 1,
        infoSwitch: 1,
        infoTimeout: 5,
        listPosition: 0,
        localCmdUrl: "",
        localHttpDeviceCode: "",
        localHttpEnabled: 0,
        medCount: 2,
        nextCount: 0,
        nextCountList: 1,
        nextFun: 21,
        noColorKeys: 0,
        noNumbersKeys: 0,
        noSmall: 0,
        okFun: 0,
        osdOpacity: 7,
        pageSize: 25,
        parentPin: "1234",
        permanentTime: 0,
        pipPosition: 0,
        pipSize: 0,
        players: 0,
        pnFun: 0,
        prevCount: 2,
        prevFun: 20,
        preview: 0,
        psChannels: 1,
        psOptions: 0,
        requirePinForProviderSelection: 0,
        resumeWithTenSecondRewind: 1,
        rewFun: 0,
        rFun: 10,
        rwFun: 18,
        seek13Duration: 15,
        seek46Duration: 180,
        seek79Duration: 600,
        showArchive: 1,
        showDescription: 1,
        showName: 1,
        showNumber: 1,
        showProgram: 1,
        showProgress: 1,
        showScroll: 1,
        sleepTimeout: 0,
        stopPlay: 0,
        swopBaseUrl: "",
        thumbnail: 1,
        timezone: 0,
        useGraphicalIndicators: 0,
        volumeStep: 5,
        yFun: 1,
    };
}

/** Restore only supported seek durations from old backups. */
export function normalizeSeekDuration(value: number, fallback: number): number {
    return [
        5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 3600,
    ].indexOf(value) >= 0
        ? value
        : fallback;
}
const settingDefaults = defaultSettings();
function defineSetting(
    id: string,
    key: string,
    scope: "application" | "provider",
    effects: string[],
    rules: any
): SettingDefinition {
    var fallback = (settingDefaults as any)[id];
    return {
        decode: rules.list
            ? function (raw) {
                  return raw.split(",").filter(function (x) {
                      return x !== "";
                  });
              }
            : rules.nextCount
              ? function (raw) {
                    return Number(raw) + 1;
                }
              : undefined,
        defaultValue: fallback,
        effects: effects,
        encode: rules.list
            ? function (value) {
                  return value.join(",");
              }
            : rules.nextCount
              ? function (value) {
                    return String(value - 1);
                }
              : undefined,
        id: id,
        key: key,
        scope: scope,
        validate: function (value): boolean {
            if (rules.list)
                return (
                    Array.isArray(value) &&
                    value.every(function (item) {
                        return typeof item === "string";
                    })
                );
            if (rules.pin)
                return (
                    typeof value === "string" &&
                    (value === "*" || /^\d{4}$/.test(value))
                );
            if (rules.color) {
                if (
                    typeof value !== "string" ||
                    !/^\d{1,3},\d{1,3}$/.test(value)
                )
                    return false;
                var pair = value.split(",").map(Number);
                return pair[0] <= 360 && pair[1] <= 100;
            }
            if (typeof fallback === "string") return typeof value === "string";
            if (
                typeof value !== "number" ||
                !isFinite(value) ||
                Math.floor(value) !== value
            )
                return false;
            if (rules.durations)
                return normalizeSeekDuration(value, NaN) === value;
            return rules.range
                ? value >= rules.range[0] && value <= rules.range[1]
                : value >= 0;
        },
    };
}
export const settingsSchema: SettingDefinition[] = [
    defineSetting("noSmall", "sNoSmall", "application", ["setListPos"], {
        range: [0, 1],
    }),
    defineSetting("stopPlay", "sStopPlay", "application", [], {
        range: [0, 1],
    }),
    defineSetting("pipSize", "sPipSize", "application", ["setPipPosBuf"], {
        range: [0, 2],
    }),
    defineSetting("pipPosition", "sPipPos", "application", ["setPipPosBuf"], {
        range: [0, 3],
    }),
    defineSetting(
        "pageSize",
        "sPageSize",
        "application",
        ["setFontSize", "setListPos"],
        { range: [10, 30] }
    ),
    defineSetting(
        "fontShift",
        "sFontShift",
        "application",
        ["setFontSize", "setListPos"],
        { range: [0, 30] }
    ),
    defineSetting(
        "fontSize",
        "sFont",
        "application",
        ["setFontSize", "setListPos"],
        {
            range: [0, 6],
        }
    ),
    defineSetting("arrowFun", "sArrowFun", "application", [], {
        range: [0, 3],
    }),
    defineSetting("rewFun", "sRewFun", "application", [], { range: [0, 3] }),
    defineSetting("pnFun", "sPNFun", "application", [], { range: [0, 3] }),
    defineSetting("rFun", "sRfun", "application", [], { range: [0, 64] }),
    defineSetting("gFun", "sGfun", "application", [], { range: [0, 64] }),
    defineSetting("yFun", "sYfun", "application", [], { range: [0, 64] }),
    defineSetting("bFun", "sBfun", "application", [], { range: [0, 64] }),
    defineSetting("alFun", "sALfun", "application", [], { range: [0, 64] }),
    defineSetting("arFun", "sARfun", "application", [], { range: [0, 64] }),
    defineSetting("auFun", "sAUfun", "application", [], { range: [0, 64] }),
    defineSetting("adFun", "sADfun", "application", [], { range: [0, 64] }),
    defineSetting("rwFun", "sRWfun", "application", [], { range: [0, 64] }),
    defineSetting("ffFun", "sFFfun", "application", [], { range: [0, 64] }),
    defineSetting("prevFun", "sPREVfun", "application", [], { range: [0, 64] }),
    defineSetting("nextFun", "sNEXTfun", "application", [], { range: [0, 64] }),
    defineSetting("eFun", "sEfun", "application", [], { range: [0, 4] }),
    defineSetting("okFun", "sOkfun", "application", [], { range: [0, 1] }),
    defineSetting("seek13Duration", "s13dur", "application", [], {
        durations: true,
    }),
    defineSetting("seek46Duration", "s46dur", "application", [], {
        durations: true,
    }),
    defineSetting("seek79Duration", "s79dur", "application", [], {
        durations: true,
    }),
    defineSetting("noColorKeys", "sNoColorKeys", "application", [], {
        range: [0, 1],
    }),
    defineSetting("noNumbersKeys", "sNoNumbersKeys", "application", [], {
        range: [0, 1],
    }),
    defineSetting("timezone", "sTimezone", "application", ["setTimezone"], {
        range: [0, 25],
    }),
    defineSetting(
        "sleepTimeout",
        "sSleepTimeout",
        "application",
        ["setSleepTimeout"],
        { range: [0, 4] }
    ),
    defineSetting("epgRemindMinutes", "sEpgRemindMinutes", "application", [], {
        range: [0, 120],
    }),
    defineSetting("volumeStep", "sVolumeStep", "application", [], {
        range: [3, 10],
    }),
    defineSetting("infoTimeout", "sInfoTimeout", "application", [], {
        range: [3, 20],
    }),
    defineSetting("infoSlide", "sInfoSlide", "application", [], {
        range: [0, 1],
    }),
    defineSetting("infoSwitch", "sInfoSwitch", "application", [], {
        range: [0, 1],
    }),
    defineSetting("infoChange", "sInfoChange", "application", [], {
        range: [0, 1],
    }),
    defineSetting("infoRew", "sInfoRew", "application", [], { range: [0, 1] }),
    defineSetting("thumbnail", "sThumbnail", "application", [], {
        range: [0, 1],
    }),
    defineSetting("osdOpacity", "sOsdOpacity", "application", ["setColor"], {
        range: [0, 10],
    }),
    defineSetting("listPosition", "sListPos", "application", ["setListPos"], {
        range: [0, 1],
    }),
    defineSetting("editor", "sEditor", "application", ["setEditor"], {
        range: [0, 1],
    }),
    defineSetting("showNumber", "sShowNum", "provider", [], { range: [0, 1] }),
    defineSetting("channelLogoMode", "sShowPikon", "provider", [], {
        range: [0, 2],
    }),
    defineSetting("showName", "sShowName", "provider", [], { range: [0, 1] }),
    defineSetting("showProgress", "sShowProgress", "provider", [], {
        range: [0, 1],
    }),
    defineSetting("showArchive", "sShowArchive", "provider", [], {
        range: [0, 1],
    }),
    defineSetting("showScroll", "sShowScroll", "application", [], {
        range: [0, 1],
    }),
    defineSetting("showDescription", "sShowDescr", "provider", [], {
        range: [0, 1],
    }),
    defineSetting("showProgram", "sShowProgram", "provider", [], {
        range: [0, 1],
    }),
    defineSetting("preview", "sPreview", "provider", [], { range: [0, 2] }),
    defineSetting("nextCountList", "sNextCount", "provider", [], {
        nextCount: true,
        range: [0, 20],
    }),
    defineSetting("favorites", "sFavorites", "application", [], {
        range: [-1, 1],
    }),
    defineSetting("permanentTime", "sPermanentTime", "application", [], {
        range: [0, 2],
    }),
    defineSetting("resumeWithTenSecondRewind", "s10resum", "application", [], {
        range: [0, 1],
    }),
    defineSetting("prevCount", "sPrevCount", "application", [], {
        range: [0, 4],
    }),
    defineSetting("medCount", "sMedCount", "application", [], {
        range: [0, 5],
    }),
    defineSetting("psChannels", "sPSchannels", "application", [], {
        range: [0, 1],
    }),
    defineSetting("psOptions", "sPSoptions", "application", [], {
        range: [0, 1],
    }),
    defineSetting(
        "requirePinForProviderSelection",
        "sPSprovs",
        "application",
        [],
        {
            range: [0, 1],
        }
    ),
    defineSetting("hdmiSupport", "sHDMIsupport", "application", [], {
        range: [0, 1],
    }),
    defineSetting("autorun", "sAutorun", "application", ["setAutorun"], {
        range: [0, 1],
    }),
    defineSetting(
        "players",
        "sPlayers",
        "provider",
        ["setPlayerMode", "setPlayer"],
        {
            range: [0, 3],
        }
    ),
    defineSetting("bufSize", "sBufSize", "application", ["stbSetBuffer"], {
        range: [0, 3600],
    }),
    defineSetting(
        "useGraphicalIndicators",
        "sGrapI",
        "application",
        ["setColor"],
        {
            range: [0, 1],
        }
    ),
    defineSetting("parentPin", "parentPIN", "application", [], { pin: true }),
    defineSetting("hideMenus", "sHideMenus", "application", [], { list: true }),
    defineSetting(
        "highlightColorSel",
        "sSHLcolSel",
        "application",
        ["setColor"],
        {
            color: true,
        }
    ),
    defineSetting("highlightColor", "sSHLcolor", "application", ["setColor"], {
        color: true,
    }),
    defineSetting(
        "highlightColorB",
        "sSHLcolorB",
        "application",
        ["setColor"],
        {
            color: true,
        }
    ),
    defineSetting(
        "commandServerAddress",
        "commandServerAddress",
        "application",
        [],
        {}
    ),
    defineSetting(
        "commandServerToken",
        "commandServerToken",
        "application",
        [],
        {}
    ),
    defineSetting("localCmdUrl", "sLocalCmdUrl", "application", [], {}),
    defineSetting(
        "localHttpDeviceCode",
        "sLocalHttpDeviceCode",
        "application",
        [],
        {}
    ),
    defineSetting("swopBaseUrl", "sSwopBaseUrl", "application", [], {}),
    defineSetting("deviceUuid", "sDeviceUuid", "application", [], {}),
    defineSetting("localHttpEnabled", "sLocalHttpEnabled", "application", [], {
        range: [0, 1],
    }),
    defineSetting(
        "commandServerEnabled",
        "commandServerEnabled",
        "application",
        [],
        {
            range: [0, 1],
        }
    ),
];
function settingsSource(): string {
    var w = typeof window === "undefined" ? {} : (window as any);
    var driver = w.__ottActiveProviderDriver;
    return driver && typeof driver.storageKey === "function"
        ? driver.id + ":" + driver.storageKey("sPlayers")
        : String(w.p_pref || w.providerId || "classic");
}
export const settingsStore = createSettingsStore(settingsSchema, {
    context: settingsSource,
    effect: function (name) {
        var w = window as any;
        if (typeof w[name] === "function") {
            if (name === "setPlayerMode") w[name](settings.players);
            else w[name]();
        }
    },
    storage: function (entry) {
        var w = window as any;
        var driver = w.__ottActiveProviderDriver;
        if (
            entry.scope === "provider" &&
            driver &&
            typeof driver.storageKey === "function"
        ) {
            var key = driver.storageKey(entry.key);
            return {
                read: function () {
                    return storage.get(key);
                },
                remove: function () {
                    storage.del(key);
                },
                write: function (v) {
                    storage.set(key, v);
                },
            };
        }
        if (
            entry.scope === "provider" &&
            typeof w.providerGetItem === "function"
        ) {
            var read = w.providerGetItem,
                write = w.providerSetItem,
                remove = w.providerDelItem;
            return {
                read: function () {
                    return read(entry.key);
                },
                remove: function () {
                    if (remove) remove(entry.key);
                    else write(entry.key, "");
                },
                write: function (v) {
                    write(entry.key, v);
                },
            };
        }
        return {
            read: function () {
                return storage.get(entry.key);
            },
            remove: function () {
                storage.del(entry.key);
            },
            write: function (v) {
                storage.set(entry.key, v);
            },
        };
    },
});
/** Typed and legacy views both forward to the same authoritative store. */
export const settings = {} as PlayerSettings;
settingsSchema.forEach(function (entry) {
    Object.defineProperty(settings, entry.id, {
        enumerable: true,
        get: function () {
            return settingsStore.get(entry.id);
        },
        set: function (value) {
            settingsStore.observe(entry.id, value);
        },
    });
});
Object.defineProperty(settings, "nextCount", {
    enumerable: true,
    get: function () {
        return Math.max(0, settings.nextCountList - 1);
    },
    set: function (value) {
        settings.nextCountList = Number(value) + 1;
    },
});
export function installSettingsFacade(target: Record<string, any>): void {
    settingsSchema.forEach(function (entry) {
        var key = entry.id === "nextCountList" ? "sNextCountL" : entry.key;
        Object.defineProperty(target, key, {
            configurable: true,
            enumerable: true,
            get: function () {
                return settingsStore.get(entry.id);
            },
            set: function (value) {
                settingsStore.observe(entry.id, value);
            },
        });
    });
    Object.defineProperty(target, "sNextCount", {
        configurable: true,
        enumerable: true,
        get: function () {
            return settings.nextCount;
        },
        set: function (value) {
            settings.nextCount = value;
        },
    });
    target.settings = settings;
}
export function loadSettings(): PlayerSettings {
    settingsSchema.forEach(function (entry) {
        if (entry.id === "alFun") entry.defaultValue = defaultLeftArrowAction();
    });
    settingsStore.reload();
    var w = window as any;
    var nativeEditor =
        !!w.__TAURI__ ||
        !!w.Capacitor ||
        /^(pc|pc2|tauri|desktop|nodejs)$/.test(String(w.ott_device || ""));
    if (nativeEditor && !storage.get("sEditorPcNativeMigrated")) {
        settings.editor = 1;
        try {
            storage.setI("sEditor", 1);
            storage.set("sEditorPcNativeMigrated", "1");
        } catch (_error) {}
    }
    installSettingsFacade(w);
    return settings;
}
/** Refresh only this provider's settings; application preferences stay intact. */
export function loadProviderSettings(playerDefault: number): void {
    settingsStore.reload("provider");
    var w = window as any;
    if (
        typeof w.providerGetItem === "function" &&
        w.providerGetItem("sPlayers") === null
    )
        settings.players = playerDefault;
}
export function saveSettings(input: Partial<PlayerSettings>): boolean {
    var draft = settingsStore.begin(true);
    var valid = true;
    settingsSchema.forEach(function (entry) {
        if (
            Object.prototype.hasOwnProperty.call(input, entry.id) &&
            !draft.set(entry.id, (input as any)[entry.id])
        )
            valid = false;
    });
    if (!valid) {
        draft.cancel();
        return false;
    }
    return draft.commit();
}
export function beginSettingsDraft(): SettingsDraft {
    return settingsStore.begin();
}
if (typeof window !== "undefined") installSettingsFacade(window as any);

/**
 * Export envelope version 1.
 */
export interface ExportEnvelopeV1 {
    favoritesArray: number[];
    parentalArray: number[];
    settings: Omit<
        PlayerSettings,
        | "localHttpEnabled"
        | "localHttpDeviceCode"
        | "commandServerAddress"
        | "commandServerToken"
        | "commandServerEnabled"
    >;
    timestamp: number;
    version: 1;
}

/**
 * Export current settings + channels state to JSON string (envelope v1).
 *
 * @returns JSON string containing settings, parentalArray, favoritesArray.
 *
 * @remarks
 * Uses providerGetJson to read parentalArray/favoritesArray from storage
 * (same keys used by channels/index.ts saveChannelsCats).
 */
export function exportSettings(): string {
    // Consent and credentials belong to this installation, never a backup.
    const exportedSettings = (
        window as any
    ).OttPlayCore.classicPortableSnapshot(settings, false);
    const env: ExportEnvelopeV1 = {
        favoritesArray: window.providerGetJson?.("favoritesArray", []) || [],
        parentalArray: window.providerGetJson?.("parentalArray", []) || [],
        settings: writeLegacySettingsFields(
            exportedSettings
        ) as ExportEnvelopeV1["settings"],
        timestamp: Date.now(),
        version: 1,
    };
    return JSON.stringify(env, null, 2);
}

/**
 * Import settings + channels state from JSON string (envelope v1).
 *
 * @param jsonStr - JSON string from exportSettings().
 * @param onConfirm - Callback when user confirms overwrite (for UI confirmBox).
 *
 * @remarks
 * Parses envelope, validates version, then:
 * 1. Restores PlayerSettings via saveSettings()
 * 2. Writes parentalArray/favoritesArray via providerSetItem()
 * 3. Reloads settings module state via loadSettings()
 * 4. Shows success via showShift()
 */
export function importSettings(
    jsonStr: string,
    onConfirm?: (ok: boolean) => void
): void {
    let env: ExportEnvelopeV1;
    try {
        env = JSON.parse(jsonStr) as ExportEnvelopeV1;
    } catch (_e) {
        if (onConfirm) onConfirm(false);
        return;
    }

    if (!(window as any).OttPlayCore.classicImportEnvelope(env)) {
        if (onConfirm) onConfirm(false);
        return;
    }
    var request = beginSettingsDraft();
    var settled = false;
    function complete(accept: boolean): void {
        if (settled) return;
        settled = true;
        var applied =
            accept && request.active() && applyImport(env, request.active);
        request.cancel();
        if (onConfirm) onConfirm(applied);
    }
    if (typeof window.confirmBox === "function") {
        window.confirmBox(
            "Overwrite current settings?",
            function () {
                complete(true);
            },
            function () {
                complete(false);
            }
        );
    } else complete(true);
}

function applyImport(env: ExportEnvelopeV1, admitted: () => boolean): boolean {
    var remote = (window as any).__ottCommandServer;
    if (remote)
        remote.configure({
            address: settings.commandServerAddress,
            enabled: false,
            token: settings.commandServerToken,
        });
    if (!admitted()) return false;
    // Ignore even explicitly injected credentials/consent in imported JSON.
    // Importing ordinary preferences preserves this installation's own consent.
    var saved = saveSettings({
        ...(readLegacySettingsFields(
            env.settings
        ) as ExportEnvelopeV1["settings"]),
        ...(window as any).OttPlayCore.classicInstallationState(
            settings,
            false
        ),
    });
    if (!saved) {
        if (typeof window.showShift === "function")
            window.showShift("Settings could not be saved");
        return false;
    }
    if (!admitted()) return false;
    if (typeof window.providerSetItem === "function") {
        window.providerSetItem(
            "parentalArray",
            JSON.stringify(env.parentalArray || [])
        );
        if (!admitted()) return false;
        window.providerSetItem(
            "favoritesArray",
            JSON.stringify(env.favoritesArray || [])
        );
    }
    if (!admitted()) return false;
    loadSettings();
    if (typeof window.showShift === "function") {
        window.showShift("Settings imported");
    }
    // Restart so live window.s* globals and channels module
    // favoritesArray/parentalArray pick up the new data.
    if (typeof window.restart === "function") window.restart();
    return true;
}
