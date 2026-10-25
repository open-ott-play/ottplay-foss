import { checkProviderUrl, isProviderAllowed } from "../provider";
import { remotePlayerInfo } from "./remote-restart";

/** Remote-only tools are loaded independently of media/catalogue readiness. */
export function executeRemoteSettings(
    w: any,
    request: any,
    done: (result: any) => void
): () => void {
    var runtime = remotePlayerInfo(w).runtime,
        source = w.__ottActiveProviderDriver;
    var active = true,
        params = request.params || {},
        releases: (() => void)[] = [];
    var provider =
        params.provider === "vportal" && request.action !== "player_settings";
    var initial = scope();
    function scope(): string {
        var h = w.__ottPlayerSettingsHost,
            config: any = null;
        try {
            config =
                source && source.configuration ? source.configuration() : null;
        } catch (_) {}
        return JSON.stringify([h && h.source(), config]);
    }
    function respond(result: any): void {
        if (active) {
            active = false;
            done(result);
        }
    }
    function fail(reason: string): void {
        var data: any = {
            error: "Remote settings are unavailable or changed while loading.",
        };
        if (
            request.action === "player_settings" ||
            request.action === "plex_folders"
        ) {
            data.version = 1;
            data.op = params.op;
            data.runtime = params.runtime || runtime;
            data.reason = reason;
        } else if (provider) {
            data.provider = "vportal";
            data.runtime = params.runtime;
            data.reason = reason;
            data[
                request.action === "provider_settings" ? "profile" : "number"
            ] =
                request.action === "provider_settings"
                    ? params.settings && params.settings.profile
                    : params.number;
        }
        respond({
            data: data,
            status: reason === "unsupported" ? "unsupported" : "rejected",
        });
    }
    function valid(): boolean {
        if (!active) return false;
        if (runtime !== remotePlayerInfo(w).runtime) {
            fail("runtime_changed");
            return false;
        }
        if (
            source !== w.__ottActiveProviderDriver ||
            scope() !== initial ||
            (typeof request.expires_at === "number" &&
                Date.now() >= request.expires_at * 1000)
        ) {
            fail("source_changed");
            return false;
        }
        return true;
    }
    function ensure(
        name: string,
        ready: () => boolean,
        next: () => void
    ): void {
        if (!valid()) return;
        if (ready()) {
            next();
            return;
        }
        var assets =
            w.__ottRemoteSettingsAssets || (w.__ottRemoteSettingsAssets = {});
        var state = assets[name],
            first = !state;
        if (!state) state = assets[name] = { waiting: [] };
        var waiter = function (error?: string) {
            if (!active) return;
            if (error || !ready()) fail(error || "unsupported");
            else if (valid()) next();
        };
        state.waiting.push(waiter);
        releases.push(function () {
            var index = state.waiting.indexOf(waiter);
            if (index >= 0) state.waiting.splice(index, 1);
        });
        if (!first) return;
        var script = w.document.createElement("script"),
            settled = false;
        var timer = w.setTimeout(function () {
            settle("unsupported");
        }, 15000);
        function settle(reason?: string): void {
            if (settled) return;
            settled = true;
            w.clearTimeout(timer);
            script.onload = script.onerror = null;
            if (script.parentNode) script.parentNode.removeChild(script);
            delete assets[name];
            var waiting = state.waiting;
            state.waiting = [];
            waiting.forEach(function (callback: (reason?: string) => void) {
                try {
                    callback(reason);
                } catch (_) {}
            });
        }
        script.src =
            String(w.host || "").replace(/\/$/, "") +
            "/dist/" +
            name +
            ".js?" +
            encodeURIComponent(w.__cv || "");
        script.onload = function () {
            settle();
        };
        script.onerror = function () {
            settle("unsupported");
        };
        try {
            (w.document.head || w.document.body).appendChild(script);
        } catch (_) {
            settle("unsupported");
        }
    }
    function execute(): void {
        if (!valid()) return;
        try {
            var policy = { allowed: isProviderAllowed, url: checkProviderUrl };
            if (request.action === "plex_folders") {
                var folders =
                    w.__ottRemotePlexFolderSession ||
                    (w.__ottRemotePlexFolderSession =
                        w.__ottRemotePlexFolders.create(w, function () {
                            return remotePlayerInfo(w).runtime;
                        }));
                folders.request(request, respond);
            } else if (request.action === "player_settings") {
                var api =
                    w.__ottRemotePlayerSettings ||
                    (w.__ottRemotePlayerSettings =
                        w.__ottPlayerSettingsFactory.create(w, function () {
                            return remotePlayerInfo(w).runtime;
                        }));
                api.request(request, respond);
            } else if (provider) {
                var driverApi =
                    w.__ottRemoteVPortalSettings ||
                    (w.__ottRemoteVPortalSettings =
                        w.__ottRemoteProviderSettings.create(
                            w,
                            function () {
                                return remotePlayerInfo(w).runtime;
                            },
                            policy
                        ));
                driverApi.request(request, respond);
            } else if (request.action === "settings_compare")
                respond(w.__ottRemoteLegacySettings.compare(w, params));
            else w.__ottRemoteLegacySettings.write(w, params, respond, policy);
        } catch (_) {
            fail("storage_failed");
        }
    }
    ensure(
        "remote-settings",
        function () {
            return !!(
                w.__ottPlayerSettingsFactory &&
                w.__ottRemoteProviderSettings &&
                w.__ottRemoteLegacySettings
            );
        },
        function () {
            if (provider)
                ensure(
                    "provider-vportal",
                    function () {
                        return !!w.__ottVPortalDriver;
                    },
                    execute
                );
            else if (
                request.action === "player_settings" &&
                params.op === "set" &&
                /^subtitle(?:FontFamily|FontSize|TextColor|Outline|Background)$/.test(
                    params.id
                )
            ) {
                if (
                    !w.__ottAppearanceHost ||
                    typeof w.__ottAppearanceHost.ready !== "function"
                ) {
                    fail("unsupported");
                    return;
                }
                try {
                    var release = w.__ottAppearanceHost.ready(function (
                        loaded: boolean
                    ) {
                        if (!active) return;
                        if (!loaded) fail("unsupported");
                        else if (valid()) execute();
                    });
                    if (typeof release === "function") releases.push(release);
                } catch (_) {
                    fail("unsupported");
                }
            } else if (
                request.action === "plex_folders" ||
                (request.action === "provider_settings" &&
                    params.provider === "plex") ||
                (request.action === "player_settings" &&
                    source &&
                    (params.op === "schema" ||
                        /^(provider|m3u|plex|edem|stalker|vportal)/.test(
                            params.id || ""
                        )))
            ) {
                ensure(
                    "remote-provider-fields",
                    function () {
                        return (
                            !!w.__ottRemoteProviderFields &&
                            (request.action !== "plex_folders" ||
                                !!w.__ottRemotePlexFolders)
                        );
                    },
                    execute
                );
            } else execute();
        }
    );
    return function () {
        active = false;
        releases.forEach(function (release) {
            release();
        });
    };
}
