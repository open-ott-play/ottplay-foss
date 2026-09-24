/**
 * Host controller for the common playback model. The injected ports own clocks,
 * timers and effects. This private module has no access to classic player state.
 */
interface PlaybackVisit {
    archiveStart?: number;
    channelId: string;
    kind: "live" | "archive" | "vod";
    payload?: any;
    sourceId: string;
}

interface PlaybackObservation {
    archiveAvailable: boolean;
    archiveEarliest?: number;
    duration?: number;
    /** The host validates source resources even when a replacement reuses IDs. */
    isCurrent?(): boolean;
    now: number;
    position?: number;
    target: PlaybackVisit | null;
}

interface PlaybackIntent {
    intent: "offset" | "absolute" | "begin" | "restart" | "go-live";
    value?: number;
}

interface PlaybackSessionPorts {
    apply(plan: any, intent: PlaybackIntent): void;
    observe(): PlaybackObservation;
    preview(intent: PlaybackIntent): void;
    schedule(callback: () => void, delay: number): any;
    unschedule(handle: any): void;
}

function createPlaybackSessionController(
    core: any,
    ports: PlaybackSessionPorts
) {
    var ownership = new core.PlaybackSessionOwnership();
    var pending: PlaybackIntent | null = null;
    var timer: any = null;

    function sameTarget(
        a: PlaybackVisit | null,
        b: PlaybackVisit | null
    ): boolean {
        // Restoration may start before a channel exists. The ownership ticket
        // and host context still bind guards; request() rejects absent targets.
        if (a === null && b === null) return true;
        return (
            !!a &&
            !!b &&
            a.sourceId === b.sourceId &&
            a.channelId === b.channelId &&
            a.kind === b.kind &&
            a.archiveStart === b.archiveStart
        );
    }

    function cancel(): void {
        ownership.cancel();
        if (timer !== null) ports.unschedule(timer);
        timer = null;
        pending = null;
    }

    var origin: PlaybackVisit | null = null;
    var originCurrent: (() => boolean) | undefined;
    function request(intent: PlaybackIntent): void {
        var observation = ports.observe();
        if (!observation.target) {
            cancel();
            return;
        }
        if (intent.intent === "offset" && !isFinite(intent.value as number))
            return;
        if (
            pending &&
            intent.intent === "offset" &&
            pending.intent === "offset" &&
            sameTarget(origin, observation.target) &&
            (!originCurrent || originCurrent())
        ) {
            intent = {
                intent: "offset",
                value: (pending.value || 0) + (intent.value || 0),
            };
        }
        cancel();
        pending = intent;
        origin = observation.target;
        originCurrent = observation.isCurrent;
        var ticket = ownership.begin();
        var expected = origin;
        var isCurrent = originCurrent;
        function flush(): void {
            if (!ownership.accepts(ticket)) return;
            var current = ports.observe();
            cancel();
            if (
                !sameTarget(expected, current.target) ||
                (isCurrent && !isCurrent())
            )
                return;
            var plan = core.playbackSeekPlan(current.target, {
                archiveAvailable: current.archiveAvailable,
                archiveEarliest: current.archiveEarliest,
                duration: current.duration,
                intent: intent.intent,
                now: current.now,
                position: current.position,
                value: intent.value,
            });
            if (plan.action !== "noop") ports.apply(plan, intent);
        }
        if (intent.intent === "offset") {
            ports.preview(intent);
            timer = ports.schedule(flush, 500);
        } else flush();
    }

    return {
        cancel: cancel,
        dispose: cancel,
        guard: function (
            callback: (...args: any[]) => void
        ): (...args: any[]) => void {
            cancel();
            var observed = ports.observe();
            var expected = observed.target;
            var ticket = ownership.begin();
            return function (this: any): void {
                if (
                    !ownership.accepts(ticket) ||
                    !sameTarget(expected, ports.observe().target) ||
                    (observed.isCurrent && !observed.isCurrent())
                )
                    return;
                cancel();
                callback.apply(this, arguments);
            };
        },
        request: request,
        transition: function (
            current: PlaybackVisit | null,
            target: PlaybackVisit | null,
            history: PlaybackVisit[],
            position: number | undefined,
            limit: number,
            historyKinds?: string[]
        ): any {
            cancel();
            return core.playbackSessionTransition(
                current,
                target,
                history,
                position,
                limit,
                historyKinds
            );
        },
    };
}

interface PlaybackStateSnapshot {
    duration?: number;
    generation: number;
    historyTarget: PlaybackVisit | null;
    phase: "idle" | "loading" | "playing" | "paused" | "stopped";
    position: number;
    target: PlaybackVisit | null;
}

/** Owned session state. Host codecs may adopt old state at an explicit boundary;
 * normal playback commands never interpret legacy mode numbers or list positions.
 */
function createPlaybackState(changed: (state: PlaybackStateSnapshot) => void) {
    var state: PlaybackStateSnapshot = {
        generation: 0,
        historyTarget: null,
        phase: "idle",
        position: 0,
        target: null,
    };
    function visit(value: PlaybackVisit | null): PlaybackVisit | null {
        return value
            ? {
                  archiveStart: value.archiveStart,
                  channelId: value.channelId,
                  kind: value.kind,
                  payload: value.payload,
                  sourceId: value.sourceId,
              }
            : null;
    }
    function snapshot(): PlaybackStateSnapshot {
        return {
            duration: state.duration,
            generation: state.generation,
            historyTarget: visit(state.historyTarget),
            phase: state.phase,
            position: state.position,
            target: visit(state.target),
        };
    }
    function position(value: number, duration?: number, notify = true): void {
        if (
            !state.target ||
            typeof value !== "number" ||
            !isFinite(value) ||
            value < 0
        )
            return;
        var nextDuration =
            typeof duration === "number" && isFinite(duration) && duration >= 0
                ? duration
                : state.duration;
        // Explicit backend reports also checkpoint a value previously sampled by
        // compatibility observation. Durable throttling belongs to the journal.
        state.position = value;
        state.duration = nextDuration;
        if (notify) changed(snapshot());
    }
    function open(
        target: PlaybackVisit | null,
        historyTarget: PlaybackVisit | null = target,
        offset = 0,
        notify = true
    ): void {
        state = {
            generation: state.generation + 1,
            historyTarget: visit(historyTarget),
            phase: target ? "loading" : "idle",
            position: 0,
            target: visit(target),
        };
        position(offset, undefined, false);
        if (notify) changed(snapshot());
    }
    function classify(
        target: PlaybackVisit,
        historyTarget: PlaybackVisit,
        duration?: number
    ): void {
        if (!state.target || state.phase === "stopped") return;
        state.target = visit(target);
        state.historyTarget = visit(historyTarget);
        position(state.position, duration, false);
        changed(snapshot());
    }
    function phase(value: PlaybackStateSnapshot["phase"], notify = true): void {
        if (!state.target || state.phase === value) return;
        // A late native event after Stop cannot revive a session without loading again.
        if (state.phase === "stopped" && value !== "loading") return;
        state.phase = value;
        if (value === "stopped") state.generation++;
        if (notify) changed(snapshot());
    }
    return {
        classify: classify,
        open: open,
        phase: phase,
        position: position,
        snapshot: snapshot,
    };
}

(window as any).__ottPlaybackSession = {
    create: createPlaybackSessionController,
    createState: createPlaybackState,
};
