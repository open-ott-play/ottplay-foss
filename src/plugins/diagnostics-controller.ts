import { executeRemoteRestart } from "../commands/remote-restart";
import {
    type CommandServerRequest,
    type CommandServerResponse,
    normalizeCommandServerAddress,
} from "./command-server";
import {
    createDiagnosticsPermissionStore,
    type DiagnosticsPermissionBinding,
    type DiagnosticsPermissionStore,
} from "./diagnostics-permission";
import {
    createRemoteDiagnostics,
    type RemoteDiagnosticsOptions,
} from "./remote-diagnostics";

export interface DiagnosticsControllerStatus {
    enabled: boolean;
    message: string;
    pending: boolean;
    remainingMs?: number;
    runtimeId?: string;
    sessionId?: string;
    state: string;
    trusted: boolean;
}

interface ControllerConfig {
    address: string;
    enabled: boolean;
    token: string;
}

interface ControllerDependencies {
    clientFactory?: typeof createRemoteDiagnostics;
    getConfig: () => ControllerConfig;
    onStatus?: (status: DiagnosticsControllerStatus) => void;
    permissionStore?: DiagnosticsPermissionStore;
    runtimeLabel?: string;
    send: (
        request: CommandServerRequest,
        complete: (response?: CommandServerResponse) => void
    ) => () => void;
}

const MAX_GRANT_MS = 600000;
const MAX_NUMBER = 9007199254740991;

