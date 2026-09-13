/**
 * Watch a native HLS attempt without changing working video playback.
 * WKWebView can accept HEVC in MPEG-TS as audio-only without raising an error.
 * A single prefetched HLS fragment distinguishes that case from actual radio.
 */
export function watchAutoNativePlayback(
    media: HTMLVideoElement,
    url: string,
    HlsRef: any,
    options: {
        active: () => boolean;
        fallback: () => void;
        restore: () => void;
    }
): (restoreNative?: boolean) => void {
    var disposed = false;
    var decided = false;
    var probing = false;
    var probe: any = null;
    var checkTimer: ReturnType<typeof setTimeout> | null = null;
    var probeTimer: ReturnType<typeof setTimeout> | null = null;
    var actionTimer: ReturnType<typeof setTimeout> | null = null;
    var events = [
        "playing",
        "timeupdate",
        "loadedmetadata",
        "loadeddata",
        "resize",
    ];

    function removeListeners(): void {
        for (var i = 0; i < events.length; i++)
            media.removeEventListener(events[i], inspect);
        media.removeEventListener("error", onNativeError);
    }

    function clearWaits(): void {
        if (checkTimer !== null) clearTimeout(checkTimer);
        if (probeTimer !== null) clearTimeout(probeTimer);
        checkTimer = null;
        probeTimer = null;
    }

    function cancel(restoreNative?: boolean): void {
        if (disposed) return;
        // Changing engine preference can cancel a probe without replacing the
        // current stream. Renew that native session even when a probe result
        // was already queued; stop/channel-switch cancellation never renews it.
        var renewNative = restoreNative === true && probing && options.active();
        disposed = true;
        removeListeners();
        clearWaits();
        if (actionTimer !== null) clearTimeout(actionTimer);
        actionTimer = null;
        var previous = probe;
        probe = null;
        if (previous) {
            try {
                previous.destroy();
            } catch (_destroyError) {}
        }
        if (renewNative) options.restore();
    }

    function current(): boolean {
        if (disposed) return false;
        if (options.active()) return true;
        // A stale HLS event can arrive before its caller disposes the watcher.
        // Its controller must finish emitting before we destroy that probe.
        if (actionTimer === null) {
            actionTimer = setTimeout(function () {
                actionTimer = null;
                cancel();
            }, 0);
        }
        return false;
    }

    function finish(useFallback: boolean): void {
        if (!current() || decided) return;
        decided = true;
        removeListeners();
        clearWaits();
        // The transmuxer still uses its controllers after emitting track data.
        // Destroying it or replacing playback inside that event is reentrant.
        actionTimer = setTimeout(function () {
            actionTimer = null;
            var stillCurrent = !disposed && options.active();
            // Native video may finish loading during the probe or just after
            // its track event. Keep that now-working engine; renewing src is
            // still necessary for proxies that replaced their session.
            if (
                useFallback &&
                probing &&
                !media.error &&
                ((media as any).videoTracks
                    ? (media as any).videoTracks.length > 0
                    : media.videoWidth > 0)
            )
                useFallback = false;
            cancel();
            if (!stillCurrent) return;
            if (useFallback) options.fallback();
            else options.restore();
        }, 0);
    }

    function audioWithoutVideo(): boolean {
        var tracks = media as any;
        // WKWebView may report nonzero dimensions while it has decoded only
        // audio. An available videoTracks list is stronger
        // evidence than those dimensions; no track API means no speculation.
        return (
            !media.paused &&
            media.readyState >= 2 &&
            !!tracks.audioTracks &&
            tracks.audioTracks.length > 0 &&
            !!tracks.videoTracks &&
            tracks.videoTracks.length === 0
        );
    }

    function startProbe(): void {
        if (!current() || decided || probing || !audioWithoutVideo()) return;
        if (!HlsRef || !HlsRef.isSupported || !HlsRef.isSupported()) return;
        probing = true;
        // Local HLS proxies may replace their playback session on every master
        // request. Always renew native src on an unknown result, radio, error or
        // timeout; leaving its old src would break radio. Keep native playing
        // while probing so play/pause controls still represent the user's intent.
        try {
            probe = new HlsRef({
                backBufferLength: 0,
                enableWorker: true,
                lowLatencyMode: false,
                maxBufferLength: 1,
                maxMaxBufferLength: 1,
                startFragPrefetch: true,
                startLevel: 0,
                testBandwidth: false,
            });
            probe.on(
                HlsRef.Events.FRAG_PARSING_INIT_SEGMENT,
                function (_event: any, data: any): void {
                    if (!current() || decided || !data || data.id !== "main")
                        return;
                    var tracks = data.tracks || {};
                    var track = tracks.video || tracks.audiovideo;
                    var metadata = track && track.metadata;
                    var hasVideo = !!(
                        track &&
                        (/(?:hvc1|hev1)(?:\.|$)/i.test(track.codec || "") ||
                            (metadata &&
                                metadata.width > 0 &&
                                metadata.height > 0))
                    );
                    // Real audio-only channels keep the native engine. A
                    // missing/unknown video track is not evidence of HEVC.
                    finish(hasVideo);
                }
            );
            probe.on(HlsRef.Events.ERROR, function (): void {
                finish(false);
            });
            probeTimer = setTimeout(function () {
                probeTimer = null;
                finish(false);
            }, 8000);
            // startFragPrefetch transmuxes the first fragment without attaching
            // any media element or opening another audible/visible decoder.
            probe.loadSource(url);
        } catch (_probeError) {
            finish(false);
        }
    }

    function inspect(): void {
        if (!current() || decided || probing) return;
        if (!audioWithoutVideo()) {
            if (checkTimer !== null) clearTimeout(checkTimer);
            checkTimer = null;
            return;
        }
        if (checkTimer !== null) return;
        checkTimer = setTimeout(function () {
            checkTimer = null;
            startProbe();
        }, 1500);
    }

    function onNativeError(): void {
        if (!current() || decided || probing) return;
        var error = media.error;
        // Network errors and stalled playback do not prove codec mismatch.
        if (error && (error.code === 3 || error.code === 4)) finish(true);
    }

    for (var i = 0; i < events.length; i++)
        media.addEventListener(events[i], inspect);
    media.addEventListener("error", onNativeError);
    // PiP can load the HLS library after native playback has already emitted
    // metadata or failed. Inspect that state as well as subsequent events.
    onNativeError();
    inspect();
    return cancel;
}
