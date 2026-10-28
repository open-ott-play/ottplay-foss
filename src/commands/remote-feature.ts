import { getScriptDOM } from "../utils/helpers";

/** Fixed internal feature names; independent bounded queues, no request URLs. */
export function loadRemoteFeature(
    w: any,
    feature:
        | "perf-capture"
        | "favorites-transfer"
        | "remote-settings-lifecycle"
        | "runtime-debug-details"
        | "local-compatibility"
        | "local-media-ui"
        | "remote-local-runner",
    done: (error?: string) => void,
    readOnly?: "favorites-recovery"
): void {
    var loads = w.__ottRemoteFeatureLoads || (w.__ottRemoteFeatureLoads = {});
    if (loads[feature]) {
        if (loads[feature].length < 32) loads[feature].push(done);
        else done("unsupported");
        return;
    }
    var pending = (loads[feature] = [done]),
        settled = false;
    function settle(error?: string): void {
        if (settled) return;
        settled = true;
        w.clearTimeout(timer);
        delete loads[feature];
        pending.forEach(function (callback: any) {
            try {
                callback(error);
            } catch (_) {}
        });
        pending.length = 0;
    }
    var timer = w.setTimeout(function () {
        settle("unsupported");
    }, 15000);
    try {
        getScriptDOM(
            String(w.host || "").replace(/\/$/, "") +
                "/dist/" +
                feature +
                ".js?" +
                encodeURIComponent(w.__cv || ""),
            function () {
                settle();
            },
            function () {
                settle("unsupported");
            },
            feature === "favorites-transfer" ? readOnly : undefined
        );
    } catch (_) {
        settle("unsupported");
    }
}
