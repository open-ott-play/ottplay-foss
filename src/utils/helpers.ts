/**
 * Helper utilities ported from stbPlayer.js.
 *
 * Collection of small, commonly-used functions for DOM manipulation,
 * performance logging, feedback POST, time formatting, and script loading.
 */

/**
 * Create a DOM Event in a cross-browser compatible way.
 *
 * @param type - The event type name (e.g. `'click'`, `'customEvent'`).
 * @returns A new `Event` object.
 *
 * @sideEffects
 * Falls back to `document.createEvent('Event')` + `initEvent` when the
 * `new Event()` constructor is unavailable (legacy IE).
 */
export function createNewEvent(type: string): Event {
    var event: Event;
    try {
        event = new Event(type);
    } catch (_e) {
        event = document.createEvent("Event");
        event.initEvent(type, false, false);
    }
    return event;
}

/**
 * Send a client feedback message to the default `/report_feedb` endpoint.
 *
 * @param message - The message string to report.
 *
 * @sideEffects
 * Delegates to `PostFeedback()` which buffers and asynchronously POSTs
 * feedback data to the server.
 */
export function client_feedb(message: string): void {
    PostFeedback(message, "/report_feedb");
}

/**
 * Record a performance timestamp label (Maple 6 STB only).
 *
 * @param label - A string identifying the point in execution.
 *
 * @remarks
 * No-ops on non-Maple-6 devices. Appends a `"timestamp - label"` entry to
 * the internal `_perfLog` array for later retrieval / reporting.
 *
 * @sideEffects
 * Mutates the internal `_perfLog` array.
 */
export function pperf_stamp(label: string): void {
    if (navigator.userAgent.indexOf("Maple 6") === -1) return;
    var now = Date.now();
    _perfLog.push(now.toString(10) + " - " + label);
}
var _perfLog: string[] = [];

/**
 * Return all recorded performance stamps as one newline-joined string and
 * clear the buffer. Empty string when nothing was recorded (non-Maple 6
 * devices never record).
 *
 * @returns The collected `"timestamp - label"` lines, or "".
 */
export function pperf_flush(): string {
    if (!_perfLog.length) return "";
    var out: string = _perfLog.join("\n");
    _perfLog = [];
    return out;
}
var FeedbPOST: (msg: string) => void = function (msg: string): void {
    PostFeedback(msg, "/report_feedb");
};

/**
 * Batched feedback POST system.
 *
 * Buffers feedback messages and sends them in a single AJAX POST after a
 * 5-second debounce period. Resets the timer on each new submission.
 *
 * @param data     - The feedback payload (any JSON-serializable value).
 * @param endpoint - Optional target path (defaults to `'/report_feedb'`).
 *
 * @sideEffects
 * - Appends to the internal `_fbBuffer` array.
 * - Sets / resets `_fbTimer` via `setTimeout`.
 * - On flush, performs an AJAX POST request to `{host}/api/feedback`
 *   using jQuery (`$.ajax`) if available.
 */
export function PostFeedback(data: any, endpoint?: string): void {
    try {
        _fbBuffer.push({
            msg: data,
            path: endpoint || "/report_feedb",
            ts: Date.now(),
        });
        if (_fbTimer === null) {
            _fbTimer = setTimeout(function () {
                _fbTimer = null;
                var batch = _fbBuffer.splice(0, _fbBuffer.length);
                if (batch.length === 0) return;
                var base =
                    typeof (window as any).host === "string"
                        ? (window as any).host
                        : "";
                try {
                    if (typeof $ !== "undefined" && $.ajax) {
                        $.ajax({
                            type: "POST",
                            url: base + "/api/feedback",
                            data: JSON.stringify(batch),
                            contentType: "application/json",
                            timeout: 3000,
                        });
                    }
                } catch (_e) {}
            }, 5000);
        }
    } catch (_e) {}
}
var _fbBuffer: any[] = [];
var _fbTimer: any = null;

/**
 * Compute the current window width relative to a 1280-pixel baseline.
 *
 * @returns The ratio `window.innerWidth / 1280`.
 *
 * @remarks
 * Used for responsive scaling of UI elements in an STB environment where
 * 1280×720 is the reference resolution.
 */
