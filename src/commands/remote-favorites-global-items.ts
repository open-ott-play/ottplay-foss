import { ensureRemoteGlobalFavorites } from "./remote-favorites-global";
export function globalFavoritesItemsCapability(w: any): any {
    if (w.__ottInitializeGlobalFavorites) w.__ottInitializeGlobalFavorites();
    var host = w.__ottGlobalFavorites;
    return host && host.createItems && w.__ottGlobalFavoritesPorts
        ? { version: 1 }
        : null;
}
export function executeGlobalFavoritesItems(
    w: any,
    runtime: string,
    request: any,
    done: (value: any) => void
): () => void {
    var finished = false,
        items: any = null;
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
            var host = w.__ottGlobalFavorites,
                ports = w.__ottGlobalFavoritesPorts;
            if (finished) return;
            if (error || !host || !host.createItems) {
                reply({
                    error: "unsupported",
                    op: request.params && request.params.op,
                    runtime: runtime,
                    subject: "global",
                    version: 1,
                });
                return;
            }
            items = host.createItems();
            var bytes: number;
            try {
                bytes = w.__ottGlobalFavorites.requestBytes(request);
            } catch (_) {
                bytes = 16385;
            }
            items
                .execute(
                    request.params,
                    bytes,
                    request.expires_at,
                    function () {
                        return (
                            !finished &&
                            ports === w.__ottGlobalFavoritesPorts &&
                            ports.runtime() === runtime
                        );
                    }
                )
                .then(reply, function () {
                    reply({
                        error: "storage_unavailable",
                        op: request.params && request.params.op,
                        runtime: runtime,
                        subject: "global",
                        version: 1,
                    });
                });
        }
    );
    return function () {
        if (cancel) cancel();
        if (items) items.cancel();
        reply({
            error: "cancelled",
            op: request.params && request.params.op,
            runtime: runtime,
            subject: "global",
            version: 1,
        });
    };
}
