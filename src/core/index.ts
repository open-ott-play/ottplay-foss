/**
 * Core STB player — video element management, playback control,
 * fullscreen, PiP, aspect ratio, audio/subtitle tracks.
 *
 * Ported from stb/core.js.
 */

declare var Hls: any;
declare var shaka: any;
declare var $: any;
declare function showSelectBox(
    current: number,
    items: string[],
    callback: (val: number) => void,
    exitKey?: number
): void;
declare function showShift(msg: string): void;
declare function _(key: string, ...args: any[]): string;
declare function saveCHarr(key: string, val: number): void;
declare function execCHarr(key: string, callback: (val: number) => void): void;

import { providerHasItemValue } from "../storage/index";

/** Reference to the primary <video> DOM element. */
export var video: HTMLVideoElement | null = null;
/** Reference to the PiP (picture-in-picture) <video> DOM element. */
export var videoPip: HTMLVideoElement | null = null;
/**
 * Active playback engine mode:
 * 0 = native HTML5, 1 = hls.js, 2 = shaka-player.
 */
export var playerMode = 0;

/**
 * Set the playback engine mode.
 * @param v - 0 (HTML5), 1 (hls.js), or 2 (shaka).
 */
export function setPlayerMode(v: number): void {
    playerMode = v;
    console.log("[setPlayerMode] playerMode=" + v);
}
/** Human-readable labels for each playerMode value. */
export var playerModeNames = ["html5", "hls.js", "shaka"];
/** Available preload buffer sizes (indexes into a numeric range). */
export var bufferSizes = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
];

/** Button label for the Exit key. */
export var strEXIT = "Esc";
/** Button label for the Enter key. */
export var strENTER = "ENTER";
/** Button label for the Tools key (wrench icon). */
export var strTools = '<span class="fontello">&#xe808;</span>';
/** Button label for the Info key. */
export var strInfo = '<span class="fontello">&#xe810;</span>';
/** Button label for the EPG key (empty by default). */
export var strEPG = "";
/** Button label for the PiP key. */
export var strPip = "W";
/** Button label for the Aspect Ratio key. */
export var strAspect = "A";
/** Button label for the Zoom key. */
export var strZoom = "E";
/** Button label for the Audio track key. */
export var strAudio = "S";
/** Button label for the Pre-Channel key. */
export var strPRECH = "?";
/** Button label for the Return key (left arrow icon). */
export var strRETURN = '<span class="fontello">&#xe804;</span>';
/** Button label for the Setup key. */
export var strSETUP = "§";
/** Button label for the Language key. */
export var strLANG = "SHIFT";

/** Active hls.js instance for the main video!. */
var hlsInstance: any = null;
/** One-shot live auto-restart after fatal HLS parse/network (reset on success / new play). */
var _liveRestartUsed = false;
/** Guard so recursive stbPlay from live restart does not clear _liveRestartUsed. */
var _inLiveRestart = false;
/** A restart is queued — skip duplicate fatal handlers to avoid stacking black screens. */
var _liveRestartPending = false;
var _liveRestartTimer: ReturnType<typeof setTimeout> | null = null;
/** Identifies the current user-requested playback session. */
var _playSession = 0;
/** The previous Shaka must release this video before another engine attaches. */
var _coreShakaTeardown: PromiseLike<unknown> | null = null;
var _corePendingSeek: (() => void) | null = null;

function isCoreThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        !!value && typeof (value as PromiseLike<unknown>).then === "function"
    );
}

/** Older WebKit play() returns void; modern autoplay failures must be consumed. */
function playCoreMedia(media: HTMLVideoElement): void {
    try {
        var result = media.play();
        if (isCoreThenable(result)) {
            result.then(undefined, function (error) {
                console.log("[video] play() rejected:", error);
            });
        }
    } catch (error) {
        console.log("[video] play() failed:", error);
    }
}

function cancelCoreSeek(): void {
    if (_corePendingSeek) _corePendingSeek();
    _corePendingSeek = null;
}

/** Some STB engines reject currentTime until loadedmetadata has arrived. */
function seekCoreMedia(position: number, session: number): void {
    cancelCoreSeek();
    if (!video || !isFinite(position) || position < 0) return;
    var media = video;
    function apply(): boolean {
        if (session !== _playSession || video !== media) return true;
        try {
            media.currentTime = position;
            return true;
        } catch (_notReady) {
            return false;
        }
    }
    var applied = apply();
    if (
        (!applied || media.readyState === 0) &&
        typeof media.addEventListener === "function"
    ) {
        var clear = function (): void {
            media.removeEventListener("loadedmetadata", onMetadata);
            if (_corePendingSeek === clear) _corePendingSeek = null;
        };
        var onMetadata = function (): void {
            apply();
            clear();
        };
        _corePendingSeek = clear;
        media.addEventListener("loadedmetadata", onMetadata);
    }
}

function destroyCoreShaka(): void {
    var player = window.player;
    window.player = null;
    if (!player || typeof player.destroy !== "function") return;
    try {
        var pending = player.destroy();
        if (isCoreThenable(pending)) {
            _coreShakaTeardown = pending;
            var clear = function (): void {
                if (_coreShakaTeardown === pending) _coreShakaTeardown = null;
            };
            pending.then(clear, function (error) {
                clear();
                console.error("[Shaka] destroy failed:", error);
            });
        }
    } catch (error) {
        console.error("[Shaka] destroy failed:", error);
    }
}

function cancelLiveRestart(): void {
    if (_liveRestartTimer !== null) {
        clearTimeout(_liveRestartTimer);
        _liveRestartTimer = null;
    }
    _liveRestartPending = false;
}

/**
 * Compatibility hook for archive callers. The UI background interval is the
 * sole playTime clock and already stops counting while playback is paused.
 */
export function clearPlayTimeInterval(): void {
    // No per-stream timer to clear.
}
/** Active hls.js instance for the PiP video!. */
var hlsPipInstance: any = null;
var _corePipSession = 0;
/** Whether the player is currently in fullscreen mode. */
var isFullscreen = true;
/**
 * Current aspect ratio index: 0 = "contain" (letterbox), 1 = "cover" (crop).
 * Default contain matches OTT companion / classic PC stb — whole frame visible
 * (bars OK). Toggle Aspect Ratio still switches contain|cover; per-channel
 * aAspects overrides when set.
 */
var aspectRatio = 0;
/**
 * Digital zoom index for HTML5: 0 = 100%, 1 = 125%, 2 = 150%, 3 = 175%.
 * Persisted per-channel in aZooms. Legacy only toggled body.stb-zoom with no CSS.
 */
var zoomLevel = 0;
var zoomScales = [1, 1.25, 1.5, 1.75];
var zoomLabels = ["100%", "125%", "150%", "175%"];

/** Active PiP size preset index (0 = small, 1 = medium, 2 = large). */
export var pipSize = 0;
/** Active PiP corner position index (0 = top-right, 1 = bottom-right, 2 = bottom-left, 3 = top-left). */
export var pipPosition = 0;
/** Whether the channel list is positioned on the right side (1) or left (0). */
export var listPos = 0;
/** Editor mode flag (1 = edit enabled, 0 = disabled). */
export var editorMode = 1;
/** Desired buffer size preference (string parsed from settings). */
export var bufSize: any = 0;
/** Previous sampling of webkitVideoDecodedByteCount for bitrate calculation. */
var prevDecodedBytes = 0;
/** PiP dimension presets in pixels: [small, medium, large]. */
var pipPresets = [
    { x: 256, y: 144 },
    { x: 384, y: 216 },
    { x: 512, y: 288 },
];

/**
 * Check whether the browser is currently NOT in fullscreen mode.
 * Uses vendor-prefixed fullscreen properties for cross-browser support.
 *
 * @returns `true` if no fullscreen API is active, `false` if in fullscreen.
 *          Returns `true` on error (defensive fallback).
 */
export function isNormalScreen(): boolean {
    try {
        return !(
            document.fullscreen ||
            (document as any).mozFullScreen ||
            (document as any).webkitFullScreen ||
            (document as any).msRequestFullscreen
        );
    } catch (e) {
        return true;
    }
}

/**
 * Request fullscreen on the entire document element.
 * Tries every vendor-prefixed API (standard, Moz, WebKit, MS).
 *
 * Side effects: Requests fullscreen from the browser; user gesture may be required.
 */
export function openFullscreen(): void {
    var elem = document.documentElement as any;
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
}

