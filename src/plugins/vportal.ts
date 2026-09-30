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
    /** Explicit same-origin installation API; never resolved through the upstream proxy. */
    directEndpoint?: string;
    isCurrent?: () => boolean;
    preferDefault?: boolean;
    sourceId?: string;
    title?: string;
}

export interface VPortalClient {
    cancel(): void;
    dispose(): void;
    load(target: any, callback: VPortalCompletion): void;
    play(item: any): void;
    resolve(item: any, done: (item: any) => void, automatic?: boolean): void;
    stop(url?: string): void;
}

/** The provider owns this instance, so replacing its settings invalidates all work. */
export function createVPortalClient(
    link: string,
    options: VPortalOptions = {}
): VPortalClient | null {
    var direct = options.directEndpoint;
    if (direct && !/^\/[a-z0-9][a-z0-9/_-]*$/i.test(direct)) return null;
    var parsed = direct ? { key: "", url: direct } : parseVPortalLink(link);
    if (!parsed) return null;
    var portal = parsed;
    var w = window as any;
    var jq = w.jQuery || w.$;
    var native = Boolean(
        w.__TAURI__ ||
            (w.Capacitor &&
                (typeof w.Capacitor.isNativePlatform !== "function" ||
                    w.Capacitor.isNativePlatform()))
    );
    var nasOrigin =
        direct && w.location
            ? String(w.location.protocol) + "//" + String(w.location.host)
            : native && /^https?:\/\/[^/]+\/nas\/api$/i.test(portal.url)
              ? portal.url.slice(0, -8)
              : "";
    var revision = 0;
    var disposed = false;
    var pending: any = null;
    var dialogHandler: any = null;
    var previousDialogHandler: any = null;
    var qualityHandler: any = null;
    var openingQuality = false;
    var preferredQuality = "";
    var mediaSession: {
        stop: string;
        url: string;
        started: boolean;
        heartbeat: string;
        timer?: number;
        pending?: any;
    } | null = null;
    var releases = 0;
    var releaseWaiters: Array<() => void> = [];

    function sessionUrl(value: any): string {
        if (!nasOrigin || typeof value !== "string") return "";
        if (
            value.slice(0, nasOrigin.length).toLowerCase() !==
            nasOrigin.toLowerCase()
        )
            return "";
        var path = value.slice(nasOrigin.length);
        return /^\/nas\/stream\/[a-z0-9_-]+\.[a-z0-9_-]+\/media\.[a-z0-9]{1,8}$/i.test(
            path
        )
            ? direct
                ? path
                : value
            : "";
    }

    function releaseUrl(value: any): void {
        var path = sessionUrl(value);
        if (!path) return;
        releases++;
        var finished = false;
        function complete(): void {
            if (finished) return;
            finished = true;
            if (--releases) return;
            var waiting = releaseWaiters;
            releaseWaiters = [];
            waiting.forEach(function (next) {
                next();
            });
        }
        try {
            jq.ajax({
                complete: complete,
                dataType: "text",
                timeout: 5000,
                type: "GET",
                url: path,
            });
        } catch (_) {
            complete();
        }
    }

    function stop(url?: string): void {
        var session = mediaSession;
        if (!session || (url && session.url !== url)) return;
        mediaSession = null;
        w.clearInterval(session.timer);
        if (session.pending) session.pending.abort();
        releaseUrl(session.stop);
    }

    function heartbeat(session: NonNullable<typeof mediaSession>): void {
        if (!session.heartbeat || session.timer !== undefined) return;
        session.timer = w.setInterval(function () {
            if (mediaSession !== session || session.pending) return;
            var finished = false;
            try {
                var pending = jq.ajax({
                    complete: function () {
                        finished = true;
                        session.pending = null;
                    },
                    dataType: "text",
                    timeout: 5000,
                    type: "GET",
                    url: session.heartbeat,
                });
                if (!finished && mediaSession === session)
                    session.pending = pending;
            } catch (_) {
                /* A failed heartbeat must not interrupt playback or display credentials. */
            }
        }, 30000);
    }

    function afterRelease(next: () => void): void {
        if (releases) releaseWaiters.push(next);
        else next();
    }

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
        var handler = dialogHandler;
        var previous = previousDialogHandler;
        dialogHandler = null;
        previousDialogHandler = null;
        if (handler && w.dialogBoxKeyHandler === handler) {
            w.dialogBoxKeyHandler = previous;
            jq("#dialogbox").hide();
        }
    }

    function cancel(): void {
        var token = ++revision;
        if (mediaSession && !mediaSession.started && !openingQuality) stop();
        var request = pending;
        pending = null;
        if (request && typeof request.abort === "function") request.abort();
        if (token !== revision) return;
        hideBusy();
        if (token !== revision) return;
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
        var body = copyRequest(params);
        body.app = "ott-play";
        if (!direct) body.key = portal.key;
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
                    native || direct ? body : { params: body, url: portal.url }
                ),
                dataType: "json",
                error: function (_xhr: any, status: string): void {
                    if (isCurrent(token) && guard() && status !== "abort")
                        reportError();
                },
                success: function (data: any): void {
                    if (isCurrent(token) && guard()) accept(data);
                    else if (data) releaseUrl(data.stop);
                },
                timeout: 30000,
                type: "POST",
                url:
                    native || direct
                        ? portal.url
                        : String(w.host || "").replace(/\/$/, "") +
                          "/vportal/api",
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

    function load(target: any, callback: VPortalCompletion): void {
        var token = revision + 1;
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
        var token = revision + 1;
        cancel();
        if (!item || !isCurrent(token)) return;
        if (
            options.sourceId &&
            (item.request || item.vportalSource) &&
            item.vportalSource !== options.sourceId
        ) {
            reportError();
            return;
        }
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
            var session = mediaSession;
            if (session) {
                var lifecycle =
                    result &&
                    ((result.sessions && result.sessions[url]) ||
                        (url === result.url && result));
                session.stop = lifecycle ? lifecycle.stop : "";
                session.heartbeat = sessionUrl(
                    lifecycle && lifecycle.heartbeat
                );
                session.url = url;
                session.started = true;
            }
            try {
                if (resolved) resolved(playable);
                else w._playMedia(playable);
                if (session && mediaSession === session) heartbeat(session);
            } catch (error) {
                if (mediaSession === session) stop();
                throw error;
            }
        }
        stop();
        if (!item.request || typeof item.request !== "object") {
            afterRelease(function () {
                start(item.stream_url);
            });
            return;
        }
        var result: any = null;
        afterRelease(function () {
            if (!current()) return;
            request(
                item.request,
                token,
                function (data): void {
                    if (current()) {
                        result = data;
                        if (nasOrigin && data && data.stop)
                            mediaSession = {
                                heartbeat: "",
                                started: false,
                                stop: data.stop,
                                url: data.url || "",
                            };
                    } else if (data) releaseUrl(data.stop);
                },
                function (): void {
                    if (!current()) {
                        if (mediaSession && !mediaSession.started) stop();
                        return;
                    }
                    if (!result || result.type === "error") {
                        if (mediaSession && !mediaSession.started) stop();
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
                        if (mediaSession && !mediaSession.started) stop();
                        reportError();
                        return;
                    }
                    if (
                        automatic ||
                        options.preferDefault ||
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
                    openingQuality = true;
                    try {
                        w.showSelectBox(
                            selected,
                            names.map(metadataText),
                            function (index: number) {
                                if (
                                    current() &&
                                    index >= 0 &&
                                    index < names.length
                                ) {
                                    preferredQuality = names[index];
                                    start(variants[names[index]]);
                                }
                            },
                            -1,
                            !!resolved
                        );
                    } finally {
                        openingQuality = false;
                    }
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
                        if (code === keys.RETURN || code === keys.EXIT)
                            cancel();
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
        });
    }

    return {
        cancel: cancel,
        dispose: function (): void {
            disposed = true;
            cancel();
            stop();
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
        stop: function (url?: string) {
            if (!nasOrigin || (mediaSession && url && mediaSession.url !== url))
                return;
            cancel();
            stop(url);
        },
    };
}

(window as any).parseVPortalLink = parseVPortalLink;
(window as any).createVPortalClient = createVPortalClient;

/** A local installation advertises its catalog without exposing a NAS/Plex access key. */
export function createNasLibrary(host: any): any {
    var revision = 0;
    var pending: any = null;
    var source: any = null;
    var api: any;
    function retire(): void {
        var previous = source;
        source = null;
        if (!previous) return;
        if (host.__ottMedia && host.__ottMedia.usesSource(previous))
            host.__ottMedia.useSource(null);
        previous.client.dispose();
    }
    function init(): void {
        var token = ++revision;
        if (pending && typeof pending.abort === "function") pending.abort();
        pending = null;
        // Native shells use explicitly configured VPortal links and their normal transport.
        if (
            !host.location ||
            !/^https?:$/.test(host.location.protocol) ||
            host.__TAURI__ ||
            (host.Capacitor &&
                (typeof host.Capacitor.isNativePlatform !== "function" ||
                    host.Capacitor.isNativePlatform()))
        )
            return;
        var jq = host.jQuery || host.$;
        if (!jq || typeof jq.ajax !== "function") return;
        var finished = false;
        try {
            var request = jq.ajax({
                cache: false,
                complete: function () {
                    finished = true;
                    if (token === revision) pending = null;
                },
                contentType: "application/json",
                dataType: "json",
                success: function (config: any): void {
                    if (token !== revision) return;
                    if (
                        !config ||
                        config.enabled !== true ||
                        config.api !== "/nas/api" ||
                        typeof config.sourceId !== "string" ||
                        !/^[a-z0-9:_-]{1,160}$/i.test(config.sourceId)
                    ) {
                        retire();
                        return;
                    }
                    if (source && source.sourceId === config.sourceId) return;
                    retire();
                    var title =
                        typeof config.title === "string" && config.title.trim()
                            ? config.title.trim().slice(0, 120)
                            : "Synology";
                    var next: any = {
                        read: function (key: string) {
                            // A fresh NAS namespace must never claim the active provider's legacy journal.
                            return typeof host.stbGetItem === "function"
                                ? host.stbGetItem("installation:" + key)
                                : null;
                        },
                        sourceId: config.sourceId,
                        title: title,
                        write: function (key: string, value: string) {
                            if (typeof host.stbSetItem === "function")
                                host.stbSetItem("installation:" + key, value);
                        },
                    };
                    next.client = createVPortalClient("", {
                        directEndpoint: config.api,
                        isCurrent: function () {
                            return (
                                source === next &&
                                host.__ottMedia.usesSource(next)
                            );
                        },
                        preferDefault: true,
                        sourceId: next.sourceId,
                        title: title,
                    });
                    if (!next.client) return;
                    source = next;
                    if (typeof host.__ottNasLibraryChanged === "function")
                        host.__ottNasLibraryChanged();
                },
                timeout: 5000,
                type: "GET",
                url: "/nas/config",
            });
            if (!finished && token === revision) pending = request;
        } catch (_) {
            /* An absent optional installation must never block startup. */
        }
    }
    api = {
        available: function () {
            return !!source;
        },
        dispose: function () {
            revision++;
            if (pending && typeof pending.abort === "function") pending.abort();
            pending = null;
            retire();
        },
        init: init,
        open: function () {
            if (!source || !host.__ottMedia) return;
            host.__ottMedia.useSource(source);
            host.__ottMedia.open(null, source.title);
        },
        title: function () {
            return source ? metadataText(source.title) : "Synology";
        },
    };
    return api;
}
(window as any).__ottNasLibrary = createNasLibrary(window);
(window as any).popNasMedia = function () {
    (window as any).__ottNasLibrary.open();
};
