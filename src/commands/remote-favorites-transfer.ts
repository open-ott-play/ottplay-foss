import { settingsRecoveryRequired } from "../storage/index";
import { compress, decompress } from "../utils/lzstring";
import { loadRemoteFeature } from "./remote-feature";

/** Reuse main-owned storage helpers; the optional asset never initializes storage. */
interface TransferRuntime {
    capability(): Promise<any | null>;
    dispose(): void;
    execute(params: any, transport: any): Promise<any>;
}

var protocolErrors = (
    "invalid_request envelope_too_large runtime_changed busy expired " +
    "operation_conflict transaction_not_found out_of_order chunk_conflict " +
    "incomplete hash_mismatch revision_conflict binding_changed policy_denied " +
    "unsupported_persistence codec_error not_ready reconciliation_required " +
    "storage_unavailable limits_exceeded"
).split(" ");

function instance(w: any, runtime: () => string): TransferRuntime | null {
    var factory = w.__ottFavoritesTransferRuntime;
    var cached = w.__ottRemoteFavoritesTransfer;
    if (
        cached &&
        (cached.factory !== factory || cached.runtime !== runtime())
    ) {
        delete w.__ottRemoteFavoritesTransfer;
        try {
            cached.value.dispose();
        } catch (_) {}
        cached = null;
    }
    if (cached) return cached.value;
    if (!factory || typeof factory.create !== "function") return null;
    var value = factory.create(w, {
        runtime: runtime,
        storage: {
            compress: compress,
            decompress: decompress,
            recoveryRequired: settingsRecoveryRequired,
        },
    });
    if (
        !value ||
        typeof value.capability !== "function" ||
        typeof value.execute !== "function" ||
        typeof value.dispose !== "function"
    )
        return null;
    w.__ottRemoteFavoritesTransfer = {
        factory: factory,
        runtime: runtime(),
        value: value,
    };
    return value;
}

function load(w: any, done: (error?: string) => void): void {
    if (w.__ottFavoritesTransferRuntime) done();
    else loadRemoteFeature(w, "favorites-transfer", done);
}

/** Qualification is read-only; an unavailable optional asset preserves legacy caps. */
export function remoteFavoritesTransferCapability(
    w: any,
    runtime: () => string,
    done: (capability: any | null) => void,
    expiresAt?: number
): () => void {
    var cancelled = false;
    var settled = false;
    var owner = runtime();
    var timer: any = null;
    function current(): boolean {
        return (
            !cancelled &&
            owner === runtime() &&
            (expiresAt === undefined || Date.now() < expiresAt * 1000)
        );
    }
    function finish(value: any): void {
        if (cancelled || settled) return;
        settled = true;
        if (timer !== null) w.clearTimeout(timer);
        timer = null;
        done(current() && value && value.version === 1 ? value : null);
    }
    var budget = Math.min(
        1000,
        expiresAt === undefined ? 1000 : expiresAt * 1000 - Date.now() - 250
    );
    // Negative-only hint: other providers retain legacy caps without optional I/O.
    if (
        !(budget > 0) ||
        w.p_pref !== "plex" ||
        w.__ottActiveProviderDriver?.id !== "plex"
    )
        finish(null);
    else {
        timer = w.setTimeout(function () {
            finish(null);
        }, budget);
        load(w, function (error) {
            if (cancelled || settled) return;
            if (error || !current()) return finish(null);
            try {
                var api = instance(w, runtime);
                if (!api) return finish(null);
                Promise.resolve(api.capability()).then(
                    function (value) {
                        if (cancelled || settled) return;
                        var cached = w.__ottRemoteFavoritesTransfer;
                        finish(
                            cached &&
                                cached.value === api &&
                                cached.factory ===
                                    w.__ottFavoritesTransferRuntime
                                ? value
                                : null
                        );
                    },
                    function () {
                        finish(null);
                    }
                );
            } catch (_) {
                finish(null);
            }
        });
    }
    return function () {
        cancelled = true;
        if (timer !== null) w.clearTimeout(timer);
        timer = null;
    };
}

function permitted(w: any): boolean {
    try {
        return !(
            w.__ottStandby?.blocked?.() ||
            w.__ottKiosk?.enabled?.() ||
            (w.__ottParental
                ? w.__ottParental.needs("providers") ||
                  w.__ottParental.needs("settings")
                : (w.sPSprovs || w.sPSoptions) &&
                  w.parentPIN !== "*" &&
                  !w.parentAccess)
        );
    } catch (_) {
        return false;
    }
}

