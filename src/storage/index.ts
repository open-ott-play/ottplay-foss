/**
 * Storage abstraction layer.
 *
 * Ported from player.js (ottpStorage IIFE, laaMac, provider helpers).
 * Uses localStorage when available, falls back to cookies or session memory.
 * Provides provider-prefixed storage for multi-provider setups.
 *
 * Variable renaming from original JS:
 *   e → key        t → value       r → callback    s → location
 *   n → adapter    i → methodName  o → adapterObj  a → get
 *   c → set        u → del         d → has         p → hasValue
 *   f → clear      h → dump        y → getI        m → setI
 *   l → init       g → prefix
 */

// ---------------------------------------------------------------------------
// External globals (defined in index.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dynamic script loader
// ---------------------------------------------------------------------------

// loadJS and getScriptDOM defined in utils/helpers.ts

// ---------------------------------------------------------------------------
// LZ-String compression (declared here, defined in utils/lzstring.ts which is
// concatenated before storage/index.js by build-concat.cjs)
// ---------------------------------------------------------------------------

declare function compress(uncompressed: string): string;
declare function decompress(compressed: string): string | null;
/** Marker prefix for compressed values */
const LZ_MARKER = "\x01LZ\x01";

// ---------------------------------------------------------------------------
// Storage adapter (localStorage / cookie fallback)
// ---------------------------------------------------------------------------

export interface StorageAdapter {
    clear(): void;
    del(key: string): void;
    dump(): Record<string, string>;
    get(key: string): string | null;
    getI(key: string, defaultValue?: number): number;
    has(key: string): boolean;
    hasValue(key: string): boolean;
    reset(): void;
    set(key: string, value: string): void;
    setI(key: string, value: number): void;
}

function createStorageAdapter(
    get: StorageAdapter["get"],
    set: StorageAdapter["set"],
    del: StorageAdapter["del"],
    clear: StorageAdapter["clear"],
    dump: StorageAdapter["dump"]
): StorageAdapter {
    return {
        clear,
        del,
        dump,
        get,
        getI(key: string, defaultValue = 0): number {
            const value = parseInt(get(key) || "", 10);
            return isNaN(value) ? defaultValue : value;
        },
        has(key: string): boolean {
            return get(key) !== null;
        },
        hasValue(key: string): boolean {
            return (get(key) || "") !== "";
        },
        reset(): void {},
        set,
        setI(key: string, value: number): void {
            set(key, String(value));
        },
    };
}

// -- localStorage implementation ------------------------------------------------

/**
 * Create a `StorageAdapter` backed by `window.localStorage`.
 *
 * @returns A `StorageAdapter` object with all required methods.
 *
 * @remarks
 * Storage access can fail after detection (privacy settings, quota). Failed
 * operations switch to cookies/memory for this session and preserve readable keys.
 */
const STORAGE_FALLBACK_KEYS = "ottplayStorageFallback";
const STORAGE_COOKIE_ATTRIBUTES =
    "; expires=Tue, 19 Jan 2038 03:14:07 GMT; path=/";

/** Internal cookie bookkeeping must never be imported as a user setting. */
export function isStorageMetadataKey(key: string): boolean {
    return (
        key === STORAGE_FALLBACK_KEYS ||
        key.indexOf(STORAGE_FALLBACK_KEYS + ".") === 0
    );
}

function readStorageCookies(): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    try {
        const entries = (document.cookie || "").split(";");
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i].trim();
            const equals = entry.indexOf("=");
            if (equals <= 0) continue;
            let key = "";
            try {
                key = decodeURIComponent(entry.slice(0, equals));
                result[key] = decodeURIComponent(entry.slice(equals + 1));
            } catch (_malformedCookie) {
                // A corrupt marker is incomplete, not an absent override list.
                if (isStorageMetadataKey(key)) result[key] = "";
            }
        }
    } catch (_cookieAccess) {}
    return result;
}

function storageFallbackHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++)
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return (hash >>> 0).toString(36);
}

