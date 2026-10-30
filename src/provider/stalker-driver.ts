interface StalkerConfiguration {
    active: number;
    portals: Array<{ name: string; portal: string; mac: string }>;
}

/** The old singleton becomes slot zero without changing its account or storage keys. */
function normalizeStalkerConfiguration(value: any): StalkerConfiguration {
    var input = value && typeof value === "object" ? value : {};
    var slots = Array.isArray(input.portals) ? input.portals : [input];
    var active = Number(input.active);
    var result: StalkerConfiguration = {
        active:
            active >= 0 && active < 15 && Math.floor(active) === active
                ? active
                : 0,
        portals: [],
    };
    for (var index = 0; index < 15; index++) {
        var row = slots[index] || {};
        result.portals.push({
            mac: typeof row.mac === "string" ? row.mac : "",
            name: typeof row.name === "string" ? row.name : "",
            portal: typeof row.portal === "string" ? row.portal : "",
        });
    }
    return result;
}

/** Instance lifecycles for classic MAG and the retained MAC JSON-RPC dialect. */
function classicStalkerUrl(url: string): string {
    var clean = url.split(/[?#]/)[0].replace(/\/+$/, "");
    if (/\/stalker_portal$/i.test(clean)) return clean + "/c/";
    return /\/(?:c(?:\/index\.html)?|(?:server\/)?load\.php|portal\.php)$/i.test(
        clean
    )
        ? clean
        : "";
}

var classicStalkerSequence = 0;

interface StalkerProviderDriver extends ProviderDriver {
    catalogError(): boolean;
    catalogLoading(): boolean;
    hasMediaKey(key: string): boolean;
    mediaClient(): any;
    startMedia(): void;
}

/** Collect only core-returned folders; the visible surface remains the channel list. */
function createStalkerMedia(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    current: () => boolean,
    client: any,
    root: any,
    send: (request: any, scope: DriverLifetime, done: any, fail: any) => void,
    publish: (items: any[]) => void
) {
    var discovery = ports.createLifetime();
    var resolution = ports.createLifetime();
    var state = "idle",
        host: any = null;
    var timer: any = null,
        deadline: any = null;
    var queue: any[] = [],
        cursor = 0,
        records: any[] = [];
    var recordsByKey: Record<string, any> = Object.create(null);
    var seen: Record<string, boolean> = Object.create(null);
    var folders = 0,
        bytes = 0;
    var source = ports.sourceIdentity ? ports.sourceIdentity() : "stalker";
    function active() {
        return current() && owner.active();
    }
    function escape(value: any): string {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    function key(path: any[], id: string): string {
        var codes: Record<string, string> = {
            "portal-category": "c",
            "portal-episode": "e",
            "portal-movie": "m",
            "portal-season": "s",
        };
        try {
            var compact = path.map(function (part) {
                if (!codes[part.type]) throw new Error();
                return [
                    codes[part.type],
                    decodeURIComponent(
                        part.id.slice(part.id.lastIndexOf(":") + 1)
                    ),
                ];
            });
            compact.push([
                "v",
                decodeURIComponent(id.slice(id.lastIndexOf(":") + 1)),
            ]);
            var input = encodeURIComponent(JSON.stringify(compact)).replace(
                /%([0-9A-F]{2})/g,
                function (_, hex) {
                    return String.fromCharCode(parseInt(hex, 16));
                }
            );
            var alphabet =
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
                output = "";
            for (var i = 0; i < input.length; i += 3) {
                var value =
                    (input.charCodeAt(i) << 16) |
                    ((input.charCodeAt(i + 1) || 0) << 8) |
                    (input.charCodeAt(i + 2) || 0);
                output +=
                    alphabet[(value >>> 18) & 63] +
                    alphabet[(value >>> 12) & 63];
                if (i + 1 < input.length)
                    output += alphabet[(value >>> 6) & 63];
                if (i + 2 < input.length) output += alphabet[value & 63];
            }
            return output.length <= 242 ? "stalker-media:" + output : "";
        } catch (_) {
            return "";
        }
    }
    function record(item: any, path: any[], categories: any[]): any {
        var identity = key(path, item.id);
        if (!identity) throw new Error("identity_limit");
        return {
            __ottMediaCategories: categories,
            __ottMediaCollection: categories
                .map(function (part) {
                    return part.name;
                })
                .join(" / "),
            adult: item.adult ? 1 : 0,
            description:
                "<b>" +
                escape(item.name) +
                "</b>" +
                (item.description ? "<br>" + escape(item.description) : ""),
            itemId: identity,
            logo_30x30: item.logo || "",
            request: {
                id: item.id,
                key: identity,
                kind: "stalker-media",
                path: path.map(function (part) {
                    return { id: part.id, type: part.type };
                }),
            },
            stalkerSource: source,
            title: String(item.name || "").slice(0, 512),
        };
    }
    function run(
        operation: any,
        scope: DriverLifetime,
        budget: any,
        done: any,
        fail: any
    ) {
        if (!active() || !scope.active()) return;
        if (ports.now() >= budget.deadline) return fail();
        if (!operation || operation.failure) return fail();
        var request: any;
        try {
            request = operation.request();
        } catch (_) {
            return fail();
        }
        if (!request) {
            try {
                done(operation.result());
            } catch (_) {
                fail();
            }
            return;
        }
        if (++budget.requests > 5000) return fail();
        send(
            request,
            scope,
            function (data: any) {
                if (!active() || !scope.active()) return;
                if (ports.now() >= budget.deadline) return fail();
                var error: any;
                try {
                    error = operation.accept(data);
                } catch (_) {
                    return fail();
                }
                if (error) return fail();
                run(operation, scope, budget, done, fail);
            },
            fail
        );
    }
    function finish(failed: boolean) {
        if (state !== "loading") return;
        state = failed ? "partial" : "complete";
        if (timer !== null) window.clearTimeout(timer);
        if (deadline !== null) window.clearTimeout(deadline);
        timer = deadline = null;
        queue = [];
        discovery.dispose();
        if (failed && active() && host && typeof host.showShift === "function")
            host.showShift(
                host._("Media Library") + ": " + host._("Failed to load!")
            );
    }
    function start() {
        if (!active() || state !== "idle" || !root) return;
        state = "loading";
        var scope = discovery.activate("stalker-media-catalog");
        var budget = { deadline: ports.now() + 120, requests: 0 };
        queue = [{ categories: [], node: root, path: [] }];
        cursor = 0;
        deadline = window.setTimeout(function () {
            finish(true);
        }, 120000);
        function next() {
            timer = null;
            if (!active() || !scope.active()) return;
            var job = queue[cursor];
            queue[cursor++] = null;
            if (!job) return finish(false);
            run(
                client.browse(job.node),
                scope,
                budget,
                function (result: any) {
                    if (!Array.isArray(result.items)) return finish(true);
                    var batch: any[] = [];
                    try {
                        result.items.forEach(function (item: any) {
                            if (item.kind === "folder") {
                                if (
                                    job.path.length >= 8 ||
                                    ++folders > 5000 ||
                                    job.path.some(function (part: any) {
                                        return (
                                            part.id === item.id &&
                                            part.type === item.folderType
                                        );
                                    })
                                )
                                    throw new Error("folder_limit");
                                var path = job.path.concat([
                                    { id: item.id, type: item.folderType },
                                ]);
                                var signature = JSON.stringify(path);
                                if (seen[signature]) return;
                                seen[signature] = true;
                                queue.push({
                                    categories: job.categories.concat([
                                        {
                                            id: "stalker-category:" + signature,
                                            name: item.name,
                                        },
                                    ]),
                                    node: item,
                                    path: path,
                                });
                            } else if (item.kind === "vod") {
                                var entry = record(
                                    item,
                                    job.path,
                                    job.categories
                                );
                                if (seen[entry.itemId]) return;
                                if (records.length + batch.length >= 50000)
                                    throw new Error("item_limit");
                                bytes += JSON.stringify(entry).length * 2;
                                if (bytes > 67108864)
                                    throw new Error("metadata_limit");
                                seen[entry.itemId] = true;
                                batch.push(entry);
                            }
                        });
                    } catch (_) {
                        return finish(true);
                    }
                    if (ports.now() >= budget.deadline) return finish(true);
                    if (batch.length) {
                        publish(batch);
                        if (!active() || !scope.active()) return;
                        batch.forEach(function (entry) {
                            records.push(entry);
                            recordsByKey[entry.itemId] = entry;
                        });
                    }
                    if (active() && scope.active())
                        timer = window.setTimeout(next, 0);
                },
                function () {
                    finish(true);
                }
            );
        }
        next();
    }
    function cancel() {
        resolution.dispose();
    }
    var api = {
        attach: function (value: any) {
            host = value;
        },
        cancel: cancel,
        catalogError: function () {
            return state === "partial";
        },
        catalogLoading: function () {
            return active() && state === "loading";
        },
        dispose: function () {
            finish(false);
            state = "cancelled";
            discovery.dispose();
            resolution.dispose();
            records = [];
            queue = [];
            recordsByKey = Object.create(null);
        },
        hasMediaKey: function (key: string) {
            return active() && !!recordsByKey[key];
        },
        load: function (_: any, done: any) {
            if (!host || !active()) return;
            host.mediaRecords = records.slice();
            host.mediaName = host._("Stalker Portal Provider");
            done();
        },
        persist: function (item: any) {
            return {
                adult: item.adult,
                itemId: item.itemId,
                request: JSON.parse(JSON.stringify(item.request)),
                title: item.title,
            };
        },
        resolve: function (saved: any, done: any, automatic?: boolean) {
            cancel();
            var request = saved && saved.request;
            if (
                !active() ||
                !request ||
                request.kind !== "stalker-media" ||
                typeof request.id !== "string" ||
                request.id.length > 2048 ||
                !Array.isArray(request.path) ||
                request.path.length < 1 ||
                request.path.length > 8 ||
                request.path.some(function (part: any) {
                    return (
                        !part ||
                        typeof part.id !== "string" ||
                        part.id.length > 2048 ||
                        typeof part.type !== "string"
                    );
                }) ||
                key(request.path, request.id) !== request.key ||
                !request.key
            )
                return done(null);
            // The media host attaches this launch identity before resolution.
            // Retain only its current source/key pair when replacing metadata.
            var reference = saved.__ottMediaRef;
            if (
                reference &&
                (reference.sourceId !== source ||
                    reference.itemId !== "provider:" + request.key)
            )
                return done(null);
            reference = reference
                ? { itemId: reference.itemId, sourceId: reference.sourceId }
                : null;
            request = {
                id: request.id,
                key: request.key,
                kind: request.kind,
                path: request.path.map(function (part: any) {
                    return { id: part.id, type: part.type };
                }),
            };
            var scope = resolution.activate("stalker-media-playback"),
                settled = false;
            var budget = { deadline: ports.now() + 60, requests: 0 },
                timeout: any = null;
            function valid() {
                return (
                    active() &&
                    scope.active() &&
                    (!done.isCurrent || done.isCurrent())
                );
            }
            function finishResolve(value: any) {
                if (settled || !valid()) return;
                settled = true;
                if (timeout !== null) window.clearTimeout(timeout);
                scope.dispose();
                done(ports.now() >= budget.deadline ? null : value);
            }
            timeout = window.setTimeout(function () {
                finishResolve(null);
                scope.dispose();
            }, 60000);
            scope.own(function () {
                if (timeout !== null) window.clearTimeout(timeout);
            });
            function walk(node: any, index: number, categories: any[]) {
                run(
                    client.browse(node),
                    scope,
                    budget,
                    function (result: any) {
                        if (!valid()) return;
                        var part = request.path[index];
                        var matches = (result.items || []).filter(function (
                            item: any
                        ) {
                            return part
                                ? item.id === part.id &&
                                      item.folderType === part.type
                                : item.id === request.id && item.kind === "vod";
                        });
                        if (matches.length !== 1) return finishResolve(null);
                        var item = matches[0];
                        if (part)
                            return walk(
                                item,
                                index + 1,
                                categories.concat([
                                    {
                                        id:
                                            "stalker-category:" +
                                            JSON.stringify(
                                                request.path.slice(0, index + 1)
                                            ),
                                        name: item.name,
                                    },
                                ])
                            );
                        // Capture the core operation before a PIN dialog yields: another
                        // catalog branch may reuse the same provider-local leaf ID.
                        var playback = client.playback(item);
                        function play() {
                            if (!valid()) return;
                            var entry = record(item, request.path, categories);
                            if (reference) entry.__ottMediaRef = reference;
                            run(
                                playback,
                                scope,
                                budget,
                                function (result: any) {
                                    if (!result.url) return finishResolve(null);
                                    entry.stream_url = result.url;
                                    finishResolve(entry);
                                },
                                function () {
                                    finishResolve(null);
                                }
                            );
                        }
                        function locked() {
                            return (
                                host &&
                                (host.__ottParental
                                    ? host.__ottParental.needs("channels")
                                    : host.sPSchannels &&
                                      host.parentPIN !== "*" &&
                                      !host.parentAccess)
                            );
                        }
                        if (item.adult && locked()) {
                            if (
                                automatic ||
                                typeof host.enterPinAndSetAccess !== "function"
                            )
                                return finishResolve(null);
                            host.enterPinAndSetAccess(
                                function () {
                                    if (locked()) finishResolve(null);
                                    else play();
                                },
                                function () {
                                    finishResolve(null);
                                }
                            );
                        } else play();
                    },
                    function () {
                        finishResolve(null);
                    }
                );
            }
            walk(root, 0, []);
        },
        stableRequests: true,
        stalker: true,
        start: start,
    };
    owner.own(api.dispose);
    return api;
}

/** HTTP/JSON and classic-view codecs; handshake, paging and link policy stay in core. */
function createClassicStalkerDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    helpers: StalkerDriverHelpers,
    credentials: ProviderCredentials,
    current: () => boolean
): StalkerProviderDriver {
    var alive = true;
    var lifetime = ports.createLifetime();
    var scope = lifetime.activate("classic-stalker");
    var prefix = "ottplay-stalker:" + ++classicStalkerSequence + ":";
    var catalog = helpers.emptyCatalog();
    var nodes: Record<string, any> = Object.create(null);
    var rawRows: Record<string, any> = Object.create(null);
    var headers: Record<string, string> = {};
    var media: any = null;
    var config: any = {
        bulkCatalog: true,
        id: "classic-stalker",
        language: ports.language ? ports.language() : "en",
        mac: credentials.username,
        preferHls: !ports.isDune(),
        profile: { stb_type: "MAG250" },
        timezone: "Etc/UTC",
        url: classicStalkerUrl(credentials.server),
    };
    var location = ports.core.stalkerConfig(config);
    Object.keys(location).forEach(function (key) {
        config[key] = location[key];
    });
    function active() {
        return alive && owner.active() && scope.active() && current();
    }
    var transport = helpers.transport(ports, owner, active);
    function absolute(value: string): string {
        if (!value) return "";
        try {
            var url = new URL(value, config.referer);
            return /^https?:$/.test(url.protocol) &&
                !url.username &&
                !url.password
                ? url.href
                : "";
        } catch (_) {
            return "";
        }
    }
    var client = config.failure
        ? null
        : new ports.core.StalkerClient(
              config,
              1,
              encodeURIComponent,
              absolute,
              absolute
          );
    function send(
        request: any,
        current: DriverLifetime,
        done: (data: any) => void,
        fail: (...args: any[]) => void
    ) {
        if (!active() || !current.active()) return;
        var native = ports.m3u && ports.m3u.native();
        var relay: string | null =
            (ports.relay || "").replace(/\/+$/, "") + "/stalker/api";
        if (!native && ports.hostedStalkerRoute) {
            try {
                relay = ports.hostedStalkerRoute(config.endpoint);
            } catch (_) {
                relay = null;
            }
            if (!relay) {
                fail();
                return;
            }
        }
        transport.send(
            current,
            native
                ? {
                      dataType: "json",
                      headers: request.headers,
                      timeout: 15000,
                      type: "GET",
                      url: request.url,
                  }
                : {
                      contentType: "application/json",
                      data: JSON.stringify({
                          headers: request.headers,
                          url: request.url,
                      }),
                      dataType: "json",
                      timeout: 20000,
                      type: "POST",
                      url: relay,
                  },
            done,
            fail
        );
    }
    function run(
        operation: any,
        current: DriverLifetime,
        done: (result: any) => void,
        fail: (auth?: boolean) => void,
        retryHandshake?: boolean
    ) {
        if (!active() || !current.active()) return;
        if (!operation || operation.failure) {
            fail();
            return;
        }
        var request = operation.request();
        if (!request) {
            done(operation.result());
            return;
        }
        headers = request.headers;
        send(
            request,
            current,
            function (data) {
                var response = data && data.js;
                if (
                    /[?&]type=itv(?:&|$)/.test(request.url) &&
                    /[?&]action=get_(?:all_channels|ordered_list)(?:&|$)/.test(
                        request.url
                    ) &&
                    response &&
                    Array.isArray(response.data)
                )
                    response.data.forEach(function (row: any) {
                        if (row && row.id != null)
                            rawRows[String(row.id)] = row;
                    });
                var error = operation.accept(data);
                if (error) {
                    // Some portals return HTTP 200 with an empty handshake.
                    // Retry initial loading once, without retrying denial.
                    if (
                        retryHandshake &&
                        /[?&]action=handshake(?:&|$)/.test(request.url) &&
                        (response == null ||
                            (typeof response === "object" &&
                                Object.keys(response).length === 0))
                    )
                        run(client.load(), current, done, fail);
                    else fail(!!(response && response.not_valid_token));
                    return;
                }
                run(operation, current, done, fail, retryHandshake);
            },
            function (xhr: any) {
                if (operation.reject((xhr && xhr.status) || 0))
                    run(operation, current, done, fail);
                else fail(!!xhr && (xhr.status === 401 || xhr.status === 403));
            }
        );
    }
    function build(result: any) {
        var rows: any[] = [];
        nodes = Object.create(null);
        result.channels.forEach(function (item: any) {
            if (item.kind !== "live") return;
            var id = decodeURIComponent(
                item.id.slice(item.id.lastIndexOf(":") + 1)
            );
            var raw = rawRows[id] || {};
            var reference = prefix + encodeURIComponent(item.id);
            nodes[reference] = { id: id, item: item, raw: raw };
            rows.push({
                genre: item.group,
                id: id,
                logo: absolute(raw.logo || item.logo),
                name: raw.name || item.name,
                url: reference,
            });
        });
        // Project through the existing shared catalog identity codec.
        var projection = new ports.core.LegacyStalkerClient(
            credentials.server,
            credentials.username
        );
        projection.accept({ result: {} });
        projection.accept({ result: rows });
        catalog = ports.channelCatalog!(
            projection.channelCatalog(),
            ports.hash,
            "stalker"
        );
    }
    function dispose() {
        alive = false;
        if (media) media.dispose();
        lifetime.dispose();
        transport.dispose();
        nodes = Object.create(null);
        rawRows = Object.create(null);
        headers = {};
        catalog = helpers.emptyCatalog();
    }
    owner.own(dispose);
    return {
        archive: function () {
            return "";
        },
        capabilities: {
            archive: false,
            guide: true,
            media: true,
            mediaPlaylist: true,
            settings: true,
        },
        catalogError: function () {
            return !!media && media.catalogError();
        },
        catalogLoading: function () {
            return !!media && media.catalogLoading();
        },
        credentials: function () {
            return credentials;
        },
        dispose: dispose,
        guide: function (id, done) {
            var row = active() && catalog.channels[id];
            var node = row && nodes[row.url];
            if (!node) {
                done(null);
                return;
            }
            send(
                {
                    headers: headers,
                    url:
                        config.endpoint +
                        "?type=itv&action=get_short_epg&ch_id=" +
                        encodeURIComponent(node.id) +
                        "&size=100&JsHttpRequest=1-xml",
                },
                scope,
                function (data) {
                    var entries = data && data.js;
                    if (!Array.isArray(entries)) {
                        done(null);
                        return;
                    }
                    var adapted = entries.map(function (entry: any) {
                        return {
                            descr: entry.descr,
                            end_timestamp:
                                entry.stop_timestamp || entry.end_timestamp,
                            name: entry.name,
                            start_timestamp: entry.start_timestamp,
                        };
                    });
                    done(
                        new ports.core.LegacyStalkerClient("", "").guide({
                            result: adapted,
                        })
                    );
                },
                function () {
                    done(null);
                }
            );
        },
        hasMediaKey: function (key) {
            return !!media && media.hasMediaKey(key);
        },
        id: "stalker",
        load: function (done) {
            if (!client) {
                done(null, "credentials");
                return;
            }
            ports.progress("Connecting to Stalker portal...");
            run(
                client.load(),
                scope,
                function (result) {
                    build(result);
                    var roots = result.channels.filter(function (item: any) {
                        return item.folderType === "portal-vod";
                    });
                    if (roots.length === 1)
                        media = createStalkerMedia(
                            ports,
                            scope,
                            active,
                            client,
                            roots[0],
                            send,
                            function (items) {
                                var projected = ports.channelCatalog!(
                                    items.map(function (item) {
                                        var category =
                                            item.__ottMediaCategories[
                                                item.__ottMediaCategories
                                                    .length - 1
                                            ];
                                        return {
                                            groupId: category
                                                ? category.id
                                                : "stalker-vod",
                                            groupName:
                                                item.__ottMediaCollection ||
                                                "Movies",
                                            itemId: item.itemId,
                                            logo: item.logo_30x30,
                                            name: item.title,
                                            providerId: "",
                                            url: "stalker:media",
                                        };
                                    }),
                                    ports.hash,
                                    "stalker"
                                );
                                projected.ids.forEach(function (id) {
                                    if (catalog.channels[id])
                                        throw new Error(
                                            "Stalker media identity collision"
                                        );
                                });
                                projected.ids.forEach(function (id, index) {
                                    var row = projected.channels[id],
                                        item = items[index];
                                    row.adult = item.adult;
                                    row.__ottMediaItem = item;
                                    row.__ottMediaProvider = "stalker";
                                    row.__ottMediaCollection =
                                        item.__ottMediaCollection;
                                    row.__ottMediaCategories =
                                        item.__ottMediaCategories;
                                    row.__ottStalkerMediaKey = item.itemId;
                                    catalog.channels[id] = row;
                                    catalog.ids.push(id);
                                });
                                projected.incremental = true;
                                done(projected);
                            }
                        );
                    done(helpers.snapshot(catalog));
                },
                function () {
                    done(helpers.emptyCatalog(), "stalker-connect");
                },
                true
            );
        },
        logo: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].logo
                : "";
        },
        mediaClient: function () {
            return active() ? media : null;
        },
        resolveStream: function (url, done) {
            var requestLife = ports.createLifetime();
            var requestScope = requestLife.activate("link");
            var node = active() && nodes[url];
            if (!node) {
                done(url.indexOf("ottplay-stalker:") === 0 ? null : url);
                return function () {};
            }
            // A direct command explicitly marked non-temporary needs no create_link.
            var raw = node.raw;
            var direct = String(raw.cmd || "").replace(
                /^(?:ffmpeg|ffrt)\s+/i,
                ""
            );
            if (
                raw.use_http_tmp_link != null &&
                Number(raw.use_http_tmp_link) === 0 &&
                !Number(raw.wowza_tmp_link) &&
                !Number(raw.use_load_balancing) &&
                !Number(raw.nginx_secure_link) &&
                /^https?:\/\//i.test(direct) &&
                !/^https?:\/\/(?:localhost|127\.|\[::1\])/i.test(direct)
            ) {
                done(client.streamUrl(direct));
            } else {
                var retried = false;
                function resolve() {
                    run(
                        client.playback(node.item),
                        requestScope,
                        function (result) {
                            done(result.url || null);
                        },
                        function (auth) {
                            if (!auth || retried) {
                                done(null);
                                return;
                            }
                            retried = true;
                            run(
                                client.load(),
                                requestScope,
                                resolve,
                                function () {
                                    done(null);
                                }
                            );
                        }
                    );
                }
                resolve();
            }
            return function () {
                requestLife.dispose();
            };
        },
        saveCredentials: function () {},
        startMedia: function () {
            if (active() && media) media.start();
        },
        stream: function (id) {
            return active() && catalog.channels[id]
                ? catalog.channels[id].url
                : "";
        },
    };
}