export function getWidthK(): number {
    return window.innerWidth / 1280;
}

/**
 * Compute the current window height relative to a 720-pixel baseline.
 *
 * @returns The ratio `window.innerHeight / 720`.
 *
 * @remarks
 * Used for responsive scaling of UI elements in an STB environment where
 * 1280×720 is the reference resolution.
 */
export function getHeightK(): number {
    return window.innerHeight / 720;
}

// Expose globally for UI code that uses window.getWidthK / window.getHeightK
(window as any).getWidthK = getWidthK;
(window as any).getHeightK = getHeightK;

/**
 * Format a number to at least two digits, left-padding with `'0'` if needed.
 *
 * @param num - A non-negative integer (typically 0–59 for minutes/seconds).
 * @returns A two-character string (e.g. `'03'`, `'45'`).
 *
 * @remarks
 * Single-digit inputs become `'0' + digit`; multi-digit inputs are
 * returned as-is via string concatenation.
 */
export function formatTwoDigits(num: number): string {
    return num.toString().length === 1 ? "0" + num : "" + num;
}

/**
 * Convert a Unix timestamp (seconds since epoch) to an `HH:MM` string.
 *
 * @param timestamp - Seconds since 1970-01-01 UTC.
 * @returns A string in the format `"HH:MM"` using local time.
 */
export function time2time(timestamp: number): string {
    var date = new Date(timestamp * 1000);
    return (
        formatTwoDigits(date.getHours()) +
        ":" +
        formatTwoDigits(date.getMinutes())
    );
}

/**
 * Convert a Unix timestamp to a formatted date-time string.
 *
 * @param timestamp - Seconds since 1970-01-01 UTC.
 * @returns A string in the format `"DD.MM.YYYY HH:MM"` using local time.
 */
export function time2dateStr(timestamp: number): string {
    var date = new Date(timestamp * 1000);
    return (
        formatTwoDigits(date.getDate()) +
        "." +
        formatTwoDigits(date.getMonth() + 1) +
        "." +
        date.getFullYear() +
        " " +
        time2time(timestamp)
    );
}

/**
 * Convert a duration in seconds to `"H:MM:SS"` format.
 *
 * @param totalSeconds - A non-negative duration in seconds.
 * @returns A formatted string (e.g. `"1:05:30"` for 3930 seconds).
 *
 * @remarks
 * Hours can exceed 23 for very long durations. Minutes and seconds are
 * always zero-padded to two digits.
 */
export function secondsToText(totalSeconds: number): string {
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = Math.floor(totalSeconds % 60);
    return h + ":" + formatTwoDigits(m) + ":" + formatTwoDigits(s);
}

/**
 * Format playback position and duration as a readable string.
 *
 * @param position - Current playback position in seconds.
 * @param duration - Total duration in seconds.
 * @returns A string in the format `"H:MM:SS / H:MM:SS"`.
 *
 * @remarks
 * Both values are formatted via `secondsToText` and joined with `" / "`.
 */
export function positionToText(position: number, duration: number): string {
    return secondsToText(position) + " / " + secondsToText(duration);
}

/**
 * Detect the current browser name from the user-agent string.
 *
 * @returns One of `'Firefox'`, `'Opera'`, `'IE'`, `'Edge'`, `'Chrome'`,
 *          `'Safari'`, or `'Unknown'`.
 *
 * @remarks
 * Checks UA substrings in a specific order (Firefox → Opera → Trident →
 * Edge → Chrome → Safari) to avoid false positives (e.g. Chrome also
 * contains "Safari").
 */
export function browserName(): string {
    var ua = navigator.userAgent;
    if (ua.indexOf("Firefox") !== -1) return "Firefox";
    if (ua.indexOf("Opera") !== -1) return "Opera";
    if (ua.indexOf("Trident") !== -1) return "IE";
    if (ua.indexOf("Edge") !== -1) return "Edge";
    if (ua.indexOf("Chrome") !== -1) return "Chrome";
    if (ua.indexOf("Safari") !== -1) return "Safari";
    return "Unknown";
}

/**
 * Show an on-screen alert via the STB `showShift` mechanism.
 *
 * @param msg - The message text to display.
 *
 * @remarks
 * No-ops if `window.showShift` is not present. This is specific to STB
 * middleware that provides `showShift` for on-screen notifications.
 */
