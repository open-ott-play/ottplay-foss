// Playwright init-script helper only. Never imported by the player bundle.
module.exports = function installShakaLifecycleDiagnostics() {
    var w = window;
    var events = [],
        players = [],
        prototypes = [],
        dropped = 0;
    var serial = 0;
    function safe(read) {
        try {
            return read();
        } catch (_) {
            return null;
        }
    }
    function id(player) {
        if (
            !player ||
            (typeof player !== "object" && typeof player !== "function")
        )
            return 0;
        var found = players.indexOf(player);
        if (found >= 0) return found + 1;
        if (players.length === 16) return 0;
        players.push(player);
        return players.length;
    }
    function number(value) {
        return typeof value === "number" && isFinite(value) ? value : null;
    }
    function state(player) {
        var current = safe(function () {
            return w.player;
        });
        return {
            coreMode: number(
                safe(function () {
                    return w._corePlaybackMode;
                })
            ),
            currentPlayerId: id(current),
            forcePlay: safe(function () {
                return typeof w.forcePlay === "boolean" ? w.forcePlay : null;
            }),
            isCurrentPlayer: !!player && current === player,
            nativeAttempt: number(
                safe(function () {
                    return w._coreNativeAttempt;
                })
            ),
            playerId: id(player),
            playerMode: number(
                safe(function () {
                    return w.playerMode;
                })
            ),
            session: number(
                safe(function () {
                    return w._playSession;
                })
            ),
            teardownPending: safe(function () {
                return typeof w._coreShakaTeardown === "undefined"
                    ? null
                    : !!w._coreShakaTeardown;
            }),
        };
    }
    function record(kind, player, error) {
        try {
            var row = state(player);
            row.sequence = ++serial;
            row.kind = kind;
            row.at = safe(function () {
                return w.performance.now();
            });
            if (error) {
                row.errorCode = number(
                    safe(function () {
                        return error.code;
                    })
                );
                row.errorCategory = number(
                    safe(function () {
                        return error.category;
                    })
                );
            }
            if (events.length === 64) {
                events.shift();
                dropped++;
            }
            events.push(row);
        } catch (_) {}
    }
    function instrument() {
        try {
            var Player = w.shaka && w.shaka.Player;
            var proto = Player && Player.prototype;
            if (
                !proto ||
                prototypes.indexOf(proto) >= 0 ||
                prototypes.length === 4
            )
                return;
            prototypes.push(proto);
            ["attach", "load", "destroy"].forEach(function (name) {
                var original = proto[name];
                if (typeof original !== "function") return;
                proto[name] = function () {
                    var player = this,
                        returned;
                    record(name + ":start", player);
                    try {
                        returned = original.apply(player, arguments);
                    } catch (error) {
                        record(name + ":throw", player, error);
                        throw error;
                    }
                    // Observe without replacing the caller's value/promise or rejection.
                    try {
                        if (returned && typeof returned.then === "function")
                            returned.then(
                                function () {
                                    record(name + ":resolved", player);
                                },
                                function (error) {
                                    record(name + ":rejected", player, error);
                                }
                            );
                        else record(name + ":returned", player);
                    } catch (_) {}
                    return returned;
                };
            });
        } catch (_) {}
    }
    function wrapLoader(original) {
        if (typeof original !== "function") return original;
        return function (engine, callback) {
            var args = Array.prototype.slice.call(arguments);
            if (engine === "shaka" && typeof callback === "function") {
                record("loader:start");
                args[1] = function (ready) {
                    record(ready ? "loader:ready" : "loader:unavailable");
                    instrument();
                    return callback.apply(this, arguments);
                };
            }
            try {
                return original.apply(this, args);
            } catch (error) {
                record("loader:throw", null, error);
                throw error;
            }
        };
    }
    var loader = w.__ottLoadMediaEngine,
        wrapped = wrapLoader(loader);
    try {
        Object.defineProperty(w, "__ottLoadMediaEngine", {
            configurable: true,
            enumerable: true,
            get: function () {
                return wrapped;
            },
            set: function (value) {
                loader = value;
                wrapped = wrapLoader(value);
            },
        });
    } catch (_) {}
    instrument();
    w.__aspectShakaLifecycle = {
        snapshot: function () {
            var player = safe(function () {
                return w.player;
            });
            var value = state(player);
            value.playerPresent = !!player;
            value.loaderPresent = typeof loader === "function";
            value.shakaAvailable = safe(function () {
                return !!(w.shaka && w.shaka.Player);
            });
            value.attachedToVideo = safe(function () {
                return !!player && typeof player.getMediaElement === "function"
                    ? player.getMediaElement() === w.video
                    : null;
            });
            value.loadMode = number(
                safe(function () {
                    return player && typeof player.getLoadMode === "function"
                        ? player.getLoadMode()
                        : null;
                })
            );
            value.buffering = safe(function () {
                return player && typeof player.isBuffering === "function"
                    ? !!player.isBuffering()
                    : null;
            });
            value.dropped = dropped;
            value.events = events.slice();
            return value;
        },
    };
};
