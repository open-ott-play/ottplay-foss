/**
 * Remote control key handler — main dispatch + key function mapping.
 *
 * Ported from stbPlayer.js keyHandler, keyFun.
 */

import {
    closeFullscreen,
    isNormalScreen,
    openFullscreen,
    stbEventToKeyCode,
} from "../core";
import { translate as _ } from "../localization";
import { settings } from "../settings";

declare var listKeyHandlerFn: (key: number) => boolean;
declare var dialogBoxKeyHandler: ((key: number) => void) | null;

// Virtual keyboard state (from ui/index.ts)
declare var _keysSymbol: { s: string; a: () => void }[];
declare var _keyP: boolean;
declare var _keyE: boolean;
declare var _setLang: (e: boolean) => void;
declare var showEdit: () => void;

/* ---------------------------------------------------------------------------
 * Key codes (from stb/pc/stb.js — override per device via window.keys)
 * --------------------------------------------------------------------------- */

export var keys: Record<string, number> = {
    ASPECT: 65,
    AUDIO: 83,
    BLUE: 406,
    CH_DOWN: 189,
    CH_LIST: 0,
    CH_UP: 187,
    DOWN: 40,
    ENTER: 13,
    EPG: 0,
    EXIT: 27,
    FAVORITES: 70,
    FF: 34,
    GREEN: 404,
    INFO: 73,
    LANG: 16,
    LEFT: 37,
    MENU: 179,
    MUTE: 173,
    N0: 48,
    N1: 49,
    N2: 50,
    N3: 51,
    N4: 52,
    N5: 53,
    N6: 54,
    N7: 55,
    N8: 56,
    N9: 57,
    NEXT: 35,
    PAUSE: 19,
    PIP: 87,
    PLAY: 80,
    POWER: 81,
    PRECH: 191,
    PREV: 36,
    REC: 0,
    RED: 403,
    RETURN: 8,
    RIGHT: 39,
    RW: 33,
    SETUP: 192,
    STOP: 83,
    SUBTITLE: 76,
    TOOLS: 84,
    UP: 38,
    VOL_DOWN: 174,
    VOL_UP: 175,
    YELLOW: 405,
    ZOOM: 69,
};

/* ---------------------------------------------------------------------------
 * Mode flags
 * --------------------------------------------------------------------------- */

var isEditMode = false;
var isSelectBox = false;

/* ---------------------------------------------------------------------------
 * Main key dispatch
 * --------------------------------------------------------------------------- */

/**
 * Main entry point for keyboard and remote-control key events.
 * Routes the event through a priority chain: dialog box → about/list → edit → select box → list → main.
 *
 * @param event - The raw KeyboardEvent from the DOM or a synthetic event.
 * @returns void
 * @sideeffect Calls preventDefault/stopPropagation on the event. Sets `window.isListVisible`. Invokes page-specific handlers.
 * @analysis Falls through modes in order; once a mode handles the key, later modes are skipped. Dialog box always takes priority.
 */
