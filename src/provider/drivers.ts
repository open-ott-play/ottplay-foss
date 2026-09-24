/** Provider instances receive ports; they never evaluate scripts or use player globals. */
interface DriverLifetime {
    active(): boolean;
    own(cleanup: () => void): () => void;
}
interface DriverStorage {
    get(key: string): string | null;
    remove(key: string): void;
    set(key: string, value: string): void;
}
interface DriverCatalog {
    channels: { [id: string]: any };
    groupOrder: string[];
    groups: { [name: string]: Array<string | number> };
    ids: Array<string | number>;
}
interface DriverHttpRequest {
    data?: any;
    dataType?: string;
    method?: string;
    timeout: number;
    type?: string;
    url: string;
}
interface ProviderDriverProfile {
    id: string;
    kind: string;
    prefix: string;
    title: string;
}
interface ProviderDriverPorts {
    core: any;
    createLifetime(): any;
    hash(value: string): number;
    isDune(): boolean;
    now(): number;
    progress(message: string): void;
    relay: string;
    request(
        request: DriverHttpRequest,
        done: (value: any) => void,
        fail: () => void
    ): () => void;
    storage: DriverStorage;
    translate(value: string): string;
    validateUrl(value: string): boolean;
}
interface ProviderCredentials {
    password: string;
    playlist?: string;
    server: string;
    username: string;
}
interface ProviderDriver {
    archive(id: string | number, start: number, end: number): string;
    readonly capabilities: {
        archive: boolean;
        guide: boolean;
        settings: boolean;
        media: boolean;
    };
    configuration?(): any;
    credentials(): ProviderCredentials;
    dispose(): void;
    guide(id: string | number, callback: (value: any) => void): void;
    readonly id: string;
    load(
        callback: (
            catalog: DriverCatalog | null,
            error?: string,
            pending?: boolean
        ) => void
    ): void;
    logo(id: string | number): string;
    saveCredentials(value: ProviderCredentials): void;
    stream(id: string | number): string;
}
type ProviderDriverFactory = (
    ports: ProviderDriverPorts,
    lifetime: DriverLifetime
) => ProviderDriver;

function emptyDriverCatalog(): DriverCatalog {
    return {
        channels: Object.create(null),
        groupOrder: [],
        groups: Object.create(null),
        ids: [],
    };
}

function driverCatalogSnapshot(catalog: DriverCatalog): DriverCatalog {
    var snapshot = emptyDriverCatalog();
    snapshot.ids = catalog.ids.slice();
    snapshot.groupOrder = catalog.groupOrder.slice();
    Object.keys(catalog.groups).forEach(function (name) {
        snapshot.groups[name] = catalog.groups[name].slice();
    });
    Object.keys(catalog.channels).forEach(function (id) {
        var row = catalog.channels[id];
        var copy: any = {};
        Object.keys(row).forEach(function (key) {
            copy[key] = row[key];
        });
        if (row.category)
            copy.category = {
                class: row.category.class,
                name: row.category.name,
            };
        snapshot.channels[id] = copy;
    });
    return snapshot;
}

function createDriverRegistry() {
    var factories: { [id: string]: ProviderDriverFactory } =
        Object.create(null);
    return {
        create: function (
            id: string,
            ports: ProviderDriverPorts,
            lifetime: DriverLifetime
        ): ProviderDriver {
            if (!factories[id])
                throw new Error("Unsupported provider driver: " + id);
            return factories[id](ports, lifetime);
        },
        has: function (id: string) {
            return !!factories[id];
        },
        ids: function () {
            return Object.keys(factories);
        },
        register: function (id: string, factory: ProviderDriverFactory) {
            if (!id || factories[id])
                throw new Error("Duplicate provider driver: " + id);
            factories[id] = factory;
        },
    };
}

function createDemoDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime
): ProviderDriver {
    var disposed = false;
    var catalog = emptyDriverCatalog();
    var title = ports.translate("Demo — moving test pattern");
    ["pattern.mp4", "pattern.m3u8"].forEach(function (file, index) {
        var id = 900000001 + index;
        catalog.ids.push(id);
        catalog.channels[id] = {
            category: { class: 2, name: "Demo" },
            channel_name: title + (index ? " (HLS)" : " (MP4)"),
            logo: "",
            rec: 0,
            time: 0,
            time_to: 0,
            url: "https://liminal-sketch-vv8r.here.now/demo/" + file,
        };
    });
    function active() {
        return !disposed && owner.active();
    }
    var driver: ProviderDriver = {
        archive: function () {
            return "";
        },
        capabilities: {
            archive: false,
            guide: true,
            media: false,
            settings: false,
        },
        credentials: function () {
            return { password: "", server: "", username: "" };
        },
        dispose: function () {
            disposed = true;
        },
        guide: function (_, callback) {
            if (active()) callback([]);
        },
        id: "demo",
        load: function (callback) {
            if (active()) callback(driverCatalogSnapshot(catalog));
        },
        logo: function () {
            return "";
        },
        saveCredentials: function () {},
        stream: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].url
                : "";
        },
    };
    owner.own(driver.dispose);
    return driver;
}

