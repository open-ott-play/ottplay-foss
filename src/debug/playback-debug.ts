/**
 * Playback realtime debug (opt-in). Concat module — no imports; exposes window.__ottDebug.
 * Zero cost when off: intervals/network/HUD only after isDebugEnabled() at boot.
 * HS5-safe: ES5 classic script, full-width wrapping HUD banner (no flex/gap/grid).
 * Multi-port: tags port/origin/playerId on every event; auto-enable via GET /debug/config.
 */

var OTT_DEBUG_RING_MAX = 800;
var OTT_DEBUG_INGEST_MS = 2000;
var OTT_DEBUG_HUD_MS = 1000;
var OTT_DEBUG_STALL_MS = 3000;
var OTT_DEBUG_STATS_MS = 30000;

function ottDebugIsEnabled(): boolean {
    try {
        if ((window as any).__OTT_DEBUG__ === true) return true;
        if (
            typeof localStorage !== "undefined" &&
            localStorage.getItem("ottplay_debug") === "1"
        )
            return true;
        var q = typeof location !== "undefined" ? location.search || "" : "";
        if (q.indexOf("debug=1") !== -1 || q.indexOf("debug=true") !== -1)
            return true;
    } catch (_e) {}
    return false;
}

type OttDebugCat = "video" | "hls" | "net" | "stall" | "sys";

interface OttDebugEvent {
    cat: OttDebugCat;
    data?: any;
    msg: string;
    origin?: string;
    playerId?: string;
    port?: string;
    session: string;
    t: number;
    ua?: string;
}

var _ottDbgEnabled = false;
var _ottDbgRing: OttDebugEvent[] = [];
var _ottDbgSession = "";
var _ottDbgPlayerId = "";
var _ottDbgHudOn = true;
var _ottDbgHudEl: HTMLElement | null = null;
var _ottDbgHudTimer: ReturnType<typeof setInterval> | null = null;
var _ottDbgIngestTimer: ReturnType<typeof setInterval> | null = null;
var _ottDbgStatsTimer: ReturnType<typeof setInterval> | null = null;
var _ottDbgPending: OttDebugEvent[] = [];
var _ottDbgHls: any = null;
var _ottDbgVideo: HTMLVideoElement | null = null;
var _ottDbgStallTimer: ReturnType<typeof setTimeout> | null = null;
var _ottDbgStallSince = 0;
var _ottDbgLastError = "";
var _ottDbgLastDecodedBytes = 0;
var _ottDbgLastMbps = 0;

// Extended counters (flushed as periodic stats events)
var _ottDbgStallCount = 0;
var _ottDbgStallTotalMs = 0;
var _ottDbgStallMaxMs = 0;
var _ottDbgLastStallMs = 0;
var _ottDbgWaitingCount = 0;
var _ottDbgErrorCount = 0;
var _ottDbgRecoverCount = 0;
var _ottDbgSampleBufAhead = -1;
var _ottDbgSampleBw = -1;
var _ottDbgSampleLevel = -1;

function ottDebugShortId(): string {
    return Math.random().toString(36).slice(2, 8);
}

function ottDebugPort(): string {
    try {
        if (typeof location === "undefined") return "";
        if (location.port) return String(location.port);
        if (location.protocol === "https:") return "443";
        if (location.protocol === "http:") return "80";
    } catch (_e) {}
    return "";
}

function ottDebugOrigin(): string {
    try {
        if (typeof location !== "undefined" && location.origin)
            return String(location.origin);
    } catch (_e) {}
    return "";
}

function ottDebugUaShort(): string {
    try {
        var ua =
            typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
        if (!ua) return "";
        // Keep short: browser family + OS hint
        var m = ua.match(/(Chrome|Firefox|Safari|Edg|OPR)\/[\d.]+/);
        var browser = m ? m[0] : ua.substring(0, 24);
        var os = "";
        if (ua.indexOf("Macintosh") !== -1) os = "mac";
        else if (ua.indexOf("Windows") !== -1) os = "win";
        else if (ua.indexOf("Android") !== -1) os = "and";
        else if (ua.indexOf("iPhone") !== -1 || ua.indexOf("iPad") !== -1)
            os = "ios";
        else if (ua.indexOf("Linux") !== -1) os = "linux";
        return os ? browser + "/" + os : browser;
    } catch (_e2) {
        return "";
    }
}

