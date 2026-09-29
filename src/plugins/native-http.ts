/** Native HTTP underneath jQuery, leaving its public AJAX contract intact. */
export interface NativeHttpResponse {
    body: string;
    headers: string;
    status: number;
    statusText: string;
}

var nativeHttpSequence = 0;

function nativeHttpRemoteUrl(url: string): boolean {
    if (!/^https?:\/\//i.test(url)) return false;
    try {
        var parsed = new URL(url);
        var hostname = parsed.hostname.toLowerCase();
        return (
            parsed.origin !== window.location.origin &&
            !/^(tauri|ipc|asset)\.localhost$/.test(hostname)
        );
    } catch (_error) {
        return false;
    }
}

function nativeHttpFormField(data: string, name: string): string {
    var match = new RegExp("(?:^|&)" + name + "=([^&]*)").exec(data);
    return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
}

/**
 * JSONP providers use jQuery's generated callback name. Parse only that call;
 * never evaluate a provider response as a script inside the native app.
 */
function nativeHttpJsonpConverter(callback: string): (text: string) => string {
    return function (text: string): string {
        if (!/^[A-Za-z_$][\w$]*$/.test(callback))
            throw new Error("Unsupported JSONP callback name");
        var escaped = callback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        var match = new RegExp(
            "^\\s*(?:/\\*\\*/\\s*)?" +
                escaped +
                "\\s*\\(([\\s\\S]*)\\)\\s*;?\\s*$"
        ).exec(text);
        if (!match) throw new Error("Invalid JSONP response for " + callback);
        var value = JSON.parse(match[1]);
        var receive = (window as any)[callback];
        if (typeof receive !== "function")
            throw new Error("Missing JSONP callback " + callback);
        receive(value);
        return text;
    };
}

/**
 * Installed only for embedded native frontends. jQuery has already applied
 * $.param, JSONP callback/cache parameters, beforeSend and headers by send().
 * It also owns converters, statusCode, context, callbacks and jqXHR.abort().
 */
function installNativeHttpTransport(
    $: any,
    request: (args: any) => Promise<NativeHttpResponse>,
    cancel?: (requestId: string) => Promise<unknown>
): void {
    $.ajaxTransport("+* +script", function (opts: any) {
        if (opts.async === false) return;
        var url = String(opts.url || "");
        var method = String(opts.type || "GET").toUpperCase();
        var remote = nativeHttpRemoteUrl(url);
        var path = url.split("?")[0];
        var isCompanionProxy = !remote && /\/m3u\/cp\.php$/.test(path);
        var isExternalMatch =
            remote && /\/m3u\/match-(?:channels|logos)$/.test(path);
        var types: string[] = opts.dataTypes || [];
        // VPortal explicitly opts its JSON POST protocol into the native bridge.
        // Keep unrelated provider POSTs on their existing transport.
        var isVPortalRequest =
            opts.vportalRequest === true &&
            remote &&
            method === "POST" &&
            /^application\/json(?:\s*;|$)/i.test(
                String(opts.contentType || "")
            ) &&
            types.indexOf("json") !== -1;
        if (
            !(
                isCompanionProxy ||
                (remote && (method === "GET" || isExternalMatch)) ||
                isVPortalRequest
            )
        )
            return;

        // A playlist can have an incorrect JavaScript MIME type. jQuery 1.x
        // otherwise evaluates it (even for HTTP errors) during MIME inference.
        opts.contents.script = false;
        if (types[0] === "script") {
            // Ordinary $.getScript keeps the browser's existing transport.
            if (types.indexOf("json") === -1 || !opts.jsonpCallback) return;
            opts.converters["text script"] = nativeHttpJsonpConverter(
                String(opts.jsonpCallback)
            );
        }
        var aborted = false;
        var settled = false;
        var requestId: string | undefined;
        return {
            // jQuery settles immediately; retire only this native request as well.
            abort: function (): void {
                if (aborted || settled) return;
                aborted = true;
                if (cancel && requestId) {
                    try {
                        cancel(requestId).catch(function () {});
                    } catch (_error) {}
                }
            },
            send: function (
                headers: Record<string, string>,
                complete: any
            ): void {
                var requestUrl = url;
                var requestMethod = method;
                var requestBody =
                    opts.hasContent && opts.data != null
                        ? String(opts.data)
                        : undefined;
                var requestHeaders = headers;
                try {
                    if (isCompanionProxy) {
                        var form =
                            requestBody || url.slice(url.indexOf("?") + 1);
                        requestUrl = nativeHttpFormField(form, "url");
                        if (!requestUrl)
                            throw new Error("proxy_fetch: missing url");
                        requestMethod = "GET";
                        requestBody = undefined;
                        // cp.php's form headers describe the envelope, not the upstream GET.
                        requestHeaders = {};
                        var ua = nativeHttpFormField(form, "ua");
                        if (ua) requestHeaders["User-Agent"] = ua;
                    }
                    var args: any = {
                        body: requestBody,
                        headers: requestHeaders,
                        method: requestMethod,
                        timeoutMs: opts.timeout > 0 ? opts.timeout : 30000,
                        url: requestUrl,
                    };
                    if (cancel) {
                        requestId =
                            "http-" +
                            Date.now().toString(36) +
                            "-" +
                            (++nativeHttpSequence).toString(36);
                        args.requestId = requestId;
                    }
                    request(args).then(
                        function (response: NativeHttpResponse) {
                            settled = true;
                            if (aborted) return;
                            complete(
                                response.status,
                                response.statusText,
                                { text: response.body },
                                response.headers
                            );
                        },
                        function (error: any) {
                            settled = true;
                            if (aborted) return;
                            var message =
                                error && error.message
                                    ? String(error.message)
                                    : String(error || "Native HTTP failed");
                            complete(
                                0,
                                error &&
                                    (error.timeout || error.code === "timeout")
                                    ? "timeout"
                                    : "error",
                                { text: message }
                            );
                        }
                    );
                } catch (error) {
                    settled = true;
                    complete(0, "error", { text: String(error) });
                }
            },
        };
    });
}

export function installTauriHttpTransport(
    $: any,
    invoke: (command: string, args: any) => Promise<NativeHttpResponse>
): void {
    installNativeHttpTransport($, function (args) {
        return invoke("proxy_http", args);
    });
    installNativeSwopTransport($, (args) => invoke("swop_http", args), true);
}

export function installCapacitorHttpTransport(
    $: any,
    http: {
        httpRequest(args: any): Promise<NativeHttpResponse>;
        cancelHttpRequest?(args: { requestId: string }): Promise<unknown>;
        swopRequest?(args: any): Promise<NativeHttpResponse>;
    }
): void {
    var capacitor = (window as any).Capacitor;
    if (
        capacitor &&
        typeof capacitor.isNativePlatform === "function" &&
        !capacitor.isNativePlatform()
    )
        return;
    installNativeHttpTransport(
        $,
        function (args) {
            args.url = String(args.url).replace(/^@/, "");
            return http.httpRequest(args);
        },
        capacitor?.getPlatform?.() === "ios" && http.cancelHttpRequest
            ? function (requestId) {
                  return http.cancelHttpRequest!({ requestId });
              }
            : undefined
    );
    if (capacitor && capacitor.isNativePlatform?.() === true) {
        installNativeSwopTransport(
            $,
            (args) => {
                if (!http.swopRequest)
                    throw new Error("Native SWOP unavailable");
                return http.swopRequest(args);
            },
            false
        );
    }
}

/** Dedicated, explicit SWOP capability. Never fall back to provider HTTP/XHR. */
function installNativeSwopTransport(
    $: any,
    request: (args: {
        url: string;
        body: string;
        clientId: string;
    }) => Promise<NativeHttpResponse>,
    allowLoopback: boolean
): void {
    $.ajaxTransport("+*", function (opts: any, original: any) {
        if (opts.swopNativeRequest !== true) return;
        var aborted = false;
        return {
            abort: function (): void {
                aborted = true;
            },
            send: function (
                headers: Record<string, string>,
                complete: any
            ): void {
                function fail(timeout?: boolean): void {
                    if (!aborted)
                        complete(0, timeout ? "timeout" : "error", {
                            text: "Native remote text entry request failed",
                        });
                }
                try {
                    var url = String(original.url || "");
                    if (url !== String(opts.url || "")) throw new Error();
                    // Reject URL normalization tricks before parsing (encoded paths,
                    // userinfo, query, fragment, whitespace and backslashes).
                    var match =
                        /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::([0-9]{1,5}))?\/swop\/(session|val)$/.exec(
                            url
                        );
                    if (
                        !match ||
                        (match[1] !== "https" &&
                            !(
                                allowLoopback &&
                                (match[2] === "127.0.0.1" ||
                                    match[2] === "[::1]")
                            ))
                    )
                        throw new Error();
                    var parsed = new URL(url);
                    if (
                        !parsed.hostname ||
                        (match[3] && (+match[3] < 1 || +match[3] > 65535))
                    )
                        throw new Error();
                    var body = String(opts.data || "");
                    var value = JSON.parse(body);
                    if (
                        !value ||
                        typeof value !== "object" ||
                        Array.isArray(value) ||
                        unescape(encodeURIComponent(body)).length > 65536 ||
                        opts.type !== "POST" ||
                        opts.async === false ||
                        !/^application\/json(?:\s*;|$)/i.test(
                            String(opts.contentType || "")
                        ) ||
                        (opts.dataTypes || []).indexOf("json") === -1
                    )
                        throw new Error();
                    var clientId = "";
                    for (var key in headers) {
                        var name = key.toLowerCase();
                        if (name === "x-swop-client-id")
                            clientId = headers[key];
                        else if (name !== "accept" && name !== "content-type")
                            throw new Error();
                    }
                    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(clientId))
                        throw new Error();
                    // Only these fields cross IPC; native code independently validates
                    // and creates its own fixed headers, origin and ten-second deadline.
                    request({ body: body, clientId: clientId, url: url }).then(
                        function (response) {
                            if (!aborted)
                                complete(
                                    response.status,
                                    response.statusText,
                                    { text: response.body },
                                    response.headers
                                );
                        },
                        function (error) {
                            fail(
                                error &&
                                    (error.timeout || error.code === "timeout")
                            );
                        }
                    );
                } catch (_error) {
                    fail();
                }
            },
        };
    });
}