export function keyHandler(event: KeyboardEvent): void {
    // If an input, textarea, or contenteditable element is focused, let browser handle the key
    const target = event.target as HTMLElement | null;
    if (
        target &&
        (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
    ) {
        return;
    }
    var keyCode = stbEventToKeyCode(event);
    if (!keyCode) return;
    if (typeof (window as any).setSleepTimeout === "function")
        (window as any).setSleepTimeout();

    /* dialog box (PIN pad, etc.) */
    try {
        if (typeof $ !== "undefined" && $("#dialogbox").is(":visible")) {
            if (typeof (window as any).dialogBoxKeyHandler === "function")
                (window as any).dialogBoxKeyHandler(keyCode);
            return;
        }
    } catch (_) {
        /* ignore */
    }

    /* listAbout — value selector (grid of options) */
    try {
        if (typeof $ !== "undefined" && $("#listAbout").is(":visible")) {
            if (
                typeof (window as any).aboutKeyHandler === "function" &&
                (window as any).aboutKeyHandler(keyCode)
            )
                return;
            switch (keyCode) {
                case (window as any).keys.ENTER:
                case (window as any).keys.EXIT:
                case (window as any).keys.RETURN:
                    $("#listAbout").text("").hide();
                    (window as any).restoreCPD();
                    (window as any).showPage();
                    return;
            }
            return;
        }
    } catch (_) {
        /* ignore */
    }

    try {
        if (typeof $ !== "undefined" && $("#listEdit").is(":visible")) {
            handleEditKey(keyCode, event);
            return;
        }
    } catch (_) {
        /* ignore */
    }
    if (isEditMode) {
        handleEditKey(keyCode, event);
        return;
    }
    if (isSelectBox) {
        handleSelectBoxKey(keyCode, event);
        return;
    }

    /* Global keys: POWER, MUTE, VOL_UP, VOL_DOWN — handled before list check (matching original) */
    switch (keyCode) {
        case keys.POWER:
            if (typeof (window as any).stbExit === "function")
                (window as any).stbExit();
            if (typeof (window as any).toggleStandby === "function")
                (window as any).toggleStandby();
            return;
        case keys.MUTE:
            if (typeof (window as any).stbToggleMute === "function")
                (window as any).stbToggleMute();
            return;
        case keys.VOL_UP:
            if (typeof (window as any).changeVolume === "function") {
                (window as any).changeVolume(settings.volumeStep);
                return;
            }
            break;
        case keys.VOL_DOWN:
            if (typeof (window as any).changeVolume === "function") {
                (window as any).changeVolume(-settings.volumeStep);
                return;
            }
            break;
    }

    if ((window as any).isListVisible) {
        console.log(
            "DBG keyHandler: list visible, keyCode=" +
                keyCode +
                " listKeyHandlerFn=" +
                typeof listKeyHandlerFn
        );
        if (handleListKey(keyCode, event)) return;
    }

    handleMainKey(keyCode, event);
}

/* ---------------------------------------------------------------------------
 * Main mode — dispatch by keyCode
 * --------------------------------------------------------------------------- */

/**
 * Handle a key event in "main" mode — the default mode when no dialog/list/edit/select-box is active.
 * Maps key codes to actions: number input, navigation, playback control, volume, color keys, etc.
 *
 * @param keyCode - The numeric key code captured from the event.
 * @param event - The original KeyboardEvent (preventDefault/stopPropagation already called).
 * @returns void
 * @sideeffect Calls any of the following on `window`: numberProg, keyFun, channelsList, infoBarHide, exitPortal,
 *             popupList, prevProg, stbPause/stbContinue, playChannel, stbToggleMute, stbSetVolume,
 *             showShift, showChanelInfo, epgList, togglePip, toggleStandby, stbExit, etc.
 *             Sets `window.isListVisible` for CH_LIST and SETUP.
 * @analysis Digits 0-9 are handled before the switch. Color keys are skipped when settings.noColorKeys is set.
 *             RETURN dispatches based on settings.eFun (0-4). The PLAY/PAUSE toggle uses stbIsPlaying().
 */
function handleMainKey(keyCode: number, event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();

    /* 0-9: channel number input and archive navigation */
    if (keyCode >= 48 && keyCode <= 57) {
        // Digit keys for archive navigation when playType > 0
        if ((window as any).playType > 0) {
            switch (keyCode) {
                case keys.N1:
                    if (typeof (window as any).shiftArchive === "function")
                        (window as any).shiftArchive(-(window as any).s13dur);
                    return;
                case keys.N3:
                    if (typeof (window as any).shiftArchive === "function")
                        (window as any).shiftArchive((window as any).s13dur);
                    return;
                case keys.N4:
                    if (typeof (window as any).shiftArchive === "function")
                        (window as any).shiftArchive(-(window as any).s46dur);
                    return;
                case keys.N6:
                    if (typeof (window as any).shiftArchive === "function")
                        (window as any).shiftArchive((window as any).s46dur);
                    return;
                case keys.N7:
                    if (typeof (window as any).shiftArchive === "function")
                        (window as any).shiftArchive(-(window as any).s79dur);
                    return;
                case keys.N9:
                    if (typeof (window as any).shiftArchive === "function")
                        (window as any).shiftArchive((window as any).s79dur);
                    return;
                case keys.N2:
                    if (typeof (window as any).keyFun === "function")
                        (window as any).keyFun(20);
                    return;
                case keys.N5:
                    if (typeof (window as any).keyFun === "function")
                        (window as any).keyFun(21);
                    return;
                case keys.N8:
                    // Map N8 to STOP
                    if (typeof (window as any).playChannel === "function") {
                        (window as any).playChannel(
                            (window as any).catIndex,
                            (window as any).primaryIndex
                        );
                    }
                    return;
                case keys.N0:
                    // fall through to number input below
                    break;
            }
        }
        // Standard number input for channel selection
        if (typeof (window as any).numberProg === "function") {
            (window as any).numberProg(keyCode - 48);
        }
        return;
    }

    switch (keyCode) {
        case keys.UP:
            keyFun(settings.auFun);
            break;
        case keys.DOWN:
            keyFun(settings.adFun);
            break;
        case keys.LEFT:
            keyFun(settings.alFun);
            break;
        case keys.RIGHT:
            keyFun(settings.arFun);
            break;
        case keys.ENTER:
            if ((window as any).playType > 0 && !settings.okFun) {
                if (typeof (window as any).epgList === "function")
                    (window as any).epgList(
                        (window as any).catIndex,
                        (window as any).primaryIndex,
                        false
                    );
                break;
            }
        // fall through to CH_LIST for live TV
        case keys.CH_LIST:
            (window as any).isListVisible = true;
            if (typeof (window as any).channelsList === "function")
                (window as any).channelsList(
                    (window as any).catIndex,
                    (window as any).primaryIndex
                );
            break;
        case keys.RETURN:
            if (
                typeof (window as any).$i1 !== "undefined" &&
                (window as any).$i1.is(":visible")
            ) {
                if (typeof (window as any).infoBarHide === "function")
                    (window as any).infoBarHide();
                break;
            }
            switch (settings.eFun) {
                case 0:
                    break;
                case 1:
                    if (typeof (window as any).exitPortal === "function")
                        (window as any).exitPortal();
                    break;
                case 2:
                    if (typeof (window as any).joyMenu === "function")
                        (window as any).joyMenu();
                    break;
                case 3:
                    if (typeof (window as any).popupList === "function")
                        (window as any).popupList();
                    break;
                case 4:
                    if (typeof (window as any).prevProg === "function")
                        (window as any).prevProg();
                    break;
            }
            break;
        case keys.EXIT:
            if (typeof (window as any).exitPortal === "function")
                (window as any).exitPortal();
            break;
        case keys.PLAY:
        case keys.PAUSE:
            if (
                typeof (window as any).stbContinue === "function" &&
                typeof (window as any).stbIsPlaying === "function"
            ) {
                if ((window as any).stbIsPlaying()) {
                    (window as any).stbPause();
                } else {
                    (window as any).stbContinue();
                }
            }
            break;
        case keys.STOP:
            if (typeof (window as any).playChannel === "function") {
                (window as any).playChannel(
                    (window as any).catIndex,
                    (window as any).primaryIndex
                );
            }
            break;
        case keys.RW:
            keyFun(settings.rewFun);
            break;
        case keys.FF:
            keyFun(settings.ffFun);
            break;
        case keys.PREV:
            keyFun(settings.prevFun);
            break;
        case keys.NEXT:
            keyFun(settings.nextFun);
            break;
        case keys.MUTE:
            if (typeof (window as any).stbToggleMute === "function")
                (window as any).stbToggleMute();
            break;
        case keys.VOL_UP: {
            var vUp =
                (typeof (window as any).stbGetVolume === "function"
                    ? (window as any).stbGetVolume()
                    : 50) + settings.volumeStep;
            if (vUp > 100) vUp = 100;
            if (typeof (window as any).stbSetVolume === "function")
                (window as any).stbSetVolume(vUp);
            if (typeof (window as any).showShift === "function")
                (window as any).showShift("Volume: " + vUp);
            break;
        }
        case keys.VOL_DOWN: {
            var vDown =
                (typeof (window as any).stbGetVolume === "function"
                    ? (window as any).stbGetVolume()
                    : 50) - settings.volumeStep;
            if (vDown < 0) vDown = 0;
            if (typeof (window as any).stbSetVolume === "function")
                (window as any).stbSetVolume(vDown);
            if (typeof (window as any).showShift === "function")
                (window as any).showShift("Volume: " + vDown);
            break;
        }
        case keys.RED:
            if (settings.noColorKeys) break;
            keyFun(settings.rFun);
            break;
        case keys.GREEN:
            if (settings.noColorKeys) break;
            keyFun(settings.gFun);
            break;
        case keys.YELLOW:
            if (settings.noColorKeys) break;
            keyFun(settings.yFun);
            break;
        case keys.BLUE:
            if (settings.noColorKeys) break;
            keyFun(settings.bFun);
            break;
        case keys.POWER:
            if (typeof (window as any).stbExit === "function")
                (window as any).stbExit();
            if (typeof (window as any).toggleStandby === "function")
                (window as any).toggleStandby();
            break;
        case keys.INFO:
            if (typeof (window as any).showChanelInfo === "function")
                (window as any).showChanelInfo(settings.infoTimeout);
            break;
        case keys.EPG:
            if (
                (window as any).playType > -1 &&
                typeof (window as any).epgList === "function"
            ) {
                (window as any).epgList(
                    (window as any).catIndex,
                    (window as any).primaryIndex,
                    false
                );
            }
            break;
        case keys.MENU:
        case keys.TOOLS:
            if (typeof (window as any).popupList === "function")
                (window as any).popupList();
            break;
        case keys.PIP:
            if (typeof (window as any).togglePip === "function")
                (window as any).togglePip();
            break;
        case keys.ASPECT:
            if (typeof (window as any).stbToggleAspectRatio === "function")
                (window as any).stbToggleAspectRatio();
            break;
        case keys.ZOOM:
            if (typeof (window as any).stbToggleZoom === "function")
                (window as any).stbToggleZoom();
            break;
        case keys.AUDIO:
            if (typeof (window as any).stbToggleAudioTrack === "function")
                (window as any).stbToggleAudioTrack();
            break;
        case keys.SUBTITLE:
            if (typeof (window as any).stbToggleSubtitle === "function")
                (window as any).stbToggleSubtitle();
            if (isNormalScreen()) openFullscreen();
            else closeFullscreen();
            break;
        case keys.SETUP:
            (window as any).isListVisible = true;
            if (typeof (window as any).optionsList === "function")
                (window as any).optionsList();
            break;
        case keys.CH_UP:
            if (typeof (window as any).plusProg === "function")
                (window as any).plusProg();
            break;
        case keys.CH_DOWN:
            if (typeof (window as any).minusProg === "function")
                (window as any).minusProg();
            break;
        case keys.LANG:
            if (!_keysSymbol[1].s) return;
            _keyP = false;
            _setLang(!_keyE);
            showEdit();
            break;
    }
}

/* ---------------------------------------------------------------------------
 * List mode
 * --------------------------------------------------------------------------- */

/**
 * Handle a key event while the channel/list overlay is visible.
 * First delegates to the page-specific `listKeyHandlerFn`, then falls back to built-in list navigation.
 *
 * @param keyCode - The numeric key code.
 * @param event - The original KeyboardEvent.
 * @returns boolean — true if the key was consumed (always true, since all keys are swallowed when list is visible).
 * @sideeffect Calls `window.changeSelect` or `window.closeList`. Prevents default and stops propagation.
 * @analysis When the list is visible, ALL keys are consumed (never fall through to main handler). ENTER is silently eaten.
 */
function handleListKey(keyCode: number, event: KeyboardEvent): boolean {
    event.preventDefault();
    event.stopPropagation();
    // Original pattern: call page-specific handler FIRST with raw keyCode (number)
    if (typeof listKeyHandlerFn === "function") {
        var handled = listKeyHandlerFn(keyCode);
        if (handled) return true;
    }
    // Fallback: common list key handling (matching original keyHandler inline code)
    switch (keyCode) {
        case keys.UP:
            if (typeof (window as any).changeSelect === "function")
                (window as any).changeSelect(-1);
            return true;
        case keys.DOWN:
            if (typeof (window as any).changeSelect === "function")
                (window as any).changeSelect(1);
            return true;
        case keys.LEFT:
            if (typeof (window as any).changeSelect === "function")
                (window as any).changeSelect(-((window as any).pageSize || 25));
            return true;
        case keys.RIGHT:
            if (typeof (window as any).changeSelect === "function")
                (window as any).changeSelect((window as any).pageSize || 25);
            return true;
        case keys.RETURN:
        case keys.EXIT:
            if (typeof (window as any).closeList === "function")
                (window as any).closeList();
            return true;
        // ENTER not handled by page-specific handler is consumed silently (matches original)
        case keys.ENTER:
            return true;
    }
    // In the original, when list is visible ALL keys are consumed (never fall through to main handler)
    return true;
}

/* ---------------------------------------------------------------------------
 * Edit mode
 * --------------------------------------------------------------------------- */

/**
 * Handle a key event while an edit field is active.
 * Physical keyboard printable characters are typed directly; backspace deletes the character before the cursor.
 * Otherwise delegates to `window.editKey(keyCode)` or handles ENTER/RETURN/EXIT natively.
 *
 * @param keyCode - The numeric key code.
 * @param event - The original KeyboardEvent (provides `.key` for physical keyboard detection).
 * @returns void
 * @sideeffect Sets `isEditMode = false`, modifies `window.editvar` and `window.editPos`, calls `window._changeEdit`,
 *             `window.setEdit`, or `window.restoreCPD`.
 * @analysis Single printable characters (event.key.length === 1) are inserted directly, bypassing `editKey`.
 *             Backspace deletes one character before the cursor position. ENTER calls setEdit; RETURN/EXIT calls restoreCPD.
 */
function handleEditKey(keyCode: number, event: KeyboardEvent): void {
    isEditMode = false;
    // Physical keyboard: type single printable characters directly
    // (bypasses editKey which uses keyCodes that collide STB remote keys)
    if (event.key && event.key.length === 1) {
        var ev = (window as any).editvar || "";
        var ep =
            (window as any).editPos !== undefined
                ? (window as any).editPos
                : ev.length;
        (window as any).editvar = ev.substr(0, ep) + event.key + ev.substr(ep);
        (window as any).editPos = ep + 1;
        if (typeof (window as any)._changeEdit === "function")
            (window as any)._changeEdit();
        return;
    }
    // Backspace on physical keyboard → delete char before cursor
    if (event.key === "Backspace") {
        var ev = (window as any).editvar || "";
        var ep =
            (window as any).editPos !== undefined
                ? (window as any).editPos
                : ev.length;
        if (ep > 0) {
            (window as any).editvar = ev.substr(0, ep - 1) + ev.substr(ep);
            (window as any).editPos = ep - 1;
            if (typeof (window as any)._changeEdit === "function")
                (window as any)._changeEdit();
        }
        return;
    }
    var editFn = (window as any).editKey;
    if (typeof editFn === "function") {
        editFn(keyCode);
        return;
    }
    if (keyCode === keys.ENTER) {
        if (typeof (window as any).setEdit === "function")
            (window as any).setEdit();
    } else if (
        (keyCode === keys.RETURN || keyCode === keys.EXIT) &&
        typeof (window as any).restoreCPD === "function"
    )
        (window as any).restoreCPD();
}

/* ---------------------------------------------------------------------------
 * Select box mode
 * --------------------------------------------------------------------------- */

/**
 * Handle a key event while a select-box (value picker) is visible.
 * Supports UP/DOWN for navigation and ENTER/RETURN/EXIT to dismiss.
 *
 * @param keyCode - The numeric key code.
 * @param event - The original KeyboardEvent.
 * @returns void
 * @sideeffect Calls `window.changeSelect(delta)`. Sets `isSelectBox = false` on confirm/cancel.
 * @analysis Only arrow keys and confirm/cancel keys are handled; all others are silently ignored.
 */
function handleSelectBoxKey(keyCode: number, event: KeyboardEvent): void {
    switch (keyCode) {
        case keys.UP:
            if (typeof (window as any).changeSelect === "function")
                (window as any).changeSelect(-1);
            break;
        case keys.DOWN:
            if (typeof (window as any).changeSelect === "function")
                (window as any).changeSelect(1);
            break;
        case keys.ENTER:
            isSelectBox = false;
            break;
        case keys.RETURN:
        case keys.EXIT:
            isSelectBox = false;
            break;
    }
}

/* ---------------------------------------------------------------------------
 * Programmatic key dispatch
 * --------------------------------------------------------------------------- */

/**
 * Programmatic key dispatch — fires a synthetic key event through the normal keyHandler pipeline.
 * Useful for calling from non-keyboard sources (clicks, touch, timers).
 *
 * @param keyCode - The numeric key code to dispatch.
 * @param event - Optional original Event (its stopPropagation is called if provided).
 * @returns void
 * @sideeffect Invokes the same handler chain as a real KeyboardEvent.
 * @analysis Creates a minimal fake event object with preventDefault/stopPropagation no-ops.
 */
export function dispatchKey(keyCode: number, event?: Event): void {
    if (event) event.stopPropagation();
    keyHandler({
        keyCode: keyCode,
        preventDefault: () => {},
        stopPropagation: () => {},
    } as any);
}

/* ---------------------------------------------------------------------------
 * Key function mapping (keyFun) — maps function number to action
 * --------------------------------------------------------------------------- */

/**
 * Map a function number (0-21) to a specific action and execute it.
 * Used by the configurable button bindings in settings (e.g. settings.rFun, settings.gFun, etc.).
 *
 * @param fn - The function index (0 through 21).
 * @returns void
 * @sideeffect Dispatches to: recordsList, popupList, prevProg, shiftArchiveSelect, showChanelInfo,
 *             toggleAspectRatio, toggleAudioTrack, togglePip, stbStopPip, bucketsList, epgList,
 *             popMedia, joyMenu, changeVolume, shiftArchive, plusProg/minusProg, toggleSubtitle,
 *             playArchive, playChannel, showShift, timeShift.
 * @analysis Functions 15/16/19/20/21 branch on playType to choose between shift-archive and live-channel actions.
 *             Function 20 handles the "restart current program" use case with boundary checking against epgArray.
 */
export function keyFun(fn: number): void {
    switch (fn) {
        case 0:
            if (
                (window as any).playType > -1 &&
                typeof (window as any).recordsList === "function"
            ) {
                (window as any).recordsList(
                    (window as any).catIndex,
                    (window as any).primaryIndex,
                    false
                );
            }
            return;
        case 1:
            if (typeof (window as any).popupList === "function")
                (window as any).popupList();
            return;
        case 2:
            if (typeof (window as any).prevProg === "function")
                (window as any).prevProg();
            return;
        case 3:
            if (typeof (window as any).shiftArchiveSelect === "function")
                (window as any).shiftArchiveSelect(0);
            return;
        case 4:
            if (typeof (window as any).showChanelInfo === "function")
                (window as any).showChanelInfo();
            return;
        case 5:
            if (typeof (window as any).toggleAspectRatio === "function")
                (window as any).toggleAspectRatio();
            return;
        case 6:
            if (typeof (window as any).toggleAudioTrack === "function")
                (window as any).toggleAudioTrack();
            return;
        case 7:
            if (typeof (window as any).togglePip === "function")
                (window as any).togglePip();
            return;
        case 8:
            (window as any).pipIndex = null;
            if (typeof (window as any).stbStopPip === "function")
                (window as any).stbStopPip();
            return;
        case 9:
            if (typeof (window as any).bucketsList === "function")
                (window as any).bucketsList((window as any).catIndex);
            return;
        case 10:
            if (
                (window as any).playType > -1 &&
                typeof (window as any).epgList === "function"
            ) {
                (window as any).epgList(
                    (window as any).catIndex,
                    (window as any).primaryIndex,
                    false
                );
            }
            return;
        case 11:
            if (typeof (window as any).popMedia === "function")
                (window as any).popMedia();
            return;
        case 12:
            if (typeof (window as any).joyMenu === "function")
                (window as any).joyMenu();
            return;
        case 13:
            if (typeof (window as any).changeVolume === "function")
                (window as any).changeVolume((window as any).sVolumeStep);
            return;
        case 14:
            if (typeof (window as any).changeVolume === "function")
                (window as any).changeVolume(-(window as any).sVolumeStep);
            return;
        case 15:
            if ((window as any).playType) {
                if (typeof (window as any).shiftArchiveSelect === "function")
                    (window as any).shiftArchiveSelect(60);
            } else if (typeof (window as any).plusProg === "function")
                (window as any).plusProg();
            return;
        case 16:
            if ((window as any).playType) {
                if (typeof (window as any).shiftArchiveSelect === "function")
                    (window as any).shiftArchiveSelect(0);
            } else if (typeof (window as any).minusProg === "function")
                (window as any).minusProg();
            return;
        case 17:
            if (typeof (window as any).toggleSubtitle === "function")
                (window as any).toggleSubtitle();
            return;
        case 18:
            if (typeof (window as any).shiftArchive === "function")
                (window as any).shiftArchive(-60);
            return;
        case 19:
            if ((window as any).playType) {
                if (typeof (window as any).shiftArchive === "function")
                    (window as any).shiftArchive(60);
            } else if (typeof (window as any).shiftArchiveSelect === "function")
                (window as any).shiftArchiveSelect(-60);
            return;
        case 20:
            if ((window as any).playType < 0) {
                if (typeof (window as any).shiftArchive === "function")
                    (window as any).shiftArchive(-6e6);
                return;
            }
            if (!(window as any).playType) {
                if (typeof (window as any).timeShift === "function")
                    (window as any).timeShift(0);
                return;
            }
            if (
                (window as any).playType +
                    (window as any).playTime -
                    (window as any).epgArray[(window as any).curProg].time >
                30
            ) {
                if (typeof (window as any).playArchive === "function")
                    (window as any).playArchive(
                        (window as any).epgArray[(window as any).curProg].time
                    );
            } else {
                if (typeof (window as any).playArchive === "function")
                    (window as any).playArchive(
                        (window as any).epgArray[(window as any).curProg - 1]
                            .time
                    );
            }
            return;
        case 21:
            if ((window as any).playType < 0) return;
            if (!(window as any).playType) {
                if (typeof (window as any).shiftArchiveSelect === "function")
                    (window as any).shiftArchiveSelect(-60);
                return;
            }
            if (
                (window as any).epgArray[(window as any).curProg + 1].time <
                Date.now() / 1e3
            ) {
                if (typeof (window as any).playArchive === "function")
                    (window as any).playArchive(
                        (window as any).epgArray[(window as any).curProg + 1]
                            .time
                    );
            } else {
                if (typeof (window as any).showShift === "function")
                    (window as any).showShift(_("Live"));
                if (typeof (window as any).playChannel === "function")
                    (window as any).playChannel(
                        (window as any).catIndex,
                        (window as any).primaryIndex
                    );
            }
            return;
    }
}

// Touch handlers
var xDown: number | null = null,
    yDown: number | null = null,
    xUp: number | null = null,
    yUp: number | null = null,
    touch_locked = false;
var xMove1: number | null = null,
    yMove1: number | null = null,
    tCount: number | undefined;
var touch_min_sensY = Math.round(screen.height / 10);
var touch_min_sensX = Math.round(
    touch_min_sensY * (screen.width / screen.height) * 2
);

// Tap detection
/**
 * Detect whether a touch interaction qualifies as a "tap" (stationary press) rather than a swipe.
 * Compares start and end coordinates; if both X and Y deltas are below a sensitivity threshold, it is a tap.
 *
 * @param e - Start X (screenX at touchstart).
 * @param t - Start Y (screenY at touchstart).
 * @param r - End X (screenX at touchend).
 * @param s - End Y (screenY at touchend).
 * @param n - X-axis sensitivity threshold.
 * @param i - Y-axis sensitivity threshold (unused in body; the X threshold is used for both axes).
 * @returns boolean — true if the movement is within the tap threshold.
 * @analysis The body defaults to using `touch_min_sensX / 2` for X and `touch_min_sensY / 2` for Y.
 *             Note: parameter `i` is declared but currently unused in the body of this function.
 */
export function checkTap(
    e: number,
    t: number,
    r: number,
    s: number,
    n: number,
    i: number
): boolean {
    if (
        Math.abs(e - r) < touch_min_sensX / 10 &&
        Math.abs(t - s) < touch_min_sensX / 10
    )
        return true;
    return false;
}

// Swipe direction: bitmask 1=left, 2=down, 4=right, 8=up
/**
 * Determine the direction of a swipe gesture as a bitmask.
 * Bits: 1=left, 2=down, 4=right, 8=up. Multiple bits can be set for diagonal swipes.
 *
 * @param e - Start X (screenX at touchstart).
 * @param t - Start Y (screenY at touchstart).
 * @param r - End X (screenX at touchend / touchmove).
 * @param s - End Y (screenY at touchend / touchmove).
 * @param n - X-axis minimum distance threshold to register a horizontal swipe.
 * @param i - Y-axis minimum distance threshold to register a vertical swipe.
 * @returns number — Bitmask (1=left, 2=down, 4=right, 8=up). Returns 0 if no direction meets the threshold.
 * @analysis This does not normalize for diagonal — both horizontal and vertical bits can be set simultaneously.
 */
export function getDirection(
    e: number,
    t: number,
    r: number,
    s: number,
    n: number,
    i: number
): number {
    var a = 0;
    if (r - e > n) a |= 4;
    else if (e - r > n) a |= 1;
    if (s - t > i) a |= 2;
    else if (t - s > i) a |= 8;
    return a;
}

// Number input state
var nProg = "";
var numTimeout: any = null;
var numProgEl: HTMLElement | null = null;

/**
 * Handle incremental numeric channel/program input (digit-by-digit, like a remote control).
 * Accumulates digits into `nProg`, shows the partial number and channel name, then after a 2-second
 * timeout switches to the selected channel.
 *
 * @param digit - The digit (0-9) pressed.
 * @returns void
 * @sideeffect Mutates the `numprogElement` DOM node (shows/hides it, sets innerHTML).
 *             Uses setTimeout to delay channel switch; clears previous timeout on each new digit.
 *             Special sequences: "9999" + 7 toggles info visibility; "9999" + 9 opens popup menu.
 * @analysis Max 4 digits accumulated. Leading zero is rejected (empty string + 0 returns early).
 *             The parsed index (nProg - 1) is checked against curList bounds before calling playChannel.
 *             Timeout of 2000ms resets the input if no further digit arrives.
 */
export function numberProg(digit: number): void {
    if (nProg === "" && !digit) return;
    if (nProg.length === 4) {
        if (nProg === "9999") {
            if (digit === 7) {
                var info = document.getElementById("info");
                if (info)
                    info.style.display =
                        info.style.display === "none" ? "" : "none";
            }
            if (digit === 9 && typeof (window as any).popupList === "function")
                (window as any).popupList();
        }
        return;
    }
    nProg += digit.toString();
    var idx = Number.parseInt(nProg, 10) - 1;
    if (!numProgEl) numProgEl = document.getElementById("numprog");
    if (numProgEl) {
        numProgEl.innerHTML =
            nProg +
            (idx < 0 ||
            idx >=
                ((window as any).curList ? (window as any).curList.length : 0)
                ? ""
                : "<br/>" +
                  ((window as any).channels &&
                  (window as any).curList &&
                  (window as any).channels[(window as any).curList[idx]]
                      ? (window as any).channels[(window as any).curList[idx]]
                            .channel_name
                      : ""));
        numProgEl.style.display = "";
    }
    clearTimeout(numTimeout);
    numTimeout = setTimeout(() => {
        if (numProgEl) numProgEl.style.display = "none";
        var e = Number.parseInt(nProg) - 1;
        nProg = "";
        if (
            e < 0 ||
            e >=
                ((window as any).curList
                    ? (window as any).curList.length
                    : 0) ||
            e === (window as any).primaryIndex
        )
            return;
        if (typeof (window as any).playChannel === "function")
            (window as any).playChannel((window as any).catIndex, e);
    }, 2000);
}

/**
 * Move to the next channel/program in the current list (wraps around to the first).
 *
 * @returns void
 * @sideeffect Calls `window.playChannel(catIndex, primaryIndex + 1)` with wrap-around.
 * @analysis If primaryIndex is undefined/falsy, defaults to 0. If the incremented index exceeds the list,
 *             wraps to 0. Uses curList.length as the upper bound.
 */
export function plusProg(): void {
    var e = ((window as any).primaryIndex || 0) + 1;
    var len = (window as any).curList ? (window as any).curList.length : 0;
    if (e >= len) e = 0;
    if (typeof (window as any).playChannel === "function")
        (window as any).playChannel((window as any).catIndex, e);
}

/**
 * Move to the previous channel/program in the current list (wraps around to the last).
 *
 * @returns void
 * @sideeffect Calls `window.playChannel(catIndex, primaryIndex - 1)` with wrap-around.
 * @analysis If primaryIndex is undefined/falsy, defaults to 0. If decremented below 0, wraps to len - 1.
 */
export function minusProg(): void {
    var e = ((window as any).primaryIndex || 0) - 1;
    var len = (window as any).curList ? (window as any).curList.length : 0;
    if (e < 0) e = len - 1;
    if (typeof (window as any).playChannel === "function")
        (window as any).playChannel((window as any).catIndex, e);
}

/**
 * Callback invoked when the user selects an entry from the "previous programs" list.
 * Restores the channel and either plays the archived timeshift position or tunes live.
 *
 * @param sel - Selected index into the `prevArr` array.
 * @returns void
 * @sideeffect Calls `window.setCurrent`, `window.getEPGchanelCached`, `window.setCurProg`,
 *             `window.playArchive`, or `window.playChannel`.
 * @analysis If the selected entry has a timestamp (.t), fetches EPG for that channel and plays archive at that time.
 *             Otherwise simply switches to the channel live. Falls back to category "All" if not found in the
 *             original category.
 */
function onPrevSelect(sel: number): void {
    var prevArr = (window as any).prevArr || [];
    if (!prevArr[sel]) return;
    if (prevArr[sel].t) {
        var chId = prevArr[sel].ci;
        var ts = prevArr[sel].t;
        var r = 0,
            n = -1;
        var catsL = (window as any).cats;
        var catsArrayL = (window as any).catsArray;
        r = prevArr[sel].c;
        n =
            catsL && catsArrayL
                ? catsL[catsArrayL[r]].indexOf(prevArr[sel].ci)
                : -1;
        if (n === -1) {
            n =
                catsL && catsL[_("All")]
                    ? catsL[_("All")].indexOf(prevArr[sel].ci)
                    : -1;
            r = catsArrayL ? catsArrayL.indexOf(_("All")) : -1;
        }
        if (typeof (window as any).setCurrent === "function")
            (window as any).setCurrent(r, n, true);
        if (typeof (window as any).getEPGchanelCached === "function") {
            (window as any).getEPGchanelCached(
                chId,
                (_t: any, epgData: any) => {
                    var recent: any[] = [];
                    if (epgData !== null && epgData.length) {
                        var ch = (window as any).channels
                            ? (window as any).channels[chId]
                            : null;
                        var chRec = ((ch && ch.rec) || 0) * 60 * 60;
                        var cutoff = Date.now() / 1e3 - chRec;
                        var i: number;
                        for (i = 0; i < epgData.length; i++) {
                            if (epgData[i].time > cutoff)
                                recent.push(epgData[i]);
                        }
                        recent.sort((a: any, b: any) => a.time - b.time);
                    }
                    (window as any).epgArray = recent;
                    if (typeof (window as any).setCurProg === "function")
                        (window as any).setCurProg(chId, epgData, null);
                    if (typeof (window as any).playArchive === "function")
                        (window as any).playArchive(ts);
                }
            );
        }
    } else {
        var r2: number, n2: number;
        var catsL2 = (window as any).cats;
        var catsArrayL2 = (window as any).catsArray;
        r2 = prevArr[sel].c;
        n2 =
            catsL2 && catsArrayL2
                ? catsL2[catsArrayL2[r2]].indexOf(prevArr[sel].ci)
                : -1;
        if (n2 === -1) {
            n2 =
                catsL2 && catsL2[_("All")]
                    ? catsL2[_("All")].indexOf(prevArr[sel].ci)
                    : -1;
            r2 = catsArrayL2 ? catsArrayL2.indexOf(_("All")) : -1;
        }
        if (typeof (window as any).playChannel === "function")
            (window as any).playChannel(r2, n2);
    }
}

/**
 * Show the "previous programs" list and navigate to the selected channel/timeshift.
 * With 0 entries: does nothing. With 1 entry: immediately switches to that channel.
 * With 2+ entries: opens a select-box listing each entry with channel name, timestamp (if archived), and event name.
 *
 * @returns void
 * @sideeffect Calls `window.playChannel`, `window.showSelectBox`, or renders a popup list.
 *             Nested helpers `timeToday`, `fmtTime`, `setFromEntry` are closures over `prevArr`.
 * @analysis Entries with invalid data are spliced out of the array during iteration. Archived entries
 *             show a red timestamp; live entries show no timestamp. Falls back to category "All" if the
 *             original category lookup fails.
 */
export function prevProg(): void {
    var prevArr = (window as any).prevArr || [];
    /**
     * Check whether a Unix timestamp falls within today (00:00:00 to 23:59:59 local time).
     *
     * @param e - Unix timestamp in seconds.
     * @returns boolean — true if the timestamp is within the current calendar day.
     */
    function timeToday(e: number): boolean {
        var t =
            Math.floor(Date.now() / 864e5) * 86400 +
            new Date().getTimezoneOffset() * 60;
        return e >= t && e < t + 86400;
    }
    /**
     * Format a Unix timestamp for display. If it falls within today, uses time2time (HH:MM).
     * Otherwise uses time2str (day + date + time).
     *
     * @param e - Unix timestamp in seconds.
     * @returns string — Formatted time string, or empty string if neither helper is available.
     */
    function fmtTime(e: number): string {
        return timeToday(e)
            ? (window as any).time2time(e)
            : (window as any).time2str
              ? (window as any).time2str(e)
              : "";
    }
    var r: number, n: number;
    /**
     * Populate `r` (category index) and `n` (channel index in the category) from a prevArr entry.
     * Falls back to category "All" if the original category does not contain the channel.
     *
     * @param entry - A prevArr entry with `.c` (category index) and `.ci` (channel id).
     * @returns void
     * @sideeffect Sets the outer-scope variables `r` and `n`.
     */
    function setFromEntry(entry: any): void {
        r = entry.c;
        n =
            (window as any).cats && (window as any).catsArray
                ? (window as any).cats[(window as any).catsArray[r]].indexOf(
                      entry.ci
                  )
                : -1;
        if (n !== -1) return;
        n =
            (window as any).cats && (window as any).cats[_("All")]
                ? (window as any).cats[_("All")].indexOf(entry.ci)
                : -1;
        r = (window as any).catsArray
            ? (window as any).catsArray.indexOf(_("All"))
            : -1;
    }
    switch (prevArr.length) {
        case 0:
            return;
        case 1:
            setFromEntry(prevArr[0]);
            if (typeof (window as any).playChannel === "function")
                (window as any).playChannel(r!, n!);
            return;
        default: {
            var items: string[] = [];
            prevArr.forEach((entry: any, idx: number, arr: any[]) => {
                try {
                    items.push(
                        ((window as any).channels &&
                        (window as any).channels[entry.ci]
                            ? (window as any).channels[entry.ci].channel_name
                            : "") +
                            (entry.t
                                ? '<span style="color:red;"> - ' +
                                  fmtTime(entry.t) +
                                  "</span>"
                                : "") +
                            (entry.e
                                ? ' <span style="color:#f9bf3b;"><span style="color:#607d8b;">&#x02237; </span>' +
                                  entry.e +
                                  "</span>"
                                : "")
                    );
                } catch (e) {
                    arr.splice(idx, 1);
                }
            });
            if (typeof (window as any).showSelectBox === "function") {
                (window as any).showSelectBox(0, items, onPrevSelect, 0);
            }
        }
    }
}

/**
 * Handle the `touchstart` event on the document body.
 * Records starting touch coordinates and detects 4-finger touch to toggle touch lock.
 *
 * @param e - The TouchEvent object (typed as `any` for compatibility).
 * @returns void
 * @sideeffect Calls `e.preventDefault()`. Sets module-level variables `xDown`, `yDown`, `xUp`, `yUp`,
 *             `xMove1`, `yMove1`, `tCount`, `touch_locked`. Shows an `alert()` when locking/unlocking.
 * @analysis 4-finger touch toggles `touch_locked` flag. When locked, all subsequent touch events are ignored.
 *             The initial move reference (`xMove1`/`yMove1`) is set equal to the start coordinates.
 */
function handleTouchStart(e: any): void {
    e.preventDefault();
    tCount = e.touches.length;
    if (tCount === 4) {
        touch_locked = !touch_locked;
        alert(touch_locked ? "Touchscreen LOCKED" : "Touchscreen UNLOCKED");
    }
    if (touch_locked) return;
    xDown = e.touches[0].screenX;
    yDown = e.touches[0].screenY;
    xUp = xDown;
    yUp = yDown;
    xMove1 = xDown;
    yMove1 = yDown;
}

/**
 * Handle the `touchmove` event on the document body.
 * For single-finger moves, detects the dominant swipe direction and dispatches the corresponding
 * arrow key (LEFT, RIGHT, UP, DOWN) via `window._doKey`.
 *
 * @param e - The TouchEvent object (typed as `any` for compatibility).
 * @returns void — early return if `xDown` or `yDown` is null (no touchstart recorded).
 * @sideeffect Calls `e.preventDefault()`. Dispatches key events via `window._doKey`.
 *             Updates module-level `xUp`, `yUp`, `xMove1`, `yMove1`.
 * @analysis Only processes single-finger (tCount === 1) moves. Multi-finger moves are ignored here
 *             (handled on touchend). The direction is determined by comparing the greater of X/Y delta.
 *             A non-zero dir causes the move reference point to be reset to prevent repeated dispatches.
 */
function handleTouchMove(e: any): void {
    if (!(xDown && yDown)) return;
    e.preventDefault();
    xUp = Math.round(e.touches[0].screenX);
    yUp = Math.round(e.touches[0].screenY);
    if (tCount === 1) {
        var dir =
            Math.abs(xUp! - xMove1!) > Math.abs(yUp! - yMove1!)
                ? xUp! > xMove1!
                    ? 4
                    : 1
                : yUp! > yMove1!
                  ? 2
                  : 8;
        if (dir === 1) (window as any)._doKey((window as any).keys.LEFT);
        else if (dir === 4) (window as any)._doKey((window as any).keys.RIGHT);
        else if (dir === 2) (window as any)._doKey((window as any).keys.DOWN);
        else if (dir === 8) (window as any)._doKey((window as any).keys.UP);
        if (dir) {
            yMove1 = yUp;
            xMove1 = xUp;
        }
    }
}

/**
 * Legacy handler for `touchend` — only handles the 3-finger tap → SETUP case.
 * This is a subset of `body_handleTouchEnd` and is now primarily unused (body_handleTouchEnd replaces it for the body listener).
 *
 * @param e - The TouchEvent object (typed as `any` for compatibility).
 * @returns void
 * @sideeffect Dispatches SETUP key via `window._doKey`. Resets `xDown`, `yDown`, `tCount`.
 * @analysis Only triggers on exactly 3 touch points. Resets tracking state unconditionally after processing.
 */
function handleTouchEnd(e: any): void {
    if (
        tCount === 3 &&
        Math.abs(xUp! - xDown!) < touch_min_sensX * 5 &&
        Math.abs(yUp! - yDown!) < touch_min_sensY * 2
    )
        (window as any)._doKey((window as any).keys.SETUP);
    xDown = null as number | null;
    yDown = null as number | null;
    tCount = undefined as number | undefined;
}

/**
 * Handle the `touchend` event on the document body (replaces the legacy handleTouchEnd).
 * Maps multi-finger gestures to remote control keys:
 * - 3-finger tap → SETUP
 * - 2-finger swipe → color keys (RED/GREEN/YELLOW/BLUE) or tap → ENTER
 * - 1-finger tap → synthesizes a MouseEvent click on the target element
 *
 * @param e - The TouchEvent object (typed as `any` for compatibility).
 * @returns void — early return if `xDown` or `yDown` is null.
 * @sideeffect Calls `e.preventDefault()`. Dispatches key events via `window._doKey`.
 *             Dispatches a synthetic `click` MouseEvent on the touch target.
 *             Resets tracking state (`xDown`, `yDown`, `tCount`) after processing.
 * @analysis Only processes when `e.touches.length === 0` (finger lifted). Two-finger tap detection
 *             uses checkTap with a tighter threshold. One-finger tap creates a proper MouseEvent
 *             so that regular click handlers fire naturally.
 */
function body_handleTouchEnd(e: any): void {
    if (!(xDown && yDown)) return;
    e.preventDefault();
    if (e.touches.length === 0) {
        if (tCount === 3) {
            // 3-finger tap → SETUP (from handleTouchEnd)
            if (
                checkTap(
                    xDown!,
                    yDown!,
                    xUp!,
                    yUp!,
                    touch_min_sensX * 5,
                    touch_min_sensY * 2
                )
            )
                (window as any)._doKey((window as any).keys.SETUP);
        } else if (tCount === 2) {
            // 2-finger gestures → color keys or ENTER
            var dir = getDirection(
                xDown!,
                yDown!,
                xUp!,
                yUp!,
                touch_min_sensX,
                touch_min_sensY * 2
            );
            switch (dir) {
                case 0:
                    if (
                        checkTap(
                            xDown!,
                            yDown!,
                            xUp!,
                            yUp!,
                            touch_min_sensX / 2,
                            touch_min_sensY / 2
                        )
                    )
                        (window as any)._doKey((window as any).keys.ENTER);
                    break;
                case 1:
                    (window as any)._doKey((window as any).keys.RED);
                    break;
                case 4:
                    (window as any)._doKey((window as any).keys.BLUE);
                    break;
                case 2:
                    (window as any)._doKey((window as any).keys.YELLOW);
                    break;
                case 8:
                    (window as any)._doKey((window as any).keys.GREEN);
                    break;
            }
        } else if (tCount === 1) {
            // 1-finger tap → click event
            if (
                checkTap(
                    xDown!,
                    yDown!,
                    xUp!,
                    yUp!,
                    touch_min_sensX / 2,
                    touch_min_sensY / 2
                )
            ) {
                var clickEvent = new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    clientX: e.changedTouches[0].clientX,
                    clientY: e.changedTouches[0].clientY,
                    view: window,
                });
                e.target.dispatchEvent(clickEvent);
            }
        }
        xDown = null;
        yDown = null;
        tCount = undefined;
    }
}

