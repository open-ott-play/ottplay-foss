/** Instance lifecycles for classic MAG and the retained MAC JSON-RPC dialect. */
function classicStalkerUrl(url: string): string {
    var clean = url.split(/[?#]/)[0].replace(/\/+$/, "");
    if (/\/stalker_portal$/i.test(clean)) return clean + "/c/";
    return /\/(?:c(?:\/index\.html)?|(?:server\/)?load\.php|portal\.php)$/i.test(
        clean
    )
        ? clean
        : "";
}

var classicStalkerSequence = 0;

/** HTTP/JSON and classic-view codecs; handshake, paging and link policy stay in core. */
function createClassicStalkerDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    helpers: StalkerDriverHelpers,
    credentials: ProviderCredentials
): ProviderDriver {
    var alive = true;
    var lifetime = ports.createLifetime();
    var scope = lifetime.activate("classic-stalker");
    var prefix = "ottplay-stalker:" + ++classicStalkerSequence + ":";
    var catalog = helpers.emptyCatalog();
    var nodes: Record<string, any> = Object.create(null);
    var rawRows: Record<string, any> = Object.create(null);
    var headers: Record<string, string> = {};
    var config: any = {
        id: "classic-stalker",
        language: "en",
        mac: credentials.username,
        profile: { stb_type: "MAG250" },
        timezone: "Etc/UTC",
        url: classicStalkerUrl(credentials.server),
    };
    var location = ports.core.stalkerConfig(config);
    Object.keys(location).forEach(function (key) {
        config[key] = location[key];
    });
    function active() {
        if (!alive || !owner.active() || !scope.active()) return false;
        try {
            var saved = JSON.parse(ports.storage.get("stalker_data") || "null");
            return (
                saved &&
                saved.portal === credentials.server &&
                saved.mac === credentials.username
            );
        } catch (_) {
            return false;
        }
    }
    var transport = helpers.transport(ports, owner, active);
    function absolute(value: string): string {
        if (!value) return "";
        try {
            var url = new URL(value, config.referer);
            return /^https?:$/.test(url.protocol) &&
                !url.username &&
                !url.password
                ? url.href
                : "";
        } catch (_) {
            return "";
        }
    }
    var client = config.failure
        ? null
        : new ports.core.StalkerClient(
              config,
              1,
              encodeURIComponent,
              absolute,
              absolute
          );
    function send(
        request: any,
        current: DriverLifetime,
        done: (data: any) => void,
        fail: (...args: any[]) => void
    ) {
        var native = ports.m3u && ports.m3u.native();
        transport.send(
            current,
            native
                ? {
                      dataType: "json",
                      headers: request.headers,
                      timeout: 15000,
                      type: "GET",
                      url: request.url,
                  }
                : {
                      contentType: "application/json",
                      data: JSON.stringify({
                          headers: request.headers,
                          url: request.url,
                      }),
                      dataType: "json",
                      timeout: 20000,
                      type: "POST",
                      url:
                          (ports.relay || "").replace(/\/+$/, "") +
                          "/stalker/api",
                  },
            done,
            fail
        );
    }
    function run(
        operation: any,
        current: DriverLifetime,
        done: (result: any) => void,
        fail: (auth?: boolean) => void
    ) {
        if (!active() || !current.active()) return;
        if (!operation || operation.failure) {
            fail();
            return;
        }
        var request = operation.request();
        if (!request) {
            done(operation.result());
            return;
        }
        headers = request.headers;
        send(
            request,
            current,
            function (data) {
                var response = data && data.js;
                if (response && Array.isArray(response.data))
                    response.data.forEach(function (row: any) {
                        if (row && row.id != null)
                            rawRows[String(row.id)] = row;
                    });
                var error = operation.accept(data);
                if (error) {
                    fail(!!(response && response.not_valid_token));
                    return;
                }
                run(operation, current, done, fail);
            },
            function (xhr: any) {
                fail(!!xhr && (xhr.status === 401 || xhr.status === 403));
            }
        );
    }
    function build(result: any) {
        var rows: any[] = [];
        nodes = Object.create(null);
        result.channels.forEach(function (item: any) {
            if (item.kind !== "live") return;
            var id = decodeURIComponent(
                item.id.slice(item.id.lastIndexOf(":") + 1)
            );
            var raw = rawRows[id] || {};
            var reference = prefix + encodeURIComponent(item.id);
            nodes[reference] = { id: id, item: item, raw: raw };
            rows.push({
                genre: item.group,
                id: id,
                logo: absolute(raw.logo || item.logo),
                name: raw.name || item.name,
                url: reference,
            });
        });
        // Project through the existing shared catalog identity codec.
        var projection = new ports.core.LegacyStalkerClient(
            credentials.server,
            credentials.username
        );
        projection.accept({ result: {} });
        projection.accept({ result: rows });
        catalog = ports.channelCatalog!(
            projection.channelCatalog(),
            ports.hash,
            "stalker"
        );
    }
    function dispose() {
        alive = false;
        lifetime.dispose();
        transport.dispose();
        nodes = Object.create(null);
        rawRows = Object.create(null);
        headers = {};
        catalog = helpers.emptyCatalog();
    }
    owner.own(dispose);
    return {
        archive: function () {
            return "";
        },
        capabilities: {
            archive: false,
            guide: true,
            media: false,
            settings: true,
        },
        credentials: function () {
            return credentials;
        },
        dispose: dispose,
        guide: function (id, done) {
            var row = active() && catalog.channels[id];
            var node = row && nodes[row.url];
            if (!node) {
                done(null);
                return;
            }
            send(
                {
                    headers: headers,
                    url:
                        config.endpoint +
                        "?type=itv&action=get_short_epg&ch_id=" +
                        encodeURIComponent(node.id) +
                        "&size=100&JsHttpRequest=1-xml",
                },
                scope,
                function (data) {
                    var entries = data && data.js;
                    if (!Array.isArray(entries)) {
                        done(null);
                        return;
                    }
                    var adapted = entries.map(function (entry: any) {
                        return {
                            descr: entry.descr,
                            end_timestamp:
                                entry.stop_timestamp || entry.end_timestamp,
                            name: entry.name,
                            start_timestamp: entry.start_timestamp,
                        };
                    });
                    done(
                        new ports.core.LegacyStalkerClient("", "").guide({
                            result: adapted,
                        })
                    );
                },
                function () {
                    done(null);
                }
            );
        },
        id: "stalker",
        load: function (done) {
            if (!client) {
                done(null, "credentials");
                return;
            }
            ports.progress("Connecting to Stalker portal...");
            run(
                client.load(),
                scope,
                function (result) {
                    build(result);
                    done(helpers.snapshot(catalog));
                },
                function () {
                    done(helpers.emptyCatalog(), "stalker-connect");
                }
            );
        },
        logo: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].logo
                : "";
        },
        resolveStream: function (url, done) {
            var requestLife = ports.createLifetime();
            var requestScope = requestLife.activate("link");
            var node = active() && nodes[url];
            if (!node) {
                done(url.indexOf("ottplay-stalker:") === 0 ? null : url);
                return function () {};
            }
            // A direct command explicitly marked non-temporary needs no create_link.
            var raw = node.raw;
            var direct = String(raw.cmd || "").replace(
                /^(?:ffmpeg|ffrt)\s+/i,
                ""
            );
            if (
                raw.use_http_tmp_link != null &&
                Number(raw.use_http_tmp_link) === 0 &&
                !Number(raw.wowza_tmp_link) &&
                !Number(raw.use_load_balancing) &&
                !Number(raw.nginx_secure_link) &&
                /^https?:\/\//i.test(direct) &&
                !/^https?:\/\/(?:localhost|127\.|\[::1\])/i.test(direct)
            ) {
                done(absolute(direct));
            } else {
                var retried = false;
                function resolve() {
                    run(
                        client.playback(node.item),
                        requestScope,
                        function (result) {
                            done(result.url || null);
                        },
                        function (auth) {
                            if (!auth || retried) {
                                done(null);
                                return;
                            }
                            retried = true;
                            run(
                                client.load(),
                                requestScope,
                                resolve,
                                function () {
                                    done(null);
                                }
                            );
                        }
                    );
                }
                resolve();
            }
            return function () {
                requestLife.dispose();
            };
        },
        saveCredentials: function () {},
        stream: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].url
                : "";
        },
    };
}

