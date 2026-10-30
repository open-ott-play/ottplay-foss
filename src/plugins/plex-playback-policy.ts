/** Playback selection only. Transport, decoder probes and effects belong to the host. */
interface PlexPlaybackPlan {
    direct: boolean;
    media: any;
    mediaIndex: number;
    mime: string;
    path: string;
    videoCodec: string;
}

interface PlexPlaybackPolicyPorts {
    canPlayType(mime: string): string;
    path(value: any): string;
}

function plexPlaybackRows(value: any): any[] {
    return Array.isArray(value)
        ? value
        : value && typeof value === "object"
          ? [value]
          : [];
}

function plexPlaybackHighDepth(media: any, avc: boolean): boolean {
    var high10 = /^\s*high[ _-]*10(?:[ _-]|$)/i;
    var part = plexPlaybackRows(media.Part)[0];
    return (
        (avc && high10.test(String(media.videoProfile || ""))) ||
        plexPlaybackRows(part && part.Stream).some(function (stream) {
            return (
                stream &&
                Number(stream.streamType) === 1 &&
                (Number(stream.bitDepth) > 8 ||
                    (avc && high10.test(String(stream.profile || ""))))
            );
        })
    );
}

function plexPlaybackCodec(media: any, video: boolean): string {
    var name = String(
        video ? media.videoCodec : media.audioCodec
    ).toLowerCase();
    if (video) {
        // A generic AVC probe describes 8-bit Baseline, not High 10.
        if (name === "h264")
            return plexPlaybackHighDepth(media, true) ? "" : "avc1.42E01E";
        if (name === "hevc" || name === "h265") {
            var ten = plexPlaybackHighDepth(media, false);
            return ten ? "hvc1.2.4.L153.B0" : "hvc1.1.6.L123.B0";
        }
        return name === "vp9"
            ? "vp09.00.10.08"
            : name === "vp8"
              ? "vp8"
              : name === "av1"
                ? "av01.0.08M.08"
                : "";
    }
    return name === "aac"
        ? "mp4a.40.2"
        : name === "mp3"
          ? "mp3"
          : name === "opus" || name === "vorbis" || name === "flac"
            ? name
            : "";
}

function plexPlaybackMime(media: any): string {
    var format = String(media.container || "").toLowerCase();
    if (/^(mp4|m4v|mov)$/.test(format)) return "video/mp4";
    if (format === "webm") return "video/webm";
    if (format === "mkv") return "video/x-matroska";
    if (format === "mp3") return "audio/mpeg";
    if (format === "flac") return "audio/flac";
    if (format === "m4a" || format === "aac") return "audio/mp4";
    if (format === "ogg" || format === "opus") return "audio/ogg";
    return "application/octet-stream";
}

function plexPlaybackSupported(
    media: any,
    ports: PlexPlaybackPolicyPorts
): boolean {
    var mime = plexPlaybackMime(media);
    if (mime === "application/octet-stream" || mime === "video/x-matroska")
        return false;
    var video = plexPlaybackCodec(media, true),
        audio = plexPlaybackCodec(media, false);
    if (
        (!video && media.videoCodec) ||
        (!audio && media.audioCodec) ||
        (!video && !audio)
    )
        return false;
    try {
        return !!ports.canPlayType(
            mime + '; codecs="' + [video, audio].filter(Boolean).join(",") + '"'
        );
    } catch (_) {
        return false;
    }
}

function planPlexPlayback(
    values: any,
    mode: "auto" | "original" | "compatible",
    ports: PlexPlaybackPolicyPorts
): PlexPlaybackPlan | null {
    var media = plexPlaybackRows(values),
        fallback: PlexPlaybackPlan | null = null;
    // Media entries are alternate versions; Part entries are consecutive pieces.
    // Never skip to a later Part or optimize across a multipart presentation.
    for (var index = 0; index < Math.min(media.length, 32); index++) {
        var candidate = media[index];
        if (!candidate || typeof candidate !== "object") continue;
        var parts = plexPlaybackRows(candidate.Part),
            part = parts[0];
        var path = part && ports.path(part.key);
        if (!path) continue;
        if (fallback && (parts.length !== 1 || !candidate.videoCodec)) continue;
        var direct =
            mode === "original" ||
            !candidate.videoCodec ||
            (mode === "auto" && plexPlaybackSupported(candidate, ports));
        var plan: PlexPlaybackPlan = {
            direct: direct,
            media: candidate,
            mediaIndex: index,
            mime: plexPlaybackMime(candidate),
            path: path,
            videoCodec: plexPlaybackCodec(candidate, true),
        };
        if (!fallback) fallback = plan;
        if (direct || mode !== "auto" || parts.length !== 1) return plan;
    }
    return fallback;
}

(window as any).__ottPlexPlaybackPolicy = { plan: planPlexPlayback };
