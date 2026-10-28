// Pure acceptance rules shared by initial, observer and recreated-realm reads.
(function () {
    "use strict";
    const marker = "\x01LZ\x01";
    const expected = Object.freeze({
        media: JSON.stringify({
            padding: "native-media-".repeat(1024),
            title: "synthetic-media",
            version: 1,
        }),
        tv: JSON.stringify({
            padding: "native-tv-".repeat(1024),
            title: "synthetic-tv",
            version: 1,
        }),
    });
    function validate(kind, decoded, raw) {
        if (!Object.prototype.hasOwnProperty.call(expected, kind))
            throw Error("Unknown synthetic provider target");
        const original = expected[kind];
        if (typeof raw !== "string" || !raw.startsWith(marker))
            throw Error(
                "Provider target was not stored through the actual LZ compression path"
            );
        if (raw.length >= original.length)
            throw Error(
                "Provider target did not become shorter than its exact original JSON"
            );
        if (decoded !== original)
            throw Error(
                "Provider target did not decode to the exact original JSON"
            );
        return true;
    }
    Object.defineProperty(window, "nativeProviderTargetValidation", {
        value: Object.freeze({ expected, validate }),
    });
})();
