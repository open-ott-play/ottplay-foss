// Serialized into the browser by Playwright. Read the actual candidate's Hls
// default, then follow the pinned instance backend order (not Hls.isSupported,
// whose standalone helper prefers ManagedMediaSource by default).
async function readBrowserMediaCapabilities() {
    // UI boot intentionally omits MSE engines. Only this explicit codec
    // diagnostic requests the same bundled runtime playback would use.
    if (!window.Hls) {
        await new Promise((resolve, reject) => {
            if (typeof window.__ottLoadMediaEngine !== "function") {
                reject(new Error("Bundled HLS loader is unavailable"));
                return;
            }
            let settled = false;
            const timer = setTimeout(() => finish(false), 17000);
            function finish(ready) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (ready && window.Hls) resolve();
                else
                    reject(
                        new Error(
                            "Bundled HLS failed to load for codec diagnostics"
                        )
                    );
            }
            try {
                window.__ottLoadMediaEngine("hls", finish);
            } catch (_) {
                finish(false);
            }
        });
    }
    if (window.Hls?.DefaultConfig.preferManagedMediaSource !== false) {
        throw new Error(
            "HLS backend preference changed; review the capability probe"
        );
    }
    const mse =
        window.MediaSource ||
        window.ManagedMediaSource ||
        window.WebKitMediaSource;
    return {
        aacMse: !!mse?.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'),
        h264Mse: !!mse?.isTypeSupported('video/mp4; codecs="avc1.42c01e"'),
        hlsVersion: window.Hls.version,
        managedMediaSource: typeof window.ManagedMediaSource === "function",
        mediaSource: typeof window.MediaSource === "function",
        mseBackend: !mse
            ? "none"
            : mse === window.MediaSource
              ? "MediaSource"
              : mse === window.ManagedMediaSource
                ? "ManagedMediaSource"
                : "WebKitMediaSource",
        nativeHls: document
            .createElement("video")
            .canPlayType("application/vnd.apple.mpegurl"),
        webkitMediaSource: typeof window.WebKitMediaSource === "function",
    };
}
module.exports = { readBrowserMediaCapabilities };
