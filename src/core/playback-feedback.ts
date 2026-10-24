/** Bounded playback feedback; transport retries remain owned by the engine. */
(function (host: any): void {
    var media: HTMLVideoElement | null = null;
    var active = false;
    var expired = false;
    var timer: ReturnType<typeof setTimeout> | null = null;
    function clear(): void {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }
    function render(message: string, busy: boolean): void {
        // Use the existing compact footer so status remains visible after its
        // normal auto-hide; do not steal focus from a channel/settings list.
        if (
            message &&
            typeof host.showChannelInfo === "function" &&
            !(host.$ && host.$("#list").is(":visible"))
        ) {
            // A queued slideUp still reports :visible until its completion.
            // Finish it before deciding whether the footer needs reopening;
            // otherwise that old animation can hide newly rendered status.
            var footer = host.$ && host.$("#info1");
            if (footer && typeof footer.stop === "function")
                footer.stop(true, true);
            if (!footer || !footer.is(":visible")) host.showChannelInfo(1);
        }
        var spinner = document.getElementById("buffering");
        var status = document.getElementById("playback_status");
        var label = status || document.getElementById("video_res");
        if (status) status.style.display = message ? "block" : "none";
        var details = document.getElementById("video_res");
        if (status && message && details) details.textContent = "";
        if (spinner) spinner.style.display = busy ? "block" : "none";
        if (label) label.textContent = message;
    }
    function fail(message?: string): void {
        clear();
        expired = true;
        render(
            message || host._("Stream timed out. Select the channel to retry."),
            false
        );
    }
    function waiting(message: string, deadline: number): void {
        if (!active) {
            render("", false);
            return;
        }
        if (expired) {
            fail();
            return;
        }
        render(message, true);
        // Repeated progress/waiting/retry events must not extend the deadline.
        if (timer === null)
            timer = setTimeout(function () {
                timer = null;
                if (active) fail();
            }, deadline);
    }
    function begin(paused?: boolean): void {
        clear();
        active = !paused;
        expired = false;
        if (active) waiting(host._("Connecting..."), 30000);
        else render("", false);
    }
    function stop(): void {
        active = false;
        expired = false;
        clear();
        render("", false);
    }
    host.__ottPlaybackFeedback = {
        begin: begin,
        bind: function (next: HTMLVideoElement): void {
            if (media === next) return;
            media = next;
            function current(): boolean {
                return media === next;
            }
            next.addEventListener("loadstart", function () {
                if (current()) waiting(host._("Connecting..."), 30000);
            });
            next.addEventListener("waiting", function () {
                if (current()) waiting(host._("Buffering..."), 45000);
            });
            next.addEventListener("stalled", function () {
                if (current()) waiting(host._("Buffering..."), 45000);
            });
            next.addEventListener("playing", function () {
                if (!current() || !active) return;
                clear();
                expired = false;
                render("", false);
            });
            next.addEventListener("pause", function () {
                if (!current()) return;
                // Engine preparation also pauses media: only explicit pause intent
                // cancels feedback. A late preparation event cannot cancel startup.
                if (host.forcePlay === false) stop();
            });
            next.addEventListener("play", function () {
                if (current() && !active && host.forcePlay !== false) begin();
            });
            next.addEventListener("ended", function () {
                if (current()) stop();
            });
        },
        fail: function (): void {
            if (active) fail(host._("Stream could not be played"));
        },
        inactive: function (): boolean {
            return !active;
        },
        retry: function (): void {
            waiting(host._("Retrying..."), 30000);
        },
        stop: stop,
        visible: function (): boolean {
            return active && (timer !== null || expired);
        },
    };
})(window as any);
