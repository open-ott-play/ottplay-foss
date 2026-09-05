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
/** Interval handle that increments archive playTime every second. */
var _playTimeInterval: ReturnType<typeof setInterval> | null = null;
/** Clear the playTime ticker interval if one is running. */
export function clearPlayTimeInterval(): void {
    if (_playTimeInterval !== null) {
        clearInterval(_playTimeInterval);
        _playTimeInterval = null;
    }
}
/** Active hls.js instance for the PiP video!. */
var hlsPipInstance: any = null;
/** Whether the player is currently in fullscreen mode. */
var isFullscreen = true;
/**
 * Current aspect ratio index: 0 = "contain" (letterbox), 1 = "cover" (crop).
 */
var aspectRatio = 0;

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
 * Process a raw key event to toggle fullscreen when keyCode === 76 ('L').
 *
 * @param event - A raw keyboard event object (or null/undefined).
 * @returns The numeric keyCode from the event, or 0 if the key was consumed
 *          by fullscreen handling or if no event.
 *
 * Side effects: Toggles fullscreen when 'L' is pressed and prevents the
 *               default browser action (typing 'l' in input fields).
 */
export function stbEventToKeyCode(event: any): number {
    if (event && event.keyCode === 76) {
        if (isNormalScreen()) openFullscreen();
        else closeFullscreen();
        // Prevent default action (typing 'l' in input fields) and stop propagation
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        return 0; // Indicate key was consumed
    }
    return event ? event.keyCode : 0;
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
 *                   need it — player.load() accepts a startTime option, but we
 *                   keep currentTime for parity with the native path).
 *
 * Side effects:
 * - Destroys any previous hls.js or shaka instance.
 * - Attaches hls.js or shaka to the video element if that engine is active.
 * - Calls video!.play() exactly once.
 * - Automatically restores previous audio/subtitle track settings via execCHarr.
 */
