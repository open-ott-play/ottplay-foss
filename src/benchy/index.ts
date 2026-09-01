/**
 * Benchy diagnostics module.
 *
 * Ported from stbPlayer.js:514-731. Provides CSS integrity checks,
 * live CSS/JS reload, MAG favorites migration, and STB-ready telemetry.
 *
 * Uses `fetch` instead of jQuery for HTTP requests.
 */

import { providerGetItem, providerSetItem } from "../storage";
import { client_feedb, innerStyle, pperf_stamp } from "../utils/helpers";

/**
 * Report a diagnostic message to the server via `/report_feedb`.
 *
 * @param msg - The message string to report.
 */
function reportBenchy(msg: string): void {
    client_feedb(msg);
}

/**
 * Test CSSOM injection integrity via `innerStyle`.
 *
 * @sideEffects
 * Calls `innerStyle.init()` and `innerStyle.getRule()` for several
 * selectors, then verifies the rule is applied to the `#launch` element.
 * Reports failures via `client_feedb`.
 */
export function benchy_CSSJS(): void {
    var t: string[] = [];
    try {
        innerStyle.init();
        innerStyle.getRule(".testRule1");
        innerStyle.getRule(".testRule3");
        innerStyle.getRule(".testRule2");
        var e = innerStyle.getRule("#launch");
        if (typeof e === "undefined")
            throw new Error("getRule element is undefined");
        if (e.selectorText !== "#launch")
            throw new Error("getRule bad selector: " + e.selectorText);
        var r = document.getElementById("launch");
        if (r === null) throw new Error("#launch element not found");
        var s = window.getComputedStyle(r, undefined).top;
        e.style.setProperty("top", "1px", undefined);
        if (window.getComputedStyle(r, undefined).top === s)
            throw new Error(
                "style not applied " + window.getComputedStyle(r, undefined).top
            );
    } catch (e) {
        if (!ErrToStr(e, t)) ErrToStr(new Error("" + e), t);
        client_feedb("benchy_CSSJS::ERR::\n" + t.join("\n"));
    }
}

var benchy_last_js = "";
var benchy_last_css = "";

/**
 * Poll `/version/...` for changed hashes; on change, `eval()` the new
 * stbPlayer.js and inject the new 1280.css as a `<style>` element.
 *
 * @sideEffects
 * Performs AJAX fetches to `/version/stbPlayer/stbPlayer.js` and
 * `/version/stbPlayer/1280.css`. On hash change, re-evaluates JS and
 * injects a fresh `<style>` tag into `<head>`.
 */
export function benchy_CSSJS_LIVE(): void {
    var base =
        typeof (window as any).host === "string" ? (window as any).host : "";
    var jsUrl = base + "/version/stbPlayer/stbPlayer.js";
    var cssUrl = base + "/version/stbPlayer/1280.css";

    fetch(jsUrl, { method: "GET" })
        .then(function (r) {
            return r.json();
        })
        .then(function (r: any) {
            if (r && r.hash && r.hash !== benchy_last_js) {
                benchy_last_js = r.hash;
                fetch(base + "/stbPlayer/stbPlayer.js?_=" + r.hash, {
                    method: "GET",
                })
                    .then(function (resp) {
                        return resp.text();
                    })
                    .then(function (d: string) {
                        try {
                            // eslint-disable-next-line no-eval
                            eval(d);
                            console.log("[live] stbPlayer.js reloaded");
                        } catch (e) {
                            console.error(e);
                        }
                    });
            }
        })
        .catch(function () {});

    fetch(cssUrl, { method: "GET" })
        .then(function (r) {
            return r.json();
        })
        .then(function (r: any) {
            if (r && r.hash && r.hash !== benchy_last_css) {
                benchy_last_css = r.hash;
                fetch(base + "/stbPlayer/1280.css?_=" + r.hash, {
                    method: "GET",
                })
                    .then(function (resp) {
                        return resp.text();
                    })
                    .then(function (d: string) {
                        var s = document.createElement("style");
                        s.textContent = d;
                        document.head.appendChild(s);
                        console.log("[live] 1280.css reloaded");
                    });
            }
        })
        .catch(function () {});
}

