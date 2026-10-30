/** Load presentation independently of providers, media lifetime and screen input. */
(function (w: any): void {
    var waiting: ((ready: boolean) => void)[] = [];
    var loading = false;
    var failed = false;
    var revision = 0;
    var state = {
        effective: 0,
        error: "",
        requested: 0,
        status: "classic",
    };

    function available(): boolean {
        return !!(
            w.__ottModernUi &&
            typeof w.__ottModernUi.refresh === "function" &&
            typeof w.__ottModernUi.prepare === "function" &&
            (typeof w.__ottModernUi.supported !== "function" ||
                w.__ottModernUi.supported())
        );
    }

    function style(modern: boolean): void {
        var body = w.document && w.document.body;
        if (body && body.classList)
            body.classList.toggle("interface-modern", modern);
        state.effective = modern ? 1 : 0;
    }

    function ensure(ready: (success: boolean) => void): void {
        if (available()) {
            ready(true);
            return;
        }
        if (failed) {
            ready(false);
            return;
        }
        waiting.push(ready);
        if (loading) return;
        loading = true;
        var script = w.document.createElement("script");
        var settled = false;
        var timer = w.setTimeout(function () {
            finish(false);
        }, 15000);
        function finish(success: boolean): void {
            if (settled) return;
            settled = true;
            w.clearTimeout(timer);
            script.onload = script.onerror = null;
            if (script.parentNode) script.parentNode.removeChild(script);
            loading = false;
            success = success && available();
            failed = !success;
            var callbacks = waiting;
            waiting = [];
            callbacks.forEach(function (callback) {
                try {
                    callback(success);
                } catch (_) {}
            });
        }
        script.type = "text/javascript";
        script.src =
            String(w.hostUrl || w.host || "").replace(/\/$/, "") +
            "/dist/modern-interface.js?" +
            encodeURIComponent(w.__cv || "");
        if (!/^file:/.test(script.src)) script.crossOrigin = "anonymous";
        script.onload = function () {
            finish(true);
        };
        script.onerror = function () {
            finish(false);
        };
        try {
            (w.document.head || w.document.body).appendChild(script);
        } catch (_) {
            finish(false);
        }
    }

    function refresh(): void {
        if (available()) w.__ottModernUi.refresh();
    }

    function setMode(): void {
        var current = ++revision;
        state.requested = Number(w.sInterfaceMode) === 1 ? 1 : 0;
        state.error = "";
        if (!state.requested) {
            // An explicit return to Classic permits a later user retry.
            failed = false;
            state.status = "classic";
            style(false);
            try {
                refresh();
            } catch (_) {
                // A broken optional presentation must not block leaving it.
                state.error = "modern_render_failed";
            }
            return;
        }
        state.status = "loading";
        ensure(function (ready) {
            if (current !== revision || Number(w.sInterfaceMode) !== 1) return;
            state.status = ready ? "modern" : "fallback";
            state.error = ready ? "" : "modern_asset_unavailable";
            style(ready);
            try {
                refresh();
            } catch (_) {
                state.status = "fallback";
                state.error = "modern_render_failed";
                style(false);
                try {
                    refresh();
                } catch (_) {}
            }
            if (state.error && typeof w.showPopup === "function") {
                var message =
                    "Modern interface is unavailable. Classic remains active.";
                w.showPopup(typeof w._ === "function" ? w._(message) : message);
            }
        });
    }

    w.__ottEnsureModernUi = ensure;
    w.__ottInterfaceModeState = state;
    w.setInterfaceMode = setMode;
})(window);
