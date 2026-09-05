/**
 * Player settings — all ~100 configuration parameters.
 *
 * Loaded from persistent storage on startup (see `loadSettings`) and
 * persisted on change (see `saveSettings`). The `PlayerSettings` interface
 * defines every tunable parameter exposed to the user via the settings UI.
 */
import { storage } from "../storage/index";

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
 * @property sleepTimeout      - Inactivity sleep timer (minutes).
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
 * @property showPicon         - Show channel picon (0/1).
 * @property showName          - Show channel name (0/1).
 * @property showProgress      - Show progress bar (0/1).
 * @property showArchive       - Show archive indicator (0/1).
 * @property showScroll        - Show scrollbar (0/1).
 * @property showDescription   - Show programme description (0/1).
 * @property showProgram       - Show programme title (0/1).
 * @property preview           - Enable preview window (0/1).
 * @property nextCount         - Number of next programmes to show.
 * @property nextCountList     - Number of next programmes in list view.
 * @property favorites         - Enable favourites filtering (0/1).
 * @property permanentTime     - Always show time in OSD (0/1).
 * @property res10Resume       - Resume playback from last position (0/1).
 * @property prevCount         - Number of previous programmes shown.
 * @property medCount          - Media item count threshold.
 * @property psChannels        - Provider-switch channel mapping (0/1).
 * @property psOptions         - Provider-switch options (0/1).
 * @property psProvs           - Provider-switch provider list (0/1).
 * @property hdmiSupport       - Enable HDMI-CEC support (0/1).
 * @property autorun           - Auto-start on boot (0/1).
 * @property players           - Player type selection.
 * @property bufSize           - Buffer size in KB.
 * @property grapI             - Use graphical icons for yes/no/off (0/1).
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
    deviceUuid: string;
    editor: number;
    eFun: number;
    favorites: number;
    ffFun: number;
    fontShift: number;
    fontSize: number;
    gFun: number;
    grapI: number;
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
    psProvs: number;
    res10Resume: number;
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
    showPicon: number;
    showProgram: number;
    showProgress: number;
    showScroll: number;
    sleepTimeout: number;
    stopPlay: number;
    thumbnail: number;
    timezone: number;
    volumeStep: number;
    yFun: number;
}

/**
 * Return the factory-default `PlayerSettings` object.
 *
 * @returns A `PlayerSettings` instance with all default values.
 *
 * @remarks
 * These defaults mirror the original stbPlayer.js hard-coded values.
 */
export function defaultSettings(): PlayerSettings {
    return {
        adFun: 16,
        alFun: 14,
        arFun: 13,
        arrowFun: 0,
        auFun: 15,
        autorun: 0,
        bFun: 9,
        bufSize: 0,
        deviceUuid: "",
        editor: 0,
        eFun: 0,
        favorites: 0,
        ffFun: 19,
        fontShift: 4,
        fontSize: 4,
        gFun: 0,
        grapI: 0,
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
        psProvs: 0,
        res10Resume: 1,
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
        showPicon: 1,
        showProgram: 1,
        showProgress: 1,
        showScroll: 1,
        sleepTimeout: 0,
        stopPlay: 0,
        thumbnail: 1,
        timezone: 0,
        volumeStep: 5,
        yFun: 1,
    };
}

export let settings: PlayerSettings = defaultSettings();

/**
 * Load all settings from persistent storage into the module-level
 * `settings` object.
 *
 * @returns The populated `PlayerSettings` object (also available as the
 *          module-level `settings` export).
 *
 * @remarks
 * Each property is read via `storage.getI()` (integer) or `storage.get()`
 * (string/array) with its respective fallback default. After calling this
 * function, the shared `settings` variable is up-to-date.
 *
 * @sideEffects
 * Mutates the module-level `settings` variable.
 */
