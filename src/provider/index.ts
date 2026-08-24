/**
 * Provider management — load, parse, and manage IPTV service providers.
 * Ported from stbPlayer.js: loadProv, loadChannels, selectProvaider,
 * edit_dealer, edit_dealer_remote, firstRun, duneAddSettings, getChanelsArray.
 *
 * This module handles:
 * - Dynamic loading of provider scripts (prov.js)
 * - Provider selection UI (list of known IPTV providers)
 * - Channel list rendering and interaction
 * - Popup menu state for the OSD action menu
 * - Dealer code entry (provider activation codes)
 * - First-run setup wizard
 */

import {
    setPlayerMode,
    toggleAspectRatio,
    toggleAudioTrack,
    toggleSubtitle,
    toggleZoom,
} from "../core";
import {
    exitPortal,
    infoList,
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
} from "../ui";

// ─── Provider list ────────────────────────────────────────────────────────────

export var arrayProvaiders = [
    "m3u",
    "stalker",
    "xtream",
    "",
    "ottclub",
    "edem",
    "shura",
    "itv",
    "tvteam",
    "ottg",
    "great",
    "top",
    "shara.club",
    "shara-tv",
    "bestlist",
    "bestlist/stalker",
    "all4you",
    "ipstream",
    "korona",
    "antifriz",
    "kb-team",
    "fox",
    "iptv-ott.ru",
    "dosug",
    "topiptv",
    "1ott",
    "newlook",
    "polmedia",
    "dragon",
    "only4",
    "ottprime",
    "shocktv",
    "diamondtv",
    "fabryka",
    "russkoetv",
    "ultifl1x",
    "tvclub",
    "vidok",
    "cbilling",
    "",
    "drvao",
    "d/maxtv",
    "moidom",
    "sharavoz",
    "raduga",
    "prost",
    "fxml",
    "rd",
    "tabox",
];

export var provArray: string[] | null = null;

// ─── Storage keys for provider data ──────────────────────────────────────────

var pdsa: string[] = [
    "catsArray",
    "cats",
    "favoritesArray",
    "parentalArray",
    "catIndex",
    "primaryIndex",
    "prevArr",
    "epgTimers",
    "aAspects",
    "aZooms",
    "aAudios",
    "aSubs",
    "sSortAbc",
    "sPlayers",
    "medHistory",
    "medFavorites",
];

// ─── Popup menu state ──────────────────────────────────────────────────────────
// Initialised with full defaults (matching original) so the menu works even
// when loadProv is not called (e.g. PC/browser without a provider script).