/**
 * Exit fullscreen mode.
 * Uses the same vendor-prefixed strategy as openFullscreen.
 *
 * Side effects: Exits fullscreen; may trigger a resize event.
 */
export function closeFullscreen(): void {
    var doc = document as any;
    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    else if (doc.msExitFullscreen) doc.msExitFullscreen();
}

/**
 * Toggle native OS/window fullscreen on Tauri (macOS WKWebView).
 * Always uses Rust `toggle_fullscreen` (effective FS then flip; macOS uses
 * simple fullscreen so webview keys still work) — do not trust
 * `__ottTauriNativeFs` or JS Window API naming. No global shortcuts.
 * Escape should call stbSetTauriNativeFullscreen(false), not this toggle.
 */
export function stbToggleTauriNativeFullscreen(): Promise<void> {
    return (async function () {
        try {
            var nextFs: boolean | null = null;
            var err: any = null;

            var invokeToggle = async function (inv: any): Promise<boolean> {
                var res: any = await Promise.resolve(inv("toggle_fullscreen"));
                if (res && typeof res.fullscreen === "boolean") {
                    nextFs = res.fullscreen;
                    return true;
                }
                // Older shell without fullscreen field — still treat as success.
                nextFs = !(window as any).__ottTauriNativeFs;
                return true;
            };

            try {
                var coreApi = (window as any).__TAURI__?.core;
                if (coreApi && typeof coreApi.invoke === "function") {
                    await invokeToggle(function (cmd: string) {
                        return coreApi.invoke(cmd);
                    });
                }
            } catch (e1) {
                err = e1;
            }

            if (nextFs === null) {
                try {
                    var internals = (window as any).__TAURI_INTERNALS__;
                    if (internals && typeof internals.invoke === "function") {
                        await invokeToggle(function (cmd: string) {
                            return internals.invoke(cmd);
                        });
                    }
                } catch (e2) {
                    err = e2;
                }
            }

            // Last resort: probe + set_fullscreen(bool) if toggle_fullscreen missing.
            if (nextFs === null) {
                try {
                    var tw = (window as any).__TAURI__?.window;
                    var curWin =
                        typeof tw?.getCurrentWindow === "function"
                            ? tw.getCurrentWindow()
                            : typeof tw?.getCurrent === "function"
                              ? tw.getCurrent()
                              : null;
                    // Tauri 2 may expose webviewWindow.getCurrent instead.
                    if (!curWin) {
                        var twv = (window as any).__TAURI__?.webviewWindow;
                        if (typeof twv?.getCurrent === "function")
                            curWin = twv.getCurrent();
                    }
                    var curFs = !!(window as any).__ottTauriNativeFs;
                    if (curWin && typeof curWin.isFullscreen === "function") {
                        try {
                            var probed: any = curWin.isFullscreen();
                            if (probed && typeof probed.then === "function")
                                probed = await probed;
                            if (typeof probed === "boolean") curFs = probed;
                        } catch (_probe) {}
                    }
                    var want = !curFs;
                    var core2 = (window as any).__TAURI__?.core;
                    if (core2 && typeof core2.invoke === "function") {
                        await core2.invoke("set_fullscreen", {
                            fullscreen: want,
                        });
                        nextFs = want;
                    } else if (
                        curWin &&
                        typeof curWin.setFullscreen === "function"
                    ) {
                        await Promise.resolve(curWin.setFullscreen(want));
                        nextFs = want;
                    }
                } catch (e3) {
                    err = e3;
                }
            }

            if (nextFs === null) {
                try {
                    console.warn(
                        "[Tauri] toggle_fullscreen failed:",
                        err || "no invoke path"
                    );
                } catch (_e) {}
                return;
            }

            (window as any).__ottTauriNativeFs = nextFs;

            // Collapse in-page list so video fills the window when entering FS.
            try {
                if (nextFs && typeof (window as any).closeList === "function") {
                    var listOpen = !!(window as any).isListVisible;
                    try {
                        if (
                            typeof (window as any).$ !== "undefined" &&
                            ((window as any).$("#list_window").is(":visible") ||
                                (window as any).$("#list_osd").is(":visible"))
                        )
                            listOpen = true;
                    } catch (_e2) {}
                    if (listOpen) (window as any).closeList();
                }
            } catch (_e3) {}
        } catch (_eFs) {
            try {
                console.warn("[Tauri] L fullscreen toggle failed:", _eFs);
            } catch (_e) {}
        }
    })();
}

/**
 * Explicitly set Tauri native/simple fullscreen on or off.
 * Escape uses want=false (force exit). Prefer Rust set_fullscreen so the
 * track flag and saved outer geometry stay aligned with reality.
 */
export function stbSetTauriNativeFullscreen(want: boolean): Promise<void> {
    return (async function () {
        try {
            var nextFs: boolean | null = null;
            var inv: any = null;
            try {
                var coreApi = (window as any).__TAURI__?.core;
                if (coreApi && typeof coreApi.invoke === "function")
                    inv = function (cmd: string, args?: any) {
                        return coreApi.invoke(cmd, args);
                    };
            } catch (_e0) {}
            if (!inv) {
                try {
                    var internals = (window as any).__TAURI_INTERNALS__;
                    if (internals && typeof internals.invoke === "function")
                        inv = function (cmd: string, args?: any) {
                            return internals.invoke(cmd, args);
                        };
                } catch (_e1) {}
            }
            if (!inv) {
                try {
                    console.warn("[Tauri] set_fullscreen: no invoke path");
                } catch (_e) {}
                return;
            }
            var res: any = await Promise.resolve(
                inv("set_fullscreen", { fullscreen: !!want })
            );
            if (res && typeof res.fullscreen === "boolean")
                nextFs = res.fullscreen;
            else nextFs = !!want;
            (window as any).__ottTauriNativeFs = nextFs;
            try {
                if (nextFs && typeof (window as any).closeList === "function") {
                    var listOpen = !!(window as any).isListVisible;
                    try {
                        if (
                            typeof (window as any).$ !== "undefined" &&
                            ((window as any).$("#list_window").is(":visible") ||
                                (window as any).$("#list_osd").is(":visible"))
                        )
                            listOpen = true;
                    } catch (_e2) {}
                    if (listOpen) (window as any).closeList();
                }
            } catch (_e3) {}
        } catch (_eSet) {
            try {
                console.warn("[Tauri] set_fullscreen failed:", _eSet);
            } catch (_e) {}
        }
    })();
}

/**
 * Process a raw key event to toggle fullscreen when keyCode === 76 ('L').
 *
 * @param event - A raw keyboard event object (or null/undefined).
 * @returns The numeric keyCode from the event, or 0 if the key was consumed
 *          by fullscreen handling or if no event.
 *
 * Side effects: Toggles fullscreen when 'L' is pressed and prevents the
 *               default browser action (typing 'l' in input fields).
 */

/**
 * Tauri/macOS: native <video> often keeps focus in full-video mode so
 * window.onkeydown never sees L/Escape, while the channel list (no video
 * focus) still does. Capture-phase document listener toggles/exits simple
 * fullscreen without any global KeyL shortcut.
 */
export function installTauriFsKeyCapture(): void {
    if (typeof window === "undefined") return;
    if (typeof (window as any).__TAURI__ === "undefined") return;
    if ((window as any).__ottTauriFsKeyCapture) return;
    (window as any).__ottTauriFsKeyCapture = true;
    document.addEventListener(
        "keydown",
        function (ev: KeyboardEvent) {
            try {
                var t = ev.target as HTMLElement | null;
                if (
                    t &&
                    (t.tagName === "INPUT" ||
                        t.tagName === "TEXTAREA" ||
                        t.isContentEditable)
                ) {
                    return;
                }
            } catch (_t) {}
            var key = ev.key || "";
            var code = ev.code || "";
            var kc =
                typeof ev.keyCode === "number" && ev.keyCode
                    ? ev.keyCode
                    : typeof ev.which === "number" && ev.which
                      ? ev.which
                      : 0;
            var isL =
                kc === 76 || key === "l" || key === "L" || code === "KeyL";
            var isEsc = kc === 27 || key === "Escape" || code === "Escape";
            if (!isL && !isEsc) return;

            if (isL) {
                var editing = false;
                try {
                    if (
                        typeof (window as any).$ !== "undefined" &&
                        (window as any).$("#listEdit").is(":visible")
                    )
                        editing = true;
                } catch (_e) {}
                if (editing) return;
                // Rust toggle_fullscreen is the source of truth (simple FS
                // flag + geometry). Always toggle — do not guess from JS.
                void stbToggleTauriNativeFullscreen();
                if (ev.preventDefault) ev.preventDefault();
                if (ev.stopPropagation) ev.stopPropagation();
                if (typeof (ev as any).stopImmediatePropagation === "function")
                    (ev as any).stopImmediatePropagation();
                return;
            }

            // Escape: force exit simple FS when flagged; otherwise let
            // keyHandler run (list close / exitPortal).
            if (isEsc && (window as any).__ottTauriNativeFs) {
                void stbSetTauriNativeFullscreen(false);
                if (ev.preventDefault) ev.preventDefault();
                if (ev.stopPropagation) ev.stopPropagation();
                if (typeof (ev as any).stopImmediatePropagation === "function")
                    (ev as any).stopImmediatePropagation();
            }
        },
        true
    );
}