export function alert(msg: string): void {
    if (typeof (window as any).showShift === "function")
        (window as any).showShift(msg);
}

/**
 * Write a debug message to a DOM element's innerHTML (prepend).
 *
 * @param elementId - The `id` of the target DOM element.
 * @param text      - The text to log.
 *
 * @sideEffects
 * - Prepends `"<text><br>"` to the element's `innerHTML`.
 * - Falls back to `console.error` if the element is not found.
 */
export function log(elementId: string, text: string): void {
    var el = document.getElementById(elementId);
    if (el !== null) {
        el.innerHTML = text + "<br>" + el.innerHTML;
    } else {
        console.error('log: element "' + elementId + '" is unavailable');
    }
}

/**
 * Check whether a script or CSS `<link>` with the given URL is already in
 * the document.
 *
 * @param url - A substring of the `href` attribute to search for.
 * @returns `true` if at least one `<link>` element contains the URL substring.
 *
 * @remarks
 * Only checks `<link>` elements (stylesheets). Does not inspect `<script>`
 * tags despite the function name mentioning scripts.
 */
export function checkIfIncluded(url: string): boolean {
    var links = document.getElementsByTagName("link");
    for (var i = 0; i < links.length; i++) {
        if (links[i].href.indexOf(url) !== -1) return true;
    }
    return false;
}

/**
 * Dynamically load a JavaScript `<script>` element into a given container.
 *
 * @param url       - The script source URL.
 * @param successCb - Optional callback invoked on successful load.
 * @param errorCb   - Optional callback invoked on load error (receives an Error).
 * @param location  - The DOM element to which the script tag is appended.
 *
 * @sideEffects
 * - Creates and appends a `<script>` element to `location`.
 * - Sets `crossOrigin = 'anonymous'` if the property is supported.
 * - On error: logs to console, calls `alert()`, and invokes `errorCb`.
 * - Records a `pperf_stamp` if `pperf_stamp` is available.
 */
export function loadScript(
    url: string,
    successCb: (() => void) | null,
    errorCb: ((e: Error) => void) | null,
    location: HTMLElement
): void {
    var script = document.createElement("script");
    script.src = url;
    script.type = "text/javascript";
    if (typeof (script as any).crossOrigin !== "undefined")
        (script as any).crossOrigin = "anonymous";
    if (successCb) script.onload = successCb;
    script.onerror = function () {
        var err = new Error("Error loading: " + url);
        console.error(err);
        alert(err.message);
        if (typeof errorCb === "function") errorCb(err);
    };
    location.appendChild(script);
    if (typeof pperf_stamp === "function")
        pperf_stamp("startPlayer -- loadJS " + url);
}

/**
 * Alias for `loadScript` — load a JavaScript file into a given container.
 *
 * @param url       - The script source URL.
 * @param successCb - Optional success callback.
 * @param errorCb   - Optional error callback.
 * @param location  - The DOM element to append the script to.
 *
 * @see loadScript
 */
export function loadJS(
    url: string,
    successCb: (() => void) | null,
    errorCb: ((e: Error) => void) | null,
    location: HTMLElement
): void {
    loadScript(url, successCb, errorCb, location);
}

/**
 * Load a JavaScript file into `document.body`.
 *
 * @param url       - The script source URL.
 * @param successCb - Optional success callback.
 * @param errorCb   - Optional error callback.
 *
 * @remarks
 * Convenience wrapper around `loadScript` that always appends to `<body>`.
 *
 * @see loadScript
 */
export function getScriptDOM(
    url: string,
    successCb: (() => void) | null,
    errorCb: ((e: Error) => void) | null
): void {
    loadScript(url, successCb, errorCb, document.body);
}

/**
 * Dynamic CSS rule manager.
 *
 * Provides `init()` and `getRule(selector)` for adding and reusing CSS
 * rules at runtime. Rules are added once and cached by selector string.
 *
 * @sideEffects
 * - `init()` creates a `<style>` element and inserts it into `<body>`.
 * - `getRule()` inserts a new CSS rule into the stylesheet if the
 *   selector has not been seen before.
 *
 * @remarks
 * On Maple STB devices, rules are created with a placeholder `quotes`
 * property (which is immediately removed) to work around a CSS parsing bug.
 */