function ottDebugEnsurePlayerId(): string {
    if (_ottDbgPlayerId) return _ottDbgPlayerId;
    try {
        if (typeof sessionStorage !== "undefined") {
            var existing = sessionStorage.getItem("ottplay_player_id");
            if (existing) {
                _ottDbgPlayerId = existing;
                return _ottDbgPlayerId;
            }
            var id = "p" + ottDebugShortId();
            sessionStorage.setItem("ottplay_player_id", id);
            _ottDbgPlayerId = id;
            return _ottDbgPlayerId;
        }
    } catch (_e) {}
    _ottDbgPlayerId = "p" + ottDebugShortId();
    return _ottDbgPlayerId;
}

function ottDebugTagEvent(ev: OttDebugEvent): OttDebugEvent {
    ev.port = ottDebugPort();
    ev.origin = ottDebugOrigin();
    ev.playerId = ottDebugEnsurePlayerId();
    var ua = ottDebugUaShort();
    if (ua) ev.ua = ua;
    return ev;
}

function ottDebugPush(cat: OttDebugCat, msg: string, data?: any): void {
    if (!_ottDbgEnabled) return;
    var ev: OttDebugEvent = ottDebugTagEvent({
        cat: cat,
        msg: msg,
        session: _ottDbgSession || "-",
        t: Date.now(),
    });
    if (data !== undefined) ev.data = data;
    _ottDbgRing.push(ev);
    if (_ottDbgRing.length > OTT_DEBUG_RING_MAX) {
        _ottDbgRing.splice(0, _ottDbgRing.length - OTT_DEBUG_RING_MAX);
    }
    _ottDbgPending.push(ev);
    if (
        cat === "stall" ||
        cat === "sys" ||
        msg === "error" ||
        msg === "stats" ||
        msg.indexOf("fatal") !== -1
    ) {
        ottDebugFlushIngest();
    }
}

function ottDebugDump(): string {
    var lines: string[] = [];
    for (var i = 0; i < _ottDbgRing.length; i++) {
        var e = _ottDbgRing[i];
        var extra = e.data !== undefined ? " " + JSON.stringify(e.data) : "";
        var tag =
            (e.port ? " :" + e.port : "") +
            (e.playerId ? " " + e.playerId : "");
        lines.push(
            e.t + " [" + e.session + tag + "] " + e.cat + " " + e.msg + extra
        );
    }
    return lines.join("\n");
}

function ottDebugClear(): void {
    _ottDbgRing = [];
    _ottDbgPending = [];
    _ottDbgLastError = "";
    _ottDbgStallSince = 0;
    _ottDbgStallCount = 0;
    _ottDbgStallTotalMs = 0;
    _ottDbgStallMaxMs = 0;
    _ottDbgLastStallMs = 0;
    _ottDbgWaitingCount = 0;
    _ottDbgErrorCount = 0;
    _ottDbgRecoverCount = 0;
}

function ottDebugSetHud(on: boolean): void {
    _ottDbgHudOn = !!on;
    if (!_ottDbgEnabled) return;
    if (_ottDbgHudOn) {
        ottDebugEnsureHud();
        ottDebugUpdateHud();
    } else if (_ottDbgHudEl && _ottDbgHudEl.parentNode) {
        _ottDbgHudEl.parentNode.removeChild(_ottDbgHudEl);
        _ottDbgHudEl = null;
    }
}

function ottDebugEnsureHud(): void {
    if (_ottDbgHudEl || !_ottDbgHudOn) return;
    var el = document.createElement("div");
    el.id = "ott_debug_hud";
    // Full-width top banner; HS5-safe (no flex/gap/grid). Fields wrap as flowing text.
    el.style.cssText =
        "position:absolute;top:6px;left:4px;right:4px;width:auto;max-width:none;" +
        "z-index:99999;background:rgba(0,0,0,0.75);color:#0f0;" +
        "font:11px/1.35 monospace;padding:4px 8px;pointer-events:none;" +
        "white-space:normal;text-align:left;display:block;box-sizing:border-box;";
    el.innerHTML = "ottDebug…";
    var parent = document.body || document.documentElement;
    if (parent) parent.appendChild(el);
    _ottDbgHudEl = el;
}

