import type {
    CommandServerRequest,
    CommandServerResponse,
} from "./command-server";

/** Latest-value presence, independent of command delivery and notification consent. */
export function createPlayerStateReporter(
    w: any,
    send: (
        request: CommandServerRequest,
        complete: (response?: CommandServerResponse) => void
    ) => () => void,
    read?: () => any
): any {
    var address = "",
        token = "",
        epoch = "",
        runtime = "";
    var generation = 0,
        sequence = 0,
        failures = 0;
    var connected = false,
        connectedAt = 0,
        lastSent = -Infinity;
    var nextHeartbeat = 0,
        nextAttempt = 0;
    var timer: any = null,
        cancel: (() => void) | null = null;
    var flight: any = null,
        pending: any = null,
        latest: any = null;
    var acknowledged = "";
    function semantic(value: any): string {
        var playback: any = {};
        Object.keys(value.playback).forEach(function (key) {
            if (key !== "position" && key !== "duration")
                playback[key] = value.playback[key];
        });
        return JSON.stringify([value.runtime, value.player, playback]);
    }
    function observe(): void {
        latest = null;
        try {
            var value = read && read();
            if (
                !value ||
                typeof value.runtime !== "string" ||
                !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.runtime)
            )
                return;
            if (runtime && runtime !== value.runtime) {
                retire(true);
                sequence = 0;
            }
            runtime = value.runtime;
            latest = { signature: semantic(value), value: value };
        } catch (_) {}
    }
    function clearTimer(): void {
        if (timer !== null) w.clearTimeout(timer);
        timer = null;
    }
    function retire(discard: boolean): void {
        generation++;
        clearTimer();
        var abort = cancel;
        cancel = null;
        flight = null;
        if (discard) {
            pending = null;
            acknowledged = "";
            failures = 0;
            nextAttempt = 0;
            nextHeartbeat = 0;
            lastSent = -Infinity;
        }
        if (abort) {
            try {
                abort();
            } catch (_) {}
        }
    }
    function arm(): void {
        clearTimer();
        if (
            !connected ||
            !epoch ||
            !address ||
            !token ||
            !read ||
            !latest ||
            flight
        )
            return;
        var now = Date.now();
        if (now - connectedAt >= 45000 || now < connectedAt) return;
        var due = pending
            ? nextAttempt
            : latest.signature !== acknowledged
              ? 0
              : nextHeartbeat;
        due = Math.max(due, lastSent + 1100);
        timer = w.setTimeout(pump, Math.max(0, due - now));
    }
    function pump(): void {
        timer = null;
        observe();
        if (
            !connected ||
            !epoch ||
            !address ||
            !token ||
            !latest ||
            flight ||
            Date.now() < connectedAt ||
            Date.now() - connectedAt >= 45000
        )
            return;
        if (!pending) {
            if (
                latest.signature === acknowledged &&
                Date.now() < nextHeartbeat
            ) {
                arm();
                return;
            }
            if (sequence >= 9007199254740991) return;
            var value = latest.value;
            var envelope = {
                controller_epoch: epoch,
                playback: value.playback,
                player: value.player,
                runtime: value.runtime,
                sequence: ++sequence,
                version: 1,
            };
            var body = JSON.stringify(envelope);
            try {
                if (
                    encodeURIComponent(body).replace(/%[0-9a-f]{2}/gi, "x")
                        .length > 4096
                )
                    return;
            } catch (_) {
                return;
            }
            pending = {
                body: body,
                runtime: value.runtime,
                sequence: sequence,
                signature: latest.signature,
            };
        }
        var item = pending,
            owner = generation,
            attempt = {};
        flight = attempt;
        lastSent = Date.now();
        function complete(response?: CommandServerResponse): void {
            if (owner !== generation || flight !== attempt) return;
            flight = null;
            cancel = null;
            var ack: any;
            try {
                ack =
                    response &&
                    response.status === 200 &&
                    JSON.parse(response.body);
            } catch (_) {}
            if (
                ack &&
                Object.keys(ack).sort().join(",") ===
                    "controller_epoch,duplicate,received_at,runtime,sequence,storage,version" &&
                ack.version === 1 &&
                ack.controller_epoch === epoch &&
                ack.runtime === item.runtime &&
                ack.sequence === item.sequence &&
                typeof ack.duplicate === "boolean" &&
                /^(memory|persistent)$/.test(ack.storage) &&
                typeof ack.received_at === "string" &&
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
                    ack.received_at
                )
            ) {
                pending = null;
                acknowledged = item.signature;
                failures = 0;
                nextAttempt = 0;
                nextHeartbeat = Date.now() + 15000;
            } else {
                failures++;
                nextAttempt =
                    Date.now() +
                    Math.min(15000, 1000 * Math.pow(2, Math.min(failures, 4)));
            }
            arm();
        }
        try {
            var abort = send(
                {
                    body: item.body,
                    headers: {
                        Authorization: "Bearer " + token,
                        "Content-Type": "application/json",
                    },
                    method: "POST",
                    timeoutMs: 8000,
                    url: address,
                },
                complete
            );
            if (owner === generation && flight === attempt) cancel = abort;
        } catch (_) {
            complete();
        }
    }
    var api = {
        changed: function (): void {
            observe();
            arm();
        },
        configure: function (url: string, secret: string): void {
            api.stop();
            address = url
                .split("?")[0]
                .replace(/\/api\/webhook\/commands$/, "/api/player-state");
            token = secret;
        },
        connected: function (advertisement: any): void {
            if (
                !advertisement ||
                Object.keys(advertisement).sort().join(",") !==
                    "controller_epoch,heartbeat_ms,max_body_bytes,report_path,stale_after_ms,version" ||
                advertisement.version !== 1 ||
                typeof advertisement.controller_epoch !== "string" ||
                !/^[a-f0-9]{32}$/.test(advertisement.controller_epoch) ||
                advertisement.report_path !== "/api/player-state" ||
                advertisement.heartbeat_ms !== 15000 ||
                advertisement.stale_after_ms !== 45000 ||
                advertisement.max_body_bytes !== 4096
            ) {
                retire(true);
                connected = false;
                epoch = "";
                return;
            }
            if (epoch !== advertisement.controller_epoch) {
                retire(true);
                epoch = advertisement.controller_epoch;
            }
            connected = true;
            connectedAt = Date.now();
            observe();
            arm();
        },
        disconnected: function (): void {
            connected = false;
            retire(false);
        },
        stop: function (): void {
            connected = false;
            retire(true);
            epoch = "";
            address = "";
            token = "";
        },
    };
    observe();
    return api;
}
