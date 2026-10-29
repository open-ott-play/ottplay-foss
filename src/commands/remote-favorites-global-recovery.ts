import { ensureRemoteGlobalFavorites } from "./remote-favorites-global";

const REMOTE_GLOBAL_RECOVERY_ERRORS = [
    "invalid_request",
    "envelope_too_large",
    "runtime_changed",
    "expired",
    "busy",
    "unsupported_persistence",
    "revision_conflict",
    "context_changed",
    "policy_denied",
    "storage_unavailable",
    "limits_exceeded",
    "outcome_unknown",
];
export function globalFavoritesRecoveryCapability(w: any): any {
    return w.__ottGlobalFavoritesRecovery ? { version: 1 } : null;
}
export function executeGlobalFavoritesRecovery(
    w: any,
    runtime: string,
    request: any,
    done: (result: any) => void
): () => void {
    var finished = false;
    function reply(data: any) {
        if (finished) return;
        if (
            data.error &&
            request.params &&
            typeof request.params.runtime === "string"
        )
            data.runtime = request.params.runtime;
        finished = true;
        done({ data: data, status: data.error ? "rejected" : "ok" });
    }
    if (request.params && request.params.runtime !== runtime) {
        reply({
            error: "runtime_changed",
            op: request.params.op,
            runtime: request.params.runtime,
            subject: "global",
            version: 1,
        });
        return function () {};
    }
    var cancel = ensureRemoteGlobalFavorites(
        w,
        runtime,
        request.expires_at,
        function (error) {
            var p = request.params || {};
            function reject(code: string) {
                reply({
                    error: code,
                    op: p.op,
                    runtime: runtime,
                    subject: "global",
                    version: 1,
                });
            }
            if (error || !w.__ottGlobalFavoritesRecovery) {
                reject("unsupported_persistence");
                return;
            }
            try {
                if (w.__ottGlobalFavorites.requestBytes(request) > 16384) {
                    reject("envelope_too_large");
                    return;
                }
            } catch (_) {
                reject("invalid_request");
                return;
            }
            w.__ottGlobalFavoritesRecovery
                .execute(request, function () {
                    return !finished;
                })
                .then(reply, function (error: any) {
                    var code = error && error.message;
                    if (code === "invalid_cursor") code = "invalid_request";
                    if (code === "capacity") code = "limits_exceeded";
                    reject(
                        REMOTE_GLOBAL_RECOVERY_ERRORS.indexOf(code) >= 0
                            ? code
                            : "storage_unavailable"
                    );
                });
        }
    );
    return function () {
        if (cancel) cancel();
        if (!finished)
            reply({
                error: "expired",
                op: request.params && request.params.op,
                runtime: runtime,
                subject: "global",
                version: 1,
            });
    };
}
