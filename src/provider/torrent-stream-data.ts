interface TorrentStreamItem {
    addon: { id: string; name: string };
    description: string;
    fileIndex?: number;
    fileSelection?: "largest";
    id: string;
    kind: "url" | "torrent";
    source: string;
    title: string;
}
interface TorrentStreamPorts {
    addons: () => string | string[];
    clearTimeout?: (timer: any) => void;
    now?: () => number;
    onContextChanged?: () => void;
    request: (
        url: string,
        done: (error: any, data?: any, metadata?: any) => void
    ) => (() => void) | void;
    setTimeout?: (callback: () => void, delay: number) => any;
    sha256?: (text: string, done: (error: any, hash?: string) => void) => void;
}
type TorrentStreamResult =
    | { ok: false; error: string }
    | {
          ok: true;
          items: TorrentStreamItem[];
          failedAddons: number;
          skippedAddons: number;
          unsupportedCount: number;
      };

/** Stremio metadata requests only; a returned source is never opened here. */
function createTorrentStreamData(ports: TorrentStreamPorts) {
    var later = ports.setTimeout || setTimeout;
    var clear = ports.clearTimeout || clearTimeout;
    var now = ports.now || Date.now;
    var disposed = false;
    var configuration = "";
    var current: { cancel: () => void } | null = null;
    var manifests: { url: string; expires: number; data: any }[] = [];
    var diagnostic: any = null,
        lookupSequence = 0;

    function integer(value: any): number {
        return typeof value === "number" && isFinite(value) && value >= 0
            ? Math.min(9007199254740991, Math.floor(value))
            : 0;
    }
    function clock(): number {
        try {
            return integer(now());
        } catch (_) {
            return 0;
        }
    }
    function status(value: any): number | null {
        if (typeof value === "string" && /^[1-5][0-9]{2}$/.test(value))
            value = Number(value);
        return typeof value === "number" &&
            value >= 100 &&
            value <= 599 &&
            Math.floor(value) === value
            ? value
            : null;
    }
    function diagnostics(): any {
        var context = settings();
        if (
            disposed ||
            !diagnostic ||
            diagnostic.signature !== (context ? context.signature : "!invalid")
        ) {
            diagnostic = null;
            return { lookup: null, requests: [], requestsDropped: 0 };
        }
        var trace = diagnostic,
            lookup = trace.lookup,
            at = clock();
        return {
            lookup: {
                addonCount: lookup.addonCount,
                ageMs: integer(at - lookup.started),
                failedAddons: lookup.failedAddons,
                id: lookup.id,
                movieIdKind: lookup.movieIdKind,
                playableCount: lookup.playableCount,
                skippedAddons: lookup.skippedAddons,
                state: lookup.state,
                unsupportedCount: lookup.unsupportedCount,
            },
            requests: trace.requests.map(function (request: any) {
                return {
                    addonIndex: request.addonIndex,
                    ageMs: integer(at - request.started),
                    durationMs: request.durationMs,
                    httpStatus: request.httpStatus,
                    id: request.id,
                    lookupId: lookup.id,
                    outcome: request.outcome,
                    responseBytes: request.responseBytes,
                    stage: request.stage,
                };
            }),
            requestsDropped: trace.dropped,
        };
    }

    function bytes(value: string): number {
        return unescape(encodeURIComponent(value)).length;
    }
    function plain(value: any, limit: number): string {
        return typeof value === "string" &&
            value.length <= limit &&
            !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
            ? value.trim()
            : "";
    }
    function webUrl(value: any, secure: boolean): string {
        if (
            typeof value !== "string" ||
            value !== value.trim() ||
            value.length > 4096 ||
            /[\s\\<>"']/.test(value) ||
            (!secure && value.indexOf("|") >= 0)
        )
            return "";
        var match = /^(https?):\/\/([^/?#@]+)(\/[^?#]*)?(\?[^#]*)?$/i.exec(
            value
        );
        if (
            !match ||
            match[0] !== value ||
            (secure &&
                match[1].toLowerCase() !== "https" &&
                !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(
                    match[2]
                ))
        )
            return "";
        try {
            if (typeof URL !== "undefined") {
                var parsed = new URL(value);
                if (
                    !parsed.hostname ||
                    parsed.username ||
                    parsed.password ||
                    parsed.hash
                )
                    return "";
            } else {
                if (
                    !/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::[0-9]{1,5})?$/i.test(
                        match[2]
                    )
                )
                    return "";
                var port = /:([0-9]+)$/.exec(match[2]);
                if (port && Number(port[1]) > 65535) return "";
            }
            if (
                bytes(value) > 4096 ||
                /[\u0000-\u001f\u007f\\]/.test(decodeURIComponent(value))
            )
                return "";
        } catch (_error) {
            return "";
        }
        return value;
    }
    function settings(): { urls: string[]; signature: string } | null {
        try {
            var value = ports.addons();
            if (typeof value === "string") {
                if (bytes(value) > 4096) return null;
                value = JSON.parse(value);
            }
            if (!Array.isArray(value) || value.length > 8) return null;
            var urls: string[] = [];
            for (var i = 0; i < value.length; i++) {
                if (typeof value[i] !== "string") return null;
                var url = value[i].trim().replace(/\/+$/, "");
                if (
                    !webUrl(url, true) ||
                    url.indexOf("?") >= 0 ||
                    !/\/manifest\.json$/.test(url)
                )
                    return null;
                if (urls.indexOf(url) < 0) urls.push(url);
            }
            var signature = JSON.stringify(urls);
            if (bytes(signature) > 4096) return null;
            return { signature: signature, urls: urls };
        } catch (_error) {
            return null;
        }
    }
    function cancel(): void {
        if (current) current.cancel();
    }
    function strings(value: any, limit: number): boolean {
        if (!Array.isArray(value) || value.length > limit) return false;
        for (var i = 0; i < value.length; i++)
            if (!plain(value[i], 128)) return false;
        return true;
    }
    function streamId(data: any, ids: string[]): string {
        if (
            !data ||
            typeof data !== "object" ||
            !plain(data.id, 256) ||
            !plain(data.name, 256) ||
            !Array.isArray(data.resources) ||
            data.resources.length > 32 ||
            !strings(data.types, 32)
        )
            throw new Error("manifest");
        if (data.idPrefixes !== undefined && !strings(data.idPrefixes, 64))
            throw new Error("prefixes");
        for (var candidate = 0; candidate < ids.length; candidate++) {
            for (var i = 0; i < data.resources.length; i++) {
                var resource = data.resources[i];
                var types: any, prefixes: any;
                if (resource === "stream") {
                    types = data.types;
                    prefixes = data.idPrefixes;
                } else if (
                    resource &&
                    typeof resource === "object" &&
                    resource.name === "stream"
                ) {
                    types = resource.types;
                    prefixes = resource.idPrefixes;
                    if (
                        !strings(types, 32) ||
                        (prefixes !== undefined && !strings(prefixes, 64))
                    )
                        throw new Error("resource");
                } else continue;
                if (types.indexOf("movie") < 0) continue;
                if (prefixes === undefined) return ids[candidate];
                for (var p = 0; p < prefixes.length; p++)
                    if (ids[candidate].indexOf(prefixes[p]) === 0)
                        return ids[candidate];
            }
        }
        return "";
    }
    function normalized(
        value: any,
        addon: { id: string; name: string }
    ): TorrentStreamItem | null {
        if (!value || typeof value !== "object" || Array.isArray(value))
            return null;
        var hints = value.behaviorHints;
        if (
            hints !== undefined &&
            (!hints || typeof hints !== "object" || Array.isArray(hints))
        )
            return null;
        // These fields need a player/transport capability that this adapter does not implement.
        var forbidden = [
            "externalUrl",
            "ytId",
            "nzbUrl",
            "rarUrls",
            "zipUrls",
            "7zipUrls",
            "tgzUrls",
            "tarUrls",
            "headers",
            "requestHeaders",
            "responseHeaders",
            "proxyHeaders",
            "drm",
            "drmInfo",
            "licenseUrl",
            "licenseKey",
            "licenseType",
        ];
        for (var f = 0; f < forbidden.length; f++)
            if (
                value[forbidden[f]] !== undefined ||
                (hints && hints[forbidden[f]] !== undefined)
            )
                return null;
        var source = "",
            kind: "url" | "torrent" = "url";
        var index: number | undefined;
        if (value.url !== undefined) {
            if (
                value.infoHash !== undefined ||
                value.fileIdx !== undefined ||
                value.sources !== undefined
            )
                return null;
            source = webUrl(value.url, false);
            if (!source) return null;
        } else {
            if (
                typeof value.infoHash !== "string" ||
                !/^[a-f0-9]{40}$/i.test(value.infoHash) ||
                /[^a-f0-9]/i.test(value.infoHash)
            )
                return null;
            kind = "torrent";
            if (value.fileIdx !== undefined) {
                if (
                    typeof value.fileIdx !== "number" ||
                    !isFinite(value.fileIdx) ||
                    value.fileIdx < 0 ||
                    value.fileIdx > 2147483647 ||
                    Math.floor(value.fileIdx) !== value.fileIdx
                )
                    return null;
                index = value.fileIdx;
            }
            var trackers: string[] = [];
            if (value.sources !== undefined) {
                if (!Array.isArray(value.sources) || value.sources.length > 32)
                    return null;
                for (var s = 0; s < value.sources.length; s++) {
                    var entry = value.sources[s];
                    if (typeof entry !== "string") return null;
                    if (
                        /^dht:[a-f0-9]{40}$/i.test(entry) &&
                        entry.length === 44
                    )
                        continue;
                    if (entry.indexOf("tracker:") !== 0) return null;
                    var tracker = entry.slice(8);
                    var safe = /^udp:\/\//i.test(tracker)
                        ? webUrl(tracker.replace(/^udp:/i, "http:"), false)
                        : webUrl(tracker, false);
                    if (!safe || tracker.length > 2048) return null;
                    if (trackers.indexOf(tracker) < 0) trackers.push(tracker);
                }
            }
            trackers.sort();
            source = "magnet:?xt=urn:btih:" + value.infoHash.toLowerCase();
            for (var t = 0; t < trackers.length; t++)
                source += "&tr=" + encodeURIComponent(trackers[t]);
            if (source.length > 16384) return null;
        }
        var item: TorrentStreamItem = {
            addon: addon,
            description:
                plain(value.description, 2048) || plain(value.title, 2048),
            id: "",
            kind: kind,
            source: source,
            title:
                plain(value.name, 256) || plain(value.title, 256) || addon.name,
        };
        if (index !== undefined) item.fileIndex = index;
        else if (kind === "torrent") item.fileSelection = "largest";
        return item;
    }
    function hash(
        text: string,
        done: (error: any, hash?: string) => void
    ): void {
        if (ports.sha256) {
            ports.sha256(text, done);
            return;
        }
        try {
            var encoded = unescape(encodeURIComponent(text));
            var input = new Uint8Array(encoded.length);
            for (var i = 0; i < encoded.length; i++)
                input[i] = encoded.charCodeAt(i);
            var crypto = (window as any).crypto;
            crypto.subtle.digest("SHA-256", input).then(
                function (result: any) {
                    var output = new Uint8Array(result),
                        hex = "";
                    for (var p = 0; p < output.length; p++)
                        hex += ("0" + output[p].toString(16)).slice(-2);
                    done(null, hex);
                },
                function () {
                    done(true);
                }
            );
        } catch (_error) {
            done(true);
        }
    }
    function lookup(
        movie: { id: string; imdbId?: string },
        done: (result: TorrentStreamResult) => void
    ): () => void {
        cancel();
        if (disposed) return function () {};
        var context = settings();
        var signature = context ? context.signature : "!invalid";
        if (configuration !== signature) {
            configuration = signature;
            manifests = [];
        }
        lookupSequence =
            lookupSequence < 9007199254740991 ? lookupSequence + 1 : 1;
        var trace = {
            dropped: 0,
            lookup: {
                addonCount: context ? context.urls.length : 0,
                failedAddons: 0,
                id: lookupSequence,
                movieIdKind: "unknown",
                playableCount: 0,
                skippedAddons: 0,
                started: clock(),
                state: "pending",
                unsupportedCount: 0,
            },
            requests: [] as any[],
            signature: signature,
        };
        diagnostic = trace;
        var requestSequence = 0,
            deadline = false;
        var active = true,
            finished = false;
        var aborts: (() => void)[] = [];
        var timers: any[] = [];
        var job = { cancel: stop };
        current = job;
        function stop(): void {
            if (!active) return;
            if (!finished) trace.lookup.state = "cancelled";
            active = false;
            if (current === job) current = null;
            timers.forEach(clear);
            aborts.forEach(function (abort) {
                abort();
            });
        }
        function valid(): boolean {
            if (!active || disposed || current !== job) return false;
            var next = settings();
            var nextSignature = next ? next.signature : "!invalid";
            if (nextSignature === signature) return true;
            configuration = nextSignature;
            manifests = [];
            stop();
            diagnostic = null;
            if (ports.onContextChanged) {
                try {
                    ports.onContextChanged();
                } catch (_error) {}
            }
            return false;
        }
        function finish(result: TorrentStreamResult): void {
            if (!valid() || finished) return;
            finished = true;
            trace.lookup.state = result.ok
                ? result.items.length
                    ? "ready"
                    : result.unsupportedCount
                      ? "unsupported"
                      : "empty"
                : result.error === "unsupported"
                  ? "unsupported"
                  : result.error === "no_addons"
                    ? "empty"
                    : "failed";
            if (result.ok) trace.lookup.playableCount = result.items.length;
            stop();
            done(result);
        }
        function delay(callback: () => void, ms: number): void {
            timers.push(later(callback, ms));
        }
        function request(
            url: string,
            max: number,
            callback: (error: boolean, data?: any, record?: any) => void,
            addonIndex: number,
            stage: "manifest" | "stream"
        ): void {
            var record = {
                addonIndex: addonIndex,
                durationMs: null as number | null,
                httpStatus: null as number | null,
                id: ++requestSequence,
                outcome: "pending",
                responseBytes: null as number | null,
                stage: stage,
                started: clock(),
            };
            if (trace.requests.length < 16) trace.requests.push(record);
            else trace.dropped++;
            var pending = true,
                abort: (() => void) | void,
                aborted = false;
            function abortOnce(): void {
                if (aborted) return;
                aborted = true;
                try {
                    if (abort) abort();
                } catch (_error) {}
            }
            function settle(outcome: string): void {
                if (record.outcome !== "pending") return;
                record.outcome = outcome;
                record.durationMs = integer(clock() - record.started);
            }
            function accept(error: boolean, data?: any, outcome = "ok"): void {
                if (!pending || !valid()) return;
                pending = false;
                clear(timer);
                settle(outcome);
                callback(error, data, record);
            }
            var timer = later(function () {
                accept(true, undefined, "timeout");
                abortOnce();
            }, 15000);
            timers.push(timer);
            aborts.push(function () {
                if (pending) {
                    pending = false;
                    settle(deadline ? "timeout" : "cancelled");
                    abortOnce();
                }
            });
            try {
                abort = ports.request(url, function (error, data, metadata) {
                    if (!pending || !valid()) return;
                    record.httpStatus = status(metadata && metadata.httpStatus);
                    var size = metadata && metadata.responseBytes;
                    if (typeof size === "number" && size >= 0 && isFinite(size))
                        record.responseBytes = integer(size);
                    var httpError =
                        record.httpStatus !== null &&
                        (record.httpStatus < 200 || record.httpStatus >= 300);
                    if (error || httpError) {
                        accept(
                            true,
                            undefined,
                            httpError
                                ? "http_error"
                                : metadata?.outcome === "timeout"
                                  ? "timeout"
                                  : metadata?.outcome === "cancelled"
                                    ? "cancelled"
                                    : "transport_error"
                        );
                        return;
                    }
                    try {
                        var raw =
                            typeof data === "string"
                                ? data
                                : JSON.stringify(data);
                        if (typeof raw === "string" && raw.length <= max)
                            record.responseBytes = integer(bytes(raw));
                        if (
                            typeof raw !== "string" ||
                            raw.length > max ||
                            bytes(raw) > max
                        )
                            throw new Error("size");
                        data = JSON.parse(raw);
                        if (
                            !data ||
                            typeof data !== "object" ||
                            Array.isArray(data)
                        )
                            throw new Error("shape");
                        accept(false, data);
                    } catch (_error) {
                        accept(true, undefined, "invalid_response");
                    }
                });
                if (aborted && abort) {
                    try {
                        abort();
                    } catch (_error) {}
                }
            } catch (_error) {
                accept(true, undefined, "transport_error");
            }
        }
        var match =
            movie && typeof movie.id === "string"
                ? /^tmdb:movie:([1-9][0-9]{0,14})$/.exec(movie.id)
                : null;
        var rawId = "";
        if (movie && typeof movie.id === "string" && movie.id.length <= 1024) {
            try {
                if (
                    /^imdb:movie:tt[0-9]{7,10}$/.test(movie.id) &&
                    !/[\r\n]/.test(movie.id)
                )
                    rawId = movie.id.slice(11);
                else if (movie.id.indexOf("stremio:movie:") === 0) {
                    rawId = decodeURIComponent(movie.id.slice(14));
                    if (
                        "stremio:movie:" + encodeURIComponent(rawId) !==
                            movie.id ||
                        !plain(rawId, 256) ||
                        /[\r\n]/.test(rawId)
                    )
                        rawId = "";
                }
            } catch (_error) {
                rawId = "";
            }
        }
        if (!context || ((!match || match[0] !== movie.id) && !rawId)) {
            delay(function () {
                finish({ error: "invalid_request", ok: false });
            }, 0);
            return stop;
        }
        trace.lookup.movieIdKind = match
            ? "tmdb"
            : movie.id.indexOf("imdb:movie:") === 0
              ? "imdb"
              : "custom";
        if (!context.urls.length) {
            delay(function () {
                finish({ error: "no_addons", ok: false });
            }, 0);
            return stop;
        }
        var ids: string[] = [];
        if (
            typeof movie.imdbId === "string" &&
            /^tt[0-9]{7,10}$/.test(movie.imdbId) &&
            !/[^t0-9]/.test(movie.imdbId)
        )
            ids.push(movie.imdbId);
        if (match && match[0] === movie.id)
            ids.push("tmdb:" + match[1], movie.id);
        else if (ids.indexOf(rawId) < 0) ids.push(rawId);
        var results: {
            items: TorrentStreamItem[];
            unsupported: number;
            error: boolean;
            skipped: boolean;
        }[] = [];
        var remaining = context.urls.length;
        var manifestUrls = context.urls;
        delay(function () {
            deadline = true;
            finish({ error: "unavailable", ok: false });
        }, 45000);
        function assemble(): void {
            remaining--;
            if (!valid()) return;
            trace.lookup.failedAddons = 0;
            trace.lookup.skippedAddons = 0;
            trace.lookup.unsupportedCount = 0;
            trace.lookup.playableCount = 0;
            results.forEach(function (result) {
                if (result.error) trace.lookup.failedAddons++;
                if (result.skipped) trace.lookup.skippedAddons++;
                trace.lookup.unsupportedCount += result.unsupported;
                trace.lookup.playableCount += result.items.length;
            });
            if (remaining) return;
            var items: TorrentStreamItem[] = [],
                identities: string[] = [],
                origins: string[] = [];
            var failed = 0,
                skipped = 0,
                unsupported = 0;
            for (var i = 0; i < results.length; i++) {
                var result = results[i];
                if (result.error) failed++;
                if (result.skipped) skipped++;
                unsupported += result.unsupported;
                for (var p = 0; p < result.items.length; p++) {
                    var item = result.items[p];
                    var identity = JSON.stringify([
                        item.kind,
                        item.source,
                        item.fileIndex === undefined ? null : item.fileIndex,
                    ]);
                    if (identities.indexOf(identity) >= 0) continue;
                    identities.push(identity);
                    origins.push(manifestUrls[i]);
                    items.push(item);
                }
            }
            if (failed + skipped === results.length) {
                finish({
                    error: failed ? "unavailable" : "unsupported",
                    ok: false,
                });
                return;
            }
            if (items.length > 256 || bytes(JSON.stringify(items)) > 524288) {
                finish({ error: "limit_exceeded", ok: false });
                return;
            }
            var hashes: string[] = [],
                pending = items.length;
            if (!pending) {
                finish({
                    failedAddons: failed,
                    items: items,
                    ok: true,
                    skippedAddons: skipped,
                    unsupportedCount: unsupported,
                });
                return;
            }
            items.forEach(function (item, index) {
                var settled = false;
                try {
                    hash(
                        JSON.stringify([origins[index], identities[index]]),
                        function (error, digest) {
                            if (settled || !valid()) return;
                            settled = true;
                            if (
                                error ||
                                typeof digest !== "string" ||
                                !/^[a-f0-9]{64}$/.test(digest) ||
                                /[^a-f0-9]/.test(digest) ||
                                hashes.indexOf(digest) >= 0
                            ) {
                                finish({ error: "unavailable", ok: false });
                                return;
                            }
                            hashes.push(digest);
                            item.id = "stremio:" + digest;
                            if (!--pending)
                                finish({
                                    failedAddons: failed,
                                    items: items,
                                    ok: true,
                                    skippedAddons: skipped,
                                    unsupportedCount: unsupported,
                                });
                        }
                    );
                } catch (_error) {
                    finish({ error: "unavailable", ok: false });
                }
            });
        }
        manifestUrls.forEach(function (url, index) {
            function ready(error: boolean, data?: any, record?: any): void {
                if (!valid()) return;
                results[index] = {
                    error: error,
                    items: [],
                    skipped: false,
                    unsupported: 0,
                };
                if (error) {
                    assemble();
                    return;
                }
                var id = "";
                try {
                    id = streamId(data, ids);
                } catch (_error) {
                    if (record) record.outcome = "invalid_response";
                    results[index].error = true;
                    assemble();
                    return;
                }
                if (!id) {
                    results[index].skipped = true;
                    assemble();
                    return;
                }
                request(
                    url.slice(0, -14) +
                        "/stream/movie/" +
                        encodeURIComponent(id) +
                        ".json",
                    262144,
                    function (streamError, value, record) {
                        if (
                            streamError ||
                            !Array.isArray(value.streams) ||
                            value.streams.length > 100
                        ) {
                            results[index].error = true;
                            if (!streamError && record)
                                record.outcome = "invalid_response";
                        } else
                            value.streams.forEach(function (stream: any) {
                                var item = normalized(stream, {
                                    id: data.id,
                                    name: data.name,
                                });
                                if (item) results[index].items.push(item);
                                else results[index].unsupported++;
                            });
                        assemble();
                    },
                    index,
                    "stream"
                );
            }
            for (var i = 0; i < manifests.length; i++)
                if (manifests[i].url === url && manifests[i].expires > now()) {
                    ready(false, manifests[i].data);
                    return;
                }
            request(
                url,
                65536,
                function (error, data, record) {
                    if (!error) {
                        // Cache only validated manifests, never temporary stream URLs.
                        try {
                            streamId(data, ids);
                            manifests = manifests.filter(function (m) {
                                return m.url !== url && m.expires > now();
                            });
                            if (manifests.length >= 8) manifests.shift();
                            manifests.push({
                                data: data,
                                expires: now() + 300000,
                                url: url,
                            });
                        } catch (_error) {
                            error = true;
                            if (record) record.outcome = "invalid_response";
                        }
                    }
                    ready(error, data, record);
                },
                index,
                "manifest"
            );
        });
        return stop;
    }
    return {
        cancel: cancel,
        diagnostics: diagnostics,
        dispose: function () {
            cancel();
            disposed = true;
            manifests = [];
            diagnostic = null;
        },
        lookup: lookup,
        resetDiagnostics: function () {
            diagnostic = null;
        },
    };
}
if (typeof window !== "undefined")
    (window as any).__ottTorrentStreamData = {
        create: createTorrentStreamData,
    };
