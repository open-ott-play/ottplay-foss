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
    var scans = catalog.sourceScans;
    var found: any = null;
    var matches = 0;
    if (Array.isArray(scans))
        scans.forEach(function (scan: any) {
            if (scan && scan.sourceId === source) {
                found = scan;
                matches++;
            }
        });
    var status = (window as any).OttPlayCore.localSourceScanStatus(
        scans !== undefined,
        Array.isArray(scans),
        matches,
        found && found.generation,
        found && found.state
    );
    if (status === "invalid")
        throw {
            localMediaCode: "catalog_unavailable",
            message: "Invalid local source scan",
        };
    if (status === "legacy") return null;
    // Keep host record identity and the existing pending/error presentation.
    return found || { generation: 0, state: "pending" };
}

/** A playback selection never removes a connected source or grants file access. */
export function createLocalPlaybackSelection(
    w: any,
    identity: () => string
): any {
    var key = "localMediaPlaybackSelection";
    var pending: string[] | null = null;
    var orderKey = "";
    var orderedIds: string[] = [];
    function order(items: any[], value: any, scan: any): any[] {
        if (items.length > 50000) throw { localMediaCode: "too_many_items" };
        if (value.seed === null) return items;
        var nextKey = JSON.stringify([
            value.library,
            value.source,
            value.seed,
            scan && scan.generation,
        ]);
        if (nextKey !== orderKey) {
            orderKey = nextKey;
            orderedIds = [];
        }
        var byId: any = Object.create(null);
        items.forEach(function (item) {
            byId[item.id] = item;
        });
        var retained: any[] = [];
        orderedIds.forEach(function (id) {
            if (byId[id]) {
                retained.push(byId[id]);
                delete byId[id];
            }
        });
        var added = items.filter(function (item) {
            return !!byId[item.id];
        });
        var result = retained.concat(orderLocalItems(added, value.seed));
        orderedIds = result.map(function (item) {
            return item.id;
        });
        return result;
    }
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
            orderKey = "";
            orderedIds = [];
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
            orderKey = "";
            orderedIds = [];
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
                    item.playback?.mode !== "unsupported" &&
                    !!item.url
                );
            });
            return {
                ...catalog,
                // Playback can start from the first owned source item. The
                // provider appends discoveries while retaining its active ID.
                items:
                    (scan && !scan.generation) ||
                    (!scan && value.seed !== null && scanning)
                        ? []
                        : order(items, value, scan),
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
            orderKey = "";
            orderedIds = [];
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