function ottDebugBufferAhead(v: HTMLVideoElement): number {
    try {
        var buf = v.buffered;
        var t = v.currentTime || 0;
        var ahead = 0;
        for (var i = 0; i < buf.length; i++) {
            if (buf.start(i) <= t && buf.end(i) >= t) {
                ahead = buf.end(i) - t;
                break;
            }
            if (buf.start(i) > t) {
                ahead = Math.max(ahead, buf.end(i) - t);
            }
        }
        return Math.round(ahead * 100) / 100;
    } catch (_e) {
        return -1;
    }
}

function ottDebugDecodedMbps(v: HTMLVideoElement): number {
    var anyV = v as any;
    if (anyV.webkitVideoDecodedByteCount !== undefined) {
        var cur = anyV.webkitVideoDecodedByteCount || 0;
        if (_ottDbgLastDecodedBytes > 0 && cur >= _ottDbgLastDecodedBytes) {
            _ottDbgLastMbps =
                Math.round(
                    (((cur - _ottDbgLastDecodedBytes) * 8) / 1024 / 1024) * 100
                ) / 100;
        }
        _ottDbgLastDecodedBytes = cur;
        return _ottDbgLastMbps;
    }
    return -1;
}

function ottDebugDroppedFrames(v: HTMLVideoElement): number {
    try {
        if (typeof (v as any).getVideoPlaybackQuality === "function") {
            var q = (v as any).getVideoPlaybackQuality();
            if (q && typeof q.droppedVideoFrames === "number")
                return q.droppedVideoFrames;
        }
    } catch (_e) {}
    return -1;
}

function ottDebugRefreshSamples(): void {
    var v =
        _ottDbgVideo ||
        (document.getElementById("video") as HTMLVideoElement | null);
    if (v) _ottDbgSampleBufAhead = ottDebugBufferAhead(v);
    var hls = _ottDbgHls;
    if (hls) {
        _ottDbgSampleLevel =
            typeof hls.currentLevel === "number" ? hls.currentLevel : -1;
        _ottDbgSampleBw =
            hls.bandwidthEstimate != null
                ? Math.round(hls.bandwidthEstimate / 1000)
                : -1;
    }
}

function ottDebugCounters(): any {
    return {
        bufferAhead: _ottDbgSampleBufAhead,
        bwEstimate: _ottDbgSampleBw,
        errorCount: _ottDbgErrorCount,
        lastStallMs: _ottDbgLastStallMs,
        level: _ottDbgSampleLevel,
        recoverCount: _ottDbgRecoverCount,
        stallCount: _ottDbgStallCount,
        stallMaxMs: _ottDbgStallMaxMs,
        stallTotalMs: _ottDbgStallTotalMs,
        waitingCount: _ottDbgWaitingCount,
    };
}

function ottDebugPushStats(): void {
    if (!_ottDbgEnabled) return;
    ottDebugRefreshSamples();
    ottDebugPush("sys", "stats", ottDebugCounters());
}

