version += " lg-webos-0219";
var keys = {
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
var strEXIT = "EXIT";
var strTools = "TOOLS";
var strRETURN = "BACK";
var _baseStbInit = typeof stbInit === "function" ? stbInit : function () {};
// Hide LG splash/logo on launch — 2–5 s native delay otherwise
function _hideSplash() {
    try {
        if (
            typeof webOS !== "undefined" &&
            webOS.system &&
            typeof webOS.system.hideSplashScreen === "function"
        ) {
            webOS.system.hideSplashScreen();
        }
    } catch (e) {}
}
// Hide magic-remote cursor — STB remotes have no pointer, cursor = visual noise
function _hideCursor() {
    try {
        if (
            typeof webOS !== "undefined" &&
            webOS.device &&
            typeof webOS.device.cursorVisible === "function"
        ) {
            webOS.device.cursorVisible(false);
        }
    } catch (e) {}
}
// Lock window to landscape — WebOS supports portrait, we don't
function _lockLandscape() {
    try {
        if (
            typeof webOS !== "undefined" &&
            webOS.platform &&
            typeof webOS.platform.setWindowOrientation === "function"
        ) {
            webOS.platform.setWindowOrientation("landscape");
        }
    } catch (e) {}
}
// Bring app to foreground — prevent OS from stealing focus during playback
function _focusApp() {
    try {
        if (
            typeof webOS !== "undefined" &&
            webOS.app &&
            typeof webOS.app.requestWindowFocus === "function"
        ) {
            webOS.app.requestWindowFocus();
        }
    } catch (e) {}
}
// Ensure PiP menu items are always visible on LG — clear any persisted sHideMenus entries
function _showPipMenu() {
    try {
        if (typeof stbSetItem === "function") {
            var hidden = (stbGetItem("sHideMenus") || "")
                .split(",")
                .filter(function (x) {
                    return (
                        x !== "" && x !== "popTogglePip" && x !== "popStopPip"
                    );
                });
            stbSetItem("sHideMenus", hidden.join(","));
        }
    } catch (e) {}
}
function stbInit() {
    _baseStbInit();
    try {
        if (typeof webOS !== "undefined") {
            console.log("[stb] LG WebOS platform detected");
        } else if (typeof window.PalmSystem !== "undefined") {
            console.log("[stb] LG WebOS (PalmSystem) platform detected");
        } else {
            return;
        }
        _hideSplash();
        _hideCursor();
        _lockLandscape();
        _focusApp();
        _showPipMenu();
    } catch (e) {}
}
