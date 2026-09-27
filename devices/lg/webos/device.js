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
var _baseWebosKey = window.stbEventToKeyCode;
window.stbEventToKeyCode = function (event) {
    if (!event) return 0;
    var code = event.keyCode || event.which || 0;
    if (code === 33) return keys.CH_UP;
    if (code === 34) return keys.CH_DOWN;
    if (!code) {
        var names = [event.key, event.code];
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (name === "ChannelUp" || name === "PageUp") return keys.CH_UP;
            if (name === "ChannelDown" || name === "PageDown")
                return keys.CH_DOWN;
            if (name === "GoBack" || name === "BrowserBack") return keys.RETURN;
        }
    }
    return typeof _baseWebosKey === "function"
        ? _baseWebosKey.call(this, event)
        : code;
};
var _webosBackBound = false;
var _webosBackActive = false;
var _webosBackDepth = 0;
var _baseWebosExit = window.stbExit;
window.stbExit = function () {
    var releaseHistory = _webosBackActive;
    _webosBackActive = false;
    var result;
    if (typeof _baseWebosExit === "function")
        result = _baseWebosExit.apply(this, arguments);
    // Native webOS closes the app. Ordinary hosted tabs may reject close(); in
    // that case leave our entry and return exactly one pre-player history entry.
    // At a direct entry with no previous page, only remove our own extra entry.
    if (releaseHistory && typeof window.setTimeout === "function")
        window.setTimeout(function () {
            var history = window.history;
            if (
                !window.closed &&
                history.state &&
                history.state.ottplayWebosBack === _webosBackDepth
            )
                history.go(_webosBackDepth > 2 ? -2 : -1);
        }, 100);
    return result;
};
// Hosted webOS pages receive Back through history by default. Keep one same-page
// entry so the player can close its own menus and ask before the confirmed exit.
// https://webostv.developer.lge.com/develop/guides/back-button
function _bindWebosBackHistory() {
    var history = window.history;
    if (
        _webosBackBound ||
        !history ||
        typeof history.pushState !== "function" ||
        typeof history.replaceState !== "function" ||
        typeof window.addEventListener !== "function"
    )
        return;
    function arm() {
        history.pushState({ ottplayWebosBack: true }, "");
        // pushState discards forward entries, so length now gives the actual
        // entry depth. Persist it so reloads cannot confuse length with index.
        _webosBackDepth = history.length;
        history.replaceState({ ottplayWebosBack: _webosBackDepth }, "");
    }
    try {
        if (history.state && typeof history.state.ottplayWebosBack === "number")
            _webosBackDepth = history.state.ottplayWebosBack;
        else arm();
        _webosBackActive = true;
        _webosBackBound = true;
        window.addEventListener("popstate", function (event) {
            if (
                !_webosBackActive ||
                (event.state &&
                    event.state.ottplayWebosBack === _webosBackDepth)
            )
                return;
            arm();
            if (typeof window.keyHandler === "function")
                window.keyHandler({
                    keyCode: keys.RETURN,
                    preventDefault: function () {},
                    stopPropagation: function () {},
                });
        });
    } catch (e) {}
}
// Capture the existing initializer before assigning the device wrapper.
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
stbInit = function () {
    _bindWebosBackHistory();
    var baseInitResult = _baseStbInit.apply(this, arguments);
    try {
        if (typeof webOS !== "undefined") {
            console.log("[stb] LG WebOS platform detected");
        } else if (typeof window.PalmSystem !== "undefined") {
            console.log("[stb] LG WebOS (PalmSystem) platform detected");
        } else {
            return baseInitResult;
        }
        _hideSplash();
        // webOS manages Magic Remote pointer visibility and directional mode.
        _lockLandscape();
        _focusApp();
        _showPipMenu();
    } catch (e) {}
    return baseInitResult;
};