function ottDebugUpdateHud(): void {
    if (!_ottDbgEnabled || !_ottDbgHudOn) return;
    ottDebugEnsureHud();
    if (!_ottDbgHudEl) return;
    var v =
        _ottDbgVideo ||
        (document.getElementById("video") as HTMLVideoElement | null);
    ottDebugRefreshSamples();
    // Flowing top-banner text (wraps horizontally); join with " · ", not <br/> per field.
    var parts: string[] = [];
    parts.push("ottDebug sess=" + (_ottDbgSession || "-"));
    parts.push(
        "port=" +
            (ottDebugPort() || "-") +
            " id=" +
            (ottDebugEnsurePlayerId() || "-") +
            " stalls=" +
            _ottDbgStallCount +
            " tot=" +
            Math.round(_ottDbgStallTotalMs / 1000) +
            "s max=" +
            Math.round(_ottDbgStallMaxMs / 1000) +
            "s"
    );
    if (!v) {
        parts.push("(no video)");
        _ottDbgHudEl.innerHTML = parts.join(" · ");
        return;
    }
    parts.push(
        (v.paused ? "paused" : "playing") +
            " rs=" +
            v.readyState +
            " ns=" +
            v.networkState
    );
    parts.push("bufAhead=" + ottDebugBufferAhead(v) + "s");
    parts.push(
        "video " +
            (v.videoWidth || 0) +
            "x" +
            (v.videoHeight || 0) +
            " mbps=" +
            ottDebugDecodedMbps(v)
    );
    var hls = _ottDbgHls;
    if (hls) {
        var lvls = hls.levels || [];
        parts.push(
            "hls lvl=" +
                hls.currentLevel +
                "/" +
                lvls.length +
                " bw=" +
                (hls.bandwidthEstimate != null
                    ? Math.round(hls.bandwidthEstimate / 1000) + "k"
                    : "-") +
                " cap=" +
                hls.autoLevelCapping
        );
    } else {
        parts.push("hls: -");
    }
    var stallAge =
        _ottDbgStallSince > 0
            ? Math.round((Date.now() - _ottDbgStallSince) / 1000) + "s"
            : "-";
    parts.push("stallAge=" + stallAge + " err=" + (_ottDbgLastError || "-"));
    var dropped = ottDebugDroppedFrames(v);
    if (dropped >= 0) parts.push("droppedFrames=" + dropped);
    parts.push("ring=" + _ottDbgRing.length + "/" + OTT_DEBUG_RING_MAX);
    _ottDbgHudEl.innerHTML = parts.join(" · ");
}

function ottDebugBuildIngestBody(batch: OttDebugEvent[]): string {
    return JSON.stringify({
        events: batch,
        origin: ottDebugOrigin(),
        playerId: ottDebugEnsurePlayerId(),
        port: ottDebugPort(),
        session: _ottDbgSession || "-",
        ua: ottDebugUaShort() || undefined,
    });
}

function ottDebugFlushIngest(): void {
    if (!_ottDbgEnabled || !_ottDbgPending.length) return;
    var batch = _ottDbgPending.slice();
    _ottDbgPending = [];
    var body = ottDebugBuildIngestBody(batch);
    try {
        if (typeof fetch === "function") {
            fetch("/debug/ingest", {
                body: body,
                headers: { "Content-Type": "application/json" },
                method: "POST",
            }).catch(function () {
                // Network fail — re-queue so urgent/beacon flush can retry.
                _ottDbgPending = batch.concat(_ottDbgPending);
            });
            return;
        }
    } catch (_e) {}
    try {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/debug/ingest", true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(body);
    } catch (_e2) {
        _ottDbgPending = batch.concat(_ottDbgPending);
    }
}

/** Unload/hide flush: Beacon when available, else sync XHR (HS5-safe feature-detect). */
function ottDebugFlushIngestUrgent(): void {
    if (!_ottDbgEnabled || !_ottDbgPending.length) return;
    var batch = _ottDbgPending.slice();
    _ottDbgPending = [];
    var body = ottDebugBuildIngestBody(batch);
    var sent = false;
    try {
        if (
            typeof navigator !== "undefined" &&
            typeof (navigator as any).sendBeacon === "function"
        ) {
            if (typeof Blob !== "undefined") {
                var blob = new Blob([body], { type: "application/json" });
                sent = !!(navigator as any).sendBeacon("/debug/ingest", blob);
            } else {
                // String body → text/plain; server parses JSON from bytes anyway.
                sent = !!(navigator as any).sendBeacon("/debug/ingest", body);
            }
        }
    } catch (_e) {}
    if (!sent) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "/debug/ingest", false);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.send(body);
            sent = true;
        } catch (_e2) {}
    }
    if (!sent) {
        _ottDbgPending = batch.concat(_ottDbgPending);
    }
}

function ottDebugClearStallTimer(): void {
    if (_ottDbgStallTimer !== null) {
        clearTimeout(_ottDbgStallTimer);
        _ottDbgStallTimer = null;
    }
}

function ottDebugEndStallIfAny(): void {
    if (!_ottDbgStallSince) return;
    var dur = Date.now() - _ottDbgStallSince;
    _ottDbgLastStallMs = dur;
    if (dur >= OTT_DEBUG_STALL_MS) {
        _ottDbgStallCount++;
        _ottDbgStallTotalMs += dur;
        if (dur > _ottDbgStallMaxMs) _ottDbgStallMaxMs = dur;
    }
    _ottDbgStallSince = 0;
}

