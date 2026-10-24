import { caselessKey } from "../utils/caseless";

export var randomChannels = (function () {
    /** Unknown metadata and AceStream are neither safe nor adult candidates. */
    function randomChannelClass(w: any, id: any): number {
        var channel = w.channels && w.channels[id];
        if (
            !channel ||
            !Array.isArray(w.parentalArray) ||
            typeof channel.channel_name !== "string" ||
            !channel.channel_name.trim() ||
            /[\x00-\x1f\x7f-\x9f]/.test(channel.channel_name)
        )
            return -1;
        var category = (channel.category && channel.category.name) || "";
        if (
            /\[acestream\]/i.test(channel.channel_name) ||
            (typeof channel.url === "string" &&
                /^acestream:/i.test(channel.url))
        )
            return -1;
        return channel.adult ||
            w.parentalArray.some(function (key: any) {
                return String(key) === String(id);
            }) ||
            (w.parental && w.parental.test(category))
            ? 1
            : 0;
    }

    function validRandomOptions(value: any): boolean {
        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Object.keys(value).some(function (key) {
                return ["search", "range", "mode"].indexOf(key) < 0;
            }) ||
            (value.mode !== undefined && value.mode !== "adult")
        )
            return false;
        if (value.search !== undefined) {
            if (
                typeof value.search !== "string" ||
                !value.search.trim() ||
                /[\x00-\x1f\x7f-\x9f]/.test(value.search)
            )
                return false;
            try {
                if (
                    encodeURIComponent(value.search).replace(
                        /%[0-9A-F]{2}/g,
                        "x"
                    ).length > 1024
                )
                    return false;
            } catch (_) {
                return false;
            }
        }
        return (
            value.range === undefined ||
            (Array.isArray(value.range) &&
                value.range.length === 2 &&
                value.range.every(function (n: any) {
                    return (
                        typeof n === "number" &&
                        isFinite(n) &&
                        n % 1 === 0 &&
                        n > 0 &&
                        n <= 9007199254740991
                    );
                }) &&
                value.range[0] <= value.range[1])
        );
    }

    /** Uniform within each pool; an explicit range overrides the 80/20 preference. */
    function pickRandomChannel(
        w: any,
        ids: any[],
        options: any,
        include: (id: any) => boolean,
        random: () => number = Math.random
    ): number {
        var search = options.search ? caselessKey(options.search) : "";
        var exact =
            search &&
            ids.some(function (id) {
                var channel = w.channels && w.channels[id];
                return (
                    include(id) &&
                    channel &&
                    caselessKey(String(channel.channel_name || "")) === search
                );
            });
        var first: number[] = [],
            rest: number[] = [],
            seen: Record<string, boolean> = Object.create(null);
        ids.forEach(function (id, index) {
            var number = index + 1;
            if (seen[String(id)] || !include(id)) return;
            seen[String(id)] = true;
            if (
                options.range &&
                (number < options.range[0] || number > options.range[1])
            )
                return;
            var name = caselessKey(
                String(
                    (w.channels &&
                        w.channels[id] &&
                        w.channels[id].channel_name) ||
                        ""
                )
            );
            if (search && (exact ? name !== search : name.indexOf(search) < 0))
                return;
            if (
                randomChannelClass(w, id) !== (options.mode === "adult" ? 1 : 0)
            )
                return;
            (options.range || options.mode === "adult" || number <= 1000
                ? first
                : rest
            ).push(index);
        });
        var pool =
            first.length && rest.length
                ? random() < 0.8
                    ? first
                    : rest
                : first.length
                  ? first
                  : rest;
        return pool.length ? pool[Math.floor(random() * pool.length)] : -1;
    }

    /** The admission callback is also checked by playChannel after closing overlays. */
    function playRandomChannel(
        w: any,
        ids: any[],
        options: any,
        include: (id: any) => boolean,
        current: () => boolean,
        media = false,
        preferred = -1
    ): any {
        if (
            !validRandomOptions(options) ||
            !current() ||
            !w.__ottParental ||
            typeof w.__ottParental.needs !== "function"
        )
            return null;
        var index = pickRandomChannel(w, ids, options, include);
        if (index < 0) return null;
        var id = ids[index],
            channels = w.channels,
            channel = channels[id],
            play = w.playChannel;
        var publicId = String(media ? channel.itemId || id : id),
            title = channel.channel_name;
        var category = preferred,
            member = -1,
            list: any;
        var names = w.catsArray || [],
            cats = w.cats;
        for (var n = preferred >= 0 ? preferred : 0; n < names.length; n++) {
            list = cats && cats[names[n]];
            member = Array.isArray(list)
                ? list.map(String).indexOf(String(id))
                : -1;
            if (member >= 0) {
                category = n;
                break;
            }
            if (preferred >= 0) break;
        }
        function admitted(): boolean {
            return (
                current() &&
                w.channels === channels &&
                channels[id] === channel &&
                include(id) &&
                String(media ? channel.itemId || id : id) === publicId &&
                channel.channel_name === title &&
                randomChannelClass(w, id) ===
                    (options.mode === "adult" ? 1 : 0) &&
                (!w.parentalArray.some(function (key: any) {
                    return String(key) === String(id);
                }) ||
                    !w.__ottParental.needs("channels")) &&
                !(w.__ottKiosk && w.__ottKiosk.enabled()) &&
                !(typeof w.stbIsStandby === "function" && w.stbIsStandby()) &&
                w.playChannel === play &&
                w.catsArray === names &&
                w.cats === cats &&
                cats[names[category]] === list &&
                String(list[member]) === String(id)
            );
        }
        if (
            member < 0 ||
            typeof play !== "function" ||
            !admitted() ||
            play.call(w, category, member, true, admitted) !== true
        )
            return null;
        return { id: publicId, name: title, number: index + 1 };
    }

    return {
        classify: randomChannelClass,
        pick: pickRandomChannel,
        play: playRandomChannel,
        valid: validRandomOptions,
    };
})();
