/**
 * Sleep timer — setSleepTimeout leaf (Phase C).
 *
 * Moved from src/index.ts. Keeps a module-local sleepTimer binding
 * (app/state is OFF MODULES — do not import setSleepTimer from there).
 */
import { stbIsStandby, stbToggleStandby } from "../core";
import { settings } from "./index";

/** Module-local timer handle (matches former index.ts var). */
var sleepTimer: any = null;

/**
 * Set (or clear) the sleep timer using the selected inactivity duration.
 * The player enters standby via stbToggleStandby().
 *
 * Side effects: Sets/clears a setTimeout; calls stbToggleStandby() when
 * the timer fires.
 */
export function setSleepTimeout(): void {
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = null;
    const durations = [0, 30, 60, 120, 180];
    const minutes = durations[settings.sleepTimeout] || 0;
    if (minutes > 0 && !stbIsStandby()) {
        sleepTimer = setTimeout(
            function () {
                // A cancelled timeout may already be queued; never wake a sleeping player.
                if (stbIsStandby()) return;
                if (typeof window.stbToggleStandby === "function")
                    window.stbToggleStandby();
                else stbToggleStandby();
            },
            minutes * 60 * 1000
        );
    }
}
