/** Display metadata only: never serialize provider requests or playback payloads. */
var classificationControls = /[^\x20-\x7e]/g;
try {
    // Construct dynamically: older ES5 engines reject the feature, not the file.
    classificationControls = new RegExp("\\p{C}", "gu");
} catch (_) {}
function displayText(value: any, limit: number): string | null {
    if (typeof value !== "string") return null;
    var text = value.trim();
    // Classify after removing invisible/private characters, but retain the
    // original accepted label. Older engines use a conservative ASCII skeleton.
    var classification = text.replace(classificationControls, "").trim();
    var privateText =
        /:\/\/|^(?:[\\/]|~[\\/]|[a-z]:[\\/]|(?:data|blob|file):)|\b(?:authorization\s*:|bearer\s+|(?:password|token|secret|api[_ -]?key)\s*[:=])/i;
    if (
        !text ||
        /[\x00-\x1f\x7f-\x9f]/.test(value) ||
        privateText.test(text) ||
        privateText.test(classification)
    )
        return null;
    try {
        return encodeURIComponent(text).replace(/%[0-9a-f]{2}/gi, "x").length <=
            limit
            ? text
            : null;
    } catch (_) {
        return null;
    }
}
function boundedNumber(value: any, maximum = 9007199254740991): number | null {
    return typeof value === "number" &&
        isFinite(value) &&
        value >= 0 &&
        value <= maximum
        ? value
        : null;
}
function mediaId(value: any): string | null {
    return typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
        ? value
        : null;
}
function playbackTitle(value: any, provider: string | null): string | null {
    var title = displayText(value, 256);
    return provider === "offline" && title
        ? title.split(/[\\/]/).pop() || null
        : title;
}
function playbackMetadata(w: any, snapshot: any): any {
    var target = snapshot.target;
    if (!target) return null;
    var source = typeof target.sourceId === "string" ? target.sourceId : "";
    var provider = /^([a-z0-9_-]+)(?:[:@]|$)/i.exec(source);
    var name = provider ? displayText(provider[1], 64) : null;
    var current = w.__ottMedia?.current?.();
    if (
        target.kind === "vod" &&
        current?.ref?.sourceId === source &&
        current.ref.itemId === target.channelId
    )
        return {
            channel_number: null,
            media_id: mediaId(target.channelId),
            owner: current,
            provider: name,
            title: playbackTitle(current.payload?.title, name),
        };
    var history = snapshot.historyTarget;
    var channelTarget = target.kind === "vod" ? history : target;
    if (
        !channelTarget ||
        !/^(live|archive)$/.test(channelTarget.kind) ||
        channelTarget.sourceId !== source ||
        source !== w.__ottSourceIdentity?.current?.(w)
    )
        return null;
    var id = channelTarget.channelId;
    var channel = w.channels && w.channels[id];
    if (!channel) return null;
    var number = Array.isArray(w.cList)
        ? w.cList.indexOf(isNaN(Number(id)) ? id : Number(id))
        : -1;
    if (number < 0 && Array.isArray(w.cList)) number = w.cList.indexOf(id);
    var title = playbackTitle(channel.channel_name, name);
    return {
        channel_number: number >= 0 && number < 2147483647 ? number + 1 : null,
        media_id: mediaId(String(id)),
        owner: channel,
        provider: name,
        title: title,
    };
}
/** Shared by status and pushed presence. No transport sampling, resolution or storage writes. */
export function readPlayerState(w: any, info: any): any {
    var snapshot: any = null,
        metadata: any = null,
        handle: any = null,
        backendPhase: string | null = null;
    try {
        snapshot = w.__ottClassicPlayback?.snapshot?.();
        if (
            snapshot?.target &&
            boundedNumber(snapshot.generation) !== null &&
            Math.floor(snapshot.generation) === snapshot.generation
        ) {
            var context = w.__ottClassicPlayback.context?.();
            var owned = !context || context.isCurrentBackend?.() === true;
            if (typeof w.__ottCoreBackendPeek === "function") {
                handle = w.__ottCoreBackendPeek()?.current("main");
                owned = owned && !!handle && handle.active() === true;
                backendPhase = handle?.snapshot?.().phase || null;
            }
            if (owned) {
                metadata = playbackMetadata(w, snapshot);
                var after = w.__ottClassicPlayback.snapshot();
                if (
                    after.generation !== snapshot.generation ||
                    after.target?.sourceId !== snapshot.target.sourceId ||
                    after.target?.channelId !== snapshot.target.channelId ||
                    (context && context.isCurrentBackend() !== true) ||
                    (handle &&
                        (w.__ottCoreBackendPeek()?.current("main") !== handle ||
                            !handle.active()))
                )
                    metadata = null;
            }
        }
    } catch (_) {}
    var target = snapshot && snapshot.target;
    var standby = info.standby === true;
    var phase = standby ? "standby" : snapshot?.phase;
    if (!standby && phase === "standby") phase = "unknown";
    if (phase === "stopped") phase = "idle";
    if (
        !/^(idle|loading|playing|paused|buffering|ended|error|standby)$/.test(
            phase || ""
        )
    )
        phase = "unknown";
    var inactive = /^(idle|ended|standby)$/.test(phase);
    var proof = w.__ottPlaybackPresenceProof;
    if (
        inactive ||
        !target ||
        !metadata ||
        !proof ||
        proof.generation !== snapshot.generation ||
        proof.source !== target.sourceId ||
        proof.id !== target.channelId ||
        proof.owner !== metadata.owner ||
        proof.backend !== handle
    )
        proof = null;
    // A new loading target is intent. Pause and buffering retain only the same confirmed owner.
    if (
        !inactive &&
        phase === "playing" &&
        target &&
        metadata &&
        (!backendPhase || backendPhase === "playing")
    )
        proof = {
            backend: handle,
            generation: snapshot.generation,
            id: target.channelId,
            owner: metadata.owner,
            source: target.sourceId,
        };
    w.__ottPlaybackPresenceProof = proof;
    if (phase === "loading" && proof) phase = "buffering";
    var active = !inactive && !!proof;
    var kind = inactive
        ? "none"
        : target && /^(live|archive|vod)$/.test(target.kind)
          ? target.kind
          : "unknown";
    var volume: any = null;
    try {
        volume = boundedNumber(w.stbGetVolume?.(), 100);
    } catch (_) {}
    return {
        playback: {
            channel_number: active ? metadata.channel_number : null,
            duration: active ? boundedNumber(snapshot.duration) : null,
            kind: kind,
            media_id: active ? metadata.media_id : null,
            position: active ? boundedNumber(snapshot.position) : null,
            provider: active ? metadata.provider : null,
            state: phase,
            title: active ? metadata.title : null,
            volume: volume,
        },
        player: {
            platform: displayText(info.platform, 32) || "unknown",
            standby: standby,
            version: displayText(info.version, 64) || "unknown",
        },
        runtime: info.runtime,
    };
}
