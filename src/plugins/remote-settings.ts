/** Typed remote preferences use the same source-bound draft as local editors. */
function createRemotePlayerSettings(w: any, readRuntime: () => string): any {
    var serial = 0,
        identity = "",
        busy = false;
    var driver: any = null,
        store: any = null,
        context: any = null;
    var receipts: any[] = [];
    var tokens = /^[A-Za-z0-9_.:-]{1,128}$/;
    var ids = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
    function token(prefix: string): string {
        return prefix + Date.now().toString(36) + ":" + ++serial;
    }
    function text(value: any, limit: number): boolean {
        if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value))
            return false;
        try {
            return (
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= limit
            );
        } catch (_) {
            return false;
        }
    }
    function host(): any {
        return w.__ottPlayerSettingsHost;
    }
    function refresh(): any {
        var h = host(),
            active = w.__ottActiveProviderDriver;
        if (!h || !h.store || !Array.isArray(h.schema))
            throw new Error("unsupported");
        var config: any = null;
        try {
            config =
                active && typeof active.configuration === "function"
                    ? active.configuration()
                    : null;
        } catch (_) {}
        var profile =
            config &&
            typeof config.active === "number" &&
            config.active >= 0 &&
            config.active < 15 &&
            Math.floor(config.active) === config.active
                ? config.active + 1
                : null;
        var next = JSON.stringify([readRuntime(), h.source(), config]);
        if (
            !context ||
            identity !== next ||
            driver !== active ||
            store !== h.store
        ) {
            identity = next;
            driver = active;
            store = h.store;
            receipts = [];
            context = {
                profile: profile,
                provider:
                    active && /^[a-z0-9_-]{1,32}$/.test(active.id)
                        ? active.id
                        : null,
                token: token("context:"),
            };
        }
        return context;
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
    function definition(id: string): any {
        var schema = host().schema;
        for (var i = 0; i < schema.length; i++)
            if (schema[i].id === id) return schema[i];
        return null;
    }
    function providerReady(): boolean {
        var active = w.__ottActiveProviderDriver;
        try {
            return !!(
                active &&
                (typeof active.storageKey === "function"
                    ? typeof active.storageKey("sPlayers") === "string"
                    : typeof w.providerGetItem === "function" &&
                      typeof w.providerSetItem === "function")
            );
        } catch (_) {
            return false;
        }
    }
    function describe(entry: any): any {
        var id = entry.id,
            rules = entry.rules || {},
            fallback = entry.defaultValue;
        var sensitive =
            /^(parentPin|commandServerToken|localHttpDeviceCode|deviceUuid|localCmdUrl|commandServerAddress|swopBaseUrl)$/.test(
                id
            );
        var unavailable = entry.scope === "provider" && !providerReady();
        var lifecycle =
            /^(commandServerAddress|commandServerToken|commandServerEnabled|localCmdUrl|localHttpDeviceCode|localHttpEnabled|deviceUuid|swopBaseUrl)$/.test(
                id
            );
        var constraints: any = {};
        var type = Array.isArray(fallback)
            ? "string_array"
            : typeof fallback === "number"
              ? "integer"
              : "string";
        if (type === "integer") {
            if (rules.range) {
                constraints.minimum = rules.range[0];
                constraints.maximum = rules.range[1];
            } else constraints.minimum = 0;
            if (rules.values) constraints.values = rules.values.slice();
            if (rules.durations)
                constraints.values = [
                    5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 600, 900, 1200,
                    1800, 3600,
                ];
        } else {
            constraints.max_utf8_bytes = 4096;
            if (type === "string_array") constraints.max_items = 64;
        }
        if (rules.language)
            constraints.values = [""].concat(
                rules.language === "subtitle" ? ["off"] : [],
                host().languages || []
            );
        var access: any = {
            read: !sensitive && !unavailable,
            write: !unavailable && !lifecycle && !locked(),
        };
        if (!access.write)
            access.reason = unavailable
                ? "unsupported"
                : lifecycle
                  ? "lifecycle_required"
                  : "policy_restricted";
        var result: any = {
            access: access,
            apply: /^(bufSize|players|streamMaxHeight|streamMaxBitrate|preferredAudioLanguage|preferredSubtitleLanguage)$/.test(
                id
            )
                ? "next_stream"
                : /^(hdmiSupport|autorun)$/.test(id) ||
                    entry.effects.some(function (name: string) {
                        return typeof w[name] !== "function";
                    })
                  ? "manual"
                  : "immediate",
            constraints: constraints,
            description:
                "The saved preference is used by subsequent player actions and UI updates; saving does not restart current playback.",
            id: id,
            scope: entry.scope,
            sensitive: sensitive,
            type: type,
        };
        if (!sensitive)
            result.default_value = Array.isArray(fallback)
                ? fallback.slice()
                : fallback;
        if (/^preferred(?:Audio|Subtitle)Language$/.test(id))
            result.description =
                "Used when tracks are selected for the next stream, unless that channel has an explicit track preference. Saving does not switch the current track.";
        if (result.apply === "manual")
            result.description =
                id === "hdmiSupport"
                    ? "Legacy HDMI preference; this build has no direct HDMI apply operation."
                    : id === "autorun"
                      ? "Legacy autorun preference; actual startup is controlled by the platform autorun configuration."
                      : "Saved preference; an immediate apply hook is unavailable on this runtime. Use the platform workflow to apply it.";
        if (id === "players") {
            result.choices = [
                { aliases: ["html5", "native"], label: "HTML5", value: 0 },
                { aliases: ["hls.js", "hls"], label: "hls.js", value: 1 },
                {
                    aliases: ["shaka", "shaka-player"],
                    label: "Shaka",
                    value: 2,
                },
                {
                    aliases: ["auto", "automatic"],
                    label: "Automatic",
                    value: 3,
                },
            ];
            result.description =
                w.ott_device === "lg/webos"
                    ? "The saved provider preference is retained; LG webOS always selects Automatic playback."
                    : "The saved playback engine preference applies to the next stream.";
        }
        if (id === "bufSize") {
            result.unit = "seconds";
            result.description =
                "1 to 120 seconds sets the buffer; 0 or a value above 120 uses automatic buffering. Applies to the next stream.";
        }
        if (id === "uiFontScale") result.unit = "percent";
        return result;
    }
    function remember(id: string, capture: any, descriptor: any): any {
        var now = Date.now(),
            binding = refresh().token;
        receipts = receipts.filter(function (receipt) {
            return receipt.created <= now && receipt.expires > now;
        });
        while (receipts.length >= 128) receipts.shift();
        var revision = token("revision:");
        receipts.push({
            capture: capture,
            context: binding,
            created: now,
            expires: now + 120000,
            id: id,
            revision: revision,
        });
        var result: any = {
            id: id,
            revision: revision,
            storage:
                capture.raw === null
                    ? "default"
                    : capture.valid
                      ? "stored"
                      : "invalid",
        };
        if (descriptor.sensitive) {
            result.redacted = true;
            result.configured = capture.raw !== null && capture.raw !== "";
        } else if (
            !bounded(capture.value) ||
            (capture.valid && !bounded(capture.stored))
        ) {
            // Keep a repair revision without emitting values outside the wire budget.
            result.storage = "unavailable";
        } else {
            result.value = capture.value;
            if (capture.raw !== null && capture.valid)
                result.persisted_value = capture.stored;
            if (id === "players" && w.ott_device === "lg/webos")
                result.effective_value = 3;
            if (
                id === "bufSize" &&
                (capture.value === 0 || capture.value > 120)
            )
                result.effective_value = 0;
        }
        return result;
    }
    function bounded(value: any): boolean {
        return typeof value === "number"
            ? isFinite(value) && Math.floor(value) === value
            : typeof value === "string"
              ? text(value, 4096)
              : Array.isArray(value) &&
                value.length <= 64 &&
                value.every(function (part) {
                    return text(part, 4096);
                });
    }
    function request(request: any, done: (result: any) => void): void {
        var params = request.params || {},
            op = params.op,
            completed = false;
        var runtime =
            typeof params.runtime === "string" && tokens.test(params.runtime)
                ? params.runtime
                : readRuntime();
        function respond(result: any): void {
            if (!completed) {
                completed = true;
                done(result);
            }
        }
        function fail(reason: string): void {
            respond({
                data: {
                    error: "The player setting request could not be completed.",
                    op: op,
                    reason: reason,
                    runtime: runtime,
                    version: 1,
                },
                status: reason === "unsupported" ? "unsupported" : "rejected",
            });
        }
        function reply(data: any): void {
            data.version = 1;
            data.op = op;
            data.runtime = runtime;
            data.context = refresh();
            if (!text(JSON.stringify(data), 65536)) {
                fail("unsupported");
                return;
            }
            respond({ data: data, status: "ok" });
        }
        if (busy) {
            fail("revision_conflict");
            return;
        }
        if (
            !params ||
            typeof params !== "object" ||
            Array.isArray(params) ||
            typeof params.runtime !== "string" ||
            !tokens.test(params.runtime) ||
            ["schema", "get", "set"].indexOf(op) < 0
        ) {
            fail("invalid_request");
            return;
        }
        if (params.runtime !== readRuntime()) {
            fail("runtime_changed");
            return;
        }
        if (
            typeof request.expires_at === "number" &&
            Date.now() >= request.expires_at * 1000
        ) {
            fail("source_changed");
            return;
        }
        busy = true;
        try {
            var sourceToken = refresh().token;
            var keys = Object.keys(params).sort().join(",");
            if (op === "schema") {
                var allowed = ["op", "runtime", "limit", "cursor"];
                if (
                    Object.keys(params).some(function (key) {
                        return allowed.indexOf(key) < 0;
                    }) ||
                    (params.limit !== undefined &&
                        (typeof params.limit !== "number" ||
                            params.limit < 1 ||
                            params.limit > 20 ||
                            Math.floor(params.limit) !== params.limit))
                ) {
                    fail("invalid_request");
                    return;
                }
                var offset = 0,
                    schema = host().schema;
                if (params.cursor !== undefined) {
                    if (
                        typeof params.cursor !== "string" ||
                        !tokens.test(params.cursor) ||
                        params.cursor.indexOf(sourceToken + ":") !== 0 ||
                        !/^\d+$/.test(
                            params.cursor.slice(sourceToken.length + 1)
                        )
                    ) {
                        fail("source_changed");
                        return;
                    }
                    offset = Number(
                        params.cursor.slice(sourceToken.length + 1)
                    );
                    if (offset >= schema.length) {
                        fail("invalid_request");
                        return;
                    }
                }
                var end = Math.min(
                    schema.length,
                    offset + (params.limit || 20)
                );
                var entries = schema.slice(offset, end).map(describe);
                if (refresh().token !== sourceToken) {
                    fail("source_changed");
                    return;
                }
                reply({
                    next_cursor:
                        end < schema.length ? sourceToken + ":" + end : null,
                    settings: entries,
                });
                return;
            }
            if (
                keys !==
                    (op === "get"
                        ? "id,op,runtime"
                        : "context,id,op,revision,runtime,value") ||
                typeof params.id !== "string" ||
                !ids.test(params.id)
            ) {
                fail("invalid_request");
                return;
            }
            var entry = definition(params.id);
            if (!entry) {
                fail("unknown_setting");
                return;
            }
            var descriptor = describe(entry);
            if (op === "get") {
                if (entry.scope === "provider" && !providerReady()) {
                    reply({
                        descriptor: descriptor,
                        setting: {
                            id: params.id,
                            revision: token("unavailable:"),
                            storage: "unavailable",
                        },
                    });
                    return;
                }
                var captured = store.capture(params.id);
                if (refresh().token !== sourceToken) {
                    fail("source_changed");
                    return;
                }
                reply({
                    descriptor: descriptor,
                    setting: remember(params.id, captured, descriptor),
                });
                return;
            }
            if (
                typeof params.context !== "string" ||
                !tokens.test(params.context) ||
                typeof params.revision !== "string" ||
                !tokens.test(params.revision) ||
                !bounded(params.value)
            ) {
                fail("invalid_value");
                return;
            }
            if (params.context !== sourceToken) {
                fail("source_changed");
                return;
            }
            if (!descriptor.access.write) {
                fail(
                    descriptor.access.reason === "lifecycle_required"
                        ? "unsupported"
                        : descriptor.access.reason
                );
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
                receipt.id !== params.id ||
                receipt.context !== sourceToken ||
                receipt.expires <= Date.now() ||
                receipt.created > Date.now() ||
                !receipt.capture.current() ||
                receipt.capture.storage.read() !== receipt.capture.raw
            ) {
                fail("revision_conflict");
                return;
            }
            function sourceCurrent(): boolean {
                return (
                    params.runtime === readRuntime() &&
                    refresh().token === sourceToken &&
                    !(
                        typeof request.expires_at === "number" &&
                        Date.now() >= request.expires_at * 1000
                    )
                );
            }
            function admitted(): boolean {
                return sourceCurrent() && !locked();
            }
            var draft = store.begin(true, receipt.capture);
            if (!draft.set(params.id, params.value)) {
                draft.cancel();
                fail("invalid_value");
                return;
            }
            var expected = JSON.stringify(draft.get(params.id));
            if (!draft.commit([], admitted)) {
                fail(
                    draft.errorCode() === "source_changed"
                        ? "source_changed"
                        : /^(backup_changed|concurrent_edit)$/.test(
                                draft.errorCode()
                            )
                          ? "revision_conflict"
                          : "storage_failed"
                );
                return;
            }
            if (!sourceCurrent()) {
                fail("source_changed");
                return;
            }
            var after = store.capture(params.id);
            if (
                after.raw === null ||
                !after.valid ||
                JSON.stringify(after.value) !== expected ||
                JSON.stringify(after.stored) !== expected
            ) {
                fail("storage_failed");
                return;
            }
            var application: any = {
                state:
                    descriptor.apply === "immediate" ? "completed" : "deferred",
            };
            if (descriptor.apply !== "immediate")
                application.reason = descriptor.apply;
            if (draft.error())
                application = { reason: "effect_failed", state: "failed" };
            reply({
                application: application,
                changed:
                    JSON.stringify(receipt.capture.value) !==
                    JSON.stringify(after.value),
                persisted: true,
                setting: remember(params.id, after, descriptor),
            });
        } catch (_) {
            fail("storage_failed");
        } finally {
            busy = false;
        }
    }
    return { request: request };
}
(window as any).__ottPlayerSettingsFactory = {
    create: createRemotePlayerSettings,
};
