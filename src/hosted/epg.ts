/** Hosted deployments obtain public XMLTV in a worker; no companion API fallback. */
(function (host: any) {
    var previous: any = null;
    var status: any = { phase: "idle" };
    function description(): string {
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
            if (status.started)
                lines.push(
                    host._(
                        "EPG elapsed: %1",
                        Math.round(
                            ((status.finished || Date.now()) - status.started) /
                                1000
                        ) + " s"
                    )
                );
            content.text(lines.join("\n\n"));
        }
        function close(): void {
            host.clearInterval(timer);
            panel.hide().empty();
            host.aboutKeyHandler = previousHandler;
            host.restoreListPanelState();
        }
        function retry(): void {
            if (previous && previous.retry) previous.retry();
            render();
        }
        host.$("<button type='button'>")
            .text(host._("Retry EPG download"))
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
        host.listFooter.innerHTML =
            host.renderButtonHint(
                host.keys.ENTER,
                host.strENTER,
                "Retry EPG download"
            ) +
            host.renderButtonHint(host.keys.RETURN, host.strRETURN, "Close");
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
            status.phase = "error";
            status.finished = Date.now();
            Object.keys(pending).forEach(function (query) {
                cancel(query, null);
            });
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
        var session = {
            close: function () {
                if (disposed) return;
                disposed = true;
                host.clearInterval(watchdog);
                Object.keys(pending).forEach(function (query) {
                    host.clearTimeout(pending[query].timer);
                });
                pending = Object.create(null);
                if (worker) {
                    worker.postMessage({ type: "close" });
                    worker.terminate();
                }
                worker = null;
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
                host.clearInterval(watchdog);
                Object.keys(pending).forEach(function (query) {
                    cancel(query, null);
                });
                if (disposed) return;
                if (worker) {
                    worker.postMessage({ type: "close" });
                    worker.terminate();
                }
                start(true);
            },
        };
        previous = session;
        function start(force: boolean): void {
            var currentAttempt = ++attempt;
            worker = null;
            status = {
                channels: rows.length,
                phase: "starting",
                sources: sources.map(sourceLabel),
                started: Date.now(),
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
                        status.phase = value.stale ? "cache" : "ready";
                        status.code = "";
                        status.finished = value.stale ? 0 : Date.now();
                        notify(value.mappings || {});
                        // Same channel/source IDs can now have a different schedule generation.
                        if (
                            host.__ottClassicGuide &&
                            host.__ottClassicGuide.invalidate
                        )
                            host.__ottClassicGuide.invalidate(true);
                        report(
                            value.stale
                                ? host._(
                                      "EPG: updating saved programme guide..."
                                  )
                                : host._("EPG ready")
                        );
                    } else if (value.type === "progress") {
                        var changed = status.phase !== value.phase;
                        status.phase = value.phase;
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
                        worker.terminate();
                        worker = null;
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
            return JSON.parse(JSON.stringify(status));
        },
        enabled: function () {
            return !!settings();
        },
        open: open,
        showDiagnostics: showDiagnostics,
    };
})(window);