/**
 * Handle `click` events on the document body (assigned to `document.body.onclick`).
 * Interprets the vertical click position:
 * - Top 20% → open popup menu (popupList)
 * - Bottom 20% → show channel info (showChanelInfo)
 * - Middle 60% → dispatch ENTER key
 *
 * @param e - The MouseEvent object (typed as `any` for compatibility).
 * @returns void — early return if `e.clientY` is undefined.
 * @sideeffect Calls `window.popupList()`, `window.showChanelInfo()`, or `window._doKey(keys.ENTER, e)`.
 * @analysis Uses `document.body.getBoundingClientRect().height` or `window.innerHeight` as the reference height.
 *             The 20%/80% thresholds create three horizontal bands across the screen.
 */
function body_onClick(e: any): void {
    if (!e) e = event as any;
    if (e.clientY === undefined) return;
    var t = document.body.getBoundingClientRect().height || window.innerHeight;
    if (e.clientY < t * 0.2) (window as any).popupList();
    else if (e.clientY > t * 0.8) (window as any).showChanelInfo();
    else (window as any)._doKey((window as any).keys.ENTER, e);
}

/**
 * Handle click events when the list overlay is visible — dispatches a RETURN key to close/go back.
 *
 * @param e - The MouseEvent object (typed as `any` for compatibility).
 * @returns void
 * @sideeffect Calls `window._doKey(keys.RETURN, e)`.
 */
function list_OnClick(e: any): void {
    if (!e) e = event as any;
    (window as any)._doKey((window as any).keys.RETURN, e);
}

document.body.addEventListener("touchstart", handleTouchStart, {
    passive: false,
});
document.body.addEventListener("touchmove", handleTouchMove, {
    passive: false,
});
document.body.addEventListener("touchend", body_handleTouchEnd, {
    passive: false,
});
document.body.onclick = body_onClick;
