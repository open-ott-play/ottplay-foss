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
    var rafCount = 0,
        rafGap: number | null = null,
        tasks = 0,
        taskTime = 0,
        taskMax = 0,
        taskDropped = 0;
    var maximum = 9007199254740991;
    var supported = {
        long_tasks: !!(
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
            generation: number | null = null;
        if (handle && handle.diagnosticMedia) {
            var attachment = handle.diagnosticMedia();
            if (attachment) {
                media = attachment.media;
                hls = attachment.hls;
                generation = integer(attachment.generation);
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
        var details: any = {
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
        emit(owner, "hls", {
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
            detail:
                event === "error"
                    ? Object.prototype.hasOwnProperty.call(
                          details,
                          data.details
                      )
                        ? details[data.details]
                        : "other"
                    : null,
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
    function tick(): void {
        if (!current()) return;
        var now = ports.clock(),
            windowMs = interval(lastTick, now),
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
        lastTick = now;
        rafCount = tasks = taskTime = taskMax = taskDropped = 0;
        rafGap = null;
        if (current())
            timer = w.setTimeout(function () {
                safe(tick);
            }, 1000);
    }
    function raf(): void {
        if (!current()) return;
        var now = ports.clock(),
            gap = interval(lastFrame, now);
        rafCount = Math.min(maximum, rafCount + 1);
        if (gap !== null) rafGap = Math.max(rafGap || 0, gap);
        lastFrame = now;
        frame = w.requestAnimationFrame(raf);
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
            lastTick = ports.clock();
            if (ports.longTasks && supported.long_tasks) {
                try {
                    observer = new w.PerformanceObserver(function (list: any) {
                        safe(function () {
                            var entries = list.getEntries();
                            taskDropped = Math.min(
                                maximum,
                                taskDropped + Math.max(0, entries.length - 64)
                            );
                            for (
                                var i = 0;
                                i < Math.min(64, entries.length);
                                i++
                            ) {
                                var duration = number(entries[i].duration);
                                if (duration === null) continue;
                                tasks = Math.min(maximum, tasks + 1);
                                taskTime = Math.min(
                                    maximum,
                                    taskTime + duration
                                );
                                taskMax = Math.max(taskMax, duration);
                            }
                        });
                    });
                    observer.observe({ entryTypes: ["longtask"] });
                } catch (_) {
                    if (observer) observer.disconnect();
                    observer = null;
                    supported.long_tasks = false;
                }
            }
            if (ports.raf && supported.raf)
                frame = w.requestAnimationFrame(raf);
            timer = w.setTimeout(function () {
                safe(tick);
            }, 1000);
        },
        stop: function () {
            alive = false;
            if (timer !== null) w.clearTimeout(timer);
            if (frame !== null) w.cancelAnimationFrame(frame);
            if (observer) observer.disconnect();
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