function createDriverTransport(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    active: () => boolean
) {
    var requests: Array<() => void> = [];
    function request(
        scope: DriverLifetime,
        options: DriverHttpRequest,
        done: (value: any) => void,
        fail: () => void
    ) {
        var settled = false;
        var release = function () {};
        var releaseOwner = function () {};
        function finish(callback: () => void) {
            if (settled) return;
            settled = true;
            release();
            releaseOwner();
            var index = requests.indexOf(cleanup);
            if (index !== -1) requests.splice(index, 1);
            if (active() && scope.active()) callback();
        }
        var cleanup = function () {};
        var abort = ports.request(
            options,
            function (value) {
                finish(function () {
                    done(value);
                });
            },
            function () {
                finish(fail);
            }
        );
        if (!settled) {
            cleanup = function () {
                if (!settled) {
                    settled = true;
                    release();
                    releaseOwner();
                    var index = requests.indexOf(cleanup);
                    if (index !== -1) requests.splice(index, 1);
                    abort();
                }
            };
            requests.push(cleanup);
            release = scope.own(cleanup);
            if (!settled) releaseOwner = owner.own(cleanup);
        }
    }
    return {
        dispose: function () {
            requests.slice().forEach(function (cancel) {
                cancel();
            });
            requests = [];
        },
        send: request,
    };
}

function createXtreamDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime
): ProviderDriver {
    var disposed = false;
    var catalog = emptyDriverCatalog();
    var loads = ports.createLifetime();
    function active() {
        return !disposed && owner.active();
    }
    var transport = createDriverTransport(ports, owner, active);
    function credentials(): ProviderCredentials {
        var value: any;
        try {
            value = JSON.parse(ports.storage.get("xtream_data") || "null");
        } catch (_) {}
        return value && value.server
            ? {
                  password: String(value.password || ""),
                  server: String(value.server),
                  username: String(value.username || ""),
              }
            : { password: "", server: "", username: "" };
    }
    function client(value: ProviderCredentials) {
        return ports.core.legacyXtreamClient(
            value.server,
            value.username,
            value.password,
            encodeURIComponent
        );
    }
    var driver: ProviderDriver = {
        archive: function (id, start, end) {
            var row = active() && catalog.channels[id];
            return row
                ? ports.core.providerArchiveUrl(
                      "template",
                      row.url || "",
                      row.caso || "",
                      row.ca || "",
                      Number(start),
                      Number(end),
                      ports.now(),
                      ports.isDune(),
                      0
                  ) || ""
                : "";
        },
        capabilities: {
            archive: true,
            guide: true,
            media: false,
            settings: true,
        },
        credentials: credentials,
        dispose: function () {
            if (disposed) return;
            disposed = true;
            loads.dispose();
            transport.dispose();
            catalog = emptyDriverCatalog();
        },
        guide: function (id, callback) {
            if (!active()) return;
            var config = credentials();
            var channel = catalog.channels[id];
            if (
                !config.server ||
                !config.username ||
                !config.password ||
                !channel ||
                !channel.epg
            ) {
                callback(null);
                return;
            }
            var source = client(config);
            transport.send(
                loads.current() || owner,
                {
                    dataType: "json",
                    timeout: 10000,
                    type: "GET",
                    url: source.shortEpgUrl(String(channel.epg)),
                },
                function (response) {
                    callback(
                        source.guide(response, function (value: any) {
                            return new Date(value).getTime() / 1000;
                        })
                    );
                },
                function () {
                    callback(null);
                }
            );
        },
        id: "xtream",
        load: function (callback) {
            if (!active()) return;
            var scope = loads.activate("catalog");
            catalog = emptyDriverCatalog();
            var config = credentials();
            if (
                !config.server ||
                !config.username ||
                !config.password ||
                !ports.validateUrl(config.server)
            ) {
                callback(null, "credentials");
                return;
            }
            var source = client(config);
            transport.send(
                scope,
                {
                    dataType: "json",
                    timeout: 15000,
                    type: "GET",
                    url: source.request(),
                },
                function (response) {
                    catalog = emptyDriverCatalog();
                    if (source.accept(response))
                        callback(driverCatalogSnapshot(catalog), "catalog");
                    else {
                        // The shared core owns provider parsing and stable historical IDs.
                        // This wire shape is converted to the retained UI only by the binding below.
                        catalog = source.legacyCatalog(ports.hash);
                        callback(driverCatalogSnapshot(catalog));
                    }
                },
                function () {
                    callback(driverCatalogSnapshot(catalog), "network");
                }
            );
        },
        logo: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].logo || ""
                : "";
        },
        saveCredentials: function (value) {
            if (!active()) return;
            loads.dispose();
            catalog = emptyDriverCatalog();
            ports.storage.set(
                "xtream_data",
                JSON.stringify({
                    data: null,
                    password: value.password,
                    server: value.server,
                    username: value.username,
                })
            );
        },
        stream: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].url || ""
                : "";
        },
    };
    owner.own(driver.dispose);
    return driver;
}

