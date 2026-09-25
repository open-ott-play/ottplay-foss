/** Portable library documents. Storage, source selection and confirmation belong to the host. */
function createLibraryBackupCodec() {
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
                return (
                    value[key] !== undefined &&
                    (required.indexOf(key) >= 0 || optional.indexOf(key) >= 0)
                );
            })
        );
    }
    function name(value: string): boolean {
        return (
            value !== "__proto__" &&
            value !== "prototype" &&
            value !== "constructor"
        );
    }
    function text(value: any, empty = false): boolean {
        return (
            typeof value === "string" &&
            value.length <= 4096 &&
            (empty || value.length > 0) &&
            !/[\u0000-\u001f]/.test(value)
        );
    }
    function finite(value: any): boolean {
        return typeof value === "number" && isFinite(value);
    }
    function array(
        value: any,
        check: (item: any) => boolean,
        limit = 50000
    ): boolean {
        if (
            !Array.isArray(value) ||
            value.length > limit ||
            Object.keys(value).length !== value.length
        )
            return false;
        for (var i = 0; i < value.length; i++)
            if (
                !Object.prototype.hasOwnProperty.call(value, i) ||
                !check(value[i])
            )
                return false;
        return true;
    }
    function strings(value: any): boolean {
        var seen: Record<string, boolean> = Object.create(null);
        return array(value, function (item) {
            if (!text(item) || seen[item]) return false;
            seen[item] = true;
            return true;
        });
    }
    function dictionary(
        value: any,
        check: (item: any) => boolean,
        limit = 50000
    ): boolean {
        return (
            object(value) &&
            Object.keys(value).length <= limit &&
            Object.keys(value).every(function (key) {
                return name(key) && text(key) && check(value[key]);
            })
        );
    }
    function reference(value: any): boolean {
        if (keys(value, ["itemId"])) return text(value.itemId);
        return (
            keys(value, ["legacyId", "origin"], ["ambiguous"]) &&
            (text(value.legacyId) || finite(value.legacyId)) &&
            (value.origin === "raw" || value.origin === "canonical") &&
            (value.ambiguous === undefined ||
                typeof value.ambiguous === "boolean")
        );
    }
    function channels(value: any, source: string): boolean {
        if (value === null) return true;
        var ids: Record<string, boolean> = Object.create(null);
        return (
            keys(value, [
                "version",
                "sourceId",
                "groups",
                "hidden",
                "locks",
                "unlocks",
                "nextGroup",
                "preferences",
                "selected",
            ]) &&
            value.version === 1 &&
            value.sourceId === source &&
            array(
                value.groups,
                function (group) {
                    if (
                        !keys(
                            group,
                            ["id", "label", "members"],
                            ["known", "inheritsMembers"]
                        ) ||
                        !text(group.id) ||
                        ids[group.id] ||
                        !text(group.label, true) ||
                        !strings(group.members) ||
                        (group.known !== undefined && !strings(group.known)) ||
                        (group.inheritsMembers !== undefined &&
                            typeof group.inheritsMembers !== "boolean")
                    )
                        return false;
                    ids[group.id] = true;
                    return true;
                },
                1000
            ) &&
            strings(value.hidden) &&
            strings(value.locks) &&
            strings(value.unlocks) &&
            value.locks.every(function (id: string) {
                return value.unlocks.indexOf(id) < 0;
            }) &&
            finite(value.nextGroup) &&
            value.nextGroup > 0 &&
            Math.floor(value.nextGroup) === value.nextGroup &&
            value.nextGroup <= 9007199254740991 &&
            keys(
                value.preferences,
                [],
                ["aspect", "audio", "subtitle", "zoom"]
            ) &&
            Object.keys(value.preferences).every(function (kind) {
                return dictionary(value.preferences[kind], finite);
            }) &&
            (value.selected === null ||
                (keys(value.selected, ["groupId", "itemId"]) &&
                    text(value.selected.groupId) &&
                    text(value.selected.itemId)))
        );
    }
    function favorites(value: any, source: string): boolean {
        if (value === null) return true;
        if (
            !keys(value, ["version", "sourceId", "lists"]) ||
            value.version !== 2 ||
            value.sourceId !== source ||
            !keys(value.lists, ["v", "active", "lists", "order"]) ||
            value.lists.v !== 1 ||
            !text(value.lists.active) ||
            !name(value.lists.active) ||
            !dictionary(
                value.lists.lists,
                function (rows) {
                    return array(rows, reference);
                },
                1000
            ) ||
            !Object.prototype.hasOwnProperty.call(
                value.lists.lists,
                value.lists.active
            ) ||
            !strings(value.lists.order) ||
            value.lists.order.length > 1000
        )
            return false;
        return value.lists.order.every(function (key: string) {
            return Object.prototype.hasOwnProperty.call(value.lists.lists, key);
        });
    }
    function validate(value: any, source: string): boolean {
        try {
            return (
                text(source) &&
                keys(value, ["sourceId", "channels", "favorites"]) &&
                value.sourceId === source &&
                channels(value.channels, source) &&
                favorites(value.favorites, source)
            );
        } catch (_) {
            return false;
        }
    }
    function legacy(
        source: string,
        locked: any[],
        selected: any[],
        catalog: any,
        aliases: any,
        current: any,
        referenceFactory: (catalog: any, aliases: any) => any
    ): any {
        if (
            !validate(current, source) ||
            !array(locked, function (value) {
                return text(value) || finite(value);
            }) ||
            !array(selected, function (value) {
                return text(value) || finite(value);
            })
        )
            throw new Error("Invalid legacy library backup");
        var result = JSON.parse(JSON.stringify(current));
        var codec = referenceFactory(catalog, aliases);
        var channel = result.channels || {
            groups: [],
            hidden: [],
            locks: [],
            nextGroup: 1,
            preferences: {},
            selected: null,
            sourceId: source,
            unlocks: [],
            version: 1,
        };
        var locks: string[] = [];
        locked.forEach(function (value) {
            var ref = codec.resolve(value, "raw");
            var id =
                ref.itemId ||
                (ref.ambiguous ? "ambiguous:" : "unresolved:") +
                    String(ref.legacyId);
            if (locks.indexOf(id) < 0) locks.push(id);
        });
        channel.locks = locks;
        channel.unlocks = [];
        Object.keys(catalog || {}).forEach(function (key) {
            var ref = codec.resolve(key, "canonical");
            if (
                ref.itemId &&
                locks.indexOf(ref.itemId) < 0 &&
                channel.unlocks.indexOf(ref.itemId) < 0
            )
                channel.unlocks.push(ref.itemId);
        });
        result.channels = channel;
        var favorite = result.favorites || {
            lists: {
                active: "Favorites",
                lists: { Favorites: [] },
                order: ["Favorites"],
                v: 1,
            },
            sourceId: source,
            version: 2,
        };
        favorite.lists.lists[favorite.lists.active] = selected.map(
            function (value) {
                return codec.resolve(value, "raw");
            }
        );
        result.favorites = favorite;
        if (!validate(result, source))
            throw new Error("Invalid migrated library backup");
        return result;
    }
    return { legacy: legacy, validate: validate };
}
(window as any).__ottLibraryBackup = createLibraryBackupCodec();
