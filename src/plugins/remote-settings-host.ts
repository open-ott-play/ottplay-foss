/** Small bridge to the real owners. The transactional protocol is lazy loaded. */
function installRemoteSettingsHost(w: any, ports: any): any {
    var native = !!(
        w.__TAURI__ ||
        (w.Capacitor &&
            (!w.Capacitor.isNativePlatform || w.Capacitor.isNativePlatform()))
    );
    function webUrl(value: any, relative: boolean): boolean {
        if (
            typeof value !== "string" ||
            value.length > 4096 ||
            /[\s\\\x00-\x1f\x7f]/.test(value)
        )
            return false;
        if (!value) return true;
        if (
            !/^https?:\/\//i.test(value) &&
            !(relative && /^\/[^/]/.test(value))
        )
            return false;
        try {
            var url = new URL(value, w.location && w.location.href);
            return (
                /^https?:$/.test(url.protocol) &&
                !!url.hostname &&
                !url.username &&
                !url.password &&
                !url.hash &&
                (native ||
                    !w.location ||
                    w.location.protocol !== "https:" ||
                    url.protocol === "https:")
            );
        } catch (_) {
            return false;
        }
    }
    function validate(group: string, input: any, patch: any): any {
        var fieldIds: any = {
            command_server: [
                "commandServerAddress",
                "commandServerToken",
                "commandServerEnabled",
            ],
            language: ["ottplaylang", "ottplaylangmode"],
            local_http: [
                "localCmdUrl",
                "localHttpDeviceCode",
                "localHttpEnabled",
            ],
            swop: ["swopBaseUrl", "deviceUuid"],
        };
        if (
            !input ||
            !fieldIds[group] ||
            Object.keys(input).sort().join(",") !==
                fieldIds[group].slice().sort().join(",")
        )
            return null;
        if (
            Object.keys(input).some(function (key) {
                var value = input[key];
                if (typeof value !== "string") return typeof value !== "number";
                try {
                    return (
                        /[\x00-\x1f\x7f]/.test(value) ||
                        encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                            .length > 4096
                    );
                } catch (_) {
                    return true;
                }
            })
        )
            return null;
        var v: any = {},
            id: string;
        for (id in input)
            if (Object.prototype.hasOwnProperty.call(input, id))
                v[id] = input[id];
        if (group === "language") {
            if (Object.prototype.hasOwnProperty.call(patch, "ottplaylang"))
                v.ottplaylangmode = "manual";
            if (
                Object.prototype.hasOwnProperty.call(
                    patch,
                    "ottplaylangmode"
                ) &&
                v.ottplaylangmode === "system"
            )
                v.ottplaylang = ports.detectLanguage();
            if (
                Object.prototype.hasOwnProperty.call(
                    patch,
                    "ottplaylangmode"
                ) &&
                !v.ottplaylang
            )
                v.ottplaylang =
                    w.__ottInterfaceLanguage ||
                    ports.detectLanguage() ||
                    "_eng";
            var defaultLanguage =
                v.ottplaylang === "" &&
                v.ottplaylangmode === "system" &&
                !Object.keys(patch).length;
            if (
                (!defaultLanguage &&
                    !Object.prototype.hasOwnProperty.call(
                        ports.languageNames,
                        v.ottplaylang
                    )) ||
                !/^(manual|system)$/.test(v.ottplaylangmode)
            )
                return null;
        } else if (group === "command_server") {
            if (v.commandServerEnabled !== 0 && v.commandServerEnabled !== 1)
                return null;
            if (
                typeof v.commandServerAddress !== "string" ||
                v.commandServerAddress.length > 4096 ||
                typeof v.commandServerToken !== "string"
            )
                return null;
            if (v.commandServerAddress)
                v.commandServerAddress = ports.normalizeAddress(
                    v.commandServerAddress
                );
            if (
                (v.commandServerToken &&
                    !ports.validDeviceToken(v.commandServerToken)) ||
                (v.commandServerEnabled &&
                    (!v.commandServerAddress || !v.commandServerToken))
            )
                return null;
            if (
                v.commandServerAddress &&
                !webUrl(v.commandServerAddress, false)
            )
                return null;
        } else if (group === "local_http") {
            if (v.localHttpEnabled !== 0 && v.localHttpEnabled !== 1)
                return null;
            if (
                !webUrl(v.localCmdUrl, true) ||
                typeof v.localHttpDeviceCode !== "string" ||
                (v.localHttpDeviceCode &&
                    !ports.validDeviceToken(v.localHttpDeviceCode)) ||
                (v.localHttpEnabled &&
                    (!ports.validDeviceToken(v.localHttpDeviceCode) ||
                        (!native && !v.localCmdUrl)))
            )
                return null;
        } else if (group === "swop") {
            if (
                !webUrl(v.swopBaseUrl, false) ||
                (v.swopBaseUrl && /[?#]/.test(v.swopBaseUrl)) ||
                typeof v.deviceUuid !== "string" ||
                (v.deviceUuid && !ports.validSwopClientId(v.deviceUuid))
            )
                return null;
        } else return null;
        return v;
    }
    function applied(group: string, v: any): boolean {
        if (group === "command_server") {
            var owner = w.__ottCommandServer;
            return !!(
                owner &&
                typeof owner.matches === "function" &&
                owner.matches({
                    address: v.commandServerAddress,
                    enabled: v.commandServerEnabled === 1,
                    token: v.commandServerToken,
                }) &&
                (v.commandServerEnabled
                    ? /^(connected|waiting)$/.test(owner.status().state)
                    : owner.status().state === "disconnected")
            );
        }
        if (group === "local_http")
            return !!(
                w.__ottLocalHttpRemote &&
                typeof w.__ottLocalHttpRemote.matches === "function" &&
                w.__ottLocalHttpRemote.matches({
                    code: v.localHttpDeviceCode,
                    enabled: v.localHttpEnabled === 1,
                    url: v.localCmdUrl,
                })
            );
        if (group === "language")
            return (
                w.__ottInterfaceLanguage ===
                    (v.ottplaylang || ports.detectLanguage() || "_eng") &&
                !w.__ottLanguagePending
            );
        return (
            group === "swop" &&
            !w.__ottCancelSwopSession &&
            (w.deviceUUID || "") === v.deviceUuid &&
            (w.localStorage.getItem("ott_device_uuid") || "") ===
                v.deviceUuid &&
            (w.localStorage.getItem("deviceId") || "") === v.deviceUuid
        );
    }
    function apply(
        group: string,
        v: any,
        done: (reason?: string) => void,
        current?: () => boolean
    ): any {
        if (group === "command_server") {
            var controller = w.__ottCommandServer;
            controller.configure(
                {
                    address: v.commandServerAddress,
                    enabled: v.commandServerEnabled === 1,
                    token: v.commandServerToken,
                },
                false
            );
            var revision = controller.status().generation,
                deadline = Date.now() + 30000,
                timer: any;
            var check = function (): void {
                var state = controller.status();
                if (state.generation !== revision) {
                    done("superseded");
                    return;
                }
                if (!v.commandServerEnabled && state.state === "disconnected") {
                    done();
                    return;
                }
                if (state.state === "connected" || state.state === "waiting") {
                    done();
                    return;
                }
                if (state.failure === "authorization_failed") {
                    done("authorization_failed");
                    return;
                }
                if (Date.now() >= deadline) {
                    done("handshake_timeout");
                    return;
                }
                timer = w.setTimeout(check, 250);
            };
            check();
            return function () {
                w.clearTimeout(timer);
            };
        }
        if (group === "local_http") {
            var local = w.__ottLocalHttpRemote;
            var settled = false;
            var httpTimer = w.setTimeout(function () {
                finish("handshake_timeout");
            }, 30000);
            function finish(reason?: string): void {
                if (settled) return;
                settled = true;
                w.clearTimeout(httpTimer);
                done(current && !current() ? "superseded" : reason);
            }
            var operation: any;
            try {
                operation = local.configure(
                    {
                        code: v.localHttpDeviceCode,
                        enabled: v.localHttpEnabled === 1,
                        url: v.localCmdUrl,
                    },
                    false
                );
            } catch (error) {
                settled = true;
                w.clearTimeout(httpTimer);
                throw error;
            }
            var generation = local.status().generation;
            operation.then(
                function () {
                    var state = local.status();
                    finish(
                        state.generation !== generation
                            ? "superseded"
                            : !state.ready ||
                                state.enabled !== (v.localHttpEnabled === 1) ||
                                (state.enabled &&
                                    state.code !== v.localHttpDeviceCode)
                              ? "effect_failed"
                              : undefined
                    );
                },
                function () {
                    finish("effect_failed");
                }
            );
            return function () {
                settled = true;
                w.clearTimeout(httpTimer);
            };
        }
        if (group === "language") {
            var code = v.ottplaylang || ports.detectLanguage() || "_eng";
            if (w.__ottInterfaceLanguage === code) {
                ports.applyLanguageMetadata(code);
                done();
                return;
            }
            return ports.loadLanguage(
                code,
                function (loaded: boolean, reason?: string) {
                    done(
                        reason ||
                            (current && !current()
                                ? "superseded"
                                : loaded
                                  ? undefined
                                  : "effect_failed")
                    );
                },
                current
            );
        }
        if (group === "swop") {
            try {
                if (typeof w.__ottCancelSwopSession === "function")
                    w.__ottCancelSwopSession();
                if (
                    v.deviceUuid &&
                    w.ensureDeviceClientId(v.deviceUuid) !== v.deviceUuid
                )
                    throw new Error("identity");
                if (
                    v.deviceUuid &&
                    (w.deviceUUID !== v.deviceUuid ||
                        w.localStorage.getItem("ott_device_uuid") !==
                            v.deviceUuid ||
                        w.localStorage.getItem("deviceId") !== v.deviceUuid)
                )
                    throw new Error("identity");
                if (!v.deviceUuid) {
                    w.deviceUUID = "";
                    w.localStorage.removeItem("ott_device_uuid");
                    w.localStorage.removeItem("deviceId");
                }
                done();
            } catch (_) {
                done("storage_failed");
            }
        }
    }
    var host = {
        applied: applied,
        apply: apply,
        journal: function (group: string): any {
            var key = "__ottRemoteLifecycleToken_" + group;
            return {
                key: key,
                read: function () {
                    return ports.storage.get(key);
                },
                remove: function () {
                    ports.storage.del(key);
                },
                transaction: ports.storage.transaction,
                write: function (value: string) {
                    ports.storage.set(key, value);
                },
            };
        },
        validate: validate,
    };
    w.__ottRemoteLifecycleHost = host;
    return host;
}

(window as any).__ottRemoteLifecycleHostFactory = {
    create: installRemoteSettingsHost,
};
