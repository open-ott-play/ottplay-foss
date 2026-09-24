/** The provider/UI codec is the only media module that reads the classic host. */
var mediaClassicInstance: any = null;
var mediaClassicSource = "";
var mediaClassicProvider: any = null;
var mediaClassicPlayback: any = null;

function mediaCanonical(value: any): string {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(mediaCanonical).join(",") + "]";
    return (
        "{" +
        Object.keys(value)
            .sort()
            .filter(function (key) {
                return (
                    typeof value[key] !== "function" && value[key] !== undefined
                );
            })
            .map(function (key) {
                return JSON.stringify(key) + ":" + mediaCanonical(value[key]);
            })
            .join(",") +
        "}"
    );
}

function classicMediaRuntime(): any {
    var w = window as any;
    var source = w.__ottSourceIdentity.media(w);
    if (
        mediaClassicInstance &&
        mediaClassicSource === source &&
        mediaClassicProvider === w.getMediaArray
    )
        return mediaClassicInstance;
    var previous = mediaClassicInstance;
    mediaClassicInstance = null;
    if (previous) previous.cancel();
    if (mediaClassicInstance || source !== w.__ottSourceIdentity.media(w))
        return classicMediaRuntime();
    mediaClassicSource = source;
    mediaClassicProvider = w.getMediaArray;
    var provider = w.getMediaArray;
    var get = w.providerGetItem;
    var set = w.providerSetItem;
    var copy = w.__ottMediaLibrary.copy;
    var library: any;
    var checkpointTime = 0;
    var checkpointItem = "";
    var rendering = false;
    function bindScreen() {
        var screen = w.__ottClassicScreenPort;
        var owner = screen && screen.listOwner();
        if (!owner) return;
        var revision = library.snapshot().revision;
        owner.own(function () {
            if (!rendering && revision === library.snapshot().revision)
                api.cancel();
        });
    }
    function current() {
        return (
            source === w.__ottSourceIdentity.media(w) &&
            provider === w.getMediaArray
        );
    }
    function limit() {
        return (
            [0, 10, 20, 30, 40, 50][Number(w.sMedCount)] ||
            (Number(w.sMedCount) === 0 ? 0 : 20)
        );
    }
    function describe(records: any[], route: MediaRoute): MediaLibraryItem[] {
        var titles: { [key: string]: number } = Object.create(null);
        return records
            .filter(function (row) {
                return row && typeof row === "object";
            })
            .map(function (row) {
                var payload = copy(row);
                var title = String(
                    row.title || row.name || row.playlist_name || ""
                );
                var ref = row.__ottMediaRef;
                var explicit =
                    row.itemId !== undefined
                        ? row.itemId
                        : row.media_id !== undefined
                          ? row.media_id
                          : row.episode_id !== undefined
                            ? row.episode_id
                            : row.stream_id !== undefined
                              ? row.stream_id
                              : row.id;
                var id: string;
                if (
                    ref &&
                    ref.sourceId === source &&
                    typeof ref.itemId === "string" &&
                    ref.itemId
                )
                    id = ref.itemId;
                else if (
                    explicit !== undefined &&
                    explicit !== null &&
                    String(explicit)
                )
                    id = "provider:" + String(explicit);
                else if (row.request)
                    id = "request:" + mediaCanonical(row.request);
                else {
                    var occurrence = titles[title] || 0;
                    titles[title] = occurrence + 1;
                    // Providers without IDs get a catalog-local identity, never a signed stream URL.
                    id =
                        "catalog:" +
                        mediaCanonical([route.target || "", title, occurrence]);
                }
                var identity = { itemId: id, sourceId: source };
                payload.__ottMediaRef = identity;
                if (!payload.__ottMediaOrigin && route.kind === "catalog")
                    payload.__ottMediaOrigin = copy(route);
                return { payload: payload, ref: identity, title: title };
            });
    }
    function entry(item: MediaLibraryItem, position = 0) {
        return {
            itemId: item.ref.itemId,
            payload: copy(item.payload),
            position: position,
            sourceId: source,
        };
    }
    var journal = w.__ottMediaJournal.create({
        core: w.OttPlayCore,
        enabled: function () {
            return w.sFavorites !== -1;
        },
        importRows: function (rows: any[]) {
            return describe(rows, { kind: "history", title: "" })
                .map(function (item) {
                    item.payload.__ottMediaImported = true;
                    var position = Number(item.payload.current);
                    return entry(
                        item,
                        isFinite(position) && position >= 0 ? position : 0
                    );
                })
                .slice(0, 1000);
        },
        legacyId: w.__ottSourceIdentity.legacy(w),
        limit: limit,
        read: function (key: string) {
            if (!current()) throw new Error("Media source replaced");
            return typeof get === "function" ? get.call(w, key) : null;
        },
        sourceId: source,
        write: function (key: string, value: string) {
            if (!current() || w.sFavorites === -1)
                throw new Error("Media persistence unavailable");
            if (typeof set === "function") set.call(w, key, value);
        },
    });
    function collections() {
        var document = journal.read().document;
        function project(rows: any[]) {
            return rows.map(function (row) {
                var payload = copy(row.payload);
                payload.current = row.position;
                payload.__ottMediaRef = {
                    itemId: row.itemId,
                    sourceId: source,
                };
                payload.__ottMediaRefresh = true;
                return payload;
            });
        }
        w.medHistory = project(document.history);
        w.medFavorites = project(document.favorites);
        return document;
    }
    function project(view: MediaLibraryView, render = true) {
        if (!current()) return;
        var frame = view.frame;
        w.mediaRecords = frame
            ? frame.items.map(function (item) {
                  return copy(item.payload);
              })
            : [];
        w.mediaName = frame ? frame.route.title : "";
        w.mediaNames = view.frames.map(function (row) {
            return row.route.title;
        });
        // Read-only projections for provider codecs. Navigation never reads these arrays back.
        w.mediaUrls = view.frames.map(function (row) {
            return row.route.target === undefined
                ? row.route.kind
                : row.route.target;
        });
        w.mediaSelects = view.frames
            .slice()
            .reverse()
            .map(function (row) {
                return row.selected;
            });
        w.mediaRecordsPar = null;
        if (render && typeof w.__ottRenderMedia === "function") {
            rendering = true;
            try {
                w.__ottRenderMedia(view);
            } finally {
                rendering = false;
            }
            bindScreen();
        }
    }
    function load(route: MediaRoute, done: any) {
        bindScreen();
        if (!current() || typeof provider !== "function") {
            done([], route.title);
            return;
        }
        var marker = {};
        w._mediaLoadState = marker;
        var complete: any = function () {
            if (!complete.isCurrent()) {
                if (mediaClassicInstance)
                    mediaClassicInstance.restoreProjection();
                return;
            }
            var records = w.mediaRecords;
            var title = w.mediaName;
            project(library.snapshot(), false);
            done(copy(records || []), title);
        };
        complete.isCurrent = function () {
            return (
                current() &&
                w._mediaLoadState === marker &&
                (done.active ? done.active() : done.isCurrent())
            );
        };
        complete.publish = function (
            records: any[],
            title?: string,
            selected?: number
        ) {
            if (complete.isCurrent() && done.update)
                done.update(copy(records), title, selected);
        };
        provider(route.target === undefined ? "" : route.target, complete);
        return function () {
            if (current() && w.providerMediaClient)
                w.providerMediaClient.cancel();
        };
    }
    function collectionItems(kind: string) {
        collections();
        return describe(kind === "history" ? w.medHistory : w.medFavorites, {
            kind: kind as any,
            title: "",
        });
    }
    library = w.__ottMediaLibrary.create({
        describe: function (records: any[], route: MediaRoute) {
            var items = describe(records, route);
            if (library.snapshot().frames.length === 1 && w.sFavorites !== -1) {
                if (limit())
                    items.push({
                        payload: {
                            __ottMediaRoute: "history",
                            title: w._("History of watched movies"),
                        },
                        ref: { itemId: "view:history", sourceId: source },
                        title: w._("History of watched movies"),
                    });
                items.push({
                    payload: {
                        __ottMediaRoute: "favorites",
                        title: w._("Favorites"),
                    },
                    ref: { itemId: "view:favorites", sourceId: source },
                    title: w._("Favorites"),
                });
            }
            return items;
        },
        items: function (route: MediaRoute) {
            return route.kind === "variants"
                ? describe(route.target || [], route)
                : collectionItems(route.kind);
        },
        load: load,
        render: project,
    });
    function resolve(item: MediaLibraryItem) {
        library.resolve(
            function (done: any) {
                bindScreen();
                var abortLoad: any = null;
                function accept(payload: any) {
                    if (!done.isCurrent() || !current()) return;
                    payload.__ottMediaRef = copy(item.ref);
                    delete payload.__ottMediaRefresh;
                    var client = w.providerMediaClient;
                    if (client && typeof client.resolve === "function")
                        client.resolve(payload, done);
                    else done(payload);
                }
                var origin = item.payload.__ottMediaOrigin;
                if (
                    item.payload.__ottMediaRefresh &&
                    origin &&
                    origin.kind === "catalog"
                ) {
                    var refreshed: any = function (rows: any[]) {
                        if (!done.isCurrent()) return;
                        var found = describe(rows, origin).filter(
                            function (candidate) {
                                return candidate.ref.itemId === item.ref.itemId;
                            }
                        )[0];
                        if (found) accept(found.payload);
                        else if (typeof w.infoBox === "function")
                            w.infoBox(w._("Media item is no longer available"));
                    };
                    refreshed.isCurrent = done.isCurrent;
                    abortLoad = load(origin, refreshed);
                } else accept(copy(item.payload));
                return function () {
                    if (abortLoad) abortLoad();
                    if (current() && w.providerMediaClient)
                        w.providerMediaClient.cancel();
                };
            },
            function (payload: any) {
                if (!current() || !payload) return;
                if (typeof w.closeList === "function") w.closeList();
                w._playMedia(payload);
            }
        );
    }
    var api = {
        back: function () {
            var result = library.back();
            if (!result && w.popupList) w.popupList(w.popMedia);
        },
        cancel: function () {
            library.close();
            if (current() && w.providerMediaClient)
                w.providerMediaClient.cancel();
        },
        capture: function () {
            var valid = library.capture();
            return function () {
                return current() && valid();
            };
        },
        checkpoint: function (ref: MediaRef, position: number, force = false) {
            if (
                !current() ||
                !ref ||
                ref.sourceId !== source ||
                !isFinite(position) ||
                position < 0
            )
                return;
            var now = Date.now();
            if (
                !force &&
                checkpointItem === ref.itemId &&
                now - checkpointTime < 5000
            )
                return;
            var document = journal.read().document;
            var rows = document.history.concat(document.favorites);
            var found = rows.filter(function (row: any) {
                return row.itemId === ref.itemId;
            })[0];
            if (found) {
                found.position = position;
                if (journal.change("position", found)) {
                    checkpointTime = now;
                    checkpointItem = ref.itemId;
                }
                collections();
            }
        },
        favorite: function (payload: any) {
            var item = describe(
                [payload],
                library.snapshot().frame
                    ? library.snapshot().frame.route
                    : { kind: "catalog", target: "", title: "" }
            )[0];
            if (!item || w.sFavorites === -1) return;
            var frame = library.snapshot().frame;
            var removing = frame && frame.route.kind === "favorites";
            journal.change(removing ? "unfavorite" : "favorite", entry(item));
            collections();
            if (removing) library.replaceItems(collectionItems("favorites"));
            else if (w.showShift)
                w.showShift(item.title + w._(" added to favorites"));
        },
        highlight: function (index: number, revision: number) {
            if (current() && library.snapshot().revision === revision)
                library.select(index);
        },
        open: function (target: any, title?: string) {
            var view = library.snapshot();
            if (target === null && view.frame) {
                library.show();
                return;
            }
            if (target === -1 || target === -2) {
                library.open({
                    kind: target === -1 ? "history" : "favorites",
                    title:
                        target === -1
                            ? w._("History of watched movies")
                            : w._("Favorites"),
                });
                return;
            }
            if (target === "submenu") {
                var item = library.select(w.selIndex);
                if (item && Array.isArray(item.payload.submenu))
                    library.open({
                        kind: "variants",
                        target: item.payload.submenu,
                        title: item.title,
                    });
                return;
            }
            if (
                typeof target === "string" &&
                /^(cmd:info|alert)/.test(target)
            ) {
                var match = /(?:cmd:info|alert)\(([^)]+)\)/.exec(target);
                w.infoBox(match ? match[1] : target);
                return;
            }
            var reset =
                target === null ||
                !view.frame ||
                (view.frames[0].route.kind === "catalog" &&
                    mediaCanonical(view.frames[0].route.target) ===
                        mediaCanonical(target));
            library.open(
                {
                    kind: "catalog",
                    target: target === null ? "" : target,
                    title:
                        title || (reset ? w._("Media Library") : w.mediaName),
                },
                reset
            );
        },
        prepare: function (payload: any, url: string) {
            if (
                payload.__ottMediaRef &&
                payload.__ottMediaRef.sourceId !== source
            )
                return null;
            var item = describe([payload], { kind: "history", title: "" })[0];
            if (!item) return null;
            var state = w.__ottClassicPlayback.snapshot();
            if (
                state.target &&
                state.target.sourceId === source &&
                state.target.channelId === item.ref.itemId &&
                state.target.kind === "vod" &&
                state.phase !== "stopped" &&
                mediaClassicPlayback &&
                mediaClassicPlayback.payload.stream_url === url
            )
                return null;
            var previous = journal.read().document.history.filter(function (
                row: any
            ) {
                return row.itemId === item.ref.itemId;
            })[0];
            item.payload.stream_url = url;
            journal.change("visit", entry(item));
            collections();
            var ticket = {};
            mediaClassicPlayback = {
                payload: copy(item.payload),
                ref: item.ref,
                ticket: ticket,
            };
            return {
                item: item.payload,
                ref: item.ref,
                resume: w.OttPlayCore.mediaResumePosition(
                    previous ? previous.position : 0,
                    60
                ),
                valid: function () {
                    return (
                        current() &&
                        mediaClassicPlayback &&
                        mediaClassicPlayback.ticket === ticket
                    );
                },
            };
        },
        restoreProjection: function () {
            project(library.snapshot(), false);
        },
        select: function (index: number) {
            var item = library.select(index);
            if (!item) return;
            var admitted = api.capture();
            function proceed() {
                if (!admitted()) return;
                var payload = item.payload;
                if (payload.__ottMediaRoute)
                    library.open({
                        kind: payload.__ottMediaRoute,
                        title: item.title,
                    });
                else if (payload.playlist_url) {
                    if (payload.search_on) w.searchMedia(payload);
                    else if (
                        payload.playlist_url === "submenu" &&
                        Array.isArray(payload.submenu)
                    )
                        library.open({
                            kind: "variants",
                            target: payload.submenu,
                            title: item.title,
                        });
                    else api.open(payload.playlist_url, item.title);
                } else if (payload.stream_url || payload.request) resolve(item);
                else if (w.infoMedia) w.infoMedia();
            }
            if (
                Number(item.payload.adult) === 1 &&
                w.sPSchannels &&
                w.parentPIN !== "*" &&
                !w.parentAccess
            )
                w.enterPinAndSetAccess(proceed);
            else proceed();
        },
        show: library.show,
        snapshot: library.snapshot,
        sourceId: source,
    };
    mediaClassicInstance = api;
    collections();
    return api;
}

