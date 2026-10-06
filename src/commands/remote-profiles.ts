import { parseVPortalLink } from "../plugins/vportal";
import { checkProviderUrl, isProviderAllowed } from "../provider";

// Configuration publication can synchronously reenter the remote dispatcher.
var profileRequestActive = false;

/** Handle managed profile operations without returning endpoints or credentials. */
export function handleRemoteProfiles(
    request: any,
    done: (result: any) => void
): boolean {
    var action = request.action;
    if (["profiles", "profile", "profile_settings"].indexOf(action) < 0)
        return false;
    function rejected(message: string): any {
        return { data: { error: message }, status: "rejected" };
    }
    if (profileRequestActive) {
        done(rejected("Another profile operation is in progress."));
        return true;
    }
    var w = window as any;
    function object(value: any): boolean {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }
    function bytes(value: string): number {
        return encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x").length;
    }
    function text(value: any, maximum: number): boolean {
        return (
            typeof value === "string" &&
            value.length <= maximum &&
            !/[\u0000-\u001f\u007f]/.test(value) &&
            bytes(value) <= maximum
        );
    }
    function name(value: any): string {
        var result = String(value || "")
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .slice(0, 256);
        // Old UI settings had no length bound; keep the metadata receipt small.
        while (result) {
            try {
                if (bytes(result) <= 256) return result;
            } catch (_) {}
            result = result.slice(0, -1);
        }
        return "";
    }
    function historyHours(value: any): number | null {
        var hours =
            typeof value === "string" && !/^\d*$/.test(value.trim())
                ? NaN
                : Number(value);
        return isFinite(hours) &&
            Math.floor(hours) === hours &&
            hours >= 0 &&
            hours <= 8760
            ? hours
            : null;
    }
    function metadata(config: any, index: number): any {
        var slot = config.M3Us[index];
        return {
            active: config.active === index,
            history_hours: historyHours(slot.rechours),
            name: name(slot.name),
            number: index + 1,
            playlist_configured: !!slot.www.trim(),
            vportal_configured: !!parseVPortalLink(slot.medUrl),
        };
    }
    function locked(): boolean {
        return w.__ottParental
            ? w.__ottParental.needs("providers") ||
                  w.__ottParental.needs("settings")
            : !!(
                  (w.sPSprovs || w.sPSoptions) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess
              );
    }
    function playlistAllowed(value: string): boolean {
        if (!value) return true;
        var parsed = new URL(value);
        return (
            /^https?:\/\//i.test(value) &&
            /^https?:$/.test(parsed.protocol) &&
            !!parsed.hostname &&
            !parsed.username &&
            !parsed.password &&
            !/[\\\s]/.test(value) &&
            checkProviderUrl(parsed.href)
        );
    }
    function run(): any {
        var params = request.params === undefined ? {} : request.params;
        var driver = w.__ottActiveProviderDriver;
        if (
            driver &&
            driver.id === "vportal" &&
            isProviderAllowed("vportal") &&
            typeof driver.remoteProfiles === "function"
        )
            return driver.remoteProfiles(request);
        if (
            !driver ||
            driver.id !== "m3u" ||
            typeof driver.configuration !== "function" ||
            typeof driver.saveConfiguration !== "function" ||
            typeof driver.fixedSlot !== "function" ||
            !isProviderAllowed("m3u")
        )
            return rejected(
                "Select the M3U provider before managing profiles."
            );
        if (!object(params)) return rejected("Invalid profile parameters.");
        var config = driver.configuration();
        var before = JSON.stringify(config);
        if (
            !config ||
            !Array.isArray(config.M3Us) ||
            config.M3Us.length !== 15 ||
            typeof config.active !== "number" ||
            Math.floor(config.active) !== config.active ||
            config.active < 0 ||
            config.active >= 15
        )
            return rejected("The M3U profile configuration is unavailable.");
        if (action === "profiles") {
            if (Object.keys(params).length)
                return rejected("The profiles query accepts no parameters.");
            return {
                data: {
                    profiles: config.M3Us.map(function (
                        _slot: any,
                        index: number
                    ) {
                        return metadata(config, index);
                    }),
                    provider: "m3u",
                },
                status: "ok",
            };
        }
        if (locked())
            return rejected("Unlock provider settings on the player first.");
        var keys = Object.keys(params);
        var number = params.number;
        if (
            typeof number !== "number" ||
            !isFinite(number) ||
            Math.floor(number) !== number ||
            number < 1 ||
            number > 15 ||
            keys.length !== (action === "profile" ? 1 : 2) ||
            keys.some(function (key) {
                return (
                    key !== "number" &&
                    !(action === "profile_settings" && key === "settings")
                );
            })
        )
            return rejected("Choose a profile number from 1 to 15.");
        var index = number - 1;
        var fixed = driver.fixedSlot();
        if (fixed >= 0 && fixed !== index)
            return rejected("This player URL is restricted to one profile.");
        var slot = config.M3Us[index];
        var fields: string[] = [];
        var mediaChanged = false;
        var reload = false;
        if (action === "profile") {
            if (!slot.www.trim())
                return rejected(
                    "Configure this profile's playlist before selecting it."
                );
            if (!checkProviderUrl(slot.www))
                return rejected(
                    "This playlist is not allowed on this platform."
                );
            var existingPortal = parseVPortalLink(slot.medUrl);
            if (existingPortal && !checkProviderUrl(existingPortal.url))
                return rejected(
                    "This VPortal is not allowed on this platform."
                );
            reload = config.active !== index;
            config.active = index;
        } else {
            if (!object(params.settings))
                return rejected("Provide profile settings to change.");
            fields = Object.keys(params.settings);
            if (
                !fields.length ||
                fields.some(function (key) {
                    return (
                        [
                            "name",
                            "playlist",
                            "history_hours",
                            "vportal",
                        ].indexOf(key) < 0
                    );
                })
            )
                return rejected("Unsupported profile settings fields.");
            for (var at = 0; at < fields.length; at++) {
                var field = fields[at];
                var value = params.settings[field];
                var target =
                    field === "playlist"
                        ? "www"
                        : field === "history_hours"
                          ? "rechours"
                          : field === "vportal"
                            ? "medUrl"
                            : "name";
                if (field === "history_hours") {
                    if (
                        typeof value !== "number" ||
                        !isFinite(value) ||
                        Math.floor(value) !== value ||
                        value < 0 ||
                        value > 8760
                    )
                        return rejected(
                            "Use whole archive hours from 0 to 8760."
                        );
                } else if (!text(value, field === "name" ? 256 : 8192))
                    return rejected(
                        "Profile text exceeds its UTF-8 limit or contains invalid characters."
                    );
                if (field === "playlist" && !playlistAllowed(value))
                    return rejected("Use a valid HTTP(S) playlist URL.");
                if (field === "vportal" && value) {
                    var parsed = parseVPortalLink(value);
                    if (!parsed || !checkProviderUrl(parsed.url))
                        return rejected(
                            "Use the complete VPortal cabinet link allowed on this platform."
                        );
                }
                var changed =
                    field === "history_hours"
                        ? historyHours(slot[target]) !== value
                        : String(slot[target] || "") !== value;
                if (!changed) continue;
                slot[target] = value;
                if (field === "vportal") mediaChanged = true;
                if (
                    config.active === index &&
                    (field === "playlist" || field === "history_hours")
                )
                    reload = true;
            }
        }
        // A newly selected legacy slot may not yet have a media identity. Seed
        // only that slot so media synchronization cannot recursively save it.
        if (
            config.active === index &&
            parseVPortalLink(slot.medUrl) &&
            !slot.medSourceId
        )
            slot.medSourceId =
                Date.now().toString(36) +
                "-" +
                Math.random().toString(36).slice(2);
        var changed = JSON.stringify(config) !== before;
        var load = w.loadPlaylist;
        if (reload && typeof load !== "function")
            return rejected("The playlist reload lifecycle is unavailable.");
        // URL policy checks can open a modal; do not overwrite a synchronous
        // provider/slot change or an intervening settings write.
        if (
            w.__ottActiveProviderDriver !== driver ||
            driver.id !== "m3u" ||
            locked() ||
            driver.fixedSlot() !== fixed ||
            JSON.stringify(driver.configuration()) !== before
        )
            return rejected(
                "The profile changed during validation. Try again."
            );
        if (changed) {
            var expected = JSON.parse(JSON.stringify(config));
            if (
                driver.saveConfiguration(config) !== true ||
                w.__ottActiveProviderDriver !== driver
            )
                return rejected("Could not complete the profile save.");
            var persisted = driver.configuration();
            if (mediaChanged) {
                // The driver owns source identity rotation on a cabinet change.
                if (!persisted.M3Us[index].medSourceId)
                    return rejected("Could not complete the profile save.");
                expected.M3Us[index].medSourceId =
                    persisted.M3Us[index].medSourceId;
            }
            if (JSON.stringify(persisted) !== JSON.stringify(expected))
                return rejected("The profile changed while saving. Try again.");
            config = persisted;
            if (reload) {
                if (w.loadPlaylist !== load)
                    return rejected(
                        "The playlist reload lifecycle changed while saving."
                    );
                load();
                if (
                    w.__ottActiveProviderDriver !== driver ||
                    JSON.stringify(driver.configuration()) !==
                        JSON.stringify(config)
                )
                    return rejected(
                        "The profile changed while reloading. Try again."
                    );
            }
        }
        var data: any = {
            profile: metadata(config, index),
            provider: "m3u",
            reloaded: changed && reload,
        };
        if (action === "profile") data.dispatched = true;
        else {
            data.fields = fields;
            data.saved = true;
        }
        return { data: data, status: "ok" };
    }
    profileRequestActive = true;
    var result: any;
    try {
        result = run();
    } catch (_) {
        result = rejected("Could not validate or save this profile.");
    } finally {
        profileRequestActive = false;
    }
    done(result);
    return true;
}
