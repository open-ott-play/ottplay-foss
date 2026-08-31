/**
 * Channel management — data structures, navigation, favorites, parental control.
 *
 * Ported from stbPlayer.js (partial — ~130 of 314 original functions).
 */

import {
    videoPip as pipVideoElement,
    playerMode,
    video as videoElement,
} from "../core/index";
import { settings } from "../settings/index";
import { providerSetItem, storage } from "../storage/index";

export interface Channel {
    adult?: number;
    category?: { name: string; class: string };
    ch_id: number;
    channel_name: string;
    cmd?: string;
    descr?: string;
    description?: string | (() => string);
    icon?: string;
    logo_30x30?: string;
    name?: string;
    nextpr?: EPGEntry[] | null;
    number?: string;
    outdated?: boolean;
    playlist_url?: string;
    rec?: number;
    search_on?: boolean;
    stream_url?: string | (() => string);
    time?: number;
    time_request?: number;
    time_to?: number;
    title?: string;
    url?: string;
}

export interface EPGEntry {
    ch_id?: number;
    descr: string;
    icon?: string;
    name: string;
    time: number;
    time_to: number;
}

export interface PreviousChannel {
    c: number;
    ci: number;
    e?: string;
    i: number;
    t?: number;
}

export interface MediaHistoryEntry {
    adult?: number;
    ch_id?: number;
    current?: number;
    description?: string | (() => string);
    fav?: number;
    logo_30x30?: string;
    name?: string;
    playlist_url?: string;
    search_on?: boolean;
    stream_url?: string | (() => string);
    title?: string;
}

/* ---------------------------------------------------------------------------
 * Module-level state — channels, categories, EPG, settings, UI strings
 * --------------------------------------------------------------------------- */

/** Map of channel ID → Channel object, populated from the provider. */
export let channels: Record<number, Channel> = {};
/** Alias for `channels` (legacy compatibility with older code). */
export let chanels = channels;
/** Map of channel ID → array of EPGEntry (program guide data). */
export let epg: Record<number, EPGEntry[]> = {};
/** Map of category name → array of channel IDs in that category. */
export let cats: Record<string, number[]> = {};
/** Ordered list of category names (display order). */
export let catsArray: string[] = [];
/** Channel-ID array for the currently active category. */
export let curList: number[] = [];
/** Provider prefix string (used for storage key scoping). */
export let providerPrefix = "";

/* ---- UI label strings (may contain HTML/icon markup) ---- */
export let strInfo = "INFO";
export let strEPG = "EPG";
export let strSubt = "";
export let strNew = ' <span style="color:red;font-size:60%;">NEW</span>';
export let strUP = '<span class="fontello">&#xe80b;</span>';
export let strDOWN = '<span class="fontello">&#xe80a;</span>';
export let strLEFT = '<span class="fontello">&#xe80c;</span>';
export let strRIGHT = '<span class="fontello">&#xe80d;</span>';
export let strSTOP = '<span class="fontello">&#xe812;</span>';
export let strPLAY = '<span class="fontello">&#xe811;</span>';
export let strPAUSE = '<span class="fontello">&#xe813;</span>';
export let strPlayPause = '<span class="fontello">&#xe811;&#xe813;</span>';
export let strRW = '<span class="fontello">&#xe803;</span>';
export let strFF = '<span class="fontello">&#xe802;</span>';
export let strPREV = '<span class="fontello">&#xe806;</span>';
export let strNEXT = '<span class="fontello">&#xe805;</span>';

