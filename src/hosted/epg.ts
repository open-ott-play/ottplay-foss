/** Hosted deployments obtain public XMLTV in a worker; no companion API fallback. */
(function (host: any) {
    var previous: any = null;
    var status: any = { phase: "idle" };
    function timings(): any {
        var values: any = { cache: 0, download: 0, parse: 0 };
        if (!status.timings) return values;
        Object.keys(values).forEach(function (key: string) {
            values[key] = status.timings[key];
        });
        var key = status.phase;
        if (key === "starting" || key === "waiting") key = "cache";
        if (typeof values[key] === "number")
            values[key] += Math.max(0, Date.now() - status.phaseStarted);
        return values;
    }
    function phase(next: string): void {
        status.timings = timings();
        status.phaseStarted = Date.now();
        status.phase = next;
    }
    function seconds(value: number): string {
        return (value / 1000).toFixed(1) + " s";
    }
    function restartNeeded(): boolean {
        return (
            status.code === "EPG_WORKER" && status.failedPhase === "starting"
        );
    }
    function description(): string {
        if (restartNeeded())
            return host._(
                "EPG could not start. Restart the player to reload its files. Playback will stop."
            );
        var code = status.code || "";
        if (code === "EPG_HTTP")
            return host._("EPG source returned HTTP %1", status.httpStatus);
        if (code === "EPG_NETWORK")
            return host._(
                "EPG download failed. Check the connection, HTTPS and source CORS permissions."
            );
        if (code === "EPG_TIMEOUT")
            return host._("EPG download timed out. Retry the download.");
        if (code === "EPG_INSECURE_SOURCE")
            return host._(
                "An HTTPS player cannot download an HTTP EPG source. Use an HTTPS source."
            );
        if (/^EPG_STORAGE/.test(code))
            return host._("EPG local storage is unavailable or full.");
        if (/LIMIT$/.test(code))
            return host._(
                "EPG exceeds the device processing limit. Use a smaller source or archive window."
            );
        if (/^EPG_(GZIP|XML|UTF8)/.test(code))
            return host._("EPG archive or XML is invalid.");
        if (code === "EPG_EMPTY")
            return host._(
                "No programmes matched the playlist channels and dates. Check the source and device clock."
            );
        if (code)
            return host._(
                "EPG processing stopped. Retry and check browser support."
            );
        return phaseDescription(status.phase);
    }
    function phaseDescription(phase: string): string {
        if (phase === "idle")
            return host._("EPG has not started. Load an M3U playlist.");
        if (phase === "ready") return host._("EPG ready");
        if (phase === "download")
            return host._("EPG: downloading programme guide...");
        if (phase === "parse")
            return host._("EPG: processing programme guide...");
        if (phase === "waiting")
            return host._("EPG: waiting for another player tab...");
        return host._("EPG: opening local cache...");
    }
    function sourceLabel(url: string): string {
        // A source path or query may contain subscription credentials.
        var match = /^https?:\/\/([^/?#]+)/i.exec(url);
        return match ? match[1].replace(/^.*@/, "").slice(0, 128) : "?";
    }
    function showDiagnostics(): void {
        var panel = host.$("#listAbout");
        var previousHandler = host.aboutKeyHandler;
        var restartShown = false;
        host.saveListPanelState();
        host.$("#listCaption").text(host._("EPG diagnostics"));
        panel.empty().show();
        var content = host
            .$("<pre>")
            .css({
                fontFamily: "inherit",
                fontSize: "0.8em",
                height: "80%",
                overflow: "auto",
                touchAction: "pan-y",
                whiteSpace: "pre-wrap",
            })
            .appendTo(panel);
        function render(): void {
            restartShown = restartNeeded();
            var label = restartShown ? "Restart player" : "Retry EPG download";
            action.text(host._(label));
            host.listFooter.innerHTML =
                host.renderButtonHint(host.keys.ENTER, host.strENTER, label) +
                host.renderButtonHint(
                    host.keys.RETURN,
                    host.strRETURN,
                    "Close"
                );
            var lines = [description()];
            if (status.code) {
                lines.push(status.code);
                lines.push(
                    host._(
                        "EPG stopped during: %1",
                        phaseDescription(status.failedPhase)
                    )
                );
            }
            if (status.sources && status.sources.length) {
                var index = Math.max(0, status.source || 0);
                lines.push(
                    host._(
                        "EPG source: %1",
                        index +
                            1 +
                            "/" +
                            status.sources.length +
                            " · " +
                            status.sources[index]
                    )
                );
            }
            if (status.total || status.loaded)
                lines.push(
                    host._(
                        "EPG progress: %1",
                        (Number(status.loaded || 0) / 1048576).toFixed(1) +
                            " / " +
                            (Number(status.total || 0) / 1048576).toFixed(1) +
                            " MiB"
                    )
                );
            if (status.records != null)
                lines.push(host._("EPG programmes: %1", status.records));
            if (status.matched != null)
                lines.push(
                    host._(
                        "EPG channels: %1",
                        status.matched + "/" + status.channels
                    )
                );
            if (status.fetched)
                lines.push(
                    host._(
                        "EPG cache updated: %1",
                        new Date(status.fetched).toLocaleString()
                    )
                );
            if (status.cached && status.code)
                lines.push(
                    host._("EPG update failed; using saved programme guide")
                );
            if (status.started) {
                lines.push(
                    host._(
                        "EPG elapsed: %1",
                        Math.round(
                            ((status.finished || Date.now()) - status.started) /
                                1000
                        ) + " s"
                    )
                );
                var times = timings();
                lines.push(
                    host._("EPG cache and wait time: %1", seconds(times.cache)),
                    host._("EPG download time: %1", seconds(times.download)),
                    host._(
                        "EPG processing and storage time: %1",
                        seconds(times.parse)
                    )
                );
            }
            content.text(lines.join("\n\n"));
        }
        function close(): void {
            host.clearInterval(timer);
            panel.hide().empty();
            host.aboutKeyHandler = previousHandler;
            host.restoreListPanelState();
        }
        function retry(): void {
            // A state change must not turn an advertised retry into a restart.
            if (restartShown !== restartNeeded()) {
                render();
                return;
            }
            if (restartShown) host.restart();
            else if (previous && previous.retry) previous.retry();
            render();
        }
        var action = host
            .$("<button type='button'>")
            .on("click", function (event: any) {
                event.stopPropagation();
                retry();
            })
            .appendTo(panel);
        host.$("<button type='button'>")
            .text(host._("Back"))
            .on("click", function (event: any) {
                event.stopPropagation();
                close();
            })
            .appendTo(panel);
        var handler = function (key: number): boolean {
            if (key === host.keys.RETURN || key === host.keys.EXIT) close();
            else if (key === host.keys.ENTER) retry();
            else if (key === host.keys.UP || key === host.keys.DOWN)
                content.scrollTop(
                    content.scrollTop() + (key === host.keys.UP ? -80 : 80)
                );
            return true;
        };
        host.aboutKeyHandler = handler;
        var timer = host.setInterval(function () {
            if (host.aboutKeyHandler !== handler || !panel.is(":visible"))
                host.clearInterval(timer);
            else render();
        }, 1000);
        render();
    }
    function settings(): any {
        var deployment = host.__OTTPLAY_HOSTED__;
        return deployment &&
            deployment.version === 1 &&
            !host.Capacitor &&
            !host.__TAURI__
            ? deployment.epg
            : null;
    }
    function open(
        channels: any[],
        notify: (mappings: any) => void,
        progress?: (message: string) => void
    ): any {
        if (previous) previous.close();
        var configuration = settings();
        var worker: any = null;
        var disposed = false;
        var nextQuery = 0;
        var pending: any = Object.create(null);
        var sources: string[] = [];
        var heartbeat = Date.now();
        var watchdog: any = null;
        var attempt = 0;
        var closing: any = null;
        var resumed: any = null;
        var accepted: any = null;
        var rows = channels.map(function (channel: any) {
            var urls = (
                channel.xmltv_urls && channel.xmltv_urls.length
                    ? channel.xmltv_urls.slice()
                    : [configuration.source]
            ).map(function (url: string) {
                // The publisher moved these public aliases; HTTPS avoids old mixed-content redirects.
                return url.replace(
                    /^https?:\/\/(?:epg\.it999\.ru|epg\.one)\//i,
                    "https://cdn.epg.one/"
                );
            });
            urls.forEach(function (url: string) {
                if (sources.indexOf(url) < 0) sources.push(url);
            });
            return {
                archiveHours: Math.max(0, Number(channel.rec) || 0),
                id: String(channel.id),
                name: channel.channel_name || channel.name || "",
                sources: urls,
                tvgId: channel.epg || "",
                tvgName: channel.tn || "",
            };
        });
        function report(message: string): void {
            if (!disposed && progress) progress(message);
        }
        function failed(code: string, value?: any): void {
            if (disposed) return;
            status.code = code;
            status.httpStatus = (value && value.httpStatus) || 0;
            status.cached = value ? !!value.cached : !!status.cached;
            status.failedPhase = (value && value.phase) || status.phase;
            phase("error");
            status.finished = Date.now();
            var expected = attempt;
            Object.keys(pending).forEach(function (query) {
                cancel(query, null);
            });
            if (disposed || attempt !== expected) return;
            report(description());
            if (host.showShift)
                host.showShift(
                    host._("EPG error. Open Information → EPG diagnostics.")
                );
        }
        function cancel(query: string, value: any): void {
            var job = pending[query];
            if (!job) return;
            delete pending[query];
            host.clearTimeout(job.timer);
            if (!disposed) job.callback(value);
        }
        function stop(callback?: () => void): void {
            resumed = callback;
            if (closing) return;
            var old = worker;
            worker = null;
            if (!old) {
                if (callback) callback();
                return;
            }
            closing = old;
            var timeout: any;
            function finished(): void {
                if (closing !== old) return;
                host.clearTimeout(timeout);
                old.onmessage = old.onerror = null;
                old.terminate();
                closing = null;
                var next = resumed;
                resumed = null;
                if (next) next();
            }
            old.onmessage = function (event: any) {
                if (event.data && event.data.type === "closed") finished();
            };
            old.onerror = finished;
            // A wedged Worker must not prevent a retry or keep resources alive.
            timeout = host.setTimeout(finished, 1000);
            try {
                old.postMessage({ type: "close" });
            } catch (_) {
                finished();
            }
        }
        var session = {
            close: function () {
                if (disposed) return;
                disposed = true;
                ++attempt;
                host.clearInterval(watchdog);
                Object.keys(pending).forEach(function (query) {
                    host.clearTimeout(pending[query].timer);
                });
                pending = Object.create(null);
                stop();
                if (previous === session) {
                    previous = null;
                    status = { phase: "idle" };
                }
            },
            guide: function (
                id: string | number,
                callback: (rows: any) => void
            ): void {
                if (disposed || !worker) {
                    callback(null);
                    return;
                }
                var query = String(++nextQuery);
                pending[query] = {
                    callback: callback,
                    timer: host.setTimeout(function () {
                        cancel(query, null);
                    }, 15000),
                };
                worker.postMessage({
                    id: String(id),
                    query: query,
                    type: "guide",
                });
            },
            retry: function () {
                if (disposed) return;
                var expected = ++attempt;
                host.clearInterval(watchdog);
                Object.keys(pending).forEach(function (query) {
                    cancel(query, null);
                });
                if (disposed || attempt !== expected) return;
                stop(function () {
                    if (!disposed && attempt === expected) start(true);
                });
            },
        };
        previous = session;
        function start(force: boolean): void {
            var currentAttempt = ++attempt;
            accepted = null;
            worker = null;
            status = {
                channels: rows.length,
                phase: "starting",
                phaseStarted: Date.now(),
                sources: sources.map(sourceLabel),
                started: Date.now(),
                timings: { cache: 0, download: 0, parse: 0 },
            };
            heartbeat = Date.now();
            try {
                if (!configuration || !configuration.workerUrl || !host.Worker)
                    throw new Error("EPG worker unavailable");
                // The deployment controls this fixed same-origin worker path, never a playlist.
                if (!/^\/(?!\/)/.test(configuration.workerUrl))
                    throw new Error("EPG worker must be same-origin");
                worker = new host.Worker(configuration.workerUrl);
                worker.onmessage = function (event: any) {
                    if (disposed || attempt !== currentAttempt) return;
                    var value = event.data || {};
                    heartbeat = Date.now();
                    if (value.type === "guide")
                        cancel(String(value.query), value.rows);
                    else if (value.type === "ready") {
                        status.cached = true;
                        status.fetched = value.fetched;
                        status.matched = Object.keys(
                            value.mappings || {}
                        ).length;
                        status.records = value.records;
                        phase(value.stale ? "cache" : "ready");
                        status.code = "";
                        status.finished = value.stale ? 0 : Date.now();
                        var revision = value.generation || value.fetched;
                        if (accepted === null || accepted !== revision) {
                            accepted = revision;
                            notify(value.mappings || {});
                            if (disposed || attempt !== currentAttempt) return;
                            // Channel IDs can survive a schedule replacement.
                            if (
                                host.__ottClassicGuide &&
                                host.__ottClassicGuide.invalidate
                            )
                                host.__ottClassicGuide.invalidate(true);
                            // A completed empty screen no longer has a pending
                            // guide consumer; refresh its current owned view.
                            if (
                                !disposed &&
                                attempt === currentAttempt &&
                                host.__ottClassicGuideScreen
                            )
                                host.__ottClassicGuideScreen.refresh();
                        }
                        report(
                            value.stale
                                ? host._(
                                      "EPG: updating saved programme guide..."
                                  )
                                : host._("EPG ready")
                        );
                    } else if (value.type === "progress") {
                        var changed = status.phase !== value.phase;
                        if (
                            value.phase === "cache" &&
                            (status.phase === "ready" ||
                                status.phase === "error")
                        ) {
                            status.started = Date.now();
                            status.timings = null;
                        }
                        phase(value.phase);
                        status.source = value.source;
                        status.loaded = value.loaded;
                        status.total = value.total;
                        status.records = value.records;
                        status.code = "";
                        status.finished = 0;
                        if (changed) report(description());
                    } else if (value.type === "error") {
                        failed(value.code, value);
                    }
                };
                worker.onerror = function () {
                    if (!disposed && attempt === currentAttempt)
                        failed("EPG_WORKER");
                };
                worker.postMessage({
                    channels: rows,
                    force: force,
                    refreshMs: Math.max(
                        60000,
                        Number(configuration.refreshMs) || 7200000
                    ),
                    sources: sources,
                    type: "load",
                });
                watchdog = host.setInterval(function () {
                    if (
                        disposed ||
                        status.phase === "ready" ||
                        status.phase === "error"
                    )
                        return;
                    if (
                        Date.now() - heartbeat >
                        (status.phase === "download" ? 200000 : 60000)
                    ) {
                        ++attempt;
                        host.clearInterval(watchdog);
                        stop();
                        failed("EPG_STALLED");
                    }
                }, 5000);
            } catch (_) {
                failed("EPG_WORKER");
            }
        }
        start(false);
        return session;
    }
    host.__ottHostedEpg = {
        diagnostics: function () {
            var value = JSON.parse(JSON.stringify(status));
            value.timings = timings();
            return value;
        },
        enabled: function () {
            return !!settings();
        },
        open: open,
        showDiagnostics: showDiagnostics,
    };
})(window);
