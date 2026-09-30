/** The provider/UI codec is the only media module that reads the classic host. */
var mediaClassicInstance: any = null;
var mediaClassicSource = "";
var mediaClassicProvider: any = null;
var mediaClassicPlayback: any = null;

/** Installation libraries own their loader and storage independently of TV providers. */
interface ClassicMediaSource {
    client: any;
    read(key: string): string | null;
    sourceId: string;
    title: string;
    write(key: string, value: string): void;
}
var mediaClassicContext: ClassicMediaSource | null = null;
var mediaClassicContextRevision = 0;

function classicMediaSourceId(): string {
    return mediaClassicContext
        ? mediaClassicContext.sourceId
        : (window as any).__ottSourceIdentity.media(window);
}

function classicMediaClient(): any {
    return mediaClassicContext
        ? mediaClassicContext.client
        : (window as any).providerMediaClient;
}

function serializeMediaIdentity(value: any): string {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(serializeMediaIdentity).join(",") + "]";
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
                return (
                    JSON.stringify(key) +
                    ":" +
                    serializeMediaIdentity(value[key])
                );
            })
            .join(",") +
        "}"
    );
}

function classicMediaRuntime(): any {
    var w = window as any;
    var context = mediaClassicContext;
    var mediaClient = classicMediaClient();
    var source = classicMediaSourceId();
    var provider = context ? context.client.load : w.getMediaArray;
    if (
        mediaClassicInstance &&
        mediaClassicInstance.active() &&
        mediaClassicSource === source &&
        mediaClassicProvider === provider
    )
        return mediaClassicInstance;
    var previous = mediaClassicInstance;
    mediaClassicInstance = null;
    if (previous) previous.cancel();
    if (
        mediaClassicInstance ||
        context !== mediaClassicContext ||
        source !== classicMediaSourceId()
    )
        return classicMediaRuntime();
    mediaClassicSource = source;
    mediaClassicProvider = provider;
    // A playing installation keeps its journal and catalog when another library is browsed.
    if (
        context &&
        mediaClassicPlayback &&
        mediaClassicPlayback.runtime.active()
    ) {
        mediaClassicInstance = mediaClassicPlayback.runtime;
        mediaClassicInstance.restoreProjection();
        return mediaClassicInstance;
    }
    var get = context ? context.read : w.providerGetItem;
    var set = context ? context.write : w.providerSetItem;
    var copy = w.__ottMediaLibrary.copy;
    var library: any;
    var checkpointTime = 0;
    var checkpointItem = "";
    var rendering = false;
    var filterText = "";
    var pendingStart: any = null;
    var automaticRequest: any = null;
    var automaticGeneration = 0;
    var screenOwner: any = null;
    var screenRevision = -1;
    function bindScreen() {
        var screen = w.__ottClassicScreenPort;
        var owner = screen && screen.listOwner();
        if (!owner) return;
        var revision = library.revision();
        if (screenOwner === owner && screenRevision === revision) return;
        screenOwner = owner;
        screenRevision = revision;
        owner.own(function () {
            if (!rendering && revision === library.revision()) api.cancel();
        });
    }
    function current() {
        return (
            context === mediaClassicContext &&
            source === classicMediaSourceId() &&
            (context
                ? provider === context.client.load
                : provider === w.getMediaArray &&
                  get === w.providerGetItem &&
                  set === w.providerSetItem)
        );
    }
    function ownsPlayback() {
        return (
            context &&
            mediaClassicPlayback &&
            mediaClassicPlayback.runtime === api
        );
    }
    function persistent() {
        return current() || ownsPlayback();
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
                return row && typeof row === "object" && !row.__ottMediaFilter;
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
                    id = "request:" + serializeMediaIdentity(row.request);
                else {
                    var origin = row.__ottMediaOrigin || route;
                    var location = origin.target || "";
                    var titleKey = serializeMediaIdentity([location, title]);
                    var occurrence = titles[titleKey] || 0;
                    titles[titleKey] = occurrence + 1;
                    // Providers without IDs get a catalog-local identity, never a signed stream URL.
                    id =
                        "catalog:" +
                        serializeMediaIdentity([location, title, occurrence]);
                }
                var identity = { itemId: id, sourceId: source };
                payload.__ottMediaRef = identity;
                if (!payload.__ottMediaOrigin && route.kind === "catalog")
                    payload.__ottMediaOrigin = copy(route);
                return { payload: payload, ref: identity, title: title };
            });
    }
    function entry(item: MediaLibraryItem, position = 0) {
        var payload = copy(item.payload);
        // Direct sources resolve access URLs afresh; journals keep stable IDs only.
        if (mediaClient && typeof mediaClient.persist === "function")
            payload = mediaClient.persist(payload);
        return {
            itemId: item.ref.itemId,
            payload: payload,
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
        legacyId: context ? source : w.__ottSourceIdentity.legacy(w),
        limit: limit,
        read: function (key: string) {
            if (!persistent()) throw new Error("Media source replaced");
            var result = typeof get === "function" ? get.call(w, key) : null;
            if (!persistent()) throw new Error("Media source replaced");
            return result;
        },
        sourceId: source,
        write: function (key: string, value: string) {
            if (!persistent() || w.sFavorites === -1)
                throw new Error("Media persistence unavailable");
            if (typeof set === "function") set.call(w, key, value);
        },
    });
    function collections() {
        var document = journal.read().document;
        if (!current()) return document;
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
        (view as any).filter = filterText;
        var frame = view.frame;
        // Provider codecs may append incremental rows to this full-page projection.
        w.mediaRecords = library
            .catalog()
            .filter(function (item: MediaLibraryItem) {
                return !item.payload.__ottMediaRoute;
            })
            .map(function (item: MediaLibraryItem) {
                return item.payload;
            });
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
            project(library.snapshot("none"), false);
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
            if (current() && classicMediaClient())
                classicMediaClient().cancel();
        };
    }
    function collectionItems(kind: string) {
        collections();
        return describe(kind === "history" ? w.medHistory : w.medFavorites, {
            kind: kind as any,
            title: "",
        });
    }
    function normalizedFilter(value: string) {
        return value
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/\s+/g, " ")
            .trim();
    }
    var libraryPorts = {
        describe: function (records: any[], route: MediaRoute) {
            var items = describe(records, route);
            if (
                library.snapshot("none").frames.length === 1 &&
                w.sFavorites !== -1
            ) {
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
        filter: function (items: MediaLibraryItem[], route: MediaRoute) {
            if (route.kind === "variants") return items;
            var query = normalizedFilter(filterText);
            var result = items.filter(function (item) {
                var payload = item.payload;
                return (
                    !query ||
                    (route.kind === "catalog" && payload.__ottMediaSequence) ||
                    !(
                        payload.__ottMediaFilterable ||
                        (!payload.playlist_url &&
                            (payload.stream_url || payload.request))
                    ) ||
                    normalizedFilter(item.title).indexOf(query) !== -1
                );
            });
            var title = w._("Filter") + ": " + filterText;
            result.push({
                payload: { __ottMediaFilter: true, title: title },
                ref: { itemId: "view:filter", sourceId: source },
                title: title,
            });
            return result;
        },
        items: function (route: MediaRoute) {
            return route.kind === "variants"
                ? describe(route.target || [], route)
                : collectionItems(route.kind);
        },
        load: load,
        render: project,
    };
    library = w.__ottMediaLibrary.create(libraryPorts);
    // Background episode resolution must not revoke catalogue or editor ownership.
    var automaticLibrary = w.__ottMediaLibrary.create(libraryPorts);
    function cancelNavigationAuto() {
        var admitted = library.capture();
        api.cancelAuto();
        return current() && admitted();
    }
    function navigate(route: MediaRoute, reset = false) {
        if (cancelNavigationAuto()) library.open(route, reset);
    }
    function sequenceFor(item: MediaLibraryItem) {
        if (!item.payload.__ottMediaSequence) return null;
        var frame = library.snapshot("current").frame;
        if (!frame || frame.route.kind !== "catalog") return null;
        var items = frame.items.filter(function (row: MediaLibraryItem) {
            return (
                row.payload.__ottMediaSequence &&
                !row.payload.playlist_url &&
                (row.payload.stream_url || row.payload.request)
            );
        });
        var index = -1;
        items.forEach(function (row: MediaLibraryItem, position: number) {
            if (row.ref.itemId === item.ref.itemId) index = position;
        });
        return index < 0 ? null : { index: index, items: items };
    }
    function resolve(
        item: MediaLibraryItem,
        sequence: any = null,
        automatic = false,
        guard: () => boolean = current,
        dispatched?: () => void
    ) {
        if (!automatic && !cancelNavigationAuto()) return;
        var request = {};
        if (automatic) automaticRequest = request;
        function valid() {
            return (
                current() &&
                guard() &&
                (!automatic || automaticRequest === request)
            );
        }
        (automatic ? automaticLibrary : library).resolve(
            function (done: any) {
                bindScreen();
                var abortLoad: any = null;
                function accept(payload: any) {
                    if (!done.isCurrent() || !valid()) return;
                    payload.__ottMediaRef = copy(item.ref);
                    delete payload.__ottMediaRefresh;
                    var client = classicMediaClient();
                    if (client && typeof client.resolve === "function")
                        client.resolve(payload, done, automatic);
                    else done(payload);
                }
                var origin = item.payload.__ottMediaOrigin;
                if (
                    item.payload.__ottMediaRefresh &&
                    // Installation requests resolve stable IDs directly, independent of catalog pagination.
                    !(
                        item.payload.request &&
                        (context || (mediaClient && mediaClient.stableRequests))
                    ) &&
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
                    if (current() && classicMediaClient()) {
                        var client = classicMediaClient();
                        if (
                            automatic &&
                            typeof client.cancelAutomatic === "function"
                        )
                            client.cancelAutomatic();
                        else client.cancel();
                    }
                };
            },
            function (payload: any) {
                if (!valid() || !payload) return;
                if (automatic) automaticRequest = null;
                if (!automatic && typeof w.closeList === "function")
                    w.closeList();
                var start = {
                    automatic: automatic,
                    ref: item.ref,
                    sequence: sequence,
                    valid: guard,
                };
                var previousPlayback = mediaClassicPlayback;
                pendingStart = start;
                try {
                    w._playMedia(payload, automatic);
                } finally {
                    if (pendingStart === start) pendingStart = null;
                }
                var state = w.__ottClassicPlayback.snapshot();
                if (
                    dispatched &&
                    current() &&
                    mediaClassicPlayback &&
                    mediaClassicPlayback !== previousPlayback &&
                    mediaClassicPlayback.ref.itemId === item.ref.itemId &&
                    state.target &&
                    state.target.kind === "vod" &&
                    state.target.channelId === item.ref.itemId &&
                    state.phase !== "stopped"
                )
                    dispatched();
            }
        );
    }
    var api = {
        active: current,
        back: function () {
            if (!cancelNavigationAuto()) return;
            var result = library.back();
            if (!result && w.popupList) w.popupList(w.popMedia);
        },
        cancel: function () {
            var admitted = library.capture();
            api.cancelAuto();
            if (!admitted()) return;
            library.close();
            if (current() && classicMediaClient())
                classicMediaClient().cancel();
        },
        cancelAuto: function () {
            automaticGeneration++;
            if (!automaticRequest) return;
            automaticRequest = null;
            automaticLibrary.cancel();
        },
        capture: function () {
            var valid = library.capture();
            return function () {
                return current() && valid();
            };
        },
        captureAuto: function () {
            var revision = automaticGeneration;
            return function () {
                return current() && automaticGeneration === revision;
            };
        },
        checkpoint: function (ref: MediaRef, position: number, force = false) {
            if (
                !persistent() ||
                !ref ||
                ref.sourceId !== source ||
                !isFinite(position) ||
                position < 0
            )
                return;
            if (
                mediaClassicPlayback &&
                mediaClassicPlayback.ended &&
                mediaClassicPlayback.ref.itemId === ref.itemId &&
                mediaClassicPlayback.ref.sourceId === ref.sourceId
            )
                position = 0;
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
        ended: function (generation: number) {
            var playback = mediaClassicPlayback;
            var sequence = playback && playback.sequence;
            var revision = automaticGeneration;
            function valid() {
                var state = w.__ottClassicPlayback.snapshot();
                return (
                    current() &&
                    mediaClassicPlayback === playback &&
                    automaticGeneration === revision &&
                    state.generation === generation &&
                    state.phase === "stopped" &&
                    state.target &&
                    state.target.kind === "vod" &&
                    state.target.sourceId === source &&
                    state.target.channelId === playback.ref.itemId
                );
            }
            if (!sequence || playback.ended || !valid()) return;
            playback.ended = true;
            api.cancelAuto();
            revision = automaticGeneration;
            automaticRequest = {};
            var admitted = library.capture();
            api.checkpoint(playback.ref, 0, true);
            var index = (sequence.index + 1) % sequence.items.length;
            var item = sequence.items[index];
            function proceed() {
                if (admitted() && valid())
                    resolve(
                        item,
                        { index: index, items: sequence.items },
                        true,
                        valid
                    );
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
        favorite: function (payload: any) {
            if (payload.__ottMediaFilter) return;
            var admitted = api.capture();
            var frame = library.snapshot("none").frame;
            var item = describe(
                [payload],
                frame ? frame.route : { kind: "catalog", target: "", title: "" }
            )[0];
            if (!item || w.sFavorites === -1) return;
            var removing = frame && frame.route.kind === "favorites";
            if (
                !journal.change(
                    removing ? "unfavorite" : "favorite",
                    entry(item)
                ) ||
                !admitted()
            )
                return;
            collections();
            if (!admitted()) return;
            if (removing) {
                var items = collectionItems("favorites");
                if (admitted()) library.replaceItems(items);
            } else if (w.showShift)
                w.showShift(item.title + w._(" added to favorites"));
        },
        filter: function () {
            var frame = library.snapshot("none").frame;
            if (!frame || frame.route.kind === "variants") return;
            var admitted = library.capture();
            w.editCaption = w._("Filter");
            w.editvar = filterText;
            w.setEdit = function () {
                if (!current() || !admitted()) return;
                var value = String(w.editvar || "").trim();
                api.cancelAuto();
                if (!current() || !admitted()) return;
                library.refilter(function () {
                    filterText = value;
                });
            };
            if (typeof w.showEditKey === "function") w.showEditKey();
        },
        highlight: function (index: number, revision: number) {
            if (current() && library.revision() === revision)
                library.highlight(index);
        },
        open: function (target: any, title?: string) {
            var view = library.snapshot("none");
            if (target === null && view.frame) {
                library.show();
                return;
            }
            if (target === -1 || target === -2) {
                navigate({
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
                    navigate({
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
                    serializeMediaIdentity(view.frames[0].route.target) ===
                        serializeMediaIdentity(target));
            navigate(
                {
                    kind: "catalog",
                    target: target === null ? "" : target,
                    title:
                        title ||
                        (reset
                            ? context
                                ? context.title
                                : w._("Media Library")
                            : w.mediaName),
                },
                reset
            );
        },
        playQueue: function (
            records: any[],
            query: string,
            guard: () => boolean,
            dispatched: () => void
        ) {
            var items = describe(records, {
                kind: "catalog",
                target: "search?query=" + encodeURIComponent(query),
                title: query,
            });
            if (!items.length || !current() || !guard()) return;
            items.forEach(function (item: MediaLibraryItem) {
                item.payload.__ottVPortalQueue = true;
            });
            api.cancelAuto();
            var revision = automaticGeneration;
            var generation = w.__ottClassicPlayback.snapshot().generation;
            function valid() {
                return (
                    current() &&
                    guard() &&
                    automaticGeneration === revision &&
                    w.__ottClassicPlayback.snapshot().generation === generation
                );
            }
            var started = false;
            resolve(
                items[0],
                { index: 0, items: items, replace: true },
                true,
                valid,
                function () {
                    started = true;
                    dispatched();
                }
            );
            return function () {
                if (!started && revision === automaticGeneration)
                    api.cancelAuto();
            };
        },
        prepare: function (payload: any, url: string) {
            if (
                payload.__ottMediaRef &&
                payload.__ottMediaRef.sourceId !== source
            )
                return null;
            var item = describe([payload], { kind: "history", title: "" })[0];
            if (!item) return null;
            var start =
                pendingStart && pendingStart.ref.itemId === item.ref.itemId
                    ? pendingStart
                    : null;
            function admitted() {
                return (
                    current() && (!start || !start.automatic || start.valid())
                );
            }
            if (!admitted()) return null;
            var state = w.__ottClassicPlayback.snapshot();
            if (
                !(start && start.sequence && start.sequence.replace) &&
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
            if (!admitted()) return null;
            item.payload.stream_url = url;
            journal.change("visit", entry(item));
            if (!admitted()) return null;
            collections();
            if (!admitted()) return null;
            var departing = mediaClassicPlayback;
            if (
                departing &&
                departing.context &&
                departing.client !== classicMediaClient()
            ) {
                departing.client.stop(departing.payload.stream_url);
                if (!admitted()) return null;
            }
            var ticket = {};
            mediaClassicPlayback = {
                client: classicMediaClient(),
                context: context,
                payload: copy(item.payload),
                ref: item.ref,
                runtime: api,
                sequence: start && start.sequence,
                ticket: ticket,
            };
            return {
                item: item.payload,
                ref: item.ref,
                resume:
                    start && start.automatic
                        ? 0
                        : w.OttPlayCore.mediaResumePosition(
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
            collections();
            project(library.snapshot("none"), false);
        },
        select: function (index: number) {
            var item = library.select(index);
            if (!item) return;
            var admitted = api.capture();
            function proceed() {
                if (!admitted()) return;
                var payload = item.payload;
                if (payload.__ottMediaFilter) api.filter();
                else if (payload.__ottMediaRoute)
                    navigate({
                        kind: payload.__ottMediaRoute,
                        title: item.title,
                    });
                else if (payload.playlist_url) {
                    if (payload.search_on) w.searchMedia(payload);
                    else if (
                        payload.playlist_url === "submenu" &&
                        Array.isArray(payload.submenu)
                    )
                        navigate({
                            kind: "variants",
                            target: payload.submenu,
                            title: item.title,
                        });
                    else api.open(payload.playlist_url, item.title);
                } else if (payload.stream_url || payload.request)
                    resolve(item, sequenceFor(item));
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
        snapshot: function () {
            var view = library.snapshot();
            view.filter = filterText;
            return view;
        },
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
        else if (classicMediaClient()) classicMediaClient().cancel();
    },
    cancelAuto: function () {
        if (mediaClassicInstance) mediaClassicInstance.cancelAuto();
    },
    cancelRequest: function () {
        var client = classicMediaClient();
        if (client) client.cancel();
    },
    capture: function () {
        return classicMediaRuntime().capture();
    },
    captureAuto: function () {
        return classicMediaRuntime().captureAuto();
    },
    checkpoint: function (ref: MediaRef, position: number, force = false) {
        var playback = mediaClassicPlayback;
        var runtime =
            playback &&
            playback.context &&
            ref &&
            playback.ref.sourceId === ref.sourceId &&
            playback.ref.itemId === ref.itemId
                ? playback.runtime
                : classicMediaRuntime();
        runtime.checkpoint(ref, position, force);
    },
    current: function () {
        return mediaClassicPlayback &&
            (mediaClassicPlayback.context ||
                mediaClassicPlayback.ref.sourceId === classicMediaSourceId())
            ? mediaClassicPlayback
            : null;
    },
    ended: function (generation: number) {
        if (mediaClassicInstance) mediaClassicInstance.ended(generation);
    },
    favorite: function (item: any) {
        classicMediaRuntime().favorite(item);
    },
    filter: function () {
        classicMediaRuntime().filter();
    },
    highlight: function (index: number, revision: number) {
        classicMediaRuntime().highlight(index, revision);
    },
    open: function (target: any, title?: string) {
        classicMediaRuntime().open(target, title);
    },
    playbackStop: function (target: any) {
        var playback = mediaClassicPlayback;
        if (
            !playback ||
            !target ||
            target.kind !== "vod" ||
            target.sourceId !== playback.ref.sourceId ||
            target.channelId !== playback.ref.itemId ||
            !target.payload ||
            target.payload.stream_url !== playback.payload.stream_url
        )
            return;
        var client = playback.client;
        if (client && typeof client.stop === "function")
            client.stop(playback.payload.stream_url);
    },
    playQueue: function (
        records: any[],
        query: string,
        guard: () => boolean,
        dispatched: () => void
    ) {
        return classicMediaRuntime().playQueue(
            records,
            query,
            guard,
            dispatched
        );
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
    sourceId: classicMediaSourceId,
    useSource: function (source: ClassicMediaSource | null) {
        if (source === mediaClassicContext) return;
        var token = ++mediaClassicContextRevision;
        var host = window as any;
        var previous = mediaClassicInstance;
        // Capture a final confirmed position before the new storage owner is selected.
        var state =
            previous &&
            host.__ottClassicPlayback &&
            host.__ottClassicPlayback.snapshot();
        mediaClassicInstance = null;
        if (previous) {
            if (state && state.target && state.target.kind === "vod")
                previous.checkpoint(
                    {
                        itemId: state.target.channelId,
                        sourceId: state.target.sourceId,
                    },
                    state.position,
                    true
                );
            if (token !== mediaClassicContextRevision) return;
            previous.cancel();
        }
        if (token !== mediaClassicContextRevision) return;
        mediaClassicContext = source;
        host._mediaLoadState = {};
    },
    usesSource: function (source: ClassicMediaSource) {
        return mediaClassicContext === source;
    },
};