function createOperatorDriver(
    profile: ProviderDriverProfile,
    ports: ProviderDriverPorts,
    owner: DriverLifetime
): ProviderDriver {
    var disposed = false;
    var catalog = emptyDriverCatalog();
    var config: any = {};
    var loads = ports.createLifetime();
    function active() {
        return !disposed && owner.active();
    }
    var transport = createDriverTransport(ports, owner, active);
    function readConfiguration(): any {
        var value: any;
        try {
            value = JSON.parse(ports.storage.get("cfg") || "null");
        } catch (_) {}
        return value && (value.server || value.m3u)
            ? value
            : { m3u: "", pass: "", server: "", user: "" };
    }
    function credentials(): ProviderCredentials {
        var value = readConfiguration();
        return {
            password: String(value.pass || ""),
            playlist: String(value.m3u || ""),
            server: String(value.server || ""),
            username: String(value.user || ""),
        };
    }
    var driver: ProviderDriver = {
        archive: function () {
            return "";
        },
        capabilities: {
            archive: false,
            guide: false,
            media: false,
            settings: true,
        },
        configuration: function () {
            var copy: any = {};
            Object.keys(config).forEach(function (key) {
                copy[key] = config[key];
            });
            return copy;
        },
        credentials: credentials,
        dispose: function () {
            if (disposed) return;
            disposed = true;
            loads.dispose();
            transport.dispose();
            catalog = emptyDriverCatalog();
        },
        guide: function (_, callback) {
            if (active()) callback(null);
        },
        id: profile.id,
        load: function (callback) {
            if (!active()) return;
            var scope = loads.activate("catalog");
            catalog = emptyDriverCatalog();
            config = readConfiguration();
            function complete(error?: string, pending?: boolean) {
                if (active() && scope.active())
                    callback(driverCatalogSnapshot(catalog), error, pending);
            }
            function playlist(url: string) {
                ports.progress("Loading M3U...");
                var plan = new ports.core.OperatorPlaylistClient(
                    url,
                    ports.relay,
                    false,
                    "generic",
                    encodeURIComponent
                );
                function next() {
                    if (!active() || !scope.active()) return;
                    var request = plan.request();
                    if (!request) {
                        complete();
                        return;
                    }
                    transport.send(
                        scope,
                        request,
                        function (data) {
                            plan.accept();
                            catalog = emptyDriverCatalog();
                            try {
                                catalog = ports.core.parseProviderPlaylist(
                                    data,
                                    "generic",
                                    ports.hash,
                                    0
                                );
                            } catch (_) {}
                            complete();
                        },
                        function () {
                            plan.reject();
                            if (plan.request()) next();
                            else complete("playlist");
                        }
                    );
                }
                next();
            }
            var action = ports.core.operatorSourceAction(config);
            if (action === "PLAYLIST") {
                playlist(config.m3u);
                return;
            }
            if (action !== "API") {
                complete("configure");
                return;
            }
            ports.progress("Loading from API...");
            var session = new ports.core.OperatorClient(
                config,
                encodeURIComponent,
                ports.hash
            );
            transport.send(
                scope,
                {
                    dataType: "json",
                    timeout: 15000,
                    type: "GET",
                    url: session.request(),
                },
                function (response) {
                    try {
                        session.accept(response);
                    } catch (error) {
                        catalog = session.catalog();
                        complete(undefined, true);
                        throw error;
                    }
                    catalog = session.catalog();
                    if (session.action() === "PLAYLIST") {
                        config.m3u = session.request();
                        playlist(config.m3u);
                    } else complete();
                },
                function () {
                    session.reject();
                    config.m3u = session.request();
                    playlist(config.m3u);
                }
            );
        },
        logo: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].logo || ""
                : "";
        },
        saveCredentials: function (value) {
            if (!active()) return;
            loads.dispose();
            catalog = emptyDriverCatalog();
            config = readConfiguration();
            config.server = value.server;
            config.user = value.username;
            config.pass = value.password;
            config.m3u = value.playlist || "";
            ports.storage.set("cfg", JSON.stringify(config));
        },
        stream: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].url || ""
                : "";
        },
    };
    owner.own(driver.dispose);
    return driver;
}

