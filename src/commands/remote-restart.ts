function remoteSettingsLocked(w: any): boolean {
    return w.__ottParental
        ? w.__ottParental.needs("providers") ||
              w.__ottParental.needs("settings")
        : !!(
              (w.sPSprovs || w.sPSoptions) &&
              w.parentPIN !== "*" &&
              !w.parentAccess
          );
}
function remoteCheckpoint(w: any): void {
    var playback = w.__ottClassicPlayback;
    if (!playback || !playback.snapshot || !playback.checkpoint) return;
    if (
        w.__ottCoreTransport &&
        w.stbPlay === w.__ottCoreTransport.play &&
        typeof w.__ottCoreBackend === "function"
    ) {
        var backend = w.__ottCoreBackend();
        var handle = backend && backend.current();
        if (handle && handle.active()) handle.sample();
    }
    playback.checkpoint(playback.snapshot(), true);
}

/** Restart the owned decoder, or acknowledge a page reload before dispatching it. */
export function executeRemoteRestart(
    w: any,
    params: any,
    done: (result: any) => void,
    afterReply?: (effect: () => void) => void
): void {
    function fail(status: string, message: string): void {
        done({ data: { error: message }, status: status });
    }
    if (
        !params ||
        typeof params !== "object" ||
        Array.isArray(params) ||
        Object.keys(params).some(function (key) {
            return key !== "target";
        }) ||
        (params.target !== undefined &&
            params.target !== "stream" &&
            params.target !== "player")
    ) {
        fail("rejected", "Use restart target stream or player.");
        return;
    }
    function locked(): boolean {
        return remoteSettingsLocked(w);
    }
    var target = params.target || "stream";
    var managed =
        w.__ottCoreTransport && w.stbPlay === w.__ottCoreTransport.play;
    if (target === "stream") {
        if (!managed || typeof w.__ottCoreBackend !== "function") {
            fail(
                "unsupported",
                "Stream restart is unavailable on this player."
            );
            return;
        }
        var backend = w.__ottCoreBackend();
        var result = backend && backend.restart && backend.restart();
        if (!result) {
            fail("unsupported", "There is no owned, restartable stream.");
            return;
        }
        done({ data: result, status: "ok" });
        return;
    }
    if (locked()) {
        fail(
            "rejected",
            "Unlock player settings before restarting the player."
        );
        return;
    }
    if (!afterReply || typeof w.restart !== "function") {
        fail(
            "unsupported",
            "Player restart requires acknowledged command delivery."
        );
        return;
    }
    var restart = w.restart;
    afterReply(function () {
        // Settings can change while the response is awaiting its server ACK.
        if (locked() || w.restart !== restart) return;
        remoteCheckpoint(w);
        if (!locked() && w.restart === restart) restart.call(w);
    });
    done({
        data: {
            accepted: true,
            dispatched: false,
            effect: "reload-after-ack",
            target: "player",
        },
        status: "ok",
    });
}

// Public page identity: useful for observing a reload, never an authorization token.
var remoteRuntime =
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
export function remotePlayerInfo(w: any): any {
    var platform = w.__ottRemoteLifecycle && w.__ottRemoteLifecycle.platform;
    return {
        platform:
            typeof platform === "string" && /^[a-z0-9_-]{1,32}$/.test(platform)
                ? platform
                : "browser",
        runtime: remoteRuntime,
        version: "__OTTP_VERSION__",
    };
}

