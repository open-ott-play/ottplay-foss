/** Optional media service client. Durable inputs never contain playback leases. */
function createMediaCompanion(
    w: any,
    nativeEndpoint?: () => Promise<any>,
    nativeOnly = false
): any {
    var owned: any[] = [];
    var last: any = null;
    var playback: any = null;
    var requestTimeout = 10000;
    function fail(code: string): Error {
        return new Error(code);
    }
    function supportsTransport(): boolean {
        return typeof w.fetch === "function";
    }
    function backendError(value: any, fallback: string): string {
        return typeof value === "string" &&
            /^(?:torznab_(?:invalid_(?:source|link|query|category|xml|page)|local_only|search_unavailable|source_(?:missing|changed|limit)|reference_missing|busy|cancelled|timeout|network_error|http_error|response_limit|xml_limit|api_error|store_(?:unavailable|busy|limit))|busy|cleanup_pending|cache_(?:limit|unavailable)|service_stopped|session_(?:missing|stopped|busy|limit)|stream_(?:limit|timeout)|webseed_(?:unavailable|timeout|invalid_range|hash_mismatch|network_denied)|invalid_(?:request|source|file|metadata|tracker)|tracker_limit|file_(?:selection_required|limit)|engine_unavailable|metadata_(?:failed|timeout|limit)|no_files|torrent_failed|initialization_timeout|range_failed|plugin_(?:invalid_manifest|invalid_script|not_found|invalid_input|invalid_output|busy|cancelled|timed_out|execution_failed|network_denied|network_failed|network_limit))$/.test(
                value
            )
            ? value
            : fallback;
    }
    function publicError(value: any): string {
        return value === "" ||
            (typeof value === "string" &&
                /^companion_(?:access_denied|endpoint_invalid|transport_unavailable|not_configured|timeout|request_failed|source_invalid|selection_invalid|receipt_invalid|too_many_files|no_playable_files|torrent_unavailable|unavailable)$/.test(
                    value
                ))
            ? value
            : backendError(value, "companion_unavailable");
    }
    function progressBytes(value: any): number | null {
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    function endpointValue(value: any): string {
        if (typeof value !== "string" || value.length > 4096)
            throw fail("companion_endpoint_invalid");
        var u = new URL(value);
        if (
            !/^https?:$/.test(u.protocol) ||
            u.username ||
            u.password ||
            u.search ||
            u.hash ||
            !/\/companion\/[A-Za-z0-9_-]{32,128}\/v1\/?$/.test(u.pathname)
        )
            throw fail("companion_endpoint_invalid");
        return u.href.replace(/\/$/, "");
    }
    function endpoint(): Promise<string> {
        if (!supportsTransport())
            return Promise.reject(fail("companion_transport_unavailable"));
        var configured =
            !nativeOnly && w.settings && w.settings.companionEndpoint;
        if (!nativeOnly && !configured && w.stbGetItem)
            configured = w.stbGetItem("sCompanionEndpoint");
        if (configured)
            return Promise.resolve().then(function () {
                return endpointValue(configured);
            });
        if (!nativeEndpoint)
            return Promise.reject(fail("companion_not_configured"));
        return Promise.resolve()
            .then(nativeEndpoint)
            .then(function (value) {
                return endpointValue(value && value.endpoint);
            });
    }
    function request(
        base: string,
        path: string,
        method = "GET",
        body?: any,
        late?: (value: any) => void,
        timeoutMs = requestTimeout,
        signal?: AbortSignal
    ): Promise<any> {
        if (signal?.aborted) return Promise.reject(fail("torznab_cancelled"));
        if (!supportsTransport())
            return Promise.reject(fail("companion_transport_unavailable"));
        return new Promise(function (resolve, reject) {
            var finished = false;
            var controller = w.AbortController ? new w.AbortController() : null;
            var grace: any;
            function detach(): void {
                signal?.removeEventListener("abort", cancelRequest);
            }
            function cancelRequest(): void {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                clearTimeout(grace);
                detach();
                if (controller) controller.abort();
                reject(fail("torznab_cancelled"));
            }
            var timer = setTimeout(function () {
                finished = true;
                detach();
                if (controller && !late) controller.abort();
                reject(fail("companion_timeout"));
            }, timeoutMs);
            // A late create receipt can still release its lease, but an unresponsive
            // create cannot retain an outstanding fetch indefinitely. Unknown leases
            // are reclaimed by the service's idle timeout after this final grace.
            if (late)
                grace = setTimeout(function () {
                    if (controller) controller.abort();
                }, 30000);
            signal?.addEventListener("abort", cancelRequest);
            if (signal?.aborted) {
                cancelRequest();
                return;
            }
            Promise.resolve()
                .then(function () {
                    if (finished) throw fail("torznab_cancelled");
                    return w.fetch(base + "/" + path, {
                        body:
                            body === undefined
                                ? undefined
                                : JSON.stringify(body),
                        cache: "no-store",
                        credentials: "omit",
                        headers:
                            body === undefined
                                ? undefined
                                : { "Content-Type": "application/json" },
                        keepalive: method === "DELETE",
                        method: method,
                        redirect: "error",
                        signal: controller ? controller.signal : signal,
                    });
                })
                .then(function (response: any) {
                    if (!response.ok) {
                        if (response.status === 401)
                            throw fail("companion_access_denied");
                        return Promise.resolve()
                            .then(function () {
                                return response.json();
                            })
                            .catch(function () {
                                return null;
                            })
                            .then(function (value) {
                                throw fail(
                                    backendError(
                                        value && value.error,
                                        "companion_request_failed"
                                    )
                                );
                            });
                    }
                    return response.status === 204 ? {} : response.json();
                })
                .then(
                    function (value: any) {
                        detach();
                        clearTimeout(grace);
                        if (finished) {
                            if (late) late(value);
                            return;
                        }
                        finished = true;
                        clearTimeout(timer);
                        resolve(value);
                    },
                    function (error: any) {
                        detach();
                        clearTimeout(grace);
                        if (finished) return;
                        finished = true;
                        clearTimeout(timer);
                        reject(error);
                    }
                );
        });
    }
    function id(value: any): boolean {
        return (
            typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
        );
    }
    function remove(base: string, value: any): void {
        if (id(value))
            request(base, "sessions/" + value, "DELETE").catch(function () {});
    }
    function isSource(value: any): boolean {
        return (
            typeof value === "string" &&
            (/^(magnet:|ottplay-plugin:|ottplay-torrent:|ottplay-local-torrent:)/i.test(
                value
            ) ||
                /^https?:\/\/[^?#]*\.torrent(?:[?#]|$)/i.test(value))
        );
    }
    function plugin(value: string): any {
        var match = /^ottplay-plugin:([A-Za-z0-9_-]{1,64})\?(.*)$/.exec(value);
        if (!match) throw fail("companion_source_invalid");
        var q = new URLSearchParams(match[2]);
        var input: any = q.get("input") || "";
        var selected = q.has("index") ? Number(q.get("index")) : 0;
        if (
            input.length > 4096 ||
            !Number.isInteger(selected) ||
            selected < 0 ||
            selected > 255
        )
            throw fail("companion_source_invalid");
        if (q.get("json") === "1") {
            try {
                input = JSON.parse(input);
            } catch (_) {
                throw fail("companion_source_invalid");
            }
            if (!input || typeof input !== "object" || Array.isArray(input))
                throw fail("companion_source_invalid");
        } else
            input =
                match[1] === "direct-url" ? { url: input } : { value: input };
        return { id: match[1], index: selected, input: input };
    }
    function fileSelection(value: string): any {
        if (/^ottplay-torrent:/.test(value)) {
            var wrapped = new URL(value);
            var original = wrapped.searchParams.get("source") || "";
            var chosen = wrapped.searchParams.get("index");
            var largest = wrapped.searchParams.get("selection") === "largest";
            if (
                !/^(?:https?:\/\/|magnet:|ottplay-plugin:|ottplay-local-torrent:)/i.test(
                    original
                ) ||
                (largest
                    ? chosen !== null
                    : chosen === null || !/^\d{1,9}$/.test(chosen))
            )
                throw fail("companion_source_invalid");
            return largest
                ? { largest: true, source: original }
                : { fileIndex: Number(chosen), source: original };
        }
        if (!/^magnet:/i.test(value)) return { source: value };
        var url = new URL(value),
            selected: number | undefined;
        var all = url.searchParams.getAll("so");
        if (all.length) {
            if (all.length !== 1 || !/^\d{1,9}$/.test(all[0]))
                throw fail("companion_selection_invalid");
            selected = Number(all[0]);
            url.searchParams.delete("so");
        }
        return { fileIndex: selected, source: url.href };
    }
    function playable(file: any): boolean {
        return (
            file &&
            Number.isInteger(file.index) &&
            file.index >= 0 &&
            typeof file.name === "string" &&
            /\.(mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mpg|mpeg|ogv)$/i.test(
                file.name
            )
        );
    }
    function resolve(
        source: string,
        done: (value: any, transport?: "file" | "stream") => void,
        options?: any
    ): () => void {
        var lease: any = {
            active: true,
            base: "",
            error: "",
            files: [],
            id: "",
            selected: null,
            selectionSubmitted: false,
            source: source,
            state: "metadata",
            streams: [],
        };
        var timer: any,
            deadline: any,
            wrappedFileIndex: number | undefined,
            largestFile = false,
            completed = false;
        owned.push(lease);
        last = lease;
        if (!options || !options.metadataOnly) playback = lease;
        function reportError(code: any): void {
            lease.error = publicError(code);
            if (options && options.failed) options.failed(lease.error);
        }
        function cleanup(): void {
            if (!lease.active) return;
            lease.active = false;
            clearTimeout(timer);
            clearTimeout(deadline);
            if (lease.id) remove(lease.base, lease.id);
            owned = owned.filter(function (entry) {
                return entry !== lease;
            });
        }
        lease.cancel = cleanup;
        function finish(
            error?: any,
            result?: any,
            transport?: "file" | "stream"
        ): void {
            if (!lease.active || completed) return;
            completed = true;
            clearTimeout(timer);
            clearTimeout(deadline);
            if (error) {
                lease.state = "error";
                cleanup();
                reportError(error.message);
            }
            done(result || null, transport);
        }
        function current(): boolean {
            if (
                lease.active &&
                (!options || !options.current || options.current()) &&
                !(w.__ottStandby && w.__ottStandby.blocked())
            )
                return true;
            cleanup();
            return false;
        }
        function progress(value: any): void {
            lease.state = value.state;
            if (Number.isFinite(value.downloaded) && value.downloaded >= 0)
                lease.downloaded = value.downloaded;
            if (Number.isFinite(value.total) && value.total >= 0)
                lease.total = value.total;
        }
        function heartbeat(): void {
            if (!current() || !lease.id) return;
            timer = setTimeout(function () {
                if (!current()) return;
                request(lease.base, "sessions/" + lease.id).then(
                    function (value) {
                        if (!current()) return;
                        if (!value || value.id !== lease.id) {
                            lease.state = "error";
                            cleanup();
                            reportError("companion_receipt_invalid");
                            return;
                        }
                        progress(value);
                        if (value.state === "error") {
                            cleanup();
                            reportError(value.error);
                            return;
                        }
                        lease.error = "";
                        heartbeat();
                    },
                    function (error) {
                        if (!current()) return;
                        lease.error = error.message || "companion_unavailable";
                        heartbeat();
                    }
                );
            }, 30000);
        }
        function selected(index: number): void {
            lease.selectionSubmitted = true;
            request(lease.base, "sessions/" + lease.id + "/select", "POST", {
                fileIndex: index,
            }).then(inspect, finish);
        }
        function inspect(value: any): void {
            if (!current()) return;
            if (!value || value.id !== lease.id) {
                finish(fail("companion_receipt_invalid"));
                return;
            }
            lease.files = Array.isArray(value.files)
                ? value.files.filter(playable)
                : [];
            if (options && options.metadataOnly && lease.files.length > 4096) {
                finish(fail("companion_too_many_files"));
                return;
            }
            lease.files = lease.files.slice(0, 4096);
            lease.selected = value.selected;
            progress(value);
            if (value.state === "error") {
                finish(
                    fail(backendError(value.error, "companion_unavailable"))
                );
                return;
            }
            if (
                options &&
                options.metadataOnly &&
                /^(select|preparing|ready)$/.test(value.state)
            ) {
                if (!lease.files.length) {
                    finish(fail("companion_no_playable_files"));
                    return;
                }
                var files = lease.files.map(function (file: any) {
                    return {
                        index: file.index,
                        length: file.length,
                        name: file.name,
                    };
                });
                finish(undefined, files);
                cleanup();
                return;
            }
            if (value.state === "ready") {
                var path = "sessions/" + lease.id + "/stream";
                if (value.streamPath !== path) {
                    finish(fail("companion_receipt_invalid"));
                    return;
                }
                finish(undefined, lease.base + "/" + path, "file");
                heartbeat();
                return;
            }
            if (value.state === "select") {
                if (!lease.files.length) {
                    finish(fail("companion_no_playable_files"));
                    return;
                }
                if (!lease.selectionSubmitted) {
                    var chosen = lease.files[0];
                    if (largestFile)
                        lease.files.forEach(function (file: any) {
                            if (Number(file.length) > Number(chosen.length))
                                chosen = file;
                        });
                    selected(chosen.index);
                    return;
                }
            }
            if (
                value.state !== "metadata" &&
                value.state !== "preparing" &&
                value.state !== "select"
            ) {
                finish(fail("companion_receipt_invalid"));
                return;
            }
            timer = setTimeout(function () {
                if (current())
                    request(lease.base, "sessions/" + lease.id).then(
                        inspect,
                        finish
                    );
            }, 750);
        }
        function torrent(input: string): void {
            var selection;
            try {
                selection = fileSelection(input);
            } catch (error) {
                finish(error);
                return;
            }
            if (/^ottplay-plugin:/.test(source)) {
                var chosen = new URL(source).searchParams.get("file");
                if (chosen !== null && /^\d{1,9}$/.test(chosen))
                    selection.fileIndex = Number(chosen);
            }
            if (options && Number.isInteger(options.fileIndex))
                selection.fileIndex = options.fileIndex;
            else if (wrappedFileIndex !== undefined)
                selection.fileIndex = wrappedFileIndex;
            if (options && options.metadataOnly) delete selection.fileIndex;
            delete selection.largest;
            if (/^ottplay-local-torrent:/.test(selection.source)) {
                var ref =
                    /^ottplay-local-torrent:([a-z][a-z0-9-]{0,63})\/([0-9a-f]{32})$/.exec(
                        selection.source
                    );
                if (!ref) {
                    finish(fail("companion_source_invalid"));
                    return;
                }
                delete selection.source;
                selection.sourceId = ref[1];
                selection.sourceRef = ref[2];
            }
            lease.selectionSubmitted = selection.fileIndex !== undefined;
            request(
                lease.base,
                "sessions",
                "POST",
                selection,
                function (value) {
                    remove(lease.base, value && value.id);
                }
            ).then(function (value) {
                if (!value || !id(value.id)) {
                    finish(fail("companion_receipt_invalid"));
                    return;
                }
                lease.id = value.id;
                if (!current()) {
                    remove(lease.base, lease.id);
                    return;
                }
                inspect(value);
            }, finish);
        }
        function start(caps: any): void {
            if (!current()) return;
            if (!caps || caps.schema !== 1) {
                finish(fail("companion_protocol_unsupported"));
                return;
            }
            var requested = source;
            if (/^ottplay-torrent:/i.test(source)) {
                try {
                    var wrapped = fileSelection(source);
                    requested = wrapped.source;
                    wrappedFileIndex = wrapped.fileIndex;
                    largestFile = wrapped.largest === true;
                } catch (error) {
                    finish(error);
                    return;
                }
            }
            if (/^ottplay-plugin:/.test(requested)) {
                if (caps.plugins !== true) {
                    finish(fail("companion_plugins_unavailable"));
                    return;
                }
                var p;
                try {
                    p = plugin(requested);
                } catch (error) {
                    finish(error);
                    return;
                }
                request(lease.base, "plugins/" + p.id + "/resolve", "POST", {
                    input: p.input,
                }).then(function (value) {
                    if (!current()) return;
                    var streams = value && value.streams;
                    if (
                        !Array.isArray(streams) ||
                        streams.length > 256 ||
                        !streams[p.index] ||
                        typeof streams[p.index].url !== "string"
                    ) {
                        finish(fail("companion_no_streams"));
                        return;
                    }
                    lease.streams = streams.map(function (
                        row: any,
                        index: number
                    ) {
                        return {
                            index: index,
                            name: String(row.title || "Stream " + (index + 1)),
                        };
                    });
                    var url = streams[p.index].url;
                    if (
                        /^magnet:/.test(url) ||
                        /^https?:\/\/[^?#]*\.torrent(?:[?#]|$)/i.test(url)
                    ) {
                        if (caps.torrent === true) torrent(url);
                        else finish(fail("companion_torrent_unavailable"));
                    } else if (/^https?:\/\//i.test(url))
                        finish(
                            undefined,
                            url,
                            /\.(mp4|m4v|webm|mov|ogv)$/i.test(
                                new URL(url).pathname
                            )
                                ? "file"
                                : "stream"
                        );
                    else finish(fail("companion_source_invalid"));
                }, finish);
            } else if (caps.torrent === true) torrent(requested);
            else finish(fail("companion_torrent_unavailable"));
        }
        deadline = setTimeout(function () {
            finish(fail("companion_timeout"));
        }, 60000);
        endpoint().then(function (base) {
            if (!current()) return;
            lease.base = base;
            return request(base, "capabilities").then(start, finish);
        }, finish);
        return cleanup;
    }
    function choices(): any[] {
        if (!last || !last.active) return [];
        return last.streams
            .map(function (row: any) {
                var u = new URL(last.source);
                u.searchParams.set("index", String(row.index));
                u.searchParams.delete("file");
                return { index: row.index, name: row.name, source: u.href };
            })
            .concat(
                last.files.map(function (row: any) {
                    var u = new URL(last.source);
                    if (/^ottplay-plugin:/.test(last.source))
                        u.searchParams.set("file", String(row.index));
                    else if (/^magnet:/.test(last.source))
                        u.searchParams.set("so", String(row.index));
                    else {
                        var original = /^ottplay-torrent:/.test(last.source)
                            ? u.searchParams.get("source")
                            : last.source;
                        u = new URL(
                            "ottplay-torrent:?source=" +
                                encodeURIComponent(original || "") +
                                "&index=" +
                                row.index
                        );
                    }
                    return { index: row.index, name: row.name, source: u.href };
                })
            );
    }
    function cancelAll(): void {
        owned.slice().forEach(function (lease) {
            lease.cancel();
        });
    }
    w.addEventListener("pagehide", cancelAll);
    return {
        cancelAll: cancelAll,
        choices: choices,
        diagnostics: function () {
            return playback
                ? {
                      active: playback.active === true,
                      downloaded: progressBytes(playback.downloaded),
                      error: publicError(playback.error),
                      state: /^(metadata|select|preparing|ready|error)$/.test(
                          playback.state
                      )
                          ? playback.state
                          : "unknown",
                      total: progressBytes(playback.total),
                  }
                : null;
        },
        endpoint: endpoint,
        endpointValue: endpointValue,
        isSource: isSource,
        metadata: function (
            source: string,
            done: (files: any[] | null, reason?: string) => void
        ): () => void {
            var reason = "metadata_failed";
            return resolve(
                source,
                function (files) {
                    done(Array.isArray(files) ? files : null, reason);
                },
                {
                    failed: function (code: string) {
                        reason =
                            code === "companion_no_playable_files"
                                ? "no_files"
                                : code === "companion_too_many_files"
                                  ? "document_too_large"
                                  : /timeout/.test(code)
                                    ? "metadata_timeout"
                                    : "metadata_failed";
                    },
                    metadataOnly: true,
                }
            );
        },
        plugins: function () {
            return endpoint().then(function (base) {
                return request(base, "plugins");
            });
        },
        resolve: resolve,
        status: function () {
            return last
                ? {
                      active: last.active,
                      downloaded: last.downloaded,
                      error: last.error,
                      source: last.source,
                      state: last.state,
                      total: last.total,
                  }
                : null;
        },
        supportsTransport: supportsTransport,
        torznab: function (
            op: string,
            params: any,
            signal?: AbortSignal
        ): Promise<any> {
            if (signal?.aborted)
                return Promise.reject(fail("torznab_cancelled"));
            var path = "torrent/",
                method = "GET",
                body: any;
            if (op === "list") path += "sources";
            else if (op === "configure") {
                path += "sources";
                method = "POST";
                body = {
                    apiKey: params.apiKey,
                    endpoint: params.endpoint,
                    id: params.sourceId,
                    label: params.label,
                };
            } else if (op === "remove" || op === "caps") {
                if (!/^[a-z][a-z0-9-]{0,63}$/.test(params.sourceId))
                    return Promise.reject(fail("invalid_request"));
                path +=
                    "sources/" +
                    params.sourceId +
                    (op === "caps" ? "/caps" : "");
                if (op === "remove") method = "DELETE";
            } else if (op === "search" || op === "prepare") {
                path += op;
                method = "POST";
                body = params;
            } else return Promise.reject(fail("invalid_request"));
            return endpoint().then(function (base) {
                return request(
                    base,
                    path,
                    method,
                    body,
                    undefined,
                    20000,
                    signal
                );
            });
        },
    };
}
(window as any).__ottMediaCompanionFactory = createMediaCompanion;
