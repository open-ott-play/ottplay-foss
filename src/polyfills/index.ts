/**
 * Polyfills for old STB devices (IE8-, old WebKit, etc.).
 *
 * Provides compatibility shims for legacy environments that lack
 * standard ES5/ES6 APIs (performance.now, String.trim, Math.imul,
 * Array.findIndex, Array.isArray, TextEncoder, Date timezone offset).
 */

/**
 * Apply all polyfills required for legacy STB (set-top box) environments.
 *
 * @remarks
 * This is the single entry point — call once at application startup.
 *
 * @sideEffects
 * Mutates `window.performance`, `String.prototype`, `Math`, `Array.prototype`,
 * `Array`, `window.TextEncoder`, `Date.prototype`, and `Date` to add missing
 * methods when they do not already exist.
 */
export function applyPolyfills(): void {
    polyfillPerformanceNow();
    polyfillStringTrim();
    polyfillMathImul();
    polyfillArrayFindIndex();
    polyfillArrayIsArray();
    polyfillTextEncoder();
    polyfillDateTimezone();
}

/**
 * Polyfill `performance.now()` for environments that lack it.
 *
 * @remarks
 * Falls back to `Date.now()` minus a navigation-start timestamp captured at
 * polyfill time. Also shims `Date.now()` itself if missing.
 *
 * @sideEffects
 * - Adds or replaces `window.performance.now`
 * - Creates `window.performance` and `window.performance.timing` if absent
 * - May add `Date.now` if it does not exist
 */
function polyfillPerformanceNow(): void {
    if (!window.performance || !window.performance.now) {
        if (!Date.now) {
            Date.now = function (this: any): number {
                return new this().getTime();
            };
        }
        var perf =
            (window as any).performance || ((window as any).performance = {});
        var timing = perf.timing || (perf.timing = {});
        var navStart =
            timing.navigationStart || (timing.navigationStart = Date.now());
        perf.now = function (): number {
            return Date.now() - navStart;
        };
    }
}

/**
 * Polyfill `String.prototype.trim()` for ES3 environments.
 *
 * @remarks
 * Removes leading and trailing whitespace, including non-breaking space
 * (U+00A0) and the Unicode BOM / zero-width no-break space (U+FEFF).
 *
 * @sideEffects
 * Adds `String.prototype.trim` if absent.
 */
function polyfillStringTrim(): void {
    if (!String.prototype.trim) {
        String.prototype.trim = function (this: string): string {
            return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "");
        };
    }
}

/**
 * Polyfill `Math.imul()` for 32-bit integer multiplication.
 *
 * @remarks
 * Used internally by hashing algorithms (murmurhash, xxhash). Implements
 * the C-like 32-bit signed integer multiplication via high/low 16-bit lanes.
 *
 * @sideEffects
 * Adds `Math.imul` if absent.
 */
function polyfillMathImul(): void {
    if (!(Math as any).imul) {
        (Math as any).imul = function (a: number, b: number): number {
            var aHi = (a >>> 16) & 0xffff;
            var aLo = a & 0xffff;
            var bHi = (b >>> 16) & 0xffff;
            var bLo = b & 0xffff;
            return (aLo * bLo + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) | 0;
        };
    }
}

/**
 * Polyfill `Array.prototype.findIndex()` (ES2015).
 *
 * @remarks
 * Returns the index of the first element satisfying the predicate, or -1.
 * Implements the spec steps including `Object(this)` coercion and
 * `predicate.call(thisArg, ...)`.
 *
 * @sideEffects
 * Adds `Array.prototype.findIndex` if absent.
 */
function polyfillArrayFindIndex(): void {
    if (!Array.prototype.findIndex) {
        Array.prototype.findIndex = function (
            this: any[],
            predicate: (value: any, index: number, obj: any[]) => boolean,
            thisArg?: any,
        ): number {
            if (this == null) {
                throw new TypeError('"this" is null or not defined');
            }
            var obj = Object(this);
            var len = obj.length >>> 0;
            if (typeof predicate !== "function") {
                throw new TypeError("predicate must be a function");
            }
            var index = 0;
            while (index < len) {
                var value = obj[index];
                if (predicate.call(thisArg, value, index, obj)) {
                    return index;
                }
                index++;
            }
            return -1;
        };
    }
}

/**
 * Polyfill `Array.isArray()` (ES5).
 *
 * @remarks
 * Uses `Object.prototype.toString` to detect arrays across execution contexts.
 *
 * @sideEffects
 * Adds `Array.isArray` if absent.
 */
function polyfillArrayIsArray(): void {
    if (!Array.isArray) {
        Array.isArray = function (arg: any): arg is any[] {
            return Object.prototype.toString.call(arg) === "[object Array]";
        };
    }
}

/**
 * Polyfill `TextEncoder` (UTF-8 only) for legacy environments.
 *
 * @remarks
 * Encodes a JavaScript string into a `Uint8Array` of UTF-8 bytes. Handles
 * surrogate pairs (characters above U+FFFF are encoded as 4-byte sequences).
 * Supports the full Unicode range up to U+1FFFFF. Does NOT support streaming.
 *
 * @sideEffects
 * Sets `window.TextEncoder` if the global is undefined.
 */
