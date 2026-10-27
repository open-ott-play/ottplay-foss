/** Session-only sensors. Never retain media URLs, error strings or notification content. */
function createPerformanceSensors(w: any, ports: any): any {
    var alive = true,
        timer: any = null,
        frame: any = null,
        observer: any = null;
    var removeBackend: any = null,
        backend: any = null,
        owners: any = {};
    var sourceSequence = 0,
        notificationSequence = 0;
    var lastTick: any = null,
        lastFrame: any = null;
    var visibleState: boolean | null = null,
        visibilityRevision = 0,
        removeVisibility: any = null;
    var rafCount = 0,
        rafGap: number | null = null,
        tasks = 0,
        taskTime = 0,
        taskMax = 0,
        taskDropped = 0;
    var maximum = 9007199254740991;
    var errorDetails: any = {
        bufferAppendError: "buffer_append_error",
        bufferNudgeOnStall: "buffer_nudge_on_stall",
        bufferSeekOverHole: "buffer_seek_over_hole",
        bufferStalledError: "buffer_stalled_error",
        fragLoadError: "frag_load_error",
        fragLoadTimeOut: "frag_load_timeout",
        fragParsingError: "frag_parsing_error",
        levelEmptyError: "level_empty_error",
        levelLoadError: "level_load_error",
        levelLoadTimeOut: "level_load_timeout",
        manifestLoadError: "manifest_load_error",
        manifestLoadTimeOut: "manifest_load_timeout",
    };
    var supported = {
        long_tasks: !!(
            ports.origin !== null &&
            w.PerformanceObserver &&
            Array.isArray(w.PerformanceObserver.supportedEntryTypes) &&
            w.PerformanceObserver.supportedEntryTypes.indexOf("longtask") >= 0
        ),
        notification_stages: [
            "received",
            "dom_created",
            "media_fetch_start",
            "media_received",
            "image_loaded",
            "shown",
            "updated",
            "hidden",
            "dropped",
        ],
        notification_timings: [
            "fetch_ms",
            "base64_ms",
            "validation_ms",
            "blob_ms",
            "image_load_decode_ms",
        ],
        raf:
            typeof w.requestAnimationFrame === "function" &&
            typeof w.cancelAnimationFrame === "function",
    };
    function number(value: any, max = maximum, min = 0): number | null {
        return typeof value === "number" &&
            isFinite(value) &&
            value >= min &&
            value <= max
            ? value
            : null;
    }
    function integer(value: any, max = maximum): number | null {
        return number(value, max) !== null && value % 1 === 0 ? value : null;
    }
    function bool(value: any): boolean | null {
        return typeof value === "boolean" ? value : null;
    }
    function current(): boolean {
        return alive && ports.current();
    }
    function safe(callback: () => void): void {
        try {
            if (current()) callback();
        } catch (_) {}
    }
    function interval(start: any, end: any): number | null {
        return start && end && start.revision === end.revision
            ? number(end.at - start.at)
            : null;
    }
    function attempt(value: any, previous?: boolean): any {
        if (!value) return null;
        var result: any = {},
            keys = [
                "attachment",
                "engineStarts",
                "fatalErrors",
                "nativeFallbacks",
                "streamRetries",
            ];
        for (var i = 0; i < keys.length; i++) {
            var v = integer(value[keys[i]]);
            if (v === null) return null;
            result[keys[i]] = v;
        }
        if (previous) {
            if (
                integer(value.handleId) === null ||
                (value.generation !== null &&
                    integer(value.generation) === null) ||
                ["ended", "disposed", "suspended"].indexOf(value.reason) < 0
            )
                return null;
            result.handleId = value.handleId;
            result.generation = value.generation;
            result.reason = value.reason;
        }
        return result;
    }
    function readOwner(lane: string): any {
        var handle = backend && backend.current(lane),
            media: any = null,
            hls: any = null,
            initialPolicy: any = null,
            generation: number | null = null;
        if (handle && handle.diagnosticMedia) {
            var attachment = handle.diagnosticMedia();
            if (attachment) {
                media = attachment.media;
                hls = attachment.hls;
                generation = integer(attachment.generation);
                if (ports.hlsPolicy && attachment.initialHlsBufferPolicy)
                    initialPolicy = policyValues(
                        attachment.initialHlsBufferPolicy,
                        true
                    );
            }
        }
        if (generation === null && lane === "main" && w.__ottClassicPlayback) {
            var playback = w.__ottClassicPlayback.snapshot();
            generation = playback ? integer(playback.generation) : null;
        }
        if (!media && w.document)
            media = w.document.getElementById(
                lane === "main" ? "video" : "videopip"
            );
        return {
            generation: generation,
            handle: handle,
            handleId: handle ? integer(handle.id) : null,
            hls: hls,
            initialPolicy: initialPolicy,
            media: media,
        };
    }
    function detach(owner: any): void {
        if (owner)
            owner.remove.forEach(function (remove: any) {
                try {
                    remove();
                } catch (_) {}
            });
    }
    function attached(owner: any): boolean {
        if (!current() || owners[owner.lane] !== owner) return false;
        var now = readOwner(owner.lane);
        return (
            owner.handle === now.handle &&
            owner.media === now.media &&
            owner.hls === now.hls &&
            owner.generation === now.generation
        );
    }
    function emit(owner: any, kind: string, data: any): void {
        if (attached(owner)) ports.emit(kind, owner.lane, data, owner);
    }
    function field(value: any, key: string): any {
        try {
            return value ? value[key] : null;
        } catch (_) {
            return null;
        }
    }
    function errorDetail(detail: any): string {
        if (typeof detail !== "string") return "other";
        if (Object.prototype.hasOwnProperty.call(errorDetails, detail))
            return errorDetails[detail];
        if (ports.hlsPolicy) {
            if (detail === "bufferFullError") return "buffer_full_error";
            if (detail === "bufferAppendNoProgress")
                return "buffer_append_no_progress";
            if (detail === "bufferAddCodecError")
                return "buffer_add_codec_error";
            if (detail === "internalException") return "internal_exception";
        }
        return "other";
    }
    function pts(value: any, start: string, end: string): any {
        var a = number(field(value, start), maximum, -maximum),
            b = number(field(value, end), maximum, -maximum);
        // Invalid intervals are unknown, never repaired into invented timing.
        if (a !== null && b !== null && b < a) a = b = null;
        return { end: b, start: a };
    }
    function hlsFragment(owner: any, event: string, data: any): void {
        if (!owner.sourceId) return;
        var frag = field(data, "frag"),
            part = field(data, "part"),
            span = pts(frag, "start", "end"),
            times = pts(frag, "startPTS", "endPTS"),
            streams = field(frag, "elementaryStreams"),
            tracks: any[] = [];
        ["audio", "video", "audiovideo"].forEach(function (track) {
            var stream = field(streams, track);
            if (!stream) return;
            var values = pts(stream, "startPTS", "endPTS");
            var item: any = {
                end_pts_seconds: values.end,
                start_pts_seconds: values.start,
                track: track,
            };
            if (ports.hlsPolicy) item.partial = bool(field(stream, "partial"));
            tracks.push(item);
        });
        var value: any = {
            discontinuity_counter: integer(field(frag, "cc")),
            elementary_streams: tracks,
            end_pts_seconds: times.end,
            end_seconds: span.end,
            event: event,
            fragment_sequence: integer(field(frag, "sn")),
            level: integer(field(frag, "level")),
            part_index: integer(field(part, "index")),
            start_pts_seconds: times.start,
            start_seconds: span.start,
        };
        if (ports.hlsPolicy) {
            value.fragment_gap = bool(field(frag, "gap"));
            value.part_gap = bool(field(part, "gap"));
            value.part_independent = bool(field(part, "independent"));
        }
        emit(owner, "hls_fragment", value);
    }
    function hlsBuffers(owner: any, data: any): void {
        if (!owner.sourceId) return;
        var ranges = field(data, "timeRanges"),
            position = number(
                field(owner.media, "currentTime"),
                maximum,
                -maximum
            );
        ["audio", "video", "audiovideo"].forEach(function (track) {
            if (!ranges || !Object.prototype.hasOwnProperty.call(ranges, track))
                return;
            // Copy inside the public event callback. Do not retain HLS data,
            // SourceBuffers or borrowed TimeRanges, or re-emit stale snapshots.
            var snapshot = buffers(
                { buffered: field(ranges, track) },
                position
            );
            emit(owner, "hls_buffer", {
                buffered: snapshot.value,
                position_seconds: position,
                track: track,
            });
        });
    }
    function policyValues(config: any, snake: boolean): any {
        var value: any = {};
        [
            ["max_buffer_length_seconds", "maxBufferLength"],
            ["max_max_buffer_length_seconds", "maxMaxBufferLength"],
            ["max_buffer_size_bytes", "maxBufferSize"],
            ["back_buffer_length_seconds", "backBufferLength"],
        ].forEach(function (pair) {
            var observed = field(config, pair[snake ? 0 : 1]);
            value[pair[0]] =
                pair[0] === "max_buffer_size_bytes"
                    ? integer(observed)
                    : number(observed);
        });
        return value;
    }
    function hlsBufferPolicy(owner: any, observation: string): void {
        if (!ports.hlsPolicy || !owner.hls || !owner.sourceId) return;
        var value = policyValues(field(owner.hls, "config"), false),
            cap = value.max_max_buffer_length_seconds;
        if (!owner.policyObserved || cap !== owner.previousCap) {
            emit(owner, "hls_buffer_policy", {
                cause: "unknown",
                current: value,
                event: owner.policyObserved
                    ? "cap_observation_changed"
                    : "snapshot",
                initial: owner.initialPolicy || policyValues(null, true),
                initial_source: owner.initialPolicy
                    ? "constructor_snapshot"
                    : "unavailable",
                observation: observation,
                previous_max_max_buffer_length_seconds: owner.policyObserved
                    ? owner.previousCap
                    : null,
            });
            owner.previousCap = cap;
            owner.policyObserved = true;
        }
    }
    function hlsConfig(owner: any, observation = "sample"): void {
        if (!ports.hlsDetails || !owner || !owner.hls || !owner.sourceId)
            return;
        var config = field(owner.hls, "config"),
            value = policyValues(config, false);
        [
            ["max_buffer_hole_seconds", "maxBufferHole"],
            ["high_buffer_watchdog_period_seconds", "highBufferWatchdogPeriod"],
            ["nudge_offset_seconds", "nudgeOffset"],
            ["nudge_max_retry", "nudgeMaxRetry"],
            ["live_sync_duration_seconds", "liveSyncDuration"],
            ["live_sync_duration_count", "liveSyncDurationCount"],
            ["live_max_latency_duration_seconds", "liveMaxLatencyDuration"],
            ["live_max_latency_duration_count", "liveMaxLatencyDurationCount"],
        ].forEach(function (pair) {
            var observed = field(config, pair[1]);
            value[pair[0]] =
                pair[0] === "nudge_max_retry"
                    ? integer(observed)
                    : number(observed);
        });
        var encoded = JSON.stringify(value);
        if (encoded !== owner.config) {
            owner.config = encoded;
            emit(owner, "hls_config", value);
        }
        hlsBufferPolicy(owner, observation);
    }
    function hlsLive(owner: any): void {
        if (!ports.hlsDetails || !owner.hls || !owner.sourceId) return;
        var details = field(owner.hls, "latestLevelDetails");
        function level(key: string): any {
            var index = number(field(owner.hls, key), 65535, -1);
            if (index !== null && index % 1 !== 0) index = null;
            var value =
                index !== null && index >= 0
                    ? field(field(owner.hls, "levels"), String(index))
                    : null;
            return {
                bitrate: number(field(value, "bitrate")),
                index: index,
                max_bitrate: number(field(value, "maxBitrate")),
            };
        }
        emit(owner, "hls_live", {
            current_level: level("currentLevel"),
            edge_seconds: number(field(details, "edge"), maximum, -maximum),
            effective_buffer_length_seconds: number(
                field(owner.hls, "maxBufferLength")
            ),
            latency_seconds: number(
                field(owner.hls, "latency"),
                maximum,
                -maximum
            ),
            live_sync_position_seconds: number(
                field(owner.hls, "liveSyncPosition"),
                maximum,
                -maximum
            ),
            load_level: level("loadLevel"),
            max_latency_seconds: number(field(owner.hls, "maxLatency")),
            position_seconds: number(
                field(owner.media, "currentTime"),
                maximum,
                -maximum
            ),
            target_duration_seconds: number(field(details, "targetduration")),
            target_latency_seconds: number(field(owner.hls, "targetLatency")),
        });
    }
    function hlsEvent(owner: any, event: string, data: any): void {
        data = data || {};
        var frag = data.frag,
            part = data.part;
        var stats =
            (part && part.stats) ||
            (frag && frag.stats) ||
            (event === "playlist" ? data.stats : null) ||
            {};
        var loading = stats.loading || {},
            parsing = stats.parsing || {},
            buffering = stats.buffering || {};
        var origin = ports.origin,
            now = ports.clock();
        function timestamp(value: any): number | null {
            return origin !== null &&
                now.revision === 0 &&
                number(value) !== null &&
                value > 0 &&
                value <= origin + now.at
                ? number(value - origin, maximum, -maximum)
                : null;
        }
        function duration(start: any, end: any): number | null {
            return timestamp(start) !== null && timestamp(end) !== null
                ? number(end - start)
                : null;
        }
        var begin = timestamp(loading.start),
            first = timestamp(loading.first),
            end = timestamp(loading.end);
        if (first !== null && begin !== null && first < begin) first = null;
        if (end !== null && begin !== null && end < begin) end = null;
        var status = integer(
            data.networkDetails && data.networkDetails.status,
            599
        );
        if (status === null)
            status = integer(data.response && data.response.code, 599);
        if (status !== null && status < 100) status = null;
        var value: any = {
            buffer_duration_ms: duration(buffering.start, buffering.end),
            bytes: integer(stats.loaded),
            category:
                event !== "error"
                    ? null
                    : data.type === "networkError"
                      ? "network"
                      : data.type === "mediaError"
                        ? "media"
                        : "other",
            detail: event === "error" ? errorDetail(data.details) : null,
            event: event,
            fatal: event === "error" ? bool(data.fatal) : null,
            first_byte_at_ms: first,
            first_byte_duration_ms: duration(loading.start, loading.first),
            fragment_sequence: integer(frag && frag.sn),
            http_status: status,
            level: integer(frag ? frag.level : data.level),
            load_duration_ms: duration(loading.start, loading.end),
            load_end_ms: end,
            load_start_ms: begin,
            parse_duration_ms: duration(parsing.start, parsing.end),
            part_index: integer(part && part.index),
            retries: integer(stats.retry),
            timing_source:
                begin !== null || first !== null || end !== null
                    ? "performance"
                    : "unavailable",
        };
        if (ports.hlsPolicy) {
            value.stats_retry = value.retries;
            delete value.retries;
        }
        emit(owner, "hls", value);
    }
    function hlsErrorAction(owner: any, data: any): void {
        if (!ports.hlsPolicy || !owner.sourceId) return;
        var action = field(data, "errorAction"),
            type = field(data, "type"),
            detail = field(data, "details"),
            frag = field(data, "frag"),
            part = field(data, "part"),
            actionId = integer(field(action, "action"), 5),
            actions = [
                "do_nothing",
                "send_end_callback",
                "send_alternate_to_penalty_box",
                "remove_alternate_permanently",
                "insert_discontinuity",
                "retry_request",
            ];
        emit(owner, "hls_error_action", {
            action: actionId === null ? null : actions[actionId],
            category:
                type === "networkError"
                    ? "network"
                    : type === "mediaError"
                      ? "media"
                      : "other",
            detail: errorDetail(detail),
            flags: integer(field(action, "flags"), 31),
            fragment_sequence: integer(field(frag, "sn")),
            level: integer(frag ? field(frag, "level") : field(data, "level")),
            part_index: integer(field(part, "index")),
            resolved: bool(field(action, "resolved")),
            retry_budget_count: integer(field(action, "retryCount")),
        });
    }
    function attach(lane: string): void {
        var next = readOwner(lane),
            previous = owners[lane];
        if (
            previous &&
            previous.handle === next.handle &&
            previous.media === next.media &&
            previous.hls === next.hls &&
            previous.generation === next.generation
        )
            return;
        detach(previous);
        next.lane = lane;
        next.remove = [];
        next.level = null;
        next.sourceId = ++sourceSequence <= 1024 ? "s" + sourceSequence : null;
        owners[lane] = next;
        if (!next.media) return;
        ports.emit(
            "session",
            lane,
            { event: "source_changed", reason: null },
            next
        );
        if (next.media.addEventListener && next.media.removeEventListener)
            [
                "waiting",
                "stalled",
                "playing",
                "pause",
                "seeking",
                "seeked",
                "error",
                "ended",
            ].forEach(function (name) {
                var callback = function () {
                    safe(function () {
                        emit(next, "media", {
                            error_code: next.media.error
                                ? integer(next.media.error.code, 4) || null
                                : null,
                            event: name,
                            reason: null,
                        });
                    });
                };
                next.media.addEventListener(name, callback);
                next.remove.push(function () {
                    next.media.removeEventListener(name, callback);
                });
            });
        var hls = next.hls,
            events = w.Hls && w.Hls.Events;
        if (!hls || !events || !hls.on || !hls.off) return;
        [
            ["FRAG_LOADED", "fragment"],
            ["FRAG_BUFFERED", "fragment_buffered"],
            ["LEVEL_LOADED", "playlist"],
            ["ERROR", "error"],
            ["LEVEL_SWITCHED", "abr"],
        ].forEach(function (pair) {
            var name = events[pair[0]];
            if (!name) return;
            var callback = function (_event: any, data: any) {
                if (ports.hlsPolicy)
                    safe(function () {
                        hlsBufferPolicy(next, "hls_event");
                        if (pair[1] === "error") hlsErrorAction(next, data);
                    });
                if (
                    ports.hlsDetails &&
                    (pair[1] === "fragment" || pair[1] === "fragment_buffered")
                )
                    safe(function () {
                        hlsFragment(next, pair[1], data);
                    });
                safe(function () {
                    if (pair[1] !== "abr") {
                        hlsEvent(next, pair[1], data);
                        return;
                    }
                    var level = integer(data && data.level),
                        detail =
                            (level !== null &&
                                hls.levels &&
                                hls.levels[level]) ||
                            {};
                    emit(next, "abr", {
                        automatic: bool(hls.autoLevelEnabled),
                        bitrate: integer(detail.bitrate),
                        from_level: next.level,
                        height: integer(detail.height, 65535),
                        to_level: level,
                        width: integer(detail.width, 65535),
                    });
                    next.level = level;
                });
            };
            hls.on(name, callback);
            next.remove.push(function () {
                hls.off(name, callback);
            });
        });
        if (ports.hlsDetails && events.BUFFER_APPENDED) {
            var appended = function (_event: any, data: any) {
                safe(function () {
                    hlsBufferPolicy(next, "hls_event");
                    hlsBuffers(next, data);
                });
            };
            hls.on(events.BUFFER_APPENDED, appended);
            next.remove.push(function () {
                hls.off(events.BUFFER_APPENDED, appended);
            });
        }
        hlsConfig(next, "attachment");
    }
    function buffers(media: any, position: any): any {
        var empty = {
            ahead: null,
            value: {
                range_count: null,
                ranges: [] as any[],
                truncated_count: null,
            },
        };
        try {
            var ranges = media.buffered,
                count = integer(ranges.length, 65535);
            if (count === null || position === null) return empty;
            var lo = 0,
                hi = count;
            while (lo < hi) {
                var mid = Math.floor((lo + hi) / 2),
                    start = number(ranges.start(mid), maximum, -maximum);
                if (start === null) return empty;
                if (start <= position) lo = mid + 1;
                else hi = mid;
            }
            var containing = lo - 1,
                ahead = 0;
            if (containing >= 0) {
                var end = number(ranges.end(containing), maximum, -maximum);
                if (end === null) return empty;
                if (end >= position) ahead = end - position;
            }
            var first = Math.max(
                0,
                Math.min(Math.max(0, containing - 3), count - 8)
            );
            var selected: any[] = [],
                lastEnd: number | null = null;
            for (var i = first; i < Math.min(count, first + 8); i++) {
                var a = number(ranges.start(i), maximum, -maximum),
                    b = number(ranges.end(i), maximum, -maximum);
                if (
                    a === null ||
                    b === null ||
                    b < a ||
                    (lastEnd !== null && a < lastEnd)
                )
                    return empty;
                selected.push({ end_seconds: b, index: i, start_seconds: a });
                lastEnd = b;
            }
            return {
                ahead: ahead,
                value: {
                    range_count: count,
                    ranges: selected,
                    truncated_count: count - selected.length,
                },
            };
        } catch (_) {
            return empty;
        }
    }
    function frames(media: any): any {
        var value: any = {
            corrupted: null,
            dropped: null,
            source: "unsupported",
            total: null,
        };
        try {
            if (typeof media.getVideoPlaybackQuality === "function") {
                var quality = media.getVideoPlaybackQuality();
                if (quality) {
                    value.source = "quality";
                    value.total = integer(quality.totalVideoFrames);
                    value.dropped = integer(quality.droppedVideoFrames);
                    value.corrupted = integer(quality.corruptedVideoFrames);
                }
            }
        } catch (_) {}
        if (
            value.total === null &&
            value.dropped === null &&
            value.corrupted === null
        ) {
            try {
                value.source = "webkit";
                value.total = integer(media.webkitDecodedFrameCount);
                value.dropped = integer(media.webkitDroppedFrameCount);
            } catch (_) {}
        }
        if (
            value.total === null &&
            value.dropped === null &&
            value.corrupted === null
        )
            value.source = "unsupported";
        if (value.total !== null) {
            if (value.dropped !== null && value.dropped > value.total)
                value.dropped = null;
            if (value.corrupted !== null && value.corrupted > value.total)
                value.corrupted = null;
        }
        return value;
    }
    function sample(owner: any): void {
        if (!owner.media || !attached(owner)) return;
        hlsConfig(owner);
        hlsLive(owner);
        var media = owner.media,
            position = number(media.currentTime, maximum, -maximum),
            ranges = buffers(media, position);
        emit(owner, "sample", {
            attempt: attempt(
                owner.handle &&
                    owner.handle.diagnosticAttempt &&
                    owner.handle.diagnosticAttempt()
            ),
            buffer_ahead_seconds: ranges.ahead,
            buffered: ranges.value,
            ended: bool(media.ended),
            frames: frames(media),
            height: integer(media.videoHeight, 65535),
            last_attempt: attempt(
                backend &&
                    backend.lastAttempt &&
                    backend.lastAttempt(owner.lane),
                true
            ),
            network_state: integer(media.networkState, 3),
            paused: bool(media.paused),
            playback_rate: number(media.playbackRate, 16),
            position_seconds: position,
            ready_state: integer(media.readyState, 4),
            seeking: bool(media.seeking),
            width: integer(media.videoWidth, 65535),
        });
    }
    function refresh(): void {
        if (!current()) return;
        var next = w.__ottCoreBackendPeek && w.__ottCoreBackendPeek();
        if (next !== backend) {
            if (removeBackend) removeBackend();
            backend = next;
            removeBackend =
                backend && backend.subscribe
                    ? backend.subscribe(function () {
                          safe(refresh);
                      })
                    : null;
        }
        attach("main");
        attach("pip");
    }
    function visible(): boolean {
        return !!(w.document && w.document.visibilityState === "visible");
    }
    function nextFrame(): void {
        var revision = visibilityRevision;
        frame = w.requestAnimationFrame(function () {
            if (revision !== visibilityRevision) return;
            frame = null;
            raf();
        });
    }
    function visibilityChanged(): void {
        if (!current() || visibleState === visible()) return;
        visibleState = visible();
        var revision = ++visibilityRevision;
        lastTick = visibleState ? ports.clock() : null;
        lastFrame = null;
        rafCount = tasks = taskTime = taskMax = taskDropped = 0;
        rafGap = null;
        if (frame !== null) w.cancelAnimationFrame(frame);
        frame = null;
        if (observer) observer.disconnect();
        observer = null;
        if (!visibleState) return;
        if (ports.longTasks && supported.long_tasks) {
            var since = ports.origin + lastTick.at;
            try {
                observer = new w.PerformanceObserver(function (list: any) {
                    safe(function () {
                        if (revision !== visibilityRevision || !visible())
                            return;
                        // A task may start while hidden and finish after resume.
                        // Old observers and such boundary-spanning tasks do not
                        // belong to this visible observation window.
                        var entries = list.getEntries();
                        // Count uninspected overflow conservatively as dropped.
                        taskDropped = Math.min(
                            maximum,
                            taskDropped + Math.max(0, entries.length - 64)
                        );
                        for (var i = 0; i < Math.min(64, entries.length); i++) {
                            var start = number(entries[i].startTime);
                            if (start === null || start < since) continue;
                            var duration = number(entries[i].duration);
                            if (duration === null) continue;
                            tasks = Math.min(maximum, tasks + 1);
                            taskTime = Math.min(maximum, taskTime + duration);
                            taskMax = Math.max(taskMax, duration);
                        }
                    });
                });
                observer.observe({ entryTypes: ["longtask"] });
            } catch (_) {
                if (observer) observer.disconnect();
                observer = null;
                if (revision > 1) ports.stop("unsupported");
                else supported.long_tasks = false;
            }
        }
        if (current() && ports.raf && supported.raf) nextFrame();
    }
    function tick(): void {
        if (!current()) return;
        visibilityChanged();
        var now = ports.clock(),
            windowMs = visibleState ? interval(lastTick, now) : null,
            delay = windowMs === null ? null : Math.max(0, windowMs - 1000);
        if (delay !== null) ports.lease.loop(delay);
        refresh();
        ["main", "pip"].forEach(function (lane) {
            safe(function () {
                sample(owners[lane]);
            });
        });
        if (windowMs !== null)
            ports.emit("loop", null, {
                long_task_entries_dropped:
                    ports.longTasks && supported.long_tasks
                        ? taskDropped
                        : null,
                long_tasks:
                    ports.longTasks && supported.long_tasks ? tasks : null,
                long_tasks_max_ms:
                    ports.longTasks && supported.long_tasks ? taskMax : null,
                long_tasks_total_ms:
                    ports.longTasks && supported.long_tasks ? taskTime : null,
                max_delay_ms: delay,
                raf_callbacks: ports.raf && supported.raf ? rafCount : null,
                raf_max_gap_ms: ports.raf && supported.raf ? rafGap : null,
                samples: windowMs === null ? 0 : 1,
                window_ms: windowMs === null ? 0 : windowMs,
            });
        lastTick = visibleState ? now : null;
        rafCount = tasks = taskTime = taskMax = taskDropped = 0;
        rafGap = null;
        if (current())
            timer = w.setTimeout(function () {
                safe(tick);
            }, 1000);
    }
    function raf(): void {
        if (!current()) return;
        if (!visible()) {
            visibilityChanged();
            return;
        }
        var now = ports.clock(),
            gap = interval(lastFrame, now);
        rafCount = Math.min(maximum, rafCount + 1);
        if (gap !== null) rafGap = Math.max(rafGap || 0, gap);
        lastFrame = now;
        nextFrame();
    }
    function notification(media: any, activeCount: () => number): any {
        if (!current()) return null;
        var id =
            ++notificationSequence <= 1024 ? "n" + notificationSequence : null;
        var starts: any = {},
            times: any = {},
            closed = false;
        var image = !!media;
        media = image
            ? { bytes: media.bytes, height: media.height, width: media.width }
            : null;
        function send(stage: string, reason?: string): void {
            if (
                !current() ||
                closed ||
                supported.notification_stages.indexOf(stage) < 0
            )
                return;
            var data: any = {
                active_count: integer(activeCount(), 3) || 0,
                base64_ms: null,
                blob_ms: null,
                decode_ms: null,
                fetch_ms: null,
                image_bytes:
                    image && media.bytes > 0
                        ? integer(media.bytes, 163840)
                        : null,
                image_height:
                    image && media.height > 0
                        ? integer(media.height, 360)
                        : null,
                image_load_decode_ms: null,
                image_width:
                    image && media.width > 0 ? integer(media.width, 640) : null,
                media: image ? "image" : "none",
                notification_id: id,
                queue_ms: null,
                reason: reason || null,
                stage: stage,
                validation_ms: null,
            };
            supported.notification_timings.forEach(function (key) {
                data[key] = times[key] === undefined ? null : times[key];
            });
            ports.emit("notification", null, data);
            if (stage === "hidden" || stage === "dropped") closed = true;
        }
        return {
            phase: function (name: string, finished: boolean) {
                if (
                    !current() ||
                    closed ||
                    supported.notification_timings.indexOf(name + "_ms") < 0
                )
                    return;
                var now = ports.clock();
                if (!finished) {
                    starts[name] = now;
                    if (name === "fetch") send("media_fetch_start");
                } else {
                    times[name + "_ms"] = interval(starts[name], now);
                    delete starts[name];
                    if (name === "fetch") send("media_received");
                }
            },
            stage: send,
        };
    }
    return {
        changed: function () {
            safe(refresh);
        },
        notification: notification,
        recovery: function (key: string) {
            safe(function () {
                refresh();
                var owner = owners.main,
                    value =
                        owner &&
                        owner.handle &&
                        owner.handle.diagnosticAttempt &&
                        attempt(owner.handle.diagnosticAttempt());
                var names: any = {
                    engineStarts: "engine_start",
                    fatalErrors: "fatal_error",
                    nativeFallbacks: "native_fallback",
                    streamRetries: "stream_retry",
                };
                if (value && names[key])
                    emit(owner, "recovery", {
                        attempt: value,
                        event: names[key],
                    });
            });
        },
        start: function () {
            refresh();
            if (
                w.document &&
                w.document.addEventListener &&
                w.document.removeEventListener
            ) {
                w.document.addEventListener(
                    "visibilitychange",
                    visibilityChanged
                );
                removeVisibility = function () {
                    w.document.removeEventListener(
                        "visibilitychange",
                        visibilityChanged
                    );
                };
            }
            visibilityChanged();
            timer = w.setTimeout(function () {
                safe(tick);
            }, 1000);
        },
        stop: function () {
            alive = false;
            if (timer !== null) w.clearTimeout(timer);
            if (frame !== null) w.cancelAnimationFrame(frame);
            if (observer) observer.disconnect();
            if (removeVisibility) removeVisibility();
            if (removeBackend) removeBackend();
            Object.keys(owners).forEach(function (lane) {
                detach(owners[lane]);
            });
            owners = {};
        },
        supported: supported,
    };
}
(window as any).__ottPerfSensors = { create: createPerformanceSensors };
