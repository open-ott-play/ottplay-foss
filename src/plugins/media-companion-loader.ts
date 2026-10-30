import { loadRemoteFeature } from "../commands/remote-feature";
import { editSettingsText } from "../settings/transfer-ui";
import { tauriInvoke } from "./native-bridge";
/** No service or optional script starts until a companion source/UI is requested. */
export function installMediaCompanion(w: any): void {
    if (w.__ottMediaCompanion) return;
    var pending: Promise<any> | null = null;
    function source(value: any): boolean {
        return (
            typeof value === "string" &&
            (/^(magnet:|ottplay-plugin:|ottplay-torrent:)/i.test(value) ||
                /^https?:\/\/[^?#]*\.torrent(?:[?#]|$)/i.test(value))
        );
    }
    function ensure(): Promise<any> {
        if (pending) return pending;
        var loading = new Promise(function (resolve, reject) {
            function ready(error?: string): void {
                if (error || !w.__ottMediaCompanionFactory) {
                    reject(new Error("companion_module_unavailable"));
                    return;
                }
                try {
                    resolve(
                        w.__ottMediaCompanionFactory(
                            w,
                            w.__TAURI__
                                ? function () {
                                      return tauriInvoke(
                                          "companion_endpoint",
                                          {}
                                      );
                                  }
                                : undefined
                        )
                    );
                } catch (failure) {
                    reject(failure);
                }
            }
            if (w.__ottMediaCompanionFactory) ready();
            else loadRemoteFeature(w, "media-companion", ready);
        });
        pending = loading;
        loading.catch(function () {
            if (pending === loading) pending = null;
        });
        return loading;
    }
    w.__ottMediaCompanion = {
        ensure: ensure,
        isSource: source,
        open: function () {
            ensure().then(
                function (client) {
                    w.__ottMediaCompanionUi(w, client, editSettingsText);
                },
                function () {
                    if (w.showShift) w.showShift("Media companion unavailable");
                }
            );
        },
        resolve: function (value: string, done: (url: string | null) => void) {
            var cancelled = false,
                release = function () {};
            ensure().then(
                function (client) {
                    if (cancelled) return;
                    release = client.resolve(value, done);
                    if (cancelled) release();
                },
                function () {
                    if (!cancelled) done(null);
                }
            );
            return function () {
                cancelled = true;
                release();
            };
        },
    };
}