export function loadSettings(): PlayerSettings {
    const s = storage;
    settings = {
        adFun: s.getI("sADfun", 16),
        alFun: s.getI("sALfun", 14),
        arFun: s.getI("sARfun", 13),
        arrowFun: s.getI("sArrowFun", 0),
        auFun: s.getI("sAUfun", 15),
        autorun: s.getI("sAutorun", 0),
        bFun: s.getI("sBfun", 9),
        bufSize: s.getI("sBufSize", 0),
        deviceUuid: s.get("sDeviceUuid") || "",
        editor: s.getI("sEditor", 0),
        eFun: s.getI("sEfun", 0),
        favorites: s.getI("sFavorites", 0),
        ffFun: s.getI("sFFfun", 19),
        fontShift: s.getI("sFontShift", 4),
        fontSize: s.getI("sFont", 4),
        gFun: s.getI("sGfun", 0),
        grapI: s.getI("sGrapI", 0),
        hdmiSupport: s.getI("sHDMIsupport", 0),
        hideMenus: (s.get("sHideMenus") || "").split(",").filter(function (
            x: string
        ) {
            return x !== "";
        }),
        highlightColor: s.get("sSHLcolor") || "50,85",
        highlightColorB: s.get("sSHLcolorB") || "255,0",
        highlightColorSel: s.get("sSHLcolSel") || "240,25",
        infoChange: s.getI("sInfoChange", 1),
        infoRew: s.getI("sInfoRew", 1),
        infoSlide: s.getI("sInfoSlide", 1),
        infoSwitch: s.getI("sInfoSwitch", 1),
        infoTimeout: s.getI("sInfoTimeout", 5),
        listPosition: s.getI("sListPos", 0),
        localCmdUrl: s.get("sLocalCmdUrl") || "",
        medCount: s.getI("sMedCount", 2),
        nextCount: s.getI("sNextCount", 0),
        nextCountList: s.getI("sNextCountL", 1),
        nextFun: s.getI("sNEXTfun", 21),
        noColorKeys: s.getI("sNoColorKeys", 0),
        noNumbersKeys: s.getI("sNoNumbersKeys", 0),
        noSmall: s.getI("sNoSmall", 0),
        okFun: s.getI("sOkfun", 0),
        osdOpacity: s.getI("sOsdOpacity", 7),
        pageSize: s.getI("sPageSize", 25),
        parentPin: s.get("parentPIN") || "1234",
        permanentTime: s.getI("sPermanentTime", 0),
        pipPosition: s.getI("sPipPos", 0),
        pipSize: s.getI("sPipSize", 0),
        players: s.getI("sPlayers", 0),
        pnFun: s.getI("sPNFun", 0),
        prevCount: s.getI("sPrevCount", 2),
        prevFun: s.getI("sPREVfun", 20),
        preview: s.getI("sPreview", 0),
        psChannels: s.getI("sPSchannels", 1),
        psOptions: s.getI("sPSoptions", 0),
        psProvs: s.getI("sPSprovs", 0),
        res10Resume: s.getI("s10resum", 1),
        rewFun: s.getI("sRewFun", 0),
        rFun: s.getI("sRfun", 10),
        rwFun: s.getI("sRWfun", 18),
        seek13Duration: s.getI("s13dur", 15),
        seek46Duration: s.getI("s46dur", 180),
        seek79Duration: s.getI("s79dur", 600),
        showArchive: s.getI("sShowArchive", 1),
        showDescription: s.getI("sShowDescr", 1),
        showName: s.getI("sShowName", 1),
        showNumber: s.getI("sShowNum", 1),
        showPicon: s.getI("sShowPikon", 1),
        showProgram: s.getI("sShowProgram", 1),
        showProgress: s.getI("sShowProgress", 1),
        showScroll: s.getI("sShowScroll", 1),
        sleepTimeout: s.getI("sSleepTimeout", 0),
        stopPlay: s.getI("sStopPlay", 0),
        thumbnail: s.getI("sThumbnail", 1),
        timezone: s.getI("sTimezone", 0),
        volumeStep: s.getI("sVolumeStep", 5),
        yFun: s.getI("sYfun", 1),
    };
    return settings;
}

/**
 * Persist the given settings object to storage.
 *
 * @param s - A `PlayerSettings` instance whose values will be written.
 *
 * @remarks
 * Each property is written via `storage.setI()` (for integers) or
 * `storage.set()` (for strings / serialised arrays). This function
 * does NOT update the module-level `settings` variable — callers
 * typically modify `settings` then pass it here.
 *
 * @sideEffects
 * Writes every property to the underlying storage adapter.
 */
