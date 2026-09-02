/**
 * Initialization module for OTT-play FOSS
 * Handles player startup, DOM ready events, and initial setup
 */

export const PLAYER_VERSION = "__OTTP_VERSION__";

// duneAddSettings — set by provider scripts (stalker, edem, etc.)
declare var duneAddSettings: ((_index: number) => void) | null;

import { benchy_startPlayer, benchy_stbReady } from "../benchy";
import { cats, catsArray, sPlayers, sStopPlay } from "../channels";
import {
    setPlayer,
    setPlayerMode,
    stbExit,
    stbInit,
    stbPlay,
    stbSetBuffer,
    stbStop,
} from "../core";
import { dispatchKey, keyHandler, keys } from "../keyhandler";
import { _ } from "../localization";
import { loadChannels, loadProv } from "../provider";
import { loadSettings, settings } from "../settings";
import { setTimezone } from "../settings/helpers";
import { providerGetJson, stbGetItem, stbSetItem, storage } from "../storage";
import { closeList, initBackgroundIntervals, uiInit } from "../ui";
import { client_feedb, getScriptDOM } from "../utils/helpers";
import {
    setColor,
    setEditor,
    setFontSize,
    setListPos,
    setPipPosBuf,
    setSleepTimeout,
} from "../view/display-helpers";
import { initUIReferences } from "../view/ui-helpers";
import { applySettingsToWindow } from "./apply-settings";
import { __av, __cv, detectDevice, ott_device } from "./device";
import { selectLang } from "./language";
import {
    hostUrl,
    popupActions,
    popupArray,
    popupDetail,
    savedPopup,
    TMDb,
    version,
} from "./state";

/**
 * Called when player starts. Placeholder for performance stamping.
 */
export function onPlayerStart(): void {
    if (typeof (window as any).pperf_stamp === "function")
        (window as any).pperf_stamp("onPlayerStart");
    console.log("onPlayerStart");
}

/**
 * Callback invoked after a language script has been loaded.
 * Delegates to loadChannels(), then configures the player mode and player.
 */
export function loadProvCallback(): void {
    if (typeof (window as any).pperf_stamp === "function")
        (window as any).pperf_stamp("loadProvCallback");
    if (typeof loadChannels === "function") loadChannels();
    setPlayerMode(sPlayers);
    if (typeof setPlayer === "function") setPlayer();
}

/**
 * Main entry point — called once the DOM is ready.
 */
export function startPlayer(): void {
    // Detect device type and expose globals for provider scripts
    (window as any).ott_device = ott_device;
    (window as any).detectDevice = detectDevice;
    var launchEl = document.getElementById("launch");
    if (launchEl) {
        launchEl.innerHTML += "<br/>VER: " + PLAYER_VERSION;
    }

    onPlayerStart();

    try {
        if (typeof (window as any).pperf_stamp === "function")
            (window as any).pperf_stamp("startPlayer -- start");
        console.log("startPlayer");

        if (launchEl) {
            launchEl.innerHTML +=
                '<img src="' +
                hostUrl +
                "/stbPlayer/icon.png?" +
                PLAYER_VERSION +
                '" style="position: absolute; left: 100px; bottom:100px;" height="30%" alt=""/>';
        }

        storage.reset();

        // Inject device stub script
        var stubScript = document.createElement("script");
        stubScript.src = hostUrl + "/stb/" + ott_device + "/stb.js?" + __cv;
        stubScript.onload = function () {
            if (typeof startPlayer === "function") startPlayer();
            else console.error("startPlayer not defined");
        };
        document.head.appendChild(stubScript);

        // Inject 1280.css stylesheet
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = hostUrl + "/stbPlayer/1280.css?" + __av;
        link.media = "only screen";
        link.onload = function () {
            link.media = "all";
        };
        document.head.appendChild(link);

        benchy_startPlayer();

        uiInit();
        initBackgroundIntervals();
        (window as any).listPodval = (window as any).listPodvalElement;
        if (typeof stbInit === "function" && (stbInit() as any) !== false) {
            onStbReady();
        }
    } catch (e) {
        if (launchEl) {
            launchEl.innerHTML +=
                "<br/><br/><b>Exception:</b> name " +
                e.name +
                ", message " +
                e.message;
        }
        console.error(e);
    }
}

/**
 * Called after stbInit() completes. Responsible for:
 * - Merging device-specific key mappings
 * - Loading all settings from storage
 * - Syncing PlayerSettings to window.* globals
 * - Initialising UI references and applying visual settings
 * - Saving the current popup state for provider-switch restoration
 * - Loading the language file and then launching the provider / options
 * - Preparing TMDb if available
 */
