"use strict";

// Packaged resolver: explicit input only; no network or filesystem access.
function resolve(input) {
    if (!input || typeof input.url !== "string") {
        return { streams: [] };
    }
    return {
        streams: [
            {
                title:
                    typeof input.title === "string" && input.title
                        ? input.title
                        : "Video",
                url: input.url,
            },
        ],
    };
}
