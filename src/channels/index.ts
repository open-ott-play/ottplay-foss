import { createSettingsEditor } from "../settings/editor";
import {
    hasTmdbService,
    metadataCssUrl,
    metadataHtml,
    metadataText,
} from "../utils/helpers";
/**
 * Channel management — data structures, navigation, favorites, parental control.
 */

import { clearPlayTimeInterval, stbIsPlaying } from "../core/index";
import { translate as _ } from "../localization";
import { settings } from "../settings/index";
import { providerSetItem, storage } from "../storage/index";
import { getThumbnail, time2time } from "../utils/helpers";
import {
    activeFavoritesList,
    addFavoritesList,
    bindFavoritesViewRefresh,
    deleteFavoritesList,
    type FavoritesListsBlob,
    favoritesArray,
    favoritesLists,
    getActiveFavoritesListName,
    listFavoritesLists,
    loadFavoritesLists,
    renameFavoritesList,
    saveFavoritesLists,
    setActiveFavoritesList,
    syncFavoritesArrayFromActive,
} from "./favorites-lists";
import {
    getFilteredChannelList,
    getFilteredHistory,
    historySearchText,
    searchHistoryChannel,
    searchText,
    setSearchText,
} from "./search";

export type { FavoritesListsBlob };
export {
    addFavoritesList,
    deleteFavoritesList,
    favoritesArray,
    favoritesLists,
    getActiveFavoritesListName,
    getFilteredChannelList,
    getFilteredHistory,
    historySearchText,
    listFavoritesLists,
    renameFavoritesList,
    searchHistoryChannel,
    searchText,
    setActiveFavoritesList,
};

export interface Channel {
    adult?: number;
    category?: { name: string; class: string };
    ch_id: number;
    channel_name: string;
    cmd?: string;
    descr?: string;
    description?: string | (() => string);
    epg?: string | number;
    epg_external?: boolean;
    epg_src?: string;
    epg_url?: string | number;
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
    tn?: string;
    url?: string;
    xmltv_url?: string;
    xmltv_urls?: string[];
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

interface PortChannelIdMigration {
    get: (key: string) => string | null;
    ids: Record<string, number | null>;
    record: (previous: number, current: number) => void;
    set: (key: string, value: string) => void;
}

/** Observe only hashes computed while this provider's channel list is loading. */
export function beginPortChannelIdMigration(): PortChannelIdMigration {
    var w = window as any;
    delete w.__ottLegacyChannelAliases;
    var state: PortChannelIdMigration = {
        get: w.providerGetItem,
        ids: {},
        record: function (previous: number, current: number): void {
            if (!Number.isInteger(previous) || !Number.isInteger(current))
                return;
            var key = String(previous);
            var known = state.ids[key];
            state.ids[key] =
                known === undefined || known === current ? current : null;
        },
        set: w.providerSetItem,
    };
    w.__ottRecordPortHash = state.record;
    return state;
}

/** Stop observing a departed provider, leaving its persisted data untouched. */
export function cancelPortChannelIdMigration(): void {
    delete (window as any).__ottRecordPortHash;
    delete (window as any).__ottLegacyChannelAliases;
}

/** Incremental migration: unknown IDs, existing channel IDs and ambiguous mappings stay intact. */
export function finishPortChannelIdMigration(
    state: PortChannelIdMigration
): void {
    var w = window as any;
    if (w.__ottRecordPortHash !== state.record) return;
    cancelPortChannelIdMigration();
    if (
        w.providerGetItem !== state.get ||
        w.providerSetItem !== state.set ||
        typeof state.get !== "function" ||
        typeof state.set !== "function"
    )
        return;
    // Versioned importers consume original records and the observed hash chain.
    // Keep this metadata readable only while the collecting source still owns it.
    var aliases: Record<string, number | null> = Object.create(null);
    Object.keys(state.ids).forEach(function (key) {
        aliases[key] = state.ids[key];
    });
    var identity = function () {
        return w.__ottSourceIdentity
            ? w.__ottSourceIdentity.current(w)
            : String(w.p_pref || "");
    };
    var aliasSource = identity();
    Object.defineProperty(w, "__ottLegacyChannelAliases", {
        configurable: true,
        get: function () {
            return w.providerGetItem === state.get &&
                w.providerSetItem === state.set &&
                aliasSource === identity()
                ? aliases
                : undefined;
        },
    });
    function owns(object: object, key: string): boolean {
        return Object.prototype.hasOwnProperty.call(object, key);
    }
    function migrateId(id: unknown): unknown {
        if (typeof id !== "number" && typeof id !== "string") return id;
        var key = String(id);
        if (!/^\d+$/.test(key) || owns(channels, key)) return id;
        var seen: Record<string, boolean> = {};
        while (!seen[key]) {
            seen[key] = true;
            var target = state.ids[key];
            if (typeof target !== "number") return id;
            if (owns(channels, String(target)))
                return typeof id === "string" ? String(target) : target;
            key = String(target);
        }
        return id;
    }
    function migrateArray(value: unknown): void {
        if (Array.isArray(value))
            value.forEach(function (id, index) {
                value[index] = migrateId(id);
            });
    }
    function migrateField(value: unknown, field: string): void {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            var record = value as Record<string, unknown>;
            if (owns(record, field)) record[field] = migrateId(record[field]);
        }
    }
    var keys = [
        "cats",
        "parentalArray",
        "prevArr",
        "continueWatch",
        "playbackJournal",
        "epgTimers",
        "aAspects",
        "aZooms",
        "aAudios",
        "aSubs",
    ];
    keys.forEach(function (key) {
        try {
            var raw = state.get.call(w, key);
            if (!raw) return;
            var value = JSON.parse(raw);
            var before = JSON.stringify(value);
            if (key === "parentalArray") migrateArray(value);
            else if (key === "prevArr" || key === "epgTimers") {
                if (Array.isArray(value))
                    value.forEach(function (entry) {
                        migrateField(entry, "ci");
                    });
            } else if (key === "continueWatch")
                migrateField(value, "channelId");
            else if (key === "playbackJournal") {
                if (
                    value &&
                    value.version === 2 &&
                    w.__ottClassicPlayback &&
                    w.__ottClassicPlayback.canMigrateJournal()
                ) {
                    if (value.bookmark && value.bookmark.kind !== "vod")
                        migrateField(value.bookmark, "channelId");
                    if (Array.isArray(value.history))
                        value.history.forEach(function (entry: any) {
                            if (entry && entry.kind !== "vod")
                                migrateField(entry, "channelId");
                        });
                }
            } else if (key === "cats") {
                var lists = value;
                if (lists && typeof lists === "object" && !Array.isArray(lists))
                    Object.keys(lists).forEach(function (name) {
                        migrateArray(lists[name]);
                    });
            } else if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value)
            ) {
                Object.keys(value).forEach(function (oldKey) {
                    var newKey = String(migrateId(oldKey));
                    // Preserve an already configured canonical channel instead of overwriting it.
                    if (newKey !== oldKey && !owns(value, newKey)) {
                        value[newKey] = value[oldKey];
                        delete value[oldKey];
                    }
                });
            }
            var migrated = JSON.stringify(value);
            if (migrated === before) return;
            state.set.call(w, key, migrated);
            // These values were read before the provider populated its channel set.
            if (key === "prevArr") {
                prevArr = value;
                w.prevArr = value;
            } else if (key === "aAspects") {
                aAspects = value;
                w.aAspects = value;
            } else if (key === "aZooms") {
                aZooms = value;
                w.aZooms = value;
            } else if (key === "aAudios") {
                aAudios = value;
                w.aAudios = value;
            } else if (key === "aSubs") {
                aSubs = value;
                w.aSubs = value;
            }
        } catch (_) {
            // Keep malformed/unsupported records, and retry failed storage writes next load.
        }
    });
}

/** Edem/VPortal passes request objects instead of playlist URLs. */
export interface MediaPortalTarget {
    a?: string;
    filters?: unknown[];
    items?: unknown[];
    mediaName?: string;
    request?: Record<string, unknown>;
}

/** Public provider ABI: URL, local history/favorites, or a VPortal request. */
export type MediaTarget = string | -1 | -2 | MediaPortalTarget;

/** Legacy callbacks remain callable with no arguments; built-ins can reject stale work earlier. */
interface MediaListCompletion {
    isCurrent?: () => boolean;
    (): void;
}

interface MediaLoadState {
    name: string;
    pending: boolean;
    provider: unknown;
    records: MediaHistoryEntry[];
    urls: MediaTarget[] | null;
}

export interface MediaHistoryEntry {
    adult?: number | string;
    ch_id?: number;
    current?: number;
    descr?: string;
    description?: string | (() => string);
    fav?: number;
    logo_30x30?: string;
    name?: string;
    playlist_name?: string;
    playlist_url?: MediaTarget;
    request?: Record<string, unknown>;
    search_on?: boolean | number | string;
    stream_url?: string | (() => string);
    submenu?: MediaHistoryEntry[];
    title?: string;
    vportalSource?: string;
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
    "favoritesLists",
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
    "continueWatch",
];

/* Compatibility names are accessor views owned by SettingsStore. */
declare var sNoSmall: number;
declare var sStopPlay: number;
declare var sPipSize: number;
declare var sPipPos: number;
declare var sPageSize: number;
declare var sFontShift: number;
declare var sFont: number;
declare var sArrowFun: number;
declare var sRewFun: number;
declare var sPNFun: number;
declare var sRfun: number;
declare var sGfun: number;
declare var sYfun: number;
declare var sBfun: number;
declare var sALfun: number;
declare var sARfun: number;
declare var sAUfun: number;
declare var sADfun: number;
declare var sRWfun: number;
declare var sFFfun: number;
declare var sPREVfun: number;
declare var sNEXTfun: number;
declare var sEfun: number;
declare var sOkfun: number;
declare var s13dur: number;
declare var s46dur: number;
declare var s79dur: number;
declare var sNoColorKeys: number;
declare var sNoNumbersKeys: number;
declare var sTimezone: number;
declare var sSleepTimeout: number;
declare var sEpgRemindMinutes: number;
declare var sVolumeStep: number;
declare var sInfoTimeout: number;
declare var sInfoSlide: number;
declare var sInfoSwitch: number;
declare var sInfoChange: number;
declare var sInfoRew: number;
declare var sThumbnail: number;
declare var sOsdOpacity: number;
declare var sListPos: number;
declare var sEditor: number;
declare var sShowNum: number;
declare var sShowPikon: number;
declare var sShowName: number;
declare var sShowProgress: number;
declare var sShowArchive: number;
declare var sShowScroll: number;
declare var sShowDescr: number;
declare var sShowProgram: number;
declare var sPreview: number;
declare var sNextCountL: number;
declare var sFavorites: number;
declare var sPermanentTime: number;
declare var s10resum: number;
declare var sPrevCount: number;
declare var sMedCount: number;
declare var sPSchannels: number;
declare var sPSoptions: number;
declare var sPSprovs: number;
declare var sHDMIsupport: number;
declare var sAutorun: number;
declare var sPlayers: number;
declare var sBufSize: number;
declare var sGrapI: number;
declare var parentPIN: string;
declare var sHideMenus: string[];
declare var sSHLcolSel: string;
declare var sSHLcolor: string;
declare var sSHLcolorB: string;
declare var commandServerAddress: string;
declare var commandServerToken: string;
declare var sLocalCmdUrl: string;
declare var sLocalHttpEnabled: number;
declare var sLocalHttpDeviceCode: string;
declare var sSwopBaseUrl: string;
declare var sDeviceUuid: string;
declare var commandServerEnabled: number;

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
export let parentalArray: number[] = [];

/* Multi-favorites lists state + CRUD: src/channels/favorites-lists.ts (Phase D2). */
export let epgTimers: any[] = [],
    sSortAbc = 0;
export let medHistory: MediaHistoryEntry[] = [],
    medFavorites: MediaHistoryEntry[] = [];

/* ---- Playback & EPG state ---- */
export let playType = 0,
    playTime = 0;
export let _prog100: any = null,
    _tmedia: any = null;
export let epgCacheCapacity = 0;
export let epgCacheByChannel: Record<number, EPGEntry[]> = {};
export let epgCacheChannelOrder: number[] = [];
let epgCacheFetchedAt: Record<number, number> = {};
let epgCacheGeneration = 0;
type EpgCallback = (chId: number, programs: EPGEntry[] | null) => void;
let epgPending: Record<
    number,
    {
        generation: number;
        channel: Channel | undefined;
        callbacks: EpgCallback[];
    }
