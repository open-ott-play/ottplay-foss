version += ' lg-webos-0219';
var keys = {
    RIGHT: 39, LEFT: 37, DOWN: 40, UP: 38,
    RETURN: 461, EXIT: 27, TOOLS: 459, FF: 417, RW: 412,
    NEXT: 425, PREV: 424, ENTER: 13,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    CH_LIST: 0, CH_UP: 427, CH_DOWN: 428,
    N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,
    PRECH: 0, POWER: 0, PLAY: 415, STOP: 413, PAUSE: 19,
    INFO: 457, REC: 416, MUTE: 449,
    VOL_UP: 447, VOL_DOWN: 448, EPG: 0,
    ZOOM: 0, ASPECT: 0, AUDIO: 0, SETUP: 458, PIP: 0, LANG: 0
};
var strEXIT = 'EXIT';
var strTools = 'TOOLS';
var strRETURN = 'BACK';
var _baseStbInit = typeof stbInit === 'function' ? stbInit : function(){};
function stbInit() {
    _baseStbInit();
    try {
        if (typeof webOS !== 'undefined') {
            console.log('[stb] LG WebOS platform detected');
        } else if (typeof window.PalmSystem !== 'undefined') {
            console.log('[stb] LG WebOS (PalmSystem) platform detected');
        }
    } catch(e) {}
}
