version += ' android-0219';
var keys = {
    RIGHT: 22, LEFT: 21, DOWN: 20, UP: 19,
    RETURN: 4, EXIT: 4, TOOLS: 82, FF: 90, RW: 89,
    NEXT: 87, PREV: 88, ENTER: 66,
    RED: 183, GREEN: 184, YELLOW: 185, BLUE: 186,
    CH_LIST: 0, CH_UP: 167, CH_DOWN: 168,
    N0: 7, N1: 8, N2: 9, N3: 10, N4: 11, N5: 12, N6: 13, N7: 14, N8: 15, N9: 16,
    PRECH: 0, POWER: 26, PLAY: 85, STOP: 86, PAUSE: 85,
    INFO: 165, REC: 0, MUTE: 91,
    VOL_UP: 24, VOL_DOWN: 25, EPG: 0,
    ZOOM: 0, ASPECT: 0, AUDIO: 0, SETUP: 82, PIP: 0, LANG: 0
};
var strEXIT = 'BACK';
var strENTER = 'OK';
var strRETURN = 'BACK';
var strSETUP = 'MENU';
var _baseStbInit = typeof stbInit === 'function' ? stbInit : function(){};
function stbInit() {
    _baseStbInit();
    try {
        if (typeof Android !== 'undefined') {
            console.log('[stb] Android platform detected');
        }
    } catch(e) {}
}
