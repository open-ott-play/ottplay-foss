/** Remaining persistent UI preferences, with explicit owner effects and saved-byte CAS. */
function createRemoteExtraSettings(w: any, checkpoint?: (w: any) => void): any {
    if (w.__ottExtraSettings) return w.__ottExtraSettings;
    var versions: any = {};
    var definitions = [
        {
            apply: "after_ack",
            description:
                "Hide the provider chooser. Reloads the player after acknowledgement.",
            id: "noSelProv",
            key: "noSelProv",
        },
        {
            apply: "after_ack",
            description:
                "Hide provider configuration. Reloads the player after acknowledgement.",
            id: "noProvParam",
            key: "noProvParam",
        },
        {
            apply: "manual",
            description:
                "Browser media-library URL. Applies to the next library read; does not open a picker or start playback.",
            id: "localMediaEndpoint",
            key: "localMediaEndpoint",
            secret: true,
        },
        {
            apply: "immediate",
            debug: true,
            description:
                "Persistently enable or disable the playback debug collector.",
            id: "debugEnabled",
            key: "ottplay_debug",
        },
        {
            apply: "immediate",
            debug: true,
            description:
                "Persistently show or hide the debug HUD. The collector must be enabled to display it.",
            fallback: 1,
            id: "debugHud",
            key: "ottplay_debug_hud",
        },
        {
            apply: "immediate",
            description: "Alphabetically sort this provider's channel lists.",
            id: "sortAlphabetically",
            key: "sSortAbc",
            provider: true,
        },
    ];
    function definition(id: string): any {
        for (var i = 0; i < definitions.length; i++)
            if (definitions[i].id === id) return definitions[i];
        throw new Error("unknown_setting");
    }
    function revision(id: string): number {
        return versions[id] || 0;
    }
    function changed(id: string): number {
        return (versions[id] = revision(id) + 1);
    }
    function media(): any {
        return w.__ottLocalMedia;
    }
    function localMedia(): boolean {
        var owner = media();
        return (
            !!owner &&
            typeof owner.libraryIdentity === "function" &&
            owner.libraryIdentity().indexOf("browser:") === 0
        );
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
    function descriptor(id: string): any {
        var d = definition(id),
            owner = w.__ottActiveProviderDriver;
        var reason = locked() ? "policy_restricted" : "";
        if (
            d.provider &&
            (!owner ||
                typeof owner.storageKey !== "function" ||
                typeof w.sortChannels !== "function")
        )
            reason = "unsupported";
        if (d.secret && !localMedia())
            reason = media() ? "local_action_required" : "unsupported";
        if (d.debug && !w.__ottDebug) reason = "unsupported";
        if (
            d.apply === "after_ack" &&
            (typeof w.restart !== "function" ||
                typeof checkpoint !== "function")
        )
            reason = "unsupported";
        var result: any = {
            access: { read: !d.secret, write: !reason },
            apply: d.apply,
            constraints: d.secret
                ? { max_utf8_bytes: 4096 }
                : { maximum: 1, minimum: 0 },
            description: d.description,
            id: id,
            scope: d.provider ? "provider" : "application",
            sensitive: !!d.secret,
            type: d.secret ? "string" : "integer",
        };
        if (reason) result.access.reason = reason;
        if (!d.secret) result.default_value = d.fallback || 0;
        if (d.secret && reason === "local_action_required")
            result.description =
                "This native player uses its local library. Connect folders and grant file access on the device; a browser media-library URL does not configure native access.";
        return result;
    }
    function storage(d: any): any {
        var owner = d.provider ? w.__ottActiveProviderDriver : null;
        var key =
            d.provider && owner && owner.storageKey
                ? owner.storageKey(d.key)
                : d.key;
        var target = d.debug ? w.localStorage : w;
        var read = d.debug ? target.getItem : w.stbGetItem;
        var write = d.debug ? target.setItem : w.stbSetItem;
        var remove = d.debug ? target.removeItem : w.stbDelItem;
        if (
            typeof key !== "string" ||
            typeof read !== "function" ||
            typeof write !== "function" ||
            typeof remove !== "function"
        )
            throw new Error("unsupported");
        function current(): boolean {
            return (
                (!d.provider || owner === w.__ottActiveProviderDriver) &&
                (d.debug
                    ? target === w.localStorage &&
                      read === target.getItem &&
                      write === target.setItem &&
                      remove === target.removeItem
                    : read === w.stbGetItem &&
                      write === w.stbSetItem &&
                      remove === w.stbDelItem)
            );
        }
        return {
            current: current,
            read: function () {
                return read.call(target, key);
            },
            remove: function () {
                remove.call(target, key);
            },
            write: function (value: string) {
                write.call(target, key, value);
            },
        };
    }
    function valid(d: any, value: any): boolean {
        if (!d.secret) return value === 0 || value === 1;
        if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value))
            return false;
        try {
            return (
                encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= 4096
            );
        } catch (_) {
            return false;
        }
    }
    function effectOwner(d: any): any {
        return d.secret
            ? media()
            : d.debug
              ? w.__ottDebug
              : d.provider
                ? w.sortChannels
                : w.restart;
    }
    function capture(id: string): any {
        var d = definition(id),
            port = storage(d),
            raw = port.read(),
            version = revision(id);
        var owner = effectOwner(d),
            ownerRevision = d.secret && owner && owner.settingsRevision();
        function ownerCurrent(): boolean {
            return (
                owner === effectOwner(d) &&
                (!d.secret ||
                    ownerRevision === (owner && owner.settingsRevision()))
            );
        }
        var stored = d.secret ? raw : raw === "0" ? 0 : raw === "1" ? 1 : null;
        var okay = raw !== null && valid(d, stored);
        return {
            configured: raw !== null && raw !== "",
            current: function () {
                return (
                    port.current() &&
                    revision(id) === version &&
                    port.read() === raw &&
                    ownerCurrent()
                );
            },
            id: id,
            owner: owner,
            ownerCurrent: ownerCurrent,
            raw: raw,
            storage: port,
            stored: stored,
            valid: okay,
            value: okay ? stored : d.secret ? "" : d.fallback || 0,
            version: version,
        };
    }
    function save(
        id: string,
        requested: any,
        before: any,
        admitted: () => boolean,
        afterReply: any
    ): any {
        var d = definition(id),
            view = descriptor(id);
        if (!view.access.write)
            throw new Error(
                view.access.reason === "local_action_required"
                    ? "local_only"
                    : view.access.reason
            );
        if (!valid(d, requested)) throw new Error("invalid_value");
        if (!before.current() || !admitted())
            throw new Error("revision_conflict");
        if (d.apply === "after_ack" && typeof afterReply !== "function")
            throw new Error("unsupported");
        var value = requested;
        if (d.secret) {
            value = value.trim().replace(/\/+$/, "");
            try {
                value = media().libraryWrite("browser:" + value).value;
            } catch (_) {
                throw new Error("invalid_value");
            }
        }
        var expected = String(value),
            port = before.storage;
        var commit =
            w.__ottPlayerSettingsHost && w.__ottPlayerSettingsHost.commit;
        if (typeof commit !== "function") throw new Error("unsupported");
        function current(): boolean {
            return (
                port.current() &&
                before.ownerCurrent() &&
                admitted() &&
                !locked() &&
                revision(id) === before.version
            );
        }
        try {
            commit(
                [{ after: expected, before: before.raw, storage: port }],
                current,
                current
            );
        } catch (_) {
            throw new Error(current() ? "storage_failed" : "source_changed");
        }
        if (!current() || port.read() !== expected)
            throw new Error("storage_failed");
        changed(id);
        var application: any = { state: "completed" };
        try {
            if (d.apply === "after_ack") {
                var saved = capture(id),
                    restart = w.restart;
                var reloaded = false;
                afterReply(function () {
                    if (reloaded) return;
                    reloaded = true;
                    function current(): boolean {
                        return (
                            saved.current() &&
                            admitted() &&
                            !locked() &&
                            w.restart === restart
                        );
                    }
                    if (!current()) return;
                    checkpoint!(w);
                    if (current()) restart.call(w);
                });
                application = { reason: "after_ack", state: "deferred" };
            } else if (d.secret) {
                media().didRestoreLibrary();
                application = { reason: "manual", state: "deferred" };
            } else if (id === "sortAlphabetically") {
                w.sortChannels(value);
                if (typeof w.showPage === "function") w.showPage();
            } else if (id === "debugEnabled") {
                if (value) {
                    w.__ottDebug.enable(true);
                } else w.__ottDebug.disable();
            } else if (id === "debugHud") {
                if (w.__ottDebug.enabled) w.__ottDebug.setHud(value === 1);
                else application = { reason: "manual", state: "deferred" };
            }
        } catch (_) {
            application = { reason: "effect_failed", state: "failed" };
        }
        if (
            !port.current() ||
            !admitted() ||
            port.read() !== expected ||
            (d.secret && before.owner !== media())
        )
            throw new Error("source_changed");
        return {
            application: application,
            capture: capture(id),
            changed: before.value !== value,
        };
    }
    var api = {
        capture: capture,
        changed: changed,
        descriptor: descriptor,
        revision: revision,
        save: save,
        schema: definitions.map(function (d) {
            return {
                extraField: true,
                id: d.id,
                scope: d.provider ? "provider" : "application",
            };
        }),
    };
    w.__ottExtraSettings = api;
    return api;
}
(window as any).__ottRemoteSettingsExtras = {
    create: createRemoteExtraSettings,
};
