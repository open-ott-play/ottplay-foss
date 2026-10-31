/** Local indexer metadata. Only opaque references leave the owned companion. */
function createTorznabData(ports: any): any {
    var generation = 0,
        disposed = false,
        sources: any[] = [],
        categories: any[] = [],
        pending: any[] = [],
        cached: any = Object.create(null);
    function cancel(): void {
        generation++;
        var requests = pending;
        pending = [];
        requests.forEach(function (controller) {
            controller.abort();
        });
    }
    function fail(error: any): any {
        var code = String(error?.message || "unavailable");
        return {
            error: /^torznab_(?:invalid_(?:source|link|query|category|xml|page)|local_only|search_unavailable|source_(?:missing|changed|limit)|reference_missing|busy|cancelled|timeout|network_error|http_error|response_limit|xml_limit|api_error|store_(?:unavailable|busy|limit))$/.test(
                code
            )
                ? code
                : "unavailable",
            ok: false,
        };
    }
    function request(op: string, params: any): Promise<any> {
        var ticket = generation,
            controller = ports.controller?.();
        if (controller) pending.push(controller);
        function release(): void {
            var index = pending.indexOf(controller);
            if (index >= 0) pending.splice(index, 1);
        }
        return Promise.resolve()
            .then(function () {
                if (!context(ticket)) throw new Error("torznab_cancelled");
                return ports.request(op, params, controller?.signal);
            })
            .then(
                function (result) {
                    release();
                    return result;
                },
                function (error) {
                    release();
                    throw error;
                }
            );
    }
    function context(ticket: number): boolean {
        return !disposed && generation === ticket;
    }
    function initialize(): Promise<void> {
        var ticket = generation;
        return request("list", {}).then(function (result) {
            if (result?.schema !== 1 || !Array.isArray(result.sources))
                throw new Error("unavailable");
            if (!context(ticket)) return;
            sources = result.sources.filter(function (source: any) {
                return (
                    /^[a-z][a-z0-9-]{0,63}$/.test(source.id) &&
                    typeof source.label === "string"
                );
            });
            var values: any[] = [];
            var pending = Promise.resolve();
            sources.forEach(function (source: any) {
                pending = pending.then(function () {
                    if (!context(ticket)) return;
                    return request("caps", { sourceId: source.id }).then(
                        function (caps) {
                            values.push({ caps: caps, source: source });
                        },
                        function () {
                            values.push({ caps: null, source: source });
                        }
                    );
                });
            });
            return pending.then(function () {
                if (!context(ticket)) return;
                categories = [];
                values.forEach(function (value) {
                    var source = value.source,
                        caps = value.caps;
                    categories.push({
                        categoryIds: [],
                        id: "catalog:torznab:" + source.id + ":all",
                        searchSupported: caps?.searchAvailable !== false,
                        sourceId: source.id,
                        title: source.label,
                    });
                    (caps?.categories || []).forEach(function (cat: any) {
                        if (
                            !Number.isInteger(cat.id) ||
                            cat.id < 0 ||
                            typeof cat.name !== "string"
                        )
                            return;
                        categories.push({
                            categoryIds: [cat.id],
                            id: "catalog:torznab:" + source.id + ":" + cat.id,
                            searchSupported: caps.searchAvailable !== false,
                            sourceId: source.id,
                            title: source.label + " / " + cat.name,
                        });
                    });
                });
            });
        });
    }
    function selection(id: string): any {
        return (
            categories.filter(function (cat) {
                return cat.id === id;
            })[0] || categories[0]
        );
    }
    function languageRank(item: any): number {
        var preferred = String(ports.language?.() || "")
            .toLowerCase()
            .split(/[-_]/)[0];
        var aliases: any = {
            de: ["de", "deu", "ger", "german"],
            en: ["en", "eng", "english"],
            es: ["es", "spa", "spanish"],
            fr: ["fr", "fra", "fre", "french"],
            it: ["it", "ita", "italian"],
            ru: ["ru", "rus", "russian"],
        };
        var wanted = aliases[preferred] || [preferred];
        var languages = Array.isArray(item.languages) ? item.languages : [];
        return languages.some(function (value: any) {
            return wanted.indexOf(String(value).toLowerCase()) >= 0;
        })
            ? 0
            : languages.length
              ? 2
              : 1;
    }
    function page(
        id: string,
        query: string,
        cursor: number | null,
        done: any
    ): void {
        cancel();
        var ticket = generation;
        var ready = categories.length ? Promise.resolve() : initialize();
        ready
            .then(function () {
                if (!context(ticket)) return;
                var cat = selection(id);
                if (!cat) {
                    done({ error: "not_configured", ok: false });
                    return;
                }
                return request("search", {
                    categoryIds: cat.categoryIds,
                    limit: 50,
                    offset: cursor || 0,
                    query: query,
                    sourceId: cat.sourceId,
                }).then(function (result) {
                    if (!context(ticket)) return;
                    if (
                        result?.schema !== 1 ||
                        result.sourceId !== cat.sourceId ||
                        !Array.isArray(result.items)
                    )
                        throw new Error("unavailable");
                    var items = result.items
                        .slice(0, 100)
                        .map(function (item: any, index: number) {
                            if (
                                !/^[0-9a-f]{32}$/.test(item.resultRef) ||
                                typeof item.title !== "string"
                            )
                                return null;
                            var row = {
                                description: [
                                    Number.isFinite(item.size)
                                        ? (item.size / 1073741824).toFixed(2) +
                                          " GiB"
                                        : "",
                                    Number.isFinite(item.seeders)
                                        ? item.seeders + " seeders"
                                        : "",
                                    (item.languages || []).join(", "),
                                ]
                                    .filter(Boolean)
                                    .join(" · "),
                                id:
                                    "torznab:" +
                                    cat.sourceId +
                                    ":" +
                                    item.resultRef,
                                position: index,
                                poster: "",
                                rank: languageRank(item),
                                resultRef: item.resultRef,
                                sourceId: cat.sourceId,
                                title: item.title,
                            };
                            cached[row.id] = row;
                            return row;
                        })
                        .filter(Boolean)
                        .sort(function (a: any, b: any) {
                            return a.rank - b.rank || a.position - b.position;
                        });
                    // The companion bounds transient references; do not retain an unbounded second copy.
                    var keys = Object.keys(cached);
                    keys.slice(0, Math.max(0, keys.length - 512)).forEach(
                        function (key) {
                            delete cached[key];
                        }
                    );
                    done({
                        catalog: {
                            id: cat.id,
                            searchSupported: cat.searchSupported,
                            title: cat.title,
                        },
                        items: items,
                        next: result.nextOffset,
                        ok: true,
                    });
                });
            })
            .catch(function (error) {
                if (context(ticket)) done(fail(error));
            });
    }
    return {
        cancel: cancel,
        categories: function (done: any) {
            cancel();
            var ticket = generation;
            initialize().then(
                function () {
                    if (context(ticket))
                        done({ categories: categories, ok: true });
                },
                function (error) {
                    if (context(ticket)) done(fail(error));
                }
            );
        },
        details: function (id: string, done: any) {
            done({ item: cached[id], ok: !!cached[id] });
        },
        dispose: function () {
            disposed = true;
            cancel();
            cached = Object.create(null);
        },
        load: function (category: string, cursor: number | null, done: any) {
            page(category, "", cursor, done);
        },
        lookup: function (movie: any, done: any) {
            cancel();
            var ticket = generation;
            request("prepare", {
                resultRef: movie.resultRef,
                sourceId: movie.sourceId,
            })
                .then(function (result) {
                    if (!context(ticket)) return;
                    if (
                        result?.sourceId !== movie.sourceId ||
                        !/^[0-9a-f]{32}$/.test(result.sourceRef)
                    )
                        throw new Error("unavailable");
                    done({
                        items: [
                            {
                                addon: { name: "Torznab" },
                                description: movie.description,
                                id:
                                    "torznab:" +
                                    movie.sourceId +
                                    ":" +
                                    result.sourceRef,
                                kind: "local-torrent",
                                source:
                                    "ottplay-local-torrent:" +
                                    movie.sourceId +
                                    "/" +
                                    result.sourceRef,
                                sourceId: movie.sourceId,
                                sourceRef: result.sourceRef,
                                title: movie.title,
                            },
                        ],
                        ok: true,
                    });
                })
                .catch(function (error) {
                    if (context(ticket)) done(fail(error));
                });
        },
        reset: function () {
            cancel();
            categories = [];
            sources = [];
            cached = Object.create(null);
        },
        search: function (
            query: string,
            cursor: number | null,
            done: any,
            category: string
        ) {
            page(category, query, cursor, done);
        },
    };
}
(window as any).__ottTorznabData = { create: createTorznabData };
