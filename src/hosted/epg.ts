/** Hosted deployments obtain public XMLTV in a worker; no companion API fallback. */
(function (host: any) {
    var previous: any = null;
    function settings(): any {
        var deployment = host.__OTTPLAY_HOSTED__;
        return deployment && deployment.version === 1 && !host.Capacitor && !host.__TAURI__ ? deployment.epg : null;
    }
    function open(channels: any[], notify: (mappings: any) => void, progress?: (message: string) => void): any {
        if (previous) previous.close();
        var configuration = settings();
        var worker: any = null;
        var disposed = false;
        var nextQuery = 0;
        var pending: any = Object.create(null);
        var sources: string[] = [];
        var rows = channels.map(function (channel: any) {
            var urls = (channel.xmltv_urls && channel.xmltv_urls.length ? channel.xmltv_urls.slice() : [configuration.source]).map(function (url: string) {
                // The publisher moved these public aliases; HTTPS avoids old mixed-content redirects.
                return url.replace(/^https?:\/\/(?:epg\.it999\.ru|epg\.one)\//i, "https://cdn.epg.one/");
            });
            urls.forEach(function (url: string) { if (sources.indexOf(url) < 0) sources.push(url); });
            return { id: String(channel.id), name: channel.channel_name || channel.name || "",
                tvgId: channel.epg || "", tvgName: channel.tn || "", sources: urls,
                archiveHours: Math.max(0, Number(channel.rec) || 0) };
        });
        function report(message: string): void { if (!disposed && progress) progress(message); }
        function cancel(query: string, value: any): void {
            var job = pending[query];
            if (!job) return;
            delete pending[query]; host.clearTimeout(job.timer);
            if (!disposed) job.callback(value);
        }
        var session = {
            close: function () {
                if (disposed) return;
                disposed = true;
                Object.keys(pending).forEach(function (query) { host.clearTimeout(pending[query].timer); });
                pending = Object.create(null);
                if (worker) { worker.postMessage({ type: "close" }); worker.terminate(); }
                worker = null;
                if (previous === session) previous = null;
            },
            guide: function (id: string | number, callback: (rows: any) => void): void {
                if (disposed || !worker) { callback(null); return; }
                var query = String(++nextQuery);
                pending[query] = { callback: callback, timer: host.setTimeout(function () { cancel(query, null); }, 15000) };
                worker.postMessage({ type: "guide", id: String(id), query: query });
            }
        };
        previous = session;
        try {
            if (!configuration || !configuration.workerUrl || !host.Worker) throw new Error("EPG worker unavailable");
            // The deployment controls this fixed same-origin worker path, never a playlist.
            if (!/^\/(?!\/)/.test(configuration.workerUrl)) throw new Error("EPG worker must be same-origin");
            worker = new host.Worker(configuration.workerUrl);
            worker.onmessage = function (event: any) {
                if (disposed) return;
                var value = event.data || {};
                if (value.type === "guide") cancel(String(value.query), value.rows);
                else if (value.type === "ready") {
                    notify(value.mappings || {});
                    // Same channel/source IDs can now have a different schedule generation.
                    if (host.__ottClassicGuide && host.__ottClassicGuide.invalidate) host.__ottClassicGuide.invalidate(true);
                    report(value.stale ? host._("EPG: updating saved programme guide...") : host._("EPG ready"));
                } else if (value.type === "progress") report(value.phase === "download" ? host._("EPG: downloading programme guide...") : host._("EPG: processing programme guide..."));
                else if (value.type === "error") {
                    report(value.cached ? host._("EPG update failed; using saved programme guide") : host._("EPG unavailable: %1", value.code));
                }
            };
            worker.onerror = function () {
                Object.keys(pending).forEach(function (query) { cancel(query, null); });
                report(host._("EPG unavailable: %1", "EPG_WORKER"));
            };
            worker.postMessage({ type: "load", channels: rows, sources: sources,
                refreshMs: Math.max(60000, Number(configuration.refreshMs) || 7200000) });
        } catch (_) { report(host._("EPG unavailable on this browser")); }
        return session;
    }
    host.__ottHostedEpg = { enabled: function () { return !!settings(); }, open: open };
})(window);