export function saveSettings(s: PlayerSettings): void {
    const store = storage;
    store.setI("sNoSmall", s.noSmall);
    store.setI("sStopPlay", s.stopPlay);
    store.setI("sPipSize", s.pipSize);
    store.setI("sPipPos", s.pipPosition);
    store.setI("sPageSize", s.pageSize);
    store.setI("sFontShift", s.fontShift);
    store.setI("sFont", s.fontSize);
    store.setI("sArrowFun", s.arrowFun);
    store.setI("sRewFun", s.rewFun);
    store.setI("sPNFun", s.pnFun);
    store.setI("sRfun", s.rFun);
    store.setI("sGfun", s.gFun);
    store.setI("sYfun", s.yFun);
    store.setI("sBfun", s.bFun);
    store.setI("sALfun", s.alFun);
    store.setI("sARfun", s.arFun);
    store.setI("sAUfun", s.auFun);
    store.setI("sADfun", s.adFun);
    store.setI("sRWfun", s.rwFun);
    store.setI("sFFfun", s.ffFun);
    store.setI("sPREVfun", s.prevFun);
    store.setI("sNEXTfun", s.nextFun);
    store.setI("sEfun", s.eFun);
    store.setI("sOkfun", s.okFun);
    store.setI("s13dur", s.seek13Duration);
    store.setI("s46dur", s.seek46Duration);
    store.setI("s79dur", s.seek79Duration);
    store.setI("sNoColorKeys", s.noColorKeys);
    store.setI("sNoNumbersKeys", s.noNumbersKeys);
    store.setI("sTimezone", s.timezone);
    store.setI("sSleepTimeout", s.sleepTimeout);
    store.setI("sVolumeStep", s.volumeStep);
    store.setI("sInfoTimeout", s.infoTimeout);
    store.setI("sInfoSlide", s.infoSlide);
    store.setI("sInfoSwitch", s.infoSwitch);
    store.setI("sInfoChange", s.infoChange);
    store.setI("sInfoRew", s.infoRew);
    store.setI("sThumbnail", s.thumbnail);
    store.setI("sOsdOpacity", s.osdOpacity);
    store.setI("sListPos", s.listPosition);
    store.setI("sEditor", s.editor);
    store.setI("sShowNum", s.showNumber);
    store.setI("sShowPikon", s.showPicon);
    store.setI("sShowName", s.showName);
    store.setI("sShowProgress", s.showProgress);
    store.setI("sShowArchive", s.showArchive);
    store.setI("sShowScroll", s.showScroll);
    store.setI("sShowDescr", s.showDescription);
    store.setI("sShowProgram", s.showProgram);
    store.setI("sPreview", s.preview);
    store.setI("sNextCount", s.nextCount);
    store.setI("sNextCountL", s.nextCountList);
    store.setI("sFavorites", s.favorites);
    store.setI("sPermanentTime", s.permanentTime);
    store.setI("s10resum", s.res10Resume);
    store.setI("sPrevCount", s.prevCount);
    store.setI("sMedCount", s.medCount);
    store.setI("sPSchannels", s.psChannels);
    store.setI("sPSoptions", s.psOptions);
    store.setI("sPSprovs", s.psProvs);
    store.setI("sHDMIsupport", s.hdmiSupport);
    store.setI("sAutorun", s.autorun);
    store.setI("sPlayers", s.players);
    store.setI("sBufSize", s.bufSize);
    store.setI("sGrapI", s.grapI);
    store.set("parentPIN", s.parentPin);
    store.set("sHideMenus", s.hideMenus.join(","));
    store.set("sSHLcolSel", s.highlightColorSel);
    store.set("sSHLcolor", s.highlightColor);
    store.set("sSHLcolorB", s.highlightColorB);
    store.set("sLocalCmdUrl", s.localCmdUrl);
    store.set("sDeviceUuid", s.deviceUuid);
}

/**
 * Export envelope version 1.
 */
export interface ExportEnvelopeV1 {
    favoritesArray: number[];
    parentalArray: number[];
    settings: PlayerSettings;
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
    const env: ExportEnvelopeV1 = {
        favoritesArray: window.providerGetJson?.("favoritesArray", []) || [],
        parentalArray: window.providerGetJson?.("parentalArray", []) || [],
        settings: settings,
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

    if (!env || env.version !== 1 || !env.settings) {
        if (onConfirm) onConfirm(false);
        return;
    }

    if (typeof window.confirmBox === "function") {
        window.confirmBox(
            "Overwrite current settings?",
            function (ok: boolean) {
                if (!ok) {
                    if (onConfirm) onConfirm(false);
                    return;
                }
                applyImport(env);
                if (onConfirm) onConfirm(true);
            }
        );
    } else {
        applyImport(env);
        if (onConfirm) onConfirm(true);
    }
}

function applyImport(env: ExportEnvelopeV1): void {
    saveSettings(env.settings);
    if (typeof window.providerSetItem === "function") {
        window.providerSetItem(
            "parentalArray",
            JSON.stringify(env.parentalArray || [])
        );
        window.providerSetItem(
            "favoritesArray",
            JSON.stringify(env.favoritesArray || [])
        );
    }
    loadSettings();
    if (typeof window.showShift === "function") {
        window.showShift("Settings imported");
    }
}