interface StalkerDriverHelpers {
    emptyCatalog(): DriverCatalog;
    snapshot(catalog: DriverCatalog): DriverCatalog;
    transport(
        ports: ProviderDriverPorts,
        owner: DriverLifetime,
        active: () => boolean
    ): {
        dispose(): void;
        send(
            scope: DriverLifetime,
            request: DriverHttpRequest,
            done: (value: any) => void,
            fail: () => void
        ): void;
    };
}

function createStalkerProviderDriver(
    ports: ProviderDriverPorts,
    owner: DriverLifetime,
    helpers: StalkerDriverHelpers
): StalkerProviderDriver {
    var disposed = false;
    var revision = 0;
    var catalogs = ports.createLifetime();
    var catalog = helpers.emptyCatalog();
    var loaded: ProviderCredentials | null = null;
    var classic: StalkerProviderDriver | null = null;
    function retireClassic() {
        var previous = classic;
        classic = null;
        if (previous) previous.dispose();
        driver.capabilities.media = false;
        driver.capabilities.mediaPlaylist = false;
    }
    function active(): boolean {
        return !disposed && owner.active();
    }
    var transport = helpers.transport(ports, owner, active);
    function configuration(): StalkerConfiguration {
        var value: any;
        try {
            value = JSON.parse(ports.storage.get("stalker_data") || "null");
        } catch (_) {}
        return normalizeStalkerConfiguration(value);
    }
    function credentials(): ProviderCredentials {
        var config = configuration();
        var value = config.portals[config.active];
        return {
            mode: config.active,
            password: "",
            server: value.portal,
            username: value.mac,
        };
    }
    function matches(config: ProviderCredentials): boolean {
        var current = credentials();
        return (
            active() &&
            current.mode === config.mode &&
            current.server === config.server &&
            current.username === config.username
        );
    }
    function client(config: ProviderCredentials): any {
        return new ports.core.LegacyStalkerClient(
            config.server,
            config.username
        );
    }
    function post(
        scope: DriverLifetime,
        config: ProviderCredentials,
        source: any,
        data: any,
        timeout: number,
        receive: (value: any) => void
    ): void {
        transport.send(
            scope,
            {
                contentType: "application/json",
                data: JSON.stringify(data),
                dataType: "json",
                timeout: timeout,
                type: "POST",
                url: source.endpoint(),
            },
            function (value) {
                if (matches(config)) receive(value);
            },
            function () {
                if (matches(config)) receive(null);
            }
        );
    }
    function row(id: string | number): any {
        return loaded && matches(loaded) ? catalog.channels[id] : null;
    }
    var driver: StalkerProviderDriver = {
        archive: function (id, start, end) {
            if (classic) return classic.archive(id, start, end);
            var channel = row(id);
            return channel
                ? ports.core.providerArchiveUrl(
                      "template",
                      channel.url || "",
                      channel.caso || "",
                      channel.ca || "",
                      Number(start),
                      Number(end),
                      ports.now(),
                      ports.isDune(),
                      0
                  ) || ""
                : "";
        },
        capabilities: {
            archive: true,
            guide: true,
            media: false,
            settings: true,
        },
        catalogError: function () {
            return !!classic && classic.catalogError();
        },
        catalogLoading: function () {
            return !!classic && classic.catalogLoading();
        },
        configuration: configuration,
        credentials: credentials,
        dispose: function () {
            if (disposed) return;
            disposed = true;
            retireClassic();
            revision++;
            catalogs.dispose();
            transport.dispose();
            loaded = null;
            catalog = helpers.emptyCatalog();
        },
        guide: function (id, callback) {
            if (classic) return classic.guide(id, callback);
            if (!active()) return;
            var channel = row(id);
            var scope = catalogs.current();
            if (!loaded || !scope || !channel || !channel.epg) {
                callback(null);
                return;
            }
            var config = loaded;
            var source = client(config);
            post(
                scope,
                config,
                source,
                source.guideRequest(channel.epg, ports.now),
                10000,
                function (response) {
                    callback(source.guide(response));
                }
            );
        },
        hasMediaKey: function (key) {
            return !!classic && classic.hasMediaKey(key);
        },
        id: "stalker",
        load: function (callback) {
            if (!active()) return;
            var operation = ++revision;
            retireClassic();
            var scope = catalogs.activate("catalog");
            if (!active() || !scope.active() || operation !== revision) return;
            loaded = null;
            catalog = helpers.emptyCatalog();
            var config = credentials();
            var valid =
                config.server &&
                config.username &&
                ports.validateUrl(config.server);
            if (!active() || !scope.active() || operation !== revision) return;
            if (!valid) {
                callback(null, "credentials");
                return;
            }
            if (classicStalkerUrl(config.server)) {
                classic = createClassicStalkerDriver(
                    ports,
                    scope,
                    helpers,
                    config,
                    function () {
                        return matches(config);
                    }
                );
                driver.capabilities.media = true;
                driver.capabilities.mediaPlaylist = true;
                classic.load(callback);
                return;
            }
            var source = client(config);
            ports.progress("Connecting to Stalker portal...");
            function advance(): void {
                if (!scope.active() || !matches(config)) return;
                var request = source.request();
                if (!request) {
                    var parsed = ports.channelCatalog!(
                        source.channelCatalog(),
                        ports.hash,
                        "stalker"
                    );
                    if (!scope.active() || !matches(config)) return;
                    catalog = parsed;
                    loaded = config;
                    callback(helpers.snapshot(catalog));
                    return;
                }
                if (request.method === "get_channels")
                    ports.progress("Loading channels...");
                if (!scope.active() || !matches(config)) return;
                post(
                    scope,
                    config,
                    source,
                    request,
                    15000,
                    function (response) {
                        var error = source.accept(response);
                        if (error)
                            callback(
                                helpers.snapshot(catalog),
                                error.failure === "LEGACY_CONNECT"
                                    ? "stalker-connect"
                                    : "stalker-catalog"
                            );
                        else advance();
                    }
                );
            }
            advance();
        },
        logo: function (id) {
            if (classic) return classic.logo(id);
            var channel = row(id);
            return channel ? channel.logo || "" : "";
        },
        mediaClient: function () {
            return classic && classic.mediaClient();
        },
        resolveStream: function (url, callback) {
            if (classic) return classic.resolveStream!(url, callback);
            callback(url.indexOf("ottplay-stalker:") === 0 ? null : url);
            return function () {};
        },
        saveConfiguration: function (value, admission?: () => boolean) {
            if (!active() || (admission && !admission())) return false;
            var next = normalizeStalkerConfiguration(value);
            var before = configuration();
            var operation = ++revision;
            var previous = before.portals[before.active];
            var selected = next.portals[next.active];
            function current() {
                return (
                    active() &&
                    operation === revision &&
                    (!admission || admission())
                );
            }
            if (
                !ports.commit(
                    { stalker_data: JSON.stringify(next) },
                    current,
                    current
                ) ||
                !current()
            )
                return false;
            if (
                next.active !== before.active ||
                selected.portal !== previous.portal ||
                selected.mac !== previous.mac
            ) {
                retireClassic();
                if (!active() || operation !== revision) return false;
                catalogs.dispose();
                if (!active() || operation !== revision) return false;
                loaded = null;
                catalog = helpers.emptyCatalog();
            }
            return (
                active() &&
                operation === revision &&
                (!admission || admission())
            );
        },
        saveCredentials: function (value) {
            var config = configuration();
            if (value.mode !== undefined && value.mode !== config.active)
                return false;
            var slot = config.portals[config.active];
            slot.portal = value.server;
            slot.mac = value.username;
            return driver.saveConfiguration!(config);
        },
        startMedia: function () {
            if (classic) classic.startMedia();
        },
        storageKey: function (key) {
            var slot = configuration().active;
            return (
                "stalker" +
                key +
                (slot && ports.m3u && ports.m3u.scopedKeys().indexOf(key) !== -1
                    ? String(slot)
                    : "")
            );
        },
        stream: function (id) {
            if (classic) return classic.stream(id);
            var channel = row(id);
            return channel ? channel.url || "" : "";
        },
    };
    owner.own(driver.dispose);
    return driver;
}