export var innerStyle: any = (function () {
    var cssSheet: any;
    var rules: Record<string, any> = {};
    /**
     * Initialise the internal `<style>` element and insert it at the top of
     * `<body>`.
     *
     * @sideEffects
     * Creates a `<style>` DOM element and inserts it as the first child of
     * `<body>`; stores a reference to the element's CSSStyleSheet.
     */
    function init(): void {
        (innerStyle as any).elHtml = document.createElement("style");
        document.body.insertBefore(
            (innerStyle as any).elHtml,
            document.body.firstChild
        );
        cssSheet = (innerStyle as any).elHtml.sheet;
    }

    /**
     * Get (or create) the CSS rule object for a given selector.
     *
     * @param selector - A CSS selector string (e.g. `'.my-class'`).
     * @returns The corresponding CSS style rule object, or `undefined` if
     *          the rule could not be inserted.
     *
     * @sideEffects
     * On first invocation for a given selector, inserts a new empty rule
     * (or `{quotes: inherit}` on Maple) into the stylesheet and caches it.
     */
    function getRule(selector: string): any {
        var rule = rules[selector];
        if (typeof rule === "undefined") {
            var index = cssSheet.cssRules.length;
            if (!(window as any).client_can.is_maple) {
                cssSheet.insertRule(selector + " {}", 0);
                rule = cssSheet.cssRules[0];
            } else {
                cssSheet.insertRule(selector + " {quotes: inherit;}", 0);
                rule = cssSheet.cssRules[index];
                if (typeof rule !== "undefined")
                    rule.style.removeProperty("quotes");
            }
            if (cssSheet.cssRules.length <= index) {
                client_feedb("Cannot add empty CSS rule");
                rule = undefined;
            }
            rules[selector] = rule;
        }
        return rule;
    }
    return { init: init, getRule: getRule };
})();

/**
 * Generate an HTML `<div>` string for a channel thumbnail / preview image.
 *
 * @param url - The thumbnail image URL.
 * @returns An HTML string with inline styles for width, height, margin, and
 *          `background-image`, or an empty string if `window.sThumbnail` is
 *          falsy or `url` is empty.
 *
 * @remarks
 * Width and height are scaled by `getWidthK()` / `getHeightK()` relative to
 * the 1280×720 baseline. Base values: width = 133px, height = 200px,
 * margin = width/15. Does NOT insert DOM elements — returns an HTML string
 * for callers to use (e.g. via `innerHTML`).
 */
export function getThumbnail(url: string): string {
    if ((window as any).sThumbnail && url) {
        var w = Math.floor(133 * getWidthK());
        var h = Math.floor(200 * getHeightK());
        var m = Math.floor(w / 15);
        return (
            '<div class="img" style="background-image: url(\'' +
            url +
            "');width:" +
            w +
            "px;height:" +
            h +
            "px;margin:" +
            m +
            'px;float:left;background-size:cover;"></div>'
        );
    }
    return "";
}

/**
 * Log an error message to the browser console.
 *
 * @param msg - The error data to log (passed to `console.log` with an `[ERR]` prefix).
 *
 * @remarks
 * This is a lightweight helper — does not actually POST anywhere despite the
 * name. In the original codebase it may have been intended for server-side
 * error reporting; currently it only logs to console.
 */
export function ErrPOST(msg: any): void {
    if (msg) console.log("[ERR]", msg);
}

/**
 * Compute a simple imul-based hash of a string.
 *
 * @param str - The input string.
 * @returns A 32-bit integer hash value.
 *
 * @remarks
 * Uses `Math.imul` for multiplication (requires the polyfill in older
 * environments). Iterates over each character: `h = imul(h ^ charCode, 387420489)`.
 * Finalises with `h ^ (h >>> 9)`. Not cryptographically secure.
 */
export function TSH(str: string): number {
    for (var i = 0, h = 9; i < str.length; ) {
        h = Math.imul(h ^ str.charCodeAt(i++), 387420489);
    }
    return h ^ (h >>> 9);
}
