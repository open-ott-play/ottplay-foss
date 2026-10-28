/** Pure codec only: the owner supplies an already verified, explicitly paired PMS. */
interface FavoritesPlexCodecPorts {
    current(): { verified: true; serverId: string; sourceId: string } | null;
    request(path: string): any;
}

function createFavoritesPlexCodec(ports: FavoritesPlexCodecPorts) {
    function fail(code: string): never {
        var error = new Error("Favorites Plex: " + code);
        (error as any).code = code;
        throw error;
    }
    function exact(value: any, names: string[]): boolean {
        if (!value || typeof value !== "object" || Array.isArray(value))
            return false;
        var keys = Object.getOwnPropertyNames(value);
        return (
            keys.length === names.length &&
            names.every(function (name) {
                var descriptor = Object.getOwnPropertyDescriptor(value, name);
                return (
                    !!descriptor &&
                    descriptor.enumerable &&
                    "value" in descriptor
                );
            })
        );
    }
    function server(value: any): boolean {
        // A machine identifier, never an address, token, request or display name.
        return (
            typeof value === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}(?![\s\S])/.test(value)
        );
    }
    function source(value: any): boolean {
        return (
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 8192 &&
            !/[\u0000-\u001f\u007f]/.test(value)
        );
    }
    function current() {
        var value: any;
        try {
            value = ports.current();
            if (
                !exact(value, ["verified", "serverId", "sourceId"]) ||
                value.verified !== true ||
                !server(value.serverId) ||
                !source(value.sourceId)
            )
                fail("source_unavailable");
            return { serverId: value.serverId, sourceId: value.sourceId };
        } catch (_) {
            return fail("source_unavailable");
        }
    }
    function unchanged(before: { serverId: string; sourceId: string }) {
        var after = current();
        if (
            before.serverId !== after.serverId ||
            before.sourceId !== after.sourceId
        )
            fail("context_changed");
    }
    function rating(value: any): boolean {
        return (
            typeof value === "string" &&
            /^[1-9][0-9]{0,19}(?![\s\S])/.test(value)
        );
    }
    return {
        encode: function (item: any) {
            if (!exact(item, ["sourceId", "request"])) fail("invalid_item");
            var path = item.request;
            if (typeof path !== "string") fail("invalid_item");
            var match =
                /^\/library\/metadata\/([1-9][0-9]{0,19})(?![\s\S])/.exec(path);
            if (!match) fail("invalid_item");
            var owner = current();
            if (item.sourceId !== owner.sourceId) fail("item_unavailable");
            unchanged(owner);
            return {
                kind: "plex-media",
                serverId: owner.serverId,
                ratingKey: match[1],
            };
        },
        decode: function (locator: any) {
            if (
                !exact(locator, ["kind", "serverId", "ratingKey"]) ||
                locator.kind !== "plex-media" ||
                !server(locator.serverId) ||
                !rating(locator.ratingKey)
            )
                fail("invalid_locator");
            var owner = current();
            if (locator.serverId !== owner.serverId) fail("item_unavailable");
            var request: any;
            try {
                request = ports.request(
                    "/library/metadata/" + locator.ratingKey,
                );
            } catch (_) {
                fail("request_unavailable");
            }
            if (request === null || request === undefined)
                fail("request_unavailable");
            unchanged(owner);
            // This result is receiver-private. Only encode's locator is transferable.
            return { sourceId: owner.sourceId, request: request };
        },
    };
}
