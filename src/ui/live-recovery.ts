/** Non-modal OSD. Recovery state and seconds come exclusively from the watchdog. */
(function (w: any) {
    function render(status: LiveRecoveryStatus): void {
        var element = w.document.getElementById("liveRecoveryStatus");
        if (!element) return;
        var visible =
            status.phase !== "hidden" && !w.document.pictureInPictureElement;
        var feedback = w.__ottPlaybackFeedback;
        if (feedback && feedback.setRecoveryOverlay)
            feedback.setRecoveryOverlay(
                visible &&
                    (status.phase === "countdown" ||
                        status.phase === "restarting")
            );
        var text = "";
        if (visible) {
            if (status.phase === "countdown")
                text = w._("Stream stalled. Restart in %1 s", status.remaining);
            else if (status.phase === "restarting")
                text = w._(
                    "Recovering stream (%1/%2)",
                    status.attempt,
                    status.limit
                );
            else
                text = w._(
                    "Live recovery attempts exhausted (%1/%2)",
                    status.attempt,
                    status.limit
                );
        }
        if (element.textContent !== text) element.textContent = text;
        element.style.display = visible ? "block" : "none";
        element.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    w.__ottLiveRecoveryOSD = { render: render };
})(window as any);
