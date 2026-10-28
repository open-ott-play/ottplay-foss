/** Private physical backend ports; never probe or initialize persistent data. */
export interface FavoritesPhysicalStorageRead {
    current(): boolean;
    read(key: string): string | null;
}
export interface FavoritesPhysicalStorageGrant
    extends FavoritesPhysicalStorageRead {
    compareAndSwap(
        key: string,
        before: string | null,
        after: string,
        admission?: () => boolean
    ): "confirmed" | "conflict" | "unknown";
    exclusive<T>(
        work: (grant: FavoritesPhysicalStorageGrant) => T | Promise<T>
    ): Promise<T>;
    readonly implementationVersion: 1;
    readonly kind: "synchronous-localstorage";
    readonly lockName: "ottplay:favorites-ledger";
    readonly origin: string;
    readonly privateLedgerKey: "favorites-receipts.v1";
}
function descriptor(
    object: any,
    key: string
): { owner: any; value: PropertyDescriptor } | null {
    while (object) {
        var value = Object.getOwnPropertyDescriptor(object, key);
        if (value) return { owner: object, value: value };
        object = Object.getPrototypeOf(object);
    }
    return null;
}
function unchanged(
    object: any,
    key: string,
    prior: ReturnType<typeof descriptor>
): boolean {
    var next = descriptor(object, key);
    return (
        !!prior &&
        !!next &&
        prior.owner === next.owner &&
        ["value", "get", "set", "writable", "enumerable", "configurable"].every(
            function (field) {
                return (
                    (prior!.value as any)[field] === (next!.value as any)[field]
                );
            }
        )
    );
}
/** Called only by the adapter that captured the actual localStorage backend. */
export function createFavoritesPhysicalStorageRead(
    w: any,
    actualStorage: Storage,
    currentAdapter: () => boolean
): FavoritesPhysicalStorageRead | null {
    try {
        var pins = [
            descriptor(w, "localStorage"),
            descriptor(actualStorage, "getItem"),
            descriptor(actualStorage, "setItem"),
            descriptor(actualStorage, "removeItem"),
        ];
        if (
            pins.some(function (pin) {
                return !pin;
            }) ||
            [pins[1], pins[2], pins[3]].some(function (pin) {
                return !pin || typeof pin.value.value !== "function";
            })
        )
            return null;
        var get = pins[1]!.value.value,
            set = pins[2]!.value.value,
            remove = pins[3]!.value.value;
        var current = function (): boolean {
            try {
                return (
                    currentAdapter() &&
                    unchanged(w, "localStorage", pins[0]) &&
                    unchanged(actualStorage, "getItem", pins[1]) &&
                    unchanged(actualStorage, "setItem", pins[2]) &&
                    unchanged(actualStorage, "removeItem", pins[3]) &&
                    w.localStorage === actualStorage &&
                    actualStorage.getItem === get &&
                    actualStorage.setItem === set &&
                    actualStorage.removeItem === remove
                );
            } catch (_) {
                return false;
            }
        };
        var reader = {
            current: current,
            read: function (key: string): string | null {
                if (!current()) throw new Error("unsupported_persistence");
                var value = get.call(actualStorage, key);
                if ((value !== null && typeof value !== "string") || !current())
                    throw new Error("storage_unavailable");
                return value;
            },
        };
        return current() ? Object.freeze(reader) : null;
    } catch (_) {
        return null;
    }
}
export function createFavoritesPhysicalStorageGrant(
    w: any,
    actualStorage: Storage,
    currentAdapter: () => boolean
): FavoritesPhysicalStorageGrant | null {
    try {
        var reader = createFavoritesPhysicalStorageRead(
            w,
            actualStorage,
            currentAdapter
        );
        if (!reader) return null;
        var navigator = w.navigator,
            locks = navigator && navigator.locks;
        var location = w.location,
            origin = location && location.origin;
        var pins = [
            descriptor(w, "navigator"),
            descriptor(navigator, "locks"),
            descriptor(locks, "request"),
        ];
        if (
            typeof origin !== "string" ||
            !origin ||
            origin === "null" ||
            pins.some(function (pin) {
                return !pin;
            }) ||
            !pins[2] ||
            typeof pins[2].value.value !== "function"
        )
            return null;
        var request = pins[2]!.value.value,
            get = descriptor(actualStorage, "getItem")!.value.value,
            set = descriptor(actualStorage, "setItem")!.value.value;
        var held = false;
        var current = function (): boolean {
            try {
                return (
                    reader!.current() &&
                    unchanged(w, "navigator", pins[0]) &&
                    unchanged(navigator, "locks", pins[1]) &&
                    unchanged(locks, "request", pins[2]) &&
                    w.navigator === navigator &&
                    navigator.locks === locks &&
                    w.location === location &&
                    location.origin === origin &&
                    locks.request === request
                );
            } catch (_) {
                return false;
            }
        };
        var read = function (key: string): string | null {
            if (!current()) throw new Error("unsupported_persistence");
            var value = reader!.read(key);
            if (!current()) throw new Error("unsupported_persistence");
            return value;
        };
        var grant: FavoritesPhysicalStorageGrant = {
            compareAndSwap: function (key, before, after, admission) {
                function admitted(): boolean {
                    try {
                        return !admission || admission() === true;
                    } catch (_) {
                        return false;
                    }
                }
                if (!held || !current() || !admitted()) return "conflict";
                try {
                    if (read(key) !== before) return "conflict";
                } catch (_) {
                    return "conflict";
                }
                if (!current() || !admitted()) return "conflict";
                // All application callbacks precede this final physical compare.
                // No ownership/admission callbacks may intervene before the set.
                try {
                    if (get.call(actualStorage, key) !== before)
                        return "conflict";
                } catch (_) {
                    return "conflict";
                }
                try {
                    set.call(actualStorage, key, after);
                    return current() &&
                        read(key) === after &&
                        current() &&
                        admitted()
                        ? "confirmed"
                        : "unknown";
                } catch (_) {
                    return "unknown";
                }
            },
            current: current,
            exclusive: function <T>(
                work: (grant: FavoritesPhysicalStorageGrant) => T | Promise<T>
            ): Promise<T> {
                if (!current())
                    return Promise.reject(new Error("unsupported_persistence"));
                if (held) return Promise.reject(new Error("busy"));
                try {
                    return Promise.resolve(
                        request.call(
                            locks,
                            "ottplay:favorites-ledger",
                            { ifAvailable: true, mode: "exclusive" },
                            function (lock: any) {
                                if (!lock || held) throw new Error("busy");
                                if (!current())
                                    throw new Error("unsupported_persistence");
                                held = true;
                                // Web Locks owns the full work promise, independently of the RPC lifetime.
                                return Promise.resolve()
                                    .then(function () {
                                        return work(grant);
                                    })
                                    .then(
                                        function (value) {
                                            held = false;
                                            return value;
                                        },
                                        function (error) {
                                            held = false;
                                            throw error;
                                        }
                                    );
                            }
                        )
                    );
                } catch (error) {
                    return Promise.reject(error);
                }
            },
            implementationVersion: 1,
            kind: "synchronous-localstorage",
            lockName: "ottplay:favorites-ledger",
            origin: origin,
            privateLedgerKey: "favorites-receipts.v1",
            read: read,
        };
        return current() ? Object.freeze(grant) : null;
    } catch (_) {
        return null;
    }
}
