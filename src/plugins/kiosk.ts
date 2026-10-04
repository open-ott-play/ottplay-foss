import { caselessKey } from "../utils/caseless";

/** Device-local policy. Only the authenticated command-server dispatcher mutates it. */
export function createKiosk(w: any): any {
    var key = "__ottKioskV1";
    var policy: any = null;
    var timer: any = null;
    var lastProgress = 0;
    var lastPosition: number | null = null;
    var retries = 0;
    var health = "idle";
    function now(): number {
        return w.performance && typeof w.performance.now === "function"
            ? w.performance.now()
            : Date.now();
    }
    function source(): string {
        return w.__ottSourceIdentity.current(w);
    }
    function provider(): string {
        return String((w.__ottActiveProviderDriver || {}).id || w.p_pref || "");
    }
    function enabled(): boolean {
        return !!policy;
    }
    function locked(): boolean {
        return !!(policy && policy.channel);
    }
    function reset(): void {
        lastPosition = null;
        lastProgress = now();
        health = locked() ? "starting" : policy ? "waiting" : "idle";
    }
    function save(next: any): boolean {
        try {
            var value = JSON.stringify(next);
            w.stbSetItem(key, value);
            if (w.stbGetItem(key) !== value) return false;
        } catch (_) {
            return false;
        }
        policy = next;
        reset();
        if (typeof w.setSleepTimeout === "function") w.setSleepTimeout();
        return true;
    }
    function snapshot(): any {
        return {
            channel: locked()
                ? { id: policy.channel.id, name: policy.channel.name }
                : null,
            enabled: enabled(),
            health: health,
            provider: policy ? policy.provider : null,
            retries: retries,
            retry_seconds: 10,
            state: locked() ? "locked" : policy ? "waiting" : "off",
        };
    }
    function allowed(id: any): boolean {
        return (
            !locked() ||
            (source() === policy.source && String(id) === policy.channel.id)
        );
    }
    function admit(id: any): boolean {
        if (!allowed(id)) return false;
        if (policy && !policy.channel) {
            // Arming does not capture the already playing channel or a boot callback.
            if (w.commandChannelsReady !== true || source() !== policy.source)
                return false;
            if (
                !save({
                    channel: {
                        id: String(id),
                        name: String(w.channels[id].channel_name || ""),
                    },
                    provider: policy.provider,
                    source: policy.source,
                })
            )
                return false;
            closeControls();
        }
        return true;
    }
    function locate(id: string): number[] | null {
        var categories = w.catsArray || [];
        for (var c = 0; c < categories.length; c++) {
            var list = (w.cats || {})[categories[c]] || [];
            for (var i = 0; i < list.length; i++)
                if (String(list[i]) === id) return [c, i];
        }
        return null;
    }
    function closeControls(): void {
        if (typeof w.closeList === "function") w.closeList();
        if (typeof w.stbStopPip === "function") w.stbStopPip();
        w.pipIndex = null;
        if (w.__ottMedia && w.__ottMedia.cancelRequest)
            w.__ottMedia.cancelRequest();
    }
    function play(): void {
        if (!locked() || w.commandChannelsReady !== true) return;
        if (source() !== policy.source) {
            health = "source-unavailable";
            return;
        }
        var indices = locate(policy.channel.id);
        if (!indices || !(w.channels || {})[policy.channel.id]) {
            health = "channel-unavailable";
            return;
        }
        // Resolve the channel again, including expiring provider URLs. Never reuse
        // an old stream URL, list position, or a different provider's identical ID.
        w.playChannel(indices[0], indices[1]);
    }
    function tick(): void {
        if (!locked()) return;
        var time = now();
        if (time < lastProgress) lastProgress = time;
        try {
            var id = (w.curList || [])[w.primaryIndex];
            var position = w.stbGetPosTime();
            var valid =
                typeof position === "number" &&
                isFinite(position) &&
                position >= 0;
            if (
                allowed(id) &&
                w.stbIsPlaying() &&
                valid &&
                lastPosition !== null &&
                position > lastPosition
            ) {
                lastProgress = time;
                health = "playing";
            }
            lastPosition = valid ? position : null;
        } catch (_) {
            lastPosition = null;
            health = "error";
        }
        if (time - lastProgress < 10000) return;
        lastProgress = time;
        lastPosition = null;
        health = "retrying";
        retries++;
        try {
            play();
        } catch (_) {
            health = "error";
        }
    }
    function validQuery(query: string): boolean {
        try {
            return (
                !/[\x00-\x1f\x7f]/.test(query) &&
                encodeURIComponent(query).replace(/%[0-9A-F]{2}/g, "x")
                    .length <= 1024
            );
        } catch (_) {
            return false;
        }
    }
    function request(params: any, done: (result: any) => void): void {
        function fail(message: string): void {
            done({ data: { error: message }, status: "rejected" });
        }
        var mode = params && params.mode;
        if (
            !params ||
            typeof params !== "object" ||
            Array.isArray(params) ||
            Object.keys(params).some(function (name) {
                return name !== "mode" && name !== "query";
            }) ||
            ["status", "on", "off", "set"].indexOf(mode) < 0 ||
            (params.query !== undefined &&
                (typeof params.query !== "string" ||
                    !params.query.trim() ||
                    !validQuery(params.query))) ||
            ((mode === "off" || mode === "status") &&
                params.query !== undefined) ||
            (mode === "set" && params.query === undefined)
        ) {
            fail("Use kiosk status, on [CHANNEL], set CHANNEL or off.");
            return;
        }
        if (mode === "status") {
            done({ data: snapshot(), status: "ok" });
            return;
        }
        if (mode === "off") {
            if (!save(null)) {
                fail("Could not save kiosk policy.");
                return;
            }
        } else {
            if (mode === "set" && !enabled()) {
                fail("Enable kiosk mode first.");
                return;
            }
            if (mode === "on" && enabled() && params.query === undefined) {
                done({ data: snapshot(), status: "ok" });
                return;
            }
            if (
                w.commandChannelsReady !== true ||
                !(w.cList || w.curList || []).length ||
                !w.__ottSourceIdentity ||
                typeof w.playChannel !== "function" ||
                typeof w.stbIsPlaying !== "function" ||
                typeof w.stbGetPosTime !== "function"
            ) {
                fail("Wait for a player with channel playback to be ready.");
                return;
            }
            if (
                w.__ottParental &&
                (w.__ottParental.needs("providers") ||
                    w.__ottParental.needs("settings"))
            ) {
                fail(
                    "Unlock player settings before enabling or changing kiosk mode."
                );
                return;
            }
            var selected: any = null;
            if (params.query !== undefined) {
                var text = params.query.trim();
                var rows = (w.cList || w.curList || [])
                    .filter(function (id: any, i: number, ids: any[]) {
                        return ids.indexOf(id) === i && (w.channels || {})[id];
                    })
                    .map(function (id: any, i: number) {
                        return {
                            id: String(id),
                            name: String(w.channels[id].channel_name || ""),
                            number: i + 1,
                        };
                    });
                var matches = rows.filter(function (row: any) {
                    return /^\d+$/.test(text)
                        ? row.number === Number(text)
                        : caselessKey(row.name) === caselessKey(text);
                });
                if (!matches.length && !/^\d+$/.test(text))
                    matches = rows.filter(function (row: any) {
                        return (
                            caselessKey(row.name).indexOf(caselessKey(text)) !==
                            -1
                        );
                    });
                if (matches.length !== 1 || !locate(matches[0].id)) {
                    fail(
                        "Choose one available channel by its catalogue number or unique name."
                    );
                    return;
                }
                selected = { id: matches[0].id, name: matches[0].name };
                if (
                    typeof w.ifParentalAccessChId === "function" &&
                    w.ifParentalAccessChId(selected.id, function () {})
                ) {
                    fail(
                        "Unlock the channel before selecting it for kiosk mode."
                    );
                    return;
                }
            }
            if (
                !save({
                    channel: selected,
                    provider: provider(),
                    source: source(),
                })
            ) {
                fail("Could not save kiosk policy.");
                return;
            }
            retries = 0;
            if (selected) {
                closeControls();
                try {
                    play();
                } catch (_) {
                    health = "error";
                }
            }
        }
        done({ data: snapshot(), status: "ok" });
    }
    function init(): void {
        try {
            var saved = JSON.parse(w.stbGetItem(key) || "null");
            if (
                saved &&
                typeof saved.source === "string" &&
                typeof saved.provider === "string" &&
                (saved.channel === null ||
                    (saved.channel &&
                        typeof saved.channel.id === "string" &&
                        typeof saved.channel.name === "string"))
            )
                policy = saved;
        } catch (_) {}
        reset();
        if (timer === null) timer = w.setInterval(tick, 1000);
    }
    function blockInput(event: any): void {
        if (!locked()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    if (w.document && w.document.addEventListener)
        [
            "click",
            "dblclick",
            "pointerdown",
            "mousedown",
            "touchstart",
            "wheel",
        ].forEach(function (name) {
            w.document.addEventListener(name, blockInput, {
                capture: true,
                passive: false,
            });
        });
    return {
        admit: admit,
        allowed: allowed,
        enabled: enabled,
        init: init,
        locked: locked,
        request: request,
        snapshot: snapshot,
    };
}
