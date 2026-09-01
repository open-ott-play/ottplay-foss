/**
 * PC device stub.
 *
 * Keycodes and platform-specific init for PC/Maple/Spark STBs.
 * Sets window.keys and overrides stbInit.
 */

// PC keycodes
var pcKeys = {
    ASPECT: 0,
    AUDIO: 0,
    BLUE: 0,
    CH_DOWN: 0,
    CH_LIST: 0,
    CH_UP: 0,
    DOWN: 40,
    ENTER: 13,
    EPG: 0,
    EXIT: 27,
    FF: 70,
    GREEN: 113,
    INFO: 73,
    LANG: 0,
    LEFT: 37,
    MUTE: 77,
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
    NEXT: 0,
    PAUSE: 19,
    PIP: 0,
    PLAY: 415,
    POWER: 0,
    PRECH: 0,
    PREV: 0,
    REC: 0,
    RED: 403,
    RETURN: 8,
    RIGHT: 39,
    RW: 82,
    SETUP: 0,
    STOP: 413,
    TOOLS: 459,
    UP: 38,
    VOL_DOWN: 448,
    VOL_UP: 447,
    YELLOW: 405,
    ZOOM: 0,
};

// Set globals expected by the player
(window as any).keys = pcKeys;

function stbInit(): void {
    console.log("[stb] PC platform detected");
}
(window as any).stbInit = stbInit;