function ottDebugOnVideoEvent(event: Event): void {
    if (!_ottDbgEnabled || !event || !event.type) return;
    var t = event.type;
    if (
        t !== "waiting" &&
        t !== "stalled" &&
        t !== "playing" &&
        t !== "error" &&
        t !== "pause" &&
        t !== "play" &&
        t !== "canplay" &&
        t !== "emptied" &&
        t !== "abort" &&
        t !== "ended"
    ) {
        return;
    }
    var data: any = undefined;
    if (t === "error") {
        _ottDbgErrorCount++;
        var v =
            _ottDbgVideo ||
            (document.getElementById("video") as HTMLVideoElement | null);
        var me = v && v.error ? v.error : null;
        if (me) {
            data = { code: me.code, message: me.message };
            _ottDbgLastError =
                String(me.code) + (me.message ? " " + me.message : "");
        } else {
            _ottDbgLastError = "error";
        }
    }
    ottDebugPush("video", t, data);
    if (t === "waiting" || t === "stalled") {
        _ottDbgWaitingCount++;
        if (!_ottDbgStallSince) _ottDbgStallSince = Date.now();
        ottDebugClearStallTimer();
        _ottDbgStallTimer = setTimeout(function () {
            _ottDbgStallTimer = null;
            var v2 =
                _ottDbgVideo ||
                (document.getElementById("video") as HTMLVideoElement | null);
            if (v2 && !v2.paused && v2.readyState < 3) {
                ottDebugPush("stall", "waiting>3s", {
                    ageMs: Date.now() - (_ottDbgStallSince || Date.now()),
                    bufAhead: ottDebugBufferAhead(v2),
                    networkState: v2.networkState,
                    readyState: v2.readyState,
                });
            }
        }, OTT_DEBUG_STALL_MS);
    }
    if (t === "playing") {
        ottDebugClearStallTimer();
        ottDebugEndStallIfAny();
    }
}

function ottDebugBeginSession(_url?: string): void {
    if (!_ottDbgEnabled) return;
    _ottDbgSession = ottDebugShortId();
    _ottDbgHls = null;
    _ottDbgVideo = document.getElementById("video") as HTMLVideoElement | null;
    _ottDbgLastDecodedBytes = 0;
    _ottDbgLastMbps = 0;
    _ottDbgStallSince = 0;
    ottDebugClearStallTimer();
    ottDebugPush(
        "sys",
        "stbPlay",
        _url ? { url: String(_url).substring(0, 120) } : undefined
    );
}

function ottDebugWrapXhrSetup(
    prevXhr?: any
): (xhr: XMLHttpRequest, url: string) => void {
    return function (xhr: XMLHttpRequest, url: string) {
        if (typeof prevXhr === "function") {
            try {
                prevXhr(xhr, url);
            } catch (_e) {}
        }
        if (!_ottDbgEnabled) return;
        xhr.addEventListener("load", function () {
            if (xhr.status >= 400) {
                ottDebugPush("net", "xhr status", {
                    status: xhr.status,
                    url: String(url).substring(0, 160),
                });
            }
        });
        xhr.addEventListener("error", function () {
            ottDebugPush("net", "xhr error", {
                url: String(url).substring(0, 160),
            });
        });
    };
}

function ottDebugWrapRecover(hls: any): void {
    if (!hls) return;
    if (
        typeof hls.recoverMediaError === "function" &&
        !hls.__ottDbgRecoverWrapped
    ) {
        var prevRecover = hls.recoverMediaError.bind(hls);
        hls.recoverMediaError = function () {
            _ottDbgRecoverCount++;
            ottDebugPush("hls", "recoverMediaError", {
                recoverCount: _ottDbgRecoverCount,
            });
            return prevRecover();
        };
        hls.__ottDbgRecoverWrapped = true;
    }
    if (typeof hls.startLoad === "function" && !hls.__ottDbgStartLoadWrapped) {
        var prevStart = hls.startLoad.bind(hls);
        hls.startLoad = function (startPosition?: number) {
            _ottDbgRecoverCount++;
            ottDebugPush("hls", "startLoad", {
                recoverCount: _ottDbgRecoverCount,
                startPosition: startPosition,
            });
            return prevStart(startPosition);
        };
        hls.__ottDbgStartLoadWrapped = true;
    }
}

