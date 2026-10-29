import { remoteFavoritesCapability } from "./remote-favorites-contract";
export function ensureGlobalFavorites(
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
        version: 1,
        max_items: remoteFavoritesCapability.max_items,
        operations: operations,
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
        done({ status: data.error ? "rejected" : "ok", data: data });
    }
    if (request.params && request.params.runtime !== runtime) {
        reply({
            version: 1,
            runtime: request.params.runtime,
            op: request.params.op,
            subject: "global",
            error: "runtime_changed",
        });
        return function () {};
    }
    cancel = ensureGlobalFavorites(
        w,
        runtime,
        request.expires_at,
        function (error) {
            if (finished) return;
            if (error || !w.__ottGlobalFavoritesProtocol) {
                reply({
                    version: 1,
                    runtime: runtime,
                    op: request.params && request.params.op,
                    subject: "global",
                    error: "unsupported",
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
                        version: 1,
                        runtime: runtime,
                        op: request.params.op,
                        subject: "global",
                        error: "storage_unavailable",
                    });
                });
        }
    );
    return function () {
        if (cancel) cancel();
        if (!finished)
            reply({
                version: 1,
                runtime: runtime,
                op: request.params && request.params.op,
                subject: "global",
                error: "expired",
            });
    };
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
            status: error ? "rejected" : "ok",
            data: Object.assign(
                {
                    version: 1,
                    runtime: runtime,
                    op: request.params.op,
                    state: error
                        ? "error"
                        : request.params.op === "play"
                          ? "dispatched"
                          : "ready",
                },
                error ? { error: error } : data
            ),
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
                reply(
                    undefined,
                    (error && error.message) || "storage_unavailable"
                );
            }
        );
    return function () {
        if (inner && inner.cancel) inner.cancel();
        reply(undefined, "cancelled");
    };
}
