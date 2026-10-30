import {
    isProviderAllowed,
    providerIds,
    selectProviderByIndex,
} from "../provider";
import { captureFavoritesPhysicalStorage } from "../storage/index";
import { loadRemoteFeature } from "./remote-feature";
import { remotePlayerInfo } from "./remote-restart";

function torrentCatalogInstance(w: any): any {
    var runtime = remotePlayerInfo(w).runtime,
        cached = w.__ottRemoteTorrentCatalog;
    if (cached && cached.runtime !== runtime) {
        cached.value.dispose();
        cached = null;
    }
    if (!cached && w.__ottTorrentCatalogRuntime) {
        cached = {
            runtime: runtime,
            value: w.__ottTorrentCatalogRuntime.create(w, {
                runtime: function () {
                    return remotePlayerInfo(w).runtime;
                },
                select: function () {
                    return (
                        isProviderAllowed("torrent") &&
                        selectProviderByIndex(providerIds.indexOf("torrent"))
                    );
                },
                storage: captureFavoritesPhysicalStorage,
            }),
        };
        w.__ottRemoteTorrentCatalog = cached;
    }
    return cached && cached.value;
}
export function executeRemoteTorrentCatalog(
    w: any,
    request: any,
    done: (value: any) => void
): () => void {
    var active = true,
        params = request.params || {},
        runtime = remotePlayerInfo(w).runtime,
        load = w.__ottCommandChannelLoad,
        driver = w.__ottActiveProviderDriver,
        started = Date.now();
    function failure(reason: string): void {
        finish({
            error: "Torrent catalog request failed.",
            op: params.op,
            reason: reason,
            runtime: params.runtime,
            version: 1,
        });
    }
    function finish(data: any): void {
        if (!active) return;
        active = false;
        done({
            data: data,
            status: data.error
                ? data.reason === "unsupported"
                    ? "unsupported"
                    : "rejected"
                : "ok",
        });
    }
    function current(): boolean {
        return (
            active &&
            runtime === remotePlayerInfo(w).runtime &&
            (request.expires_at === undefined ||
                Date.now() < request.expires_at * 1000)
        );
    }
    function dispatch(error?: string): void {
        if (!active) return;
        if (!current()) {
            failure(
                runtime !== remotePlayerInfo(w).runtime
                    ? "runtime_changed"
                    : "expired"
            );
            return;
        }
        if (
            load !== w.__ottCommandChannelLoad ||
            driver !== w.__ottActiveProviderDriver
        ) {
            failure("source_changed");
            return;
        }
        if (error || !w.__ottMediaCompanion?.providerAvailable()) {
            failure("unsupported");
            return;
        }
        var service = torrentCatalogInstance(w);
        if (!service) {
            failure("unsupported");
            return;
        }
        service
            .request(params, {
                current: current,
                deadlineAt:
                    request.expires_at === undefined
                        ? started + 40000
                        : request.expires_at * 1000,
                startedAt: started,
            })
            .then(finish, function () {
                failure("storage_failed");
            });
    }
    function loadFeature(): void {
        if (!current()) {
            if (active) failure("expired");
            return;
        }
        if (w.__ottTorrentCatalogRuntime) dispatch();
        else loadRemoteFeature(w, "provider-torrent", dispatch);
    }
    if (w.__ottMediaCompanion?.nativePending())
        w.__ottMediaCompanion.capabilities().then(loadFeature, function () {
            failure("unsupported");
        });
    else loadFeature();
    return function () {
        active = false;
    };
}
(window as any).__ottTorrentCatalogAccess = function () {
    return torrentCatalogInstance(window);
};