/** null means incomplete: never replace cookie values with stale native data. */
function readStorageFallback(cookies: Record<string, string>): string[] | null {
    const parts = Object.keys(cookies).filter(function (key) {
        return key.indexOf(STORAGE_FALLBACK_KEYS + ".") === 0;
    });
    const marker = cookies[STORAGE_FALLBACK_KEYS];
    if (marker === undefined) return parts.length ? null : [];
    try {
        let saved = JSON.parse(marker);
        if (!Array.isArray(saved)) {
            if (
                !saved ||
                saved.v !== 2 ||
                !parts.length ||
                saved.n !== parts.length
            )
                return null;
            let value = "";
            for (let i = 0; i < parts.length; i++) {
                const part = cookies[STORAGE_FALLBACK_KEYS + "." + i];
                if (!part) return null;
                value += part;
            }
            if (storageFallbackHash(value) !== saved.h) return null;
            saved = JSON.parse(value);
        } else if (parts.length) return null;
        if (!Array.isArray(saved)) return null;
        for (let i = 0; i < saved.length; i++)
            if (typeof saved[i] !== "string" || isStorageMetadataKey(saved[i]))
                return null;
        return saved;
    } catch (_invalidMarker) {
        return null;
    }
}

function createLocalStorageAdapter(): StorageAdapter {
    let nativeStorage: Storage | null = null;
    try {
        nativeStorage = window.localStorage;
        if (nativeStorage) nativeStorage.getItem("");
    } catch (_error) {
        nativeStorage = null;
    }
    let cookieWrites = true;
    const fallback = createCookieAdapter(function () {
        return cookieWrites;
    });
    const overrides: Record<string, boolean> = Object.create(null);
    const saved = readStorageFallback(readStorageCookies());
    let incomplete = saved === null;
    if (saved)
        saved.forEach(function (key) {
            overrides[key] = true;
        });
    const persistOverrides = function (update?: () => void): void {
        // Commit a small barrier before changing parts. A rejected part/final
        // manifest leaves this barrier visible to both boot and the next adapter.
        fallback.set(STORAGE_FALLBACK_KEYS, "pending");
        const persisted =
            readStorageCookies()[STORAGE_FALLBACK_KEYS] === "pending";
        // Rejected metadata cannot authorize a partly persisted value change.
        // CookieAdapter still keeps the current session's value in memory.
        cookieWrites = persisted;
        if (update) update();
        cookieWrites = true;
        if (!persisted) return;
        // Unknown tombstones cannot be reconstructed from cookie values alone.
        // Keep incomplete state until an explicit successful native clear.
        if (incomplete) return;
        const keys = Object.keys(overrides);
        const value = JSON.stringify(keys).replace(
            /[\u007f-\uffff]/g,
            function (ch) {
                return (
                    "\\u" + ("000" + ch.charCodeAt(0).toString(16)).slice(-4)
                );
            }
        );
        const parts: string[] = [];
        let offset = 0;
        if (keys.length)
            while (offset < value.length) {
                const name = STORAGE_FALLBACK_KEYS + "." + parts.length;
                // RFC 6265's 4096-byte minimum includes name, value and attributes.
                // ASCII-escaped JSON permits safe splits even inside a long key.
                const limit =
                    4096 -
                    encodeURIComponent(name).length -
                    1 -
                    STORAGE_COOKIE_ATTRIBUTES.length;
                let end = offset;
                let bytes = 0;
                while (end < value.length) {
                    const size = encodeURIComponent(value.charAt(end)).length;
                    if (bytes + size > limit) break;
                    bytes += size;
                    end++;
                }
                parts.push(value.slice(offset, end));
                offset = end;
            }
        parts.forEach(function (part, index) {
            fallback.set(STORAGE_FALLBACK_KEYS + "." + index, part);
        });
        const cookies = readStorageCookies();
        for (let i = 0; i < parts.length; i++)
            if (cookies[STORAGE_FALLBACK_KEYS + "." + i] !== parts[i]) return;
        Object.keys(cookies).forEach(function (key) {
            if (key.indexOf(STORAGE_FALLBACK_KEYS + ".") !== 0) return;
            const index = key.slice(STORAGE_FALLBACK_KEYS.length + 1);
            if (
                !/^(0|[1-9][0-9]*)$/.test(index) ||
                Number(index) >= parts.length
            )
                fallback.del(key);
        });
        if (parts.length)
            fallback.set(
                STORAGE_FALLBACK_KEYS,
                JSON.stringify({
                    h: storageFallbackHash(value),
                    n: parts.length,
                    v: 2,
                })
            );
        else fallback.del(STORAGE_FALLBACK_KEYS);
    };
    const mark = function (
        key: string,
        active: boolean,
        update?: () => void
    ): void {
        if (active) overrides[key] = true;
        else delete overrides[key];
        persistOverrides(update);
    };

    // Keep readable settings when a privacy restriction or quota makes the
    // native adapter unusable. Cookie writes also have an in-memory fallback.
    const failover = function (): void {
        const previous = nativeStorage;
        nativeStorage = null;
        if (!previous || incomplete) return;
        try {
            for (let i = 0; i < previous.length; i++) {
                const key = previous.key(i);
                if (key != null && !isStorageMetadataKey(key)) {
                    const value = previous.getItem(key);
                    if (value != null && !overrides[key])
                        fallback.set(key, value);
                }
            }
        } catch (_error) {}
    };
    const get = function (key: string): string | null {
        if (isStorageMetadataKey(key)) return null;
        if (overrides[key] || incomplete) return fallback.get(key);
        if (nativeStorage) {
            try {
                return nativeStorage.getItem(key);
            } catch (_error) {
                failover();
            }
        }
        return fallback.get(key);
    };
    const set = function (key: string, value: string): void {
        if (isStorageMetadataKey(key)) return;
        if (nativeStorage && !incomplete) {
            try {
                nativeStorage.setItem(key, value);
                if (overrides[key])
                    mark(key, false, function () {
                        fallback.del(key);
                    });
                else fallback.del(key);
                return;
            } catch (_error) {
                failover();
            }
        }
        mark(key, true, function () {
            fallback.set(key, value);
        });
    };
    const del = function (key: string): void {
        if (isStorageMetadataKey(key)) return;
        if (nativeStorage && !incomplete) {
            try {
                nativeStorage.removeItem(key);
                if (overrides[key])
                    mark(key, false, function () {
                        fallback.del(key);
                    });
                else fallback.del(key);
                return;
            } catch (_error) {
                failover();
            }
        }
        mark(key, true, function () {
            fallback.del(key);
        });
    };
    const clear = function (): void {
        if (nativeStorage) {
            try {
                nativeStorage.clear();
                Object.keys(fallback.dump()).forEach(function (key) {
                    fallback.del(key);
                });
                Object.keys(overrides).forEach(function (key) {
                    delete overrides[key];
                });
                incomplete = false;
                persistOverrides();
                return;
            } catch (_error) {
                failover();
            }
        }
        const keys = Object.keys(fallback.dump());
        keys.forEach(function (key) {
            overrides[key] = true;
        });
        // Existing deleted overrides have no cookie, but remain tombstones.
        persistOverrides(function () {
            fallback.clear();
        });
    };
    const dump = function (): Record<string, string> {
        if (nativeStorage && !incomplete) {
            try {
                const result: Record<string, string> = {};
                for (let i = 0; i < nativeStorage.length; i++) {
                    const key = nativeStorage.key(i);
                    if (key != null && !isStorageMetadataKey(key)) {
                        const value = nativeStorage.getItem(key);
                        if (value != null) result[key] = value;
                    }
                }
                Object.keys(overrides).forEach(function (key) {
                    const value = fallback.get(key);
                    if (value == null) delete result[key];
                    else result[key] = value;
                });
                return result;
            } catch (_error) {
                failover();
            }
        }
        return fallback.dump();
    };
    return createStorageAdapter(get, set, del, clear, dump);
}

