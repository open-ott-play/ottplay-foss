/* Dedicated Tauri PiP document. Engine assets are the same bundled files as main. */
(function () {
    "use strict";
    if (window.__ottplayPip) return;

    var instance = Number(window.location.hash.slice(1));
    var current = null;
    var lastSession = 0;
    var lifecycle = 0;
    var libraries = {};
    var booted = false;

    function invoke(command, args) {
        return window.__TAURI__.core.invoke(command, args);
    }

    function status(message) {
        var el = document.getElementById("ottplay-pip-status");
        if (el) {
            el.textContent = message;
            el.hidden = !message;
        }
    }

    function active(state) {
        return current === state && !state.failed;
    }

    function report(state, event) {
        // Do not expose provider URLs, credentials or decoder error objects.
        try {
            invoke("pip_player_event", {
                event: event,
                instance: instance,
                session: state.session,
            }).catch(function () {});
        } catch (_) {}
    }

    function release(state) {
        if (!state) return;
        state.video.onplaying = null;
        state.video.onerror = null;
        if (state.hls) {
            try {
                state.hls.destroy();
            } catch (_) {}
            state.hls = null;
        }
        if (state.shaka) {
            try {
                var destroyed = state.shaka.destroy();
                if (destroyed && destroyed.catch)
                    destroyed.catch(function () {});
            } catch (_) {}
            state.shaka = null;
        }
        try {
            state.video.pause();
            state.video.removeAttribute("src");
            state.video.load();
        } catch (_) {}
    }

    function stop(session) {
        if (typeof session === "number") {
            if (session < lastSession) return;
            lastSession = Math.max(lastSession, session);
        } else lifecycle++;
        var previous = current;
        current = null;
        release(previous);
        status("");
    }

    function fail(state) {
        if (!active(state)) return;
        state.failed = true;
        release(state);
        status("Stream could not be played");
        report(state, "error");
    }

    function playVideo(state) {
        if (!active(state)) return;
        try {
            var playing = state.video.play();
            if (playing && playing.catch) {
                playing.catch(function () {
                    if (active(state)) fail(state);
                });
            }
        } catch (_) {
            fail(state);
        }
    }

    function library(name, path) {
        if (libraries[name]) return libraries[name];
        libraries[name] = new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.src = new URL(path, window.location.href).href;
            script.onload = resolve;
            script.onerror = function () {
                delete libraries[name];
                script.remove();
                reject(new Error("Bundled player unavailable"));
            };
            document.head.appendChild(script);
        });
        return libraries[name];
    }

    function direct(state) {
        if (!active(state)) return;
        state.video.src = state.url;
        playVideo(state);
    }

    function hls(state) {
        function start() {
            if (!active(state)) return;
            if (!window.Hls || !window.Hls.isSupported()) {
                if (state.video.canPlayType("application/vnd.apple.mpegurl"))
                    direct(state);
                else fail(state);
                return;
            }
            try {
                var player = new window.Hls();
                state.hls = player;
                player.on(window.Hls.Events.MANIFEST_PARSED, function () {
                    if (active(state) && state.hls === player) playVideo(state);
                });
                player.on(window.Hls.Events.ERROR, function (_, data) {
                    if (active(state) && data && data.fatal) fail(state);
                });
                player.loadSource(state.url);
                player.attachMedia(state.video);
            } catch (_) {
                fail(state);
            }
        }
        if (window.Hls) start();
        else
            library("hls", "./js/hls.min.js").then(start, function () {
                if (!active(state)) return;
                if (state.video.canPlayType("application/vnd.apple.mpegurl"))
                    direct(state);
                else fail(state);
            });
    }

    function dash(state) {
        function start() {
            if (!active(state)) return;
            try {
                if (window.shaka && window.shaka.polyfill)
                    window.shaka.polyfill.installAll();
                if (
                    !window.shaka ||
                    !window.shaka.Player.isBrowserSupported()
                ) {
                    fail(state);
                    return;
                }
                var player = new window.shaka.Player();
                state.shaka = player;
                player.addEventListener("error", function (event) {
                    if (
                        active(state) &&
                        event.detail &&
                        event.detail.severity === 2
                    )
                        fail(state);
                });
                Promise.resolve(player.attach(state.video)).then(function () {
                    if (active(state) && state.shaka === player)
                        return player.load(state.url);
                }).then(
                    function () {
                        if (active(state) && state.shaka === player)
                            playVideo(state);
                    },
                    function () {
                        if (active(state)) fail(state);
                    }
                );
            } catch (_) {
                fail(state);
            }
        }
        if (window.shaka) start();
        else
            library("shaka", "./js/shaka-player.compiled.js").then(
                start,
                function () {
                    if (active(state)) fail(state);
                }
            );
    }

    function play(request) {
        // A delayed ready response cannot replace a newer Rust command or revive stop.
        if (
            !request ||
            request.instance !== instance ||
            request.session <= lastSession
        )
            return;
        lastSession = request.session;
        stop();
        var previous = document.getElementById("ottplay-pip-video");
        var video = document.createElement("video");
        video.id = "ottplay-pip-video";
        video.autoplay = true;
        video.loop = request.loop === true;
        video.muted = true;
        video.defaultMuted = true;
        video.setAttribute("muted", "");
        video.controls = false;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        if (previous) previous.parentNode.replaceChild(video, previous);
        else document.body.appendChild(video);
        var state = {
            session: request.session,
            url: request.url,
            video: video,
            hls: null,
            shaka: null,
            failed: false,
            started: false,
        };
        current = state;
        status("Loading…");
        video.onplaying = function () {
            if (!active(state) || state.started) return;
            state.started = true;
            status("");
            report(state, "playing");
        };
        video.onerror = function () {
            if (active(state)) fail(state);
        };
        // Explicit native mode is retained. Otherwise DASH/HLS use main's engines.
        if (request.engine === 0) direct(state);
        else if (request.engine === 2 || /\.mpd(?:[?#]|$)/i.test(state.url))
            dash(state);
        else if (request.engine === 1 || /\.m3u8(?:[?#]|$)/i.test(state.url))
            hls(state);
        else direct(state);
    }

    window.__ottplayPip = { play: play, stop: stop };

    function boot() {
        if (booted) return;
        booted = true;
        document.addEventListener("mousedown", function (event) {
            if (event.button !== 0) return;
            event.preventDefault();
            try {
                window.__TAURI__.window
                    .getCurrentWindow()
                    .startDragging()
                    .catch(function () {});
            } catch (_) {}
        });
        window.addEventListener("pagehide", stop);
        try {
            var readyLifecycle = lifecycle;
            invoke("pip_player_event", {
                event: "ready",
                instance: instance,
                session: 0,
            }).then(
                function (request) {
                    if (lifecycle === readyLifecycle) play(request);
                },
                function () {
                    if (lifecycle === readyLifecycle)
                        status("Player could not start");
                }
            );
        } catch (_) {
            status("Player could not start");
        }
    }
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
})();
