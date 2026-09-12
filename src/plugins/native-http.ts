/** Native HTTP underneath jQuery, leaving its public AJAX contract intact. */
export interface NativeHttpResponse {
    body: string;
    headers: string;
    status: number;
    statusText: string;
}

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
        var escaped = callback.replace(/\$/g, "\\$");
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
    request: (args: any) => Promise<NativeHttpResponse>
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
        if (
            !(
                isCompanionProxy ||
                (remote && (method === "GET" || isExternalMatch))
            )
        )
            return;

        var types: string[] = opts.dataTypes || [];
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
        return {
            // Native IPC cannot cancel an in-flight request. jQuery settles abort/timeout
            // immediately; discard late native responses (native timeout is bounded).
            abort: function (): void {
                aborted = true;
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
                    request({
                        body: requestBody,
                        headers: requestHeaders,
                        method: requestMethod,
                        timeoutMs: opts.timeout > 0 ? opts.timeout : 30000,
                        url: requestUrl,
                    }).then(
                        function (response: NativeHttpResponse) {
                            if (aborted) return;
                            complete(
                                response.status,
                                response.statusText,
                                { text: response.body },
                                response.headers
                            );
                        },
                        function (error: any) {
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
}

export function installCapacitorHttpTransport(
    $: any,
    http: { httpRequest(args: any): Promise<NativeHttpResponse> }
): void {
    var capacitor = (window as any).Capacitor;
    if (
        capacitor &&
        typeof capacitor.isNativePlatform === "function" &&
        !capacitor.isNativePlatform()
    )
        return;
    installNativeHttpTransport($, function (args) {
        args.url = String(args.url).replace(/^@/, "");
        return http.httpRequest(args);
    });
}
