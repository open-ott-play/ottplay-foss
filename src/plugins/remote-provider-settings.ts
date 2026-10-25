/** Configuration-only driver instances reuse normal codecs without mounting providers. */
function createRemoteProviderSettings(
    w: any,
    runtime: () => string,
    policy: any
): any {
    var sequence = 0,
        context = "",
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
    function currentContext(): string {
        var driver = w.__ottActiveProviderDriver;
        var value = JSON.stringify([
            runtime(),
            w.__ottPlayerSettingsHost.source(),
            driver && driver.configuration ? driver.configuration() : null,
        ]);
        if (!context || value !== signature || owner !== driver) {
            signature = value;
            owner = driver;
            receipts = [];
            context = "vportal:" + Date.now().toString(36) + ":" + ++sequence;
        }
        return context;
    }
    function remember(raw: string | null, number: number): string {
        var revision = "saved:" + Date.now().toString(36) + ":" + ++sequence;
        receipts = receipts.filter(function (r) {
            return r.created <= Date.now() && r.expires > Date.now();
        });
        while (receipts.length >= 128) receipts.shift();
        receipts.push({
            context: currentContext(),
            created: Date.now(),
            expires: Date.now() + 120000,
            number: number,
            raw: raw,
            revision: revision,
        });
        return revision;
    }
    function request(request: any, done: (result: any) => void): void {
        var params = request.params || {},
            writing = request.action === "provider_settings";
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
            var binding = currentContext(),
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
                        currentContext() === binding) &&
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
                    receipt.number !== number ||
                    receipt.context !== binding ||
                    receipt.expires <= Date.now() ||
                    receipt.created > Date.now() ||
                    receipt.raw !== raw
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
                        revision: remember(raw, number),
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
                    revision: remember(after, number),
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
