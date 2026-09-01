/**
 * Samsung Tizen device stub.
 *
 * Keycodes and platform-specific init for Samsung Tizen TVs.
 * Sets window.keys and overrides stbInit.
 */

import { stbInit as baseStbInit } from "../../../core";

var tizenKeys = {
    ASPECT: 10121,
    AUDIO: 10171,
    BLUE: 10303,
    CH_DOWN: 10061,
    CH_LIST: 10107,
    CH_UP: 10060,
    DOWN: 40,
    ENTER: 10008,
    EPG: 0,
    EXIT: 10182,
    FF: 417,
    GREEN: 10301,
    INFO: 10109,
    LANG: 0,
    LEFT: 37,
    MUTE: 10134,
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
    NEXT: 425,
    PAUSE: 19,
    PIP: 0,
    PLAY: 10015,
    POWER: 10005,
    PRECH: 10136,
    PREV: 424,
    REC: 10017,
    RED: 10300,
    RETURN: 10009,
    RIGHT: 39,
    RW: 412,
    SETUP: 10041,
    STOP: 10016,
    TOOLS: 10110,
    UP: 38,
    VOL_DOWN: 10044,
    VOL_UP: 10043,
    YELLOW: 10302,
    ZOOM: 10122,
};

// Set globals expected by the player
(window as any).keys = tizenKeys;
(window as any).strEXIT = "RETURN";
(window as any).strENTER = "ENTER";
(window as any).strTools = "TOOLS";
(window as any).strRETURN = "RETURN";
(window as any).strSETUP = "MENU";

// Hide Samsung launch splash — Tizen 5.5+ exposes setSplashEnabled on webapis.appcommon
function hideSplash(): void {
    try {
        const webapis = (window as any).webapis;
        if (webapis?.appcommon?.setSplashEnabled) {
            webapis.appcommon.setSplashEnabled(false);
        }
    } catch {
        // ponytail: degrade silently
    }
}

// Hide smart-remote cursor — Tizen SDK has no setCursorVisible JS API, use CSS
function hideCursor(): void {
    try {
        document.documentElement.style.cursor = "none";
        document.body.style.cursor = "none";
    } catch {
        // ponytail: degrade silently
    }
}

// Lock window to landscape — Tizen supports portrait, we don't
function lockLandscape(): void {
    try {
        const so = (screen as any).orientation;
        if (so?.lock) {
            so.lock("landscape").catch(() => {
                /* ponytail: some Tizen builds reject; ignore */
            });
        }
    } catch {
        // ponytail: degrade silently
    }
}

// Bring app to foreground — prevent OS from stealing focus during playback
function focusApp(): void {
    try {
        const tizen = (window as any).tizen;
        if (tizen?.application?.getCurrentApplication) {
            tizen.application.getCurrentApplication().requestForeground();
        }
        if (typeof window.focus === "function") window.focus();
    } catch {
        // ponytail: degrade silently
    }
}

// Override stbInit with Tizen-specific init
function stbInit(): void {
    baseStbInit();
    const win = window as any;
    if (typeof win.tizen === "undefined") {
        return;
    }
    console.log("[stb] Samsung Tizen platform detected");
    hideSplash();
    hideCursor();
    lockLandscape();
    focusApp();
}
(window as any).stbInit = stbInit;