export var nofun = function () {};
export var popupActions: any[] = [
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
export var popupArray: string[] = [
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
export var popupDetail: string[] = [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Show rewind window",
    "",
    "",
    "",
    "",
    "Show list of channel archive records without duplication",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
];

// ─── External declarations (set by other modules at runtime) ───────────────────

declare var $: any;
declare var host: string;
declare var __cv: string;
declare var __av: string;
declare var __test: string;
declare var host_ott: string;
declare var host_ott_proto: string;
var launch_id = "#launch";
var savedPopup: {
    ver: string;
    popupActions: any[];
    popupArray: string[];
    popupDetail: string[];
} = { ver: "", popupActions: [], popupArray: [], popupDetail: [] };
declare var channelsList: any;
declare var pperf_stamp: (label: string) => void;
declare var stbIsPlaying: () => boolean;
declare var stbStop: () => void;
declare var stbSetItem: (key: string, val: string) => void;
declare var stbGetItem: (key: string) => string;
declare var stbPlayPip: (url: string) => void;
declare var getEPGchanel: (
    chId: string,
    cb: (id: string, data: any[]) => void,
) => void;
declare var getEPGchanelCached: (
    chId: string,
    cb: (id: string, data: any[]) => void,
) => void;
declare var epgCash: number;
declare var getCurProgData: (
    chId: string,
    cb: (chId: string) => void,
) => boolean;
declare var getChannelPicon: (chId: string) => string;
declare var channelsKeyHandler: (key: number) => boolean;
/**
 * Update a single channel row in the rendered channel list.
 * Refreshes the program name element (#pn{chId}) and the progress bar width
 * (#pr{chId}) based on elapsed time. Also re-renders the detail panel if the
 * updated channel is currently selected.
 *
 * @param chId - The channel ID to update.
 *
 * Side effects: DOM mutations to #pn{chId}, #pr{chId}.
 * Called as the EPG callback from getCurProgData.
 */
function updateChanelList(chId: string): void {
    $("#pn" + chId).html(chanels[chId].name);
    $("#pr" + chId).css(
        "width",
        ((Date.now() / 1e3 - chanels[chId].time) /
            (chanels[chId].time_to - chanels[chId].time)) *
            100 +
            "%",
    );
    if (listArray[selIndex] == chId) detailProg();
}
/**
 * Render the detail/program info panel for the currently selected channel.
 * Shows current program name, time range, elapsed/total duration, description
 * thumbnail, upcoming programs, and auto-scrolls long descriptions.
 * Optionally triggers a video preview (sPreview == 1).
 *
 * Reads global state: selIndex, listArray, chanels, curColor, sShowDescr,
 * sNextCountL, sPreview.
 *
 * Side effects: DOM writes to #listDetail, #_descr, auto-scroll via scrollUp().
 * Calls previewChId() on window if sPreview is enabled.
 *
 * Edge case: Returns early if chanels[listArray[selIndex]] is undefined or if
 * the program has already ended (time_to < now).
 */
function detailProg(): void {
    var e = chanels[listArray[selIndex]];
    if (e === undefined) return;
    if (e.time_to && e.time_to >= Date.now() / 1e3) {
        var t = Math.round((Date.now() / 1e3 - e.time) / 60);
        var r =
            '<div id="_name"><div style="color:' +
            curColor +
            ';">' +
            e.name +
            '</div><div style="font-size:smaller;">' +
            time2time(e.time) +
            " - " +
            time2time(e.time_to) +
            " (" +
            (t > 0 ? t + "/" : "") +
            Math.round((e.time_to - e.time) / 60) +
            " " +
            _("min") +
            ")</div></div>" +
            '<div id="_descr" style="font-size:smaller;overflow:hidden;"><div id="_prd">' +
            getThumbnail(e.icon) +
            e.descr +
            "</div></div>";
        if (e.nextpr && sNextCountL) {
            r +=
                '<div id="_nextpr" style="' +
                (sShowDescr
                    ? "position:absolute;left:0;bottom:0;padding:4px;"
                    : "") +
                'width:98%;white-space:nowrap;font-size:smaller;">';
            e.nextpr.forEach(function (n: any, i: number) {
                if (i < sNextCountL)
                    r +=
                        time2time(n.time) +
                        ' <span style="color:' +
                        curColor +
                        ';">' +
                        n.name +
                        "</span></br>";
            });
            r += "</div>";
        }
        listDetail.innerHTML = r;
        var s = sShowDescr
            ? $("#listDetail").height() -
              $("#_name").height() -
              ($("#_nextpr").height() || 0)
            : 0;
        $("#_descr").height(s);
        s = $("#_prd").height() + 10 - s;
        scrollUp("_prd", s, 5000);
    }
    if (sPreview == 1) {
        if (typeof (window as any).previewChId === "function")
            (window as any).previewChId(listArray[selIndex]);
    }
}
/**
 * Populate the channel list popup (#listPopUp) with action buttons.
 * Contents differ depending on whether we're in a sub-category vs. root
 * (sFavorites / listCatIndex), and whether parental control is active.
 *
 * Side effects: Writes innerHTML to #listPopUp; appends parental control
 * button if sPSchannels && parentPIN != '*'.
 */
function setPopupChannels(): void {
    if ((!sFavorites && listCatIndex) || (sFavorites && !listCatIndex)) {
        $("#listPopUp").html(
            btnDiv(keys.N1, "1", "Move channel up") +
                "<br/>" +
                btnDiv(keys.N7, "7", "Move channel down") +
                "<br/>" +
                btnDiv(keys.N8, "8", "Delete channel") +
                (sFavorites
                    ? ""
                    : "<br/>" +
                      btnDiv(keys.N3, "3", "Add channel to category")),
        );
    } else {
        $("#listPopUp").html(
            btnDiv(
                keys.N3,
                "3",
                "Add channel to " + (sFavorites ? "favorites" : "category"),
            ) +
                "<br/>" +
                btnDiv(
                    keys.N9,
                    "9",
                    _("Sort channels") +
                        ": " +
                        _(sSortAbc ? '"As Is"' : "By alphabet"),
                ),
        );
    }
    if (sPSchannels && parentPIN != "*") {
        $("#listPopUp").append(
            "<br/>" + btnDiv(keys.N4, "4", "Channel parental control"),
        );
    }
}
declare var sPreview: number;
declare var previewChan: any;
declare var sNoColorKeys: number;
declare var sNoNumbersKeys: number;
declare var sArrowFun: number;
declare var sRewFun: number;
declare var sPNFun: number;
declare var sPSprovs: number;
declare var parentPIN: string;
declare var parentAccess: boolean;
declare var enterPinAndSetAccess: (fn: () => void) => void;
declare var selIndex: number;
declare var listArray: any[];
declare var listDetail: HTMLElement;
declare var listCaptionElement: HTMLElement;
var listPodval: HTMLElement = null;
declare var itemWith: number;
declare var pageSize: number;
declare var bodyColor: string;
declare var curColor: string;
declare var sShowNum: number;
declare var sShowPikon: number;
declare var sShowName: number;
declare var sShowProgram: number;
declare var sShowProgress: number;
declare var sShowArchive: number;
declare var sShowDescr: number;
declare var sShowScroll: number;
declare var catIndex: number;
declare var primaryIndex: number;
declare var catsArray: string[];
declare var cats: Record<string, string[]>;
declare var parentalArray: string[];
declare var favoritesArray: string[];
declare var prevArr: any[];
declare var cList: string[];
declare var chanels: Record<string, any>;
declare var epg: any;
declare var curList: string[];
declare var epgCashObj: Record<string, any>;
declare var epgCashArr: string[];
declare var _crData: { catIndex: number; data: any[]; selIndex: number };
declare var aAspects: Record<string, any>;
declare var aAudios: Record<string, any>;
declare var aZooms: Record<string, any>;
declare var aSubs: Record<string, any>;
declare var mediaUrls: string[] | null;
declare var listCatIndex: number;
declare var getListItem: (item: any, idx: number) => string;
declare var detailListAction: () => void;
declare var listKeyHandler: (key: number) => boolean;
declare var listKeyHandlerFn: (key: number) => boolean;
declare var showPage: () => void;
declare var closeList: () => void;
declare var btnDiv: (
    key: number,
    label: string,
    desc: string,
    num?: string,
    extra?: string,
) => string;
declare var strRETURN: string;
declare var strInfo: string;
declare var strEPG: string;
declare var strTools: string;
declare var strLEFT: string;
declare var strRIGHT: string;
declare var strRW: string;
declare var strFF: string;
declare var strPREV: string;
declare var strNEXT: string;
declare var strPlayPause: string;
declare var strSTOP: string;
declare var strPip: string;
declare var strUP: string;
declare var strDOWN: string;
declare var strENTER: string;
declare var strAudio: string;
declare var strSubt: string;
declare var strZoom: string;
declare var strAspect: string;
declare var strSETUP: string;
declare var strPRECH: string;
declare var keys: any;
declare var editCaption: string;
declare var editvar: string;
declare var editKey: (key: number) => boolean;
declare var setEdit: () => void;
declare var showEditKey: (initKeys?: number[]) => void;
declare var getScriptDOM: (
    url: string,
    onSuccess: () => void,
    onError: (e?: any) => void,
) => void;
/**
 * Process a "dealer" (provider activation) code string.
 * Parses the code as "key:value", and if the key is "d" or "data",
 * stores the value in provider storage under 'dealerData'.
 *
 * @param code - The raw code string (e.g. "d:someEncodedData").
 *
 * Side effects: Calls providerSetItem('dealerData', ...) on match.
 * Logs to console for debugging.
 */
function doDealer(code: string): void {
    console.log("[dealer] code:", code);
    try {
        if (typeof code === "string") {
            var parts = code.split(":");
            if (parts.length >= 2) {
                var key = parts[0],
                    val = parts.slice(1).join(":");
                if (key === "d" || key === "data")
                    providerSetItem("dealerData", val);
            }
        }
    } catch (r) {
        console.error("[dealer]", r);
    }
}
declare var providerGetItem: (key: string) => string;
declare var providerGetNum: (key: string, def: number) => number;
declare var providerGetJson: (key: string, def: any) => any;
declare var providerSetItem: (key: string, val: string) => void;
declare var providerHasItem: (key: string) => boolean;
declare var providerHasItemValue: (key: string) => boolean;
declare var providerDelItem: (key: string) => void;
declare var _providerGetItem: (key: string) => string;
declare var _providerHasItem: (key: string) => boolean;
declare var _providerHasItemValue: (key: string) => boolean;
declare var _providerSetItem: (key: string, val: string) => void;
declare var _providerDelItem: (key: string) => void;
declare var _playChannel: (catIdx: number, chIdx: number) => void;
declare var _bucketsList: (catIdx: number) => void;
declare var _playMedia: (item: any) => void;
declare var playChannel: (catIdx: number, chIdx: number) => void;
declare var bucketsList: (catIdx: number) => void;
declare var playMedia: (item: any) => void;
declare var onChanelsLoaded: () => void;
declare var client_feedb: (msg: string) => void;
declare var infoBox: (msg: string) => void;
/**
 * Show the Settings list (optionsArr) as a navigable list UI.
 * Each entry in optionsArr is rendered as a row; ENTER triggers its action.
 * Optionally selects a specific entry if `fn` matches an action.
 * Checks parental PIN gate (sPSoptions / parentPIN).
 *
 * @param fn - Optional action function to pre-select in the list.
 *
 * Side effects: Populates listDataArray, listArray, installs getListItemFn /
 * detailListActionFn / listKeyHandlerFn; writes to listCaptionElement,
 * listPodval, hides #listPopUp; calls showPage() to render.
 *
 * Edge case: If sNoNumbersKeys is falsy, appends a "9" shortcut button
 * for selectProvaider. Always appends strTools button for selectProvaider.
 */
export function optionsList(fn?: () => void): void {
    if (sPSoptions && parentPIN != "*" && !(window as any).parentAccess) {
        if (typeof (window as any).enterPinAndSetAccess === "function") {
            (window as any).enterPinAndSetAccess(optionsList as any);
        }
        return;
    }
    listDataArray = [];
    optionsArr.forEach(function (opt: any) {
        listDataArray.push(_(opt.name || ""));
    });
    listArray = listDataArray;
    if (!sNoNumbersKeys) addBtn2menu(optionsArr, selectProvaider, "9");
    addBtn2menu(optionsArr, selectProvaider, strTools);
    selIndex = 0;
    if (typeof fn !== "undefined") {
        for (var t = 0; t < optionsArr.length; t++) {
            if (optionsArr[t].action == fn) {
                selIndex = t;
                break;
            }
        }
    }
    getListItemFn = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + item;
    };
    detailListActionFn = function () {
        listDetail.innerHTML = _(
            optionsArr[selIndex].desc || optionsArr[selIndex].name || "",
        );
        if (optionsArr[selIndex].action == noSelProv) nselprov = 0;
    };
    listKeyHandlerFn = function (key: number): boolean {
        console.log(
            "DBG optionsList handler: key=" +
                key +
                " keys.ENTER=" +
                keys.ENTER +
                " selIndex=" +
                selIndex +
                " action=" +
                (optionsArr[selIndex]
                    ? typeof optionsArr[selIndex].action
                    : "undefined"),
        );
        switch (key) {
            case keys.RETURN:
                popupList(-1);
                return true;
            case keys.ENTER:
                console.log(
                    "DBG optionsList ENTER: optionsArr[selIndex].action=" +
                        (optionsArr[selIndex].action
                            ? "function"
                            : "undefined"),
                );
                if (optionsArr[selIndex].action) optionsArr[selIndex].action();
                return true;
            case keys.TOOLS:
            case keys.N9:
                if (optIndexOf(selectProvaider) > -1) selectProvaider();
                return true;
        }
        return false;
    };
    listCaptionElement.innerHTML = _("Settings");
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listPopUp").hide();
    showPage();
}
declare var selectLang: () => void;
declare var loadSettings: () => void;
declare var loadOpt: (() => void) | undefined;
declare var delOption: (fn: () => void) => void;
// popupActions/popupArray/popupDetail defined as export let above

var nselprov = 0,
    nprovparams = 0,
    _clearAll = 0;

/**
 * Toggle the "Show providers?" / "Hide providers?" setting.
 * Requires 7 rapid invocations (nselprov counter) before the confirmation
 * dialog appears — a hidden/secret access pattern.
 * Checks parental PIN gate (sPSprovs).
 *
 * Side effects: Writes 'noSelProv' to stb storage, then calls restart().
 */
export function noSelProv(): void {
    if (++nselprov < 7) return;
    if (sPSprovs && parentPIN != "*" && !(window as any).parentAccess) {
        if (typeof (window as any).enterPinAndSetAccess === "function") {
            (window as any).enterPinAndSetAccess(noSelProv);
        }
        return;
    }
    var e = parseInt(stbGetItem("noSelProv")) || 0;
    confirmBox(e ? "Show providers?" : "Hide providers?", function () {
        stbSetItem("noSelProv", e ? "1" : "0");
        restart();
    });
    nselprov = 0;
}

/**
 * Toggle the "Show provider settings?" / "Hide provider settings?" flag.
 * Requires 7 rapid invocations (nprovparams counter) before confirmation —
 * same hidden-access pattern as noSelProv.
 * Checks parental PIN gate (sPSoptions).
 *
 * Side effects: Writes 'noProvParam' to stb storage, then calls restart().
 */
export function noProvParam(): void {
    if (++nprovparams < 7) return;
    if (sPSoptions && parentPIN != "*" && !(window as any).parentAccess) {
        if (typeof (window as any).enterPinAndSetAccess === "function") {
            (window as any).enterPinAndSetAccess(noProvParam);
        }
        return;
    }
    var e = parseInt(stbGetItem("noProvParam")) || 0;
    confirmBox(
        e ? "Show provider settings?" : "Hide provider settings?",
        function () {
            stbSetItem("noProvParam", e ? "1" : "0");
            restart();
        },
    );
    nprovparams = 0;
}

/**
 * Hard-restart the player: stop any active playback, then reload the page
 * (both via href assignment and location.reload() for compatibility).
 *
 * Side effects: Calls stbStop(), then window.location.href = self and reload.
 */
export function restart(): void {
    stbStop();
    window.location.href = window.location.href;
    window.location.reload();
}
declare var setPlayer: () => void;
declare var getEPGchanelCur:
    | ((chId: string, cb: (id: string, data: any[]) => void) => void)
    | null;
declare var getMediaArray:
    | ((url: string, cb: (data: any[]) => void) => void)
    | null;
declare var sNextCount: number;
declare var sNextCountL: number;
declare var sPlayers: number;
declare var medHistory: any[];
declare var medFavorites: any[];
declare var _prog100: any;
declare var playType: number;
declare var playTime: number;
declare var forcePlay: boolean;
declare var sStopPlay: number;
declare var sInfoSwitch: number;
declare var sInfoChange: number;
declare var sInfoRew: number;
declare var sInfoTimeout: number;
declare var sInfoSlide: number;
declare var sVolumeStep: number;
declare var sPermanentTime: number;
declare var sGrapI: number;
declare var s10resum: number;
declare var sPrevCount: number;
declare var sMedCount: number;
declare var sPSchannels: number;
declare var sPSoptions: number;
declare var sNoSmall: number;
declare var sListPos: number;
declare var sFontShift: number;
declare var sFont: number;
declare var sTimezone: number;
declare var sSleepTimeout: number;
declare var sOsdOpacity: number;
declare var sSHLcolor: string;
declare var sSHLcolSel: string;
declare var sSHLcolorB: string;
declare var eSHLcolor: string;
declare var eSHLcolSel: string;
declare var eSHLcolorB: string;
declare var sEditor: number;
declare var sSortAbc: number;
declare var sFavorites: number;
declare var sALfun: number;
declare var sARfun: number;
declare var sAUfun: number;
declare var sADfun: number;
declare var sRWfun: number;
declare var sFFfun: number;
declare var sPREVfun: number;
declare var sNEXTfun: number;
declare var sRfun: number;
declare var sGfun: number;
declare var sYfun: number;
declare var sBfun: number;
declare var sEfun: number;
declare var sOkfun: number;
declare var s13dur: number;
declare var s46dur: number;
declare var s79dur: number;
declare var sHideMenus: string[];
declare var sBufSize: number;
declare var sAutorun: number;
declare var sThumbnail: number;
declare var p_pref: string;
declare var _epgDomen: string;
declare var ott_event: any;
declare var keyStrings: Record<string, string>;
declare function _(key: string, ...args: any[]): string;
declare function getWidthK(): number;
declare function getHeightK(): number;
declare var aboutKeyHandler: (key: number) => boolean;
declare var saveCPD: () => void;
declare var restoreCPD: () => void;
declare var stbExit: () => void;
declare var version: string;
declare var s: string;
declare var time2time: (timestamp: number) => string;
declare var getThumbnail: (url: string) => string;
declare var scrollUp: (el: string, px: number, delay: number) => void;
declare var listDataArray: any[];
declare var optionsArr: { action: any; name?: string; desc?: string }[];
declare var addBtn2menu: (arr: any[], action: any, label: string) => void;
declare var getListItemFn: (item: any, idx: number) => string;
declare var detailListActionFn: () => void;
declare var popupList: (i?: number) => void;
declare var optIndexOf: (action: any) => number;
declare var confirmBox: (
    message: string,
    onYes: () => void,
    onNo?: () => void,
) => void;

// ─── Load provider script ─────────────────────────────────────────────────────

/**
 * Load a provider script dynamically from /prov/{id}/prov.js.
 * Resets global function overrides (playChannel, channelsList, etc.) to
 * internal implementations, restores base popup state, then fetches the
 * provider's prov.js via getScriptDOM.
 *
 * Flow:
 * 1. Resolve provider ID from URL query string or stb storage.
 * 2. Clear out provider callback overrides (playChannel, etc.).
 * 3. Restore savedPopup state (popupActions/Array/Detail).
 * 4. Load prov.js; on success call duneAddSettings → loadChannels.
 * 5. On failure call onError → firstRun().
 *
 * Side effects: DOM mutations to #launch / #dialogbox, calls stbStop() if
 * playing, calls closeList(), writes to provider storage for 'ottplayprov'.
 * Logs extensively to console.
 *
 * Edge case: If noSelProv=1, removes selectProvaider action from optionsArr.
 * If noProvParam=1, splices provider settings out of popup arrays.
 */
export function loadProv(): void {
    pperf_stamp("loadProv -- start");

    /**
     * Handle provider script load failure.
     * Clears the pending provider, alerts the error (unless 'no' provider),
     * and falls back to firstRun().
     *
     * Side effects: Alert dialog; DOM append to launch_id; hides the element.
     */
    function onError(): void {
        (window as any)._pendingProvId = "";
        if (s !== "no") {
            alert(s + ": load error!!!");
        }
        $(launch_id)
            .append("<br/><b>Failed to load provider script !!!</b>")
            .hide();
        firstRun();
    }

    if (!$("#launch").is(":visible")) {
        if (stbIsPlaying()) stbStop();
        $("#dialogbox")
            .html(
                '<img src="' +
                    host +
                    "/stbPlayer/buffering.gif?" +
                    __av +
                    '" height="40">',
            )
            .show();
        launch_id = "#dialogbox";
        closeList();
    }

    version = savedPopup.ver;
    getEPGchanelCur = null;
    getMediaArray = null;
    // Assign provider callback stubs (ported from original)
    if (typeof _playChannel !== "undefined") playChannel = _playChannel;
    if (typeof _channelsList !== "undefined") channelsList = _channelsList;
    if (typeof _bucketsList !== "undefined") bucketsList = _bucketsList;
    if (typeof _playMedia !== "undefined") playMedia = _playMedia;
    if (typeof _providerGetItem !== "undefined")
        providerGetItem = _providerGetItem;
    if (typeof _providerHasItem !== "undefined")
        providerHasItem = _providerHasItem;
    if (typeof _providerHasItemValue !== "undefined")
        providerHasItemValue = _providerHasItemValue;
    if (typeof _providerSetItem !== "undefined")
        providerSetItem = _providerSetItem;
    if (typeof _providerDelItem !== "undefined")
        providerDelItem = _providerDelItem;

    // Restore base popup state (saved before any provider script ran)
    if (savedPopup.popupActions.length) {
        popupActions = savedPopup.popupActions.slice();
        popupArray = savedPopup.popupArray.slice();
        popupDetail = savedPopup.popupDetail.slice();
    } else {
        // Fallback: hardcoded defaults
        popupActions = [
            (window as any).toggleAspectRatio,
            (window as any).toggleZoom,
            (window as any).toggleAudioTrack,
            (window as any).toggleSubtitle,
            (window as any).popPrevProg,
            (window as any).popPause,
            (window as any).popStop,
            (window as any).popShift,
            (window as any).popTogglePip,
            (window as any).popStopPip,
            (window as any).popBuckets,
            (window as any).popEpg,
            (window as any).popRecords,
            (window as any).popMedia,
            (window as any).noProvParam,
            (window as any).nofun,
            (window as any).optionsList,
            (window as any).restart,
            (window as any).exitPortal,
            (window as any).infoList,
        ];
        popupArray = [
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
    }

    var matchResult = window.location.search.match(/\?([^&]+)/);
    s = "";
    if (matchResult !== null) {
        s = matchResult[1].replace(/!/g, "");
        if (s === "clear") {
            stbSetItem("ottplayprov", "");
            stbSetItem("noSelProv", "0");
            s = "";
        }
        if (s.indexOf("*") > -1 && !stbGetItem("ottplayprov")) {
            s = s.replace(/\*/g, "");
            if (arrayProvaiders.indexOf(s) > -1) {
                stbSetItem("ottplayprov", s);
                stbSetItem("noSelProv", "1");
                s = "";
            }
        }
        if (arrayProvaiders.indexOf(s) === -1) s = "";
    }
    if (s) delOption(selectProvaider);
    else s = stbGetItem("ottplayprov") || s;
    if (arrayProvaiders.indexOf(s) === -1) s = "";
    if (!s) {
        s = "no";
        onError();
        return;
    }
    if (parseInt(stbGetItem("noSelProv") || "0")) delOption(selectProvaider);
    else {
        $(launch_id).append("<br/>Loading provider " + s + " script ...");
        delOption(edit_dealer);
    }
    pperf_stamp("loadProv -- load js");
    getScriptDOM(
        host + "/prov/" + s + "/prov.js?" + __cv,
        function () {
            try {
                pperf_stamp("loadProv -- js ready");
                console.log(
                    "[loadProv] Script loaded, checking duneAddSettings",
                );
                if (typeof duneAddSettings === "function") {
                    $(launch_id).append("<br/>Loading settings...");
                    console.log("[loadProv] duneAddSettings found, calling it");
                    console.log(
                        "[loadProv] popupActions.length:",
                        popupActions.length,
                        "noProvParam:",
                        (window as any).noProvParam,
                    );
                    console.log(
                        "[loadProv] popupActions.indexOf(noProvParam):",
                        popupActions.indexOf(noProvParam),
                    );
                    var idx = popupActions.indexOf(noProvParam) + 1;
                    console.log("[loadProv] idx after +1:", idx);
                    console.log(
                        "[loadProv] BEFORE duneAddSettings - popupArray.length:",
                        popupArray.length,
                        "popupActions.length:",
                        popupActions.length,
                    );
                    console.log(
                        "[loadProv] popupArray before:",
                        popupArray.slice(),
                    );
                    duneAddSettings(idx);
                    console.log(
                        "[loadProv] AFTER duneAddSettings - popupArray.length:",
                        popupArray.length,
                    );
                    console.log(
                        "[loadProv] popupArray after:",
                        popupArray.slice(),
                    );
                    console.log(
                        "[loadProv] duneAddSettings completed, popupArray:",
                        popupArray.slice(0, 5),
                        "...",
                    );
                    console.log("[loadProv] Now calling loadChannels");
                    // Update window globals for popupList to read
                    console.log("[loadProv] About to update window globals");
                    console.log(
                        "[loadProv] optionsList index:",
                        popupActions.indexOf(optionsList),
                    );
                    console.log("[loadProv] idx:", idx);
                    console.log(
                        "[loadProv] popupActions.length before splice check:",
                        popupActions.length,
                    );
                    console.log(
                        "[loadProv] popupArray before window update:",
                        popupArray.slice(),
                    );
                    (window as any).popupActions = popupActions;
                    (window as any).popupArray = popupArray;
                    (window as any).popupDetail = popupDetail;
                    console.log(
                        "[loadProv] window.popupArray length after update:",
                        (window as any).popupArray.length,
                    );
                    console.log(
                        "[loadProv] window.popupArray full:",
                        (window as any).popupArray.slice(),
                    );
                    (window as any).popupActions = popupActions;
                    (window as any).popupArray = popupArray;
                    (window as any).popupDetail = popupDetail;
                    if (parseInt(stbGetItem("noProvParam") || "0")) {
                        var count = popupActions.indexOf(optionsList) - idx;
                        console.log(
                            "[loadProv] noProvParam=1, about to splice count:",
                            count,
                            "items from idx:",
                            idx,
                        );
                        console.log(
                            "[loadProv] popupArray before splice:",
                            popupArray.slice(),
                        );
                        popupArray.splice(idx, count);
                        popupDetail.splice(idx, count);
                        popupActions.splice(idx, count);
                        console.log(
                            "[loadProv] popupArray after splice:",
                            popupArray.slice(),
                        );
                    }
                    if (
                        parseInt(stbGetItem("noSelProv") || "0") +
                            parseInt(stbGetItem("noProvParam") || "0") !==
                        2
                    ) {
                        $(launch_id).append(
                            '<img src="' +
                                host +
                                "/prov/" +
                                s +
                                "/logo.png?" +
                                __av +
                                '" alt=" " onerror="this.width=0" style="position:absolute; ' +
                                (launch_id !== "#dialogbox"
                                    ? 'top:100px; right:100px;" width="25%" max-height="25%" />'
                                    : 'top:6px; right:6px;" height="40" />'),
                        );
                    }
                    if (typeof getEPGchanelCur !== "function")
                        getEPGchanelCur = epgCash
                            ? getEPGchanelCached
                            : getEPGchanel;
                    // Expose for doGetCurProg queue processing
                    (window as any).getEPGchanelCurCached = getEPGchanelCur;
                    pperf_stamp("loadProv -- loadChannels");
                    loadChannels();
                } else {
                    console.error("duneAddSettings is not a function");
                    onError();
                }
            } catch (e) {
                console.error(e);
                (window as any)._pendingProvId = "";
                $(launch_id).append(
                    "<br/><br/><b>Exception:</b> name " +
                        (e as any).name +
                        ", message " +
                        (e as any).message +
                        ", typeof " +
                        typeof e,
                );
            }
        },
        function (e: any) {
            console.error(e);
            onError();
        },
    );
}

// ─── Load channels ────────────────────────────────────────────────────────────

/**
 * Load channels via the provider's getChanelsArray callback.
 * Resets all channel/category/EPG state to defaults, then restores
 * persisted values from provider storage (catIndex, aAspects, etc.).
 *
 * Side effects: Clears chanels, epg, catsArray, cats, favoritesArray,
 * parentalArray, etc. Writes to DOM (#launch / #dialogbox). Calls
 * getChanelsArray(onChanelsLoaded) to trigger the actual provider fetch.
 * Calls setPlayerMode() and setPlayer().
 *
 * Edge case: Stops any active playback before loading.
 */
export function loadChannels(): void {
    if (!$("#launch").is(":visible")) {
        if (stbIsPlaying()) stbStop();
        if (launch_id !== "#dialogbox")
            $("#dialogbox")
                .html(
                    '<center><img src="' +
                        host +
                        "/stbPlayer/buffering.gif?" +
                        __av +
                        '" height="40">',
                )
                .show();
        launch_id = "#dialogbox";
        closeList();
    }

    primaryIndex = providerGetNum("primaryIndex", 0);
    cList = [];
    // Clear channel data in-place to keep window.chanels and channels references in sync
    for (var _ck in chanels) {
        delete chanels[_ck];
    }
    epg = {};
    epgCashObj = {};
    epgCashArr = [];
    curList = [];
    catsArray = [];
    cats = {};
    parentalArray = [];
    favoritesArray = [];
    prevArr = providerGetJson("prevArr", []);
    medHistory = providerGetJson("medHistory", []);
    medFavorites = providerGetJson("medFavorites", []);
    mediaUrls = null;
    _crData = { catIndex: -1, data: [], selIndex: 0 };
    catIndex = providerGetNum("catIndex", 0);
    aAspects = providerGetJson("aAspects", {});
    aAudios = providerGetJson("aAudios", {});
    aZooms = providerGetJson("aZooms", {});
    aSubs = providerGetJson("aSubs", {});
    sShowNum = providerGetNum("sShowNum", 1);
    sShowName = providerGetNum("sShowName", 1);
    sShowPikon = providerGetNum("sShowPikon", 1);
    sShowProgress = providerGetNum("sShowProgress", 1);
    sShowProgram = providerGetNum("sShowProgram", 1);
    sShowDescr = providerGetNum("sShowDescr", 1);
    sShowArchive = providerGetNum("sShowArchive", 0);
    sPreview = providerGetNum("sPreview", 0);
    sPlayers = providerGetNum("sPlayers", 0);
    console.log("[loadChannels] sPlayers from storage=" + sPlayers);
    setPlayerMode(sPlayers);
    sNextCount = providerGetNum("sNextCount", 0);
    sNextCountL = sNextCount + 1;
    if (sNextCount === -1) sNextCount = 0;
    if (typeof setPlayer === "function") setPlayer();

    $(launch_id).append("<br/>Loading channel list...");
    // If getChanelsArray doesn't call back (e.g. empty playlist URL), hide spinner after timeout
    var _loadTimer = setTimeout(function () {
        $("#dialogbox").hide();
        $("#buffering").hide();
    }, 3000);
    getChanelsArray(function () {
        clearTimeout(_loadTimer);
        onChanelsLoaded();
    });
}

// ─── Provider selection UI ────────────────────────────────────────────────────

/**
 * Show the provider selection list UI.
 * Builds provArray with display names for each known provider, reorders
 * recently used providers to the top, handles PIN parental gate, and
 * installs list handlers for navigation and selection.
 *
 * Contains two inner functions:
 * - showAbout(): Loads and displays the provider's about HTML description.
 * - selectProv(id): Persists the chosen provider and calls loadProv().
 *
 * Side effects: Reorders arrayProvaiders and provArray based on recent
 * usage; writes 'ottplayprov' to stb storage; writes to DOM elements
 * (#listCaption, #listPodval, #listDetail, etc.); calls showPage().
 *
 * Edge cases:
 * - If cbkey is absent, removes 'cbilling' from the provider list.
 * - If sNoNumbersKeys, hides number-key shortcuts.
 * - RETURN from a non-dune setup calls firstRun(); otherwise calls optionsList.
 */
export function selectProvaider(): void {
    if (sPSprovs && parentPIN !== "*" && !(window as any).parentAccess) {
        enterPinAndSetAccess(selectProvaider);
        return;
    }
    if (!provArray || provArray.some((p) => typeof p !== "string"))
        provArray = [
            (sNoColorKeys ? "" : '<div class="btn red">&nbsp;</div>&nbsp;') +
                _("m3u-m3u8 playlists"),
            (sNoColorKeys ? "" : '<div class="btn green">&nbsp;</div>&nbsp;') +
                _("Stalker portals"),
            (sNoColorKeys ? "" : '<div class="btn yellow">&nbsp;</div>&nbsp;') +
                "Xtream-codes",
            "",
            "OTTCLUB",
            "Эдем / iLookTV",
            "Шура ТВ",
            "ITV.LIVE",
            "TV.Team",
            "GlanzTV",
            "GREAT IPTV",
            "Top-Tv",
            "Shara.club (ClubTV.pro)",
            "Shara-TV",
            "BEST LiST IPTV [HLS Playlist]",
            "BEST LiST IPTV [Stalker/Ministra Portal]",
            "All4you.tv",
            "IpStream.one",
            "KORONA TV",
            "АнтиФриз.ТВ",
            "KBC (Kinoboom)",
            "Fox-TV",
            "VIP-IP.COM",
            "TV DOSUG",
            "TOP-IPTV",
            "1OTT.NET",
            "New Look",
            "POLMEDIA",
            "Dragon Media PRO",
            "Only4.tv",
            "OTT Prime ONLINE",
            "ShockTv",
            "Diamond TV",
            "Fabryka.TV",
            "RUSSKOETV",
            "ULTIFL1X",
            "TVClub",
            "Vidok.TV",
            "Гомельсат (cbilling)",
        ];

    var cbkey = stbGetItem("cbkey");
    if (!cbkey) {
        for (var i = 0; i < provArray.length; i++) {
            if (provArray[i] === "Гомельсат (cbilling)") {
                provArray.splice(i, 1);
                break;
            }
        }
    }

    /**
     * Display the "about" description HTML for the currently selected provider.
     * Loads /prov/{id}/about{lang}.html into #listDetail, then copies it into
     * #listAbout as a full-screen overlay.
     *
     * Side effects: Saves/restores CPD (current page data); shows #listAbout;
     * installs aboutKeyHandler to dismiss on any key press.
     */
    function showAbout(): void {
        $("#listAbout").html(
            '<div style="font-size:larger;">' +
                listDetail.innerHTML.replace("display:none", "") +
                "</div>",
        );
        saveCPD();
        aboutKeyHandler = function () {
            restoreCPD();
            $("#listAbout").hide();
            return true;
        };
        $("#listAbout").show();
    }

    /**
     * Select and persist a provider by its string ID, then reload via loadProv().
     * If the chosen provider is the same as the current one, opens optionsList
     * instead. Also updates the recent-providers list in storage.
     *
     * @param id - Provider identifier (e.g. 'm3u', 'stalker').
     *
     * Side effects: Writes 'ottplayprov' and 'ottplayprovs' to stb storage.
     */
    function selectProv(id: string): void {
        if (!id) return;
        if (savedProvId === id) {
            optionsList(selectProvaider);
            return;
        }
        stbSetItem("ottplayprov", id);
        if (arrayProvaiders.indexOf(id) > recentCount - 1) {
            var recent = recentProviders.slice();
            var idx = recent.indexOf(id);
            if (idx !== -1) recent.splice(idx, 1);
            recent.push(id);
            stbSetItem("ottplayprovs", JSON.stringify(recent));
        }
        loadProv();
    }

    var recentCount = 3;
    var savedProvId = stbGetItem("ottplayprov") || "no";
    var recentProviders: string[] = [];
    try {
        recentProviders = JSON.parse(stbGetItem("ottplayprovs") || "[]");
    } catch (e) {
        console.error(e);
        recentProviders = [];
    }
    recentProviders.forEach(function (prov) {
        if (!cbkey && prov === "cbilling") return;
        var idx = arrayProvaiders.indexOf(prov);
        if (idx === -1) return;
        arrayProvaiders.splice(idx, 1);
        arrayProvaiders.splice(recentCount + 1, 0, prov);
        var name = provArray![idx];
        provArray!.splice(idx, 1);
        provArray!.splice(recentCount + 1, 0, name);
    });

    selIndex = arrayProvaiders.indexOf(savedProvId);
    if (selIndex === -1 || selIndex >= provArray!.length) selIndex = 0;
    listArray = provArray!;
    listDataArray = provArray!;
    getListItemFn = function (item: string, idx: number) {
        return (
            "&nbsp;&nbsp;" +
            (sNoNumbersKeys || idx < recentCount + 1 || idx > 9 + recentCount
                ? ""
                : '<div class="btn">' + (idx - recentCount) + "</div>&nbsp;") +
            item
        );
    };
    detailListAction = function () {
        if (arrayProvaiders[selIndex]) {
            var aboutUrl =
                host + "/prov/" + arrayProvaiders[selIndex] + "/about";
            var lang = stbGetItem("ottplaylang") || "";
            if (lang === "_eng") lang = "";
            $("#listDetail").load(
                "" + aboutUrl + lang + ".html?" + __av,
                function (_e: any, status: string) {
                    if (status === "error")
                        $("#listDetail").load(aboutUrl + ".html?" + __av);
                },
            );
        }
    };
    listKeyHandlerFn = function (key: number) {
        switch (key) {
            case keys.N1:
            case keys.N2:
            case keys.N3:
            case keys.N4:
            case keys.N5:
            case keys.N6:
            case keys.N7:
            case keys.N8:
            case keys.N9:
                selectProv(arrayProvaiders[key - 49 + recentCount + 1]);
                return true;
            case keys.RED:
                selectProv("m3u");
                return true;
            case keys.GREEN:
                selectProv("stalker");
                return true;
            case keys.YELLOW:
                selectProv("xtream");
                return true;
            case keys.ENTER:
                selectProv(arrayProvaiders[selIndex]);
                return true;
            case keys.RETURN:
                if (typeof duneAddSettings !== "function") {
                    firstRun();
                } else optionsList(selectProvaider);
                return true;
            case keys.RIGHT:
                if (sArrowFun !== 2) return false;
            // fall through
            case keys.N0:
            case keys.INFO:
                showAbout();
                return true;
            case keys.FF:
                if (sRewFun !== 1) return false;
                showAbout();
                return true;
            case keys.NEXT:
                if (sPNFun !== 1) return false;
                showAbout();
                return true;
            default:
                return false;
        }
    };
    listCaptionElement.innerHTML = _("Choose provider");
    listPodval.innerHTML =
        btnDiv(keys.RETURN, strRETURN, "Close") +
        btnDiv(keys.N0, strInfo, "Description", "0");
    $("#listPopUp").hide();
    showPage();
}

// ─── Edit dealer (enter provider code) ────────────────────────────────────────

/**
 * Open the "Enter Provider Code" editor UI.
 * Prompts the user to type a dealer (provider activation) code, then
 * fetches the corresponding script from /d/{prefix}.js and calls
 * doDealer() with the entered value.
 *
 * Inner functions:
 * - showError(msg): Alerts the error and re-shows the editor.
 * - setEdit: Triggered on submit; validates editvar, loads the script.
 *
 * Side effects: Sets editCaption, editvar; overrides setEdit and
 * showEditKey globals; loads a script dynamically.
 */
export function edit_dealer(): void {
    /**
     * Show an error alert for invalid dealer codes and re-open the editor.
     *
     * @param msg - Translation key for the error message.
     */
    function showError(msg: string): void {
        alert(_(msg));
        setTimeout(function () {
            showEditKey([0, 1, 2]);
        });
    }
    editCaption = _("Enter Provider Code");
    editvar = "";
    /** Validate the entered code, load the dealer script, and process it. */
    setEdit = function () {
        if (!editvar) showError("Error Code!");
        else
            getScriptDOM(
                host + "/d/" + editvar.split(":")[0] + ".js?" + __cv,
                function () {
                    try {
                        doDealer(editvar);
                    } catch (e) {
                        console.error(e);
                        showError("Error Code!");
                    }
                },
                function () {
                    showError("Error Code!");
                },
            );
    };
    showEditKey([0, 1, 2]);
}

// ─── Edit dealer remote (enter provider code via web) ─────────────────────────

/**
 * Open the remote "Enter Provider Code" editor UI.
 * Sends a request to the OTT cloud service (host_ott/swop/a.php) to
 * generate a one-time code, displays a QR code for the user to scan,
 * then polls the server until the code is submitted via the web interface.
 *
 * Inner functions:
 * - showError(msg): Alerts and cleans up.
 * - cleanup(): Cancels polling and hides the editor overlay.
 * - poll(): Periodically checks the cloud server for the entered value.
 *
 * Side effects: DOM mutations to #listEdit; AJAX POST requests to
 * host_ott/swop/a.php; loads a dynamic script on success; sets a
 * 10-minute timeout auto-cleanup.
 */
export function edit_dealer_remote(): void {
    /**
     * Show an error alert and trigger cleanup.
     *
     * @param msg - Translation key for the error message.
     */
    function showError(msg: string): void {
        alert(_(msg));
        setTimeout(function () {
            cleanup();
        });
    }
    var cancelled = false;
    var code: string;

    /**
     * Cancel the remote dealer polling and hide the editor overlay.
     * Called on success, error, or 10-minute timeout.
     *
     * Side effects: Clears the timeout, hides #listEdit.
     */
    function cleanup(): void {
        clearTimeout(timer);
        cancelled = true;
        $("#listEdit").hide();
    }
    var timer = setTimeout(cleanup, 6e5);

    /**
     * Poll the cloud server for the dealer code value.
     * If the status is 'forbidden', retry after 5 seconds.
     * If 'success', parse the response, load the dealer script,
     * and call doDealer().
     *
     * Side effects: AJAX POST to host_ott/swop/a.php; may load
     * a dynamic script; may call showError() or hide #listEdit.
     */
    function poll(): void {
        if (cancelled) return;
        $.ajax({
            url: host_ott_proto + host_ott + "/swop/a.php",
            data: { c: "get_val", d: code },
            type: "POST",
            timeout: 1e4,
            cache: false,
            success: function (data: any) {
                if (cancelled) return;
                if (data.status === "forbidden") setTimeout(poll, 5e3);
                else if (data.status === "success") {
                    if (!data.data) showError("Error Code!");
                    else
                        getScriptDOM(
                            host +
                                "/d/" +
                                data.data.split(":")[0] +
                                ".js?" +
                                __cv,
                            function () {
                                try {
                                    doDealer(data.data);
                                    $("#listEdit").hide();
                                } catch (e) {
                                    console.error(e);
                                    showError("Error Code!");
                                }
                            },
                            function () {
                                showError("Error Code!");
                            },
                        );
                }
            },
            error: function (jqXHR: any) {
                $("#listEdit").html(
                    '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                        jqXHR.responseText +
                        "</div>",
                );
            },
        });
    }

    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listEdit")
        .html(
            '<div style="text-align:center;font-size:larger;"><br/><br/>' +
                _("Send request") +
                "...</div>",
        )
        .show();
    editKey = function (key: number) {
        if (key === keys.RETURN || key === keys.EXIT) cleanup();
        return true;
    };
    $.ajax({
        url: host_ott_proto + host_ott + "/swop/a.php",
        data: { c: "get_var", n: _("Enter Provider Code"), v: "" },
        type: "POST",
        timeout: 1e4,
        cache: false,
        success: function (data: any) {
            code = data.code;
            $("#listEdit").html(
                '<div style="text-align:center;font-size:larger;"><br/>' +
                    _("Request sended!") +
                    "<br/><br/>" +
                    _("For enter value open") +
                    '<br/><span style="font-size:larger;color:' +
                    curColor +
                    '">' +
                    __test +
                    "ott-play.com/swop</span> " +
                    _("and enter code") +
                    ' <span style="font-size:larger;color:' +
                    curColor +
                    '">' +
                    code +
                    "</span><br/><br/>" +
                    _("or scan") +
                    ":<br/><br/>" +
                    '<div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://' +
                    __test +
                    "ott-play.com/swop/?" +
                    code +
                    '" style="height:30%;"/></div>' +
                    "</div>",
            );
            setTimeout(poll, 1e4);
        },
        error: function (jqXHR: any) {
            $("#listEdit").html(
                '<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>' +
                    jqXHR.responseText +
                    "</div>",
            );
        },
    });
}

// ─── Dune add settings (provider hook) ────────────────────────────────────────

/**
 * Called by provider scripts (prov.js) to extend the settings/popup UI.
 * Override point — providers assign a function that inserts their own
 * settings entries into popupActions/popupArray/popupDetail at the
 * given index.
 * Initially null; set by provider scripts after load.
 *
 * @param _index - The index in popupActions where provider items should
 *                 be inserted.
 */
declare var duneAddSettings: ((_index: number) => void) | null;

// ─── getChanelsArray callback pattern ─────────────────────────────────────────

/**
 * Called by provider scripts to supply the channel list.
 * Override point — providers implement this function to parse their
 * channel data and populate cats/chanels/etc., then invoke the callback.
 * The default implementation immediately calls the callback (no-op).
 *
 * @param _callback - Function to call once channel data is loaded.
 */
export function getChanelsArray(_callback: () => void): void {
    // Override in provider scripts
    _callback();
}

// ─── Channel list UI ──────────────────────────────────────────────────────────

/**
 * Render the channel list for a given category, with selection index set
 * to channelIdx. Builds the channel row template (number, archive indicator,
 * picon, name, program progress bar) and installs list handlers.
 *
 * @param catIdx - Category index in catsArray.
 * @param channelIdx - Initial selection index within the category.
 *
 * Side effects: Populates getListItemFn, detailListAction, listKeyHandlerFn;
 * writes to listDetail, listCaptionElement, listPodval, #listPopUp;
 * calls setPopupChannels() and showPage(). Sets previewChan if sPreview
 * matches.
 *
 * Edge cases:
 * - If catsArray[catIdx] is undefined, shows an error via infoBox().
 * - Channel rendering skips missing channels with an error message.
 * - Parental-restricted channels get red styling.
 * - If stbPlayPip exists, a PiP button is added to the footer.
 */
function _channelsList(catIdx: number, channelIdx: number): void {
    if (catsArray[catIdx] === undefined) {
        infoBox(
            "ERROR: Category #" +
                catIdx +
                " does not exist!<br /> Please select other",
        );
        client_feedb(
            "category_trouble_channelsList: " +
                catIdx +
                " / " +
                catsArray.length +
                " / " +
                Object.keys(providerGetJson("cats", {})).length,
        );
    }
    selIndex = channelIdx;
    listCatIndex = catIdx;
    listArray = cats[catsArray[listCatIndex]] || [];
    var wk = getWidthK();
    var itemH = (window.innerHeight - 90 * getHeightK()) / pageSize;
    var numWidth = 0;
    if (sShowNum)
        try {
            var testEl = $("#testFont");
            testEl.text("9");
            numWidth =
                testEl.width() * listArray.length.toString().length + 6 * wk;
            testEl.text("");
        } catch (e) {
            console.error(e);
        }
    var archWidth = sShowArchive ? 3 * wk : 0;
    var pikonSize = [0, itemH - 2, itemH * 1.5][sShowPikon];
    var pikonMargin = pikonSize || !archWidth ? 6 * wk : 0;
    var progWidth = sShowProgress ? 40 * wk : 0;
    var progBarH = Math.floor(itemH / 3.5);
    var progMargin = sShowProgress ? Math.floor((itemH - progBarH) / 2) : 0;

    getListItemFn = function (chId: string, idx: number) {
        var ch = chanels[chId];
        if (!ch)
            return (
                "&nbsp;&nbsp;" +
                _("Channel is not available!!!") +
                " id=" +
                chId
            );
        var textW =
            itemWith -
            numWidth -
            pikonSize -
            pikonMargin -
            progWidth -
            2 * progMargin -
            archWidth * 3;
        var progName = getCurProgData(chId, updateChanelList) ? ch.name : "";
        if (ch.outdated === true)
            progName =
                '<i style="color:#3c3c0a">' +
                _("no epg at current time") +
                "</i>";
        var pct = progName
            ? ((Date.now() / 1e3 - ch.time) / (ch.time_to - ch.time)) * 100
            : 0;
        var parentalStyle =
            !sPSchannels ||
            parentPIN === "*" ||
            parentalArray.indexOf(chId) === -1
                ? ""
                : "color:#a00;";
        return (
            (numWidth
                ? '<div style="float:left;width:' +
                  numWidth +
                  "px;text-align:right;" +
                  parentalStyle +
                  '">' +
                  (idx + 1) +
                  "</div>"
                : "") +
            (archWidth
                ? '<div style="float:left;width:' +
                  archWidth +
                  "px;" +
                  (ch.rec ? "background-color:lime;" : "") +
                  "margin:" +
                  archWidth +
                  "px;height:" +
                  (itemH - archWidth * 2) +
                  'px"></div>'
                : "") +
            '<div class="img" style="background-image:url(\'' +
            (pikonSize ? getChannelPicon(chId) : "") +
            "'); width:" +
            pikonSize +
            "px;margin-left:" +
            pikonMargin +
            'px;"></div>' +
            '<div style="float:left; width:' +
            textW +
            "px; color:" +
            bodyColor +
            '; overflow:hidden;">&nbsp;' +
            (sShowName ? ch.channel_name + "&nbsp;" : "") +
            (sShowProgram
                ? '<span id="pn' +
                  chId +
                  '" style="color:' +
                  curColor +
                  ';">' +
                  progName +
                  "</span></div>"
                : "</div>") +
            (progWidth
                ? '<div class="progress_div" style="width:' +
                  progWidth +
                  "px;margin:" +
                  progMargin +
                  'px;"><div id="pr' +
                  chId +
                  '" style="width:' +
                  pct +
                  "%;height:" +
                  progBarH +
                  "px;background-color:" +
                  curColor +
                  ';font-size:1px;"></div></div>'
                : "")
        );
    };
    listDetail.innerHTML = "";
    detailListAction = detailProg;
    listKeyHandlerFn = channelsKeyHandler;
    listCaptionElement.innerHTML =
        _("Channel list. Category: ") + (catsArray[listCatIndex] || "");
    listPodval.innerHTML =
        btnDiv(
            keys.RED,
            "",
            "EPG",
            strEPG,
            sArrowFun === 2
                ? strRIGHT
                : sRewFun === 1
                  ? strFF
                  : sPNFun === 1
                    ? strNEXT
                    : "",
        ) +
        btnDiv(
            keys.BLUE,
            "",
            "Category",
            strPlayPause,
            sArrowFun === 2
                ? strLEFT
                : sRewFun === 1
                  ? strRW
                  : sPNFun === 1
                    ? strPREV
                    : "",
        ) +
        btnDiv(keys.YELLOW, "", "Actions", strTools, "0") +
        btnDiv(keys.N2, strInfo, "Description", "2") +
        (typeof stbPlayPip === "function"
            ? btnDiv(keys.PIP, strPip, "Open in PiP", strSTOP, "5")
            : "");
    setPopupChannels();
    $("#listPopUp").hide();
    (window as any).listDataArray = listArray;
    previewChan =
        sPreview && catIdx === catIndex && channelIdx === primaryIndex
            ? { c: catIdx, i: channelIdx, ch_id: listArray[selIndex] }
            : null;
    showPage();
}

// ─── First run setup wizard ───────────────────────────────────────────────────

/**
 * Show the "First Run Setup" list — a wizard that appears when no provider
 * is yet configured. Provides options to enter a provider code, load
 * settings, or manually select a provider.
 *
 * Side effects: Populates listArray with action entries; installs list
 * handlers; writes to listCaptionElement, listPodval; calls showPage().
 *
 * Edge case: If loadOpt (loadAllOptions) is a function, inserts an extra
 * "Load settings from storage" entry at index 3.
 */
export function firstRun(): void {
    listArray = [
        { action: edit_dealer, name: _("Enter Provider Code") },
        {
            action: edit_dealer_remote,
            name: _("Enter Provider Code on PC or Phone"),
        },
        { action: loadSettings, name: _("Load settings") },
        { action: nofun, name: "" },
        { action: selectProvaider, name: _("Manual setup") },
    ];
    if (typeof loadOpt === "function")
        listArray.splice(3, 0, {
            action: loadOpt,
            name: _("Load settings from storage"),
        });
    selIndex = 0;
    getListItemFn = function (item: any, _idx: number) {
        return "&nbsp;&nbsp;" + (item.name || "");
    };
    detailListAction = function () {
        listDetail.innerHTML = listArray[selIndex].name || "";
    };
    listKeyHandlerFn = function (key: number) {
        switch (key) {
            case keys.EXIT:
            case keys.RETURN:
                selectLang();
                return true;
            case keys.ENTER:
                if ((listArray[selIndex] as any).action)
                    (listArray[selIndex] as any).action();
                return true;
        }
        return false;
    };
    listCaptionElement.innerHTML = _("First Run Setup");
    listPodval.innerHTML = btnDiv(keys.RETURN, strRETURN, "Close");
    $("#listPopUp").hide();
    listDataArray = listArray;
    showPage();
}
