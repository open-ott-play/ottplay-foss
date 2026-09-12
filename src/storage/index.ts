/**
 * Storage abstraction layer.
 *
 * Ported from stbPlayer.js (ottpStorage IIFE, laaMac, provider helpers).
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
function createLocalStorageAdapter(): StorageAdapter {
    let nativeStorage: Storage | null = null;
    try {
        nativeStorage = window.localStorage;
        if (nativeStorage) nativeStorage.getItem("");
    } catch (_error) {
        nativeStorage = null;
    }
    const fallback = createCookieAdapter();

    // Keep readable settings when a privacy restriction or quota makes the
    // native adapter unusable. Cookie writes also have an in-memory fallback.
    const failover = function (): void {
        const previous = nativeStorage;
        nativeStorage = null;
        if (!previous) return;
        try {
            for (let i = 0; i < previous.length; i++) {
                const key = previous.key(i);
                if (key != null) {
                    const value = previous.getItem(key);
                    if (value != null) fallback.set(key, value);
                }
            }
        } catch (_error) {}
    };
    const get = function (key: string): string | null {
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
        if (nativeStorage) {
            try {
                nativeStorage.setItem(key, value);
                return;
            } catch (_error) {
                failover();
            }
        }
        fallback.set(key, value);
    };
    const del = function (key: string): void {
        if (nativeStorage) {
            try {
                nativeStorage.removeItem(key);
                return;
            } catch (_error) {
                failover();
            }
        }
        fallback.del(key);
    };
    const clear = function (): void {
        if (nativeStorage) {
            try {
                nativeStorage.clear();
                return;
            } catch (_error) {
                failover();
            }
        }
        fallback.clear();
    };
    const dump = function (): Record<string, string> {
        if (nativeStorage) {
            try {
                const result: Record<string, string> = {};
                for (let i = 0; i < nativeStorage.length; i++) {
                    const key = nativeStorage.key(i);
                    if (key != null) {
                        const value = nativeStorage.getItem(key);
                        if (value != null) result[key] = value;
                    }
                }
                return result;
            } catch (_error) {
                failover();
            }
        }
        return fallback.dump();
    };
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
function createCookieAdapter(): StorageAdapter {
    const values: Record<string, string | null> = Object.create(null);
    let cleared = false;
    const readCookies = function (): Record<string, string> {
        const result: Record<string, string> = Object.create(null);
        if (cleared) return result;
        try {
            const entries = (document.cookie || "").split(";");
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i].trim();
                const equals = entry.indexOf("=");
                if (equals <= 0) continue;
                try {
                    result[decodeURIComponent(entry.slice(0, equals))] =
                        decodeURIComponent(entry.slice(equals + 1));
                } catch (_malformedCookie) {}
            }
        } catch (_cookieAccess) {}
        return result;
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
        try {
            document.cookie =
                encodeURIComponent(key) +
                "=" +
                encodeURIComponent(value) +
                "; expires=Tue, 19 Jan 2038 03:14:07 GMT; path=/";
        } catch (_cookieAccess) {}
    };
    const del = function (key: string): void {
        values[key] = null;
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
        return result;
    };
    return {
        clear(): void {
            const all = dump();
            for (const key in all) del(key);
            cleared = true;
        },
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
 * stbPlayer.js. A single `try/catch` wraps `window.localStorage` access.
 */
export const storage: StorageAdapter = (() => {
    // Detect localStorage availability (mirrors client_can.localstorage)
    let canUseLocalStorage = false;
    try {
        canUseLocalStorage = !!window.localStorage;
    } catch (_e) {
        canUseLocalStorage = false;
    }

    return canUseLocalStorage
        ? createLocalStorageAdapter()
        : createCookieAdapter();
})();

/**
 * Classic provider scripts (prov/<id>/prov.js) call bare
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
    return providerGetItem(key) !== null && providerGetItem(key) !== "";
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
 * Read a provider-prefixed value and coerce it to a boolean.
 *
 * @param key - The logical key.
 * @returns `true` if the stored value is truthy (via `!!`), `false`
 *          otherwise (including missing key).
 */
export function providerGetBool(key: string): boolean {
    return !!providerGetItem(key);
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

/**
 * Persist a value only if it differs from the currently stored value.
 *
 * @param key   - The logical key (without provider prefix).
 * @param value - The new value to write.
 *
 * @remarks
 * Reads the current value via `loadValue(key)` and compares it with the
 * new value. Only calls `providerSetItem` if they differ. Useful for
 * reducing unnecessary storage writes (and compression overhead).
 */
export function saveIfChanged(key: string, value: string): void {
    if (loadValue(key) !== value) providerSetItem(key, value);
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
export const stbGetAllItems = storage.dump;
