import { loadRemoteFeature } from "../commands/remote-feature";

/** Fixed, bounded observations owned by the enabled remote connection. */
interface DebugConfig {
    address: string;
    enabled: boolean;
    token: string;
}
interface DebugDependencies {
    getConfig(): DebugConfig;
    native?(): Promise<any>;
    runtime(): string;
}
const DEBUG_MAX = 9007199254740991;
function finite(value: any, max = DEBUG_MAX): boolean {
    return (
        typeof value === "number" &&
        isFinite(value) &&
        value >= 0 &&
        value <= max
    );
}
export function installRuntimeDebug(w: any, deps: DebugDependencies): any {
    var binding: DebugConfig | null = null;
    var epoch = 0;
    var disposed = false;
    var suspended = false;
    var started = 0;
    var lastClock = 0;
    var sequence = 0;
    var dropped = 0;
    var events: any[] = [];
    var counters: any = {};
    var listeners: Array<() => void> = [];
    // The slot stays occupied until native completion, even after our deadline.
    var nativePending = false;
    var cancelRead: (() => void) | null = null;

    function clock(): number {
        var value: any;
        try {
            value = w.performance.now();
        } catch (_) {
            value = Date.now();
        }
        if (!finite(value)) value = lastClock;
        lastClock = Math.max(lastClock, value);
        return lastClock;
    }
    function platform(): string {
        try {
            if (w.__TAURI__) return "tauri";
            var cap = w.Capacitor;
            if (cap && (!cap.isNativePlatform || cap.isNativePlatform())) {
                var name = cap.getPlatform && cap.getPlatform();
                if (name === "android" || name === "ios")
                    return "capacitor-" + name;
            }
            if (w.ott_device === "lg/webos" || w.webOS) return "webos";
        } catch (_) {
            return "unknown";
        }
        return "browser";
    }
    function same(a: DebugConfig | null, b: DebugConfig | null): boolean {
        return (
            a === b ||
            !!(
                a &&
                b &&
                a.enabled === b.enabled &&
                a.address === b.address &&
                a.token === b.token
            )
        );
    }
    function config(): DebugConfig | null {
        try {
            var c = deps.getConfig();
            if (!disposed && c && c.enabled === true && c.address && c.token)
                return { address: c.address, enabled: true, token: c.token };
        } catch (_) {
            /* Disabled until a valid connection can be read. */
        }
        return null;
    }
    function retire(): void {
        epoch++;
        try {
            if (w.__ottPerfCapture) w.__ottPerfCapture.retire("disconnected");
        } catch (_) {}
        listeners.forEach(function (remove) {
            remove();
        });
        listeners = [];
        if (cancelRead) cancelRead();
        cancelRead = null;
        events = [];
        counters = {};
        sequence = dropped = 0;
        suspended = false;
        binding = null;
    }
    function record(code: string): void {
        if (!binding || !same(binding, config())) return;
        if (sequence === DEBUG_MAX) {
            dropped = Math.min(DEBUG_MAX, dropped + 1);
            return;
        }
        sequence++;
        events.push({
            code: code,
            elapsedMs: clock() - started,
            sequence: sequence,
        });
        if (events.length > 32) {
            events.shift();
            dropped = Math.min(DEBUG_MAX, dropped + 1);
        }
    }
    function count(key: string): void {
        counters[key] = Math.min(DEBUG_MAX, (counters[key] || 0) + 1);
    }
    function listen(
        target: any,
        type: string,
        action: (event: any) => void,
        capture = false
    ): void {
        if (!target || typeof target.addEventListener !== "function") return;
        target.addEventListener(type, action, capture);
        listeners.push(function () {
            target.removeEventListener(type, action, capture);
        });
    }
    function visible(): boolean {
        return !!(w.document && w.document.visibilityState === "visible");
    }
    function begin(): void {
        started = clock();
        counters = {
            errorCount: 0,
            rejectionCount: 0,
        };
        record("started");
        ["online", "offline", "focus", "blur"].forEach(function (type) {
            listen(w, type, function () {
                record(type);
            });
        });
        listen(w, "error", function () {
            count("errorCount");
            record("error");
        });
        listen(w, "unhandledrejection", function () {
            count("rejectionCount");
            record("unhandled_rejection");
        });
        listen(w.document, "visibilitychange", function () {
            record(visible() ? "visible" : "hidden");
        });
        listen(w, "pagehide", function () {
            record("suspended");
            suspended = true;
            try {
                if (w.__ottPerfCapture)
                    w.__ottPerfCapture.retire("page_hidden");
            } catch (_) {}
            if (cancelRead) cancelRead();
        });
        listen(w, "pageshow", function () {
            if (!sync()) return;
            suspended = false;
            record("resumed");
        });
        ["error", "waiting", "stalled", "playing", "ended"].forEach(
            function (type) {
                listen(
                    w.document,
                    type,
                    function (event: any) {
                        var target = event && event.target;
                        if (
                            target &&
                            (target === element("video") ||
                                target === element("videopip"))
                        )
                            record("media_" + type);
                    },
                    true
                );
            }
        );
    }
    function sync(): boolean {
        var next = config();
        if (!same(binding, next)) {
            retire();
            binding = next;
            if (binding) begin();
        }
        return !!binding;
    }
    function element(id: string): any {
        try {
            return w.document.getElementById(id);
        } catch (_) {
            return null;
        }
    }
    function put(out: any, key: string, value: any, max = DEBUG_MAX): void {
        if (finite(value, max)) out[key] = value;
    }
    function bool(out: any, key: string, value: any): void {
        if (typeof value === "boolean") out[key] = value;
    }
    function sample(version: number, details: any): any {
        var metrics: any = {};
        Object.keys(counters).forEach(function (key) {
            put(metrics, key, counters[key]);
        });
        put(metrics, "uptimeMs", clock() - started);
        try {
            var performance =
                w.__ottPerfCapture && w.__ottPerfCapture.metrics();
            if (performance)
                [
                    "loopDelayMs",
                    "loopMaxDelayMs",
                    "loopSamples",
                    "loopLongDelays",
                ].forEach(function (key) {
                    put(metrics, key, performance[key]);
                });
        } catch (_) {}
        try {
            var control =
                w.__ottCommandServer && w.__ottCommandServer.debugSnapshot();
            if (control) {
                [
                    "controlPendingRequests",
                    "controlPendingResponses",
                    "controlConsecutiveFailures",
                ].forEach(function (key) {
                    put(metrics, key, control[key]);
                });
                bool(metrics, "controlActive", control.controlActive);
            }
        } catch (_) {
            /* A legacy controller need not implement this producer. */
        }
        try {
            bool(metrics, "online", w.navigator.onLine);
            put(
                metrics,
                "hardwareConcurrency",
                w.navigator.hardwareConcurrency
            );
            put(metrics, "deviceMemoryGiB", w.navigator.deviceMemory);
        } catch (_) {
            /* Unavailable browser APIs stay absent. */
        }
        try {
            var memory = w.performance.memory;
            if (memory) {
                put(metrics, "jsHeapUsedBytes", memory.usedJSHeapSize);
                put(metrics, "jsHeapTotalBytes", memory.totalJSHeapSize);
                put(metrics, "jsHeapLimitBytes", memory.jsHeapSizeLimit);
            }
        } catch (_) {
            /* JS heap inspection is browser-specific. */
        }
        bool(metrics, "secureContext", w.isSecureContext);
        try {
            if (
                w.document.visibilityState === "visible" ||
                w.document.visibilityState === "hidden"
            )
                metrics.visible = visible();
            bool(metrics, "focused", w.document.hasFocus());
        } catch (_) {
            /* A missing document is not measured false. */
        }
        return {
            capturedAt: Date.now(),
            events: events.map(function (e) {
                return {
                    code: e.code,
                    elapsedMs: e.elapsedMs,
                    sequence: e.sequence,
                };
            }),
            eventsDropped: dropped,
            media: details.media(w, version),
            metrics: metrics,
            native: { data: null, state: "unsupported" },
            platform: platform(),
            runtime: deps.runtime(),
            version: version,
        };
    }
    function snapshot(version = 1): Promise<any> {
        if (version !== 1 && version !== 2 && version !== 3)
            return Promise.reject(new Error("invalid_request"));
        if (!sync() || suspended)
            return Promise.reject(new Error("unavailable"));
        var details = w.__ottRuntimeDebugDetails;
        if (!details) {
            var expected = epoch,
                identity = deps.runtime();
            return new Promise(function (resolve, reject) {
                loadRemoteFeature(w, "runtime-debug-details", function (error) {
                    if (
                        error ||
                        !w.__ottRuntimeDebugDetails ||
                        expected !== epoch ||
                        !binding ||
                        !same(binding, config()) ||
                        suspended ||
                        identity !== deps.runtime()
                    ) {
                        reject(new Error("unavailable"));
                        return;
                    }
                    try {
                        snapshot(version).then(resolve, reject);
                    } catch (_) {
                        reject(new Error("unavailable"));
                    }
                });
            });
        }
        var result = sample(version, details);
        var owner = epoch;
        var runtime = result.runtime;
        function resolved(): Promise<any> {
            return Promise.resolve(result).then(function (value) {
                if (
                    owner !== epoch ||
                    !same(binding, config()) ||
                    !binding ||
                    suspended ||
                    runtime !== deps.runtime()
                )
                    throw new Error("unavailable");
                return value;
            });
        }
        if (
            !deps.native ||
            (result.platform !== "tauri" &&
                result.platform.indexOf("capacitor-") !== 0)
        )
            return resolved();
        if (nativePending) {
            result.native.state = "unavailable";
            return resolved();
        }
        nativePending = true;
        return new Promise(function (resolve, reject) {
            var complete = false;
            var timeout: any = null;
            function finish(state: string, data: any): void {
                if (complete) return;
                complete = true;
                if (timeout !== null) w.clearTimeout(timeout);
                cancelRead = null;
                if (
                    owner !== epoch ||
                    !same(binding, config()) ||
                    runtime !== deps.runtime() ||
                    suspended
                ) {
                    reject(new Error("unavailable"));
                    return;
                }
                result.native = { data: data, state: state };
                resolve(result);
            }
            cancelRead = function () {
                finish("unavailable", null);
            };
            timeout = w.setTimeout(function () {
                finish("timeout", null);
            }, 1500);
            try {
                Promise.resolve(deps.native!()).then(
                    function (value) {
                        nativePending = false;
                        var projected: any = null;
                        try {
                            projected = details.native(value);
                        } catch (_) {
                            /* Invalid producer. */
                        }
                        var expected =
                            result.platform === "tauri"
                                ? "tauri"
                                : result.platform.slice(10);
                        if (projected && projected.platform !== expected)
                            projected = null;
                        finish(projected ? "available" : "invalid", projected);
                    },
                    function () {
                        nativePending = false;
                        finish("unavailable", null);
                    }
                );
            } catch (_) {
                nativePending = false;
                finish("unavailable", null);
            }
        });
    }
    var api = {
        available: function () {
            return !!config() && !suspended;
        },
        configurationChanged: sync,
        configurationRevision: function () {
            sync();
            return epoch;
        },
        dispose: function () {
            disposed = true;
            retire();
        },
        recordPerformanceDelay: function () {
            if (sync() && !suspended && visible()) record("loop_delay");
        },
        snapshot: snapshot,
    };
    return api;
}
