/** Independent, device-local VPortal profiles. M3U settings remain untouched. */
interface VPortalProviderDriver extends ProviderDriver {
    mediaClient(): any;
    remoteProfiles?(request: any): any;
    saveConfiguration(value: any): boolean;
}

function createVPortalProviderDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    helpers: any
): VPortalProviderDriver {
    var disposed = false;
    var revision = 0;
    var client: any = null;
    var ready = false;
    var api = (window as any).__ottVPortal;
    function active(): boolean {
        return !disposed && owner.active();
    }
    var operations = helpers.credentials(ports, active);
    function configuration(): any {
        var value: any;
        try {
            value = JSON.parse(ports.storage.get("profiles") || "null");
        } catch (_) {}
        var config: any = { active: 0, portals: [] };
        if (
            value &&
            value.active >= 0 &&
            value.active < 15 &&
            Math.floor(value.active) === value.active
        )
            config.active = value.active;
        for (var i = 0; i < 15; i++) {
            var row = value && Array.isArray(value.portals) && value.portals[i];
            config.portals.push({
                link: row && typeof row.link === "string" ? row.link : "",
                name: row && typeof row.name === "string" ? row.name : "",
            });
        }
        return config;
    }
    function retire(): void {
        revision++;
        ready = false;
        var previous = client;
        client = null;
        if (previous) previous.dispose();
        if (driver && (driver as any).publishLibrary)
            (driver as any).publishLibrary();
    }
    function validText(value: any, limit: number): boolean {
        try {
            return (
                typeof value === "string" &&
                !/[\u0000-\u001f\u007f]/.test(value) &&
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= limit
            );
        } catch (_) {
            return false;
        }
    }
    function saveConfiguration(value: any): boolean {
        return operations.run(function (current: () => boolean) {
            if (
                !value ||
                !Array.isArray(value.portals) ||
                value.portals.length !== 15 ||
                typeof value.active !== "number" ||
                value.active < 0 ||
                value.active > 14 ||
                Math.floor(value.active) !== value.active
            )
                return false;
            var next: any = { active: value.active, portals: [] };
            var before = JSON.stringify(configuration());
            for (var i = 0; i < 15; i++) {
                var row = value.portals[i];
                if (
                    !row ||
                    !validText(row.name, 256) ||
                    !validText(row.link, 8192)
                )
                    return false;
                var parsed = row.link ? api.parse(row.link) : null;
                if (row.link && (!parsed || !ports.validateUrl(parsed.url)))
                    return false;
                if (!current() || JSON.stringify(configuration()) !== before)
                    return false;
                next.portals.push({ link: row.link, name: row.name });
            }
            if (!operations.write({ profiles: JSON.stringify(next) }, current))
                return false;
            var previous = JSON.parse(before);
            if (
                previous.active !== next.active ||
                JSON.stringify(previous.portals[previous.active]) !==
                    JSON.stringify(next.portals[next.active])
            )
                retire();
            return current();
        }, true);
    }
    var driver: VPortalProviderDriver = {
        archive: function () {
            return "";
        },
        capabilities: {
            archive: false,
            guide: false,
            libraryOnly: true,
            media: true,
            settings: true,
        },
        configuration: configuration,
        credentials: function () {
            var config = configuration();
            return {
                password: "",
                playlist: config.portals[config.active].link,
                server: "",
                username: "",
            };
        },
        dispose: function () {
            if (!disposed) {
                disposed = true;
                retire();
            }
        },
        guide: function (_, done) {
            if (active()) done([]);
        },
        id: "vportal",
        libraryReady: function () {
            return active() && ready;
        },
        load: function (done) {
            operations.run(function (current: () => boolean) {
                retire();
                if (!current()) return;
                var config = configuration();
                var row = config.portals[config.active];
                var parsed = api.parse(row.link);
                if (!parsed || !ports.validateUrl(parsed.url)) {
                    if (current()) done(null, "credentials");
                    return;
                }
                if (!current()) return;
                var generation = revision;
                client = api.create(row.link, {
                    isCurrent: function () {
                        return current() && generation === revision;
                    },
                    sourceId: ports.sourceIdentity!(),
                    title: row.name || "VPortal",
                });
                if (!client || !current()) return;
                ready = true;
                done(helpers.emptyCatalog());
            });
        },
        logo: function () {
            return "";
        },
        mediaClient: function () {
            return active() && ready ? client : null;
        },
        saveConfiguration: saveConfiguration,
        saveCredentials: function (value) {
            var config = configuration();
            config.portals[config.active].link = value.playlist || "";
            return saveConfiguration(config);
        },
        stream: function () {
            return "";
        },
    };
    owner.own(driver.dispose);
    return driver;
}

