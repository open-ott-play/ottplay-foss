/** Compare saved bytes without selecting a provider or returning its secrets. */
function compareRemoteSettings(w: any, params: any): any {
    function object(value: any): boolean {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }
    function fail(): any {
        return {
            data: { error: "Settings comparison is unavailable or invalid." },
            status: "rejected",
        };
    }
    function boundedText(value: any, maximum: number): boolean {
        if (
            typeof value !== "string" ||
            value.length > maximum ||
            /[\u0000-\u001f\u007f]/.test(value)
        )
            return false;
        try {
            return (
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= maximum
            );
        } catch (_) {
            return false;
        }
    }
    if (!object(params) || !object(params.settings)) return fail();
    var provider = params.provider;
    var schemas: Record<string, string[]> = {
        m3u: ["history_hours", "name", "playlist"],
        plex: ["server", "token"],
        stalker: ["mac", "name", "server"],
    };
    if (!Object.prototype.hasOwnProperty.call(schemas, provider)) return fail();
    var numbered = provider !== "plex";
    if (
        Object.keys(params).sort().join(",") !==
            (numbered ? "number,provider,settings" : "provider,settings") ||
        Object.keys(params.settings).sort().join(",") !==
            schemas[provider].join(",") ||
        (numbered &&
            (typeof params.number !== "number" ||
                params.number < 1 ||
                params.number > 15 ||
                Math.floor(params.number) !== params.number))
    )
        return fail();
    if (
        w.__ottParental
            ? w.__ottParental.needs("providers") ||
              w.__ottParental.needs("settings")
            : (w.sPSprovs || w.sPSoptions) &&
              w.parentPIN !== "*" &&
              !w.parentAccess
    )
        return fail();
    var expected = params.settings;
    if (
        schemas[provider].some(function (key) {
            return key === "history_hours"
                ? typeof expected[key] !== "number" ||
                      !isFinite(expected[key]) ||
                      Math.floor(expected[key]) !== expected[key] ||
                      expected[key] < 0 ||
                      expected[key] > 8760
                : !boundedText(
                      expected[key],
                      key === "name"
                          ? 256
                          : key === "token"
                            ? 1024
                            : key === "mac"
                              ? 17
                              : 8192
                  );
        })
    )
        return fail();
    try {
        var key =
            provider === "m3u"
                ? "m3um3uArr"
                : provider === "plex"
                  ? "plexcfg"
                  : "stalkerstalker_data";
        var raw = w.stbGetItem(key);
        var saved = raw ? JSON.parse(raw) : {};
        var actual: any;
        if (provider === "m3u") {
            var slot = (saved.M3Us || [])[params.number - 1] || {};
            actual = {
                history_hours: Number(slot.rechours || 0),
                name: slot.name || "",
                playlist: slot.www || "",
            };
        } else if (provider === "stalker") {
            var portal =
                (Array.isArray(saved.portals) ? saved.portals : [saved])[
                    params.number - 1
                ] || {};
            actual = {
                mac: portal.mac || "",
                name: portal.name || "",
                server: portal.portal || "",
            };
        } else {
            actual = {
                server: saved.address || saved.server || "",
                token: saved.token || "",
            };
            expected = {
                server: expected.server.trim().replace(/\/+$/, ""),
                token: expected.token.trim(),
            };
        }
        var matched = schemas[provider].every(function (field) {
            return actual[field] === expected[field];
        });
        // Reentrant/native reads must not certify a value replaced during the comparison.
        if (w.stbGetItem(key) !== raw) return fail();
        var data: any = { matched: matched, provider: provider };
        if (numbered) data.number = params.number;
        return { data: data, status: "ok" };
    } catch (_) {
        return fail();
    }
}