> = {};

/** Clear full schedules and reject responses from the previous provider/refresh. */
export function invalidateEpgCache(refetchPending = false): void {
    var waiting = epgPending;
    var w = window as any;
    var refreshView =
        refetchPending &&
        w.isListVisible &&
        (w.listKeyHandlerFn === epgKeyHandler ||
            w.listKeyHandler === epgKeyHandler);
    epgCacheGeneration++;
    epgPending = {};
    epgCacheFetchedAt = {};
    for (var key in epg) delete epg[key];
    for (var key in epgCacheByChannel) delete epgCacheByChannel[key];
    epgCacheChannelOrder.length = 0;
    currentProgramRequestQueue.length = 0;
    // Backend warm-up invalidates schedules, not the menu's selected channel.
    // Its in-flight callback renders rows but does not reassign epg_ch_id.
    if (!refetchPending) epg_ch_id = null;
    curEpgData = null;
    for (var key in channels) {
        var ch = channels[key];
        if (!ch) continue;
        ch.time_request = 0;
        ch.time_to = 0;
        ch.nextpr = null;
    }
    // Backend warm-up can race an EPG menu request. Keep its consumer alive
    // by issuing a fresh request; provider reloads deliberately drop consumers.
    if (refetchPending) {
        for (var key in waiting) {
            var request = waiting[key];
            if (request.channel !== channels[key]) continue;
            request.callbacks.forEach(function (notify) {
                getChannelEpgCached(Number(key), notify);
            });
        }
        // A completed visible menu has no pending consumer to reissue.
        // Reopen its current view so fresh rows and archive/timer actions agree.
        if (refreshView) {
            var channelIndex = w.listChannel & 65535;
            if (epgListMode === 0)
                recordsList(w.listCatIndex, channelIndex, w.epgreturn);
            else if (epgListMode === 2)
                epgListAlpha(w.listCatIndex, channelIndex, w.epgreturn);
            else epgList(w.listCatIndex, channelIndex, w.epgreturn);
        }
    }
}

function epgCacheLimit(): number {
    var configured =
        typeof window !== "undefined" &&
        typeof (window as any).epgCacheCapacity !== "undefined"
            ? Number((window as any).epgCacheCapacity)
            : epgCacheCapacity;
    return (window as any).OttPlayCore.legacyGuideCacheCapacity(configured);
}

function readEpgCache(channelId: number): EPGEntry[] | null {
    var data = epg[channelId];
    var core = (window as any).OttPlayCore;
    var state = core.legacyGuideCacheRead(
        data,
        epgCacheFetchedAt[channelId],
        epgCacheLimit(),
        function () {
            return Date.now();
        }
    );
    if (state === 0) return null;
    if (state < 0) {
        delete epg[channelId];
        delete epgCacheByChannel[channelId];
        delete epgCacheFetchedAt[channelId];
        core.legacyGuideCacheOrder(epgCacheChannelOrder, channelId, null, true);
        return null;
    }
    core.legacyGuideCacheOrder(epgCacheChannelOrder, channelId, null, false);
    return data;
}

/** Only complete provider/native responses belong in the full-schedule cache. */
function cacheFetchedEpg(channelId: number, data: EPGEntry[] | null): void {
    var limit = epgCacheLimit();
    if (!limit || !data || !data.length) return;
    epg[channelId] = data;
    epgCacheByChannel[channelId] = data;
    epgCacheFetchedAt[channelId] = Date.now();
    (window as any).OttPlayCore.legacyGuideCacheOrder(
        epgCacheChannelOrder,
        channelId,
        limit,
        false
    ).forEach(function (id: number) {
        delete epg[id];
        delete epgCacheByChannel[id];
        delete epgCacheFetchedAt[id];
    });
}
export let currentProgramRequestQueue: Array<{
    ch_id: number;
    callback: (chId: number) => void;
}> = [];
export let epgListMode = 0,
    epgreturn = false,
    listChannel = 0,
    listEpgArray: EPGEntry[] = [],
    epg_ch_id: any = null;

/**
 * Process the EPG request queue. Pops the next entry and fetches EPG data
 * through the shared cache, then continues until the queue is empty.
 * Preserves the legacy EPG request queue behavior.
 */
export function processCurrentProgramQueue(): void {
    if (currentProgramRequestQueue.length === 0) return;
    var entry = currentProgramRequestQueue.shift();
    var chId = entry!.ch_id;
    // Always use getChannelEpgCached (same path as EPG menu). With epgCacheCapacity=0,
    // gold wires getCachedChannelEpg → getChannelEpg; Mode B must share the
    // Cached path so list/footer see programmes already loaded for the browser.
    // (The sync helper getCachedChannelEpg(id) ignores callbacks — never use it.)
    getChannelEpgCached(chId, function (id: any, epgData: EPGEntry[] | null) {
        // Legacy: setCurProg(e, t, r.callback) — callback receives channel id.
        setCurProg(id, epgData, entry!.callback);
        // Defer next queue item so a sync getChannelEpg(null) cannot nest forever
        // before setCurProg has a chance to set time_request.
        setTimeout(processCurrentProgramQueue, 0);
    });
}
export let curEpgData: EPGEntry[] | null = null;
export let epgArray: EPGEntry[] = [],
    curProg = -1;
export let mediaListArr: MediaHistoryEntry[] = [];
export let mediaUrls: MediaTarget[] | null = null;
export let mediaNames: string[] = [],
    mediaSelects: number[] = [];
export let mediaRecords: MediaHistoryEntry[] = [];
export let mediaRecordsPar: MediaHistoryEntry[] | null = null;
export let mediaName = "";
/* searchText + historySearchText: src/channels/search.ts (Phase D filter leaf). */
export let searchInput = "",
    searchTimeout: any = null;
export let archivePos = 0,
    archiveStart = 0,
    archiveEnd = 0;
export let fileArchive = false;

/** Classic view entrypoint; state/history decisions belong to the playback model. */
export function setCurrent(
    categoryIndex: number,
    channelIndex: number,
    isArchive?: boolean
): void {
    (window as any).__ottClassicPlayback.select(
        categoryIndex,
        channelIndex,
        isArchive
    );
}

/**
 * Restore continue-watching bookmark on startup.
 *
 * Reads the `continueWatch` provider key. If the saved mode is archive or
 * vod for a channel still present in the current playlist and the bookmark
 * is younger than 7 days, shows a `confirmBox` "Resume from archive?" dialog.
 * On Yes: plays archive at the saved position (reusing `window.playArchive`).
 * On No: returns false so the caller falls back to normal live playback.
 *
 * Returns true if a resume was offered (archive/vod dialog shown), false
 * otherwise (no bookmark / stale / channel missing / live mode) — the caller
 * should then run the normal `playChannel` path.
 *
 * Must be called after the playlist is populated.
 */
export function restoreContinueWatch(): boolean {
    try {
        var cw: any = (window as any).__ottClassicPlayback.bookmark();
        if (!cw || !cw.v || !cw.mode || cw.channelId == null) return false;
        var ageMs = Date.now() - (cw.updatedAt || 0);
        if (ageMs < -300000 || ageMs > 7 * 24 * 60 * 60 * 1000) return false; // stale: > 7 days
        // 1) Resume dialog = archive only (positive playType sentinel required).
        // VOD / live → return false so caller does live playback.
        if (
            !(
                cw.mode === "archive" &&
                typeof cw.playType === "number" &&
                cw.playType > 0
            )
        )
            return false;
        // 3) Category-aware channel lookup — track which list won so Yes callback can use it directly.
        var resumeCatIndex: number = -1;
        var resumeIdx: number = -1;
        if (
            cats &&
            catsArray &&
            typeof cw.catIndex === "number" &&
            cats[catsArray[cw.catIndex]]
        ) {
            resumeCatIndex = cw.catIndex;
            resumeIdx = cats[catsArray[cw.catIndex]].indexOf(cw.channelId);
        }
        if (resumeIdx === -1) {
            resumeCatIndex = catIndex;
            resumeIdx = curList.indexOf(cw.channelId);
        }
        if (resumeIdx === -1 && cats && cats[_("All")]) {
            var allIdx = cats[_("All")].indexOf(cw.channelId);
            if (allIdx !== -1) {
                resumeCatIndex = catsArray.indexOf(_("All"));
                resumeIdx = allIdx;
            }
        }
        if (resumeIdx === -1) return false; // channel no longer present
        // A PIN adds another asynchronous step. Keep it tied to the playlist
        // and provider that offered the bookmark, even when IDs are reused.
        var source = {
            categories: catsArray,
            cats: cats,
            channel: channels[cw.channelId],
            channels: channels,
            get: window.providerGetItem,
            list:
                (cats && catsArray && cats[catsArray[resumeCatIndex]]) ||
                curList,
            prefix: (window as any).p_pref,
            set: window.providerSetItem,
        };
        var isCurrent = function (): boolean {
            return (
                catsArray === source.categories &&
                cats === source.cats &&
                channels === source.channels &&
                channels[cw.channelId] === source.channel &&
                ((cats && catsArray && cats[catsArray[resumeCatIndex]]) ||
                    curList) === source.list &&
                window.providerGetItem === source.get &&
                window.providerSetItem === source.set &&
                (window as any).p_pref === source.prefix &&
                source.list.indexOf(cw.channelId) !== -1
            );
        };
        var playLiveFallback = function (): boolean {
            if (!isCurrent()) return false;
            try {
                window.playChannel(
                    resumeCatIndex,
                    source.list.indexOf(cw.channelId)
                );
                return true;
            } catch (_e) {
                console.error(_e);
                primaryIndex = 0;
                catIndex = sFavorites ? 1 : 0;
                try {
                    window.playChannel(catIndex, primaryIndex);
                } catch (e2) {
                    console.error(e2);
                }
                return false;
            }
        };
        var playSavedArchive = function (): void {
            if (!isCurrent()) return;
            if (ifParentalAccessChId(cw.channelId, playSavedArchive)) return;
            // Avoid setCurrent: it would overwrite the archive bookmark with live mode.
            catIndex = resumeCatIndex;
            curList = source.list;
            primaryIndex = curList.indexOf(cw.channelId);
            window.catIndex = catIndex;
            window.curList = curList;
            window.primaryIndex = primaryIndex;
            if (typeof window.playArchive === "function") {
                window.playArchive(cw.playType);
                if (typeof cw.playTime === "number") {
                    setTimeout(
                        (window as any).__ottClassicPlayback.guard(function () {
                            if (
                                isCurrent() &&
                                curList === source.list &&
                                curList[primaryIndex] === cw.channelId &&
                                window.playType === Math.floor(cw.playType)
                            )
                                window.stbSetPosTime(cw.playTime);
                        }),
                        500
                    );
                }
            } else {
                playLiveFallback();
            }
        };

        if (typeof window.confirmBox === "function") {
            window.confirmBox(
                _("Resume from archive?") +
                    "<br><br>" +
                    _("Bookmark age: %1 days", Math.floor(ageMs / 86400000)),
                playSavedArchive,
                function () {
                    playLiveFallback();
                }
            );
        } else {
            // No confirmBox available — skip archive, let caller play live.
            return false;
        }
        return true;
    } catch (_e) {
        // never block startup on bookmark restore
        return false;
    }
}

/**
 * Move to the next channel in the current category (wraps around to index 0).
 *
 * Side effects: Calls `window.playChannel` which triggers playback switch.
 */
export function nextChannel(): void {
    var nextIndex = (window as any).OttPlayCore.playbackChannelIndex(
        primaryIndex,
        curList.length,
        1,
        "classic"
    );
    if (typeof window.playChannel === "function")
        window.playChannel(catIndex, nextIndex);
}

/**
 * Move to the previous channel in the current category (wraps to the end).
 *
 * Side effects: Calls `window.playChannel` which triggers playback switch.
 */
export function prevChannel(): void {
    var prevIndex = (window as any).OttPlayCore.playbackChannelIndex(
        primaryIndex,
        curList.length,
        -1,
        "classic"
    );
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
    var lst = activeFavoritesList();
    (window as any).OttPlayCore.editFavoriteSelection(lst, channelId, "add");
    syncFavoritesArrayFromActive();
}

/**
 * Remove a channel ID from the favorites list if present.
 *
 * Side effects: Mutates `favoritesArray` in-memory (does NOT persist).
 */
