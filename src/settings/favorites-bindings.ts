/** Private target bindings; public identities are random, never credential-derived. */
interface FavoritesBindingPorts {
    compareAndSwap(
        before: string | null,
        after: string
    ): "confirmed" | "conflict" | "unknown";
    current(entry: any, binding: any): boolean;
    /** Required only for explicit Plex provisioning; actual physical-store readback. */
    persistedRead?(): string | null;
    /** Private host lookup: one current verified PMS and its parent/source grants. */
    provisionTarget?(targetId: string): any;
    read(): string | null;
    uuid(): string;
    validateSelector(kind: string, selector: any): boolean;
}

export function createFavoritesBindings(ports: FavoritesBindingPorts) {
    var active = false;
    var maxBytes = 524288;
    var maxEntries = 256;
    function fail(code: string): never {
        var error = new Error("Favorites bindings: " + code);
        (error as any).code = code;
        throw error;
    }
    function object(value: any): boolean {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }
    function keys(
        value: any,
        required: string[],
        optional: string[] = []
    ): boolean {
        return (
            object(value) &&
            required.every(function (key) {
                return Object.prototype.hasOwnProperty.call(value, key);
            }) &&
            Object.keys(value).every(function (key) {
                return required.indexOf(key) >= 0 || optional.indexOf(key) >= 0;
            })
        );
    }
    function text(value: any, limit: number): boolean {
        if (
            typeof value !== "string" ||
            !value ||
            value.length > limit ||
            /[\u0000-\u001f\u007f]/.test(value)
        )
            return false;
        try {
            encodeURIComponent(value);
            return true;
        } catch (_) {
            return false;
        }
    }
    function uuid(value: any): boolean {
        return (
            typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/.test(
                value
            )
        );
    }
    function copy(value: any): any {
        return JSON.parse(JSON.stringify(value));
    }
    function bounded(raw: string, limit: number): boolean {
        if (raw.length > limit) return false;
        try {
            return (
                encodeURIComponent(raw).replace(/%[0-9A-F]{2}/g, "x").length <=
                limit
            );
        } catch (_) {
            return false;
        }
    }
    function selectorBytes(
        value: string,
        budget: { nodes: number; bytes: number }
    ): void {
        // Charge encoded keys/strings and separators before retaining more data.
        budget.bytes +=
            encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, "x").length + 1;
        if (budget.bytes > 16384) fail("invalid_selector");
    }
    function canonical(
        value: any,
        depth = 0,
        budget = { bytes: 0, nodes: 0 }
    ): any {
        budget.nodes++;
        if (depth > 8 || budget.nodes > 512) fail("invalid_selector");
        if (
            value === null ||
            typeof value === "boolean" ||
            (typeof value === "number" && isFinite(value))
        ) {
            selectorBytes(JSON.stringify(value), budget);
            return value;
        }
        if (typeof value === "string" && (value === "" || text(value, 4096))) {
            selectorBytes(JSON.stringify(value), budget);
            return value;
        }
        if (Array.isArray(value)) {
            if (value.length > 64 || Object.keys(value).length !== value.length)
                fail("invalid_selector");
            selectorBytes("[]", budget);
            return value.map(function (item) {
                return canonical(item, depth + 1, budget);
            });
        }
        if (!object(value) || Object.keys(value).length > 64)
            fail("invalid_selector");
        selectorBytes("{}", budget);
        var result: any = Object.create(null);
        Object.keys(value)
            .sort()
            .forEach(function (key) {
                if (
                    !text(key, 128) ||
                    /^(?:__proto__|prototype|constructor)$/.test(key)
                )
                    fail("invalid_selector");
                selectorBytes(JSON.stringify(key), budget);
                result[key] = canonical(value[key], depth + 1, budget);
            });
        return result;
    }
    function binding(kind: string, value: any): any {
        if (
            !keys(value, ["owner", "selector"]) ||
            !text(value.owner, 512) ||
            !object(value.selector)
        )
            fail("invalid_binding");
        var selector = canonical(value.selector);
        if (!bounded(JSON.stringify(selector), 16384)) fail("invalid_selector");
        var valid = false;
        try {
            valid = ports.validateSelector(kind, copy(selector)) === true;
        } catch (_) {}
        if (!valid) fail("invalid_selector");
        return { owner: value.owner, selector: selector };
    }
    function publicEntry(value: any): any {
        var result: any = {
            id: value.id,
            kind: value.kind,
            provider: value.provider,
        };
        if (value.kind === "source") result.profile_id = value.profile_id;
        return result;
    }
    function row(value: any, privateValue: boolean): any {
        if (
            !keys(
                value,
                ["id", "kind", "provider"],
                privateValue ? ["profile_id", "binding"] : ["profile_id"]
            ) ||
            !uuid(value.id) ||
            (value.kind !== "profile" && value.kind !== "source") ||
            typeof value.provider !== "string" ||
            !/^[a-z0-9][a-z0-9_.\/-]{0,63}$/.test(value.provider) ||
            (value.kind === "source"
                ? !uuid(value.profile_id)
                : Object.prototype.hasOwnProperty.call(value, "profile_id"))
        )
            fail("invalid_registry");
        var result = publicEntry(value);
        if (Object.prototype.hasOwnProperty.call(value, "binding"))
            result.binding = binding(value.kind, value.binding);
        return result;
    }
    function entries(
        values: any,
        privateValue: boolean,
        requireParents = true
    ): any[] {
        if (
            !Array.isArray(values) ||
            values.length > maxEntries ||
            Object.keys(values).length !== values.length
        )
            fail("invalid_registry");
        var result = values.map(function (value) {
            return row(value, privateValue);
        });
        var ids: any = Object.create(null),
            targets: any = Object.create(null);
        result.forEach(function (entry) {
            if (ids[entry.id]) fail("conflict");
            ids[entry.id] = entry;
            if (entry.binding) {
                var key = JSON.stringify([
                    entry.kind,
                    entry.provider,
                    entry.profile_id || "",
                    entry.binding.selector,
                ]);
                if (targets[key]) fail("ambiguous_binding");
                targets[key] = true;
            }
        });
        if (requireParents)
            result.forEach(function (entry) {
                if (entry.kind === "source") {
                    var parent = ids[entry.profile_id];
                    if (
                        !parent ||
                        parent.kind !== "profile" ||
                        parent.provider !== entry.provider
                    )
                        fail("missing_profile");
                }
            });
        return result;
    }
    function read(): any {
        var raw: string | null = null;
        try {
            raw = ports.read();
        } catch (_) {
            fail("storage_unavailable");
        }
        if (raw === null)
            return {
                raw: null,
                value: { entries: [], revision: 0, version: 1 },
            };
        if (typeof raw !== "string" || !bounded(raw, maxBytes))
            fail("invalid_registry");
        var value: any;
        try {
            value = JSON.parse(raw);
        } catch (_) {
            fail("invalid_registry");
        }
        if (
            !keys(value, ["version", "revision", "entries"]) ||
            value.version !== 1 ||
            typeof value.revision !== "number" ||
            value.revision < 0 ||
            value.revision > 9007199254740991 ||
            Math.floor(value.revision) !== value.revision
        )
            fail("invalid_registry");
        return {
            raw: raw,
            value: {
                entries: entries(value.entries, true),
                revision: value.revision,
                version: 1,
            },
        };
    }
    function find(rows: any[], id: string): any {
        if (!uuid(id)) fail("invalid_id");
        for (var i = 0; i < rows.length; i++)
            if (rows[i].id === id) return rows[i];
        fail("missing_binding");
    }
    function requireCurrent(entry: any): void {
        if (!entry.binding) fail("unbound");
        var current = false;
        try {
            current =
                ports.current(publicEntry(entry), copy(entry.binding)) === true;
        } catch (_) {}
        if (!current) fail("stale_context");
    }
    function requireParent(rows: any[], entry: any): void {
        if (entry.kind === "source")
            requireCurrent(find(rows, entry.profile_id));
    }
    function freshId(rows: any[]): string {
        var id: string;
        try {
            id = ports.uuid();
        } catch (_) {
            fail("identity_unavailable");
        }
        if (!uuid(id)) fail("identity_unavailable");
        if (
            rows.some(function (entry) {
                return entry.id === id;
            })
        )
            fail("conflict");
        return id;
    }
    function mutate(
        expectedRevision: number,
        operation: (rows: any[]) => any,
        guard?: (written?: boolean) => void,
        persistent = false
    ): any {
        if (active) fail("busy");
        active = true;
        try {
            var before = read();
            if (
                typeof expectedRevision !== "number" ||
                expectedRevision !== before.value.revision
            )
                fail("registry_changed");
            if (persistent) {
                if (typeof ports.persistedRead !== "function")
                    fail("storage_unavailable");
                var physical: string | null;
                try {
                    physical = ports.persistedRead();
                } catch (_) {
                    fail("storage_unavailable");
                }
                if (physical !== before.raw) fail("registry_changed");
            }
            var rows = copy(before.value.entries);
            var result = operation(rows);
            rows = entries(rows, true);
            var latest: string | null;
            try {
                latest = ports.read();
            } catch (_) {
                fail("storage_unavailable");
            }
            if (latest !== before.raw) fail("registry_changed");
            if (guard) {
                guard();
                try {
                    latest = ports.read();
                    if (persistent && ports.persistedRead!() !== before.raw)
                        fail("registry_changed");
                } catch (error: any) {
                    if (error && error.code === "registry_changed") throw error;
                    fail("storage_unavailable");
                }
                if (latest !== before.raw) fail("registry_changed");
            }
            if (JSON.stringify(rows) === JSON.stringify(before.value.entries))
                return {
                    changed: false,
                    result: result,
                    revision: before.value.revision,
                };
            if (before.value.revision === 9007199254740991)
                fail("revision_exhausted");
            var next = {
                entries: rows,
                revision: before.value.revision + 1,
                version: 1,
            };
            var raw = JSON.stringify(next);
            if (!bounded(raw, maxBytes)) fail("limit_exceeded");
            var written: string;
            try {
                written = ports.compareAndSwap(before.raw, raw);
            } catch (_) {
                fail("outcome_unknown");
            }
            if (written === "conflict") fail("registry_changed");
            if (written !== "confirmed") fail("outcome_unknown");
            var actual: string | null;
            try {
                actual = persistent ? ports.persistedRead!() : ports.read();
                if (guard) {
                    guard(true);
                    if (ports.read() !== raw || ports.persistedRead!() !== raw)
                        fail("outcome_unknown");
                }
            } catch (_) {
                fail("outcome_unknown");
            }
            if (actual !== raw) fail("outcome_unknown");
            return { changed: true, result: result, revision: next.revision };
        } finally {
            active = false;
        }
    }
    return {
        bind: function (id: string, value: any, expectedRevision: number) {
            return mutate(expectedRevision, function (rows) {
                var entry = find(rows, id);
                entry.binding = binding(entry.kind, value);
                requireParent(rows, entry);
                requireCurrent(entry);
                return publicEntry(entry);
            });
        },
        copyProfile: function (
            id: string,
            targets: any,
            expectedRevision: number
        ) {
            return mutate(expectedRevision, function (rows) {
                var original = find(rows, id);
                if (
                    original.kind !== "profile" ||
                    !keys(targets, ["profile", "sources"]) ||
                    !Array.isArray(targets.sources)
                )
                    fail("invalid_binding");
                var sources = rows.filter(function (entry) {
                    return entry.kind === "source" && entry.profile_id === id;
                });
                if (
                    targets.sources.length !== sources.length ||
                    targets.sources.length > maxEntries
                )
                    fail("invalid_binding");
                var targetMap: any = Object.create(null);
                targets.sources.forEach(function (target: any) {
                    if (
                        !keys(target, ["id", "binding"]) ||
                        !uuid(target.id) ||
                        targetMap[target.id] ||
                        !sources.some(function (source) {
                            return source.id === target.id;
                        })
                    )
                        fail("invalid_binding");
                    targetMap[target.id] = target.binding;
                });
                var profile = {
                    binding: binding("profile", targets.profile),
                    id: freshId(rows),
                    kind: "profile",
                    provider: original.provider,
                };
                requireCurrent(profile);
                rows.push(profile);
                var copied = [publicEntry(profile)];
                sources.forEach(function (source) {
                    var next = {
                        binding: binding("source", targetMap[source.id]),
                        id: freshId(rows),
                        kind: "source",
                        profile_id: profile.id,
                        provider: source.provider,
                    };
                    requireCurrent(next);
                    rows.push(next);
                    copied.push(publicEntry(next));
                });
                return copied;
            });
        },
        create: function (value: any, expectedRevision: number) {
            return mutate(expectedRevision, function (rows) {
                if (
                    !keys(
                        value,
                        ["kind", "provider", "binding"],
                        ["profile_id"]
                    )
                )
                    fail("invalid_binding");
                var candidate = {
                    binding: value.binding,
                    id: freshId(rows),
                    kind: value.kind,
                    provider: value.provider,
                } as any;
                if (Object.prototype.hasOwnProperty.call(value, "profile_id"))
                    candidate.profile_id = value.profile_id;
                var entry = row(candidate, true);
                requireParent(rows, entry);
                requireCurrent(entry);
                rows.push(entry);
                return publicEntry(entry);
            });
        },
        importPublic: function (values: any, expectedRevision: number) {
            var incoming = entries(values, false, false);
            return mutate(expectedRevision, function (rows) {
                incoming.forEach(function (entry) {
                    var existing = rows.filter(function (value) {
                        return value.id === entry.id;
                    })[0];
                    if (existing) {
                        if (
                            JSON.stringify(publicEntry(existing)) !==
                            JSON.stringify(entry)
                        )
                            fail("conflict");
                    } else rows.push(entry);
                });
                return null;
            });
        },
        list: function () {
            var state = read().value;
            return {
                entries: state.entries.map(publicEntry),
                revision: state.revision,
                version: 1,
            };
        },
        lookup: function (id: string) {
            var state = read().value;
            return {
                entry: publicEntry(find(state.entries, id)),
                revision: state.revision,
            };
        },
        /** Internal UI pairing; both private rows share one registry CAS. No transfer wire route. */
        provisionPlayback: function (value: any, expectedRevision: number) {
            return mutate(
                expectedRevision,
                function (rows) {
                    if (
                        !keys(value, ["provider", "profile", "source"]) ||
                        !/^(m3u|vportal|plex|offline)$/.test(value.provider)
                    )
                        fail("invalid_binding");
                    var profileBinding = binding("profile", value.profile);
                    var sourceBinding = binding("source", value.source);
                    if (
                        profileBinding.selector.kind !==
                            "global-playback-target" ||
                        sourceBinding.selector.kind !== "global-playback-target"
                    )
                        fail("invalid_binding");
                    var profile = rows.filter(function (entry) {
                        return (
                            entry.kind === "profile" &&
                            entry.provider === value.provider &&
                            JSON.stringify(entry.binding) ===
                                JSON.stringify(profileBinding)
                        );
                    })[0];
                    if (!profile)
                        profile = {
                            id: freshId(rows),
                            kind: "profile",
                            provider: value.provider,
                            binding: profileBinding,
                        };
                    requireCurrent(profile);
                    if (rows.indexOf(profile) < 0) rows.push(profile);
                    var source = rows.filter(function (entry) {
                        return (
                            entry.kind === "source" &&
                            entry.provider === value.provider &&
                            entry.profile_id === profile.id &&
                            JSON.stringify(entry.binding) ===
                                JSON.stringify(sourceBinding)
                        );
                    })[0];
                    if (!source)
                        source = {
                            id: freshId(rows),
                            kind: "source",
                            provider: value.provider,
                            profile_id: profile.id,
                            binding: sourceBinding,
                        };
                    requireCurrent(source);
                    if (rows.indexOf(source) < 0) rows.push(source);
                    return {
                        profile: publicEntry(profile),
                        source: publicEntry(source),
                    };
                },
                undefined,
                true
            );
        },
        /** Separate bootstrap packet, not a favorites-transfer operation. */
        provisionPlex: function (value: any, expectedRevision: number) {
            var captured: any,
                profile: any,
                source: any,
                priorProfile: any,
                priorSource: any;
            function target(): any {
                var grant: any;
                try {
                    if (typeof ports.provisionTarget !== "function")
                        fail("target_unavailable");
                    grant = ports.provisionTarget(value.target_id);
                } catch (_) {
                    fail("target_unavailable");
                }
                if (
                    !keys(grant, [
                        "verified",
                        "provider",
                        "target_id",
                        "profile",
                        "source",
                    ]) ||
                    grant.verified !== true ||
                    grant.provider !== "plex" ||
                    grant.target_id !== value.target_id
                )
                    fail("target_unavailable");
                var result = {
                    profile: binding("profile", grant.profile),
                    source: binding("source", grant.source),
                };
                // Deliberately narrow first-scope policy, NOT authority by owner alone.
                if (result.profile.owner !== result.source.owner)
                    fail("parent_owner_mismatch");
                return result;
            }
            function guard(written = false): void {
                if (JSON.stringify(target()) !== JSON.stringify(captured))
                    fail("target_changed");
                requireCurrent(profile);
                requireCurrent(source);
                if (priorProfile && !written) {
                    requireCurrent(priorProfile);
                    requireCurrent(priorSource);
                }
            }
            return mutate(
                expectedRevision,
                function (rows) {
                    if (
                        !keys(
                            value,
                            ["mode", "target_id"],
                            value && value.mode === "create"
                                ? []
                                : value && value.mode === "replace-current"
                                  ? [
                                        "profile_id",
                                        "source_id",
                                        "prior_profile_id",
                                        "prior_source_id",
                                    ]
                                  : ["profile_id", "source_id"]
                        ) ||
                        ["create", "import", "pair", "replace-current"].indexOf(
                            value.mode
                        ) < 0 ||
                        typeof value.target_id !== "string" ||
                        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(
                            value.target_id
                        )
                    )
                        fail("invalid_provision");
                    if (
                        value.mode !== "create" &&
                        (!uuid(value.profile_id) ||
                            !uuid(value.source_id) ||
                            value.profile_id === value.source_id)
                    )
                        fail("invalid_provision");
                    captured = target();
                    if (value.mode === "replace-current") {
                        if (
                            !uuid(value.prior_profile_id) ||
                            !uuid(value.prior_source_id) ||
                            value.prior_profile_id === value.prior_source_id
                        )
                            fail("invalid_provision");
                        if (
                            [value.profile_id, value.source_id].some(
                                function (id) {
                                    return (
                                        id === value.prior_profile_id ||
                                        id === value.prior_source_id
                                    );
                                }
                            )
                        )
                            fail("conflict");
                        var previousProfile = find(
                                rows,
                                value.prior_profile_id
                            ),
                            previousSource = find(rows, value.prior_source_id);
                        if (
                            previousProfile.kind !== "profile" ||
                            previousProfile.provider !== "plex" ||
                            previousSource.kind !== "source" ||
                            previousSource.provider !== "plex" ||
                            previousSource.profile_id !== previousProfile.id
                        )
                            fail("conflict");
                        if (
                            !previousProfile.binding ||
                            !previousSource.binding ||
                            JSON.stringify(previousProfile.binding) !==
                                JSON.stringify(captured.profile) ||
                            JSON.stringify(previousSource.binding) !==
                                JSON.stringify(captured.source)
                        )
                            fail("prior_scope_mismatch");
                        if (
                            rows.some(function (entry) {
                                return (
                                    entry.kind === "source" &&
                                    entry.profile_id === previousProfile.id &&
                                    entry.id !== previousSource.id &&
                                    !!entry.binding
                                );
                            })
                        )
                            fail("bound_children");
                        priorProfile = copy(previousProfile);
                        priorSource = copy(previousSource);
                        requireCurrent(priorProfile);
                        requireCurrent(priorSource);
                        delete previousProfile.binding;
                        delete previousSource.binding;
                    }
                    var profileId =
                        value.mode === "create"
                            ? freshId(rows)
                            : value.profile_id;
                    profile = rows.filter(function (entry) {
                        return entry.id === profileId;
                    })[0];
                    if (!profile) {
                        if (value.mode === "pair") fail("missing_binding");
                        profile = {
                            id: profileId,
                            kind: "profile",
                            provider: "plex",
                        };
                        rows.push(profile);
                    }
                    if (
                        profile.kind !== "profile" ||
                        profile.provider !== "plex"
                    )
                        fail("conflict");
                    var sourceId =
                        value.mode === "create"
                            ? freshId(rows)
                            : value.source_id;
                    source = rows.filter(function (entry) {
                        return entry.id === sourceId;
                    })[0];
                    if (!source) {
                        if (value.mode === "pair") fail("missing_binding");
                        source = {
                            id: sourceId,
                            kind: "source",
                            profile_id: profile.id,
                            provider: "plex",
                        };
                        rows.push(source);
                    }
                    if (
                        source.kind !== "source" ||
                        source.provider !== "plex" ||
                        source.profile_id !== profile.id
                    )
                        fail("conflict");
                    if (
                        value.mode === "replace-current" &&
                        rows.some(function (entry) {
                            return (
                                entry.kind === "source" &&
                                entry.profile_id === profile.id &&
                                entry.id !== source.id &&
                                !!entry.binding
                            );
                        })
                    )
                        fail("bound_children");
                    [
                        [profile, captured.profile],
                        [source, captured.source],
                    ].forEach(function (pair) {
                        if (
                            pair[0].binding &&
                            JSON.stringify(pair[0].binding) !==
                                JSON.stringify(pair[1])
                        )
                            fail("already_bound");
                        pair[0].binding = copy(pair[1]);
                    });
                    guard();
                    return {
                        profile: publicEntry(profile),
                        source: publicEntry(source),
                        target_id: value.target_id,
                    };
                },
                guard,
                true
            );
        },
        resolve: function (id: string) {
            var before = read();
            var entry = find(before.value.entries, id);
            requireParent(before.value.entries, entry);
            requireCurrent(entry);
            var current: string | null;
            try {
                current = ports.read();
            } catch (_) {
                fail("storage_unavailable");
            }
            if (current !== before.raw) fail("registry_changed");
            return {
                binding: copy(entry.binding),
                entry: publicEntry(entry),
                revision: before.value.revision,
            };
        },
    };
}

(window as any).__ottFavoritesBindings = { create: createFavoritesBindings };
