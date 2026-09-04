/**
 * Channel management — data structures, navigation, favorites, parental control.
 */

import {
    clearPlayTimeInterval,
    videoPip as pipVideoElement,
    playerMode,
    stbIsPlaying,
    stbPause,
    video as videoElement,
} from "../core/index";
import { translate as _ } from "../localization";
import { settings } from "../settings/index";
import { providerSetItem, storage } from "../storage/index";
import { getThumbnail, time2time } from "../utils/helpers";

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

/* ---- Playback & EPG state ---- */
export let playType = 0,
    playTime = 0;
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
    epgreturn = false,
    listChannel = 0,
    listEpgArray: EPGEntry[] = [],
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
    // Provider sets window.getEPGchanelCurCached = getEPGchanelCur (callback style).
    var fetchFn = window.getEPGchanelCurCached || getEPGchanelCached;
    if (typeof fetchFn === "function") {
        fetchFn(chId, function (id: any, epgData: EPGEntry[] | null) {
            // Legacy: setCurProg(e, t, r.callback) — callback receives channel id.
            setCurProg(id, epgData, entry!.callback);
            // Defer next queue item so a sync getEPGchanel(null) cannot nest forever
            // before setCurProg has a chance to set time_request.
            setTimeout(doGetCurProg, 0);
        });
    } else {
        doGetCurProg();
    }
}
export let curEpgData: EPGEntry[] | null = null;
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
export let historySearchText = "";
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
                    window.video?.currentTime || 0
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
                    c: catIndex,
                    ci: oldCatId,
                    e: _prog100?.name,
                    i: primaryIndex,
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
    window.catIndex = categoryIndex;
    window.curList = curList;
    window.primaryIndex = channelIndex;
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
    if (typeof window.playChannel === "function")
        window.playChannel(catIndex, nextIndex);
}

/**
 * Move to the previous channel in the current category (wraps to the end).
 *
 * Side effects: Calls `window.playChannel` which triggers playback switch.
 */
export function prevChannel(): void {
    var prevIndex = primaryIndex - 1;
    if (prevIndex < 0) prevIndex = curList.length - 1;
    if (typeof window.playChannel === "function")
        window.playChannel(catIndex, prevIndex);
}

/**
 * Delegate a numeric key press to the global `numberProg` handler for channel-number input.
 *
 * @param digit - The pressed digit (0-9).
 *
 * Side effects: Calls `window.numberProg(digit)` if defined.
 */
