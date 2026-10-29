/** Stable provider IDs only here; explicit channel-name locators use their separate exact-match path. */
export function globalFavoriteProviderId(value: any): string | null {
    if (typeof value === "number") {
        if (
            !isFinite(value) ||
            value < 0 ||
            Math.floor(value) !== value ||
            value > 9007199254740991
        )
            return null;
        value = String(value);
    }
    return typeof value === "string" &&
        value.length <= 256 &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
        ? value
        : null;
}
export function globalFavoriteChannelId(
    provider: string,
    row: any
): string | null {
    if (!row) return null;
    var epg =
        provider === "m3u" && globalFavoriteProviderId(row.__ottFavoriteTvgId);
    return epg ? "m3u-epg:" + epg : null;
}
/** Configuration property order is not profile identity (normalizers reorder fields). */
export function globalFavoriteCanonical(value: any): string {
    function ordered(input: any, depth: number): any {
        if (depth > 16) throw new Error("Invalid configuration");
        if (!input || typeof input !== "object") return input;
        if (Array.isArray(input))
            return input.map(function (part) {
                return ordered(part, depth + 1);
            });
        var output: any = Object.create(null);
        Object.keys(input)
            .sort()
            .forEach(function (key) {
                output[key] = ordered(input[key], depth + 1);
            });
        return output;
    }
    return JSON.stringify(ordered(value, 0));
}
