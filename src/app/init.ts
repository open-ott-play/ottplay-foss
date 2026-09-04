/**
 * Early concat module (MODULES, before index.js).
 *
 * Runtime `startPlayer` / `onStbReady` live in `src/index.ts` (last in MODULES),
 * which overwrites any earlier function of the same name. Device `stb.js` is
 * loaded only from `index.html` — do not re-inject it here.
 *
 * This file keeps the global `window.onerror` handler so it still runs in the
 * classic bundle. Do not add a second auto-start; `index.html` calls
 * `startPlayer()` after `stbPlayer.js` + device `stb.js`.
 */

import { client_feedb } from "../utils/helpers";

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
