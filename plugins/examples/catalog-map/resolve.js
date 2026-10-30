"use strict";

// Maps metadata supplied by the caller; the runtime does not fetch a catalog.
function resolve(input) {
    var items = input && Array.isArray(input.items) ? input.items : [];
    var query =
        input && typeof input.query === "string"
            ? input.query.toLowerCase()
            : "";
    var streams = [];
    for (var i = 0; i < items.length && streams.length < 128; i++) {
        var item = items[i];
        if (
            !item ||
            typeof item.title !== "string" ||
            typeof item.url !== "string"
        )
            continue;
        if (query && item.title.toLowerCase().indexOf(query) === -1) continue;
        streams.push({ title: item.title, url: item.url });
    }
    return { streams: streams };
}