function ottDebugAttachHls(hls: any): void {
    if (!_ottDbgEnabled || !hls || typeof hls.on !== "function") return;
    _ottDbgHls = hls;
    ottDebugWrapRecover(hls);
    var HlsRef = typeof Hls !== "undefined" ? Hls : (window as any).Hls;
    if (!HlsRef || !HlsRef.Events) return;
    var Ev = HlsRef.Events;

    hls.on(Ev.ERROR, function (_e: any, data: any) {
        var fatal = !!(data && data.fatal);
        if (fatal) {
            _ottDbgErrorCount++;
            _ottDbgLastError =
                "hls:" +
                String((data && data.type) || "") +
                "/" +
                String((data && data.details) || "");
        }
        ottDebugPush(fatal ? "hls" : "hls", fatal ? "ERROR fatal" : "ERROR", {
            details: data && data.details,
            fatal: fatal,
            level: data && data.level,
            type: data && data.type,
        });
    });

    hls.on(Ev.FRAG_LOADED, function (_e: any, data: any) {
        var frag = data && data.frag;
        var stats = data && data.stats;
        ottDebugPush("hls", "FRAG_LOADED", {
            level: frag && frag.level,
            loadMs:
                stats && stats.loading
                    ? stats.loading.end - stats.loading.start
                    : undefined,
            size: stats && (stats.total || stats.loaded),
            sn: frag && frag.sn,
        });
    });

    hls.on(Ev.LEVEL_SWITCHED, function (_e: any, data: any) {
        ottDebugPush("hls", "LEVEL_SWITCHED", { level: data && data.level });
    });

    hls.on(Ev.LEVEL_LOADED, function (_e: any, data: any) {
        ottDebugPush("hls", "LEVEL_LOADED", {
            details:
                data && data.details ? { live: data.details.live } : undefined,
            level: data && data.level,
        });
    });

    hls.on(Ev.MANIFEST_PARSED, function (_e: any, data: any) {
        var levels = (data && data.levels) || hls.levels || [];
        var summary: any[] = [];
        for (var i = 0; i < levels.length; i++) {
            var L = levels[i];
            summary.push({
                bw: L && L.bitrate,
                h: L && L.height,
                i: i,
            });
        }
        ottDebugPush("hls", "MANIFEST_PARSED", {
            levels: summary.length,
            summary: summary,
        });
    });

    // xhrSetup must be set on hlsConfig before new Hls — see wrapXhrSetup.
}

function ottDebugOnVisibilityFlush(): void {
    if (!_ottDbgEnabled) return;
    try {
        // Final stats into pending without async auto-flush (ottDebugPush would
        // fire fetch for msg===stats); Beacon/sync XHR must carry the last batch.
        ottDebugRefreshSamples();
        var ev: OttDebugEvent = ottDebugTagEvent({
            cat: "sys",
            msg: "unload-stats",
            session: _ottDbgSession || "-",
            t: Date.now(),
        });
        ev.data = ottDebugCounters();
        _ottDbgRing.push(ev);
        if (_ottDbgRing.length > OTT_DEBUG_RING_MAX) {
            _ottDbgRing.splice(0, _ottDbgRing.length - OTT_DEBUG_RING_MAX);
        }
        _ottDbgPending.push(ev);
        ottDebugFlushIngestUrgent();
    } catch (_e) {}
}

function ottDebugInstallFlushHooks(): void {
    try {
        if (typeof document !== "undefined" && document.addEventListener) {
            document.addEventListener(
                "visibilitychange",
                function () {
                    if (document.visibilityState === "hidden") {
                        ottDebugOnVisibilityFlush();
                    }
                },
                false
            );
        }
        if (typeof window !== "undefined" && window.addEventListener) {
            window.addEventListener(
                "pagehide",
                ottDebugOnVisibilityFlush,
                false
            );
            window.addEventListener(
                "beforeunload",
                ottDebugOnVisibilityFlush,
                false
            );
        }
    } catch (_e) {}
}

