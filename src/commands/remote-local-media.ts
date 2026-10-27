import { orderLocalItems } from "../offline/playback-selection";
import { remotePlayerInfo } from "./remote-restart";

/** Runtime-bound operations on sources already owned by this player. */
export function executeRemoteLocalMedia(
    w: any,
    params: any,
    done: (value: any) => void,
    expiresAt?: number
): (() => void) | void {
    var media = w.__ottLocalMedia;
    var runtime = remotePlayerInfo(w).runtime;
    var operation = params && params.op;
    var requestRuntime = params && params.runtime;
    var listing = operation === "sources";
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
            status: error === "unsupported" ? "unsupported" : "rejected",
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
            /[\\/]|^[a-z][a-z0-9+.-]*:/i.test(source.name) ||
            ["file", "folder"].indexOf(source.kind) < 0 ||
            (source.available !== undefined &&
                typeof source.available !== "boolean")
        )
            error("catalog_unavailable");
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
                error("catalog_unavailable");
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
                    : ["op", "runtime", "source"]
                ).indexOf(key) < 0
            );
        }) ||
        (listing
            ? params.include_paths !== undefined &&
              typeof params.include_paths !== "boolean"
            : !text(params.source, 4096))
    ) {
        fail("invalid_request");
        return;
    }
    if (runtime !== requestRuntime) {
        fail("runtime_changed");
        return;
    }
    if (
        listing &&
        params.path !== undefined &&
        (!text(params.path, 4096) || !/^(\/|[a-z]:[\\/])/i.test(params.path))
    ) {
        fail("invalid_request");
        return;
    }
    if (deadline <= Date.now()) {
        fail("catalog_loading");
        return;
    }
    if (!media?.remoteSources || !media?.remoteCapabilities) {
        fail("unsupported");
        return;
    }
    if (!listing && restricted()) {
        fail("restricted");
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
        fail("unsupported");
        return;
    }
    var path =
        !listing &&
        (/^\//.test(params.source) || /^[a-z]:[\\/]/i.test(params.source));
    if (
        (path || params.path || params.include_paths) &&
        !capability.absolute_paths
    ) {
        fail("unsupported");
        return;
    }
    if (!listing && !path && /[\\/]/.test(params.source)) {
        fail("invalid_request");
        return;
    }
    try {
        if (!listing && w.__ottOfflineProfiles?.catalogGuard)
            profileCurrent = w.__ottOfflineProfiles.catalogGuard();
    } catch (_) {
        fail("restricted");
        return;
    }
    w.__ottLocalMediaRequestActive = true;
    ownsRequest = true;
    timer = setTimeout(
        function () {
            fail("catalog_loading");
            if (cancelWork) cancelWork();
        },
        Math.max(1, deadline - Date.now())
    );
    Promise.resolve()
        .then(function () {
            if (!current()) error("runtime_changed");
            return observe(
                path
                    ? media.remoteSources(false, params.source, current)
                    : media.remoteSources(
                          !!params.include_paths,
                          params.path,
                          current
                      )
            );
        })
        .then(function (value: any) {
            if (!path) return value;
            if (!current()) error("runtime_changed");
            if (!value || !Array.isArray(value.sources))
                error("catalog_unavailable");
            if (value.sources.length > 1) error("source_ambiguous");
            // Canonical lookup is read-only. Re-linking an existing folder
            // starts a new scan, preventing long scans from ever completing
            // when the controller retries a timed-out play request.
            if (value.sources.length) return { source: value.sources[0] };
            return observe(media.remoteConnect(params.source));
        })
        .then(function (value: any) {
            if (!current()) error("runtime_changed");
            var sources = path ? [value.source] : value.sources;
            if (!Array.isArray(sources) || sources.length > 32)
                error("catalog_unavailable");
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
            if (matches.length !== 1) error("source_ambiguous");
            var source = matches[0];
            if (source.kind !== "folder" || source.available === false)
                error("source_unavailable");
            function result(count: number): any {
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
                };
            }
            if (operation === "connect") return result(0);
            return observe(media.remoteCatalog(current)).then(function (
                catalog: any
            ) {
                if (!current()) error("runtime_changed");
                if (catalog.scanning || catalog.cancelled)
                    error("catalog_loading");
                if (catalog.scanError) error("catalog_unavailable");
                if (catalog.reconnectRequired) error("source_unavailable");
                var permitted = w.__ottOfflineProfiles
                    ? w.__ottOfflineProfiles.filter(catalog)
                    : catalog;
                var items = (permitted.items || []).filter(function (
                    item: any
                ) {
                    return (
                        item.sourceId === source.id &&
                        item.available !== false &&
                        !!item.url
                    );
                });
                if (!items.length) error("empty_source");
                if (items.length > 50000) error("too_many_items");
                var known: { [id: string]: boolean } = Object.create(null);
                items.forEach(function (item: any) {
                    if (!text(item.id, 256) || known[item.id])
                        error("catalog_unavailable");
                    known[item.id] = true;
                });
                var seed =
                    operation === "shuffle"
                        ? Math.floor(Math.random() * 4294967295) + 1
                        : null;
                items = orderLocalItems(items, seed);
                if (!current()) error("runtime_changed");
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
                return result(items.length);
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