// -- Cookie implementation ------------------------------------------------------

/**
 * Create a `StorageAdapter` backed by `document.cookie`.
 *
 * @returns A `StorageAdapter` object with all required methods.
 *
 * @remarks
 * Cookies use an expiration date in 2038 (far future) for `set` and
 * unix epoch (1970) for `del`. All values are URI-encoded/decoded.
 * The cookie path is always `/`.
 */
function createCookieAdapter(canPersist?: () => boolean): StorageAdapter {
    const values: Record<string, string | null> = Object.create(null);
    let cleared = false;
    const readCookies = function (): Record<string, string> {
        return cleared ? Object.create(null) : readStorageCookies();
    };
    const get = function (key: string): string | null {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            return values[key];
        }
        const cookies = readCookies();
        return Object.prototype.hasOwnProperty.call(cookies, key)
            ? cookies[key]
            : null;
    };
    const set = function (key: string, value: string): void {
        if (!key) return;
        values[key] = String(value);
        if (canPersist && !canPersist()) return;
        try {
            document.cookie =
                encodeURIComponent(key) +
                "=" +
                encodeURIComponent(value) +
                STORAGE_COOKIE_ATTRIBUTES;
        } catch (_cookieAccess) {}
    };
    const del = function (key: string): void {
        values[key] = null;
        if (canPersist && !canPersist()) return;
        try {
            document.cookie =
                encodeURIComponent(key) +
                "=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";
        } catch (_cookieAccess) {}
    };
    const dump = function (): Record<string, string> {
        const result = readCookies();
        for (const key in values) {
            const value = values[key];
            if (value === null) delete result[key];
            else result[key] = value;
        }
        Object.keys(result).forEach(function (key) {
            if (isStorageMetadataKey(key)) delete result[key];
        });
        return result;
    };
    return createStorageAdapter(
        get,
        set,
        del,
        function clear(): void {
            const all = dump();
            for (const key in all) del(key);
            cleared = true;
        },
        dump
    );
}