export function removeFromFavorites(channelId: number): void {
    var lst = activeFavoritesList();
    (window as any).OttPlayCore.editFavoriteSelection(lst, channelId, "remove");
    syncFavoritesArrayFromActive();
}

/* ---- Multi-favorites lists CRUD: ./favorites-lists.ts ---- */

/**
 * If the user is currently viewing the Favorites category, rebind module
 * `curList` / `window.curList` to the freshly-synced `cats["Favorites"]`
 * array, clamp indices, and update `window.activeFavList`.
 * Called after every mutation that changes the active list content.
 */
function refreshFavoritesViewIfActive(): void {
    if (typeof window === "undefined") return;
    var w = window as any;
    if (!w._ || !catsArray || !cats) return;
    var favLabel = w._("Favorites");
    var ci = catsArray.indexOf(favLabel);
    if (ci === -1) return;
    if (w.catIndex !== ci) return;
    curList = cats[favLabel] || [];
    w.curList = curList;
    if (primaryIndex >= curList.length)
        primaryIndex = Math.max(0, curList.length - 1);
    if (primaryIndex < 0) primaryIndex = 0;
    w.primaryIndex = primaryIndex;
    if (typeof w.selIndex === "number" && w.selIndex >= curList.length) {
        w.selIndex = primaryIndex;
    }
    w.activeFavList = getActiveFavoritesListName();
}

bindFavoritesViewRefresh(refreshFavoritesViewIfActive);

/**
 * Multi-favorites list manager UI (proper #list menu, not showSelectBox OSD).
 * Pick a list to switch immediately; last row opens add/rename/delete.
 * Calls saveChannelsCats() after every mutation.
 */
export function popFavLists(): void {
    var w = window as any;
    var keys = w.keys;

    // Kill any leftover showSelectBox OSD from older builds.
    try {
        var numEl = document.getElementById("numprog");
        if (numEl) numEl.style.display = "none";
        w.selectBoxKeyHandler = null;
    } catch (_) {}

    function switchTo(listName: string): void {
        setActiveFavoritesList(listName);
        saveChannelsCats();
        refreshFavoritesViewIfActive();
        w.showShift(
            (w._ ? w._("Active list") : "Active list") + ": " + listName
        );
    }

    function addNewList(): void {
        w.editCaption = w._ ? w._("New list name") : "New list name";
        w.editvar = "";
        w.setEdit = function () {
            var name = (w.editvar || "").trim();
            if (name && addFavoritesList(name)) {
                switchTo(name);
                w.showShift(w._ ? w._("List created") : "List created");
                showMain();
            }
            w.setEdit = function () {};
        };
        if (typeof w.showEditKey === "function") {
            w.showEditKey(w.keys.ENTER);
        }
    }

    function showEditActions(listName: string): void {
        var names = listFavoritesLists();
        var canDelete = names.length > 1;
        var rows: string[] = [];
        rows.push(w._ ? w._("Rename") : "Rename");
        if (canDelete) rows.push(w._ ? w._("Delete") : "Delete");
        rows.push(w._ ? w._("Cancel") : "Cancel");

        w.selIndex = 0;
        w.listArray = rows;
        w.listDataArray = rows;
        w.getListItemFn = function (item: string): string {
            return "&nbsp;&nbsp;" + metadataText(item);
        };
        w.detailListActionFn = function () {};
        w.listKeyHandlerFn = function (key: number): boolean {
            if (!keys) return false;
            switch (key) {
                case keys.RETURN:
                    showManage();
                    return true;
                case keys.ENTER: {
                    var idx = w.selIndex | 0;
                    if (idx === 0) {
                        w.editCaption =
                            (w._ ? w._("Rename to") : "Rename to") +
                            ": " +
                            listName;
                        w.editvar = listName;
                        w.setEdit = function () {
                            var newName = (w.editvar || "").trim();
                            if (
                                newName &&
                                newName !== listName &&
                                renameFavoritesList(listName, newName)
                            ) {
                                switchTo(newName);
                                w.showShift(
                                    w._ ? w._("List renamed") : "List renamed"
                                );
                                showMain();
                            }
                            w.setEdit = function () {};
                        };
                        if (typeof w.showEditKey === "function") {
                            w.showEditKey(w.keys.ENTER);
                        }
                    } else if (idx === 1 && canDelete) {
                        w.confirmBox(
                            (w._ ? w._("Delete list") : "Delete list") +
                                ": " +
                                listName +
                                "?",
                            function () {
                                deleteFavoritesList(listName);
                                saveChannelsCats();
                                refreshFavoritesViewIfActive();
                                w.showShift(
                                    w._ ? w._("List deleted") : "List deleted"
                                );
                                showMain();
                            }
                        );
                    } else {
                        showManage();
                    }
                    return true;
                }
            }
            return false;
        };
        var cap = document.getElementById("listCaption");
        if (cap)
            cap.textContent =
                (w._ ? w._("Favorite lists") : "Favorite lists") +
                ": " +
                listName;
        var footerElement = document.getElementById("listPodval");
        if (footerElement && typeof w.renderButtonHint === "function") {
            footerElement.innerHTML = w.renderButtonHint(
                keys.RETURN,
                w.strRETURN,
                "Close"
            );
        }
        try {
            if (typeof $ !== "undefined") $("#listPopUp").hide();
        } catch (_) {}
        if (typeof w.showPage === "function") w.showPage();
    }

    function showManage(): void {
        var names = listFavoritesLists();
        var activeName = getActiveFavoritesListName();
        var rows = names.map(function (n: string) {
            return n === activeName
                ? "\u2713 " +
                      n +
                      (w._ ? " (" + w._("current") + ")" : " (current)")
                : n;
        });
        rows.push(w._ ? w._("Add new list") : "Add new list");

        w.selIndex = Math.max(0, names.indexOf(activeName));
        w.listArray = rows;
        w.listDataArray = rows;
        w.getListItemFn = function (item: string): string {
            return "&nbsp;&nbsp;" + metadataText(item);
        };
        w.detailListActionFn = function () {};
        w.listKeyHandlerFn = function (key: number): boolean {
            if (!keys) return false;
            switch (key) {
                case keys.RETURN:
                    showMain();
                    return true;
                case keys.ENTER: {
                    var idx = w.selIndex | 0;
                    if (idx === names.length) {
                        addNewList();
                    } else if (idx >= 0 && idx < names.length) {
                        showEditActions(names[idx]);
                    }
                    return true;
                }
            }
            return false;
        };
        var cap = document.getElementById("listCaption");
        if (cap)
            cap.innerHTML = w._
                ? w._("Add / rename / delete\u2026")
                : "Add / rename / delete\u2026";
        var footerElement = document.getElementById("listPodval");
        if (footerElement && typeof w.renderButtonHint === "function") {
            footerElement.innerHTML = w.renderButtonHint(
                keys.RETURN,
                w.strRETURN,
                "Close"
            );
        }
        try {
            if (typeof $ !== "undefined") $("#listPopUp").hide();
        } catch (_) {}
        if (typeof w.showPage === "function") w.showPage();
    }

    function showMain(): void {
        var names = listFavoritesLists();
        var activeName = getActiveFavoritesListName();
        var rows = names.map(function (n: string) {
            return n === activeName ? "\u2713 " + n : n;
        });
        rows.push(
            w._
                ? w._("Add / rename / delete\u2026")
                : "Add / rename / delete\u2026"
        );

        w.selIndex = Math.max(0, names.indexOf(activeName));
        w.listArray = rows;
        w.listDataArray = rows;
        w.getListItemFn = function (item: string): string {
            return "&nbsp;&nbsp;" + metadataText(item);
        };
        w.detailListActionFn = function () {};
        w.listKeyHandlerFn = function (key: number): boolean {
            if (!keys) return false;
            switch (key) {
                case keys.RETURN:
                    if (typeof w.popupList === "function") w.popupList();
                    else if (typeof w.closeList === "function") w.closeList();
                    return true;
                case keys.ENTER: {
                    var idx = w.selIndex | 0;
                    if (idx === names.length) {
                        showManage();
                    } else if (idx >= 0 && idx < names.length) {
                        switchTo(names[idx]);
                        showMain();
                    }
                    return true;
                }
            }
            return false;
        };
        var cap = document.getElementById("listCaption");
        if (cap) cap.innerHTML = w._ ? w._("Favorite lists") : "Favorite lists";
        var footerElement = document.getElementById("listPodval");
        if (footerElement && typeof w.renderButtonHint === "function") {
            footerElement.innerHTML =
                w.renderButtonHint(keys.RETURN, w.strRETURN, "Close") +
                w.renderButtonHint(
                    keys.ENTER,
                    "Ok",
                    w._ ? w._("Switch") : "Switch"
                );
        }
        try {
            if (typeof $ !== "undefined") $("#listPopUp").hide();
        } catch (_) {}
        if (typeof w.showPage === "function") w.showPage();
    }

    showMain();
}

/**
 * Persist the current `catsArray`, `cats`, `favoritesArray`, and `parentalArray`
 * to storage via the provider API.
 *
 * Side effects: Writes JSON strings to provider storage (async via providerSetItem).
 */