export function handleNumberInput(digit: number): void {
    if (typeof window.numberProg === "function") window.numberProg(digit);
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
        window.parentPIN !== "*" &&
        !window.parentAccess
    ) {
        if (typeof window.enterPinAndSetAccess === "function")
            window.enterPinAndSetAccess(callback);
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
    // Fall through to provider fetch
    var w = window as any;
    if (typeof w.getEPGchanel === "function") {
        w.getEPGchanel(channelId, callback);
    } else {
        callback(channelId, null);
    }
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
    // Legacy stbPlayer.js getCurProgData — uses chanels[], nextpr advance, then queue.
    // Do NOT sync-invoke updateChanelInfo from a cache hit: that re-enters this
    // function on the same stack when setCurProg cannot stick time_to / time_request.
    var ch = (window as any).chanels
        ? (window as any).chanels[channelId]
        : window.channels
          ? window.channels[channelId]
          : undefined;
    if (!ch) return false;
    var now = Date.now() / 1000;
    if (ch.time_to && ch.time_to >= now) return true;
    if (ch.time_request && ch.time_request > now) return false;
    var found = false;
    if (ch.nextpr) {
        var nofun =
            typeof (window as any).nofun === "function"
                ? (window as any).nofun
                : function () {};
        setCurProg(channelId, ch.nextpr, nofun);
        ch.time_request = 0;
    }
    if (ch.time_to && ch.time_to >= now) found = true;
    arrayGetCurProg.push({ callback: callback, ch_id: channelId });
    if (arrayGetCurProg.length < 2) doGetCurProg();
    return found;
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
    callback?: ((chId: number) => void) | (() => void)
): void {
    // Legacy always updates chanels[id] even when epgData is null/empty, and sets
    // time_request=now+3600 on miss so updateChanelInfo → getCurProgData cannot
    // re-queue forever (sync getEPGchanel(null) path).
    var safeChannelId = Number(channelId);
    if (!Number.isFinite(safeChannelId) || !Number.isInteger(safeChannelId))
        return;
    var sorted: EPGEntry[] = [];
    var hasData = Array.isArray(epgData) && epgData.length > 0;
    if (hasData) {
        sorted = epgData!.slice().sort(function (a: EPGEntry, b: EPGEntry) {
            return a.time - b.time;
        });
        epg[safeChannelId] = sorted;
        epgCashObj[safeChannelId] = sorted;
    }
    var now = Date.now() / 1000;
    var idx = sorted.findIndex(function (entry: EPGEntry) {
        return entry.time_to >= now && entry.time <= now;
    });
    var ch = (window as any).chanels
        ? (window as any).chanels[safeChannelId]
        : window.channels
          ? window.channels[safeChannelId]
          : undefined;
    if (ch) {
        var nextCount =
            typeof (window as any).sNextCount === "number"
                ? (window as any).sNextCount
                : 0;
        if (idx === -1) {
            ch.name = "";
            ch.time = 0;
            ch.time_to = 0;
            ch.descr = "";
            ch.nextpr = null;
            ch.time_request = now + 3600;
            if (hasData) ch.outdated = true;
        } else {
            var cur = sorted[idx];
            ch.name = cur.name;
            ch.time = cur.time;
            ch.time_to = cur.time_to;
            ch.descr = cur.descr || "";
            ch.time_request = 0;
            if (cur.icon !== undefined) ch.icon = cur.icon;
            ch.nextpr = sorted.slice(idx + 1, idx + 1 + nextCount + 1);
            if (ch.nextpr.length === 0) ch.nextpr = null;
            if (typeof ch.outdated !== "undefined") delete ch.outdated;
        }
    }
    if (callback) (callback as (chId: number) => void)(safeChannelId);
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
                window._pendingProvId &&
                typeof window.stbSetItem === "function"
            ) {
                window.stbSetItem("ottplayprov", window._pendingProvId);
                if (typeof window.stbSetItem === "function") {
                    var id = window._pendingProvId;
                    var arr = window.arrayProvaiders;
                    var recentCount = 3;
                    if (arr && arr.indexOf(id) > recentCount - 1) {
                        var recentProviders: any[] = [];
                        try {
                            recentProviders = JSON.parse(
                                window.stbGetItem("ottplayprovs") || "[]"
                            );
                        } catch (_) {}
                        var rIdx: number = recentProviders.indexOf(id);
                        if (rIdx !== -1) recentProviders.splice(rIdx, 1);
                        recentProviders.push(id);
                        window.stbSetItem(
                            "ottplayprovs",
                            JSON.stringify(recentProviders)
                        );
                    }
                }
                window._pendingProvId = "";
            }
            if (!sFavorites) {
                catsArray = window.providerGetJson("catsArray", []);
                cats =
                    Array.isArray(catsArray) && catsArray.length > 0
                        ? window.providerGetJson("cats", {})
                        : {};
            } else {
                favoritesArray = window.providerGetJson("favoritesArray", []);
            }
            if (!catsArray.length && cList.length) {
                cList.forEach(function (chId: number) {
                    var ch = window.channels[chId];
                    if (ch && ch.category) {
                        if (!cats[ch.category.name]) {
                            catsArray.push(ch.category.name);
                            cats[ch.category.name] = [];
                        }
                        cats[ch.category.name].push(chId);
                    }
                });
            }
            parentalArray = window.providerGetJson("parentalArray", []);
            if (
                !parentalArray.length &&
                typeof window.parental !== "undefined"
            ) {
                cList.forEach(function (chId: number) {
                    var ch = window.channels[chId];
                    if (
                        ch &&
                        ch.category &&
                        ch.category.name &&
                        window.parental.test(ch.category.name)
                    ) {
                        parentalArray.push(chId);
                    }
                });
            }
            catsArray.unshift(window._("All"));
            cats[window._("All")] = cList.slice();
            if (sFavorites) {
                catsArray.unshift(window._("Favorites"));
                cats[window._("Favorites")] = favoritesArray;
            }
            // Sync module cats/catsArray/curList to globals (used by _channelsList, old code)
            window.catsArray = catsArray;
            window.cats = cats;
            window.curList = curList;
            window.catIndex = catIndex;
            window.primaryIndex = primaryIndex;
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
                window.playChannel(catIndex, primaryIndex);
            } catch (e) {
                console.error(e);
                primaryIndex = 0;
                catIndex = sFavorites ? 1 : 0;
                try {
                    window.playChannel(catIndex, primaryIndex);
                } catch (e2) {
                    console.error(e2);
                }
            }
            try {
                window.loadEpgTimers();
            } catch (e) {
                console.error(e);
            }
            // List must be hidden so main key handler gets events (ENTER, Q, C, etc.)
            window.isListVisible = false;
        } else {
            // Empty channel list — show popup so user can configure provider (e.g., enter playlist URL)
            window.playType = 0;
            setCurrent(sFavorites ? 1 : 0, 0);
            var launchEl = document.getElementById("launch");
            if (launchEl)
                launchEl.innerHTML += "<br/>Channel list not received !!!";
            // Reset pending provider so user can retry without hitting savedProvId === id
            window._pendingProvId = "";
            window.launch_id = "#launch";
            // Show popup list so user can select 'Select playlist' to configure provider
            try {
                if (typeof window.popupList === "function") {
                    var pActions = window.popupActions;
                    if (pActions && pActions.length) {
                        window.popupList();
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
 * - Calls `window.getEPGchanelCached` (provider API) and `window.setCurProg` on success.
 */
export function epgShow_miniproc(
    mode: number,
    catIdx: number,
    chIdx: number,
    epgReturn: any,
    callback: (chId: any) => void
): void {
    var w = window as any;
    // Legacy stbPlayer.js:6534-6556
    //   epgShow_miniproc(mode, catIdx, chIdx, epgreturn, cb)
    //   a = cats[catsArray[listCatIndex]][listChannel]
    //   getEPGchanelCached(a, ...)  // internal channel id, NOT ch.ch_id
    epglisted = mode;
    epgreturn = epgReturn;
    w.epgreturn = epgReturn;
    w.listCatIndex = catIdx;
    w.listChannel = chIdx;

    var catList =
        cats[catsArray[catIdx]] || w.cats[w.catsArray[catIdx]] || curList || [];
    var a = catList[chIdx];
    if (mode === 0 && !(channels[a] && channels[a].rec)) return;
    if (epg_ch_id && epg_ch_id == a) {
        callback(a);
        return;
    }
    epg_ch_id = a;

    if (typeof w.getEPGchanelCached !== "function") {
        epglisted = 0;
        return;
    }
    if (mode) {
        $("#listPopUp")
            .html(
                '<img src="' +
                    (w.host || "") +
                    "/stbPlayer/buffering.gif?" +
                    (w.__av || "") +
                    '" height="40">'
            )
            .show();
    }
    w.getEPGchanelCached(a, function (id: any, data: EPGEntry[]) {
        epglisted = 0;
        // Legacy: if (!t) — empty array is truthy and still opens the list
        if (!data) {
            curEpgData = null;
            $("#listPopUp").hide();
            w.listChannel |= 65536;
            if (typeof w.infoBox === "function")
                w.infoBox(w._("Channel has no EPG"));
            return;
        }
        curEpgData = data;
        if (callback) callback(id);
        if (typeof (w as any).setCurProg === "function")
            (w as any).setCurProg(id, data, null);
    });
}

export function epgList(catIdx: number, chIdx: number, force: boolean): void {
    var w = window as any;
    epgreturn = force || false;
    w.epgreturn = epgreturn;

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
            if (typeof window.detailEPG === "function")
                window.detailEPG(channelId);
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

    epgShow_miniproc(1, catIdx, chIdx, force || false, onDataReady);
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
    window.epgArray = listEpgArray;
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
        case keys.LEFT:
            if (w.sArrowFun !== 2) return false;
        // fallthrough
        case keys.N3:
        case keys.CH_LIST:
        case keys.YELLOW:
            if (typeof w.channelsList === "function")
                w.channelsList(w.listCatIndex, w.listChannel);
            return true;
        case keys.RETURN:
            if (typeof w.closeList === "function") w.closeList();
            return true;
        case keys.ENTER:
            selectEpg();
            return true;
        case keys.N1:
        case keys.PLAY:
        case keys.PAUSE:
        case keys.BLUE:
            if (typeof w.bucketsList === "function")
                w.bucketsList(w.listCatIndex);
            return true;
        case keys.RIGHT:
            if (w.sArrowFun !== 2) return false;
        // fallthrough
        case keys.N2:
            if (typeof w.infoProgramm === "function") w.infoProgramm(item.name);
            return true;
        case keys.RW:
            if (w.sRewFun !== 1) return false;
            if (typeof w.channelsList === "function")
                w.channelsList(w.listCatIndex, w.listChannel);
            return true;
        case keys.PREV:
            if (w.sPNFun !== 1) return false;
            if (typeof w.channelsList === "function")
                w.channelsList(w.listCatIndex, w.listChannel);
            return true;
        case keys.FF:
            if (w.sRewFun !== 1) return false;
            if (typeof w.infoProgramm === "function") w.infoProgramm(item.name);
            return true;
        case keys.NEXT:
            if (w.sPNFun !== 1) return false;
            if (typeof w.infoProgramm === "function") w.infoProgramm(item.name);
            return true;
        case keys.N0:
        case keys.EPG:
        case keys.STOP:
        case keys.RED:
            switch (epglisted) {
                case 0:
                    if (typeof w.epgList === "function")
                        w.epgList(
                            w.listCatIndex,
                            w.listChannel,
                            w.epgreturn || false
                        );
                    return true;
                case 1:
                    if (typeof w.epgListAlpha === "function")
                        w.epgListAlpha(
                            w.listCatIndex,
                            w.listChannel,
                            w.epgreturn || false
                        );
                    return true;
                case 2:
                    if (
                        channels[epg_ch_id] &&
                        channels[epg_ch_id].rec &&
                        typeof w.recordsList === "function"
                    )
                        w.recordsList(
                            w.listCatIndex,
                            w.listChannel,
                            w.epgreturn || false
                        );
                    else if (typeof w.epgList === "function")
                        w.epgList(
                            w.listCatIndex,
                            w.listChannel,
                            w.epgreturn || false
                        );
                    return true;
            }
            return true;
        case keys.N8:
        case keys.TOOLS:
        case keys.GREEN:
            if (typeof setEpgTimer === "function")
                setEpgTimer(epg_ch_id, item.time);
            return true;
        case keys.INFO:
            if (typeof w.infoProgramm === "function") w.infoProgramm(item.name);
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
                    c: w.listCatIndex,
                    ci: channelId,
                    i: w.listChannel,
                    n: item.name,
                    t: item.time,
                    te: item.time_to,
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
                        c: t.c,
                        ci: t.ci,
                        i: t.i,
                        n: t.n,
                        t: t.t,
                        te: t.te,
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
export function recordsList(
    catIdx: number,
    chIdx: number,
    epgReturn: boolean
): void {
    var w = window as any;
    // Legacy stbPlayer.js:6641-6656 recordsList(e, t, r)
    if (
        (w.listChannel & 65536) === 65536 &&
        (w.listChannel & 65535) === chIdx &&
        w.listCatIndex === catIdx
    ) {
        if (typeof w.infoBox === "function")
            w.infoBox(w._("Channel has no EPG"));
        return;
    }

    function onDataReady(channelId: any): void {
        var e: EPGEntry[] = [];
        var r: EPGEntry[] = [];
        var ch = (channels[channelId] || {}) as Channel;
        if (curEpgData !== null && curEpgData.length) {
            var recHours = ch.rec || 0;
            e = curEpgData
                .filter(function (entry) {
                    return entry.time > Date.now() / 1000 - recHours * 3600;
                })
                .sort(function (a, b) {
                    return a.time - b.time;
                });
            var seen: string[] = [];
            var sorted = curEpgData.slice().sort(function (a, b) {
                return b.time - a.time;
            });
            r = sorted
                .filter(function (entry) {
                    if (entry.time < Date.now() / 1000 - recHours * 3600)
                        return false;
                    if (entry.time_to * 1000 > Date.now()) return false;
                    if (seen.indexOf(entry.name) !== -1) return false;
                    seen.push(entry.name);
                    return true;
                })
                .sort(function (a, b) {
                    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
                });
        }
        w.selIndex = 0;
        w.listArray = r;
        listEpgArray = e;
        w.getListItemFn = function (item: any, _idx: number) {
            return "&nbsp;&nbsp;" + (item && item.name ? item.name : "");
        };
        w.detailListActionFn = function () {
            if (typeof w.detailEPG === "function") w.detailEPG();
        };
        w.listKeyHandlerFn = epgKeyHandler;
        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML =
                w._("Archive. Channel: ") + (ch.channel_name || "");
        if (typeof epgPodval === "function") epgPodval();
        $("#listPopUp").hide();
        if (typeof w.showPage === "function") w.showPage();
    }
    epgShow_miniproc(0, catIdx, chIdx, epgReturn, onDataReady);
}

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
 * Side effects: Sets playTime, playType, fileArchive, archivePos;
 *               calls stbStop/stbPlay/stbSetPosTime via window globals.
 */
export function playArchive(e: number): void {
    var w = window as any;
    var t = curProg;
    // Defensive: clear any stale ticker before stbPlay stbStop path runs.
    // stbPlay clears it too, but only on the happy path; if stbPlay throws
    // before ticker init, this would leak.
    clearPlayTimeInterval();
    updateArchiveInfo(e);
    if (w.sInfoRew) w.showChanelInfo(1);
    var r = curList[primaryIndex];
    var s = epgArray[curProg] || {
        descr: "",
        name: "",
        time: Math.floor(e / 3600) * 3600,
        time_to: (Math.floor(e / 3600) + 1) * 3600,
    };
    playTime = 0;
    playType = Math.floor(e);
    w.playType = playType;
    w.playTime = playTime;
    if (!fileArchive || t != curProg) {
        if (w.sStopPlay) w.stbStop();
        w.stbPlay(
            w.getArchiveUrl(r, e, s.time_to, s),
            fileArchive ? e - s.time : 0
        );
    } else {
        w.stbSetPosTime(e - s.time);
    }
}

/**
 * Populate OSD with archive playback info at a given playback position.
 *
 * Called both from playArchive (on seek/start) and from the periodic
 * tick in uiInit() (every second during archive playback).
 *
 * @param position - Archive position in seconds (Unix timestamp).
 *
 * Side effects:
 * - Updates `archivePos`, `curProg`, `_prog100`.
 * - Populates DOM: #programm_name, #programm_name2, #programm_duration,
 *   #begin_time, #end_time, #nprogramm_name, #nbegin_time, #nend_time,
 *   #programm_descr, #progress, #progress_r, #progress_div background.
 * - Calls `window.updateChanelInfo` to refresh the OSD.
 * - Calls `getEPGchanelCached` if seek crossed the EPG program window.
 */
export function updateArchiveInfo(position: number): void {
    archivePos = position;
    var w = window as any;
    var channelId = curList[primaryIndex];
    var prog: EPGEntry | null = null;

    // Update channel header info
    var chEl = document.getElementById("channel_name");
    if (chEl && channels[channelId]) {
        chEl.innerHTML = channels[channelId].channel_name || "";
    }
    var piconEl = document.getElementById("picon");
    if (piconEl && typeof w.getChannelPicon === "function") {
        piconEl.style.backgroundImage =
            'url("' + w.getChannelPicon(channelId) + '")';
    }
    var chNumEl = document.getElementById("channel_number");
    if (chNumEl) chNumEl.innerHTML = "" + (primaryIndex + 1);

    // Find current program in epgArray
    var prevProg = curProg;
    var idx = epgArray.findIndex(function (e) {
        return e.time_to > position && e.time <= position;
    });

    if (idx !== -1) {
        curProg = idx;
        prog = epgArray[idx];
    } else {
        // No EPG: rolling 1h lookback window with playhead at ~80%
        // (same as live virtualTimeshiftProg — avoids clock-hour "17:00" bars).
        curProg = idx;
        var lookback = 3600;
        var total = lookback / 0.8;
        prog = {
            descr: "",
            name: "",
            time: position - lookback,
            time_to: position - lookback + total,
        };
    }

    _prog100 = prog;

    // Program name
    var progNameEl = document.getElementById("programm_name");
    if (progNameEl) progNameEl.innerHTML = prog ? prog.name : "";
    var progName2El = document.getElementById("programm_name2");
    if (progName2El) progName2El.innerHTML = prog ? prog.name : "";

    // Progress bar
    var progressEl = document.getElementById("progress");
    var progressREl = document.getElementById("progress_r");
    var progressDivEl = document.getElementById("progress_div");
    var duration = prog ? prog.time_to - prog.time : 1;
    var elapsed = position - (prog ? prog.time : position);
    var pct = Math.min(100, Math.max(0, (elapsed / duration) * 100));
    if (progressEl) progressEl.style.width = pct + "%";
    var nowSec = Date.now() / 1000;
    // remainingPct: use archive position (not clock time) since prog.time may be synthetic
    var remainingPct =
        prog && prog.time_to > position
            ? Math.min(
                  100,
                  Math.max(0, ((prog.time_to - position) / duration) * 100)
              )
            : 0;
    if (progressREl) progressREl.style.width = remainingPct + "%";
    if (progressDivEl) progressDivEl.style.backgroundColor = "#600";

    // Time labels
    var beginTimeEl = document.getElementById("begin_time");
    if (beginTimeEl && prog) beginTimeEl.textContent = time2time(prog.time);
    var endTimeEl = document.getElementById("end_time");
    if (endTimeEl && prog)
        endTimeEl.textContent =
            "+" + Math.round((prog.time_to - position) / 60);
    else if (endTimeEl) endTimeEl.textContent = "";

    // Duration / current time
    // Inline time2str — not re-exported from utils/helpers
    var progStartStr = (function () {
        var d = new Date((prog ? prog.time : position) * 1000);
        var days = (
            typeof _ === "function"
                ? _("Su Mo Tu We Th Fr Sa")
                : "Su Mo Tu We Th Fr Sa"
        ).split(" ");
        return (
            days[d.getDay()] +
            "&nbsp;" +
            ("0" + d.getDate()).slice(-2) +
            "." +
            ("0" + (d.getMonth() + 1)).slice(-2) +
            "&nbsp;" +
            ("0" + d.getHours()).slice(-2) +
            ":" +
            ("0" + d.getMinutes()).slice(-2)
        );
    })();
    var durationEl = document.getElementById("programm_duration");
    if (durationEl && prog) {
        var arcTime = time2time(position);
        var elapsedMin = Math.round((position - prog.time) / 60);
        var totalMin = Math.round((prog.time_to - prog.time) / 60);
        durationEl.innerHTML =
            '<span id="arc_time" style="color:#a00;">' +
            arcTime +
            "</span> " +
            progStartStr +
            " - " +
            time2time(prog.time_to) +
            ' (<span id="cur_time">' +
            (elapsedMin > 0 ? elapsedMin + "/" : "") +
            "</span>" +
            totalMin +
            " " +
            (typeof _ === "function" ? _("min") : "min") +
            ")";
    } else if (durationEl) {
        durationEl.innerHTML = "";
    }

    // Description
    var descrEl = document.getElementById("programm_descr");
    if (descrEl && prog) {
        var thumb = "";
        if (typeof getThumbnail === "function") {
            thumb = getThumbnail(prog.icon || "");
        }
        descrEl.innerHTML = thumb + (prog.descr || "");
    } else if (descrEl) {
        descrEl.innerHTML = "";
    }

    // Next program
    var nextProgIdx = idx + 1;
    if (nextProgIdx <= 0) {
        nextProgIdx = epgArray.findIndex(function (e) {
            return e.time > position;
        });
    }
    var nprogramNameEl = document.getElementById("nprogramm_name");
    var nbeginTimeEl = document.getElementById("nbegin_time");
    var nendTimeEl = document.getElementById("nend_time");
    if (
        nextProgIdx > -1 &&
        nextProgIdx < epgArray.length - 1 &&
        epgArray[nextProgIdx]
    ) {
        var nextProg = epgArray[nextProgIdx];
        if (nprogramNameEl) nprogramNameEl.innerHTML = nextProg.name;
        if (nbeginTimeEl) nbeginTimeEl.textContent = time2time(nextProg.time);
        if (nendTimeEl)
            nendTimeEl.textContent =
                "" + Math.round((nextProg.time_to - nextProg.time) / 60);
    } else {
        if (nprogramNameEl) nprogramNameEl.innerHTML = "  ";
        if (nbeginTimeEl) nbeginTimeEl.textContent = "";
        if (nendTimeEl) nendTimeEl.textContent = "";
    }

    // Trigger channel info refresh
    if (typeof w.updateChanelInfo === "function") {
        w.updateChanelInfo(listChannel);
    }

    // EPG re-fetch on seek-cross-boundary (stbPlayer.js:1744-1746)
    // If curProg changed and bar is not visible, auto-show
    if (w.sInfoChange && prevProg !== curProg && !$("#info1").is(":visible")) {
        w.showChanelInfo(1);
    }
    // Re-fetch EPG if seek crossed program window boundary and we don't have
    // enough future programs
    if (prevProg !== curProg && typeof w.getEPGchanelCached === "function") {
        // Check if next program is missing from epgArray
        var needFetch = false;
        if (nextProgIdx >= epgArray.length || !epgArray[nextProgIdx]) {
            needFetch = true;
        } else if (
            nextProgIdx + 1 >= epgArray.length ||
            !epgArray[nextProgIdx + 1]
        ) {
            needFetch = true;
        }
        if (needFetch) {
            w.getEPGchanelCached(
                channelId,
                function (_chId: number, data: EPGEntry[] | null) {
                    if (data && data.length) {
                        epgArray = data;
                        setCurProg(_chId, data, undefined as any);
                    }
                }
            );
        }
    }
}

/**
 * Stop archive playback and return to live TV for the current channel.
 * No-op if playback has not started, or if the current channel is not
 * an archive-capable (`rec`) channel.
 *
 * Side effects: refreshes the EPG window, resets playType/playTime, and
 * pauses the underlying video element.
 */
export function liveStop(): void {
    if (!stbIsPlaying()) return;
    var e = curList[primaryIndex];
    if (!channels[e].rec) return;
    getEPGchanelCached(e, function (t: number, e: any) {
        var r: any[] = [];
        if (e !== null && e.length) {
            r = e
                .filter(function (e: any) {
                    var ch = channels[t];
                    return ch
                        ? e.time > Date.now() / 1e3 - (ch.rec ?? 0) * 60 * 60
                        : false;
                })
                .sort(function (e: any, t: any) {
                    return e.time - t.time;
                });
        }
        epgArray = r;
        setCurProg(t, e, undefined as any);
        playType = Math.round(Date.now() / 1e3);
        playTime = 0;
        if (typeof window.showChanelInfo === "function")
            window.showChanelInfo(2);
        if (typeof window.showShift === "function")
            window.showShift(window._("Pause"));
        stbPause();
    });
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
        if (typeof window.timeShift === "function") window.timeShift(-delta);
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
        _shiftSec += e;
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
    // Legacy stbPlayer.js:6205-6304
    var chId = curList[primaryIndex];
    var ch = channels[chId];
    if (!playType && !(ch && ch.rec)) return;
    var i = 0;
    var t: any = null;
    var keys = w.keys || {};
    function r(delta: number): void {
        clearTimeout(t);
        i += delta;
        var stepEl = document.getElementById("step");
        if (stepEl && typeof w.step2text === "function")
            stepEl.innerHTML = w.step2text(i);
        t = setTimeout(function () {
            $("#dialogbox").hide();
            if (w.tooltip) w.tooltip.style.display = "";
            shiftArchive(i);
        }, 3000);
    }
    var btnDiv = w.btnDiv;
    $("#dialogbox")
        .html(
            w._("Rewind") +
                ':<br/><span id="step" style="font-size: 150%;"></span><br/>' +
                '<br><div class="btn" onclick="_doKey(keys.UP);">' +
                (w.strUP || "") +
                '</div>&nbsp;<div class="btn" onclick="_doKey(keys.DOWN);">' +
                (w.strDOWN || "") +
                "</div>&nbsp;+/- " +
                w._("1 minute") +
                "&nbsp;&nbsp;" +
                '<div class="btn" onclick="_doKey(keys.LEFT);">' +
                (w.strLEFT || "") +
                '</div>&nbsp;<div class="btn" onclick="_doKey(keys.RIGHT);">' +
                (w.strRIGHT || "") +
                "</div>&nbsp;+/- " +
                w._("10 Seconds") +
                "<br/>" +
                (typeof btnDiv === "function"
                    ? btnDiv(keys.ENTER, w.strENTER, "Go to") +
                      btnDiv(keys.RETURN, w.strRETURN, "Close")
                    : "")
        )
        .show();
    if (w.sInfoRew && typeof w.showChanelInfo === "function")
        w.showChanelInfo(1);
    r(initialDelta);
    w.dialogBoxKeyHandler = function (e: number): void {
        switch (e) {
            case keys.N1:
                r(-(w.s13dur || 0));
                return;
            case keys.N3:
                r(w.s13dur || 0);
                return;
            case keys.N4:
                r(-(w.s46dur || 0));
                return;
            case keys.N6:
                r(w.s46dur || 0);
                return;
            case keys.N7:
                r(-(w.s79dur || 0));
                return;
            case keys.N9:
                r(w.s79dur || 0);
                return;
            case keys.FF:
            case keys.UP:
                r(60);
                return;
            case keys.RW:
            case keys.DOWN:
                r(-60);
                return;
            case keys.RIGHT:
                r(10);
                return;
            case keys.LEFT:
                r(-10);
                return;
            case keys.EXIT:
            case keys.RETURN:
                $("#dialogbox").hide();
                if (typeof w.infoBarHide === "function") w.infoBarHide();
                if (w.tooltip) w.tooltip.style.display = "";
                clearTimeout(t);
                return;
            case keys.ENTER:
                $("#dialogbox").hide();
                clearTimeout(t);
                shiftArchive(i);
                if (w.tooltip) w.tooltip.style.display = "";
                return;
            default:
                return;
        }
    };
}

export function timeShift(n: number): void {
    var w = window as any;
    var chId = curList[primaryIndex];
    var ch = channels[chId];
    if (!ch || !ch.rec) return;
    if (typeof w.getEPGchanelCached !== "function") {
        // No EPG helper — seek by delta using archivePos as the base time
        if (n > 0) playArchive(Date.now() / 1000 - n);
        return;
    }
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
        window.epgArray = r;
        setCurProg(chId, epgData, undefined);
        window.curProg = curProg;
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
 * Default implementation: refresh page display.
 * Overwritten at provider init with `_channelsList()` from
 * `src/provider/index.ts` (full legacy port).
 *
 * @param _catIdx     - Category index (used by provider override).
 * @param _channelIdx - Channel index within the category (used by provider override).
 * Side effects: Calls `window.showPage`.
 */
export function channelsList(_catIdx: number, _channelIdx: number): void {
    if (typeof window.showPage === "function") window.showPage();
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
 * Hides the Actions popup, opens
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
        var submitted = window.editvar || "";
        if (!inputVal && !submitted) return;
        saved = inputVal || submitted;
        window.editvar = saved;
        if (typeof w.stbSetItem === "function") w.stbSetItem("chSearch", saved);
        setTimeout(function () {
            if (w.listCatIndex === undefined) return;
            var q = saved.toLowerCase();
            var catList = cats[catsArray[w.listCatIndex]] || [];
            w.listArray = catList.filter(function (id: number): boolean {
                var ch = channels[id];
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
                        r = channels[w.listArray[w.selIndex]];
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
                        r = channels[w.listArray[w.selIndex]];
                        if (
                            r !== undefined &&
                            typeof w.infoProgramm === "function"
                        )
                            w.infoProgramm(r.name);
                        return true;
                    case w.keys.NEXT:
                        if (w.sPNFun != 1) return false;
                        r = channels[w.listArray[w.selIndex]];
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
        !w.sFavorites && w.listCatIndex
            ? true
            : !!(w.sFavorites && !w.listCatIndex);
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
                  !w.sFavorites || w.listCatIndex
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
                w.parentChannel();
                return true;
            case w.keys.RETURN:
                $(dialog!).hide();
                return true;
            case w.keys.YELLOW:
            case w.keys.TOOLS:
                $(dialog!).hide();
                w.listChannel = w.selIndex;
                searchChannel();
                return true;
        }
        return false;
    };
}

/**
 * caption "String for search" seeded from stbGetItem("medSearch"); on submit
 * persists the new query, sets window.mediaName to e.title, unshifts 0 into
 * window.mediaSelects, and reloads the playlist with the search query
 * appended to e.playlist_url.
 *
 * Side effects:
 *  - Writes "medSearch" to stb storage on submit.
 *  - Mutates window.mediaName and window.mediaSelects.
 *  - Calls window.mediaList with the search-suffixed playlist URL.
 *
 * Caller: selectMedia() in stbPlayer.js — invoked only when
 * `e.search_on` is truthy.
 */
/**
 * Set the history search query string.
 * @param query - The search text to filter history entries by.
 * Side effects: Sets `historySearchText`.
 */
export function searchHistoryChannel(query: string): void {
    historySearchText = query;
}

/**
 * Returns history entries that match `historySearchText` (case-insensitive).
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
 * Returns channel IDs that match `searchText` (case-insensitive) within the
 * current category. If the filter is empty, returns a copy of `curList`.
 */
export function getFilteredChannelList(): number[] {
    if (!searchText) return curList.slice();
    const lower = searchText.toLowerCase();
    return curList.filter((chId) => {
        const ch = channels[chId];
        return (
            (ch?.channel_name?.toLowerCase().includes(lower) ?? false) ||
            (ch?.name?.toLowerCase().includes(lower) ?? false)
        );
    });
}

export function searchMedia(e: any): void {
    var w = window as any;
    searchText = typeof e === "string" ? e : "";
    w.editCaption = w._("String for search");
    var t =
        (typeof w.stbGetItem === "function" ? w.stbGetItem("medSearch") : "") ||
        "";
    w.editvar = t;
    w.setEdit = function (): void {
        var inputEl = document.getElementById("editvar");
        var inputVal = (inputEl && (inputEl as HTMLInputElement).value) || "";
        var submitted = window.editvar || "";
        if (!inputVal && !submitted) return;
        t = inputVal || submitted;
        if (typeof w.stbSetItem === "function") w.stbSetItem("medSearch", t);
        w.mediaName = e.title;
        w.mediaSelects.unshift(0);
        if (typeof w.mediaList === "function") {
            w.mediaList(
                e.playlist_url +
                    (e.playlist_url.indexOf("?") == -1 ? "?" : "&") +
                    "search=" +
                    t
            );
        }
    };
    if (typeof w.showEditKey === "function") w.showEditKey();
}

/**
 * Open the records search dialog.
 * Sets `window.editCaption` and `window.editvar` from persisted `medSearch`,
 * assigns a new `window.setEdit` that filters `_crData.data` by name/descr
 * and wires a dedicated listKeyHandler for the filtered result list.
 * Finally invokes `window.showEditKey` to display the input UI.
 *
 * Side effects:
 * - Mutates `window.editCaption`, `window.editvar`, `window.setEdit`,
 *   `window.listArray`, `window.getListItemFn`, `window.detailListActionFn`,
 *   `window.listKeyHandlerFn`, `_crData.selIndex`, `window.selIndex`.
 * - Reads/writes `medSearch` via stbGetItem/stbSetItem.
 * - Updates #listCaption and #listPodval innerHTML; hides #listPopUp.
 * - Calls `window.showPage`.
 */
export function searchRec(): void {
    var w = window as any;
    w.editCaption = w._("String for search");
    var e =
        (typeof w.stbGetItem === "function" ? w.stbGetItem("medSearch") : "") ||
        "";
    w.editvar = e;
    w.setEdit = function (): void {
        if (!(w.editvar as string).length) return;
        e = w.editvar;
        if (typeof w.stbSetItem === "function") w.stbSetItem("medSearch", e);
        setTimeout(function () {
            w.selIndex = 0;
            var t = e.toLowerCase();
            w.listArray = w._crData.data.filter(function (e: any) {
                return (
                    e.name.toLowerCase().indexOf(t) !== -1 ||
                    e.descr.toLowerCase().indexOf(t) !== -1
                );
            });
            w.getListItemFn = function (e: any, _t: number): string {
                return "&nbsp;&nbsp;" + e.name;
            };
            w.detailListActionFn = detailREC;
            w.listKeyHandlerFn = function (key: number): boolean {
                switch (key) {
                    case w.keys.EXIT:
                        if (typeof w.closeList === "function") w.closeList();
                        return true;
                    case w.keys.LEFT:
                        if (w.sArrowFun != 2) return false;
                    // falls through
                    case w.keys.RETURN:
                        if (typeof w.catRecordsList === "function")
                            w.catRecordsList(w.listCatIndex);
                        return true;
                    case w.keys.RIGHT:
                        if (w.sArrowFun != 2) return false;
                    // falls through
                    case w.keys.N2:
                    case w.keys.INFO:
                        if (typeof w.infoProgramm === "function")
                            w.infoProgramm(w.listArray[w.selIndex].name);
                        return true;
                    case w.keys.RW:
                        if (w.sRewFun != 1) return false;
                        if (typeof w.catRecordsList === "function")
                            w.catRecordsList(w.listCatIndex);
                        return true;
                    case w.keys.PREV:
                        if (w.sPNFun != 1) return false;
                        if (typeof w.catRecordsList === "function")
                            w.catRecordsList(w.listCatIndex);
                        return true;
                    case w.keys.FF:
                        if (w.sRewFun != 1) return false;
                        if (typeof w.infoProgramm === "function")
                            w.infoProgramm(w.listArray[w.selIndex].name);
                        return true;
                    case w.keys.NEXT:
                        if (w.sPNFun != 1) return false;
                        if (typeof w.infoProgramm === "function")
                            w.infoProgramm(w.listArray[w.selIndex].name);
                        return true;
                    case w.keys.N0:
                    case w.keys.YELLOW:
                    case w.keys.TOOLS:
                        w._crData.selIndex = w.selIndex;
                        if (typeof w.searchRec === "function") w.searchRec();
                        return true;
                    case w.keys.ENTER: {
                        var tCh = w.listArray[w.selIndex].ch_id;
                        var r = w.listArray[w.selIndex].time;
                        w._crData.selIndex = w._crData.data.findIndex(function (
                            e: any
                        ) {
                            return e.ch_id == tCh && e.time == r;
                        });
                        if (typeof w.selectREC === "function") w.selectREC();
                        return true;
                    }
                }
                return false;
            };
            var captionEl = document.getElementById("listCaption");
            if (captionEl)
                captionEl.innerHTML =
                    w._("Archive. Category: ") +
                    w.catsArray[w.listCatIndex] +
                    ". " +
                    w._("Search") +
                    ':"' +
                    e +
                    '" (' +
                    w.listArray.length +
                    ")";
            var podvalEl = document.getElementById("listPodval");
            if (podvalEl) {
                podvalEl.innerHTML =
                    w.btnDiv(
                        w.keys.RETURN,
                        w.strRETURN,
                        "Records",
                        w.sArrowFun == 2
                            ? w.strLEFT
                            : w.sRewFun == 1
                              ? w.strRW
                              : w.sPNFun == 1
                                ? w.strPREV
                                : ""
                    ) +
                    w.btnDiv(
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
                    ) +
                    w.btnDiv(w.keys.YELLOW, "", "Search", w.strTools, "0");
            }
            $("#listPopUp").hide();
            if (typeof w.showPage === "function") w.showPage();
        });
    };
    if (typeof w.showEditKey === "function") w.showEditKey();
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
    var keys = window.keys;
    if (!keys) return false;

    switch (keyCode) {
        case keys.RETURN:
            if (typeof window.closeList === "function") window.closeList();
            return true;

        case keys.ENTER: {
            if (typeof window.closeList === "function") {
                window.closeList();
            }
            var selChId = window.listArray
                ? window.listArray[window.selIndex]
                : undefined;
            var curChId = window.curList
                ? window.curList[window.primaryIndex]
                : undefined;
            if (selChId) {
                if (selChId !== curChId) {
                    if (typeof window.playChannel === "function") {
                        window.playChannel(
                            window.listCatIndex,
                            window.selIndex
                        );
                    }
                } else if (!window.playType) {
                    // Same channel in live mode — show info bar (matches old stbPlayer behavior)
                    if (typeof window.setCurrent === "function") {
                        window.setCurrent(window.listCatIndex, window.selIndex);
                    }
                    var chId = window.curList
                        ? window.curList[window.primaryIndex]
                        : undefined;
                    if (typeof window.updateChanelInfo === "function") {
                        window.updateChanelInfo(chId);
                    }
                    if (
                        typeof window.showChanelInfo === "function" &&
                        window.sInfoSwitch
                    ) {
                        window.showChanelInfo(window.settings.infoTimeout);
                    }
                    window.playType = 0;
                }
            }
            return true;
        }

        case keys.STOP:
        case keys.PIP:
            if (typeof window.stbPlayPip === "function") {
                var chId = window.listArray[window.selIndex];
                if (chId) window.pipIndex = window.selIndex;
                if (typeof window.getChannelUrl === "function") {
                    window.stbPlayPip(window.getChannelUrl(chId));
                }
            }
            return true;

        case keys.RED:
        case window.keys ? window.keys.EPG : undefined:
            if (typeof window.epgList === "function") {
                window.epgList(window.listCatIndex, window.selIndex, true);
            }
            return true;

        case keys.BLUE:
        case keys.PLAY:
        case keys.PAUSE:
            if (typeof window.bucketsList === "function") {
                window.bucketsList(window.listCatIndex);
            }
            return true;

        case keys.N0:
        case keys.YELLOW:
        case keys.TOOLS:
            if (window.sNoNumbersKeys) {
                showActionsDialog();
            } else {
                $("#listPopUp").toggle();
            }
            return true;

        case keys.N2:
        case keys.INFO: {
            var ch = window.channels[window.listArray[window.selIndex]];
            if (
                ch &&
                typeof ch.name !== "undefined" &&
                typeof window.infoProgramm === "function"
            ) {
                window.infoProgramm(ch.name);
            }
            return true;
        }

        case keys.RW:
        case keys.PREV: {
            var rwFn = keyCode === keys.RW ? window.sRewFun : window.sPNFun;
            if (rwFn === 1 && typeof window.bucketsList === "function") {
                window.bucketsList(window.listCatIndex);
                return true;
            }
            if (rwFn === 2) {
                var newCat =
                    window.listCatIndex > 0
                        ? window.listCatIndex - 1
                        : (window.catsArray || []).length - 1;
                if (typeof window.channelsList === "function") {
                    window.channelsList(
                        newCat,
                        window.catIndex !== newCat ? 0 : window.primaryIndex
                    );
                }
                return true;
            }
            return false;
        }

        case keys.FF:
        case keys.NEXT: {
            var ffFn = keyCode === keys.FF ? window.sRewFun : window.sPNFun;
            if (ffFn === 1 && typeof window.epgList === "function") {
                window.epgList(window.listCatIndex, window.selIndex, true);
                return true;
            }
            if (ffFn === 2) {
                var newCat2 =
                    window.listCatIndex < (window.catsArray || []).length - 1
                        ? window.listCatIndex + 1
                        : 0;
                if (typeof window.channelsList === "function") {
                    window.channelsList(
                        newCat2,
                        window.catIndex !== newCat2 ? 0 : window.primaryIndex
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
                if (typeof window.addChannel2bucket === "function") {
                    window.addChannel2bucket();
                }
                return true;
            case keys.N4:
                if (typeof window.parentChannel === "function") {
                    window.parentChannel();
                }
                return true;
            case keys.N9: {
                var newSort = window.sSortAbc == 1 ? 0 : 1;
                window.sSortAbc = newSort;
                if (typeof window.providerSetItem === "function") {
                    window.providerSetItem("sSortAbc", newSort);
                }
                if (typeof window.sortChannels === "function") {
                    window.sortChannels(newSort);
                }
                if (typeof window.showPage === "function") window.showPage();
                return true;
            }
            case keys.N6:
                window.listChannel = window.selIndex;
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
    var listArray = window.listArray;
    var selIndex = window.selIndex;
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
    if (typeof window.showPage === "function") window.showPage();
    if (typeof window.changeSelect === "function") window.changeSelect(delta);
    if (typeof window.saveChannelsCats === "function")
        window.saveChannelsCats();
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
    var listArray = window.listArray;
    var selIndex = window.selIndex;
    if (!listArray || selIndex === undefined) return;
    listArray.splice(selIndex, 1);
    if (
        selIndex === listArray.length &&
        typeof window.changeSelect === "function"
    ) {
        window.changeSelect(-1);
    }
    if (typeof window.showPage === "function") window.showPage();
    if (typeof window.saveChannelsCats === "function")
        window.saveChannelsCats();
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
            next.style.backgroundColor = window.curColorB || "#668";
            next.style.color = window.curColor || "gold";
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

    window.dialogBoxKeyHandler = function (e: number): void {
        switch (e) {
            case window.keys.N0:
            case window.keys.N1:
            case window.keys.N2:
            case window.keys.N3:
            case window.keys.N4:
            case window.keys.N5:
            case window.keys.N6:
            case window.keys.N7:
            case window.keys.N8:
            case window.keys.N9: {
                pin += (e - 48).toString();
                var pinEl = document.getElementById("pin");
                if (pinEl)
                    pinEl.innerHTML = "# # # # ".substr(0, pin.length * 2);
                if (pin.length === 4) {
                    $("#dialogbox").hide();
                    window.dialogBoxKeyHandler = null;
                    callback(pin);
                }
                return;
            }
            case window.keys.RETURN:
                $("#dialogbox").hide();
                window.dialogBoxKeyHandler = null;
                callback("");
                return;
            case window.keys.LEFT:
                highlight(curIdx - 1);
                return;
            case window.keys.RIGHT:
                highlight(curIdx + 1);
                return;
            case window.keys.UP:
                highlight(1);
                return;
            case window.keys.DOWN:
                highlight(0);
                return;
            case window.keys.ENTER:
                if (typeof window._doKey === "function") {
                    window._doKey(window.keys.N0 + curIdx);
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
    window.parentAccess = granted;
    if (granted) {
        setTimeout(function () {
            window.parentAccess = false;
        }, 3600000); /* 1 hour */
        callback();
    } else {
        if (typeof window.showShift === "function")
            window.showShift(
                window._("Wrong parental code !!!") || "Wrong parental code !!!"
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
        window._("Enter parental code") || "Enter parental code",
        function (pin: string) {
            if (!pin) return;
            setParentAccess(pin === window.parentPIN, callback);
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
    if (window.parentPIN !== "*" && !window.parentAccess) {
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
            if (typeof window.stbSetItem === "function")
                window.stbSetItem("parentPIN", window.parentPIN);
            var idx = 1;
            if (typeof window.saveIfChanged === "function")
                window.saveIfChanged(idx++, "sPSchannels", true);
            if (typeof window.saveIfChanged === "function")
                window.saveIfChanged(idx++, "sPSoptions", true);
            if (
                typeof window.optIndexOf === "function" &&
                typeof window.selectProvaider !== "undefined" &&
                window.optIndexOf(window.selectProvaider) !== -1 &&
                typeof window.saveIfChanged === "function"
            )
                window.saveIfChanged(idx++, "sPSprovs", true);
            if (typeof window.showShift === "function")
                window.showShift(
                    window._("Settings saved") || "Settings saved"
                );
            if (typeof window.closeList === "function") window.closeList();
            if (typeof window.optionsList === "function")
                window.optionsList(parentControlSetup);
        }

        var enabled = window.parentPIN !== "*" ? 1 : 0;
        if (
            enabled !==
            (window.listArray && window.listArray[0]
                ? window.listArray[0].val
                : null)
        ) {
            if (window.parentPIN !== "*") {
                window.parentPIN = "*";
                doSave();
            } else {
                enterPinCode(
                    window._("Set parental code") || "Set parental code",
                    function (pin: string) {
                        if (!pin) return;
                        var newPin = pin;
                        enterPinCode(
                            window._("Repeat parental code") ||
                                "Repeat parental code",
                            function (repeat: string) {
                                if (!repeat) return;
                                if (repeat !== newPin) {
                                    if (typeof window.showShift === "function")
                                        window.showShift(
                                            window._(
                                                "Wrong parental code !!!"
                                            ) || "Wrong parental code !!!"
                                        );
                                } else {
                                    window.parentPIN = pin;
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

    var yesNo = [window._("no") || "no", window._("yes") || "yes"];
    window.listArray = [
        {
            name: window._("Parental control") || "Parental control",
            val: window.parentPIN !== "*" ? 1 : 0,
            values: yesNo,
        },
        {
            name:
                window._("Protect Adult Channels") || "Protect Adult Channels",
            val: window.sPSchannels,
            values: yesNo,
        },
        {
            name: window._("Protect Settings") || "Protect Settings",
            val: window.sPSoptions,
            values: yesNo,
        },
        {
            name:
                window._("Protect Change Provider") ||
                "Protect Change Provider",
            val: window.sPSprovs,
            values: yesNo,
        },
        { cur: "", name: "", val: 0, values: window.nofun || [] },
        {
            cur: "",
            name:
                '<div class="btn">' +
                (window._("Save Settings") || "Save Settings") +
                "</div>",
            val: 0,
            values: saveSettings,
        },
    ];
    if (
        typeof window.optIndexOf === "function" &&
        typeof window.selectProvaider !== "undefined" &&
        window.optIndexOf(window.selectProvaider) === -1
    ) {
        window.listArray.splice(3, 1);
    }
    var captionEl = document.getElementById("listCaption");
    if (captionEl)
        captionEl.innerHTML =
            window._("Parental control") || "Parental control";
    if (typeof window._setSetup === "function") {
        window._setSetup(saveSettings, function () {
            if (typeof window.optionsList === "function")
                window.optionsList(parentControlSetup);
        });
    }
}
