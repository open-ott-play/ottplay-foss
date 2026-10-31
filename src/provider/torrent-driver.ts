/** Torrent catalog identities belong to the player, independently of service leases. */
function normalizeTorrentConfiguration(value: any): any {
    return (window as any).__ottTorrentCodec.normalize(value);
}

function createTorrentStreamAdapter(
    host: any,
    ports: ProviderDriverPorts,
    changed: () => void
): any {
    return host.__ottTorrentStreamData?.create({
        addons: function () {
            return host.settings?.torrentStreamAddons || "[]";
        },
        onContextChanged: changed,
        request: function (url: string, done: any) {
            return ports.request(
                { dataType: "text", timeout: 15000, url: url },
                function (value) {
                    done(null, value);
                },
                function () {
                    done("unavailable");
                }
            );
        },
    });
}

function createTorrentProviderDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    helpers: any
): any {
    var disposed = false,
        catalog = helpers.emptyCatalog(),
        ready = false,
        discoverySerial = 0,
        discoveryCancel: (() => void) | null = null,
        discoverySelection: any = null;
    function cancelDiscovery(keepSelection = false): void {
        discoverySerial++;
        if (!keepSelection) discoverySelection = null;
        var cancel = discoveryCancel;
        discoveryCancel = null;
        if (cancel) cancel();
    }
    function discoveryRequest(payload: any): any {
        var request = payload?.request;
        var movieId = request?.movieId;
        var validMovie =
            typeof movieId === "string" &&
            movieId.length <= 1024 &&
            (/^tmdb:movie:[1-9][0-9]{0,14}$/.test(movieId) ||
                /^imdb:movie:tt[0-9]{5,12}$/.test(movieId));
        if (
            !validMovie &&
            typeof movieId === "string" &&
            movieId.indexOf("stremio:movie:") === 0 &&
            movieId.length <= 1024
        ) {
            try {
                var rawId = decodeURIComponent(movieId.slice(14));
                validMovie =
                    !!rawId &&
                    !/[\u0000-\u001f\u007f]/.test(rawId) &&
                    encodeURIComponent(rawId) === movieId.slice(14);
            } catch (_) {}
        }
        if (
            !active() ||
            !ready ||
            request?.kind !== "torrent-discovery" ||
            !validMovie ||
            !/^stremio:[a-f0-9]{64}$/.test(request.sourceId) ||
            (request.imdbId && !/^tt[0-9]{5,12}$/.test(request.imdbId)) ||
            (payload.__ottMediaRef &&
                payload.__ottMediaRef.sourceId !== ports.sourceIdentity!())
        )
            return null;
        var result: any = {
            kind: "torrent-discovery",
            movieId: request.movieId,
            sourceId: request.sourceId,
        };
        if (request.imdbId) result.imdbId = request.imdbId;
        return result;
    }
    function discoveryRecord(payload: any, request: any): any {
        var id =
            "torrent-discovery:" +
            request.movieId +
            ":" +
            request.sourceId.slice(8);
        return {
            __ottMediaRef: { itemId: id, sourceId: ports.sourceIdentity!() },
            description: String(payload.description || "").slice(0, 8192),
            itemId: id,
            logo_30x30: String(payload.logo_30x30 || "").slice(0, 2048),
            request: request,
            title: String(payload.title || request.movieId).slice(0, 1024),
        };
    }
    function discoveryUrl(stream: any): string {
        if (stream?.kind === "url" && /^https?:\/\//i.test(stream.source))
            return stream.source;
        if (stream?.kind !== "torrent" || !/^magnet:\?/i.test(stream.source))
            return "";
        if (stream.fileSelection === "largest")
            return (
                "ottplay-torrent:?source=" +
                encodeURIComponent(stream.source) +
                "&selection=largest" +
                ((window as any).__TAURI__ ? "&native=1" : "")
            );
        if (
            typeof stream.fileIndex !== "number" ||
            stream.fileIndex < 0 ||
            Math.floor(stream.fileIndex) !== stream.fileIndex
        )
            return "";
        return source({ source: stream.source }, stream.fileIndex);
    }
    function resolveDiscovery(payload: any, done: any): void {
        cancelDiscovery(true);
        var selection = discoverySelection;
        discoverySelection = null;
        var request = discoveryRequest(payload);
        if (!request || (done.isCurrent && !done.isCurrent())) {
            done(null);
            return;
        }
        var serial = discoverySerial;
        var host = window as any;
        var settings = host.settings?.torrentStreamAddons || "[]";
        function accept(stream: any): void {
            if (
                serial !== discoverySerial ||
                !active() ||
                (done.isCurrent && !done.isCurrent())
            )
                return;
            var url = discoveryUrl(stream);
            if (!url) {
                done(null);
                return;
            }
            var record = discoveryRecord(payload, request);
            record.stream_url = url;
            done(record);
        }
        if (
            selection &&
            selection.request.sourceId === request.sourceId &&
            selection.request.movieId === request.movieId &&
            selection.settings === settings
        ) {
            accept(selection.stream);
            return;
        }
        var data = createTorrentStreamAdapter(host, ports, function () {
            if (serial === discoverySerial) {
                cancelDiscovery();
                if (active() && (!done.isCurrent || done.isCurrent()))
                    done(null);
            }
        });
        if (!data) {
            done(null);
            return;
        }
        discoveryCancel = function () {
            data.dispose();
        };
        data.lookup(
            { id: request.movieId, imdbId: request.imdbId },
            function (result: any) {
                if (
                    serial !== discoverySerial ||
                    !active() ||
                    (done.isCurrent && !done.isCurrent())
                )
                    return;
                var found =
                    result?.ok &&
                    result.items.filter(function (stream: any) {
                        return stream.id === request.sourceId;
                    });
                data.dispose();
                discoveryCancel = null;
                accept(found && found.length === 1 ? found[0] : null);
            }
        );
    }
    function active(): boolean {
        return !disposed && owner.active();
    }
    function configuration(): any {
        try {
            return (window as any).__ottTorrentCodec.parse(
                (window as any).__ottTorrentCodec.utf8(
                    ports.storage.get("cfg") || "null"
                )
            );
        } catch (_) {
            return null;
        }
    }
    function identity(config: any, entry: any, index: number): string {
        return "torrent:" + config.id + ":" + entry.id + ":" + index;
    }
    function source(entry: any, index: number): string {
        if ((window as any).__TAURI__)
            return (
                "ottplay-torrent:?source=" +
                encodeURIComponent(entry.source) +
                "&index=" +
                index +
                "&native=1"
            );
        var url = new URL(entry.source);
        if (/^magnet:/i.test(entry.source))
            url.searchParams.set("so", String(index));
        else
            return (
                "ottplay-torrent:?source=" +
                encodeURIComponent(entry.source) +
                "&index=" +
                index
            );
        return url.href;
    }
    function record(config: any, entry: any, file: any): any {
        var key = identity(config, entry, file.index),
            group = "torrent-source:" + entry.id;
        return {
            __ottMediaCategories: [{ id: group, name: entry.category }],
            __ottMediaCollection: entry.category,
            __ottMediaRef: { itemId: key, sourceId: ports.sourceIdentity!() },
            itemId: key,
            request: {
                catalogId: config.id,
                entryId: entry.id,
                fileIndex: file.index,
                kind: "torrent",
            },
            stream_url: "torrent:request",
            title: (entry.files.length === 1 ? entry.title : file.name).slice(
                0,
                1024
            ),
        };
    }
    function lookup(payload: any): any {
        var config = configuration(),
            request = payload && payload.request;
        if (
            !active() ||
            !ready ||
            !config ||
            !request ||
            request.kind !== "torrent" ||
            request.catalogId !== config.id ||
            (payload.__ottMediaRef &&
                payload.__ottMediaRef.sourceId !== ports.sourceIdentity!())
        )
            return null;
        for (var i = 0; i < config.entries.length; i++) {
            var entry = config.entries[i];
            if (entry.id !== request.entryId) continue;
            for (var j = 0; j < entry.files.length; j++) {
                var file = entry.files[j];
                if (file.index === request.fileIndex)
                    return { entry: entry, item: record(config, entry, file) };
            }
        }
        return null;
    }
    var client = {
        cancel: cancelDiscovery,
        load: function (_target: any, done: any) {
            if (!active() || !ready || (done.isCurrent && !done.isCurrent()))
                return;
            var host = window as any;
            host.mediaName = "Torrent";
            host.mediaRecords = catalog.ids.map(function (id: any) {
                return catalog.channels[id].__ottMediaItem;
            });
            done();
        },
        persist: function (payload: any) {
            if (payload?.request?.kind === "torrent-discovery") {
                var request = discoveryRequest(payload);
                return request ? discoveryRecord(payload, request) : {};
            }
            var found = lookup(payload);
            if (!found)
                return {
                    request: payload && payload.request,
                    title: payload && payload.title,
                };
            var result = found.item;
            delete result.stream_url;
            return result;
        },
        resolve: function (payload: any, done: any) {
            if (payload?.request?.kind === "torrent-discovery") {
                resolveDiscovery(payload, done);
                return;
            }
            cancelDiscovery();
            var found = lookup(payload);
            if (!found || (done.isCurrent && !done.isCurrent())) {
                done(null);
                return;
            }
            var result = found.item;
            result.stream_url = source(found.entry, result.request.fileIndex);
            done(result);
        },
        stableRequests: true,
        stop: function () {},
    };
    var driver = {
        archive: function () {
            return "";
        },
        capabilities: {
            archive: false,
            guide: false,
            media: true,
            mediaPlaylist: true,
            settings: true,
        },
        configuration: configuration,
        credentials: function () {
            var config = configuration();
            return {
                password: "",
                server: config ? config.id : "",
                username: "",
            };
        },
        discoveryPayload: function (movie: any, stream: any) {
            discoverySelection = null;
            var payload: any = {
                description: movie.description,
                logo_30x30: movie.poster,
                request: {
                    imdbId: movie.imdbId,
                    kind: "torrent-discovery",
                    movieId: movie.id,
                    sourceId: stream.id,
                },
                title: movie.title,
            };
            var request = discoveryRequest(payload);
            if (!request || !discoveryUrl(stream)) return null;
            discoverySelection = {
                request: request,
                settings: (window as any).settings?.torrentStreamAddons || "[]",
                stream: stream,
            };
            return discoveryRecord(payload, request);
        },
        discoveryPorts: ports,
        dispose: function () {
            cancelDiscovery();
            disposed = true;
            ready = false;
            catalog = helpers.emptyCatalog();
        },
        guide: function (_id: any, done: any) {
            if (active()) done([]);
        },
        id: "torrent",
        invalidateCatalog: function () {
            catalog = helpers.emptyCatalog();
        },
        libraryReady: function () {
            return active() && ready;
        },
        load: function (done: any) {
            if (!active()) return;
            catalog = helpers.emptyCatalog();
            var config = configuration();
            ready = true;
            if (!config) {
                done(catalog, "torrent-empty");
                return;
            }
            config.entries.forEach(function (entry: any) {
                entry.files.forEach(function (file: any) {
                    var item = record(config, entry, file),
                        key = item.itemId;
                    if (!catalog.groups[entry.category]) {
                        catalog.groups[entry.category] = [];
                        catalog.groupOrder.push(entry.category);
                    }
                    catalog.ids.push(key);
                    catalog.groups[entry.category].push(key);
                    catalog.channels[key] = {
                        __ottMediaCategories: item.__ottMediaCategories,
                        __ottMediaCollection: entry.category,
                        __ottMediaItem: item,
                        __ottMediaProvider: "torrent",
                        category: {
                            class: catalog.groupOrder.indexOf(entry.category),
                            name: entry.category,
                        },
                        channel_name: item.title,
                        itemId: key,
                        logo: "",
                        rec: 0,
                        time: 0,
                        time_to: 0,
                        url: item.stream_url,
                    };
                });
            });
            done(catalog, catalog.ids.length ? undefined : "torrent-empty");
        },
        logo: function () {
            return "";
        },
        mediaClient: function () {
            return active() && ready ? client : null;
        },
        saveConfiguration: function (value: any) {
            var next = normalizeTorrentConfiguration(value);
            if (!active() || !next) return false;
            try {
                (window as any).__ottTorrentCodec.encode(next);
                ports.storage.set("cfg", JSON.stringify(next));
                if (ports.storage.get("cfg") !== JSON.stringify(next))
                    return false;
            } catch (_) {
                return false;
            }
            return active();
        },
        saveCredentials: function () {
            return false;
        },
        stream: function (id: any) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].url
                : "";
        },
    };
    owner.own(driver.dispose);
    return driver;
}

