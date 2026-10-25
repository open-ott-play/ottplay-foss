/** Keep Plex implementation lazy while capability discovery stays synchronous. */
export function remotePlexQueue(w: any, runtime: string): any {
    if (w.__ottPlexQueue) return w.__ottPlexQueue;
    var controller: any = null;
    var loading: any = null;
    var serial = 0;
    var ids: string[] = [];
    var failure = "";
    var unavailable = "Plex playback is unavailable on this player.";
    var cancelledError = "Plex queue request was cancelled.";
    var capability = {
        max_items: 500,
        operations: ["play", "preview", "status", "next", "previous", "stop"],
        version: 1,
    };
    var libraryCapability = {
        max_items: 500,
        operations: ["list", "preview", "play"],
        version: 1,
    };
    function validRequest(
        params: any,
        kind: "library" | "queue" | "ids"
    ): boolean {
        if (kind === "ids")
            return (
                Array.isArray(params) &&
                !!params.length &&
                params.length <= 500 &&
                params.every(function (id: any) {
                    return (
                        typeof id === "string" && /^[1-9][0-9]{0,19}$/.test(id)
                    );
                })
            );
        if (!params || params.runtime !== runtime) return false;
        var op = params.op;
        var playing = op === "play" || op === "preview";
        var keys = Object.keys(params).sort().join(",");
        if (kind !== "library")
            return (
                capability.operations.indexOf(op) >= 0 &&
                (keys === "op,runtime" ||
                    (playing && keys === "ids,op,runtime"))
            );
        if (op === "list") return keys === "op,runtime";
        if (!playing) return false;
        var libraryId = params.library_id;
        var id = typeof libraryId === "string";
        var expected = id ? "library_id,op,runtime" : "op,query,runtime";
        if (params.allow_truncate === true)
            expected = "allow_truncate," + expected;
        if (
            (keys !== expected && keys !== expected + ",shuffle") ||
            (params.shuffle !== undefined &&
                typeof params.shuffle !== "boolean")
        )
            return false;
        if (id)
            return (
                /^[1-9][0-9]{0,19}$/.test(libraryId) && !/\s/.test(libraryId)
            );
        var query = params.query;
        if (
            typeof query !== "string" ||
            !query.trim() ||
            /[\u0000-\u001f\u007f]/.test(query)
        )
            return false;
        try {
            return (
                encodeURIComponent(query).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= 256
            );
        } catch (_) {
            return false;
        }
    }

    function snapshot(): any {
        if (controller) return controller.snapshot();
        var view: any = {
            active: !!ids.length,
            ids: ids.slice(),
            index: ids.length ? 0 : null,
            order: "listed",
            repeat: "none",
            runtime: runtime,
            state: failure ? "error" : ids.length ? "preparing" : "idle",
            version: 1,
        };
        if (failure) view.error = failure;
        return view;
    }
    function stop(): void {
        var stopping = ++serial;
        if (loading) loading();
        if (stopping !== serial) return;
        ids = [];
        failure = "";
        if (controller) controller.stop();
    }
    function execute(request: any, done: (value: any) => void): any {
        var params = request.params || {};
        var op = params.op;
        var library = request.action === "plex_library";
        var readOnly = op === "preview" || (library && op === "list");
        function reject(error: string): void {
            done({
                data: library
                    ? {
                          error: error,
                          op: op,
                          runtime: runtime,
                          state: "error",
                          version: 1,
                      }
                    : { error: error },
                status: "rejected",
            });
        }
        if (!validRequest(params, library ? "library" : "queue")) {
            reject(unavailable);
            return;
        }
        if (controller) return controller.execute(request, done);
        if (op === "status") {
            done({ data: snapshot(), status: "ok" });
            return;
        }
        if (op === "stop") {
            stop();
            done({ data: snapshot(), status: "ok" });
            return;
        }
        if (
            !readOnly &&
            typeof w.stbIsStandby === "function" &&
            w.stbIsStandby()
        ) {
            reject("Wake the player before starting Plex playback.");
            return;
        }
        if (!readOnly && w.commandChannelsReady !== true) {
            reject(unavailable);
            return;
        }
        if (!library && !validRequest(params.ids, "ids")) {
            reject("Plex queue is empty.");
            return;
        }
        if (loading && (readOnly || op !== "play")) {
            reject("Plex queue request is already in progress.");
            return;
        }
        var intent = ++serial;
        if (loading) loading();
        if (intent !== serial) {
            reject(cancelledError);
            return;
        }
        if (op === "play") {
            ids = library ? [] : params.ids.slice();
            failure = "";
        }
        var cancelled = false;
        var cancelInner: any = null;
        var cleanups: Array<() => void> = [];
        var provider = w.__ottActiveProviderDriver;
        var config = w.stbGetItem("plexcfg");
        var playback = w.__ottClassicPlayback;
        var generation = playback && playback.snapshot().generation;
        var timer: any;
        function cancel(): void {
            if (cancelled) return;
            cancelled = true;
            if (!controller && op === "play") {
                if (!failure) failure = cancelledError;
                ids = [];
            }
            if (loading === cancel) loading = null;
            w.clearTimeout(timer);
            cleanups.forEach(function (fn) {
                fn();
            });
            if (cancelInner) cancelInner();
        }
        function failed(): void {
            if (cancelled) return;
            var error = "Plex provider module could not be loaded.";
            if (op === "play") failure = error;
            cancel();
            reject(error);
        }
        loading = cancel;
        timer = w.setTimeout(failed, 35000);
        function ready(): void {
            if (cancelled || intent !== serial) return;
            if (
                provider !== w.__ottActiveProviderDriver ||
                config !== w.stbGetItem("plexcfg") ||
                (!readOnly &&
                    typeof w.stbIsStandby === "function" &&
                    w.stbIsStandby()) ||
                (playback && playback.snapshot().generation !== generation) ||
                (typeof request.expires_at === "number" &&
                    Date.now() >= request.expires_at * 1000)
            ) {
                failed();
                return;
            }
            w.clearTimeout(timer);
            loading = null;
            controller = w.__ottPlexQueueFactory.create(
                w,
                runtime,
                failure,
                validRequest
            );
            cancelInner = controller.execute(request, done);
        }
        try {
            if (w.__ottPlexQueueFactory) ready();
            else
                w.__ottProviderAssets.classic.ensure(
                    "plex",
                    w.host || "",
                    w.__cv || "",
                    {
                        active: function () {
                            return !cancelled;
                        },
                        own: function (fn: () => void) {
                            cleanups.push(fn);
                            return function () {
                                var at = cleanups.indexOf(fn);
                                if (at >= 0) cleanups.splice(at, 1);
                            };
                        },
                    },
                    ready,
                    failed
                );
        } catch (_) {
            failed();
        }
        return cancel;
    }
    var api = {
        capability: capability,
        execute: execute,
        libraryCapability: libraryCapability,
        retained: function () {
            return controller
                ? controller.retained()
                : !!loading && !!ids.length;
        },
        snapshot: snapshot,
        stop: stop,
    };
    w.__ottPlexQueue = api;
    if (w.addEventListener)
        w.addEventListener("pagehide", function () {
            if (loading) loading();
        });
    return api;
}
