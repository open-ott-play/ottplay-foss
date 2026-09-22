import {
    commandEndpointBase,
    validCommandEnvelope,
    validDeviceId,
    validDeviceToken,
    wire,
} from "../shared/wire-contracts";

/** Outbound command delivery. Independent of native HTTP listening and WebCrypto. */
export interface CommandServerConfig {
    address: string;
    enabled: boolean;
    token: string;
}

export interface CommandServerRequest {
    body?: string;
    headers: Record<string, string>;
    method: string;
    timeoutMs: number;
    url: string;
}

export interface CommandServerResponse {
    body: string;
    status: number;
}

/** Accept an address or an old command endpoint; new connections always use ACK delivery. */
export function normalizeCommandServerAddress(value: string): string {
    var address = String(value || "").trim();
    if (!address || /[\s\\#]/.test(address))
        throw new Error("Enter a server address without spaces or a fragment.");
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) {
        if (
            /^[a-z][a-z0-9+.-]*:/i.test(address) &&
            !/^[^:]+:\d+(?:[/?]|$)/.test(address) &&
            address.charAt(0) !== "[" &&
            (address.match(/:/g) || []).length < 2
        )
            throw new Error("Use an HTTP or HTTPS server address.");
        // Add the default port to the authority, never to the device query.
        var suffix = address.search(/[/?]/);
        var host = suffix < 0 ? address : address.slice(0, suffix);
        var rest = suffix < 0 ? "" : address.slice(suffix);
        if (host.charAt(0) !== "[" && (host.match(/:/g) || []).length > 1)
            host = "[" + host + "]";
        if (!/:\d+$/.test(host)) host += ":8081";
        address = "http://" + host + rest;
    }
    var parsed: URL;
    try {
        parsed = new URL(address);
    } catch (_error) {
        throw new Error(
            "Enter a valid server address, for example 192.168.1.20:8081."
        );
    }
    if (
        !/^https?:$/.test(parsed.protocol) ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
    )
        throw new Error(
            "Use HTTP or HTTPS without a username or password in the address."
        );
    var deviceQuery = "";
    if (parsed.search) {
        var parts = parsed.search.slice(1).split("&");
        if (parts.length !== 1 || parts[0].split("=")[0] !== "device_id")
            throw new Error(
                "Enter the access code separately, not in the server address."
            );
        var device = "";
        try {
            device = decodeURIComponent(parts[0].slice("device_id=".length));
        } catch (_error) {}
        if (!validDeviceId(device))
            throw new Error("The device ID in the address is invalid.");
        deviceQuery = "?device_id=" + encodeURIComponent(device);
    }
    var base = parsed.pathname.replace(/\/+$/, "");
    base = commandEndpointBase(base);
    return (
        parsed.protocol +
        "//" +
        parsed.host +
        base +
        wire.commandPath +
        deviceQuery
    );
}

/** Injectable transport keeps the same delivery rules for XHR and native HTTP. */
export function createCommandServer(
    w: any,
    send: (
        request: CommandServerRequest,
        complete: (response?: CommandServerResponse) => void
    ) => () => void,
    persist: (config: CommandServerConfig) => void,
    dispatch: (command: any) => string | void
): any {
    var config: CommandServerConfig = {
        address: "",
        enabled: false,
        token: "",
    };
    var generation = 0;
    var timer: any = null;
    var cancel: (() => void) | null = null;
    var active = false;
    var failures = 0;
    var seen: Record<string, boolean> = Object.create(null);
    var seenOrder: string[] = [];
    var seenAddress = "";
    var seenToken = "";
    var pending: string[] = [];
    var deferredUntil: Record<string, number> = Object.create(null);
    var lastCommandMessage = "";
    var state = "disconnected";
    var message = "Disconnected";
    var listener: (() => void) | null = null;

    function status(): any {
        return {
            address: config.address,
            enabled: config.enabled,
            generation: generation,
            message: message,
            state: state,
        };
    }
    function update(next: string, text: string): void {
        state = next;
        message = text;
        if (listener) listener();
    }
    function stop(): void {
        generation++;
        if (timer !== null) w.clearTimeout(timer);
        timer = null;
        var abort = cancel;
        cancel = null;
        active = false;
        if (abort) {
            try {
                abort();
            } catch (_error) {}
        }
        pending = [];
        deferredUntil = Object.create(null);
        lastCommandMessage = "";
        failures = 0;
    }
    function schedule(delay: number): void {
        if (!config.enabled) return;
        if (timer !== null) w.clearTimeout(timer);
        timer = w.setTimeout(function () {
            timer = null;
            poll();
        }, delay);
    }
    function failed(response?: CommandServerResponse): void {
        failures++;
        var denied =
            response && (response.status === 401 || response.status === 403);
        update(
            "error",
            denied
                ? "Access denied. Check the server access code."
                : "Server unavailable. Retrying automatically; check its address and network access."
        );
        schedule(
            Math.min(30000, 1000 * Math.pow(2, Math.min(failures, 5))) +
                Math.floor(Math.random() * 500)
        );
    }
    function request(method: string, ids?: string[]): void {
        if (!config.enabled || active) return;
        var current = generation;
        var requestStarted = Date.now();
        active = true;
        var url = config.address;
        var queryIndex = url.indexOf("?");
        if (ids)
            url =
                (queryIndex < 0 ? url : url.slice(0, queryIndex)) +
                wire.ackPath.slice(wire.commandPath.length) +
                (queryIndex < 0 ? "" : url.slice(queryIndex));
        else url += (queryIndex < 0 ? "?" : "&") + "delivery=ack";
        var headers: Record<string, string> = {
            Authorization: "Bearer " + config.token,
        };
        if (ids) headers["Content-Type"] = "application/json";
        var finished = false;
        function complete(response?: CommandServerResponse): void {
            if (finished || current !== generation || !config.enabled) return;
            finished = true;
            active = false;
            cancel = null;
            if (!response || response.status !== 200) {
                failed(response);
                return;
            }
            var data: any;
            try {
                data = JSON.parse(response.body);
            } catch (_error) {
                failed();
                return;
            }
            var waiting = false;
            if (ids) {
                if (!data || data.status !== "ok") {
                    failed();
                    return;
                }
                pending = pending.filter(function (id) {
                    return ids.indexOf(id) === -1;
                });
            } else {
                if (!validCommandEnvelope(data)) {
                    failed();
                    return;
                }
                var now = Date.now();
                for (var j = 0; j < data.commands.length; j++) {
                    var command = data.commands[j];
                    if (!seen[command.id]) {
                        var deadline = deferredUntil[command.id];
                        if (!deadline) deadline = now + 60000;
                        if (
                            typeof command.expires_at === "number" &&
                            isFinite(command.expires_at) &&
                            typeof data.server_time === "number" &&
                            isFinite(data.server_time)
                        )
                            deadline = Math.min(
                                deadline,
                                requestStarted +
                                    Math.max(
                                        0,
                                        command.expires_at - data.server_time
                                    ) *
                                        1000
                            );
                        var result: string | void = "accepted";
                        // Mark before dispatch: an ACK retry must not repeat a volume step.
                        seen[command.id] = true;
                        seenOrder.push(command.id);
                        while (seenOrder.length > 2048)
                            delete seen[seenOrder.shift()!];
                        if (now >= deadline) {
                            lastCommandMessage =
                                "A command expired while the player was loading channels.";
                        } else {
                            try {
                                result = dispatch(command);
                            } catch (_error) {
                                result = "rejected";
                            }
                            if (current !== generation || !config.enabled)
                                return;
                            if (result === "deferred") {
                                delete seen[command.id];
                                seenOrder.splice(
                                    seenOrder.indexOf(command.id),
                                    1
                                );
                                deferredUntil[command.id] = deadline;
                                waiting = true;
                                break;
                            }
                            if (
                                result === "unsupported" ||
                                result === "rejected"
                            )
                                lastCommandMessage =
                                    "A command was rejected by the player. Check its provider and settings.";
                        }
                        delete deferredUntil[command.id];
                    }
                    if (current !== generation || !config.enabled) return;
                    if (pending.indexOf(command.id) === -1)
                        pending.push(command.id);
                }
            }
            failures = 0;
            update(
                waiting ? "waiting" : "connected",
                waiting
                    ? "Connected. Waiting for the channel list..."
                    : lastCommandMessage || "Connected"
            );
            schedule(pending.length ? 0 : 1000);
        }
        try {
            var abort = send(
                {
                    body: ids ? JSON.stringify({ ids: ids }) : undefined,
                    headers: headers,
                    method: method,
                    timeoutMs: 8000,
                    url: url,
                },
                complete
            );
            if (!finished && current === generation) cancel = abort;
        } catch (_error) {
            complete();
        }
    }
    function poll(): void {
        if (pending.length) request("POST", pending.slice(0, wire.ackBatchMax));
        else request("GET");
    }
    function configure(next: CommandServerConfig): void {
        stop();
        config = {
            address: String(next.address || "").trim(),
            enabled: false,
            token: String(next.token || "").trim(),
        };
        // Keep completed IDs across reconnects to the same queue. Endpoint or
        // credential edits retire that private history, including while disabled.
        var normalizedAddress = "";
        try {
            normalizedAddress = normalizeCommandServerAddress(config.address);
        } catch (_error) {}
        if (
            !normalizedAddress ||
            normalizedAddress !== seenAddress ||
            config.token !== seenToken
        ) {
            seen = Object.create(null);
            seenOrder = [];
        }
        seenAddress = normalizedAddress;
        seenToken = config.token;
        // Revoke locally before validation/storage. Invalid edits cannot retain a live connection.
        persist(config);
        if (!next.enabled) {
            update("disconnected", "Disconnected");
            return;
        }
        try {
            config.address =
                normalizedAddress ||
                normalizeCommandServerAddress(config.address);
            if (!validDeviceToken(config.token))
                throw new Error(
                    "Enter the server's device access code (32–256 letters, digits, _ or -)."
                );
            if (
                !w.__TAURI__ &&
                !(
                    w.Capacitor &&
                    (typeof w.Capacitor.isNativePlatform !== "function" ||
                        w.Capacitor.isNativePlatform())
                ) &&
                w.location &&
                w.location.protocol === "https:" &&
                /^http:/.test(config.address)
            )
                throw new Error(
                    "This HTTPS player cannot connect to an HTTP server. Use an HTTPS server or open the player over HTTP."
                );
            config.enabled = true;
            persist(config);
            update("connecting", "Connecting...");
            poll();
        } catch (error) {
            config.enabled = false;
            persist(config);
            update(
                "error",
                error instanceof Error
                    ? error.message
                    : "Could not connect to the server."
            );
        }
    }
    return {
        configure: configure,
        poll: poll,
        status: status,
        subscribe: function (next: (() => void) | null): void {
            listener = next;
        },
    };
}

/** Browser XHR or an existing native HTTP bridge, with bounded cancellation. */
export function createCommandServerTransport(
    w: any,
    nativeRequest?: (
        request: CommandServerRequest
    ) => Promise<CommandServerResponse>
): any {
    return function (
        request: CommandServerRequest,
        complete: (response?: CommandServerResponse) => void
    ): () => void {
        var done = false;
        var xhr: any = null;
        var timer = w.setTimeout(function () {
            finish();
            if (xhr) xhr.abort();
        }, request.timeoutMs);
        function finish(response?: CommandServerResponse): void {
            if (done) return;
            done = true;
            w.clearTimeout(timer);
            complete(response);
        }
        if (nativeRequest) {
            try {
                nativeRequest(request).then(finish, function () {
                    finish();
                });
            } catch (_error) {
                finish();
            }
        } else {
            try {
                xhr = new w.XMLHttpRequest();
                xhr.open(request.method, request.url, true);
                xhr.timeout = request.timeoutMs;
                for (var name in request.headers)
                    if (
                        Object.prototype.hasOwnProperty.call(
                            request.headers,
                            name
                        )
                    )
                        xhr.setRequestHeader(name, request.headers[name]);
                xhr.onload = function () {
                    finish({ body: xhr.responseText, status: xhr.status });
                };
                xhr.onerror =
                    xhr.ontimeout =
                    xhr.onabort =
                        function () {
                            finish();
                        };
                xhr.send(request.body || null);
            } catch (_error) {
                finish();
            }
        }
        return function (): void {
            if (done) return;
            done = true;
            w.clearTimeout(timer);
            if (xhr) xhr.abort();
        };
    };
}
