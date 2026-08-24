version += ' spark-0219';
var keys = {
    RIGHT: 39, LEFT: 37, DOWN: 40, UP: 38,
    RETURN: 8, EXIT: 27, TOOLS: 84, FF: 70, RW: 82,
    NEXT: 190, PREV: 188, ENTER: 13,
    RED: 112, GREEN: 113, YELLOW: 114, BLUE: 115,
    CH_LIST: 0, CH_UP: 33, CH_DOWN: 34,
    N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,
    PRECH: 0, POWER: 0, PLAY: 80, STOP: 83, PAUSE: 80,
    INFO: 73, REC: 0, MUTE: 77,
    VOL_UP: 0, VOL_DOWN: 0, EPG: 0,
    ZOOM: 0, ASPECT: 0, AUDIO: 0, SETUP: 84, PIP: 0, LANG: 0
};
var strEXIT = 'EXIT';
var strRETURN = 'BACK';
var _baseStbInit = typeof stbInit === 'function' ? stbInit : function(){};
function stbInit() {
    _baseStbInit();
    try {
        if (typeof STB !== 'undefined') {
            console.log('[stb] Spark STB platform detected');
        }
    } catch(e) {}
}
