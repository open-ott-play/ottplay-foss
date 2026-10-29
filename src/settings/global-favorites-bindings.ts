/** Private selector recognition only: never authorizes a Plex transfer grant. */
export function isGlobalFavoriteSelector(value: any): boolean {
    function exact(object: any, keys: string[]): boolean {
        return (
            !!object &&
            typeof object === "object" &&
            !Array.isArray(object) &&
            Object.keys(object).sort().join(",") === keys.sort().join(",") &&
            keys.every(function (key) {
                var field = Object.getOwnPropertyDescriptor(object, key);
                return !!field && "value" in field;
            })
        );
    }
    function text(value: any, limit: number): boolean {
        return (
            typeof value === "string" &&
            !!value &&
            value.trim() === value &&
            value.length <= limit &&
            !/[\u0000-\u001f\u007f]/.test(value) &&
            value.indexOf("://") < 0
        );
    }
    if (
        !value ||
        !exact(
            value,
            [
                "kind",
                "origin",
                "provider",
                "slot",
                "configurationDigest",
            ].concat(value.provider === "offline" ? ["root"] : [])
        ) ||
        value.kind !== "global-playback-target" ||
        !/^[a-z0-9][a-z0-9_.\/-]{0,63}$/.test(value.provider) ||
        !exact(value.origin, [
            "provider",
            "profile",
            "subprofile",
            "sourceAlias",
        ]) ||
        value.origin.provider !==
            (value.provider === "offline" ? "local" : value.provider) ||
        !text(value.origin.profile, 256) ||
        !text(value.origin.sourceAlias, 256) ||
        !(
            value.origin.subprofile === null ||
            text(value.origin.subprofile, 256)
        ) ||
        typeof value.configurationDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.configurationDigest) ||
        !(value.slot === null
            ? true
            : typeof value.slot === "number" &&
              isFinite(value.slot) &&
              Math.floor(value.slot) === value.slot &&
              value.slot >= 0 &&
              value.slot < 15)
    )
        return false;
    return (
        value.provider !== "offline" ||
        (exact(value.root, ["alias", "id", "key"]) &&
            text(value.root.alias, 256) &&
            text(value.root.id, 2048) &&
            /^s(?:[0-9]|[12][0-9]|3[01])$/.test(value.root.key))
    );
}
