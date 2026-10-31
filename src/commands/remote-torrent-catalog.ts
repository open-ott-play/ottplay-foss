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

/** Private native indexer control; no credentials enter player settings or snapshots. */
export function executeRemoteTorrentIndexer(
    w: any,
    request: any,
    done: (value: any) => void
): () => void {
    var active = true,
        params = request.params || {},
        runtime = remotePlayerInfo(w).runtime;
    var op = params.op,
        writable = op === "configure" || op === "remove" || op === "prepare";
    function finish(data: any, status = "ok"): void {
        if (!active) return;
        active = false;
        done({
            data: Object.assign(
                {
                    op: op,
                    runtime:
                        typeof params.runtime === "string" &&
                        params.runtime.length <= 128
                            ? params.runtime
                            : runtime,
                    version: 1,
                },
                data
            ),
            status: status,
        });
    }
    function failure(reason: string): void {
        finish(
            { error: "Torrent indexer request failed.", reason: reason },
            reason === "unsupported" ? "unsupported" : "rejected"
        );
    }
    function restricted(): boolean {
        return !!(
            writable &&
            (w.__ottStandby?.blocked() ||
                w.__ottKiosk?.enabled() ||
                (w.__ottParental
                    ? w.__ottParental.needs("settings") ||
                      w.__ottParental.needs("providers")
                    : (w.sPSoptions || w.sPSprovs) &&
                      w.parentPIN !== "*" &&
                      !w.parentAccess))
        );
    }
    function current(): boolean {
        return (
            active &&
            runtime === remotePlayerInfo(w).runtime &&
            (request.expires_at === undefined ||
                Date.now() < request.expires_at * 1000)
        );
    }
    function text(value: any, maximum: number, empty = false): boolean {
        if (
            typeof value !== "string" ||
            (!empty && !value) ||
            /[\x00-\x1f\x7f-\x9f]/.test(value)
        )
            return false;
        try {
            return (
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= maximum
            );
        } catch (_) {
            return false;
        }
    }
    function integer(value: any, maximum: number): boolean {
        return (
            typeof value === "number" &&
            isFinite(value) &&
            Math.floor(value) === value &&
            value >= 0 &&
            value <= maximum
        );
    }
    var fields: any = {
        caps: ["sourceId"],
        configure: ["sourceId", "label", "endpoint", "apiKey"],
        list: [],
        prepare: ["sourceId", "resultRef"],
        remove: ["sourceId"],
        search: ["sourceId", "query", "categoryIds", "offset", "limit"],
    };
    var required = fields[op];
    var valid =
        Array.isArray(required) &&
        params.version === 1 &&
        params.runtime === runtime &&
        Object.keys(params).sort().join(",") ===
            ["version", "runtime", "op"].concat(required).sort().join(",");
    if (valid && op !== "list")
        valid =
            typeof params.sourceId === "string" &&
            /^[a-z][a-z0-9-]{0,63}$/.test(params.sourceId);
    if (valid && op === "configure")
        valid =
            text(params.label, 128) &&
            text(params.endpoint, 4096) &&
            text(params.apiKey, 2048, true);
    if (valid && op === "search")
        valid =
            text(params.query, 512, true) &&
            integer(params.offset, 1000000) &&
            integer(params.limit, 100) &&
            params.limit > 0 &&
            Array.isArray(params.categoryIds) &&
            params.categoryIds.length <= 16 &&
            params.categoryIds.every(function (id: any) {
                return integer(id, 9007199254740991) && id > 0;
            });
    if (valid && op === "prepare")
        valid =
            typeof params.resultRef === "string" &&
            /^[0-9a-f]{32}$/.test(params.resultRef);
    if (!valid)
        failure(
            params.runtime !== runtime ? "runtime_changed" : "invalid_request"
        );
    else if (restricted()) failure("policy_restricted");
    else {
        var ready = w.__ottMediaCompanion?.nativePending()
            ? w.__ottMediaCompanion.capabilities()
            : Promise.resolve();
        ready
            .then(function () {
                if (!current()) {
                    if (active) failure("expired");
                    return;
                }
                if (!w.__ottMediaCompanion?.indexerAvailable?.()) {
                    failure("unsupported");
                    return;
                }
                return w.__ottMediaCompanion.ensure(true).then(function (
                    client: any
                ) {
                    if (!current()) {
                        if (active) failure("expired");
                        return;
                    }
                    if (restricted()) {
                        failure("policy_restricted");
                        return;
                    }
                    var body: any = {};
                    required.forEach(function (key: string) {
                        body[key] = params[key];
                    });
                    return client.torznab(op, body).then(function (
                        result: any
                    ) {
                        if (
                            (op === "configure" || op === "remove") &&
                            runtime === remotePlayerInfo(w).runtime
                        ) {
                            w.__ottTorznabRevision =
                                (w.__ottTorznabRevision || 0) + 1;
                            w.__ottTorrentCatalogChanged?.();
                        }
                        if (!current()) {
                            if (active) failure("expired");
                            return;
                        }
                        finish(result);
                    });
                });
            })
            .catch(function (error: any) {
                var reason = String(error?.message || "unavailable");
                failure(
                    /^(torznab_(?:invalid_(?:source|link|query|category|xml|page)|local_only|search_unavailable|source_(?:missing|changed|limit)|reference_missing|busy|cancelled|timeout|network_error|http_error|response_limit|xml_limit|api_error|store_(?:unavailable|busy|limit))|invalid_request|invalid_source|invalid_tracker|invalid_metadata|tracker_limit|metadata_limit|service_stopped|companion_(?:transport_unavailable|endpoint_invalid|not_configured|timeout|access_denied|request_failed|unavailable|module_unavailable))$/.test(
                        reason
                    )
                        ? reason
                        : "unavailable"
                );
            });
    }
    return function () {
        active = false;
    };
}