export function stbEventToKeyCode(event: any): number {
    if (!event) return 0;

    // Prefer classic keyCode/which; some hosts (incl. Tauri webview) report 0.
    var keyCode =
        typeof event.keyCode === "number" && event.keyCode
            ? event.keyCode
            : typeof event.which === "number" && event.which
              ? event.which
              : 0;

    if (!keyCode) {
        var key = event.key || "";
        var code = event.code || "";
        // Map common keys when keyCode/which is missing (sync; no Tauri invoke).
        if (key === "ArrowLeft" || code === "ArrowLeft") keyCode = 37;
        else if (key === "ArrowUp" || code === "ArrowUp") keyCode = 38;
        else if (key === "ArrowRight" || code === "ArrowRight") keyCode = 39;
        else if (key === "ArrowDown" || code === "ArrowDown") keyCode = 40;
        else if (key === "Enter" || code === "Enter" || code === "NumpadEnter")
            keyCode = 13;
        else if (key === "Escape" || code === "Escape") keyCode = 27;
        else if (key === " " || key === "Spacebar" || code === "Space")
            keyCode = 32;
        else if (key === "Backspace" || code === "Backspace") keyCode = 8;
        else if (key === "Delete" || code === "Delete") keyCode = 46;
        else if (key === "PageUp" || code === "PageUp") keyCode = 33;
        else if (key === "PageDown" || code === "PageDown") keyCode = 34;
        else if (key === "Home" || code === "Home") keyCode = 36;
        else if (key === "End" || code === "End") keyCode = 35;
        else if (key === "AudioVolumeMute" || code === "AudioVolumeMute")
            keyCode = 173; // keys.MUTE
        else if (key === "AudioVolumeDown" || code === "AudioVolumeDown")
            keyCode = 174; // keys.VOL_DOWN
        else if (key === "AudioVolumeUp" || code === "AudioVolumeUp")
            keyCode = 175; // keys.VOL_UP
        else if (
            key === "MediaPlayPause" ||
            code === "MediaPlayPause" ||
            key === "MediaPlay" ||
            code === "MediaPlay" ||
            key === "MediaPause" ||
            code === "MediaPause"
        )
            keyCode = 80; // keys.PLAY / keys.PAUSE
        else if (key === "MediaStop" || code === "MediaStop")
            keyCode = 83; // keys.STOP
        else if (key === "GoBack" || code === "GoBack" || key === "BrowserBack")
            keyCode = 27; // keys.EXIT (menu/back remotes; Android BACK parity)
        else if (key === "l" || key === "L" || code === "KeyL") keyCode = 76;
    }

    // Escape while Tauri native/simple fullscreen → force EXIT (not toggle).
    // Do not open exitPortal. Relies on macOS simple fullscreen so Escape
    // reaches the webview; never register a system-wide letter shortcut.
    if (keyCode === 27) {
        var inTauriEsc = typeof (window as any).__TAURI__ !== "undefined";
        if (inTauriEsc && (window as any).__ottTauriNativeFs) {
            void stbSetTauriNativeFullscreen(false);
            if (event.preventDefault) event.preventDefault();
            if (event.stopPropagation) event.stopPropagation();
            return 0;
        }
    }

    if (keyCode === 76) {
        // L/l/KeyL — fullscreen toggle on non-Tauri platforms.
        // On Tauri the capture-phase document listener in
        // installTauriFsKeyCapture owns L (stopImmediatePropagation
        // keeps window.onkeydown from running), so do NOT toggle here.
        var inTauri = typeof (window as any).__TAURI__ !== "undefined";
        if (!inTauri) {
            if (isNormalScreen()) openFullscreen();
            else closeFullscreen();
            if (event.preventDefault) event.preventDefault();
            if (event.stopPropagation) event.stopPropagation();
            return 0; // Indicate key was consumed
        }
    }
    return keyCode;
}

/**
 * Start playback of a given URL on the main video element.
 * Supports three engine modes: native HTML5, hls.js, and shaka-player.
 *
 * Playback start timing (exactly once per stream start):
 * - HLS path:    play() is invoked from the MANIFEST_PARSED event.
 * - Shaka path:  play() is invoked immediately after player.load().
 * - Native path: play() is invoked at the end of stbPlay().
 *
 * @param url      - Stream URL to play.
 * @param position - Optional start offset in seconds. Used as `#t=` fragment for
 *                   HLS (browser handles it on attach), and as a direct
 *                   currentTime assignment for native HTML5 (shaka does not
 *                   need it; Shaka receives it as its load startTime).
 *
 * Side effects:
 * - Destroys any previous hls.js or shaka instance.
 * - Attaches hls.js or shaka to the video element if that engine is active.
 * - Calls video!.play() exactly once.
 * - Automatically restores previous audio/subtitle track settings via execCHarr.
 */
export function stbPlay(url: string, position?: number): void {
    if (!_inLiveRestart) {
        _playSession++;
        cancelLiveRestart();
        _liveRestartUsed = false;
    }
    (window as any).forcePlay = true;
    var session = _playSession;
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    cancelCoreSeek();
    destroyCoreShaka();
    clearPlayTimeInterval();
    if (
        window.__ottDebug &&
        window.__ottDebug.enabled &&
        typeof window.__ottDebug.beginSession === "function"
    ) {
        window.__ottDebug.beginSession(url);
    }
    // Shaka detach is asynchronous and may otherwise clear the next engine's src.
    var start = function (): void {
        if (session === _playSession) startCorePlayback(url, position, session);
    };
    if (_coreShakaTeardown) _coreShakaTeardown.then(start, start);
    else start();
    window.playType = window.playType ?? 0;
    window.playTime = window.playTime ?? 0;
}

