/** Torrent catalog identities belong to the player, independently of service leases. */
function normalizeTorrentConfiguration(value: any): any {
    return (window as any).__ottTorrentCodec.normalize(value);
}

function createTorrentProviderDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    helpers: any
): any {
    var disposed = false,
        catalog = helpers.emptyCatalog(),
        ready = false;
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
        cancel: function () {},
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
        dispose: function () {
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

function mountTorrentProvider(
    host: any,
    driver: any,
    owner: DriverLifetime
): void {
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
                [{ action: add, name: host._("Add new list") }].concat(
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
        if (!host.__ottKiosk?.enabled()) host.__ottEditProvider();
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
