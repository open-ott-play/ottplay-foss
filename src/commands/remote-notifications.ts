function persistedValue(w: any): string | null {
    if (typeof w.stbGetNotificationSetting !== "function")
        throw new Error("storage_unavailable");
    var value = w.stbGetNotificationSetting();
    if (value !== null && value !== "0" && value !== "1")
        throw new Error("storage_unavailable");
    return value;
}

/** Installation policy: never resolve this key through a provider/profile. */
export function readNotificationsEnabled(w: any): boolean {
    try {
        return persistedValue(w) !== "0";
    } catch (_) {
        // An unreadable policy must not turn a previously disabled receiver on.
        return false;
    }
}