function startCorePlayback(
    url: string,
    position: number | undefined,
    session: number
): void {
    // Decode-fail: try hls.js first, drop failing level, recover once; native only if Safari
    var _forceNative = false;
    var _pm =
        playerMode === 1 &&
        !_forceNative &&
        typeof Hls !== "undefined" &&
        Hls.isSupported()
            ? "hls.js"
            : playerMode === 2
              ? "shaka"
              : "html5";
    console.log(
        "[stbPlay] url=" +
            url.substring(0, 80) +
            "... playerMode=" +
            playerMode +
            " (" +
            _pm +
            ")"
    );
    var useHls =
        playerMode === 1 &&
        !_forceNative &&
        typeof Hls !== "undefined" &&
        Hls.isSupported();
    if (useHls) {
        // #167 retry caps are archive-only: live FHD fragments are large and a
        // single timeout was aborting the stream (then video error 3 DECODE).
        var _isArchive =
            (position && position > 0) ||
            (typeof window.playType === "number" && window.playType > 0);
        var hlsConfig: any = {
            backBufferLength: 90,
            capLevelToPlayerSize: false,
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 30,
            maxBufferSize: 120000000,
            maxMaxBufferLength: 600,
            overrideNative: false,
            startLevel: -1,
        };
        if (_isArchive) {
            hlsConfig.fragLoadingMaxRetry = 1;
            hlsConfig.levelLoadingMaxRetry = 1;
            hlsConfig.manifestLoadingMaxRetry = 1;
        }
        if (
            window.__ottDebug &&
            window.__ottDebug.enabled &&
            typeof window.__ottDebug.wrapXhrSetup === "function"
        ) {
            hlsConfig.xhrSetup = window.__ottDebug.wrapXhrSetup(
                hlsConfig.xhrSetup
            );
        }
        hlsInstance = new Hls(hlsConfig);
        var playbackHls = hlsInstance;
        if (
            window.__ottDebug &&
            window.__ottDebug.enabled &&
            typeof window.__ottDebug.attachHls === "function"
        ) {
            window.__ottDebug.attachHls(hlsInstance);
        }
        // ponytail: seek to position at MANIFEST_PARSED — currentTime === 0 guaranteed
        var _startPos = position || 0;
        var _mediaRecovered = false;
        var _networkRetries = 0;
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.ERROR, function (_event: any, data: any) {
            if (session !== _playSession || hlsInstance !== playbackHls) return;
            if (data.fatal) {
                console.error("[HLS] fatal error:", data.type, data.details);
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    var lvls = hlsInstance.levels || [];
                    var failed =
                        data.frag && typeof data.frag.level === "number"
                            ? data.frag.level
                            : typeof data.level === "number"
                              ? data.level
                              : hlsInstance.currentLevel;
                    if (lvls.length > 1 && failed > 0) {
                        var cap = failed - 1;
                        console.log(
                            "[HLS] MEDIA_ERROR: drop level " +
                                failed +
                                " cap=" +
                                cap
                        );
                        hlsInstance.autoLevelCapping = cap;
                        if (typeof hlsInstance.removeLevel === "function") {
                            hlsInstance.removeLevel(failed);
                            hlsInstance.startLoad();
                            return;
                        }
                        hlsInstance.currentLevel = cap;
                    } else {
                        // hls-proxy always exposes a single STREAM-INF, so
                        // drop-level never runs for proxied live channels.
                        console.log(
                            "[HLS] MEDIA_ERROR: skip drop level (levels=" +
                                lvls.length +
                                " failed=" +
                                failed +
                                ")"
                        );
                    }
                    if (!_mediaRecovered) {
                        _mediaRecovered = true;
                        console.log(
                            "[HLS] trying recoverMediaError" +
                                (data.details ? " (" + data.details + ")" : "")
                        );
                        hlsInstance.recoverMediaError();
                    } else {
                        // Chrome/Edge MSE cannot play HLS natively. Setting
                        // video.src to an .m3u8 only yields SRC_NOT_SUPPORTED
                        // and hides the real cause (often mp2/ac3 audio on
                        // "HD Orig" streams — use remuxed "HD" / AAC instead).
                        var canNative = false;
                        try {
                            canNative = !!(
                                video &&
                                typeof video.canPlayType === "function" &&
                                video.canPlayType(
                                    "application/vnd.apple.mpegurl"
                                )
                            );
                        } catch (_e) {
                            canNative = false;
                        }
                        var det = String((data && data.details) || "");
                        var appendFail =
                            det.indexOf("bufferAppend") !== -1 ||
                            det.indexOf("bufferAppendError") !== -1;
                        // destroy() clears currentTime. Preserve the requested/resumed
                        // VOD position before moving from MSE to native HLS.
                        var nativePosition = video!.currentTime || _startPos;
                        hlsInstance.destroy();
                        hlsInstance = null;
                        if (canNative) {
                            console.log(
                                "[HLS] MEDIA_ERROR twice, fallback native HTML5"
                            );
                            video!.src = url;
                            if (nativePosition > 0)
                                seekCoreMedia(nativePosition, session);
                            if ((window as any).forcePlay !== false)
                                playCoreMedia(video!);
                        } else {
                            console.log(
                                "[HLS] MEDIA_ERROR twice, no native HLS" +
                                    (det ? " details=" + det : "") +
                                    (appendFail
                                        ? " (HD Orig often mp2/ac3 + strict Chrome decode)"
                                        : "")
                            );
                            $("#buffering").hide();
                            $("#video_res").html(
                                "<br/>error DECODE" +
                                    (appendFail ? " (HD Orig)" : "") +
                                    " — try HD remux / AAC"
                            );
                        }
                    }
                } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    // levelParsingError / manifest parse are not transient —
                    // startLoad() would loop forever (no-EPG archive bad URL,
                    // purged segments, proxy HTML error pages).
                    var det = String((data && data.details) || "");
                    var parseFail =
                        det.indexOf("Parsing") !== -1 ||
                        det.indexOf("parsing") !== -1;
                    if (parseFail || _networkRetries >= 2) {
                        // Live: one-shot destroy + same-URL reload after parse
                        // fail (e.g. proxy HTML 403). Archive: destroy only (#220).
                        if (
                            parseFail &&
                            !_isArchive &&
                            !_liveRestartUsed &&
                            (window as any).forcePlay !== false
                        ) {
                            // ponytail: one-shot — skip duplicate fatal handlers while restart is in flight
                            if (_liveRestartPending) {
                                console.log(
                                    "[HLS] live: restart already pending, skipping duplicate fatal"
                                );
                                return;
                            }
                            _liveRestartUsed = true;
                            _liveRestartPending = true;
                            console.log(
                                "[HLS] live: restart same URL after fatal parse/network"
                            );
                            if (
                                window.__ottDebug &&
                                window.__ottDebug.enabled &&
                                typeof window.__ottDebug.push === "function"
                            ) {
                                window.__ottDebug.push("hls", "live-restart", {
                                    details: det,
                                    url: url,
                                });
                            }
                            hlsInstance.destroy();
                            hlsInstance = null;
                            // User-visible feedback: "Reconnecting…" clears on MANIFEST_PARSED / playing
                            if (typeof showShift === "function") {
                                showShift(_("Reconnecting…"));
                            }
                            // ponytail: 300–500ms backoff before re-stbPlay (not a retry loop — still one-shot)
                            var _delay = 300 + Math.floor(Math.random() * 200);
                            _liveRestartTimer = setTimeout(function () {
                                if (
                                    session !== _playSession ||
                                    !_liveRestartPending ||
                                    (window as any).forcePlay === false
                                )
                                    return;
                                _liveRestartTimer = null;
                                _inLiveRestart = true;
                                try {
                                    stbPlay(url, 0);
                                } finally {
                                    _inLiveRestart = false;
                                    _liveRestartPending = false;
                                }
                            }, _delay);
                            return;
                        }
                        console.log(
                            "[HLS] unrecoverable network/parse, destroying"
                        );
                        hlsInstance.destroy();
                        hlsInstance = null;
                    } else {
                        _networkRetries++;
                        console.log("[HLS] trying startLoad");
                        hlsInstance.startLoad();
                    }
                } else {
                    console.log("[HLS] unrecoverable, destroying");
                    hlsInstance.destroy();
                    hlsInstance = null;
                }
            }
        });
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
            if (session !== _playSession || hlsInstance !== playbackHls) return;
            _liveRestartUsed = false;
            _liveRestartPending = false;
            if ((window as any).forcePlay !== false) {
                playCoreMedia(video!);
            }
            if (_startPos > 0) {
                seekCoreMedia(_startPos, session);
                _startPos = 0;
            }
        });
        hlsInstance.on(
            Hls.Events.AUDIO_TRACKS_UPDATED,
            function (_e: any, d: any) {
                if (session !== _playSession || hlsInstance !== playbackHls)
                    return;
                execCHarr("aAudios", function (i: number) {
                    if (hlsInstance) hlsInstance.audioTrack = i;
                });
                if (typeof (window as any).refreshAudioBadge === "function")
                    (window as any).refreshAudioBadge();
            }
        );
        execCHarr("aSubs", function (i: number) {
            if (hlsInstance) hlsInstance.subtitleTrack = i - 1;
        });
    } else if (
        playerMode === 2 &&
        typeof shaka !== "undefined" &&
        shaka.Player &&
        shaka.Player.isBrowserSupported()
    ) {
        var playbackShaka = new shaka.Player(video);
        window.player = playbackShaka;
        var loaded = function (): void {
            if (
                session === _playSession &&
                window.player === playbackShaka &&
                (window as any).forcePlay !== false
            ) {
                playCoreMedia(video!);
            }
        };
        var failed = function (error: unknown): void {
            if (session === _playSession && window.player === playbackShaka)
                console.error("[Shaka] load failed:", error);
        };
        try {
            var loading = playbackShaka.load(
                url,
                position && position > 0 ? position : undefined
            );
            if (isCoreThenable(loading)) loading.then(loaded, failed);
            else loaded();
        } catch (error) {
            failed(error);
        }
    } else {
        video!.src = url;
        if (position && position > 0) seekCoreMedia(position, session);
        if ((window as any).forcePlay !== false) playCoreMedia(video!);
    }
}

