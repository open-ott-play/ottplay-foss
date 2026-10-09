/** An explicit Plex queue owns a media source, never the selected TV provider. */
function createRemotePlexQueue(
    w: any,
    runtime: string,
    initialError = ""
): any {
    var lastError = initialError;
    var queue: any = null;
    var pending: any = null;
    var serial = 0;
    var capability = {
        max_items: 500,
        operations: ["play", "preview", "status", "next", "previous", "stop"],
        version: 1,
    };
    function config(): string {
        try {
            return String(w.stbGetItem("plexcfg") || "");
        } catch (_) {
            return "";
        }
    }
    function title(value: any): string {
        var input = String(value || "Plex");
        var output = "";
        var bytes = 0;
        for (var i = 0; i < input.length; i++) {
            var code = input.charCodeAt(i);
            var next = input.charCodeAt(i + 1);
            var text = input.charAt(i);
            var size = code < 128 ? 1 : code < 2048 ? 2 : 3;
            if (code < 32 || code === 127) text = " ";
            if (
                code >= 0xd800 &&
                code <= 0xdbff &&
                next >= 0xdc00 &&
                next <= 0xdfff
            ) {
                text += input.charAt(++i);
                size = 4;
            } else if (code >= 0xd800 && code <= 0xdfff) {
                text = " ";
                size = 1;
            }
            if (bytes + size > 512) break;
            output += text;
            bytes += size;
        }
        return output;
    }
    function state(): any {
        if (queue && queue.source) {
            var media = w.__ottMedia.current();
            var playback = w.__ottClassicPlayback.snapshot();
            if (
                media &&
                media.sequence &&
                media.sequence.queueId === queue.id &&
                playback.target &&
                playback.target.sourceId === queue.source.sourceId &&
                playback.target.channelId === media.ref.itemId
            ) {
                queue.index = media.sequence.index;
                queue.repeat = media.sequence.repeat === "all" ? "all" : "none";
                if (!queue.error)
                    queue.state = media.ended
                        ? queue.index === queue.ids.length - 1 &&
                          queue.repeat !== "all"
                            ? "ended"
                            : "preparing"
                        : playback.phase === "paused"
                          ? "paused"
                          : playback.phase === "playing"
                            ? "playing"
                            : playback.phase === "stopped"
                              ? "error"
                              : "preparing";
                if (queue.state === "error" && !queue.error)
                    queue.error = "Plex playback could not start.";
            } else if (!pending && !queue.error) {
                queue.state = "error";
                queue.error = "Player context changed before Plex playback.";
            }
        }
        var shown = pending && pending.owned ? pending.owned : queue;
        var result: any = {
            active: !!(shown && shown.ids.length),
            ids: shown ? shown.ids.slice() : [],
            index: shown ? shown.index : null,
            order: "listed",
            repeat: shown && shown.repeat === "all" ? "all" : "none",
            runtime: runtime,
            state: shown ? shown.state : lastError ? "error" : "idle",
            version: 1,
        };
        if (shown && shown.records && shown.index !== null)
            result.title = title(shown.records[shown.index].title);
        if (shown && shown.error) result.error = shown.error;
        else if (!shown && lastError) result.error = lastError;
        return result;
    }
    function stop(): void {
        if (pending) pending.abort();
        var previous = queue;
        queue = null;
        lastError = "";
        if (!previous || !previous.source) return;
        var playing = w.__ottMedia.current();
        var playback = w.__ottClassicPlayback.snapshot();
        if (
            playing &&
            playing.sequence &&
            playing.sequence.queueId === previous.id &&
            playback.target &&
            playback.target.kind === "vod" &&
            playback.target.sourceId === previous.source.sourceId &&
            playback.target.channelId === playing.ref.itemId
        ) {
            w.__ottMedia.cancelAuto();
            if (typeof w.stbStop === "function") w.stbStop();
        }
        if (w.__ottMedia.usesSource(previous.source))
            w.__ottMedia.useSource(null);
        previous.source.client.dispose();
    }
    function execute(
        request: any,
        done: (result: any) => void
    ): (() => void) | void {
        var params = request.params || {};
        var op = params.op;
        function reject(error: string): void {
            done({ data: { error: error }, status: "rejected" });
        }
        if (
            params.runtime !== runtime ||
            capability.operations.indexOf(op) < 0 ||
            Object.keys(params).some(function (key) {
                return (
                    key !== "op" &&
                    key !== "runtime" &&
                    ((op !== "play" && op !== "preview") || key !== "ids")
                );
            })
        ) {
            reject("Plex playback is unavailable on this player.");
            return;
        }
        if (op === "status") {
            done({ data: state(), status: "ok" });
            return;
        }
        if (w.__ottKiosk && w.__ottKiosk.enabled() && op !== "preview") {
            reject("Kiosk mode does not allow a Plex queue.");
            return;
        }
        if (op === "stop") {
            stop();
            done({ data: state(), status: "ok" });
            return;
        }
        if (op !== "preview" && w.commandChannelsReady !== true) {
            reject("Plex playback is unavailable on this player.");
            return;
        }
        var stepping = op === "next" || op === "previous";
        var ids = stepping && queue ? queue.ids.slice() : params.ids;
        if (
            !Array.isArray(ids) ||
            !ids.length ||
            ids.length > 500 ||
            ids.some(function (id: any) {
                return typeof id !== "string" || !/^[1-9][0-9]{0,19}$/.test(id);
            })
        ) {
            reject("Plex queue is empty.");
            return;
        }
        state();
        var index =
            stepping && queue ? queue.index + (op === "next" ? 1 : -1) : 0;
        if (index < 0 || index >= ids.length) {
            reject(
                index < 0
                    ? "Plex queue is already at its first item."
                    : "Plex queue is already at its last item."
            );
            return;
        }
        if (
            !w.__ottMedia ||
            !w.__ottMedia.playOrderedQueue ||
            !w.__ottMedia.beginSource ||
            !w.__ottClassicPlayback ||
            typeof w._playMedia !== "function"
        ) {
            reject("Plex playback is unavailable on this player.");
            return;
        }
        if (pending && op === "preview") {
            reject("Plex queue request is already in progress.");
            return;
        }
        if (pending) pending.abort();
        if (op !== "preview") lastError = "";
        var prior = queue;
        var handoff: any = null;
        var owned: any = {
            id: runtime + ":plex:" + ++serial,
            ids: ids.slice(),
            index: index,
            records: null,
            source: null,
            state: "preparing",
        };
        var saved = config();
        var driver = w.__ottActiveProviderDriver;
        var provider = w.p_pref;
        var mediaSource = w.__ottMedia.sourceId();
        if (typeof w.__ottClassicPlayback.reconcile === "function")
            w.__ottClassicPlayback.reconcile();
        var generation = w.__ottClassicPlayback.snapshot().generation;
        var completed = false;
        var committed = false;
        var client: any = null;
        var authCancel: any = null;
        var timer: any;
        var operation: any;
        function allowed(): boolean {
            return (
                !owned.records ||
                !owned.records.some(function (record: any) {
                    return Number(record.adult) === 1;
                }) ||
                !(
                    (w.__ottParental && w.__ottParental.needs("channels")) ||
                    (w.sPSchannels && w.parentPIN !== "*" && !w.parentAccess)
                )
            );
        }
        function valid(): boolean {
            return (
                !completed &&
                pending === operation &&
                config() === saved &&
                w.__ottActiveProviderDriver === driver &&
                w.p_pref === provider &&
                (op === "preview" ||
                    (w.commandChannelsReady === true &&
                        !(w.__ottKiosk && w.__ottKiosk.enabled()) &&
                        allowed())) &&
                (committed || w.__ottMedia.sourceId() === mediaSource) &&
                w.__ottClassicPlayback.snapshot().generation === generation &&
                !(
                    typeof request.expires_at === "number" &&
                    Date.now() >= request.expires_at * 1000
                )
            );
        }
        function finish(error?: string, preview?: any, silent = false): void {
            if (completed) return;
            completed = true;
            w.clearTimeout(timer);
            if (pending === operation) pending = null;
            if (authCancel) authCancel();
            if (error && handoff && queue === owned) {
                handoff.rollback();
                handoff = null;
                queue = prior;
                owned.source = null;
                committed = false;
            }
            if (error && queue === owned) {
                owned.state = "error";
                owned.error = error;
            }
            if (error && !queue && op !== "preview") lastError = error;
            if (!committed && client) client.dispose();
            if (silent) return;
            if (error) {
                if (op === "preview")
                    done({
                        data: {
                            error: error,
                            ids: ids.slice(),
                            order: "listed",
                            runtime: runtime,
                            state: "error",
                            titles: [],
                            version: 1,
                        },
                        status: "ok",
                    });
                else reject(error);
            } else done({ data: preview || state(), status: "ok" });
        }
        operation = {
            abort: function () {
                finish("Plex queue request was cancelled.");
            },
            cancel: function () {
                finish("Plex queue request was cancelled.", undefined, true);
            },
            owned: op === "preview" ? null : owned,
        };
        pending = operation;
        timer = w.setTimeout(function () {
            finish("Plex queue request timed out.");
        }, 35000);
        function current(): boolean {
            if (valid()) return true;
            if (!completed)
                finish("Player context changed before Plex playback.");
            return false;
        }
        function load(): void {
            if (!current()) return;
            var raw: any;
            var normalized: any;
            try {
                raw = JSON.parse(saved);
                normalized = w.__ottPlex.normalize(raw);
            } catch (_) {}
            if (
                !normalized ||
                (typeof w.checkProviderUrl === "function" &&
                    !w.checkProviderUrl(normalized.address))
            ) {
                finish("Plex configuration is missing or invalid.");
                return;
            }
            var account =
                w.__ottPlexAuth && w.__ottPlexAuth.routing(raw.account);
            var sourceId = w.__ottSourceIdentity.media({
                __ottActiveProviderDriver: {
                    credentials: function () {
                        return {
                            password: normalized.token,
                            plexAccount: account,
                            server: normalized.address,
                            username: "",
                        };
                    },
                    id: "plex",
                },
                p_pref: "plex",
            });
            function connect(address: string): void {
                if (!current()) return;
                client = w.__ottPlex.create(
                    {
                        address: address,
                        playback: normalized.playback,
                        token: normalized.token,
                    },
                    {
                        host: w,
                        isCurrent: function () {
                            return committed
                                ? queue === owned && config() === saved
                                : valid();
                        },
                        sourceId: sourceId,
                    }
                );
                if (!client || typeof client.queue !== "function") {
                    finish("Plex provider module could not be loaded.");
                    return;
                }
                client.connect(function (error: any) {
                    if (!current()) return;
                    if (error) {
                        finish(
                            "Plex server is unreachable or access was denied."
                        );
                        return;
                    }
                    client.queue(ids, function (records: any[]) {
                        if (!current()) return;
                        if (!records || records.length !== ids.length) {
                            finish(
                                "One or more Plex items are unavailable or not playable."
                            );
                            return;
                        }
                        owned.records = records;
                        if (op !== "preview" && !allowed()) {
                            finish(
                                "Unlock parental access before starting the Plex queue."
                            );
                            return;
                        }
                        if (op === "preview") {
                            finish(undefined, {
                                ids: ids.slice(),
                                order: "listed",
                                runtime: runtime,
                                state: "ready",
                                titles: records.map(function (record) {
                                    return title(record.title);
                                }),
                                version: 1,
                            });
                            return;
                        }
                        client.resolve(
                            records[index],
                            function (resolved: any) {
                                if (!current()) return;
                                if (!resolved) {
                                    finish("Plex playback could not start.");
                                    return;
                                }
                                var source = {
                                    client: client,
                                    read: function (key: string) {
                                        return w.stbGetItem("plex" + key);
                                    },
                                    sourceId: sourceId,
                                    title: "Plex",
                                    write: function (
                                        key: string,
                                        value: string
                                    ) {
                                        w.stbSetItem("plex" + key, value);
                                    },
                                };
                                committed = true;
                                queue = owned;
                                owned.source = source;
                                try {
                                    handoff = w.__ottMedia.beginSource(source);
                                    if (!current()) return;
                                    w.__ottMedia.playOrderedQueue(
                                        records,
                                        index,
                                        owned.id,
                                        resolved,
                                        valid,
                                        function () {
                                            if (!handoff || !handoff.commit()) {
                                                finish(
                                                    "Player context changed before Plex playback."
                                                );
                                                return;
                                            }
                                            handoff = null;
                                            w.clearTimeout(w.previewTimer);
                                            w.previewChan = null;
                                            if (
                                                typeof w.closeList ===
                                                "function"
                                            )
                                                w.closeList(false);
                                            if (
                                                prior &&
                                                prior.source &&
                                                prior.source.client !== client
                                            )
                                                prior.source.client.dispose();
                                            finish();
                                        },
                                        function () {
                                            if (queue !== owned) return;
                                            owned.state = "error";
                                            owned.error =
                                                "Plex playback could not start.";
                                            if (!completed) finish(owned.error);
                                        }
                                    );
                                } catch (_) {
                                    finish("Plex playback could not start.");
                                }
                            }
                        );
                    });
                });
            }
            if (account)
                authCancel = w.__ottPlexAuth.connect(
                    {
                        connections: account.connections,
                        id: account.id,
                        token: normalized.token,
                    },
                    {
                        onConnected: function (result: any) {
                            authCancel = null;
                            connect(result.url);
                        },
                        onError: function () {
                            finish(
                                "Plex server is unreachable or access was denied."
                            );
                        },
                    }
                );
            else connect(normalized.address);
        }
        try {
            load();
        } catch (_) {
            finish("Plex playback could not start.");
        }
        return operation.cancel;
    }
    var api = {
        capability: capability,
        execute: execute,
        retained: function () {
            return !!(queue && queue.source) || !!(pending && pending.owned);
        },
        snapshot: state,
        stop: stop,
    };
    if (w.addEventListener) w.addEventListener("pagehide", stop);
    return api;
}

(window as any).__ottPlexQueueFactory = { create: createRemotePlexQueue };
