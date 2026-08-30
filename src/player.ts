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
// View helpers
import {
    setColor,
    setEditor,
    setFontSize,
    setListPos,
    setPipPosBuf,
    setSleepTimeout,
    stbSetOsdOpacity,
} from "./view/display-helpers";

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
var getListItemFn: ((item: any, idx: number) => string) | null = null;
var detailListActionFn: (() => void) | null = null;
var listKeyHandlerFn: ((key: any) => boolean) | null = null;
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
import {
    addBtn2menu,
    delOption,
    indexOfAction,
    optIndexOf,
} from "./view/options-helpers";

declare var optionsArr: { action: any; name?: string; desc?: string }[];

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

// Settings helpers
import { setTimezone } from "./settings/helpers";

// Provider-scoped storage aliases
import {
    _providerDelItem,
    _providerGetItem,
    _providerHasItem,
    _providerHasItemValue,
    _providerSetItem,
} from "./storage/provider-helpers";

// UI-related DOM element references
import { initUIReferences } from "./view/ui-helpers";
