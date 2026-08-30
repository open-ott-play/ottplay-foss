/**
 * OTT-play FOSS — main entry point.
 * Wires all modules together and exposes globals for backward compat.
 *
 * Responsibilities:
 * - Initialize storage, UI, and STB emulation layer.
 * - Load language files and provider scripts.
 * - Provide the settings subsystem (stbOptions, settingsInterface, etc.).
 * - Expose every function/constant on window.* for legacy compatibility.
 * - Handle playback (channel and media), channel list display, archive mode.
 * - Manage sleep timers, info bar, PiP, preview, and cloud settings sync.
 *
 * ─── BUILD CONSTRAINT: duplicate function bodies required ─────────────────
 * `build-concat.cjs` runs `tsc` then `stripModule()` which removes every
 * `import`/`export` line, then concatenates all .ts files in a fixed order
 * and runs terser to produce `dist/stbPlayer.js`. The legacy code in this
 * file uses top-level `function X` declarations (not `export function`),
 * which become global function declarations after the strip step and
 * therefore land in the bundle as callable symbols.
 *
 * New code lives in `src/app/*.ts` and `src/view/*.ts` as proper ES modules
 * with named exports — those are tree-shaken at the TypeScript level
 * (imports become references), but their body is inlined into the bundle
 * in the order `build-concat.cjs` lists. The legacy `function X` blocks
 * further down are therefore REQUIRED for the bundle to work: they provide
 * the surface that the concat step turns into globals for non-module
 * callers (stbPlayer, dune plugins, runtime providers).
 *
 * Do NOT delete these duplicates as part of the ES-module refactor. The
 * full migration to post-bundle architecture (drop the concat pipeline,
 * use real ES modules, drop the globals) is tracked separately.
 * ──────────────────────────────────────────────────────────────────────────
 */

// Polyfills (must run first)
import { applyPolyfills } from "./polyfills";

applyPolyfills();

// Utils
import * as encoding from "./utils/encoding";

// lzstring functions from utils/lzstring.ts (loaded earlier in concat)
declare const compress: any;

// Channels — only import what actually exists
import {
    _enterPinCode,
    _prog100,
    _tmedia,
    aAspects,
    aAudios,
    addToFavorites,
    aSubs,
    aZooms,
    catIndex,
    cats,
    catsArray,
    channels,
    curList,
    enterPinAndSetAccess,
    enterPinCode,
    epg,
    epgList,
    favoritesArray,
    forcePlay,
    getChannelUrl,
    getMediaDescr,
    handleNumberInput,
    ifParentalAccessChId,
    medFavorites,
    medHistory,
    mediaSelects,
    mediaUrls,
    nextChannel,
    parentalArray,
    parentControlSetup,
    playArchive,
    playTime,
    playType,
    prevArr,
    prevChannel,
    primaryIndex,
    removeFromFavorites,
    saveChannelsCats,
    sEditor,
    setCurrent,
    setParentAccess,
    sInfoSwitch,
    sMedCount,
    sPlayers,
    sStopPlay,
    updateArchiveInfo,
} from "./channels";
// Localization
import {
    _,
    loadLanguage,
    translate,
    translations,
    useGraphicIcons,
} from "./localization";
// Settings
import {
    defaultSettings,
    loadSettings,
    type PlayerSettings,
    saveSettings,
    settings,
} from "./settings";
// Storage
import {
    getMacAddress,
    providerDelItem,
    providerGetBool,
    providerGetItem,
    providerGetJson,
    providerGetNum,
    providerHasItem,
    providerHasItemValue,
    providerSetItem,
    setProviderPrefix,
    stbClearAllItems,
    stbDelItem,
    stbGetAllItems,
    stbGetItem,
    stbSetItem,
    storage,
} from "./storage";
import { client_feedb, PostFeedback, pperf_flush } from "./utils/helpers";

// Sync channels to window.chanels so provider scripts and UI can access it globally
(window as any).chanels = channels;

// Core
import {
    bufferSizes,
    loadAllOptions,
    playerMode,
    playerModeNames,
    saveAllOptions,
    setPipPosition,
    setPlayer,
    setPlayerMode,
    stbAudioTracksExists,
    stbContinue,
    stbCSS,
    stbExit,
    stbGetLen,
    stbGetPosTime,
    stbGetVolume,
    stbInfo,
    stbInit,
    stbIsPlaying,
    stbPause,
    stbPlay,
    stbPlayPip,
    stbSetBuffer,
    stbSetPosTime,
    stbSetVolume,
    stbSetWindow,
    stbStop,
    stbStopPip,
    stbSubtitleExists,
    stbToFullScreen,
    stbToggleAspectRatio,
    stbToggleAudioTrack,
    stbToggleMute,
    stbToggleStandby,
    stbToggleSubtitle,
    stbToggleZoom,
    strAspect,
    strAudio,
    strENTER,
    strEPG,
    strEXIT,
    strInfo,
    strLANG,
    strPip,
    strPRECH,
    strRETURN,
    strSETUP,
    strTools,
    strZoom,
    toggleAspectRatio,
    toggleAudioTrack,
    toggleSubtitle,
    toggleZoom,
    video,
    videoPip,
} from "./core";

// UI — popup functions
import {
    backColorDialog,
    btnDiv,
    changeSelect,
    closeList,
    colorDialog,
    confirmBox,
    exitPortal,
    hsvToRgb,
    infoBarHide,
    infoBarHideT,
    infoBox,
    infoList,
    initBackgroundIntervals,
    popBuckets,
    popEpg,
    popMedia,
    popPause,
    popPrevProg,
    popRecords,
    popShift,
    popStop,
    popStopPip,
    popTogglePip,
    popupList,
    restoreCPD,
    saveCPD,
    selColorDialog,
    setSelect,
    showChanelInfo,
    showPage,
    showSelectBox,
    showShift,
    step2text,
    strDOWN,
    strFF,
    strLEFT,
    strNEXT,
    strNew,
    strPAUSE,
    strPLAY,
    strPlayPause,
    strPREV,
    strRIGHT,
    strRW,
    strSTOP,
    strSubt,
    strUP,
    uiInit,
    updateChanelInfo,
    updateMediaInfo,
} from "./ui";

// jQuery (loaded externally via <script> tag)
declare var $: any;

// Command handler (push commands via webhook)
import { handleCommand, showPopup } from "./commands";
// Key handler
import { dispatchKey, keyHandler, keys } from "./keyhandler";
// Provider — only import what actually exists
import {
    edit_dealer,
    edit_dealer_remote,
    loadChannels,
    loadProv,
    noProvParam,
    noSelProv,
    optionsList,
    restart,
    selectProvaider,
} from "./provider";

// duneAddSettings — initially null, set by provider scripts
declare var duneAddSettings: ((_index: number) => void) | null;

// nofun — no-op callback used by firstRun list
/** A no-op function used as a placeholder callback in list entries and popup menus. */
function nofun(): void {}

// Version
var PLAYER_VERSION = "0319.1812";

// Backward compat globals (were defined in old monolithic bundle)
// itemWith — channel list item width, updated by showPage()
(window as any).itemWith = 735;
// client_can — capability detection for provider scripts
(window as any).client_can_https = false;
(window as any).client_can = {
    https: (window as any).client_can_https,
    localstorage: typeof window.localStorage !== "undefined",
    websocket: typeof window.WebSocket !== "undefined",
    is_maple:
        typeof navigator !== "undefined" &&
        navigator.userAgent.indexOf("Maple 6") !== -1,
};
(window as any).client_can.crossxhr =
    typeof navigator !== "undefined" &&
    !/(?:Viera\/1\.)/.test(navigator.userAgent);

// Host URL
var hostUrl = "";

// Device type
var deviceType = "";

// EPG domain
var epgDomain = "";

// Parental PIN
var parentPIN = "1234";

// Hide menus list
var hideMenus: string[] = [];

// Sleep timer
var sleepTimer: any = null;

// Info timeout
var infoTimeout: any = null;

// Number input state
var numberBuffer = "";
var numberTimeout: any = null;

// List state
var isListVisible = false;
var listSelectionIndex = 0;
var listDataArray: any[] = [];
var getListItemFn: Function = null;
var detailListActionFn: Function = null;
var listKeyHandlerFn: Function = null;
var selIndex = 0;
var listArray: any[] = [];

// Edit mode
var isEditMode = false;
var editCaption = "";
var editValue = "";

// Select box
var isSelectBox = false;

// PiP state
var pipIndex: number = null;
var pipCatIndex = 0;

// Preview
var previewChan: any = null;
var previewTimer: any = null;

// Popup menu
var popupActions: any[] = [
    toggleAspectRatio,
    toggleZoom,
    toggleAudioTrack,
    toggleSubtitle,
    popPrevProg,
    popPause,
    popStop,
    popShift,
    popTogglePip,
    popStopPip,
    popBuckets,
    popEpg,
    popRecords,
    popMedia,
    noProvParam,
    nofun,
    optionsList,
    restart,
    exitPortal,
    infoList,
];
var popupArray: string[] = (window as any).popupArray || [
    "Toggle Aspect Ratio",
    "Toggle Zoom Mode",
    "Switch sound track",
    "Switch subtitle",
    "Return to previous channel",
    "Pause/Play",
    "Restart stream / Live",
    "Rewind",
    "Call PiP / PiP exchange",
    "Close PiP",
    "Category selection",
    "Show EPG and archive for channel",
    "Show list of channel archive records",
    "Show Media Library",
    "",
    "",
    "Settings",
    "Restart player",
    "Exit player",
    "Information",
];
var popupDetail: any[] = (window as any).popupDetail || [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "Show rewind window",
    null,
    null,
    null,
    null,
    "Show list of channel archive records without duplication",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
];
var savedPopup: {
    ver: string;
    popupActions: any[];
    popupArray: string[];
    popupDetail: string[];
} = { ver: PLAYER_VERSION, popupActions: [], popupArray: [], popupDetail: [] };
var version: string = PLAYER_VERSION;

// Options system (ported from stbPlayer.js)
var optionsArr: { action: any; name?: string; desc?: string }[] = [];

/**
 * Find the index of an action function within an array of { action } objects.
 *
 * @param arr - Array of objects with an `action` property.
 * @param action - The action function to locate.
 * @returns The index, or -1 if not found.
 */
function indexOfAction(arr: any[], action: any): number {
    for (var i = 0; i < arr.length; i++) if (arr[i].action === action) return i;
    return -1;
}

/**
 * Convenience wrapper: find the index of `action` in the global optionsArr.
 *
 * @param action - The action function to find.
 * @returns Index in optionsArr, or -1.
 */
function optIndexOf(action: any): number {
    return indexOfAction(optionsArr, action);
}

/**
 * Remove an option entry from optionsArr by its action function.
 *
 * @param action - The action to remove. No-op if not found.
 * Side effects: Mutates optionsArr.
 */
function delOption(action: any): void {
    var idx = optIndexOf(action);
    if (idx > -1) optionsArr.splice(idx, 1);
}

/**
 * Prepend a styled button label to a list item whose action matches.
 * Used to overlay number/color button shortcuts onto settings list entries.
 *
 * @param arr - Array of { action } objects (e.g. optionsArr).
 * @param action - The action to target.
 * @param label - The button label HTML to prepend.
 *
 * Side effects: Mutates listArray (via global reference cast).
 * No-op if label is empty or action not found.
 */
function addBtn2menu(arr: any[], action: any, label: string): void {
    if (!label) return;
    var idx = indexOfAction(arr, action);
    if (idx > -1)
        (listArray as any)[idx] =
            '<div class="btn">' + label + "</div> " + (listArray as any)[idx];
}

// Font family list (index: 0=system, 1=Roboto, 2=RobotoCondensed, 3=Caveat, 4=Liberation, 5=Gabriela, 6=PTSansNarrow)
var fontFamilyList = [
    "",
    "Roboto, ",
    "RobotoCondensed, ",
    "Caveat, ",
    "Liberation, ",
    "Gabriela, ",
    "PTSansNarrow, ",
];

// Color state — defaults from original stbPlayer.js
var curColor = "gold";
var curColorB = "#668";
var bodyColor = "#f0f0f0";

// Page size
var pageSize = 25;

// TMDb
var TMDb: any = {
    prepare: function () {},
};

// Feedback
// client_feedb and PostFeedback defined in utils/helpers.ts

// Performance stamps
var perfStamps: string[] = [];

// Script loading
declare function loadScript(
    url: string,
    successCb: () => void,
    errorCb?: (e: any) => void,
    location?: HTMLElement
): void;
declare function getScriptDOM(
    url: string,
    successCb: () => void,
    errorCb?: () => void
): void;

// Provider-scoped storage aliases

/** @returns Provider-stored string value for `key`, or null. */
function _providerGetItem(key: string): string | null {
    return providerGetItem(key);
}

/** @returns True if `key` exists in provider storage. */
function _providerHasItem(key: string): boolean {
    return providerHasItem(key);
}

/** @returns True if `key` exists and has a non-empty value. */
function _providerHasItemValue(key: string): boolean {
    return providerHasItemValue(key);
}

/** Write `val` to provider storage under `key`. */
function _providerSetItem(key: string, val: string): void {
    providerSetItem(key, val);
}

/** Delete `key` from provider storage. */
function _providerDelItem(key: string): void {
    providerDelItem(key);
}

// Settings helpers

/**
 * Apply the configured timezone offset from settings.
 * Currently a stub — reads settings.timezone but performs no actual offset.
 * Reserved for future use (e.g. shifting EPG times).
 */
function setTimezone(): void {
    var tz = settings.timezone;
    if (tz) {
        // Apply timezone offset
    }
}

// UI-related DOM element references
var $i1: any;
var tooltip: HTMLElement | null = null;
var $tooltipSpan: any;

/**
 * Cache jQuery references to frequently-used DOM elements.
 * Must be called after the DOM is ready and #info1 / #progress_span exist.
 *
 * Side effects: Assigns module-level $i1, tooltip, $tooltipSpan.
 */
function initUIReferences(): void {
    $i1 = $("#info1");
    tooltip = document.getElementById("progress_span");
    if (tooltip) $tooltipSpan = $("span", tooltip);
}

/**
 * Calculate and apply font sizes, padding, and element dimensions based on
 * window/screen resolution, pageSize, and fontShift settings.
 * Also applies font family from settings.fontSize, toggles permanentTime
 * visibility, and dynamically adjusts widths for channel number, picon,
 * time labels, and program name using a test-font measurement technique.
 *
 * Side effects: Extensive DOM mutations on #list, #info1, #numprog,
 * #dialogbox, #listCaption, #listPodval, #permanentTime, #picon, #channel,
 * #progress, #descr, #buffering, #pip_buffering, #mute, #volume_div,
 * and many more. Calls stbCSS() if available. Hides .no_small elements
 * when settings.noSmall is set.
 */