function writeRemoteProviderSettings(
    w: any,
    params: any,
    done: (result: any) => void,
    policy: any
): void {
    function reject(error: string): void {
        done({ data: { error: error }, status: "rejected" });
    }
    function reply(data: any): void {
        done({ data: data, status: "ok" });
    }
    function settingsLocked(): boolean {
        return !!(
            (w.__ottKiosk && w.__ottKiosk.enabled()) ||
            (w.__ottParental
                ? w.__ottParental.needs("providers") ||
                  w.__ottParental.needs("settings")
                : (w.sPSprovs || w.sPSoptions) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess)
        );
    }

    var driver = w.__ottActiveProviderDriver;
    if (!driver || driver.id !== params.provider) {
        reject("Select this provider before changing its settings.");
        return;
    }
    if (!policy.allowed(driver.id) || settingsLocked()) {
        reject("Unlock provider settings on the player first.");
        return;
    }
    if (
        driver.id === "stalker" &&
        params.settings &&
        Object.prototype.hasOwnProperty.call(params.settings, "profile")
    ) {
        var settings = params.settings;
        try {
            if (
                Array.isArray(settings) ||
                Object.keys(settings).sort().join(",") !==
                    "mac,name,profile,server" ||
                typeof settings.profile !== "number" ||
                Math.floor(settings.profile) !== settings.profile ||
                settings.profile < 1 ||
                settings.profile > 15 ||
                typeof settings.name !== "string" ||
                /[\u0000-\u001f\u007f]/.test(settings.name) ||
                encodeURIComponent(settings.name).replace(/%[0-9A-F]{2}/g, "x")
                    .length > 256 ||
                typeof settings.server !== "string" ||
                settings.server.length > 8192 ||
                /[\\\s]/.test(settings.server) ||
                !/^https?:\/\//i.test(settings.server) ||
                typeof settings.mac !== "string" ||
                !/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(settings.mac) ||
                typeof driver.configuration !== "function" ||
                typeof driver.saveConfiguration !== "function"
            )
                throw new Error();
            var stalkerEndpoint = new URL(settings.server);
            if (
                !stalkerEndpoint.hostname ||
                stalkerEndpoint.username ||
                stalkerEndpoint.password ||
                !policy.url(stalkerEndpoint.href)
            )
                throw new Error();
            var original = JSON.stringify(driver.configuration());
            var configuration = JSON.parse(original);
            var slot = settings.profile - 1;
            if (
                !Array.isArray(configuration.portals) ||
                configuration.portals.length !== 15 ||
                !configuration.portals[slot] ||
                (configuration.active === slot &&
                    typeof w.loadChannels !== "function")
            )
                throw new Error();
            configuration.portals[slot] = {
                mac: settings.mac,
                name: settings.name,
                portal: settings.server,
            };
            var stalkerChanged = original !== JSON.stringify(configuration);
            if (
                w.__ottActiveProviderDriver !== driver ||
                settingsLocked() ||
                JSON.stringify(driver.configuration()) !== original ||
                (stalkerChanged &&
                    driver.saveConfiguration(configuration) !== true) ||
                w.__ottActiveProviderDriver !== driver ||
                JSON.stringify(driver.configuration()) !==
                    JSON.stringify(configuration)
            )
                throw new Error();
            if (stalkerChanged && configuration.active === slot)
                w.loadChannels();
            if (
                w.__ottActiveProviderDriver !== driver ||
                JSON.stringify(driver.configuration()) !==
                    JSON.stringify(configuration)
            )
                throw new Error();
            reply({
                fields: ["profile", "name", "server", "mac"],
                profile: settings.profile,
                provider: "stalker",
                saved: true,
            });
        } catch (_) {
            reject("Could not validate or save the Stalker profile.");
        }
        return;
    }
    if (driver.id === "plex") {
        var plexSettings =
            typeof driver.saveRemoteSettings === "function"
                ? driver.saveRemoteSettings(params)
                : "Plex settings are unavailable on this player.";
        if (typeof plexSettings === "string") reject(plexSettings);
        else
            reply({
                fields: plexSettings,
                provider: "plex",
                saved: true,
            });
        return;
    }
    var schemas: Record<string, string[]> = {
        m3u: ["playlist"],
        ottclub: ["server", "key"],
        stalker: ["server", "mac"],
        xtream: ["server", "username", "password"],
    };
    var schema = schemas[driver.id];
    var fields = Object.keys(params.settings || {});
    if (
        !schema ||
        !params.settings ||
        typeof params.settings !== "object" ||
        Array.isArray(params.settings) ||
        !fields.length ||
        fields.some(function (key) {
            return (
                schema.indexOf(key) < 0 ||
                typeof params.settings[key] !== "string" ||
                params.settings[key].length > 8192
            );
        })
    ) {
        reject("Unsupported provider settings fields.");
        return;
    }
    var config = driver.credentials();
    fields.forEach(function (key) {
        config[key === "mac" || key === "key" ? "username" : key] =
            params.settings[key];
    });
    var endpoint = driver.id === "m3u" ? config.playlist : config.server;
    if (endpoint) {
        try {
            var club = driver.id === "ottclub";
            if (club && /[\s/\\?#@]/.test(endpoint)) throw new Error();
            var parsed = new URL(club ? "http://" + endpoint : endpoint);
            if (
                !/^https?:$/.test(parsed.protocol) ||
                !parsed.hostname ||
                parsed.username ||
                parsed.password ||
                !policy.url(parsed.href)
            )
                throw new Error();
            // The OTTClub driver prepends HTTP to its stored host.
            if (club) config.server = parsed.host;
        } catch (_error) {
            reject(
                driver.id === "ottclub"
                    ? "Use an OTTClub host, optionally with a port, without a URL scheme or path."
                    : "Use a valid HTTP(S) provider URL."
            );
            return;
        }
    }
    if (
        driver.id === "stalker" &&
        !/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(config.username)
    ) {
        reject("Use a MAC address such as 00:1A:79:00:00:01.");
        return;
    }
    if (driver.saveCredentials(config) === false) {
        reject("Could not save provider settings.");
        return;
    }
    if (typeof w.loadPlaylist === "function") w.loadPlaylist();
    reply({ fields: fields, provider: driver.id, saved: true });
    return;
}
/**
 * Explicit native provider slots. The terminal sends an exact slot number and
 * compare/write context, so a preset can configure Edem without selecting it
 * and without exposing the saved credentials in a reply.
 */
function nativeProviderSettings(
    w: any,
    request: any,
    params: any,
    policy: any,
    runtime: () => string
): any {
    var writing = request.action === "provider_settings",
        number = params.number;
    var keys: any = { key: "edkey", list: "edlist", portal: "edvpurl" };
    var state =
        w.__ottNativeProviderSettings ||
        (w.__ottNativeProviderSettings = {
            context: "",
            owner: null,
            receipts: [],
            sequence: 0,
            signature: "",
        });
    function reject(reason: string): any {
        return {
            data: {
                number: number,
                provider: "edem",
                reason: reason,
                runtime: params.runtime,
                version: 1,
            },
            status: reason === "unsupported" ? "unsupported" : "rejected",
        };
    }
    function bounded(value: any, maximum: number): boolean {
        if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value))
            return false;
        try {
            return (
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= maximum
            );
        } catch (_) {
            return false;
        }
    }
    function portal(value: any): string | null {
        if (!bounded(value, 8192)) return null;
        var header = /^portal::(?:\[|%5b)key:([\s\S]*?)(?:\]|%5d)/i.exec(value);
        if (header)
            value =
                "portal::[key:" +
                header[1] +
                "]" +
                value.slice(header[0].length);
        if (value && value.indexOf("portal::[key:") !== 0) return null;
        return value;
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
    function signature(): string {
        var h = w.__ottPlayerSettingsHost,
            driver = w.__ottActiveProviderDriver;
        return JSON.stringify([
            runtime(),
            h && typeof h.source === "function" ? h.source() : "",
            driver && driver.id ? driver.id : "",
        ]);
    }
    function context(): string {
        var next = signature(),
            driver = w.__ottActiveProviderDriver;
        if (
            !state.context ||
            next !== state.signature ||
            state.owner !== driver
        ) {
            state.signature = next;
            state.owner = driver;
            state.receipts = [];
            state.context =
                "edem:" + Date.now().toString(36) + ":" + ++state.sequence;
        }
        return state.context;
    }
    function raw(): any {
        var value: any = {};
        Object.keys(keys).forEach(function (field) {
            value[field] = w.stbGetItem(keys[field]);
        });
        return value;
    }
    function expected(current: any, patch: any): any {
        var next: any = {};
        Object.keys(keys).forEach(function (field) {
            next[field] =
                patch[field] !== undefined
                    ? field === "list"
                        ? String(patch[field])
                        : patch[field]
                    : current[field];
        });
        return next;
    }
    function matched(current: any, patch: any): boolean {
        return Object.keys(patch).every(function (field) {
            var saved = current[field];
            if (field === "list") return Number(saved || 0) === patch.list;
            return (saved || "") === patch[field];
        });
    }
    function remember(value: any): string {
        var revision =
            "native:" + Date.now().toString(36) + ":" + ++state.sequence;
        state.receipts = state.receipts.filter(function (row: any) {
            return row.created <= Date.now() && row.expires > Date.now();
        });
        while (state.receipts.length >= 128) state.receipts.shift();
        state.receipts.push({
            context: state.context,
            created: Date.now(),
            expires: Date.now() + 120000,
            revision: revision,
            snapshot: JSON.stringify(value),
        });
        return revision;
    }
    if (!params || typeof params !== "object" || Array.isArray(params))
        return reject("invalid_request");
    var patch = params.settings,
        fields = patch && typeof patch === "object" ? Object.keys(patch) : [];
    var allowed = ["key", "list", "portal"];
    if (
        params.version !== 1 ||
        params.provider !== "edem" ||
        typeof params.runtime !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(params.runtime) ||
        number !== 1 ||
        Object.keys(params).sort().join(",") !==
            (writing
                ? "context,number,provider,revision,runtime,settings,version"
                : "number,provider,runtime,settings,version") ||
        !fields.length ||
        fields.some(function (field) {
            return allowed.indexOf(field) < 0;
        })
    )
        return reject("invalid_request");
    var normalized: any = {};
    if (
        (patch.key !== undefined &&
            !(
                typeof patch.key === "string" &&
                /^[A-Za-z0-9_-]{1,512}$/.test(patch.key)
            )) ||
        (patch.list !== undefined &&
            !(
                typeof patch.list === "number" &&
                Math.floor(patch.list) === patch.list &&
                patch.list >= 0 &&
                patch.list <= 3
            ))
    )
        return reject("invalid_value");
    if (patch.key !== undefined) normalized.key = patch.key;
    if (patch.list !== undefined) normalized.list = patch.list;
    if (patch.portal !== undefined) {
        var link = portal(patch.portal);
        if (link === null) return reject("invalid_value");
        normalized.portal = link;
    }
    if (params.runtime !== runtime()) return reject("runtime_changed");
    if (!policy.allowed("edem")) return reject("unsupported");
    if (writing && locked()) return reject("policy_restricted");
    var binding = context(),
        snapshot = raw(),
        saved = JSON.stringify(snapshot);
    function current(): boolean {
        return (
            signature() === state.signature &&
            w.__ottActiveProviderDriver === state.owner &&
            (!writing || !locked()) &&
            !(
                typeof request.expires_at === "number" &&
                Date.now() >= request.expires_at * 1000
            )
        );
    }
    if (!current()) return reject("source_changed");
    if (!writing)
        return {
            data: {
                context: binding,
                matched: matched(snapshot, normalized),
                number: number,
                provider: "edem",
                revision: remember(snapshot),
                runtime: params.runtime,
                version: 1,
            },
            status: "ok",
        };
    if (params.context !== binding) return reject("source_changed");
    var receipt: any = null;
    for (var i = 0; i < state.receipts.length; i++)
        if (state.receipts[i].revision === params.revision) {
            receipt = state.receipts.splice(i, 1)[0];
            break;
        }
    if (
        !receipt ||
        receipt.context !== binding ||
        receipt.expires <= Date.now() ||
        receipt.created > Date.now() ||
        receipt.snapshot !== saved
    )
        return reject("revision_conflict");
    if (
        typeof w.commitSettingsWrites !== "function" ||
        typeof w.stbGetItem !== "function" ||
        typeof w.stbSetItem !== "function"
    )
        return reject("storage_failed");
    var next = expected(snapshot, normalized);
    var reloaded = false,
        reloadRequired = false;
    if (!matched(snapshot, normalized)) {
        var writes = fields.map(function (field) {
            var key = keys[field];
            return {
                after: next[field],
                before: snapshot[field],
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
        });
        function admitted(): boolean {
            if (!current()) return false;
            var now = raw();
            return Object.keys(keys).every(function (field) {
                return (
                    now[field] === snapshot[field] || now[field] === next[field]
                );
            });
        }
        try {
            w.commitSettingsWrites(writes, admitted, function () {
                return current();
            });
        } catch (_) {
            return reject("storage_failed");
        }
        if (
            !current() ||
            JSON.stringify(raw()) !== JSON.stringify(next)
        ) {
            // Persisted bytes that the source can no longer certify stay saved;
            // the terminal must reread the profile instead of repeating the write.
            return reject("source_changed");
        }
        var driver = w.__ottActiveProviderDriver;
        if (driver && driver.id === "edem") {
            try {
                if (typeof driver.settingsChanged === "function")
                    driver.settingsChanged();
            } catch (_) {}
            if (
                w.__ottStandby &&
                typeof w.__ottStandby.blocked === "function" &&
                w.__ottStandby.blocked()
            ) {
                reloadRequired = true;
            } else if (typeof w.loadChannels === "function") {
                w.loadChannels();
                reloaded = true;
            } else reloadRequired = true;
        }
        if (!current() || JSON.stringify(raw()) !== JSON.stringify(next))
            return reject("source_changed");
    }
    return {
        data: {
            context: binding,
            fields: fields.slice().sort(),
            number: number,
            provider: "edem",
            reload_required: reloadRequired,
            reloaded: reloaded,
            revision: remember(next),
            runtime: params.runtime,
            saved: true,
            version: 1,
        },
        status: "ok",
    };
}
(window as any).__ottRemoteLegacySettings = {
    compare: compareRemoteSettings,
    native: nativeProviderSettings,
    write: writeRemoteProviderSettings,
};
