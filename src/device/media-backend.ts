/** A decoder lease belongs to one request; observers never own transport methods. */
interface MediaBackendContext {
    active?(): boolean;
    generation: number;
    kind: string;
    position: number;
    sourceActive?(): boolean;
}
interface MediaBackendRequest {
    context?: MediaBackendContext;
    lane?: string;
    position?: number;
    url: string;
}
interface MediaBackendSample {
    duration: number;
    paused: boolean;
    position: number;
    ready: number;
}
interface MediaEngineLease {
    dispose(replaced?: boolean): void;
    pause(): void;
    resume(): void;
    sample(): MediaBackendSample;
    seek(position: number): void;
    selectTrack?(kind: string, index: number): void;
    tracks?(kind: string): any;
}
interface MediaBackendPorts {
    clearInterval(timer: any): void;
    context(): MediaBackendContext | null;
    emit(
        context: MediaBackendContext,
        type: string,
        position?: number,
        duration?: number
    ): void;
    open(
        request: MediaBackendRequest,
        event: (type: string) => void
    ): MediaEngineLease;
    setInterval(callback: () => void, delay: number): any;
}
function createMediaBackend(ports: MediaBackendPorts) {
    var sequence = 0;
    var lanes: { [lane: string]: any } = {};
    var subscribers: Array<(event: any) => void> = [];
    var seeks: {
        [lane: string]: {
            handle: any;
            run(value: number, rebind: boolean): void;
        };
    } = {};
    function publish(handle: any, type: string) {
        var event = {
            handle: handle,
            id: handle.id,
            lane: handle.lane,
            type: type,
        };
        subscribers.slice().forEach(function (callback) {
            callback(event);
        });
    }
    function open(request: MediaBackendRequest): any {
        var lane = request.lane || "main";
        var previous = lanes[lane];
        var inputContext = request.context || ports.context();
        var context = inputContext
            ? {
                  active: inputContext.active,
                  generation: inputContext.generation,
                  kind: inputContext.kind,
                  position: inputContext.position,
                  sourceActive: inputContext.sourceActive,
              }
            : null;
        var engine: MediaEngineLease | null = null;
        var alive = true;
        var timer: any = null;
        var phase = "loading";
        var desired = context
            ? context.position
            : Number(request.position) || 0;
        var offset: number | null =
            context && context.kind === "archive" ? null : 0;
        var position = desired;
        var duration = NaN;
        var pendingEvents: string[] = [];
        function updateTimer() {
            if (phase !== "playing" && timer !== null) {
                ports.clearInterval(timer);
                timer = null;
            }
            if (
                current() &&
                phase === "playing" &&
                lane === "main" &&
                context &&
                timer === null
            )
                timer = ports.setInterval(function () {
                    observe();
                }, 1000);
        }
        function current() {
            return alive && lanes[lane] === handle;
        }
        function domainCurrent() {
            var now = ports.context();
            return (
                !!context &&
                (!context.active || context.active()) &&
                !!now &&
                now.generation === context.generation
            );
        }
        function command(type: string) {
            if (lane === "main" && context && domainCurrent())
                ports.emit(context, type, position, duration);
        }
        function observe(type?: string) {
            if (!current()) return;
            if (!engine) {
                pendingEvents.push(type || "sample");
                return;
            }
            var latest = ports.context();
            if (context && latest && latest.generation === context.generation)
                if (context.kind !== latest.kind) {
                    context.kind = latest.kind;
                    context.active = latest.active;
                    context.sourceActive = latest.sourceActive;
                }
            var sample = engine.sample();
            if (type === "pause" && phase !== "playing") type = "position";
            if (type === "playing" && !sample.paused && sample.ready >= 2) {
                phase = "playing";
                command("playing");
            } else if (
                type === "pause" &&
                sample.paused &&
                phase === "playing"
            ) {
                phase = "paused";
                command("pause");
            } else if (type === "ended") {
                phase = "stopped";
                command("stop");
            }
            if (
                sample.ready >= 1 &&
                (phase === "playing" || phase === "paused")
            ) {
                if (offset === null) offset = desired - sample.position;
                var measured = sample.position + offset;
                if (isFinite(measured) && measured >= 0) position = measured;
                duration = sample.duration;
                if (!context || context.kind !== "live") command("position");
            }
            updateTimer();
            if (current()) publish(handle, type || "position");
        }
        function seek(value: number, rebind: boolean) {
            if (!current() || !engine || !isFinite(value) || value < 0) return;
            if (
                !handle.active() &&
                (!rebind ||
                    !context ||
                    !context.sourceActive ||
                    !context.sourceActive())
            )
                return;
            var next = ports.context();
            if (
                !handle.active() &&
                (!next || !context || next.kind !== context.kind)
            )
                return;
            if (next)
                context = {
                    active: next.active,
                    generation: next.generation,
                    kind: next.kind,
                    position: next.position,
                    sourceActive: next.sourceActive,
                };
            desired = context ? context.position : value;
            offset =
                context && context.kind === "archive" ? desired - value : 0;
            position = context && context.kind === "archive" ? desired : value;
            engine.seek(value);
            if (!current()) return;
            command("position");
            // An archive seek can rebind the same decoder to a fresh domain generation.
            var sample = engine.sample();
            if (sample.paused) {
                phase = "paused";
                command("pause");
            } else if (sample.ready >= 2) {
                phase = "playing";
                command("playing");
            }
            publish(handle, "seek");
        }
        var handle: any = {
            active: function () {
                return (
                    current() &&
                    (lane !== "main" || !context || domainCurrent())
                );
            },
            dispose: function (replaced?: boolean) {
                if (!alive) return;
                alive = false;
                if (lanes[lane] === handle) {
                    delete lanes[lane];
                    delete seeks[lane];
                }
                if (timer !== null) ports.clearInterval(timer);
                timer = null;
                // The engine lease checks its own generation before releasing a shared decoder.
                if (engine) engine.dispose(replaced);
                phase = "stopped";
                publish(handle, "dispose");
            },
            id: ++sequence,
            lane: lane,
            pause: function () {
                if (!handle.active() || !engine) return;
                phase = "paused";
                updateTimer();
                command("pause");
                if (!current()) return;
                engine.pause();
                if (current()) publish(handle, "pause");
            },
            resume: function () {
                if (!handle.active() || !engine) return;
                engine.resume();
                if (!current()) return;
                phase = engine.sample().paused ? "paused" : "playing";
                updateTimer();
                command(phase === "paused" ? "pause" : "resume");
                publish(handle, phase === "paused" ? "pause" : "resume");
            },
            sample: function () {
                observe();
            },
            seek: function (value: number) {
                seek(value, false);
            },
            selectTrack: function (kind: string, index: number) {
                if (handle.active() && engine && engine.selectTrack)
                    engine.selectTrack(kind, index);
            },
            snapshot: function () {
                return {
                    duration: duration,
                    id: handle.id,
                    lane: lane,
                    phase: phase,
                    position: position,
                };
            },
            tracks: function (kind: string) {
                return handle.active() && engine && engine.tracks
                    ? engine.tracks(kind)
                    : null;
            },
        };
        lanes[lane] = handle;
        seeks[lane] = { handle: handle, run: seek };
        if (previous) previous.dispose(true);
        if (!current()) return handle;
        command("loading");
        if (!current()) return handle;
        var opened: MediaEngineLease;
        try {
            opened = ports.open(request, observe);
        } catch (error) {
            if (current()) command("stop");
            handle.dispose();
            throw error;
        }
        if (!current()) {
            opened.dispose();
            return handle;
        }
        engine = opened;
        publish(handle, "open");
        if (!current()) return handle;
        pendingEvents.forEach(observe);
        pendingEvents = [];
        if (!current()) return handle;
        updateTimer();
        return handle;
    }
    return {
        current: function (lane?: string) {
            return lanes[lane || "main"] || null;
        },
        dispose: function () {
            var retired = lanes;
            lanes = {};
            Object.keys(retired).forEach(function (lane) {
                retired[lane].dispose();
            });
        },
        open: open,
        seek: function (value: number) {
            var operation = seeks.main;
            if (operation && operation.handle === lanes.main)
                operation.run(value, true);
        },
        stop: function (lane?: string) {
            var handle = lanes[lane || "main"];
            var context = ports.context();
            if ((!lane || lane === "main") && context)
                ports.emit(context, "stop");
            if (handle) handle.dispose();
        },
        subscribe: function (callback: (event: any) => void) {
            subscribers.push(callback);
            return function () {
                var index = subscribers.indexOf(callback);
                if (index >= 0) subscribers.splice(index, 1);
            };
        },
    };
}
(window as any).__ottMediaBackend = { create: createMediaBackend };