function setFontSize(): void {
    pageSize = settings.pageSize;
    var e = window.innerHeight / 720;
    var t = window.innerWidth / 1280;
    var r = (window.innerHeight - 90 * e) / pageSize - settings.fontShift * e;
    r = Math.max(r, 16 * e);
    r = Math.min(r, 40 * e);
    $("#list").css("font-size", r + "px");
    $("#testFont").css("font-size", r + "px");
    $("#permanentTime").css("font-size", r + "px");

    r = Math.max(r, 22 * e);
    if ($i1 && typeof $i1.css === "function") $i1.css("font-size", r + "px");
    $("#numprog").css("font-size", r + "px");
    $("#dialogbox").css("font-size", r + "px");

    r = Math.min(r, 25 * e);
    $("#listCaption").css("font-size", r + "px");
    $("#listPodval").css("font-size", r + "px");
    $("#permanentTime")
        .toggle(settings.permanentTime !== 0)
        .toggleClass("osd", settings.permanentTime !== 2)
        .css("background-color", "");

    var s = "Helvetica, Arial, sans-serif";
    $("body").css("font-family", fontFamilyList[settings.fontSize] + s);

    $("#info").css("padding", 20 * e + "px");
    $("#numprog").css({
        left: 20 * e + "px",
        top: 20 * e + "px",
        padding: 10 * e + "px",
    });
    $("#permanentTime").css({
        right: 20 * e + "px",
        top: 20 * t + "px",
        padding: 10 * e + "px " + 10 * t + "px",
    });
    $("#launch").css({ "font-size": 16 * e + "px", padding: 100 * e + "px" });
    $("logo").css({ margin: 100 * e + "px" });
    $("#list").css({ margin: 10 * e + "px " + 10 * t + "px" });
    $("#listCaption").css({ height: 30 * e + "px" });
    $("#listTime").css({ width: 80 * t + "px", "font-size": 22 * e + "px" });
    $("#list_s").css({ "font-size": 16 * e + "px" });
    $("#listPodval").css({ height: 30 * e + "px" });
    $("#listDetail").css({
        width: 514 * t + 1 + "px",
        top: 330 * e + "px",
        bottom: 30 * e + 1 + "px",
        padding: 4 * e + "px " + 4 * t + "px",
    });
    $("#listPopUp").css({
        bottom: 30 * e + 1 + "px",
        padding: 10 * e + "px",
        margin: 10 * e + "px",
    });
    $("#listIn").css({
        left: 522 * t + "px",
        top: 30 * e + 1 + "px",
        bottom: 30 * e + 1 + "px",
        padding: 4 * e + "px 0px",
    });
    $("#listAbout").css({
        left: 522 * t + "px",
        top: 30 * e + 1 + "px",
        bottom: 30 * e + 1 + "px",
        padding: 10 * e + "px " + 10 * t + "px",
    });
    $("#listEdit").css({
        left: 522 * t + "px",
        top: 30 * e + 1 + "px",
        bottom: 30 * e + 1 + "px",
        padding: 10 * e + "px " + 10 * t + "px",
    });
    $("#info1").css({ padding: 20 * e + "px " + 20 * t + "px" });
    $("#picon").css({ width: 80 * t + "px", height: 80 * e + "px" });
    $("#channel").css({
        width: 1040 * t + "px",
        padding: "0px 0px 0px " + 20 * t + "px",
    });
    $("#channel_number").css({ width: 70 * t + "px" });
    $("#progress_div").css({ margin: 2 * e + "px 0px" });
    $("#progress").css({ height: 6 * e + "px" });
    $("#progress_r").css({ height: 6 * e + "px" });
    $("#begin_time").css({ width: 70 * t + "px", "font-size": 22 * e + "px" });
    $("#end_time").css({ width: 70 * t + "px", "font-size": 22 * e + "px" });
    $("#programm_name").css({ width: 900 * t + "px" });
    $("#nbegin_time").css({ width: 70 * t + "px", "font-size": 22 * e + "px" });
    $("#nend_time").css({ width: 70 * t + "px", "font-size": 22 * e + "px" });
    $("#nprogramm_name").css({ width: 900 * t + "px" });
    $("#data").css({ width: 80 * t + "px", "font-size": 22 * e + "px" });
    $("#current_s").css({ "font-size": 16 * e + "px" });
    $("#video_res").css({ "font-size": 16 * e + "px" });
    $("#descr").css({
        padding: "0px " + 100 * t + "px",
        margin: "0px 0px " + 20 * e + "px 0px",
    });
    $("#buffering").css({
        left: 10 * e + "px",
        top: 10 * e + "px",
        width: 30 * e + "px",
        height: 30 * e + "px",
        "background-size": 30 * e + "px",
    });
    $("#pip_buffering").css({
        right: 10 * e + "px",
        top: 10 * e + "px",
        width: 30 * e + "px",
        height: 30 * e + "px",
        "background-size": 30 * e + "px",
    });
    $("#mute").css({
        width: 40 * e + "px",
        height: 40 * e + "px",
        "background-size": 20 * e + "px",
    });
    $("#volume_div").css({
        left: 10 * t + "px",
        width: 15 * t + "px",
        border: 5 * e + "px solid black",
    });
    $("#dialogbox").css({ padding: 10 * e + "px", margin: 10 * e + "px" });
    $("btn").css({
        "border-radius": 6 * e + "px",
        padding: "0px " + 6 * t + "px",
    });

    try {
        if (tooltip && tooltip.style) {
            tooltip.style.width = 12 * e + "px";
            tooltip.style.height = 12 * e + "px";
            tooltip.style.border = 3 * e + "px solid " + curColor;
        }
    } catch (ex) {
        console.error(ex);
    }

    // Dynamic picon/data/listTime width based on font metrics
    try {
        var n = $("#testFont"),
            i = n.css("font-size");
        n.css("font-size", 22 * e).text("9");
        var a = n.width();
        n.text("").css("font-size", i);
        var o = a * 7;
        if (o) {
            $("#picon").css({ width: o + "px" });
            $("#data").css({ width: o + "px" });
            $("#listTime").css({ width: o + "px" });
            $("#channel").css({ width: 1200 * t - o * 2 + "px" });
            $("#descr").css({ padding: "0px " + (o + 20 * t) + "px" });
        }
    } catch (ex) {
        console.error(ex);
    }

    // Dynamic channel_number/begin/end_time/programm_name width
    try {
        var n2 = $("#testFont"),
            i2 = n2.css("font-size"),
            l2 = $i1 && $i1.css ? $i1.css("font-size") : "22px";
        n2.css("font-size", l2).text("9");
        var a2 = n2.width();
        n2.text("").css("font-size", i2);
        if (a2) {
            var w = a2 * 6;
            $("#channel_number").css({ width: w + "px" });
            $("#begin_time").css({ width: w + "px", "font-size": "inherit" });
            $("#end_time").css({ width: w + "px", "font-size": "inherit" });
            $("#programm_name").css({ width: 1200 * t - w - 20 * t + "px" });
            $("#nbegin_time").css({ width: w + "px", "font-size": "inherit" });
            $("#nend_time").css({ width: w + "px", "font-size": "inherit" });
            $("#nprogramm_name").css({ width: 1200 * t - w - 20 * t + "px" });
        }
    } catch (ex) {
        console.error(ex);
    }

    // Hide elements in small-screen mode
    if (settings.noSmall) {
        $(".no_small").hide();
    }

    try {
        if (typeof (window as any).stbCSS === "function")
            (window as any).stbCSS();
        $("#descr").css(
            "max-height",
            (660 - $("#channel").height()) * e + "px"
        );
    } catch (ex) {
        console.error(ex);
    }
}

/**
 * Position the channel list panel on the left or right side of the screen
 * depending on settings.listPosition. Also adjusts the detail panel and
 * popup containers accordingly.
 *
 * Side effects: CSS position changes on #listIn, #listAbout, #listEdit,
 * #listDetail, #listPopUp via jQuery.
 */
function setListPos(): void {
    var e = window.innerWidth / 1280;
    var t = window.innerHeight / 720;
    var r = settings.listPosition ? 0 : 522 * e;
    var s = settings.listPosition ? 522 * e : 0;
    var n = settings.listPosition ? 738 * e : 0;
    $("#listIn").css({ left: r + "px", right: s + "px" });
    $("#listAbout").css({ left: r + "px", right: s + "px" });
    $("#listEdit").css({ left: r + "px", right: s + "px" });
    $("#listDetail").css({ left: n + "px" });
    $("#listPopUp").css({ left: n + "px" });
    n = settings.noSmall ? 30 * t + 1 : 330 * t;
    $("#listDetail").css({ top: n + "px" });
}

/**
 * Apply highlight colors (foreground, selection background, list background)
 * from HSV settings to the DOM. Computes RGB values, writes to body color,
 * list borders, progress bars, dialog boxes, OSD opacity, and the window
 * frame elements (#_t, #_b, #_l, #_r).
 *
 * Side effects: Extensive DOM CSS mutations. Calls stbSetOsdOpacity().
 * Reads settings.highlightColor, highlightColorSel, highlightColorB,
 * osdOpacity, listPosition.
 */
function setColor(): void {
    $("body").css("color", bodyColor);
    // sSHLcolSel -> curColorB (selection background), H,S at lightness 50
    var selCv = settings.highlightColorSel.split(",");
    curColorB =
        "rgb(" +
        hsvToRgb(Number.parseInt(selCv[0]), Number.parseInt(selCv[1]), 50).join(
            ","
        ) +
        ")";
    // sSHLcolor -> curColor (selection foreground), H,S at lightness 100
    var fgCv = settings.highlightColor.split(",");
    curColor =
        "rgb(" +
        hsvToRgb(Number.parseInt(fgCv[0]), Number.parseInt(fgCv[1]), 100).join(
            ","
        ) +
        ")";

    $("#listCaption").css("border-bottom", "1px solid " + curColor);
    $("#listPodval").css("border-top", "1px solid " + curColor);
    $("#listPopUp").css("border", "1px solid " + curColor);
    $("#progress").css("background-color", curColor);
    if ($tooltipSpan && typeof $tooltipSpan.css === "function") {
        $tooltipSpan.css({ "background-color": curColorB, color: curColor });
    }
    $("#programm_name2").css("color", curColor);
    $("#dialogbox").css("border", "1px solid " + curColor);
    try {
        if (tooltip && tooltip.style)
            tooltip.style.border =
                3 * (window.innerHeight / 720) + "px solid " + curColor;
    } catch (e) {
        console.error(e);
    }
    stbSetOsdOpacity(settings.osdOpacity * 10);

    // Window frame elements
    var e = window.innerHeight / 720;
    var t = window.innerWidth / 1280;
    $("#_t").css("height", 50 * e);
    $("#_b").css("top", (50 + 288) * e);
    var listFrameLeft = settings.listPosition ? 758 : 10;
    $("#_l").css("width", listFrameLeft * t);
    $("#_r").css("left", (listFrameLeft + 512) * t);

    // Background color from sSHLcolorB
    var bgCv = settings.highlightColorB.split(",");
    var bgColor =
        "rgb(" +
        hsvToRgb(Number.parseInt(bgCv[0]), 100, Number.parseInt(bgCv[1])).join(
            ","
        ) +
        ")";
    $(".list_back").css("background-color", bgColor);
    $("#listPopUp").css("background-color", bgColor);
}

/**
 * Set the OSD (on-screen display) background opacity.
 * Computes an rgba() value from the highlight color B (HSV) and the
 * given opacity percentage, then applies it to all elements with
 * class "osd".
 *
 * @param val - Opacity percentage (0–100, but typically 0–10 mapped from
 *              osdOpacity setting).
 *
 * Side effects: CSS background-color on .osd elements.
 */
function stbSetOsdOpacity(val: number): void {
    var cv = settings.highlightColorB.split(",");
    $(".osd").css(
        "background-color",
        "rgba(" +
            hsvToRgb(Number.parseInt(cv[0]), 100, Number.parseInt(cv[1])).join(
                ","
            ) +
            "," +
            val / 100 +
            ")"
    );
}

/**
 * Select the editor implementation (built-in or native) based on sEditor.
 * Routes editKey / showEditKey to showEditKey1 or showEditKey2 on window.
 *
 * Side effects: Assigns window.editKey and window.showEditKey.
 */
function setEditor(): void {
    if (sEditor && typeof (window as any).showEditKey2 === "function") {
        (window as any).editKey = (window as any).editKey2;
        (window as any).showEditKey = (window as any).showEditKey2;
    } else {
        (window as any).editKey = (window as any).editKey1;
        (window as any).showEditKey = (window as any).showEditKey1;
    }
}

/**
 * Apply the configured PiP (Picture-in-Picture) window position and size.
 * Delegates to setPipPosition() from the core module.
 *
 * Side effects: DOM mutations via setPipPosition().
 */
function setPipPosBuf(): void {
    setPipPosition();
}

/**
 * Set (or clear) the sleep timer. After settings.sleepTimeout minutes,
 * the player enters standby via stbToggleStandby().
 *
 * Side effects: Sets/clears a setTimeout; calls stbToggleStandby() when
 * the timer fires.
 */
function setSleepTimeout(): void {
    if (sleepTimer) clearTimeout(sleepTimer);
    if (settings.sleepTimeout > 0) {
        sleepTimer = setTimeout(
            function () {
                stbToggleStandby();
            },
            settings.sleepTimeout * 60 * 1000
        );
    }
}

// Channel list functions

/**
 * Show the top-level category list. Displays catsArray labels and
 * installs a minimal key handler (ENTER plays, RETURN/EXIT closes).
 *
 * Side effects: Sets isListVisible, listDataArray, listSelectionIndex;
 * installs list handler functions; calls showPage().
 *
 * Edge case: This is a simplified stub — the full channel list with EPG
 * and progress bars is rendered by _channelsList in the provider module.
 */
function showChanelsList(): void {
    isListVisible = true;
    listDataArray = catsArray.slice();
    listSelectionIndex = catIndex >= 0 ? catIndex : 0;
    getListItemFn = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + item;
    };
    detailListActionFn = function () {};
    listKeyHandlerFn = function (key: number) {
        switch (key) {
            case 13: // ENTER
                // Close the list; playback stays on the current channel
                // (provider module replaces this handler when loaded).
                closeList();
                isListVisible = false;
                return true;
            case 8: // RETURN
            case 27: // EXIT
                closeList();
                isListVisible = false;
                return true;
        }
        return false;
    };
    showPage();
}

// Archive playback

/**
 * Start archive (timeshift) playback at the given timestamp.
 * Delegates to playArchive() from the channels module.
 *
 * @param timestamp - Unix timestamp (seconds) to seek to.
 *
 * Side effects: Calls playArchive(); may change playback state.
 */
function playArchiveMode(timestamp: number): void {
    playArchive(timestamp);
}

// Media info update

/**
 * Update the #video_res element with the current video resolution
 * (videoWidth × videoHeight) from the <video> element, if available.
 *
 * Side effects: DOM write to #video_res.
 */
function updateMediaInfoDisplay(): void {
    var resEl = document.getElementById("video_res");
    if (resEl && video && video.videoWidth)
        resEl.innerHTML = "<br/>" + video.videoWidth + "x" + video.videoHeight;
}

// Check media (detect archive)
var mediaCheckTimer: any = null;

/**
 * Detect whether the current playback is an archive recording (stream with
 * a finite duration > 180s and < 1,000,000s). If so, sets playType to
 * -99999999999 and resets playTime to 0.
 *
 * Side effects: Updates window.playType, window.playTime; calls
 * updateMediaInfoDisplay(). Clears mediaCheckTimer.
 */
function checkMedia(): void {
    clearTimeout(mediaCheckTimer);
    if (video) {
        var duration = stbGetLen();
        if (
            duration &&
            duration > 180 &&
            duration !== Number.POSITIVE_INFINITY &&
            duration < 1000000
        ) {
            window.playTime = 0;
            window.playType = -99999999999;
            updateMediaInfoDisplay();
        }
    }
}

