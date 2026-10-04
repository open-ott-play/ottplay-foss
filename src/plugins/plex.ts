interface PlexConfig {
    address: string;
    playback: "auto" | "original" | "compatible";
    token: string;
}

/** Configuration belongs to one player/profile; no server environment or shared credentials. */
function normalizePlexConfig(value: any): PlexConfig | null {
    if (!value || typeof value !== "object") return null;
    var address = String(value.address || value.server || "")
        .trim()
        .replace(/\/+$/, "");
    var token = typeof value.token === "string" ? value.token.trim() : "";
    if (
        !/^https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?(?:\/[a-z0-9_./~-]*)?$/i.test(
            address
        ) ||
        /(?:^|\/)\.\.(?:\/|$)/.test(address) ||
        !token ||
        token.length > 1024 ||
        /[\s\u0000-\u001f\u007f]/.test(token)
    )
        return null;
    var port = /^https?:\/\/(?:\[[^\]]+\]|[^/:]+):(\d+)(?:\/|$)/i.exec(address);
    if (port && (+port[1] < 1 || +port[1] > 65535)) return null;
    return {
        address: address,
        playback:
            value.playback === "original" || value.playback === "compatible"
                ? value.playback
                : "auto",
        token: token,
    };
}

function plexRows(value: any): any[] {
    return Array.isArray(value)
        ? value
        : value && typeof value === "object"
          ? [value]
          : [];
}