export function saveChannelsCats(): void {
    if (typeof providerSetItem === "function") {
        // `favoritesArray` mirrors the active list (back-compat alias).
        syncFavoritesArrayFromActive();
        saveFavoritesLists();
        (window as any).__ottChannels.refresh();
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
        (window as any).OttPlayCore.classicParentalPrompt(
            settings.psChannels,
            window.parentPIN,
            window.parentAccess
        )
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

/**
 * Timezone hours for Mode B get_epg. NEVER use channel.rec — that is archive
 * depth (M3U rechours / catchup-days), not timezone. Pass 0 so Rust applies
 * time_shift_by_epg from match_channels; tvg-shift (ch.ts, seconds) is applied
 * client-side after fetch like Mode A m3u getChannelEpg.
 */
export function epgTimezoneHours(_ch: any): number {
    return 0;
}

/** Configured catchup/history hours from channel.rec (M3U settings / tags). */
export function epgArchiveHours(ch: any): number {
    if (!ch || ch.rec == null) return 0;
    var n = Number(ch.rec);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Apply tvg-shift (ch.ts seconds) to EPG entries in-place — Mode A parity. */
export function applyChannelTvgShift(
    ch: any,
    epgData: EPGEntry[] | null
): EPGEntry[] | null {
    return (window as any).OttPlayCore.legacyGuideShift(epgData, ch && ch.ts);
}

/** Only the built-in M3U companion uses native XMLTV. Other providers own EPG. */
export function usesNativeXmltv(ch: Channel | undefined): boolean {
    var w = window as any;
    return (
        !!(w.Capacitor || w.__TAURI__) &&
        w.p_pref === "m3u" &&
        !!ch &&
        !ch.epg_external &&
        (!ch.epg_src || ch.epg_src === "local")
    );
}

/** Preserve playlist source order and schemes, never interpret a companion hash as a URL. */
export function channelXmltvUrls(ch: Channel | undefined): string[] {
    var sources =
        ch && ch.xmltv_urls && ch.xmltv_urls.length
            ? ch.xmltv_urls
            : ch && ch.xmltv_url
              ? [ch.xmltv_url]
              : [];
    return sources.filter(function (source, index) {
        return (
            typeof source === "string" &&
            /^https?:\/\//i.test(source) &&
            sources.indexOf(source) === index
        );
    });
}

export function getChannelEpgCached(
    channelId: number,
    callback: (chId: number, programs: EPGEntry[] | null) => void
): void {
    var cached = readEpgCache(channelId);
    if (cached) {
        callback(channelId, cached);
        return;
    }
    var existing = epgPending[channelId];
    if (existing && existing.channel === channels[channelId]) {
        existing.callbacks.push(callback);
        return;
    }
    var request = {
        callbacks: [callback],
        channel: channels[channelId],
        generation: epgCacheGeneration,
    };
    epgPending[channelId] = request;
    function finish(_id: number, programs: EPGEntry[] | null): void {
        // A late response must not populate the new provider or trigger its UI.
        if (
            epgPending[channelId] !== request ||
            request.generation !== epgCacheGeneration ||
            request.channel !== channels[channelId]
        )
            return;
        delete epgPending[channelId];
        var data = Array.isArray(programs) && programs.length ? programs : null;
        cacheFetchedEpg(channelId, data);
        request.callbacks.forEach(function (notify) {
            notify(channelId, data);
        });
    }
    try {
        // Mode B (Capacitor mobile): use native XMLTV EPG plugin.
        if (
            typeof (window as any).Capacitor !== "undefined" &&
            usesNativeXmltv(channels[channelId])
        ) {
            var ch = channels[channelId];
            // Native XMLTV resolves raw tvg-id/name; epg_url is a companion hash.
            var hash = ch && ch.epg != null ? String(ch.epg) : "";
            var timeShiftHours = epgTimezoneHours(ch);
            var archiveHours = epgArchiveHours(ch);
            var xmltvUrls = channelXmltvUrls(ch);
            (window as any).Capacitor.Plugins.MobileXmltvEpg.getEpg({
                archive_hours: archiveHours,
                ch: ch?.channel_name || ch?.name || "",
                channel_id: String(channelId),
                hash: hash,
                time_shift_hours: timeShiftHours,
                tvg_name: (ch && ch.tn) || "",
                xmltv_url: xmltvUrls[0] || "",
                xmltv_urls: xmltvUrls,
            })
                .then(function (result: any) {
                    // Accept both raw EPG array and {epg_data: [...]} (same as Tauri).
                    var epgData = Array.isArray(result)
                        ? result
                        : result && Array.isArray(result.epg_data)
                          ? result.epg_data
                          : null;
                    epgData = applyChannelTvgShift(ch, epgData);
                    // Never cache [] — empty is truthy in JS and would permanently
                    // skip re-fetch after a cold-XMLTV miss (Mode B warm race).
                    if (epgData && epgData.length > 0) {
                        finish(channelId, epgData);
                    } else {
                        finish(channelId, null);
                    }
                })
                .catch(function (_err: any) {
                    finish(channelId, null);
                });
            return;
        }
        // Mode B (Tauri desktop): in-process Rust EPG via invoke() (not HTTP).
        // Pass playlist channel name + epg_url hash so resolve_xmltv_id can match
        // (numeric channelId alone almost never equals an XMLTV id).
        if (
            typeof (window as any).__TAURI__ !== "undefined" &&
            usesNativeXmltv(channels[channelId])
        ) {
            var ch = channels[channelId];
            var channelName = (ch && (ch.channel_name || ch.name)) || "";
            var hash =
                ch && (ch as any).epg_url != null
                    ? String((ch as any).epg_url)
                    : "";
            var timeShiftHours = epgTimezoneHours(ch);
            var archiveHours = epgArchiveHours(ch);
            var coreApi = (window as any).__TAURI__.core;
            var invokeFn =
                coreApi && typeof coreApi.invoke === "function"
                    ? function (cmd: string, args: any) {
                          return coreApi.invoke(cmd, args);
                      }
                    : typeof (window as any).__TAURI__.invoke === "function"
                      ? function (cmd: string, args: any) {
                            return (window as any).__TAURI__.invoke(cmd, args);
                        }
                      : null;
            if (!invokeFn) {
                finish(channelId, null);
                return;
            }
            // Tauri 2 command args are camelCase (channel_id → channelId).
            // timeShiftHours = timezone only (0 → Rust uses time_shift_by_epg).
            // archiveHours = configured catchup/history depth (channel.rec).
            invokeFn("get_epg", {
                archiveHours: archiveHours,
                ch: channelName,
                channelId: String(channelId),
                hash: hash,
                timeShiftHours: timeShiftHours,
                tvgId: ch && ch.epg != null ? String(ch.epg) : "",
                tvgName: (ch && ch.tn) || "",
                xmltvUrls: channelXmltvUrls(ch),
            })
                .then(function (result: any) {
                    // Accept both raw EPG array and {epg_data: [...]} wrapper.
                    var epgData = Array.isArray(result)
                        ? result
                        : result && Array.isArray(result.epg_data)
                          ? result.epg_data
                          : null;
                    epgData = applyChannelTvgShift(ch, epgData);
                    // Never cache [] — see Capacitor branch (cold XMLTV miss).
                    if (epgData && epgData.length > 0) {
                        finish(channelId, epgData);
                    } else {
                        finish(channelId, null);
                    }
                })
                .catch(function (_err: any) {
                    finish(channelId, null);
                });
            return;
        }
        // Fall through to provider fetch (Mode A / browser / STB)
        var w = window as any;
        if (typeof w.getChannelEpg === "function") {
            w.getChannelEpg(channelId, finish);
        } else {
            finish(channelId, null);
        }
    } catch (_err) {
        finish(channelId, null);
    }
}

/**
 * Get the currently cached EPG array for a channel, or null.
 * Convenience wrapper over `epg[channelId]`.
 *
 * @param channelId - Channel ID.
 * @returns The EPGEntry[] or null if not cached.
 */
export function getCachedChannelEpg(channelId: number): EPGEntry[] | null {
    return readEpgCache(channelId);
}

/**
 * Retrieve EPG data from the secondary EPG cache (`epgCacheByChannel`).
 * This is a separate cache from `epg` (used for older fetched data).
 *
 * @param channelId - Channel ID.
 * @returns The EPGEntry[] or null.
 */
export function getEpgFromCache(channelId: number): EPGEntry[] | null {
    return readEpgCache(channelId);
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
    // Legacy stbPlayer.js getCurProgData — uses channels[], nextpr advance, then queue.
    // Do NOT sync-invoke updateChannelInfo from a cache hit: that re-enters this
    // function on the same stack when setCurProg cannot stick time_to / time_request.
    var ch = (window as any).channels
        ? (window as any).channels[channelId]
        : window.channels
          ? window.channels[channelId]
          : undefined;
    if (!ch) return false;
    var now = Date.now() / 1000;
    if (ch.time_to && ch.time_to >= now) return true;
    if (ch.time_request && ch.time_request > now) {
        // Miss lock: re-evaluate cached programmes against wall clock so a
        // prior "no current" (wrong timezone / programme gap) does not keep
        // list/footer blank for an hour while the EPG menu still has data.
        var cachedLock = readEpgCache(channelId);
        if (cachedLock && cachedLock.length) {
            var refreshWithoutCallback =
                typeof (window as any).noop === "function"
                    ? (window as any).noop
                    : function () {};
            setCurProg(channelId, cachedLock, refreshWithoutCallback);
            if (ch.time_to && ch.time_to >= now) return true;
        }
        return false;
    }
    var found = false;
    if (ch.nextpr) {
        var noop =
            typeof (window as any).noop === "function"
                ? (window as any).noop
                : function () {};
        setCurProg(channelId, ch.nextpr, noop);
        ch.time_request = 0;
    }
    if (ch.time_to && ch.time_to >= now) found = true;
    currentProgramRequestQueue.push({ callback: callback, ch_id: channelId });
    // Defer queue drain past showPage's innerHTML. Sync cache hits used to
    // call updateChannelListRow before #pn* nodes existed, so only the playing
    // channel (time_to already set → baked into row HTML) showed EPG.
    if (currentProgramRequestQueue.length < 2)
        setTimeout(processCurrentProgramQueue, 0);
    return found;
}

/**
 * Update a channel's now/next display from a full schedule or a nextpr slice.
 * Full-schedule caching belongs to getChannelEpgCached, never this UI helper.
 *
 * @param channelId - Channel ID to associate the data with.
 * @param epgData   - Programs used to update the current channel display.
 * @param callback  - Optional function called after storing.
 *
 * Side effects: Updates channel now/next fields and invokes the callback.
 */
export function setCurProg(
    channelId: number,
    epgData: EPGEntry[] | null,
    callback?: ((chId: number) => void) | (() => void)
): void {
    // Legacy always updates channels[id] even when epgData is null/empty, and sets
    // time_request=now+3600 on miss so updateChannelInfo → getCurProgData cannot
    // re-queue forever (sync getChannelEpg(null) path).
    var safeChannelId = Number(channelId);
    if (!Number.isFinite(safeChannelId) || !Number.isInteger(safeChannelId))
        return;
    var hasData = Array.isArray(epgData) && epgData.length > 0;
    var nextCount =
        typeof (window as any).sNextCount === "number"
            ? (window as any).sNextCount
            : 0;
    var selection = (window as any).OttPlayCore.legacyGuideSelection(
        hasData ? epgData : [],
        Date.now() / 1000,
        nextCount
    );
    var ch = (window as any).channels
        ? (window as any).channels[safeChannelId]
        : window.channels
          ? window.channels[safeChannelId]
          : undefined;
    if (ch) {
        if (!selection.current) {
            ch.name = "";
            ch.time = 0;
            ch.time_to = 0;
            ch.descr = "";
            ch.nextpr = null;
            ch.time_request = selection.retryAt;
            if (hasData) ch.outdated = true;
        } else {
            var cur = selection.current;
            ch.name = cur.name;
            ch.time = cur.time;
            ch.time_to = cur.time_to;
            ch.descr = cur.descr || "";
            ch.time_request = 0;
            if (cur.icon !== undefined) ch.icon = cur.icon;
            ch.nextpr = selection.following;
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
export function onChannelsLoaded(): void {
    console.log("[onChanelsLoaded] cList.length=" + cList.length);
    // Dismiss the old loading dialog before playback can open a PIN or resume
    // prompt. Hiding it afterwards would close the newly created prompt.
    $("#dialogbox").hide();
    try {
        if (cList.length) {
            // Save pending provider to storage on success
            if (
                window._pendingProvId &&
                typeof window.stbSetItem === "function"
            ) {
                window.stbSetItem("ottplayprov", window._pendingProvId);
                var id = window._pendingProvId;
                var arr = window.providerIds;
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

                window._pendingProvId = "";
            }
            loadFavoritesLists();
            (window as any).__ottChannels.mount(window);
            (window as any).__ottClassicPlayback.hydrate();
            // Start playback: restore continue-watching bookmark if available.
            // If no archive/vod bookmark is offered, fall back to the normal
            // live playChannel path (live bookmarks are already encoded in
            // catIndex/primaryIndex persisted by setCurrent).
            var el = document.getElementById("launch");
            if (el) el.innerHTML += "<br/>Start playback...";
            if (!restoreContinueWatch()) {
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
    // Loading overlays can close now; keep any new playback prompt visible.
    $("#launch").hide();
    $("#buffering").hide();
    if (typeof (window as any).clearBootHide === "function")
        (window as any).clearBootHide();
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
    var name = metadataText(item.name);
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
    // Use the same clock as isCurrent (live or archive playhead). time_to
    // marks ended programmes so the current row is not also tagged past —
    // wrong past styling after EPG page-up was easy to miss when rows clipped.
    var isPast = item.time_to <= now;
    if (ch.rec && isPast)
        prefix +=
            '<div class="btn green">&nbsp;</div> ' +
            '<span class="epg-archive-tag">' +
            (w._ ? w._("Archive") : "Archive") +
            "</span> ";
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
 * - Mutates `epgListMode` flag (prevents concurrent EPG fetches).
 * - Sets `epg_ch_id`, `curEpgData`.
 * - Shows/hides #listPopUp spinner.
 * - Calls `window.getChannelEpgCached` (provider API) and `window.setCurProg` on success.
 */
export function loadEpgListData(
    mode: number,
    catIdx: number,
    chIdx: number,
    epgReturn: any,
    callback: (chId: any) => void
): void {
    var w = window as any;
    // Preserve the legacy category-selection lookup: the cache receives the
    // internal channel ID from the selected category, not its provider ch_id.
    epgListMode = mode;
    w.epgListMode = mode;
    epgreturn = epgReturn;
    w.epgreturn = epgReturn;
    w.listCatIndex = catIdx;
    w.listChannel = chIdx;

    var catList =
        cats[catsArray[catIdx]] || w.cats[w.catsArray[catIdx]] || curList || [];
    var a = catList[chIdx];
    if (mode === 0 && !(channels[a] && channels[a].rec)) return;
    if (epg_ch_id && epg_ch_id == a && curEpgData !== null) {
        callback(a);
        return;
    }
    epg_ch_id = a;
    w.epg_ch_id = a;

    if (typeof w.getChannelEpgCached !== "function") {
        epgListMode = 0;
        return;
    }
    if (mode) {
        $("#listPopUp")
            .html(
                '<div class="ott-spinner" aria-hidden="true"><span class="blob"></span><span class="blob"></span><span class="blob"></span><span class="blob"></span></div>'
            )
            .show();
    }
    w.getChannelEpgCached(a, function (id: any, data: EPGEntry[]) {
        // Legacy does not clear epgListMode here — it is the list mode
        // (by-time / alpha / records) used by renderEpgFooter + RED / setEpgTimer.
        if (!data) {
            epgListMode = 0;
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

/**
 * Check whether the currently selected channel has no EPG (empty guard).
 * Mirrors stbPlayer.js:6559-6565.
 *
 * @param catIdx - Current category index (`listCatIndex`).
 * @param chIdx  - Current channel index within the category (`listChannel`).
 * @returns `true` if the channel has no EPG (and an infoBox was shown), `false` otherwise.
 */
export function showMissingEpgNotice(catIdx: number, chIdx?: number): boolean {
    var w = window as any;
    if (
        (w.listChannel & 65536) === 65536 &&
        (w.listChannel & 65535) === chIdx &&
        w.listCatIndex === catIdx
    ) {
        if (typeof w.infoBox === "function")
            w.infoBox(w._("Channel has no EPG"));
        return true;
    }
    return false;
}

export function epgList(catIdx: number, chIdx: number, force: boolean): void {
    var w = window as any;
    epgreturn = force || false;
    w.epgreturn = epgreturn;

    if (showMissingEpgNotice(catIdx, chIdx)) return;

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

        var nowTs =
            w.playType > 0 &&
            channelId == (w.curList && w.curList[w.primaryIndex])
                ? w.playType + w.playTime
                : Math.floor(Date.now() / 1000);
        w.selIndex = epgData.findIndex(function (e) {
            return e.time_to >= nowTs && e.time <= nowTs;
        });
        if (w.selIndex === -1) w.selIndex = 0;

        // listDataArray must be replaced too — showPage prefers it over
        // listArray, and popupList leaves Menu rows there.
        w.listArray = epgData;
        w.listDataArray = epgData;
        listEpgArray = epgData;
        w.getListItem = itemEPG;
        w.getListItemFn = itemEPG;
        w.detailListAction = function () {
            if (typeof window.detailEPG === "function")
                window.detailEPG(channelId);
        };
        w.detailListActionFn = w.detailListAction;
        w.listKeyHandler = epgKeyHandler;
        w.listKeyHandlerFn = epgKeyHandler;

        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML = metadataText(
                w._("EPG and archive. Channel: ") + (ch.channel_name || "")
            );

        if (typeof renderEpgFooter === "function") renderEpgFooter();
        $("#listPopUp").hide();
        if (typeof w.showPage === "function") w.showPage();
    }

    loadEpgListData(1, catIdx, chIdx, force || false, onDataReady);
}

/**
 * Handle selection of an EPG list item.
 * - If the program is in the future or channel has no archive, show program info.
 * - If the program has archive (rec > 0), play the archive from the start time,
 *   after checking parental access.
 *
 * Side effects:
 * - Calls `window.showProgramInfo` for future/non-archive entries.
 * - Calls `ifParentalAccessChId` for locked channels.
 * - Calls `window.closeList`, `setCurrent`, `playArchive`.
 * - Sets `window.epgArray`.
 */
export function selectEpg(): void {
    var w = window as any;
    var channelId = epg_ch_id;
    var ch: Channel = channels[channelId] || ({} as Channel);
    var selectedList = w.listArray;
    var selectedIndex = w.selIndex;
    var item = selectedList[selectedIndex];
    if (!item) return;

    if (!ch.rec || item.time > Date.now() / 1000) {
        if (typeof w.showProgramInfo === "function")
            w.showProgramInfo(item.name);
        return;
    }

    var category = w.listCatIndex;
    var index = w.listChannel;
    var schedule = listEpgArray;
    var start = item.time;
    // PIN completion belongs to this choice, not whichever row is visible later.
    var accept = w.__ottClassicPlayback.guard(function (): void {
        if (
            epg_ch_id !== channelId ||
            channels[channelId] !== ch ||
            w.listArray !== selectedList ||
            w.selIndex !== selectedIndex ||
            selectedList[selectedIndex] !== item ||
            item.time !== start ||
            listEpgArray !== schedule ||
            w.listCatIndex !== category ||
            w.listChannel !== index ||
            String(
                ((w.cats || {})[(w.catsArray || [])[category]] || [])[index]
            ) !== String(channelId) ||
            !(Number(ch.rec) > 0) ||
            start > Date.now() / 1000 ||
            start <= Date.now() / 1000 - Number(ch.rec) * 3600
        )
            return;
        if (typeof w.closeList === "function") w.closeList();
        if (typeof setCurrent === "function") setCurrent(category, index, true);
        window.epgArray = schedule;
        if (typeof playArchive === "function") playArchive(start);
    });
    if (
        typeof ifParentalAccessChId === "function" &&
        ifParentalAccessChId(channelId, accept)
    )
        return;
    accept();
}

/**
 * Render the EPG list footer with button-hint icons for
 * Return, Enter, Red (Description), Green (Set timer), Yellow (TMDb).
 *
 * Side effects: Injects innerHTML into #listPodval.
 */
export function renderEpgFooter(): void {
    var w = window as any;
    var footerElement = document.getElementById("listPodval");
    if (!footerElement) return;
    // Legacy stbPlayer.js:6528-6531
    var ch = (channels[epg_ch_id] || {}) as Channel;
    var redLabel =
        epgListMode == 2
            ? ch.rec
                ? "Records"
                : "By time"
            : epgListMode
              ? "By alphabet"
              : "By time";
    var yellowExtra =
        w.sArrowFun == 2
            ? w.strLEFT
            : w.sRewFun == 1
              ? w.strRW
              : w.sPNFun == 1
                ? w.strPREV
                : "";
    var descExtra =
        w.sArrowFun == 2
            ? w.strRIGHT
            : w.sRewFun == 1
              ? w.strFF
              : w.sPNFun == 1
                ? w.strNEXT
                : "";
    footerElement.innerHTML =
        w.renderButtonHint(w.keys.RED, "", redLabel, w.strSTOP, "0") +
        w.renderButtonHint(w.keys.BLUE, "", "Category", w.strPlayPause, "1") +
        w.renderButtonHint(
            w.keys.YELLOW,
            "",
            "Channel list",
            "3",
            yellowExtra
        ) +
        w.renderButtonHint(
            w.keys.N2,
            w.strInfo,
            "Description",
            "2",
            descExtra
        ) +
        '<span id="bTimer" style="display:none;">' +
        w.renderButtonHint(w.keys.GREEN, "", "Timer", w.strTools, "8") +
        "</span>" +
        (ch.rec
            ? '<span class="epg-footer-archive">' +
              (w._
                  ? w._("Archive: ENTER on past programs")
                  : "Archive: ENTER on past programs") +
              "</span>"
            : "");
}

/**
 * Key handler for the EPG list view.
 * Keys: ENTER (play/select), RED/INFO (program info), GREEN (set timer),
 * YELLOW (TMDb search), RETURN (close list).
 *
 * @param keyCode - The pressed key code.
 * @returns `true` if the key was handled, `false` to bubble up.
 *
 * Side effects: Delegates to `selectEpg`, `setEpgTimer`, `showProgramInfo`,
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
            // Legacy: if (!epgreturn) closeList(); else channelsList(...)
            if (!w.epgreturn) {
                if (typeof w.closeList === "function") w.closeList();
            } else if (typeof w.channelsList === "function") {
                w.channelsList(w.listCatIndex, w.listChannel);
            }
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
            if (typeof w.showProgramInfo === "function")
                w.showProgramInfo(item.name);
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
            if (typeof w.showProgramInfo === "function")
                w.showProgramInfo(item.name);
            return true;
        case keys.NEXT:
            if (w.sPNFun !== 1) return false;
            if (typeof w.showProgramInfo === "function")
                w.showProgramInfo(item.name);
            return true;
        case keys.N0:
        case keys.EPG:
        case keys.STOP:
        case keys.RED:
            switch (epgListMode) {
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
            if (typeof setEpgTimer === "function") setEpgTimer();
            return true;
        case keys.INFO:
            if (typeof w.showProgramInfo === "function")
                w.showProgramInfo(item.name);
            return true;
        case keys.N5:
            searchEpgByTitle();
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
    var detailEl = w.listDetailElement || document.getElementById("listDetail");
    if (!(item && detailEl)) return;

    // Legacy stbPlayer.js:6507-6516
    detailEl.innerHTML =
        '<div id="_name"><div style="color:' +
        (w.curColor || "") +
        ';">' +
        metadataText(item.name) +
        '</div><div style="font-size:smaller;">' +
        (typeof w.formatProgramDateTime === "function"
            ? w.formatProgramDateTime(item.time)
            : formatEpgTime(item.time)) +
        " - " +
        (typeof w.time2time === "function"
            ? w.time2time(item.time_to)
            : formatEpgTime(item.time_to)) +
        " (" +
        Math.round((item.time_to - item.time) / 60) +
        " " +
        w._("min") +
        ")</div></div>" +
        '<div id="_descr" style="font-size:smaller;overflow:hidden;"><div id="_prd">' +
        (typeof w.getThumbnail === "function"
            ? w.getThumbnail(item.icon)
            : "") +
        metadataHtml(item.descr) +
        "</div></div>";

    var t = ($("#listDetail").height() || 0) - ($("#_name").height() || 0);
    $("#_descr").height(t);
    t = ($("#_prd").height() || 0) + 10 - t;
    if (typeof w.scrollUp === "function") w.scrollUp("_prd", t, 5000);
    if (item.time > Date.now() / 1000) $("#bTimer").show();
    else $("#bTimer").hide();
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
    if (!timer || typeof timer !== "object") return;
    clearTimeout(timer.ti);
    clearTimeout(timer.ri);
    delete timer.ti;
    delete timer.ri;
    var channel = Object.prototype.hasOwnProperty.call(channels, timer.ci)
        ? channels[timer.ci]
        : null;
    if (!channel || !isFinite(+timer.t)) return;
    var delay = timer.t * 1000 - Date.now();
    if (delay < 0) delay = 0;

    // A provider reload replaces channel objects. A timer reload/removal clears
    // its handle, also invalidating an already open confirmation dialog.
    var timerId: ReturnType<typeof setTimeout>;
    function isCurrent(): boolean {
        return timer.ti === timerId && channels[timer.ci] === channel;
    }
    function currentPosition(): [number, number] | null {
        var category = cats[catsArray[timer.c]];
        if (category && category[timer.i] == timer.ci)
            return [timer.c, timer.i];
        for (var c = 0; c < catsArray.length; c++) {
            category = cats[catsArray[c]];
            if (!category) continue;
            for (var i = 0; i < category.length; i++)
                if (category[i] == timer.ci) return [c, i];
        }
        return null;
    }

    var leadMs = (settings.epgRemindMinutes || 0) * 60 * 1000;
    if (leadMs > 0) {
        var remindAt = timer.t * 1000 - leadMs;
        var delayRemind = remindAt - Date.now();
        if (delayRemind < 0 && timer.t * 1000 - Date.now() > 0) delayRemind = 0;
        timer.ri = setTimeout(
            function () {
                if (!isCurrent()) return;
                if (typeof w.showShift === "function") {
                    var minutesLeft = Math.max(
                        0,
                        Math.ceil((timer.t * 1000 - Date.now()) / 60000)
                    );
                    var ch = channels[timer.ci]
                        ? channels[timer.ci].channel_name
                        : "";
                    w.showShift(
                        w._(
                            "Reminder: %1 — %2 in %3 min",
                            ch,
                            timer.n || "",
                            minutesLeft
                        )
                    );
                }
            },
            delayRemind > 0 ? delayRemind : 0
        );
    }

    timerId = timer.ti = setTimeout(function () {
        if (!isCurrent() || !currentPosition()) return;
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
                if (!isCurrent()) return;
                var position = currentPosition();
                if (!position) return;
                if (typeof w.closeList === "function") w.closeList();
                if (typeof w.playChannel === "function")
                    w.playChannel(position[0], position[1]);
            });
        }
    }, delay);
}

/**
 * Restore provider timers (with legacy STB fallback), retaining valid future
 * entries and scheduling only channels present in the current provider.
 * Saved data is not rewritten: missing channels may return on a later load.
 */
export function loadEpgTimers(): void {
    var w = window as any;
    var previousTimers = Array.isArray(epgTimers) ? epgTimers : [];
    epgTimers = [];
    previousTimers.forEach(function (timer) {
        if (!timer || typeof timer !== "object") return;
        clearTimeout(timer.ti);
        clearTimeout(timer.ri);
        delete timer.ti;
        delete timer.ri;
    });
    try {
        var data =
            typeof w.providerGetItem === "function"
                ? w.providerGetItem("epgTimers")
                : null;
        if (data == null && typeof w.stbGetItem === "function")
            data = w.stbGetItem("epgTimers");
        if (data) {
            var parsed = JSON.parse(data);
            if (!Array.isArray(parsed)) return;
            var now = Date.now() / 1000;
            epgTimers = parsed.filter(function (t) {
                return (
                    t &&
                    typeof t === "object" &&
                    (typeof t.ci === "number" || typeof t.ci === "string") &&
                    (typeof t.t === "number" || typeof t.t === "string") &&
                    isFinite(+t.t) &&
                    +t.t > now
                );
            });
            epgTimers.forEach(function (timer) {
                // Legacy saves included runtime handles. They belong to the
                // previous page instance and must never cancel current work.
                delete timer.ti;
                delete timer.ri;
                startEpgTimer(timer);
            });
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
export function setEpgTimer(_channelId?: any, _time?: number): void {
    var w = window as any;
    // Legacy stbPlayer.js:3735-3760 — uses list selection + epgListMode mode
    var item = w.listArray[w.selIndex];
    if (!w.epgListMode || !item || item.time < Date.now() / 1000) return;

    var idx = epgTimers.findIndex(function (t) {
        return t.ci == w.epg_ch_id && t.t == item.time;
    });
    var msg = idx === -1 ? "Set timer?" : "Remove timer?";

    if (typeof w.confirmBox !== "function") return;
    w.confirmBox(w._(msg), function () {
        if (idx === -1) {
            var timer = {
                c: w.listCatIndex,
                ci: w.epg_ch_id,
                i: w.listChannel,
                n: item.name,
                t: item.time,
                te: item.time_to,
            };
            startEpgTimer(timer);
            epgTimers.push(timer);
        } else {
            clearTimeout(epgTimers[idx].ti);
            clearTimeout(epgTimers[idx].ri);
            delete epgTimers[idx].ti;
            delete epgTimers[idx].ri;
            epgTimers.splice(idx, 1);
        }
        if (typeof w.showPage === "function") w.showPage();
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
        if (typeof w.providerSetItem === "function")
            w.providerSetItem("epgTimers", JSON.stringify(cleanTimers));
        else if (typeof w.stbSetItem === "function")
            w.stbSetItem("epgTimers", JSON.stringify(cleanTimers));
    });
}

/**
 * Alphabetical EPG list (mode=2). vs gold stbPlayer.js:6602.
 * Not an alias — delegates to loadEpgListData(2, ...) then sorts by name.
 *
 * @param catIdx - Category index.
 * @param chIdx  - Channel index within the category.
 * @param force  - If true, forces EPG refresh.
 *
 * Side effects: Same as loadEpgListData + sets listArray/listDataArray/listKeyHandler.
 */
export function epgListAlpha(
    catIdx: number | EPGEntry[],
    chIdx?: number,
    force?: boolean
): void {
    // Legacy stbPlayer.js:6602-6638 — alphabetical EPG list
    if (typeof catIdx !== "number") return;
    var w = window as any;
    if (showMissingEpgNotice(catIdx, chIdx)) return;

    function onDataReady(channelId: any): void {
        var byTime: EPGEntry[] = [];
        var byName: EPGEntry[] = [];
        var ch = (channels[channelId] || {}) as Channel;
        if (curEpgData !== null && curEpgData.length) {
            byTime = curEpgData
                .filter(function (e) {
                    return ch.rec
                        ? e.time > Date.now() / 1000 - ch.rec * 3600
                        : e.time_to > Date.now() / 1000 - 7200;
                })
                .sort(function (a, b) {
                    return a.time - b.time;
                });
            byName = curEpgData
                .filter(function (e) {
                    return ch.rec
                        ? e.time > Date.now() / 1000 - ch.rec * 3600
                        : e.time_to > Date.now() / 1000;
                })
                .sort(function (a, b) {
                    return a.name < b.name
                        ? -1
                        : a.name > b.name
                          ? 1
                          : a.time - b.time;
                });
        }
        var nowTs =
            w.playType > 0 &&
            channelId == (w.curList && w.curList[w.primaryIndex])
                ? w.playType + w.playTime
                : Math.floor(Date.now() / 1000);
        w.selIndex = byName.findIndex(function (e) {
            return e.time_to >= nowTs && e.time <= nowTs;
        });
        if (w.selIndex === -1) w.selIndex = 0;
        w.listArray = byName;
        w.listDataArray = byName;
        listEpgArray = byTime;
        w.getListItem = itemEPG;
        w.getListItemFn = itemEPG;
        w.detailListAction = function () {
            if (typeof window.detailEPG === "function")
                window.detailEPG(channelId);
        };
        w.detailListActionFn = w.detailListAction;
        w.listKeyHandler = epgKeyHandler;
        w.listKeyHandlerFn = epgKeyHandler;
        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML = metadataText(
                w._("EPG and archive. Channel: ") + (ch.channel_name || "")
            );
        if (typeof renderEpgFooter === "function") renderEpgFooter();
        $("#listPopUp").hide();
        if (typeof w.showPage === "function") w.showPage();
    }
    loadEpgListData(2, catIdx, chIdx as number, force || false, onDataReady);
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
    if (showMissingEpgNotice(catIdx, chIdx)) return;

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
        w.listDataArray = r;
        listEpgArray = e;
        var itemRec = function (item: any, _idx: number) {
            return "&nbsp;&nbsp;" + metadataText(item && item.name);
        };
        w.getListItem = itemRec;
        w.getListItemFn = itemRec;
        w.detailListAction = function () {
            if (typeof w.detailEPG === "function") w.detailEPG(channelId);
        };
        w.detailListActionFn = w.detailListAction;
        w.listKeyHandler = epgKeyHandler;
        w.listKeyHandlerFn = epgKeyHandler;
        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML = metadataText(
                w._("Archive. Channel: ") + (ch.channel_name || "")
            );
        if (typeof renderEpgFooter === "function") renderEpgFooter();
        $("#listPopUp").hide();
        if (typeof w.showPage === "function") w.showPage();
    }
    loadEpgListData(0, catIdx, chIdx, epgReturn, onDataReady);
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
        w.listDataArray = data;
        mediaRecords = data;
        var itemFn = function (item: any, _idx: number) {
            return "&nbsp;&nbsp;" + metadataText(item.name || item.title);
        };
        w.getListItem = itemFn;
        w.getListItemFn = itemFn;
        w.detailListAction = detailREC;
        w.detailListActionFn = detailREC;
        w.listKeyHandler = mediaKeyHandler;
        w.listKeyHandlerFn = mediaKeyHandler;

        var captionEl = document.getElementById("listCaption");
        if (captionEl)
            captionEl.innerHTML = metadataText(
                w._("Records for channel: ") + (ch.channel_name || "")
            );

        var footerElement = document.getElementById("listPodval");
        if (footerElement) {
            footerElement.innerHTML = w.renderButtonHint(
                w.keys.RETURN,
                w.strRETURN,
                "Close"
            );
        }

        if (typeof w.showPage === "function") w.showPage();
    }, providerChId);
}

// The legacy bundle links this renderer from ui/index.ts.
declare function showMediaList1(): void;

/** Keep the last accepted view separate from globals mutated by provider callbacks. */
export function rememberMediaView(_pending = false): void {}

/** Closing/reloading while fetching must not reopen a departed VOD view. */
export function cancelMediaLoad(): void {
    var w = window as any;
    if (w.__ottMedia) w.__ottMedia.cancel();
    else if (w.providerMediaClient) w.providerMediaClient.cancel();
}

/** Providers write mediaRecords/mediaName before their no-argument completion callback. */
export function requestMediaList(target: MediaTarget): void {
    (window as any).__ottMedia.open(target);
}

/** Return to the parent VOD folder, retaining its selected row. */
function mediaBack(): void {
    (window as any).__ottMedia.back();
}

/** Route remote buttons within VOD, including parent-folder navigation. */
export function mediaKeyHandler(keyCode: number): boolean {
    var w = window as any;
    var keys = w.keys;
    var item: MediaHistoryEntry | undefined = w.listArray[w.selIndex];
    function forward(): void {
        if (item && item.playlist_url) selectMedia(w.selIndex);
        else if (typeof w.infoMedia === "function") w.infoMedia();
    }
    if (w.sArrowFun === 2) {
        switch (keyCode) {
            case keys.LEFT:
                mediaBack();
                return true;
            case keys.RIGHT:
                forward();
                return true;
            case keys.RETURN:
                w.closeList();
                return true;
        }
    }
    switch (keyCode) {
        case keys.RETURN:
            mediaBack();
            return true;
        case keys.N0:
        case keys.RED:
        case keys.PRECH:
        case keys.EXIT:
            w.closeList();
            return true;
        case keys.ENTER:
            selectMedia(w.selIndex);
            return true;
        case keys.N2:
        case keys.INFO:
            if (typeof w.infoMedia === "function") w.infoMedia();
            return true;
        case keys.RW:
            if (w.sRewFun !== 1) return false;
            mediaBack();
            return true;
        case keys.PREV:
            if (w.sPNFun !== 1) return false;
            mediaBack();
            return true;
        case keys.FF:
            if (w.sRewFun !== 1) return false;
            forward();
            return true;
        case keys.NEXT:
            if (w.sPNFun !== 1) return false;
            forward();
            return true;
        case keys.N8:
        case keys.TOOLS:
        case keys.GREEN:
            if (
                w.sFavorites !== -1 &&
                w.__ottMedia.snapshot().frames.length > 1 &&
                item
            )
                addToMedFavorites(item);
            return true;
        case keys.YELLOW:
            if (
                item &&
                hasTmdbService() &&
                w.TMDb &&
                typeof w.TMDb.search === "function"
            )
                w.TMDb.search(item.title || item.name || "");
            return true;
    }
    return false;
}

/** Add the selected movie/folder, or delete it while viewing favorites. */
export function addToMedFavorites(item: MediaHistoryEntry): void {
    (window as any).__ottMedia.favorite(item);
}

/** Select a media entry using the provider's VOD hierarchy and PIN contract. */
export function selectMedia(index?: number): void {
    var w = window as any;
    w.__ottMedia.select(index === undefined ? w.selIndex : index);
}

/** Provider completion callback: render populated mediaRecords without refetching. */
export function showMediaList(): void {
    (window as any).__ottMedia.show();
}

/** Descriptions may be lazy functions in legacy provider records. */
export function getMediaDescr(item?: MediaHistoryEntry): string {
    var text = (item && (item.description || item.descr)) || "";
    if (typeof text === "function") text = text();
    return metadataHtml(text);
}

/** Decode the classic entrypoint; archive decisions belong to its controller. */
export function playArchive(epoch: number): void {
    (window as any).__ottClassicArchive.open(epoch);
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
 * - Calls `window.updateChannelInfo` to refresh the OSD.
 * - Calls `getChannelEpgCached` if seek crossed the EPG program window.
 */
export function updateArchiveInfo(position: number): void {
    (window as any).__ottClassicArchive.update(position);
}

/** Render the coordinator's immutable selection; rendering never requests media or EPG. */
function renderArchiveInfo(model: ArchiveView): void {
    var position = model.position;
    archivePos = position;
    var w = window as any;
    var channelId = model.context.host.id;
    epgArray = model.rows.map(function (row): EPGEntry {
        return row.payload;
    });
    curProg = model.current ? model.rows.indexOf(model.current) : -1;
    var prog: EPGEntry = model.current
        ? model.current.payload
        : {
              descr: "",
              name: "",
              time: model.window.start,
              time_to: model.window.end,
          };
    playType = w.playType;
    playTime = w.playTime;

    // Update channel header info
    var chEl = document.getElementById("channel_name");
    if (chEl && channels[channelId]) {
        chEl.textContent = channels[channelId].channel_name || "";
    }
    var piconEl = document.getElementById("picon");
    if (piconEl && typeof w.getChannelPicon === "function") {
        piconEl.style.backgroundImage =
            'url("' + metadataCssUrl(w.getChannelPicon(channelId)) + '")';
    }
    var chNumEl = document.getElementById("channel_number");
    if (chNumEl) chNumEl.innerHTML = "" + (primaryIndex + 1);

    _prog100 = prog;
    w._prog100 = prog;

    // Program name
    var progNameEl = document.getElementById("programm_name");
    if (progNameEl) progNameEl.textContent = prog ? prog.name : "";
    var progName2El = document.getElementById("programm_name2");
    if (progName2El) progName2El.textContent = prog ? prog.name : "";

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
    // Inline formatProgramDateTime — not re-exported from utils/helpers
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
        descrEl.innerHTML = thumb + metadataHtml(prog.descr);
    } else if (descrEl) {
        descrEl.innerHTML = "";
    }

    // The controller supplies the next programme independently of array indices.
    var nextProg = model.next ? model.next.payload : null;
    var nextProgramNameElement = document.getElementById("nprogramm_name");
    var nbeginTimeEl = document.getElementById("nbegin_time");
    var nendTimeEl = document.getElementById("nend_time");
    if (nextProg) {
        if (nextProgramNameElement)
            nextProgramNameElement.textContent = nextProg.name;
        if (nbeginTimeEl) nbeginTimeEl.textContent = time2time(nextProg.time);
        if (nendTimeEl)
            nendTimeEl.textContent =
                "" + Math.round((nextProg.time_to - nextProg.time) / 60);
    } else {
        if (nextProgramNameElement) nextProgramNameElement.innerHTML = "  ";
        if (nbeginTimeEl) nbeginTimeEl.textContent = "";
        if (nendTimeEl) nendTimeEl.textContent = "";
    }

    if (w.sInfoChange && model.changed && !$("#info1").is(":visible")) {
        w.showChannelInfo(1);
    }
}
if (typeof window !== "undefined")
    (window as any).__ottRenderArchive = renderArchiveInfo;

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
    (window as any).__ottClassicArchive.pauseLive();
}

/** Decode the existing remote action at the compatibility boundary. */
export function shiftArchive(delta: number): void {
    (window as any).__ottClassicPlayback.shift(delta);
}

/**
 * Format a shift delta (seconds) as a localized ">> mm:ss / << mm:ss" string.
 *
 * @param e - Delta in seconds.
 * Side effects: Reads global window._ for localization.
 */
function formatSeekOffset(e: number): string {
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
    var context = w.__ottClassicPlayback.context();
    var finished = false;
    var revision = 0;
    var submit = w.__ottClassicPlayback.guard(function (): void {
        shiftArchive(i);
    });
    function finish(apply: boolean): void {
        if (finished) return;
        finished = true;
        revision++;
        clearTimeout(t);
        // A retired dialog cannot seek or hide a replacement dialog.
        if (w.dialogBoxKeyHandler !== handler || !context.isCurrent()) return;
        $("#dialogbox").hide();
        if (w.tooltip) w.tooltip.style.display = "";
        if (apply) submit();
        else if (typeof w.infoBarHide === "function") w.infoBarHide();
        if (w.dialogBoxKeyHandler === handler) w.dialogBoxKeyHandler = null;
    }
    function r(delta: number): void {
        if (finished || w.dialogBoxKeyHandler !== handler) return;
        clearTimeout(t);
        i += delta;
        var stepEl = document.getElementById("step");
        if (stepEl && typeof w.formatSeekOffset === "function")
            stepEl.innerHTML = w.formatSeekOffset(i);
        var expected = ++revision;
        t = setTimeout(function () {
            if (expected === revision) finish(true);
        }, 3000);
    }
    var renderButtonHint = w.renderButtonHint;
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
                (typeof renderButtonHint === "function"
                    ? renderButtonHint(keys.ENTER, w.strENTER, "Go to") +
                      renderButtonHint(keys.RETURN, w.strRETURN, "Close")
                    : "")
        )
        .show();
    if (w.sInfoRew && typeof w.showChannelInfo === "function")
        w.showChannelInfo(1);
    var handler = function (e: number): void {
        if (finished || w.dialogBoxKeyHandler !== handler) return;
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
                finish(false);
                return;
            case keys.ENTER:
                finish(true);
                return;
            default:
                return;
        }
    };
    w.dialogBoxKeyHandler = handler;
    r(initialDelta);
}

export function timeShift(offset: number): void {
    (window as any).__ottClassicArchive.rewind(offset);
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
/**
 * Index of the currently playing channel inside category `catIdx`, or 0.
 * Used when opening a category so Category: All highlights the live channel
 * instead of row 0 (invisible / wrong cursor).
 */
function playingChannelIdxInCategory(catIdx: number): number {
    try {
        var list = (cats && catsArray && cats[catsArray[catIdx]]) || [];
        if (!list.length) return 0;
        if (
            catIdx === catIndex &&
            typeof primaryIndex === "number" &&
            primaryIndex >= 0 &&
            primaryIndex < list.length
        ) {
            return primaryIndex;
        }
        var curList = (cats && catsArray && cats[catsArray[catIndex]]) || [];
        var curId = curList[primaryIndex];
        if (curId != null) {
            var i = list.indexOf(curId);
            if (i >= 0) return i;
        }
    } catch (_e) {}
    return 0;
}

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
            metadataText(item)
        );
    };

    var detailEl = document.getElementById("listDetail");
    if (detailEl) detailEl.innerHTML = "";

    w.detailListActionFn = function () {};
    w.listKeyHandlerFn = bucketsKeyHandler;

    var captionEl = document.getElementById("listCaption");
    if (captionEl) captionEl.innerHTML = w._("Category selection");

    var footerElement = document.getElementById("listPodval");
    if (footerElement) {
        var html = w.renderButtonHint(
            w.keys.RED,
            "",
            w._(w.strPlayPause || strPlayPause),
            w.strPRECH
        );
        if (!sFavorites) {
            html += w.renderButtonHint(w.keys.YELLOW, "", w._(w.strTools), "0");
        }
        footerElement.innerHTML = html;
    }

    if (!sFavorites) {
        var popupHtml =
            w.renderButtonHint(w.keys.N1, "1", w._("Move category up")) +
            "<br/>" +
            w.renderButtonHint(w.keys.N7, "7", w._("Move category down")) +
            "<br/>" +
            w.renderButtonHint(w.keys.N3, "3", w._("Create category")) +
            "<br/>" +
            w.renderButtonHint(w.keys.N6, "6", w._("Rename category")) +
            "<br/>" +
            w.renderButtonHint(w.keys.N9, "9", w._("Copy category")) +
            "<br/>" +
            w.renderButtonHint(w.keys.N8, "8", w._("Delete category"));
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
                    if (!w.__ottChannels.change("create", name)) return true;
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
                    if (
                        !w.__ottChannels.change(
                            "rename",
                            w.__ottChannels.group(w.selIndex),
                            newName
                        )
                    )
                        return true;
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
                    if (
                        !w.__ottChannels.change(
                            "create",
                            copyName,
                            w.__ottChannels.group(w.selIndex)
                        )
                    )
                        return true;
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
                    if (
                        !w.__ottChannels.change(
                            "remove",
                            w.__ottChannels.group(w.selIndex)
                        )
                    )
                        return true;
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
                w.channelsList(idx, playingChannelIdxInCategory(idx));
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
                w.channelsList(
                    w.selIndex,
                    playingChannelIdxInCategory(w.selIndex)
                );
            }
            return true;

        case keys.FF:
        case keys.NEXT: {
            var nextCat =
                w.selIndex < catsArray.length - 1 ? w.selIndex + 1 : 0;
            if (typeof w.channelsList === "function") {
                w.channelsList(nextCat, playingChannelIdxInCategory(nextCat));
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
 * listKeyHandler for the search view, updates listCaption/listFooter and
 * re-renders via showPage().
 *
 * Side effects:
 *  - Writes "chSearch" to stb storage on submit.
 *  - Mutates global listArray, listKeyHandler, listCaption, listFooter.
 *  - Hides #listPopUp.
 *
 * The installed listKeyHandler mirrors the original: YELLOW/TOOLS/N0
 * retrigger this function; ENTER plays the selected channel via
 * playChannel; GREEN/PLAY/PAUSE/N3 calls addChannel2bucket; RETURN/RW/PREV
 * (and LEFT when sArrowFun===2) returns to the unfiltered channelsList
 * preserving the prior position (listChannel).
 */
/**
 * Search EPG programmes by title across the in-memory `epg` cache
 * (per-channel programmes already fetched by getChannelEpgCached).
 * No network fetch — only the loaded window is searched.
 *
 * Flow:
 * 1. Prompt via the same `showEditKey` UX as searchChannel (caption "Search programme").
 * 2. Filter `epg[ch_id]` entries by case-insensitive substring on `name`.
 * 3. Render results as a list with `channel_name + programme + time`.
 * 4. ENTER on a result → open EPG for that channel and select the programme.
 *
 * Side effects:
 * - Mutates `window.editCaption`, `window.editvar`, `window.setEdit`,
 *   `window.listArray`, `window.listDataArray`, `window.listKeyHandlerFn`,
 *   `window.getListItemFn`, `window.selIndex`, `_crData.selIndex`.
 * - Reads/writes `epgSearch` via stbGetItem/stbSetItem.
 * - Updates #listCaption and #listPodval innerHTML; hides #listPopUp.
 * - Calls `window.showPage` and `window.showShift`.
 */
export function searchEpgByTitle(): void {
    var w = window as any;
    $("#listPopUp").hide();

    function runSearch(query: string): void {
        var q = (query || "").toLowerCase();
        if (!q) {
            if (typeof w.showShift === "function")
                w.showShift(w._("Not found"));
            return;
        }
        var results: any[] = [];
        var chIds = Object.keys(epg);
        for (var i = 0; i < chIds.length; i++) {
            var chId = Number(chIds[i]);
            var progs = epg[chId];
            if (!progs || !progs.length) continue;
            for (var j = 0; j < progs.length; j++) {
                var p = progs[j];
                if (p && p.name && p.name.toLowerCase().indexOf(q) !== -1) {
                    var ch = channels[chId] || ({} as Channel);
                    results.push({
                        ch_id: chId,
                        ch_name: ch.channel_name || ch.name || "",
                        name: p.name,
                        rec: ch.rec || 0,
                        time: p.time,
                        time_to: p.time_to,
                    });
                }
            }
        }
        results.sort(function (a, b) {
            return a.time - b.time;
        });

        if (!results.length) {
            if (typeof w.showShift === "function")
                w.showShift(w._("Not found"));
            return;
        }

        var caption =
            w._("Search programme") +
            ':"' +
            query +
            '" (' +
            results.length +
            ")";

        function renderItem(item: any, _idx: number): string {
            return (
                "&nbsp;&nbsp;" +
                (channels[item.ch_id] &&
                channels[item.ch_id].rec &&
                item.time < Date.now() / 1000
                    ? '<div class="btn green">&nbsp;</div> '
                    : "") +
                formatEpgTime(item.time) +
                " - " +
                formatEpgTime(item.time_to) +
                " " +
                (item.ch_name ? "[" + metadataText(item.ch_name) + "] " : "") +
                metadataText(item.name)
            );
        }

        function openForChannel(item: any): void {
            // Find the (catIndex, primaryIndex) of item.ch_id across catsArray
            var catIdx = -1;
            var primaryIndex = -1;
            for (var ci = 0; ci < catsArray.length; ci++) {
                var list = cats[catsArray[ci]] || [];
                var pi = list.indexOf(item.ch_id);
                if (pi !== -1) {
                    catIdx = ci;
                    primaryIndex = pi;
                    break;
                }
            }
            if (catIdx === -1) return;
            if (typeof setCurrent === "function")
                setCurrent(catIdx, primaryIndex, true);
            epg_ch_id = item.ch_id;
            w.epg_ch_id = item.ch_id;
            if (typeof epgList === "function")
                epgList(catIdx, primaryIndex, false);
            setTimeout(function () {
                var idx = -1;
                var arr = (w.listArray as any[]) || [];
                for (var k = 0; k < arr.length; k++) {
                    if (
                        arr[k] &&
                        arr[k].time === item.time &&
                        arr[k].name === item.name
                    ) {
                        idx = k;
                        break;
                    }
                }
                if (idx !== -1) {
                    w.selIndex = idx;
                    if (typeof w.showPage === "function") w.showPage();
                    if (typeof selectEpg === "function") selectEpg();
                }
            }, 50);
        }

        w.listArray = results;
        w.listDataArray = results;
        w.selIndex = 0;
        w.getListItem = renderItem;
        w.getListItemFn = renderItem;
        w.detailListAction = function (): void {};
        w.detailListActionFn = w.detailListAction;
        w.listKeyHandler = function (k: number): boolean {
            if (k === w.keys.EXIT || k === w.keys.RETURN) {
                if (typeof w.closeList === "function") w.closeList();
                return true;
            }
            if (k === w.keys.ENTER) {
                var sel = (w.listArray as any[])[w.selIndex];
                if (sel) openForChannel(sel);
                return true;
            }
            return false;
        };
        w.listKeyHandlerFn = w.listKeyHandler;

        var captionEl = document.getElementById("listCaption");
        if (captionEl) captionEl.textContent = caption;

        var footerElement = document.getElementById("listPodval");
        if (footerElement) {
            footerElement.innerHTML =
                (typeof w.renderButtonHint === "function"
                    ? w.renderButtonHint(
                          w.keys.RETURN,
                          w.strRETURN,
                          "Close",
                          ""
                      )
                    : "") +
                (typeof w.renderButtonHint === "function"
                    ? w.renderButtonHint(w.keys.ENTER, "", "Open", "")
                    : "");
        }

        if (typeof w.showPage === "function") w.showPage();
    }

    var editCaption = w._("Search programme");
    var saved =
        typeof w.stbGetItem === "function"
            ? w.stbGetItem("epgSearch") || ""
            : "";
    var editvar = saved;
    var setEdit = function (): void {
        var inputEl = document.getElementById("editvar");
        var inputVal = (inputEl && (inputEl as HTMLInputElement).value) || "";
        var submitted = window.editvar || "";
        if (!inputVal && !submitted) return;
        saved = inputVal || submitted;
        window.editvar = saved;
        if (typeof w.stbSetItem === "function")
            w.stbSetItem("epgSearch", saved);
        runSearch(saved);
    };
    w.editCaption = editCaption;
    w.editvar = editvar;
    w.setEdit = setEdit;
    if (typeof w.showEditKey === "function") w.showEditKey();
}

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
                        if (typeof w.updateChannelInfo === "function")
                            w.updateChannelInfo(t);
                        if (
                            w.sInfoSwitch &&
                            typeof w.showChannelInfo === "function"
                        )
                            w.showChannelInfo(1);
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
                            typeof w.showProgramInfo === "function"
                        )
                            w.showProgramInfo(r.name);
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
                            typeof w.showProgramInfo === "function"
                        )
                            w.showProgramInfo(r.name);
                        return true;
                    case w.keys.NEXT:
                        if (w.sPNFun != 1) return false;
                        r = channels[w.listArray[w.selIndex]];
                        if (
                            r !== undefined &&
                            typeof w.showProgramInfo === "function"
                        )
                            w.showProgramInfo(r.name);
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
            var footerElement = document.getElementById("listPodval");
            if (footerElement) {
                footerElement.innerHTML =
                    (typeof w.renderButtonHint === "function"
                        ? w.renderButtonHint(
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
                    (typeof w.renderButtonHint === "function"
                        ? w.renderButtonHint(
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
                    (typeof w.renderButtonHint === "function"
                        ? w.renderButtonHint(
                              w.keys.YELLOW,
                              "",
                              "Search",
                              w.strTools,
                              "0"
                          )
                        : "") +
                    (typeof w.renderButtonHint === "function"
                        ? w.renderButtonHint(
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
        (typeof w.renderButtonHint === "function"
            ? w.renderButtonHint(
                  w.keys.UP,
                  w.strUP,
                  t ? "<br>Up<br>" : "<br><br>"
              )
            : "") +
        "</td><td></td></tr>" +
        "<tr>" +
        e +
        (typeof w.renderButtonHint === "function"
            ? w.renderButtonHint(
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
        (typeof w.renderButtonHint === "function"
            ? w.renderButtonHint(
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
        (typeof w.renderButtonHint === "function"
            ? w.renderButtonHint(
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
        (typeof w.renderButtonHint === "function"
            ? w.renderButtonHint(
                  w.keys.DOWN,
                  w.strDOWN,
                  t ? "<br>Down<br>" : "<br><br>"
              )
            : "") +
        "</td><td></td></tr>" +
        "</table>" +
        (typeof w.renderButtonHint === "function"
            ? w.renderButtonHint(w.keys.RETURN, w.strRETURN, "Close")
            : "") +
        (typeof w.renderButtonHint === "function"
            ? w.renderButtonHint(w.keys.YELLOW, "", "Search", w.strTools)
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
/* searchHistoryChannel / getFilteredHistory / getFilteredChannelList: ./search.ts */

export function searchMedia(e: MediaHistoryEntry): void {
    var w = window as any;
    if (typeof e.playlist_url !== "string") return;
    var target = e.playlist_url;
    var sourceList = w.listArray;
    var admitted = w.__ottMedia.capture();
    w.editCaption = w._("String for search");
    var t =
        (typeof w.stbGetItem === "function" ? w.stbGetItem("medSearch") : "") ||
        "";
    w.editvar = t;
    w.setEdit = function (): void {
        if (w.listArray !== sourceList || !admitted()) return;
        var inputEl = document.getElementById("editvar");
        var inputVal = (inputEl && (inputEl as HTMLInputElement).value) || "";
        var submitted = window.editvar || "";
        if (!inputVal && !submitted) return;
        t = inputVal || submitted;
        if (typeof w.stbSetItem === "function") w.stbSetItem("medSearch", t);

        if (typeof w.mediaList === "function") {
            w.__ottMedia.open(
                target +
                    (target.indexOf("?") === -1 ? "?" : "&") +
                    "search=" +
                    encodeURIComponent(t),
                e.title
            );
        }
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
 * Special case: when playType is negative (media mode) and the array is for aspects or zooms,
 * returns the fixed key "-1media".
 *
 * @param arrayName - The name of the array being accessed (used for media-mode logic).
 * @returns String key for the current channel, or null if unavailable.
 */
function channelPreferenceTarget(arrayName: string): number | null | undefined {
    if (playType < 0)
        return arrayName === "aAspects" || arrayName === "aZooms"
            ? null
            : undefined;
    return curList[primaryIndex];
}

export function getChannelPreference(arrayName: string): number {
    var target = channelPreferenceTarget(arrayName);
    if (target === undefined) return 0;
    var value = (window as any).__ottChannels.preference(arrayName, target);
    return value === undefined ? 0 : value;
}

export function applyChannelPreference(
    arrayName: string,
    callback: (value: number) => void
): void {
    if (typeof callback !== "function") return;
    var target = channelPreferenceTarget(arrayName);
    if (target === undefined) return;
    var value = (window as any).__ottChannels.preference(arrayName, target);
    if (
        value === undefined &&
        arrayName !== "aAspects" &&
        arrayName !== "aZooms"
    )
        return;
    try {
        callback(value === undefined ? 0 : value);
    } catch (error) {
        console.error(error);
    }
}

export function saveChannelPreference(
    arrayName: string,
    value: number | undefined | null
): void {
    var target = channelPreferenceTarget(arrayName);
    if (target !== undefined)
        (window as any).__ottChannels.setPreference(arrayName, target, value);
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
 * showActionsDialog, showProgramInfo, moveChannel, deleteChannel, etc.
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
                    if (typeof window.updateChannelInfo === "function") {
                        window.updateChannelInfo(chId);
                    }
                    if (
                        typeof window.showChannelInfo === "function" &&
                        window.sInfoSwitch
                    ) {
                        window.showChannelInfo(window.settings.infoTimeout);
                    }
                    window.playType = 0;
                }
            }
            return true;
        }

        case keys.N5:
        case keys.STOP:
        case keys.PIP:
            if (typeof window.playPipChannel === "function")
                window.playPipChannel(
                    window.listCatIndex,
                    window.selIndex,
                    true
                );
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
                typeof window.showProgramInfo === "function"
            ) {
                window.showProgramInfo(ch.name);
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
    var w = window as any;
    var selected = w.listArray && w.listArray[w.selIndex];
    var categories = w.listArray === catsArray;
    var groupId = w.__ottChannels.group(
        categories ? w.selIndex : w.listCatIndex
    );
    if (!groupId || selected === undefined) return;
    if (groupId === "system:favorites" && !categories) {
        var list = activeFavoritesList();
        var at = list.indexOf(selected);
        if (at < 0 || !list.length) return;
        list.splice(at, 1);
        list.splice(
            (at + delta + list.length + 1) % (list.length + 1),
            0,
            selected
        );
        saveChannelsCats();
    } else if (
        !w.__ottChannels.change(
            categories ? "move" : "member",
            categories
                ? groupId
                : {
                      action: "move",
                      channelId: selected,
                      delta: delta,
                      groupId: groupId,
                  },
            delta
        )
    )
        return;
    w.listArray = categories
        ? catsArray
        : cats[catsArray[w.listCatIndex]] || [];
    w.listDataArray = w.listArray;
    w.selIndex = w.listArray.indexOf(selected);
    if (typeof w.showPage === "function") w.showPage();
}

function deleteChannel(): void {
    var w = window as any;
    var selected = w.listArray && w.listArray[w.selIndex];
    var groupId = w.__ottChannels.group(w.listCatIndex);
    if (!groupId || selected === undefined) return;
    if (groupId === "system:favorites") {
        removeFromFavorites(selected);
        saveChannelsCats();
    } else if (
        !w.__ottChannels.change("member", {
            action: "remove",
            channelId: selected,
            groupId: groupId,
        })
    )
        return;
    w.listArray = cats[catsArray[w.listCatIndex]] || [];
    w.listDataArray = w.listArray;
    w.selIndex = Math.max(0, Math.min(w.selIndex, w.listArray.length - 1));
    if (typeof w.showPage === "function") w.showPage();
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
                // Native remotes use their own codes (Android digits are 7–16).
                for (var digit = 0; digit < 10; digit++) {
                    if (e === window.keys["N" + digit]) {
                        pin += digit.toString();
                        break;
                    }
                }
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
                highlight(curIdx - 1);
                return;
            case window.keys.DOWN:
                highlight(curIdx + 1);
                return;
            case window.keys.ENTER:
                if (typeof window._doKey === "function") {
                    window._doKey(window.keys["N" + curIdx]);
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
        if (!editor.active()) return;
        function finish(pin: string): void {
            var enabling = editor.get("parentPin") === "*" && pin !== "*";
            if (
                !editor.active() ||
                !editor.set("parentPin", pin) ||
                !editor.save()
            )
                return;
            if (enabling) setParentAccess(true, function () {});
            if (typeof window.showShift === "function")
                window.showShift(window._("Settings saved"));
            if (typeof window.closeList === "function") window.closeList();
            if (typeof window.optionsList === "function")
                window.optionsList(parentControlSetup);
        }
        var pin = editor.get("parentPin");
        if (
            !rows.filter(function (row: any) {
                return row.editorAction === "parentalEnabled";
            })[0].val
        ) {
            finish("*");
            return;
        }
        if (pin !== "*") {
            finish(pin);
            return;
        }
        enterPinCode(window._("Set parental code"), function (first: string) {
            if (!editor.active() || !first) return;
            enterPinCode(
                window._("Repeat parental code"),
                function (repeat: string) {
                    if (!editor.active() || !repeat) return;
                    if (repeat === first) finish(first);
                    else if (typeof window.showShift === "function")
                        window.showShift(window._("Wrong parental code !!!"));
                }
            );
        });
    }

    var yesNo = [window._("no") || "no", window._("yes") || "yes"];
    window.listArray = [
        {
            editorAction: "parentalEnabled",
            name: window._("Parental control") || "Parental control",
            val: window.parentPIN !== "*" ? 1 : 0,
            values: yesNo,
        },
        {
            name:
                window._("Protect Adult Channels") || "Protect Adult Channels",
            settingId: "psChannels",
            val: window.sPSchannels,
            values: yesNo,
        },
        {
            name: window._("Protect Settings") || "Protect Settings",
            settingId: "psOptions",
            val: window.sPSoptions,
            values: yesNo,
        },
        {
            name:
                window._("Protect Change Provider") ||
                "Protect Change Provider",
            settingId: "requirePinForProviderSelection",
            val: window.sPSprovs,
            values: yesNo,
        },
        { cur: "", name: "", val: 0, values: window.noop || [] },
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
        typeof window.findOptionIndex === "function" &&
        typeof window.showProviderSelection !== "undefined" &&
        window.findOptionIndex(window.showProviderSelection) === -1
    ) {
        window.listArray.splice(3, 1);
    }
    var rows = window.listArray;
    var editor = createSettingsEditor(window, rows);
    var captionEl = document.getElementById("listCaption");
    if (captionEl)
        captionEl.innerHTML =
            window._("Parental control") || "Parental control";
    if (typeof window._setSetup === "function") {
        window._setSetup(saveSettings, function () {
            editor.cancel();
            if (typeof window.optionsList === "function")
                window.optionsList(parentControlSetup);
        });
    }
    editor.attach();
}