var remoteKeys: { [key: string]: string[] } = {
    aspect: ["ASPECT", "aspect"],
    audio: ["AUDIO", "audio"],
    back: ["RETURN", "back"],
    channel_down: ["CH_DOWN", "channel-down"],
    channel_up: ["CH_UP", "channel-up"],
    channels: ["CH_LIST", "channels"],
    down: ["DOWN", "down"],
    fullscreen: ["SUBTITLE", "subtitle"],
    guide: ["EPG", "guide"],
    info: ["INFO", "info"],
    left: ["LEFT", "left"],
    menu: ["MENU", "menu"],
    mute: ["MUTE", "mute"],
    ok: ["ENTER", "accept"],
    pip: ["PIP", "picture-in-picture"],
    play_pause: ["PLAY", "play"],
    right: ["RIGHT", "right"],
    settings: ["SETUP", "settings"],
    up: ["UP", "up"],
    volume_down: ["VOL_DOWN", "volume-down"],
    volume_up: ["VOL_UP", "volume-up"],
    zoom: ["ZOOM", "zoom"],
};
var remoteLifecycleMethods: { [operation: string]: string } = {
    exit_app: "exit",
    reboot_device: "reboot",
    restart_app: "restart",
};
function remoteKiosk(w: any): boolean {
    return !!(w.__ottKiosk && w.__ottKiosk.enabled());
}
function remoteProtectedInput(w: any): boolean {
    // These application-owned surfaces require local input, even after a PIN grant.
    try {
        var port = w.__ottClassicScreenPort;
        var owner = port && port.screens && port.screens.current();
        if (owner && owner.model && owner.model.localOnlyInput) return true;
        var list = port && port.listOwner && port.listOwner();
        if (list && list.model && list.model.localOnlyInput) return true;
        if (
            w.$ &&
            w
                .$("#pin, #remoteDiagnosticsToggle, #remoteDiagnosticsTrust")
                .is(":visible")
        )
            return true;
        return !!(
            w.isListVisible &&
            (w.listArray || []).some(function (row: any) {
                return (
                    row &&
                    (row.editorAction === "parentalEnabled" ||
                        /^(psChannels|psOptions|requirePinForProviderSelection)$/.test(
                            row.settingId
                        ))
                );
            })
        );
    } catch (_) {
        return true;
    }
}
function remoteInputCode(w: any, key: string): number {
    if (
        !Object.prototype.hasOwnProperty.call(remoteKeys, key) ||
        typeof w.keyHandler !== "function" ||
        !w.keys ||
        !w.__ottClassicScreenPort ||
        typeof w.__ottClassicScreenPort.normalize !== "function"
    )
        return 0;
    var pair = remoteKeys[key];
    var code = w.keys[pair[0]];
    if (typeof code !== "number" || !isFinite(code) || code <= 0) return 0;
    var mapped =
        w.__ottDevice && w.__ottDevice.eventToKeyCode
            ? w.__ottDevice.eventToKeyCode({ keyCode: code, which: code })
            : code;
    // Hardware key aliases can collide (for example AUDIO and STOP on a PC).
    if (w.__ottClassicScreenPort.normalize(mapped).id !== pair[1]) return 0;
    if (key === "fullscreen" && w.__ottClassicScreenPort.screens.current())
        return 0;
    return code;
}
function remoteInputAllowed(w: any, key: string): boolean {
    if (remoteProtectedInput(w)) return false;
    return (
        (!remoteKiosk(w) && !remoteSettingsLocked(w)) ||
        /^(volume_up|volume_down|mute)$/.test(key)
    );
}
function remoteOwnedPlayback(w: any): any {
    if (
        !w.__ottCoreTransport ||
        w.stbPlay !== w.__ottCoreTransport.play ||
        typeof w.__ottCoreBackend !== "function" ||
        !w.__ottClassicPlayback ||
        typeof w.__ottClassicPlayback.snapshot !== "function"
    )
        return null;
    var backend = w.__ottCoreBackend();
    var handle =
        backend && typeof backend.current === "function" && backend.current();
    var state = w.__ottClassicPlayback.snapshot();
    return handle &&
        handle.active() &&
        state &&
        state.target &&
        /^(live|vod|archive)$/.test(state.target.kind) &&
        /^(playing|paused)$/.test(handle.snapshot().phase)
        ? { backend: backend, handle: handle, kind: state.target.kind }
        : null;
}