// Unload handler

/**
 * Persist the current channel position and reset playType on page unload.
 *
 * Side effects: Calls setCurrent() and sets window.playType = 0.
 */
function body_onUnload(): void {
    setCurrent(catIndex, primaryIndex);
    window.playType = 0;
    // Report collected Maple 6 performance stamps (buffer is cleared;
    // no-op and empty on other platforms). The server appends the payload
    // to feedback.log.
    var perf: string = pperf_flush();
    if (perf) PostFeedback(perf);
}

/**
 * Handle the visibilitychange event. When the page becomes hidden
 * (tab switched, browser minimised), persists state via body_onUnload().
 *
 * Side effects: Calls body_onUnload() if document.hidden.
 */
function body_onUnloadHidden(): void {
    if (document.hidden) body_onUnload();
}
if (navigator.userAgent.search(/Maple/i) === -1) {
    if (document.addEventListener) {
        document.addEventListener("visibilitychange", body_onUnloadHidden);
    } else if ((document as any).attachEvent) {
        (document as any).attachEvent(
            "onvisibilitychange",
            body_onUnloadHidden
        );
    }
    if (window.addEventListener) {
        try {
            window.addEventListener("beforeunload", body_onUnload);
        } catch (_) {
            /* ignore */
        }
        try {
            window.addEventListener("unload", body_onUnload);
        } catch (_) {
            /* ignore */
        }
    } else if ((window as any).attachEvent) {
        client_feedb("is window.attachEvent");
        (window as any).attachEvent("onbeforeunload", body_onUnload);
        (window as any).attachEvent("onunload", body_onUnload);
    }
}

// Main initialization

/**
 * Called at the beginning of startPlayer(). Emits a performance stamp
 * and logs to console. Stub for future startup logic.
 */
function onPlayerStart(): void {
    if (typeof (window as any).pperf_stamp === "function")
        (window as any).pperf_stamp("onPlayerStart");
    console.log("onPlayerStart");
}

// Language selection

/**
 * Show the language selection list. Renders a list of 20 languages,
 * saves the selection to stb storage, loads the corresponding language
 * JS file from /stbPlayer/{code}.js, then proceeds to loadProv() or
 * optionsList depending on duneAddSettings availability.
 *
 * Side effects: Writes 'ottplaylang' to stb storage; dynamically loads
 * a language script via getScriptDOM; DOM mutations to list elements;
 * calls showPage().
 *
 * Edge cases:
 * - If duneAddSettings is a function (Dune environment), on ENTER/EXIT
 *   navigates to optionsList instead of loadProv / stbExit.
 * - If no language was previously selected, the launch element is hidden.
 */
function selectLang(): void {
    var langCodes = [
        "_eng",
        "_arm",
        "_bel",
        "_bul",
        "_fra",
        "_ger",
        "_gre",
        "_heb",
        "_hun",
        "_ita",
        "_lat",
        "_lit",
        "_pol",
        "_por",
        "_rou",
        "_rus",
        "_spa",
        "_tur",
        "_ukr",
        "_uzb",
    ];
    var langNames = [
        "English",
        "Armenian - Հայերեն",
        "Belarusian - Беларуская",
        "Bulgarian - Български",
        "French - Français",
        "German - Deutsch",
        "Greek - Ελληνικά",
        "Hebrew - עברית",
        "Hungarian - Magyar",
        "Italian - Italiano",
        "Latvian - Latviski",
        "Lithuanian - Lietuvių",
        "Polish - Polski",
        "Portuguese - Português",
        "Romanian - Română",
        "Russian - Русский",
        "Spanish - Español",
        "Turkish - Türkçe",
        "Ukrainian - Українська",
        "Uzbek - O'zbekcha",
    ];
    selIndex = langCodes.indexOf(stbGetItem("ottplaylang") || "");
    var prevSelIndex = selIndex;
    if (selIndex === -1) selIndex = 0;
    listDataArray = langNames;
    getListItemFn = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + item;
    };
    detailListActionFn = function () {};
    listKeyHandlerFn = function (key: number): boolean {
        switch (key) {
            case keys.ENTER:
                console.log(
                    "TRACE selectLang ENTER prevSelIndex=" +
                        prevSelIndex +
                        " selIndex=" +
                        selIndex
                );
                if (prevSelIndex === selIndex) {
                    if (typeof duneAddSettings !== "function") loadProv();
                    else if (typeof (window as any).optionsList === "function")
                        (window as any).optionsList(selectLang);
                } else {
                    stbSetItem("ottplaylang", langCodes[selIndex]);
                    (window as any).keyStrings = {};
                    getScriptDOM(
                        hostUrl +
                            "/stbPlayer/" +
                            langCodes[selIndex] +
                            ".js?" +
                            PLAYER_VERSION,
                        function () {
                            if (typeof duneAddSettings !== "function") {
                                loadProv();
                            } else if (
                                typeof (window as any).optionsList ===
                                "function"
                            )
                                (window as any).optionsList(selectLang);
                        },
                        function () {
                            console.log("TRACE langJS load FAILED");
                            infoBox("ERR: lang loading fail!");
                        }
                    );
                }
                return true;
            case keys.EXIT:
                if (typeof duneAddSettings === "function") return false;
            case keys.RETURN:
                if (typeof duneAddSettings !== "function") {
                    closeList();
                    stbExit();
                } else if (typeof (window as any).optionsList === "function")
                    (window as any).optionsList(selectLang);
                return true;
        }
        return false;
    };
    var listDetailEl = document.getElementById("listDetail");
    if (listDetailEl) listDetailEl.innerHTML = "";
    var listCaptionEl = document.getElementById("listCaption");
    if (listCaptionEl) listCaptionEl.innerHTML = _("Choose language");
    var listPodvalEl = document.getElementById("listPodval");
    if (listPodvalEl)
        listPodvalEl.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    var listPopUpEl = document.getElementById("listPopUp");
    if (listPopUpEl) listPopUpEl.style.display = "none";
    showPage();
}

// Load provider callback (called after language JS loaded)

/**
 * Callback invoked after a language script has been loaded.
 * Delegates to loadChannels(), then configures the player mode and player.
 *
 * Side effects: Calls loadChannels(), setPlayerMode(), and setPlayer().
 */
function loadProvCallback(): void {
    if (typeof (window as any).pperf_stamp === "function")
        (window as any).pperf_stamp("loadProvCallback");
    if (typeof loadChannels === "function") loadChannels();
    setPlayerMode(sPlayers);
    if (typeof setPlayer === "function") setPlayer();
}

// Main entry point

/**
 * Main entry point — called once the DOM is ready.
 * Initialises storage, UI, the STB layer, key handler, and triggers
 * the full startup chain (onStbReady → language → provider).
 *
 * Side effects: Resets storage, calls uiInit(), stbInit(), wires
 * window.onkeydown, calls onStbReady(). Appends version and icon to
 * the #launch element.
 *
 * Edge case: Wrapped in try/catch — exceptions are displayed in #launch.
 */
export function startPlayer(): void {
    var launchEl = document.getElementById("launch");
    if (launchEl) {
        launchEl.innerHTML += "<br/>VER: " + PLAYER_VERSION;
    }

    onPlayerStart();

    try {
        if (typeof (window as any).pperf_stamp === "function")
            (window as any).pperf_stamp("startPlayer -- start");
        console.log("startPlayer");

        if (launchEl) {
            launchEl.innerHTML +=
                '<img src="' +
                hostUrl +
                "/stbPlayer/icon.png?" +
                PLAYER_VERSION +
                '" style="position: absolute; left: 100px; bottom:100px;" height="30%" alt=""/>';
        }

        storage.reset();

        uiInit();
        initBackgroundIntervals();
        (window as any).listPodval = (window as any).listPodvalElement;
        if (typeof stbInit === "function") {
            stbInit();
            window.onkeydown = keyHandler;
            onStbReady();
        }
    } catch (e) {
        if (launchEl) {
            launchEl.innerHTML +=
                "<br/><br/><b>Exception:</b> name " +
                e.name +
                ", message " +
                e.message;
        }
        console.error(e);
    }
}

// Post-STB-init setup

/**
 * Called after stbInit() completes. Responsible for:
 * - Merging device-specific key mappings
 * - Loading all settings from storage
 * - Syncing PlayerSettings to window.* globals
 * - Initialising UI references and applying visual settings
 * - Saving the current popup state for provider-switch restoration
 * - Loading the language file and then launching the provider / options
 * - Preparing TMDb if available
 *
 * Side effects: Extensive — calls loadSettings(), applySettingsToWindow(),
 * setTimezone(), setFontSize(), setListPos(), setColor(), setEditor(),
 * setPipPosBuf(), setSleepTimeout(); loads language JS; calls loadProv()
 * or optionsList().
 *
 * Edge case: If no language is set, calls selectLang() directly and returns.
 * Wrapped in try/catch — exceptions are displayed in #launch.
 */
function onStbReady(): void {
    if (typeof (window as any).pperf_stamp === "function")
        (window as any).pperf_stamp("onStbReady -- start");

    try {
        // Merge device-specific key mappings from window.keys (set by stb/{device}/stb.js)
        if (typeof (window as any).keys !== "undefined") {
            Object.assign(keys, (window as any).keys);
        }
        // Load all settings
        loadSettings();
        // Sync PlayerSettings → window.* for settings submenu compatibility
        applySettingsToWindow(settings);
        initUIReferences();

        // Apply settings
        if (typeof stbSetBuffer === "function") stbSetBuffer();
        setTimezone();
        setFontSize();
        setListPos();
        setColor();
        setEditor();
        setPipPosBuf();
        setSleepTimeout();
        closeList();

        // Expose edit globals for provider scripts (stalker, edem, etc.)
        // Providers assign window.setEdit, window.editCaption, window.editvar directly
        if (typeof (window as any).setEdit === "undefined")
            (window as any).setEdit = function () {};
        if (typeof (window as any).editKey === "undefined")
            (window as any).editKey = (window as any).editKey1;
        if (typeof (window as any).showEditKey === "undefined")
            (window as any).showEditKey = (window as any).showEditKey1;

        if (typeof (window as any).pperf_stamp === "function")
            (window as any).pperf_stamp("startPlayer -- control 1");

        // Save current popup state (read by loadProv when switching providers)
        savedPopup.popupActions = popupActions.slice();
        savedPopup.popupArray = popupArray.slice();
        savedPopup.popupDetail = popupDetail.slice();
        savedPopup.ver = version;

        // Load language
        var lang = stbGetItem("ottplaylang");
        var launchEl = document.getElementById("launch");
        if (!lang) {
            console.log("TRACE no lang, calling selectLang()");
            if (launchEl) {
                launchEl.innerHTML += "<br/><b>No language selected !!!</b>";
                launchEl.style.display = "none";
            }
            selectLang();
            return;
        }

        console.log("TRACE lang=" + lang + ", loading langJS");
        if (typeof (window as any).pperf_stamp === "function")
            (window as any).pperf_stamp("startPlayer -- loadLang -- js");
        getScriptDOM(
            hostUrl + "/stbPlayer/" + lang + ".js?" + PLAYER_VERSION,
            function () {
                console.log("TRACE langJS loaded (onStbReady path)");
                if (typeof duneAddSettings !== "function") loadProv();
                else if (typeof (window as any).optionsList === "function")
                    (window as any).optionsList(selectLang);
            },
            function () {
                var el = document.getElementById("launch");
                if (el) {
                    el.innerHTML += "<br/><b>No language selected !!!</b>";
                    el.style.display = "none";
                }
                selectLang();
            }
        );

        if (TMDb && TMDb.prepare) TMDb.prepare();
    } catch (e) {
        var launchEl2 = document.getElementById("launch");
        if (launchEl2) {
            launchEl2.innerHTML +=
                "<br/><br/><b>Exception.StbReady:</b> name " +
                e.name +
                ", message " +
                e.message;
        }
        console.error(e);
    }
}

// Auto-start when DOM ready
if (
    typeof (window as any).ott_device === "undefined" ||
    (window as any).ott_device === ""
) {
    if (document.readyState === "complete") {
        startPlayer();
    } else {
        document.addEventListener("DOMContentLoaded", startPlayer);
    }
}

console.log("player loaded!");

// Expose globals for backward compat with HTML and other scripts
declare var window: any;
window.startPlayer = startPlayer;
window.onStbReady = onStbReady;
window.keyHandler = keyHandler;
window._doKey = dispatchKey;
window.keys = keys;

/* ---------------------------------------------------------------------------
 * Core channel / media playback
 * --------------------------------------------------------------------------- */

/**
 * Internal implementation of playChannel. Starts playback of the channel
 * at (catIdx, chIdx): validates the category, checks parental access,
 * stops current playback if sStopPlay, updates current channel index,
 * shows channel info, and calls stbPlay() with the channel URL.
 * Also schedules a media check via checkMedia() after 2 seconds.
 *
 * @param catIdx - Category index.
 * @param chIdx - Channel index within the category.
 *
 * Side effects: Calls stbStop(), setCurrent(), updateChanelInfo(),
 * showChanelInfo(), stbPlay(). Sets window.playType = 0. Creates a
 * setTimeout for checkMedia.
 *
 * Edge case: If the category doesn't exist, shows an error via infoBox()
 * and client_feedb(). If parental access is required, defers via callback.
 */
function _playChannel(catIdx: number, chIdx: number): void {
    console.log(
        "[playChannel] catIdx=" +
            catIdx +
            " chIdx=" +
            chIdx +
            " catsArray.length=" +
            catsArray.length
    );
    if (catsArray[catIdx] === undefined) {
        infoBox(
            "ERROR: Category #" +
                catIdx +
                " does not exist!<br /> Please select other"
        );
        client_feedb(
            "category_trouble_playChannel: " +
                catIdx +
                " / " +
                catsArray.length +
                " / " +
                Object.keys(providerGetJson("cats", {})).length
        );
    }
    if (
        ifParentalAccessChId(cats[catsArray[catIdx]][chIdx], function () {
            playChannel(catIdx, chIdx);
        })
    ) {
        console.log("[playChannel] blocked by parental");
        return;
    }
    if (sStopPlay) stbStop();
    setCurrent(catIdx, chIdx);
    var channelId = curList[primaryIndex];
    console.log(
        "[playChannel] channelId=" +
            channelId +
            " url=" +
            getChannelUrl(channelId)
    );
    updateChanelInfo(channelId);
    if (sInfoSwitch) showChanelInfo(settings.infoTimeout);
    (window as any).playType = 0;
    if (typeof setPlayer === "function") setPlayer();
    stbPlay(getChannelUrl(channelId));
    clearTimeout((window as any)._tmedia);
    (window as any)._tmedia = setTimeout(checkMedia, 2000);
}

/**
 * Internal implementation of playMedia. Starts playback of a media library
 * item: updates history, resets info bar elements, sets playType to a
 * sentinel value (-1e11), and calls stbPlay() with the item's stream URL.
 * If the item has a resume position, shows a "Continue watching?" confirmation.
 *
 * @param item - Media item object with properties: stream_url, title,
 *               logo_30x30, etc.
 *
 * Side effects: Mutates medHistory (unshift, splice), writes to DOM
 * (#picon, #channel_name, #nprogramm_name, #nbegin_time, #nend_time,
 * #programm_name, #progress_div, #progress_r, #progress, #begin_time,
 * #end_time, #programm_name2, #programm_duration, #programm_descr).
 * Calls stbStop(), stbPlay(), showChanelInfo(). Sets forcePlay = true.
 *
 * Edge case: If stream_url is a function, calls it to get the URL.
 * If mediaUrls last element is -1, resets mediaSelects[0] to 0.
 */
