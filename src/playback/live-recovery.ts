/** Bounded live-only watchdog. Decoder replacement does not renew its budget. */
interface LiveRecoverySample {
    activity: string;
    blocked: boolean;
    handleId: number;
    key: string;
    position: number;
    ready: boolean;
    recovering: boolean;
    terminal: boolean;
}
interface LiveRecoveryStatus {
    attempt: number;
    limit: number;
    phase: "hidden" | "countdown" | "restarting" | "exhausted";
    remaining: number;
}
interface LiveRecoveryPorts {
    clearInterval(timer: any): void;
    now(): number;
    report?(status: LiveRecoveryStatus): void;
    restart(): any;
    sample(): LiveRecoverySample | null;
    setInterval(callback: () => void, delay: number): any;
    settings(): { attempts: number; timeout: number };
}
function createLiveRecovery(ports: LiveRecoveryPorts) {
    var timer: any = null;
    var key = "";
    var handleId = 0;
    var position: number | null = null;
    var lastProgress = 0;
    var healthySince: number | null = null;
    var attempts = 0;
    var armed = false;
    var activity = "";
    var lastTick = 0;
    var restarting = false;
    var observedHandle = 0;
    var observedPosition: number | null = null;
    var status: LiveRecoveryStatus = {
        attempt: 0,
        limit: 0,
        phase: "hidden",
        remaining: 0,
    };
    // Presentation must never interrupt recovery, even if the UI is unavailable.
    function report(phase: LiveRecoveryStatus["phase"], remaining = 0): void {
        status = {
            attempt: attempts,
            limit: limits().attempts,
            phase: phase,
            remaining: remaining,
        };
        try {
            if (ports.report) ports.report(status);
        } catch (_) {}
    }
    // Event-driven hiding only: no deadline, counter or recovery decision is changed.
    function refresh(): void {
        if (!limits().attempts) {
            report("hidden");
            return;
        }
        var sample = ports.sample();
        var progress = !!(
            sample &&
            sample.ready &&
            sample.handleId === observedHandle &&
            observedPosition !== null &&
            sample.position - observedPosition > 0.05
        );
        observedHandle = sample ? sample.handleId : 0;
        observedPosition = sample ? sample.position : null;
        if (
            !sample ||
            sample.key !== key ||
            sample.blocked ||
            sample.terminal ||
            (sample.recovering && !restarting) ||
            progress ||
            (sample.ready &&
                position !== null &&
                sample.position - position > 0.05)
        ) {
            restarting = false;
            report(
                sample &&
                    sample.key === key &&
                    !sample.blocked &&
                    sample.terminal &&
                    armed &&
                    attempts >= limits().attempts &&
                    !progress
                    ? "exhausted"
                    : "hidden"
            );
        }
    }
    function reset(): void {
        key = "";
        position = null;
        healthySince = null;
        attempts = 0;
        armed = false;
        restarting = false;
        report("hidden");
    }
    function limits(): { attempts: number; timeout: number } {
        var value = ports.settings();
        return (window as any).OttPlayCore.classicLiveStallLimits(
            value.attempts,
            value.timeout
        );
    }
    function tick(): void {
        var limit = limits();
        if (!limit.attempts) {
            configure();
            return;
        }
        var sample = ports.sample();
        if (!sample) {
            reset();
            return;
        }
        var time = ports.now();
        if (key !== sample.key) {
            reset();
            key = sample.key;
            lastProgress = time;
        }
        if (
            (window as any).OttPlayCore.classicLiveStallResetWindow(
                time,
                lastTick,
                lastProgress,
                handleId !== sample.handleId,
                activity !== sample.activity
            )
        ) {
            lastProgress = time;
            position = null;
            healthySince = null;
        }
        lastTick = time;
        handleId = sample.handleId;
        activity = sample.activity;
        if (sample.blocked || sample.recovering || sample.terminal) {
            lastProgress = time;
            position = null;
            healthySince = null;
            if (sample.blocked || sample.terminal || !restarting) {
                restarting = false;
                report(
                    (window as any).OttPlayCore.classicLiveStallBlockedPhase(
                        sample.terminal,
                        sample.blocked,
                        armed,
                        attempts,
                        limit.attempts,
                        restarting
                    )
                );
            } else report("restarting");
            return;
        }
        var valid = (window as any).OttPlayCore.classicLiveStallValidPosition(
            sample.position
        );
        var progress = (window as any).OttPlayCore.classicLiveStallProgress(
            sample.position,
            position
        );
        if (progress && sample.ready) {
            armed = true;
            lastProgress = time;
            if (healthySince === null) healthySince = time;
            attempts = (
                window as any
            ).OttPlayCore.classicLiveStallHealthyAttempts(
                attempts,
                healthySince,
                time
            );
        } else {
            healthySince = null;
            // A discontinuity is not evidence of a stall.
            if (valid && position !== null && sample.position < position)
                lastProgress = time;
        }
        position = valid ? sample.position : null;
        var age = time - lastProgress;
        if (progress && sample.ready) restarting = false;
        var plan = (window as any).OttPlayCore.classicLiveStallPlan(
            armed,
            attempts,
            age,
            limit.attempts,
            limit.timeout,
            restarting,
            progress && sample.ready
        );
        report(plan.phase, plan.remaining);
        // Reporting may synchronously reenter the host. Re-evaluate current state.
        if (
            !(window as any).OttPlayCore.classicLiveStallPlan(
                armed,
                attempts,
                time - lastProgress,
                limit.attempts,
                limit.timeout,
                restarting,
                false
            ).restart
        )
            return;
        // Sampling can synchronously dispatch channel/mode changes. Recheck ownership.
        var current = ports.sample();
        if (
            !current ||
            current.key !== key ||
            current.handleId !== handleId ||
            current.blocked ||
            current.recovering ||
            current.terminal ||
            current.activity !== sample.activity ||
            current.position - sample.position > 0.05
        ) {
            report("hidden");
            return;
        }
        attempts++;
        lastProgress = time;
        position = null;
        healthySince = null;
        restarting = true;
        report("restarting");
        try {
            ports.restart();
        } catch (_) {
            // A failed dispatch consumes its attempt too; never turn failure into a loop.
        }
    }
    function configure(): void {
        if (!limits().attempts) {
            if (timer !== null) ports.clearInterval(timer);
            timer = null;
            reset();
        } else if (timer === null) timer = ports.setInterval(tick, 1000);
    }
    return {
        configure: configure,
        dispose: function (): void {
            if (timer !== null) ports.clearInterval(timer);
            timer = null;
            reset();
        },
        refresh: refresh,
        snapshot: function () {
            return {
                armed: armed,
                attempts: attempts,
                status: Object.assign({}, status),
            };
        },
    };
}
(window as any).__ottLiveRecovery = { create: createLiveRecovery };
