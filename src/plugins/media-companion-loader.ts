import { loadRemoteFeature } from "../commands/remote-feature";
import { tauriInvoke } from "./native-bridge";
/** Native capability discovery is static; the service starts only for a source. */
export function installMediaCompanion(w: any): void {
    if (w.__ottMediaCompanion) return;
    var pending: Promise<any> | null = null;
    var pendingNative: Promise<any> | null = null;
    var nativeAvailable: boolean | null = w.__TAURI__ ? null : false;
    var nativeIndexer = false;
    var capabilityRequest: Promise<any> | null = null;
    function capabilities(): Promise<any> {
        if (!w.__TAURI__) return Promise.resolve(null);
        if (!capabilityRequest)
            capabilityRequest = Promise.resolve()
                .then(function () {
                    return tauriInvoke("companion_capabilities", {});
                })
                .then(
                    function (value: any) {
                        nativeAvailable = !!(
                            value &&
                            value.schema === 1 &&
                            value.local === true &&
                            value.available === true &&
                            value.torrent === true
                        );
                        nativeIndexer =
                            nativeAvailable && value.localTorznab === true;
                        return nativeAvailable ? value : null;
                    },
                    function () {
                        nativeAvailable = false;
                        return null;
                    }
                );
        return capabilityRequest;
    }
    function available(): boolean {
        return (
            typeof w.fetch === "function" &&
            !!(
                (w.settings && w.settings.companionEndpoint) ||
                (w.stbGetItem && w.stbGetItem("sCompanionEndpoint")) ||
                nativeAvailable === true
            )
        );
    }
    function source(value: any): boolean {
        return (
            typeof value === "string" &&
            (/^(magnet:|ottplay-plugin:|ottplay-torrent:|ottplay-local-torrent:)/i.test(
                value
            ) ||
                /^https?:\/\/[^?#]*\.torrent(?:[?#]|$)/i.test(value))
        );
    }
    function ensure(nativeOnly = false): Promise<any> {
        if (nativeOnly ? pendingNative : pending)
            return (nativeOnly ? pendingNative : pending)!;
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
                                      return capabilities().then(
                                          function (value) {
                                              if (!value)
                                                  throw new Error(
                                                      "companion_unavailable"
                                                  );
                                              return tauriInvoke(
                                                  "companion_endpoint",
                                                  {}
                                              );
                                          }
                                      );
                                  }
                                : undefined,
                            nativeOnly
                        )
                    );
                } catch (failure) {
                    reject(failure);
                }
            }
            if (w.__ottMediaCompanionFactory) ready();
            else loadRemoteFeature(w, "media-companion", ready);
        });
        if (nativeOnly) pendingNative = loading;
        else pending = loading;
        loading.catch(function () {
            if (nativeOnly && pendingNative === loading) pendingNative = null;
            else if (!nativeOnly && pending === loading) pending = null;
        });
        return loading;
    }
    w.__ottMediaCompanion = {
        available: available,
        capabilities: capabilities,
        ensure: ensure,
        indexerAvailable: function () {
            return typeof w.fetch === "function" && nativeIndexer;
        },
        isSource: source,
        nativePending: function () {
            return !!w.__TAURI__ && nativeAvailable === null;
        },
        providerAvailable: function () {
            return typeof w.fetch === "function" && nativeAvailable === true;
        },
        resolve: function (
            value: string,
            done: (url: string | null, transport?: "file" | "stream") => void
        ) {
            var cancelled = false,
                release = function () {};
            var nativeOnly = false;
            try {
                nativeOnly =
                    /^ottplay-torrent:/i.test(value) &&
                    new URL(value).searchParams.get("native") === "1";
            } catch (_) {}
            ensure(nativeOnly).then(
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
    if (w.__TAURI__) capabilities();
}