// ---------------------------------------------------------------------------
// Main storage singleton  (ottpStorage IIFE)
// ---------------------------------------------------------------------------

/**
 * Main application storage adapter.
 *
 * Auto-detects `localStorage` support at module load time. Falls back to
 * cookie-based storage when `localStorage` is unavailable (e.g. STB
 * environments, sandboxed iframes, or privacy-restricted browsers).
 *
 * @remarks
 * The detection test mirrors `client_can.localstorage` from the original
 * player.js. A single `try/catch` wraps `window.localStorage` access.
 */
export const storage: StorageAdapter = (() => {
    var adapter = createLocalStorageAdapter();
    var clear = adapter.clear;
    adapter.clear = function (): void {
        var playback = (window as any).__ottClassicPlayback;
        if (playback) playback.suspendPersistence();
        var guide = (window as any).__ottClassicGuide;
        if (guide) guide.invalidate(false);
        clear();
    };
    return adapter;
})();

/**
 * Classic provider scripts (providers/<id>/provider.js) call bare
 * ottpStorage.del/has/hasValue. Concat const/let bindings stay script-local;
 * a global var plus window.ottpStorage must exist before loadChannels →
 * setPlayer (m3u overwrites global providerHasItemValue to use ottpStorage).
 */
export var ottpStorage: StorageAdapter = storage;
if (typeof window !== "undefined") {
    (window as any).ottpStorage = storage;
}

// ---------------------------------------------------------------------------
// MAC address helpers  (laaMac)
// ---------------------------------------------------------------------------

/**
 * Generate a random MAC address.
 * Original: laaMac inner function t()
 */
function generateMac(): string {
    return "XY:XX:XX:XX:XX:XX".replace(/[XY]/g, (ch: string) => {
        if (ch === "Y") {
            return "26ae".charAt(Math.floor(Math.random() * 4));
        }
        return "0123456789abcdef".charAt(Math.floor(Math.random() * 16));
    });
}

/**
 * Get or generate a MAC address, persisted in storage.
 * Original: laaMac.get
 */
export function getMacAddress(): string {
    return (
        storage.get("laa_mac") ||
        (() => {
            const mac = generateMac();
            storage.set("laa_mac", mac);
            return mac;
        })()
    );
}

// ---------------------------------------------------------------------------
// Provider-prefixed storage
// ---------------------------------------------------------------------------

/** Provider prefix — set via setProviderPrefix() */
let prefix = "";

