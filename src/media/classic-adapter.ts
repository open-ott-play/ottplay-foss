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
    var collectionRequest: any = null;
    var shuffleRequest: any = null;
    var completionRequest: any = null;
    var restored = false;
    var repeat = "all";
    var repeatKey = "mediaRepeat.v1:" + source;
    var screenOwner: any = null;
    var screenRevision = -1;
    var pageScheduled = -1;
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
                else if (row.playlist_url && !row.submenu)
                    id = "route:" + serializeMediaIdentity(row.playlist_url);
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
        decorate(view);
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
    function playable(item: MediaLibraryItem) {
        var payload = item.payload;
        return (
            !payload.__ottMediaFilter &&
            !payload.__ottMediaRoute &&
            !payload.playlist_url &&
            !!(payload.stream_url || payload.request)
        );
    }
    function authorize(
        item: MediaLibraryItem,
        proceed: () => void,
        rejected?: () => void
    ) {
        if (
            Number(item.payload.adult) === 1 &&
            w.sPSchannels &&
            w.parentPIN !== "*" &&
            !w.parentAccess
        )
            w.enterPinAndSetAccess(proceed, rejected);
        else proceed();
    }
    function decorate(view: any) {
        view.repeat = repeat;
        view.shuffle = shuffleRequest
            ? "loading"
            : mediaClassicPlayback &&
                mediaClassicPlayback.runtime === api &&
                mediaClassicPlayback.sequence &&
                mediaClassicPlayback.sequence.ordered
              ? "on"
              : "off";
        view.canRepeat = !!(
            !view.loading &&
            view.frame &&
            view.frame.route.kind === "catalog" &&
            view.frame.items.some(playable)
        );
        view.canShuffle = view.canRepeat && canCollect(view.frame.route.target);
    }
    function updateControls() {
        if (!current() || typeof w.__ottUpdateMediaControls !== "function")
            return;
        var view = {};
        decorate(view);
        w.__ottUpdateMediaControls(view);
    }
    function canCollect(target: any) {
        return (
            !mediaClient ||
            typeof mediaClient.canCollect !== "function" ||
            mediaClient.canCollect(target)
        );
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
        page:
            mediaClient && typeof mediaClient.page === "function"
                ? function (route: MediaRoute, done: any) {
                      return mediaClient.page(
                          route.target,
                          function (result: any) {
                              if (!current() || !done.isCurrent()) return;
                              // Replacing the list would dismiss an editor or
                              // dialog opened while the quiet request ran.
                              if (screenOwner && !screenOwner.foreground()) {
                                  library.cancelPage();
                                  return;
                              }
                              var records = copy(result.items || []);
                              if (mediaClient.stableRequests) {
                                  var frame = library.snapshot("none").frame;
                                  if (frame)
                                      records.forEach(function (row: any) {
                                          row.__ottMediaOrigin = copy(
                                              frame.route
                                          );
                                      });
                              }
                              done(records, result.error);
                          }
                      );
                  }
                : undefined,
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
    function sequenceFor(item: MediaLibraryItem, complete = true) {
        var frame =
            complete && item.payload.__ottMediaSequence
                ? library.snapshot("current").frame
                : null;
        if (!frame || frame.route.kind !== "catalog")
            return repeat === "one" && playable(item)
                ? { index: 0, items: [item], repeat: repeat }
                : null;
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
        return index < 0
            ? null
            : { index: index, items: items, repeat: repeat };
    }
    function navigationFor(item: MediaLibraryItem) {
        var origin = item.payload.__ottMediaOrigin;
        if (!origin || origin.kind !== "catalog") return [];
        var saved = item.payload.__ottMediaTrail;
        var trail =
            Array.isArray(saved) &&
            saved.length > 0 &&
            saved.length <= 64 &&
            saved.every(function (frame: any) {
                return (
                    frame &&
                    frame.route &&
                    frame.route.kind === "catalog" &&
                    typeof frame.route.title === "string" &&
                    typeof frame.selected === "number" &&
                    frame.selected >= 0
                );
            })
                ? copy(saved)
                : [];
        if (!trail.length) {
            if (origin.target)
                trail.push({
                    route: {
                        kind: "catalog",
                        target: "",
                        title: context ? context.title : w._("Media Library"),
                    },
                    selected: 0,
                });
            trail.push({ route: copy(origin), selected: 0 });
        }
        // Collected catalogs start at zero even when the saved file was chosen
        // from a later page. Its stable ID supplies the restored selection.
        var last = trail[trail.length - 1];
        last.route = copy(origin);
        if (last.route.target && typeof last.route.target === "object")
            delete last.route.target.offset;
        return trail;
    }
    function collectFolder(
        item: MediaLibraryItem,
        guard: () => boolean,
        done: (folder: any) => void
    ) {
        var origin = item.payload.__ottMediaOrigin;
        if (
            !mediaClient ||
            !mediaClient.stableRequests ||
            typeof mediaClient.collect !== "function" ||
            !origin ||
            origin.kind !== "catalog" ||
            !canCollect(origin.target)
        ) {
            done(null);
            return;
        }
        rememberNavigation(item);
        var revision = automaticGeneration;
        var generation = w.__ottClassicPlayback.snapshot().generation;
        var ticket: any = { cancel: null };
        collectionRequest = ticket;
        var received = false;
        function valid() {
            return (
                current() &&
                guard() &&
                automaticGeneration === revision &&
                w.__ottClassicPlayback.snapshot().generation === generation
            );
        }
        function accept(result: any) {
            if (received || collectionRequest !== ticket || !valid()) return;
            received = true;
            collectionRequest = null;
            var folder: any = false;
            if (result && !result.error && Array.isArray(result.items)) {
                var seen: any = Object.create(null);
                var items = describe(result.items, origin).filter(
                    function (row) {
                        if (!playable(row) || seen[row.ref.itemId])
                            return false;
                        seen[row.ref.itemId] = true;
                        return true;
                    }
                );
                var index = -1;
                items.forEach(function (row, position) {
                    row.payload.__ottMediaTrail = item.payload.__ottMediaTrail;
                    if (row.ref.itemId === item.ref.itemId) index = position;
                });
                // A moved or removed file must never continue in another folder.
                if (index >= 0)
                    folder = {
                        catalog: describe(
                            result.records || result.items,
                            origin
                        ),
                        sequence: {
                            index: index,
                            items: items,
                            repeat: repeat,
                        },
                    };
            }
            done(folder);
        }
        try {
            var cancel = mediaClient.collect(origin.target, accept, valid);
            if (typeof cancel === "function" && !received) {
                if (collectionRequest === ticket && valid())
                    ticket.cancel = cancel;
                else cancel();
            }
        } catch (_) {
            accept(null);
        }
    }
    function rememberNavigation(item: MediaLibraryItem) {
        if (!mediaClient || !mediaClient.stableRequests) return;
        var view = library.snapshot("none");
        if (
            view.frame &&
            view.frame.route.kind === "catalog" &&
            item.payload.__ottMediaOrigin &&
            serializeMediaIdentity(view.frame.route.target) ===
                serializeMediaIdentity(item.payload.__ottMediaOrigin.target)
        )
            item.payload.__ottMediaTrail = view.frames
                .slice(-64)
                .map(function (frame) {
                    return { route: frame.route, selected: frame.selected };
                });
    }
    function restoreFolder(item: MediaLibraryItem, folder: any) {
        var trail = navigationFor(item);
        if (!library.restore(trail, folder.catalog, item.ref)) return false;
        // Every next sibling carries the same breadcrumb, not a playlist copy.
        item.payload.__ottMediaTrail = trail;
        folder.sequence.items.forEach(function (row: MediaLibraryItem) {
            row.payload.__ottMediaTrail = trail;
        });
        project(library.snapshot("none"), false);
        return true;
    }
    function resolve(
        item: MediaLibraryItem,
        sequence: any = null,
        automatic = false,
        guard: () => boolean = current,
        dispatched?: () => void,
        startup?: { position: number; unavailable(): void },
        settled?: () => void
    ) {
        if (!automatic && !cancelNavigationAuto()) return;
        rememberNavigation(item);
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
                if (!valid()) return;
                if (automatic) automaticRequest = null;
                if (!payload) {
                    if (settled) settled();
                    if (startup) startup.unavailable();
                    return;
                }
                if (!automatic && typeof w.closeList === "function")
                    w.closeList();
                var start = {
                    automatic: automatic,
                    ref: item.ref,
                    sequence: sequence,
                    startup: startup,
                    valid: guard,
                };
                var previousPlayback = mediaClassicPlayback;
                pendingStart = start;
                try {
                    w._playMedia(payload, automatic);
                } finally {
                    if (pendingStart === start) pendingStart = null;
                    if (settled) settled();
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
            completionRequest = null;
            shuffleRequest = null;
            var collecting = collectionRequest;
            collectionRequest = null;
            var resolving = automaticRequest;
            automaticRequest = null;
            if (resolving) automaticLibrary.cancel();
            if (collecting && collecting.cancel) collecting.cancel();
            updateControls();
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
        cycleRepeat: function () {
            var admitted = library.capture();
            var completion = completionRequest;
            var reschedule =
                completion && automaticRequest && completion.valid();
            var revision = automaticGeneration + 1;
            api.cancelAuto();
            if (!current() || !admitted() || automaticGeneration !== revision)
                return;
            repeat =
                repeat === "all" ? "one" : repeat === "one" ? "off" : "all";
            if (mediaClassicPlayback && mediaClassicPlayback.runtime === api) {
                var playback = mediaClassicPlayback;
                if (!playback.sequence) {
                    var payload = copy(playback.payload);
                    payload.__ottMediaRefresh = true;
                    playback.sequence = {
                        index: 0,
                        items: [
                            {
                                payload: payload,
                                ref: copy(playback.ref),
                                title: String(playback.payload.title || ""),
                            },
                        ],
                    };
                }
                playback.sequence.repeat = repeat;
            }
            try {
                if (typeof set === "function") set.call(w, repeatKey, repeat);
            } catch (_) {
                // Playback controls remain usable when optional persistence fails.
            }
            if (current() && admitted()) updateControls();
            if (
                reschedule &&
                current() &&
                admitted() &&
                automaticGeneration === revision &&
                mediaClassicPlayback === completion.playback &&
                w.__ottClassicPlayback.snapshot().generation ===
                    completion.generation
            ) {
                // Only the pending natural completion is re-admitted. Old
                // resolver/PIN callbacks retain their cancelled generation.
                completion.playback.ended = false;
                api.ended(completion.generation);
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
            if (!playback || playback.ended || !valid()) return;
            playback.ended = true;
            // A completed standalone item also loses its resume checkpoint.
            // It must not cancel a new shuffle being collected in parallel.
            if (sequence) api.cancelAuto();
            revision = automaticGeneration;
            var admitted = library.capture();
            api.checkpoint(playback.ref, 0, true);
            if (!sequence || !admitted() || !valid()) return;
            var mode = sequence.repeat || "all";
            if (
                !sequence.items.length ||
                (mode === "off" && sequence.index + 1 >= sequence.items.length)
            )
                return;
            automaticRequest = {};
            var completion = {
                generation: generation,
                playback: playback,
                valid: function () {
                    return admitted() && valid();
                },
            };
            completionRequest = completion;
            var index =
                mode === "one"
                    ? sequence.index
                    : (sequence.index + 1) % sequence.items.length;
            var item = sequence.items[index];
            function proceed() {
                if (admitted() && valid())
                    resolve(
                        item,
                        {
                            index: index,
                            items: sequence.items,
                            ordered: sequence.ordered,
                            repeat: mode,
                        },
                        true,
                        valid,
                        function () {
                            if (completionRequest === completion)
                                completionRequest = null;
                        }
                    );
            }
            authorize(item, proceed);
        },
        favorite: function (payload: any) {
            if (payload.__ottMediaFilter || payload.__ottMediaNext) return;
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
            var admitted = api.capture();
            library.cancelPage();
            if (!admitted()) return;
            if (shuffleRequest) {
                var revision = automaticGeneration + 1;
                api.cancelAuto();
                if (!admitted() || automaticGeneration !== revision) return;
            }
            var frame = library.snapshot("none").frame;
            if (!frame || frame.route.kind === "variants") return;
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
            if (!current() || library.revision() !== revision) return;
            library.highlight(index);
            if (pageScheduled === revision || !library.nearEnd(index)) return;
            pageScheduled = revision;
            // Highlight runs inside detail painting. Defer cached responses so
            // the old detail cannot overwrite the newly appended page.
            w.setTimeout(function () {
                if (pageScheduled !== revision) return;
                pageScheduled = -1;
                if (
                    current() &&
                    library.revision() === revision &&
                    (!screenOwner || screenOwner.foreground()) &&
                    !shuffleRequest &&
                    !collectionRequest &&
                    !automaticRequest
                )
                    library.more();
            }, 0);
        },
        open: function (target: any, title?: string) {
            var view = library.snapshot("none");
            if (target === null && view.frame) {
                if (
                    mediaClassicPlayback &&
                    mediaClassicPlayback.runtime === api
                )
                    library.highlightRef(mediaClassicPlayback.ref);
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
            var revision = automaticGeneration + 1;
            api.cancelAuto();
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
            journal.change(
                "visit",
                entry(item, start && start.startup ? start.startup.position : 0)
            );
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
                    start && start.startup
                        ? start.startup.position
                        : start && start.automatic
                          ? 0
                          : w.OttPlayCore.mediaResumePosition(
                                previous ? previous.position : 0,
                                60
                            ),
                resumeStartup: !!(start && start.startup),
                valid: function () {
                    return (
                        current() &&
                        mediaClassicPlayback &&
                        mediaClassicPlayback.ticket === ticket
                    );
                },
            };
        },
        restoreLast: function (onUnavailable?: () => void) {
            if (!current() || restored) return false;
            restored = true;
            if (
                w.sFavorites === -1 ||
                !limit() ||
                !mediaClient ||
                !mediaClient.stableRequests ||
                typeof mediaClient.resolve !== "function" ||
                (mediaClassicPlayback && mediaClassicPlayback.runtime === api)
            )
                return false;
            var saved = journal.read();
            var row = saved.document.history[0];
            if (
                !current() ||
                !saved.writable ||
                !row ||
                row.sourceId !== source ||
                !isFinite(row.position) ||
                row.position <= 0 ||
                !row.payload.request
            )
                return false;
            var payload = copy(row.payload);
            payload.__ottMediaRef = { itemId: row.itemId, sourceId: source };
            payload.__ottMediaRefresh = true;
            var item = describe([payload], { kind: "history", title: "" })[0];
            if (!playable(item)) return false;
            var admitted = library.capture();
            var revision = automaticGeneration + 1;
            api.cancelAuto();
            if (!current() || !admitted() || revision !== automaticGeneration)
                return true;
            if (typeof w.__ottClassicPlayback.reconcile === "function")
                w.__ottClassicPlayback.reconcile();
            var generation = w.__ottClassicPlayback.snapshot().generation;
            function valid() {
                return (
                    current() &&
                    mediaClient === classicMediaClient() &&
                    admitted() &&
                    revision === automaticGeneration &&
                    w.__ottClassicPlayback.snapshot().generation === generation
                );
            }
            function unavailable() {
                if (valid() && onUnavailable) onUnavailable();
            }
            authorize(item, function () {
                if (!valid()) return;
                try {
                    collectFolder(item, valid, function (folder) {
                        if (!valid()) return;
                        if (folder) {
                            if (!restoreFolder(item, folder)) return;
                            admitted = library.capture();
                        }
                        if (valid())
                            resolve(
                                item,
                                folder
                                    ? folder.sequence
                                    : sequenceFor(item, folder !== false),
                                true,
                                valid,
                                undefined,
                                {
                                    position: row.position,
                                    unavailable: unavailable,
                                }
                            );
                    });
                } catch (_) {
                    if (valid()) {
                        automaticRequest = null;
                        unavailable();
                    }
                }
            });
            return true;
        },
        restoreProjection: function () {
            collections();
            project(library.snapshot("none"), false);
        },
        select: function (index: number) {
            var item = library.select(index);
            if (!item) return;
            if (item.payload.__ottMediaNext) {
                library.more(true);
                return;
            }
            var admitted = api.capture();
            library.cancelPage();
            if (!admitted()) return;
            api.cancelAuto();
            if (!admitted()) return;
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
                } else if (payload.stream_url || payload.request) {
                    var revision = automaticGeneration;
                    var generation =
                        w.__ottClassicPlayback.snapshot().generation;
                    collectFolder(item, admitted, function (folder) {
                        if (!admitted()) return;
                        if (folder) {
                            if (!restoreFolder(item, folder)) return;
                            // Retiring the old resolver can synchronously Stop
                            // or replace playback. A new navigation capture must
                            // not erase that cancellation.
                            if (
                                !current() ||
                                automaticGeneration !== revision ||
                                w.__ottClassicPlayback.snapshot().generation !==
                                    generation
                            )
                                return;
                            admitted = api.capture();
                        }
                        if (admitted())
                            resolve(
                                item,
                                folder
                                    ? folder.sequence
                                    : sequenceFor(item, folder !== false)
                            );
                    });
                } else if (w.infoMedia) w.infoMedia();
            }
            authorize(item, proceed);
        },
        show: library.show,
        shufflePlay: function () {
            var view = library.snapshot("none");
            var frame = view.frame;
            if (
                !current() ||
                view.loading ||
                (screenOwner && !screenOwner.foreground()) ||
                !frame ||
                frame.route.kind !== "catalog"
            )
                return;
            if (!canCollect(frame.route.target)) return;
            var admitted = library.capture();
            var revision = automaticGeneration + 1;
            api.cancelAuto();
            if (!current() || !admitted() || automaticGeneration !== revision)
                return;
            var cancelledView = library.revision();
            library.cancel();
            // Revoke manual resolver/PIN ownership too, without changing the
            // frame. An abort callback may navigate elsewhere synchronously.
            if (
                !current() ||
                library.revision() !== cancelledView + 1 ||
                automaticGeneration !== revision
            )
                return;
            // cancel() changes the revision captured by screen disposal and UI
            // highlight callbacks. Rebind both before admitting async work.
            library.show();
            if (
                !current() ||
                library.revision() !== cancelledView + 1 ||
                automaticGeneration !== revision
            )
                return;
            // The shuffle intent belongs to the folder, not its highlighted row.
            admitted = library.capture("frame");
            // This explicit new queue replaces the old queue's future EOS action,
            // while its currently playing video continues during collection.
            if (mediaClassicPlayback && mediaClassicPlayback.runtime === api)
                mediaClassicPlayback.sequence = null;
            var viewRevision = library.revision();
            if (typeof w.__ottClassicPlayback.reconcile === "function")
                w.__ottClassicPlayback.reconcile();
            var generation = w.__ottClassicPlayback.snapshot().generation;
            var ticket: any = { cancel: null };
            collectionRequest = ticket;
            shuffleRequest = ticket;
            var received = false;
            var query = normalizedFilter(filterText);
            function valid() {
                return (
                    current() &&
                    admitted() &&
                    automaticGeneration === revision &&
                    library.revision() === viewRevision &&
                    w.__ottClassicPlayback.snapshot().generation === generation
                );
            }
            function foreground() {
                if (!valid()) return false;
                if (screenOwner && !screenOwner.foreground()) {
                    // A new editor/dialog owns the screen. Retire this intent,
                    // including a provider guard that rejects before delivery.
                    if (shuffleRequest === ticket) api.cancelAuto();
                    return false;
                }
                return true;
            }
            function accept(result: any) {
                if (received || collectionRequest !== ticket || !foreground())
                    return;
                received = true;
                collectionRequest = null;
                var items: MediaLibraryItem[] = [];
                if (result && !result.error && Array.isArray(result.items)) {
                    var seen: { [key: string]: boolean } = Object.create(null);
                    items = describe(result.items, frame!.route).filter(
                        function (item) {
                            if (
                                !playable(item) ||
                                (query &&
                                    normalizedFilter(item.title).indexOf(
                                        query
                                    ) === -1) ||
                                seen[item.ref.itemId]
                            )
                                return false;
                            seen[item.ref.itemId] = true;
                            return true;
                        }
                    );
                }
                if (!items.length) {
                    finish();
                    if (typeof w.infoBox === "function")
                        w.infoBox(
                            w._(
                                result && !result.error
                                    ? "Nothing to play"
                                    : "Unable to load playlist"
                            )
                        );
                    return;
                }
                var ordered = items.slice();
                for (var index = items.length - 1; index > 0; index--) {
                    var selected = Math.floor(Math.random() * (index + 1));
                    var item = items[index];
                    items[index] = items[selected];
                    items[selected] = item;
                }
                function proceed() {
                    if (!foreground()) return;
                    resolve(
                        items[0],
                        {
                            index: 0,
                            items: items,
                            ordered: ordered,
                            repeat: repeat,
                            replace: true,
                        },
                        true,
                        foreground,
                        function () {
                            if (typeof w.closeList === "function")
                                w.closeList();
                        },
                        undefined,
                        finish
                    );
                }
                authorize(items[0], proceed, finish);
            }
            function finish() {
                if (shuffleRequest !== ticket) return;
                shuffleRequest = null;
                updateControls();
            }
            library.show();
            if (!valid()) return;
            var client = classicMediaClient();
            if (client && typeof client.collect === "function") {
                try {
                    var cancel = client.collect(
                        frame.route.target,
                        accept,
                        function () {
                            // A completed collection may have opened our PIN.
                            return received ? valid() : foreground();
                        }
                    );
                    if (typeof cancel === "function") {
                        if (
                            !received &&
                            collectionRequest === ticket &&
                            valid()
                        )
                            ticket.cancel = cancel;
                        else if (!received) cancel();
                    }
                } catch (_) {
                    accept({ error: true });
                }
            } else
                accept({
                    items: library.catalog().map(function (
                        item: MediaLibraryItem
                    ) {
                        return item.payload;
                    }),
                });
        },
        snapshot: function () {
            var view = library.snapshot();
            view.filter = filterText;
            decorate(view);
            return view;
        },
        sourceId: source,
        toggleShuffle: function () {
            var playback = mediaClassicPlayback;
            var sequence =
                playback && playback.runtime === api && playback.sequence;
            if (!shuffleRequest && !(sequence && sequence.ordered)) {
                api.shufflePlay();
                return;
            }
            var admitted = library.capture();
            var completion = completionRequest;
            var reschedule =
                completion && automaticRequest && completion.valid();
            var revision = automaticGeneration + 1;
            api.cancelAuto();
            if (
                !current() ||
                !admitted() ||
                playback !== mediaClassicPlayback ||
                automaticGeneration !== revision
            )
                return;
            if (sequence && sequence.ordered) {
                sequence.items = sequence.ordered;
                delete sequence.ordered;
                sequence.items.forEach(function (
                    item: MediaLibraryItem,
                    index: number
                ) {
                    if (item.ref.itemId === playback.ref.itemId)
                        sequence.index = index;
                });
            }
            updateControls();
            if (
                reschedule &&
                current() &&
                admitted() &&
                automaticGeneration === revision &&
                mediaClassicPlayback === completion.playback &&
                w.__ottClassicPlayback.snapshot().generation ===
                    completion.generation
            ) {
                completion.playback.ended = false;
                api.ended(completion.generation);
            }
        },
    };
    mediaClassicInstance = api;
    try {
        var savedRepeat =
            typeof get === "function" ? get.call(w, repeatKey) : null;
        if (current() && /^(all|one|off)$/.test(savedRepeat || ""))
            repeat = savedRepeat;
    } catch (_) {
        // Missing storage or old settings retain the legacy repeat-all default.
    }
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
    cycleRepeat: function () {
        classicMediaRuntime().cycleRepeat();
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
    restoreLast: function (onUnavailable?: () => void) {
        return classicMediaRuntime().restoreLast(onUnavailable);
    },
    select: function (index: number) {
        classicMediaRuntime().select(index);
    },
    show: function () {
        classicMediaRuntime().show();
    },
    shufflePlay: function () {
        classicMediaRuntime().shufflePlay();
    },
    snapshot: function () {
        return classicMediaRuntime().snapshot();
    },
    sourceId: classicMediaSourceId,
    toggleShuffle: function () {
        classicMediaRuntime().toggleShuffle();
    },
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
