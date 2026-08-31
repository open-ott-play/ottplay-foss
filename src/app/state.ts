/**
 * Application state for OTT-play FOSS
 * Centralized global state management
 */

// Version
export const PLAYER_VERSION = "__OTTP_VERSION__";

// Host URL
export let hostUrl = "";

// Device type
export let deviceType = "";

// EPG domain
export let epgDomain = "";

// Parental PIN
export let parentPIN = "1234";

// Hide menus list
export let hideMenus: string[] = [];

// Sleep timer
export let sleepTimer: any = null;

// Info timeout
export let infoTimeout: any = null;

// Number input state
export let numberBuffer = "";
export let numberTimeout: any = null;

// List state
export let isListVisible = false;
export let listSelectionIndex = 0;
export let listDataArray: any[] = [];
export let getListItemFn: ((item: any, idx: number) => string) | null = null;
export let detailListActionFn: (() => void) | null = null;
export let listKeyHandlerFn: ((key: any) => boolean) | null = null;
export let selIndex = 0;
export let listArray: any[] = [];

// Edit mode
export let isEditMode = false;
export let editCaption = "";
export let editValue = "";

// Select box
export let isSelectBox = false;

// PiP state
export let pipIndex: number | null = null;
export let pipCatIndex = 0;

// Preview
export let previewChan: any = null;
export let previewTimer: any = null;

// Popup state
export const popupActions: any[] = [];
export const popupArray: string[] = [];
export const popupDetail: any[] = [];

// Saved popup (for provider-switch restoration)
export const savedPopup: {
    ver: string;
    popupActions: any[];
    popupArray: string[];
    popupDetail: any[];
} = { ver: PLAYER_VERSION, popupActions: [], popupArray: [], popupDetail: [] };

export const version: string = PLAYER_VERSION;

// Options system (ported from stbPlayer.js)
export const optionsArr: { action: any; name?: string; desc?: string }[] = [];

// Font family list
export const fontFamilyList = [
    "",
    "Roboto, ",
    "RobotoCondensed, ",
    "Caveat, ",
    "Liberation, ",
    "Gabriela, ",
    "PTSansNarrow, ",
];

// Color state — defaults from original stbPlayer.js
export let curColor = "gold";
export let curColorB = "#668";
export let bodyColor = "#f0f0f0";

// Page size
export let pageSize = 25;

// ponytail: setter indirection — callers in other modules must not reassign
// the imported binding directly (illegal in strict ES modules). Route through
// this setter instead.
export function setPageSize(val: number): void {
    pageSize = val;
}
export function setIsListVisible(val: boolean): void {
    isListVisible = val;
}
export function setListSelectionIndex(val: number): void {
    listSelectionIndex = val;
}
export function setListDataArray(val: any[]): void {
    listDataArray = val;
}
export function setGetListItemFn(
    val: ((item: any, idx: number) => string) | null
): void {
    getListItemFn = val;
}
export function setDetailListActionFn(val: (() => void) | null): void {
    detailListActionFn = val;
}
export function setListKeyHandlerFn(val: ((key: any) => boolean) | null): void {
    listKeyHandlerFn = val;
}

// TMDb
export const TMDb: any = {
    prepare: function () {
        // ponytail: TMDb.prepare is a stub reserved for future use
    },
};

// Performance stamps
export const perfStamps: string[] = [];

// Media check timer
export let mediaCheckTimer: any = null;

// Sleep timer indirection setter — must not reassign exported let from another module
export function setSleepTimer(val: any): void {
    sleepTimer = val;
}

// Backward compat capability detection (was window.client_can)
export const client_can_https = false;
export const client_can = {
    https: client_can_https,
    localstorage: typeof window.localStorage !== "undefined",
    websocket: typeof window.WebSocket !== "undefined",
    is_maple:
        typeof navigator !== "undefined" &&
        navigator.userAgent.indexOf("Maple 6") !== -1,
    crossxhr:
        typeof navigator !== "undefined" &&
        !/(?:Viera\/1\.)/.test(navigator.userAgent),
};
