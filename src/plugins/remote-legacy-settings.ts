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
(window as any).__ottRemoteLegacySettings = {
    compare: compareRemoteSettings,
    write: writeRemoteProviderSettings,
};