/**
 * Stop playback: pause, remove the src attribute, and destroy the hls.js instance.
 * Side effects: Mutates video element; may free decoder resources.
 */
export function stbStop(): void {
    _playSession++;
    cancelLiveRestart();
    cancelCoreSeek();
    (window as any).forcePlay = false;
    video!.pause();
    video!.removeAttribute("src");
    destroyCoreShaka();
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    clearPlayTimeInterval();
}
/**
 * Pause playback.
 * Side effects: Sets video!.pause().
 */
export function stbPause(): void {
    (window as any).forcePlay = false;
    cancelLiveRestart();
    video!.pause();
}
/**
 * Toggle play/pause. Resumes if paused, pauses if playing.
 * Side effects: Plays or pauses the video element.
 */
export function stbContinue(): void {
    if (video!.paused) {
        (window as any).forcePlay = true;
        playCoreMedia(video!);
    } else stbPause();
}
/**
 * Check whether the video is currently playing (not paused).
 * @returns `true` if video is playing, `false` if paused.
 */
export function stbIsPlaying(): boolean {
    return !video!.paused;
}
/**
 * Toggle the muted state on the video element.
 * Side effects: Flips video!.muted.
 */
export function stbToggleMute(): void {
    video!.muted = !video!.muted;
}
/**
 * Get the current volume level as a percentage.
 * @returns Volume in range 0–100.
 */
export function stbGetVolume(): number {
    return video!.volume * 100;
}
/**
 * Set the volume level.
 * @param v - Volume in range 0–100 (will be divided by 100 for the video element).
 * Side effects: Sets video!.volume.
 */
export function stbSetVolume(v: number): void {
    video!.volume = v / 100;
}
/**
 * Get the current playback position.
 * @returns Current time in seconds.
 */
export function stbGetPosTime(): number {
    return video!.currentTime;
}
/**
 * Seek to a specific playback position.
 * @param v - Target time in seconds.
 * Side effects: Sets video!.currentTime.
 */
export function stbSetPosTime(v: number): void {
    seekCoreMedia(v, _playSession);
    if (
        (window as any).playType < 0 &&
        typeof (window as any).updateMediaInfo === "function"
    ) {
        (window as any).updateMediaInfo();
    }
}
/**
 * Get the total duration of the loaded media.
 * @returns Duration in seconds (may be NaN or Infinity for live streams).
 */
export function stbGetLen(): number {
    return video!.duration;
}

/**
 * Expand the video container to fill the entire viewport (in-page fullscreen,
 * not browser fullscreen API). Sets the isFullscreen flag and reapplies
 * the aspect ratio CSS.
 *
 * Side effects: Mutates #video and #vdiv element positions/sizes via jQuery.
 */
export function stbToFullScreen(): void {
    isFullscreen = true;
    // Pin #vdiv to the visible viewport edges (not height/width 100% of an
    // oversized body — same failure mode as the 1.1.28 info-band bug). Flex
    // centers letterboxed frames when aspect is contain (WKWebView object-position
    // on <video> is unreliable).
    $("#vdiv").css({
        "align-items": "center",
        bottom: 0,
        display: "flex",
        height: "auto",
        "justify-content": "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        width: "auto",
    });
    try {
        var box = document.getElementById("vdiv");
        if (box) void (box as HTMLElement).offsetWidth;
    } catch (_reflow) {}
    applyAspectRatio();
    applyZoom();
}

/**
 * Shrink the video to a small window (picture-in-window) rather than fullscreen.
 * Position is calculated relative to a 1280×720 design canvas.
 *
 * Side effects: Mutates #video and #vdiv CSS dimensions; sets isFullscreen to false.
 */
export function stbSetWindow(): void {
    isFullscreen = false;
    var h = window.innerHeight / 720,
        w = window.innerWidth / 1280;
    // List chrome: #list margin 10 + caption 52 (yellow border under caption).
    // Old top:50*h sat under that line ("жёлтая линия отрезает шапку").
    // Keep 512×288 hole; #_t/#_b are synced in setColor to the same metrics.
    var listMargin = 10 * h;
    var capH = 52 * h;
    var top = listMargin + capH;
    $("#vdiv").css({
        "align-items": "center",
        bottom: "auto",
        display: "flex",
        height: 288 * h + "px",
        "justify-content": "center",
        left: window.sListPos ? 758 * w + "px" : 10 * w + "px",
        position: "absolute",
        right: "auto",
        top: top + "px",
        width: 512 * w + "px",
    });
    applyAspectRatio();
    applyZoom();
}

/**
 * Append diagnostic info (user-agent and public IP) to the #listAbout element.
 *
 * Side effects: DOM mutation on #listAbout; performs an HTTP GET to api.ipify.org.
 */
export function stbInfo(): void {
    $("#listAbout").append("<br/>userAgent: " + navigator.userAgent);
    var devId =
        typeof localStorage !== "undefined"
            ? localStorage.getItem("deviceId")
            : null;
    if (devId) $("#listAbout").append("<br/>Device ID: " + devId);
    var localUrl =
        typeof localStorage !== "undefined"
            ? localStorage.getItem("local_poll_url")
            : null;
    if (localUrl) $("#listAbout").append("<br/>Local Poll URL: " + localUrl);
    $.get("http://api.ipify.org", function (d: any) {
        $("#listAbout").append("<br/>Ip address: " + d);
    });
}

/**
 * Set the aspect ratio index and immediately apply it to the video element.
 * @param v - 0 = "contain" (letterbox), 1 = "cover" (crop/fill).
 * Side effects: Calls applyAspectRatio which mutates video CSS object-fit.
 */
export function setAspect(v: number): void {
    aspectRatio = v;
    applyAspectRatio();
    applyZoom();
}

/**
 * Apply the current aspectRatio to the #video element's CSS `object-fit` property.
 * Index 0 → "contain", index 1 → "cover".
 *
 * Side effects: Direct DOM CSS mutation on #video!.
 */
export function applyAspectRatio(): void {
    var fit = ["contain", "cover"][aspectRatio] || "contain";
    var box = document.getElementById("vdiv");
    var vEl = document.getElementById("video") as HTMLVideoElement | null;
    // Force layout after stbToFullScreen / resize CSS so client* is not stale
    // (1.1.29 explicit px geometry otherwise froze the previous crop size).
    if (box) void (box as HTMLElement).offsetWidth;
    var cw = 0;
    var ch = 0;
    if (isFullscreen) {
        // Viewport is the plane in full-video; more reliable than client* right
        // after inset:0 is applied on resize.
        cw = window.innerWidth || 0;
        ch = window.innerHeight || 0;
    } else if (box) {
        cw = box.clientWidth;
        ch = box.clientHeight;
    }
    var vw = vEl && vEl.videoWidth ? vEl.videoWidth : 0;
    var vh = vEl && vEl.videoHeight ? vEl.videoHeight : 0;
    // Explicit geometry: WKWebView often top-aligns letterboxed <video> frames
    // despite object-position:center. Size the element to the fitted frame and
    // let flex (#vdiv) center it (contain) or absolute-center the cover crop.
    if (cw > 0 && ch > 0 && vw > 0 && vh > 0) {
        var scale =
            fit === "contain"
                ? Math.min(cw / vw, ch / vh)
                : Math.max(cw / vw, ch / vh);
        var w = Math.max(1, Math.round(vw * scale));
        var h = Math.max(1, Math.round(vh * scale));
        if (fit === "contain") {
            $("#video").css({
                bottom: "",
                height: h + "px",
                left: "",
                "max-height": "100%",
                "max-width": "100%",
                "object-fit": "fill",
                "object-position": "center center",
                position: "relative",
                right: "",
                top: "",
                width: w + "px",
            });
        } else {
            $("#video").css({
                bottom: "",
                height: h + "px",
                left: Math.round((cw - w) / 2) + "px",
                "max-height": "",
                "max-width": "",
                "object-fit": "fill",
                "object-position": "center center",
                position: "absolute",
                right: "",
                top: Math.round((ch - h) / 2) + "px",
                width: w + "px",
            });
        }
        return;
    }
    // Fallback before metadata: CSS contain max-box / cover fill + flex center.
    if (fit === "contain") {
        $("#video").css({
            bottom: "",
            height: "auto",
            left: "",
            "max-height": "100%",
            "max-width": "100%",
            "object-fit": "contain",
            "object-position": "center center",
            position: "relative",
            right: "",
            top: "",
            width: "auto",
        });
    } else {
        $("#video").css({
            bottom: 0,
            height: "100%",
            left: 0,
            "max-height": "",
            "max-width": "",
            "object-fit": "cover",
            "object-position": "center center",
            position: "absolute",
            right: 0,
            top: 0,
            width: "100%",
        });
    }
}