function mountVPortalProvider(
    host: any,
    driver: VPortalProviderDriver,
    owner: DriverLifetime
): void {
    var revision = 0;
    var attached: any = null;
    function active(): boolean {
        return owner.active();
    }
    function escape(value: any): string {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    function label(): string {
        return host._("VPortal profiles");
    }
    function metadata(config: any, index: number): any {
        var row = config.portals[index];
        return {
            active: config.active === index,
            history_hours: 0,
            name: row.name,
            number: index + 1,
            playlist_configured: false,
            vportal_configured: !!host.__ottVPortal.parse(row.link),
        };
    }
    function locked(): boolean {
        return (
            !!(host.__ottKiosk && host.__ottKiosk.enabled()) ||
            !!(
                host.__ottParental &&
                (host.__ottParental.needs("providers") ||
                    host.__ottParental.needs("settings"))
            )
        );
    }
    driver.remoteProfiles = function (request: any) {
        function fail(message: string): any {
            return { data: { error: message }, status: "rejected" };
        }
        var params = request.params || {};
        if (
            !active() ||
            !params ||
            typeof params !== "object" ||
            Array.isArray(params)
        )
            return fail("Invalid profile parameters.");
        var config = driver.configuration!();
        var before = JSON.stringify(config);
        if (request.action === "profiles") {
            if (Object.keys(params).length)
                return fail("The profiles query accepts no parameters.");
            return {
                data: {
                    profiles: config.portals.map(function (
                        _: any,
                        index: number
                    ) {
                        return metadata(config, index);
                    }),
                    provider: "vportal",
                },
                status: "ok",
            };
        }
        if (locked())
            return fail(
                "Unlock provider settings and kiosk on the player first."
            );
        var selecting = request.action === "profile";
        var number = params.number;
        if (
            typeof number !== "number" ||
            Math.floor(number) !== number ||
            number < 1 ||
            number > 15 ||
            Object.keys(params).length !== (selecting ? 1 : 2) ||
            Object.keys(params).some(function (key) {
                return key !== "number" && !(key === "settings" && !selecting);
            })
        )
            return fail("Choose a profile number from 1 to 15.");
        var index = number - 1;
        var fields: string[] = [];
        if (selecting) {
            if (!host.__ottVPortal.parse(config.portals[index].link))
                return fail(
                    "Configure this profile's VPortal link before selecting it."
                );
            config.active = index;
        } else {
            var settings = params.settings;
            if (
                !settings ||
                typeof settings !== "object" ||
                Array.isArray(settings)
            )
                return fail("Provide profile settings to change.");
            fields = Object.keys(settings);
            if (
                !fields.length ||
                fields.some(function (key) {
                    return key !== "name" && key !== "vportal";
                })
            )
                return fail(
                    "VPortal profiles accept name and vportal fields only."
                );
            fields.forEach(function (key) {
                config.portals[index][key === "vportal" ? "link" : "name"] =
                    settings[key];
            });
        }
        if (
            !active() ||
            locked() ||
            JSON.stringify(driver.configuration!()) !== before
        )
            return fail("The profile changed during validation. Try again.");
        var reload = config.active === index || selecting;
        if (reload && typeof host.loadChannels !== "function")
            return fail("The provider reload lifecycle is unavailable.");
        if (
            !driver.saveConfiguration(config) ||
            !active() ||
            JSON.stringify(driver.configuration!()) !== JSON.stringify(config)
        )
            return fail("Could not complete the profile save.");
        revision++;
        if (reload) host.loadChannels();
        if (
            !active() ||
            JSON.stringify(driver.configuration!()) !== JSON.stringify(config)
        )
            return fail(
                "The provider changed while saving. Check the profile before repeating."
            );
        var data: any = {
            profile: metadata(config, index),
            provider: "vportal",
            reloaded: reload,
        };
        if (selecting) data.dispatched = true;
        else {
            data.saved = true;
            data.fields = fields;
        }
        return { data: data, status: "ok" };
    };
    function edit(): boolean {
        if (!active() || locked()) return false;
        var editor = ++revision;
        var selected = driver.configuration!().active;
        function current(): boolean {
            return active() && revision === editor && !locked();
        }
        function list(): void {
            if (!current()) return;
            var config = driver.configuration!();
            host.listArray = config.portals.map(function (
                row: any,
                index: number
            ) {
                return (
                    index +
                    1 +
                    ": " +
                    escape(row.name || "VPortal") +
                    (index === config.active ? " ✓" : "") +
                    (row.link ? "" : " — " + host._("Not configured"))
                );
            });
            host.listDataArray = host.listArray;
            host.getListItem = function (value: any) {
                return "&nbsp;&nbsp;" + value;
            };
            host.listCaption.innerHTML = label();
            host.listDetail.innerHTML = "";
            host.detailListAction = function () {};
            host.selIndex = selected;
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
                selected = host.selIndex;
                open();
                return true;
            };
            host.showPage();
        }
        function open(): void {
            var config = driver.configuration!();
            var before = JSON.stringify(config);
            var row = config.portals[selected];
            var fieldRevision = 0;
            function render(): void {
                host.listArray = [
                    host._("Profile name") + ": " + escape(row.name),
                    host._("VPortal link") +
                        ": " +
                        (row.link ? "********" : ""),
                    "",
                    host._("Save and open library"),
                ];
                host.listDataArray = host.listArray;
            }
            render();
            host.listCaption.innerHTML = "VPortal — " + (selected + 1);
            host.selIndex = 0;
            host.listKeyHandler = function (key: number) {
                if (!current()) return false;
                if (key === host.keys.RETURN) {
                    fieldRevision++;
                    list();
                    return true;
                }
                if (key !== host.keys.ENTER) return false;
                var index = host.selIndex;
                if (index === 0 || index === 1) {
                    var field = ++fieldRevision;
                    host.editCaption = host._(
                        index ? "VPortal link" : "Profile name"
                    );
                    host.editvar = index ? row.link : row.name;
                    host.setEdit = function () {
                        if (!current() || field !== fieldRevision) return;
                        fieldRevision++;
                        row[index ? "link" : "name"] = String(
                            host.editvar || ""
                        ).trim();
                        render();
                        host.showPage();
                    };
                    host.showEditKey(host.keys.ENTER, index === 1);
                } else if (index === 3) {
                    if (JSON.stringify(driver.configuration!()) !== before) {
                        list();
                        return true;
                    }
                    if (!host.__ottVPortal.parse(row.link)) {
                        host.alert(
                            host._(
                                "Enter the VPortal link as shown in the cabinet"
                            )
                        );
                        return true;
                    }
                    config.active = selected;
                    if (!driver.saveConfiguration(config) || !current()) {
                        if (current())
                            host.alert(
                                host._("Could not save provider settings.")
                            );
                        return true;
                    }
                    revision++;
                    host.loadChannels();
                }
                return true;
            };
            host.showPage();
        }
        host.listFooter.innerHTML = host.renderButtonHint(
            host.keys.RETURN,
            host.strRETURN,
            "Close"
        );
        host.$("#listPopUp").hide();
        list();
        return true;
    }
    edit.menuTitle = label;
    edit.menuDetail = label;
    host.__ottEditProvider = edit;
    host.duneAddSettings = function (index: number) {
        if (!active()) return;
        host.popupActions.splice(index, 1, edit);
        host.popupArray.splice(index, 1, label());
        host.popupDetail.splice(index, 1, label());
    };
    (driver as any).publishLibrary = function () {
        if (!active()) return;
        attached = driver.mediaClient();
        host.providerMediaClient = attached;
        host.getMediaArray = attached ? attached.load : null;
    };
    owner.own(function () {
        revision++;
        if (host.providerMediaClient === attached) {
            host.providerMediaClient = null;
            host.getMediaArray = null;
        }
    });
}

(window as any).__ottVPortalDriver = {
    create: createVPortalProviderDriver,
    mount: mountVPortalProvider,
    reportLoad: function (
        host: any,
        driver: VPortalProviderDriver,
        error?: string
    ): boolean {
        if (!driver.libraryReady!()) {
            if (error && error !== "credentials")
                host.alert(host._("VPortal request failed"));
            host.__ottEditProvider();
            return false;
        }
        (driver as any).publishLibrary();
        return true;
    },
};