/**
 * Set the provider prefix for provider-scoped storage keys.
 *
 * @param g - The provider prefix string (appended before every provider key).
 *
 * @remarks
 * All subsequent `provider*` calls will use `prefix + key` as the
 * underlying storage key. This enables multi-provider configurations
 * (e.g. different middleware vendors) to share the same storage
 * namespace without key collisions.
 */
export function setProviderPrefix(g: string): void {
    prefix = g;
}

/** Compression threshold — values larger than this are compressed with lz-string */
const COMPRESS_THRESHOLD = 200; // bytes

/**
 * Get a provider-prefixed storage value, auto-decompressing if the value
 * starts with the LZ-compression marker.
 *
 * @param key - The logical key (without provider prefix).
 * @returns The stored string (decompressed if needed), or `null` if the
 *          key does not exist.
 *
 * @remarks
 * If the raw value starts with `LZ_MARKER` (`\x01LZ\x01`), the marker is
 * stripped and the remainder is decompressed via `decompress()`. If
 * decompression throws (corrupt data), the raw (still-marker-prefixed)
 * value is returned as-is as a fallback.
 */
export function providerGetItem(key: string): string | null {
    var raw = storage.get(prefix + key);
    if (raw && raw.substring(0, LZ_MARKER.length) === LZ_MARKER) {
        try {
            raw = decompress(raw.substring(LZ_MARKER.length)) || "";
        } catch (_) {
            /* return compressed form */
        }
    }
    return raw;
}

/**
 * Check whether a provider-prefixed key exists in storage.
 *
 * @param key - The logical key (without provider prefix).
 * @returns `true` if the key exists (value may be empty string).
 */
export function providerHasItem(key: string): boolean {
    return storage.has(prefix + key);
}

/**
 * Check whether a provider-prefixed key exists with a non-empty value.
 *
 * @param key - The logical key (without provider prefix).
 * @returns `true` if the key exists AND its value is not `''`.
 */
export function providerHasItemValue(key: string): boolean {
    const value = providerGetItem(key);
    return value !== null && value !== "";
}

/**
 * Set a provider-prefixed storage value, auto-compressing if the value
 * exceeds `COMPRESS_THRESHOLD` (200 bytes) and compression reduces size.
 *
 * @param key   - The logical key (without provider prefix).
 * @param value - The string value to store.
 *
 * @remarks
 * Compression is attempted only when `value.length > 200`. The compressed
 * output is stored with the `LZ_MARKER` prefix. If compression does not
 * yield a smaller string (or throws), the value is stored uncompressed.
 *
 * @sideEffects
 * Writes to the underlying storage adapter via `storage.set()`.
 */
export function providerSetItem(key: string, value: string): void {
    if (value.length > COMPRESS_THRESHOLD) {
        try {
            var compressed = compress(value);
            if (compressed.length < value.length) {
                storage.set(prefix + key, LZ_MARKER + compressed);
                return;
            }
        } catch (_) {
            /* fall through to uncompressed */
        }
    }
    storage.set(prefix + key, value);
}

/**
 * Delete a provider-prefixed key from storage.
 *
 * @param key - The logical key (without provider prefix) to delete.
 */
export function providerDelItem(key: string): void {
    storage.del(prefix + key);
}

/**
 * Read a provider-prefixed value and parse it as an integer.
 *
 * @param key          - The logical key.
 * @param defaultValue - Fallback value when the key is missing or the
 *                       stored value is not a valid integer.
 * @returns The parsed integer, or `defaultValue`.
 */
