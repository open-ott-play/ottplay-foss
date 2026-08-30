// Settings helpers and timezone utilities

import { settings } from "../settings";

/**
 * Apply the configured timezone offset from settings.
 * Currently a stub — reads settings.timezone but performs no actual offset.
 * Reserved for future use (e.g. shifting EPG times).
 */
export function setTimezone(): void {
    var tz = settings.timezone;
    if (tz) {
        // Apply timezone offset
    }
}
