interface TorrentDiscoveryMovie {
    description: string;
    id: string;
    language: string;
    poster: string;
    title: string;
    year: string;
}

interface TorrentDiscoveryPorts {
    addonBaseUrl?: () => string;
    apiPath?: (tail: string) => string;
    clearTimeout?: (timer: any) => void;
    language: () => string;
    now?: () => number;
    onContextChanged?: () => void;
    request: (
        url: string,
        done: (error: any, data?: any) => void
    ) => (() => void) | void;
    setTimeout?: (callback: () => void, delay: number) => any;
}

type TorrentDiscoveryResult =
    | { ok: false; error: string }
    | {
          ok: true;
          items?: TorrentDiscoveryMovie[];
          item?: TorrentDiscoveryMovie;
          next?: number | null;
          categories?: { id: string; title: string }[];
      };

/** Movie metadata only. This adapter never resolves or starts a media source. */
function createTorrentDiscoveryData(ports: TorrentDiscoveryPorts) {
    var clock = ports.now || Date.now;
    var later = ports.setTimeout || setTimeout;
    var clear = ports.clearTimeout || clearTimeout;
    var disposed = false;
    var configuration = "";
    var cache: { key: string; expires: number; text: string; bytes: number }[] =
        [];
    var cacheBytes = 0;
    var lanes: { [name: string]: { cancel: () => void } | undefined } = {};

    function byteLength(value: string): number {
        var size = 0;
        for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i);
            if (code < 128) size++;
            else if (code < 2048) size += 2;
            else if (
                code >= 0xd800 &&
                code <= 0xdbff &&
                i + 1 < value.length &&
                value.charCodeAt(i + 1) >= 0xdc00 &&
                value.charCodeAt(i + 1) <= 0xdfff
            ) {
                size += 4;
                i++;
            } else size += 3;
        }
        return size;
    }

    function plain(value: any, limit: number): string {
        return typeof value === "string" &&
            value.length <= limit &&
            !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
            ? value.trim()
            : "";
    }

    function numberId(value: any): string {
        var result = String(value);
        return /^[1-9][0-9]{0,14}$/.test(result) && !/[^0-9]/.test(result)
            ? result
            : "";
    }

    function httpsUrl(value: any, limit = 2048): string {
        var result = plain(value, limit);
        return /^https:\/\/[^\s/@?#\\]+(?:\/[^\s?#\\]*)?(?:\?[^\s#\\]*)?$/i.test(
            result
        ) && !/[<>"']/.test(result)
            ? result
            : "";
    }

    function cancel(): void {
        Object.keys(lanes).forEach(function (key) {
            var job = lanes[key];
            if (job) job.cancel();
        });
    }

    function context(): { language: string; base: string } | null {
        if (disposed) return null;
        var language = "";
        var base = "";
        try {
            language = String(ports.language() || "")
                .trim()
                .replace(/_/g, "-");
            base = ports.addonBaseUrl ? String(ports.addonBaseUrl() || "") : "";
        } catch (_error) {
            return null;
        }
        var languageMatch =
            /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?$/i.exec(
                language
            );
        if (!languageMatch || languageMatch[0] !== language) language = "en-US";
        var parts = language.split("-");
        language = parts[0].toLowerCase();
        for (var part = 1; part < parts.length; part++)
            language +=
                "-" +
                (parts[part].length === 4
                    ? parts[part].charAt(0).toUpperCase() +
                      parts[part].slice(1).toLowerCase()
                    : parts[part].toUpperCase());
        base = base.trim().replace(/\/+$/, "");
        var signature = language + "\n" + base;
        if (signature !== configuration) {
            cancel();
            configuration = signature;
            cache = [];
            cacheBytes = 0;
        }
        try {
            var decodedBase = decodeURIComponent(base);
            if (
                base &&
                (!httpsUrl(base, 4096) ||
                    /[?#]/.test(base) ||
                    /[\s\\{}]/.test(decodedBase) ||
                    /\/manifest\.json\/*$/i.test(decodedBase))
            )
                return null;
        } catch (_error) {
            return null;
        }
        return { base: base, language: language };
    }

    function endpoint(ctx: { language: string; base: string }, tail: string) {
        if (ctx.base)
            return (
                ctx.base +
                "/" +
                encodeURIComponent(JSON.stringify({ language: ctx.language })) +
                "/" +
                tail
            );
        return ports.apiPath ? ports.apiPath(tail) : "/tmdb/s/" + tail;
    }

    function remember(key: string, value: TorrentDiscoveryResult): void {
        var text = JSON.stringify(value);
        var bytes = byteLength(text);
        if (bytes > 2097152) return;
        while (cache.length >= 32 || cacheBytes + bytes > 2097152) {
            cacheBytes -= cache.shift()!.bytes;
        }
        cache.push({
            bytes: bytes,
            expires: clock() + 300000,
            key: key,
            text: text,
        });
        cacheBytes += bytes;
    }

    function run(
        lane: string,
        url: string,
        transform: ((data: any) => TorrentDiscoveryResult) | null,
        done: (result: TorrentDiscoveryResult) => void
    ): () => void {
        var previous = lanes[lane];
        if (previous) previous.cancel();
        if (disposed) return function () {};
        var active = true;
        var aborted = false;
        var abort: (() => void) | void;
        var timer: any;
        var signature = configuration;
        var key = signature + "\n" + url;
        var job = { cancel: stop };
        lanes[lane] = job;

        function stop(): void {
            if (!active) return;
            active = false;
            clear(timer);
            if (lanes[lane] === job) delete lanes[lane];
            abortTransport();
        }

        function abortTransport(): void {
            if (aborted) return;
            aborted = true;
            try {
                if (abort) abort();
            } catch (_error) {
                // A transport that cannot abort still cannot publish a stale result.
            }
        }

        function finish(result: TorrentDiscoveryResult): void {
            if (!active || disposed || signature !== configuration) return;
            // Also fence a language/source change before the next UI request.
            var current = transform ? context() : true;
            if (!current || !active || signature !== configuration) {
                stop();
                if (
                    signature !== configuration &&
                    !disposed &&
                    ports.onContextChanged
                ) {
                    // The owner decides whether its current view should reload.
                    // Explicit new-context requests already canceled these jobs.
                    try {
                        ports.onContextChanged();
                    } catch (_error) {}
                }
                return;
            }
            active = false;
            clear(timer);
            if (lanes[lane] === job) delete lanes[lane];
            done(result);
        }

        if (!transform) {
            timer = later(function () {
                finish({ error: "invalid_request", ok: false });
            }, 0);
            return stop;
        }
        for (var i = cache.length - 1; i >= 0; i--) {
            if (cache[i].expires <= clock()) {
                cacheBytes -= cache[i].bytes;
                cache.splice(i, 1);
            } else if (cache[i].key === key) {
                var hit = cache.splice(i, 1)[0];
                cache.push(hit);
                timer = later(function () {
                    finish(JSON.parse(hit.text));
                }, 0);
                return stop;
            }
        }
        timer = later(function () {
            finish({ error: "timeout", ok: false });
            abortTransport();
        }, 15000);
        try {
            abort = ports.request(url, function (error: any, data?: any) {
                if (!active || disposed || signature !== configuration) return;
                if (error) {
                    finish({ error: "unavailable", ok: false });
                    return;
                }
                var result: TorrentDiscoveryResult;
                try {
                    var serialized =
                        typeof data === "string" ? data : JSON.stringify(data);
                    if (
                        typeof serialized !== "string" ||
                        serialized.length > 524288 ||
                        byteLength(serialized) > 524288
                    )
                        throw new Error("response size");
                    data = JSON.parse(serialized);
                    if (
                        !data ||
                        typeof data !== "object" ||
                        Array.isArray(data)
                    )
                        throw new Error("response shape");
                    result = transform(data);
                } catch (_error) {
                    result = { error: "invalid_response", ok: false };
                }
                if (result.ok && signature === configuration)
                    remember(key, result);
                finish(result);
            });
        } catch (_error) {
            finish({ error: "unavailable", ok: false });
        }
        return stop;
    }

    function movie(
        data: any,
        language: string,
        addon: boolean
    ): TorrentDiscoveryMovie {
        if (!data || typeof data !== "object" || Array.isArray(data))
            throw new Error("movie");
        var id = addon
            ? /^tmdb:(?:movie:)?([1-9][0-9]{0,14})$/.exec(String(data.id || ""))
            : null;
        var numericId = addon
            ? id && id[0] === data.id
                ? id[1]
                : ""
            : numberId(data.id);
        if (addon && data.type && data.type !== "movie")
            throw new Error("type");
        var title = plain(addon ? data.name : data.title, 512);
        if (!title && !addon) title = plain(data.original_title, 512);
        if (!numericId || !title) throw new Error("identity");
        var path = plain(data.poster_path, 1024);
        var poster = addon
            ? httpsUrl(data.poster)
            : /^\/[a-zA-Z0-9_./-]+$/.test(path)
              ? "https://image.tmdb.org/t/p/w342" + path
              : "";
        var date = plain(addon ? data.releaseInfo : data.release_date, 64);
        return {
            description: plain(addon ? data.description : data.overview, 8192),
            id: "tmdb:movie:" + numericId,
            language: language,
            poster: poster,
            title: title,
            year: /^[12][0-9]{3}(?:$|[^0-9])/.test(date)
                ? date.slice(0, 4)
                : "",
        };
    }

    function pageRequest(
        category: string,
        query: string | null,
        cursor: number | null,
        done: (result: TorrentDiscoveryResult) => void
    ): () => void {
        var ctx = context();
        var page = cursor === null || cursor === undefined ? 1 : cursor;
        if (
            !ctx ||
            typeof page !== "number" ||
            page < 1 ||
            page > 500 ||
            Math.floor(page) !== page ||
            typeof category !== "string" ||
            (query !== null && !plain(query, 256))
        )
            return run("list", "", null, done);
        var tail = "";
        var genre = "";
        if (category.indexOf("genre:") === 0) {
            try {
                genre = decodeURIComponent(category.slice(6));
            } catch (_error) {}
            if (!plain(genre, 128) || (!ctx.base && !numberId(genre)))
                return run("list", "", null, done);
        } else if (
            category !== "popular" &&
            category !== "new" &&
            query === null
        )
            return run("list", "", null, done);
        if (ctx.base) {
            if (query !== null && page !== 1)
                return run("list", "", null, done);
            tail =
                "catalog/movie/" +
                (query !== null
                    ? "tmdb.search"
                    : category === "new"
                      ? "tmdb.latest"
                      : "tmdb.top");
            var extras = ["skip=" + (page - 1) * 20];
            if (query !== null)
                extras.push("search=" + encodeURIComponent(query.trim()));
            if (genre) extras.push("genre=" + encodeURIComponent(genre));
            tail += "/" + extras.join("&") + ".json";
        } else {
            tail =
                query !== null
                    ? "search/movie"
                    : genre
                      ? "discover/movie"
                      : "movie/" +
                        (category === "new" ? "now_playing" : "popular");
            tail +=
                "?language=" +
                encodeURIComponent(ctx.language) +
                "&page=" +
                page +
                "&include_adult=false";
            if (query !== null)
                tail += "&query=" + encodeURIComponent(query.trim());
            if (genre) tail += "&with_genres=" + encodeURIComponent(genre);
        }
        var locale = ctx.language;
        var addon = !!ctx.base;
        return run(
            "list",
            endpoint(ctx, tail),
            function (data: any) {
                var rows = addon ? data.metas : data.results;
                if (!Array.isArray(rows) || rows.length > 100)
                    throw new Error("page");
                if (!addon && data.page !== page)
                    throw new Error("page number");
                if (
                    !addon &&
                    (typeof data.total_pages !== "number" ||
                        data.total_pages < 0 ||
                        !isFinite(data.total_pages) ||
                        Math.floor(data.total_pages) !== data.total_pages)
                )
                    throw new Error("page total");
                var ids: { [key: string]: boolean } = {};
                var items: TorrentDiscoveryMovie[] = [];
                rows.forEach(function (row: any) {
                    var item = movie(row, locale, addon);
                    if (!ids[item.id]) {
                        ids[item.id] = true;
                        items.push(item);
                    }
                });
                var more = addon
                    ? query === null && rows.length >= 20
                    : typeof data.total_pages === "number" &&
                      data.total_pages > page;
                return {
                    items: items,
                    next: more && page < 500 ? page + 1 : null,
                    ok: true,
                };
            },
            done
        );
    }

    return {
        cancel: cancel,
        categories: function (done: (result: TorrentDiscoveryResult) => void) {
            var ctx = context();
            if (!ctx) return run("categories", "", null, done);
            var addon = !!ctx.base;
            return run(
                "categories",
                endpoint(
                    ctx,
                    addon
                        ? "manifest.json"
                        : "genre/movie/list?language=" +
                              encodeURIComponent(ctx.language)
                ),
                function (data: any) {
                    var categories = [
                        { id: "popular", title: "Popular" },
                        { id: "new", title: "New" },
                    ];
                    var values: any[] = [];
                    if (addon) {
                        if (
                            !Array.isArray(data.catalogs) ||
                            data.catalogs.length > 100
                        )
                            throw new Error("catalogs");
                        data.catalogs.forEach(function (entry: any) {
                            if (
                                entry &&
                                entry.type === "movie" &&
                                entry.id === "tmdb.top" &&
                                Array.isArray(entry.extra)
                            )
                                entry.extra.forEach(function (extra: any) {
                                    if (
                                        extra &&
                                        extra.name === "genre" &&
                                        Array.isArray(extra.options)
                                    )
                                        values = extra.options;
                                });
                        });
                    } else {
                        if (!Array.isArray(data.genres))
                            throw new Error("genres");
                        values = data.genres;
                    }
                    if (values.length > 100) throw new Error("genres size");
                    var seen: { [key: string]: boolean } = {};
                    values.forEach(function (value: any) {
                        var title = plain(
                            addon ? value : value && value.name,
                            128
                        );
                        var id = addon
                            ? encodeURIComponent(title)
                            : numberId(value && value.id);
                        if (!title || !id) throw new Error("genre");
                        if (!seen[id]) {
                            seen[id] = true;
                            categories.push({
                                id: "genre:" + id,
                                title: title,
                            });
                        }
                    });
                    return { categories: categories, ok: true };
                },
                done
            );
        },
        details: function (
            id: string,
            done: (result: TorrentDiscoveryResult) => void
        ) {
            var ctx = context();
            var match =
                typeof id === "string"
                    ? /^tmdb:movie:([1-9][0-9]{0,14})$/.exec(id)
                    : null;
            if (!ctx || !match || match[0] !== id)
                return run("details", "", null, done);
            var locale = ctx.language;
            var addon = !!ctx.base;
            var tail = addon
                ? "meta/movie/tmdb:" + match[1] + ".json"
                : "movie/" +
                  match[1] +
                  "?language=" +
                  encodeURIComponent(locale);
            return run(
                "details",
                endpoint(ctx, tail),
                function (data: any) {
                    var item = movie(addon ? data.meta : data, locale, addon);
                    if (item.id !== id) throw new Error("different movie");
                    return { item: item, ok: true };
                },
                done
            );
        },
        dispose: function () {
            cancel();
            disposed = true;
            cache = [];
            cacheBytes = 0;
        },
        load: function (
            category: string,
            cursor: number | null,
            done: (result: TorrentDiscoveryResult) => void
        ) {
            return pageRequest(category, null, cursor, done);
        },
        search: function (
            query: string,
            cursor: number | null,
            done: (result: TorrentDiscoveryResult) => void
        ) {
            return pageRequest("search", query, cursor, done);
        },
    };
}

if (typeof window !== "undefined")
    (window as any).__ottTorrentDiscoveryData = {
        create: createTorrentDiscoveryData,
    };
