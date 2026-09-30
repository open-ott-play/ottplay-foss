import { caselessKey } from "../utils/caseless";
import { metadataImageUrl, metadataText } from "../utils/helpers";

export interface VPortalLink {
    key: string;
    url: string;
}

/** Decode only the bracket syntax; URL escapes and the opaque key stay intact. */
export function parseVPortalLink(value: unknown): VPortalLink | null {
    if (typeof value !== "string") return null;
    var link = value.trim();
    if (/[\u0000-\u001f\u007f]/.test(link)) return null;
    var match =
        /^portal::(?:\[|%5b)key:([^\[\]\s<>"\\]{1,1024}?)(?:\]|%5d)(https?:\/\/[^\s<>"\\]+)$/i.exec(
            link
        );
    if (!match) return null;
    var endpoint = match[2];
    // Credentials, fragments and ambiguous authorities have no place in an API URL.
    if (
        !/^https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?(?:[/?][^#]*)?$/i.test(
            endpoint
        )
    )
        return null;
    return { key: match[1], url: endpoint };
}

/** A hosted installation publishes exact provider routes, never an open relay. */
export function hostedVPortalRoute(
    endpoint: string,
    profile: any
): string | null {
    if (
        !profile ||
        profile.version !== 1 ||
        !profile.vportal ||
        !Array.isArray(profile.vportal.routes)
    )
        return null;
    var selected: string | null = null;
    for (var index = 0; index < profile.vportal.routes.length; index++) {
        var route = profile.vportal.routes[index];
        if (!route || route.upstream !== endpoint) continue;
        if (
            selected !== null ||
            typeof route.path !== "string" ||
            !/^\/vportal\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.path)
        )
            return null;
        selected = route.path;
    }
    return selected;
}

interface VPortalCompletion {
    isCurrent?: () => boolean;
    (): void;
}

interface VPortalOptions {
    isCurrent?: () => boolean;
    sourceId?: string;
    title?: string;
}

export interface VPortalClient {
    cancel(): void;
    cancelAutomatic(): void;
    dispose(): void;
    load(target: any, callback: VPortalCompletion): void;
    play(item: any): void;
    resolve(item: any, done: (item: any) => void, automatic?: boolean): void;
    search(
        query: string,
        done: (result: { items: any[]; error?: string }) => void,
        isCurrent?: () => boolean
    ): () => void;
}

interface VPortalRequestLane {
    pending: any;
    revision: number;
}

/** The provider owns this instance, so replacing its settings invalidates all work. */
export function createVPortalClient(
    link: string,
    options: VPortalOptions = {}
): VPortalClient | null {
    var parsed = parseVPortalLink(link);
    if (!parsed) return null;
    var portal = parsed;
    var w = window as any;
    var jq = w.jQuery || w.$;
    var foreground: VPortalRequestLane = { pending: null, revision: 0 };
    var background: VPortalRequestLane = { pending: null, revision: 0 };
    var searchLane: VPortalRequestLane = { pending: null, revision: 0 };
    var stopSearch: (() => void) | null = null;
    var disposed = false;
    var dialogHandler: any = null;
    var previousDialogHandler: any = null;
    var qualityHandler: any = null;
    var preferredQuality = "";

    function translate(text: string): string {
        return typeof w._ === "function" ? w._(text) : text;
    }

    function isCurrent(
        token: number,
        lane: VPortalRequestLane = foreground
    ): boolean {
        return (
            !disposed &&
            token === lane.revision &&
            (!options.isCurrent || options.isCurrent())
        );
    }

    function hideBusy(): void {
        var handler = dialogHandler;
        var previous = previousDialogHandler;
        dialogHandler = null;
        previousDialogHandler = null;
        if (handler && w.dialogBoxKeyHandler === handler) {
            w.dialogBoxKeyHandler = previous;
            jq("#dialogbox").hide();
        }
    }

    function cancelAutomatic(): void {
        ++background.revision;
        var request = background.pending;
        background.pending = null;
        if (request && typeof request.abort === "function") request.abort();
    }

    function cancel(): void {
        var token = ++foreground.revision;
        var request = foreground.pending;
        foreground.pending = null;
        // Invalidate all lanes before abort callbacks can start newer work.
        if (stopSearch) stopSearch();
        cancelAutomatic();
        if (request && typeof request.abort === "function") request.abort();
        if (token !== foreground.revision) return;
        hideBusy();
        if (token !== foreground.revision) return;
        var picker = qualityHandler;
        qualityHandler = null;
        if (picker && w.selectBoxKeyHandler === picker) {
            w.selectBoxKeyHandler = null;
            jq("#numprog").hide();
        }
    }

    function showBusy(): void {
        previousDialogHandler = w.dialogBoxKeyHandler;
        dialogHandler = function (code: number): void {
            var keys = w.keys || {};
            if (
                code !== keys.RETURN &&
                code !== keys.EXIT &&
                code !== keys.STOP
            )
                return;
            cancel();
            if (typeof w.closeList === "function") w.closeList();
            if (code === keys.STOP && typeof w.stbStop === "function")
                w.stbStop();
        };
        w.dialogBoxKeyHandler = dialogHandler;
        jq("#dialogbox")
            .html(metadataText(translate("Download! Wait ...")))
            .show();
    }

    function reportError(automatic = false): void {
        // API errors can echo the request key. Never display or log their bodies.
        var notify = automatic ? w.showShift : w.alert;
        if (typeof notify === "function")
            notify.call(w, translate("VPortal request failed"));
    }

    function copyRequest(value: any): any {
        var result: any = {};
        if (value && typeof value === "object" && !Array.isArray(value)) {
            Object.keys(value).forEach(function (key) {
                if (
                    key !== "__proto__" &&
                    key !== "constructor" &&
                    key !== "prototype" &&
                    key !== "app" &&
                    key !== "key"
                )
                    result[key] = value[key];
            });
        }
        return result;
    }

    function sourceTarget(target: any): any {
        if (options.sourceId) target.vportalSource = options.sourceId;
        return target;
    }

    function request(
        params: any,
        token: number,
        accept: (data: any) => void,
        complete: () => void,
        guard: () => boolean,
        lane: VPortalRequestLane = foreground
    ): void {
        var native = Boolean(
            w.__TAURI__ ||
                (w.Capacitor &&
                    (typeof w.Capacitor.isNativePlatform !== "function" ||
                        w.Capacitor.isNativePlatform()))
        );
        var body = copyRequest(params);
        body.app = "ott-play";
        body.key = portal.key;
        var hosted = !native && w.__OTTPLAY_HOSTED__ !== undefined;
        var endpoint: string | null =
            String(w.host || "").replace(/\/$/, "") + "/vportal/api";
        if (native) endpoint = portal.url;
        else if (hosted)
            endpoint = hostedVPortalRoute(portal.url, w.__OTTPLAY_HOSTED__);
        var finished = false;
        var automatic = lane === background;
        var visible = lane === foreground;
        if (visible) showBusy();
        try {
            if (!endpoint)
                throw new Error("VPortal endpoint is not configured");
            var xhr = jq.ajax({
                complete: function (): void {
                    if (finished) return;
                    finished = true;
                    if (lane === searchLane && !guard()) return;
                    if (!isCurrent(token, lane)) return;
                    lane.pending = null;
                    if (visible) hideBusy();
                    complete();
                },
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(
                    native || hosted ? body : { params: body, url: portal.url }
                ),
                dataType: "json",
                error: function (_xhr: any, status: string): void {
                    if (
                        !finished &&
                        lane !== searchLane &&
                        isCurrent(token, lane) &&
                        guard() &&
                        status !== "abort"
                    )
                        reportError(automatic);
                },
                success: function (data: any): void {
                    if (lane === searchLane && !guard()) return;
                    if (!finished && isCurrent(token, lane)) accept(data);
                },
                timeout: 30000,
                type: "POST",
                url: endpoint,
                vportalRequest: true,
            });
            if (!finished && isCurrent(token, lane)) lane.pending = xhr;
        } catch (_error) {
            if (!isCurrent(token, lane)) return;
            if (visible) hideBusy();
            if (lane !== searchLane && guard()) reportError(automatic);
            complete();
        }
    }

    function description(item: any, parent: any): string {
        var parts = ["<b>" + metadataText(item.title || "") + "</b>"];
        ["year", "duration", "agelimit", "description"].forEach(
            function (field) {
                var value = item[field] || (parent && parent[field]);
                if (value !== undefined && value !== null && value !== "")
                    parts.push(metadataText(value));
            }
        );
        return parts.join("<br>");
    }

    function media(item: any, parent: any): any {
        if (!item || typeof item !== "object") return null;
        if (
            item.type !== "stream" &&
            item.type !== "category" &&
            item.type !== "multistream"
        )
            return null;
        var title = String(item.title || "");
        if (parent && parent.type === "multistream" && parent.title)
            title = String(parent.title) + " - " + title;
        var record: any = {
            description: description(item, parent),
            logo_30x30: metadataImageUrl(
                item.imglr ||
                    item.img ||
                    (parent && (parent.imglr || parent.img))
            ),
            title: title,
        };
        if (item.type === "multistream") record.__ottMediaFilterable = true;
        sourceTarget(record);
        if (item.adult || (parent && parent.adult)) record.adult = 1;
        if (item.type === "stream") {
            if (parent && parent.type === "multistream")
                record.__ottMediaSequence = true;
            if (item.request && typeof item.request === "object")
                record.request = copyRequest(item.request);
            record.stream_url = validStream(item.url)
                ? item.url
                : record.request
                  ? "vportal:request"
                  : "";
        } else
            record.playlist_url = sourceTarget({
                mediaName: title,
                request: copyRequest(item.request),
            });
        return record;
    }

    function validStream(value: any): boolean {
        return (
            typeof value === "string" && /^https?:\/\/[^\s<>]+$/i.test(value)
        );
    }

    function directProviderId(item: any): any {
        var fields = [
            "id",
            "fid",
            "stream_id",
            "itemId",
            "media_id",
            "episode_id",
        ];
        for (var index = 0; index < fields.length; index++) {
            var value = item[fields[index]];
            if (
                (typeof value === "string" && value) ||
                (typeof value === "number" && isFinite(value))
            )
                return { field: fields[index], value: String(value) };
        }
        return null;
    }

    function search(
        query: string,
        done: (result: { items: any[]; error?: string }) => void,
        guard?: () => boolean
    ): () => void {
        if (stopSearch) stopSearch();
        query = String(query || "").trim();
        var token = ++searchLane.revision;
        var active = true;
        var timer: any = null;
        var deadline = Date.now() + 25000;
        var folded = caselessKey(query);
        var items: any[] = [];
        var tasks: any[] = [];
        var requests: { [key: string]: boolean } = Object.create(null);
        var folders: { [key: string]: boolean } = Object.create(null);
        var playables: { [key: string]: boolean } = Object.create(null);
        var pageCount = 0;
        var rowCount = 0;
        var canonicalBytes = 0;

        function cancelSearch(): void {
            if (!active) return;
            active = false;
            if (timer !== null) w.clearTimeout(timer);
            tasks = [];
            if (stopSearch === cancelSearch) stopSearch = null;
            if (token !== searchLane.revision) return;
            ++searchLane.revision;
            var pending = searchLane.pending;
            searchLane.pending = null;
            if (pending && typeof pending.abort === "function") pending.abort();
        }

        function current(): boolean {
            if (!active) return false;
            if (!isCurrent(token, searchLane) || (guard && !guard())) {
                cancelSearch();
                return false;
            }
            return true;
        }

        function finish(error?: string): void {
            if (!current()) return;
            var result = error ? { error: error, items: [] } : { items: items };
            cancelSearch();
            done(result);
        }

        function fail(): void {
            finish("VPortal search could not collect a complete result");
        }

        // Sorted request keys detect cycles even if the provider reorders JSON keys.
        function key(value: any, limit = 65536): string {
            function ordered(input: any, depth: number): any {
                if (depth > 12) throw new Error();
                if (!input || typeof input !== "object") return input;
                if (Array.isArray(input))
                    return input.map(function (part: any) {
                        return ordered(part, depth + 1);
                    });
                var result = Object.create(null);
                Object.keys(input)
                    .sort()
                    .forEach(function (name) {
                        result[name] = ordered(input[name], depth + 1);
                    });
                return result;
            }
            var valueKey = JSON.stringify(ordered(value, 0));
            // Reserve UTF-16 storage across all identity maps and page signatures.
            // Charge repeated keys too, keeping the bound conservative on old TVs.
            canonicalBytes += valueKey ? valueKey.length * 2 : 0;
            if (
                !valueKey ||
                valueKey.length > limit ||
                canonicalBytes > 2097152
            )
                throw new Error();
            return valueKey;
        }

        function folderContext(item: any, parent: any): any {
            var context: any = { type: "multistream" };
            [
                "title",
                "year",
                "duration",
                "agelimit",
                "description",
                "imglr",
                "img",
            ].forEach(function (field) {
                context[field] = item[field] || (parent && parent[field]);
            });
            if (parent && parent.title && item.title)
                context.title = parent.title + " - " + item.title;
            if (item.adult || (parent && parent.adult)) context.adult = 1;
            return context;
        }

        function collection(
            params: any,
            parent: any,
            ancestors: string[]
        ): any {
            if (!params || typeof params !== "object" || Array.isArray(params))
                throw new Error();
            var copied = copyRequest(params);
            if (!Object.keys(copied).length) throw new Error();
            copied.limit = 300;
            var identity = key(copied);
            if (ancestors.indexOf(identity) !== -1) throw new Error();
            if (folders[identity]) return null;
            folders[identity] = true;
            return {
                ancestors: ancestors.concat([identity]),
                pages: Object.create(null),
                params: copied,
                parent: parent,
            };
        }

        function next(): void {
            if (!current()) return;
            if (Date.now() >= deadline) {
                finish(
                    "VPortal search timed out before collecting all results"
                );
                return;
            }
            try {
                while (tasks.length) {
                    if (Date.now() >= deadline) {
                        finish(
                            "VPortal search timed out before collecting all results"
                        );
                        return;
                    }
                    var task = tasks.pop();
                    if (task.item) {
                        var item = task.item;
                        if (
                            !task.parent &&
                            caselessKey(String(item.title || "")).indexOf(
                                folded
                            ) === -1
                        )
                            continue;
                        if (item.type === "stream") {
                            var record = media(item, task.context);
                            if (
                                !record ||
                                !record.stream_url ||
                                (record.request &&
                                    !Object.keys(record.request).length)
                            )
                                throw new Error();
                            var identity = key(
                                record.request || record.stream_url
                            );
                            if (playables[identity]) continue;
                            playables[identity] = true;
                            if (items.length >= 2000) throw new Error();
                            var title = task.parent
                                ? task.parent.title
                                : "[" + query + "]";
                            record.__ottMediaOrigin = {
                                kind: "catalog",
                                target: sourceTarget({
                                    mediaName: title,
                                    request: copyRequest(task.params),
                                }),
                                title: title,
                            };
                            if (!record.request)
                                record.__ottVPortalDirect = {
                                    id: directProviderId(item),
                                    occurrence: task.occurrence,
                                    title: String(item.title || ""),
                                };
                            items.push(record);
                        } else if (
                            item.type === "multistream" ||
                            (task.parent && item.type === "category")
                        ) {
                            var child = collection(
                                item.request,
                                folderContext(item, task.context),
                                task.ancestors
                            );
                            if (child) tasks.push(child);
                        }
                        continue;
                    }
                    var requestKey = key(task.params);
                    if (requests[requestKey] || ++pageCount > 100)
                        throw new Error();
                    requests[requestKey] = true;
                    var response: any = null;
                    request(
                        task.params,
                        token,
                        function (data): void {
                            if (current()) response = data;
                        },
                        function (): void {
                            if (!current()) return;
                            try {
                                acceptPage(task, response);
                            } catch (_error) {
                                fail();
                                return;
                            }
                            next();
                        },
                        current,
                        searchLane
                    );
                    return;
                }
                finish();
            } catch (_error) {
                fail();
            }
        }

        function acceptPage(task: any, data: any): void {
            if (
                !data ||
                ["videoportal", "category", "multistream"].indexOf(
                    data.type
                ) === -1 ||
                !Array.isArray(data.items) ||
                data.truncated
            )
                throw new Error();
            rowCount += data.items.length;
            if (rowCount > 10000) throw new Error();
            var rows: any[] = [];
            var nextPage: any = null;
            data.items.forEach(function (item: any) {
                if (!item || typeof item !== "object") throw new Error();
                if (item.type === "next") {
                    if (nextPage) throw new Error();
                    nextPage = item;
                } else rows.push(item);
            });
            var signature = key(
                rows.map(function (item) {
                    return [item.type, item.title, item.request, item.url];
                }),
                2000000
            );
            if (rows.length && task.pages[signature]) throw new Error();
            task.pages[signature] = true;
            var context = folderContext(task.parent || {}, data);
            context.type = task.parent ? "multistream" : "category";
            // Response metadata can add an adult flag, but cannot replace the
            // matched series title or discard metadata from an earlier page.
            context.title = task.parent ? task.parent.title : "";
            if (nextPage) {
                var params = copyRequest(task.params);
                var supplied = copyRequest(nextPage.request);
                Object.keys(supplied).forEach(function (name) {
                    params[name] = supplied[name];
                });
                if (supplied.offset === undefined)
                    params.offset =
                        Math.max(0, Number(task.params.offset) || 0) +
                        rows.length;
                params.limit = 300;
                var offset = Number(params.offset);
                if (
                    params.cmd !== task.params.cmd ||
                    params.query !== task.params.query ||
                    !isFinite(offset) ||
                    Math.floor(offset) !== offset ||
                    offset <= (Number(task.params.offset) || 0)
                )
                    throw new Error();
                tasks.push({
                    ancestors: task.ancestors,
                    pages: task.pages,
                    params: params,
                    parent: task.parent ? context : null,
                });
            } else if (
                data.has_more ||
                data.hasMore ||
                (typeof data.total === "number" &&
                    data.total >
                        (Number(task.params.offset) || 0) + rows.length)
            ) {
                throw new Error();
            }
            var occurrences: { [key: string]: number } = Object.create(null);
            var rowOccurrences: number[] = [];
            rows.forEach(function (item) {
                var title = String(item.title || "");
                var occurrence = occurrences[title] || 0;
                rowOccurrences.push(occurrence);
                if (item.type === "stream") occurrences[title] = occurrence + 1;
            });
            for (var index = rows.length - 1; index >= 0; index--)
                tasks.push({
                    ancestors: task.ancestors,
                    context: context,
                    item: rows[index],
                    occurrence: rowOccurrences[index],
                    params: task.params,
                    parent: task.parent ? context : null,
                });
        }

        stopSearch = cancelSearch;
        if (!current()) return cancelSearch;
        if (!folded || query.length > 1024) {
            finish("VPortal search requires a title filter");
            return cancelSearch;
        }
        timer = w.setTimeout(function () {
            finish("VPortal search timed out before collecting all results");
        }, 25000);
        tasks.push(collection({ cmd: "search", query: query }, null, []));
        next();
        return cancelSearch;
    }

    function load(target: any, callback: VPortalCompletion): void {
        var token = foreground.revision + 1;
        cancel();
        if (!isCurrent(token)) return;
        var view = w._mediaLoadState;
        function current(): boolean {
            return (
                isCurrent(token) &&
                view === w._mediaLoadState &&
                (!callback.isCurrent || callback.isCurrent())
            );
        }
        if (!current()) return;
        var name = options.title || "VPortal";
        if (target === "" || target == null)
            target = sourceTarget({ mediaName: name, request: {} });
        else if (typeof target === "string" && /^search(?:\?|$)/.test(target)) {
            var query = target.slice(target.indexOf("=") + 1);
            try {
                query = decodeURIComponent(query);
            } catch (_error) {
                /* Legacy literal percent escapes remain searchable. */
            }
            target = sourceTarget({
                mediaName: "[" + query + "]",
                request: { cmd: "search", query: query },
            });
        }
        if (
            !target ||
            typeof target !== "object" ||
            (options.sourceId && target.vportalSource !== options.sourceId)
        ) {
            w.mediaRecords = [];
            reportError();
            callback();
            return;
        }
        name = target.mediaName || name;
        if (target.a === "filters" || target.a === "filter") {
            var values = target.a === "filters" ? target.filters : target.items;
            w.mediaRecords = [];
            if (Array.isArray(values))
                values.forEach(function (value: any): void {
                    if (!value || typeof value !== "object") return;
                    w.mediaRecords.push({
                        description: metadataText(value.title),
                        playlist_url: sourceTarget(
                            target.a === "filters"
                                ? {
                                      a: "filter",
                                      items: value.items,
                                      mediaName: value.title,
                                  }
                                : {
                                      mediaName: value.title,
                                      request: copyRequest(value.request),
                                  }
                        ),
                        title: String(value.title || ""),
                    });
                });
            w.mediaName = name;
            callback();
            return;
        }
        var params = copyRequest(target.request);
        params.limit = Math.max(
            1,
            Math.min(1000, Number(w.sPageSize) * 10 || 300)
        );
        var records: any[] = [];
        request(
            params,
            token,
            function (data): void {
                if (!current()) return;
                if (
                    !data ||
                    (data.type !== "videoportal" &&
                        data.type !== "category" &&
                        data.type !== "multistream") ||
                    !Array.isArray(data.items)
                ) {
                    reportError();
                    return;
                }
                var next: any = null;
                data.items.forEach(function (item: any): void {
                    if (item && item.type === "next") next = item;
                    else {
                        var record = media(item, data);
                        if (record) records.push(record);
                    }
                });
                if (next) {
                    var page = copyRequest(params);
                    var supplied = copyRequest(next.request);
                    Object.keys(supplied).forEach(function (key) {
                        page[key] = supplied[key];
                    });
                    if (supplied.offset === undefined)
                        page.offset =
                            Math.max(0, Number(params.offset) || 0) +
                            data.items.filter(function (item: any) {
                                return item && item.type !== "next";
                            }).length;
                    if (
                        page.offset > (Number(params.offset) || 0) ||
                        Object.keys(supplied).some(function (key) {
                            return page[key] !== params[key];
                        })
                    )
                        records.push({
                            playlist_url: sourceTarget({
                                mediaName: name,
                                request: page,
                            }),
                            title: translate("Next"),
                        });
                }
                if (data.controls && data.controls.search)
                    records.push({
                        playlist_url: "search",
                        search_on: 1,
                        title: translate("Search"),
                    });
                if (data.controls && Array.isArray(data.controls.filters))
                    records.push({
                        playlist_url: sourceTarget({
                            a: "filters",
                            filters: data.controls.filters,
                            mediaName: translate("Filters"),
                        }),
                        title: translate("Filters"),
                    });
            },
            function (): void {
                if (!current()) return;
                w.mediaRecords = records;
                w.mediaName = name;
                callback();
            },
            current
        );
    }

    function play(
        item: any,
        resolved?: (item: any) => void,
        automatic = false
    ): void {
        var lane = automatic ? background : foreground;
        var token = lane.revision + 1;
        if (automatic) cancelAutomatic();
        else cancel();
        if (!item || !isCurrent(token, lane)) return;
        if (
            options.sourceId &&
            (item.request || item.vportalSource) &&
            item.vportalSource !== options.sourceId
        ) {
            reportError(automatic);
            return;
        }
        var view = w._mediaLoadState;
        function current(): boolean {
            return (
                isCurrent(token, lane) &&
                (automatic || view === w._mediaLoadState)
            );
        }
        function start(url: string): void {
            if (!current() || !validStream(url)) return;
            // History may hold the selected object itself. The core must compare
            // its previous URL with the newly resolved URL before updating it.
            var playable = copyRequest(item);
            playable.stream_url = url;
            if (resolved) resolved(playable);
            else w._playMedia(playable);
        }
        if (!item.request || typeof item.request !== "object") {
            if (automatic && item.__ottVPortalQueue) {
                var direct = item.__ottVPortalDirect;
                var origin = item.__ottMediaOrigin;
                var target = origin && origin.target;
                if (
                    !direct ||
                    !target ||
                    !target.request ||
                    typeof target.request !== "object" ||
                    Array.isArray(target.request) ||
                    !Object.keys(target.request).length ||
                    (options.sourceId &&
                        target.vportalSource !== options.sourceId)
                ) {
                    reportError(true);
                    return;
                }
                var page: any = null;
                var pageReceived = false;
                request(
                    target.request,
                    token,
                    function (data): void {
                        if (current()) {
                            pageReceived = true;
                            page = data;
                        }
                    },
                    function (): void {
                        if (!current()) return;
                        if (!page) {
                            if (pageReceived) reportError(true);
                            return;
                        }
                        if (
                            ["videoportal", "category", "multistream"].indexOf(
                                page.type
                            ) === -1 ||
                            !Array.isArray(page.items) ||
                            page.items.length > 10000 ||
                            page.truncated
                        ) {
                            reportError(true);
                            return;
                        }
                        var matches: any[] = [];
                        var occurrence = 0;
                        page.items.forEach(function (candidate: any): void {
                            if (!candidate || candidate.type !== "stream")
                                return;
                            if (direct.id) {
                                var id = candidate[direct.id.field];
                                if (
                                    (typeof id === "string" ||
                                        typeof id === "number") &&
                                    String(id) === direct.id.value
                                )
                                    matches.push(candidate);
                            } else if (
                                String(candidate.title || "") === direct.title
                            ) {
                                if (occurrence++ === direct.occurrence)
                                    matches.push(candidate);
                            }
                        });
                        var fresh = matches.length === 1 ? matches[0] : null;
                        if (
                            !fresh ||
                            (fresh.request &&
                                typeof fresh.request === "object") ||
                            !validStream(fresh.url)
                        ) {
                            reportError(true);
                            return;
                        }
                        start(fresh.url);
                    },
                    current,
                    lane
                );
                return;
            }
            start(item.stream_url);
            return;
        }
        var result: any = null;
        request(
            item.request,
            token,
            function (data): void {
                if (current()) result = data;
            },
            function (): void {
                if (!current()) return;
                if (!result || result.type === "error") {
                    if (result) reportError(automatic);
                    return;
                }
                var variants = result.variants;
                var names =
                    variants && typeof variants === "object"
                        ? Object.keys(variants).filter(function (name) {
                              return validStream(variants[name]);
                          })
                        : [];
                var url = validStream(result.url)
                    ? result.url
                    : names.length
                      ? variants[names[0]]
                      : "";
                if (!url) {
                    reportError(automatic);
                    return;
                }
                if (
                    automatic ||
                    names.length < 2 ||
                    typeof w.showSelectBox !== "function"
                ) {
                    if (automatic && names.indexOf(preferredQuality) !== -1)
                        url = variants[preferredQuality];
                    start(url);
                    return;
                }
                var selected = 0;
                names.forEach(function (name, index) {
                    if (variants[name] === url) selected = index;
                });
                w.showSelectBox(
                    selected,
                    names.map(metadataText),
                    function (index: number) {
                        if (current() && index >= 0 && index < names.length) {
                            preferredQuality = names[index];
                            start(variants[names[index]]);
                        }
                    },
                    -1,
                    !!resolved
                );
                // showSelectBox closes the old list, which deliberately cancels pending work.
                token = foreground.revision;
                view = w._mediaLoadState;
                var picker = w.selectBoxKeyHandler;
                qualityHandler = function (code: number): boolean {
                    if (!current()) {
                        cancel();
                        return true;
                    }
                    var keys = w.keys || {};
                    if (code === keys.STOP) {
                        cancel();
                        if (typeof w.stbStop === "function") w.stbStop();
                        return true;
                    }
                    var handled =
                        typeof picker === "function" ? picker(code) : false;
                    if (code === keys.RETURN || code === keys.EXIT) cancel();
                    return handled;
                };
                var screen = w.__ottClassicScreenPort;
                if (
                    screen &&
                    typeof screen.decorateOwnedCallback === "function"
                )
                    qualityHandler = screen.decorateOwnedCallback(
                        "picker",
                        picker,
                        qualityHandler
                    );
                else w.selectBoxKeyHandler = qualityHandler;
            },
            current,
            lane
        );
    }

    return {
        cancel: cancel,
        cancelAutomatic: cancelAutomatic,
        dispose: function (): void {
            disposed = true;
            cancel();
        },
        load: load,
        play: play,
        resolve: function (
            item: any,
            done: (item: any) => void,
            automatic?: boolean
        ) {
            play(item, done, automatic);
        },
        search: search,
    };
}

(window as any).parseVPortalLink = parseVPortalLink;
(window as any).createVPortalClient = createVPortalClient;