/** Retained menu projection. Draft edits and callbacks belong to this mounted instance. */
function mountStalkerProviderSettings(
    host: any,
    driver: ProviderDriver,
    owner: DriverLifetime
) {
    var revision = 0;
    driver.settingsChanged = function () {
        revision++;
    };
    function text(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    function profileLabel(
        slot: StalkerConfiguration["portals"][number]
    ): string {
        return text(
            slot.name ||
                slot.portal.replace(/^https?:\/\//, "").split("/")[0] ||
                "—"
        );
    }
    function openList(title: string): void {
        host.listDetail.innerHTML = "";
        host.listCaption.innerHTML = title;
        host.listFooter.innerHTML = host.renderButtonHint(
            host.keys.RETURN,
            host.strRETURN,
            "Close"
        );
        host.$("#listPopUp").hide();
        host.showPage();
    }
    function load(config: StalkerConfiguration): void {
        revision++;
        if (!driver.saveConfiguration!(config) || !owner.active()) return;
        updateLabel();
        host.loadChannels();
    }
    function menuTitle(): string {
        var config: StalkerConfiguration = driver.configuration!();
        return (
            host._("Stalker portal settings") +
            ": " +
            (config.active + 1) +
            " - " +
            profileLabel(config.portals[config.active])
        );
    }
    function updateLabel(): void {
        if (!owner.active()) return;
        var index = host.popupActions.indexOf(edit);
        if (index < 0) return;
        host.popupArray[index] = menuTitle();
    }
    function edit(selected?: number): boolean {
        if (!owner.active()) return false;
        var editor = ++revision;
        var config: StalkerConfiguration = driver.configuration!();
        var before = JSON.stringify(config);
        function current(): boolean {
            return (
                owner.active() &&
                revision === editor &&
                JSON.stringify(driver.configuration!()) === before
            );
        }
        host.selIndex = typeof selected === "number" ? selected : config.active;
        host.listArray = config.portals;
        host.listDataArray = host.listArray;
        host.getListItem = function (
            slot: StalkerConfiguration["portals"][number],
            index: number
        ) {
            return (
                "&nbsp;&nbsp;" +
                (index + 1) +
                ": " +
                (index === config.active ? "✓ " : "") +
                profileLabel(slot)
            );
        };
        host.detailListAction = function () {
            if (!current()) return;
            var slot = config.portals[host.selIndex];
            if (!slot) return;
            host.listDetail.innerHTML =
                host._("Portal URL") +
                ": " +
                text(slot.portal) +
                "<br/>" +
                host._("MAC address") +
                ": " +
                text(slot.mac);
            host.listFooter.innerHTML =
                host.renderButtonHint(
                    host.keys.RETURN,
                    host.strRETURN,
                    "Close"
                ) +
                host.renderButtonHint(
                    host.keys.ENTER,
                    host.strENTER,
                    host.selIndex === config.active || !slot.portal || !slot.mac
                        ? "Edit"
                        : "Load"
                ) +
                host.renderButtonHint(host.keys.YELLOW, "", "Edit");
        };
        host.listKeyHandler = function (key: number) {
            if (!current()) return false;
            if (key === host.keys.RETURN) {
                revision++;
                host.popupList(
                    host.popupActions.indexOf(
                        host.toggleProviderSettingsVisibility
                    ) + 1
                );
                return true;
            }
            if (key >= 49 && key <= 54) host.selIndex = key - 49;
            else if (key !== host.keys.ENTER && key !== host.keys.YELLOW)
                return false;
            var index = host.selIndex;
            var slot = config.portals[index];
            if (!slot) return true;
            if (
                key === host.keys.YELLOW ||
                config.active === index ||
                !slot.portal ||
                !slot.mac
            )
                showDetails(index);
            else {
                config.active = index;
                load(config);
            }
            return true;
        };
        openList(host._("Select Stalker portal"));
        return true;
    }
    function showDetails(slotIndex: number): void {
        var editor = ++revision;
        var fieldRevision = 0;
        var config: StalkerConfiguration = driver.configuration!();
        var before = JSON.stringify(config);
        var draft = config.portals[slotIndex];
        var fields = ["portal", "mac", "name"];
        var titles = ["Portal URL", "MAC address", "Profile name"];
        var prompts = [
            "Enter Stalker portal URL",
            "Enter MAC address",
            "Profile name",
        ];
        var details = [
            "Enter Stalker portal URL (e.g. http://your-portal/stalker_portal/c/)",
            "Enter MAC address (e.g. 00:1A:2B:3C:4D:5E)",
            "Profile name",
            "",
            "Save settings and load channel list",
        ];
        function current(): boolean {
            return (
                owner.active() &&
                revision === editor &&
                JSON.stringify(driver.configuration!()) === before
            );
        }
        function render(): void {
            host.listArray = fields
                .map(function (field, index) {
                    return (
                        host._(titles[index]) +
                        ": " +
                        text((draft as any)[field])
                    );
                })
                .concat(["", host._("Save and load channels")]);
            host.listDataArray = host.listArray;
        }
        host.selIndex = 0;
        render();
        host.getListItem = function (value: any) {
            return "&nbsp;&nbsp;" + value;
        };
        host.detailListAction = function () {
            if (current())
                host.listDetail.innerHTML = host._(
                    details[host.selIndex] || ""
                );
        };
        host.listKeyHandler = function (key: number) {
            if (!current()) return false;
            if (key === host.keys.RETURN) {
                edit(slotIndex);
                return true;
            }
            if (key !== host.keys.ENTER) return false;
            var index = host.selIndex;
            if (index >= 0 && index < fields.length) {
                var field = ++fieldRevision;
                host.editCaption = host._(prompts[index]);
                host.editvar = (draft as any)[fields[index]];
                host.setEdit = function () {
                    if (!current() || field !== fieldRevision) return;
                    fieldRevision++;
                    var value = String(host.editvar).trim();
                    (draft as any)[fields[index]] =
                        index === 0
                            ? value.replace(/\/+$/, "")
                            : index === 1
                              ? value.toUpperCase()
                              : value;
                    render();
                    host.showPage();
                };
                host.showEditKey(host.keys.ENTER);
            } else if (index === 4) {
                config.active = slotIndex;
                load(config);
            }
            return true;
        };
        openList(host._("Stalker Portal Provider"));
    }
    edit.menuTitle = menuTitle;
    edit.menuDetail = function () {
        return host._("Stalker portal settings");
    };
    return {
        edit: edit,
        mount: function (index: number) {
            if (!owner.active()) return;
            host.popupActions.splice(index, 1, edit);
            host.popupArray.splice(index, 1, "");
            host.popupDetail.splice(index, 1, edit.menuDetail());
            updateLabel();
        },
        updateLabel: updateLabel,
    };
}

function mountStalkerMedia(
    host: any,
    driver: StalkerProviderDriver,
    owner: DriverLifetime
) {
    var media = driver.mediaClient();
    if (!media || !owner.active()) return;
    media.attach(host);
    host.providerMediaClient = media;
    host.getMediaArray = media.load;
    owner.own(function () {
        if (host.providerMediaClient === media) {
            host.providerMediaClient = null;
            host.getMediaArray = null;
        }
    });
    // Yield until the caller has published the initial live catalog.
    var timer = window.setTimeout(function () {
        if (owner.active()) driver.startMedia();
    }, 0);
    owner.own(function () {
        window.clearTimeout(timer);
    });
}

if (typeof window !== "undefined")
    (window as any).__ottStalkerDriver = {
        create: createStalkerProviderDriver,
        mountMedia: mountStalkerMedia,
        mountSettings: mountStalkerProviderSettings,
    };