/**
 * No-op debug hook guarded on `__iid === "blablabla"`.
 *
 * @sideEffects
 * Only reports via `client_feedb` when the debug guard is active.
 */
export function benchy_fixSettings(): void {
    var t: string[] = [];
    var iid = (window as any).__iid;
    if (typeof iid === "string" && iid === "blablabla") {
        try {
            t.push("debug: " + "blablabla");
            if (t.length !== 0) throw "complete";
        } catch (e) {
            var r =
                "benchy-FIX-0311::" +
                t.join("--") +
                "::" +
                (typeof e === "string" ? e : (e as Error).message);
            client_feedb(r);
        }
    }
}

/**
 * Migrate `localStorage fav_*` keys to the provider storage (MAG only).
 *
 * @sideEffects
 * Iterates `localStorage`, copies any key starting with `fav_` into the
 * provider namespace via `providerSetItem`, and reports the migration.
 */
export function fix_mag_favoritesArray(): void {
    var t: string[] = [];
    var ott_device = (window as any).ott_device;
    if (typeof ott_device === "string" && ott_device === "mag") {
        try {
            if (typeof localStorage !== "undefined") {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf("fav_") === 0) {
                        t.push(k);
                        var v = localStorage.getItem(k);
                        if (v && typeof providerSetItem === "function") {
                            providerSetItem(k, v);
                        }
                    }
                }
            }
            if (t.length > 0) {
                client_feedb("benchyMagFav::migrated::" + t.join("--"));
            }
        } catch (e) {
            var r =
                "benchyMagFav::ERR::" +
                t.join("--") +
                "::" +
                (typeof e === "string" ? e : (e as Error).message);
            client_feedb(r);
        }
    }
}

/**
 * Start the live CSS/JS reload interval.
 *
 * @sideEffects
 * Calls `benchy_CSSJS_LIVE()` immediately and then every 30 seconds.
 */
export function benchy_showPlayer(): void {
    if (typeof benchy_CSSJS_LIVE === "function") {
        benchy_CSSJS_LIVE();
        setInterval(benchy_CSSJS_LIVE, 30000);
    }
}

/**
 * Entry point called from `startPlayer()`.
 *
 * @sideEffects
 * Runs `benchy_fixSettings()` then `benchy_CSSJS()`.
 */
export function benchy_startPlayer(): void {
    if (typeof benchy_fixSettings === "function") benchy_fixSettings();
    if (typeof benchy_CSSJS === "function") benchy_CSSJS();
}

/**
 * Called from `onStbReady()`.
 *
 * @sideEffects
 * Records a `pperf_stamp` and increments the `stb_ready_count` counter.
 */
export function benchy_stbReady(): void {
    pperf_stamp("stb ready");
    try {
        if (typeof providerGetItem === "function") {
            var d = providerGetItem("stb_ready_count") || "0";
            providerSetItem(
                "stb_ready_count",
                String((parseInt(d, 10) || 0) + 1)
            );
        }
    } catch (e) {
        // ignore
    }
}

/**
 * Push an error value into an array of strings, returning `true` on success.
 */
function ErrToStr(e: unknown, t: string[]): boolean {
    try {
        if (typeof e === "string") {
            t.push(e);
            return true;
        }
        if (e && (e as Error).message) {
            t.push((e as Error).message as string);
            return true;
        }
        if (e && (e as Error).name) {
            t.push((e as Error).name + ": " + ((e as Error).message || ""));
            return true;
        }
        try {
            t.push(JSON.stringify(e));
            return true;
        } catch (_e) {}
        t.push(String(e));
        return true;
    } catch (_e) {
        return false;
    }
}

// Expose globals expected by legacy code and provider scripts
(window as any).benchy = {
    CSSJS: benchy_CSSJS,
    CSSJS_LIVE: benchy_CSSJS_LIVE,
    fix_mag_favoritesArray: fix_mag_favoritesArray,
    fixSettings: benchy_fixSettings,
    showPlayer: benchy_showPlayer,
    startPlayer: benchy_startPlayer,
    stbReady: benchy_stbReady,
};
