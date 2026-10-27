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

/** Native source completion is scoped to the same atomic catalogue snapshot. */
export function localSourceScan(catalog: any, source: string): any {
    if (catalog.sourceScans === undefined) return null;
    function invalid(): never {
        throw {
            localMediaCode: "catalog_unavailable",
            message: "Invalid local source scan",
        };
    }
    if (!Array.isArray(catalog.sourceScans)) return invalid();
    var found: any = null;
    catalog.sourceScans.forEach(function (scan: any) {
        if (!scan || scan.sourceId !== source) return;
        if (
            found ||
            typeof scan.generation !== "number" ||
            !isFinite(scan.generation) ||
            Math.floor(scan.generation) !== scan.generation ||
            scan.generation < 1 ||
            scan.generation > 9007199254740991 ||
            ["pending", "scanning", "complete", "error"].indexOf(scan.state) < 0
        )
            invalid();
        found = scan;
    });
    // An advertised source protocol cannot fall back to global completion
    // before the requested folder has an authoritative scan record.
    return found || { generation: 0, state: "pending" };
}

/** A playback selection never removes a connected source or grants file access. */
export function createLocalPlaybackSelection(
    w: any,
    identity: () => string
): any {
    var key = "localMediaPlaybackSelection";
    var pending: string[] | null = null;
    function read(requireContext = true): any {
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
        return !requireContext || value.library === identity() ? value : null;
    }
    return {
        clear: function (): void {
            w.stbSetItem(key, "");
            pending = null;
        },
        clearSource: function (id: string): boolean {
            // A disconnected binding may be selected by another saved profile.
            var value = read(false);
            if (!value || value.source !== id) return false;
            w.stbSetItem(key, "");
            if (w.stbGetItem(key))
                throw new Error(
                    "The disconnected local source selection could not be cleared"
                );
            pending = null;
            return true;
        },
        filter: function (catalog: any): any {
            var value = read();
            if (!value) return catalog;
            var scan = localSourceScan(catalog, value.source);
            if (scan && scan.state === "error")
                throw new Error(
                    "The selected local source could not be scanned"
                );
            var scanning = scan
                ? scan.state !== "complete"
                : !!catalog.scanning;
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
                    (value.seed !== null || scan) && scanning
                        ? []
                        : orderLocalItems(items, value.seed),
                scanError:
                    scan && scan.generation ? undefined : catalog.scanError,
                scanning: scanning,
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
        source: function (): string | undefined {
            var value = read();
            return value ? value.source : undefined;
        },
    };
}
