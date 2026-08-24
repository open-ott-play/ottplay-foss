version += ' samsung-tizen-0219';
var keys = {
    RIGHT: 39, LEFT: 37, DOWN: 40, UP: 38,
    RETURN: 10009, EXIT: 10182, TOOLS: 10110, FF: 417, RW: 412,
    NEXT: 425, PREV: 424, ENTER: 10008,
    RED: 10300, GREEN: 10301, YELLOW: 10302, BLUE: 10303,
    CH_LIST: 10107, CH_UP: 10060, CH_DOWN: 10061,
    N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,
    PRECH: 10136, POWER: 10005, PLAY: 10015, STOP: 10016, PAUSE: 19,
    INFO: 10109, REC: 10017, MUTE: 10134,
    VOL_UP: 10043, VOL_DOWN: 10044, EPG: 0,
    ZOOM: 10122, ASPECT: 10121, AUDIO: 10171, SETUP: 10041, PIP: 0, LANG: 0
};
var strEXIT = 'RETURN';
var strENTER = 'ENTER';
var strTools = 'TOOLS';
var strRETURN = 'RETURN';
var strSETUP = 'MENU';
var _baseStbInit = typeof stbInit === 'function' ? stbInit : function(){};
function stbInit() {
    _baseStbInit();
    try {
        if (typeof tizen !== 'undefined') {
            console.log('[stb] Samsung Tizen platform detected');
        }
    } catch(e) {}
}
