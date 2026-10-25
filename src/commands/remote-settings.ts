import { checkProviderUrl, isProviderAllowed } from "../provider";
import { getScriptDOM } from "../utils/helpers";
import { remoteCheckpoint, remotePlayerInfo } from "./remote-restart";

/** Keep the full settings dispatcher off the startup path, including in standby. */
export function executeRemoteSettings(
    w: any,
    request: any,
    done: (result: any) => void,
    afterReply?: (effect: () => void) => void
): () => void {
    var active = true,
        cancel: any,
        params = request.params || {};
    var runtime = remotePlayerInfo(w).runtime,
        driver = w.__ottActiveProviderDriver;
    function source(): string {
        var h = w.__ottPlayerSettingsHost,
            config: any = null;
        try {
            config =
                driver && driver.configuration ? driver.configuration() : null;
        } catch (_) {}
        return JSON.stringify([h && h.source(), config]);
    }
    var initial = source();
    function fail(reason: string): void {
        if (!active) return;
        active = false;
        var data: any = {
            error: "Remote settings are unavailable or changed while loading.",
        };
        if (
            /^(?:player_settings(?:_patch)?|plex_folders)$/.test(request.action)
        ) {
            data.version = 1;
            data.op = params.op;
            data.runtime = params.runtime || runtime;
            data.reason = reason;
            if (request.action === "player_settings_patch")
                data.group = params.group;
        } else if (request.action === "notifications") {
            data.version = 1;
            data.operation =
                params.operation === "get" || params.operation === "set"
                    ? params.operation
                    : null;
            data.runtime = params.runtime || runtime;
            data.error =
                reason === "runtime_changed"
                    ? "runtime_mismatch"
                    : "unsupported";
            if (data.error === "unsupported") reason = "unsupported";
        } else if (
            /^playback_handoff_(?:export|import)$/.test(request.action)
        ) {
            data.error = "unsupported";
            reason = "source_changed";
        } else if (params.provider === "vportal") {
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
        done({
            data: data,
            status: reason === "unsupported" ? "unsupported" : "rejected",
        });
    }
    function dispatch(error?: string): void {
        if (!active) return;
        if (error || !w.__ottRemoteSettingsDispatch) {
            fail(error || "unsupported");
            return;
        }
        if (runtime !== remotePlayerInfo(w).runtime) {
            fail("runtime_changed");
            return;
        }
        if (
            driver !== w.__ottActiveProviderDriver ||
            initial !== source() ||
            (typeof request.expires_at === "number" &&
                Date.now() >= request.expires_at * 1000)
        ) {
            fail("source_changed");
            return;
        }
        try {
            cancel = w.__ottRemoteSettingsDispatch.execute(
                w,
                request,
                function (result: any) {
                    if (active) {
                        active = false;
                        done(result);
                    }
                },
                afterReply,
                {
                    allowed: isProviderAllowed,
                    checkpoint: remoteCheckpoint,
                    runtime: function () {
                        return remotePlayerInfo(w).runtime;
                    },
                    url: checkProviderUrl,
                }
            );
        } catch (_) {
            fail("storage_failed");
        }
    }
    if (w.__ottRemoteSettingsDispatch) dispatch();
    else {
        var state = w.__ottRemoteSettingsLoad;
        if (state) state.waiters.push(dispatch);
        else {
            state = w.__ottRemoteSettingsLoad = { waiters: [dispatch] };
            var settled = false;
            var settle = function (reason?: string): void {
                if (settled) return;
                settled = true;
                w.clearTimeout(timeout);
                delete w.__ottRemoteSettingsLoad;
                var pending = state.waiters;
                state.waiters = [];
                pending.forEach(function (next: (error?: string) => void) {
                    try {
                        next(reason);
                    } catch (_) {}
                });
            };
            var timeout = w.setTimeout(function () {
                settle("unsupported");
            }, 15000);
            try {
                getScriptDOM(
                    String(w.host || "").replace(/\/$/, "") +
                        "/dist/remote-settings-lifecycle.js?" +
                        encodeURIComponent(w.__cv || ""),
                    function () {
                        settle();
                    },
                    function () {
                        settle("unsupported");
                    }
                );
            } catch (_) {
                settle("unsupported");
            }
        }
    }
    return function () {
        active = false;
        if (typeof cancel === "function") cancel();
    };
}