/** Typed, bounded controls share the command transport's exact-result ACK fence. */
export function executeRemoteControl(
    w: any,
    action: string,
    params: any,
    done: (result: any) => void,
    afterReply?: (effect: () => void) => void
): void {
    function fail(status: string, error: string): void {
        done({ data: { error: error }, status: status });
    }
    function reply(data: any): void {
        done({ data: data, status: "ok" });
    }
    var fields =
        action === "lifecycle"
            ? ["operation"]
            : action === "input"
              ? ["key"]
              : action === "playback"
                ? ["operation", "position"]
                : [];
    if (
        !params ||
        typeof params !== "object" ||
        Array.isArray(params) ||
        Object.keys(params).some(function (key) {
            return fields.indexOf(key) < 0;
        })
    ) {
        fail("rejected", "Invalid control parameters.");
        return;
    }
    var hooks = w.__ottRemoteLifecycle;
    var owned = remoteOwnedPlayback(w);
    function lifecycleAvailable(operation: string): boolean {
        if (operation === "restart_stream")
            return !!(owned && typeof owned.backend.restart === "function");
        if (remoteSettingsLocked(w)) return false;
        if (operation === "reload_player")
            return typeof w.restart === "function";
        if (remoteKiosk(w)) return false;
        if (operation === "standby" || operation === "wake")
            return (
                typeof w.stbToggleStandby === "function" &&
                typeof w.stbIsStandby === "function"
            );
        return !!(
            hooks &&
            Object.prototype.hasOwnProperty.call(
                remoteLifecycleMethods,
                operation
            ) &&
            typeof hooks[remoteLifecycleMethods[operation]] === "function"
        );
    }
    var playback =
        owned && owned.kind !== "live" && !remoteKiosk(w)
            ? ["pause", "resume"].concat(owned.kind === "vod" ? ["seek"] : [])
            : [];
    if (action === "capabilities") {
        reply({
            input: Object.keys(remoteKeys).filter(function (key) {
                return remoteInputAllowed(w, key) && !!remoteInputCode(w, key);
            }),
            lifecycle: [
                "restart_stream",
                "reload_player",
                "restart_app",
                "standby",
                "wake",
                "exit_app",
                "reboot_device",
            ].filter(lifecycleAvailable),
            playback: playback,
            player: remotePlayerInfo(w),
            version: 1,
        });
        return;
    }
    if (action === "playback") {
        var operation = params.operation;
        if (
            ["pause", "resume", "seek"].indexOf(operation) < 0 ||
            (operation === "seek"
                ? typeof params.position !== "number" ||
                  !isFinite(params.position) ||
                  params.position < 0
                : params.position !== undefined)
        ) {
            fail(
                "rejected",
                "Use pause, resume or seek with a nonnegative position."
            );
            return;
        }
        if (!owned || playback.indexOf(operation) < 0) {
            fail(
                "unsupported",
                "Playback control requires a compatible owned stream."
            );
            return;
        }
        if (operation === "seek") owned.handle.seek(params.position);
        else owned.handle[operation]();
        var result: any = { dispatched: true, operation: operation };
        if (operation === "seek") result.position = params.position;
        reply(result);
        return;
    }
    if (action === "input") {
        var key = params.key;
        if (
            typeof key !== "string" ||
            !Object.prototype.hasOwnProperty.call(remoteKeys, key)
        ) {
            fail("rejected", "Use a named input key.");
            return;
        }
        if (!remoteInputAllowed(w, key)) {
            fail("rejected", "This surface requires local input.");
            return;
        }
        var code = remoteInputCode(w, key);
        if (!afterReply || !code) {
            fail(
                "unsupported",
                "This key requires supported acknowledged input."
            );
            return;
        }
        var handler = w.keyHandler;
        var port = w.__ottClassicScreenPort;
        var revision =
            typeof port.revision === "function" ? port.revision() : 0;
        afterReply(function () {
            if (
                w.keyHandler !== handler ||
                w.__ottClassicScreenPort !== port ||
                (port.revision && port.revision() !== revision) ||
                !remoteInputAllowed(w, key) ||
                remoteInputCode(w, key) !== code
            )
                return;
            // UI keys may reach legacy lifecycle sinks; only explicit typed
            // lifecycle operations may invoke those platform effects remotely.
            var previous = w.__ottRemoteInputActive;
            w.__ottRemoteInputActive = true;
            try {
                handler({
                    keyCode: code,
                    preventDefault: function () {},
                    stopPropagation: function () {},
                    which: code,
                });
            } finally {
                w.__ottRemoteInputActive = previous;
            }
        });
        reply({
            accepted: true,
            dispatched: false,
            effect: "input-after-ack",
            key: key,
        });
        return;
    }
    var operation = params.operation;
    if (
        [
            "restart_stream",
            "reload_player",
            "restart_app",
            "standby",
            "wake",
            "exit_app",
            "reboot_device",
        ].indexOf(operation) < 0
    ) {
        fail("rejected", "Use a named lifecycle operation.");
        return;
    }
    if (operation === "restart_stream" || operation === "reload_player") {
        executeRemoteRestart(
            w,
            { target: operation === "restart_stream" ? "stream" : "player" },
            function (result) {
                if (result.status === "ok" && operation === "reload_player")
                    result.data = {
                        accepted: true,
                        dispatched: false,
                        effect: "lifecycle-after-ack",
                        operation: operation,
                    };
                else if (result.status === "ok")
                    result.data = {
                        accepted: true,
                        dispatched: true,
                        operation: operation,
                    };
                done(result);
            },
            afterReply
        );
        return;
    }
    if (remoteSettingsLocked(w) || remoteKiosk(w)) {
        fail(
            "rejected",
            "Unlock player settings and kiosk before this operation."
        );
        return;
    }
    if (!afterReply || !lifecycleAvailable(operation)) {
        fail("unsupported", "This lifecycle operation is unavailable.");
        return;
    }
    var standby = operation === "standby" || operation === "wake";
    var method = remoteLifecycleMethods[operation];
    var effect = standby ? w.stbToggleStandby : hooks[method];
    var readStandby = w.stbIsStandby;
    afterReply(function () {
        if (remoteSettingsLocked(w) || remoteKiosk(w)) return;
        if (standby) {
            if (
                w.stbToggleStandby === effect &&
                w.stbIsStandby === readStandby &&
                !!readStandby() !== (operation === "standby")
            )
                effect.call(w);
        } else if (
            w.__ottRemoteLifecycle === hooks &&
            hooks[method] === effect
        ) {
            remoteCheckpoint(w);
            if (
                !remoteSettingsLocked(w) &&
                !remoteKiosk(w) &&
                w.__ottRemoteLifecycle === hooks &&
                hooks[method] === effect
            )
                effect.call(hooks);
        }
    });
    reply({
        accepted: true,
        dispatched: false,
        effect: "lifecycle-after-ack",
        operation: operation,
    });
}
