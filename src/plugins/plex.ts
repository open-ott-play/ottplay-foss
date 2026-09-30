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
        done: (data: any, error?: string) => void
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
                error: function (_xhr: any, status: string) {
                    if (current(token) && status !== "abort")
                        done(null, "Plex connection failed");
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
    function records(container: any, path: string, params: any): any[] {
        var root = path === "/library/sections";
        var result: any[] = [];
        var section = /^\/library\/sections\/(\d+)\/all(?:\?|$)/.exec(path);
        if (section && !Number(params["X-Plex-Container-Start"]))
            result.push({
                playlist_url: target(
                    "/library/sections/" + section[1] + "/folder",
                    translate("Folders")
                ),
                title: translate("Folders"),
            });
        items(container).forEach(function (item) {
            var title = String(item.title || item.name || "");
            var key = plexPath(item.key);
            if (root && /^\d+$/.test(String(item.key)))
                key = "/library/sections/" + item.key + "/all";
            var playable =
                /^(?:movie|episode|clip|track)$/.test(item.type) ||
                plexRows(item.Media).length > 0;
            var id = String(item.ratingKey || "");
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
        if (count > 0 && Number(container.totalSize) > offset + count)
            result.push({
                playlist_url: {
                    offset: offset + count,
                    path: path,
                    plexSource: source,
                    query: params.query,
                    title: String(
                        container.title2 ||
                            container.title1 ||
                            options.title ||
                            "Plex"
                    ),
                },
                title: translate("Next"),
            });
        if (root)
            result.push({
                playlist_url: "plexsearch",
                search_on: 1,
                title: translate("Search"),
            });
        return result;
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
            w.mediaRecords = data ? records(data, path, params) : [];
            w.mediaName = String(
                (data && (data.title2 || data.title1)) ||
                    (value && value.title) ||
                    options.title ||
                    "Plex"
            );
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
        if (
            !item ||
            item.plexSource !== source ||
            !item.request ||
            !/^\/library\/metadata\/\d+$/.test(item.request.path)
        ) {
            failure();
            return;
        }
        release();
        function run(): void {
            if (!current(token)) return;
            request(item.request.path, {}, token, function (data, error) {
                if (error || !data) {
                    failure();
                    return;
                }
                var entry = items(data)[0];
                var media = entry && plexRows(entry.Media)[0];
                var part = media && plexRows(media.Part)[0];
                var path = part && plexPath(part.key);
                if (!path) {
                    failure();
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
                    done(playable);
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
                        if (!current(token) || session !== active) return;
                        if (
                            decisionError ||
                            !decision ||
                            Number(decision.transcodeDecisionCode || 1001) >=
                                2000
                        ) {
                            release();
                            failure();
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
                            done(playable);
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
        cancel();
        release();
        unloading = false;
    }
    if (typeof w.addEventListener === "function")
        w.addEventListener("pagehide", pagehide);
    return {
        cancel: cancel,
        connect: function (done: (error?: string) => void) {
            cancel();
            var token = revision;
            request("/library/sections", {}, token, function (data, error) {
                if (data) {
                    sections = data;
                    sectionsAt = Date.now();
                }
                done(error);
            });
            return function () {
                if (current(token)) cancel();
            };
        },
        dispose: function () {
            if (typeof w.removeEventListener === "function")
                w.removeEventListener("pagehide", pagehide);
            disposed = true;
            cancel();
            release();
            sections = null;
            search = null;
        },
        load: load,
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
