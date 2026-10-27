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
        return {
            attempts:
                isFinite(value.attempts) &&
                Math.floor(value.attempts) === value.attempts &&
                value.attempts >= 0 &&
                value.attempts <= 5
                    ? value.attempts
                    : 0,
            timeout:
                [10, 15, 20, 30].indexOf(value.timeout) >= 0
                    ? value.timeout * 1000
                    : 15000,
        };
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
            time - lastTick > 5000 ||
            time < lastProgress ||
            handleId !== sample.handleId ||
            activity !== sample.activity
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
                    sample.terminal &&
                        !sample.blocked &&
                        armed &&
                        attempts >= limit.attempts
                        ? "exhausted"
                        : "hidden"
                );
            } else report("restarting");
            return;
        }
        var valid = isFinite(sample.position) && sample.position >= 0;
        var progress =
            valid && position !== null && sample.position - position > 0.05;
        if (progress && sample.ready) {
            armed = true;
            lastProgress = time;
            if (healthySince === null) healthySince = time;
            if (time - healthySince >= 10000) attempts = 0;
        } else {
            healthySince = null;
            // A discontinuity is not evidence of a stall.
            if (valid && position !== null && sample.position < position)
                lastProgress = time;
        }
        position = valid ? sample.position : null;
        var age = time - lastProgress;
        if (progress && sample.ready) {
            restarting = false;
            report("hidden");
        } else if (!armed) report("hidden");
        else if (attempts >= limit.attempts && age >= limit.timeout)
            report("exhausted");
        else if (restarting) report("restarting");
        else if (age >= 3000 && attempts < limit.attempts)
            report(
                "countdown",
                Math.max(0, Math.ceil((limit.timeout - age) / 1000))
            );
        else report("hidden");
        if (
            !armed ||
            attempts >= limit.attempts ||
            time - lastProgress < limit.timeout
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
