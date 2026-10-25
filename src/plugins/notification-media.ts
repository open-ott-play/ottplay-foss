/** Bounded, ephemeral camera snapshots. Never use the command string transport. */
export interface NotificationMediaDescriptor {
    bytes: number;
    content_type: "image/jpeg";
    height: number;
    id: string;
    kind: "image";
    width: number;
}
export interface NotificationMediaResult {
    dispose: () => void;
    height: number;
    remainingMs: number;
    url: string;
    width: number;
}
export interface NotificationMediaOptions {
    address: string;
    media: NotificationMediaDescriptor;
    remainingMs: number;
    runtime: string;
    token: string;
}
var BODY_LIMIT = 224 * 1024;
function integer(value: any, max: number): boolean {
    return (
        typeof value === "number" &&
        value > 0 &&
        value <= max &&
        Math.floor(value) === value
    );
}
export function validNotificationMedia(value: any): boolean {
    return !!(
        value &&
        typeof value.id === "string" &&
        /^[a-f0-9]{32}$/.test(value.id) &&
        value.url === undefined &&
        value.kind === "image" &&
        value.content_type === "image/jpeg" &&
        integer(value.width, 640) &&
        integer(value.height, 360) &&
        integer(value.bytes, 163840)
    );
}
/** No network is touched by this capability probe. */
export function supportsNotificationMedia(w: any): boolean {
    try {
        return !!(
            typeof w.fetch === "function" &&
            typeof w.Request === "function" &&
            typeof w.AbortController === "function" &&
            typeof w.atob === "function" &&
            typeof w.Blob === "function" &&
            typeof w.URL === "function" &&
            typeof w.URL.createObjectURL === "function" &&
            typeof w.URL.revokeObjectURL === "function" &&
            w.ReadableStream &&
            typeof w.ReadableStream.prototype.getReader === "function"
        );
    } catch (_error) {
        return false;
    }
}
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
    var length = bytes.length;
    if (
        length < 12 ||
        bytes[0] !== 255 ||
        bytes[1] !== 216 ||
        bytes[length - 2] !== 255 ||
        bytes[length - 1] !== 217
    )
        return null;
    var offset = 2,
        found: { width: number; height: number } | null = null;
    while (offset + 4 <= length) {
        if (bytes[offset++] !== 255) return null;
        while (offset < length && bytes[offset] === 255) offset++;
        var marker = bytes[offset++];
        if (marker === 218) return found;
        if (marker === 217) return null;
        var size = bytes[offset] * 256 + bytes[offset + 1];
        if (size < 2 || offset + size > length) return null;
        if (marker === 192 || marker === 194) {
            if (found || size < 8 || bytes[offset + 2] !== 8) return null;
            found = {
                height: bytes[offset + 3] * 256 + bytes[offset + 4],
                width: bytes[offset + 5] * 256 + bytes[offset + 6],
            };
        }
        // Other JPEG frame types are outside the snapshot contract.
        else if (
            marker >= 192 &&
            marker <= 207 &&
            marker !== 196 &&
            marker !== 200 &&
            marker !== 204
        )
            return null;
        offset += size;
    }
    return null;
}
function decode(
    w: any,
    body: string,
    options: NotificationMediaOptions,
    elapsed: number
): { bytes: Uint8Array; remainingMs: number } | null {
    if (body.length > BODY_LIMIT || /[^\x09\x0a\x0d\x20-\x7e]/.test(body))
        return null;
    var data = JSON.parse(body),
        media = options.media;
    if (
        !data ||
        data.version !== 1 ||
        data.id !== media.id ||
        data.runtime !== options.runtime ||
        data.content_type !== "image/jpeg" ||
        data.width !== media.width ||
        data.height !== media.height ||
        data.bytes !== media.bytes ||
        typeof data.server_time !== "number" ||
        !isFinite(data.server_time) ||
        typeof data.expires_at !== "number" ||
        !isFinite(data.expires_at) ||
        data.server_time <= 0 ||
        (data.expires_at - data.server_time) * 1000 <= elapsed ||
        typeof data.data_base64 !== "string" ||
        data.data_base64.length !== Math.ceil(media.bytes / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data.data_base64)
    )
        return null;
    var binary = w.atob(data.data_base64);
    if (binary.length !== media.bytes) return null;
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
    var size = jpegSize(bytes);
    return size && size.width === media.width && size.height === media.height
        ? {
              bytes: bytes,
              remainingMs: Math.min(
                  options.remainingMs - elapsed,
                  (data.expires_at - data.server_time) * 1000 - elapsed
              ),
          }
        : null;
}
/** Explicit cancellation is silent. Completion owns its disposable object URL. */
export function loadNotificationMedia(
    w: any,
    options: NotificationMediaOptions,
    complete: (result: NotificationMediaResult | null) => void
): () => void {
    var done = false,
        timer: any = null,
        controller: any = null,
        reader: any = null;
    function clock(): number | null {
        try {
            var value = w.performance && w.performance.now();
            return typeof value === "number" && isFinite(value) ? value : null;
        } catch (_error) {
            return null;
        }
    }
    var started = Date.now(),
        monotonic = clock();
    function elapsed(): number {
        var now = clock();
        return Math.max(
            0,
            Date.now() - started,
            monotonic === null || now === null ? 0 : now - monotonic
        );
    }
    function cancelTransport(): void {
        try {
            if (controller) controller.abort();
        } catch (_error) {}
        try {
            if (reader) {
                var cancelled = reader.cancel();
                if (cancelled && cancelled.catch)
                    cancelled.catch(function () {});
            }
        } catch (_error) {}
    }
    function finish(body?: string): void {
        if (done) return;
        done = true;
        w.clearTimeout(timer);
        cancelTransport();
        var result: NotificationMediaResult | null = null;
        try {
            var bytes =
                body && elapsed() < options.remainingMs
                    ? decode(w, body, options, elapsed())
                    : null;
            var api = w.URL || w.webkitURL;
            if (
                bytes &&
                api &&
                typeof api.createObjectURL === "function" &&
                typeof api.revokeObjectURL === "function" &&
                typeof w.Blob === "function"
            ) {
                var url = api.createObjectURL(
                    new w.Blob([bytes.bytes], { type: "image/jpeg" })
                );
                var disposed = false;
                result = {
                    dispose: function () {
                        if (!disposed) {
                            disposed = true;
                            try {
                                api.revokeObjectURL(url);
                            } catch (_error) {}
                        }
                    },
                    height: options.media.height,
                    remainingMs: bytes.remainingMs,
                    url: url,
                    width: options.media.width,
                };
            }
        } catch (_error) {}
        complete(result);
    }
    function abort(): void {
        if (!done) {
            done = true;
            w.clearTimeout(timer);
            cancelTransport();
        }
    }
    try {
        if (
            !validNotificationMedia(options.media) ||
            typeof options.runtime !== "string" ||
            !/^[A-Za-z0-9_.:-]{1,128}$/.test(options.runtime) ||
            typeof options.token !== "string" ||
            !/^[\x21-\x7e]{1,4096}$/.test(options.token) ||
            typeof options.address !== "string" ||
            typeof options.remainingMs !== "number" ||
            !isFinite(options.remainingMs) ||
            options.remainingMs <= 0 ||
            !supportsNotificationMedia(w)
        ) {
            finish();
            return abort;
        }
        var url = new w.URL(options.address);
        if (
            !/^https?:$/.test(url.protocol) ||
            url.username ||
            url.password ||
            url.hash
        ) {
            finish();
            return abort;
        }
        var device = url.searchParams.get("device_id");
        if (
            url.search &&
            (!device ||
                !/^[A-Za-z0-9_.:-]{1,128}$/.test(device) ||
                url.searchParams.toString() !==
                    "device_id=" + encodeURIComponent(device))
        ) {
            finish();
            return abort;
        }
        url.pathname =
            url.pathname
                .replace(/\/$/, "")
                .replace(/\/api\/webhook\/commands$/, "") +
            "/api/notifications/media";
        url.search =
            "?id=" +
            options.media.id +
            "&runtime=" +
            encodeURIComponent(options.runtime) +
            (device ? "&device_id=" + encodeURIComponent(device) : "");
        controller = new w.AbortController();
        var transport: any = {
            headers: {
                Accept: "application/json",
                Authorization: "Bearer " + options.token,
            },
            method: "GET",
            url: url.toString(),
        };
        if (w.__OTTPLAY_HOSTED__ && w.__OTTPLAY_HOSTED__.controlTransport) {
            if (!w.__ottControlTransport) throw new Error();
            transport = w.__ottControlTransport.map(transport);
        }
        var request = new w.Request(transport.url, {
            body: transport.body,
            cache: "no-store",
            credentials: "omit",
            headers: transport.headers,
            method: transport.method,
            redirect: "error",
            signal: controller.signal,
        });
        if (request.redirect !== "error") {
            finish();
            return abort;
        }
        timer = w.setTimeout(
            function () {
                finish();
            },
            Math.min(8000, options.remainingMs)
        );
        w.fetch(request)
            .then(function (response: any) {
                if (done) return;
                var type = response.headers.get("Content-Type") || "";
                var length = response.headers.get("Content-Length");
                if (
                    response.status !== 200 ||
                    response.redirected ||
                    (response.url && response.url !== transport.url) ||
                    !/^application\/json(?:\s*;|$)/i.test(type) ||
                    (length !== null &&
                        (!/^\d+$/.test(length) ||
                            Number(length) > BODY_LIMIT)) ||
                    !response.body ||
                    typeof response.body.getReader !== "function"
                ) {
                    finish();
                    return;
                }
                reader = response.body.getReader();
                var total = 0,
                    text = "";
                function read(): void {
                    reader
                        .read()
                        .then(function (part: any) {
                            if (done) return;
                            if (part.done) {
                                finish(text);
                                return;
                            }
                            if (
                                !part.value ||
                                typeof part.value.length !== "number" ||
                                total + part.value.length > BODY_LIMIT
                            ) {
                                finish();
                                return;
                            }
                            total += part.value.length;
                            for (var i = 0; i < part.value.length; i++) {
                                if (part.value[i] > 127) {
                                    finish();
                                    return;
                                }
                                text += String.fromCharCode(part.value[i]);
                            }
                            read();
                        })
                        .catch(function () {
                            finish();
                        });
                }
                read();
            })
            .catch(function () {
                finish();
            });
    } catch (_error) {
        finish();
    }
    return abort;
}
