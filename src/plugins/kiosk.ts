import { caselessKey } from "../utils/caseless";
import { createKioskVideoProgress } from "./kiosk-video-progress";
import { createStrictKioskInput } from "./strict-kiosk-input";

/** Device-local policy. Only the authenticated command-server dispatcher mutates it. */
export function createKiosk(w: any): any {
    var key = "__ottKioskV1";
    var policy: any = null;
    var timer: any = null;
    var lastProgress = 0;
    var lastPosition: number | null = null;
    var retries = 0;
    var recoveryAttempts = 0;
    var health = "idle";
    var lastSaved = 0;
    var lastMediaId = "";
    var mediaStarting = false;
    var frameRecovery = false;
    var frameHealthySince: number | null = null;
    var videoProgress = createKioskVideoProgress(w);
    var strictInput = createStrictKioskInput(w, strict);
    function now(): number {
        return w.performance && typeof w.performance.now === "function"
            ? w.performance.now()
            : Date.now();
    }
    function source(): string {
        return w.__ottSourceIdentity.current(w);
    }
    function provider(): string {
        return String((w.__ottActiveProviderDriver || {}).id || w.p_pref || "");
    }
    function enabled(): boolean {
        return !!policy;
    }
    function locked(): boolean {
        return !!(policy && (policy.channel || policy.media));
    }
    function strict(): boolean {
        return locked() && policy.strict === true;
    }
    function reset(): void {
        videoProgress.reset();
        frameRecovery = false;
        frameHealthySince = null;
        recoveryAttempts = 0;
        lastPosition = null;
        lastProgress = now();
        lastSaved = lastProgress;
        lastMediaId = "";
        mediaStarting = !!(policy && policy.media);
        health = locked() ? "starting" : policy ? "waiting" : "idle";
        strictInput.sync();
    }
    function save(next: any): boolean {
        try {
            var value = JSON.stringify(next);
            w.stbSetItem(key, value);
            if (w.stbGetItem(key) !== value) return false;
        } catch (_) {
            return false;
        }
        policy = next;
        reset();
        if (typeof w.setSleepTimeout === "function") w.setSleepTimeout();
        return true;
    }
    function snapshot(): any {
        return {
            channel:
                policy && policy.channel
                    ? { id: policy.channel.id, name: policy.channel.name }
                    : null,
            ...(policy && policy.media
                ? {
                      media: {
                          index: policy.media.index,
                          title: policy.media.records[policy.media.index].title,
                          total: policy.media.records.length,
                      },
                      startup_grace_seconds: 60,
                  }
                : {}),
            enabled: enabled(),
            health: health,
            provider: policy ? policy.provider : null,
            retries: retries,
            retry_seconds: 10,
            state: locked() ? "locked" : policy ? "waiting" : "off",
            strict: !!(policy && policy.strict),
            video_progress: videoProgress.snapshot(),
        };
    }
    function allowed(id: any): boolean {
        return (
            !locked() ||
            (!!policy.channel &&
                source() === policy.source &&
                String(id) === policy.channel.id)
        );
    }
    function validMedia(value: any): boolean {
        try {
            return (
                !!value &&
                typeof value.source === "string" &&
                (value.queueId === undefined ||
                    (typeof value.queueId === "string" &&
                        value.queueId.length <= 100)) &&
                Array.isArray(value.records) &&
                value.records.length > 0 &&
                value.records.length <= 1000 &&
                typeof value.index === "number" &&
                Math.floor(value.index) === value.index &&
                value.index >= 0 &&
                value.index < value.records.length &&
                typeof value.position === "number" &&
                isFinite(value.position) &&
                value.position >= 0 &&
                JSON.stringify(value).length <= 500000 &&
                value.records.every(function (row: any) {
                    return (
                        row &&
                        typeof row.title === "string" &&
                        row.request &&
                        typeof row.request === "object" &&
                        !Array.isArray(row.request) &&
                        row.__ottMediaRef &&
                        row.__ottMediaRef.sourceId === value.source &&
                        typeof row.__ottMediaRef.itemId === "string" &&
                        !!row.__ottMediaRef.itemId &&
                        !row.stream_url
                    );
                })
            );
        } catch (_) {
            return false;
        }
    }
    function allowedMedia(ref: any): boolean {
        return (
            !locked() ||
            !!(
                policy.media &&
                ref &&
                w.__ottMedia &&
                w.__ottMedia.sourceId() === policy.source &&
                ref.sourceId === policy.source &&
                policy.media.records.some(function (row: any) {
                    return row.__ottMediaRef.itemId === ref.itemId;
                })
            )
        );
    }
    function admit(id: any): boolean {
        if (!allowed(id)) return false;
        if (policy && !policy.channel && !policy.media) {
            // Arming does not capture the already playing channel or a boot callback.
            if (w.commandChannelsReady !== true || source() !== policy.source)
                return false;
            if (
                !save({
                    channel: {
                        id: String(id),
                        name: String(w.channels[id].channel_name || ""),
                    },
                    provider: policy.provider,
                    source: policy.source,
                    strict: policy.strict === true,
                })
            )
                return false;
            closeControls();
        }
        return true;
    }
    function locate(id: string): number[] | null {
        var categories = w.catsArray || [];
        for (var c = 0; c < categories.length; c++) {
            var list = (w.cats || {})[categories[c]] || [];
            for (var i = 0; i < list.length; i++)
                if (String(list[i]) === id) return [c, i];
        }
        return null;
    }
    function closeControls(): void {
        if (typeof w.closeList === "function") w.closeList();
        if (typeof w.stbStopPip === "function") w.stbStopPip();
        w.pipIndex = null;
        if (w.__ottMedia && w.__ottMedia.cancelRequest)
            w.__ottMedia.cancelRequest();
    }
    function play(): void {
        if (!locked() || w.commandChannelsReady !== true) return;
        videoProgress.reset();
        frameHealthySince = null;
        if (policy.media) {
            var selected = policy;
            if (!w.__ottMedia || w.__ottMedia.sourceId() !== selected.source) {
                health = "source-unavailable";
                return;
            }
            mediaStarting = true;
            lastProgress = now();
            if (
                !w.__ottMedia.restoreKiosk(selected.media, function () {
                    return (
                        policy === selected &&
                        w.__ottMedia.sourceId() === selected.source
                    );
                })
            )
                health = "error";
            return;
        }
        if (source() !== policy.source) {
            health = "source-unavailable";
            return;
        }
        var indices = locate(policy.channel.id);
        if (!indices || !(w.channels || {})[policy.channel.id]) {
            health = "channel-unavailable";
            return;
        }
        // Resolve the channel again, including expiring provider URLs. Never reuse
        // an old stream URL, list position, or a different provider's identical ID.
        w.playChannel(indices[0], indices[1]);
    }
    function restartPlayer(): boolean {
        try {
            if (
                typeof w.restart !== "function" ||
                typeof w.stbGetPersistedItem !== "function" ||
                provider() !== policy.provider ||
                (policy.media
                    ? !w.__ottMedia || w.__ottMedia.sourceId() !== policy.source
                    : source() !== policy.source)
            )
                return false;
            // Reserve a durable cooldown before reloading so a broken source cannot
            // create a boot loop. Keep soft stream recovery available throughout.
            var reloadKey = "__ottKioskReloadV1";
            var time = Date.now();
            var previous = Number(w.stbGetPersistedItem(reloadKey) || 0);
            if (previous > 0 && time - previous < 600000) return false;
            var stored = JSON.stringify(policy);
            w.stbSetItem(key, stored);
            if (w.stbGetPersistedItem(key) !== stored) return false;
            w.stbSetItem(reloadKey, String(time));
            if (w.stbGetPersistedItem(reloadKey) !== String(time)) return false;
            w.restart();
            recoveryAttempts = 0;
            return true;
        } catch (_) {
            return false;
        }
    }
    function tick(): void {
        if (!locked()) return;
        var time = now();
        if (time < lastProgress) lastProgress = time;
        var mediaAdmitted = false;
        if (policy.media) {
            try {
                // Health polling reads the current identity/position, never copies the queue.
                var selection = w.__ottMedia && w.__ottMedia.current();
                var state =
                    w.__ottClassicPlayback && w.__ottClassicPlayback.snapshot();
                if (
                    selection &&
                    state &&
                    state.target &&
                    state.target.kind === "vod" &&
                    selection.ref.sourceId === policy.source &&
                    state.target.sourceId === policy.source &&
                    state.target.channelId === selection.ref.itemId
                ) {
                    var selectedRef = selection.ref;
                    mediaAdmitted = allowedMedia(selectedRef);
                    if (mediaAdmitted) {
                        // Natural EOF may resolve the next episode asynchronously on slow devices.
                        if (selection.ended && !mediaStarting) {
                            mediaStarting = true;
                            lastProgress = time;
                            lastPosition = null;
                        }
                        if (lastMediaId !== selectedRef.itemId) {
                            frameRecovery = false;
                            frameHealthySince = null;
                            lastMediaId = selectedRef.itemId;
                            lastPosition = null;
                            lastProgress = time;
                            mediaStarting = true;
                        }
                        var sequence = selection.sequence;
                        var cursor = sequence && sequence.index;
                        var exactCursor =
                            sequence &&
                            sequence.queueId === policy.media.queueId &&
                            typeof cursor === "number" &&
                            Math.floor(cursor) === cursor &&
                            cursor >= 0 &&
                            cursor < policy.media.records.length &&
                            policy.media.records[cursor].__ottMediaRef
                                .itemId === selectedRef.itemId;
                        for (var i = 0; i < policy.media.records.length; i++) {
                            if (
                                policy.media.records[i].__ottMediaRef.itemId ===
                                    selectedRef.itemId &&
                                (!exactCursor || i === cursor)
                            ) {
                                policy.media.index = i;
                                policy.media.position =
                                    !selection.ended &&
                                    typeof state.position === "number" &&
                                    isFinite(state.position) &&
                                    state.position >= 0
                                        ? state.position
                                        : 0;
                                break;
                            }
                        }
                        if (time - lastSaved >= 5000) {
                            try {
                                var stored = JSON.stringify(policy);
                                w.stbSetItem(key, stored);
                                if (w.stbGetItem(key) === stored)
                                    lastSaved = time;
                            } catch (_) {
                                // Keep the live cursor for recovery. A failed checkpoint
                                // does not describe decoder health; retry in five seconds.
                                lastSaved = time;
                            }
                        }
                    }
                }
            } catch (_) {
                health = "error";
            }
        }
        try {
            var frames = videoProgress.sample(
                time,
                w.__ottClassicPlayback && w.__ottClassicPlayback.snapshot()
            );
            if (frames.state === "stalled") frameRecovery = true;
            if (frameRecovery) {
                if (
                    frames.state === "progressing" &&
                    frames.frame_age_ms <= 2000
                ) {
                    if (frameHealthySince === null) frameHealthySince = time;
                    if (time - frameHealthySince >= 10000) {
                        frameRecovery = false;
                        frameHealthySince = null;
                    }
                } else frameHealthySince = null;
            }
            var id = (w.curList || [])[w.primaryIndex];
            var position = w.stbGetPosTime();
            var valid =
                typeof position === "number" &&
                isFinite(position) &&
                position >= 0;
            if (
                (policy.media ? mediaAdmitted : allowed(id)) &&
                w.stbIsPlaying() &&
                frames.state !== "stalled" &&
                !(frameRecovery && frames.state === "warming") &&
                valid &&
                lastPosition !== null &&
                position > lastPosition
            ) {
                lastProgress = time;
                health = "playing";
                mediaStarting = false;
                if (!frameRecovery && frames.state !== "warming")
                    recoveryAttempts = 0;
            }
            lastPosition = valid ? position : null;
        } catch (_) {
            lastPosition = null;
            health = "error";
        }
        if (
            time - lastProgress <
            (mediaStarting ||
            (frameRecovery && frames && frames.state === "warming")
                ? 60000
                : 10000)
        )
            return;
        lastProgress = time;
        lastPosition = null;
        health = "retrying";
        if (w.navigator && w.navigator.onLine === false) return;
        if (recoveryAttempts >= 3 && restartPlayer()) return;
        retries++;
        recoveryAttempts++;
        try {
            play();
        } catch (_) {
            health = "error";
        }
    }
    function validQuery(query: string): boolean {
        try {
            return (
                !/[\x00-\x1f\x7f]/.test(query) &&
                encodeURIComponent(query).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= 1024
            );
        } catch (_) {
            return false;
        }
    }
    function request(params: any, done: (result: any) => void): void {
        function fail(message: string): void {
            done({ data: { error: message }, status: "rejected" });
        }
        var mode = params && params.mode;
        if (
            !params ||
            typeof params !== "object" ||
            Array.isArray(params) ||
            Object.keys(params).some(function (name) {
                return name !== "mode" && name !== "query" && name !== "strict";
            }) ||
            (params.strict !== undefined &&
                typeof params.strict !== "boolean") ||
            ((mode === "off" || mode === "status") &&
                params.strict !== undefined) ||
            ["status", "on", "off", "set"].indexOf(mode) < 0 ||
            (params.query !== undefined &&
                (typeof params.query !== "string" ||
                    !params.query.trim() ||
                    !validQuery(params.query))) ||
            ((mode === "off" || mode === "status") &&
                params.query !== undefined) ||
            (mode === "set" && params.query === undefined)
        ) {
            fail("Use kiosk status, on [CHANNEL], set CHANNEL or off.");
            return;
        }
        if (mode === "status") {
            done({ data: snapshot(), status: "ok" });
            return;
        }
        if (mode === "off") {
            if (!save(null)) {
                fail("Could not save kiosk policy.");
                return;
            }
        } else {
            if (mode === "set" && !enabled()) {
                fail("Enable kiosk mode first.");
                return;
            }
            if (mode === "on" && enabled() && params.query === undefined) {
                if (
                    params.strict !== undefined &&
                    params.strict !== !!policy.strict
                ) {
                    if (!save({ ...policy, strict: params.strict })) {
                        fail("Could not save kiosk policy.");
                        return;
                    }
                    if (locked()) closeControls();
                }
                done({ data: snapshot(), status: "ok" });
                return;
            }
            if (provider() === "vportal" || provider() === "plex") {
                if (params.query !== undefined) {
                    fail(
                        "Start the required media playback, then use kiosk on without a channel query."
                    );
                    return;
                }
                if (
                    w.__ottParental &&
                    (w.__ottParental.needs("providers") ||
                        w.__ottParental.needs("settings"))
                ) {
                    fail("Unlock player settings before enabling kiosk mode.");
                    return;
                }
                var selection = w.__ottMedia && w.__ottMedia.kioskSelection();
                if (
                    w.commandChannelsReady !== true ||
                    !validMedia(selection) ||
                    selection.source !== w.__ottMedia.sourceId()
                ) {
                    fail("Start media playback before enabling kiosk mode.");
                    return;
                }
                if (
                    w.sPSchannels &&
                    w.parentPIN !== "*" &&
                    !w.parentAccess &&
                    selection.records.some(function (row: any) {
                        return Number(row.adult) === 1;
                    })
                ) {
                    fail(
                        "Unlock parental access before locking this media queue."
                    );
                    return;
                }
                if (
                    !save({
                        channel: null,
                        media: selection,
                        provider: provider(),
                        source: selection.source,
                        strict:
                            params.strict !== undefined
                                ? params.strict
                                : !!(policy && policy.strict),
                    })
                ) {
                    fail("Could not save kiosk policy.");
                    return;
                }
                retries = 0;
                w.__ottMedia.keepKioskLoop();
                closeControls();
                done({ data: snapshot(), status: "ok" });
                return;
            }
            if (
                w.commandChannelsReady !== true ||
                !(w.cList || w.curList || []).length ||
                !w.__ottSourceIdentity ||
                typeof w.playChannel !== "function" ||
                typeof w.stbIsPlaying !== "function" ||
                typeof w.stbGetPosTime !== "function"
            ) {
                fail("Wait for a player with channel playback to be ready.");
                return;
            }
            if (
                w.__ottParental &&
                (w.__ottParental.needs("providers") ||
                    w.__ottParental.needs("settings"))
            ) {
                fail(
                    "Unlock player settings before enabling or changing kiosk mode."
                );
                return;
            }
            var selected: any = null;
            if (params.query !== undefined) {
                var text = params.query.trim();
                var rows = (w.cList || w.curList || [])
                    .filter(function (id: any, i: number, ids: any[]) {
                        return ids.indexOf(id) === i && (w.channels || {})[id];
                    })
                    .map(function (id: any, i: number) {
                        return {
                            id: String(id),
                            name: String(w.channels[id].channel_name || ""),
                            number: i + 1,
                        };
                    });
                var search = caselessKey(text);
                // Keep catalogue order, even when a later row is an exact name match.
                var matches = rows.filter(function (row: any) {
                    return /^\d+$/.test(text)
                        ? row.number === Number(text)
                        : caselessKey(row.name).indexOf(search) !== -1;
                });
                if (!matches.length || !locate(matches[0].id)) {
                    fail(
                        "No matching channel is available in the current categories."
                    );
                    return;
                }
                selected = { id: matches[0].id, name: matches[0].name };
                if (
                    typeof w.ifParentalAccessChId === "function" &&
                    w.ifParentalAccessChId(selected.id, function () {})
                ) {
                    fail(
                        "Unlock the channel before selecting it for kiosk mode."
                    );
                    return;
                }
            }
            if (
                !save({
                    channel: selected,
                    provider: provider(),
                    source: source(),
                    strict:
                        params.strict !== undefined
                            ? params.strict
                            : !!(policy && policy.strict),
                })
            ) {
                fail("Could not save kiosk policy.");
                return;
            }
            retries = 0;
            if (selected) {
                closeControls();
                try {
                    play();
                } catch (_) {
                    health = "error";
                }
            }
        }
        done({ data: snapshot(), status: "ok" });
    }
    function init(): void {
        try {
            var saved = JSON.parse(w.stbGetItem(key) || "null");
            if (
                saved &&
                typeof saved.source === "string" &&
                typeof saved.provider === "string" &&
                (saved.strict === undefined ||
                    typeof saved.strict === "boolean") &&
                (saved.media
                    ? (saved.provider === "vportal" ||
                          saved.provider === "plex") &&
                      saved.channel === null &&
                      validMedia(saved.media) &&
                      saved.media.source === saved.source
                    : saved.channel === null ||
                      (saved.channel &&
                          typeof saved.channel.id === "string" &&
                          typeof saved.channel.name === "string"))
            )
                policy = saved;
        } catch (_) {}
        reset();
        if (timer === null) timer = w.setInterval(tick, 1000);
    }
    function stopDiagnostics(): boolean {
        if (!locked()) return false;
        try {
            var controller = w.__ottRemoteDiagnostics;
            if (
                !controller ||
                typeof controller.status !== "function" ||
                typeof controller.stopSession !== "function"
            )
                return false;
            var state = controller.status();
            if (
                !state ||
                state.state !== "active" ||
                typeof state.sessionId !== "string" ||
                !/^[A-Za-z0-9_.:-]{1,80}$/.test(state.sessionId)
            )
                return false;
            // Stop only this capture; connection authority and kiosk playback stay intact.
            controller.stopSession();
            return true;
        } catch (_) {
            return false;
        }
    }
    function diagnosticsStopTarget(event: any): boolean {
        var doc = w.document;
        if (!doc || typeof doc.getElementById !== "function") return false;
        var button = doc.getElementById("remoteDiagnosticsIndicator");
        return (
            !!button &&
            button.nodeName === "BUTTON" &&
            button.ownerDocument === doc &&
            event.target === button
        );
    }
    function blockInput(event: any): void {
        if (!locked()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // Consume the activation here: neither a DOM onclick nor a delegated
        // settings handler may run through this exception to kiosk input locking.
        if (
            ["click", "pointerdown", "mousedown", "touchstart"].indexOf(
                event.type
            ) >= 0 &&
            diagnosticsStopTarget(event)
        )
            stopDiagnostics();
    }
    function stopDiagnosticsKey(event: any): void {
        if (
            !locked() ||
            !diagnosticsStopTarget(event) ||
            (event.key !== "Enter" &&
                event.key !== " " &&
                event.keyCode !== 13 &&
                event.keyCode !== 32)
        )
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        stopDiagnostics();
    }
    if (w.document && w.document.addEventListener) {
        w.document.addEventListener("keydown", stopDiagnosticsKey, true);
        [
            "click",
            "dblclick",
            "pointerdown",
            "mousedown",
            "touchstart",
            "wheel",
        ].forEach(function (name) {
            w.document.addEventListener(name, blockInput, {
                capture: true,
                passive: false,
            });
        });
    }
    return {
        admit: admit,
        allowed: allowed,
        allowedMedia: allowedMedia,
        enabled: enabled,
        init: init,
        locked: locked,
        request: request,
        restoreMedia: function (): boolean {
            if (!locked() || !policy.media) return false;
            reset();
            play();
            return true;
        },
        snapshot: snapshot,
        stopDiagnostics: stopDiagnostics,
        strict: strict,
        strictKey: strictInput.key,
    };
}
