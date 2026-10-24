const notificationKey = "sNotificationsEnabled";

function persistedValue(w: any): string | null {
    if (typeof w.stbGetNotificationSetting !== "function")
        throw new Error("storage_unavailable");
    var value = w.stbGetNotificationSetting();
    if (value !== null && value !== "0" && value !== "1")
        throw new Error("storage_unavailable");
    return value;
}

/** Installation policy: never resolve this key through a provider/profile. */
export function readNotificationsEnabled(w: any): boolean {
    try {
        return persistedValue(w) !== "0";
    } catch (_) {
        // An unreadable policy must not turn a previously disabled receiver on.
        return false;
    }
}

/** One durable policy controls text and every optional notification media type. */
export function executeRemoteNotifications(
    w: any,
    runtime: string,
    params: any,
    done: (result: any) => void
): void {
    var operation = params && params.operation;
    function fail(error: string): void {
        done({
            data: {
                error: error,
                operation:
                    operation === "get" || operation === "set"
                        ? operation
                        : null,
                runtime: runtime,
                version: 1,
            },
            status: error === "unsupported" ? "unsupported" : "rejected",
        });
    }
    if (
        !params ||
        typeof params !== "object" ||
        Array.isArray(params) ||
        params.version !== 1 ||
        (operation !== "get" && operation !== "set") ||
        typeof params.runtime !== "string" ||
        !/^[a-z0-9-]{1,64}$/.test(params.runtime) ||
        Object.keys(params).sort().join(",") !==
            (operation === "set"
                ? "enabled,operation,runtime,version"
                : "operation,runtime,version") ||
        (operation === "set" && typeof params.enabled !== "boolean")
    ) {
        fail("invalid_request");
        return;
    }
    if (params.runtime !== runtime) {
        runtime = params.runtime;
        fail("runtime_mismatch");
        return;
    }
    var receiver = w.__ottRemoteNotifications;
    if (
        typeof w.stbSetItem !== "function" ||
        !receiver ||
        typeof receiver.setEnabled !== "function" ||
        typeof receiver.poll !== "function"
    ) {
        fail("unsupported");
        return;
    }
    var enabled: boolean;
    try {
        if (operation === "set") {
            var expected = params.enabled ? "1" : "0";
            w.stbSetItem(notificationKey, expected);
            if (persistedValue(w) !== expected) {
                fail("storage_unavailable");
                return;
            }
            enabled = expected === "1";
        } else enabled = persistedValue(w) !== "0";
    } catch (_) {
        fail("storage_unavailable");
        return;
    }
    if (operation === "set") {
        receiver.setEnabled(enabled);
        receiver.poll();
    }
    done({
        data: {
            enabled: enabled,
            operation: operation,
            persisted: true,
            runtime: runtime,
            version: 1,
        },
        status: "ok",
    });
}
