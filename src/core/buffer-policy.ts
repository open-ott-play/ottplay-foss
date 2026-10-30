/** Bounded MSE buffers shared by browser, server and native WebView shells. */
export interface BufferPolicyInput {
    android?: boolean;
    deviceMemory?: number;
    live?: boolean;
    lowMemoryDevice?: boolean;
    originalUrl?: string;
    pip?: boolean;
    seconds?: any;
    url?: string;
}

/** Only actual AceStream protocol/engine endpoints identify this transport. */
export function isAceStreamSource(value: string = ""): boolean {
    return (
        /^(?:acestream|ace):\/\//i.test(value) ||
        /^https?:\/\/[^/?#]+\/ace\/(?:getstream|manifest(?:\.m3u8)?)(?:[/?#]|$)/i.test(
            value
        )
    );
}

export function createBufferPolicy(input: BufferPolicyInput): any {
    var memory = Number(input.deviceMemory);
    var lowMemory =
        input.lowMemoryDevice === true ||
        (isFinite(memory) && memory > 0 && memory <= 2);
    var mobile = !!input.android;
    var ace =
        isAceStreamSource(input.originalUrl) || isAceStreamSource(input.url);
    var live = input.live !== false;
    var seconds = Number(input.seconds);
    // 0 is the existing automatic setting. Positive values are seconds, not MB.
    var explicit = isFinite(seconds) && seconds > 0 && seconds <= 120;
    var forward = ace
        ? lowMemory
            ? 45
            : 60
        : live
          ? lowMemory
              ? 20
              : 30
          : lowMemory
            ? 30
            : 60;
    if (explicit) forward = seconds;
    var behind = lowMemory ? 15 : mobile ? 30 : 60;
    if (input.pip) behind = 0;
    var bytes = lowMemory ? 32000000 : mobile ? 64000000 : 120000000;
    if (input.pip) bytes = Math.floor(bytes / 2);
    // AceStream gets more jitter tolerance, without the previous 600-second ceiling.
    var ceiling = Math.max(forward, ace ? 120 : live ? 60 : 120);
    return {
        explicit: explicit,
        hls: {
            backBufferLength: behind,
            maxBufferLength: forward,
            maxBufferSize: bytes,
            maxMaxBufferLength: ceiling,
        },
        profile:
            (lowMemory ? "low-memory" : mobile ? "android" : "standard") +
            "/" +
            (ace ? "acestream" : live ? "live" : "vod"),
        shaka: {
            bufferBehind: behind,
            bufferingGoal: forward,
            rebufferingGoal: Math.min(forward, ace ? 5 : 2),
        },
    };
}

/** Browser hints are optional; absence never classifies a device as low memory. */
export function coreBufferPolicy(
    w: any,
    url: string,
    originalUrl: string,
    seconds: any,
    live = true,
    pip = false
): any {
    var navigator = w.navigator || {};
    var android =
        w.ott_device === "android" ||
        /\bAndroid\b/i.test(navigator.userAgent || "");
    return createBufferPolicy({
        android: android,
        deviceMemory: navigator.deviceMemory,
        live: live,
        lowMemoryDevice: android && w.__ottNativeLowMemoryDevice === true,
        originalUrl: originalUrl,
        pip: pip,
        seconds: seconds,
        url: url,
    });
}

/** Fixed constructor-time numbers only; no HLS instance or live config is retained. */
export function snapshotInitialHlsBufferPolicy(hls: any): any {
    var config: any;
    try {
        config = hls && hls.config;
    } catch (_) {
        return null;
    }
    if (!config) return null;
    var snapshot: any = {};
    [
        ["max_buffer_length_seconds", "maxBufferLength"],
        ["max_max_buffer_length_seconds", "maxMaxBufferLength"],
        ["max_buffer_size_bytes", "maxBufferSize"],
        ["back_buffer_length_seconds", "backBufferLength"],
    ].forEach(function (pair) {
        var value: any;
        try {
            value = config[pair[1]];
        } catch (_) {}
        snapshot[pair[0]] =
            typeof value === "number" &&
            isFinite(value) &&
            value >= 0 &&
            value <= 9007199254740991 &&
            (pair[0] !== "max_buffer_size_bytes" || value % 1 === 0)
                ? value
                : null;
    });
    return snapshot;
}
