/** A stable catalogue plus a small seed reproduces the whole shuffled folder. */
export function orderLocalItems(items: any[], seed: number | null): any[] {
    var result = items.slice();
    if (seed === null) return result;
    result.sort(function (left, right) {
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    var state = seed || 1;
    for (var i = result.length - 1; i > 0; i--) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        var j = Math.floor(((state >>> 0) / 4294967296) * (i + 1));
        var item = result[i];
        result[i] = result[j];
        result[j] = item;
    }
    return result;
}

/** A playback selection never removes a connected source or grants file access. */
export function createLocalPlaybackSelection(
    w: any,
    identity: () => string
): any {
    var key = "localMediaPlaybackSelection";
    var pending: string[] | null = null;
    function read(): any {
        var raw = w.stbGetItem(key);
        if (!raw) return null;
        var value = JSON.parse(raw);
        if (
            !value ||
            value.version !== 1 ||
            typeof value.library !== "string" ||
            typeof value.source !== "string" ||
            !value.source ||
            Object.keys(value).sort().join(",") !==
                "library,seed,source,version" ||
            (value.seed !== null &&
                (typeof value.seed !== "number" ||
                    !isFinite(value.seed) ||
                    value.seed < 1 ||
                    value.seed > 4294967295 ||
                    Math.floor(value.seed) !== value.seed))
        )
            throw new Error("Invalid local playback selection");
        return value.library === identity() ? value : null;
    }
    return {
        clear: function (): void {
            w.stbSetItem(key, "");
            pending = null;
        },
        filter: function (catalog: any): any {
            var value = read();
            if (!value) return catalog;
            var sources = (catalog.sources || []).filter(function (
                source: any
            ) {
                return source.id === value.source;
            });
            if (!sources.length && !catalog.scanning)
                throw new Error("The selected local source is unavailable");
            var items = (catalog.items || []).filter(function (item: any) {
                return (
                    item.sourceId === value.source &&
                    item.available !== false &&
                    !!item.url
                );
            });
            return {
                ...catalog,
                // A seeded permutation needs the full set. No partial scan may
                // publish an order that changes again under an active decoder.
                items:
                    value.seed !== null && catalog.scanning
                        ? []
                        : orderLocalItems(items, value.seed),
                sources: sources,
            };
        },
        order: function (): string[] | null {
            return pending && pending.slice();
        },
        ordered: function (): void {
            pending = null;
        },
        select: function (
            source: string,
            ids: string[],
            seed: number | null = null
        ): void {
            var value = JSON.stringify({
                library: identity(),
                seed: seed,
                source: source,
                version: 1,
            });
            w.stbSetItem(key, value);
            if (w.stbGetItem(key) !== value)
                throw new Error(
                    "The local playback selection could not be saved"
                );
            pending = ids.map(function (id) {
                return "local-" + id;
            });
        },
    };
}
