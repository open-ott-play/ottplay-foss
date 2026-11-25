/** Map a failed codec transaction to the shared provider rejection vocabulary. */
function nativeProviderFailure(error: any): string {
    var reason = error && error.message;
    return reason === "invalid_value" ||
        reason === "revision_conflict" ||
        reason === "source_changed"
        ? reason
        : "storage_failed";
}
/** Configuration-only driver instances reuse normal codecs without mounting providers. */
function createRemoteProviderSettings(
    w: any,
    runtime: () => string,
    policy: any
): any {
    var sequence = 0,
        context = "",
        contextTag = "",
        signature = "",
        owner: any = null,
        busy = false;
    var receipts: any[] = [];
    function text(value: any, maximum: number): boolean {
        try {
            return (
                typeof value === "string" &&
                !/[\x00-\x1f\x7f]/.test(value) &&
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= maximum
            );
        } catch (_) {
            return false;
        }
    }
    function locked(): boolean {
        return !!(
            (w.__ottKiosk && w.__ottKiosk.enabled()) ||
            (w.__ottParental
                ? w.__ottParental.needs("settings") ||
                  w.__ottParental.needs("providers")
                : (w.sPSoptions || w.sPSprovs) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess)
        );
    }
    function currentContext(tag: string): string {
        var driver = w.__ottActiveProviderDriver;
        var value = JSON.stringify([
            runtime(),
            w.__ottPlayerSettingsHost.source(),
            driver && driver.configuration ? driver.configuration() : null,
        ]);
        if (
            !context ||
            value !== signature ||
            owner !== driver ||
            tag !== contextTag
        ) {
            signature = value;
            owner = driver;
            contextTag = tag;
            receipts = [];
            context = tag + ":" + Date.now().toString(36) + ":" + ++sequence;
        }
        return context;
    }
    /** One receipt per compared state; only the provider that issued it accepts it. */
    function remember(receipt: {
        number: number;
        provider: string;
        snapshot: string | null;
    }): string {
        var revision = "saved:" + Date.now().toString(36) + ":" + ++sequence;
        receipts = receipts.filter(function (r) {
            return r.created <= Date.now() && r.expires > Date.now();
        });
        while (receipts.length >= 128) receipts.shift();
        receipts.push({
            context: currentContext(receipt.provider),
            created: Date.now(),
            expires: Date.now() + 120000,
            number: receipt.number,
            provider: receipt.provider,
            revision: revision,
            snapshot: receipt.snapshot,
        });
        return revision;
    }
    /**
     * Configuration-only Edem instance. The provider driver owns the storage
     * keys, the portal form and the single-transaction save, exactly as it does
     * for the local editor; this session only adds the remote protocol.
     */
    function nativeDriver(active: () => boolean): any {
        var registry =
                w.__ottProviderDrivers && w.__ottProviderDrivers.registry,
            profiles = w.__ottProviderDriverProfiles || [],
            prefix = "";
        if (!registry || !w.__ottProviderRuntime) return null;
        for (var i = 0; i < profiles.length; i++)
            if (profiles[i] && profiles[i].id === "edem")
                prefix = profiles[i].prefix;
        function physical(key: string): string {
            return prefix + key;
        }
        return registry.create(
            "edem",
            {
                commit: function (
                    writes: any[],
                    valid: () => boolean,
                    rollback: () => boolean
                ): boolean {
                    if (typeof w.commitSettingsWrites !== "function")
                        throw new Error("storage_failed");
                    w.commitSettingsWrites(
                        writes.map(function (row: any) {
                            var key = physical(row.key);
                            return {
                                after: row.after,
                                before: row.before,
                                storage: {
                                    key: key,
                                    read: function () {
                                        return w.stbGetItem(key);
                                    },
                                    remove: function () {
                                        w.stbDelItem(key);
                                    },
                                    write: function (value: string) {
                                        w.stbSetItem(key, value);
                                    },
                                },
                            };
                        }),
                        valid,
                        rollback
                    );
                    return valid();
                },
                core: {},
                createLifetime: w.__ottProviderRuntime.createRegistry,
                murmur: function (value: string, seed: number) {
                    return typeof w.murmurhash3_32_gc === "function"
                        ? w.murmurhash3_32_gc(value, seed)
                        : 0;
                },
                storage: {
                    get: function (key: string) {
                        return w.stbGetItem(physical(key));
                    },
                    remove: function (key: string) {
                        w.stbDelItem(physical(key));
                    },
                    set: function (key: string, value: string) {
                        w.stbSetItem(physical(key), value);
                    },
                },
                translate: function (value: string) {
                    return typeof w._ === "function" ? w._(value) : value;
                },
            },
            {
                active: active,
                own: function () {
                    return function () {};
                },
            }
        );
    }
    /** Edem is one account, so its only slot is 1; the driver codec does the rest. */
    function nativeRequest(request: any, done: (result: any) => void): void {
        var params = request.params || {},
            writing = request.action === "provider_settings",
            number = params.number,
            settings = params.settings,
            ids: any = {
                key: "edemKey",
                list: "edemList",
                portal: "edemPortal",
            },
            fields =
                settings &&
                typeof settings === "object" &&
                !Array.isArray(settings)
                    ? Object.keys(settings)
                    : [],
            driver: any = null,
            open = true,
            completed = false;
        function respond(result: any): void {
            if (!completed) {
                completed = true;
                done(result);
            }
        }
        function fail(reason: string): void {
            respond({
                data: {
                    number: number,
                    provider: "edem",
                    reason: reason,
                    runtime: params.runtime,
                    version: 1,
                },
                status: reason === "unsupported" ? "unsupported" : "rejected",
            });
        }
        if (busy) {
            fail("revision_conflict");
            return;
        }
        busy = true;
        try {
            if (
                params.provider !== "edem" ||
                params.version !== 1 ||
                typeof params.runtime !== "string" ||
                !/^[A-Za-z0-9_.:-]{1,128}$/.test(params.runtime) ||
                number !== 1 ||
                Object.keys(params).sort().join(",") !==
                    (writing
                        ? "context,number,provider,revision,runtime,settings,version"
                        : "number,provider,runtime,settings,version") ||
                !fields.length ||
                fields.some(function (field) {
                    return !Object.prototype.hasOwnProperty.call(ids, field);
                })
            ) {
                fail("invalid_request");
                return;
            }
            if (params.runtime !== runtime()) {
                fail("runtime_changed");
                return;
            }
            if (!policy.allowed("edem")) {
                fail("unsupported");
                return;
            }
            if (writing && locked()) {
                fail("policy_restricted");
                return;
            }
            var binding = currentContext("edem"),
                source = w.__ottActiveProviderDriver,
                read = w.stbGetItem,
                write = w.stbSetItem,
                remove = w.stbDelItem;
            function current(): boolean {
                return (
                    open &&
                    params.runtime === runtime() &&
                    currentContext("edem") === binding &&
                    source === w.__ottActiveProviderDriver &&
                    read === w.stbGetItem &&
                    write === w.stbSetItem &&
                    remove === w.stbDelItem &&
                    (!writing || !locked()) &&
                    !(
                        typeof request.expires_at === "number" &&
                        Date.now() >= request.expires_at * 1000
                    )
                );
            }
            driver = nativeDriver(current);
            var api =
                driver &&
                w.__ottRemoteProviderFields &&
                w.__ottRemoteProviderFields.create(w, driver, false);
            if (!api) {
                fail("unsupported");
                return;
            }
            var patch: any = {};
            try {
                fields.forEach(function (field) {
                    patch[ids[field]] = api.normalize(
                        ids[field],
                        settings[field]
                    );
                });
            } catch (error) {
                fail(nativeProviderFailure(error));
                return;
            }
            function stored(): boolean {
                return Object.keys(patch).every(function (id) {
                    return api.capture(id).stored === patch[id];
                });
            }
            var before = api.capture(ids[fields[0]]),
                snapshot = JSON.stringify(before.state);
            if (!current() || !before.current()) {
                fail("source_changed");
                return;
            }
            if (writing) {
                if (params.context !== binding) {
                    fail("source_changed");
                    return;
                }
                var receipt: any = null;
                for (var i = 0; i < receipts.length; i++)
                    if (receipts[i].revision === params.revision) {
                        receipt = receipts.splice(i, 1)[0];
                        break;
                    }
                if (
                    !receipt ||
                    receipt.provider !== "edem" ||
                    receipt.number !== number ||
                    receipt.context !== binding ||
                    receipt.expires <= Date.now() ||
                    receipt.created > Date.now() ||
                    receipt.snapshot !== snapshot
                ) {
                    fail("revision_conflict");
                    return;
                }
            }
            var matched = stored(),
                reloaded = false,
                reloadRequired = false;
            if (writing && !matched) {
                var active = !!source && source.id === "edem",
                    sleeping = !!(w.__ottStandby && w.__ottStandby.blocked());
                if (
                    active &&
                    (typeof source.settingsChanged !== "function" ||
                        (!sleeping && typeof w.loadChannels !== "function"))
                ) {
                    fail("unsupported");
                    return;
                }
                try {
                    api.saveFields(patch, before, current);
                } catch (error) {
                    fail(nativeProviderFailure(error));
                    return;
                }
                if (!current()) {
                    fail("source_changed");
                    return;
                }
                if (active) {
                    source.settingsChanged();
                    if (sleeping) reloadRequired = true;
                    else {
                        w.loadChannels();
                        reloaded = true;
                    }
                }
                if (!current() || !stored()) {
                    fail("source_changed");
                    return;
                }
            }
            var data: any = {
                context: binding,
                number: number,
                provider: "edem",
                revision: remember({
                    number: number,
                    provider: "edem",
                    snapshot:
                        writing && !matched
                            ? JSON.stringify(api.capture(ids[fields[0]]).state)
                            : snapshot,
                }),
                runtime: params.runtime,
                version: 1,
            };
            if (writing) {
                data.fields = fields.slice().sort();
                data.reload_required = reloadRequired;
                data.reloaded = reloaded;
                data.saved = true;
            } else data.matched = matched;
            respond({ data: data, status: "ok" });
        } catch (error) {
            fail(nativeProviderFailure(error));
        } finally {
            open = false;
            if (driver) driver.dispose();
            busy = false;
        }
    }
    function request(request: any, done: (result: any) => void): void {
        var params = request.params || {},
            writing = request.action === "provider_settings";
        if (params.provider === "edem") {
            nativeRequest(request, done);
            return;
        }
        var settings = params.settings || {},
            number = writing ? settings.profile : params.number;
        var detached: any = null,
            open = true,
            completed = false;
        function respond(result: any): void {
            if (!completed) {
                completed = true;
                done(result);
            }
        }
        function fail(reason: string): void {
            var data: any = {
                error: "The VPortal configuration request could not be completed.",
                provider: "vportal",
                reason: reason,
                runtime: params.runtime,
            };
            data[writing ? "profile" : "number"] = number;
            respond({
                data: data,
                status: reason === "unsupported" ? "unsupported" : "rejected",
            });
        }
        if (busy) {
            fail("revision_conflict");
            return;
        }
        busy = true;
        try {
            var settingKeys = Object.keys(settings).sort().join(",");
            if (
                params.provider !== "vportal" ||
                typeof params.runtime !== "string" ||
                !/^[A-Za-z0-9_.:-]{1,128}$/.test(params.runtime) ||
                typeof number !== "number" ||
                number < 1 ||
                number > 15 ||
                Math.floor(number) !== number ||
                Object.keys(params).sort().join(",") !==
                    (writing
                        ? "context,provider,revision,runtime,settings"
                        : "number,provider,runtime,settings") ||
                (settingKeys !== (writing ? "profile,vportal" : "vportal") &&
                    settingKeys !==
                        (writing ? "name,profile,vportal" : "name,vportal")) ||
                !text(settings.vportal, 8192) ||
                (settings.name !== undefined && !text(settings.name, 256))
            ) {
                fail("invalid_request");
                return;
            }
            if (runtime() !== params.runtime) {
                fail("runtime_changed");
                return;
            }
            if (writing && locked()) {
                fail("policy_restricted");
                return;
            }
            var binding = currentContext("vportal"),
                source = w.__ottActiveProviderDriver;
            var read = w.stbGetItem,
                write = w.stbSetItem,
                remove = w.stbDelItem;
            var raw = read.call(w, "vportalprofiles");
            if (raw !== null && raw !== undefined && raw !== "")
                JSON.parse(raw);
            var saving = false;
            function current(): boolean {
                return (
                    open &&
                    params.runtime === runtime() &&
                    ((saving &&
                        source &&
                        source.id === "vportal" &&
                        w.__ottPlayerSettingsHost.source() === sourceTag &&
                        JSON.stringify(source.configuration()) ===
                            expectedConfig) ||
                        currentContext("vportal") === binding) &&
                    source === w.__ottActiveProviderDriver &&
                    read === w.stbGetItem &&
                    write === w.stbSetItem &&
                    remove === w.stbDelItem &&
                    (!writing || !locked()) &&
                    !(
                        typeof request.expires_at === "number" &&
                        Date.now() >= request.expires_at * 1000
                    )
                );
            }
            if (!current()) {
                fail("source_changed");
                return;
            }
            if (writing) {
                if (params.context !== binding) {
                    fail("source_changed");
                    return;
                }
                var receipt: any = null;
                for (var i = 0; i < receipts.length; i++)
                    if (receipts[i].revision === params.revision) {
                        receipt = receipts.splice(i, 1)[0];
                        break;
                    }
                if (
                    !receipt ||
                    receipt.provider !== "vportal" ||
                    receipt.number !== number ||
                    receipt.context !== binding ||
                    receipt.expires <= Date.now() ||
                    receipt.created > Date.now() ||
                    receipt.snapshot !== raw
                ) {
                    fail("revision_conflict");
                    return;
                }
            }
            if (
                !w.__ottProviderDrivers ||
                !w.__ottVPortalDriver ||
                !policy.allowed("vportal")
            ) {
                fail("unsupported");
                return;
            }
            var expectedConfig = "",
                sourceTag = w.__ottPlayerSettingsHost.source();
            detached = w.__ottProviderDrivers.registry.create(
                "vportal",
                {
                    commit: function (
                        writes: any[],
                        valid: () => boolean,
                        rollback: () => boolean
                    ): boolean {
                        if (
                            writes.length !== 1 ||
                            writes[0].key !== "profiles" ||
                            !current() ||
                            read.call(w, "vportalprofiles") !== raw
                        )
                            return false;
                        saving = true;
                        w.commitSettingsWrites(
                            [
                                {
                                    after: writes[0].after,
                                    before: raw,
                                    storage: {
                                        key: "vportalprofiles",
                                        read: function () {
                                            return read.call(
                                                w,
                                                "vportalprofiles"
                                            );
                                        },
                                        remove: function () {
                                            remove.call(w, "vportalprofiles");
                                        },
                                        write: function (value: string) {
                                            write.call(
                                                w,
                                                "vportalprofiles",
                                                value
                                            );
                                        },
                                    },
                                },
                            ],
                            function () {
                                return current() && valid();
                            },
                            function () {
                                return current() && rollback();
                            }
                        );
                        return current();
                    },
                    storage: {
                        get: function (key: string) {
                            return read.call(w, "vportal" + key);
                        },
                    },
                    validateUrl: policy.url,
                },
                {
                    active: current,
                    own: function () {
                        return function () {};
                    },
                }
            );
            var config = detached.configuration(),
                index = number - 1,
                row = config.portals[index];
            var matched =
                row.link === settings.vportal &&
                (settings.name === undefined || row.name === settings.name);
            if (!current() || read.call(w, "vportalprofiles") !== raw) {
                fail("source_changed");
                return;
            }
            if (!writing) {
                respond({
                    data: {
                        context: binding,
                        matched: matched,
                        number: number,
                        provider: "vportal",
                        revision: remember({
                            number: number,
                            provider: "vportal",
                            snapshot: raw,
                        }),
                        runtime: params.runtime,
                    },
                    status: "ok",
                });
                return;
            }
            var activeSlot =
                source && source.id === "vportal" && config.active === index;
            var sleeping = !!(w.__ottStandby && w.__ottStandby.blocked());
            if (
                !matched &&
                activeSlot &&
                (typeof source.configurationChanged !== "function" ||
                    (!sleeping && typeof w.loadChannels !== "function"))
            ) {
                fail("unsupported");
                return;
            }
            if (row.link !== settings.vportal) row.sections = [];
            row.link = settings.vportal;
            if (settings.name !== undefined) row.name = settings.name;
            expectedConfig = JSON.stringify(config);
            if (!matched && !detached.saveConfiguration(config)) {
                fail("storage_failed");
                return;
            }
            if (
                !current() ||
                read.call(w, "vportalprofiles") !==
                    (matched ? raw : expectedConfig)
            ) {
                fail("source_changed");
                return;
            }
            if (!matched) {
                // Adopt only this verified same-source write; stale revisions cannot follow it.
                signature = JSON.stringify([
                    runtime(),
                    w.__ottPlayerSettingsHost.source(),
                    source && source.configuration
                        ? source.configuration()
                        : null,
                ]);
                receipts = [];
            }
            var reloaded = false;
            if (!matched && activeSlot) {
                source.configurationChanged();
                if (!sleeping) {
                    w.loadChannels();
                    reloaded = true;
                }
            }
            var after = read.call(w, "vportalprofiles");
            if (!current() || after !== (matched ? raw : expectedConfig)) {
                fail("source_changed");
                return;
            }
            respond({
                data: {
                    context: binding,
                    fields: Object.keys(settings).sort(),
                    profile: number,
                    provider: "vportal",
                    reload_required: !!(!matched && activeSlot && sleeping),
                    reloaded: reloaded,
                    revision: remember({
                        number: number,
                        provider: "vportal",
                        snapshot: after,
                    }),
                    runtime: params.runtime,
                    saved: true,
                },
                status: "ok",
            });
        } catch (_) {
            fail("storage_failed");
        } finally {
            open = false;
            if (detached) detached.dispose();
            busy = false;
        }
    }
    return { request: request };
}
(window as any).__ottRemoteProviderSettings = {
    create: createRemoteProviderSettings,
};