export function stbPlay(url: string, position?: number): void {
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    if (window.player) {
        window.player = null;
    }
    clearPlayTimeInterval();
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
    if (
        playerMode === 1 &&
        !_forceNative &&
        typeof Hls !== "undefined" &&
        Hls.isSupported()
    ) {
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
        hlsInstance = new Hls(hlsConfig);
        // ponytail: seek to position at MANIFEST_PARSED — currentTime === 0 guaranteed
        var _startPos = position || 0;
        var _mediaRecovered = false;
        var _networkRetries = 0;
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.ERROR, function (_event: any, data: any) {
            if (data.fatal) {
                console.error("[HLS] fatal error:", data.type, data.details);
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    var lvls = hlsInstance.levels || [];
                    var failed =
                        (data.frag && data.frag.level) ||
                        data.level ||
                        hlsInstance.currentLevel;
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
                        hlsInstance.destroy();
                        hlsInstance = null;
                        if (canNative) {
                            console.log(
                                "[HLS] MEDIA_ERROR twice, fallback native HTML5"
                            );
                            video!.src = url;
                            video!.play().catch(function () {});
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
            video!.play().catch(function (e) {
                console.log("[HLS] play() rejected:", e);
            });
            if (_startPos > 0) {
                video!.currentTime = _startPos;
                _startPos = 0;
            }
        });
        hlsInstance.on(
            Hls.Events.AUDIO_TRACKS_UPDATED,
            function (_e: any, d: any) {
                execCHarr("aAudios", function (i: number) {
                    if (hlsInstance) hlsInstance.audioTrack = i;
                });
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
        window.player = new shaka.Player(video);
        try {
            window.player.load(url);
            video!.play();
        } catch (e) {
            console.error(e);
        }
    } else {
        video!.src = url;
    }
    // Only call play() for non-HLS modes — HLS.js triggers play after manifest parsed
    if (playerMode !== 1) {
        video!.play();
        if (position && position > 0) {
            video!.currentTime = position;
        }
    }
    // Sync playType/playTime to window for external UI consumers
    window.playType = window.playType ?? 0;
    window.playTime = window.playTime ?? 0;
    // Start playTime ticker for archive playback (playType > 0 set by playArchive)
    if (window.playType > 0) {
        _playTimeInterval = setInterval(function () {
            window.playTime = (window.playTime as number) + 1;
        }, 1000);
    }
}

/**
 * Stop playback: pause, remove the src attribute, and destroy the hls.js instance.
 * Side effects: Mutates video element; may free decoder resources.
 */
export function stbStop(): void {
    video!.pause();
    video!.removeAttribute("src");
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
    video!.pause();
}
/**
 * Toggle play/pause. Resumes if paused, pauses if playing.
 * Side effects: Plays or pauses the video element.
 */
export function stbContinue(): void {
    if (video!.paused) video!.play();
    else video!.pause();
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
    video!.currentTime = v;
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
    $("#video").css({ height: "100%", left: 0, top: 0, width: "100%" });
    $("#vdiv").css({ height: "100%", left: 0, top: 0, width: "100%" });
    applyAspectRatio();
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
    $("#vdiv").css({
        height: 288 * h + "px",
        left: window.sListPos ? 758 * w + "px" : 10 * w + "px",
        top: 50 * h + "px",
        width: 512 * w + "px",
    });
    $("#video").css({ height: "100%", left: 0, top: 0, width: "100%" });
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
}

/**
 * Apply the current aspectRatio to the #video element's CSS `object-fit` property.
 * Index 0 → "contain", index 1 → "cover".
 *
 * Side effects: Direct DOM CSS mutation on #video!.
 */
export function applyAspectRatio(): void {
    $("#video").css("object-fit", ["contain", "cover"][aspectRatio]);
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
 * Count available subtitle tracks (hls.js subtitle tracks or native text tracks).
 * @returns Number of subtitle/text tracks.
 */
export function stbSubtitleExists(): number {
    if (hlsInstance) return hlsInstance.subtitleTracks.length;
    return video!.textTracks.length;
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
    if (playerMode === 1 && typeof Hls !== "undefined" && Hls.isSupported()) {
        if (hlsPipInstance) hlsPipInstance.destroy();
        hlsPipInstance = new Hls();
        hlsPipInstance.loadSource(url);
        hlsPipInstance.attachMedia(videoPip);
        hlsPipInstance.on(Hls.Events.MANIFEST_PARSED, function () {});
    } else {
        videoPip!.src = url;
    }
    videoPip!.play();
    $("#videopip").show();
    setPipPosition();
}

/**
 * Stop PiP playback, destroy the hls.js Pip instance, and hide the PiP element.
 *
 * Side effects: Hides #videopip; pauses and clears the PiP video!.
 */
export function stbStopPip(): void {
    videoPip!.pause();
    videoPip!.src = "";
    if (hlsPipInstance) hlsPipInstance.destroy();
    $("#videopip").hide();
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
    });
    try {
        if (!document.getElementById("vdiv")) {
            $("body").prepend(
                '<div id="vdiv" style="position: absolute; overflow: hidden; background-color: black;"><video id="video" style="position: absolute; object-position: center center;"></video></div><video id="videopip" muted style="position: absolute; display: none; background-color: black; object-position: center center;"></video>'
            );
        }
        video = document.getElementById("video") as HTMLVideoElement;
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
        if ((video as any).webkitVideoDecodedByteCount !== undefined) {
            setInterval(function () {
                if (
                    video!.videoWidth &&
                    (video as any).webkitVideoDecodedByteCount -
                        prevDecodedBytes >
                        0
                ) {
                    $("#video_res").html(
                        "<br/>" +
                            video!.videoWidth +
                            "x" +
                            video!.videoHeight +
                            "<br/>" +
                            Math.round(
                                ((((video as any).webkitVideoDecodedByteCount -
                                    prevDecodedBytes) *
                                    8) /
                                    1024 /
                                    1024) *
                                    100
                            ) /
                                100 +
                            " Mbps"
                    );
                }
                prevDecodedBytes = (video as any).webkitVideoDecodedByteCount;
            }, 1000);
        }
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
    if (hlsInstance && hlsInstance.audioTrack !== index) {
        hlsInstance.audioTrack = index;
        return;
    }
    var tracks = (video as any).audioTracks;
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
        tracks = hlsInstance
            ? hlsInstance.audioTracks
            : (video as any).audioTracks;
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
    var tracks = (video as any).textTracks;
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
    var cur = 0,
        tracks = hlsInstance
            ? hlsInstance.subtitleTracks
            : (video as any).textTracks;
    var labels = [tracks.length ? _("Off") : _("Not found")];
    if (hlsInstance) {
        tracks = hlsInstance.subtitleTracks;
        cur = hlsInstance.subtitleTrack + 1;
    }
    for (var i = 0; i < tracks.length; i++) {
        if (!hlsInstance && (tracks[i] as any).mode === "showing") cur = i + 1;
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
                setSubtitleTrack(v);
                saveCHarr("aSubs", v);
            }
        },
        -1
    );
}

/**
 * Toggle a CSS class `stb-zoom` on the document body for zoom effects.
 *
 * Side effects: Mutates document.body.classList.
 */
export function stbToggleZoom(): void {
    document.body.classList.toggle("stb-zoom");
}

/** Internal standby state flag. */
var _standby = false;

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