function _playMedia(item: any): void {
    if (mediaUrls && mediaUrls[mediaUrls.length - 1] === -1)
        mediaSelects[0] = 0;
    setCurrent(catIndex, -1);
    var resumePos = 0;
    var historyIdx = medHistory.findIndex(function (e: any) {
        return e.stream_url === item.stream_url;
    });
    if (historyIdx !== -1) {
        if (historyIdx === 0 && (window as any).playType === -1e11) return;
        resumePos = Math.floor(medHistory[historyIdx].current / 60) * 60;
        medHistory.splice(historyIdx, 1);
    }
    medHistory.unshift(item);
    var maxMedCount = [0, 10, 20, 30, 40, 50][sMedCount] || 10;
    medHistory.splice(maxMedCount);
    $("#picon").css(
        "background-image",
        'url("' + (item.logo_30x30 || "") + '")'
    );
    $("#channel_number").text(" ");
    $("#channel_name").html(item.title);
    $("#nprogramm_name").html("&nbsp; ");
    $("#nbegin_time").text("");
    $("#nend_time").text("");
    $("#programm_name").html("&nbsp; ");
    (window as any)._prog100 = 0;
    $("#progress_div").css("background-color", "#446");
    $("#progress_r").css("width", "0%");
    $("#progress").css("width", "0%");
    $("#begin_time").text("");
    $("#end_time").text("");
    $("#programm_name2").text("");
    $("#programm_duration").text("");
    $("#programm_descr").html(getMediaDescr(item));
    if (sInfoSwitch) showChanelInfo(settings.infoTimeout);
    (window as any).playTime = 0;
    (window as any).playType = -1e11;
    (window as any).forcePlay = true;
    if (sStopPlay) stbStop();
    if (typeof item.stream_url === "function")
        item.stream_url = item.stream_url();
    stbPlay(item.stream_url);
    if (resumePos)
        confirmBox(
            _("Continue watching?") + "<br><br>" + step2text(resumePos),
            function () {
                stbSetPosTime(resumePos);
            }
        );
}

var playChannel = _playChannel;
var playMedia = _playMedia;

window._playChannel = _playChannel;
window.playChannel = playChannel;
window._playMedia = _playMedia;
window.playMedia = playMedia;

window.showChanelsList = showChanelsList;
// window.refreshchanelsList = refreshchanelsList; // not yet ported
window.showPage = showPage;
window.closeList = closeList;
window.changeSelect = changeSelect;
window.setSelect = setSelect;
window.showShift = showShift;
window.showSelectBox = showSelectBox;
window.infoBox = infoBox;
window.confirmBox = confirmBox;
window.updateChanelInfo = updateChanelInfo;
window.updateMediaInfo = updateMediaInfoDisplay;
window.stbPlay = stbPlay;
window.stbStop = stbStop;
window.stbPause = stbPause;
window.stbContinue = stbContinue;
window.stbIsPlaying = stbIsPlaying;
window.stbToggleMute = stbToggleMute;
window.stbGetVolume = stbGetVolume;
window.stbSetVolume = stbSetVolume;
window.stbGetPosTime = stbGetPosTime;
window.stbSetPosTime = stbSetPosTime;
window.stbGetLen = stbGetLen;
window.stbToFullScreen = stbToFullScreen;
window.stbSetWindow = stbSetWindow;
window.stbToggleAspectRatio = stbToggleAspectRatio;
window.stbToggleAudioTrack = stbToggleAudioTrack;
window.stbToggleSubtitle = stbToggleSubtitle;
window.stbAudioTracksExists = stbAudioTracksExists;
window.stbSubtitleExists = stbSubtitleExists;
window.stbPlayPip = stbPlayPip;
window.stbStopPip = stbStopPip;
window.stbSetBuffer = stbSetBuffer;
/**
 * Generic settings-list setup function. Assigned to window._setSetup.
 * Renders a list of setting items with current values and left/right
 * arrows to change them, a GREEN/PLAY button to save, and RETURN to cancel.
 *
 * @param saveCallback - Function called when the user saves settings.
 * @param cancelCallback - Function called when the user cancels.
 *
 * Side effects: Overrides window.selIndex, getListItem, detailListAction,
 * listKeyHandlerFn, listDataArray; writes to #listDetail, #listPodval;
 * calls showPage().
 */
window._setSetup = function (
    saveCallback: () => void,
    cancelCallback: () => void
): void {
    (window as any).selIndex = 0;
    (window as any).getListItem = function (item: any, _idx: number): string {
        return (
            '<div style="float:right; width:23%; overflow:hidden; text-align:right;">' +
            (item.values[item.val] || item.cur) +
            "&nbsp;&nbsp;</div>" +
            '<div style="float:left; width:75%; overflow:hidden;">&nbsp;&nbsp;' +
            item.name +
            "</div>"
        );
    };
    var detailEl = document.getElementById("listDetail");
    if (detailEl) detailEl.innerHTML = "";
    (window as any).detailListAction = function (): void {
        var item = (window as any).listArray[(window as any).selIndex];
        var dEl = document.getElementById("listDetail");
        if (dEl) {
            dEl.innerHTML =
                (Array.isArray(item.values)
                    ? item.name +
                      "<br/><br/>" +
                      ((window as any)._("Choose from") || "Choose from") +
                      ":<br/>" +
                      item.values
                          .filter(function (v: any) {
                              return v !== "@@@";
                          })
                          .join(", ")
                    : item.cur) + (item.desc ? "<br/><br/>" + item.desc : "");
        }
    };
    var podvalEl = document.getElementById("listPodval");
    if (podvalEl) {
        podvalEl.innerHTML =
            (window as any).btnDiv(
                (window as any).keys.RETURN,
                (window as any).strRETURN,
                "Close"
            ) +
            (window as any).btnDiv(
                (window as any).keys.ENTER,
                (window as any).strENTER,
                "Change value",
                (window as any).strLEFT,
                (window as any).strRIGHT
            ) +
            (window as any).btnDiv(
                (window as any).keys.GREEN,
                "",
                "Save Settings",
                (window as any).strPlayPause,
                "0"
            );
    }
    (window as any).listKeyHandlerFn = function (e: number): boolean {
        var item = (window as any).listArray[(window as any).selIndex];
        switch (e) {
            case (window as any).keys.ENTER:
                if (typeof item.values === "function") {
                    item.values();
                }
                if (Array.isArray(item.values) && item.values.length > 2) {
                    (window as any).selectValue(item);
                    return true;
                }
            case (window as any).keys.RIGHT:
                if (Array.isArray(item.values)) {
                    item.val =
                        item.val > item.values.length - 2 ? 0 : item.val + 1;
                    if (item.values[item.val] === "@@@") {
                        (window as any).listKeyHandlerFn(e);
                    } else if (typeof (window as any).showPage === "function")
                        (window as any).showPage();
                }
                return true;
            case (window as any).keys.LEFT:
                if (Array.isArray(item.values)) {
                    item.val =
                        item.val === 0 ? item.values.length - 1 : item.val - 1;
                    if (item.values[item.val] === "@@@") {
                        (window as any).listKeyHandlerFn(e);
                    } else if (typeof (window as any).showPage === "function")
                        (window as any).showPage();
                }
                return true;
            case (window as any).keys.N0:
            case (window as any).keys.PLAY:
            case (window as any).keys.PAUSE:
            case (window as any).keys.GREEN:
                saveCallback();
                return true;
            case (window as any).keys.RETURN:
                cancelCallback();
                return true;
        }
        return false;
    };
    (window as any).listDataArray = (window as any).listArray;
    if (typeof (window as any).showPage === "function")
        (window as any).showPage();
};

/**
 * Show the "STB Settings" screen (editor, player mode, buffer size).
 * Checks parental PIN (sPSoptions), renders a list with save callback,
 * and persists changes to storage on save.
 *
 * Inner function saveSettings() iterates the list and writes sEditor,
 * sPlayers, sBufSize to stb or provider storage as appropriate.
 *
 * Side effects: Calls setEditor(), stbSetBuffer(), showShift(), closeList();
 * writes to stb storage.
 */
window.stbOptions = function (): void {
    var w = window as any;
    if (w.sPSoptions && w.parentPIN !== "*" && !w.parentAccess) {
        if (typeof w.enterPinAndSetAccess === "function")
            w.enterPinAndSetAccess(w.stbOptions);
        return;
    }
    /**
     * Persist the STB settings (editor, player mode, buffer size) and
     * re-apply them. Then re-open the stbOptions screen.
     */
    function saveSettings(): void {
        var i = -1;
        if (w.sEditor !== w.listArray[++i].val) {
            w.sEditor = w.listArray[i].val;
            w.stbSetItem("sEditor", w.listArray[i].val.toString());
        }
        if (w.sPlayers !== w.listArray[++i].val) {
            w.sPlayers = w.listArray[i].val;
            w.providerSetItem("sPlayers", w.listArray[i].val.toString());
            if (typeof w.setPlayerMode === "function")
                w.setPlayerMode(w.sPlayers);
        }
        if (w.sBufSize !== w.listArray[++i].val) {
            w.sBufSize = w.listArray[i].val;
            w.stbSetItem("sBufSize", w.listArray[i].val.toString());
        }
        if (typeof w.setEditor === "function") w.setEditor();
        if (typeof w.stbSetBuffer === "function") w.stbSetBuffer();
        if (typeof w.showShift === "function")
            w.showShift(w._("Settings saved") || "Settings saved");
        if (typeof w.closeList === "function") w.closeList();
        w.stbOptions();
    }
    var noyes = [w._("no") || "no", w._("yes") || "yes"];
    w.listArray = [
        {
            name: w._("Editor") || "Editor",
            val: w.sEditor,
            values: [w._("built-in") || "built-in", w._("native") || "native"],
        },
        {
            name:
                w._("Type of player for streaming") ||
                "Type of player for streaming",
            val: w.sPlayers,
            values: w.playerModeNames,
        },
        {
            name: w._("Buffer Size, s") || "Buffer Size, s",
            val: w.sBufSize,
            values: w.bufferSizes,
        },
        { name: "", val: 0, values: w.nofun || [], cur: "" },
        {
            name:
                '<div class="btn">' +
                (w._("Save Settings") || "Save Settings") +
                "</div>",
            val: 0,
            values: saveSettings,
            cur: "",
        },
    ];
    var captionEl = document.getElementById("listCaption");
    if (captionEl) captionEl.innerHTML = w._("Settings STB") || "Settings STB";
    if (typeof w._setSetup === "function") {
        w._setSetup(saveSettings, function () {
            w.stbOptions();
        });
    }
};
delete (window as any).addAoptions;

/**
 * Helper used by settings save functions: if the current window[key] value
 * differs from listArray[pos].val, update window[key] and persist it.
 *
 * @param pos - Index in the current listArray of settings items.
 * @param key - The window property name to save (e.g. 'sStopPlay').
 * @param useStb - If true, use stbSetItem; otherwise use providerSetItem.
 *
 * Side effects: Updates window[key]; writes to stb/provider storage.
 */
window.saveIfChanged = function (
    pos: number,
    key: string,
    useStb: boolean
): void {
    var w = window as any;
    if (useStb === undefined) useStb = false;
    if (w[key] === w.listArray[pos].val) return;
    w[key] = w.listArray[pos].val;
    if (useStb && typeof w.stbSetItem === "function") w.stbSetItem(key, w[key]);
    else if (typeof w.providerSetItem === "function")
        w.providerSetItem(key, w[key]);
};

// ─── Settings UI functions (ported from original stbPlayer.js) ──────────────

/**
 * Show the "Interface settings" screen.
 * Offers options for: black screen on channel switch, PiP size/position,
 * font type, timezone, sleep timer, interface transparency, volume step,
 * color spectrum, background colors, permanent clock, graphical indication,
 * resume-after-pause behaviour, previous channels count, media history,
 * editor type, player type, and buffer size.
 *
 * Inner function save() iterates the list and persists each setting.
 *
 * Side effects: Calls setTimezone(), setFontSize(), setListPos(),
 * setColor(), setEditor(), setPipPosBuf(), setPlayer(), setAutorun(),
 * stbSetBuffer(), showShift(), closeList(); writes to stb/provider storage.
 * Conditionally removes rows for unsupported features (no PiP, no volume,
 * etc.).
 */
