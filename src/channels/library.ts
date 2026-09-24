/** Catalog and user edits have separate lifetimes. Views receive disposable projections. */
interface LibraryChannel {
    groupId: string;
    groupLabel: string;
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
}
interface LibraryDocument {
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
    var items: Record<string, { id: number }> = Object.create(null);
    var ids: Record<string, string> = Object.create(null);
    var aliases: Record<string, string | null> = Object.create(null);
    var provider: LibraryGroup[] = [];
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
        var group = groupById(provider, row.groupId);
        if (!group) {
            group = { id: row.groupId, label: row.groupLabel, members: [] };
            provider.push(group);
        }
        group.members.push(row.itemId);
    });
    provider.unshift({
        id: "system:all",
        label: "",
        members: catalog.map(function (row) {
            return row.itemId;
        }),
    });
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
    function unique(value: any): string[] {
        var seen: Record<string, boolean> = Object.create(null);
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
    function empty(): LibraryDocument {
        return {
            groups: [],
            hidden: [],
            locks: catalog
                .filter(function (row) {
                    return row.locked;
                })
                .map(function (row) {
                    return row.itemId;
                }),
            nextGroup: 1,
            preferences: {},
            selected: null,
            sourceId: ports.sourceId,
            unlocks: [],
            version: 1,
        };
    }
    function decode(value: any): LibraryDocument | null {
        if (
            !value ||
            value.version !== 1 ||
            value.sourceId !== ports.sourceId ||
            !Array.isArray(value.groups) ||
            !Array.isArray(value.hidden) ||
            !Array.isArray(value.locks) ||
            !value.preferences ||
            typeof value.preferences !== "object"
        )
            return null;
        var result = empty();
        var seen: Record<string, boolean> = Object.create(null);
        value.groups.forEach(function (group: any) {
            if (
                !group ||
                typeof group.id !== "string" ||
                typeof group.label !== "string" ||
                seen[group.id]
            )
                return;
            seen[group.id] = true;
            result.groups.push({
                id: group.id,
                inheritsMembers: group.inheritsMembers === true,
                known: unique(group.known),
                label: group.label,
                members: unique(group.members),
            });
        });
        result.hidden = unique(value.hidden);
        result.unlocks = unique(value.unlocks);
        result.locks = unique(value.locks.concat(result.locks)).filter(
            function (id) {
                return result.unlocks.indexOf(id) < 0;
            }
        );
        ["aspect", "audio", "subtitle", "zoom"].forEach(function (kind) {
            var source = value.preferences[kind];
            var target: Record<string, number> = Object.create(null);
            if (source && typeof source === "object")
                Object.keys(source).forEach(function (id) {
                    if (typeof source[id] === "number" && isFinite(source[id]))
                        target[id] = source[id];
                });
            result.preferences[kind] = target;
        });
        if (
            value.selected &&
            typeof value.selected.groupId === "string" &&
            typeof value.selected.itemId === "string"
        )
            result.selected = clone(value.selected);
        if (Number.isInteger(value.nextGroup) && value.nextGroup > 0)
            result.nextGroup = value.nextGroup;
        return result;
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
            state.unlocks = catalog
                .filter(function (row) {
                    return row.locked && state!.locks.indexOf(row.itemId) < 0;
                })
                .map(function (row) {
                    return row.itemId;
                });
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
    state.locks = unique(state.locks.map(resolve)).filter(function (id) {
        return state!.unlocks.indexOf(id) < 0;
    });
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
        var result = state!.groups.map(function (group) {
            var live = groupById(provider, group.id);
            return {
                id: group.id,
                label: live && group.label === "" ? live.label : group.label,
                members: (live && group.inheritsMembers
                    ? live.members
                    : group.members.concat(
                          live
                              ? live.members.filter(function (id) {
                                    return (
                                        !!group.known &&
                                        group.known.indexOf(id) < 0 &&
                                        group.members.indexOf(id) < 0
                                    );
                                })
                              : []
                      )
                ).map(resolve),
            };
        });
        provider.forEach(function (group) {
            if (
                state!.hidden.indexOf(group.id) < 0 &&
                !result.some(function (value) {
                    return value.id === group.id;
                })
            )
                result.push(clone(group));
        });
        return result.filter(function (group) {
            return state!.hidden.indexOf(group.id) < 0;
        });
    }
    function commit(change: (draft: LibraryDocument) => void): boolean {
        if (!writable || readFailed || !ports.current()) return false;
        var draft = clone(state!);
        change(draft);
        var text = JSON.stringify(draft);
        try {
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
            if (prior !== text) ports.set(key, text);
            if (!ports.current() || ports.get(key) !== text || !ports.current())
                return false;
            state = draft;
            return true;
        } catch (_) {
            return false;
        }
    }
    function numeric(members: string[]): number[] {
        return members
            .filter(function (id) {
                return !!items[id];
            })
            .map(function (id) {
                return items[id].id;
            });
    }
    function editGroup(
        draft: LibraryDocument,
        id: string
    ): LibraryGroup | undefined {
        var group = groupById(draft.groups, id);
        if (!group) {
            var live = groupById(groups(), id);
            if (live) {
                group = clone(live);
                if (
                    provider.some(function (value) {
                        return value.id === id;
                    })
                )
                    group.label = "";
                group.inheritsMembers = provider.some(function (value) {
                    return value.id === id;
                });
                draft.groups.push(group);
            }
        }
        return group;
    }
    return {
        active: ports.current,
        changeMember: function (
            groupId: string,
            channelId: number,
            action: "add" | "remove" | "move",
            delta?: number
        ): boolean {
            var id = ids[String(channelId)];
            if (!id) return false;
            return commit(function (draft) {
                var group = editGroup(draft, groupId);
                if (!group) return;
                var visible = groupById(groups(), groupId);
                if (visible) group.members = visible.members.slice();
                var live = groupById(provider, groupId);
                group.inheritsMembers = false;
                group.known = unique(
                    (group.known || []).concat(live ? live.members : [])
                );
                var at = group.members.indexOf(id);
                if (action === "add" && at < 0) group.members.push(id);
                if (action === "remove" && at >= 0) group.members.splice(at, 1);
                if (action === "move" && at >= 0) {
                    group.members.splice(at, 1);
                    group.members.splice(
                        (at + (delta || 0) + group.members.length + 1) %
                            (group.members.length + 1),
                        0,
                        id
                    );
                }
            });
        },
        createGroup: function (label: string, copy?: string): string | null {
            label = label.trim();
            if (
                !label ||
                groups().some(function (group) {
                    return group.label === label;
                })
            )
                return null;
            var id = "user:" + state!.nextGroup;
            return commit(function (draft) {
                var original = groupById(groups(), copy!);
                draft.nextGroup++;
                draft.groups.push({
                    id: id,
                    label: label,
                    members: original ? original.members.slice() : [],
                });
            })
                ? id
                : null;
        },
        itemId: function (id: number): string | null {
            return ids[String(id)] || null;
        },
        lock: function (channelId: number, locked: boolean): boolean {
            var id = ids[String(channelId)];
            if (!id) return false;
            return commit(function (draft) {
                draft.locks = draft.locks.filter(function (value) {
                    return value !== id;
                });
                draft.unlocks = draft.unlocks.filter(function (value) {
                    return value !== id;
                });
                if (locked) draft.locks.push(id);
                else draft.unlocks.push(id);
            });
        },
        moveGroup: function (id: string, delta: number): boolean {
            if (id.indexOf("system:") === 0) return false;
            var ordered = groups().filter(function (group) {
                return group.id.indexOf("system:") !== 0;
            });
            var at = ordered
                .map(function (group) {
                    return group.id;
                })
                .indexOf(id);
            if (at < 0 || !ordered.length) return false;
            var item = ordered.splice(at, 1)[0];
            ordered.splice(
                (at + delta + ordered.length + 1) % (ordered.length + 1),
                0,
                item
            );
            return commit(function (draft) {
                draft.groups = ordered.map(function (group) {
                    var stored = groupById(draft.groups, group.id);
                    return {
                        id: group.id,
                        inheritsMembers: stored ? stored.inheritsMembers : true,
                        known: stored && stored.known,
                        label: stored ? stored.label : "",
                        members: group.members,
                    };
                });
            });
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
            if (id.indexOf("system:") === 0) return false;
            return commit(function (draft) {
                draft.groups = draft.groups.filter(function (group) {
                    return group.id !== id;
                });
                draft.hidden.push(id);
            });
        },
        renameGroup: function (id: string, label: string): boolean {
            if (id.indexOf("system:") === 0) return false;
            label = label.trim();
            if (
                !label ||
                groups().some(function (group) {
                    return group.id !== id && group.label === label;
                })
            )
                return false;
            return commit(function (draft) {
                var group = editGroup(draft, id);
                if (group) group.label = label;
            });
        },
        select: function (groupId: string, channelId: number): boolean {
            var id = ids[String(channelId)];
            if (!id) return false;
            if (
                state!.selected &&
                state!.selected.groupId === groupId &&
                state!.selected.itemId === id
            )
                return true;
            return commit(function (draft) {
                draft.selected = { groupId: groupId, itemId: id };
            });
        },
        setPreference: function (
            kind: string,
            channelId: number | null,
            value: number | null | undefined
        ): boolean {
            var id = channelId === null ? "media" : ids[String(channelId)];
            if (
                !id ||
                ["aspect", "audio", "subtitle", "zoom"].indexOf(kind) < 0 ||
                (value != null && !isFinite(value))
            )
                return false;
            return commit(function (draft) {
                var prefs =
                    draft.preferences[kind] || (draft.preferences[kind] = {});
                if (value == null) delete prefs[id!];
                else prefs[id!] = value;
            });
        },
        snapshot: function () {
            return {
                all: numeric(
                    (
                        groups().filter(function (group) {
                            return group.id === "system:all";
                        })[0] || { members: [] }
                    ).members
                ),
                groups: groups()
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
