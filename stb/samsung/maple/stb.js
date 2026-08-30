version += " samsung-maple-0219";
var keys = {
    RIGHT: 6,
    LEFT: 4,
    DOWN: 5,
    UP: 8,
    RETURN: 88,
    EXIT: 45,
    TOOLS: 31,
    FF: 72,
    RW: 74,
    NEXT: 69,
    PREV: 68,
    ENTER: 12,
    RED: 29,
    GREEN: 30,
    YELLOW: 32,
    BLUE: 33,
    CH_LIST: 107,
    CH_UP: 18,
    CH_DOWN: 19,
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
    PRECH: 108,
    POWER: 0,
    PLAY: 71,
    STOP: 73,
    PAUSE: 75,
    INFO: 99,
    REC: 0,
    MUTE: 82,
    VOL_UP: 16,
    VOL_DOWN: 17,
    EPG: 0,
    ZOOM: 0,
    ASPECT: 0,
    AUDIO: 0,
    SETUP: 31,
    PIP: 0,
    LANG: 0,
};
var strEXIT = "EXIT";
var strRETURN = "RETURN";
var _baseStbInit = typeof stbInit === "function" ? stbInit : function () {};
function stbInit() {
    _baseStbInit();
    try {
        if (typeof Common !== "undefined" && Common.API) {
            console.log("[stb] Samsung Maple (Orsay) platform detected");
        }
    } catch (e) {}
}
