/** Explicit, bounded diagnostic lease. Loading this factory starts no observers. */
function createPerformanceCapture(w: any, runtime: () => string): any {
    if (w.__ottPerfCapture) return w.__ottPerfCapture;
    var report: any = null,
        lease: any = null,
        sensors: any = null;
    var active = false,
        expiry: any = null,
        purge: any = null;
    var events: any[] = [],
        sizes: number[] = [],
        bytes = 0,
        sequence = 1;
    var rateDropped = 0,
        ringDropped = 0,
        oversizedDropped = 0;
    var origin = 0,
        lastRaw = 0,
        elapsed = 0,
        regression = 0;
    var recoveringClock = false;
    var tokens = 40,
        refillAt = 0,
        binding = "",
        performanceClock = false;
    function finite(value: any): boolean {
        return (
            typeof value === "number" &&
            isFinite(value) &&
            value >= 0 &&
            value <= 9007199254740991
        );
    }
    function integer(value: any): boolean {
        return finite(value) && value % 1 === 0;
    }
    function matches(value: any, pattern: RegExp): boolean {
        return (
            typeof value === "string" &&
            !/[\r\n]/.test(value) &&
            pattern.test(value)
        );
    }
    function wall(): number {
        return w.Date ? w.Date.now() : Date.now();
    }
    function rawClock(): number {
        return performanceClock ? w.performance.now() : wall();
    }
    function clock(): any {
        var value: number;
        try {
            value = rawClock();
        } catch (_) {
            regression++;
            return { at: elapsed, revision: regression };
        }
        if (!finite(value) || value < lastRaw) {
            regression++;
            recoveringClock = true;
        } else {
            if (recoveringClock) {
                regression++;
                recoveringClock = false;
            }
            elapsed = Math.max(elapsed, value - origin);
            lastRaw = value;
        }
        return { at: elapsed, revision: regression };
    }
    var loopMetrics: any = {};
    function acquireLease(): any {
        var debug = w.__ottRuntimeDebug,
            revision = debug.configurationRevision();
        loopMetrics = {};
        function authorized(): boolean {
            return (
                debug === w.__ottRuntimeDebug &&
                revision === debug.configurationRevision() &&
                debug.available()
            );
        }
        var value = {
            authorized: authorized,
            close: function () {
                if (lease === value) loopMetrics = {};
            },
            current: function () {
                return lease === value && active && authorized();
            },
            loop: function (delay: number) {
                if (
                    !value.current() ||
                    !finite(delay) ||
                    !w.document ||
                    w.document.visibilityState !== "visible"
                )
                    return;
                loopMetrics.loopDelayMs = delay;
                loopMetrics.loopMaxDelayMs = Math.max(
                    loopMetrics.loopMaxDelayMs || 0,
                    delay
                );
                loopMetrics.loopSamples = (loopMetrics.loopSamples || 0) + 1;
                if (delay >= 250) {
                    loopMetrics.loopLongDelays =
                        (loopMetrics.loopLongDelays || 0) + 1;
                    debug.recordPerformanceDelay();
                }
            },
        };
        return value;
    }
    function removeOldest(): void {
        events.shift();
        bytes -= sizes.shift()!;
        ringDropped++;
    }
    function store(
        kind: string,
        lane: string | null,
        data: any,
        owner?: any,
        terminal?: boolean
    ): void {
        if (!report || (!terminal && !admitted())) return;
        var time = clock().at,
            seq = sequence++;
        if (!terminal) {
            tokens = Math.min(40, tokens + Math.max(0, time - refillAt) / 50);
            refillAt = time;
            if (tokens < 1) {
                rateDropped++;
                return;
            }
            tokens--;
        }
        var event = {
            at_ms: time,
            data: data,
            generation:
                owner && integer(owner.generation) ? owner.generation : null,
            handle_id: owner && integer(owner.handleId) ? owner.handleId : null,
            kind: kind,
            lane: lane,
            seq: seq,
            source_id:
                owner && matches(owner.sourceId, /^s[1-9][0-9]{0,5}$/)
                    ? owner.sourceId
                    : null,
        };
        var encoded: string;
        try {
            encoded = JSON.stringify(event);
        } catch (_) {
            oversizedDropped++;
            return;
        }
        // All strings are local enums, never URLs, provider data or notification text.
        if (encoded.length > 2048 || /[^\x00-\x7f]/.test(encoded)) {
            oversizedDropped++;
            return;
        }
        while (
            events.length &&
            (events.length >= (terminal ? 1024 : 1023) ||
                bytes + encoded.length > (terminal ? 524288 : 522240))
        )
            removeOldest();
        events.push(event);
        sizes.push(encoded.length);
        bytes += encoded.length;
    }
    function discard(): void {
        if (purge !== null) w.clearTimeout(purge);
        purge = null;
        report = null;
        lease = null;
        events = [];
        sizes = [];
        bytes = 0;
    }
    function stop(reason: string): void {
        if (!active) return;
        active = false;
        if (expiry !== null) w.clearTimeout(expiry);
        expiry = null;
        if (w.__ottPerfSink === sensors) w.__ottPerfSink = null;
        try {
            if (sensors) sensors.stop();
        } catch (_) {}
        sensors = null;
        try {
            if (lease) lease.close();
        } catch (_) {}
        report.state = "stopped";
        report.reason = reason;
        store(
            "session",
            null,
            { event: "stopped", reason: reason },
            null,
            true
        );
        report.elapsed_ms = elapsed;
        purge = w.setTimeout(discard, 300000);
    }
    function admitted(): boolean {
        if (!active) return false;
        if (runtime() !== binding) {
            stop("runtime_changed");
            discard();
            return false;
        }
        if (!lease || !lease.current()) {
            stop("disconnected");
            discard();
            return false;
        }
        if (clock().at >= report.duration_seconds * 1000) {
            stop("expired");
            return false;
        }
        return true;
    }
    function metadata(): any {
        if (active) admitted();
        if (!report) return null;
        var result = Object.assign({}, report);
        result.elapsed_ms = active ? clock().at : report.elapsed_ms;
        result.remaining_ms = active
            ? Math.max(0, result.duration_seconds * 1000 - result.elapsed_ms)
            : 0;
        result.first_seq = events.length ? events[0].seq : sequence;
        result.next_seq = sequence;
        result.event_count = events.length;
        result.rate_dropped = rateDropped;
        result.ring_dropped = ringDropped;
        result.oversized_dropped = oversizedDropped;
        result.dropped_events = rateDropped + ringDropped + oversizedDropped;
        result.bytes = bytes;
        return result;
    }
    function request(input: any): any {
        var p = input.params || {},
            op = p.op;
        function fail(error: string): any {
            return {
                data: { error: error, op: op, runtime: p.runtime, version: 1 },
                status: error === "unsupported" ? "unsupported" : "rejected",
            };
        }
        function reply(extra?: any): any {
            return {
                data: Object.assign(
                    {
                        op: op,
                        runtime: p.runtime,
                        session: metadata(),
                        version: 1,
                    },
                    extra || {}
                ),
                status: "ok",
            };
        }
        var required = ["version", "op", "runtime"],
            optional: string[] = [];
        if (op === "start") {
            required.push("session_id");
            optional = ["duration_seconds", "raf", "long_tasks"];
        } else if (op === "read") {
            required.push("session_id", "after_seq");
            optional = ["limit"];
        } else if (op === "stop") required.push("session_id");
        else if (op === "status") optional = ["session_id"];
        else return fail("invalid_request");
        if (
            p.version !== 1 ||
            required.some(function (key) {
                return !Object.prototype.hasOwnProperty.call(p, key);
            }) ||
            Object.keys(p).some(function (key) {
                return required.indexOf(key) < 0 && optional.indexOf(key) < 0;
            }) ||
            !matches(p.runtime, /^[A-Za-z0-9_.:-]{1,128}$/) ||
            (p.session_id !== undefined &&
                !matches(p.session_id, /^[a-f0-9]{32}$/))
        )
            return fail("invalid_request");
        if (p.runtime !== runtime()) return fail("runtime_mismatch");
        if (
            typeof input.expires_at === "number" &&
            wall() >= input.expires_at * 1000
        )
            return fail("expired");
        if (active) admitted();
        if (
            report &&
            (binding !== runtime() || (lease && !lease.authorized()))
        ) {
            stop("disconnected");
            discard();
        }
        if (!w.__ottRuntimeDebug || !w.__ottRuntimeDebug.available())
            return fail("disconnected");
        if (op === "start") {
            var duration =
                p.duration_seconds === undefined ? 120 : p.duration_seconds;
            var raf = p.raf === undefined ? false : p.raf,
                longTasks = p.long_tasks === undefined ? true : p.long_tasks;
            if (
                !integer(duration) ||
                duration < 10 ||
                duration > 600 ||
                typeof raf !== "boolean" ||
                typeof longTasks !== "boolean"
            )
                return fail("invalid_request");
            if (report && report.id === p.session_id) {
                if (
                    report.duration_seconds !== duration ||
                    report.requested.raf !== raf ||
                    report.requested.long_tasks !== longTasks
                )
                    return fail("busy");
                return reply();
            }
            if (active) return fail("busy");
            if (
                !w.__ottPerfSensors ||
                !w.__ottRuntimeDebug.configurationRevision
            )
                return fail("unsupported");
            discard();
            try {
                lease = acquireLease();
                performanceClock = false;
                try {
                    performanceClock = !!(
                        w.performance &&
                        typeof w.performance.now === "function" &&
                        finite(w.performance.now())
                    );
                } catch (_) {}
                origin = lastRaw = rawClock();
                elapsed = 0;
                regression = 0;
                recoveringClock = false;
                tokens = 40;
                refillAt = 0;
                sequence = 1;
                rateDropped = ringDropped = oversizedDropped = 0;
                binding = runtime();
                active = true;
                report = {
                    clock: performanceClock ? "performance" : "wall_fallback",
                    duration_seconds: duration,
                    elapsed_ms: 0,
                    id: p.session_id,
                    reason: null,
                    remaining_ms: duration * 1000,
                    requested: { long_tasks: longTasks, raf: raf },
                    sample_interval_ms: 1000,
                    started_at_unix_ms: wall(),
                    state: "active",
                    supported: {},
                };
                sensors = w.__ottPerfSensors.create(w, {
                    clock: clock,
                    current: admitted,
                    emit: store,
                    lease: lease,
                    longTasks: longTasks,
                    origin: performanceClock ? origin : null,
                    raf: raf,
                    stop: stop,
                });
                report.supported = sensors.supported;
                w.__ottPerfSink = sensors;
                store(
                    "session",
                    null,
                    { event: "started", reason: null },
                    null,
                    true
                );
                expiry = w.setTimeout(function () {
                    stop("expired");
                }, duration * 1000);
                sensors.start();
                if (!report) return fail("disconnected");
                return reply();
            } catch (_) {
                if (active && report) stop("unsupported");
                else active = false;
                return fail("unsupported");
            }
        }
        if (!report || (p.session_id && report.id !== p.session_id))
            return op === "status" && !p.session_id
                ? reply()
                : fail("not_found");
        if (op === "stop") {
            stop("requested");
            return reply();
        }
        if (op === "status") return reply();
        var limit = p.limit === undefined ? 64 : p.limit;
        if (
            !integer(p.after_seq) ||
            p.after_seq >= sequence ||
            !integer(limit) ||
            limit < 1 ||
            limit > 64
        )
            return fail("invalid_request");
        var session = metadata();
        if (!session) return fail("not_found");
        var selected: any[] = [],
            cursor = p.after_seq,
            more = false;
        var first = session.first_seq;
        function page(items: any[], next: number, remaining: boolean): any {
            return {
                data: {
                    events: items,
                    lost_before: Math.max(0, first - p.after_seq - 1),
                    more: remaining,
                    next_after_seq: next,
                    op: op,
                    runtime: p.runtime,
                    session: session,
                    version: 1,
                },
                status: "ok",
            };
        }
        for (var i = 0; i < events.length; i++) {
            if (events[i].seq <= p.after_seq) continue;
            var candidate = selected.concat([events[i]]);
            if (
                candidate.length > limit ||
                JSON.stringify(page(candidate, events[i].seq, true).data)
                    .length > 61440
            ) {
                more = true;
                break;
            }
            selected = candidate;
            cursor = events[i].seq;
        }
        if (!more) cursor = session.next_seq - 1;
        return page(selected, cursor, more);
    }
    var api = {
        metrics: function () {
            return admitted() ? Object.assign({}, loopMetrics) : null;
        },
        request: request,
        retire: function (reason: string) {
            stop(reason);
            if (reason === "disconnected" || reason === "runtime_changed")
                discard();
        },
    };
    w.__ottPerfCapture = api;
    return api;
}
(window as any).__ottPerfCaptureFactory = { create: createPerformanceCapture };
