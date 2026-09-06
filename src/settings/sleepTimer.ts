/**
 * Sleep timer — setSleepTimeout leaf (Phase C).
 *
 * Moved from src/index.ts. Keeps a module-local sleepTimer binding
 * (app/state is OFF MODULES — do not import setSleepTimer from there).
 */
import { stbToggleStandby } from "../core";
import { settings } from "./index";

/** Module-local timer handle (matches former index.ts var). */
var sleepTimer: any = null;

/**
 * Set (or clear) the sleep timer. After settings.sleepTimeout minutes,
 * the player enters standby via stbToggleStandby().
 *
 * Side effects: Sets/clears a setTimeout; calls stbToggleStandby() when
 * the timer fires.
 */
export function setSleepTimeout(): void {
    if (sleepTimer) clearTimeout(sleepTimer);
    if (settings.sleepTimeout > 0) {
        sleepTimer = setTimeout(
            function () {
                stbToggleStandby();
            },
            settings.sleepTimeout * 60 * 1000
        );
    }
}