/**
 * Open a selection box to let the user toggle between "contain" and "cover" aspect ratios.
 * On selection, persists the choice via saveCHarr.
 *
 * Side effects: Shows a select-box UI; writes to per-channel storage (aAspects).
 */
export function stbToggleAspectRatio(): void {
    showSelectBox(aspectRatio, ["contain", "cover"], function (v: number) {
        setAspect(v);
        saveCHarr("aAspects", v);
    });
}

/**
 * Check whether more than one audio track is available (hls.js or native).
 * @returns `true` if multiple audio tracks exist.
 */
export function stbAudioTracksExists(): boolean {
    var v = hlsInstance || video;
    return v && v.audioTracks ? v.audioTracks.length > 1 : false;
}

/**
 * True when a native textTrack looks like a real, selectable subtitle/caption
 * (not metadata, and not an anonymous WebKit placeholder with no label/lang).
 */
function isUsableNativeSubtitleTrack(t: any): boolean {
    var kind = (t && t.kind) || "";
    if (kind && kind !== "subtitles" && kind !== "captions") return false;
    return !!(t && (t.label || t.name || t.language || t.lang));
}

/**
 * Count available subtitle tracks worth offering in the Menu / picker.
 * hls.js: EXT-X-MEDIA subtitleTracks (0 when muxed remux has none — Chrome path).
 * Native HTML5 (Tauri/WKWebView): only subtitles/captions with label or language;
 * anonymous WebKit placeholders must not surface as "Switch subtitle".
 * @returns Number of usable subtitle/text tracks.
 */
export function stbSubtitleExists(): number {
    if (hlsInstance) return (hlsInstance.subtitleTracks || []).length;
    var tt = (video && video.textTracks) || [];
    var n = 0;
    for (var i = 0; i < tt.length; i++) {
        if (isUsableNativeSubtitleTrack(tt[i])) n++;
    }
    return n;
}

/**
 * Start PiP (picture-in-picture) playback for a given stream URL.
 * Supports hls.js when playerMode === 1.
 *
 * @param url - Stream URL for the PiP window.
 *
 * Side effects: Shows #videopip; attaches hls.js or native src; calls videoPip!.play().
 */
export function stbPlayPip(url: string): void {
    var session = ++_corePipSession;
    if (hlsPipInstance) {
        hlsPipInstance.destroy();
        hlsPipInstance = null;
    }
    if (playerMode === 1 && typeof Hls !== "undefined" && Hls.isSupported()) {
        var pipHls = new Hls();
        hlsPipInstance = pipHls;
        pipHls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (session === _corePipSession && hlsPipInstance === pipHls)
                playCoreMedia(videoPip!);
        });
        pipHls.loadSource(url);
        pipHls.attachMedia(videoPip);
    } else {
        videoPip!.src = url;
        playCoreMedia(videoPip!);
    }
    $("#videopip").show();
    setPipPosition();
}

/** Stop PiP, cancel its callbacks, and release the decoder and buffering OSD. */
export function stbStopPip(): void {
    _corePipSession++;
    videoPip!.pause();
    if (hlsPipInstance) {
        hlsPipInstance.destroy();
        hlsPipInstance = null;
    }
    videoPip!.removeAttribute("src");
    $("#videopip").hide();
    $("#pip_buffering").hide();
}
/**
 * Reposition and resize the PiP overlay based on the current pipSize and pipPosition
 * settings. All coordinates are computed relative to a 1280×720 design canvas.
 *
 * Positions: 0 = top-right, 1 = bottom-right, 2 = bottom-left, 3 = top-left.
 *
 * Side effects: Mutates #videopip CSS dimensions and position.
 */
export function setPipPosition(): void {
    // Legacy setPipPosBuf reads sPipSize / sPipPos globals — keep in sync.
    var win = window as any;
    function num(v: any, fallback: number): number {
        var n = typeof v === "number" ? v : parseInt(v, 10);
        return isNaN(n) ? fallback : n;
    }
    if (win.sPipSize !== undefined) pipSize = num(win.sPipSize, pipSize);
    if (win.sPipPos !== undefined) pipPosition = num(win.sPipPos, pipPosition);
    pipSize = Math.max(0, Math.min(pipPresets.length - 1, pipSize | 0));
    pipPosition = (((pipPosition | 0) % 4) + 4) % 4;

    var m = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    // Legacy: set all four sides (auto clears the opposite corner).
    var css: any = {
        bottom: pipPosition == 1 || pipPosition == 2 ? 20 * m + "px" : "auto",
        height: pipPresets[pipSize].y * m + "px",
        left: pipPosition > 1 ? 20 * m + "px" : "auto",
        right: pipPosition < 2 ? 20 * m + "px" : "auto",
        top: pipPosition == 0 || pipPosition == 3 ? 20 * m + "px" : "auto",
        width: pipPresets[pipSize].x * m + "px",
    };
    $("#videopip").css(css);
    $("#pip_buffering").css(css);
}

/**
 * Configure the video preload behaviour based on the stored buffer size setting.
 * If a positive buffer size is found, sets `preload = "auto"`.
 *
 * Side effects: Sets video!.preload attribute (may trigger early buffering).
 */
export function stbSetBuffer(): void {
    try {
        var b = Number.parseInt(
            (bufSize as any) || window.stbGetItem("sBufSize"),
            10
        );
        if (!isNaN(b) && b > 0 && video) {
            video!.preload = "auto";
        }
    } catch (e) {
        console.error("[stb] stbSetBuffer error:", e);
    }
}

/**
 * Inject custom CSS stored in STB settings (key `stb_custom_css`) into the document head.
 *
 * Side effects: Creates and appends a <style> element to document.head if CSS exists.
 */
export function stbCSS(): void {
    if (typeof window.stbGetItem !== "function") return;
    var css = window.stbGetItem("stb_custom_css");
    if (css) {
        var s = document.createElement("style");
        s.textContent = css;
        document.head.appendChild(s);
    }
}

/**
 * Auto-detect the player mode: if the provider has not set a player preference and
 * the browser cannot play HLS natively (Apple's `canPlayType`), fall back to hls.js (mode 1).
 *
 * Side effects: May set `playerMode` to 1.
 */
export function setPlayer(): void {
    if (
        video &&
        !providerHasItemValue("sPlayers") &&
        !video!.canPlayType("application/vnd.apple.mpegurl") &&
        typeof Hls !== "undefined" &&
        Hls.isSupported()
    ) {
        playerMode = 1;
    }
}

/**
 * Close the current browser window/tab (standard STB exit behaviour).
 */
export function stbExit(): void {
    window.close();
}

/**
 * Initialise the STB player: inject video DOM elements, attach event handlers,
 * go fullscreen, and set the global key handler.
 *
 * This is the bootstrap entry point for the player UI. It must be called once
 * after the document is ready.
 *
 * Side effects:
 * - Creates #vdiv, #video, and #videopip elements in the DOM if they do not exist.
 * - Sets up event listeners on the main video element (waiting, loadstart, canplay, error, etc.).
 * - Shows/hides #buffering and #video_res on playback events.
 * - Starts a 1-second interval to calculate and display decoded bitrate.
 * - Calls stbToFullScreen().
 * - Assigns `window.onkeydown = window.keyHandler`.
 */
