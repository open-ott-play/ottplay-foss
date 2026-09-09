/**
 * Device detection module.
 *
 * Detects device type from URL path and user agent string.
 * Exports globals expected by legacy code and provider scripts.
 */

// URL-based device detection (legacy index.html:67-91)
export function detectDevice(): string {
    var path = window.location.pathname;
    var m = path.match(/^\/f\/(.+?)(\/|$)/);
    if (m) return m[1].replace(/\/+$/, "");
    var ua = navigator.userAgent.toLowerCase();
    if (ua.indexOf("webos") !== -1 || ua.indexOf("lg") !== -1)
        return "lg/webos";
    if (ua.indexOf("tizen") !== -1) return "samsung/tizen";
    if (ua.indexOf("maple") !== -1) return "samsung/maple";
    if (ua.indexOf("stb") !== -1 && ua.indexOf("infomir") !== -1) return "mag";
    if (ua.indexOf("dune") !== -1) return "dune";
    if (ua.indexOf("android") !== -1) return "android";
    if (ua.indexOf("hbbtv") !== -1 || ua.indexOf("oipf") !== -1) return "hbbtv";
    if (ua.indexOf("viera") !== -1) return "panasonic";
    if (ua.indexOf("philips") !== -1) return "philips";
    if (ua.indexOf("hisense") !== -1) return "hisense";
    if (ua.indexOf("sony") !== -1) return "sony";
    if (ua.indexOf("tcl") !== -1) return "tcl";
    if (ua.indexOf("sharp") !== -1) return "sharp";
    if (ua.indexOf("toshiba") !== -1) return "toshiba";
    if (ua.indexOf("skyworth") !== -1) return "skyworth";
    if (ua.indexOf("vewd") !== -1) return "vewd";
    if (ua.indexOf("spark") !== -1) return "spark";
    if (ua.indexOf("nodejs") !== -1 || ua.indexOf("electron") !== -1)
        return "nodejs";
    return "pc";
}

/**
 * Global variables expected by legacy code and provider scripts.
 * These are initialized in index.ts before the bundle loads.
 */

export let host = window.location.origin || "http://localhost:8080";
export let __cv = "local";
export let __av = "local";
export let __iid = "";
export let dnt = false;
export let ott_device: string = detectDevice();