/** PMS installations may return XML even when JSON was requested. */
function plexContainer(value: any, host: any): any {
    if (typeof value === "string") {
        if (value.length > 8 * 1024 * 1024)
            throw new Error("Invalid Plex response");
        if (/^\s*\{/.test(value)) value = JSON.parse(value);
        else {
            if (/<!DOCTYPE/i.test(value)) throw new Error("Invalid Plex XML");
            var xml = new host.DOMParser().parseFromString(value, "text/xml");
            if (
                xml.getElementsByTagName("parsererror").length ||
                !xml.documentElement ||
                xml.documentElement.nodeName !== "MediaContainer"
            )
                throw new Error("Invalid Plex XML");
            var convert = function (node: any, depth = 0): any {
                if (depth > 16) throw new Error("Invalid Plex XML");
                var result: any = Object.create(null);
                for (var i = 0; i < node.attributes.length; i++)
                    result[node.attributes[i].name] = node.attributes[i].value;
                for (
                    var child = node.firstChild;
                    child;
                    child = child.nextSibling
                ) {
                    if (child.nodeType !== 1) continue;
                    var key = child.nodeName;
                    if (!Array.isArray(result[key])) result[key] = [];
                    result[key].push(convert(child, depth + 1));
                }
                return result;
            };
            value = { MediaContainer: convert(xml.documentElement) };
        }
    }
    if (
        !value ||
        !value.MediaContainer ||
        typeof value.MediaContainer !== "object"
    )
        throw new Error("Invalid Plex response");
    return value.MediaContainer;
}

function plexPath(value: any): string {
    if (
        typeof value !== "string" ||
        !/^\/(?:library\/(?:sections|metadata|parts)(?:[/?]|$)|hubs\/search(?:[?]|$))/.test(
            value
        ) ||
        /[\\#\u0000-\u0020]/.test(value) ||
        /[?&]X-Plex-/i.test(value)
    )
        return "";
    try {
        if (
            /(?:^|\/)\.\.(?:\/|$)|\\/.test(
                decodeURIComponent(value.split("?")[0])
            )
        )
            return "";
    } catch (_) {
        return "";
    }
    return value;
}

function createPlexClient(
    configuration: any,
    options: {
        host?: any;
        isCurrent?(): boolean;
        onRetry?(): void;
        sourceId: string;
        title?: string;
    }
): any {
    var config = normalizePlexConfig(configuration);
    if (
        !config ||
        !options ||
        !options.sourceId ||
        options.sourceId.indexOf(config.token) !== -1
    )
        return null;
    var w = options.host || (window as any);
    var jq = w.jQuery || w.$;
    if (!jq || typeof jq.ajax !== "function") return null;
    var source = options.sourceId;
    var revision = 0;
    var disposed = false;
    var unloading = false;
    var pending: any = null;
    var connectTimer: any = null;
    var cancelCollection: (() => void) | null = null;
    var cancelPage: (() => void) | null = null;
    var pageRevision = 0;
    var sections: any = null;
    var sectionsAt = 0;
    var search: any = null;
    var session: any = null;
    var releasing = 0;
    var waiting: Array<() => void> = [];
    var sequence = 0;
    var clientId =
        "ottplay-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2);

    function current(token: number): boolean {
        return (
            !disposed &&
            token === revision &&
            (!options.isCurrent || options.isCurrent())
        );
    }
    function translate(value: string): string {
        return typeof w._ === "function" ? w._(value) : value;
    }
    function failure(): void {
        if (typeof w.infoBox === "function")
            w.infoBox(translate("Plex connection failed"));
    }
    function url(path: string, params: any = {}): string {
        var pairs: string[] = [];
        Object.keys(params).forEach(function (key) {
            pairs.push(
                encodeURIComponent(key) +
                    "=" +
                    encodeURIComponent(String(params[key]))
            );
        });
        pairs.push("X-Plex-Token=" + encodeURIComponent(config!.token));
        return (
            config!.address +
            path +
            (path.indexOf("?") === -1 ? "?" : "&") +
            pairs.join("&")
        );
    }
    function request(
        path: string,
        params: any,
        token: number,
        done: (data: any, error?: string, retryable?: boolean) => void
    ): void {
        var finished = false;
        var owned: any = null;
        var headers: any = { Accept: "application/json" };
        ["X-Plex-Container-Start", "X-Plex-Container-Size"].forEach(
            function (key) {
                if (params[key] !== undefined)
                    headers[key] = String(params[key]);
            }
        );
        try {
            var xhr = jq.ajax({
                complete: function () {
                    finished = true;
                    if (pending === owned) pending = null;
                },
                dataType: "text",
                error: function (xhr: any, status: string) {
                    if (current(token) && status !== "abort") {
                        var code = Number(xhr.status) || 0;
                        done(
                            null,
                            "Plex connection failed",
                            !code || code === 408 || code === 429 || code >= 500
                        );
                    }
                },
                headers: headers,
                success: function (data: any) {
                    if (!current(token)) return;
                    var parsed: any;
                    try {
                        parsed = plexContainer(data, w);
                    } catch (_) {
                        done(null, "Plex connection failed");
                        return;
                    }
                    done(parsed);
                },
                timeout: 30000,
                type: "GET",
                url: url(path, params),
            });
            owned = xhr;
            if (!finished && current(token)) pending = xhr;
        } catch (_) {
            if (current(token)) done(null, "Plex connection failed");
        }
    }
    function control(path: string, active: any, done?: () => void): any {
        try {
            if (unloading && typeof w.fetch === "function") {
                w.fetch(url(path, { session: active.id }), {
                    credentials: "omit",
                    keepalive: true,
                    method: "GET",
                }).then(done, done);
                return null;
            }
            return jq.ajax({
                complete: done,
                dataType: "text",
                timeout: 5000,
                type: "GET",
                url: url(path, { session: active.id }),
            });
        } catch (_) {
            if (done) done();
            return null;
        }
    }
    function release(): void {
        var active = session;
        session = null;
        if (!active) return;
        w.clearInterval(active.timer);
        if (active.pending) active.pending.abort();
        releasing++;
        var complete = false;
        control("/video/:/transcode/universal/stop", active, function () {
            if (complete) return;
            complete = true;
            if (--releasing) return;
            var next = waiting;
            waiting = [];
            next.forEach(function (run) {
                run();
            });
        });
    }
    function cancel(): void {
        revision++;
        if (connectTimer !== null) w.clearTimeout(connectTimer);
        connectTimer = null;
        var xhr = pending;
        pending = null;
        if (xhr && typeof xhr.abort === "function") xhr.abort();
        if (session && !session.started) release();
    }
    function persist(value: any): any {
        if (typeof value === "string")
            return value.indexOf(config!.token) !== -1 ||
                value.indexOf(encodeURIComponent(config!.token)) !== -1 ||
                /[?&]X-Plex-Token=/i.test(value)
                ? undefined
                : value;
        if (!value || typeof value !== "object") return value;
        var clean: any = Array.isArray(value) ? [] : {};
        Object.keys(value).forEach(function (key) {
            if (
                /^(?:stream_url|__ottPlexPlayback|__ottNativeFile|__proto__|constructor|prototype|token|stop|heartbeat|sessions)$/i.test(
                    key
                )
            )
                return;
            var child = persist(value[key]);
            if (child !== undefined) clean[key] = child;
        });
        return clean;
    }
    function escaped(value: any): string {
        return String(value || "").replace(/[&<>"']/g, function (character) {
            return "&#" + character.charCodeAt(0) + ";";
        });
    }
    function target(path: string, title: string): any {
        return { path: path, plexSource: source, title: title };
    }
    function items(container: any): any[] {
        var rows = plexRows(container.Metadata).concat(
            plexRows(container.Directory),
            plexRows(container.Video),
            plexRows(container.Track)
        );
        plexRows(container.Hub).forEach(function (hub) {
            rows = rows.concat(items(hub));
        });
        return rows;
    }
    function itemTitle(item: any, playable: boolean): string {
        function text(value: any): string {
            return typeof value === "string" || typeof value === "number"
                ? String(value)
                      .replace(/[\u0000-\u001f\u007f]/g, " ")
                      .replace(/\s+/g, " ")
                      .trim()
                : "";
        }
        var names = [item.title, item.name, item.originalTitle, item.titleSort];
        for (var i = 0; i < names.length; i++) {
            var title = text(names[i]);
            if (title) return title;
        }
        var media = plexRows(item.Media);
        for (var m = 0; m < media.length; m++) {
            if (!media[m] || typeof media[m] !== "object") continue;
            var parts = plexRows(media[m].Part);
            for (var p = 0; p < parts.length; p++) {
                if (!parts[p] || typeof parts[p] !== "object") continue;
                var file = parts[p].file;
                // Part.file is a filesystem path, never a playback URL. Only
                // its final component belongs in the visible catalog label.
                if (
                    typeof file !== "string" ||
                    /^[a-z][a-z0-9+.-]*:\/\//i.test(file)
                )
                    continue;
                var filename = text(file.split(/[\\/]/).pop());
                if (filename && filename !== "." && filename !== "..")
                    return filename;
            }
        }
        return translate(playable ? "Untitled" : "Untitled folder");
    }
    function records(
        container: any,
        path: string,
        params: any,
        navigation = true,
        title?: string
    ): any[] {
        var root = path === "/library/sections";
        var result: any[] = [];
        var section = /^\/library\/sections\/(\d+)\/all(?:\?|$)/.exec(path);
        if (navigation && section && !Number(params["X-Plex-Container-Start"]))
            result.push({
                playlist_url: target(
                    "/library/sections/" + section[1] + "/folder",
                    translate("Browse folders")
                ),
                title: translate("Browse folders"),
            });
        items(container).forEach(function (item) {
            if (!item || typeof item !== "object") return;
            var key = plexPath(item.key);
            if (root && /^\d+$/.test(String(item.key)))
                key = "/library/sections/" + item.key + "/all";
            var playable =
                /^(?:movie|episode|clip|track)$/.test(item.type) ||
                plexRows(item.Media).length > 0;
            var id = String(item.ratingKey || "");
            var title = itemTitle(item, playable && /^\d+$/.test(id));
            if (playable && /^\d+$/.test(id)) {
                result.push({
                    __ottMediaSequence:
                        item.type === "episode" || item.type === "track",
                    description: escaped(item.summary),
                    plexSource: source,
                    request: { path: "/library/metadata/" + id },
                    stream_url: "plex:request",
                    title: title,
                });
            } else if (key) {
                if (/^\/library\/metadata\/\d+$/.test(key)) key += "/children";
                result.push({
                    description: escaped(item.summary),
                    playlist_url: target(key, title),
                    title: title,
                });
            }
        });
        var offset =
            Number(container.offset) ||
            Number(params["X-Plex-Container-Start"]) ||
            0;
        var count = Number(container.size) || items(container).length;
        if (
            navigation &&
            count > 0 &&
            Number(container.totalSize) > offset + count
        )
            result.push({
                __ottMediaNext: true,
                playlist_url: {
                    offset: offset + count,
                    path: path,
                    plexSource: source,
                    query: params.query,
                    title: String(
                        title ||
                            container.title2 ||
                            container.title1 ||
                            options.title ||
                            "Plex"
                    ),
                },
                title: translate("Next"),
            });
        if (navigation && root)
            result.push({
                playlist_url: "plexsearch",
                search_on: 1,
                title: translate("Search"),
            });
        return result;
    }
    function catalogTitle(value: any, data: any): string {
        var selected =
            value && typeof value.title === "string" && value.title.trim();
        return String(
            selected ||
                (data && (data.title2 || data.title1)) ||
                options.title ||
                "Plex"
        );
    }
    /** One cursor request owns neither visible navigation nor playback resolution. */
    function page(
        value: any,
        done: (result: { items: any[]; error?: string }) => void
    ): () => void {
        var token = ++pageRevision;
        if (cancelPage) cancelPage();
        if (token !== pageRevision) return function () {};
        var ended = false;
        var settled = false;
        var pendingPage: any = null;
        function cancelOwned(): void {
            ended = true;
            if (cancelPage === cancelOwned) cancelPage = null;
            var xhr = pendingPage;
            pendingPage = null;
            if (xhr && typeof xhr.abort === "function") xhr.abort();
        }
        function active(): boolean {
            return (
                !ended &&
                !disposed &&
                token === pageRevision &&
                (!options.isCurrent || options.isCurrent())
            );
        }
        function finish(data: any, failed = false): void {
            if (!active()) return;
            var rows: any[] = [];
            try {
                if (!failed) {
                    if (path === "/hubs/search") {
                        var found = items(data);
                        data = {
                            Metadata: found.slice(offset, offset + 200),
                            offset: offset,
                            size: Math.min(
                                200,
                                Math.max(0, found.length - offset)
                            ),
                            totalSize: found.length,
                        };
                    } else if (
                        (data.offset !== undefined &&
                            Number(data.offset) !== offset) ||
                        items(data).length > 200
                    )
                        throw new Error();
                    rows = records(
                        data,
                        path,
                        params,
                        true,
                        catalogTitle(value, data)
                    );
                }
            } catch (_) {
                failed = true;
            }
            ended = true;
            settled = true;
            pendingPage = null;
            if (cancelPage === cancelOwned) cancelPage = null;
            done(
                failed
                    ? { error: translate("Unable to load playlist"), items: [] }
                    : { items: rows }
            );
        }
        cancelPage = cancelOwned;
        if (!active()) {
            cancelOwned();
            return cancelOwned;
        }
        var path =
            value && value.plexSource === source ? plexPath(value.path) : "";
        var offset = value && Number(value.offset);
        var params: any = {
            "X-Plex-Container-Size": 200,
            "X-Plex-Container-Start": offset,
        };
        if (value && typeof value.query === "string")
            params.query = value.query;
        if (
            !/^\/(?:library\/(?:sections(?:\/\d+\/(?:all|folder))?|metadata\/\d+\/children)(?:\?|$)|hubs\/search(?:\?|$))/.test(
                path
            ) ||
            !isFinite(offset) ||
            offset < 0 ||
            Math.floor(offset) !== offset
        ) {
            finish(null, true);
            return cancelOwned;
        }
        if (
            path === "/hubs/search" &&
            search &&
            search.query === params.query &&
            Date.now() - search.at < 15000
        ) {
            finish(search.data);
            return cancelOwned;
        }
        var query =
            path === "/hubs/search"
                ? {
                      limit: 200,
                      query: params.query,
                      "X-Plex-Container-Size": 1000,
                      "X-Plex-Container-Start": 0,
                  }
                : params;
        try {
            var xhr = jq.ajax({
                complete: function () {},
                dataType: "text",
                error: function () {
                    finish(null, true);
                },
                headers: {
                    Accept: "application/json",
                    "X-Plex-Container-Size": String(
                        query["X-Plex-Container-Size"]
                    ),
                    "X-Plex-Container-Start": String(
                        query["X-Plex-Container-Start"]
                    ),
                },
                success: function (raw: any) {
                    if (!active()) return;
                    var data: any;
                    try {
                        data = plexContainer(raw, w);
                    } catch (_) {
                        finish(null, true);
                        return;
                    }
                    if (path === "/hubs/search")
                        search = {
                            at: Date.now(),
                            data: data,
                            query: params.query,
                        };
                    finish(data);
                },
                timeout: 30000,
                type: "GET",
                url: url(path, query),
            });
            if (active()) pendingPage = xhr;
            else if (!settled && xhr && typeof xhr.abort === "function")
                xhr.abort();
        } catch (_) {
            finish(null, true);
        }
        return cancelOwned;
    }
    function collectionPath(value: any): string {
        var path =
            value === "" || value === null || value === undefined
                ? "/library/sections"
                : value &&
                    typeof value === "object" &&
                    value.plexSource === source
                  ? plexPath(value.path)
                  : "";
        // Hub search uses per-hub limits instead of flat offset pagination;
        // never present its possibly truncated snapshot as a complete queue.
        return /^\/library\/(?:sections(?:\/\d+\/(?:all|folder))?|metadata\/\d+\/children)(?:\?|$)/.test(
            path
        )
            ? path
            : "";
    }
    /** Collect a flat catalog independently from the visible navigation request. */
    function collect(
        value: any,
        done: (result: {
            items: any[];
            records: any[];
            error?: string;
        }) => void,
        guard?: () => boolean
    ): () => void {
        if (cancelCollection) cancelCollection();
        var ended = false;
        var pendingPage: any = null;
        var timer: any = null;
        var started = Date.now();
        var offset = 0;
        var pages = 0;
        var total: number | null = null;
        var characters = 0;
        var collected: any[] = [];
        var catalog: any[] = [];
        var seen: any = Object.create(null);
        var seenPages: any = Object.create(null);
        var path = collectionPath(value);
        function cancelOwned(): void {
            if (ended) return;
            ended = true;
            if (cancelCollection === cancelOwned) cancelCollection = null;
            if (timer !== null) w.clearTimeout(timer);
            timer = null;
            var previous = pendingPage;
            pendingPage = null;
            collected = [];
            catalog = [];
            seen = seenPages = null;
            if (previous && previous.xhr) previous.xhr.abort();
        }
        function active(): boolean {
            if (ended) return false;
            var valid =
                !disposed && (!options.isCurrent || options.isCurrent());
            try {
                if (guard && !guard()) valid = false;
            } catch (_) {
                valid = false;
            }
            if (!valid) cancelOwned();
            return valid;
        }
        function finish(error = false): void {
            if (!active()) return;
            var result = error
                ? {
                      error: translate("Unable to load playlist"),
                      items: [],
                      records: [],
                  }
                : { items: collected, records: catalog };
            cancelOwned();
            done(result);
        }
        function integer(value: any): number | null {
            var number = Number(value);
            return value !== null &&
                value !== "" &&
                isFinite(number) &&
                number >= 0 &&
                Math.floor(number) === number
                ? number
                : null;
        }
        function accept(data: any): void {
            if (!active()) return;
            if (Date.now() - started >= 120000) {
                finish(true);
                return;
            }
            var rows: any[];
            var page: any[];
            try {
                rows = items(data);
                page = records(
                    data,
                    path,
                    { "X-Plex-Container-Start": offset },
                    false
                );
            } catch (_) {
                finish(true);
                return;
            }
            var count =
                data.size === undefined ? rows.length : integer(data.size);
            var start =
                data.offset === undefined ? offset : integer(data.offset);
            var reported =
                data.totalSize === undefined ? null : integer(data.totalSize);
            if (
                count === null ||
                count !== rows.length ||
                count > 200 ||
                start !== offset ||
                (data.totalSize !== undefined && reported === null) ||
                (reported !== null &&
                    (reported > 100000 ||
                        reported < offset + count ||
                        (total !== null && total !== reported))) ||
                offset + count > 100000
            ) {
                finish(true);
                return;
            }
            if (reported !== null) total = reported;
            var signature = JSON.stringify(
                rows.map(function (row) {
                    return row && [row.ratingKey, row.key, row.type];
                })
            );
            if (count && seenPages[signature]) {
                finish(true);
                return;
            }
            if (count) seenPages[signature] = true;
            page.forEach(function (record) {
                var playable =
                    record.request && record.stream_url && !record.playlist_url;
                var id = playable
                    ? "item:" + record.request.path
                    : record.playlist_url && record.playlist_url.path
                      ? "folder:" + record.playlist_url.path
                      : "";
                if (!id) return;
                if (seen[id]) return;
                seen[id] = true;
                characters += JSON.stringify(record).length;
                catalog.push(record);
                if (playable) collected.push(record);
            });
            if (characters > 8 * 1024 * 1024) {
                finish(true);
                return;
            }
            offset += count;
            if (
                (total !== null && offset === total) ||
                (total === null && count === 0)
            ) {
                finish();
            } else if (!count || pages >= 1000 || offset >= 100000) {
                finish(true);
            } else {
                // Yield between pages, including transports with synchronous
                // callbacks. Collection never walks into child directories.
                timer = w.setTimeout(function () {
                    timer = null;
                    next();
                }, 0);
            }
        }
        function next(): void {
            if (!active()) return;
            if (Date.now() - started >= 120000) {
                finish(true);
                return;
            }
            pages++;
            var owner: any = { xhr: null };
            pendingPage = owner;
            var params = {
                "X-Plex-Container-Size": 200,
                "X-Plex-Container-Start": offset,
            };
            function complete(data: any, error = false): void {
                if (!active() || pendingPage !== owner) return;
                pendingPage = null;
                if (error) finish(true);
                else accept(data);
            }
            try {
                var xhr = jq.ajax({
                    dataType: "text",
                    error: function () {
                        complete(null, true);
                    },
                    headers: {
                        Accept: "application/json",
                        "X-Plex-Container-Size": "200",
                        "X-Plex-Container-Start": String(offset),
                    },
                    success: function (raw: any) {
                        var data: any;
                        try {
                            data = plexContainer(raw, w);
                        } catch (_) {
                            complete(null, true);
                            return;
                        }
                        complete(data);
                    },
                    timeout: Math.min(
                        30000,
                        Math.max(1, 120000 - (Date.now() - started))
                    ),
                    type: "GET",
                    url: url(path, params),
                });
                if (pendingPage === owner) owner.xhr = xhr;
            } catch (_) {
                complete(null, true);
            }
        }
        cancelCollection = cancelOwned;
        if (!path) finish(true);
        else next();
        return cancelOwned;
    }
    function load(value: any, callback: any): void {
        cancel();
        var token = revision;
        var path = "/library/sections";
        var params: any = {
            "X-Plex-Container-Size": 200,
            "X-Plex-Container-Start": 0,
        };
        if (typeof value === "string" && /^plexsearch\?search=/.test(value)) {
            path = "/hubs/search";
            try {
                params.query = decodeURIComponent(
                    value.slice(value.indexOf("=") + 1)
                );
            } catch (_) {
                params.query = "";
            }
        } else if (
            value &&
            typeof value === "object" &&
            value.plexSource === source
        ) {
            path = plexPath(value.path);
            params["X-Plex-Container-Start"] = Math.max(
                0,
                Number(value.offset) || 0
            );
            if (typeof value.query === "string") params.query = value.query;
        } else if (value !== "" && value !== null && value !== undefined)
            path = "";
        function accept(data: any, error?: string): void {
            if (
                !current(token) ||
                (callback.isCurrent && !callback.isCurrent())
            )
                return;
            if (error) failure();
            if (data && path === "/hubs/search") {
                var found = items(data);
                var offset = Number(params["X-Plex-Container-Start"]) || 0;
                data = {
                    Metadata: found.slice(offset, offset + 200),
                    offset: offset,
                    size: Math.min(200, Math.max(0, found.length - offset)),
                    totalSize: found.length,
                };
            }
            var title = catalogTitle(value, data);
            w.mediaRecords = data
                ? records(data, path, params, true, title)
                : [];
            w.mediaName = title;
            callback();
        }
        if (!path) {
            accept(null, "Invalid catalog");
            return;
        }
        if (
            path === "/library/sections" &&
            sections &&
            Date.now() - sectionsAt < 15000
        )
            accept(sections);
        else if (path === "/hubs/search") {
            if (
                search &&
                search.query === params.query &&
                Date.now() - search.at < 15000
            )
                accept(search.data);
            else
                request(
                    path,
                    {
                        limit: 200,
                        query: params.query,
                        "X-Plex-Container-Size": 1000,
                        "X-Plex-Container-Start": 0,
                    },
                    token,
                    function (data, error) {
                        if (data)
                            search = {
                                at: Date.now(),
                                data: data,
                                query: params.query,
                            };
                        accept(data, error);
                    }
                );
        } else request(path, params, token, accept);
    }
    function codec(media: any, video: boolean): string {
        var name = String(
            video ? media.videoCodec : media.audioCodec
        ).toLowerCase();
        if (video) {
            if (name === "h264") return "avc1.42E01E";
            if (name === "hevc" || name === "h265") {
                var ten = plexRows(
                    plexRows(media.Part)[0] && plexRows(media.Part)[0].Stream
                ).some(function (stream) {
                    return (
                        Number(stream.streamType) === 1 &&
                        Number(stream.bitDepth) > 8
                    );
                });
                return ten ? "hvc1.2.4.L153.B0" : "hvc1.1.6.L123.B0";
            }
            return name === "vp9"
                ? "vp09.00.10.08"
                : name === "vp8"
                  ? "vp8"
                  : name === "av1"
                    ? "av01.0.08M.08"
                    : "";
        }
        return name === "aac"
            ? "mp4a.40.2"
            : name === "mp3"
              ? "mp3"
              : name === "opus" || name === "vorbis" || name === "flac"
                ? name
                : "";
    }
    function originalMime(media: any): string {
        var format = String(media.container || "").toLowerCase();
        if (/^(mp4|m4v|mov)$/.test(format)) return "video/mp4";
        if (format === "webm") return "video/webm";
        if (format === "mkv") return "video/x-matroska";
        if (format === "mp3") return "audio/mpeg";
        if (format === "flac") return "audio/flac";
        if (format === "m4a" || format === "aac") return "audio/mp4";
        if (format === "ogg" || format === "opus") return "audio/ogg";
        return "application/octet-stream";
    }
    function supports(media: any): boolean {
        var mime = originalMime(media);
        if (mime === "application/octet-stream" || mime === "video/x-matroska")
            return false;
        var video = codec(media, true),
            audio = codec(media, false);
        if (
            (!video && media.videoCodec) ||
            (!audio && media.audioCodec) ||
            (!video && !audio)
        )
            return false;
        try {
            return !!w.document
                .createElement("video")
                .canPlayType(
                    mime +
                        '; codecs="' +
                        [video, audio].filter(Boolean).join(",") +
                        '"'
                );
        } catch (_) {
            return false;
        }
    }
    function resolve(item: any, done: (item: any) => void): void {
        cancel();
        var token = revision;
        var finished = false;
        function finish(playable: any): void {
            if (finished || !current(token)) return;
            finished = true;
            if (!playable) failure();
            // A visible error may itself retire this source or navigate away.
            if (current(token)) done(playable);
        }
        if (
            !item ||
            item.plexSource !== source ||
            !item.request ||
            !/^\/library\/metadata\/\d+$/.test(item.request.path)
        ) {
            finish(null);
            return;
        }
        release();
        function run(): void {
            if (!current(token)) return;
            request(item.request.path, {}, token, function (data, error) {
                if (finished || !current(token)) return;
                if (error || !data) {
                    finish(null);
                    return;
                }
                var entry = items(data)[0];
                var media = entry && plexRows(entry.Media)[0];
                var part = media && plexRows(media.Part)[0];
                var path = part && plexPath(part.key);
                if (!path) {
                    finish(null);
                    return;
                }
                var playable = persist(item);
                playable.plexSource = source;
                if (
                    config!.playback === "original" ||
                    (config!.playback === "auto" && supports(media)) ||
                    !media.videoCodec
                ) {
                    playable.stream_url = url(path);
                    playable.__ottNativeFile = true;
                    playable.__ottPlexPlayback = {
                        mime: originalMime(media),
                        type: "file",
                    };
                    finish(playable);
                    return;
                }
                var active: any = {
                    id: clientId + "-" + ++sequence,
                    started: false,
                    url: "",
                };
                session = active;
                var params: any = {
                    audioBoost: 100,
                    directPlay: 0,
                    directStream: 1,
                    fastSeek: 1,
                    maxVideoBitrate: 12000,
                    mediaIndex: 0,
                    partIndex: 0,
                    path: item.request.path,
                    protocol: "hls",
                    session: active.id,
                    videoQuality: 100,
                    videoResolution: "1920x1080",
                    "X-Plex-Client-Identifier": clientId,
                    "X-Plex-Platform": "Chrome",
                    "X-Plex-Product": "OTTPlay",
                };
                var videoCodec = codec(media, true);
                var mse = false;
                try {
                    if (
                        /^hvc1\./.test(videoCodec) &&
                        w.Hls &&
                        typeof w.Hls.isSupported === "function" &&
                        w.Hls.isSupported() &&
                        w.MediaSource &&
                        w.MediaSource.isTypeSupported(
                            'video/mp4; codecs="' + videoCodec + '"'
                        )
                    ) {
                        mse = true;
                        params["X-Plex-Client-Profile-Extra"] =
                            "add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mp4&videoCodec=h264,hevc&audioCodec=aac&replace=true)";
                        if (Number(media.width) > 0 && Number(media.height) > 0)
                            params.videoResolution =
                                media.width + "x" + media.height;
                    }
                } catch (_) {
                    /* Unknown decoder capability keeps the compatible profile. */
                }
                request(
                    "/video/:/transcode/universal/decision",
                    params,
                    token,
                    function (decision, decisionError) {
                        if (finished || !current(token) || session !== active)
                            return;
                        if (
                            decisionError ||
                            !decision ||
                            Number(decision.transcodeDecisionCode || 1001) >=
                                2000
                        ) {
                            release();
                            finish(null);
                            return;
                        }
                        playable.stream_url = active.url = url(
                            "/video/:/transcode/universal/start.m3u8",
                            params
                        );
                        playable.__ottPlexPlayback = {
                            mime: "application/vnd.apple.mpegurl",
                            type: "hls",
                        };
                        if (mse) playable.__ottPlexPlayback.engine = "mse";
                        active.started = true;
                        try {
                            finish(playable);
                        } catch (error) {
                            if (session === active) release();
                            throw error;
                        }
                        if (session !== active) return;
                        active.timer = w.setInterval(function () {
                            if (session !== active || active.pending) return;
                            var finished = false;
                            var ping = control(
                                "/video/:/transcode/universal/ping",
                                active,
                                function () {
                                    finished = true;
                                    active.pending = null;
                                }
                            );
                            if (!finished && session === active)
                                active.pending = ping;
                        }, 30000);
                    }
                );
            });
        }
        if (releasing) waiting.push(run);
        else run();
    }
    function pagehide(): void {
        unloading = true;
        if (cancelPage) cancelPage();
        if (cancelCollection) cancelCollection();
        cancel();
        release();
        unloading = false;
    }
    if (typeof w.addEventListener === "function")
        w.addEventListener("pagehide", pagehide);
    return {
        canCollect: function (value: any): boolean {
            return !!collectionPath(value);
        },
        cancel: cancel,
        collect: collect,
        connect: function (done: (error?: string) => void) {
            cancel();
            var token = revision;
            var attempts = 0;
            function attempt() {
                connectTimer = null;
                if (!current(token)) return;
                attempts++;
                request(
                    "/library/sections",
                    {},
                    token,
                    function (data, error, retryable) {
                        if (retryable && attempts < 3) {
                            if (options.onRetry) options.onRetry();
                            if (current(token))
                                connectTimer = w.setTimeout(
                                    attempt,
                                    attempts * 2000
                                );
                            return;
                        }
                        if (data) {
                            sections = data;
                            sectionsAt = Date.now();
                        }
                        done(error);
                    }
                );
            }
            attempt();
            return function () {
                if (current(token)) cancel();
            };
        },
        dispose: function () {
            if (typeof w.removeEventListener === "function")
                w.removeEventListener("pagehide", pagehide);
            disposed = true;
            if (cancelPage) cancelPage();
            if (cancelCollection) cancelCollection();
            cancel();
            release();
            sections = null;
            search = null;
        },
        load: load,
        page: page,
        persist: persist,
        play: function (item: any) {
            resolve(item, function (playable) {
                w._playMedia(playable);
            });
        },
        resolve: resolve,
        stableRequests: true,
        stop: function (expected?: string) {
            if (session && expected && session.url !== expected) return;
            cancel();
            release();
        },
    };
}

(window as any).__ottPlex = {
    create: createPlexClient,
    normalize: normalizePlexConfig,
};