export function stbInit(): void {
    $("body").css({ "background-color": "#111" });
    window.addEventListener("resize", function () {
        if (typeof window.setFontSize === "function") window.setFontSize();
        if (typeof window.setListPos === "function") window.setListPos();
        if (typeof window.setColor === "function") window.setColor();
        // Re-apply video fit/center after layout — sync path alone left explicit
        // px sizes from 1.1.29 stuck at the pre-resize crop.
        var refreshVideo = function () {
            if (isFullscreen) stbToFullScreen();
            else {
                applyAspectRatio();
                applyZoom();
            }
        };
        refreshVideo();
        try {
            requestAnimationFrame(function () {
                requestAnimationFrame(refreshVideo);
            });
        } catch (_raf) {
            refreshVideo();
        }
    });
    try {
        if (!document.getElementById("vdiv")) {
            $("body").prepend(
                '<div id="vdiv" style="position: absolute; overflow: hidden; background-color: black; display: flex; align-items: center; justify-content: center;"><video id="video" style="object-fit: contain; object-position: center center; max-width: 100%; max-height: 100%;"></video></div><video id="videopip" muted style="position: absolute; display: none; background-color: black; object-fit: cover; object-position: center center;"></video>'
            );
        }
        video = document.getElementById("video") as HTMLVideoElement;
        try {
            // Intrinsic size arrives async; re-center contain letterbox once known.
            video!.addEventListener("loadedmetadata", function () {
                applyAspectRatio();
                applyZoom();
            });
        } catch (_meta) {}
        try {
            // Keep focus off native <video> so L/Escape reach the document
            // key path in full-video mode (list overlay already did).
            video!.setAttribute("tabindex", "-1");
            var _blurVid = function () {
                try {
                    video!.blur();
                } catch (_b) {}
            };
            video!.addEventListener("playing", _blurVid);
            video!.addEventListener("click", _blurVid);
        } catch (_tab) {}
        video!.addEventListener("waiting", function () {
            $("#buffering").show();
            $("#video_res").html("<br/>connect...");
        });
        video!.addEventListener("loadstart", function () {
            $("#buffering").show();
            $("#video_res").html("<br/>buffering...");
        });
        video!.addEventListener("loadeddata", function () {
            console.log("Event: loadeddata");
        });
        video!.addEventListener("loadedmetadata", function () {
            console.log("Event: loadedmetadata");
        });
        video!.addEventListener("durationchange", function () {});
        video!.addEventListener("canplay", function () {
            $("#buffering").hide();
            $("#video_res").text("");
            if (video!.videoWidth)
                $("#video_res").html(
                    "<br/>" + video!.videoWidth + "x" + video!.videoHeight
                );
            if (typeof execCHarr === "function") {
                execCHarr("aAspects", setAspect);
                execCHarr("aZooms", setZoom);
                execCHarr("aSubs", setSubtitleTrack);
                execCHarr("aAudios", setAudioTrack);
            }
        });
        video!.addEventListener("playing", function () {
            $("#buffering").hide();
        });
        video!.addEventListener("error", function () {
            var _p =
                playerMode === 1
                    ? "hls.js"
                    : playerMode === 2
                      ? "shaka"
                      : "html5";
            var err = video?.error;
            var me = ["", "ABORTED", "NETWORK", "DECODE", "SRC_NOT_SUPPORTED"];
            var errName = err?.code ? me[err.code] || String(err.code) : "";
            console.log(
                "video > error: " +
                    (err?.code || "") +
                    (errName ? "-" + errName : "") +
                    (err?.message ? " (" + err.message + ")" : "") +
                    " player=" +
                    _p
            );
            $("#buffering").hide();
            $("#video_res").html(
                "<br/>error " +
                    (err?.code ?? 0) +
                    (errName ? " " + errName : "") +
                    " (" +
                    _p +
                    ")"
            );
        });
        video!.addEventListener("resize", function () {
            if (video!.videoWidth)
                $("#video_res").html(
                    "<br/>" + video!.videoWidth + "x" + video!.videoHeight
                );
        });
        [
            "waiting",
            "loadstart",
            "loadeddata",
            "loadedmetadata",
            "durationchange",
            "canplay",
            "canplaythrough",
            "playing",
            "error",
            "progress",
            "ratechange",
            "ended",
            "suspend",
            "emptied",
            "stalled",
            "abort",
            "play",
            "pause",
            "resize",
        ].forEach(function (e) {
            video!.addEventListener(e, videoEvent);
        });
        // Bitrate in #video_res (info1 bottom-right). Prefer WebKit decoded
        // bytes (OTT); fall back to hls.js bandwidthEstimate when missing.
        setInterval(function () {
            if (!video || !video.videoWidth) return;
            var res = "<br/>" + video.videoWidth + "x" + video.videoHeight;
            var mbps = 0;
            var decoded = (video as any).webkitVideoDecodedByteCount;
            if (decoded !== undefined && decoded - prevDecodedBytes > 0) {
                mbps =
                    Math.round(
                        (((decoded - prevDecodedBytes) * 8) / 1024 / 1024) * 100
                    ) / 100;
                prevDecodedBytes = decoded;
            } else if (decoded !== undefined) {
                prevDecodedBytes = decoded;
            }
            if (!(mbps > 0) && hlsInstance && hlsInstance.bandwidthEstimate) {
                mbps =
                    Math.round((hlsInstance.bandwidthEstimate / 1e6) * 100) /
                    100;
            }
            if (mbps > 0) {
                $("#video_res").html(res + "<br/>" + mbps + " Mbps");
            }
        }, 1000);
        videoPip = document.getElementById("videopip") as HTMLVideoElement;
        videoPip!.addEventListener("loadstart", function () {
            if (videoPip!.style.display != "none") $("#pip_buffering").show();
        });
        videoPip!.addEventListener("playing", function () {
            $("#pip_buffering").hide();
        });
    } catch (e) {
        console.error(e);
    }
    stbToFullScreen();
    window.onkeydown = window.keyHandler;
    try {
        installTauriFsKeyCapture();
    } catch (_fsKey) {}
}

/**
 * Log all video events to the console for debugging.
 * On 'error' events, also logs the MediaError code and message.
 *
 * @param event - Raw video DOM event.
 *
 * Side effects: Console output.
 */
function videoEvent(event: Event): void {
    if (event && event.type) {
        console.log("[video] event: " + event.type);
        if (event.type === "error") {
            var me = video ? video!.error : null;
            if (me)
                console.error(
                    "[video] MediaError: code=" + me.code + " msg=" + me.message
                );
        }
        if (
            window.__ottDebug &&
            window.__ottDebug.enabled &&
            typeof window.__ottDebug.onVideoEvent === "function"
        ) {
            window.__ottDebug.onVideoEvent(event);
        }
    }
}

/**
 * Switch to a specific audio track.
 * For hls.js, sets hlsInstance.audioTrack directly.
 * For native HTML5, iterates video!.audioTracks and enables only the target index.
 *
 * @param index - Zero-based audio track index.
 *
 * Side effects: Mutates hlsInstance.audioTrack or video!.audioTracks[i].enabled.
 */
function setAudioTrack(index: number): void {
    if (hlsInstance) {
        if (hlsInstance.audioTrack !== index) hlsInstance.audioTrack = index;
        return;
    }
    var tracks = (video && (video as any).audioTracks) || [];
    for (var i = 0; i < tracks.length; i++) tracks[i].enabled = i === index;
}

/**
 * Open a selection box listing all available audio tracks.
 * On selection, switches to the chosen track and persists the choice via saveCHarr.
 *
 * Side effects: Shows a select-box UI; calls setAudioTrack; writes to aAudios storage.
 */
export function stbToggleAudioTrack(): void {
    var cur = 0,
        tracks =
            (hlsInstance
                ? hlsInstance.audioTracks
                : video && (video as any).audioTracks) || [];
    if (!tracks.length) {
        showSelectBox(0, [_("Not found")], function () {}, 1500);
        return;
    }
    var labels: string[] = [];
    if (hlsInstance) cur = hlsInstance.audioTrack;
    for (var i = 0; i < tracks.length; i++) {
        if (!hlsInstance && tracks[i].enabled) cur = i;
        labels.push(
            i +
                1 +
                "/" +
                tracks.length +
                " (" +
                ((tracks[i] as any).label || (tracks[i] as any).name) +
                "/" +
                ((tracks[i] as any).language || (tracks[i] as any).lang) +
                ")"
        );
    }
    showSelectBox(
        cur,
        labels,
        function (v: number) {
            if (v !== cur) {
                setAudioTrack(v);
                saveCHarr("aAudios", v);
            }
        },
        -1
    );
}

/**
 * Switch to a specific subtitle track.
 * For hls.js, sets hlsInstance.subtitleTrack (subtract 1 because index 0 = "Off").
 * For native HTML5, sets textTracks[i].mode to "showing" or "disabled".
 *
 * @param index - 1-based subtitle track index (0 = "Off" / disabled).
 *
 * Side effects: Mutates hlsInstance.subtitleTrack or video!.textTracks[i].mode.
 */