window.settingsInterface = function (): void {
    var w = window as any;
    /**
     * Persist all interface settings and re-apply them.
     * Conditionally saves PiP, OSD opacity, volume step, and editor
     * settings based on capability. Calls all apply-functions after saving.
     */
    function save(): void {
        var i = 0;
        w.saveIfChanged(i++, "sStopPlay", true);
        if (typeof w.stbPlayPip === "function") {
            w.saveIfChanged(i++, "sPipSize", true);
            w.saveIfChanged(i++, "sPipPos", true);
        }
        w.saveIfChanged(i++, "sFont", true);
        w.saveIfChanged(i++, "sTimezone", true);
        w.saveIfChanged(i++, "sSleepTimeout", true);
        if (typeof w.stbSetOsdOpacity === "function")
            w.saveIfChanged(i++, "sOsdOpacity", true);
        if (
            typeof w.stbGetVolume === "function" &&
            w.sVolumeStep !== w.listArray[i++].val + 3
        ) {
            w.sVolumeStep = w.listArray[i - 1].val + 3;
            w.stbSetItem("sVolumeStep", w.sVolumeStep.toString());
        }
        i++;
        if (w.sSHLcolor !== w.eSHLcolor) {
            w.sSHLcolor = w.eSHLcolor;
            w.stbSetItem("sSHLcolor", w.sSHLcolor);
        }
        i++;
        if (w.sSHLcolSel !== w.eSHLcolSel) {
            w.sSHLcolSel = w.eSHLcolSel;
            w.stbSetItem("sSHLcolSel", w.sSHLcolSel);
        }
        i++;
        if (w.sSHLcolorB !== w.eSHLcolorB) {
            w.sSHLcolorB = w.eSHLcolorB;
            w.stbSetItem("sSHLcolorB", w.sSHLcolorB);
        }
        w.saveIfChanged(i++, "sPermanentTime", true);
        w.saveIfChanged(i++, "sGrapI", true);
        w.saveIfChanged(i++, "s10resum", true);
        w.saveIfChanged(i++, "sPrevCount", true);
        if (typeof w.getMediaArray === "function")
            w.saveIfChanged(i++, "sMedCount", true);
        if (typeof w.showEditKey2 === "function")
            w.saveIfChanged(i++, "sEditor", true);
        w.saveIfChanged(i++, "sPlayers");
        if (typeof w.stbSetBuffer === "function")
            w.saveIfChanged(i++, "sBufSize", true);
        if (typeof w.setTimezone === "function") w.setTimezone();
        if (typeof w.setFontSize === "function") w.setFontSize();
        if (typeof w.setListPos === "function") w.setListPos();
        if (typeof w.setColor === "function") w.setColor();
        if (typeof w.setEditor === "function") w.setEditor();
        if (typeof w.setPipPosBuf === "function") w.setPipPosBuf();
        if (typeof w.setPlayer === "function") w.setPlayer();
        if (typeof w.setAutorun === "function") w.setAutorun();
        if (typeof w.stbSetBuffer === "function") w.stbSetBuffer();
        if (typeof w.showShift === "function")
            w.showShift(w._("Settings saved") || "Settings saved");
        if (typeof w.closeList === "function") w.closeList();
        w.optionsList(w.settingsInterface);
    }
    var noyes = [w._("no") || "no", w._("yes") || "yes"];
    var tz = (w.arrTimezone || ["system", "0"]).slice();
    tz[0] = w._(tz[0]) || tz[0];
    w.listArray = [
        {
            name:
                w._("Black screen while switching the channel") ||
                "Black screen while switching the channel",
            val: w.sStopPlay,
            values: noyes,
        },
        {
            name: w._("PiP window size") || "PiP window size",
            val: w.sPipSize,
            values: [
                w._("small") || "small",
                w._("medium") || "medium",
                w._("large") || "large",
            ],
        },
        {
            name: w._("PiP window position") || "PiP window position",
            val: w.sPipPos,
            values: [
                w._("top-right") || "top-right",
                w._("bottom-right") || "bottom-right",
                w._("left-bottom") || "left-bottom",
                w._("top-left") || "top-left",
            ],
        },
        {
            name: w._("Font type") || "Font type",
            val: w.sFont,
            values: [
                '<span style="font-family:Helvetica, Arial, sans-serif;">' +
                    (w._("system") || "system") +
                    "</span>",
                '<span style="font-family:Roboto;">Roboto</span>',
                '<span style="font-family:RobotoCondensed;">Roboto Condensed</span>',
                '<span style="font-family:Caveat;">Caveat</span>',
                '<span style="font-family:Liberation;">Liberation</span>',
                '<span style="font-family:Gabriela;">Gabriela</span>',
                '<span style="font-family:PTSansNarrow;">PTSansNarrow</span>',
            ],
        },
        { name: w._("Timezone") || "Timezone", val: w.sTimezone, values: tz },
        {
            name: w._("Sleep timer") || "Sleep timer",
            val: w.sSleepTimeout,
            values: [
                w._("off") || "off",
                w._("30 minutes") || "30 minutes",
                w._("1 hour") || "1 hour",
                w._("2 hours") || "2 hours",
                w._("3 hours") || "3 hours",
            ],
        },
        {
            name: w._("Interface transparency") || "Interface transparency",
            val: w.sOsdOpacity,
            values: [
                "100%",
                "90%",
                "80%",
                "70%",
                "60%",
                "50%",
                "40%",
                "30%",
                "20%",
                "10%",
                "0%",
            ],
        },
        {
            name: w._("Volume step, %") || "Volume step, %",
            val: w.sVolumeStep - 3,
            values: [3, 4, 5, 6, 7, 8, 9, 10],
        },
        {
            name: w._("Color spectrum") || "Color spectrum",
            val: w.sSHLcolor,
            values: w.colorDialog,
            cur: w._("select") || "select",
        },
        {
            name:
                w._("Background color of selected item") ||
                "Background color of selected item",
            val: w.sSHLcolSel,
            values: w.selColorDialog,
            cur: w._("select") || "select",
        },
        {
            name: w._("Background color") || "Background color",
            val: w.sSHLcolorB,
            values: w.backColorDialog,
            cur: w._("select") || "select",
        },
        {
            name:
                w._("Permanent clock on screen") || "Permanent clock on screen",
            val: w.sPermanentTime,
            values: [
                w._("no") || "no",
                w._("yes") || "yes",
                w._("transparent") || "transparent",
            ],
        },
        {
            name: w._("Graphical indication") || "Graphical indication",
            val: w.sGrapI,
            values: noyes,
        },
        {
            name:
                w._("Position shift -10 seconds after pause") ||
                "Position shift -10 seconds after pause",
            val: w.s10resum,
            values: noyes,
        },
        {
            name:
                w._("Remember previous channels") ||
                "Remember previous channels",
            val: w.sPrevCount,
            values: [1, 5, 10, 15, 20],
        },
        {
            name: w._("History in Media Library") || "History in Media Library",
            val: w.sMedCount,
            values: [w._("no") || "no", 10, 20, 30, 40, 50],
        },
        {
            name: w._("Editor") || "Editor",
            val: w.sEditor,
            values: [w._("built-in") || "built-in", w._("native") || "native"],
        },
        {
            name:
                w._("Type of player for streaming") ||
                "Type of player for streaming",
            val: w.sPlayers,
            values: w.playerModeNames,
        },
        {
            name: w._("Buffer Size, s") || "Buffer Size, s",
            val: w.sBufSize,
            values: w.bufferSizes,
        },
        { name: "", val: 0, values: w.nofun || [], cur: "" },
        {
            name:
                '<div class="btn">' +
                (w._("Save Settings") || "Save Settings") +
                "</div>",
            val: 0,
            values: save,
            cur: "",
        },
    ];
    if (typeof w.stbSetBuffer === "function" && w.stbBufferSizes)
        w.listArray[18].values = w.stbBufferSizes;
    if (typeof w.stbPlayers !== "undefined" && Array.isArray(w.stbPlayers))
        w.listArray[17].values = w.stbPlayers;
    if (typeof w.showEditKey2 !== "function") w.listArray.splice(16, 1);
    if (typeof w.getMediaArray !== "function") w.listArray.splice(15, 1);
    if (typeof w.stbGetVolume !== "function") w.listArray.splice(7, 1);
    if (typeof w.stbSetOsdOpacity !== "function") w.listArray.splice(6, 1);
    if (typeof w.stbPlayPip !== "function") w.listArray.splice(1, 2);
    w.eSHLcolor = w.sSHLcolor;
    w.eSHLcolorB = w.sSHLcolorB;
    w.eSHLcolSel = w.sSHLcolSel;
    var capEl = document.getElementById("listCaption");
    if (capEl)
        capEl.innerHTML = w._("Interface settings") || "Interface settings";
    if (typeof w._setSetup === "function")
        w._setSetup(save, function () {
            w.optionsList(w.settingsInterface);
        });
};

/**
 * Show the "Infobar settings" screen.
 * Options: infobar display timeout, sliding infobar, show on switch,
 * show on program change, show on rewind, show thumbnails.
 *
 * Inner function save() persists each value.
 *
 * Side effects: Calls showShift(), closeList(); writes to stb storage.
 */
window.settingsInfobar = function (): void {
    var w = window as any;

    /** Persist infobar settings (timeout, slide, switch, change, rewind, thumbnails). */
    function save(): void {
        var i = 0;
        if (w.sInfoTimeout !== w.listArray[i++].val + 3) {
            w.sInfoTimeout = w.listArray[i - 1].val + 3;
            w.stbSetItem("sInfoTimeout", w.sInfoTimeout.toString());
        }
        w.saveIfChanged(i++, "sInfoSlide", true);
        w.saveIfChanged(i++, "sInfoSwitch", true);
        w.saveIfChanged(i++, "sInfoChange", true);
        w.saveIfChanged(i++, "sInfoRew", true);
        w.saveIfChanged(i++, "sThumbnail", true);
        if (typeof w.showShift === "function")
            w.showShift(w._("Settings saved") || "Settings saved");
        if (typeof w.closeList === "function") w.closeList();
        w.optionsList(w.settingsInfobar);
    }
    var noyes = [w._("no") || "no", w._("yes") || "yes"];
    w.listArray = [
        {
            name:
                w._("Infobar display timeout, s") ||
                "Infobar display timeout, s",
            val: w.sInfoTimeout - 3,
            values: [3, 4, 5, 6, 7, 8, 9, 10],
        },
        {
            name: w._('"Sliding" infobar') || '"Sliding" infobar',
            val: w.sInfoSlide,
            values: noyes,
        },
        {
            name: w._("Show when switching") || "Show when switching",
            val: w.sInfoSwitch,
            values: noyes,
        },
        {
            name:
                w._("Show when changing program") ||
                "Show when changing program",
            val: w.sInfoChange,
            values: noyes,
        },
        {
            name: w._("Show when rewind") || "Show when rewind",
            val: w.sInfoRew,
            values: noyes,
        },
        {
            name: w._("Show thumbnails") || "Show thumbnails",
            val: w.sThumbnail,
            values: noyes,
        },
        { name: "", val: 0, values: w.nofun || [], cur: "" },
        {
            name:
                '<div class="btn">' +
                (w._("Save Settings") || "Save Settings") +
                "</div>",
            val: 0,
            values: save,
            cur: "",
        },
    ];
    var capEl = document.getElementById("listCaption");
    if (capEl) capEl.innerHTML = w._("Infobar settings") || "Infobar settings";
    if (typeof w._setSetup === "function")
        w._setSetup(save, function () {
            w.optionsList(w.settingsInfobar);
        });
};

/**
 * Show the "Lists settings" screen.
 * Options: reduce video when list is shown, number of rows, line spacing,
 * list position (left/right), show scrollbar.
 *
 * Inner function save() persists each value and re-applies fonts and
 * positions.
 *
 * Side effects: Calls setFontSize(), setListPos(), setColor(),
 * showShift(), closeList(); writes to stb storage.
 */
window.settingsLists = function (): void {
    var w = window as any;

    /** Persist list settings (noSmall, pageSize, fontShift, listPos, showScroll) and re-apply. */
    function save(): void {
        var i = 0;
        w.saveIfChanged(i++, "sNoSmall", true);
        if (w.sPageSize !== w.listArray[i++].val + 10) {
            w.sPageSize = w.listArray[i - 1].val + 10;
            w.stbSetItem("sPageSize", w.sPageSize.toString());
        }
        w.saveIfChanged(i++, "sFontShift", true);
        w.saveIfChanged(i++, "sListPos", true);
        w.saveIfChanged(i++, "sShowScroll", true);
        if (typeof w.setFontSize === "function") w.setFontSize();
        if (typeof w.setListPos === "function") w.setListPos();
        if (typeof w.setColor === "function") w.setColor();
        if (typeof w.showShift === "function")
            w.showShift(w._("Settings saved") || "Settings saved");
        if (typeof w.closeList === "function") w.closeList();
        w.optionsList(w.settingsLists);
    }
    var noyes = [w._("no") || "no", w._("yes") || "yes"];
    w.listArray = [
        {
            name:
                w._("Not reduce video when showing the list (bugfix)") ||
                "Not reduce video when showing the list (bugfix)",
            val: w.sNoSmall,
            values: noyes,
        },
        {
            name: w._("Number of rows in lists") || "Number of rows in lists",
            val: w.sPageSize - 10,
            values: [
                10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
                26, 27, 28, 29, 30,
            ],
        },
        {
            name:
                w._("Distance between lines in lists") ||
                "Distance between lines in lists",
            val: w.sFontShift,
            values: [
                "0",
                1,
                2,
                3,
                4,
                5,
                6,
                7,
                8,
                9,
                10,
                11,
                12,
                13,
                14,
                15,
                16,
                17,
                18,
                19,
                20,
                21,
                22,
                23,
                24,
                25,
                26,
                27,
                28,
                29,
                30,
            ],
        },
        {
            name: w._("List location") || "List location",
            val: w.sListPos,
            values: [w._("right") || "right", w._("left") || "left"],
        },
        {
            name: w._("Show scrollbar in list") || "Show scrollbar in list",
            val: w.sShowScroll,
            values: noyes,
        },
        { name: "", val: 0, values: w.nofun || [], cur: "" },
        {
            name:
                '<div class="btn">' +
                (w._("Save Settings") || "Save Settings") +
                "</div>",
            val: 0,
            values: save,
            cur: "",
        },
    ];
    var capEl = document.getElementById("listCaption");
    if (capEl) capEl.innerHTML = w._("Lists settings") || "Lists settings";
    if (typeof w._setSetup === "function")
        w._setSetup(save, function () {
            w.optionsList(w.settingsLists);
        });
};

/**
 * Show the "Channel list settings" screen.
 * Options: show number, picons, channel name, program name, progress bar,
 * archive indicator, description, preview mode, next programs count,
 * editing style (categories vs. favorites).
 *
 * Inner function save() persists each value.
 *
 * Side effects: Calls showShift(), closeList(); writes to provider/storage.
 */