/** List of module state keys that should be persisted via the provider storage API. */
export const persistedKeys: string[] = [
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

/* ---- All exported settings variables (mapped from stored preferences) ---- */
export let sNoSmall = 0,
    sStopPlay = 0,
    sPipSize = 0,
    sPipPos = 0,
    sPageSize = 25;
export let sFontShift = 4,
    sFont = 1,
    sArrowFun = 0,
    sRewFun = 0,
    sPNFun = 0;
export let sRfun = 10,
    sGfun = 0,
    sYfun = 1,
    sBfun = 9;
export let sALfun = 0,
    sARfun = 0,
    sAUfun = 0,
    sADfun = 0;
export let sRWfun = 0,
    sFFfun = 0,
    sPREVfun = 0,
    sNEXTfun = 0;
export let sEfun = 0,
    sOkfun = 0;
export let s13dur = 0,
    s46dur = 0,
    s79dur = 0;
export let sNoColorKeys = 0,
    sNoNumbersKeys = 0;
export let sTimezone = 0,
    sSleepTimeout = 0,
    sVolumeStep = 5;
export let sInfoTimeout = 5,
    sInfoSlide = 1,
    sInfoSwitch = 1,
    sInfoChange = 1,
    sInfoRew = 1;
export let sThumbnail = 1,
    sOsdOpacity = 7,
    sListPos = 0;
export let sSHLcolSel = "240,25",
    eSHLcolSel = "",
    sSHLcolor = "50,85",
    eSHLcolor = "",
    sSHLcolorB = "255,0",
    eSHLcolorB = "";
export let sEditor = 0,
    sShowNum = 1,
    sShowPikon = 1,
    sShowName = 1,
    sShowProgress = 1;
export let sShowArchive = 1,
    sShowScroll = 1,
    sShowDescr = 1,
    sShowProgram = 1,
    sPreview = 0;
export let sNextCount = 0,
    sNextCountL = 1,
    sFavorites = 0,
    sPermanentTime = 0,
    s10resum = 1;
export let sPrevCount = 2,
    sMedCount = 2;
export let sPSchannels = 1,
    sPSoptions = 0,
    sPSprovs = 0,
    sHDMIsupport = 0,
    sAutorun = 0;
export let sPlayers = 0,
    sBufSize = 0,
    sGrapI = 0;
export let parentPIN = "1234",
    sHideMenus: string[] = [];

/* ---- Per-channel aspect/audio/subtitle/zoom records ---- */
export let aAspects: Record<string, number> = {};
export let aAudios: Record<string, number> = {};
export let aZooms: Record<string, number> = {};
export let aSubs: Record<string, number> = {};

/* ---- Navigation & history state ---- */
export let version = "",
    primaryIndex = 0,
    catIndex = -1;
export let cList: number[] = [],
    prevArr: PreviousChannel[] = [];
export let favoritesArray: number[] = [],
    parentalArray: number[] = [];
export let epgTimers: any[] = [],
    sSortAbc = 0;
export let medHistory: MediaHistoryEntry[] = [],
    medFavorites: MediaHistoryEntry[] = [];
export let historySearchText = "";

/* ---- Playback & EPG state ---- */
export let playType = 0,
    playTime = 0,
    forcePlay = false;
export let _prog100: any = null,
    _tmedia: any = null;
export let epgCash = 0;
export let epgCashObj: Record<number, EPGEntry[]> = {};
export let epgCashArr: number[] = [];
export let arrayGetCurProg: Array<{
    ch_id: number;
    callback: (chId: number) => void;
}> = [];
export let epglisted = 0,
    listChannel = 0,
    epg_ch_id: any = null;

/**
 * Process the EPG request queue. Pops the next entry and fetches EPG data
 * via getEPGchanelCurCached, then recurses until the queue is empty.
 * Matches old stbPlayer.js doGetCurProg() behavior.
 */
export function doGetCurProg(): void {
    if (arrayGetCurProg.length === 0) return;
    var entry = arrayGetCurProg.shift();
    var chId = entry!.ch_id;
    // Use getEPGchanelCurCached if available (set by provider), else getEPGchanelCached
    var fetchFn = (window as any).getEPGchanelCurCached || getEPGchanelCached;
    if (typeof fetchFn === "function") {
        fetchFn(chId, function (_id: any, epgData: EPGEntry[] | null) {
            setCurProg(chId, epgData, function () {
                entry!.callback(chId);
            });
            // Use setTimeout to prevent infinite recursion if callback triggers another fetch
            setTimeout(doGetCurProg, 0);
        });
    } else {
        // No fetch function available — skip and process next
        doGetCurProg();
    }
}
export let curEpgData: EPGEntry[] | null = null,
    listEpgArray: EPGEntry[] = [];
export let epgArray: EPGEntry[] = [],
    curProg = -1;
export let mediaListArr: any[] = [],
    mediaUrls: any = null;
export let mediaNames: string[] = [],
    mediaSelects: number[] = [];
export let mediaRecords: any[] = [],
    mediaRecordsPar: any[] = [];
export let mediaName = "";
export let searchText = "",
    searchInput = "",
    searchTimeout: any = null;
export let archivePos = 0,
    archiveStart = 0,
    archiveEnd = 0;
export let fileArchive = false;

/* ---- Timeshift / catchup state (restored from stbPlayer.js) ---- */
var _shiftTimer: any = null;
var _shiftSec = 0;

/**
 * Switch the current category and channel selection.
 * Updates the "previous channel" history (`prevArr`) unless the switch is
 * from a media-item playback (playType === -99999999999).
 *
 * @param categoryIndex - Index into `catsArray` for the new category.
 * @param channelIndex  - Index into the category's channel list (`curList`).
 * @param isArchive     - If true, the new selection is an archive (time-shifted) playback.
 *
 * Side effects:
 * - Mutates `prevArr` (push old position, trim to configured max count).
 * - Updates `catIndex`, `curList`, `primaryIndex`.
 * - Syncs values to `window` globals for legacy code compatibility.
 * - When playType is -99999999999 (media mode), saves current media position to history.
 */
export function setCurrent(
    categoryIndex: number,
    channelIndex: number,
    isArchive?: boolean
): void {
    var wasArchive = playType > 0;
    if (
        categoryIndex !== catIndex ||
        channelIndex !== primaryIndex ||
        (isArchive !== wasArchive &&
            channelIndex !== -1 &&
            playType !== -99999999999)
    ) {
        if (playType === -99999999999) {
            if (medHistory.length && medHistory[0].current !== undefined) {
                medHistory[0].current = Math.floor(
                    (window as any).video?.currentTime || 0
                );
            }
        } else {
            try {
                var oldCatId = cats[catsArray[catIndex]]?.[primaryIndex];
                var newCatId = cats[catsArray[categoryIndex]]?.[channelIndex];
                prevArr = prevArr.filter(function (prev: PreviousChannel) {
                    var hasTime = prev.t !== undefined;
                    return (
                        (prev.ci !== oldCatId || hasTime !== wasArchive) &&
                        (prev.ci !== newCatId || hasTime !== isArchive)
                    );
                });
                prevArr.unshift({
                    ci: oldCatId,
                    c: catIndex,
                    i: primaryIndex,
                    e: _prog100?.name,
                });
                if (wasArchive && prevArr[0])
                    prevArr[0].t = playType + playTime;
                var prevCount = [1, 5, 10, 15, 20][settings.prevCount] || 10;
                prevArr.splice(prevCount);
            } catch (e) {
                console.error(e);
            }
        }
        if (channelIndex === -1) return;
    }
    catIndex = categoryIndex;
    curList = cats[catsArray[catIndex]] || [];
    primaryIndex = channelIndex;
    // Sync to globals for backward compat with old-style code
    (window as any).catIndex = categoryIndex;
    (window as any).curList = curList;
    (window as any).primaryIndex = channelIndex;
    // Persist current channel position (original stbPlayer.js saves at this point)
    providerSetItem("primaryIndex", String(primaryIndex));
    providerSetItem("catIndex", String(catIndex));
    // Also save prevArr if it was updated
    if (prevArr.length) providerSetItem("prevArr", JSON.stringify(prevArr));
}

/**
 * Move to the next channel in the current category (wraps around to index 0).
 *
 * Side effects: Calls `window.playChannel` which triggers playback switch.
 */
export function nextChannel(): void {
    var nextIndex = primaryIndex + 1;
    if (nextIndex >= curList.length) nextIndex = 0;
    if (typeof (window as any).playChannel === "function")
        (window as any).playChannel(catIndex, nextIndex);
}

/**
 * Move to the previous channel in the current category (wraps to the end).
 *
 * Side effects: Calls `window.playChannel` which triggers playback switch.
 */
export function prevChannel(): void {
    var prevIndex = primaryIndex - 1;
    if (prevIndex < 0) prevIndex = curList.length - 1;
    if (typeof (window as any).playChannel === "function")
        (window as any).playChannel(catIndex, prevIndex);
}

/**
 * Delegate a numeric key press to the global `numberProg` handler for channel-number input.
 *
 * @param digit - The pressed digit (0-9).
 *
 * Side effects: Calls `window.numberProg(digit)` if defined.
 */
export function handleNumberInput(digit: number): void {
    if (typeof (window as any).numberProg === "function")
        (window as any).numberProg(digit);
}

/**
 * Resolve a playable URL string from a Channel object or channel ID.
 * Checks `url`, then `cmd`, then `stream_url` in order.
 *
 * @param channelOrId - A Channel object or numeric channel ID.
 * @returns The resolved stream URL, or empty string if the channel is not found or has no URL.
 */
export function getChannelUrl(channelOrId: Channel | number): string {
    var ch: Channel;
    if (typeof channelOrId === "number") {
        ch = channels[channelOrId];
    } else {
        ch = channelOrId;
    }
    if (!ch) return "";
    return ch.url || ch.cmd || (ch.stream_url as string) || "";
}

/**
 * Add a channel ID to the favorites list if not already present.
 *
 * Side effects: Mutates `favoritesArray` in-memory (does NOT persist — call saveChannelsCats).
 */
export function addToFavorites(channelId: number): void {
    if (favoritesArray.indexOf(channelId) === -1)
        favoritesArray.push(channelId);
}

/**
 * Remove a channel ID from the favorites list if present.
 *
 * Side effects: Mutates `favoritesArray` in-memory (does NOT persist).
 */
export function removeFromFavorites(channelId: number): void {
    var idx = favoritesArray.indexOf(channelId);
    if (idx !== -1) favoritesArray.splice(idx, 1);
}

/**
 * Persist the current `catsArray`, `cats`, `favoritesArray`, and `parentalArray`
 * to storage via the provider API.
 *
 * Side effects: Writes JSON strings to provider storage (async via providerSetItem).
 */
export function saveChannelsCats(): void {
    if (typeof providerSetItem === "function") {
        providerSetItem("catsArray", JSON.stringify(catsArray));
        providerSetItem("cats", JSON.stringify(cats));
        providerSetItem("favoritesArray", JSON.stringify(favoritesArray));
        providerSetItem("parentalArray", JSON.stringify(parentalArray));
    }
}

/**
 * Check whether a channel has an active parental lock.
 *
 * @param channelId - The channel ID to check.
 * @returns `true` if the channel ID is in the `parentalArray`.
 */
export function hasParentalLock(channelId: number): boolean {
    return parentalArray.indexOf(channelId) !== -1;
}

/**
 * Guard function: if parental control is enabled and not yet authorised,
 * prompt the user to enter their PIN before proceeding.
 *
 * @param callback - Function to execute once access is granted.
 * @returns `true` if a PIN prompt was shown (access was blocked), `false` if access is free.
 *
 * Side effects: May call `window.enterPinAndSetAccess`, which shows a PIN dialog.
 */
export function ifParentalAccess(callback: () => void): boolean {
    if (
        settings.psChannels &&
        (window as any).parentPIN !== "*" &&
        !(window as any).parentAccess
    ) {
        if (typeof (window as any).enterPinAndSetAccess === "function")
            (window as any).enterPinAndSetAccess(callback);
        return true;
    }
    return false;
}

/**
 * Guard function combining `hasParentalLock` and `ifParentalAccess`.
 * Only shows the PIN prompt if the specific channel is locked.
 *
 * @param channelId - The channel to test for parental lock.
 * @param callback  - Function to execute once access is granted.
 * @returns `true` if a PIN prompt was shown, `false` otherwise.
 */
export function ifParentalAccessChId(
    channelId: number,
    callback: () => void
): boolean {
    if (hasParentalLock(channelId)) return ifParentalAccess(callback);
    return false;
}

/**
 * Look up EPG data for a channel from the in-memory cache (`epg` map).
 * Calls the callback synchronously with the cached data or `null`.
 *
 * @param channelId - Channel ID to look up.
 * @param callback  - Receives `(chId, programs | null)`.
 *
 * Side effects: None (pure lookup).
 */
export function getEPGchanelCached(
    channelId: number,
    callback: (chId: number, programs: EPGEntry[] | null) => void
): void {
    var cached = epg[channelId];
    if (cached) {
        callback(channelId, cached);
        return;
    }
    callback(channelId, null);
}

/**
 * Get the currently cached EPG array for a channel, or null.
 * Convenience wrapper over `epg[channelId]`.
 *
 * @param channelId - Channel ID.
 * @returns The EPGEntry[] or null if not cached.
 */
export function getEPGchanelCurCached(channelId: number): EPGEntry[] | null {
    return epg[channelId] || null;
}

/**
 * Retrieve EPG data from the secondary EPG cash (`epgCashObj`).
 * This is a separate cache from `epg` (used for older fetched data).
 *
 * @param channelId - Channel ID.
 * @returns The EPGEntry[] or null.
 */
export function getEpgFromCash(channelId: number): EPGEntry[] | null {
    return epgCashObj[channelId] || null;
}

/**
 * Check if cached EPG contains a program currently airing for the given channel.
 * If found, invokes the callback with the channel ID.
 *
 * @param channelId - Channel ID to check.
 * @param callback  - Invoked with `channelId` if current program is found.
 * @returns `true` if a current program was found (and callback was called), `false` otherwise.
 */
export function getCurProgData(
    channelId: number,
    callback: (chId: number) => void
): boolean {
    var ch = (window as any).chanels
        ? (window as any).chanels[channelId]
        : undefined;
    var now = Date.now() / 1000;
    // If channel object already has current EPG data, return true immediately (sync path)
    if (ch && ch.time_to && ch.time_to >= now) return true;
    // If EPG was recently requested and not yet expired, skip (prevent duplicate requests)
    if (ch && ch.time_request && ch.time_request > now) return false;
    // Check the EPG cache as fallback
    var cached = epg[channelId];
    if (cached) {
        var idx = cached.findIndex(function (entry: EPGEntry) {
            return entry.time_to >= now && entry.time <= now;
        });
        if (idx !== -1) {
            setCurProg(channelId, cached, function () {
                callback(channelId);
            });
            return true;
        }
    }
    // Queue EPG fetch from server (matches old stbPlayer doGetCurProg behavior)
    arrayGetCurProg.push({ ch_id: channelId, callback: callback });
    if (arrayGetCurProg.length < 2) doGetCurProg();
    return false;
}

/**
 * Store EPG data for a channel in both the primary (`epg`) and secondary
 * (`epgCashObj`) caches, then optionally invoke a callback.
 *
 * @param channelId - Channel ID to associate the data with.
 * @param epgData   - EPG entry array to cache, or null (no-op for storage).
 * @param callback  - Optional function called after storing.
 *
 * Side effects: Writes to `epg[channelId]` and `epgCashObj[channelId]`.
 */
export function setCurProg(
    channelId: number,
    epgData: EPGEntry[] | null,
    callback?: () => void
): void {
    if (epgData) {
        epg[channelId] = epgData;
        epgCashObj[channelId] = epgData;
        // Populate channel object with current program (matching old stbPlayer behavior)
        var ch = (window as any).chanels
            ? (window as any).chanels[channelId]
            : undefined;
        if (ch) {
            var sorted = epgData.slice().sort(function (
                a: EPGEntry,
                b: EPGEntry
            ) {
                return a.time - b.time;
            });
            var now = Date.now() / 1000;
            var idx = sorted.findIndex(function (entry: EPGEntry) {
                return entry.time_to >= now && entry.time <= now;
            });
            if (idx === -1) {
                ch.name = "";
                ch.time = 0;
                ch.time_to = 0;
                ch.descr = "";
                ch.nextpr = null;
                ch.time_request = now + 3600;
                if (epgData.length > 0) ch.outdated = true;
            } else {
                var cur = sorted[idx];
                ch.name = cur.name;
                ch.time = cur.time;
                ch.time_to = cur.time_to;
                ch.descr = cur.descr || "";
                ch.time_request = 0;
                ch.nextpr = sorted.slice(idx + 1);
            }
        }
    }
    if (callback) callback();
}

/**
 * Callback invoked once the full channel list has been loaded from the provider.
 *
 * Responsibilities:
 * - Saves the pending provider ID to storage.
 * - Loads persisted category/favorites/parental data from storage.
 * - If no categories exist, builds them from the `category` field on each channel.
 * - Prepends the "All" and optionally "Favorites" virtual categories.
 * - Starts playback via `window.playChannel`.
 * - Loads EPG timers.
 * - If the channel list is empty, shows a configuration popup so the user can
 *   select a playlist/provider.
 *
 * Side effects:
 * - DOM mutations on #dialogbox, #launch, #buffering (hides them).
 * - Writes to STB storage (provider ID).
 * - Reads from STB storage (catsArray, cats, favoritesArray, parentalArray).
 * - Calls `window.playChannel` (starts playback).
 * - Calls `window.loadEpgTimers`.
 * - Console log "player ready!".
 */
export function onChanelsLoaded(): void {
    console.log("[onChanelsLoaded] cList.length=" + cList.length);
    try {
        if (cList.length) {
            // Save pending provider to storage on success
            if (
                (window as any)._pendingProvId &&
                typeof (window as any).stbSetItem === "function"
            ) {
                (window as any).stbSetItem(
                    "ottplayprov",
                    (window as any)._pendingProvId
                );
                if (typeof (window as any).stbSetItem === "function") {
                    var id = (window as any)._pendingProvId;
                    var arr = (window as any).arrayProvaiders;
                    var recentCount = 3;
                    if (arr && arr.indexOf(id) > recentCount - 1) {
                        var recentProviders: any[] = [];
                        try {
                            recentProviders = JSON.parse(
                                (window as any).stbGetItem("ottplayprovs") ||
                                    "[]"
                            );
                        } catch (_) {}
                        var rIdx: number = recentProviders.indexOf(id);
                        if (rIdx !== -1) recentProviders.splice(rIdx, 1);
                        recentProviders.push(id);
                        (window as any).stbSetItem(
                            "ottplayprovs",
                            JSON.stringify(recentProviders)
                        );
                    }
                }
                (window as any)._pendingProvId = "";
            }
            if (!sFavorites) {
                catsArray = (window as any).providerGetJson("catsArray", []);
                cats =
                    Array.isArray(catsArray) && catsArray.length > 0
                        ? (window as any).providerGetJson("cats", {})
                        : {};
            } else {
                favoritesArray = (window as any).providerGetJson(
                    "favoritesArray",
                    []
                );
            }
            if (!catsArray.length && cList.length) {
                cList.forEach(function (chId: number) {
                    var ch = (window as any).chanels[chId];
                    if (ch && ch.category) {
                        if (!cats[ch.category.name]) {
                            catsArray.push(ch.category.name);
                            cats[ch.category.name] = [];
                        }
                        cats[ch.category.name].push(chId);
                    }
                });
            }
            parentalArray = (window as any).providerGetJson(
                "parentalArray",
                []
            );
            if (
                !parentalArray.length &&
                typeof (window as any).parental !== "undefined"
            ) {
                cList.forEach(function (chId: number) {
                    var ch = (window as any).chanels[chId];
                    if (
                        ch &&
                        ch.category &&
                        ch.category.name &&
                        (window as any).parental.test(ch.category.name)
                    ) {
                        parentalArray.push(chId);
                    }
                });
            }
            catsArray.unshift((window as any)._("All"));
            cats[(window as any)._("All")] = cList.slice();
            if (sFavorites) {
                catsArray.unshift((window as any)._("Favorites"));
                cats[(window as any)._("Favorites")] = favoritesArray;
            }
            // Sync module cats/catsArray/curList to globals (used by _channelsList, old code)
            (window as any).catsArray = catsArray;
            (window as any).cats = cats;
            (window as any).curList = curList;
            (window as any).catIndex = catIndex;
            (window as any).primaryIndex = primaryIndex;
            // Clamp catIndex and primaryIndex to valid ranges
            if (catIndex < 0 || catIndex >= catsArray.length)
                catIndex = sFavorites ? 1 : 0;
            curList = cats[catsArray[catIndex]] || [];
            if (primaryIndex < 0 || primaryIndex >= curList.length)
                primaryIndex = 0;
            // Start playback
            var el = document.getElementById("launch");
            if (el) el.innerHTML += "<br/>Start playback...";
            try {
                (window as any).playChannel(catIndex, primaryIndex);
            } catch (e) {
                console.error(e);
                primaryIndex = 0;
                catIndex = sFavorites ? 1 : 0;
                try {
                    (window as any).playChannel(catIndex, primaryIndex);
                } catch (e2) {
                    console.error(e2);
                }
            }
            try {
                (window as any).loadEpgTimers();
            } catch (e) {
                console.error(e);
            }
            // List must be hidden so main key handler gets events (ENTER, Q, C, etc.)
            (window as any).isListVisible = false;
        } else {
            // Empty channel list — show popup so user can configure provider (e.g., enter playlist URL)
            (window as any).playType = 0;
            setCurrent(sFavorites ? 1 : 0, 0);
            var launchEl = document.getElementById("launch");
            if (launchEl)
                launchEl.innerHTML += "<br/>Channel list not received !!!";
            // Reset pending provider so user can retry without hitting savedProvId === id
            (window as any)._pendingProvId = "";
            (window as any).launch_id = "#launch";
            // Show popup list so user can select 'Select playlist' to configure provider
            try {
                if (typeof (window as any).popupList === "function") {
                    var pActions = (window as any).popupActions;
                    if (pActions && pActions.length) {
                        (window as any).popupList();
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
    } catch (e) {
        console.error(e);
    }
    // Cleanup: hide loading element
    $("#dialogbox").hide();
    $("#launch").hide();
    $("#buffering").hide();
    console.log("player ready!");
}

/**
 * Format a numeric timestamp (Unix seconds or milliseconds) into a "HH:MM" string.
 *
 * @param timestamp - Unix timestamp (seconds). Values > 1e12 are treated as milliseconds.
 * @returns Formatted time string like "14:05", or "--:--" if the input is invalid.
 */
export function formatEpgTime(timestamp: number): string {
    if (typeof timestamp !== "number" || isNaN(timestamp)) return "--:--";
    // Heuristic: if timestamp > 1e12 it's probably milliseconds → convert to seconds
    var ts = timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp;
    var d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return "--:--";
    return (
        (d.getHours() < 10 ? "0" : "") +
        d.getHours() +
        ":" +
        (d.getMinutes() < 10 ? "0" : "") +
        d.getMinutes()
    );
}

/**
 * Render an EPG list item as an HTML string for display in the channel/EPG list.
 * Highlights the currently-airing program and shows record/archive indicators.
 *
 * @param item  - The EPG entry to render.
 * @param index - Unused index (kept for callback signature compatibility).
 * @returns HTML string suitable for injection into a list container.
 */
export function itemEPG(item: EPGEntry, index: number): string {
    var w = window as any;
    var name = item.name;
    var now =
        w.playType > 0 &&
        w.primaryIndex !== undefined &&
        w.curList &&
        w.listArray &&
        w.listArray[w.selIndex] == w.curList[w.primaryIndex]
            ? w.playType + w.playTime
            : Math.floor(Date.now() / 1000);
    var isCurrent = item.time <= now && item.time_to > now;

    if (isCurrent) {
        name =
            '<span style="color:' +
            (w.curColor || "#fff") +
            ';">' +
            name +
            "</span>";
    }

    var ch = (channels[epg_ch_id] || {}) as Channel;
    var prefix = "";
    if (ch.rec && item.time < Date.now() / 1000)
        prefix += '<div class="btn green">&nbsp;</div> ';
    if (isCurrent) prefix += '<div class="btn red">&nbsp;</div> ';

    return (
        "&nbsp;&nbsp;" +
        prefix +
        formatEpgTime(item.time) +
        " - " +
        formatEpgTime(item.time_to) +
        " " +
        (name || "")
    );
}

/**
 * Fetch EPG data for a single channel and update the local cache.
 * If `mode` is truthy, shows a loading spinner in #listPopUp.
 *
 * @param mode      - If non-zero, display a buffering spinner while loading.
 * @param catIdx    - Category index (passed through for context).
 * @param chIdx     - Channel index (passed through for context).
 * @param channelId - The channel ID (or provider channel ID) to fetch EPG for.
 * @param callback  - Called with `channelId` once EPG data is ready (or fails).
 *
 * Side effects:
 * - Mutates `epglisted` flag (prevents concurrent EPG fetches).
 * - Sets `epg_ch_id`, `curEpgData`.
 * - Shows/hides #listPopUp spinner.
 * - Calls `window.getEPGchanel` (provider API) and `window.setCurProg` on success.
 */
export function epgShow_miniproc(
    mode: number,
    catIdx: number,
    chIdx: number,
    channelId: any,
    callback: (chId: any) => void
): void {
    var w = window as any;
    if (epglisted) return;
    epglisted = 1;
    epg_ch_id = channelId;
    w.listCatIndex = catIdx;
    w.listChannel = chIdx;

    var ch = (channels[channelId] || {}) as Channel;
    var providerChId = ch.ch_id;

    if (mode) {
        $("#listPopUp")
            .html(
                '<img src="' +
                    w.host +
                    "/stbPlayer/buffering.gif?" +
                    w.__av +
                    '" height="40">'
            )
            .show();
    }

    if (typeof w.getEPGchanel === "function") {
        w.getEPGchanel(providerChId, function (id: any, data: EPGEntry[]) {
            epglisted = 0;
            if (id != providerChId) return;
            if (!data || data.length === 0) {
                curEpgData = null;
                $("#listPopUp").hide();
                w.listChannel |= 65536;
                if (typeof w.infoBox === "function")
                    w.infoBox(w._("Channel has no EPG"));
                return;
            }
            curEpgData = data;
            if (callback) callback(channelId);
            if (typeof (w as any).setCurProg === "function")
                (w as any).setCurProg(channelId, data, null);
        });
    } else {
        epglisted = 0;
    }
}

/**
 * Open the EPG list view for a specific channel.
 * Fetches EPG data if not already cached, then renders the list with
 * a "no EPG" fallback if the channel flag (65536) indicates absence.
 *
 * @param catIdx - Category index of the channel.
 * @param chIdx  - Channel index within the category.
 * @param force  - If true, bypasses some guards (currently unused in logic).
 *
 * Side effects:
 * - Calls `epgShow_miniproc` to fetch EPG data.
 * - Sets `window.listArray`, `window.getListItemFn`, etc. for the list UI.
 * - Hides #listPopUp.
 * - Calls `window.showPage` to refresh the visible list.
 */
export function epgList(catIdx: number, chIdx: number, force: boolean): void {
    var w = window as any;

    // Check if channel has EPG
    if (
        (w.listChannel & 65536) === 65536 &&
        (w.listChannel & 65535) === chIdx &&
        w.listCatIndex === catIdx
    ) {
        if (typeof w.infoBox === "function")
            w.infoBox(w._("Channel has no EPG"));
        return;
    }

    function onDataReady(channelId: any) {
        var epgData: EPGEntry[] = [];
        var ch = (channels[channelId] || {}) as Channel;
        if (curEpgData && curEpgData.length) {
            var now = Math.floor(Date.now() / 1000);
            epgData = curEpgData
                .filter(function (e) {
                    return ch.rec
                        ? e.time > now - ch.rec * 3600
                        : e.time_to > now - 7200;
                })
                .sort(function (a, b) {
                    return a.time - b.time;
                });
        }

        w.listArray = epgData;
        listEpgArray = epgData;
        w.getListItemFn = itemEPG;
        w.detailListActionFn = function () {
            if (typeof (window as any).detailEPG === "function")
                (window as any).detailEPG(channelId);
        };
        w.listKeyHandlerFn = epgKeyHandler;

        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML =
                w._("EPG and archive. Channel: ") + (ch.channel_name || "");

        if (typeof epgPodval === "function") epgPodval();
        $("#listPopUp").hide();
        if (typeof w.showPage === "function") w.showPage();
    }

    epgShow_miniproc(1, catIdx, chIdx, curList[chIdx], onDataReady);
}

/**
 * Handle selection of an EPG list item.
 * - If the program is in the future or channel has no archive, show program info.
 * - If the program has archive (rec > 0), play the archive from the start time,
 *   after checking parental access.
 *
 * Side effects:
 * - Calls `window.infoProgramm` for future/non-archive entries.
 * - Calls `ifParentalAccessChId` for locked channels.
 * - Calls `window.closeList`, `setCurrent`, `playArchive`.
 * - Sets `window.epgArray`.
 */
export function selectEpg(): void {
    var w = window as any;
    var ch: Channel = channels[epg_ch_id] || ({} as Channel);
    var item = w.listArray[w.selIndex];
    if (!item) return;

    if (!ch.rec || item.time > Date.now() / 1000) {
        if (typeof w.infoProgramm === "function") w.infoProgramm(item.name);
        return;
    }

    if (
        typeof ifParentalAccessChId === "function" &&
        ifParentalAccessChId(epg_ch_id, function () {
            selectEpg();
        })
    )
        return;

    if (typeof w.closeList === "function") w.closeList();
    if (typeof setCurrent === "function")
        setCurrent(w.listCatIndex, w.listChannel, true);

    // Update global epgArray for playback sync
    (window as any).epgArray = listEpgArray;
    if (typeof playArchive === "function") playArchive(item.time);
}

/**
 * Render the EPG list footer (podval) with button-hint icons for
 * Return, Enter, Red (Description), Green (Set timer), Yellow (TMDb).
 *
 * Side effects: Injects innerHTML into #listPodval.
 */
export function epgPodval(): void {
    var w = window as any;
    var podvalEl = document.getElementById("listPodval");
    if (!podvalEl) return;

    var html =
        w.btnDiv(w.keys.RETURN, w.strRETURN, "Close") +
        w.btnDiv(w.keys.ENTER, w.strENTER, "Play") +
        w.btnDiv(w.keys.RED, w.strInfo, "Description") +
        w.btnDiv(w.keys.GREEN, "", "Set timer") +
        w.btnDiv(w.keys.YELLOW, "", "TMDb");

    podvalEl.innerHTML = html;
}

/**
 * Key handler for the EPG list view.
 * Keys: ENTER (play/select), RED/INFO (program info), GREEN (set timer),
 * YELLOW (TMDb search), RETURN (close list).
 *
 * @param keyCode - The pressed key code.
 * @returns `true` if the key was handled, `false` to bubble up.
 *
 * Side effects: Delegates to `selectEpg`, `setEpgTimer`, `infoProgramm`,
 * `w.TMDb.search`, or `w.closeList`.
 */
export function epgKeyHandler(keyCode: number): boolean {
    var w = window as any;
    var keys = w.keys;
    var item = w.listArray[w.selIndex];
    if (!item) return false;

    switch (keyCode) {
        case keys.ENTER:
            selectEpg();
            return true;
        case keys.RED:
        case keys.INFO:
            if (typeof w.infoProgramm === "function") w.infoProgramm(item.name);
            return true;
        case keys.GREEN:
            if (typeof setEpgTimer === "function")
                setEpgTimer(epg_ch_id, item.time);
            return true;
        case keys.YELLOW:
            if (w.TMDb && typeof w.TMDb.search === "function")
                w.TMDb.search(item.name);
            return true;
        case keys.RETURN:
            if (typeof w.closeList === "function") w.closeList();
            return true;
    }
    return false;
}

/**
 * Render the detail/info panel for the currently selected EPG item in #listDetail.
 * Shows program name, time range, duration, elapsed time, and description/icon.
 *
 * @param channelId - The channel ID (used for context, but detail is from `window.listArray`).
 *
 * Side effects: Injects innerHTML into #listDetail, sets #_prd height, starts scroll.
 */
export function detailEPG(channelId: number): void {
    var w = window as any;
    var item = w.listArray[w.selIndex];
    if (!(item && w.listDetailElement)) return;

    var now = Math.floor(Date.now() / 1000);
    var dur = Math.round((item.time_to - item.time) / 60);
    var prog = Math.round((now - item.time) / 60);

    var html =
        '<div style="color:' +
        w.curColor +
        ';">' +
        item.name +
        "</div>" +
        '<div style="font-size:smaller;">' +
        formatEpgTime(item.time) +
        " - " +
        formatEpgTime(item.time_to) +
        " (" +
        (prog > 0 && prog < dur ? prog + "/" : "") +
        dur +
        " " +
        w._("min") +
        ")</div>" +
        '<div id="_prd" style="font-size:smaller;overflow:hidden;">' +
        (typeof w.getThumbnail === "function"
            ? w.getThumbnail(item.icon)
            : "") +
        (item.descr || "") +
        "</div>";

    w.listDetailElement.innerHTML = html;

    var s =
        ($("#listDetail").height() || 0) -
        ($("#_prd").prev().height() || 0) -
        ($("#_prd").prev().prev().height() || 0);
    $("#_prd").height(s > 0 ? s : 100);
    var px = $("#_prd").children().height() || 0;
    if (typeof w.scrollUp === "function") w.scrollUp("_prd", px - s, 5000);
}

/**
 * Render an array of EPG entries into a complete HTML string for use in
 * legacy view containers. Shows time range and optional description for each entry.
 *
 * @param epgData - Array of EPG entries to render.
 * @returns Concatenated HTML string (empty if input is null/empty).
 */
export function renderEpgHTML(epgData: EPGEntry[]): string {
    var html = "";
    if (!(epgData && epgData.length)) return html;
    epgData.forEach(function (entry: EPGEntry) {
        html +=
            '<div class="epg-entry"><span class="epg-time">' +
            formatEpgTime(entry.time) +
            '</span> <span class="epg-name">' +
            entry.name +
            "</span>";
        if (entry.descr)
            html += '<div class="epg-descr">' + entry.descr + "</div>";
        html += "</div>";
    });
    return html;
}

/**
 * Start a one-shot timer that will prompt the user to switch to a channel
 * when a future program begins.
 *
 * @param timer - Timer object with properties:
 *   `t` (start Unix seconds), `te` (end), `ci` (channel ID),
 *   `c` (category index), `i` (channel index), `n` (program name).
 *
 * Side effects: Calls `setTimeout`. When the timer fires, shows a confirm box
 * and on confirmation calls `window.closeList` and `window.playChannel`.
 * Stores the timeout ID on `timer.ti`.
 */
export function startEpgTimer(timer: any): void {
    var w = window as any;
    var delay = timer.t * 1000 - Date.now();
    if (delay < 0) delay = 0;

    timer.ti = setTimeout(function () {
        var msg =
            w._("Timer: switch to channel?") +
            "<br/><br/>" +
            (channels[timer.ci] ? channels[timer.ci].channel_name : "") +
            '<div style="color:' +
            (w.curColor || "#fff") +
            ';">' +
            timer.n +
            "</div>" +
            formatEpgTime(timer.t) +
            " - " +
            formatEpgTime(timer.te) +
            " (" +
            Math.round((timer.te - timer.t) / 60) +
            " " +
            w._("min") +
            ")";

        if (typeof w.confirmBox === "function") {
            w.confirmBox(msg, function () {
                if (typeof w.closeList === "function") w.closeList();
                if (typeof (w as any).playChannel === "function")
                    (w as any).playChannel(timer.c, timer.i);
            });
        }
    }, delay);
}

/**
 * Load previously-saved EPG timers from STB storage (key `epgTimers`),
 * filter out past timers, and restart each active timer via `startEpgTimer`.
 *
 * Side effects: Reads from STB storage; mutates `epgTimers` array;
 * calls `startEpgTimer` for each valid timer.
 */
export function loadEpgTimers(): void {
    var w = window as any;
    try {
        var data =
            typeof w.stbGetItem === "function"
                ? w.stbGetItem("epgTimers")
                : null;
        if (data) {
            epgTimers = JSON.parse(data);
            var now = Date.now() / 1000;
            epgTimers = epgTimers.filter(function (t) {
                return t.t > now;
            });
            epgTimers.forEach(startEpgTimer);
        }
    } catch (e) {
        console.error("loadEpgTimers error:", e);
    }
}

/**
 * Toggle an EPG timer for the currently-selected program.
 * If a timer already exists for this channel+program, remove it;
 * otherwise, create and start a new timer.
 *
 * @param channelId - Channel ID for the timer.
 * @param time      - Program start timestamp (used to identify the EPG entry).
 *
 * Side effects:
 * - Shows a confirm dialog (`window.confirmBox`).
 * - On confirmation, mutates `epgTimers` array.
 * - Persists updated timers to STB storage (`stbSetItem`).
 */
export function setEpgTimer(channelId: any, time: number): void {
    var w = window as any;
    var item = w.listArray[w.selIndex];
    if (!item || item.time < Date.now() / 1000) return;

    var idx = epgTimers.findIndex(function (t) {
        return t.ci == channelId && t.t == item.time;
    });
    var msg = idx === -1 ? "Set timer?" : "Remove timer?";

    if (typeof w.confirmBox === "function") {
        w.confirmBox(w._(msg), function () {
            if (idx === -1) {
                var timer = {
                    ci: channelId,
                    c: w.listCatIndex,
                    i: w.listChannel,
                    t: item.time,
                    te: item.time_to,
                    n: item.name,
                };
                startEpgTimer(timer);
                epgTimers.push(timer);
            } else {
                clearTimeout(epgTimers[idx].ti);
                epgTimers.splice(idx, 1);
            }
            if (typeof w.stbSetItem === "function") {
                var cleanTimers = epgTimers.map(function (t) {
                    return {
                        ci: t.ci,
                        c: t.c,
                        i: t.i,
                        t: t.t,
                        te: t.te,
                        n: t.n,
                    };
                });
                w.stbSetItem("epgTimers", JSON.stringify(cleanTimers));
            }
        });
    }
}

/**
 * Legacy alias for `epgList`. When the first argument is a number (key-code style
 * invocation), redirects to the real `epgList` function.
 *
 * @param epgData  - In legacy mode, this is actually a numeric category index.
 * @param _options - Unused (kept for signature compatibility).
 *
 * Side effects: Delegates to `epgList` when invoked in legacy mode.
 */
export function epgListAlpha(epgData: EPGEntry[], _options?: any): void {
    if (typeof (epgData as any) === "number") {
        epgList(epgData as any, arguments[1], arguments[2]);
    }
}

/**
 * Render an array of record items as a simple HTML list (each item shows name or title).
 *
 * @param records - Array of record objects, each expected to have `name` or `title`.
 * @returns Concatenated HTML string, or empty string if records is empty/null.
 */
export function recordsList(records: any[]): string {
    if (!(records && records.length)) return "";
    return records
        .map(
            (r: any) =>
                "<div>&nbsp;&nbsp;" + (r.name || r.title || "") + "</div>"
        )
        .join("");
}

/**
 * Handle selection of a record from the records list.
 * Closes the list and delegates to `window.playMedia`.
 *
 * @param index - Index into `window.listArray` for the selected record.
 *
 * Side effects: Calls `window.closeList` and `window.playMedia`.
 */
export function selectREC(index: number): void {
    var w = window as any;
    var item = w.listArray[index];
    if (!item) return;
    if (typeof w.closeList === "function") w.closeList();
    if (typeof (w as any).playMedia === "function") (w as any).playMedia(item);
}

/**
 * Render the detail panel for the currently selected record item.
 * Populates #listDetail with the media description.
 *
 * Side effects: Injects innerHTML into #listDetail.
 */
export function detailREC(): void {
    var w = window as any;
    var detailEl = document.getElementById("listDetail");
    if (detailEl) detailEl.innerHTML = getMediaDescr(w.listArray[w.selIndex]);
}

/**
 * Open the records (archive) list for a specific category/channel.
 * Fetches media array from the provider and renders it as a selectable list.
 *
 * @param catIdx - Index of the category (or channel) within `curList`.
 *
 * Side effects:
 * - Calls `window.getMediaArray` (provider API).
 * - Sets `window.listArray`, `window.getListItemFn`, etc.
 * - Shows/hides #listPopUp, updates #listCaption / #listPodval.
 * - Calls `window.showPage`.
 */
export function catRecordsList(catIdx: number): void {
    var w = window as any;
    if (typeof w.closeList === "function") w.closeList();

    if (typeof w.getMediaArray !== "function") {
        if (typeof w.infoBox === "function")
            w.infoBox(w._("Records not supported by provider"));
        return;
    }

    var chId = curList[catIdx];
    var ch = channels[chId] || ({} as Channel);
    var providerChId = ch.ch_id;

    w.getMediaArray(function (data: any[]) {
        if (!data || data.length === 0) {
            if (typeof w.infoBox === "function")
                w.infoBox(w._("Records library is empty"));
            return;
        }

        w.listArray = data;
        mediaRecords = data;
        w.getListItemFn = function (item: any, _idx: number) {
            return "&nbsp;&nbsp;" + (item.name || item.title || "");
        };
        w.detailListActionFn = detailREC;
        w.listKeyHandlerFn = mediaKeyHandler;

        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML =
                w._("Records for channel: ") + (ch.channel_name || "");

        var podvalEl = document.getElementById("listPodval");
        if (podvalEl) {
            podvalEl.innerHTML = w.btnDiv(w.keys.RETURN, w.strRETURN, "Close");
        }

        if (typeof w.showPage === "function") w.showPage();
    }, providerChId);
}

/**
 * Key handler for the media/VOD list view.
 * Keys: ENTER (play), RED/INFO (info), GREEN (toggle favorites),
 * YELLOW (TMDb search), RETURN (close).
 *
 * @param keyCode - The pressed key code.
 * @returns `true` if handled, `false` to bubble up.
 *
 * Side effects: Delegates to `selectMedia`, `infoProgramm`,
 * `addToMedFavorites`, `TMDb.search`, or `closeList`.
 */
export function mediaKeyHandler(keyCode: number): boolean {
    var w = window as any;
    var keys = w.keys;
    var item = w.listArray[w.selIndex];
    if (!item) return false;

    switch (keyCode) {
        case keys.ENTER:
            selectMedia(w.selIndex);
            return true;
        case keys.RED:
        case keys.INFO:
            if (typeof w.infoProgramm === "function")
                w.infoProgramm(getMediaDescr(item));
            return true;
        case keys.GREEN:
            addToMedFavorites(item);
            return true;
        case keys.YELLOW:
            if (w.TMDb && typeof w.TMDb.search === "function")
                w.TMDb.search(item.name || item.title);
            return true;
        case keys.RETURN:
            if (typeof w.closeList === "function") w.closeList();
            return true;
    }
    return false;
}

/**
 * Toggle a media/VOD item in or out of the media favorites list (`medFavorites`).
 * Uses `stream_url` as the unique identifier.
 *
 * @param item - Media item object (expected to have `stream_url`).
 *
 * Side effects:
 * - Mutates `medFavorites` array.
 * - Shows an on-screen notification via `window.showShift`.
 * - Persists the updated array via `stbSetItem`.
 */
export function addToMedFavorites(item: any): void {
    var w = window as any;
    var idx = medFavorites.findIndex(function (e: any) {
        return e.stream_url === item.stream_url;
    });
    if (idx === -1) {
        medFavorites.unshift(item);
        if (typeof w.showShift === "function")
            w.showShift(w._("Added to favorites"));
    } else {
        medFavorites.splice(idx, 1);
        if (typeof w.showShift === "function")
            w.showShift(w._("Removed from favorites"));
    }
    if (typeof w.stbSetItem === "function")
        w.stbSetItem("medFavorites", JSON.stringify(medFavorites));
}

/**
 * Handle selection of a media/VOD item from the list.
 * - If it has a `playlist_url`, loads the playlist via `getScriptDOM`.
 * - If it has a `stream_url`, closes the list and plays directly.
 *
 * @param index - Index into `window.listArray`.
 *
 * Side effects: May show #listPopUp spinner; calls `getScriptDOM`, `closeList`,
 * or `playMedia`.
 */
export function selectMedia(index: number): void {
    var w = window as any;
    var item = w.listArray[index];
    if (!item) return;

    if (item.playlist_url) {
        if (typeof w.getScriptDOM === "function") {
            $("#listPopUp")
                .html(
                    '<img src="' +
                        w.host +
                        "/stbPlayer/buffering.gif?" +
                        w.__av +
                        '" height="40">'
                )
                .show();
            w.getScriptDOM(item.playlist_url, function () {
                $("#listPopUp").hide();
            });
        }
    } else if (item.stream_url) {
        if (typeof w.closeList === "function") w.closeList();
        if (typeof (w as any).playMedia === "function")
            (w as any).playMedia(item);
    }
}

/**
 * Open the media library (VOD) list. Fetches media array from the provider
 * and renders it as a selectable list with favorites and TMDb support.
 *
 * Side effects:
 * - Calls `window.getMediaArray`.
 * - Sets up list renderers (`getListItemFn`, `detailListActionFn`, `listKeyHandlerFn`).
 * - Updates #listCaption / #listPodval DOM.
 * - Calls `window.showPage`.
 */
export function showMediaList(): void {
    var w = window as any;
    if (typeof w.closeList === "function") w.closeList();

    if (typeof w.getMediaArray !== "function") {
        if (typeof w.infoBox === "function")
            w.infoBox(w._("VOD not supported by provider"));
        return;
    }

    w.getMediaArray(function (data: any[]) {
        if (!data || data.length === 0) {
            if (typeof w.infoBox === "function")
                w.infoBox(w._("Media library is empty"));
            return;
        }

        w.listArray = data;
        mediaListArr = data;
        w.getListItemFn = function (item: any, _idx: number) {
            return "&nbsp;&nbsp;" + (item.name || item.title || "");
        };
        w.detailListActionFn = function () {
            var detailEl = document.getElementById("listDetail");
            if (detailEl)
                detailEl.innerHTML = getMediaDescr(w.listArray[w.selIndex]);
        };
        w.listKeyHandlerFn = mediaKeyHandler;

        var captionEl = document.getElementById("listCaption");
        if (captionEl) captionEl.innerHTML = w._("Media Library");

        var podvalEl = document.getElementById("listPodval");
        if (podvalEl) {
            podvalEl.innerHTML =
                w.btnDiv(w.keys.RETURN, w.strRETURN, "Close") +
                w.btnDiv(w.keys.GREEN, "", "Favorites") +
                w.btnDiv(w.keys.YELLOW, "", "TMDb");
        }

        if (typeof w.showPage === "function") w.showPage();
    });
}
/**
 * Extract a human-readable description from a media item.
 * Checks `description` first, then falls back to `descr`.
 *
 * @param item - Media item object.
 * @returns The description string, or empty string.
 */
export function getMediaDescr(item: any): string {
    return item?.description || item?.descr || "";
}

/**
 * Start archive playback at a given Unix timestamp.
 *
 * Mirrors the monolith's playArchive() in stbPlayer.js: updates OSD,
 * computes the current program (or a synthetic hour block when EPG is
 * missing), then either opens a fresh stbPlay() with the provider's
 * archive URL or seeks within the existing stream when the program
 * has not changed.
 *
 * @param e - Archive start time in seconds (Unix).
 * Side effects: Sets playTime, playType, forcePlay, fileArchive, archivePos;
 *               calls stbStop/stbPlay/stbSetPosTime via window globals.
 */
export function playArchive(e: number): void {
    var w = window as any;
    var t = curProg;
    if (typeof updateArchiveInfo === "function") updateArchiveInfo(e);
    if (w.sInfoRew && typeof w.showChanelInfo === "function")
        w.showChanelInfo(1);
    var r = curList[primaryIndex];
    var prog = epgArray[curProg] || {
        name: "",
        time: Math.floor(e / 3600) * 3600,
        time_to: (Math.floor(e / 3600) + 1) * 3600,
        descr: "",
    };
    playTime = 0;
    playType = Math.floor(e);
    forcePlay = true;
    (w as any).playType = playType;
    (w as any).playTime = playTime;
    (w as any).forcePlay = forcePlay;
    archivePos = e;
    var getUrl = w.getArchiveUrl;
    if (!fileArchive || t !== curProg) {
        if (w.sStopPlay && typeof w.stbStop === "function") w.stbStop();
        var url = getUrl(r, e, prog.time_to, prog);
        if (typeof w.stbPlay === "function")
            w.stbPlay(url, fileArchive ? e - prog.time : 0);
    } else if (typeof w.stbSetPosTime === "function") {
        w.stbSetPosTime(e - prog.time);
    }
}

/**
 * Update the archive playback info (current program index) based on
 * the current playback position. Called periodically during archive playback.
 *
 * @param position - Current playback position in seconds (Unix timestamp).
 *
 * Side effects:
 * - Updates `archivePos`, `curProg`, `_prog100`.
 * - Calls `window.updateChanelInfo` to refresh the OSD.
 */
export function updateArchiveInfo(position: number): void {
    if (playType <= 0) return;
    archivePos = position;

    var now = playType + playTime;
    var idx = epgArray.findIndex(function (e) {
        return e.time <= now && e.time_to > now;
    });
    if (idx !== -1) {
        curProg = idx;
        _prog100 = epgArray[idx];
        if (typeof (window as any).updateChanelInfo === "function") {
            (window as any).updateChanelInfo(listChannel);
        }
    }
}

/**
 * Stop archive playback and return to live TV for the current channel.
 * No-op if `playType <= 0` (already live).
 *
 * Side effects: Calls `window.playChannel` to restart live playback.
 */
export function liveStop(): void {
    if (playType <= 0) return;
    if (typeof (window as any).playChannel === "function") {
        (window as any).playChannel(catIndex, primaryIndex);
    }
}

/**
 * Apply a seek inside the current archive stream, clamped to [0, len-15].
 * No-op when the platform cannot set the playback position.
 * Handles live TV (playType === 0) as a clock-skip by calling timeShift.
 *
 * @param offset - Target offset in seconds from the start of the stream.
 */
function seekArchive(offset: number): void {
    var w = window as any;
    if (typeof w.stbSetPosTime !== "function" || !videoElement) return;
    // Guard for media sentinel (playType < 0) only — live (playType === 0) is allowed
    if (playType < 0 && playType !== -99999999999) return;
    if (playType === 0) {
        // Clock skip on live: offset is relative seconds from now
        var delta = offset;
        if (typeof (window as any).timeShift === "function")
            (window as any).timeShift(-delta);
        return;
    }
    var len: number =
        typeof (w.stbGetLen as any) === "function" ? w.stbGetLen() : 0;
    if (offset < 0) offset = 0;
    if (len && offset > len - 15) offset = len - 15;
    w.stbSetPosTime(offset);
}

/**
 * Shift the archive playback position by a delta (positive = forward, negative = backward).
 * Accumulates the delta and debounces the actual seek to ~500 ms, matching the
 * monolith's behaviour so a stream of key presses becomes one seek.
 *
 * @param e - Delta in seconds (negative = rewind, positive = forward, -6e6 = to beginning).
 * Side effects: Mutates `_shiftSec`, `archivePos`; shows a shift OSD; debounces
 *               a call to `_shiftArchive` via a setTimeout.
 */
export function shiftArchive(e: number): void {
    var w = window as any;
    if (e === -6e6) {
        _shiftSec = e;
        _shiftArchive();
        return;
    }
    _shiftSec += e;
    clearTimeout(_shiftTimer);
    if (w.sInfoRew && typeof w.showChanelInfo === "function")
        w.showChanelInfo(1);
    if (typeof w.showShift === "function") w.showShift(step2text(_shiftSec));
    _shiftTimer = setTimeout(_shiftArchive, 500);
}

/**
 * Apply the accumulated shift delta. Dispatches by current playType:
 *  - live (playType === 0): negative → timeShift(-delta), positive → restart live
 *  - media (playType < 0): relative stbSetPosTime, clamped
 *  - archive (playType > 0): shift playType by delta+playTime, re-playArchive
 *    if the result is still in the past, else drop to live.
 */
function _shiftArchive(): void {
    var w = window as any;
    var e = _shiftSec;
    _shiftSec = 0;
    clearTimeout(_shiftTimer);
    if (!e) return;
    if (!playType) {
        if (e < 0) {
            if (typeof w.timeShift === "function") w.timeShift(-e);
        } else {
            if (typeof w.showShift === "function")
                w.showShift((w._ && w._("Restart stream")) || "Restart stream");
            if (typeof w.playChannel === "function")
                w.playChannel(catIndex, primaryIndex);
        }
        return;
    }
    function announce(): void {
        if (e === -6e6) {
            if (typeof w.showShift === "function")
                w.showShift((w._ && w._("To begining")) || "To beginning");
        } else {
            if (typeof w.showShift === "function") w.showShift(step2text(e));
        }
    }
    if (playType < 0) {
        var newPos = Math.max(
            (typeof w.stbGetPosTime === "function" ? w.stbGetPosTime() : 0) + e,
            0
        );
        var len = typeof w.stbGetLen === "function" ? w.stbGetLen() : 0;
        if (len && newPos > len) return;
        if (typeof w.stbSetPosTime === "function") w.stbSetPosTime(newPos);
        announce();
        if (w.sInfoRew && typeof w.showChanelInfo === "function")
            w.showChanelInfo(1);
        return;
    }
    playType = playType + e + playTime;
    (w as any).playType = playType;
    if (playType < Date.now() / 1e3) {
        announce();
        playArchive(playType);
    } else {
        if (typeof w.showShift === "function")
            w.showShift((w._ && w._("Live")) || "Live");
        if (typeof w.playChannel === "function")
            w.playChannel(catIndex, primaryIndex);
    }
}

/**
 * Format a shift delta (seconds) as a localized ">> mm:ss / << mm:ss" string.
 *
 * @param e - Delta in seconds.
 * Side effects: Reads global window._ for localization.
 */
function step2text(e: number): string {
    if (!e) return "&nbsp;";
    var abs = Math.abs(e);
    var m = Math.floor(abs / 60);
    var s = abs % 60;
    var w = window as any;
    var _ =
        (w._ && w._.bind(w)) ||
        function (s: string) {
            return s;
        };
    var prefix = e > 0 ? ">> " : "<< ";
    return prefix + (m ? m + _(" m ") : "") + (s ? s + _(" s") : "");
}

/**
 * Interactive OSD for manual archive position selection.
 * Opens a dialog that accumulates a delta via number keys, then calls
 * shiftArchive(delta) after a 3-second idle timeout.
 *
 * @param initialDelta - Initial delta offset (seconds).
 * Side effects: Shows/hides a dialog box; calls shiftArchive().
 */
export function shiftArchiveSelect(initialDelta: number): void {
    var w = window as any;
    var chId = curList[primaryIndex];
    var ch = chanels[chId];
    if (!playType && !(ch && ch.rec)) return;
    var i = 0;
    var t: any = null;
    function r(delta: number): void {
        clearTimeout(t);
        i += delta;
        var stepEl = document.getElementById("step");
        if (stepEl) stepEl.innerHTML = step2text(i);
        t = setTimeout(function () {
            var dialogbox = document.getElementById("dialogbox");
            if (dialogbox) dialogbox.style.display = "none";
            shiftArchive(i);
        }, 3000);
    }
    // Guard: keep existing dialog if open
    var dialogbox = document.getElementById("dialogbox");
    if (dialogbox) {
        dialogbox.style.display = "";
    }
    r(initialDelta);
}

/**
 * Clock-skip / timeshift on live TV — jumps N seconds back into the stream.
 * Requires the current channel to have `rec` (catchup-days) set.
 * Fetches EPG, sets epgArray, then calls playArchive(now-n) for clock skip
 * without requiring an EPG entry, or playArchive(progStart) when n=0.
 *
 * @param n - Seconds to go back (positive), or 0 to jump to current program start.
 * Side effects: Sets epgArray, curProg; calls playArchive(); shows OSD.
 */
export function timeShift(n: number): void {
    var w = window as any;
    var chId = curList[primaryIndex];
    var ch = chanels[chId];
    if (!ch || !ch.rec) return;
    if (typeof w.getEPGchanelCached !== "function") return;
    w.getEPGchanelCached(chId, function (_t: any, epgData: EPGEntry[] | null) {
        var r: EPGEntry[] = [];
        if (
            epgData !== null &&
            epgData !== undefined &&
            (epgData as any).length
        ) {
            r = (epgData as EPGEntry[])
                .filter(function (e) {
                    return e.time > Date.now() / 1000 - ch!.rec! * 60 * 60;
                })
                .sort(function (a, b) {
                    return a.time - b.time;
                });
        }
        epgArray = r;
        (window as any).epgArray = r;
        setCurProg(chId, epgData, undefined);
        (window as any).curProg = curProg;
        setCurrent(catIndex, primaryIndex, true);
        if (n) {
            var delta = Math.round(Date.now() / 1000) - n;
            if (typeof w.showShift === "function") w.showShift(step2text(-n));
            playArchive(delta);
        } else {
            if (typeof w.showShift === "function")
                w.showShift(
                    (w._ && w._("Archive - begin")) || "Archive - begin"
                );
            var now = Date.now() / 1000;
            var s = r.findIndex(function (e) {
                return e.time_to >= now && e.time <= now;
            });
            if (s >= 0 && r[s]) playArchive(r[s].time);
        }
    });
}

/**
 * Show the channel list for a category and channel index.
 * Currently a stub that just refreshes the page display.
 *
 * @param catIdx     - Category index.
 * @param channelIdx - Channel index within the category.
 * Side effects: Calls `window.showPage`.
 */
export function channelsList(catIdx: number, channelIdx: number): void {
    if (typeof (window as any).showPage === "function")
        (window as any).showPage();
}
/**
 * Open the category list ("buckets" / bucket selection) view.
 * Supports category management (create, rename, copy, delete, move) via popup actions.
 *
 * @param catIdx      - Category index to pre-select (defaults to 0).
 * @param _channelIdx - Unused (kept for call-site compatibility).
 *
 * Side effects:
 * - Sets `window.listArray`, `window.listDataArray`, `window.getListItemFn`, etc.
 * - Updates #listCaption, #listPodval, #listPopUp DOM.
 * - Calls `window.showPage`.
 */
export function bucketsList(catIdx: number, _channelIdx?: number): void {
    var w = window as any;
    var catsList = catsArray || [];

    w.selIndex =
        typeof catIdx === "number" && catIdx >= 0 && catIdx < catsList.length
            ? catIdx
            : 0;
    w.listArray = catsList;
    w.listDataArray = catsList;
    w.getListItemFn = function (item: string, idx: number): string {
        return (
            "&nbsp;&nbsp;" +
            (settings.noNumbersKeys || idx > 8
                ? ""
                : '<div class="btn">' + (idx + 1) + "</div>&nbsp;") +
            (item || "")
        );
    };

    var detailEl = document.getElementById("listDetail");
    if (detailEl) detailEl.innerHTML = "";

    w.detailListActionFn = function () {};
    w.listKeyHandlerFn = bucketsKeyHandler;

    var captionEl = document.getElementById("listCaption");
    if (captionEl) captionEl.innerHTML = w._("Category selection");

    var podvalEl = document.getElementById("listPodval");
    if (podvalEl) {
        var html = w.btnDiv(
            w.keys.RED,
            "",
            w._(w.strPlayPause || strPlayPause),
            w.strPRECH
        );
        if (!sFavorites) {
            html += w.btnDiv(w.keys.YELLOW, "", w._(w.strTools), "0");
        }
        podvalEl.innerHTML = html;
    }

    if (!sFavorites) {
        var popupHtml =
            w.btnDiv(w.keys.N1, "1", w._("Move category up")) +
            "<br/>" +
            w.btnDiv(w.keys.N7, "7", w._("Move category down")) +
            "<br/>" +
            w.btnDiv(w.keys.N3, "3", w._("Create category")) +
            "<br/>" +
            w.btnDiv(w.keys.N6, "6", w._("Rename category")) +
            "<br/>" +
            w.btnDiv(w.keys.N9, "9", w._("Copy category")) +
            "<br/>" +
            w.btnDiv(w.keys.N8, "8", w._("Delete category"));
        $("#listPopUp").html(popupHtml);
    }
    $("#listPopUp").hide();

    if (typeof w.showPage === "function") w.showPage();
}

/**
 * Key handler for the category list (buckets) view.
 * Supports:
 * - Number keys 1-9 for direct category jump.
 * - LEFT/RW/PREV → popup list or close.
 * - RIGHT/ENTER → open channels list for selected category.
 * - FF/NEXT → next category.
 * - RED/PLAY/PAUSE/PRECH → records list for category.
 * - RETURN → close.
 * - With popup visible: N1/N7 (move), N3 (create), N6 (rename), N9 (copy), N8 (delete).
 *
 * @param keyCode - The pressed key code.
 * @returns `true` if handled, `false` to bubble up.
 *
 * Side effects: Delegates to moveChannel, saveChannelsCats, showPage, etc.
 */
export function bucketsKeyHandler(keyCode: number): boolean {
    var w = window as any;
    var keys = w.keys;
    if (!keys) return false;

    // Popup actions for category management
    if ($("#listPopUp").is(":visible")) {
        switch (keyCode) {
            case keys.N1:
                moveChannel(-1);
                return true;
            case keys.N7:
                moveChannel(1);
                return true;
            case keys.N3: {
                var name = prompt(w._("Enter category name"));
                if (name && name.trim()) {
                    name = name.trim();
                    catsArray.push(name);
                    cats[name] = [];
                    saveChannelsCats();
                    w.listArray = catsArray;
                    w.listDataArray = catsArray;
                    w.selIndex = catsArray.length - 1;
                    if (typeof w.showPage === "function") w.showPage();
                }
                return true;
            }
            case keys.N6: {
                var oldName = catsArray[w.selIndex];
                if (!oldName) return true;
                var newName = prompt(w._("Enter new category name"), oldName);
                if (newName && newName.trim() && newName.trim() !== oldName) {
                    newName = newName.trim();
                    cats[newName] = cats[oldName];
                    delete cats[oldName];
                    catsArray[w.selIndex] = newName;
                    if (w.catIndex === oldName) w.catIndex = newName;
                    saveChannelsCats();
                    w.listArray = catsArray;
                    w.listDataArray = catsArray;
                    if (typeof w.showPage === "function") w.showPage();
                }
                return true;
            }
            case keys.N9: {
                var srcName = catsArray[w.selIndex];
                if (!srcName) return true;
                var copyName = prompt(
                    w._("Enter new category name"),
                    srcName + " (copy)"
                );
                if (copyName && copyName.trim()) {
                    copyName = copyName.trim();
                    catsArray.push(copyName);
                    cats[copyName] = (cats[srcName] || []).slice();
                    saveChannelsCats();
                    w.listArray = catsArray;
                    w.listDataArray = catsArray;
                    w.selIndex = catsArray.length - 1;
                    if (typeof w.showPage === "function") w.showPage();
                }
                return true;
            }
            case keys.N8: {
                if (catsArray.length <= 1) {
                    if (typeof w.showShift === "function")
                        w.showShift(w._("Cannot delete the last category"));
                    return true;
                }
                var delName = catsArray[w.selIndex];
                if (
                    delName &&
                    confirm(w._("Delete category") + ' "' + delName + '"?')
                ) {
                    delete cats[delName];
                    catsArray.splice(w.selIndex, 1);
                    if (w.selIndex >= catsArray.length)
                        w.selIndex = catsArray.length - 1;
                    saveChannelsCats();
                    w.listArray = catsArray;
                    w.listDataArray = catsArray;
                    if (typeof w.showPage === "function") w.showPage();
                }
                return true;
            }
        }
        return true;
    }

    switch (keyCode) {
        case keys.N0:
        case keys.YELLOW:
        case keys.TOOLS:
            $("#listPopUp").toggle();
            return true;

        case keys.N1:
        case keys.N2:
        case keys.N3:
        case keys.N4:
        case keys.N5:
        case keys.N6:
        case keys.N7:
        case keys.N8:
        case keys.N9: {
            var idx = keyCode - keys.N1;
            if (
                idx >= 0 &&
                idx < catsArray.length &&
                typeof w.channelsList === "function"
            ) {
                w.channelsList(idx, 0);
            }
            return true;
        }

        case keys.LEFT:
        case keys.RW:
        case keys.PREV:
            if (typeof w.popupList === "function") {
                w.popupList();
            } else if (typeof w.closeList === "function") {
                w.closeList();
            }
            return true;

        case keys.RIGHT:
        case keys.ENTER:
            if (typeof w.channelsList === "function") {
                w.channelsList(w.selIndex, 0);
            }
            return true;

        case keys.FF:
        case keys.NEXT: {
            var nextCat =
                w.selIndex < catsArray.length - 1 ? w.selIndex + 1 : 0;
            if (typeof w.channelsList === "function") {
                w.channelsList(nextCat, 0);
            }
            return true;
        }

        case keys.RED:
        case keys.PLAY:
        case keys.PAUSE:
        case keys.PRECH:
            if (typeof w.catRecordsList === "function") {
                w.catRecordsList(w.selIndex);
            }
            return true;

        case keys.RETURN:
            if (typeof w.closeList === "function") w.closeList();
            return true;

        default:
            return false;
    }
}
/**
 * Open the channel search prompt, then re-render the current category
 * filtered by the entered query.
 *
 * Ported from stbPlayer.js searchChannel(). Hides the Actions popup, opens
 * the inline editor with caption "String for search" seeded from
 * stbGetItem("chSearch") (empty default), and on submit persists the new
 * query, filters the current category by channel_name, installs a fresh
 * listKeyHandler for the search view, updates listCaption/listPodval and
 * re-renders via showPage().
 *
 * Side effects:
 *  - Writes "chSearch" to stb storage on submit.
 *  - Mutates global listArray, listKeyHandler, listCaption, listPodval.
 *  - Hides #listPopUp.
 *
 * The installed listKeyHandler mirrors the original: YELLOW/TOOLS/N0
 * retrigger this function; ENTER plays the selected channel via
 * playChannel; GREEN/PLAY/PAUSE/N3 calls addChannel2bucket; RETURN/RW/PREV
 * (and LEFT when sArrowFun===2) returns to the unfiltered channelsList
 * preserving the prior position (listChannel).
 */
export function searchChannel(): void {
    var w = window as any;
    $("#listPopUp").hide();
    var editCaption = w._("String for search");
    var saved =
        typeof w.stbGetItem === "function"
            ? w.stbGetItem("chSearch") || ""
            : "";
    var editvar = saved;
    var setEdit = function (): void {
        // Read window.editvar and #editvar input (user may have typed in the HTML input)
        var inputEl = document.getElementById("editvar");
        var inputVal = (inputEl && (inputEl as HTMLInputElement).value) || "";
        var submitted = (window as any).editvar || "";
        if (!inputVal && !submitted) return;
        saved = inputVal || submitted;
        (window as any).editvar = saved;
        if (typeof w.stbSetItem === "function") w.stbSetItem("chSearch", saved);
        setTimeout(function () {
            if (w.listCatIndex === undefined) return;
            var q = saved.toLowerCase();
            var catList = cats[catsArray[w.listCatIndex]] || [];
            w.listArray = catList.filter(function (id: number): boolean {
                var ch = chanels[id];
                return !!(
                    ch &&
                    ch.channel_name &&
                    ch.channel_name.toLowerCase().indexOf(q) !== -1
                );
            });
            w.listDataArray = w.listArray;
            w.selIndex = 0;
            w.listKeyHandler = function (e: number): boolean {
                function play(): void {
                    var idx = (cats[catsArray[w.listCatIndex]] || []).indexOf(
                        w.listArray[w.selIndex]
                    );
                    if (sPreview == 2) {
                        if (
                            w.previewChan &&
                            w.previewChan.ch_id == w.listArray[w.selIndex]
                        ) {
                            setCurrent(w.listCatIndex, idx);
                        } else {
                            if (typeof w.previewChId === "function")
                                w.previewChId(w.listArray[w.selIndex]);
                            return;
                        }
                    }
                    w.previewChan = null;
                    if (typeof w.closeList === "function") w.closeList();
                    if (
                        (w.catIndex == w.listCatIndex &&
                            w.primaryIndex == idx &&
                            !w.playType) ||
                        sPreview == 1
                    ) {
                        setCurrent(w.listCatIndex, idx);
                        var t = (w.curList || [])[w.primaryIndex];
                        if (typeof w.updateChanelInfo === "function")
                            w.updateChanelInfo(t);
                        if (
                            w.sInfoSwitch &&
                            typeof w.showChanelInfo === "function"
                        )
                            w.showChanelInfo(1);
                        w.playType = 0;
                        return;
                    }
                    setTimeout(function () {
                        if (typeof w.playChannel === "function")
                            w.playChannel(w.listCatIndex, idx);
                    }, 10);
                }
                var r: any;
                switch (e) {
                    case w.keys.EXIT:
                        if (typeof w.closeList === "function") w.closeList();
                        return true;
                    case w.keys.LEFT:
                        if (w.sArrowFun != 2) return false;
                    // fall through
                    case w.keys.RETURN:
                        if (typeof w.channelsList === "function")
                            w.channelsList(w.listCatIndex, w.listChannel);
                        return true;
                    case w.keys.RIGHT:
                        if (w.sArrowFun != 2) return false;
                        return true;
                    case w.keys.N2:
                    case w.keys.INFO:
                        r = chanels[w.listArray[w.selIndex]];
                        if (
                            r !== undefined &&
                            typeof w.infoProgramm === "function"
                        )
                            w.infoProgramm(r.name);
                        return true;
                    case w.keys.RW:
                        if (w.sRewFun != 1) return false;
                        if (typeof w.channelsList === "function")
                            w.channelsList(w.listCatIndex, w.listChannel);
                        return true;
                    case w.keys.PREV:
                        if (w.sPNFun != 1) return false;
                        if (typeof w.channelsList === "function")
                            w.channelsList(w.listCatIndex, w.listChannel);
                        return true;
                    case w.keys.FF:
                        if (w.sRewFun != 1) return false;
                        r = chanels[w.listArray[w.selIndex]];
                        if (
                            r !== undefined &&
                            typeof w.infoProgramm === "function"
                        )
                            w.infoProgramm(r.name);
                        return true;
                    case w.keys.NEXT:
                        if (w.sPNFun != 1) return false;
                        r = chanels[w.listArray[w.selIndex]];
                        if (
                            r !== undefined &&
                            typeof w.infoProgramm === "function"
                        )
                            w.infoProgramm(r.name);
                        return true;
                    case w.keys.N0:
                    case w.keys.YELLOW:
                    case w.keys.TOOLS:
                        searchChannel();
                        return true;
                    case w.keys.ENTER:
                        play();
                        return true;
                    case w.keys.GREEN:
                    case w.keys.PLAY:
                    case w.keys.PAUSE:
                    case w.keys.N3:
                        if (typeof w.addChannel2bucket === "function")
                            w.addChannel2bucket();
                        return true;
                }
                return false;
            };
            (function () {
                var captionEl = document.getElementById("listCaption");
                if (captionEl) {
                    captionEl.textContent =
                        w._("Search") +
                        ':"' +
                        saved +
                        '" (' +
                        w.listArray.length +
                        ")";
                }
            })();
            var podvalEl = document.getElementById("listPodval");
            if (podvalEl) {
                podvalEl.innerHTML =
                    (typeof w.btnDiv === "function"
                        ? w.btnDiv(
                              w.keys.RETURN,
                              w.strRETURN,
                              "Close",
                              w.sArrowFun == 2
                                  ? w.strLEFT
                                  : w.sRewFun == 1
                                    ? w.strRW
                                    : w.sPNFun == 1
                                      ? w.strPREV
                                      : ""
                          )
                        : "") +
                    (typeof w.btnDiv === "function"
                        ? w.btnDiv(
                              w.keys.N2,
                              w.strInfo,
                              "Description",
                              "2",
                              w.sArrowFun == 2
                                  ? w.strRIGHT
                                  : w.sRewFun == 1
                                    ? w.strFF
                                    : w.sPNFun == 1
                                      ? w.strNEXT
                                      : ""
                          )
                        : "") +
                    (typeof w.btnDiv === "function"
                        ? w.btnDiv(w.keys.YELLOW, "", "Search", w.strTools, "0")
                        : "") +
                    (typeof w.btnDiv === "function"
                        ? w.btnDiv(
                              w.keys.GREEN,
                              "",
                              "Add channel to " +
                                  (sFavorites ? "favorites" : "category"),
                              w.strPlayPause,
                              "3"
                          )
                        : "");
            }
            $("#listPopUp").hide();
            $("#listEdit").hide();
            if (typeof w.showPage === "function") w.showPage();
        });
    };
    w.editCaption = editCaption;
    w.editvar = editvar;
    w.setEdit = setEdit;
    if (typeof w.showEditKey === "function") w.showEditKey();
}

/**
 * Show the on-screen Actions dialog used when sNoNumbersKeys is set.
 *
 * Ported from the inline `function a()` inside the original
 * channelsKeyHandler: a 3×3 table of arrow-key action buttons (UP=move
 * channel up, DOWN=move channel down, LEFT=delete-or-sort,
 * RIGHT=parental-or-empty, ENTER=add-to-bucket) plus a YELLOW/TOOLS
 * "Search" button. Each arrow ENTER also routes through the same
 * dialogBoxKeyHandler installed for the duration of the dialog, so PC
 * users without a number pad can reach Move/Delete/Sort/Add/Parental
 * without needing N0/N3/N6/N7/N8/N9 — the same actions the popup N-keys
 * trigger.
 *
 * Side effects: writes innerHTML to #dialogbox, shows it, installs
 * window.dialogBoxKeyHandler, hides it on RETURN.
 */
export function showActionsDialog(): void {
    var w = window as any;
    var t =
        !w.sFavorites && w.w.w.listCatIndex
            ? true
            : !!(w.sFavorites && !w.w.w.listCatIndex);
    var e = '<td align="center" valign="top" width="30%">';
    var dialog = document.getElementById("dialogbox");
    if (!dialog) return;
    dialog.innerHTML =
        '<table style="font-size:inherit" width="100%">' +
        "<tr><td></td>" +
        e +
        (typeof w.btnDiv === "function"
            ? w.btnDiv(w.keys.UP, w.strUP, t ? "<br>Up<br>" : "<br><br>")
            : "") +
        "</td><td></td></tr>" +
        "<tr>" +
        e +
        (typeof w.btnDiv === "function"
            ? w.btnDiv(
                  w.keys.LEFT,
                  w.strLEFT,
                  t
                      ? "<br>Delete"
                      : "<br>" +
                            w._("Sort channels") +
                            ":<br>" +
                            w._(w.sSortAbc ? '"As Is"' : "By alphabet")
              )
            : "") +
        "</td>" +
        e +
        (typeof w.btnDiv === "function"
            ? w.btnDiv(
                  w.keys.ENTER,
                  w.strENTER,
                  !w.sFavorites || w.w.w.listCatIndex
                      ? "<br>Add<br>to " +
                            (w.sFavorites ? "favorites" : "category")
                      : "<br><br>"
              )
            : "") +
        "</td>" +
        e +
        (typeof w.btnDiv === "function"
            ? w.btnDiv(
                  w.keys.RIGHT,
                  w.strRIGHT,
                  w.sPSchannels && w.parentPIN != "*"
                      ? "<br>Parental<br>Control"
                      : "<br>"
              )
            : "") +
        "</td></tr>" +
        "<tr><td></td>" +
        e +
        (typeof w.btnDiv === "function"
            ? w.btnDiv(w.keys.DOWN, w.strDOWN, t ? "<br>Down<br>" : "<br><br>")
            : "") +
        "</td><td></td></tr>" +
        "</table>" +
        (typeof w.btnDiv === "function"
            ? w.btnDiv(w.keys.RETURN, w.strRETURN, "Close")
            : "") +
        (typeof w.btnDiv === "function"
            ? w.btnDiv(w.keys.YELLOW, "", "Search", w.strTools)
            : "");
    $(dialog!).show();
    w.dialogBoxKeyHandler = function (ev: number): boolean {
        switch (ev) {
            case w.keys.ENTER:
                $(dialog!).hide();
                if (typeof w.addChannel2bucket === "function")
                    w.addChannel2bucket();
                return true;
            case w.keys.UP:
                if (typeof w.moveChannel === "function") w.moveChannel(-1);
                return true;
            case w.keys.DOWN:
                if (typeof w.moveChannel === "function") w.moveChannel(1);
                return true;
            case w.keys.LEFT:
                if (t) {
                    if (typeof w.deleteChannel === "function")
                        w.deleteChannel();
                } else {
                    $(dialog!).hide();
                    if (typeof w.sortChannelsAction === "function")
                        w.sortChannelsAction();
                }
                return true;
            case w.keys.RIGHT:
                if (
                    w.sPSchannels &&
                    w.parentPIN != "*" &&
                    typeof w.parentChannel === "function"
                ) {
                    w.parentChannel();
                }
                return true;
            case w.keys.RETURN:
                $(dialog!).hide();
                return true;
            case w.keys.YELLOW:
            case w.keys.TOOLS:
                $(dialog!).hide();
                w.w.w.listChannel = w.w.w.selIndex;
                searchChannel();
                return true;
        }
        return false;
    };
}

/**
 * Set the media search query string.
 * @param query - The search text to filter media items by.
 * Side effects: Sets `searchText`.
 */
export function searchMedia(query: string): void {
    searchText = query;
}

/**
 * Set the records search query string.
 * @param query - The search text to filter records by.
 * Side effects: Sets `searchText`.
 */
export function searchRec(query: string): void {
    searchText = query;
}

/**
 * Set the history search query string.
 * @param query - The search text to filter history entries by.
 * Side effects: Sets `historySearchText`.
 */
export function searchHistoryChannel(query: string): void {
    historySearchText = query;
}

/**
 * Returns history entries that match `historySearchText` (case‑insensitive).
 * If the filter is empty, returns a copy of `medHistory`.
 */
export function getFilteredHistory(): MediaHistoryEntry[] {
    if (!historySearchText) return medHistory.slice();
    const lower = historySearchText.toLowerCase();
    return medHistory.filter(
        (entry) =>
            (entry.name?.toLowerCase().includes(lower) ?? false) ||
            (entry.title?.toLowerCase().includes(lower) ?? false)
    );
}

/**
 * Returns channel IDs that match `searchText` (case‑insensitive) within the current category.
 * If the filter is empty, returns a copy of `curList`.
 */
export function getFilteredChannelList(): number[] {
    if (!searchText) return curList.slice();
    const lower = searchText.toLowerCase();
    return curList.filter((chId) => {
        const ch = chanels[chId];
        return (
            (ch?.channel_name?.toLowerCase().includes(lower) ?? false) ||
            (ch?.name?.toLowerCase().includes(lower) ?? false)
        );
    });
}

/**
 * Set the channel sort mode.
 * @param mode - 0 = default (no sort), 1 = alphabetical (A-Z).
 * Side effects: Sets `sSortAbc`.
 */
export function sortChannels(mode: number): void {
    sSortAbc = mode;
}

/* ---------------------------------------------------------------------------
 * Channel-array helpers (aAspects, aAudios, aSubs, aZooms per-channel storage)
 * --------------------------------------------------------------------------- */

/**
 * Resolve the current channel ID (as a string key) for per-channel array lookups.
 * Special case: when playType is -1e11 (media mode) and the array is for aspects or zooms,
 * returns the fixed key "-1media".
 *
 * @param arrayName - The name of the array being accessed (used for media-mode logic).
 * @returns String key for the current channel, or null if unavailable.
 */
function _ch_id(arrayName: string): string | null {
    if (playType === -1e11)
        return arrayName === "aAspects" || arrayName === "aZooms"
            ? "-1media"
            : null;
    return String(curList[primaryIndex]);
}

/**
 * Get a saved per-channel value from a named global array (e.g. `aAspects`, `aAudios`).
 *
 * @param arrayName - The name of the global array variable (e.g. `"aAspects"`).
 * @returns The stored numeric value, or 0 if not found / invalid.
 */
export function getCHarr(arrayName: string): number {
    if (typeof arrayName !== "string") return 0;
    var chId = _ch_id(arrayName);
    if (chId == null) return 0;
    var arr = (window as any)[arrayName];
    if (arr && typeof arr[chId] !== "undefined") return arr[chId];
    return 0;
}

/**
 * Look up the current channel's saved value in a named array and pass it
 * to the callback. For `aAspects` and `aZooms`, defaults to 0 if missing.
 *
 * @param arrayName - Name of the global array (e.g. `"aAspects"`).
 * @param callback  - Receives the numeric value found (or default).
 *
 * Side effects: None (the callback may have side effects).
 */
export function execCHarr(
    arrayName: string,
    callback: (val: number) => void
): void {
    if (typeof arrayName !== "string" || typeof callback !== "function") return;
    var chId = _ch_id(arrayName);
    if (chId == null) return;
    var arr = (window as any)[arrayName];
    var val =
        typeof arr !== "undefined" && arr !== null ? arr[chId] : undefined;
    if (typeof val === "undefined") {
        if (arrayName === "aAspects" || arrayName === "aZooms") val = 0;
        else return;
    }
    try {
        callback(val);
    } catch (e) {
        console.error(e);
    }
}

/**
 * Save a per-channel value into a named global array and persist to provider storage.
 * If value is `undefined` or `null`, removes the entry.
 * Persists asynchronously via `providerSetItem` after a `setTimeout(0)`.
 *
 * @param arrayName - Name of the global array (e.g. `"aAspects"`).
 * @param val       - The value to store, or null/undefined to delete.
 *
 * Side effects: Writes to provider storage; mutates the global array object.
 */
export function saveCHarr(
    arrayName: string,
    val: number | undefined | null
): void {
    if (typeof arrayName !== "string") return;
    var obj = (window as any)[arrayName];
    if (typeof obj !== "object" || obj === null) {
        obj = {};
        (window as any)[arrayName] = obj;
    }
    var chId = _ch_id(arrayName);
    if (chId == null) return;
    if (val === undefined || val === null) {
        if (typeof obj[chId] === "undefined") return;
        delete obj[chId];
    } else {
        if (val === obj[chId]) return;
        obj[chId] = val;
    }
    setTimeout(function () {
        providerSetItem(arrayName, JSON.stringify(obj));
    });
}

/* ---------------------------------------------------------------------------
 * Channel list key handler
 * --------------------------------------------------------------------------- */

/**
 * Key handler for the channel list view.
 * Supports: RETURN (close), ENTER (select + play), STOP/PIP (PiP),
 * RED/EPG (EPG), BLUE/PLAY/PAUSE (categories), YELLOW/TOOLS (popup),
 * INFO (program info), RW/PREV (prev category), FF/NEXT (next category),
 * and popup keys (move, delete, add, parental, sort, search).
 *
 * @param keyCode - The pressed key code.
 * @returns `true` if handled, `false` to bubble up.
 *
 * Side effects: Delegates to playChannel, stbPlayPip, epgList, bucketsList,
 * showActionsDialog, infoProgramm, moveChannel, deleteChannel, etc.
 */
export function channelsKeyHandler(keyCode: number): boolean {
    var keys = (window as any).keys;
    if (!keys) return false;

    switch (keyCode) {
        case keys.RETURN:
            if (typeof (window as any).closeList === "function")
                (window as any).closeList();
            return true;

        case keys.ENTER: {
            if (typeof (window as any).closeList === "function") {
                (window as any).closeList();
            }
            var selChId = (window as any).listArray
                ? (window as any).listArray[(window as any).selIndex]
                : undefined;
            var curChId = (window as any).curList
                ? (window as any).curList[(window as any).primaryIndex]
                : undefined;
            if (selChId) {
                if (selChId !== curChId) {
                    if (typeof (window as any).playChannel === "function") {
                        (window as any).playChannel(
                            (window as any).listCatIndex,
                            (window as any).selIndex
                        );
                    }
                } else if (!(window as any).playType) {
                    // Same channel in live mode — show info bar (matches old stbPlayer behavior)
                    if (typeof (window as any).setCurrent === "function") {
                        (window as any).setCurrent(
                            (window as any).listCatIndex,
                            (window as any).selIndex
                        );
                    }
                    var chId = (window as any).curList
                        ? (window as any).curList[(window as any).primaryIndex]
                        : undefined;
                    if (
                        typeof (window as any).updateChanelInfo === "function"
                    ) {
                        (window as any).updateChanelInfo(chId);
                    }
                    if (
                        typeof (window as any).showChanelInfo === "function" &&
                        (window as any).sInfoSwitch
                    ) {
                        (window as any).showChanelInfo(
                            (window as any).settings.infoTimeout
                        );
                    }
                    (window as any).playType = 0;
                }
            }
            return true;
        }

        case keys.STOP:
        case keys.PIP:
            if (typeof (window as any).stbPlayPip === "function") {
                var chId = (window as any).listArray[(window as any).selIndex];
                if (chId) (window as any).pipIndex = (window as any).selIndex;
                if (typeof (window as any).getChannelUrl === "function") {
                    (window as any).stbPlayPip(
                        (window as any).getChannelUrl(chId)
                    );
                }
            }
            return true;

        case keys.RED:
        case (window as any).keys ? (window as any).keys.EPG : undefined:
            if (typeof (window as any).epgList === "function") {
                (window as any).epgList(
                    (window as any).listCatIndex,
                    (window as any).selIndex,
                    true
                );
            }
            return true;

        case keys.BLUE:
        case keys.PLAY:
        case keys.PAUSE:
            if (typeof (window as any).bucketsList === "function") {
                (window as any).bucketsList((window as any).listCatIndex);
            }
            return true;

        case keys.N0:
        case keys.YELLOW:
        case keys.TOOLS:
            if ((window as any).sNoNumbersKeys) {
                showActionsDialog();
            } else {
                $("#listPopUp").toggle();
            }
            return true;

        case keys.N2:
        case keys.INFO: {
            var ch = (window as any).chanels[
                (window as any).listArray[(window as any).selIndex]
            ];
            if (
                ch &&
                typeof ch.name !== "undefined" &&
                typeof (window as any).infoProgramm === "function"
            ) {
                (window as any).infoProgramm(ch.name);
            }
            return true;
        }

        case keys.RW:
        case keys.PREV: {
            var rwFn =
                keyCode === keys.RW
                    ? (window as any).sRewFun
                    : (window as any).sPNFun;
            if (
                rwFn === 1 &&
                typeof (window as any).bucketsList === "function"
            ) {
                (window as any).bucketsList((window as any).listCatIndex);
                return true;
            }
            if (rwFn === 2) {
                var newCat =
                    (window as any).listCatIndex > 0
                        ? (window as any).listCatIndex - 1
                        : ((window as any).catsArray || []).length - 1;
                if (typeof (window as any).channelsList === "function") {
                    (window as any).channelsList(
                        newCat,
                        (window as any).catIndex !== newCat
                            ? 0
                            : (window as any).primaryIndex
                    );
                }
                return true;
            }
            return false;
        }

        case keys.FF:
        case keys.NEXT: {
            var ffFn =
                keyCode === keys.FF
                    ? (window as any).sRewFun
                    : (window as any).sPNFun;
            if (ffFn === 1 && typeof (window as any).epgList === "function") {
                (window as any).epgList(
                    (window as any).listCatIndex,
                    (window as any).selIndex,
                    true
                );
                return true;
            }
            if (ffFn === 2) {
                var newCat2 =
                    (window as any).listCatIndex <
                    ((window as any).catsArray || []).length - 1
                        ? (window as any).listCatIndex + 1
                        : 0;
                if (typeof (window as any).channelsList === "function") {
                    (window as any).channelsList(
                        newCat2,
                        (window as any).catIndex !== newCat2
                            ? 0
                            : (window as any).primaryIndex
                    );
                }
                return true;
            }
            return false;
        }
    }

    // Popup key handling
    if ($("#listPopUp").is(":visible")) {
        switch (keyCode) {
            case keys.N1:
                moveChannel(-1);
                return true;
            case keys.N7:
                moveChannel(1);
                return true;
            case keys.N8:
                deleteChannel();
                return true;
            case keys.N3:
                if (typeof (window as any).addChannel2bucket === "function") {
                    (window as any).addChannel2bucket();
                }
                return true;
            case keys.N4:
                if (typeof (window as any).parentChannel === "function") {
                    (window as any).parentChannel();
                }
                return true;
            case keys.N9: {
                var newSort = (window as any).sSortAbc == 1 ? 0 : 1;
                (window as any).sSortAbc = newSort;
                if (typeof (window as any).providerSetItem === "function") {
                    (window as any).providerSetItem("sSortAbc", newSort);
                }
                if (typeof (window as any).sortChannels === "function") {
                    (window as any).sortChannels(newSort);
                }
                if (typeof (window as any).showPage === "function")
                    (window as any).showPage();
                return true;
            }
            case keys.N6:
                (window as any).listChannel = (window as any).selIndex;
                searchChannel();
                return true;
        }
    }

    return false;
}

/**
 * Move the currently selected channel up or down in the list by the given delta.
 * Handles wraparound: if moving past the top, the item goes to the bottom (and vice versa).
 *
 * @param delta - +1 (move down / later position), -1 (move up / earlier position).
 *
 * Side effects:
 * - Mutates `window.listArray` in-place.
 * - Calls `window.showPage`, `window.changeSelect`, `window.saveChannelsCats`.
 */
function moveChannel(delta: number): void {
    var listArray = (window as any).listArray;
    var selIndex = (window as any).selIndex;
    if (!listArray || selIndex === undefined) return;

    if (selIndex + delta < 0) {
        listArray.push(listArray[selIndex]);
        listArray.shift();
    } else if (selIndex + delta > listArray.length - 1) {
        listArray.unshift(listArray[selIndex]);
        listArray.pop();
    } else {
        var tmp = listArray[selIndex];
        listArray[selIndex] = listArray[selIndex + delta];
        listArray[selIndex + delta] = tmp;
    }
    if (typeof (window as any).showPage === "function")
        (window as any).showPage();
    if (typeof (window as any).changeSelect === "function")
        (window as any).changeSelect(delta);
    if (typeof (window as any).saveChannelsCats === "function")
        (window as any).saveChannelsCats();
}

/**
 * Delete the currently selected channel from the list.
 *
 * Side effects:
 * - Mutates `window.listArray` via `splice`.
 * - Calls `window.changeSelect(-1)` if the deleted item was last.
 * - Calls `window.showPage` and `window.saveChannelsCats`.
 */
function deleteChannel(): void {
    var listArray = (window as any).listArray;
    var selIndex = (window as any).selIndex;
    if (!listArray || selIndex === undefined) return;
    listArray.splice(selIndex, 1);
    if (
        selIndex === listArray.length &&
        typeof (window as any).changeSelect === "function"
    ) {
        (window as any).changeSelect(-1);
    }
    if (typeof (window as any).showPage === "function")
        (window as any).showPage();
    if (typeof (window as any).saveChannelsCats === "function")
        (window as any).saveChannelsCats();
}

/* ---------------------------------------------------------------------------
 * Parental control — PIN code entry
 * --------------------------------------------------------------------------- */

/**
 * Show an on-screen PIN-pad dialog with digit buttons 0-9.
 * Supports navigation via arrow keys, digit entry via number keys,
 * ENTER to select the highlighted digit, RETURN to cancel.
 *
 * @param promptText - The message displayed above the PIN pad.
 * @param callback   - Called with the entered 4-digit PIN string,
 *                     or empty string if cancelled.
 *
 * Side effects:
 * - Creates/replaces content of #dialogbox.
 * - Registers `window.dialogBoxKeyHandler` for the duration of the dialog.
 * - Highlights digit buttons via DOM style mutations.
 */
export function _enterPinCode(
    promptText: string,
    callback: (pin: string) => void
): void {
    var pin = "";
    var html = "";
    var curIdx = 0;

    function highlight(idx: number): void {
        var k = document.getElementById("k" + curIdx);
        if (k) {
            k.style.backgroundColor = "";
            k.style.color = "";
        }
        curIdx = idx;
        if (curIdx < 0) curIdx = 9;
        else if (curIdx > 9) curIdx = 0;
        var next = document.getElementById("k" + curIdx);
        if (next) {
            next.style.backgroundColor = (window as any).curColorB || "#668";
            next.style.color = (window as any).curColor || "gold";
        }
    }

    /* build digit buttons: 1 2 3 4 5 6 7 8 9 0 */
    for (var i = 0; i < 10; i++) {
        var digit = i < 9 ? i + 1 : 0;
        html +=
            '<div id="k' +
            digit +
            '" style="display:inline-block;padding:6px;">' +
            '<div class="btn" onclick="_doKey && _doKey(window.keys.N' +
            digit +
            ');">' +
            digit +
            "</div></div>";
    }

    if (!$("#dialogbox").length) return;
    $("#dialogbox")
        .html(
            promptText +
                '<br/><br/><span id="pin" style="font-size: 200%;">&nbsp;</span><br><br>' +
                html
        )
        .show();
    highlight(1);

    (window as any).dialogBoxKeyHandler = function (e: number): void {
        switch (e) {
            case (window as any).keys.N0:
            case (window as any).keys.N1:
            case (window as any).keys.N2:
            case (window as any).keys.N3:
            case (window as any).keys.N4:
            case (window as any).keys.N5:
            case (window as any).keys.N6:
            case (window as any).keys.N7:
            case (window as any).keys.N8:
            case (window as any).keys.N9: {
                pin += (e - 48).toString();
                var pinEl = document.getElementById("pin");
                if (pinEl)
                    pinEl.innerHTML = "# # # # ".substr(0, pin.length * 2);
                if (pin.length === 4) {
                    $("#dialogbox").hide();
                    (window as any).dialogBoxKeyHandler = null;
                    callback(pin);
                }
                return;
            }
            case (window as any).keys.RETURN:
                $("#dialogbox").hide();
                (window as any).dialogBoxKeyHandler = null;
                callback("");
                return;
            case (window as any).keys.LEFT:
                highlight(curIdx - 1);
                return;
            case (window as any).keys.RIGHT:
                highlight(curIdx + 1);
                return;
            case (window as any).keys.UP:
                highlight(1);
                return;
            case (window as any).keys.DOWN:
                highlight(0);
                return;
            case (window as any).keys.ENTER:
                if (typeof (window as any)._doKey === "function") {
                    (window as any)._doKey((window as any).keys.N0 + curIdx);
                }
                return;
        }
    };
}

/**
 * Public convenience wrapper around `_enterPinCode`.
 *
 * @param promptText - Prompt message for the PIN dialog.
 * @param callback   - Receives the entered PIN (or empty on cancel).
 *
 * Side effects: See `_enterPinCode`.
 */
export function enterPinCode(
    promptText: string,
    callback: (pin: string) => void
): void {
    _enterPinCode(promptText, callback);
}

/* ---------------------------------------------------------------------------
 * Parental access management
 * --------------------------------------------------------------------------- */

/**
 * Grant or revoke parental access.
 * When granted, access auto-expires after 1 hour (setTimeout).
 * When denied, shows a "Wrong parental code" notification.
 *
 * @param granted  - `true` if the correct PIN was entered, `false` otherwise.
 * @param callback - Invoked only when access is granted.
 *
 * Side effects:
 * - Sets `window.parentAccess` flag.
 * - Shows on-screen notification on failure.
 */
export function setParentAccess(granted: boolean, callback: () => void): void {
    (window as any).parentAccess = granted;
    if (granted) {
        setTimeout(function () {
            (window as any).parentAccess = false;
        }, 3600000); /* 1 hour */
        callback();
    } else {
        if (typeof (window as any).showShift === "function")
            (window as any).showShift(
                (window as any)._("Wrong parental code !!!") ||
                    "Wrong parental code !!!"
            );
    }
}

/**
 * Prompt the user to enter their parental PIN, then grant or deny access.
 *
 * @param callback - Called on successful PIN entry.
 *
 * Side effects: Shows PIN dialog; calls `setParentAccess`.
 */
export function enterPinAndSetAccess(callback: () => void): void {
    enterPinCode(
        (window as any)._("Enter parental code") || "Enter parental code",
        function (pin: string) {
            if (!pin) return;
            setParentAccess(pin === (window as any).parentPIN, callback);
        }
    );
}

/* ---------------------------------------------------------------------------
 * Parental control settings menu
 * --------------------------------------------------------------------------- */

/**
 * Open the parental control settings screen.
 * Lists options: enable/disable parental control, protect adult channels,
 * protect settings, protect provider switching.
 *
 * If parental control is locked (`parentPIN !== '*'` and no `parentAccess`),
 * prompts for PIN first before showing settings.
 *
 * @see {@link saveSettings} Inner function that persists changes.
 *
 * Side effects:
 * - May show PIN dialog.
 * - Sets `window.listArray` with settings items.
 * - Updates #listCaption.
 * - Calls `window._setSetup` and `window.optionsList`.
 */
export function parentControlSetup(): void {
    if ((window as any).parentPIN !== "*" && !(window as any).parentAccess) {
        enterPinAndSetAccess(parentControlSetup);
        return;
    }

    /**
     * Persist the current parental control settings to STB storage.
     * Handles enabling/disabling the PIN (asks for new PIN + confirmation).
     *
     * Side effects:
     * - Writes to STB storage (`stbSetItem`).
     * - Shows on-screen notification.
     * - Closes the current list and re-opens the options list.
     * - On PIN change, may show PIN entry dialogs.
     */
    function saveSettings(): void {
        function doSave(): void {
            if (typeof (window as any).stbSetItem === "function")
                (window as any).stbSetItem(
                    "parentPIN",
                    (window as any).parentPIN
                );
            var idx = 1;
            if (typeof (window as any).saveIfChanged === "function")
                (window as any).saveIfChanged(idx++, "sPSchannels", true);
            if (typeof (window as any).saveIfChanged === "function")
                (window as any).saveIfChanged(idx++, "sPSoptions", true);
            if (
                typeof (window as any).optIndexOf === "function" &&
                typeof (window as any).selectProvaider !== "undefined" &&
                (window as any).optIndexOf((window as any).selectProvaider) !==
                    -1 &&
                typeof (window as any).saveIfChanged === "function"
            )
                (window as any).saveIfChanged(idx++, "sPSprovs", true);
            if (typeof (window as any).showShift === "function")
                (window as any).showShift(
                    (window as any)._("Settings saved") || "Settings saved"
                );
            if (typeof (window as any).closeList === "function")
                (window as any).closeList();
            if (typeof (window as any).optionsList === "function")
                (window as any).optionsList(parentControlSetup);
        }

        var enabled = (window as any).parentPIN !== "*" ? 1 : 0;
        if (
            enabled !==
            ((window as any).listArray && (window as any).listArray[0]
                ? (window as any).listArray[0].val
                : null)
        ) {
            if ((window as any).parentPIN !== "*") {
                (window as any).parentPIN = "*";
                doSave();
            } else {
                enterPinCode(
                    (window as any)._("Set parental code") ||
                        "Set parental code",
                    function (pin: string) {
                        if (!pin) return;
                        var newPin = pin;
                        enterPinCode(
                            (window as any)._("Repeat parental code") ||
                                "Repeat parental code",
                            function (repeat: string) {
                                if (!repeat) return;
                                if (repeat !== newPin) {
                                    if (
                                        typeof (window as any).showShift ===
                                        "function"
                                    )
                                        (window as any).showShift(
                                            (window as any)._(
                                                "Wrong parental code !!!"
                                            ) || "Wrong parental code !!!"
                                        );
                                } else {
                                    (window as any).parentPIN = pin;
                                    setParentAccess(true, doSave);
                                }
                            }
                        );
                    }
                );
            }
        } else {
            doSave();
        }
    }

    var yesNo = [
        (window as any)._("no") || "no",
        (window as any)._("yes") || "yes",
    ];
    (window as any).listArray = [
        {
            name: (window as any)._("Parental control") || "Parental control",
            val: (window as any).parentPIN !== "*" ? 1 : 0,
            values: yesNo,
        },
        {
            name:
                (window as any)._("Protect Adult Channels") ||
                "Protect Adult Channels",
            val: (window as any).sPSchannels,
            values: yesNo,
        },
        {
            name: (window as any)._("Protect Settings") || "Protect Settings",
            val: (window as any).sPSoptions,
            values: yesNo,
        },
        {
            name:
                (window as any)._("Protect Change Provider") ||
                "Protect Change Provider",
            val: (window as any).sPSprovs,
            values: yesNo,
        },
        { name: "", val: 0, values: (window as any).nofun || [], cur: "" },
        {
            name:
                '<div class="btn">' +
                ((window as any)._("Save Settings") || "Save Settings") +
                "</div>",
            val: 0,
            values: saveSettings,
            cur: "",
        },
    ];
    if (
        typeof (window as any).optIndexOf === "function" &&
        typeof (window as any).selectProvaider !== "undefined" &&
        (window as any).optIndexOf((window as any).selectProvaider) === -1
    ) {
        (window as any).listArray.splice(3, 1);
    }
    var captionEl = document.getElementById("listCaption");
    if (captionEl)
        captionEl.innerHTML =
            (window as any)._("Parental control") || "Parental control";
    if (typeof (window as any)._setSetup === "function") {
        (window as any)._setSetup(saveSettings, function () {
            if (typeof (window as any).optionsList === "function")
                (window as any).optionsList(parentControlSetup);
        });
    }
}
