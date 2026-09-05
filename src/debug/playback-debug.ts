/**
 * Playback realtime debug (opt-in). Concat module — no imports; exposes window.__ottDebug.
 * Zero cost when off: intervals/network/HUD only after isDebugEnabled() at boot.
 * HS5-safe: ES5 classic script, block/br HUD CSS only (no flex/gap/grid).
 */

var OTT_DEBUG_RING_MAX = 800;
var OTT_DEBUG_INGEST_MS = 2000;
var OTT_DEBUG_HUD_MS = 1000;
var OTT_DEBUG_STALL_MS = 3000;

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
    session: string;
    t: number;
}

var _ottDbgEnabled = false;
var _ottDbgRing: OttDebugEvent[] = [];
var _ottDbgSession = "";
var _ottDbgHudOn = true;
var _ottDbgHudEl: HTMLElement | null = null;
var _ottDbgHudTimer: ReturnType<typeof setInterval> | null = null;
var _ottDbgIngestTimer: ReturnType<typeof setInterval> | null = null;
var _ottDbgPending: OttDebugEvent[] = [];
var _ottDbgHls: any = null;
var _ottDbgVideo: HTMLVideoElement | null = null;
var _ottDbgStallTimer: ReturnType<typeof setTimeout> | null = null;
var _ottDbgStallSince = 0;
var _ottDbgLastError = "";
var _ottDbgLastDecodedBytes = 0;
var _ottDbgLastMbps = 0;

function ottDebugShortId(): string {
    return Math.random().toString(36).slice(2, 8);
}

function ottDebugPush(cat: OttDebugCat, msg: string, data?: any): void {
    if (!_ottDbgEnabled) return;
    var ev: OttDebugEvent = {
        cat: cat,
        msg: msg,
        session: _ottDbgSession || "-",
        t: Date.now(),
    };
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
        lines.push(e.t + " [" + e.session + "] " + e.cat + " " + e.msg + extra);
    }
    return lines.join("\n");
}

function ottDebugClear(): void {
    _ottDbgRing = [];
    _ottDbgPending = [];
    _ottDbgLastError = "";
    _ottDbgStallSince = 0;
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
    el.style.cssText =
        "position:absolute;top:8px;right:8px;z-index:99999;" +
        "background:rgba(0,0,0,0.75);color:#0f0;font:11px/1.35 monospace;" +
        "padding:8px 10px;max-width:360px;pointer-events:none;" +
        "white-space:pre;display:block;";
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

function ottDebugUpdateHud(): void {
    if (!_ottDbgEnabled || !_ottDbgHudOn) return;
    ottDebugEnsureHud();
    if (!_ottDbgHudEl) return;
    var v =
        _ottDbgVideo ||
        (document.getElementById("video") as HTMLVideoElement | null);
    var lines: string[] = [];
    lines.push("ottDebug sess=" + (_ottDbgSession || "-"));
    if (!v) {
        lines.push("(no video)");
        _ottDbgHudEl.innerHTML = lines.join("<br/>");
        return;
    }
    lines.push(
        (v.paused ? "paused" : "playing") +
            " rs=" +
            v.readyState +
            " ns=" +
            v.networkState
    );
    lines.push("bufAhead=" + ottDebugBufferAhead(v) + "s");
    lines.push(
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
        lines.push(
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
        lines.push("hls: -");
    }
    var stallAge =
        _ottDbgStallSince > 0
            ? Math.round((Date.now() - _ottDbgStallSince) / 1000) + "s"
            : "-";
    lines.push("stallAge=" + stallAge + " err=" + (_ottDbgLastError || "-"));
    var dropped = ottDebugDroppedFrames(v);
    if (dropped >= 0) lines.push("droppedFrames=" + dropped);
    lines.push("ring=" + _ottDbgRing.length + "/" + OTT_DEBUG_RING_MAX);
    _ottDbgHudEl.innerHTML = lines.join("<br/>");
}

function ottDebugFlushIngest(): void {
    if (!_ottDbgEnabled || !_ottDbgPending.length) return;
    var batch = _ottDbgPending.slice();
    _ottDbgPending = [];
    var body = JSON.stringify({
        events: batch,
        session: _ottDbgSession || "-",
    });
    try {
        if (typeof fetch === "function") {
            fetch("/debug/ingest", {
                body: body,
                headers: { "Content-Type": "application/json" },
                method: "POST",
            }).catch(function () {});
            return;
        }
    } catch (_e) {}
    try {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/debug/ingest", true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(body);
    } catch (_e2) {}
}

function ottDebugClearStallTimer(): void {
    if (_ottDbgStallTimer !== null) {
        clearTimeout(_ottDbgStallTimer);
        _ottDbgStallTimer = null;
    }
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
        _ottDbgStallSince = 0;
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

function ottDebugAttachHls(hls: any): void {
    if (!_ottDbgEnabled || !hls || typeof hls.on !== "function") return;
    _ottDbgHls = hls;
    var HlsRef = typeof Hls !== "undefined" ? Hls : (window as any).Hls;
    if (!HlsRef || !HlsRef.Events) return;
    var Ev = HlsRef.Events;

    hls.on(Ev.ERROR, function (_e: any, data: any) {
        var fatal = !!(data && data.fatal);
        if (fatal) {
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

function ottDebugBoot(): void {
    if (!ottDebugIsEnabled()) {
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
            wrapXhrSetup: function (prev: any) {
                return prev;
            },
        };
        return;
    }
    _ottDbgEnabled = true;
    console.info("[ottDebug] enabled");
    ottDebugEnsureHud();
    ottDebugPush("sys", "boot", {
        href: typeof location !== "undefined" ? location.href : "",
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
        wrapXhrSetup: ottDebugWrapXhrSetup,
    };
    ottDebugUpdateHud();
}

declare var Hls: any;

ottDebugBoot();
