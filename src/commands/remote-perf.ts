import { loadRemoteFeature } from "./remote-feature";
import { remotePlayerInfo } from "./remote-restart";

/** Only the bounded loading bridge runs in the startup bundle. */
export function executeRemotePerformance(
    w: any,
    request: any,
    done: (result: any) => void
): () => void {
    var active = true,
        params = request.params || {},
        debug = w.__ottRuntimeDebug;
    var revision = debug && debug.configurationRevision(),
        runtime = remotePlayerInfo(w).runtime;
    function dispatch(error?: string): void {
        if (!active) return;
        active = false;
        if (
            !error &&
            (debug !== w.__ottRuntimeDebug ||
                !debug ||
                revision !== debug.configurationRevision())
        )
            error = "disconnected";
        if (!error && runtime !== remotePlayerInfo(w).runtime)
            error = "runtime_mismatch";
        if (
            !error &&
            typeof request.expires_at === "number" &&
            Date.now() >= request.expires_at * 1000
        )
            error = "expired";
        var result: any;
        try {
            if (!error && w.__ottPerfCaptureFactory)
                result = w.__ottPerfCaptureFactory
                    .create(w, function () {
                        return remotePlayerInfo(w).runtime;
                    })
                    .request(request);
        } catch (_) {
            error = "unsupported";
        }
        if (!result)
            result = {
                data: {
                    error: error || "unsupported",
                    op: params.op,
                    runtime: params.runtime,
                    version: params.version === 2 ? 2 : 1,
                },
                status:
                    error === "unsupported" || !error
                        ? "unsupported"
                        : "rejected",
            };
        done(result);
    }
    if (w.__ottPerfCaptureFactory) dispatch();
    else loadRemoteFeature(w, "perf-capture", dispatch);
    return function () {
        active = false;
    };
}
