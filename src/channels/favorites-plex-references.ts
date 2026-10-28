/** Source-owned Plex projection. Rating keys stay strings; generic references are unchanged. */
export function createPlexFavoriteReferences(channels: any, proof: any) {
    function rating(value: any): string | null {
        var match =
            typeof value === "string" &&
            /^plex-([1-9][0-9]{0,19})(?![\s\S])/.exec(value);
        return match ? match[1] : null;
    }
    function current(): boolean {
        try {
            return proof && proof.verified === true && proof.current();
        } catch (_) {
            return false;
        }
    }
    function available(key: string): boolean {
        var id = rating(key),
            row =
                channels &&
                Object.prototype.hasOwnProperty.call(channels, key) &&
                channels[key];
        var item = row && row.__ottMediaItem;
        return (
            !!id &&
            current() &&
            !!item &&
            item.plexSource === proof.sourceId &&
            item.request &&
            Object.keys(item.request).join(",") === "path" &&
            item.request.path === "/library/metadata/" + id
        );
    }
    return {
        project: function (reference: any): string | null {
            var item = reference && reference.itemId;
            if (typeof item !== "string" || item.slice(0, 8) !== "channel:")
                return null;
            var key = item.slice(8);
            return available(key) ? key : null;
        },
        resolve: function (value: any, origin: "raw" | "canonical") {
            if (typeof value === "string" && available(value))
                return { itemId: "channel:" + value };
            return { legacyId: value, origin: origin };
        },
    };
}
(window as any).__ottFavoritesPlexReferences = {
    create: createPlexFavoriteReferences,
};
