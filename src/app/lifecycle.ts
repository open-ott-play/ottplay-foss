/**
 * Lifecycle handlers (page unload, visibility change) and media detection
 * for OTT-play FOSS.
 */

import { setCurrent } from "../channels";
import { settings } from "../settings";

// ponytail: mediaCheckTimer must live here so checkMedia() can reference it
// without crossing module boundaries too much.
export let mediaCheckTimer: any = null;

/**
 * Persist the current channel position and reset playType on page unload.
 * Also reports Maple 6 performance stamps.
 *
 * Side effects: Calls setCurrent(); sets window.playType = 0.
 */
export function body_onUnload(): void {
    setCurrent((window as any).catIndex, (window as any).primaryIndex);
    (window as any).playType = 0;
    // Report collected Maple 6 performance stamps — server appends to feedback.log
    var perf: string = (window as any).pperf_flush();
    if (perf) (window as any).PostFeedback(perf);
}

/**
 * Handle visibilitychange. When the page becomes hidden, persist state.
 */
export function body_onUnloadHidden(): void {
    if (document.hidden) body_onUnload();
}

/**
 * Detect archive recording (finite duration > 180s, < 1,000,000s) and
 * switch playType accordingly.
 *
 * Side effects: Updates window.playType / window.playTime; calls
 * updateMediaInfoDisplay(); clears mediaCheckTimer.
 */
export function checkMedia(): void {
    clearTimeout(mediaCheckTimer);
    var video = (window as any).video;
    if (video) {
        var duration = (window as any).stbGetLen();
        if (
            duration &&
            duration > 180 &&
            duration !== Number.POSITIVE_INFINITY &&
            duration < 1000000
        ) {
            (window as any).playTime = 0;
            (window as any).playType = -99999999999;
            (window as any).updateMediaInfoDisplay();
        }
    }
}

// Attach lifecycle listeners once (module-level side-effect; runs on import)
if (
    typeof navigator !== "undefined" &&
    navigator.userAgent.search(/Maple/i) === -1
) {
    if (document.addEventListener) {
        document.addEventListener("visibilitychange", body_onUnloadHidden);
    } else if ((document as any).attachEvent) {
        (document as any).attachEvent(
            "onvisibilitychange",
            body_onUnloadHidden
        );
    }
    if (typeof window !== "undefined") {
        if (window.addEventListener) {
            try {
                window.addEventListener("beforeunload", body_onUnload);
            } catch {
                /* ignore */
            }
            try {
                window.addEventListener("unload", body_onUnload);
            } catch {
                /* ignore */
            }
        } else if ((window as any).attachEvent) {
            (window as any).attachEvent("onbeforeunload", body_onUnload);
            (window as any).attachEvent("onunload", body_onUnload);
        }
    }
}
