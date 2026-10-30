"use strict";

// The operator's manifest grants only exact public HTTPS catalog/media hosts.
function resolve(input) {
    if (!input || typeof input.catalogUrl !== "string") return { streams: [] };
    var catalog = JSON.parse(fetchText(input.catalogUrl));
    var items = catalog && Array.isArray(catalog.items) ? catalog.items : [];
    var streams = [];
    for (var i = 0; i < items.length && streams.length < 128; i++) {
        var item = items[i];
        if (
            !item ||
            typeof item.title !== "string" ||
            typeof item.url !== "string"
        )
            continue;
        streams.push({ title: item.title, url: item.url });
    }
    return { streams: streams };
}
