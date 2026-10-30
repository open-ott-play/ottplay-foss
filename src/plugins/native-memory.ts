/** Optional device classification; never waits for native work before starting playback. */
export function captureNativeMemoryHint(
    w: any,
    snapshot: () => Promise<any>
): () => void {
    var pending = false;
    var timer: any = null;
    function cancel(): void {
        pending = false;
        if (timer !== null) w.clearTimeout(timer);
        timer = null;
        if (typeof w.removeEventListener === "function")
            w.removeEventListener("pagehide", cancel);
    }
    try {
        var cap = w.Capacitor;
        if (
            !cap ||
            typeof cap.getPlatform !== "function" ||
            cap.getPlatform() !== "android" ||
            (cap.isNativePlatform && !cap.isNativePlatform())
        )
            return cancel;
        var clock = function (): number {
            return Date.now();
        };
        var performance = w.performance;
        if (performance && typeof performance.now === "function")
            clock = function (): number {
                return performance.now();
            };
        var started = clock();
        var deadline = started + 1500;
        pending = true;
        w.addEventListener("pagehide", cancel);
        // Late native replies must not change policy after this optional read expired.
        timer = w.setTimeout(cancel, 1500);
        Promise.resolve(snapshot()).then(function (value: any): void {
            if (!pending) return;
            try {
                if (
                    value &&
                    value.version === 1 &&
                    value.platform === "android" &&
                    value.metrics
                ) {
                    var metrics = value.metrics;
                    var lowRam = metrics.isLowRamDevice;
                    var total = metrics.systemTotalBytes;
                    var validTotal =
                        typeof total === "number" &&
                        isFinite(total) &&
                        total > 0 &&
                        total <= 9007199254740991 &&
                        Math.floor(total) === total;
                    // Older APKs provide total RAM without the stable low-RAM flag.
                    // Ignore transient memory pressure and all unrelated diagnostics.
                    // Timer delivery can lag behind a queued reply on a busy event loop.
                    var now = clock();
                    if (
                        (lowRam === undefined || typeof lowRam === "boolean") &&
                        (total === undefined || validTotal) &&
                        (typeof lowRam === "boolean" || validTotal) &&
                        pending &&
                        now >= started &&
                        now < deadline
                    )
                        w.__ottNativeLowMemoryDevice =
                            lowRam === true ||
                            (validTotal && total <= 2 * 1024 * 1024 * 1024);
                }
            } catch (_) {
                // A malformed/unavailable snapshot leaves the browser policy intact.
            }
            cancel();
        }, cancel);
    } catch (_) {
        cancel();
    }
    return cancel;
}
