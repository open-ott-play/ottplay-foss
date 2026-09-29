/** Comparison key using the host's Unicode casing tables, without normalization. */
export function caselessKey(value: string): string {
    // Lowercase first lets capital sharp S expand; uppercase unifies both sigmas.
    // Default (non-Turkic) folding keeps dotless i distinct from ASCII i.
    if (value.indexOf("\u0131") < 0) return value.toLowerCase().toUpperCase();
    return value.replace(/[^\u0131]+/g, function (part) {
        return part.toLowerCase().toUpperCase();
    });
}
