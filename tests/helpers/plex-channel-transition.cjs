// Serialized by Playwright. No imports, waits or deferred cleanup in this function.
// Hooks cover only this synchronous four-call interval; asynchronous work and
// console delivery can outlive it. A missing returned mark is not a crash site.
module.exports = function plexChannelTransition(engine) {
    const restores = [];
    const receivers = [];
    const hooks = [
        "player.pause",
        "tech.disposeSourceHandler",
        "tech.clearTracks",
        "tech.reset",
        "media.load",
        "worker.terminate",
        "sourceBuffer.abort",
    ];
    let sequence = 0;
    let observing = true;
    function emit(hook, phase, receiver) {
        try {
            if (!observing || sequence >= 64) return;
            let id = receivers.indexOf(receiver) + 1;
            if (!id && receiver && receivers.length < 16) {
                receivers.push(receiver);
                id = receivers.length;
            }
            sequence++;
            console.log(
                "Plex teardown boundary: " +
                    JSON.stringify(
                        sequence === 64
                            ? {
                                  hook: "diagnostics",
                                  phase: "limit",
                                  receiver: 0,
                                  sequence,
                              }
                            : { hook, phase, receiver: id, sequence }
                    )
            );
        } catch (_) {
            // Diagnostics never replace a method's result or thrown value.
        }
    }
    function hook(target, key, label) {
        try {
            if (!target) throw null;
            const own = Object.getOwnPropertyDescriptor(target, key);
            let descriptor = own;
            let prototype = target;
            // Do not invoke accessors or traverse an unbounded private graph.
            for (let depth = 0; !descriptor && depth < 8; depth++) {
                prototype = Object.getPrototypeOf(prototype);
                if (!prototype) break;
                descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            }
            if (!descriptor || typeof descriptor.value !== "function")
                throw null;
            const original = descriptor.value;
            function wrapped() {
                "use strict";
                emit(label, "entered", this);
                try {
                    const result = Reflect.apply(original, this, arguments);
                    emit(label, "returned", this);
                    return result;
                } catch (error) {
                    emit(label, "threw", this);
                    throw error;
                }
            }
            Object.defineProperty(
                target,
                key,
                own
                    ? { ...own, value: wrapped }
                    : {
                          configurable: true,
                          enumerable: descriptor.enumerable,
                          value: wrapped,
                          writable: true,
                      }
            );
            restores.push({ key, label, own, target, wrapped });
            emit(label, "attached", target);
        } catch (_) {
            emit(label, "unavailable", null);
        }
    }
    function install() {
        // Other engines retain only their existing transition observations.
        if (engine !== "video.js") return;
        let player;
        let tech;
        let media;
        try {
            media = window.video;
            player = window.videojs?.getPlayer("video");
            tech = player?.tech({ IWillNotUseThisInPlugins: true });
            if (
                !media ||
                !tech ||
                tech.el() !== media ||
                window.video !== media
            )
                throw null;
        } catch (_) {
            hooks.forEach((label) => emit(label, "unavailable", null));
            return;
        }
        hook(player, "pause", hooks[0]);
        hook(tech, "disposeSourceHandler", hooks[1]);
        hook(tech, "clearTracks", hooks[2]);
        hook(tech, "reset", hooks[3]);
        hook(media, "load", hooks[4]);
        // Native prototypes avoid depending on VHS private worker/buffer paths.
        // This interval is synchronous and always restored in the same evaluate.
        try {
            hook(window.Worker?.prototype, "terminate", hooks[5]);
        } catch (_) {
            emit(hooks[5], "unavailable", null);
        }
        try {
            hook(window.SourceBuffer?.prototype, "abort", hooks[6]);
        } catch (_) {
            emit(hooks[6], "unavailable", null);
        }
    }
    function restore() {
        for (let i = restores.length - 1; i >= 0; i--) {
            const { target, key, own, wrapped, label } = restores[i];
            try {
                if (
                    Object.getOwnPropertyDescriptor(target, key)?.value !==
                    wrapped
                ) {
                    emit(label, "superseded", target);
                    continue;
                }
                if (own) Object.defineProperty(target, key, own);
                else if (!Reflect.deleteProperty(target, key)) throw null;
                emit(label, "restored", target);
            } catch (_) {
                emit(label, "cleanup-failed", target);
            }
        }
    }

    // Synchronous observations preserve the four calls and their order.
    // An after mark means call return, not completion of asynchronous work.
    // Console delivery may stop on a crash; a missing mark proves nothing.
    function mark(step) {
        try {
            let media = null;
            try {
                const video = window.video;
                const seconds = (value) =>
                    Number.isFinite(value) && Math.abs(value) <= 1e9
                        ? Math.round(value * 1000) / 1000
                        : null;
                const integer = (value, max) =>
                    Number.isInteger(value) && value >= 0 && value <= max
                        ? value
                        : null;
                const boolean = (value) =>
                    typeof value === "boolean" ? value : null;
                if (video) {
                    const ranges = video.buffered;
                    const count = integer(ranges?.length, 100000);
                    media = {
                        bufferedRangeCount: count,
                        currentTime: seconds(video.currentTime),
                        duration: seconds(video.duration),
                        ended: boolean(video.ended),
                        errorCode: integer(video.error?.code, 4),
                        lastBufferEnd:
                            count > 0 ? seconds(ranges.end(count - 1)) : null,
                        networkState: integer(video.networkState, 3),
                        paused: boolean(video.paused),
                        readyState: integer(video.readyState, 4),
                        sourcePresent: !!video.currentSrc,
                    };
                }
            } catch (_) {
                // Even an unavailable media element can leave a step mark.
            }
            console.log(
                "Plex channel transition: " + JSON.stringify({ media, step })
            );
        } catch (_) {
            // Observations must not suppress or replace the next call.
        }
    }
    try {
        try {
            install();
        } catch (_) {
            // An observation failure must still run the original four calls.
            emit("diagnostics", "unavailable", null);
        }
        mark(0);
        window.stbStop();
        mark(1);
        mark(2);
        window.closeList();
        mark(3);
        mark(4);
        window.__ottMedia.useSource(null);
        mark(5);
        mark(6);
        window.__ottMedia.open(null);
        mark(7);
    } finally {
        restore();
        observing = false;
        receivers.length = 0;
        restores.length = 0;
    }
};
