/** Complete explicitly bound Plex favorites document. No playback or network authority. */
interface PlexFavoritesDocumentPorts {
    current(): {
        verified: true;
        serverId: string;
        sourceId: string;
        channelSourceId: string;
        current(): boolean;
    } | null;
    json: { parse(bytes: Uint8Array): any; encode(value: any): Uint8Array };
    plex: { encode(value: any): any; decode(value: any): any };
    references: {
        project(value: any): string | number | null;
        resolve(value: any, origin: any): any;
    };
}
export function createPlexFavoritesDocument(ports: PlexFavoritesDocumentPorts) {
    function fail(): never {
        throw new Error("codec_error");
    }
    function exact(
        value: any,
        required: string[],
        optional: string[] = []
    ): boolean {
        return (
            !!value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            required.every((key) =>
                Object.prototype.hasOwnProperty.call(value, key)
            ) &&
            Object.keys(value).every(
                (key) =>
                    required.indexOf(key) >= 0 || optional.indexOf(key) >= 0
            )
        );
    }
    function text(value: any, max = 256, blank = false): boolean {
        if (
            typeof value !== "string" ||
            (!blank && !value) ||
            /[\u0000-\u001f\u007f]/.test(value)
        )
            return false;
        try {
            ports.json.encode(value);
        } catch (_) {
            return false;
        }
        var count = 0;
        for (var at = 0; at < value.length; at++, count++)
            if (
                value.charCodeAt(at) >= 0xd800 &&
                value.charCodeAt(at) <= 0xdbff
            )
                at++;
        return count <= max;
    }
    function scope(value: any): boolean {
        var uuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
        return (
            exact(value, ["provider", "profileBindingId", "sourceBindingId"]) &&
            value.provider === "plex" &&
            uuid.test(value.profileBindingId) &&
            uuid.test(value.sourceBindingId)
        );
    }
    function owner() {
        var value = ports.current();
        if (
            !value ||
            value.verified !== true ||
            !value.current() ||
            !text(value.sourceId, 1024) ||
            !text(value.channelSourceId, 1024) ||
            typeof value.serverId !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}(?![\s\S])/.test(value.serverId)
        )
            fail();
        return value;
    }
    function locator(value: any): boolean {
        return (
            exact(value, ["kind", "serverId", "ratingKey"]) &&
            value.kind === "plex-media" &&
            typeof value.serverId === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}(?![\s\S])/.test(
                value.serverId
            ) &&
            typeof value.ratingKey === "string" &&
            /^[1-9][0-9]{0,19}(?![\s\S])/.test(value.ratingKey)
        );
    }
    function reference(value: any): boolean {
        if (
            exact(value, ["state", "locator"], ["title"]) &&
            value.state === "located"
        )
            return (
                locator(value.locator) &&
                (value.title === undefined || text(value.title, 512, true))
            );
        if (
            !exact(value, ["state", "reason", "provenance"], ["title"]) ||
            value.state !== "unresolved" ||
            [
                "missing",
                "ambiguous",
                "legacy-unportable",
                "codec-unavailable",
            ].indexOf(value.reason) < 0 ||
            !exact(value.provenance, ["origin"], ["legacyId"]) ||
            ["raw", "canonical"].indexOf(value.provenance.origin) < 0 ||
            (value.title !== undefined && !text(value.title, 512, true))
        )
            return false;
        var id = value.provenance.legacyId;
        return (
            id === undefined ||
            (typeof id === "number" &&
                isFinite(id) &&
                id >= 0 &&
                id <= 9007199254740991 &&
                Math.floor(id) === id)
        );
    }
    function inspect(doc: any, expectedScope: any) {
        if (
            !exact(doc, [
                "schema",
                "scope",
                "coverage",
                "channelLists",
                "mediaFavorites",
            ]) ||
            doc.schema !== 1 ||
            !scope(doc.scope) ||
            !scope(expectedScope) ||
            ["provider", "profileBindingId", "sourceBindingId"].some(
                (key) => doc.scope[key] !== expectedScope[key]
            ) ||
            !exact(doc.coverage, [
                "channelLists",
                "mediaFavorites",
                "history",
                "remoteAliases",
            ]) ||
            doc.coverage.channelLists !== "complete-for-scope" ||
            doc.coverage.mediaFavorites !== "complete-for-scope" ||
            doc.coverage.history !== "excluded-preserved" ||
            doc.coverage.remoteAliases !== "excluded-preserved"
        )
            fail();
        var lists = doc.channelLists;
        if (
            !exact(lists, ["active", "order", "default", "lists"]) ||
            !Array.isArray(lists.lists) ||
            lists.lists.length > 256 ||
            !Array.isArray(lists.order) ||
            !exact(lists.default, ["present"], ["value"]) ||
            typeof lists.default.present !== "boolean" ||
            (lists.default.present
                ? !Object.prototype.hasOwnProperty.call(
                      lists.default,
                      "value"
                  ) ||
                  (lists.default.value !== null && !text(lists.default.value))
                : Object.prototype.hasOwnProperty.call(
                      lists.default,
                      "value"
                  )) ||
            !Array.isArray(doc.mediaFavorites) ||
            doc.mediaFavorites.length > 1000 ||
            !doc.mediaFavorites.every(reference)
        )
            fail();
        var names: string[] = [],
            counts = {
                channelLists: lists.lists.length,
                channelMemberships: 0,
                mediaFavorites: doc.mediaFavorites.length,
                unresolved: 0,
            };
        var unresolved: any[] = [];
        function pending(
            ref: any,
            collection: string,
            entry: number,
            list?: number
        ) {
            if (ref.state !== "unresolved") return;
            counts.unresolved++;
            var row: any = {
                collection,
                entry_index: entry,
                reason: ref.reason,
            };
            if (list !== undefined) row.list_index = list;
            unresolved.push(row);
        }
        lists.lists.forEach((list: any, at: number) => {
            if (
                !exact(list, ["name", "entries"], ["shuffleBefore"]) ||
                !text(list.name) ||
                names.indexOf(list.name) >= 0 ||
                !Array.isArray(list.entries) ||
                list.entries.length > 10000 ||
                !list.entries.every(reference) ||
                (list.shuffleBefore !== undefined &&
                    (!Array.isArray(list.shuffleBefore) ||
                        list.shuffleBefore.length > 10000 ||
                        !list.shuffleBefore.every(reference)))
            )
                fail();
            names.push(list.name);
            counts.channelMemberships += list.entries.length;
            list.entries.forEach((ref: any, index: number) =>
                pending(ref, "channelLists", index, at)
            );
            (list.shuffleBefore || []).forEach((ref: any, index: number) =>
                pending(ref, "channelLists", list.entries.length + index, at)
            );
        });
        if (
            lists.order.length !== names.length ||
            lists.order.some(
                (name: any, at: number) =>
                    names.indexOf(name) < 0 || lists.order.indexOf(name) !== at
            ) ||
            (names.length
                ? names.indexOf(lists.active) < 0
                : lists.active !== null)
        )
            fail();
        doc.mediaFavorites.forEach((ref: any, at: number) =>
            pending(ref, "mediaFavorites", at)
        );
        return { counts, document: doc, unresolved };
    }
    function encodePath(path: string, owned: any) {
        var encoded = ports.plex.encode({
            request: path,
            sourceId: owned.sourceId,
        });
        if (
            !locator(encoded) ||
            encoded.serverId !== owned.serverId ||
            "/library/metadata/" + encoded.ratingKey !== path
        )
            fail();
        return encoded;
    }
    function channel(ref: any, owned: any): any {
        var match =
            ref &&
            typeof ref.itemId === "string" &&
            /^channel:plex-([1-9][0-9]{0,19})(?![\s\S])/.exec(ref.itemId);
        if (match)
            return {
                locator: encodePath("/library/metadata/" + match[1], owned),
                state: "located",
            };
        if (ref && typeof ref.legacyId === "string") {
            var resolved = ports.references.resolve(ref.legacyId, ref.origin);
            if (resolved && resolved.itemId) return channel(resolved, owned);
            return fail();
        }
        if (
            !ref ||
            (ref.origin !== "raw" && ref.origin !== "canonical") ||
            typeof ref.legacyId !== "number" ||
            ref.legacyId < 0 ||
            ref.legacyId > 9007199254740991 ||
            Math.floor(ref.legacyId) !== ref.legacyId
        )
            fail();
        return {
            provenance: { legacyId: ref.legacyId, origin: ref.origin },
            reason: ref.ambiguous ? "ambiguous" : "legacy-unportable",
            state: "unresolved",
        };
    }
    return {
        decode: function (bytes: Uint8Array, expected: any) {
            return inspect(ports.json.parse(bytes), expected);
        },
        encode: function (doc: any) {
            inspect(doc, doc.scope);
            return ports.json.encode(doc);
        },
        prepare: function (bytes: Uint8Array, expected: any, mediaBefore: any) {
            var owned = owner(),
                parsed = inspect(ports.json.parse(bytes), expected),
                doc = parsed.document;
            var foreign: any[] = [];
            doc.channelLists.lists.forEach((list: any, at: number) => {
                list.entries
                    .concat(list.shuffleBefore || [])
                    .forEach((ref: any, index: number) => {
                        if (
                            ref.state === "located" &&
                            ref.locator.serverId !== owned.serverId
                        )
                            foreign.push({
                                collection: "channelLists",
                                entry_index: index,
                                list_index: at,
                                reason: "missing",
                            });
                    });
            });
            doc.mediaFavorites.forEach((ref: any, at: number) => {
                if (
                    ref.state === "located" &&
                    ref.locator.serverId !== owned.serverId
                )
                    foreign.push({
                        collection: "mediaFavorites",
                        entry_index: at,
                        reason: "missing",
                    });
            });
            parsed.counts.unresolved += foreign.length;
            if (parsed.unresolved.length || foreign.length)
                return {
                    counts: parsed.counts,
                    ready: false,
                    unresolved: parsed.unresolved.concat(foreign),
                };
            if (
                !doc.channelLists.lists.length ||
                (doc.channelLists.default.present &&
                    doc.channelLists.default.value !== "Favorites")
            )
                fail();
            function local(ref: any) {
                return { itemId: "channel:plex-" + ref.locator.ratingKey };
            }
            var lists: any = Object.create(null),
                shuffle: any = Object.create(null);
            doc.channelLists.lists.forEach((list: any) => {
                lists[list.name] = list.entries.map(local);
                if (list.shuffleBefore !== undefined)
                    shuffle[list.name] = list.shuffleBefore.map(local);
            });
            var tv: any = {
                lists: {
                    active: doc.channelLists.active,
                    lists,
                    order: doc.channelLists.order.slice(),
                    v: 1,
                },
                sourceId: owned.channelSourceId,
                version: 2,
            };
            if (doc.channelLists.default.present) {
                if (!Object.prototype.hasOwnProperty.call(lists, "Favorites"))
                    fail();
                tv.defaultList = doc.channelLists.default.value;
            }
            if (Object.keys(shuffle).length) tv.shuffleBefore = shuffle;
            if (
                !mediaBefore ||
                mediaBefore.sourceId !== owned.sourceId ||
                mediaBefore.version !== 1 ||
                !Array.isArray(mediaBefore.history)
            )
                fail();
            var media = JSON.parse(JSON.stringify(mediaBefore));
            media.favorites = doc.mediaFavorites.map((ref: any) => {
                var decoded = ports.plex.decode(ref.locator),
                    path = "/library/metadata/" + ref.locator.ratingKey;
                if (
                    !decoded ||
                    decoded.sourceId !== owned.sourceId ||
                    !decoded.request ||
                    decoded.request.path !== path ||
                    Object.keys(decoded.request).join(",") !== "path"
                )
                    fail();
                return {
                    itemId: "request:" + JSON.stringify({ path }),
                    payload: {
                        plexSource: owned.sourceId,
                        request: { path },
                        title: ref.title || "",
                    },
                    position: 0,
                    sourceId: owned.sourceId,
                };
            });
            if (!owned.current()) fail();
            return {
                counts: parsed.counts,
                media,
                ready: true,
                tv,
                unresolved: [],
            };
        },
        snapshot: function (expected: any, tv: any, media: any) {
            var owned = owner();
            if (
                !tv ||
                tv.version !== 2 ||
                tv.sourceId !== owned.channelSourceId ||
                !tv.lists ||
                tv.lists.v !== 1 ||
                !media ||
                media.version !== 1 ||
                media.sourceId !== owned.sourceId ||
                !Array.isArray(media.favorites)
            )
                fail();
            var doc = {
                channelLists: {
                    active: tv.lists.active,
                    default: Object.prototype.hasOwnProperty.call(
                        tv,
                        "defaultList"
                    )
                        ? { present: true, value: tv.defaultList }
                        : { present: false },
                    lists: Object.keys(tv.lists.lists).map((name) => {
                        var list: any = {
                            entries: tv.lists.lists[name].map((ref: any) =>
                                channel(ref, owned)
                            ),
                            name,
                        };
                        if (
                            tv.shuffleBefore &&
                            Object.prototype.hasOwnProperty.call(
                                tv.shuffleBefore,
                                name
                            )
                        )
                            list.shuffleBefore = tv.shuffleBefore[name].map(
                                (ref: any) => channel(ref, owned)
                            );
                        return list;
                    }),
                    order: tv.lists.order.slice(),
                },
                coverage: {
                    channelLists: "complete-for-scope",
                    history: "excluded-preserved",
                    mediaFavorites: "complete-for-scope",
                    remoteAliases: "excluded-preserved",
                },
                mediaFavorites: media.favorites.map((row: any) => {
                    if (
                        !row ||
                        row.sourceId !== owned.sourceId ||
                        !row.payload ||
                        !row.payload.request ||
                        Object.keys(row.payload.request).join(",") !== "path"
                    )
                        fail();
                    var ref: any = {
                        locator: encodePath(row.payload.request.path, owned),
                        state: "located",
                    };
                    if (typeof row.payload.title === "string")
                        ref.title = row.payload.title;
                    return ref;
                }),
                schema: 1,
                scope: expected,
            };
            inspect(doc, expected);
            if (!owned.current()) fail();
            return ports.json.encode(doc);
        },
        validate: function (bytes: Uint8Array, expected: any) {
            inspect(ports.json.parse(bytes), expected);
        },
    };
}
(window as any).__ottFavoritesPlexDocument = {
    create: createPlexFavoritesDocument,
};
