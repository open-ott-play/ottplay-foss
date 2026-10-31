import {
    encodeBoundedUtf8,
    parseBoundedJson,
} from "../commands/favorites-document-json";

export const TORRENT_CATALOG_BYTES = 8388608;
export function torrentUtf8(
    value: string,
    maximum = TORRENT_CATALOG_BYTES
): Uint8Array {
    return encodeBoundedUtf8(value, maximum);
}
export function torrentKeys(value: any, keys: string[]): boolean {
    return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).sort().join(",") === keys.slice().sort().join(",") &&
        keys.every(function (key) {
            var descriptor = Object.getOwnPropertyDescriptor(value, key);
            return !!descriptor && "value" in descriptor;
        })
    );
}
export function torrentInteger(value: any, maximum: number): boolean {
    return (
        typeof value === "number" &&
        isFinite(value) &&
        Math.floor(value) === value &&
        value >= 0 &&
        value <= maximum
    );
}
export function torrentId(value: any): boolean {
    return (
        typeof value === "string" &&
        /^[A-Za-z0-9_-]{1,64}(?![\s\S])/.test(value)
    );
}
function torrentCatalogText(value: any, units: number, bytes: number): boolean {
    if (
        typeof value !== "string" ||
        !value ||
        value.length > units ||
        /[\x00-\x1f\x7f-\x9f]/.test(value)
    )
        return false;
    try {
        torrentUtf8(value, bytes);
        return true;
    } catch (_) {
        return false;
    }
}
function torrentCatalogLabel(value: any): boolean {
    return torrentCatalogText(value, 256, 1024) && value === value.trim();
}
export function torrentSource(value: any): boolean {
    if (!torrentCatalogText(value, 8192, 8192) || /\s/.test(value))
        return false;
    if (/^magnet:\?/i.test(value)) return true;
    try {
        var url = new URL(value);
        return (
            /^https?:$/.test(url.protocol) &&
            !!url.hostname &&
            !url.username &&
            !url.password &&
            /\.torrent$/i.test(url.pathname)
        );
    } catch (_) {
        return false;
    }
}
export function torrentFiles(value: any): any[] | null {
    if (!Array.isArray(value) || value.length > 4096) return null;
    var seen: any = Object.create(null),
        files: any[] = [];
    for (var i = 0; i < value.length; i++) {
        var file = value[i];
        if (
            !torrentKeys(file, ["index", "name", "length"]) ||
            !torrentInteger(file.index, 999999999) ||
            seen[file.index] ||
            !torrentInteger(file.length, 9007199254740991) ||
            !torrentCatalogText(file.name, 4096, 16384) ||
            !/\.(mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mpg|mpeg|ogv)$/i.test(
                file.name
            )
        )
            return null;
        seen[file.index] = true;
        files.push({ index: file.index, length: file.length, name: file.name });
    }
    return files;
}
/** Validate without coercing, dropping fields, trimming or replacing content. */
export function normalizeTorrentCatalog(value: any): any | null {
    if (
        !torrentKeys(value, ["schema", "id", "name", "entries"]) ||
        value.schema !== 1 ||
        !torrentId(value.id) ||
        !torrentCatalogLabel(value.name) ||
        !Array.isArray(value.entries) ||
        value.entries.length > 256
    )
        return null;
    var seen: any = Object.create(null),
        entries: any[] = [],
        total = 0;
    for (var i = 0; i < value.entries.length; i++) {
        var entry = value.entries[i];
        if (
            !torrentKeys(entry, [
                "id",
                "title",
                "category",
                "source",
                "files",
            ]) ||
            !torrentId(entry.id) ||
            seen[entry.id] ||
            !torrentCatalogLabel(entry.title) ||
            !torrentCatalogLabel(entry.category) ||
            !torrentSource(entry.source)
        )
            return null;
        var files = torrentFiles(entry.files);
        if (!files || (total += files.length) > 10000) return null;
        seen[entry.id] = true;
        entries.push({
            category: entry.category,
            files: files,
            id: entry.id,
            source: entry.source,
            title: entry.title,
        });
    }
    return { entries: entries, id: value.id, name: value.name, schema: 1 };
}
export function parseTorrentCatalog(bytes: Uint8Array): any {
    var value = normalizeTorrentCatalog(
        parseBoundedJson(bytes, TORRENT_CATALOG_BYTES, 8, 65536)
    );
    if (!value) throw new Error("invalid_document");
    return value;
}
export function encodeTorrentCatalog(value: any): Uint8Array {
    var normalized = normalizeTorrentCatalog(value);
    if (!normalized) throw new Error("invalid_document");
    return torrentUtf8(JSON.stringify(normalized));
}

if (typeof window !== "undefined")
    (window as any).__ottTorrentCodec = {
        encode: encodeTorrentCatalog,
        files: torrentFiles,
        normalize: normalizeTorrentCatalog,
        parse: parseTorrentCatalog,
        source: torrentSource,
        utf8: torrentUtf8,
    };