(window as any).__ottMedia = {
    back: function () {
        classicMediaRuntime().back();
    },
    cancel: function () {
        var host = window as any;
        host._mediaLoadState = {};
        if (mediaClassicInstance) mediaClassicInstance.cancel();
        else if (host.providerMediaClient) host.providerMediaClient.cancel();
    },
    capture: function () {
        return classicMediaRuntime().capture();
    },
    checkpoint: function (ref: MediaRef, position: number, force = false) {
        classicMediaRuntime().checkpoint(ref, position, force);
    },
    current: function () {
        var w = window as any;
        return mediaClassicPlayback &&
            mediaClassicPlayback.ref.sourceId === w.__ottSourceIdentity.media(w)
            ? mediaClassicPlayback
            : null;
    },
    favorite: function (item: any) {
        classicMediaRuntime().favorite(item);
    },
    highlight: function (index: number, revision: number) {
        classicMediaRuntime().highlight(index, revision);
    },
    open: function (target: any, title?: string) {
        classicMediaRuntime().open(target, title);
    },
    prepare: function (item: any, url: string) {
        return classicMediaRuntime().prepare(item, url);
    },
    select: function (index: number) {
        classicMediaRuntime().select(index);
    },
    show: function () {
        classicMediaRuntime().show();
    },
    snapshot: function () {
        return classicMediaRuntime().snapshot();
    },
    sourceId: function () {
        return (window as any).__ottSourceIdentity.media(window);
    },
};
