/**
 * Timezone utilities for OTT-play FOSS
 */

import { settings } from "../settings";

/**
 * Configure the timezone offset for archive/programme time display.
 * Reads settings.timezone and sets window.arrTimezone.
 */
export function setTimezone(): void {
    var tz = settings.timezone;
    var arrTimezone = (window as any).arrTimezone || ["system", "0"];
    (window as any).arrTimezone = arrTimezone;
    if (tz >= 0 && tz < arrTimezone.length) {
        var curTimezone = arrTimezone[tz] || arrTimezone[0];
        if (curTimezone === "system") {
            (window as any).arrTimezone = [
                "system",
                "" + new Date().getTimezoneOffset(),
            ];
        }
    }
}
