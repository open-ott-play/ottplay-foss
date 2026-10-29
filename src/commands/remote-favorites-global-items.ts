import { ensureGlobalFavorites } from "./remote-favorites-global";
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
    var cancel = ensureGlobalFavorites(
        w,
        runtime,
        request.expires_at,
        function (error) {
            var host = w.__ottGlobalFavorites,
                ports = w.__ottGlobalFavoritesPorts;
            if (finished) return;
            if (error || !host || !host.createItems) {
                reply({
                    version: 1,
                    runtime: runtime,
                    op: request.params && request.params.op,
                    subject: "global",
                    error: "unsupported",
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
                        version: 1,
                        runtime: runtime,
                        op: request.params && request.params.op,
                        subject: "global",
                        error: "storage_unavailable",
                    });
                });
        }
    );
    return function () {
        if (cancel) cancel();
        if (items) items.cancel();
        reply({
            version: 1,
            runtime: runtime,
            op: request.params && request.params.op,
            subject: "global",
            error: "cancelled",
        });
    };
}