window.settingsChannels = function (): void {
    var w = window as any;

    /** Persist channel list display settings (showNum, showPikon, showName, etc.). */
    function save(): void {
        var i = 0;
        w.saveIfChanged(i++, "sShowNum");
        w.saveIfChanged(i++, "sShowPikon");
        w.saveIfChanged(i++, "sShowName");
        w.saveIfChanged(i++, "sShowProgram");
        w.saveIfChanged(i++, "sShowProgress");
        w.saveIfChanged(i++, "sShowArchive");
        w.saveIfChanged(i++, "sShowDescr");
        w.saveIfChanged(i++, "sPreview");
        if (w.sNextCountL !== w.listArray[i++].val) {
            w.sNextCountL = w.listArray[i - 1].val;
            w.sNextCount = w.sNextCountL ? w.sNextCountL - 1 : 0;
            w.providerSetItem("sNextCount", (w.sNextCountL - 1).toString());
        }
        w.saveIfChanged(i++, "sFavorites", true);
        if (typeof w.showShift === "function")
            w.showShift(w._("Settings saved") || "Settings saved");
        if (typeof w.closeList === "function") w.closeList();
        w.optionsList(w.settingsChannels);
    }
    var noyes = [w._("no") || "no", w._("yes") || "yes"];
    w.listArray = [
        {
            name:
                w._("Show channel number in list") ||
                "Show channel number in list",
            val: w.sShowNum,
            values: noyes,
        },
        {
            name:
                w._("Show picons in channel list") ||
                "Show picons in channel list",
            val: w.sShowPikon,
            values: [w._("no") || "no", "1x1", "3x4"],
        },
        {
            name:
                w._("Show channel name in list") || "Show channel name in list",
            val: w.sShowName,
            values: noyes,
        },
        {
            name: w._("Show program name") || "Show program name",
            val: w.sShowProgram,
            values: noyes,
        },
        {
            name:
                w._("Show progress in channel list") ||
                "Show progress in channel list",
            val: w.sShowProgress,
            values: noyes,
        },
        {
            name:
                w._("Show archive availability in list") ||
                "Show archive availability in list",
            val: w.sShowArchive,
            values: noyes,
        },
        {
            name: w._("Show description") || "Show description",
            val: w.sShowDescr,
            values: noyes,
        },
        {
            name: w._("Preview in channel list") || "Preview in channel list",
            val: w.sPreview,
            values: [
                w._("no") || "no",
                w._("always") || "always",
                w._("on ") || "on " + (w.strENTER || "ENTER"),
            ],
        },
        {
            name:
                w._("Number of next TV programs in channel list") ||
                "Number of next TV programs in channel list",
            val: w.sNextCountL,
            values: [w._("no") || "no", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        },
        {
            name:
                w._("Channel list editing style") ||
                "Channel list editing style",
            val: w.sFavorites !== -1 ? w.sFavorites : w.nofun || [],
            values:
                w.sFavorites !== -1
                    ? [
                          w._("All categories") || "All categories",
                          w._('"Favorites"') || '"Favorites"',
                      ]
                    : '<span style="color:gray;">' +
                      (w._('"Favorites"') || '"Favorites"') +
                      "</span>",
        },
        { name: "", val: 0, values: w.nofun || [], cur: "" },
        {
            name:
                '<div class="btn">' +
                (w._("Save Settings") || "Save Settings") +
                "</div>",
            val: 0,
            values: save,
            cur: "",
        },
    ];
    var capEl = document.getElementById("listCaption");
    if (capEl)
        capEl.innerHTML =
            w._("Channel list settings") || "Channel list settings";
    if (typeof w._setSetup === "function")
        w._setSetup(save, function () {
            w.optionsList(w.settingsChannels);
        });
};

/**
 * Show the "Buttons settings" screen.
 * Configures behaviour of arrow keys, RW/FF, PREV/NEXT, colour buttons,
 * RETURN, ENTER, and number-row seek step durations.
 * Dynamically removes rows for hardware keys that don't exist.
 *
 * Inner function save() persists each value.
 *
 * Side effects: Calls showShift(), closeList(); writes to stb storage.
 */
window.settingsButtons = function (): void {
    var w = window as any;

    /** Persist button mapping settings (arrow fun, rewind fun, colour buttons, seek steps). */
    function save(): void {
        var i = 0;
        w.saveIfChanged(i++, "sArrowFun", true);
        if (w.keys.RW) w.saveIfChanged(i++, "sRewFun", true);
        if (w.keys.PREV) w.saveIfChanged(i++, "sPNFun", true);
        w.saveIfChanged(i++, "sALfun", true);
        w.saveIfChanged(i++, "sARfun", true);
        w.saveIfChanged(i++, "sAUfun", true);
        w.saveIfChanged(i++, "sADfun", true);
        if (w.keys.RW) w.saveIfChanged(i++, "sRWfun", true);
        if (w.keys.RW) w.saveIfChanged(i++, "sFFfun", true);
        if (w.keys.PREV) w.saveIfChanged(i++, "sPREVfun", true);
        if (w.keys.PREV) w.saveIfChanged(i++, "sNEXTfun", true);
        if (!w.sNoColorKeys) {
            w.saveIfChanged(i++, "sRfun", true);
            w.saveIfChanged(i++, "sGfun", true);
            w.saveIfChanged(i++, "sYfun", true);
            w.saveIfChanged(i++, "sBfun", true);
        }
        w.saveIfChanged(i++, "sEfun", true);
        w.saveIfChanged(i++, "sOkfun", true);
        if (!w.sNoNumbersKeys) {
            w.listArray[i].val = d.indexOf(w.listArray[i].val);
            w.saveIfChanged(i++, "s13dur", true);
            w.listArray[i].val = d.indexOf(w.listArray[i].val);
            w.saveIfChanged(i++, "s46dur", true);
            w.listArray[i].val = d.indexOf(w.listArray[i].val);
            w.saveIfChanged(i++, "s79dur", true);
        }
        w.saveIfChanged(i++, "sNoColorKeys", true);
        w.saveIfChanged(i++, "sNoNumbersKeys", true);
        if (typeof w.showShift === "function")
            w.showShift(w._("Settings saved") || "Settings saved");
        if (typeof w.closeList === "function") w.closeList();
        w.optionsList(w.settingsButtons);
    }
    var r = "Behavior of %1/%2 buttons in lists";
    var s = "Button %1 function when viewing";
    var n = "Rewind step by buttons %1/%2";
    var ia = '<div class="btn';
    var a = ia + '">';
    var o = "</div>";
    var l = '">&nbsp;' + o;
    var c = [
        w._("paging") || "paging",
        w._("volume") || "volume",
        "dune-php",
        "neutrino",
    ];
    var u = [
        w._("Records") || "Records",
        w._("Menu") || "Menu",
        w._("Previous") || "Previous",
        w._("Rewind") || "Rewind",
        w._("Info") || "Info",
        w._("Aspect") || "Aspect",
        w._("Audio") || "Audio",
        "PiP",
        w._("Close PiP") || "Close PiP",
        w._("Category") || "Category",
        w._("EPG") || "EPG",
        w._("Media") || "Media",
        w._("Joystick") || "Joystick",
        "V+",
        "V-",
        "P+",
        "P-",
        w._("Subtitle") || "Subtitle",
        "-1 " + (w._(" m ") || " m ").trim(),
        "+1 " + (w._(" m ") || " m ").trim(),
        w._("Prev") || "Prev",
        w._("Next") || "Next",
    ];
    var d = [
        5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 3600,
    ];
    var p = d.map(function (e: number) {
        return typeof w.step2text === "function"
            ? w.step2text(e).substr(2).trim()
            : e.toString();
    });
    if (typeof w.stbToggleAspectRatio !== "function") u[5] = "@@@";
    if (typeof w.stbToggleAudioTrack !== "function") u[6] = "@@@";
    if (typeof w.stbPlayPip !== "function") {
        u[7] = "@@@";
        u[8] = "@@@";
    }
    if (typeof w.stbGetVolume !== "function") {
        u[13] = "@@@";
        u[14] = "@@@";
        c[1] = "@@@";
    }
    if (typeof w.stbToggleSubtitle !== "function") u[17] = "@@@";
    var noyes = [w._("no") || "no", w._("yes") || "yes"];
    w.listArray = [
        {
            name: w._(
                r,
                a + (w.strLEFT || "L") + o,
                a + (w.strRIGHT || "R") + o
            ),
            val: w.sArrowFun,
            values: c,
        },
        {
            name: w._(r, a + (w.strRW || "RW") + o, a + (w.strFF || "FF") + o),
            val: w.sRewFun,
            values: [w._("paging") || "paging", "dune-php", "neutrino"],
        },
        {
            name: w._(
                r,
                a + (w.strPREV || "PREV") + o,
                a + (w.strNEXT || "NEXT") + o
            ),
            val: w.sPNFun,
            values: [
                w._("paging") || "paging",
                "dune-php",
                "neutrino",
                w._("begin/end") || "begin/end",
            ],
        },
        { name: w._(s, a + (w.strLEFT || "L") + o), val: w.sALfun, values: u },
        { name: w._(s, a + (w.strRIGHT || "R") + o), val: w.sARfun, values: u },
        { name: w._(s, a + (w.strUP || "U") + o), val: w.sAUfun, values: u },
        { name: w._(s, a + (w.strDOWN || "D") + o), val: w.sADfun, values: u },
        { name: w._(s, a + (w.strRW || "RW") + o), val: w.sRWfun, values: u },
        { name: w._(s, a + (w.strFF || "FF") + o), val: w.sFFfun, values: u },
        {
            name: w._(s, a + (w.strPREV || "PREV") + o),
            val: w.sPREVfun,
            values: u,
        },
        {
            name: w._(s, a + (w.strNEXT || "NEXT") + o),
            val: w.sNEXTfun,
            values: u,
        },
        { name: w._(s, ia + " red" + l), val: w.sRfun, values: u },
        { name: w._(s, ia + " green" + l), val: w.sGfun, values: u },
        { name: w._(s, ia + " yellow" + l), val: w.sYfun, values: u },
        { name: w._(s, ia + " blue" + l), val: w.sBfun, values: u },
        {
            name: w._(s, a + (w.strRETURN || "RET") + o),
            val: w.sEfun,
            values: [
                w._("Nothing") || "Nothing",
                w._("Exit") || "Exit",
                w._("Joystick") || "Joystick",
                w._("Menu") || "Menu",
                w._("Previous") || "Previous",
            ],
        },
        {
            name: w._(
                "Button function %1 when viewing archive",
                a + (w.strENTER || "ENTER") + o
            ),
            val: w.sOkfun,
            values: [w._("EPG") || "EPG", w._("Channels") || "Channels"],
        },
        {
            name: w._(n, a + 1 + o, a + 3 + o),
            val: d.indexOf(w.s13dur),
            values: p,
        },
        {
            name: w._(n, a + 4 + o, a + 6 + o),
            val: d.indexOf(w.s46dur),
            values: p,
        },
        {
            name: w._(n, a + 7 + o, a + 9 + o),
            val: d.indexOf(w.s79dur),
            values: p,
        },
        {
            name:
                w._("Remote (color buttons N/A)") ||
                "Remote (color buttons N/A)",
            val: w.sNoColorKeys,
            values: noyes,
        },
        {
            name:
                w._("Remote (number buttons N/A)") ||
                "Remote (number buttons N/A)",
            val: w.sNoNumbersKeys,
            values: noyes,
        },
        { name: "", val: 0, values: w.nofun || [], cur: "" },
        {
            name: a + (w._("Save Settings") || "Save Settings") + o,
            val: 0,
            values: save,
            cur: "",
        },
    ];
    if (w.sNoNumbersKeys) w.listArray.splice(17, 3);
    if (w.sNoColorKeys) w.listArray.splice(11, 4);
    if (!w.keys.PREV) w.listArray.splice(9, 2);
    if (!w.keys.RW) w.listArray.splice(7, 2);
    if (!w.keys.PREV) w.listArray.splice(2, 1);
    if (!w.keys.RW) w.listArray.splice(1, 1);
    var capEl = document.getElementById("listCaption");
    if (capEl) capEl.innerHTML = w._("Buttons settings") || "Buttons settings";
    if (typeof w._setSetup === "function")
        w._setSetup(save, function () {
            w.optionsList(w.settingsButtons);
        });
};

/**
 * Show the "Menu items settings" screen.
 * Allows the user to show/hide individual popup menu items by toggling
 * a yes/no value per entry.
 *
 * Inner function save() builds sHideMenus array and persists it.
 *
 * Side effects: Writes 'sHideMenus' to stb storage; calls showShift().
 */
window.settingsMenu = function (): void {
    var w = window as any;

    /** Build the sHideMenus array from toggled list items and persist it. */
    function save(): void {
        w.sHideMenus = [];
        for (var i = 0; i < w.popupActions.indexOf(w.noProvParam); i++) {
            if (w.listArray[i].val) w.sHideMenus.push(w.popupActions[i].name);
        }
        if (typeof w.stbSetItem === "function")
            w.stbSetItem("sHideMenus", w.sHideMenus.join(","));
        if (typeof w.showShift === "function")
            w.showShift(w._("Settings saved") || "Settings saved");
        w.optionsList(w.settingsMenu);
    }
    var noyes = [w._("yes") || "yes", w._("no") || "no"];
    w.listArray = [];
    for (var i = 0; i < w.popupActions.indexOf(w.noProvParam); i++) {
        w.listArray.push({
            name: w._(w.popupArray[i]),
            val:
                (w.sHideMenus || []).indexOf(w.popupActions[i].name) === -1
                    ? 0
                    : 1,
            values: noyes,
        });
    }
    w.listArray.push({ name: "", val: 0, values: w.nofun || [], cur: "" });
    w.listArray.push({
        name:
            '<div class="btn">' +
            (w._("Save Settings") || "Save Settings") +
            "</div>",
        val: 0,
        values: save,
        cur: "",
    });
    var capEl = document.getElementById("listCaption");
    if (capEl)
        capEl.innerHTML = w._("Select menu items") || "Select menu items";
    if (typeof w._setSetup === "function")
        w._setSetup(save, function () {
            w.optionsList(w.settingsMenu);
        });
};

/**
 * Show the "Manage settings" screen.
 * Options: save settings (cloud), load settings (cloud), clear settings,
 * enter provider code, enter provider code (remote).
 * Dynamically adds/removes entries based on available capabilities
 * (stbClearAllItems, stbGetAllItems, loadOpt, saveOpt).
 *
 * Inner function clearSettings() confirms then clears all items and
 * restarts.
 *
 * Side effects: Calls restart() on clear; writes to storage.
 */
window.settingsManage = function (): void {
    var w = window as any;
    /**
     * Prompt the user to confirm, then clear all stb storage items and
     * restart the player.
     *
     * Side effects: Calls stbClearAllItems() then restart().
     */
    function clearSettings(): void {
        if (typeof w.confirmBox === "function") {
            w.confirmBox("Clear all settings?", function () {
                try {
                    if (typeof w.stbClearAllItems === "function")
                        w.stbClearAllItems();
                } catch (e) {
                    console.error(e);
                }
                if (typeof w.restart === "function") w.restart();
            });
        }
    }
    w.listArray = [
        {
            action: w.cloudSendSettings,
            name: w._("Save settings") || "Save settings",
        },
        {
            action: w.cloudLoadSettings,
            name: w._("Load settings") || "Load settings",
        },
        { action: w.nofun || function () {}, name: "" },
        {
            action: clearSettings,
            name: w._("Clear settings") || "Clear settings",
        },
        { action: w.nofun || function () {}, name: "" },
        {
            action: w.edit_dealer,
            name: w._("Enter Provider Code") || "Enter Provider Code",
        },
        {
            action: w.edit_dealer_remote,
            name:
                w._("Enter Provider Code on PC or Phone") ||
                "Enter Provider Code on PC or Phone",
        },
    ];
    if (typeof w.stbClearAllItems !== "function") w.listArray.splice(2, 2);
    if (typeof w.stbGetAllItems !== "function") w.listArray.splice(0, 1);
    if (typeof w.loadOpt === "function")
        w.listArray.splice(0, 0, {
            action: w.loadOpt,
            name:
                w._("Load settings from storage") ||
                "Load settings from storage",
        });
    if (typeof w.saveOpt === "function")
        w.listArray.splice(0, 0, {
            action: w.saveOpt,
            name: w._("Save settings to storage") || "Save settings to storage",
        });
    w.selIndex = 0;
    w.getListItem = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + (item.name || "");
    };
    w.detailListActionFn = function () {};
    w.detailListAction = function () {
        var detailEl = document.getElementById("listDetail");
        if (detailEl)
            detailEl.innerHTML = w._(
                w.listArray[w.selIndex].desc ||
                    w.listArray[w.selIndex].name ||
                    ""
            );
    };
    w.listKeyHandlerFn = function (key: number): boolean {
        switch (key) {
            case w.keys.RETURN:
                w.optionsList(w.settingsManage);
                return true;
            case w.keys.ENTER:
                if (w.listArray[w.selIndex].action)
                    w.listArray[w.selIndex].action();
                return true;
        }
        return false;
    };
    var capEl = document.getElementById("listCaption");
    if (capEl) capEl.innerHTML = w._("Manage settings") || "Manage settings";
    var podEl = document.getElementById("listPodval");
    if (podEl) podEl.innerHTML = w.btnDiv(w.keys.RETURN, w.strRETURN, "Close");
    if (typeof jQuery !== "undefined") jQuery("#listPopUp").hide();
    w.listDataArray = w.listArray;
    if (typeof w.showPage === "function") w.showPage();
};

// Cloud-based send/load settings (from original stbPlayer.js)

/**
 * Upload current settings to the cloud service (host_ott/swop/a.php).
 * Serialises all stb storage items as XML properties, POSTs them,
 * and displays a QR code + code for download on another device.
 *
 * Inner function cleanup() clears the 10-minute timeout and hides the
 * overlay.
 *
 * Side effects: AJAX POST; DOM mutations to #listAbout; sets
 * window.aboutKeyHandler.
 *
 * Edge case: Returns early if host_ott / host_ott_proto are not set
 * (non-STB environment).
 */
