version += ' mag-0219';
var keys = {
    RIGHT: 39, LEFT: 37, DOWN: 40, UP: 38,
    RETURN: 8, EXIT: 27, TOOLS: 122, FF: 70, RW: 82,
    NEXT: 190, PREV: 188, ENTER: 13,
    RED: 112, GREEN: 113, YELLOW: 114, BLUE: 115,
    CH_LIST: 0, CH_UP: 33, CH_DOWN: 34,
    N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54, N7: 55, N8: 56, N9: 57,
    PRECH: 191, POWER: 0, PLAY: 68, STOP: 83, PAUSE: 80,
    INFO: 73, REC: 0, MUTE: 77,
    VOL_UP: 107, VOL_DOWN: 109, EPG: 0,
    ZOOM: 0, ASPECT: 0, AUDIO: 0, SETUP: 122, PIP: 0, LANG: 16
};
var strEXIT = 'EXIT';
var strRETURN = 'BACK';
var _baseStbInit = typeof stbInit === 'function' ? stbInit : function(){};
function stbInit() {
    _baseStbInit();
    try {
        if (typeof gSTB !== 'undefined') {
            console.log('[stb] MAG STB detected');
            var mac = gSTB.GetMACAddress ? gSTB.GetMACAddress() : gSTB.GetDeviceMacAddress ? gSTB.GetDeviceMacAddress() : '';
            if (mac && mac !== '') {
                stbGetMacAddress = function() { return mac; };
            }
        }
    } catch(e) {}
}
var _stb_orig_mac = stb.getMacAddress;
stb.getMacAddress = function() {
    try {
        if (typeof gSTB !== 'undefined') {
            if (gSTB.GetMACAddress) return gSTB.GetMACAddress();
            if (gSTB.GetDeviceMacAddress) return gSTB.GetDeviceMacAddress();
        }
    } catch(e) {}
    return _stb_orig_mac();
};