function setSubtitleTrack(index: number): void {
    if (hlsInstance) {
        hlsInstance.subtitleTrack = index - 1;
        return;
    }
    var tracks = (video && video.textTracks) || [];
    for (var i = 0; i < tracks.length; i++)
        (tracks[i] as any).mode = i === index - 1 ? "showing" : "disabled";
}

/**
 * Open a selection box listing all available subtitle tracks (including "Off").
 * On selection, switches to the chosen track and persists via saveCHarr.
 *
 * Side effects: Shows a select-box UI; calls setSubtitleTrack; writes to aSubs storage.
 */
export function stbToggleSubtitle(): void {
    var cur = 0;
    var labels: string[];
    // Map picker index (1..N; 0 = Off) -> engine track index for setSubtitleTrack.
    var indexMap: number[] = [-1];

    if (hlsInstance) {
        var hTracks = hlsInstance.subtitleTracks || [];
        labels = [hTracks.length ? _("Off") : _("Not found")];
        cur = hlsInstance.subtitleTrack + 1;
        for (var hi = 0; hi < hTracks.length; hi++) {
            indexMap.push(hi);
            var hName =
                (hTracks[hi] as any).name ||
                (hTracks[hi] as any).label ||
                "#" + (hi + 1);
            var hLang =
                (hTracks[hi] as any).lang ||
                (hTracks[hi] as any).language ||
                "?";
            labels.push(
                hi + 1 + "/" + hTracks.length + " (" + hName + "/" + hLang + ")"
            );
        }
    } else {
        var nTracks = (video && video.textTracks) || [];
        var usable: { eng: number; t: any }[] = [];
        for (var ni = 0; ni < nTracks.length; ni++) {
            if (isUsableNativeSubtitleTrack(nTracks[ni]))
                usable.push({ eng: ni, t: nTracks[ni] });
        }
        labels = [usable.length ? _("Off") : _("Not found")];
        for (var ui = 0; ui < usable.length; ui++) {
            indexMap.push(usable[ui].eng);
            if ((usable[ui].t as any).mode === "showing") cur = ui + 1;
            var nName =
                (usable[ui].t as any).label ||
                (usable[ui].t as any).name ||
                "#" + (ui + 1);
            var nLang =
                (usable[ui].t as any).language ||
                (usable[ui].t as any).lang ||
                "?";
            labels.push(
                ui + 1 + "/" + usable.length + " (" + nName + "/" + nLang + ")"
            );
        }
    }

    if (labels.length < 2) {
        // No real tracks — brief OSD, do not open a stuck picker.
        showSelectBox(0, labels, function () {}, 1500);
        return;
    }

    showSelectBox(
        cur,
        labels,
        function (v: number) {
            if (v === cur) return;
            var eng = indexMap[v];
            // setSubtitleTrack expects 0 = Off, 1..N = engine index + 1
            setSubtitleTrack(eng < 0 ? 0 : eng + 1);
            saveCHarr("aSubs", eng < 0 ? 0 : eng + 1);
        },
        -1
    );
}

/**
 * Apply the current zoomLevel to #video (CSS transform scale) and body.stb-zoom.
 * Overflow crop is on #vdiv (see 1280.css). HS5-safe: also sets -webkit-transform.
 */
export function applyZoom(): void {
    var scale = zoomScales[zoomLevel] || 1;
    var el = document.getElementById("video") as HTMLElement | null;
    if (el) {
        var t = scale === 1 ? "" : "scale(" + scale + ")";
        el.style.transform = t;
        (el.style as any).webkitTransform = t;
        el.style.transformOrigin = "center center";
        (el.style as any).webkitTransformOrigin = "center center";
    }
    if (scale > 1) document.body.classList.add("stb-zoom");
    else document.body.classList.remove("stb-zoom");
}

/** Set zoom index and apply immediately. */
export function setZoom(v: number): void {
    zoomLevel = v;
    applyZoom();
}

/**
 * Open a selection box for digital zoom (100–175%). Persists via saveCHarr(aZooms).
 * Replaces the old body.stb-zoom toggle that had no CSS and looked like a no-op.
 */
export function stbToggleZoom(): void {
    showSelectBox(zoomLevel, zoomLabels, function (v: number) {
        setZoom(v);
        saveCHarr("aZooms", v);
    });
}

/** Internal standby state flag. */
var _standby = false;

/** Report shared standby state without toggling playback or native wake locks. */
export function stbIsStandby(): boolean {
    return _standby;
}

/**
 * Toggle standby mode (black screen + stopped playback).
 *
 * When entering standby: stops video, closes all lists, sets background to black,
 * and shows a "STANDBY" message in #launch.
 * When exiting standby: restores background and calls startPlayer.
 *
 * Side effects: DOM mutations, video stop, global key handler may be affected.
 */
export function stbToggleStandby(): void {
    _standby = !_standby;
    if (_standby) {
        if (typeof stbStop === "function") stbStop();
        if (typeof window.closeList === "function") window.closeList();
        document.body.style.backgroundColor = "#000";
        var launchEl = document.getElementById("launch");
        if (launchEl)
            launchEl.innerHTML =
                '<div style="text-align:center;padding-top:40%;color:#666;font-size:200%;">' +
                (window.standbyText || "STANDBY") +
                "</div>";
    } else {
        document.body.style.backgroundColor = "";
        if (typeof window.startPlayer === "function") window.startPlayer();
    }
    if (typeof window.setSleepTimeout === "function") window.setSleepTimeout();
}

/** Convenience wrapper for stbToggleStandby. */
export function toggleStandby(): void {
    stbToggleStandby();
}

/** Safely invoke stbToggleAspectRatio if it exists. */
export function toggleAspectRatio(): void {
    if (typeof stbToggleAspectRatio === "function") stbToggleAspectRatio();
}

/** Safely invoke stbToggleZoom if it exists. */
export function toggleZoom(): void {
    if (typeof stbToggleZoom === "function") stbToggleZoom();
}

/** Safely invoke stbToggleAudioTrack if it exists. */
export function toggleAudioTrack(): void {
    if (typeof stbToggleAudioTrack === "function") stbToggleAudioTrack();
}

/** Safely invoke stbToggleSubtitle if it exists. */
export function toggleSubtitle(): void {
    if (typeof stbToggleSubtitle === "function") stbToggleSubtitle();
}

/**
 * Backup all STB settings (from stbGetAllItems) into localStorage under `stb_settings_backup`.
 *
 * Side effects: Writes to localStorage; calls showShift on success.
 */
export function saveAllOptions(): void {
    try {
        var items = window.stbGetAllItems();
        localStorage.setItem("stb_settings_backup", JSON.stringify(items));
        window.showShift(_("Settings saved to storage"));
    } catch (e) {}
}

/**
 * Restore all STB settings from the localStorage backup (created by saveAllOptions).
 * Clears all existing items first, then writes each backed-up key.
 *
 * Side effects: Reads from localStorage; calls stbClearAllItems and stbSetItem for each key.
 */
export function loadAllOptions(): void {
    try {
        var d = localStorage.getItem("stb_settings_backup");
        if (!d) {
            window.showShift(_("No saved settings found"));
            return;
        }
        var items = JSON.parse(d);
        window.stbClearAllItems();
        for (var k in items)
            if (items.hasOwnProperty(k)) window.stbSetItem(k, items[k]);
        window.showShift(_("Settings loaded from storage"));
    } catch (e) {}
}

/**
 * Scale the entire body element to fit within the viewport while maintaining
 * the design canvas aspect ratio (1280×720 by default).
 *
 * Side effects: Sets CSS `transform: scale(...)` on <body>.
 */
export function setTransform(): void {
    var wi = window.wi || 1280;
    var hi = window.hi || 720;
    $("body").css(
        "transform",
        "scale(" +
            Math.min(window.innerWidth / wi, window.innerHeight / hi) +
            ")"
    );
}

/** Cleanup handler: stop playback on page unload. */
export function unload(): void {
    stbStop();
}

/**
 * Auto-start the player if the `stb_autorun` setting is "1".
 * Called on page load to check whether to begin playback immediately.
 *
 * Side effects: Calls startPlayer() if autorun is enabled.
 */
export function setAutorun(): void {
    var autorun = window.stbGetItem ? window.stbGetItem("stb_autorun") : null;
    if (autorun === "1" && typeof window.startPlayer === "function") {
        window.startPlayer();
    }
}

/** On DOM ready, set a pointer cursor on the body (touch/STB UI convention). */
if (typeof document !== "undefined" && document.body) {
    document.body.style.cursor = "pointer";
}
