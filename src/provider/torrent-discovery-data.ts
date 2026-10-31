interface TorrentDiscoveryMovie {
    description: string;
    id: string;
    imdbId?: string;
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
          categories?: {
              id: string;
              title: string;
              searchSupported?: boolean;
          }[];
          mode?: "tmdb" | "stremio";
          searchSupported?: boolean;
          manifest?: any;
          catalog?: { id: string; title: string; searchSupported: boolean };
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

    function catalogBaseUrl(value: string): boolean {
        if (byteLength(value) > 4096) return false;
        if (httpsUrl(value, 4096)) return true;
        var local =
            /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?(?:\/|$)/i.exec(
                value
            );
        return (
            !!local &&
            (!local[2] || Number(local[2]) <= 65535) &&
            !!httpsUrl(value.replace(/^http:/i, "https:"), 4097)
        );
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
                (!catalogBaseUrl(base) ||
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
        addon: boolean,
        generic = false
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
        var stableId = "tmdb:movie:" + numericId;
        if (generic) {
            var rawId = plain(data.id, 256);
            if (!rawId || rawId !== data.id || /[\r\n]/.test(rawId))
                throw new Error("identity");
            stableId = /^tt[0-9]{7,10}$/.test(rawId)
                ? "imdb:movie:" + rawId
                : "stremio:movie:" + encodeURIComponent(rawId);
            if (stableId.length > 1024) throw new Error("identity");
        }
        if ((!numericId && !generic) || !title) throw new Error("identity");
        var path = plain(data.poster_path, 1024);
        var poster = addon
            ? httpsUrl(data.poster)
            : /^\/[a-zA-Z0-9_./-]+$/.test(path)
              ? "https://image.tmdb.org/t/p/w342" + path
              : "";
        var date = plain(addon ? data.releaseInfo : data.release_date, 64);
        var result: TorrentDiscoveryMovie = {
            description: plain(addon ? data.description : data.overview, 8192),
            id: stableId,
            language: language,
            poster: poster,
            title: title,
            year: /^[12][0-9]{3}(?:$|[^0-9])/.test(date)
                ? date.slice(0, 4)
                : "",
        };
        var imdbId =
            data.imdb_id ||
            (data.external_ids && data.external_ids.imdb_id) ||
            (generic && data.id);
        if (
            typeof imdbId === "string" &&
            /^tt[0-9]{7,10}$/.test(imdbId) &&
            !/[^t0-9]/.test(imdbId)
        )
            result.imdbId = imdbId;
        return result;
    }

    function addonRequest(
        lane: string,
        ctx: { base: string; language: string },
        done: (result: TorrentDiscoveryResult) => void,
        next: (manifest: any, legacy: boolean) => () => void
    ): () => void {
        var inner: (() => void) | undefined;
        var outer = run(
            lane,
            ctx.base + "/manifest.json",
            function (data: any) {
                if (
                    !Array.isArray(data.catalogs) ||
                    data.catalogs.length > 100 ||
                    !Array.isArray(data.resources) ||
                    data.resources.length > 32 ||
                    byteLength(JSON.stringify(data)) > 65536
                )
                    throw new Error("manifest");
                return { manifest: data, ok: true };
            },
            function (result) {
                if (!result.ok) {
                    done(result);
                    return;
                }
                var manifest = result.manifest;
                var ids = manifest.catalogs.map(function (entry: any) {
                    return entry && entry.type === "movie" ? entry.id : "";
                });
                inner = next(
                    manifest,
                    ids.indexOf("tmdb.top") >= 0 &&
                        ids.indexOf("tmdb.latest") >= 0 &&
                        ids.indexOf("tmdb.search") >= 0
                );
            }
        );
        return function () {
            outer();
            if (inner) inner();
        };
    }

    function catalogExtra(catalog: any, name: string): boolean {
        if (!Array.isArray(catalog.extra)) return false;
        for (var i = 0; i < catalog.extra.length; i++)
            if (catalog.extra[i] && catalog.extra[i].name === name) return true;
        return false;
    }

    function movieCatalogs(manifest: any, search: boolean): any[] {
        return manifest.catalogs.filter(function (entry: any) {
            if (
                !entry ||
                entry.type !== "movie" ||
                !plain(entry.id, 256) ||
                entry.id !== entry.id.trim() ||
                /[\r\n]/.test(entry.id)
            )
                return false;
            if (
                entry.extra !== undefined &&
                (!Array.isArray(entry.extra) || entry.extra.length > 32)
            )
                return false;
            var extras = entry.extra || [];
            for (var i = 0; i < extras.length; i++)
                if (
                    extras[i] &&
                    extras[i].isRequired &&
                    extras[i].name !== "skip" &&
                    !(search && extras[i].name === "search")
                )
                    return false;
            return !search || catalogExtra(entry, "search");
        });
    }

    function pageRequest(
        category: string,
        query: string | null,
        cursor: number | null,
        done: (result: TorrentDiscoveryResult) => void
    ): () => void {
        var ctx = context();
        if (!ctx || !ctx.base)
            return standardPageRequest(category, query, cursor, done);
        return addonRequest("list", ctx, done, function (manifest, legacy) {
            if (legacy)
                return standardPageRequest(category, query, cursor, done);
            var catalogs = movieCatalogs(manifest, query !== null),
                selected: any = null;
            for (var i = 0; i < catalogs.length; i++) {
                if (
                    query !== null ||
                    category === "popular" ||
                    category === "catalog:" + encodeURIComponent(catalogs[i].id)
                ) {
                    selected = catalogs[i];
                    break;
                }
            }
            var offset = cursor === null || cursor === undefined ? 0 : cursor;
            if (
                !selected ||
                typeof offset !== "number" ||
                offset < 0 ||
                offset > 50000 ||
                Math.floor(offset) !== offset ||
                (query !== null && !plain(query, 256)) ||
                (offset > 0 && !catalogExtra(selected, "skip"))
            )
                return run("list", "", null, done);
            var extras: string[] = [];
            if (query !== null)
                extras.push("search=" + encodeURIComponent(query.trim()));
            var paged = catalogExtra(selected, "skip");
            if (paged) extras.push("skip=" + offset);
            var url =
                ctx!.base +
                "/catalog/movie/" +
                encodeURIComponent(selected.id) +
                (extras.length ? "/" + extras.join("&") : "") +
                ".json";
            return run(
                "list",
                url,
                function (data: any) {
                    if (!Array.isArray(data.metas) || data.metas.length > 100)
                        throw new Error("page");
                    var items: TorrentDiscoveryMovie[] = [],
                        seen: string[] = [];
                    data.metas.forEach(function (row: any) {
                        if (row && row.type && row.type !== "movie") return;
                        var item = movie(row, ctx!.language, true, true);
                        if (seen.indexOf(item.id) < 0) {
                            seen.push(item.id);
                            items.push(item);
                        }
                    });
                    return {
                        catalog: {
                            id: "catalog:" + encodeURIComponent(selected.id),
                            searchSupported:
                                movieCatalogs(manifest, true).length > 0,
                            title: plain(selected.name, 256) || selected.id,
                        },
                        items: items,
                        mode: "stremio",
                        next:
                            paged &&
                            data.metas.length &&
                            offset + data.metas.length <= 50000
                                ? offset + data.metas.length
                                : null,
                        ok: true,
                    };
                },
                done
            );
        });
    }

    function standardPageRequest(
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

    function categoryRequest(
        done: (result: TorrentDiscoveryResult) => void
    ): () => void {
        var ctx = context();
        if (!ctx || !ctx.base) return standardCategories(done);
        return addonRequest(
            "categories",
            ctx,
            done,
            function (manifest, legacy) {
                if (legacy) return standardCategories(done);
                var seen: string[] = [],
                    categories: {
                        id: string;
                        title: string;
                        searchSupported: boolean;
                    }[] = [];
                movieCatalogs(manifest, false).forEach(function (entry) {
                    if (seen.indexOf(entry.id) >= 0) return;
                    seen.push(entry.id);
                    categories.push({
                        id: "catalog:" + encodeURIComponent(entry.id),
                        searchSupported: catalogExtra(entry, "search"),
                        title: plain(entry.name, 256) || entry.id,
                    });
                });
                done({
                    categories: categories,
                    mode: "stremio",
                    ok: true,
                    searchSupported: movieCatalogs(manifest, true).length > 0,
                });
                return function () {};
            }
        );
    }

    function detailRequest(
        id: string,
        done: (result: TorrentDiscoveryResult) => void
    ): () => void {
        var ctx = context();
        if (!ctx || !ctx.base) return standardDetails(id, done);
        return addonRequest("details", ctx, done, function (manifest, legacy) {
            if (legacy) return standardDetails(id, done);
            var rawId = "";
            try {
                if (typeof id === "string" && id.length <= 1024) {
                    if (
                        /^imdb:movie:tt[0-9]{7,10}$/.test(id) &&
                        !/[\r\n]/.test(id)
                    )
                        rawId = id.slice(11);
                    else if (id.indexOf("stremio:movie:") === 0) {
                        rawId = decodeURIComponent(id.slice(14));
                        if (
                            "stremio:movie:" + encodeURIComponent(rawId) !==
                                id ||
                            !plain(rawId, 256) ||
                            /[\r\n]/.test(rawId)
                        )
                            rawId = "";
                    }
                }
            } catch (_error) {
                rawId = "";
            }
            var supported = manifest.resources.some(function (resource: any) {
                var types =
                    resource === "meta"
                        ? manifest.types
                        : resource && resource.name === "meta"
                          ? resource.types
                          : null;
                var prefixes =
                    resource === "meta"
                        ? manifest.idPrefixes
                        : resource && resource.idPrefixes;
                return (
                    Array.isArray(types) &&
                    types.indexOf("movie") >= 0 &&
                    (prefixes === undefined ||
                        (Array.isArray(prefixes) &&
                            prefixes.some(function (prefix: any) {
                                return (
                                    typeof prefix === "string" &&
                                    rawId.indexOf(prefix) === 0
                                );
                            })))
                );
            });
            if (!rawId || !supported) return run("details", "", null, done);
            return run(
                "details",
                ctx!.base +
                    "/meta/movie/" +
                    encodeURIComponent(rawId) +
                    ".json",
                function (data: any) {
                    var item = movie(data.meta, ctx!.language, true, true);
                    if (item.id !== id) throw new Error("different movie");
                    return { item: item, ok: true };
                },
                done
            );
        });
    }

    function standardCategories(
        done: (result: TorrentDiscoveryResult) => void
    ) {
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
                    if (!Array.isArray(data.genres)) throw new Error("genres");
                    values = data.genres;
                }
                if (values.length > 100) throw new Error("genres size");
                var seen: { [key: string]: boolean } = {};
                values.forEach(function (value: any) {
                    var title = plain(addon ? value : value && value.name, 128);
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
    }

    function standardDetails(
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
              encodeURIComponent(locale) +
              "&append_to_response=external_ids";
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
    }

    return {
        cancel: cancel,
        categories: categoryRequest,
        details: detailRequest,
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
