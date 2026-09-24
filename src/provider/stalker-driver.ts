/** Instance lifecycle for the MAC JSON-RPC dialect. Protocol policy lives in core. */
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
            revision++;
            catalogs.dispose();
            transport.dispose();
            loaded = null;
            catalog = helpers.emptyCatalog();
        },
        guide: function (id, callback) {
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
            var channel = row(id);
            return channel ? channel.logo || "" : "";
        },
        saveCredentials: function (value) {
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
            "Enter Stalker portal URL (e.g. http://your-portal:8800)",
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