/** Read-only movie discovery shares the normal channel and category renderers. */
function createTorrentDiscoveryView(
    host: any,
    driver: any,
    owner: DriverLifetime,
    ports: ProviderDriverPorts
): any {
    var factory = host.__ottTorrentDiscoveryData;
    if (!factory || !host.__ottChannelListView || !host.__ottCategoryListView)
        return null;
    var data = factory.create({
        addonBaseUrl: function () {
            return host.settings?.torrentCatalogEndpoint || "";
        },
        apiPath: function (tail: string) {
            return host.TMDb?.apiPath
                ? host.TMDb.apiPath(tail)
                : "/tmdb/s/" + tail;
        },
        language: function () {
            return host.__ottTorrentCatalogLanguage
                ? host.__ottTorrentCatalogLanguage()
                : ports.language
                  ? ports.language()
                  : "en";
        },
        onContextChanged: function () {
            settingsChanged();
        },
        request: function (url: string, done: any) {
            return ports.request(
                { dataType: "text", timeout: 15000, url: url },
                function (value) {
                    done(null, value);
                },
                function () {
                    done("unavailable");
                }
            );
        },
    });
    var streamData = createTorrentStreamAdapter(host, ports, function () {
        sourcesChanged();
    });
    var generation = 0,
        rendering = false,
        rows: string[] = [],
        items: any[] = [],
        category = "popular",
        categoryName = host._("Popular"),
        searchSupported = true,
        query: string | null = null,
        next: number | null = null,
        busy = false,
        failure = "",
        handler: any = null,
        signature = "",
        displayRows: any[] | null = null,
        display = "channels",
        streamSignature = "",
        selectedMovie: any = null,
        streams: any[] = [],
        pendingPlayback: { cancel?: () => void; cancelled: boolean } | null =
            null,
        staged: { [lane: string]: (() => void) | undefined } = {},
        flushing = false;
    function foreground(): boolean {
        var screen = host.__ottClassicScreenPort?.listOwner();
        return (
            allowed() &&
            displayRows === host.listArray &&
            (!screen ||
                (screen.foreground ? screen.foreground() : screen.active()))
        );
    }
    function present(lane: string, action: () => void): void {
        if (foreground()) action();
        else staged[lane] = action;
    }
    function resume(): boolean {
        if (flushing || !foreground()) return false;
        if (settingsChanged() || sourcesChanged()) return true;
        var pending = staged,
            lanes = Object.keys(pending);
        if (!lanes.length) return false;
        staged = {};
        flushing = true;
        try {
            lanes.forEach(function (lane) {
                var action = pending[lane];
                if (action) present(lane, action);
            });
        } finally {
            flushing = false;
        }
        return true;
    }
    function configuration(): string {
        return (
            (host.__ottTorrentCatalogLanguage
                ? host.__ottTorrentCatalogLanguage()
                : ports.language
                  ? ports.language()
                  : "en") +
            "\n" +
            (host.settings?.torrentCatalogEndpoint || "")
        );
    }
    function settingsChanged(): boolean {
        if (!signature || signature === configuration()) return false;
        var visible = foreground();
        close();
        if (!visible) return false;
        if (display === "categories") categories();
        else fetchPage(null, false);
        return true;
    }
    function sourcesChanged(): boolean {
        if (
            display !== "streams" ||
            !selectedMovie ||
            streamSignature === (host.settings?.torrentStreamAddons || "[]")
        )
            return false;
        var visible = foreground();
        close();
        if (!visible) return false;
        openSources(selectedMovie);
        return true;
    }
    function allowed(): boolean {
        return (
            owner.active() &&
            !host.__ottKiosk?.enabled() &&
            !host.__ottStandby?.blocked() &&
            !host.__ottParental?.needs("providers")
        );
    }
    function current(): boolean {
        return (
            allowed() &&
            host.listArray === rows &&
            (!handler || host.listKeyHandlerFn === handler) &&
            (!host.__ottClassicScreenPort?.listOwner() ||
                host.__ottClassicScreenPort.listOwner().active())
        );
    }
    function close(): void {
        generation++;
        busy = false;
        staged = {};
        data.cancel();
        streamData?.cancel();
        cancelPlayback();
    }
    function cancelPlayback(): void {
        var pending = pendingPlayback;
        pendingPlayback = null;
        if (pending) {
            pending.cancelled = true;
            driver.mediaClient().cancel();
            if (pending.cancel) pending.cancel();
        }
    }
    function row(item: any): any {
        return {
            __ottMediaItem: {
                description:
                    (item.year ? item.year + "\n\n" : "") +
                    (item.description || ""),
                itemId: item.id,
                logo_30x30: item.poster || "",
                title: item.title,
            },
            channel_name: item.title,
            logo: item.poster || "",
            modernMeta: item.year || "",
            modernTitle: item.title,
        };
    }
    function detail(): void {
        if (resume()) return;
        var item =
            display === "streams"
                ? streams[host.selIndex]
                : items[host.selIndex];
        if (item)
            host.__ottChannelListView.detail(
                display === "streams" ? streamRow(item) : row(item)
            );
        else
            statusDetail(
                failure ||
                    host._(busy ? "Loading. Please wait..." : "Not found"),
                busy
            );
    }
    function statusDetail(message: string, loading: boolean): void {
        if (host.listDetail) {
            host.listDetail.textContent = message;
            if (loading && host.document) {
                var spinner = host.document.createElement("div");
                spinner.className = "ott-spinner";
                spinner.setAttribute("aria-hidden", "true");
                for (var i = 0; i < 4; i++) {
                    var dot = host.document.createElement("span");
                    dot.className = "blob";
                    spinner.appendChild(dot);
                }
                host.listDetail.insertBefore(
                    spinner,
                    host.listDetail.firstChild
                );
            }
        }
    }
    function information(): void {
        if (settingsChanged()) return;
        var item = items[host.selIndex];
        if (!item || !current()) return;
        var request = generation;
        data.details(item.id, function (result: any) {
            if (
                request !== generation ||
                !current() ||
                items[host.selIndex] !== item
            )
                return;
            present("details", function () {
                if (
                    request !== generation ||
                    !current() ||
                    items[host.selIndex] !== item
                )
                    return;
                if (
                    result &&
                    result.ok &&
                    result.item &&
                    result.item.id === item.id
                ) {
                    items[host.selIndex] = result.item;
                    item = result.item;
                }
                show(item.id);
                detail();
                host.showProgramInfo(item.title);
            });
        });
    }
    function streamRow(stream: any): any {
        return row({
            description: [stream.addon?.name, stream.description]
                .filter(Boolean)
                .join("\n\n"),
            id: stream.id,
            poster: selectedMovie?.poster || "",
            title:
                stream.title ||
                stream.addon?.name ||
                selectedMovie?.title ||
                "",
        });
    }
    function showSources(): void {
        if (!allowed()) return;
        rows = streams.map(function (stream) {
            return stream.id;
        });
        displayRows = rows;
        display = "streams";
        var projected: any = Object.create(null);
        streams.forEach(function (stream) {
            projected[stream.id] = streamRow(stream);
        });
        rendering = true;
        try {
            host.__ottChannelListView.show({
                categoryName:
                    host._("Choose a source") +
                    ": " +
                    (selectedMovie?.title || "Torrent"),
                channel: function (id: string) {
                    return projected[id];
                },
                detail: detail,
                id: "torrent:sources",
                key: key,
                locked: function () {
                    return false;
                },
                picon: function (id: string) {
                    return projected[id]?.logo || "";
                },
                playing: function () {
                    return false;
                },
                rows: rows,
                selected: 0,
            });
            handler = host.listKeyHandlerFn;
            if (!streams.length) detail();
            host.__ottClassicScreenPort?.onDispose(function () {
                if (!rendering) close();
            });
        } finally {
            rendering = false;
        }
    }
    function backToMovies(): void {
        var selected = selectedMovie?.id;
        close();
        selectedMovie = null;
        streams = [];
        failure = "";
        show(selected);
    }
    function openSources(movie: any): void {
        if (!allowed() || !movie) return;
        close();
        selectedMovie = movie;
        streams = [];
        streamSignature = host.settings?.torrentStreamAddons || "[]";
        var request = generation;
        busy = true;
        failure = "";
        showSources();
        function currentSource(): boolean {
            return (
                request === generation &&
                current() &&
                display === "streams" &&
                selectedMovie === movie
            );
        }
        function lookup(): void {
            if (!currentSource()) return;
            if (!streamData) {
                busy = false;
                failure = host._("Unavailable");
                showSources();
                return;
            }
            streamData.lookup(movie, function (result: any) {
                if (!currentSource()) return;
                present("streams", function () {
                    if (!currentSource()) return;
                    busy = false;
                    streams = result?.ok ? result.items : [];
                    failure = host._(
                        !result?.ok
                            ? result?.error === "no_addons"
                                ? "Not configured"
                                : "Failed to load!"
                            : result.unsupportedCount && !streams.length
                              ? "Unsupported source"
                              : "Nothing to play"
                    );
                    showSources();
                });
            });
        }
        if (
            !movie.imdbId &&
            /^tmdb:movie:/.test(movie.id) &&
            streamSignature !== "[]"
        ) {
            data.details(movie.id, function (result: any) {
                if (!currentSource()) return;
                if (result?.ok && result.item?.id === movie.id) {
                    Object.keys(result.item).forEach(function (key) {
                        movie[key] = result.item[key];
                    });
                }
                lookup();
            });
        } else lookup();
    }
    function playSource(): void {
        var stream = streams[host.selIndex],
            movie = selectedMovie;
        if (!stream || !movie || !current() || !foreground()) return;
        cancelPlayback();
        var payload =
            typeof host.__ottMedia?.playItem === "function" &&
            driver.discoveryPayload(movie, stream);
        if (!payload) {
            host.showShift?.(host._("Unsupported source"));
            return;
        }
        var ticket: { cancel?: () => void; cancelled: boolean } = {
            cancelled: false,
        };
        pendingPlayback = ticket;
        var request = generation,
            committed = false;
        var context = streamSignature;
        function admitted(): boolean {
            return (
                allowed() &&
                !ticket.cancelled &&
                context === (host.settings?.torrentStreamAddons || "[]") &&
                (committed ||
                    (request === generation &&
                        current() &&
                        foreground() &&
                        selectedMovie === movie &&
                        streams[host.selIndex] === stream))
            );
        }
        var cancel = host.__ottMedia.playItem(
            payload,
            admitted,
            function () {
                if (!admitted()) return;
                if (pendingPlayback === ticket) pendingPlayback = null;
                committed = true;
                host.closeList();
            },
            function () {
                if (pendingPlayback !== ticket) return;
                var report = admitted();
                cancelPlayback();
                if (report) host.showShift?.(host._("Failed to load!"));
            }
        );
        if (typeof cancel === "function") {
            ticket.cancel = cancel;
            if (ticket.cancelled) cancel();
        }
    }
    function show(selected?: string): void {
        if (!allowed()) return;
        rows = items.map(function (item) {
            return item.id;
        });
        displayRows = rows;
        display = "channels";
        var projected: any = Object.create(null);
        items.forEach(function (item) {
            projected[item.id] = row(item);
        });
        rendering = true;
        try {
            host.__ottChannelListView.show({
                categoryName:
                    query === null
                        ? categoryName
                        : host._("Search") + ": " + query,
                channel: function (id: string) {
                    return projected[id];
                },
                detail: detail,
                id: "torrent:discovery",
                key: key,
                locked: function () {
                    return false;
                },
                more: next !== null && !busy,
                picon: function (id: string) {
                    return projected[id]?.logo || "";
                },
                playing: function () {
                    return false;
                },
                rows: rows,
                search: searchSupported,
                selected: Math.max(0, rows.indexOf(selected || "")),
            });
            handler = host.listKeyHandlerFn;
            if (!items.length) detail();
            host.__ottClassicScreenPort?.onDispose(function () {
                if (!rendering) close();
            });
        } finally {
            rendering = false;
        }
    }
    function fetchPage(cursor: number | null, append: boolean): void {
        if (!allowed() || (append && (busy || next === null))) return;
        var nextSignature = configuration();
        if (signature && signature !== nextSignature) {
            append = false;
            cursor = null;
            if (/^genre:/.test(category)) category = "popular";
            if (/^catalog:/.test(category)) category = "popular";
            searchSupported = true;
        }
        signature = nextSignature;
        if (category === "popular") categoryName = host._("Popular");
        else if (category === "new") categoryName = host._("New releases");
        var request = ++generation;
        data.cancel();
        var selected = rows[host.selIndex];
        if (!append) items = [];
        next = null;
        failure = "";
        busy = true;
        show(selected);
        function done(result: any): void {
            if (request !== generation || !current()) return;
            present("list", function () {
                if (request !== generation || !current()) return;
                busy = false;
                if (!result || !result.ok) {
                    failure = host._("Failed to load!");
                    if (append) next = cursor;
                    show(selected);
                    if (items.length && host.showShift) host.showShift(failure);
                    return;
                }
                if (result.catalog) {
                    category = result.catalog.id;
                    categoryName = result.catalog.title;
                    searchSupported = result.catalog.searchSupported !== false;
                }
                var known: any = Object.create(null);
                items.forEach(function (item) {
                    known[item.id] = true;
                });
                (result.items || []).forEach(function (item: any) {
                    if (!known[item.id] && items.length < 500) {
                        known[item.id] = true;
                        items.push(item);
                    }
                });
                next = items.length < 500 ? result.next : null;
                show(selected);
            });
        }
        if (query === null) data.load(category, cursor, done);
        else data.search(query, cursor, done);
    }
    function open(id?: string, title?: string): boolean {
        if (!allowed()) return false;
        category = id || "popular";
        categoryName = title || host._("Popular");
        query = null;
        fetchPage(null, false);
        return true;
    }
    function search(): boolean {
        if (!allowed()) return false;
        if (!searchSupported) return true;
        var wasCurrent = current();
        close();
        if (!wasCurrent) {
            items = [];
            next = null;
            failure = "";
            show();
        }
        var request = generation;
        var parent = host.__ottClassicScreenPort?.listOwner(),
            editor: any = null;
        host.editCaption = host._("Search");
        host.editvar = query || "";
        host.setEdit = function () {
            if (
                !allowed() ||
                request !== generation ||
                (parent && !parent.active()) ||
                (editor &&
                    !host.__ottClassicScreenPort.acceptsEditorSave(editor))
            )
                return;
            var text = String(host.editvar || "").trim();
            if (!text || text.length > 256) return;
            query = text;
            fetchPage(null, false);
        };
        host.showEditKey(host.keys.ENTER);
        editor = host.__ottClassicScreenPort?.owner("editor");
        return true;
    }
    function categories(genres?: any[], rootEntries = false): boolean {
        if (!allowed()) return false;
        close();
        signature = configuration();
        var request = generation;
        var external = !genres && !!host.settings?.torrentCatalogEndpoint;
        var choices = external
            ? []
            : genres || [
                  { id: "popular", title: host._("Popular") },
                  { id: "new", title: host._("New releases") },
                  { id: "genres", title: host._("Genre") },
                  { id: "sources", title: host._("My sources") },
                  { id: "favorites", title: host._("Favorites") },
              ];
        var labels = choices.map(function (item) {
            return item.title;
        });
        displayRows = labels;
        display = "categories";
        function select(index: number): void {
            if (
                !allowed() ||
                request !== generation ||
                host.listArray !== labels
            )
                return;
            var choice = choices[index];
            if (!choice) return;
            if (choice.id === "genres") {
                data.categories(function (result: any) {
                    if (
                        request !== generation ||
                        host.listArray !== labels ||
                        !allowed()
                    )
                        return;
                    present("categories", function () {
                        if (
                            request !== generation ||
                            host.listArray !== labels ||
                            !allowed()
                        )
                            return;
                        if (!result || !result.ok) {
                            host.showShift?.(host._("Failed to load!"));
                            return;
                        }
                        categories(
                            (result.categories || []).filter(function (
                                entry: any
                            ) {
                                return /^genre:/.test(entry.id);
                            })
                        );
                    });
                });
            } else if (choice.id === "sources") {
                close();
                var sourceIndex = host.__ottChannels?.index("system:all");
                var saved = driver.configuration();
                if (
                    sourceIndex >= 0 &&
                    saved &&
                    saved.entries.some(function (entry: any) {
                        return entry.files.length > 0;
                    })
                )
                    host.channelsList(sourceIndex, 0);
                else host.__ottEditProvider();
            } else if (choice.id === "favorites") {
                close();
                host.openGlobalFavorites?.();
            } else {
                searchSupported = choice.searchSupported !== false;
                open(choice.id, choice.title);
            }
        }
        rendering = true;
        try {
            host.__ottCategoryListView.show({
                detail: function () {
                    if (resume()) return;
                    if (external)
                        statusDetail(host._("Loading. Please wait..."), true);
                },
                key: function (code: number): boolean {
                    if (!allowed() || host.listArray !== labels) return true;
                    if (
                        code !== host.keys.RETURN &&
                        code !== host.keys.EXIT &&
                        settingsChanged()
                    )
                        return true;
                    if (code === host.keys.RETURN || code === host.keys.EXIT) {
                        if (genres && !rootEntries) categories();
                        else {
                            close();
                            host.closeList();
                        }
                        return true;
                    }
                    if (request !== generation) return true;
                    if (resume()) return true;
                    if (code === host.keys.ENTER) {
                        select(host.selIndex);
                        return true;
                    }
                    for (var number = 1; number <= 9; number++)
                        if (code === host.keys["N" + number]) {
                            select(number - 1);
                            return true;
                        }
                    return false;
                },
                labels: labels,
                selected: Math.max(
                    0,
                    choices
                        .map(function (item) {
                            return item.id;
                        })
                        .indexOf(category)
                ),
            });
            host.__ottClassicScreenPort?.onDispose(function () {
                if (!rendering) close();
            });
        } finally {
            rendering = false;
        }
        if (external) {
            data.categories(function (result: any) {
                if (
                    request !== generation ||
                    host.listArray !== labels ||
                    !allowed()
                )
                    return;
                present("categories", function () {
                    if (
                        request !== generation ||
                        host.listArray !== labels ||
                        !allowed()
                    )
                        return;
                    if (!result?.ok) {
                        external = false;
                        statusDetail(host._("Failed to load!"), false);
                        return;
                    }
                    var catalogs = (result.categories || []).filter(function (
                        entry: any
                    ) {
                        return /^catalog:/.test(entry.id);
                    });
                    if (!catalogs.length)
                        catalogs = (result.categories || []).filter(function (
                            entry: any
                        ) {
                            return (
                                entry.id === "popular" ||
                                entry.id === "new" ||
                                /^genre:/.test(entry.id)
                            );
                        });
                    categories(
                        catalogs.concat([
                            { id: "sources", title: host._("My sources") },
                            { id: "favorites", title: host._("Favorites") },
                        ]),
                        true
                    );
                });
            });
        }
        return true;
    }
    function key(code: number): boolean {
        if (!current()) return true;
        var keys = host.keys;
        if (code === keys.RETURN || code === keys.EXIT) {
            if (display === "streams" && code === keys.RETURN) {
                backToMovies();
                return true;
            }
            close();
            host.closeList();
            return true;
        }
        if (settingsChanged() || sourcesChanged()) return true;
        if (resume()) return true;
        if (display === "streams") {
            if (code === keys.BLUE || code === keys.PLAY || code === keys.PAUSE)
                return categories();
            if (code === keys.ENTER) {
                if (!streams.length && !busy) openSources(selectedMovie);
                else playSource();
                return true;
            }
            if (
                code === keys.INFO ||
                code === keys.EPG ||
                code === keys.RED ||
                code === keys.N2
            ) {
                detail();
                if (streams[host.selIndex])
                    host.showProgramInfo(streams[host.selIndex].title);
                return true;
            }
            if (
                [
                    keys.YELLOW,
                    keys.TOOLS,
                    keys.N0,
                    keys.GREEN,
                    keys.N3,
                    keys.PIP,
                    keys.STOP,
                    keys.RANDOM,
                    keys.FAVORITES,
                ].indexOf(code) >= 0
            )
                return true;
            return false;
        }
        if (
            code === keys.BLUE ||
            code === keys.PLAY ||
            code === keys.PAUSE ||
            (code === keys.LEFT && host.sArrowFun === 2)
        )
            return categories();
        if (code === keys.YELLOW || code === keys.TOOLS || code === keys.N0)
            return search();
        if (code === keys.NEXT || code === keys.FF) {
            if (next !== null && !busy) fetchPage(next, true);
            return true;
        }
        if (
            code === keys.INFO ||
            code === keys.N2 ||
            code === keys.RED ||
            code === keys.EPG
        ) {
            if (!items.length && !busy) fetchPage(null, false);
            else information();
            return true;
        }
        if (code === keys.ENTER) {
            if (!items.length && !busy) fetchPage(null, false);
            else if (items[host.selIndex]) openSources(items[host.selIndex]);
            return true;
        }
        // No playable source exists yet: never dispatch PiP, shuffle or Favorites.
        if (
            code === keys.GREEN ||
            code === keys.N3 ||
            code === keys.PIP ||
            code === keys.STOP ||
            code === keys.RANDOM ||
            code === keys.FAVORITES
        )
            return true;
        return false;
    }
    owner.own(function () {
        close();
        data.dispose();
        streamData?.dispose();
    });
    return {
        categories: categories,
        close: close,
        open: open,
        search: search,
        settingsChanged: settingsChanged,
        sourcesChanged: sourcesChanged,
    };
}