function polyfillTextEncoder(): void {
    if (typeof TextEncoder !== "undefined") return;
    var Utf8Encoder = function () {} as any;
    Utf8Encoder.prototype.encode = function (str: string): Uint8Array {
        var bytes: number[] = [];
        var pos = -1;
        var len = str.length;
        while (++pos < len) {
            var code = str.charCodeAt(pos);
            if (code <= 0x7f) {
                bytes.push(code);
            } else if (code <= 0x7ff) {
                bytes.push(0xc0 | ((code >>> 6) & 0x1f));
                bytes.push(0x80 | (code & 0x3f));
            } else {
                var charCode = code;
                if (0xd800 <= charCode && charCode <= 0xdbff && pos + 1 < len) {
                    var nextCode = str.charCodeAt(pos + 1);
                    if (0xdc00 <= nextCode && nextCode <= 0xdfff) {
                        charCode =
                            0x10000 +
                            ((charCode & 0x3ff) << 10) +
                            (nextCode & 0x3ff);
                        pos++;
                    }
                }
                if (charCode <= 0xffff) {
                    bytes.push(0xe0 | ((charCode >>> 12) & 0x0f));
                    bytes.push(0x80 | ((charCode >>> 6) & 0x3f));
                    bytes.push(0x80 | (charCode & 0x3f));
                } else if (charCode <= 0x1fffff) {
                    bytes.push(0xf0 | ((charCode >>> 18) & 0x07));
                    bytes.push(0x80 | ((charCode >>> 12) & 0x3f));
                    bytes.push(0x80 | ((charCode >>> 6) & 0x3f));
                    bytes.push(0x80 | (charCode & 0x3f));
                }
            }
        }
        return new Uint8Array(bytes);
    };
    (window as any).TextEncoder = Utf8Encoder;
}

/**
 * Polyfill custom timezone-offset support on `Date` (legacy STB feature).
 *
 * @remarks
 * Adds a `timezoneOffset` property to Date instances and a set of static /
 * instance methods (`Date.setTimezoneOffset`, `Date.getTimezoneOffset`,
 * `Date.prototype.toString`, etc.) that shift the UTC getters/setters by a
 * configurable offset in minutes.
 *
 * Also overrides `Date.prototype.toString` to output UTC time shifted by the
 * stored offset.
 *
 * The patch modifies all `get*` / `set*` method pairs (Milliseconds, Seconds,
 * Minutes, Hours, Date, Month, FullYear, Year, Day) to behave as UTC
 * equivalents adjusted by the custom offset.
 *
 * @sideEffects
 * - Adds `Date.prototype.timezoneOffset` (instance property, default =
 *   system offset at polyfill time)
 * - Adds `Date.setTimezoneOffset(offset)` / `Date.getTimezoneOffset()`
 * - Adds `Date.prototype.setTimezoneOffset(offset)` / `Date.prototype.getTimezoneOffset()`
 * - Overrides `Date.prototype.toString()`
 * - Overrides all `Date.prototype.get*` / `set*` date/time accessors
 */
function polyfillDateTimezone(): void {
    var baseDate = new Date();
    (Date.prototype as any).timezoneOffset = baseDate.getTimezoneOffset();
    (Date as any).setTimezoneOffset = function (offset: number): number {
        return ((this as any).prototype.timezoneOffset = offset);
    };
    (Date.prototype as any).setTimezoneOffset = function (
        offset: number,
    ): number {
        return ((this as any).timezoneOffset = offset);
    };
    (Date as any).getTimezoneOffset = function (_offset?: number): number {
        return (this as any).prototype.timezoneOffset;
    };
    (Date.prototype as any).getTimezoneOffset = function (): number {
        return (this as any).timezoneOffset;
    };
    (Date.prototype as any).toString = function (): string {
        var offsetMs = (this as any).timezoneOffset * 60 * 1000;
        baseDate.setTime(this.getTime() - offsetMs);
        return baseDate.toUTCString();
    };
    var dateParts = [
        "Milliseconds",
        "Seconds",
        "Minutes",
        "Hours",
        "Date",
        "Month",
        "FullYear",
        "Year",
        "Day",
    ];
    dateParts.forEach(function (part: string) {
        (Date.prototype as any)["get" + part] = function () {
            var offsetMs = (this as any).timezoneOffset * 60 * 1000;
            baseDate.setTime(this.getTime() - offsetMs);
            return (baseDate as any)["getUTC" + part]();
        };
        (Date.prototype as any)["set" + part] = function (value: number) {
            var offsetMs = (this as any).timezoneOffset * 60 * 1000;
            baseDate.setTime(this.getTime() - offsetMs);
            (baseDate as any)["setUTC" + part](value);
            var result = baseDate.getTime() + offsetMs;
            this.setTime(result);
            return result;
        };
    });
}
