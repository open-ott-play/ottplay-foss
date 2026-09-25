/** Settings domain. No browser, renderer or ambient storage dependencies. */
export interface SettingDefinition {
    decode?(value: string): any;
    defaultValue: any;
    effects: string[];
    encode?(value: any): string;
    id: string;
    key: string;
    scope: "application" | "provider";
    validate(value: any): boolean;
}
export interface SettingStorage {
    read(): string | null;
    remove(): void;
    write(value: string): void;
}
export interface SettingsPorts {
    context(): string;
    effect(name: string): void;
    storage(definition: SettingDefinition): SettingStorage;
}
export interface SettingsWrite {
    after: string;
    before: string | null;
    storage: SettingStorage;
}
export interface SettingsDraft {
    active(): boolean;
    cancel(): void;
    commit(writes?: SettingsWrite[], admitted?: () => boolean): boolean;
    error(): string;
    get(id: string): any;
    set(id: string, value: any): boolean;
}

/** A single owner, with detached snapshots and optimistic, source-bound drafts. */
export function createSettingsStore(
    schema: SettingDefinition[],
    ports: SettingsPorts
) {
    var definitions: Record<string, SettingDefinition> = Object.create(null);
    var values: Record<string, any> = Object.create(null);
    var revision = 0;
    var context = ports.context();
    function copy(value: any): any {
        return Array.isArray(value) ? value.slice() : value;
    }
    function equal(a: any, b: any): boolean {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    schema.forEach(function (entry) {
        if (definitions[entry.id])
            throw new Error("Duplicate setting: " + entry.id);
        definitions[entry.id] = entry;
        values[entry.id] = copy(entry.defaultValue);
    });
    function get(id: string): any {
        return copy(values[id]);
    }
    function observe(id: string, value: any): boolean {
        var entry = definitions[id];
        if (!entry || !entry.validate(value)) return false;
        values[id] = copy(value);
        return true;
    }
    function reload(scope?: "application" | "provider"): void {
        context = ports.context();
        var generation = ++revision;
        var source = context;
        var loaded: Record<string, any> = {};
        schema.forEach(function (entry) {
            if (scope && entry.scope !== scope) return;
            var value = copy(entry.defaultValue);
            try {
                var raw = ports.storage(entry).read();
                if (raw !== null) {
                    var parsed = entry.decode
                        ? entry.decode(raw)
                        : typeof entry.defaultValue === "number"
                          ? /^[-+]?\d+$/.test(raw)
                              ? Number(raw)
                              : NaN
                          : raw;
                    if (entry.validate(parsed)) value = parsed;
                }
            } catch (_error) {
                /* Unreadable storage cannot inject an invalid preference. */
            }
            loaded[entry.id] = copy(value);
        });
        if (generation !== revision || source !== ports.context()) return;
        Object.keys(loaded).forEach(function (id) {
            values[id] = loaded[id];
        });
    }
    function begin(persistCurrent = false): SettingsDraft {
        // A failed catalog load must not prevent editing the new source's
        // preferences. Hydrate its scope before taking a fresh draft snapshot.
        if (ports.context() !== context) reload("provider");
        var generation = revision;
        var source = ports.context();
        var original: Record<string, any> = {};
        var pending: Record<string, any> = {};
        var open = true;
        var message = "";
        schema.forEach(function (entry) {
            original[entry.id] = get(entry.id);
        });
        function active(): boolean {
            return (
                open &&
                generation === revision &&
                source === context &&
                source === ports.context()
            );
        }
        return {
            active: active,
            cancel: function () {
                open = false;
                pending = {};
            },
            commit: function (
                additional = [],
                admitted = function () {
                    return true;
                }
            ) {
                function current(): boolean {
                    return active() && admitted();
                }
                if (!current()) {
                    message = "Settings source changed";
                    return false;
                }
                var changes = Object.keys(pending).filter(function (id) {
                    return persistCurrent || !equal(original[id], pending[id]);
                });
                if (
                    changes.some(function (id) {
                        return !equal(values[id], original[id]);
                    })
                ) {
                    message = "Settings changed while editing";
                    return false;
                }
                var writes: SettingsWrite[] = [];
                try {
                    additional.forEach(function (write) {
                        if (write.storage.read() !== write.before)
                            throw new Error("Backup state changed");
                    });
                    writes = additional.slice();
                    changes.forEach(function (id) {
                        var entry = definitions[id],
                            storage = ports.storage(entry);
                        writes.push({
                            after: entry.encode
                                ? entry.encode(pending[id])
                                : String(pending[id]),
                            before: storage.read(),
                            storage: storage,
                        });
                    });
                    for (var i = 0; i < writes.length; i++) {
                        if (!current())
                            throw new Error("Settings source changed");
                        writes[i].storage.write(writes[i].after);
                        if (writes[i].storage.read() !== writes[i].after)
                            throw new Error("Settings storage rejected write");
                    }
                    if (!current()) throw new Error("Settings source changed");
                } catch (error) {
                    // Roll back only the captured keys. Do not touch a newer external write.
                    for (var j = writes.length - 1; j >= 0; j--) {
                        try {
                            if (!admitted()) break;
                            if (writes[j].storage.read() !== writes[j].after)
                                continue;
                            if (writes[j].before === null)
                                writes[j].storage.remove();
                            else
                                writes[j].storage.write(
                                    writes[j].before as string
                                );
                        } catch (_rollback) {
                            /* Failure is exposed; runtime never adopts a partial commit. */
                        }
                    }
                    message = String(error);
                    return false;
                }
                open = false;
                var effects: string[] = [];
                changes.forEach(function (id) {
                    values[id] = copy(pending[id]);
                    definitions[id].effects.forEach(function (name) {
                        if (effects.indexOf(name) === -1) effects.push(name);
                    });
                });
                effects.forEach(function (name) {
                    if (
                        generation !== revision ||
                        source !== ports.context() ||
                        !admitted()
                    )
                        return;
                    try {
                        ports.effect(name);
                    } catch (error) {
                        message = String(error);
                    }
                });
                return true;
            },
            error: function () {
                return message;
            },
            get: function (id) {
                return copy(
                    Object.prototype.hasOwnProperty.call(pending, id)
                        ? pending[id]
                        : original[id]
                );
            },
            set: function (id, value) {
                var entry = definitions[id];
                if (!active() || !entry || !entry.validate(value)) {
                    message = "Invalid setting: " + id;
                    return false;
                }
                pending[id] = copy(value);
                return true;
            },
        };
    }
    return {
        begin: begin,
        context: function () {
            return context;
        },
        get: get,
        observe: observe,
        reload: reload,
        schema: schema.slice(),
    };
}
