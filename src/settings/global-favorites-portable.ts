/** Pure portable data rules. Matching never activates a profile or starts playback. */
export function createGlobalFavoritesPortableCodec() {
    function exact(value: any, keys: string[]): boolean {
        if (!value || typeof value !== "object" || Array.isArray(value))
            return false;
        if (Object.getOwnPropertyNames(value).length !== keys.length)
            return false;
        if (
            (Object as any).getOwnPropertySymbols &&
            (Object as any).getOwnPropertySymbols(value).length
        )
            return false;
        return keys.every(function (key) {
            var d = Object.getOwnPropertyDescriptor(value, key);
            return !!d && d.enumerable === true && "value" in d;
        });
    }
    function wellFormed(value: string): boolean {
        for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i);
            if (code >= 0xd800 && code <= 0xdbff) {
                var next = value.charCodeAt(++i);
                if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
            } else if (code >= 0xdc00 && code <= 0xdfff) return false;
        }
        return true;
    }
    function text(value: any, max: number): boolean {
        return (
            typeof value === "string" &&
            wellFormed(value) &&
            value.length > 0 &&
            value.length <= max &&
            !/^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$/.test(
                value
            ) &&
            !/[\u0000-\u001f\u007f]/.test(value) &&
            value.indexOf("://") < 0
        );
    }
    function identifier(value: any, max: number): boolean {
        return (
            typeof value === "string" &&
            value.length <= max &&
            /^[A-Za-z0-9][A-Za-z0-9._:-]*(?![\s\S])/.test(value)
        );
    }
    function origin(value: any): any {
        if (
            !exact(value, [
                "provider",
                "profile",
                "subprofile",
                "sourceAlias",
            ]) ||
            typeof value.provider !== "string" ||
            value.provider.length > 64 ||
            !/^[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)*(?![\s\S])/.test(
                value.provider
            ) ||
            !text(value.profile, 256) ||
            !(value.subprofile === null || text(value.subprofile, 256)) ||
            !text(value.sourceAlias, 256)
        )
            return null;
        return {
            profile: value.profile,
            provider: value.provider,
            sourceAlias: value.sourceAlias,
            subprofile: value.subprofile,
        };
    }
    function relative(value: any): boolean {
        if (
            !text(value, 8192) ||
            value.charAt(0) === "/" ||
            /^[A-Za-z]:/.test(value) ||
            /[\\]/.test(value)
        )
            return false;
        return value.split("/").every(function (segment: string) {
            return segment !== "" && segment !== "." && segment !== "..";
        });
    }
    function locator(provider: string, value: any): any {
        if (provider === "plex") {
            if (
                !exact(value, ["kind", "serverId", "ratingKey"]) ||
                value.kind !== "plex-media" ||
                typeof value.serverId !== "string" ||
                !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}(?![\s\S])/.test(
                    value.serverId
                ) ||
                typeof value.ratingKey !== "string" ||
                !/^[1-9][0-9]{0,19}(?![\s\S])/.test(value.ratingKey)
            )
                return null;
            return {
                kind: "plex-media",
                ratingKey: value.ratingKey,
                serverId: value.serverId,
            };
        }
        if (provider === "local") {
            if (
                !exact(value, ["kind", "rootAlias", "relativePath"]) ||
                value.kind !== "local-media" ||
                !text(value.rootAlias, 256) ||
                !relative(value.relativePath)
            )
                return null;
            return {
                kind: "local-media",
                relativePath: value.relativePath,
                rootAlias: value.rootAlias,
            };
        }
        if (
            provider === "vportal" ||
            (provider === "m3u" &&
                exact(value, ["kind", "idField", "id"]) &&
                value.kind === "vportal-media")
        ) {
            if (
                !exact(value, ["kind", "idField", "id"]) ||
                value.kind !== "vportal-media" ||
                [
                    "id",
                    "fid",
                    "stream_id",
                    "itemId",
                    "media_id",
                    "episode_id",
                ].indexOf(value.idField) < 0 ||
                !identifier(value.id, 256)
            )
                return null;
            return {
                id: value.id,
                idField: value.idField,
                kind: "vportal-media",
            };
        }
        if (
            exact(value, ["kind", "name", "group"]) &&
            value.kind === "channel-name"
        ) {
            if (
                !text(value.name, 1024) ||
                !(value.group === null || text(value.group, 256))
            )
                return null;
            return {
                group: value.group,
                kind: "channel-name",
                name: value.name,
            };
        }
        if (
            !exact(value, ["kind", "channelId"]) ||
            value.kind !== "channel" ||
            !identifier(value.channelId, 256) ||
            /^channel:[0-9]+(?![\s\S])/.test(value.channelId)
        )
            return null;
        return { channelId: value.channelId, kind: "channel" };
    }
    function providerId(value: any): string | null {
        if (typeof value === "number") {
            if (
                !isFinite(value) ||
                value < 0 ||
                value > 9007199254740991 ||
                Math.floor(value) !== value
            )
                return null;
            value = String(value);
        }
        return identifier(value, 256) ? value : null;
    }
    function normalize(value: any): any {
        try {
            if (
                !exact(value, ["title", "origin", "locator"]) ||
                !text(value.title, 1024)
            )
                return null;
            var o = origin(value.origin);
            var l = o && locator(o.provider, value.locator);
            return l ? { locator: l, origin: o, title: value.title } : null;
        } catch (_) {
            return null;
        }
    }
    function identity(value: any): string {
        var row = normalize(value);
        return row
            ? JSON.stringify({ locator: row.locator, origin: row.origin })
            : "";
    }
    function document(value: any): any {
        try {
            if (
                !exact(value, ["version", "entries"]) ||
                value.version !== 1 ||
                !Array.isArray(value.entries) ||
                value.entries.length > 1000
            )
                return null;
            var seen: { [key: string]: boolean } = Object.create(null);
            var rows: any[] = [];
            for (var i = 0; i < value.entries.length; i++) {
                var row = normalize(value.entries[i]);
                if (!row) return null;
                var key = identity(row);
                if (seen[key]) return null;
                seen[key] = true;
                rows.push(row);
            }
            var result = { entries: rows, version: 1 };
            // encodeURIComponent rejects lone surrogates and counts actual UTF-8.
            var bytes = encodeURIComponent(JSON.stringify(result)).replace(
                /%[A-Fa-f0-9]{2}/g,
                "x"
            ).length;
            return bytes <= 1048576 ? result : null;
        } catch (_) {
            return null;
        }
    }
    function requiredLocatorKinds(value: any): string[] | null {
        var doc = document(value);
        if (!doc) return null;
        var result: string[] = [];
        doc.entries.forEach(function (entry: any) {
            if (result.indexOf(entry.locator.kind) < 0)
                result.push(entry.locator.kind);
        });
        return result.sort();
    }
    function supports(value: any, advertisedKinds: any): boolean {
        var required = requiredLocatorKinds(value);
        if (
            !required ||
            !Array.isArray(advertisedKinds) ||
            advertisedKinds.length > 32
        )
            return false;
        for (var i = 0; i < advertisedKinds.length; i++) {
            if (
                typeof advertisedKinds[i] !== "string" ||
                advertisedKinds[i].length > 64 ||
                advertisedKinds.indexOf(advertisedKinds[i]) !== i
            )
                return false;
        }
        return required.every(function (kind) {
            return advertisedKinds.indexOf(kind) >= 0;
        });
    }
    function match(
        value: any,
        candidates: any[],
        verify: (candidate: any, locator: any) => boolean,
        current: () => boolean
    ): any {
        var row = normalize(value);
        if (!row || !Array.isArray(candidates)) return { status: "invalid" };
        try {
            if (!current()) return { status: "stale" };
            var key = JSON.stringify(row.origin);
            var choices = candidates.filter(function (candidate) {
                return JSON.stringify(origin(candidate.origin)) === key;
            });
            if (!choices.length) return { status: "missing" };
            if (choices.length !== 1) return { status: "ambiguous" };
            var verified = verify(choices[0], row.locator) === true;
            if (!current()) return { status: "stale" };
            return verified
                ? { candidate: choices[0], entry: row, status: "matched" }
                : { status: "unresolved" };
        } catch (_) {
            return { status: "unresolved" };
        }
    }
    return {
        document: document,
        identity: identity,
        match: match,
        normalize: normalize,
        providerId: providerId,
        requiredLocatorKinds: requiredLocatorKinds,
        supports: supports,
    };
}
