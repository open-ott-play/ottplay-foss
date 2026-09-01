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

// Override stbInit with Tizen-specific init
function stbInit(): void {
    baseStbInit();
    try {
        if (typeof (window as any).tizen !== "undefined") {
            console.log("[stb] Samsung Tizen platform detected");
        }
    } catch (e) {}
}
(window as any).stbInit = stbInit;