interface StalkerDriverHelpers {
    emptyCatalog(): DriverCatalog;
    snapshot(catalog: DriverCatalog): DriverCatalog;
    transport(
        ports: ProviderDriverPorts,
        owner: DriverLifetime,
        active: () => boolean
    ): {
        dispose(): void;
        send(
            scope: DriverLifetime,
            request: DriverHttpRequest,
            done: (value: any) => void,
            fail: () => void
        ): void;
    };
}

function createStalkerProviderDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    helpers: StalkerDriverHelpers
): ProviderDriver {
    var disposed = false;
    var revision = 0;
    var catalogs = ports.createLifetime();
    var catalog = helpers.emptyCatalog();
    var loaded: ProviderCredentials | null = null;
    var classic: ProviderDriver | null = null;
    function retireClassic() {
        var previous = classic;
        classic = null;
        if (previous) previous.dispose();
    }
    function active(): boolean {
        return !disposed && owner.active();
    }
    var transport = helpers.transport(ports, owner, active);
    function credentials(): ProviderCredentials {
        var value: any;
        try {
            value = JSON.parse(ports.storage.get("stalker_data") || "null");
        } catch (_) {}
        return {
            password: "",
            server: value && value.portal ? String(value.portal) : "",
            username: value && value.portal ? String(value.mac || "") : "",
        };
    }
    function matches(config: ProviderCredentials): boolean {
        var current = credentials();
        return (
            active() &&
            current.server === config.server &&
            current.username === config.username
        );
    }
    function client(config: ProviderCredentials): any {
        return new ports.core.LegacyStalkerClient(
            config.server,
            config.username
        );
    }
    function post(
        scope: DriverLifetime,
        config: ProviderCredentials,
        source: any,
        data: any,
        timeout: number,
        receive: (value: any) => void
    ): void {
        transport.send(
            scope,
            {
                contentType: "application/json",
                data: JSON.stringify(data),
                dataType: "json",
                timeout: timeout,
                type: "POST",
                url: source.endpoint(),
            },
            function (value) {
                if (matches(config)) receive(value);
            },
            function () {
                if (matches(config)) receive(null);
            }
        );
    }
    function row(id: string | number): any {
        return loaded && matches(loaded) ? catalog.channels[id] : null;
    }
    var driver: ProviderDriver = {
        archive: function (id, start, end) {
            if (classic) return classic.archive(id, start, end);
            var channel = row(id);
            return channel
                ? ports.core.providerArchiveUrl(
                      "template",
                      channel.url || "",
                      channel.caso || "",
                      channel.ca || "",
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
            retireClassic();
            revision++;
            catalogs.dispose();
            transport.dispose();
            loaded = null;
            catalog = helpers.emptyCatalog();
        },
        guide: function (id, callback) {
            if (classic) return classic.guide(id, callback);
            if (!active()) return;
            var channel = row(id);
            var scope = catalogs.current();
            if (!loaded || !scope || !channel || !channel.epg) {
                callback(null);
                return;
            }
            var config = loaded;
            var source = client(config);
            post(
                scope,
                config,
                source,
                source.guideRequest(channel.epg, ports.now),
                10000,
                function (response) {
                    callback(source.guide(response));
                }
            );
        },
        id: "stalker",
        load: function (callback) {
            if (!active()) return;
            var operation = ++revision;
            retireClassic();
            var scope = catalogs.activate("catalog");
            if (!active() || !scope.active() || operation !== revision) return;
            loaded = null;
            catalog = helpers.emptyCatalog();
            var config = credentials();
            var valid =
                config.server &&
                config.username &&
                ports.validateUrl(config.server);
            if (!active() || !scope.active() || operation !== revision) return;
            if (!valid) {
                callback(null, "credentials");
                return;
            }
            if (classicStalkerUrl(config.server)) {
                classic = createClassicStalkerDriver(
                    ports,
                    scope,
                    helpers,
                    config
                );
                classic.load(callback);
                return;
            }
            var source = client(config);
            ports.progress("Connecting to Stalker portal...");
            function advance(): void {
                if (!scope.active() || !matches(config)) return;
                var request = source.request();
                if (!request) {
                    var parsed = ports.channelCatalog!(
                        source.channelCatalog(),
                        ports.hash,
                        "stalker"
                    );
                    if (!scope.active() || !matches(config)) return;
                    catalog = parsed;
                    loaded = config;
                    callback(helpers.snapshot(catalog));
                    return;
                }
                if (request.method === "get_channels")
                    ports.progress("Loading channels...");
                if (!scope.active() || !matches(config)) return;
                post(
                    scope,
                    config,
                    source,
                    request,
                    15000,
                    function (response) {
                        var error = source.accept(response);
                        if (error)
                            callback(
                                helpers.snapshot(catalog),
                                error.failure === "LEGACY_CONNECT"
                                    ? "stalker-connect"
                                    : "stalker-catalog"
                            );
                        else advance();
                    }
                );
            }
            advance();
        },
        logo: function (id) {
            if (classic) return classic.logo(id);
            var channel = row(id);
            return channel ? channel.logo || "" : "";
        },
        resolveStream: function (url, callback) {
            if (classic) return classic.resolveStream!(url, callback);
            callback(url.indexOf("ottplay-stalker:") === 0 ? null : url);
            return function () {};
        },
        saveCredentials: function (value) {
            retireClassic();
            if (!active()) return;
            var operation = ++revision;
            catalogs.dispose();
            if (!active() || operation !== revision) return;
            loaded = null;
            catalog = helpers.emptyCatalog();
            ports.storage.set(
                "stalker_data",
                JSON.stringify({
                    data: null,
                    mac: value.username,
                    portal: value.server,
                    token: "",
                })
            );
        },
        stream: function (id) {
            if (classic) return classic.stream(id);
            var channel = row(id);
            return channel ? channel.url || "" : "";
        },
    };
    owner.own(driver.dispose);
    return driver;
}

/** Retained menu projection. Draft edits and callbacks belong to this mounted instance. */
function mountStalkerProviderSettings(
    host: any,
    driver: ProviderDriver,
    owner: DriverLifetime
) {
    var revision = 0;
    function updateLabel(): void {
        if (!owner.active()) return;
        var index = host.popupActions.indexOf(edit);
        if (index < 0) return;
        var config = driver.credentials();
        host.popupArray[index] =
            host._("Stalker portal settings") +
            (config.server
                ? ": " +
                  config.server.replace(/^https?:\/\//, "").split("/")[0] +
                  " (" +
                  config.username +
                  ")"
                : "");
    }
    function edit(): void {
        if (!owner.active()) return;
        var editor = ++revision;
        var fieldRevision = 0;
        var draft = driver.credentials();
        var titles = ["Portal URL", "MAC address"];
        var prompts = ["Enter Stalker portal URL", "Enter MAC address"];
        var details = [
            "Enter Stalker portal URL (e.g. http://your-portal/stalker_portal/c/)",
            "Enter MAC address (e.g. 00:1A:2B:3C:4D:5E)",
            "",
            "Save settings and load channel list",
        ];
        function current(): boolean {
            return owner.active() && revision === editor;
        }
        function render(): void {
            host.listArray = [
                host._(titles[0]) + ": " + draft.server,
                host._(titles[1]) + ": " + draft.username,
                "",
                host._("Save and load channels"),
            ];
            host.listDataArray = host.listArray;
        }
        host.selIndex = 0;
        render();
        host.getListItem = function (value: any) {
            return "&nbsp;&nbsp;" + value;
        };
        host.detailListAction = function () {
            if (current())
                host.listDetail.innerHTML = host._(
                    details[host.selIndex] || ""
                );
        };
        host.listKeyHandler = function (key: number) {
            if (!current()) return false;
            if (key === host.keys.RETURN) {
                revision++;
                host.popupList(
                    host.popupActions.indexOf(
                        host.toggleProviderSettingsVisibility
                    ) + 1
                );
                return true;
            }
            if (key !== host.keys.ENTER) return false;
            var index = host.selIndex;
            if (index === 0 || index === 1) {
                var field = ++fieldRevision;
                host.editCaption = host._(prompts[index]);
                host.editvar = index ? draft.username : draft.server;
                host.setEdit = function () {
                    if (!current() || field !== fieldRevision) return;
                    fieldRevision++;
                    var value = String(host.editvar).trim();
                    if (index) draft.username = value.toUpperCase();
                    else draft.server = value.replace(/\/+$/, "");
                    render();
                    host.showPage();
                };
                host.showEditKey(host.keys.ENTER);
            } else if (index === 3) {
                revision++;
                driver.saveCredentials(draft);
                if (!owner.active()) return true;
                updateLabel();
                host.loadChannels();
            }
            return true;
        };
        host.listDetail.innerHTML = "";
        host.listCaption.innerHTML = host._("Stalker Portal Provider");
        host.listFooter.innerHTML = host.renderButtonHint(
            host.keys.RETURN,
            host.strRETURN,
            "Close"
        );
        host.$("#listPopUp").hide();
        host.showPage();
    }
    return {
        edit: edit,
        mount: function (index: number) {
            if (!owner.active()) return;
            host.popupActions.splice(index, 1, edit);
            host.popupArray.splice(index, 1, "");
            host.popupDetail.splice(
                index,
                1,
                host._("Stalker portal settings")
            );
            updateLabel();
        },
        updateLabel: updateLabel,
    };
}

if (typeof window !== "undefined")
    (window as any).__ottStalkerDriver = {
        create: createStalkerProviderDriver,
        mountSettings: mountStalkerProviderSettings,
    };