function mountTorrentProvider(
    host: any,
    driver: any,
    owner: DriverLifetime
): void {
    driver.catalogBrowser = createTorrentDiscoveryView(
        host,
        driver,
        owner,
        driver.discoveryPorts
    );
    var revision = 0,
        cancelMetadata: (() => void) | null = null,
        attached: any = null;
    function locked(): boolean {
        return (
            !!host.__ottKiosk?.enabled() ||
            !!host.__ottParental?.needs("providers") ||
            !!host.__ottParental?.needs("settings")
        );
    }
    function stop(): void {
        revision++;
        if (cancelMetadata) cancelMetadata();
        cancelMetadata = null;
    }
    function identifier(): string {
        if (host.crypto && typeof host.crypto.randomUUID === "function")
            return host.crypto.randomUUID();
        return (
            Date.now().toString(36) +
            "-" +
            Math.random().toString(36).slice(2) +
            Math.random().toString(36).slice(2)
        );
    }
    function escaped(value: any): string {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function edit(): boolean {
        if (!owner.active() || locked()) return false;
        stop();
        var session = revision,
            rows: any[] = [],
            busy = false,
            renderItem: any,
            originalRaw = host.stbGetItem("torrentcfg");
        function current(): boolean {
            return (
                owner.active() &&
                session === revision &&
                !locked() &&
                host.getListItem === renderItem
            );
        }
        function config(): any {
            return (
                driver.configuration() || {
                    entries: [],
                    id: identifier(),
                    name: "Torrent",
                    schema: 1,
                }
            );
        }
        function save(value: any): void {
            if (!current() || busy) return;
            var service =
                host.__ottTorrentCatalogAccess &&
                host.__ottTorrentCatalogAccess();
            if (!service) {
                render(host._("Settings could not be saved"));
                return;
            }
            busy = true;
            service.save(value, originalRaw, current).then(function (
                saved: boolean
            ) {
                busy = false;
                if (!current()) return;
                if (!saved) {
                    render(host._("Settings could not be saved"));
                    return;
                }
                stop();
                host.loadChannels();
            });
        }
        function input(
            caption: string,
            value: string,
            accept: (value: string) => void
        ): void {
            if (!current()) return;
            host.editCaption = caption;
            host.editvar = value;
            var accepted = false;
            host.setEdit = function () {
                if (accepted || !current()) return;
                accepted = true;
                accept(String(host.editvar || "").trim());
            };
            host.showEditKey(host.keys.ENTER);
        }
        function inspect(value: any, entry: any, replace: boolean): void {
            busy = true;
            var before = JSON.stringify(driver.configuration());
            render(host._("Loading..."));
            host.__ottMediaCompanion.ensure(!!host.__TAURI__).then(
                function (client: any) {
                    if (!current()) return;
                    var completed = false;
                    var release = client.metadata(
                        entry.source,
                        function (files: any[] | null) {
                            completed = true;
                            busy = false;
                            cancelMetadata = null;
                            if (!current()) return;
                            if (
                                JSON.stringify(driver.configuration()) !==
                                before
                            ) {
                                render(host._("Settings source changed"));
                                return;
                            }
                            if (!files || !files.length) {
                                render(host._("Failed to load!"));
                                return;
                            }
                            entry.files = files;
                            if (!replace) value.entries.push(entry);
                            save(value);
                        }
                    );
                    if (!completed) cancelMetadata = release;
                },
                function () {
                    busy = false;
                    if (current()) render(host._("Unavailable"));
                }
            );
        }
        function add(): void {
            var value = config();
            if (value.entries.length >= 256) {
                render(host._("Torrent source limit reached."));
                return;
            }
            input(
                host._("Enter a magnet link or a torrent file URL."),
                "",
                function (source) {
                    if (!host.__ottTorrentCodec.source(source)) {
                        render(
                            host._("Enter a magnet link or a torrent file URL.")
                        );
                        return;
                    }
                    if (
                        value.entries.some(function (entry: any) {
                            return entry.source === source;
                        })
                    ) {
                        render(
                            host._("This source is already in the catalog.")
                        );
                        return;
                    }
                    var title = "Torrent";
                    try {
                        var url = new URL(source);
                        title =
                            url.searchParams.get("dn") ||
                            decodeURIComponent(
                                url.pathname.split("/").pop() || ""
                            ) ||
                            title;
                    } catch (_) {}
                    render();
                    input(host._("New list name"), title, function (name) {
                        if (!name) {
                            render();
                            return;
                        }
                        inspect(
                            value,
                            {
                                category: name,
                                files: [],
                                id: identifier(),
                                source: source,
                                title: name,
                            },
                            false
                        );
                    });
                }
            );
        }
        function sourceActions(entryId: string): void {
            var value = config(),
                entry = value.entries.filter(function (row: any) {
                    return row.id === entryId;
                })[0];
            if (!entry) {
                render();
                return;
            }
            render("", [
                {
                    action: function () {
                        inspect(value, entry, true);
                    },
                    name: host._("Load"),
                },
                {
                    action: function () {
                        input(
                            host._("Rename to"),
                            entry.title,
                            function (name) {
                                if (!name) {
                                    sourceActions(entryId);
                                    return;
                                }
                                entry.title = name;
                                entry.category = name;
                                save(value);
                            }
                        );
                    },
                    name: host._("Rename"),
                },
                {
                    action: function () {
                        value.entries = value.entries.filter(function (
                            row: any
                        ) {
                            return row.id !== entryId;
                        });
                        save(value);
                    },
                    name: host._("Delete"),
                },
                {
                    action: function () {
                        render();
                    },
                    name: host._("Back"),
                },
            ]);
        }
        function language(): void {
            var names =
                host.__ottAppearanceHost?.languages ||
                host.__ottRemoteLifecyclePorts?.languageNames ||
                {};
            render(
                "",
                [""].concat(Object.keys(names)).map(function (code: string) {
                    return {
                        action: function () {
                            if (!current()) return;
                            if (
                                !host.saveSettings?.({
                                    torrentCatalogLanguage: code,
                                })
                            ) {
                                render(host._("Settings could not be saved"));
                                return;
                            }
                            edit();
                        },
                        name: code ? names[code] : host._("Player default"),
                    };
                })
            );
        }
        function close(): void {
            stop();
            host.popupList(
                host.popupActions.indexOf(
                    host.toggleProviderSettingsVisibility
                ) + 1
            );
        }
        function render(message?: string, actions?: any[]): void {
            if (!owner.active() || session !== revision || locked()) return;
            rows =
                actions ||
                [
                    { action: add, name: host._("Add new list") },
                    {
                        action: language,
                        name:
                            host._("Catalog language") +
                            ": " +
                            (host.settings?.torrentCatalogLanguage
                                ? host.__ottAppearanceHost?.languages?.[
                                      host.settings.torrentCatalogLanguage
                                  ] || host.settings.torrentCatalogLanguage
                                : host._("Player default")),
                    },
                ].concat(
                    config().entries.map(function (entry: any) {
                        return {
                            action: function () {
                                sourceActions(entry.id);
                            },
                            name: entry.title + " (" + entry.files.length + ")",
                        };
                    })
                );
            host.listArray = rows;
            host.listDataArray = rows;
            host.selIndex = 0;
            renderItem = function (row: any) {
                return "&nbsp;&nbsp;" + escaped(row.name);
            };
            host.getListItem = renderItem;
            host.detailListAction = function () {
                host.listDetail.textContent = message || "";
            };
            host.listKeyHandler = function (key: number) {
                if (!current()) return false;
                if (key === host.keys.RETURN || key === host.keys.EXIT) {
                    close();
                    return true;
                }
                if (key === host.keys.ENTER) {
                    if (!busy && rows[host.selIndex])
                        rows[host.selIndex].action();
                    return true;
                }
                return false;
            };
            host.listCaption.textContent = "Torrent";
            host.listFooter.innerHTML = host.renderButtonHint(
                host.keys.RETURN,
                host.strRETURN,
                "Close"
            );
            host.showPage();
        }
        render();
        return true;
    }
    edit.menuTitle = function () {
        return "Torrent: " + host._("Manage lists");
    };
    edit.menuDetail = function () {
        return host._("Add / rename / delete…");
    };
    host.__ottEditProvider = edit;
    host.duneAddSettings = function (index: number) {
        if (!owner.active()) return;
        host.popupActions.splice(index, 1, edit);
        host.popupArray.splice(index, 1, edit.menuTitle());
        host.popupDetail.splice(index, 1, edit.menuDetail());
    };
    driver.settingsChanged = stop;
    driver.publishLibrary = function () {
        if (!owner.active()) return;
        attached = driver.mediaClient();
        host.providerMediaClient = attached;
        host.getMediaArray = attached ? attached.load : null;
    };
    owner.own(function () {
        stop();
        if (host.providerMediaClient === attached) {
            host.providerMediaClient = null;
            host.getMediaArray = null;
        }
    });
}

function reportTorrentProviderLoad(
    host: any,
    driver: any,
    error?: string
): boolean {
    driver.publishLibrary();
    if (error === "torrent-empty") {
        if (!host.__ottKiosk?.enabled()) {
            if (!driver.catalogBrowser?.open()) host.__ottEditProvider();
        }
        return false;
    }
    return true;
}

(window as any).__ottTorrentDriver = {
    create: createTorrentProviderDriver,
    mount: mountTorrentProvider,
    normalize: normalizeTorrentConfiguration,
    reportLoad: reportTorrentProviderLoad,
};