window.cloudSendSettings = function (): void {
    var w = window as any;
    /**
     * Cancel the cloud send operation and hide the about overlay.
     * Called on success, error, user cancel, or 10-minute timeout.
     */
    function cleanup() {
        clearTimeout(timer);
        if (typeof jQuery !== "undefined") jQuery("#listAbout").hide();
    }
    var timer = setTimeout(cleanup, 600000);
    if (
        typeof w.host_ott === "undefined" ||
        typeof w.host_ott_proto === "undefined"
    ) {
        if (typeof jQuery !== "undefined") {
            jQuery("#listAbout")
                .html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>Cloud save/load requires STB firmware (host_ott not set)</div>'
                )
                .show();
        }
        return;
    }
    if (typeof jQuery !== "undefined") {
        jQuery("#listAbout")
            .html(
                '<div style="text-align:center;font-size:larger;"><br/><br/>' +
                    (w._("Send settings") || "Send settings") +
                    "...</div>"
            )
            .show();
    }
    w.aboutKeyHandler = function (e: number): boolean {
        if (e === w.keys.RETURN || e === w.keys.EXIT) cleanup();
        return true;
    };
    var xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">\n<properties>\n<comment>OTT-Play Preferences</comment>';
    var items =
        typeof w.stbGetAllItems === "function" ? w.stbGetAllItems() : {};
    for (var prop in items) {
        if (Object.prototype.hasOwnProperty.call(items, prop))
            xml += '\n<entry key="' + prop + '">' + items[prop] + "</entry>";
    }
    xml += "\n</properties>";
    if (typeof jQuery !== "undefined") {
        jQuery.ajax({
            url: w.host_ott_proto + w.host_ott + "/swop/a.php",
            data: { c: "send", d: xml },
            type: "POST",
            timeout: 10000,
            cache: false,
            success: function (data: any) {
                cleanup();
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;"><br/>' +
                        (w._("Settings sended!") || "Settings sended!") +
                        "<br/><br/>" +
                        (w._("For download settings file open") ||
                            "For download settings file open") +
                        '<br/><span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        w.host_ott +
                        "/swop</span> " +
                        (w._("and enter code") || "and enter code") +
                        ' <span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        data.code +
                        "</span><br/><br/>" +
                        (w._("or scan") || "or scan") +
                        ':<br/><br/><div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://' +
                        w.host_ott +
                        "/swop/?" +
                        data.code +
                        '" style="height:30%;"/></div></div>'
                );
            },
            error: function (jqXHR: any) {
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                        jqXHR.responseText +
                        "</div>"
                );
            },
        });
    }
};

/**
 * Download settings from the cloud service by polling for a user-entered
 * code. Displays a QR code, polls the server every 5-10s, and when the
 * settings XML arrives, clears all current items and restores the received
 * values.
 *
 * Inner functions:
 * - cleanup(): Cancels polling and hides overlay.
 * - poll(): AJAX GET to check if code has been submitted.
 *
 * Side effects: AJAX POST/GET; DOM mutations to #listAbout; calls
 * stbClearAllItems() and stbSetItem() for each restored entry; calls
 * restart() on success.
 *
 * Edge case: Validates that the received XML contains the expected
 * "<comment>OTT-Play Preferences</comment>" marker.
 */
window.cloudLoadSettings = function (): void {
    var w = window as any;
    var cancelled = false;
    var code: string;
    /**
     * Cancel the cloud load operation and hide the about overlay.
     * Sets cancelled flag to stop polling.
     */
    function cleanup() {
        clearTimeout(timer);
        cancelled = true;
        if (typeof jQuery !== "undefined") jQuery("#listAbout").hide();
    }
    var timer = setTimeout(cleanup, 600000);
    if (
        typeof w.host_ott === "undefined" ||
        typeof w.host_ott_proto === "undefined"
    ) {
        if (typeof jQuery !== "undefined") {
            jQuery("#listAbout")
                .html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>Cloud save/load requires STB firmware (host_ott not set)</div>'
                )
                .show();
        }
        return;
    }
    /**
     * Poll the cloud server for the submitted settings code.
     * On 'forbidden' status, retries after 5s. On 'success', validates
     * the XML format and restores all settings.
     *
     * Side effects: AJAX POST; may call stbClearAllItems(), stbSetItem()
     * for each restored entry, and restart() on completion.
     */
    function poll() {
        if (cancelled) return;
        if (typeof jQuery !== "undefined") {
            jQuery.ajax({
                url: w.host_ott_proto + w.host_ott + "/swop/a.php",
                data: { c: "get", d: code },
                type: "POST",
                timeout: 10000,
                cache: false,
                success: function (data: any) {
                    if (cancelled) return;
                    if (data.status === "forbidden") setTimeout(poll, 5000);
                    else if (data.status === "success") {
                        var xml = data.data;
                        if (
                            xml.indexOf(
                                "<comment>OTT-Play Preferences</comment>"
                            ) !== -1
                        ) {
                            if (typeof jQuery !== "undefined")
                                jQuery("#listAbout").html(
                                    '<div style="text-align:center;font-size:200%;"><br/><br/>OTT-Play Preferences received!<br/>Restart player...</div>'
                                );
                            var entries = xml.split('<entry key="');
                            entries.shift();
                            try {
                                if (typeof w.stbClearAllItems === "function")
                                    w.stbClearAllItems();
                            } catch (e) {
                                console.error(e);
                            }
                            entries.forEach(function (entry: string) {
                                var parts = entry
                                    .split("</entry>")[0]
                                    .split('">');
                                if (typeof w.stbSetItem === "function")
                                    w.stbSetItem(parts[0], parts[1]);
                            });
                            if (typeof w.restart === "function") w.restart();
                        } else {
                            if (typeof jQuery !== "undefined")
                                jQuery("#listAbout").html(
                                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>File not OTT-Play Preferences!!!</div>'
                                );
                        }
                    }
                },
                error: function (jqXHR: any) {
                    if (typeof jQuery !== "undefined")
                        jQuery("#listAbout").html(
                            '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                                jqXHR.responseText +
                                "</div>"
                        );
                },
            });
        }
    }
    if (typeof jQuery !== "undefined") {
        jQuery("#listAbout")
            .html(
                '<div style="text-align:center;font-size:larger;"><br/><br/>' +
                    (w._("Send request") || "Send request") +
                    "...</div>"
            )
            .show();
    }
    w.aboutKeyHandler = function (e: number): boolean {
        if (e === w.keys.RETURN || e === w.keys.EXIT) cleanup();
        return true;
    };
    if (typeof jQuery !== "undefined") {
        jQuery.ajax({
            url: w.host_ott_proto + w.host_ott + "/swop/a.php",
            data: { c: "get_code" },
            type: "POST",
            timeout: 10000,
            cache: false,
            success: function (data: any) {
                code = data.code;
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;"><br/>' +
                        (w._("Request sended!") || "Request sended!") +
                        "<br/><br/>" +
                        (w._("For upload settings file open") ||
                            "For upload settings file open") +
                        '<br/><span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        w.host_ott +
                        "/swop</span> " +
                        (w._("and enter code") || "and enter code") +
                        ' <span style="font-size:larger;color:' +
                        w.curColor +
                        '">' +
                        code +
                        "</span><br/><br/>" +
                        (w._("or scan") || "or scan") +
                        ':<br/><br/><div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://' +
                        w.host_ott +
                        "/swop/?" +
                        code +
                        '" style="height:30%;"/></div></div>'
                );
                setTimeout(poll, 10000);
            },
            error: function (jqXHR: any) {
                jQuery("#listAbout").html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                        jqXHR.responseText +
                        "</div>"
                );
            },
        });
    }
};

// Window aliases for imported functions needed by settings functions
window.edit_dealer = edit_dealer;
window.edit_dealer_remote = edit_dealer_remote;

window._enterPinCode = _enterPinCode;
window.enterPinCode = enterPinCode;
window.enterPinAndSetAccess = enterPinAndSetAccess;
window.setParentAccess = setParentAccess;
window.parentControlSetup = parentControlSetup;

/* ---------------------------------------------------------------------------
 * Channel list popup helpers
 * --------------------------------------------------------------------------- */

/**
 * Preview a channel in the video area (used when sPreview=1 in channel
 * lists). Stops current playback and starts the new channel URL after
 * a 500ms debounce delay.
 *
 * @param chId - The channel ID string to preview.
 *
 * Side effects: Calls stbStop(), then stbPlay(getChannelUrl(chId)) after
 * a timeout. Updates previewChan. Clears previous previewTimer.
 */
window.previewChId = function (chId: number): void {
    var w = window as any;
    if (w.previewChan && w.previewChan.ch_id === chId) return;
    clearTimeout(w.previewTimer);
    if (
        typeof w.ifParentalAccessChId === "function" &&
        w.ifParentalAccessChId(chId, function () {
            w.previewChId(chId);
        })
    )
        return;
    w.previewTimer = setTimeout(function () {
        if (w.sStopPlay && typeof w.stbStop === "function") w.stbStop();
        w.previewChan = { c: 0, i: 0, ch_id: chId };
        if (typeof w.stbPlay === "function")
            w.stbPlay(
                typeof w.getChannelUrl === "function"
                    ? w.getChannelUrl(chId)
                    : null
            );
    }, 500);
};

/**
 * Add the currently selected channel to either the Favorites list or to
 * another category. In "Favorites" mode, directly pushes the channel.
 * In category mode, shows a sub-list of categories to choose from.
 *
 * Side effects: Mutates cats[favorites] or cats[selectedCategory];
 * calls saveChannelsCats(), showShift(); DOM mutations to listCaption,
 * listPodval; saves/restores CPD.
 *
 * Edge case: Returns early if sFavorites and !listCatIndex.
 */
window.addChannel2bucket = function (): void {
    var w = window as any;
    var idx = w.selIndex;
    var chId = w.listArray[idx];
    if (w.sFavorites) {
        if (!w.listCatIndex) return;
        w.cats[w._("Favorites") || "Favorites"].push(chId);
        if (typeof w.saveChannelsCats === "function") w.saveChannelsCats();
        if (typeof w.showShift === "function")
            w.showShift(
                (w._("Channel ") || "Channel ") +
                    (w.chanels && w.chanels[chId]
                        ? w.chanels[chId].channel_name
                        : "") +
                    (w._(" added to favorites") || " added to favorites")
            );
    } else {
        if (typeof w.saveCPD === "function") w.saveCPD();
        var savedIdx = w.selIndex;
        var savedList = w.listArray;
        var savedGetListItem = w.getListItem;
        var savedDetailListAction = w.detailListAction;
        var savedListKeyHandler = w.listKeyHandlerFn;
        var popupVisible =
            typeof $ !== "undefined" && $("#listPopUp").is(":visible");
        w.selIndex = 0;
        w.listArray = w.catsArray.slice(1);
        w.getListItem = function (item: any, _idx: number): string {
            return "&nbsp;&nbsp;" + item;
        };
        w.detailListAction = function (): void {};
        w.listKeyHandlerFn = function (e: number): boolean {
            switch (e) {
                case w.keys.ENTER:
                    w.cats[w.listArray[w.selIndex]].push(chId);
                    if (typeof w.saveChannelsCats === "function")
                        w.saveChannelsCats();
                    if (typeof w.showShift === "function")
                        w.showShift(
                            (w._("Channel ") || "Channel ") +
                                (w.chanels && w.chanels[chId]
                                    ? w.chanels[chId].channel_name
                                    : "") +
                                (w._(" added to category ") ||
                                    " added to category ") +
                                w.listArray[w.selIndex]
                        );
                    break;
                case w.keys.RETURN:
                    break;
                default:
                    return false;
            }
            if (typeof w.restoreCPD === "function") w.restoreCPD();
            w.selIndex = savedIdx;
            w.listArray = savedList;
            w.getListItem = savedGetListItem;
            w.detailListAction = savedDetailListAction;
            w.listKeyHandlerFn = savedListKeyHandler;
            if (typeof w.showPage === "function") w.showPage();
            if (popupVisible && typeof $ !== "undefined")
                $("#listPopUp").show();
            return true;
        };
        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML =
                w._("Select category to add channel") ||
                "Select category to add channel";
        var podvalEl = document.getElementById("listPodval");
        if (podvalEl)
            podvalEl.innerHTML = w.btnDiv(w.keys.RETURN, w.strRETURN, "Close");
        if (typeof $ !== "undefined") $("#listPopUp").hide();
        if (typeof w.showPage === "function") w.showPage();
    }
};

/**
 * Toggle parental control on the currently selected channel.
 * Adds/removes the channel ID from parentalArray.
 * Requires parental PIN access.
 *
 * Side effects: Mutates parentalArray; calls providerSetItem() to persist;
 * calls showPage() to re-render the list.
 */
window.parentChannel = function (): void {
    var w = window as any;
    if (!w.sPSchannels || w.parentPIN === "*") return;
    if (!w.parentAccess) {
        if (typeof w.enterPinAndSetAccess === "function")
            w.enterPinAndSetAccess(w.parentChannel);
        return;
    }
    var chId = w.listArray[w.selIndex];
    var pos = w.parentalArray.indexOf(chId);
    if (pos === -1) w.parentalArray.push(chId);
    else w.parentalArray.splice(pos, 1);
    if (typeof w.providerSetItem === "function")
        w.providerSetItem("parentalArray", JSON.stringify(w.parentalArray));
    if (typeof w.showPage === "function") w.showPage();
};
window.stbToggleZoom = stbToggleZoom;
window.stbCSS = stbCSS;
window.stbInit = stbInit;
window.stbExit = stbExit;
window.setPlayer = setPlayer;
window.stbGetItem = stbGetItem;
window.stbSetItem = stbSetItem;
window.stbDelItem = stbDelItem;
window.stbClearAllItems = stbClearAllItems;
window.stbGetAllItems = stbGetAllItems;
window.providerGetItem = providerGetItem;
window.providerSetItem = providerSetItem;
window.providerHasItem = providerHasItem;
window.providerHasItemValue = providerHasItemValue;
window.providerDelItem = providerDelItem;
window._ = translate;
window.saveAllOptions = saveAllOptions;
window.loadAllOptions = loadAllOptions;
window.saveOpt = saveAllOptions;
window.loadOpt = loadAllOptions;
window.body_onUnload = body_onUnload;
window.playArchive = playArchiveMode;
window.checkMedia = checkMedia;
window.setCurrent = setCurrent;
window.nextChannel = nextChannel;
window.prevChannel = prevChannel;
window.handleNumberInput = handleNumberInput;
window.getChannelUrl = getChannelUrl;
window.addToFavorites = addToFavorites;
window.removeFromFavorites = removeFromFavorites;
window.saveChannelsCats = saveChannelsCats;
window.epgList = epgList;
window.updateArchiveInfo = updateArchiveInfo;
window.initBackgroundIntervals = initBackgroundIntervals;
window.btnDiv = btnDiv;
window.setPipPosition = setPipPosition;
window.getPipPosition = setPipPosition;
window.setSleepTimeout = setSleepTimeout;
window.setEditor = setEditor;
window.setColor = setColor;
window.setListPos = setListPos;
window.setFontSize = setFontSize;
window.setTimezone = setTimezone;
window.saveCPD = saveCPD;
window.restoreCPD = restoreCPD;
window.getMacAddress = getMacAddress;
// client_feedb and PostFeedback from helpers.ts already global
// pperf_stamp from helpers.ts already global
window.ottpStorage = storage;
window.lzstring = {
    compress: (window as any).compress,
    decompress: (window as any).decompress,
    compressToBase64: (window as any).compressToBase64,
    decompressFromBase64: (window as any).decompressFromBase64,
    compressToUTF16: (window as any).compressToUTF16,
    decompressFromUTF16: (window as any).decompressFromUTF16,
    compressToEncodedURIComponent: (window as any)
        .compressToEncodedURIComponent,
    decompressFromEncodedURIComponent: (window as any)
        .decompressFromEncodedURIComponent,
    compressToUint8Array: (window as any).compressToUint8Array,
    decompressFromUint8Array: (window as any).decompressFromUint8Array,
};
window.channels = channels;
window.cats = cats;
window.catsArray = catsArray;
window.curList = curList;
window.catIndex = catIndex;
window.primaryIndex = primaryIndex;
window.prevArr = prevArr;
window.favoritesArray = favoritesArray;
window.parentalArray = parentalArray;
window.playType = playType;
window.playTime = playTime;
window.settings = settings;
window.parentPIN = parentPIN;
window.hideMenus = hideMenus;
window.pageSize = pageSize;
window.listDataArray = listDataArray;
window.listSelectionIndex = listSelectionIndex;
window.popupActions = popupActions;
window.popupList = popupList;
window.noProvParam = noProvParam;
window.popupArray = popupArray;
window.popupDetail = popupDetail;
window.pipIndex = pipIndex;
window.pipCatIndex = pipCatIndex;
window.previewChan = previewChan;
window.playerModeNames = playerModeNames;
window.bufferSizes = bufferSizes;
window.colorDialog = colorDialog;
window.selColorDialog = selColorDialog;
window.backColorDialog = backColorDialog;
window.optionsList = optionsList;
window.restart = restart;
window.step2text = step2text;
window.nofun = nofun;
window.toggleAspectRatio = toggleAspectRatio;
window.toggleZoom = toggleZoom;
window.toggleAudioTrack = toggleAudioTrack;
window.toggleSubtitle = toggleSubtitle;
window.popPrevProg = popPrevProg;
window.popPause = popPause;
window.popStop = popStop;
window.popShift = popShift;
window.popTogglePip = popTogglePip;
window.popStopPip = popStopPip;
window.popBuckets = popBuckets;
window.popEpg = popEpg;
window.popRecords = popRecords;
window.popMedia = popMedia;
window.exitPortal = exitPortal;
/* ---------------------------------------------------------------------------
 * Info list items (About screen)
 * --------------------------------------------------------------------------- */
