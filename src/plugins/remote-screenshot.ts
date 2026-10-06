/** Bounded, device-local screenshot permission. No image is captured on discovery. */
export interface ScreenshotImage {
    height: number;
    image: string;
    source: string;
    video: "unknown" | "excluded";
    width: number;
}
interface ScreenshotConfig {
    address: string;
    enabled: boolean;
    token: string;
}
interface ScreenshotDependencies {
    getConfig: () => ScreenshotConfig;
    mobile?: {
        capabilities: () => Promise<any>;
        capture: () => Promise<any>;
    };
    onStatus?: (status: any) => void;
}

export function screenshotSurfaceBlocked(w: any): boolean {
    try {
        var doc = w.document;
        if (!doc || doc.hidden === true) return true;
        if (
            w.__ottParental &&
            (w.__ottParental.needs("settings") ||
                w.__ottParental.needs("providers"))
        )
            return true;
        if (
            !w.__ottParental &&
            (w.sPSoptions || w.sPSprovs) &&
            w.parentPIN !== "*" &&
            !w.parentAccess
        )
            return true;
        var port = w.__ottClassicScreenPort;
        var owner = port && port.screens && port.screens.current();
        var list = port && port.listOwner && port.listOwner();
        if (
            (owner && owner.model && owner.model.localOnlyInput) ||
            (list && list.model && list.model.localOnlyInput)
        )
            return true;
        var nodes = doc.querySelectorAll(
            '#pin, #remoteSettingsContent, input:not([type="button"]):not([type="hidden"]), textarea'
        );
        for (var i = 0; i < nodes.length; i++) {
            if (
                nodes[i].getClientRects().length &&
                w.getComputedStyle(nodes[i]).visibility !== "hidden"
            )
                return true;
        }
        return false;
    } catch (_) {
        return true;
    }
}