export function providerGetNum(key: string, defaultValue: number): number {
    const parsed = Number.parseInt(providerGetItem(key) || "", 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Read a provider-prefixed value and parse it as JSON.
 *
 * @param key          - The logical key.
 * @param defaultValue - Fallback value returned when the key is missing,
 *                       empty, or contains invalid JSON.
 * @returns The parsed value of type `T`, or `defaultValue` on failure.
 *
 * @remarks
 * If `JSON.parse` throws, the error is silently caught and `defaultValue`
 * is returned.
 */
export function providerGetJson<T>(key: string, defaultValue: T): T {
    const raw = providerGetItem(key);
    if (raw) {
        try {
            return JSON.parse(raw) as T;
        } catch (_e) {
            // fall through to default
        }
    }
    return defaultValue;
}

/**
 * Convenience wrapper around `providerGetItem` that returns an empty
 * string instead of `null` for missing keys.
 *
 * @param key - The logical key (without provider prefix).
 * @returns The stored value, or `''` if the key does not exist.
 */
export function loadValue(key: string): string {
    return providerGetItem(key) || "";
}

// ---------------------------------------------------------------------------
// Global storage aliases (backward compat with stbGetItem etc.)
// ---------------------------------------------------------------------------

/**
 * Backward-compatible alias — retrieve an item from the underlying storage.
 * @see StorageAdapter.get
 */
export const stbGetItem = storage.get;

/**
 * Backward-compatible alias — store an item in the underlying storage.
 * @see StorageAdapter.set
 */
export const stbSetItem = storage.set;

/**
 * Backward-compatible alias — delete an item from the underlying storage.
 * @see StorageAdapter.del
 */
export const stbDelItem = storage.del;

/**
 * Backward-compatible alias — clear all items from the underlying storage.
 * @see StorageAdapter.clear
 */
export const stbClearAllItems = storage.clear;

/**
 * Backward-compatible alias — dump all items from the underlying storage.
 * @see StorageAdapter.dump
 */
export function stbGetAllItems(): Record<string, string> {
    var items = storage.dump();
    Object.keys(items).forEach(function (key) {
        if (key === "__ottKioskV1" || isStorageMetadataKey(key))
            delete items[key];
    });
    return items;
}

/** Credentials, consent and recursive snapshots belong to this installation. */
export function isPortableSettingsKey(key: string): boolean {
    return (
        key !== "__ottKioskV1" &&
        !isStorageMetadataKey(key) &&
        (window as any).OttPlayCore.classicPortableKey(key, true)
    );
}

/** Copy ordinary settings without changing provider payload strings. */
export function portableSettingsSnapshot(
    items: Record<string, any>
): Record<string, any> {
    var result = (window as any).OttPlayCore.classicPortableSnapshot(
        items,
        true
    );
    Object.keys(result).forEach(function (key) {
        if (key === "__ottKioskV1" || isStorageMetadataKey(key))
            delete result[key];
    });
    return result;
}

/** Restore ordinary local backup data without importing remote-control authority. */
export function restoreLocalSettingsSnapshot(items: Record<string, any>): void {
    if ((window as any).__ottKiosk && (window as any).__ottKiosk.enabled())
        return;
    var imported = portableSettingsSnapshot(items);
    var w = window as any;
    var current = w.stbGetAllItems();
    var retained = w.OttPlayCore.classicInstallationState(current, true);
    var address = retained.commandServerAddress;
    var token = retained.commandServerToken;
    var localEnabled = retained.sLocalHttpEnabled;
    var localCode = retained.sLocalHttpDeviceCode;
    // Cancel delivery before clearing storage. Keep this installation's own
    // credentials, but require an explicit reconnect after restoring settings.
    if (w.__ottCommandServer)
        w.__ottCommandServer.configure({
            address: address,
            enabled: false,
            token: token,
        });
    w.stbSetItem("commandServerEnabled", "0");
    if (w.__ottClassicPlayback) w.__ottClassicPlayback.suspendPersistence();
    if (w.__ottClassicGuide) w.__ottClassicGuide.invalidate(false);
    w.stbClearAllItems();
    for (var key in imported) {
        if (Object.prototype.hasOwnProperty.call(imported, key))
            w.stbSetItem(key, imported[key]);
    }
    w.stbSetItem("commandServerAddress", address);
    w.stbSetItem("commandServerToken", token);
    w.stbSetItem("commandServerEnabled", "0");
    // The existing native listener is independent. Preserve current local
    // consent and its code; imported values can neither enable nor replace it.
    w.stbSetItem("sLocalHttpEnabled", localEnabled);
    w.stbSetItem("sLocalHttpDeviceCode", localCode);
}
