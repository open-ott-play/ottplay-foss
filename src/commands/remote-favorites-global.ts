import { remoteFavoritesCapability } from "./remote-favorites-contract";
export function ensureRemoteGlobalFavorites(
    w: any,
    runtime: string,
    expiresAt: any,
    done: (error?: string) => void
): () => void {
    var cancelled = false,
        inner: any = null;
    function ready(error?: string) {
        if (cancelled) return;
        if (
            error ||
            !w.__ottGlobalFavoritesFacade ||
            !w.__ottGlobalFavoritesPorts ||
            w.__ottGlobalFavoritesPorts.runtime() !== runtime ||
            (typeof expiresAt === "number" &&
                Date.now() >= Math.floor(expiresAt * 1000))
        )
            done("unsupported");
        else done();
    }
    if (w.__ottGlobalFavoritesFacade) ready();
    else if (typeof w.__ottEnsureGlobalFavorites === "function")
        inner = w.__ottEnsureGlobalFavorites(ready);
    else ready("unsupported");
    return function () {
        cancelled = true;
        if (typeof inner === "function") inner();
    };
}
export function legacyFavoritesCapability(w: any): any {
    var host = w.__ottGlobalFavorites,
        operations: string[] = ["list", "play"];
    if (host && host.committer && host.committer.canWrite())
        operations = remoteFavoritesCapability.operations.slice();
    else if (!w.__ottGlobalFavoritesFacade) {
        try {
            if (
                JSON.parse(
                    w.stbGetPersistedItem("remoteFavorites.v1") || "null"
                )?.version === 2
            )
                operations = [];
        } catch (_) {
            operations = [];
        }
    }
    return {
        max_items: remoteFavoritesCapability.max_items,
        operations: operations,
        version: 1,
    };
}
export function globalFavoritesCapability(w: any): any {
    if (w.__ottInitializeGlobalFavorites) w.__ottInitializeGlobalFavorites();
    return w.__ottGlobalFavoritesProtocol &&
        w.__ottGlobalFavoritesFacade &&
        w.__ottGlobalFavoritesPorts
        ? { version: 1 }
        : null;
}
export function executeGlobalFavorites(
    w: any,
    runtime: string,
    request: any,
    done: (value: any) => void
): () => void {
    var finished = false,
        cancel: any = null;
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
    cancel = ensureRemoteGlobalFavorites(
        w,
        runtime,
        request.expires_at,
        function (error) {
            if (finished) return;
            if (error || !w.__ottGlobalFavoritesProtocol) {
                reply({
                    error: "unsupported",
                    op: request.params && request.params.op,
                    runtime: runtime,
                    subject: "global",
                    version: 1,
                });
                return;
            }
            var bytes: number;
            try {
                bytes = w.__ottGlobalFavorites.requestBytes(request);
            } catch (_) {
                bytes = 16385;
            }
            w.__ottGlobalFavoritesProtocol
                .execute(
                    request.params,
                    bytes,
                    request.expires_at,
                    function () {
                        return (
                            !finished &&
                            w.__ottGlobalFavoritesPorts.runtime() === runtime
                        );
                    }
                )
                .then(reply, function () {
                    reply({
                        error: "storage_unavailable",
                        op: request.params.op,
                        runtime: runtime,
                        subject: "global",
                        version: 1,
                    });
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
// Keep the legacy public error vocabulary stable across the shared-store bridge.
function legacySharedFavoriteError(error: any): string {
    var code = error && error.message;
    var allowed = [
        "invalid_request",
        "unsupported",
        "no_current_item",
        "unsupported_item",
        "profile_unavailable",
        "profile_changed",
        "item_unavailable",
        "ambiguous_favorite",
        "favorite_not_found",
        "too_many_favorites",
        "storage_unavailable",
        "policy_denied",
        "busy",
        "timeout",
        "cancelled",
        "context_changed",
        "playback_failed",
    ];
    return typeof code === "string" && allowed.indexOf(code) >= 0
        ? code
        : "storage_unavailable";
}

export function executeLegacySharedFavorites(
    w: any,
    runtime: string,
    request: any,
    done: (value: any) => void,
    policy: () => boolean
): () => void {
    var facade = w.__ottGlobalFavoritesFacade,
        stopped = false,
        inner: any = null;
    var deadline = Math.min(
        Date.now() + 35000,
        typeof request.expires_at === "number"
            ? Math.floor(request.expires_at * 1000)
            : Infinity
    );
    function current() {
        return (
            !stopped &&
            Date.now() < deadline &&
            facade === w.__ottGlobalFavoritesFacade &&
            w.__ottGlobalFavoritesPorts.runtime() === runtime &&
            facade.current() &&
            (request.params.op === "list" || policy())
        );
    }
    function reply(data?: any, error?: string) {
        if (stopped) return;
        stopped = true;
        done({
            data: Object.assign(
                {
                    op: request.params.op,
                    runtime: runtime,
                    state: error
                        ? "error"
                        : request.params.op === "play"
                          ? "dispatched"
                          : "ready",
                    version: 1,
                },
                error ? { error: error } : data
            ),
            status: error ? "rejected" : "ok",
        });
    }
    Promise.resolve()
        .then(async function () {
            if (!current()) throw new Error("policy_denied");
            var result = await facade.legacy(request.params, current);
            if (result && result.result) {
                inner = result;
                return result.result;
            }
            return result;
        })
        .then(
            function (data) {
                reply(data);
            },
            function (error) {
                reply(undefined, legacySharedFavoriteError(error));
            }
        );
    return function () {
        if (inner && inner.cancel) inner.cancel();
        reply(undefined, "cancelled");
    };
}
