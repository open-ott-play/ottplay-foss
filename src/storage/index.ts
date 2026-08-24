/**
 * Storage abstraction layer.
 *
 * Ported from stbPlayer.js (ottpStorage IIFE, laaMac, provider helpers).
 * Uses localStorage when available, falls back to cookies.
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

declare function pperf_stamp(label: string): void;

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
    get(key: string): string | null;
    set(key: string, value: string): void;
    del(key: string): void;
    has(key: string): boolean;
    hasValue(key: string): boolean;
    clear(): void;
    dump(): Record<string, string>;
    reset(): void;
    getI(key: string, defaultValue?: number): number;
    setI(key: string, value: number): void;
}

// -- localStorage implementation ------------------------------------------------

/**
 * Create a `StorageAdapter` backed by `window.localStorage`.
 *
 * @returns A `StorageAdapter` object with all required methods.
 *
 * @remarks
 * If `localStorage.setItem` throws (e.g. quota exceeded), the `set` method
 * logs the error and calls `alert()`.
 *
 * @sideEffects
 * The `set` method may produce an `alert()` on write failure.
 */
function createLocalStorageAdapter(): StorageAdapter {
    /**
     * Retrieve a value from localStorage by key.
     *
     * @param key - The storage key.
     * @returns The stored string, or `null` if the key does not exist.
     */
    const get = function (key: string): string | null {
        return localStorage.getItem(key);
    };

    /**
     * Store a value in localStorage.
     *
     * @param key   - The storage key.
     * @param value - The string to store.
     *
     * @sideEffects
     * On `QuotaExceededError` or other exceptions, logs to console and calls
     * `alert()`.
     */
    const set = function (key: string, value: string): void {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.error(e);
            alert("Error save data!!!");
        }
    };

    /**
     * Remove a key from localStorage.
     *
     * @param key - The storage key to remove.
     */
    const del = function (key: string): void {
        localStorage.removeItem(key);
    };

    /**
     * Check whether a key exists in localStorage.
     *
     * @param key - The storage key.
     * @returns `true` if the key is present (value may be empty string).
     */
    const has = function (key: string): boolean {
        return localStorage.getItem(key) !== null;
    };

    /**
     * Check whether a key exists and holds a non-empty value.
     *
     * @param key - The storage key.
     * @returns `true` if the key is present and its value is not `''`.
     */
    const hasValue = function (key: string): boolean {
        const value = localStorage.getItem(key);
        return value !== null && value !== "";
    };

    /**
     * Remove all keys from localStorage.
     *
     * @sideEffects
     * Calls `localStorage.clear()`.
     */
    const clear = function (): void {
        localStorage.clear();
    };

    /**
     * Extract all key-value pairs from localStorage.
     *
     * @returns A plain object mapping every key to its string value.
     */
    const dump = function (): Record<string, string> {
        const items: Record<string, string> = {};
        let k: string | null;
        for (let i = 0; i < localStorage.length; i++) {
            k = localStorage.key(i);
            if (k != null) {
                items[k] = localStorage[k];
            }
        }
        return items;
    };

    /**
     * Reset / reinitialise the adapter.
     *
     * @remarks
     * No-op for localStorage — the native API is always available.
     */
    const init = function (): void {
        // no-op for localStorage; methods are already assigned
    };

    /**
     * Read a value and parse it as an integer.
     *
     * @param key          - The storage key.
     * @param defaultValue - Fallback value when the key is missing or not a
     *                       valid integer (default 0).
     * @returns The parsed integer or `defaultValue`.
     */
    const getI = function (key: string, defaultValue: number = 0): number {
        const parsed = parseInt(get(key) || "", 10);
        return isNaN(parsed) ? defaultValue : parsed;
    };

    /**
     * Write a number as a decimal string.
     *
     * @param key   - The storage key.
     * @param value - The number to store.
     */
    const setI = function (key: string, value: number): void {
        set(key, value.toString(10));
    };

    return {
        get,
        set,
        del,
        has,
        hasValue,
        clear,
        dump,
        reset: init,
        getI,
        setI,
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
    /**
     * Read a cookie value by name.
     *
     * @param key - The cookie name.
     * @returns The decoded cookie value, or `''` if the cookie does not exist.
     *
     * @remarks
     * Uses regex to extract the value from `document.cookie`. The key is
     * decoded and special regex characters are escaped.
     */
    const get = function (key: string): string {
        const pattern =
            "(?:^|;\\s*)" +
            decodeURIComponent(key).replace(/[-.+*]/g, "\\$&") +
            "\\s*\\=";
        if (!new RegExp(pattern).test(document.cookie)) {
            return "";
        }
        return decodeURIComponent(
            document.cookie.replace(
                new RegExp(
                    "(?:^|.*;\\s*)" +
                        decodeURIComponent(key).replace(/[-.+*]/g, "\\$&") +
                        "\\s*\\=\\s*((?:[^;](?!;))*[^;]?).*",
                ),
                "$1",
            ),
        );
    };

    /**
     * Write a cookie with a far-future expiration (2038).
     *
     * @param key   - The cookie name.
     * @param value - The value to store (URI-encoded).
     *
     * @remarks
     * No-ops if `key` is empty. The cookie path is `/`.
     *
     * @sideEffects
     * Sets `document.cookie`.
     */
    const set = function (key: string, value: string): void {
        if (key) {
            document.cookie =
                encodeURIComponent(key) +
                "=" +
                encodeURIComponent(value) +
                "; expires=Tue, 19 Jan 2038 03:14:07 GMT; path=/";
        }
    };

    /**
     * Delete a cookie by setting its expiration to the past.
     *
     * @param key - The cookie name to remove.
     *
     * @sideEffects
     * Sets `document.cookie` with an expiry in 1970.
     */
    const del = function (key: string): void {
        if (key) {
            document.cookie =
                encodeURIComponent(key) +
                "=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";
        }
    };

    /**
     * Check whether a cookie exists.
     *
     * @param key - The cookie name.
     * @returns `true` if the cookie is present.
     *
     * @remarks
     * Returns `false` for empty/undefined keys.
     */
    const has = function (key: string): boolean {
        if (key) {
            const pattern =
                "(?:^|;\\s*)" +
                decodeURIComponent(key).replace(/[-.+*]/g, "\\$&") +
                "\\s*\\=";
            return new RegExp(pattern).test(document.cookie);
        }
        return false;
    };

    /**
     * Check whether a cookie exists with a non-empty value.
     *
     * @param key - The cookie name.
     * @returns `true` if the cookie exists and its value is not `''`.
     */
    const hasValue = function (key: string): boolean {
        return get(key) !== "";
    };

    /**
     * Delete all cookies.
     *
     * @sideEffects
     * Iterates `document.cookie` and expires each cookie by setting its
     * expiration to unix epoch.
     */
    const clear = function (): void {
        const cookies = document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i];
            const eqPos = cookie.indexOf("=");
            const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
            document.cookie =
                name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
        }
    };

    /**
     * Extract all cookies as a key-value map.
     *
     * @returns An object mapping every cookie name to its decoded value.
     */
    const dump = function (): Record<string, string> {
        const items: Record<string, string> = {};
        const cookies = document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i];
            const eqPos = cookie.indexOf("=");
            const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
            items[name] = get(name);
        }
        return items;
    };

    /**
     * Reset / reinitialise the adapter.
     *
     * @remarks
     * No-op for cookies — the methods are always ready.
     */
    const init = function (): void {
        // no-op for cookie adapter; methods are already assigned
    };

    /**
     * Read a cookie and parse it as an integer.
     *
     * @param key          - The cookie name.
     * @param defaultValue - Fallback value (default 0).
     * @returns The parsed integer, or `defaultValue` if parsing fails.
     */
    const getI = function (key: string, defaultValue: number = 0): number {
        const parsed = parseInt(get(key), 10);
        return isNaN(parsed) ? defaultValue : parsed;
    };

    /**
     * Write a number as a cookie (decimal string).
     *
     * @param key   - The cookie name.
     * @param value - The number to store.
     */
    const setI = function (key: string, value: number): void {
        set(key, value.toString(10));
    };

    return {
        get,
        set,
        del,
        has,
        hasValue,
        clear,
        dump,
        reset: init,
        getI,
        setI,
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
    return !!(providerGetItem(key) || false);
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
    const parsed = parseInt(providerGetItem(key) || "", 10);
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
