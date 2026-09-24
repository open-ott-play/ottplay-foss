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
    dispose(): void;
    load(target: any, callback: VPortalCompletion): void;
    play(item: any): void;
    resolve(item: any, done: (item: any) => void): void;
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
    var revision = 0;
    var disposed = false;
    var pending: any = null;
    var dialogHandler: any = null;
    var previousDialogHandler: any = null;
    var qualityHandler: any = null;

    function translate(text: string): string {
        return typeof w._ === "function" ? w._(text) : text;
    }

    function isCurrent(token: number): boolean {
        return (
            !disposed &&
            token === revision &&
            (!options.isCurrent || options.isCurrent())
        );
    }

    function hideBusy(): void {
        if (dialogHandler && w.dialogBoxKeyHandler === dialogHandler) {
            jq("#dialogbox").hide();
            w.dialogBoxKeyHandler = previousDialogHandler;
        }
        dialogHandler = null;
        previousDialogHandler = null;
    }

    function cancel(): void {
        revision++;
        var request = pending;
        pending = null;
        if (request && typeof request.abort === "function") request.abort();
        hideBusy();
        if (qualityHandler && w.selectBoxKeyHandler === qualityHandler) {
            w.selectBoxKeyHandler = null;
            jq("#numprog").hide();
        }
        qualityHandler = null;
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

    function reportError(): void {
        // API errors can echo the request key. Never display or log their bodies.
        if (typeof w.alert === "function")
            w.alert(translate("VPortal request failed"));
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
        guard: () => boolean
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
        var finished = false;
        showBusy();
        try {
            var xhr = jq.ajax({
                complete: function (): void {
                    finished = true;
                    if (!isCurrent(token)) return;
                    pending = null;
                    hideBusy();
                    complete();
                },
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(
                    native ? body : { params: body, url: portal.url }
                ),
                dataType: "json",
                error: function (_xhr: any, status: string): void {
                    if (isCurrent(token) && guard() && status !== "abort")
                        reportError();
                },
                success: function (data: any): void {
                    if (isCurrent(token)) accept(data);
                },
                timeout: 30000,
                type: "POST",
                url: native
                    ? portal.url
                    : String(w.host || "").replace(/\/$/, "") + "/vportal/api",
                vportalRequest: true,
            });
            if (!finished && isCurrent(token)) pending = xhr;
        } catch (_error) {
            if (!isCurrent(token)) return;
            hideBusy();
            if (guard()) reportError();
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
        sourceTarget(record);
        if (item.adult || (parent && parent.adult)) record.adult = 1;
        if (item.type === "stream") {
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

    function load(target: any, callback: VPortalCompletion): void {
        cancel();
        var token = revision;
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

    function play(item: any, resolved?: (item: any) => void): void {
        cancel();
        if (!item || !isCurrent(revision)) return;
        if (
            options.sourceId &&
            (item.request || item.vportalSource) &&
            item.vportalSource !== options.sourceId
        ) {
            reportError();
            return;
        }
        var token = revision;
        var view = w._mediaLoadState;
        function current(): boolean {
            return isCurrent(token) && view === w._mediaLoadState;
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
                    if (result) reportError();
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
                    reportError();
                    return;
                }
                if (names.length < 2 || typeof w.showSelectBox !== "function") {
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
                        if (index >= 0 && index < names.length)
                            start(variants[names[index]]);
                    },
                    -1,
                    !!resolved
                );
                // showSelectBox closes the old list, which deliberately cancels pending work.
                token = revision;
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
            current
        );
    }

    return {
        cancel: cancel,
        dispose: function (): void {
            cancel();
            disposed = true;
        },
        load: load,
        play: play,
        resolve: function (item: any, done: (item: any) => void) {
            play(item, done);
        },
    };
}

(window as any).parseVPortalLink = parseVPortalLink;
(window as any).createVPortalClient = createVPortalClient;