export function onStbReady(): void {
    if (typeof (window as any).pperf_stamp === "function")
        (window as any).pperf_stamp("onStbReady -- start");

    try {
        // Merge device-specific key mappings from window.keys (set by stb/{device}/stb.js)
        if (typeof (window as any).keys !== "undefined") {
            Object.assign(keys, (window as any).keys);
        }
        loadSettings();
        applySettingsToWindow(settings);
        initUIReferences();

        if (typeof stbSetBuffer === "function") stbSetBuffer();
        setTimezone();
        setFontSize();
        setListPos();
        setColor();
        setEditor();
        setPipPosBuf();
        setSleepTimeout();
        closeList();

        // Expose edit globals for provider scripts (stalker, edem, etc.)
        if (typeof (window as any).editKey === "undefined")
            (window as any).editKey = (window as any).editKey1;
        if (typeof (window as any).showEditKey === "undefined")
            (window as any).showEditKey = (window as any).showEditKey1;

        if (typeof (window as any).pperf_stamp === "function")
            (window as any).pperf_stamp("startPlayer -- control 1");

        // Save current popup state (read by loadProv when switching providers)
        savedPopup.popupActions = popupActions.slice();
        savedPopup.popupArray = popupArray.slice();
        savedPopup.popupDetail = popupDetail.slice();
        savedPopup.ver = version;

        var lang = stbGetItem("ottplaylang");
        var launchEl = document.getElementById("launch");
        if (!lang) {
            console.log("TRACE no lang, calling selectLang()");
            if (launchEl) {
                launchEl.innerHTML += "<br/><b>No language selected !!!</b>";
                launchEl.style.display = "none";
            }
            selectLang();
            return;
        }

        console.log("TRACE lang=" + lang + ", loading langJS");
        if (typeof (window as any).pperf_stamp === "function")
            (window as any).pperf_stamp("startPlayer -- loadLang -- js");
        getScriptDOM(
            hostUrl + "/stbPlayer/" + lang + ".js?" + PLAYER_VERSION,
            function () {
                console.log("TRACE langJS loaded (onStbReady path)");
                if (typeof duneAddSettings !== "function") loadProv();
                else if (typeof (window as any).optionsList === "function")
                    (window as any).optionsList(selectLang);
            },
            function () {
                var el = document.getElementById("launch");
                if (el) {
                    el.innerHTML += "<br/><b>No language selected !!!</b>";
                    el.style.display = "none";
                }
                selectLang();
            }
        );

        if (TMDb && TMDb.prepare) TMDb.prepare();
    } catch (e) {
        var launchEl2 = document.getElementById("launch");
        if (launchEl2) {
            launchEl2.innerHTML +=
                "<br/><br/><b>Exception.StbReady:</b> name " +
                e.name +
                ", message " +
                e.message;
        }
        console.error(e);
    }
}

// Global error handler (legacy index.html:108-122)
(function () {
    window.onerror = function (
        event: any,
        source: string,
        lineno: number,
        colno: number,
        error: Error | undefined
    ): boolean {
        var etext: string[] = [];
        if (typeof event === "string") {
            etext.push(event || "<no_msg>");
            etext.push(
                (source || "<no_url>") +
                    "__" +
                    (lineno || "??") +
                    ":" +
                    (colno || "??")
            );
            etext.push(
                typeof error === "object" && error !== null
                    ? error.stack || "<no_stack>"
                    : "<no_stack>"
            );
        } else if (event && typeof event === "object") {
            etext.push(event.message || "<no_msg>");
            etext.push(
                (event.filename || "<no_url>") +
                    "__" +
                    (event.lineno || "??") +
                    ":" +
                    (event.colno || "??")
            );
            etext.push(
                typeof event.error === "object"
                    ? event.error.stack
                    : "<no_stack>"
            );
        }
        var errMsg = etext.join("\n");
        console.error("[window.onerror]", errMsg);
        client_feedb("window_onerror::" + errMsg.replace(/\n/g, "__"));
        return true;
    };
})();

// Auto-start when DOM ready
if (
    typeof (window as any).ott_device === "undefined" ||
    (window as any).ott_device === ""
) {
    if (document.readyState === "complete") {
        startPlayer();
    } else {
        document.addEventListener("DOMContentLoaded", startPlayer);
    }
}

console.log("player loaded!");