var providerDriverProfiles: ProviderDriverProfile[] = (window as any)
    .__ottProviderDriverProfiles;
var providerDriverRegistry = createDriverRegistry();
providerDriverProfiles.forEach(function (profile) {
    providerDriverRegistry.register(
        profile.id,
        profile.kind === "demo"
            ? createDemoDriver
            : profile.kind === "xtream"
              ? createXtreamDriver
              : function (ports, owner) {
                    return createOperatorDriver(profile, ports, owner);
                }
    );
});

/** Retained UI/storage wire codec. No executable provider script enters this boundary. */
function mountProviderDriver(
    host: any,
    id: string,
    owner: DriverLifetime
): ProviderDriver {
    var profile = providerDriverProfiles.filter(function (value) {
        return value.id === id;
    })[0];
    if (!profile) throw new Error("Unsupported provider driver: " + id);
    var generic = profile.kind === "operator";
    var store: DriverStorage = {
        get: function (key) {
            return host.stbGetItem(profile.prefix + key);
        },
        remove: function (key) {
            host.stbDelItem(profile.prefix + key);
        },
        set: function (key, value) {
            host.stbSetItem(profile.prefix + key, value);
        },
    };
    var driver = providerDriverRegistry.create(
        id,
        {
            core: host.OttPlayCore,
            createLifetime: host.__ottProviderRuntime.createRegistry,
            hash: function (name) {
                return host.xxHash32S(name, true);
            },
            isDune: function () {
                return host.browserName() === "dune";
            },
            now: function () {
                return Date.now() / 1000;
            },
            progress: function (message) {
                host.$(host.launch_id).append(host._(message));
            },
            relay: host.host || "",
            request: function (options, done, fail) {
                var pending = host.$.ajax(options);
                pending.done(done).fail(fail);
                return function () {
                    if (typeof pending.abort === "function") pending.abort();
                };
            },
            storage: store,
            translate: function (value) {
                return host._(value);
            },
            validateUrl: function (value) {
                return host.checkProviderUrl(value);
            },
        },
        owner
    );
    host.__ottActiveProviderDriver = driver;
    host.p_pref = profile.prefix;
    host.ottplayDemoActive = id === "demo";
    host.providerGetItem = store.get;
    host.providerSetItem = store.set;
    host.providerDelItem = store.remove;
    host.providerHasItem = function (key: string) {
        var value = store.get(key);
        return value !== null && value !== undefined;
    };
    host.providerHasItemValue = function (key: string) {
        var value = store.get(key);
        return value !== null && value !== undefined && value !== "";
    };
    host.getMediaArray = null;
    host.getChannelUrl = driver.stream;
    host.getChannelPicon = driver.logo;
    host.getArchiveUrl = driver.archive;
    host.getChannelEpg = function (channel: any, callback: any) {
        driver.guide(channel, function (guide) {
            callback(channel, guide);
        });
    };
    if (id !== "demo")
        host.parental = /XXX|Взрослые|Для взрослых|Эротика|18\+|Adults/i;
    function label() {
        var config = driver.credentials();
        return (
            host._(profile.title + " settings") +
            (config.server && (!generic || config.username)
                ? ": " +
                  config.server.replace(/^https?:\/\//, "").split("/")[0] +
                  " (" +
                  config.username +
                  ")"
                : generic && config.playlist
                  ? ": " + config.playlist.substr(0, 40) + "..."
                  : "")
        );
    }
    function updateLabel() {
        var index = host.popupActions.indexOf(editSettings);
        if (index !== -1) host.popupArray[index] = label();
    }
    function editSettings() {
        if (!owner.active()) return;
        var draft = driver.credentials();
        var fields = generic
            ? ["server", "username", "password", "playlist"]
            : ["server", "username", "password"];
        var titles = generic
            ? ["Server", "Login", "Password", "M3U"]
            : ["Server", "Username", "Password"];
        var prompts = generic
            ? ["Server URL", "Username", "Password", "M3U URL"]
            : ["Enter Xtream server URL", "Enter username", "Enter password"];
        var details = generic
            ? ["API server URL", "Username", "Password", "M3U URL (fallback)"]
            : prompts;
        var saveIndex = fields.length + 1;
        var saveLabel = generic ? "Save and load" : "Save and load channels";
        function render() {
            host.listArray = fields
                .map(function (field, index) {
                    var value = (draft as any)[field] || "";
                    if (field === "playlist") value = value.substr(0, 45);
                    return (
                        host._(titles[index]) +
                        ": " +
                        (index === 2 && value ? "********" : value)
                    );
                })
                .concat(["", host._(saveLabel)]);
            host.listDataArray = host.listArray;
        }
        host.selIndex = 0;
        render();
        host.getListItem = function (value: any) {
            return "&nbsp;&nbsp;" + value;
        };
        host.detailListAction = function () {
            host.listDetail.innerHTML = host._(
                host.selIndex < fields.length
                    ? details[host.selIndex]
                    : host.selIndex === saveIndex
                      ? generic
                          ? "Save & load channels"
                          : "Save settings and load channel list"
                      : ""
            );
        };
        host.listKeyHandler = function (key: number) {
            if (!owner.active()) return false;
            if (key === host.keys.RETURN) {
                host.popupList(
                    host.popupActions.indexOf(
                        host.toggleProviderSettingsVisibility
                    ) + 1
                );
                return true;
            }
            if (key !== host.keys.ENTER) return false;
            var selected = host.selIndex;
            if (selected < fields.length) {
                host.editCaption = host._(prompts[selected]);
                host.editvar = (draft as any)[fields[selected]];
                host.setEdit = function () {
                    if (!owner.active()) return;
                    (draft as any)[fields[selected]] = String(
                        host.editvar
                    ).trim();
                    render();
                    host.showPage();
                };
                host.showEditKey(host.keys.ENTER, selected === 2);
            } else if (selected === saveIndex) {
                driver.saveCredentials(draft);
                updateLabel();
                host.loadChannels();
            }
            return true;
        };
        host.listDetail.innerHTML = "";
        host.listCaption.innerHTML = host._(
            generic ? profile.title : "Xtream Codes Provider"
        );
        host.listFooter.innerHTML = host.renderButtonHint(
            host.keys.RETURN,
            host.strRETURN,
            "Close"
        );
        host.$("#listPopUp").hide();
        host.showPage();
    }
    host.duneAddSettings = function (index: number) {
        if (!owner.active() || !driver.capabilities.settings) return;
        host.popupActions.splice(index, 1, editSettings);
        host.popupArray.splice(index, 1, label());
        host.popupDetail.splice(index, 1, host._(profile.title + " settings"));
    };
    host.getChannelsArray = function (callback: () => void) {
        if (!owner.active()) return;
        if (id === "xtream")
            host.$(host.launch_id).append(
                host._("Loading channels from Xtream API...")
            );
        driver.load(function (catalog, error, pending) {
            if (!owner.active()) return;
            if (error === "credentials") {
                editSettings();
                return;
            }
            if (catalog) {
                // Catalog replacement is confined to this explicit legacy-view codec.
                host.cList = catalog.ids.slice();
                var channels = host.channels || {};
                Object.keys(channels).forEach(function (key) {
                    delete channels[key];
                });
                Object.keys(catalog.channels).forEach(function (key) {
                    channels[key] = catalog.channels[key];
                });
                host.channels = channels;
                host.cats = catalog.groups;
                host.catsArray = catalog.groupOrder.slice();
            }
            if (pending) return;
            if (error)
                host.alert(
                    host._(
                        error === "configure"
                            ? "Configure " +
                                  profile.title +
                                  " in Settings -> Provider Settings"
                            : error === "playlist"
                              ? "Failed to load!"
                              : error === "network"
                                ? "Failed to connect to Xtream API server"
                                : "Failed to load channels from Xtream API"
                    )
                );
            callback();
        });
    };
    return driver;
}

(window as any).__ottProviderDrivers = {
    createRegistry: createDriverRegistry,
    mount: mountProviderDriver,
    registry: providerDriverRegistry,
};