/**
 * Display the "About" / plugin info screen.
 * Shows player version, install ID, HTTPS support status, OTT host, and
 * device info (via stbInfo).
 *
 * Side effects: Saves CPD; writes to #listAbout; calls stbInfo() if
 * available; sets aboutKeyHandler to dismiss on any key.
 */
function pluginInfo(): void {
    var v = (window as any).version || "<br/>Version: " + PLAYER_VERSION;
    var host = (window as any).host || "-";
    var __iid = (window as any).__iid || "-";
    var canHttps = (window as any).client_can_https ? "Yes" : "No";
    var html =
        _("Player info:") +
        "<br/>" +
        v +
        "<br/>" +
        "<br/>Install ID: " +
        __iid +
        "<br/>" +
        "HTTPS support: " +
        canHttps +
        "<br/>" +
        "OTT / APP host: " +
        host +
        " / " +
        window.location.host +
        "<br/><br/>" +
        _("Device info:") +
        "<br/>";
    (window as any).saveCPD();
    $("#listAbout").show().html(html);
    if (typeof (window as any).stbInfo === "function")
        (window as any).stbInfo();
    (window as any).aboutKeyHandler = function () {
        return false;
    };
}

/**
 * Display the "Remote control buttons description" screen.
 * Lists all remote button functions for live and archive modes, with
 * labelled key icons. Auto-scrolls long content.
 *
 * Side effects: Saves CPD; writes to #listAbout; calls scrollUp();
 * sets aboutKeyHandler to dismiss on RETURN.
 */
function buttonsInfo(): void {
    var e = '<br/><div class="btn">';
    var t = "</div> - ";
    var strYellow = (window as any).strTools || "";
    var strRed = (window as any).strEPG || "";
    var html =
        e +
        (window as any).strENTER +
        t +
        _("Show channel selection list") +
        e +
        (window as any).strRETURN +
        t +
        _("Hide / Return") +
        e +
        (window as any).strEXIT +
        t +
        _("Exit player") +
        "<br/><br/>" +
        _("In live mode: <br/>") +
        e +
        (window as any).strSTOP +
        t +
        _("Restart stream") +
        e +
        (window as any).strPLAY +
        " / " +
        (window as any).strPAUSE +
        " / 0" +
        t +
        _("Pause/Play") +
        e +
        (window as any).strPREV +
        t +
        _("Timeshift: to start of TV program") +
        e +
        (window as any).strRW +
        t +
        _("Timeshift: one minute back") +
        e +
        (window as any).strFF +
        " / " +
        (window as any).strNEXT +
        t +
        _("Show rewind window") +
        _("<br/><br/>In archive mode:<br/>") +
        e +
        (window as any).strPLAY +
        " / " +
        (window as any).strPAUSE +
        " / 0" +
        t +
        _("Pause/Play") +
        e +
        (window as any).strSTOP +
        " / 8" +
        t +
        _("Stop playback and return to live") +
        e +
        (window as any).strPREV +
        " / 2" +
        t +
        _("To start of TV program / Previous TV program") +
        e +
        (window as any).strNEXT +
        " / 5" +
        t +
        _("Next TV program") +
        e +
        (window as any).strRW +
        " / " +
        (window as any).strFF +
        t +
        _("Back / Forward for 1 minute") +
        (strYellow ? "<br/>" + e + strYellow + t + _("Show player menu") : "") +
        (strRed
            ? "<br/>" + e + strRed + t + _("Show EPG and archive for channel")
            : "");
    (window as any).saveCPD();
    $("#listAbout")
        .html('<div id="_prd">' + html + "</div>")
        .show();
    var a = $("#_prd").height() + 10 - $("#listAbout").height();
    (window as any).scrollUp("_prd", a, 10000);
    (window as any).aboutKeyHandler = function (e: number): boolean {
        if (e === (window as any).keys.RETURN) {
            (window as any).restoreCPD();
            $("#listAbout").hide().text("");
            clearTimeout((window as any).detailTimer);
        }
        return true;
    };
}

var infoArr: any[] = [
    { action: buttonsInfo, name: "Description of remote control buttons" },
    { action: nofun },
    { action: pluginInfo, name: "About", desc: "Player and device info" },
];

window.infoArr = infoArr;
window.pluginInfo = pluginInfo;
window.buttonsInfo = buttonsInfo;
window.infoList = infoList;
window.isListVisible = isListVisible;
window.isEditMode = isEditMode;
window.isSelectBox = isSelectBox;
window.editCaption = editCaption;
window.editValue = editValue;
window.curColor = curColor;
window.curColorB = curColorB;
window.bodyColor = bodyColor;
window.epgCache = epg;
window.medHistory = medHistory;
window.medFavorites = medFavorites;
window.channelAspects = aAspects;
window.channelZooms = aZooms;
window.channelAudios = aAudios;
window.channelSubs = aSubs;
window.strEXIT = strEXIT;
window.strENTER = strENTER;
window.strTools = strTools;
window.strInfo = strInfo;
window.strEPG = strEPG;
window.strPip = strPip;
window.strAspect = strAspect;
window.strZoom = strZoom;
window.strAudio = strAudio;
window.strPrech = strPRECH;
window.strRETURN = strRETURN;
window.strSETUP = strSETUP;
window.strLANG = strLANG;
window.strUP = strUP;
window.strDOWN = strDOWN;
window.strLEFT = strLEFT;
window.strRIGHT = strRIGHT;
window.strSTOP = strSTOP;
window.strPLAY = strPLAY;
window.strPAUSE = strPAUSE;
window.strPlayPause = strPlayPause;
window.strRW = strRW;
window.strFF = strFF;
window.strPREV = strPREV;
window.strNEXT = strNEXT;
window.strSubt = strSubt;
window.strNew = strNew;
window.TMDb = TMDb;
window.__cv = PLAYER_VERSION;
window.__av = PLAYER_VERSION;
window.version = "<br/>Version: " + PLAYER_VERSION;

// Command handler (push commands via webhook)
window.handleCommand = handleCommand;
window.showPopup = showPopup;

/* ---------------------------------------------------------------------------
 * Sync PlayerSettings → window.* for settings submenu compatibility
 * --------------------------------------------------------------------------- */
/**
 * Synchronise the typed PlayerSettings object onto window.* globals.
 * This is required because the settings submenu system (stbOptions,
 * settingsInterface, etc.) reads/writes values from window.* properties
 * rather than the typed settings object.
 *
 * @param s - The current PlayerSettings instance.
 *
 * Side effects: Assigns ~50 window properties (sNoSmall, sStopPlay,
 * sPipSize, sFont, sArrowFun, … and many others).
 */
function applySettingsToWindow(s: PlayerSettings): void {
    window.sNoSmall = s.noSmall;
    window.sStopPlay = s.stopPlay;
    window.sPipSize = s.pipSize;
    window.sPipPos = s.pipPosition;
    window.sPageSize = s.pageSize;
    window.sFontShift = s.fontShift;
    window.sFont = s.fontSize;
    window.sArrowFun = s.arrowFun;
    window.sRewFun = s.rewFun;
    window.sPNFun = s.pnFun;
    window.sRfun = s.rFun;
    window.sGfun = s.gFun;
    window.sYfun = s.yFun;
    window.sBfun = s.bFun;
    window.sALfun = s.alFun;
    window.sARfun = s.arFun;
    window.sAUfun = s.auFun;
    window.sADfun = s.adFun;
    window.sRWfun = s.rwFun;
    window.sFFfun = s.ffFun;
    window.sPREVfun = s.prevFun;
    window.sNEXTfun = s.nextFun;
    window.sEfun = s.eFun;
    window.sOkfun = s.okFun;
    window.s13dur = s.seek13Duration;
    window.s46dur = s.seek46Duration;
    window.s79dur = s.seek79Duration;
    window.sNoColorKeys = s.noColorKeys;
    window.sNoNumbersKeys = s.noNumbersKeys;
    window.sTimezone = s.timezone;
    window.sSleepTimeout = s.sleepTimeout;
    window.sVolumeStep = s.volumeStep;
    window.sInfoTimeout = s.infoTimeout;
    window.sInfoSlide = s.infoSlide;
    window.sInfoSwitch = s.infoSwitch;
    window.sInfoChange = s.infoChange;
    window.sInfoRew = s.infoRew;
    window.sThumbnail = s.thumbnail;
    window.sOsdOpacity = s.osdOpacity;
    window.sListPos = s.listPosition;
    window.sEditor = s.editor;
    window.sShowNum = s.showNumber;
    window.sShowPikon = s.showPicon;
    window.sShowName = s.showName;
    window.sShowProgress = s.showProgress;
    window.sShowArchive = s.showArchive;
    window.sShowScroll = s.showScroll;
    window.sShowDescr = s.showDescription;
    window.sShowProgram = s.showProgram;
    window.sPreview = s.preview;
    window.sNextCount = s.nextCount;
    window.sNextCountL = s.nextCountList;
    window.sFavorites = s.favorites;
    window.sPermanentTime = s.permanentTime;
    window.s10resum = s.res10Resume;
    window.sPrevCount = s.prevCount;
    window.sMedCount = s.medCount;
    window.sPSchannels = s.psChannels;
    window.sPSoptions = s.psOptions;
    window.sPSprovs = s.psProvs;
    window.sHDMIsupport = s.hdmiSupport;
    window.sAutorun = s.autorun;
    window.sPlayers = s.players;
    window.sBufSize = s.bufSize;
    window.sGrapI = s.grapI;
    window.parentPIN = s.parentPin;
    window.sSHLcolSel = s.highlightColorSel;
    window.sSHLcolor = s.highlightColor;
    window.sSHLcolorB = s.highlightColorB;
    window.sLocalCmdUrl = s.localCmdUrl;
}

/**
 * Show the "Remote control" settings screen.
 * Displays the device UUID (read-only) and the local command URL setting.
 * Provides info about push command capabilities.
 *
 * Side effects: Writes to #listAbout; sets listKeyHandlerFn for ENTER/RETURN.
 */
window.settingsCommands = function (): void {
    var w = window as any;
    w.saveCPD();
    var uid =
        w.deviceUUID ||
        w.localStorage.getItem("ott_device_uuid") ||
        "not generated";
    var lurl = w.sLocalCmdUrl || "";
    var html =
        "<br/>" +
        "<b>Device ID (UUID):</b><br/>" +
        '<span style="font-family:monospace;font-size:120%;color:' +
        w.curColor +
        '">' +
        uid +
        "</span><br/>" +
        "<br/>" +
        "This unique ID identifies your device. Use it to target commands<br/>" +
        "to this specific player from Home Assistant or other automation.<br/>" +
        "<br/>" +
        "<b>Local command URL:</b><br/>" +
        (lurl
            ? '<span style="font-family:monospace;">' + lurl + "</span>"
            : "not set") +
        "<br/>" +
        "<br/>" +
        "<b>Push commands (via webhook):</b><br/>" +
        "popup_message, channel_by_number, channel_by_name,<br/>" +
        "random_channel, change_provider, change_playlist<br/>" +
        "<br/>" +
        "Press ENTER to change local URL, RETURN to go back.";
    $("#listAbout").show().html(html);
    w.aboutKeyHandler = function (e: number): boolean {
        if (e === w.keys.RETURN) {
            w.restoreCPD();
            $("#listAbout").hide().text("");
            w.optionsList(w.settingsCommands);
            return true;
        }
        if (e === w.keys.ENTER) {
            // Prompt for new local URL
            var newUrl = prompt(
                "Local command URL (leave empty to use central server):",
                lurl
            );
            if (newUrl !== null) {
                w.sLocalCmdUrl = newUrl.trim();
                if (typeof w.stbSetItem === "function")
                    w.stbSetItem("sLocalCmdUrl", w.sLocalCmdUrl);
                w.settingsCommands();
            }
            return true;
        }
        return false;
    };
};

// Rebuild optionsArr now that all window.* settings functions are defined
optionsArr.length = 0;
var _o = window as any;
optionsArr.push({ action: _o.settingsInterface, name: "Interface settings" });
optionsArr.push({ action: _o.settingsLists, name: "Lists settings" });
optionsArr.push({ action: _o.settingsChannels, name: "Channel list settings" });
optionsArr.push({ action: _o.settingsInfobar, name: "Infobar settings" });
optionsArr.push({ action: _o.settingsButtons, name: "Buttons settings" });
optionsArr.push({ action: _o.settingsMenu, name: "Menu items settings" });
optionsArr.push({ action: _o.parentControlSetup, name: "Parental control" });
optionsArr.push({ action: noSelProv });
optionsArr.push({
    action: selectProvaider,
    name: "Change provider",
    desc: "Change provider - you can change the provider, and it will be remembered at the next start of player!",
});
optionsArr.push({ action: edit_dealer, name: "Enter Provider Code" });
optionsArr.push({ action: _o.settingsManage, name: "Manage settings" });
optionsArr.push({
    action: _o.settingsCommands,
    name: "Remote control",
    desc: "Device ID and local command URL settings",
});
optionsArr.push({ action: selectLang, name: "Change interface language" });
