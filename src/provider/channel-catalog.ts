/** Projection of provider references to the numeric ABI used by retained STB views. */
function projectChannelCatalog(
    rows: any[],
    legacyHash: (value: string) => number,
    profile: string
) {
    var result: any = {
        channels: Object.create(null),
        groupOrder: [],
        groups: Object.create(null),
        ids: [],
    };
    var identities: Record<string, string> = Object.create(null);
    rows.forEach(function (row) {
        var raw = String(row.providerId || "");
        var id = Number(raw);
        if (
            !(
                isFinite(id) &&
                id > 0 &&
                Math.floor(id) === id &&
                id <= 9007199254740991 &&
                String(id) === raw
            )
        ) {
            var first = 2166136261;
            var second = 5381;
            for (var i = 0; i < row.itemId.length; i++) {
                var character = row.itemId.charCodeAt(i);
                first ^= character;
                first +=
                    (first << 1) +
                    (first << 4) +
                    (first << 7) +
                    (first << 8) +
                    (first << 24);
                second = ((second << 5) + second) ^ character;
            }
            id = 4294967296 + (first >>> 0) + (second & 1048575) * 4294967296;
        }
        if (identities[String(id)] && identities[String(id)] !== row.itemId)
            throw new Error("Channel identity collision");
        identities[String(id)] = row.itemId;
        if (result.channels[id]) return;
        if (!result.groups[row.groupName]) {
            result.groupOrder.push(row.groupName);
            result.groups[row.groupName] = [];
        }
        result.groups[row.groupName].push(id);
        result.ids.push(id);
        result.channels[id] = {
            ca: row.archiveMode || "",
            caso: "",
            category: {
                class: result.groupOrder.indexOf(row.groupName),
                name: row.groupName,
            },
            ch_id: id,
            channel_name: row.name,
            epg: row.providerId,
            groupId: row.groupId,
            itemId: row.itemId,
            legacyChannelId:
                profile === "stalker" && raw && isFinite(Number(raw))
                    ? Number(raw)
                    : legacyHash(row.name),
            logo: row.logo,
            rec: row.archiveHours || 0,
            tn: row.name,
            url: row.url,
        };
    });
    return result;
}

(window as any).__ottChannelCatalog = { project: projectChannelCatalog };