/** Only the active application view or an explicitly selected browser source. */
export function installRemoteScreenshot(
    w: any,
    deps: ScreenshotDependencies
): any {
    var maxBytes = 1048576;
    var maxWidth = 1280;
    var maxHeight = 720;
    var grantMs = 600000;
    var supported = false;
    var source: string | null = null;
    var nativeCapture: (() => Promise<any>) | null = null;
    var nativeCurrent: (() => boolean) | null = null;
    var binding: ScreenshotConfig | null = null;
    var deadline = 0;
    var lastClock = 0;
    var lastWallClock = 0;
    var wallDeadline = 0;
    var generation = 0;
    var pending = false;
    var capturing = false;
    var cancelBrowser: (() => void) | null = null;
    var timer: any = null;
    var stream: any = null;
    var frameCapture: any = null;
    var subscriber: ((status: any) => void) | null = null;
    var message = "Remote screenshots are off.";
    var hook: any;

    function currentConfig(): ScreenshotConfig | null {
        try {
            var config = deps.getConfig();
            if (
                !config ||
                config.enabled !== true ||
                typeof config.address !== "string" ||
                typeof config.token !== "string" ||
                !/^[A-Za-z0-9_-]{32,256}$/.test(config.token)
            )
                return null;
            // Images must not cross an unencrypted LAN connection.
            var url = new URL(config.address);
            if (
                url.protocol !== "https:" &&
                !(
                    url.protocol === "http:" &&
                    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)
                )
            )
                return null;
            return {
                address: config.address,
                enabled: true,
                token: config.token,
            };
        } catch (_) {
            return null;
        }
    }
    function clock(): number {
        var now = w.performance && w.performance.now();
        if (typeof now !== "number" || !isFinite(now) || now < lastClock)
            return -1;
        lastClock = now;
        return now;
    }
    function sameConfig(config: ScreenshotConfig | null): boolean {
        return !!(
            binding &&
            config &&
            binding.address === config.address &&
            binding.token === config.token &&
            config.enabled
        );
    }
    function validGrant(): boolean {
        var now = clock();
        var wall = Date.now();
        var wallValid = isFinite(wall) && wall >= lastWallClock;
        lastWallClock = wall;
        return !!(
            wallValid &&
            wall < wallDeadline &&
            deadline &&
            now >= 0 &&
            now < deadline &&
            sameConfig(currentConfig()) &&
            (!nativeCurrent || nativeCurrent()) &&
            w.__ottRemoteScreenshot === hook
        );
    }
    function status(): any {
        var ready = validGrant();
        if (deadline && !ready) stop();
        return {
            enabled: ready,
            message: message,
            pending: pending,
            source: source,
            state: !supported
                ? "unsupported"
                : ready
                  ? "ready"
                  : "permission_required",
        };
    }
    function notify(): void {
        var view = status();
        if (deps.onStatus) deps.onStatus(view);
        if (subscriber) subscriber(view);
    }
    function stopTracks(value: any): void {
        if (!value || typeof value.getTracks !== "function") return;
        value.getTracks().forEach(function (track: any) {
            track.stop();
        });
    }
    function stop(): void {
        if (cancelBrowser) cancelBrowser();
        generation++;
        deadline = 0;
        wallDeadline = 0;
        binding = null;
        pending = false;
        if (timer !== null) w.clearTimeout(timer);
        timer = null;
        var old = stream;
        stream = null;
        frameCapture = null;
        stopTracks(old);
        if (!nativeCapture) source = null;
        message = "Remote screenshots are off.";
        notify();
    }
    function failGrant(text: string): void {
        stop();
        message = text;
        notify();
    }
    function arm(config: ScreenshotConfig, epoch: number): boolean {
        if (
            epoch !== generation ||
            !sameConfig(config) ||
            !sameConfig(currentConfig())
        )
            return false;
        var now = clock();
        if (now < 0) return false;
        if (timer !== null) w.clearTimeout(timer);
        deadline = now + grantMs;
        lastWallClock = Date.now();
        wallDeadline = lastWallClock + grantMs;
        pending = false;
        message =
            "Remote screenshots are allowed for 10 minutes. Close settings to capture.";
        timer = w.setTimeout(stop, grantMs);
        notify();
        return true;
    }
    function grant(local: boolean): void {
        if (
            local !== true ||
            w.__ottRemoteInputActive ||
            pending ||
            !supported ||
            w.__ottRemoteScreenshot !== hook
        )
            return;
        var config = currentConfig();
        if (!config) {
            failGrant(
                "Connect an HTTPS command server before allowing screenshots."
            );
            return;
        }
        stop();
        binding = config;
        var epoch = generation;
        if (nativeCapture && nativeCurrent && nativeCurrent()) {
            if (!arm(config, epoch))
                failGrant("Screenshot permission could not be enabled.");
            return;
        }
        pending = true;
        message =
            "Select the player tab or window in the browser sharing dialog.";
        notify();
        // Keep getDisplayMedia in the local gesture call stack. Never call it from RPC.
        var selection: any;
        try {
            selection = w.navigator.mediaDevices.getDisplayMedia({
                audio: false,
                preferCurrentTab: true,
                selfBrowserSurface: "include",
                surfaceSwitching: "exclude",
                video: {
                    height: { ideal: maxHeight },
                    width: { ideal: maxWidth },
                },
            });
        } catch (_) {
            failGrant("Screen sharing was cancelled or is unavailable.");
            return;
        }
        // A dismissed/unanswered picker must not retain controller authority indefinitely.
        timer = w.setTimeout(function () {
            if (generation === epoch && pending) stop();
        }, 60000);
        selection.then(
            function (selected: any) {
                if (
                    generation !== epoch ||
                    !pending ||
                    !sameConfig(currentConfig())
                ) {
                    stopTracks(selected);
                    return;
                }
                var tracks = selected.getVideoTracks();
                var surface =
                    tracks.length === 1 &&
                    tracks[0].getSettings().displaySurface;
                var kind =
                    surface === "browser"
                        ? "browser-tab"
                        : surface === "window"
                          ? "window"
                          : surface === "monitor"
                            ? "display"
                            : null;
                if (
                    !kind ||
                    tracks[0].readyState !== "live" ||
                    selected.getAudioTracks().length
                ) {
                    stopTracks(selected);
                    failGrant(
                        "This browser cannot identify the selected screenshot source."
                    );
                    return;
                }
                stream = selected;
                source = kind;
                tracks[0].addEventListener("ended", function () {
                    if (stream === selected) stop();
                });
                try {
                    frameCapture = new w.ImageCapture(tracks[0]);
                    if (!arm(config!, epoch)) stop();
                } catch (_) {
                    failGrant("Screen sharing could not start.");
                }
            },
            function () {
                if (generation === epoch)
                    failGrant(
                        "Screen sharing was cancelled or is unavailable."
                    );
            }
        );
    }
    function validImage(value: any): value is ScreenshotImage {
        if (
            !value ||
            Object.keys(value).length !== 5 ||
            typeof value.image !== "string" ||
            value.image.length > 1398104 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(value.image) ||
            value.image.length % 4 !== 0 ||
            value.source !== source ||
            (value.video !== "unknown" && value.video !== "excluded") ||
            typeof value.width !== "number" ||
            value.width % 1 ||
            value.width < 1 ||
            value.width > maxWidth ||
            typeof value.height !== "number" ||
            value.height % 1 ||
            value.height < 1 ||
            value.height > maxHeight
        )
            return false;
        try {
            var raw = w.atob(value.image);
            if (
                raw.length > maxBytes ||
                raw.slice(0, 8) !== "\x89PNG\r\n\x1a\n" ||
                raw.slice(12, 16) !== "IHDR"
            )
                return false;
            var int = function (at: number): number {
                return (
                    raw.charCodeAt(at) * 16777216 +
                    raw.charCodeAt(at + 1) * 65536 +
                    raw.charCodeAt(at + 2) * 256 +
                    raw.charCodeAt(at + 3)
                );
            };
            return int(16) === value.width && int(20) === value.height;
        } catch (_) {
            return false;
        }
    }
    function browserImage(bitmap: any): ScreenshotImage {
        if (
            !bitmap ||
            !bitmap.width ||
            !bitmap.height ||
            !stream ||
            !stream.active ||
            stream.getVideoTracks()[0].readyState !== "live" ||
            stream.getVideoTracks()[0].muted
        )
            throw new Error();
        var canvas = w.document.createElement("canvas");
        var scale = Math.min(
            1,
            maxWidth / bitmap.width,
            maxHeight / bitmap.height
        );
        for (var attempt = 0; attempt < 8; attempt++) {
            canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
            canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
            canvas
                .getContext("2d")
                .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            var encoded = canvas.toDataURL("image/png");
            if (encoded.indexOf("data:image/png;base64,") !== 0)
                throw new Error();
            var result: ScreenshotImage = {
                height: canvas.height,
                image: encoded.slice(22),
                source: source!,
                video: "unknown",
                width: canvas.width,
            };
            if (validImage(result)) return result;
            scale *= 0.75;
        }
        throw new Error();
    }
    function capture(done: (result: any) => void): () => void {
        var cancelled = false;
        if (!validGrant() || screenshotSurfaceBlocked(w) || capturing) {
            done({
                data: {
                    error: "Allow screenshots locally, close protected settings and keep the player visible.",
                },
                status: "rejected",
            });
            return function () {};
        }
        var epoch = generation;
        var port = w.__ottClassicScreenPort;
        var revision =
            port && typeof port.revision === "function"
                ? port.revision()
                : null;
        var timeout: any;
        var observer: any;
        var protectedTransition = false;
        capturing = true;
        function cleanup(): void {
            w.clearTimeout(timeout);
            if (observer) observer.disconnect();
        }
        var cancel = function (): void {
            cancelled = true;
            cleanup();
        };
        function finish(value?: any): void {
            capturing = false;
            cleanup();
            if (cancelled) return;
            cancelled = true;
            if (
                !value ||
                epoch !== generation ||
                !validGrant() ||
                protectedTransition ||
                screenshotSurfaceBlocked(w) ||
                w.__ottClassicScreenPort !== port ||
                (revision !== null && port.revision() !== revision) ||
                !validImage(value)
            ) {
                done({
                    data: {
                        error: "Screenshot unavailable, permission changed, or the player view changed. No image was returned.",
                    },
                    status: "rejected",
                });
                return;
            }
            done({ data: value, status: "ok" });
        }
        if (w.MutationObserver) {
            observer = new w.MutationObserver(function () {
                if (screenshotSurfaceBlocked(w)) protectedTransition = true;
            });
            observer.observe(w.document.documentElement, {
                attributes: true,
                childList: true,
                subtree: true,
            });
        }
        timeout = w.setTimeout(function () {
            if (!cancelled) {
                cancelled = true;
                cleanup();
                done({
                    data: { error: "Screenshot capture timed out." },
                    status: "rejected",
                });
            }
            if (cancelBrowser) {
                cancelBrowser();
                stop();
            }
            // Retain busy until the native callback drains: no accumulating captures.
        }, 12000);
        try {
            if (nativeCapture)
                nativeCapture().then(finish, function () {
                    finish();
                });
            else {
                // grabFrame requests a new snapshot from the live source. Never use
                // a cached <video> frame that could predate closing a protected view.
                var browserCapture = frameCapture;
                var browserFrame: any = null;
                var baseCancel = cancel;
                cancel = function () {
                    if (browserFrame !== null)
                        w.cancelAnimationFrame(browserFrame);
                    baseCancel();
                    capturing = false;
                    if (cancelBrowser === cancel) cancelBrowser = null;
                };
                cancelBrowser = cancel;
                var grab = function (): void {
                    if (cancelled) return;
                    if (!validGrant() || screenshotSurfaceBlocked(w)) {
                        finish();
                        return;
                    }
                    browserCapture.grabFrame().then(
                        function (bitmap: any) {
                            if (cancelled) {
                                if (bitmap && bitmap.close) bitmap.close();
                                return;
                            }
                            if (cancelBrowser === cancel) cancelBrowser = null;
                            try {
                                finish(browserImage(bitmap));
                            } catch (_) {
                                finish();
                            } finally {
                                if (bitmap && bitmap.close) bitmap.close();
                            }
                        },
                        function () {
                            if (cancelled) return;
                            if (cancelBrowser === cancel) cancelBrowser = null;
                            finish();
                        }
                    );
                };
                // Wait until the current DOM has actually painted. A capture requested
                // in the same task that closed a PIN/settings panel must not see it.
                browserFrame = w.requestAnimationFrame(function () {
                    if (cancelled) return;
                    browserFrame = w.requestAnimationFrame(function () {
                        browserFrame = null;
                        try {
                            grab();
                        } catch (_) {
                            finish();
                        }
                    });
                });
            }
        } catch (_) {
            finish();
        }
        return cancel;
    }
    hook = {
        capture: capture,
        configurationChanged: function () {
            stop();
        },
        grant: grant,
        snapshot: function () {
            var view = status();
            return { source: view.source, state: view.state };
        },
        status: status,
        stop: stop,
        subscribe: function (listener: any) {
            subscriber = listener;
            if (listener) listener(status());
        },
    };
    w.__ottRemoteScreenshot = hook;
    function nativeProbe(
        probe: () => Promise<any>,
        capture: () => Promise<any>,
        current: () => boolean
    ): void {
        nativeCurrent = current;
        try {
            probe().then(
                function (caps: any) {
                    if (w.__ottRemoteScreenshot !== hook || !current()) return;
                    if (
                        caps &&
                        caps.supported === true &&
                        (caps.source === "player-window" ||
                            caps.source === "player-view")
                    ) {
                        supported = true;
                        source = caps.source;
                        nativeCapture = capture;
                    }
                    notify();
                },
                function () {
                    notify();
                }
            );
        } catch (_) {
            /* Older shell: remain unsupported. */
        }
    }
    var tauri = w.__TAURI__;
    var cap = w.Capacitor;
    if (tauri) {
        var owner = tauri.core || tauri;
        var invoke = owner.invoke;
        if (typeof invoke === "function")
            nativeProbe(
                function () {
                    return invoke.call(owner, "screenshot_capabilities", {});
                },
                function () {
                    return invoke.call(owner, "capture_screenshot", {});
                },
                function () {
                    return (
                        w.__TAURI__ === tauri &&
                        (tauri.core || tauri) === owner &&
                        owner.invoke === invoke
                    );
                }
            );
    } else if (
        cap &&
        typeof cap.isNativePlatform === "function" &&
        cap.isNativePlatform()
    ) {
        var mobile = deps.mobile;
        if (
            mobile &&
            typeof cap.isPluginAvailable === "function" &&
            cap.isPluginAvailable("RemoteScreenshot")
        )
            nativeProbe(
                function () {
                    return mobile!.capabilities();
                },
                function () {
                    return mobile!.capture();
                },
                function () {
                    return (
                        w.Capacitor === cap &&
                        cap.isNativePlatform() &&
                        cap.isPluginAvailable("RemoteScreenshot")
                    );
                }
            );
    } else
        supported = !!(
            w.isSecureContext &&
            w.navigator &&
            w.navigator.mediaDevices &&
            typeof w.navigator.mediaDevices.getDisplayMedia === "function" &&
            typeof w.ImageCapture === "function" &&
            typeof w.ImageCapture.prototype.grabFrame === "function" &&
            typeof w.requestAnimationFrame === "function" &&
            typeof w.cancelAnimationFrame === "function"
        );
    if (w.addEventListener) w.addEventListener("pagehide", stop);
    notify();
    return hook;
}
