/** Pure detail projection, loaded only for an explicit runtime snapshot. */
const DEBUG_MAX = 9007199254740991;
const NATIVE_NUMBERS = (
    "uptimeMs systemUptimeMs residentBytes pssBytes footprintBytes heapUsedBytes " +
    "heapLimitBytes systemAvailableBytes systemTotalBytes thermalState logicalProcessors " +
    "nativeHlsSessions nativeHlsBytes nativeHlsErrors epgChannels epgProgrammes " +
    "epgMappings epgShifts requestsTotal requestsActive requestsFailed"
).split(" ");
const NATIVE_BOOLS = ["lowMemory", "foreground", "lowPower"];
function finite(value: any, max = DEBUG_MAX): boolean {
    return (
        typeof value === "number" &&
        isFinite(value) &&
        value >= 0 &&
        value <= max
    );
}
function debugInteger(value: any): boolean {
    return finite(value) && Math.floor(value) === value;
}
function playbackAttempt(value: any, retired = false): any {
    if (!value) return null;
    var result: any = {};
    var valid =
        "attachment engineStarts fatalErrors nativeFallbacks streamRetries"
            .split(" ")
            .every(function (key) {
                result[key] = value[key];
                return debugInteger(value[key]);
            });
    if (retired) {
        result.handleId = value.handleId;
        result.generation = value.generation;
        result.reason = value.reason;
        valid =
            valid &&
            debugInteger(value.handleId) &&
            (value.generation === null || debugInteger(value.generation)) &&
            ["ended", "disposed", "suspended"].indexOf(value.reason) >= 0;
    }
    return valid ? result : null;
}
function versionToken(value: any): string | null {
    var match =
        typeof value === "string" && value.match(/^[A-Za-z0-9_.+\-]{1,64}$/);
    return match && match[0] === value ? value : null;
}
/** Native values are untrusted too; never copy arbitrary objects into reports. */
function projectNativeDebug(value: any): any {
    if (
        !value ||
        value.version !== 1 ||
        ["android", "ios", "tauri", "server"].indexOf(value.platform) < 0 ||
        !value.metrics ||
        typeof value.metrics !== "object" ||
        Array.isArray(value.metrics)
    )
        return null;
    var metrics: any = {};
    NATIVE_NUMBERS.forEach(function (key) {
        var sample = value.metrics[key];
        if (finite(sample)) metrics[key] = sample;
    });
    NATIVE_BOOLS.forEach(function (key) {
        var sample = value.metrics[key];
        if (typeof sample === "boolean") metrics[key] = sample;
    });
    return {
        appVersion: versionToken(value.appVersion),
        metrics: metrics,
        osVersion: versionToken(value.osVersion),
        platform: value.platform,
        version: 1,
        webviewVersion: versionToken(value.webviewVersion),
    };
}

function put(out: any, key: string, value: any, max = DEBUG_MAX): void {
    if (finite(value, max)) out[key] = value;
}
function bool(out: any, key: string, value: any): void {
    if (typeof value === "boolean") out[key] = value;
}
function projectMedia(w: any, version: number): any[] {
    function element(id: string): any {
        try {
            return w.document.getElementById(id);
        } catch (_) {
            return null;
        }
    }

    var result: any[] = [];
    ["main", "pip"].forEach(function (lane, index) {
        var node = element(index ? "videopip" : "video");
        if (!node) return;
        var metrics: any = {};
        var generation: number | null = null;
        var handleId: number | null = null;
        var engine: string | null = null;
        var attempt: any = null;
        var lastAttempt: any = null;
        try {
            var playback =
                w.__ottClassicPlayback && w.__ottClassicPlayback.snapshot();
            if (
                lane === "main" &&
                playback &&
                finite(playback.generation) &&
                Math.floor(playback.generation) === playback.generation
            )
                generation = playback.generation;
            var backend = w.__ottCoreBackendPeek && w.__ottCoreBackendPeek();
            var handle = backend && backend.current(lane);
            if (
                handle &&
                finite(handle.id) &&
                Math.floor(handle.id) === handle.id
            )
                handleId = handle.id;
            var attached =
                handle && handle.diagnosticEngine && handle.diagnosticEngine();
            if (
                attached === "hls.js" ||
                attached === "shaka" ||
                attached === "html5"
            )
                engine = attached;
            if (version === 3 && handle && handle.diagnosticAttempt) {
                attempt = playbackAttempt(handle.diagnosticAttempt());
            }
            if (version === 3 && backend && backend.lastAttempt)
                lastAttempt = playbackAttempt(backend.lastAttempt(lane), true);
        } catch (_) {
            /* A missing owner does not prevent element observations. */
        }
        try {
            put(metrics, "positionSeconds", node.currentTime);
            put(metrics, "durationSeconds", node.duration);
            put(metrics, "videoWidth", node.videoWidth);
            put(metrics, "videoHeight", node.videoHeight);
            put(metrics, "readyState", node.readyState, 4);
            put(metrics, "networkState", node.networkState, 3);
            put(metrics, "volume", node.volume, 1);
            if (node.error) put(metrics, "mediaErrorCode", node.error.code, 4);
            ["paused", "ended", "muted", "seeking"].forEach(function (key) {
                bool(metrics, key, node[key]);
            });
            var quality =
                node.getVideoPlaybackQuality && node.getVideoPlaybackQuality();
            if (quality) {
                put(metrics, "totalFrames", quality.totalVideoFrames);
                put(metrics, "droppedFrames", quality.droppedVideoFrames);
                put(metrics, "corruptedFrames", quality.corruptedVideoFrames);
            } else {
                put(metrics, "decodedFrames", node.webkitDecodedFrameCount);
                put(metrics, "droppedFrames", node.webkitDroppedFrameCount);
            }
            var ranges = node.buffered;
            if (
                ranges &&
                finite(ranges.length, 256) &&
                finite(node.currentTime)
            ) {
                var ahead = 0;
                for (var i = 0; i < ranges.length; i++)
                    if (
                        ranges.start(i) <= node.currentTime &&
                        ranges.end(i) >= node.currentTime
                    )
                        ahead = Math.max(
                            ahead,
                            ranges.end(i) - node.currentTime
                        );
                put(metrics, "bufferAheadSeconds", ahead);
            }
        } catch (_) {
            /* Keep only fields already observed. */
        }
        var observation: any = {
            generation: generation,
            handleId: handleId,
            lane: lane,
            metrics: metrics,
        };
        if (version >= 2) observation.engine = engine;
        if (version === 3) {
            observation.attempt = attempt;
            observation.lastAttempt = lastAttempt;
        }
        result.push(observation);
    });
    return result;
}

(window as any).__ottRuntimeDebugDetails = {
    media: projectMedia,
    native: projectNativeDebug,
};
