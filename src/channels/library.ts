/** Catalog and user edits have separate lifetimes. Views receive disposable projections. */
interface LibraryChannel {
    groupId: string;
    groupLabel: string;
    groups?: Array<{ id: string; label: string }>;
    id: number;
    itemId: string;
    label: string;
    legacyId?: number;
    locked?: boolean;
}
interface LibraryGroup {
    id: string;
    inheritsMembers?: boolean;
    known?: string[];
    label: string;
    members: string[];
    shuffleBefore?: string[];
}
interface LibraryDocument {
    browsedGroup?: string;
    groups: LibraryGroup[];
    hidden: string[];
    locks: string[];
    nextGroup: number;
    preferences: Record<string, Record<string, number>>;
    selected: { groupId: string; itemId: string } | null;
    sourceId: string;
    unlocks: string[];
    version: 1;
}
interface ChannelLibraryPorts {
    current(): boolean;
    get(key: string): string | null;
    getPersisted?(key: string): string | null;
    legacySelection?: {
        category: number;
        index: number;
        favorites: number[] | null;
        virtualLabels: string[];
    };
    set(key: string, value: string): void;
    sourceId: string;
}

function createChannelLibrary(
    ports: ChannelLibraryPorts,
    catalog: LibraryChannel[]
) {
    var key = "channelLibrary:" + ports.sourceId;
    var libraryCore = (window as any).OttPlayCore;
    if (!libraryCore || libraryCore.classicChannelLibraryApiVersion() !== 1)
        throw new Error("Classic channel library core API is unavailable");
    var items: Record<string, { id: number }> = Object.create(null);
    var ids: Record<string, string> = Object.create(null);
    var aliases: Record<string, string | null> = Object.create(null);
    var provider: LibraryGroup[] = [];
    var providerById: Record<string, LibraryGroup> = Object.create(null);
    var providerMembers: Record<
        string,
        Record<string, boolean>
    > = Object.create(null);
    var writable = true;
    var readFailed = false;
    function raw(name: string): string | null {
        try {
            return ports.get(name);
        } catch (_) {
            readFailed = true;
            return null;
        }
    }
    function addProviderMemberships(row: LibraryChannel): void {
        var memberships =
            row.groups && row.groups.length
                ? row.groups
                : [{ id: row.groupId, label: row.groupLabel }];
        var seen: Record<string, boolean> = Object.create(null);
        memberships.forEach(function (membership) {
            if (
                !membership ||
                typeof membership.id !== "string" ||
                (row.groups &&
                    (!membership.id ||
                        membership.id.indexOf("system:") === 0)) ||
                typeof membership.label !== "string" ||
                seen[membership.id]
            )
                return;
            seen[membership.id] = true;
            var group = providerById[membership.id];
            if (!group) {
                group = {
                    id: membership.id,
                    label: membership.label,
                    members: [],
                };
                providerById[membership.id] = group;
                providerMembers[membership.id] = Object.create(null);
                provider.push(group);
            }
            if (!providerMembers[membership.id][row.itemId]) {
                providerMembers[membership.id][row.itemId] = true;
                group.members.push(row.itemId);
            }
        });
    }
    catalog.forEach(function (row) {
        if (items[row.itemId]) return;
        items[row.itemId] = { id: row.id };
        ids[String(row.id)] = row.itemId;
        if (row.legacyId !== undefined) {
            var alias = String(row.legacyId);
            aliases[alias] =
                aliases[alias] === undefined || aliases[alias] === row.itemId
                    ? row.itemId
                    : null;
        }
        addProviderMemberships(row);
    });
    provider.unshift({
        id: "system:all",
        label: "",
        members: catalog.map(function (row) {
            return row.itemId;
        }),
    });
    providerById["system:all"] = provider[0];
    function groupById(
        values: LibraryGroup[],
        id: string
    ): LibraryGroup | undefined {
        for (var i = 0; i < values.length; i++)
            if (values[i].id === id) return values[i];
        return undefined;
    }
    function clone<T>(value: T): T {
        return JSON.parse(JSON.stringify(value));
    }
    function unique(value: any, excluded?: string[]): string[] {
        var seen: Record<string, boolean> = Object.create(null);
        if (excluded)
            excluded.forEach(function (id) {
                seen[id] = true;
            });
        return Array.isArray(value)
            ? value.filter(function (id) {
                  if (typeof id !== "string" || seen[id]) return false;
                  seen[id] = true;
                  return true;
              })
            : [];
    }
    function read(name: string): any {
        try {
            return JSON.parse(raw(name) || "null");
        } catch (_) {
            return null;
        }
    }
    function translateIds(values: any): string[] {
        return unique(
            Array.isArray(values)
                ? values.map(function (id) {
                      return resolve("unresolved:" + String(id));
                  })
                : []
        );
    }
    function resolve(id: string): string {
        if (id.indexOf("unresolved:") !== 0) return id;
        var previous = id.slice(11);
        var current = ids[previous];
        var alias = aliases[previous];
        // Old storage may already contain migrated numbers; neither namespace wins a collision.
        if (alias === null || (alias && current && alias !== current))
            return id;
        return alias || current || id;
    }
    function catalogLocks(): string[] {
        return catalog
            .filter(function (row) {
                return row.locked;
            })
            .map(function (row) {
                return row.itemId;
            });
    }
    function empty(): LibraryDocument {
        return libraryCore.classicChannelLibraryEmpty(
            ports.sourceId,
            catalogLocks()
        );
    }
    function decode(value: any): LibraryDocument | null {
        return libraryCore.classicChannelLibraryDecode(
            value,
            ports.sourceId,
            catalogLocks()
        );
    }
    var stored = raw(key);
    var state = stored ? decode(read(key)) : null;
    if (!state) {
        state = empty();
        writable = !stored;
        var claim = raw("channelLibrarySource");
        if (writable && (!claim || claim === ports.sourceId)) {
            var oldGroups = read("cats");
            var order = read("catsArray");
            var selection = ports.legacySelection;
            var virtual = ["All", "Favorites", "Все", "Усе"].concat(
                selection ? selection.virtualLabels : []
            );
            if (oldGroups && Array.isArray(order))
                order.forEach(function (name) {
                    if (
                        typeof name !== "string" ||
                        virtual.indexOf(name) >= 0 ||
                        !Array.isArray(oldGroups[name])
                    )
                        return;
                    var known = provider.filter(function (group) {
                        return group.label === name;
                    });
                    state!.groups.push({
                        id:
                            known.length === 1
                                ? known[0].id
                                : "user:" + state!.nextGroup++,
                        inheritsMembers:
                            known.length === 1 &&
                            JSON.stringify(translateIds(oldGroups[name])) ===
                                JSON.stringify(known[0].members),
                        known:
                            known.length === 1 ? known[0].members.slice() : [],
                        label: known.length === 1 ? "" : name,
                        members: translateIds(oldGroups[name]),
                    });
                });
            var oldOrder = Array.isArray(order)
                ? order.filter(function (name) {
                      return virtual.indexOf(name) < 0;
                  })
                : [];
            if (!oldOrder.length)
                oldOrder = provider.slice(1).map(function (group) {
                    return group.label;
                });
            oldOrder.unshift("All");
            if (selection && selection.favorites) oldOrder.unshift("Favorites");
            var storedCategory = read("catIndex");
            var storedIndex = read("primaryIndex");
            var oldCategory =
                oldOrder[
                    Number(
                        storedCategory === null && selection
                            ? selection.category
                            : storedCategory
                    ) || 0
                ];
            var oldIndex =
                Number(
                    storedIndex === null && selection
                        ? selection.index
                        : storedIndex
                ) || 0;
            var oldMembers =
                oldCategory === "All"
                    ? provider[0].members
                    : oldCategory === "Favorites" && selection
                      ? translateIds(selection.favorites)
                      : oldGroups && Array.isArray(oldGroups[oldCategory])
                        ? translateIds(oldGroups[oldCategory])
                        : (
                              provider.filter(function (group) {
                                  return group.label === oldCategory;
                              })[0] || { members: [] }
                          ).members;
            var oldMember = oldMembers[oldIndex];
            var oldGroup = state.groups.filter(function (group) {
                return (
                    group.label === oldCategory ||
                    provider.some(function (live) {
                        return (
                            live.id === group.id && live.label === oldCategory
                        );
                    })
                );
            })[0];
            if (oldMember)
                state.selected = {
                    groupId: oldGroup
                        ? oldGroup.id
                        : oldCategory === "Favorites"
                          ? "system:favorites"
                          : (
                                provider.filter(function (group) {
                                    return group.label === oldCategory;
                                })[0] || { id: "system:all" }
                            ).id,
                    itemId: oldMember,
                };
            var priorLocks = read("parentalArray");
            state.locks =
                Array.isArray(priorLocks) && priorLocks.length
                    ? translateIds(priorLocks)
                    : catalog
                          .filter(function (row) {
                              return row.locked;
                          })
                          .map(function (row) {
                              return row.itemId;
                          });
            var locked: Record<string, boolean> | null = Object.create(null);
            state.locks.forEach(function (id) {
                locked![id] = true;
            });
            state.unlocks = catalog
                .filter(function (row) {
                    return row.locked && !locked![row.itemId];
                })
                .map(function (row) {
                    return row.itemId;
                });
            // Returned methods share this scope; release the temporary index.
            locked = null;
            [
                ["aAspects", "aspect"],
                ["aAudios", "audio"],
                ["aSubs", "subtitle"],
                ["aZooms", "zoom"],
            ].forEach(function (mapping) {
                var old = read(mapping[0]);
                var pref: Record<string, number> = Object.create(null);
                if (old && typeof old === "object")
                    Object.keys(old).forEach(function (id) {
                        if (typeof old[id] === "number" && isFinite(old[id]))
                            pref[
                                id === "-1media"
                                    ? "media"
                                    : resolve("unresolved:" + id)
                            ] = old[id];
                    });
                state!.preferences[mapping[1]] = pref;
            });
        }
    }
    state.unlocks = unique(state.unlocks.map(resolve));
    state.locks = unique(state.locks.map(resolve), state.unlocks);
    Object.keys(state.preferences).forEach(function (kind) {
        var preferences = state!.preferences[kind];
        Object.keys(preferences).forEach(function (id) {
            var resolved = resolve(id);
            if (resolved !== id) {
                if (preferences[resolved] === undefined)
                    preferences[resolved] = preferences[id];
                delete preferences[id];
            }
        });
    });
    if (state.selected) state.selected.itemId = resolve(state.selected.itemId);
    // Unedited provider groups follow new catalog names and membership. User copies remain independent.
    function groups(): LibraryGroup[] {
        return libraryCore.classicChannelLibraryGroups(
            state!,
            provider,
            resolve
        );
    }
    function metadata(text: string | null): string | null {
        if (text === null) return null;
        var value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value))
            return null;
        // Local playback and preview can shadow the selected cursor. Every
        // other field must still match the physical document after saving.
        delete value.selected;
        return JSON.stringify(value);
    }
    function commit(
        change: (draft: LibraryDocument) => void,
        durable = false
    ): boolean {
        if (!writable || readFailed || !ports.current()) return false;
        var draft = clone(state!);
        change(draft);
        var text = JSON.stringify(draft);
        try {
            var expectedMetadata = durable ? metadata(text) : null;
            var prior = ports.get(key);
            if (!ports.current()) return false;
            var claim = ports.get("channelLibrarySource");
            if (!ports.current()) return false;
            // Reserve the one-time import before saving its source document.
            if (!claim) {
                ports.set("channelLibrarySource", ports.sourceId);
                if (
                    !ports.current() ||
                    ports.get("channelLibrarySource") !== ports.sourceId ||
                    !ports.current()
                )
                    return false;
            }
            if (
                prior !== text ||
                (durable &&
                    ports.getPersisted &&
                    metadata(ports.getPersisted(key)) !== expectedMetadata)
            )
                ports.set(key, text);
            if (!ports.current() || ports.get(key) !== text || !ports.current())
                return false;
            if (
                durable &&
                (!ports.getPersisted ||
                    metadata(ports.getPersisted(key)) !== expectedMetadata ||
                    !ports.current())
            )
                return false;
            state = draft;
            return true;
        } catch (_) {
            return false;
        }
    }
    function numeric(members: string[]): number[] {
        var result: number[] = [];
        members.forEach(function (id) {
            if (items[id]) result.push(items[id].id);
        });
        return result;
    }
    function libraryProvider(request: any): LibraryGroup[] {
        // Core owns action dependencies. Do not re-serialize the full catalogue
        // for an action whose admission and reduction are catalogue-independent.
        return libraryCore.classicChannelLibraryNeedsProviderContext(request)
            ? provider
            : [];
    }
    function reduceLibraryDraft(draft: LibraryDocument, request: any): void {
        var next = libraryCore.classicChannelLibraryReduce(
            draft,
            libraryProvider(request),
            request,
            resolve,
            Math.random
        );
        Object.keys(draft).forEach(function (field) {
            delete (draft as any)[field];
        });
        Object.keys(next).forEach(function (field) {
            (draft as any)[field] = next[field];
        });
    }
    function libraryAction(request: any, durable = false): any {
        request.version = 1;
        var decision = libraryCore.classicChannelLibraryDecision(
            state!,
            libraryProvider(request),
            request,
            resolve
        );
        if (!decision.accepted)
            return request.action === "create" ? null : false;
        if (!decision.commit) return decision.result;
        return commit(function (draft) {
            reduceLibraryDraft(draft, request);
        }, durable)
            ? decision.result
            : request.action === "create"
              ? null
              : false;
    }
    return {
        active: ports.current,
        adoptPlaybackOrder: function (order: Array<string | number>): boolean {
            return libraryAction({
                action: "adoptOrder",
                order: order.map(function (id) {
                    return ids[String(id)];
                }),
            });
        },
        append: function (rows: LibraryChannel[]): void {
            if (!ports.current()) return;
            var addedLocks: string[] = [];
            rows.forEach(function (row) {
                if (row.locked) addedLocks.push(row.itemId);
                if (items[row.itemId]) {
                    addProviderMemberships(row);
                    return;
                }
                catalog.push(row);
                items[row.itemId] = { id: row.id };
                ids[String(row.id)] = row.itemId;
                addProviderMemberships(row);
                providerById["system:all"].members.push(row.itemId);
            });
            if (addedLocks.length)
                state!.locks = libraryCore.classicChannelLibraryAddedLocks(
                    state!.locks,
                    addedLocks,
                    state!.unlocks
                );
        },
        browse: function (groupId: string, durable = false): boolean {
            if (!ports.current()) return false;
            var request = {
                action: "browse",
                durable: durable,
                groupId: groupId,
                version: 1,
            };
            var decision = libraryCore.classicChannelLibraryDecision(
                state!,
                libraryProvider(request),
                request,
                resolve
            );
            if (!decision.accepted) return false;
            if (!decision.commit) return decision.result;
            function change(draft: LibraryDocument): void {
                reduceLibraryDraft(draft, request);
            }
            if (!durable) return commit(change);
            var before = state;
            var prior: string | null = null;
            var written: string | null = null;
            try {
                prior = ports.get(key);
                var persisted = ports.getPersisted?.(key);
                if (
                    prior === null ||
                    persisted === undefined ||
                    metadata(prior) === null ||
                    metadata(prior) !== metadata(persisted) ||
                    !ports.current()
                )
                    return false;
                var draft = clone(state!);
                change(draft);
                written = JSON.stringify(draft);
                if (!commit(change)) throw new Error("Category was not saved");
                if (
                    metadata(ports.getPersisted!(key)) === metadata(written) &&
                    ports.current()
                )
                    return true;
            } catch (_) {}
            // Restore both the live model and a session-memory fallback;
            // never overwrite a replacement source or a concurrent edit.
            if (ports.current()) {
                state = before;
                try {
                    if (
                        prior !== null &&
                        written !== null &&
                        ports.get(key) === written
                    )
                        ports.set(key, prior);
                } catch (_) {}
            }
            return false;
        },
        browsedGroup: function (): string | null {
            return ports.current() ? state!.browsedGroup || null : null;
        },
        changeMember: function (
            groupId: string,
            channelId: number,
            action: "add" | "remove" | "move",
            delta?: number
        ): boolean {
            return libraryAction({
                action: "member",
                delta: delta,
                groupId: groupId,
                itemId: ids[String(channelId)],
                memberAction: action,
            });
        },
        createGroup: function (label: string, copy?: string): string | null {
            return libraryAction({
                action: "create",
                copyId: copy,
                label: label,
            });
        },
        document: function (): LibraryDocument {
            if (!writable || readFailed || !ports.current())
                throw new Error("Channel library is unavailable for backup");
            return clone(state!);
        },
        isShuffled: function (groupId: string): boolean {
            var group = groupById(state!.groups, groupId);
            return !!(group && group.shuffleBefore);
        },
        itemId: function (id: number): string | null {
            return ids[String(id)] || null;
        },
        lock: function (channelId: number, locked: boolean): boolean {
            return libraryAction({
                action: "lock",
                itemId: ids[String(channelId)],
                locked: locked,
            });
        },
        moveGroup: function (id: string, delta: number): boolean {
            return libraryAction({ action: "move", delta: delta, groupId: id });
        },
        persist: function () {
            return commit(function () {});
        },
        preference: function (
            kind: string,
            channelId: number | null
        ): number | undefined {
            var id = channelId === null ? "media" : ids[String(channelId)];
            return id && state!.preferences[kind]
                ? state!.preferences[kind][id]
                : undefined;
        },
        removeGroup: function (id: string): boolean {
            return libraryAction({ action: "remove", groupId: id });
        },
        renameGroup: function (id: string, label: string): boolean {
            return libraryAction({
                action: "rename",
                groupId: id,
                label: label,
            });
        },
        resetShuffle: function (groupId: string): boolean {
            return libraryAction({ action: "resetShuffle", groupId: groupId });
        },
        savedPreference: function (
            kind: string,
            channelId: number | null
        ): number | undefined {
            if (!ports.current() || !ports.getPersisted) return undefined;
            var id = channelId === null ? "media" : ids[String(channelId)];
            if (!id) return undefined;
            try {
                var saved = decode(
                    JSON.parse(ports.getPersisted(key) || "null")
                );
                return ports.current() && saved && saved.preferences[kind]
                    ? saved.preferences[kind][id]
                    : undefined;
            } catch (_) {
                return undefined;
            }
        },
        select: function (groupId: string, channelId: number): boolean {
            return libraryAction({
                action: "select",
                groupId: groupId,
                itemId: ids[String(channelId)],
            });
        },
        setPreference: function (
            kind: string,
            channelId: number | null,
            value: number | null | undefined,
            durable = false
        ): boolean {
            return libraryAction(
                {
                    action: "preference",
                    itemId:
                        channelId === null ? "media" : ids[String(channelId)],
                    kind: kind,
                    value: value,
                },
                durable
            );
        },
        shuffleGroup: function (groupId: string): boolean {
            return libraryAction({ action: "shuffle", groupId: groupId });
        },
        snapshot: function () {
            var visible = groups();
            return {
                all: numeric(
                    (groupById(visible, "system:all") || { members: [] })
                        .members
                ),
                groups: visible
                    .filter(function (group) {
                        return group.id !== "system:all";
                    })
                    .map(function (group) {
                        return {
                            id: group.id,
                            label: group.label,
                            members: numeric(group.members),
                        };
                    }),
                locks: numeric(state!.locks),
                selected: clone(state!.selected),
            };
        },
        sourceId: ports.sourceId,
    };
}

(window as any).__ottChannelLibrary = { create: createChannelLibrary };
