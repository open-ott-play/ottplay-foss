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
        return w.__ottParental
            ? w.__ottParental.needs("providers") ||
                  w.__ottParental.needs("settings")
            : !!(
                  (w.sPSprovs || w.sPSoptions) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess
              );
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
        var playback = w.__ottClassicPlayback;
        if (playback && playback.snapshot && playback.checkpoint) {
            if (managed && typeof w.__ottCoreBackend === "function") {
                var backend = w.__ottCoreBackend();
                var handle = backend && backend.current();
                if (handle && handle.active()) handle.sample();
            }
            playback.checkpoint(playback.snapshot(), true);
        }
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