/** Temporary consent and explicitly saved device-local trust have separate lifetimes. */
export function installDiagnosticsController(
    w: any,
    deps: ControllerDependencies
): any {
    var enabled = false;
    var trusted = false;
    var permissionPending = true;
    var permissionGeneration = 0;
    var binding: DiagnosticsPermissionBinding | null = null;
    var permissionStore =
        deps.permissionStore || createDiagnosticsPermissionStore(w);
    var retry: any = null;
    var failures = 0;
    var policyReadPending = false;
    var resumeAfterPolicy = false;
    var nextPolicyCheck = 0;
    var removePermissionListener: (() => void) | null = null;
    var removeTrustListeners: (() => void) | null = null;
    var pageSuspended = false;
    var generation = 0;
    var client: any = null;
    var timer: any = null;
    var removeListeners: (() => void) | null = null;
    var releaseCapture: (() => void) | null = null;
    var subscriber: ((status: DiagnosticsControllerStatus) => void) | null =
        null;
    var saved: ControllerConfig | null = null;
    var lastNow = 0;
    var deadline = 0;
    var sequence = 0;
    var view: Omit<DiagnosticsControllerStatus, "trusted" | "pending"> = {
        enabled: false,
        message: "Remote diagnostics is off.",
        state: "disabled",
    };

    function status(): DiagnosticsControllerStatus {
        var result: DiagnosticsControllerStatus = {
            enabled: enabled,
            message: view.message,
            pending: permissionPending || (trusted && !enabled),
            state: view.state,
            trusted: trusted,
        };
        if (view.runtimeId) result.runtimeId = view.runtimeId;
        if (view.sessionId) result.sessionId = view.sessionId;
        if (view.remainingMs !== undefined)
            result.remainingMs = view.remainingMs;
        return result;
    }

    function notify(): void {
        if (deps.onStatus) {
            try {
                deps.onStatus(status());
            } catch (_error) {}
        }
        if (subscriber) {
            try {
                subscriber(status());
            } catch (_error) {}
        }
    }

    function number(value: any): number | null {
        return typeof value === "number" &&
            isFinite(value) &&
            value >= 0 &&
            value <= MAX_NUMBER
            ? value
            : null;
    }

    function clock(): number {
        if (!w.performance || typeof w.performance.now !== "function")
            throw new Error("Monotonic clock unavailable");
        var value = w.performance.now();
        if (number(value) === null || (enabled && value < lastNow))
            throw new Error("Monotonic clock unavailable");
        lastNow = value;
        return value;
    }

    function foreground(): boolean {
        var doc = w.document;
        return !!(
            doc &&
            (doc.visibilityState === "visible" ||
                (doc.visibilityState === undefined && doc.hidden === false))
        );
    }

    function config(value?: ControllerConfig): ControllerConfig | null {
        try {
            var next = value === undefined ? deps.getConfig() : value;
            if (
                !next ||
                next.enabled !== true ||
                typeof next.address !== "string" ||
                typeof next.token !== "string" ||
                !/^[A-Za-z0-9_-]{32,256}$/.test(next.token.trim())
            )
                return null;
            return {
                address: normalizeCommandServerAddress(next.address),
                enabled: true,
                token: next.token.trim(),
            };
        } catch (_error) {
            return null;
        }
    }

    function sameConfig(next: ControllerConfig | null): boolean {
        return !!(
            next &&
            saved &&
            next.address === saved.address &&
            next.token === saved.token &&
            next.enabled === saved.enabled
        );
    }

    function identifier(): string {
        sequence++;
        try {
            var bytes = new Uint8Array(16);
            if (!w.crypto || typeof w.crypto.getRandomValues !== "function")
                throw new Error("No random source");
            w.crypto.getRandomValues(bytes);
            var output = "";
            for (var i = 0; i < bytes.length; i++)
                output += (bytes[i] + 256).toString(16).slice(1);
            return output + "-" + sequence;
        } catch (_error) {
            // Labels are not credentials; the server issues authenticated runtime IDs.
            return (
                "page-" +
                Math.floor(lastNow).toString(36) +
                "-" +
                sequence +
                "-" +
                Math.random().toString(36).slice(2, 18)
            );
        }
    }

    function detachCapture(): void {
        var release = releaseCapture;
        releaseCapture = null;
        if (release) {
            try {
                release();
            } catch (_error) {}
        }
    }

    function stopRuntime(reason?: string): void {
        var wasEnabled = enabled;
        enabled = false;
        var current = ++generation;
        var oldTimer = timer;
        var oldListeners = removeListeners;
        var oldCapture = releaseCapture;
        var oldClient = client;
        // Detach ownership before invoking callbacks which may grant access again.
        timer = null;
        removeListeners = null;
        releaseCapture = null;
        client = null;
        saved = null;
        view = {
            enabled: false,
            message:
                reason === "unsupported"
                    ? "Remote diagnostics is unavailable on this player."
                    : reason && reason !== "local_stop" && wasEnabled
                      ? "Remote diagnostics stopped. Enable it again to grant access."
                      : "Remote diagnostics is off.",
            state:
                reason === "unsupported"
                    ? "unavailable"
                    : reason && reason !== "local_stop" && wasEnabled
                      ? "regrant-needed"
                      : "disabled",
        };
        if (oldTimer !== null) w.clearTimeout(oldTimer);
        if (oldListeners) oldListeners();
        if (oldCapture) {
            try {
                oldCapture();
            } catch (_error) {}
        }
        if (oldClient) {
            try {
                oldClient.stop(reason || "local_stop");
            } catch (_error) {}
        }
        if (current === generation) notify();
    }

    function online(): boolean {
        return !w.navigator || w.navigator.onLine !== false;
    }

    function bindingMatches(next: ControllerConfig | null): boolean {
        return !!(
            binding &&
            next &&
            binding.address === next.address &&
            binding.token === next.token
        );
    }

    function clearRetry(): void {
        if (retry !== null) w.clearTimeout(retry);
        retry = null;
    }

    function stop(reason?: string, persist = true): void {
        var hadAuthority = trusted || permissionPending;
        var current = ++permissionGeneration;
        trusted = false;
        permissionPending = hadAuthority;
        binding = null;
        policyReadPending = false;
        resumeAfterPolicy = false;
        if (removePermissionListener) removePermissionListener();
        removePermissionListener = null;
        clearRetry();
        if (removeTrustListeners) removeTrustListeners();
        removeTrustListeners = null;
        var cleaned = false;
        var settled = false;
        var failed = false;
        function finished(): void {
            if (!cleaned || !settled || current !== permissionGeneration)
                return;
            permissionPending = false;
            if (failed && hadAuthority) {
                view = {
                    enabled: false,
                    message:
                        "Trusted access could not be removed from device storage.",
                    state: "storage-error",
                };
            }
            notify();
        }
        // Queue revocation before user callbacks can request another grant.
        try {
            if (!persist) {
                settled = true;
            } else
                permissionStore.write(null, function (error) {
                    settled = true;
                    failed = error;
                    finished();
                });
        } catch (_) {
            settled = true;
            failed = true;
        }
        stopRuntime(reason);
        cleaned = true;
        finished();
    }

    function scheduleTrusted(delay: number): void {
        clearRetry();
        if (!trusted || permissionPending) return;
        var current = permissionGeneration;
        retry = w.setTimeout(function () {
            retry = null;
            if (current !== permissionGeneration || !trusted) return;
            resumeTrusted();
        }, delay);
    }

    function suspend(reason: string, retryAllowed = true): void {
        if (!trusted) {
            stop(reason);
            return;
        }
        clearRetry();
        resumeAfterPolicy = false;
        stopRuntime(reason);
        if (!trusted) return;
        view = {
            enabled: false,
            message:
                "Trusted diagnostics is waiting for this player to reconnect.",
            state: "suspended",
        };
        notify();
        if (retryAllowed && foreground() && online() && !pageSuspended)
            scheduleTrusted(
                Math.min(30000, 1000 * Math.pow(2, Math.min(5, failures++)))
            );
    }

    function verifyPolicy(resume = false): void {
        if (!trusted || !binding) return;
        if (resume) resumeAfterPolicy = true;
        if (policyReadPending) return;
        policyReadPending = true;
        var current = permissionGeneration;
        var readRuntime = generation;
        var expected = binding;
        try {
            permissionStore.read(function (error, value) {
                if (current !== permissionGeneration || !trusted) return;
                policyReadPending = false;
                if (
                    error ||
                    !value ||
                    value.address !== expected!.address ||
                    value.token !== expected!.token ||
                    value.revision !== expected!.revision
                ) {
                    // Another page owns the durable policy; never erase its new grant.
                    stop("consent_revoked", false);
                    return;
                }
                nextPolicyCheck = lastNow + 5000;
                var resumeNow = resumeAfterPolicy;
                resumeAfterPolicy = false;
                if (!bindingMatches(config())) {
                    stop("consent_revoked");
                    return;
                }
                if (resumeNow && readRuntime !== generation) {
                    verifyPolicy(true);
                    return;
                }
                if (
                    resumeNow &&
                    !enabled &&
                    foreground() &&
                    online() &&
                    !pageSuspended
                )
                    startRuntime();
            });
        } catch (_) {
            stop("consent_revoked", false);
        }
    }

    function resumeTrusted(): void {
        if (!trusted || enabled || permissionPending) return;
        if (!bindingMatches(config())) {
            stop("consent_revoked");
            return;
        }
        if (!foreground() || !online() || pageSuspended) return;
        verifyPolicy(true);
    }

    function installTrustListeners(): void {
        if (removeTrustListeners) return;
        if (permissionStore.subscribe && !removePermissionListener)
            removePermissionListener = permissionStore.subscribe(function () {
                verifyPolicy();
            });
        if (
            !w.document ||
            typeof w.document.addEventListener !== "function" ||
            typeof w.document.removeEventListener !== "function" ||
            typeof w.addEventListener !== "function" ||
            typeof w.removeEventListener !== "function"
        ) {
            stop("unsupported");
            return;
        }
        function changed(): void {
            if (!trusted) return;
            if (!foreground() || !online() || pageSuspended)
                suspend("suspended", false);
            else scheduleTrusted(0);
        }
        function hidden(): void {
            pageSuspended = true;
            changed();
        }
        function shown(): void {
            pageSuspended = false;
            changed();
        }
        w.document.addEventListener("visibilitychange", changed, false);
        w.document.addEventListener("freeze", hidden, false);
        w.document.addEventListener("resume", shown, false);
        w.addEventListener("pagehide", hidden, false);
        w.addEventListener("pageshow", shown, false);
        w.addEventListener("offline", changed, false);
        w.addEventListener("online", changed, false);
        removeTrustListeners = function () {
            w.document.removeEventListener("visibilitychange", changed, false);
            w.document.removeEventListener("freeze", hidden, false);
            w.document.removeEventListener("resume", shown, false);
            w.removeEventListener("pagehide", hidden, false);
            w.removeEventListener("pageshow", shown, false);
            w.removeEventListener("offline", changed, false);
            w.removeEventListener("online", changed, false);
        };
    }

    function setTrusted(value: boolean): void {
        if (value !== true) {
            stop("local_stop");
            return;
        }
        if (permissionPending || trusted) return;
        var next = config();
        if (!next || next.address.slice(0, 8) !== "https://") {
            view = {
                enabled: enabled,
                message: "Use an HTTPS command server for remote diagnostics.",
                state: "unavailable",
            };
            notify();
            return;
        }
        var current = ++permissionGeneration;
        var granted = {
            address: next.address,
            revision: identifier(),
            token: next.token,
        };
        permissionPending = true;
        notify();
        permissionStore.write(granted, function (error) {
            if (current !== permissionGeneration) return;
            permissionPending = false;
            var latest = config();
            if (
                error ||
                !latest ||
                latest.address !== granted.address ||
                latest.token !== granted.token
            ) {
                permissionPending = true;
                stop("consent_revoked");
                view = {
                    enabled: enabled,
                    message:
                        "Trusted diagnostics is unavailable because device storage could not be updated.",
                    state: "storage-error",
                };
                notify();
                return;
            }
            binding = granted;
            trusted = true;
            failures = 0;
            installTrustListeners();
            stopRuntime("local_stop");
            nextPolicyCheck = lastNow + 5000;
            if (trusted && foreground() && online() && !pageSuspended)
                startRuntime();
            if (trusted && !enabled) suspend("suspended", false);
            notify();
        });
    }

    function validGrant(current: number): boolean {
        if (!enabled || current !== generation) return false;
        if (!foreground() || !online() || pageSuspended) {
            suspend("suspended", false);
            return false;
        }
        if (!sameConfig(config())) {
            stop("consent_revoked");
            return false;
        }
        try {
            if (clock() >= deadline && !trusted) {
                stop("lease_expired");
                return false;
            }
        } catch (_error) {
            stop("unsupported");
            return false;
        }
        return true;
    }

    function field(value: any, key: string): any {
        try {
            return value &&
                typeof value === "object" &&
                Object.prototype.hasOwnProperty.call(value, key)
                ? value[key]
                : undefined;
        } catch (_error) {
            return undefined;
        }
    }

    function safeMetrics(value: any, keys: string[]): any {
        var result: any = {};
        if (!value || typeof value !== "object") return result;
        keys.forEach(function (key) {
            var metric = field(value, key);
            if (number(metric) !== null) result[key] = metric;
        });
        return result;
    }

    function snapshot(): any {
        var logger = w.__ottDebug;
        if (!logger || typeof logger.snapshot !== "function") return {};
        var raw: any;
        try {
            raw = logger.snapshot();
        } catch (_error) {
            return {};
        }
        if (!raw || typeof raw !== "object") return {};
        var counters = safeMetrics(field(raw, "counters"), [
            "dropped",
            "errors",
            "recoveries",
            "stalls",
            "waiting",
        ]);
        var rawVideo = field(raw, "video");
        var video: any = null;
        if (rawVideo && typeof rawVideo === "object") {
            video = safeMetrics(rawVideo, [
                "bufferAhead",
                "currentTime",
                "droppedFrames",
                "errorCode",
                "networkState",
                "readyState",
                "videoHeight",
                "videoWidth",
            ]);
            var paused = field(rawVideo, "paused");
            var ended = field(rawVideo, "ended");
            if (typeof paused === "boolean") video.paused = paused;
            if (typeof ended === "boolean") video.ended = ended;
        }
        return {
            available: field(raw, "available") === true,
            counters: counters,
            enabled: field(raw, "enabled") === true,
            video: video,
        };
    }

    function adapterSnapshot(adapter: () => any, input: boolean): any {
        var raw: any;
        try {
            raw = adapter();
        } catch (_error) {
            return { available: false, enabled: false };
        }
        var result: any = {
            available: field(raw, "available") === true,
            enabled: field(raw, "enabled") === true,
        };
        if (input && result.available && result.enabled) {
            var keys = ["move", "down", "click", "wheel"];
            var total = 0;
            for (var i = 0; i < keys.length; i++) {
                var count = field(raw, keys[i]);
                if (
                    number(count) === null ||
                    Math.floor(count) !== count ||
                    total > MAX_NUMBER - count
                )
                    return result;
                total += count;
            }
            result.inputEvents = total;
        }
        return result;
    }

    function capture(
        current: number,
        emit: (event: any) => void,
        stopped?: () => void
    ): () => void {
        if (!validGrant(current)) return function () {};
        var logger = w.__ottDebug;
        if (!logger || typeof logger.capture !== "function")
            throw new Error("Diagnostic capture unavailable");
        detachCapture();
        if (!validGrant(current)) return function () {};
        var release = logger.capture(
            function (event: any) {
                if (!validGrant(current) || !event) return;
                var category = field(event, "cat");
                var message = field(event, "msg");
                if (typeof category !== "string" || typeof message !== "string")
                    return;
                var valid =
                    (category === "video" &&
                        /^(waiting|playing|stalled|ended|error|canplay)$/.test(
                            message
                        )) ||
                    (category === "net" &&
                        /^(xhr status|xhr error)$/.test(message)) ||
                    (category === "hls" &&
                        /^(ERROR|ERROR fatal|FRAG_LOADED)$/.test(message));
                if (!valid) return;
                var data = safeMetrics(field(event, "data"), [
                    "code",
                    "status",
                    "size",
                    "loadMs",
                ]);
                // Raw text, URLs, stack traces and logger payloads never cross this boundary.
                if (validGrant(current))
                    emit({ cat: category, data: data, msg: message });
            },
            function () {
                if (!enabled || current !== generation) return;
                stop("local_stop");
                if (stopped) stopped();
            }
        );
        if (typeof release !== "function")
            throw new Error("Diagnostic capture unavailable");
        if (!enabled || current !== generation) {
            release();
            return function () {};
        }
        var released = false;
        var owned = function () {
            if (released) return;
            released = true;
            if (releaseCapture === owned) releaseCapture = null;
            release();
        };
        releaseCapture = owned;
        return owned;
    }

    function update(current: number, next: any): void {
        if (!enabled || current !== generation || !next) return;
        if (!validGrant(current)) return;
        if (
            next.state === "disabled" ||
            next.state === "unavailable" ||
            next.state === "regrant-needed" ||
            next.state === "regrant_required" ||
            next.state === "stopped" ||
            next.requiresGrant === true ||
            next.state === "error"
        ) {
            var reason =
                next.reason ||
                (next.state === "unavailable" ? "unsupported" : "disconnected");
            if (
                trusted &&
                (reason === "disconnected" ||
                    reason === "server_restarted" ||
                    reason === "lease_expired")
            )
                suspend(reason);
            else
                stop(
                    reason === "unsupported" ? "unsupported" : "consent_revoked"
                );
            return;
        }
        var active = next.state === "active";
        if (next.runtimeId) failures = 0;
        view = {
            enabled: true,
            message: active
                ? "Remote diagnostics is collecting for this page."
                : "Remote diagnostics is ready for an authorized operator.",
            remainingMs: trusted ? undefined : Math.max(0, deadline - lastNow),
            state: active ? "active" : "ready",
        };
        if (
            typeof next.runtimeId === "string" &&
            /^[A-Za-z0-9_.:-]{1,80}$/.test(next.runtimeId)
        )
            view.runtimeId = next.runtimeId;
        if (
            typeof next.sessionId === "string" &&
            /^[A-Za-z0-9_.:-]{1,80}$/.test(next.sessionId)
        )
            view.sessionId = next.sessionId;
        notify();
    }

    function watch(current: number): void {
        if (!validGrant(current)) return;
        if (trusted && lastNow >= nextPolicyCheck) verifyPolicy();
        if (!enabled || current !== generation) return;
        view.remainingMs = trusted
            ? undefined
            : Math.max(0, deadline - lastNow);
        notify();
        if (!enabled || current !== generation) return;
        timer = w.setTimeout(function () {
            if (!enabled || current !== generation) return;
            timer = null;
            watch(current);
        }, 1000);
    }

    function setEnabled(value: boolean): void {
        if (value !== true) {
            stop("local_stop");
            return;
        }
        if (trusted) {
            resumeTrusted();
            return;
        }
        if (enabled) return;
        if (permissionPending) stop("local_stop");
        startRuntime();
    }

    function startRuntime(): void {
        if (enabled) return;
        var next = config();
        if (!next) {
            view = {
                enabled: false,
                message: "Connect this player to a command server first.",
                state: "unavailable",
            };
            notify();
            return;
        }
        if (next.address.slice(0, 8) !== "https://") {
            view = {
                enabled: false,
                message: "Use an HTTPS command server for remote diagnostics.",
                state: "unavailable",
            };
            notify();
            return;
        }
        var logger = w.__ottDebug;
        if (
            !foreground() ||
            (w.navigator && w.navigator.onLine === false) ||
            !logger ||
            typeof logger.capture !== "function" ||
            typeof logger.snapshot !== "function" ||
            !w.document.addEventListener ||
            !w.document.removeEventListener ||
            !w.addEventListener ||
            !w.removeEventListener
        ) {
            stop("unsupported");
            return;
        }
        try {
            lastNow = clock();
            if (lastNow > MAX_NUMBER - MAX_GRANT_MS)
                throw new Error("Clock overflow");
        } catch (_error) {
            stop("unsupported");
            return;
        }
        enabled = true;
        saved = next;
        var current = ++generation;
        deadline = lastNow + MAX_GRANT_MS;
        function hidden(): void {
            if (current === generation && !foreground())
                suspend("suspended", false);
        }
        function pagehide(): void {
            if (current === generation) suspend("suspended", false);
        }
        function offline(): void {
            if (current === generation) suspend("disconnected", false);
        }
        w.document.addEventListener("visibilitychange", hidden, false);
        w.document.addEventListener("freeze", pagehide, false);
        w.addEventListener("pagehide", pagehide, false);
        w.addEventListener("offline", offline, false);
        removeListeners = function () {
            w.document.removeEventListener("visibilitychange", hidden, false);
            w.document.removeEventListener("freeze", pagehide, false);
            w.removeEventListener("pagehide", pagehide, false);
            w.removeEventListener("offline", offline, false);
        };
        view = {
            enabled: true,
            message: "Connecting remote diagnostics for this page.",
            remainingMs: trusted ? undefined : MAX_GRANT_MS,
            state: "ready",
        };
        notify();
        if (!enabled || current !== generation) return;
        try {
            var factory = deps.clientFactory || createRemoteDiagnostics;
            var options: RemoteDiagnosticsOptions = {
                capabilities: ["playback", "network"],
                capture: function (
                    emit: (event: any) => void,
                    stopped?: () => void
                ) {
                    return capture(current, emit, stopped);
                },
                clearTimeout: function (handle: any): void {
                    w.clearTimeout(handle);
                },
                executeRepair: function (action, complete, afterAck) {
                    if (!validGrant(current)) {
                        complete("rejected");
                        return;
                    }
                    var canceled = false;
                    executeRemoteRestart(
                        w,
                        {
                            target:
                                action === "reload_player"
                                    ? "player"
                                    : "stream",
                        },
                        function (result) {
                            if (canceled || !validGrant(current)) return;
                            complete(
                                result.status === "ok"
                                    ? action === "reload_player"
                                        ? "accepted"
                                        : "applied"
                                    : result.status === "unsupported"
                                      ? "unsupported"
                                      : "rejected"
                            );
                        },
                        function (effect) {
                            afterAck(function () {
                                if (!canceled && validGrant(current)) effect();
                            });
                        }
                    );
                    return function () {
                        canceled = true;
                    };
                },
                now: clock,
                onStatus: function (value: any) {
                    update(current, value);
                },
                send: function (request, complete) {
                    if (!validGrant(current)) return function () {};
                    return deps.send(request, function (response) {
                        if (enabled && current === generation)
                            complete(response);
                    });
                },
                sendRevocation: deps.send,
                setTimeout: function (
                    callback: () => void,
                    delay: number
                ): any {
                    return w.setTimeout(callback, delay);
                },
                snapshot: function () {
                    if (!validGrant(current)) return {};
                    var value = snapshot();
                    return validGrant(current) ? value : {};
                },
            };
            if (typeof w.__ottDebugInputSnapshot === "function") {
                options.capabilities!.push("input");
                options.inputSnapshot = function () {
                    if (!validGrant(current)) return {};
                    var value = adapterSnapshot(
                        w.__ottDebugInputSnapshot,
                        true
                    );
                    return validGrant(current) ? value : {};
                };
            }
            if (
                w.__ottHostedEpg &&
                typeof w.__ottHostedEpg.remoteSnapshot === "function"
            ) {
                options.capabilities!.push("epg");
                options.epgSnapshot = function () {
                    if (!validGrant(current)) return {};
                    var value = adapterSnapshot(function () {
                        return w.__ottHostedEpg.remoteSnapshot();
                    }, false);
                    return validGrant(current) ? value : {};
                };
            }
            var created = factory(options);
            if (!enabled || current !== generation) {
                created.stop("consent_revoked");
                return;
            }
            client = created;
            client.configure({
                address: next.address,
                bootId: identifier(),
                consentEpoch: identifier(),
                enabled: true,
                instanceId:
                    (typeof deps.runtimeLabel === "string" &&
                    /^[A-Za-z0-9_.:-]{1,40}$/.test(deps.runtimeLabel)
                        ? deps.runtimeLabel + "."
                        : "") + identifier().slice(0, 39),
                token: next.token,
            });
            watch(current);
        } catch (_error) {
            if (current === generation) stop("unsupported");
        }
    }

    var reading = permissionGeneration;
    permissionStore.read(function (error, value) {
        if (reading !== permissionGeneration) return;
        permissionPending = false;
        if (error || !value) {
            notify();
            return;
        }
        var next = config();
        if (
            !next ||
            next.address !== value.address ||
            next.token !== value.token ||
            next.address.slice(0, 8) !== "https://"
        ) {
            permissionPending = true;
            stop("consent_revoked");
            return;
        }
        if (
            typeof value.revision !== "string" ||
            !/^[A-Za-z0-9_.:-]{1,80}$/.test(value.revision)
        )
            return;
        binding = {
            address: value.address,
            revision: value.revision,
            token: value.token,
        };
        trusted = true;
        installTrustListeners();
        nextPolicyCheck = lastNow + 5000;
        if (trusted && foreground() && online() && !pageSuspended)
            startRuntime();
        if (trusted && !enabled) suspend("suspended", false);
        notify();
    });

    return {
        configurationChanged: function (next: ControllerConfig): void {
            var normalized = config(next);
            if (
                (enabled && !sameConfig(normalized)) ||
                (trusted && !bindingMatches(normalized)) ||
                permissionPending
            )
                stop("consent_revoked");
        },
        setEnabled: setEnabled,
        setTrusted: setTrusted,
        status: status,
        stop: stop,
        stopSession: function () {
            if (!trusted) {
                stop("local_stop");
                return;
            }
            stopRuntime("local_stop");
            scheduleTrusted(0);
        },
        subscribe: function (listener: any): void {
            subscriber = typeof listener === "function" ? listener : null;
            if (subscriber) {
                try {
                    subscriber(status());
                } catch (_error) {}
            }
        },
    };
}
