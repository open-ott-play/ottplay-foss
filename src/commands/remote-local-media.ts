import {
    localSourceScan,
    orderLocalItems,
} from "../offline/playback-selection";
import { remotePlayerInfo } from "./remote-restart";

/** Runtime-bound operations on sources already owned by this player. */
/** Runtime-bound operations on sources already owned by this player. */
export function executeRemoteLocalMedia(
    w: any,
    params: any,
    done: (value: any) => void,
    expiresAt?: number
): (() => void) | void {
    // Share exact repeated error/protocol text without changing wire values.
    var localMessage0 = "unsupported" as const,
        localMessage1 = "catalog_unavailable" as const,
        localMessage2 = "invalid_request" as const,
        localMessage3 = "runtime_changed" as const,
        localMessage4 = "catalog_loading" as const,
        localMessage5 = "restricted" as const,
        localMessage6 = "source_ambiguous" as const,
        localMessage7 = "source_unavailable" as const;

    var media = w.__ottLocalMedia;
    var runtime = remotePlayerInfo(w).runtime;
    var operation = params && params.op;
    var requestRuntime = params && params.runtime;
    var listing = operation === "sources";
    var playableOperation = operation === "play" || operation === "shuffle";
    var progressive = playableOperation && params.progressive === true;
    var originalDriver = w.__ottActiveProviderDriver;
    var originalLoad = w.__ottCommandChannelLoad;
    var settled = false;
    var ownsRequest = false;
    var profileCurrent: (() => boolean) | null = null;
    var timer: any = null;
    var cancelWork: (() => void) | null = null;
    var deadline = Math.min(
        Date.now() + 60000,
        typeof expiresAt === "number" && isFinite(expiresAt)
            ? expiresAt * 1000
            : Infinity
    );
    function finish(value: any): void {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (ownsRequest) w.__ottLocalMediaRequestActive = false;
        done(value);
    }
    function fail(error: string): void {
        finish({
            data: {
                error: error,
                op: operation,
                runtime: requestRuntime,
                state: "error",
                version: 1,
            },
            status: error === localMessage0 ? localMessage0 : "rejected",
        });
    }
    function restricted(): boolean {
        return !!(
            w.__ottStandby?.blocked?.() ||
            w.__ottKiosk?.enabled?.() ||
            (w.__ottParental
                ? w.__ottParental.needs("providers") ||
                  w.__ottParental.needs("settings")
                : (w.sPSprovs || w.sPSoptions) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess)
        );
    }
    function current(): boolean {
        return (
            !settled &&
            Date.now() < deadline &&
            remotePlayerInfo(w).runtime === runtime &&
            (listing ||
                (w.__ottActiveProviderDriver === originalDriver &&
                    w.__ottCommandChannelLoad === originalLoad &&
                    (!profileCurrent || profileCurrent()) &&
                    !restricted()))
        );
    }
    function text(value: any, max: number): boolean {
        try {
            return (
                typeof value === "string" &&
                !!value.trim() &&
                !/[\u0000-\u001f\u007f-\u009f]/.test(value) &&
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= max
            );
        } catch (_) {
            return false;
        }
    }
    function row(source: any, paths = false): any {
        if (
            !source ||
            typeof source.id !== "string" ||
            !/^[A-Za-z0-9_.:-]{1,256}$/.test(source.id) ||
            !text(source.name, 512) ||
            /[\\/]/.test(source.name) ||
            ["file", "folder"].indexOf(source.kind) < 0 ||
            (source.available !== undefined &&
                typeof source.available !== "boolean")
        )
            error(localMessage1);
        var value: any = {
            available: source.available !== false,
            id: source.id,
            kind: source.kind,
            name: source.name,
        };
        if (paths && source.path !== undefined) {
            if (
                !text(source.path, 4096) ||
                !/^(\/|[a-z]:[\\/])/i.test(source.path)
            )
                error(localMessage1);
            value.path = source.path;
        }
        return value;
    }
    function error(code: string): never {
        throw { localMediaCode: code };
    }
    function observe(pending: any): any {
        cancelWork =
            typeof pending?.cancel === "function" ? pending.cancel : null;
        return pending;
    }
    if (
        !params ||
        typeof params !== "object" ||
        Array.isArray(params) ||
        ["sources", "play", "shuffle", "connect"].indexOf(operation) < 0 ||
        !text(requestRuntime, 64) ||
        !/^[a-z0-9-]+$/.test(requestRuntime) ||
        Object.keys(params).some(function (key) {
            return (
                (listing
                    ? ["op", "runtime", "include_paths", "path"]
                    : playableOperation
                      ? ["op", "runtime", "source", "progressive"]
                      : ["op", "runtime", "source"]
                ).indexOf(key) < 0
            );
        }) ||
        (playableOperation &&
            params.progressive !== undefined &&
            params.progressive !== true) ||
        (listing
            ? params.include_paths !== undefined &&
              typeof params.include_paths !== "boolean"
            : !text(params.source, 4096))
    ) {
        fail(localMessage2);
        return;
    }
    if (runtime !== requestRuntime) {
        fail(localMessage3);
        return;
    }
    if (
        listing &&
        params.path !== undefined &&
        (!text(params.path, 4096) || !/^(\/|[a-z]:[\\/])/i.test(params.path))
    ) {
        fail(localMessage2);
        return;
    }
    if (deadline <= Date.now()) {
        fail(localMessage4);
        return;
    }
    if (!media?.remoteSources || !media?.remoteCapabilities) {
        fail(localMessage0);
        return;
    }
    if (!listing && restricted()) {
        fail(localMessage5);
        return;
    }
    if (w.__ottLocalMediaRequestActive) {
        fail("operation_in_progress");
        return;
    }
    var capability = media.remoteCapabilities();
    if (
        !capability ||
        capability.version !== 1 ||
        !Array.isArray(capability.operations) ||
        capability.operations.indexOf(operation) < 0
    ) {
        fail(localMessage0);
        return;
    }
    var path =
        !listing &&
        (/^\//.test(params.source) || /^[a-z]:[\\/]/i.test(params.source));
    if (
        (path || params.path || params.include_paths) &&
        !capability.absolute_paths
    ) {
        fail(localMessage0);
        return;
    }
    if (!listing && !path && /[\\/]/.test(params.source)) {
        fail(localMessage2);
        return;
    }
    try {
        if (!listing && w.__ottOfflineProfiles?.catalogGuard)
            profileCurrent = w.__ottOfflineProfiles.catalogGuard();
    } catch (_) {
        fail(localMessage5);
        return;
    }
    w.__ottLocalMediaRequestActive = true;
    ownsRequest = true;
    timer = setTimeout(
        function () {
            fail(localMessage4);
            if (cancelWork) cancelWork();
        },
        Math.max(1, deadline - Date.now())
    );
    Promise.resolve()
        .then(function () {
            if (!current()) error(localMessage3);
            return observe(
                path
                    ? media.remoteSources(false, params.source, current)
                    : media.remoteSources(
                          !!params.include_paths,
                          params.path,
                          current,
                          listing ? undefined : params.source
                      )
            );
        })
        .then(function (value: any) {
            if (!path) return value;
            if (!current()) error(localMessage3);
            if (!value || !Array.isArray(value.sources)) error(localMessage1);
            if (value.sources.length > 1) error(localMessage6);
            // Canonical lookup is read-only. Re-linking an existing folder
            // starts a new scan, preventing long scans from ever completing
            // when the controller retries a timed-out play request.
            if (value.sources.length) return { source: value.sources[0] };
            return observe(
                media.remoteConnect(params.source, current, deadline)
            );
        })
        .then(function (value: any) {
            if (!current()) error(localMessage3);
            var sources = path ? [value.source] : value.sources;
            if (!Array.isArray(sources) || sources.length > 32)
                error(localMessage1);
            sources.forEach(function (source) {
                row(source);
            });
            if (listing) {
                return {
                    op: operation,
                    runtime: runtime,
                    sources: sources.map(function (source) {
                        return row(source, !!params.include_paths);
                    }),
                    state: "ready",
                    version: 1,
                };
            }
            var matches = path
                ? sources
                : sources.filter(function (source) {
                      return source.id === params.source;
                  });
            if (!matches.length)
                matches = sources.filter(function (source) {
                    return source.name === params.source;
                });
            if (!matches.length) error("source_not_found");
            if (matches.length !== 1) error(localMessage6);
            var source = matches[0];
            if (source.kind !== "folder" || source.available === false)
                error(localMessage7);
            function result(count: number, scanning = false): any {
                return {
                    accepted: true,
                    count: count,
                    op: operation,
                    playback_confirmed: false,
                    runtime: runtime,
                    shuffled: operation === "shuffle",
                    source: row(source),
                    state: "ready",
                    version: 1,
                    ...(progressive && scanning ? { scanning: true } : {}),
                };
            }
            if (operation === "connect") return result(0);
            function playable(catalog: any): any[] {
                var permitted = w.__ottOfflineProfiles
                    ? w.__ottOfflineProfiles.filter(catalog)
                    : catalog;
                return (permitted.items || []).filter(function (item: any) {
                    return (
                        item.sourceId === source.id &&
                        item.available !== false &&
                        item.playback?.mode !== localMessage0 &&
                        !!item.url
                    );
                });
            }
            return observe(
                media.remoteCatalog(
                    current,
                    source.id,
                    progressive
                        ? function (catalog: any) {
                              return playable(catalog).length > 0;
                          }
                        : null
                )
            ).then(function (catalog: any) {
                if (!current()) error(localMessage3);
                var scan = localSourceScan(catalog, source.id);
                if (scan && scan.state === "error") error(localMessage1);
                if (
                    catalog.cancelled ||
                    (scan
                        ? !scan.generation ||
                          (!progressive && scan.state !== "complete")
                        : catalog.scanning)
                )
                    error(localMessage4);
                if (catalog.scanError && (!scan || !scan.generation))
                    error(localMessage1);
                if (catalog.reconnectRequired) error(localMessage7);
                if (
                    !(catalog.sources || []).some(function (entry: any) {
                        return (
                            entry.id === source.id &&
                            entry.kind === "folder" &&
                            entry.available !== false
                        );
                    })
                )
                    error(localMessage7);
                var scanning = scan
                    ? scan.state !== "complete"
                    : !!catalog.scanning;
                var items = playable(catalog);
                if (!items.length)
                    error(scanning ? localMessage4 : "empty_source");
                if (items.length > 50000) error("too_many_items");
                var known: {
                    [id: string]: boolean;
                } = Object.create(null);
                items.forEach(function (item: any) {
                    if (!text(item.id, 256) || known[item.id])
                        error(localMessage1);
                    known[item.id] = true;
                });
                var seed =
                    operation === "shuffle"
                        ? Math.floor(Math.random() * 4294967295) + 1
                        : null;
                items = orderLocalItems(items, seed);
                if (!current()) error(localMessage3);
                media.remoteActivate(
                    source.id,
                    items.map(function (item: any) {
                        return item.id;
                    }),
                    catalog,
                    function () {
                        return remotePlayerInfo(w).runtime === runtime;
                    },
                    seed
                );
                return result(items.length, scanning);
            });
        })
        .then(
            function (data: any) {
                finish({ data: data, status: "ok" });
            },
            function (cause: any) {
                fail(cause?.localMediaCode || "native_error");
            }
        );
    return function () {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (ownsRequest) w.__ottLocalMediaRequestActive = false;
        if (cancelWork) cancelWork();
    };
}
