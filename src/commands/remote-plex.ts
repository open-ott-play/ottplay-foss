/** Keep Plex implementation lazy while capability discovery stays synchronous. */
export function remotePlexQueue(w: any, runtime: string): any {
    if (w.__ottPlexQueue) return w.__ottPlexQueue;
    var controller: any = null;
    var loading: any = null;
    var ids: string[] = [];
    var failure = "";
    var capability = {
        max_items: 100,
        operations: ["play", "preview", "status", "next", "previous", "stop"],
        version: 1,
    };
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
    function execute(request: any, done: (value: any) => void): any {
        var params = request.params || {};
        function reject(error: string): void {
            done({ data: { error: error }, status: "rejected" });
        }
        if (controller) return controller.execute(request, done);
        if (
            params.runtime !== runtime ||
            capability.operations.indexOf(params.op) < 0 ||
            Object.keys(params).some(function (key) {
                return (
                    key !== "op" &&
                    key !== "runtime" &&
                    ((params.op !== "play" && params.op !== "preview") ||
                        key !== "ids")
                );
            })
        ) {
            reject("Plex playback is unavailable on this player.");
            return;
        }
        if (params.op === "status") {
            done({ data: snapshot(), status: "ok" });
            return;
        }
        if (params.op === "stop") {
            if (loading) loading();
            ids = [];
            failure = "";
            done({ data: snapshot(), status: "ok" });
            return;
        }
        if (params.op !== "preview" && w.commandChannelsReady !== true) {
            reject("Plex playback is unavailable on this player.");
            return;
        }
        if (loading) {
            reject("Plex queue request is already in progress.");
            return;
        }
        if (
            !Array.isArray(params.ids) ||
            !params.ids.length ||
            params.ids.length > 100 ||
            params.ids.some(function (id: any) {
                return typeof id !== "string" || !/^[1-9][0-9]{0,19}$/.test(id);
            })
        ) {
            reject("Plex queue is empty.");
            return;
        }
        if (params.op === "play") {
            ids = params.ids.slice();
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
            cancelled = true;
            if (!controller && params.op === "play") {
                if (!failure) failure = "Plex queue request was cancelled.";
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
            if (params.op === "play") failure = error;
            cancel();
            reject(error);
        }
        loading = cancel;
        timer = w.setTimeout(failed, 35000);
        function ready(): void {
            if (cancelled) return;
            if (
                provider !== w.__ottActiveProviderDriver ||
                config !== w.stbGetItem("plexcfg") ||
                (playback && playback.snapshot().generation !== generation) ||
                (typeof request.expires_at === "number" &&
                    Date.now() >= request.expires_at * 1000)
            ) {
                failed();
                return;
            }
            w.clearTimeout(timer);
            loading = null;
            controller = w.__ottPlexQueueFactory.create(w, runtime, failure);
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
        retained: function () {
            return controller
                ? controller.retained()
                : !!loading && !!ids.length;
        },
        snapshot: snapshot,
    };
    w.__ottPlexQueue = api;
    if (w.addEventListener)
        w.addEventListener("pagehide", function () {
            if (loading) loading();
        });
    return api;
}
