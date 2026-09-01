/**
 * LG WebOS device stub.
 *
 * Keycodes and platform-specific init for LG WebOS TVs.
 * Sets window.keys and overrides stbInit.
 */

import { stbInit as baseStbInit } from "../../../core";

// WebOS keycodes
var webosKeys = {
    ASPECT: 0,
    AUDIO: 0,
    BLUE: 406,
    CH_DOWN: 428,
    CH_LIST: 0,
    CH_UP: 427,
    DOWN: 40,
    ENTER: 13,
    EPG: 0,
    EXIT: 27,
    FF: 417,
    GREEN: 404,
    INFO: 457,
    LANG: 0,
    LEFT: 37,
    MUTE: 449,
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
    PLAY: 415,
    POWER: 0,
    PRECH: 0,
    PREV: 424,
    REC: 416,
    RED: 403,
    RETURN: 461,
    RIGHT: 39,
    RW: 412,
    SETUP: 458,
    STOP: 413,
    TOOLS: 459,
    UP: 38,
    VOL_DOWN: 448,
    VOL_UP: 447,
    YELLOW: 405,
    ZOOM: 0,
};

// Set globals expected by the player
(window as any).keys = webosKeys;
(window as any).strEXIT = "EXIT";
(window as any).strTools = "TOOLS";
(window as any).strRETURN = "BACK";

// Hide LG splash/logo on launch — 2–5 s native delay otherwise
function hideSplash(): void {
    try {
        const webOS = (window as any).webOS;
        if (typeof webOS?.system?.hideSplashScreen === "function") {
            webOS.system.hideSplashScreen();
        }
    } catch {
        // ponytail: degrade silently
    }
}

// Hide magic-remote cursor — STB remotes have no pointer, cursor = visual noise
function hideCursor(): void {
    try {
        const webOS = (window as any).webOS;
        if (typeof webOS?.device?.cursorVisible === "function") {
            webOS.device.cursorVisible(false);
        }
    } catch {
        // ponytail: degrade silently
    }
}

// Lock window to landscape — WebOS supports portrait, we don't
function lockLandscape(): void {
    try {
        const webOS = (window as any).webOS;
        if (typeof webOS?.platform?.setWindowOrientation === "function") {
            webOS.platform.setWindowOrientation("landscape");
        }
    } catch {
        // ponytail: degrade silently
    }
}

// Bring app to foreground — prevent OS from stealing focus during playback
function focusApp(): void {
    try {
        const webOS = (window as any).webOS;
        if (typeof webOS?.app?.requestWindowFocus === "function") {
            webOS.app.requestWindowFocus();
        }
    } catch {
        // ponytail: degrade silently
    }
}

// Override stbInit with WebOS-specific init
function stbInit(): void {
    baseStbInit();
    const win = window as any;
    if (
        typeof win.webOS === "undefined" &&
        typeof win.PalmSystem === "undefined"
    ) {
        return;
    }
    console.log("[stb] LG WebOS platform detected");
    hideSplash();
    hideCursor();
    lockLandscape();
    focusApp();
}
(window as any).stbInit = stbInit;