function ottDebugInstallApi(enabled: boolean): void {
    if (enabled) {
        (window as any).__ottDebug = {
            attachHls: ottDebugAttachHls,
            beginSession: ottDebugBeginSession,
            clear: ottDebugClear,
            dump: ottDebugDump,
            enabled: true,
            isDebugEnabled: ottDebugIsEnabled,
            onVideoEvent: ottDebugOnVideoEvent,
            push: ottDebugPush,
            setHud: ottDebugSetHud,
            toggleHud: function () {
                ottDebugSetHud(!_ottDbgHudOn);
            },
            wrapXhrSetup: ottDebugWrapXhrSetup,
        };
    } else {
        (window as any).__ottDebug = {
            attachHls: function () {},
            beginSession: function () {},
            clear: function () {},
            dump: function () {
                return "";
            },
            enabled: false,
            isDebugEnabled: ottDebugIsEnabled,
            onVideoEvent: function () {},
            push: function () {},
            setHud: function () {},
            toggleHud: function () {},
            wrapXhrSetup: function (prev: any) {
                return prev;
            },
        };
    }
}

function ottDebugEnable(): void {
    if (_ottDbgEnabled) return;
    _ottDbgEnabled = true;
    try {
        (window as any).__OTT_DEBUG__ = true;
    } catch (_e) {}
    ottDebugEnsurePlayerId();
    console.info(
        "[ottDebug] enabled port=" + ottDebugPort() + " id=" + _ottDbgPlayerId
    );
    ottDebugEnsureHud();
    ottDebugPush("sys", "boot", {
        href: typeof location !== "undefined" ? location.href : "",
        origin: ottDebugOrigin(),
        playerId: _ottDbgPlayerId,
        port: ottDebugPort(),
    });

    if (_ottDbgHudTimer === null) {
        _ottDbgHudTimer = setInterval(ottDebugUpdateHud, OTT_DEBUG_HUD_MS);
    }
    if (_ottDbgIngestTimer === null) {
        _ottDbgIngestTimer = setInterval(
            ottDebugFlushIngest,
            OTT_DEBUG_INGEST_MS
        );
    }
    if (_ottDbgStatsTimer === null) {
        _ottDbgStatsTimer = setInterval(ottDebugPushStats, OTT_DEBUG_STATS_MS);
    }
    ottDebugInstallFlushHooks();

    // D hotkey: toggle HUD strip. Installed once here so listener is only active
    // when debug is enabled. Safe on PC (keyCode 68 unused) and on MAG/Maple
    // (e.key avoids their PLAY/PREV=68 mapping).
    try {
        var _ottDbgKeyInstalled = false;
        function _ottDbgOnKeyDown(e: KeyboardEvent) {
            var target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
            ) {
                return;
            }
            var match = false;
            if (e.key === "d" || e.key === "D") {
                match = true;
            } else if (e.keyCode === 68) {
                var k = (window as any).keys;
                // MAG/Maple map 68 to PLAY/PREV — do not steal those keys.
                if (!k || (k.PLAY !== 68 && k.PREV !== 68)) match = true;
            }
            if (match) {
                e.preventDefault();
                e.stopPropagation();
                ottDebugSetHud(!_ottDbgHudOn);
                console.info("[ottDebug] HUD " + (_ottDbgHudOn ? "on" : "off"));
            }
        }
        if (!_ottDbgKeyInstalled) {
            if (typeof document !== "undefined" && document.addEventListener) {
                document.addEventListener("keydown", _ottDbgOnKeyDown, false);
            }
            _ottDbgKeyInstalled = true;
        }
    } catch (_e3) {}

    ottDebugInstallApi(true);
    ottDebugUpdateHud();
}

function ottDebugTryServerConfig(): void {
    try {
        if (typeof fetch !== "function") return;
        fetch("/debug/config")
            .then(function (r) {
                if (!r || !r.ok) return null;
                return r.json();
            })
            .then(function (cfg) {
                if (cfg && cfg.enabled === true) {
                    ottDebugEnable();
                }
            })
            .catch(function () {});
    } catch (_e) {}
}

function ottDebugBoot(): void {
    if (ottDebugIsEnabled()) {
        ottDebugEnable();
        return;
    }
    ottDebugInstallApi(false);
    // Auto-enable from server (OTTPLAY_DEBUG=1 or debug.enabled file) — silent fail.
    ottDebugTryServerConfig();
}

declare var Hls: any;

ottDebugBoot();