export function executeRemoteFavoritesTransfer(
    w: any,
    runtime: () => string,
    request: any,
    done: (result: any) => void
): () => void {
    var cancelled = false;
    var settled = false;
    var owner = runtime();
    var envelope: any;
    var requestedRuntime = owner;
    var executing: TransferRuntime | null = null;
    var op =
        request?.params &&
        typeof request.params.op === "string" &&
        /^[a-z_]{1,32}(?![\s\S])/.test(request.params.op)
            ? request.params.op
            : "invalid";
    function current(): boolean {
        // Completion does not cancel the admitted whole operation. In particular,
        // a prepare queue deadline must never become its later commit deadline.
        var cached = w.__ottRemoteFavoritesTransfer;
        return (
            !cancelled &&
            owner === runtime() &&
            permitted(w) &&
            (!executing ||
                (cached &&
                    cached.value === executing &&
                    cached.factory === w.__ottFavoritesTransferRuntime))
        );
    }
    function finish(value: any): void {
        if (cancelled || settled) return;
        settled = true;
        done(value);
    }
    function fail(error: string, unsupported = false): void {
        finish({
            data: {
                error: error,
                op: op,
                runtime: requestedRuntime,
                version: 1,
            },
            status: unsupported ? "unsupported" : "rejected",
        });
    }
    function cancel(): void {
        cancelled = true;
    }
    try {
        if (
            !request ||
            Object.keys(request).sort().join(",") !==
                "action,expires_at,id,params" ||
            request.action !== "favorites_transfer" ||
            typeof request.id !== "string" ||
            !/^[0-9a-f]{32}(?![\s\S])/.test(request.id) ||
            !request.params ||
            typeof request.params !== "object" ||
            Array.isArray(request.params) ||
            typeof request.expires_at !== "number" ||
            !isFinite(request.expires_at)
        ) {
            fail("invalid_request");
            return cancel;
        }
        var serialized = JSON.stringify(request);
        if (
            encodeURIComponent(serialized).replace(/%[0-9A-F]{2}/g, "x")
                .length > 16384
        ) {
            fail("envelope_too_large");
            return cancel;
        }
        // Own the parsed authenticated envelope across asynchronous asset loading.
        envelope = JSON.parse(serialized);
        if (
            typeof envelope.params.runtime !== "string" ||
            !/^[a-z0-9-]{1,64}(?![\s\S])/.test(envelope.params.runtime)
        ) {
            fail("invalid_request");
            return cancel;
        }
        requestedRuntime = envelope.params.runtime;
    } catch (_) {
        fail("invalid_request");
        return cancel;
    }
    function dispatch(error?: string): void {
        if (cancelled) return;
        if (owner !== runtime() || envelope.params.runtime !== owner)
            return fail("runtime_changed");
        if (Date.now() >= envelope.expires_at * 1000) return fail("expired");
        if (!permitted(w)) return fail("policy_denied");
        if (error) return fail("storage_unavailable", true);
        try {
            var api = instance(w, runtime);
            if (!api) return fail("storage_unavailable", true);
            executing = api;
            Promise.resolve(
                api.execute(envelope.params, {
                    current: current,
                    deadlineAt: envelope.expires_at * 1000,
                    envelope: envelope,
                    runtime: owner,
                })
            ).then(
                function (value) {
                    if (cancelled) return;
                    if (owner !== runtime()) return fail("runtime_changed");
                    if (
                        !value ||
                        typeof value !== "object" ||
                        Array.isArray(value) ||
                        value.version !== 1 ||
                        value.runtime !== owner ||
                        value.op !== op ||
                        (value.error !== undefined &&
                            protocolErrors.indexOf(value.error) < 0 &&
                            !(
                                op === "provision" &&
                                value.error === "outcome_unknown"
                            ))
                    )
                        return fail("storage_unavailable");
                    if (value.error) return fail(value.error);
                    finish({
                        data: value,
                        status: "ok",
                    });
                },
                function () {
                    fail("storage_unavailable");
                }
            );
        } catch (_) {
            fail("storage_unavailable");
        }
    }
    if (envelope.params.runtime !== owner) fail("runtime_changed");
    else if (Date.now() >= envelope.expires_at * 1000) fail("expired");
    else if (!permitted(w)) fail("policy_denied");
    else load(w, dispatch);
    return cancel;
}
