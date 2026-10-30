/** Hosted proxy transport. Device credentials travel only in the HTTPS body. */
(function (host: any): void {
    var routes: Record<string, string> = {
        "/api/discovery": "GET",
        "/api/notifications": "GET",
        "/api/notifications/media": "GET",
        "/api/pairings": "GET POST DELETE",
        "/api/player-state": "POST",
        "/api/responses": "POST",
        "/api/v2/diagnostics/events": "POST",
        "/api/v2/diagnostics/poll": "POST",
        "/api/v2/diagnostics/repairs/poll": "POST",
        "/api/v2/diagnostics/repairs/results": "POST",
        "/api/v2/diagnostics/results": "POST",
        "/api/v2/diagnostics/runtimes": "POST",
        "/api/webhook/commands": "GET",
        "/api/webhook/commands/ack": "POST",
        "/webhook/poll": "GET",
    };
    function fail(): never {
        throw new Error("Invalid hosted control request");
    }
    function bytes(value: string): number {
        return encodeURIComponent(value).replace(/%[A-F\d]{2}/gi, "x").length;
    }
    function base(value: any): string {
        if (typeof value !== "string") return fail();
        var url = new URL(value);
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            /[\s\\]/.test(value) ||
            /\/(?:\.|%2e)/i.test(url.pathname)
        )
            return fail();
        var canonical = url.origin + url.pathname.replace(/\/+$/, "");
        if (canonical !== value) return fail();
        return canonical;
    }
    function map(request: any): any {
        var config =
            host.__OTTPLAY_HOSTED__ && host.__OTTPLAY_HOSTED__.controlTransport;
        if (!config) return request;
        if (
            config.version !== 1 ||
            Object.keys(config).sort().join(",") !== "bases,endpoint,version" ||
            !Array.isArray(config.bases) ||
            !config.bases.length ||
            config.bases.length > 8 ||
            typeof config.endpoint !== "string"
        )
            return fail();
        var target = new URL(request.url);
        var selected = "";
        config.bases.forEach(function (value: any) {
            var candidate = base(value);
            if (
                request.url.indexOf(candidate + "/") === 0 &&
                candidate.length > selected.length
            )
                selected = candidate;
        });
        if (!selected) return request;
        if (
            target.username ||
            target.password ||
            target.hash ||
            /[\\\s]/.test(request.url)
        )
            return fail();
        var path = request.url.slice(selected.length);
        var route = path.split("?")[0];
        var allowed = routes[route];
        if (path.length > 2048 || bytes(path) > 2048) return fail();
        if (route === "/api/pairings" && request.method !== "POST") {
            if (!/^\/api\/pairings\?id=[a-f0-9]{32}$/.test(path)) return fail();
        }
        if (
            !allowed ||
            (" " + allowed + " ").indexOf(" " + request.method + " ") < 0
        )
            return fail();
        var endpoint = new URL(config.endpoint, host.location.href);
        if (
            endpoint.protocol !== "https:" ||
            endpoint.origin !== host.location.origin ||
            endpoint.username ||
            endpoint.password ||
            endpoint.search ||
            endpoint.hash ||
            /[\\\s]/.test(config.endpoint)
        )
            return fail();
        var envelope: any = { method: request.method, path: path, version: 1 };
        var headers: Record<string, string> = {};
        var seen: Record<string, boolean> = {};
        Object.keys(request.headers || {}).forEach(function (name) {
            var value = request.headers[name];
            var key = name.toLowerCase();
            if (seen[key]) fail();
            seen[key] = true;
            switch (key) {
                case "authorization":
                    if (
                        typeof value !== "string" ||
                        !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(value)
                    )
                        fail();
                    envelope.token = value.slice(7);
                    break;
                case "x-ott-diagnostics-epoch":
                    if (
                        route.indexOf("/api/v2/diagnostics/") !== 0 ||
                        typeof value !== "string" ||
                        !/^[A-Za-z0-9_.-]{1,80}$/.test(value)
                    )
                        fail();
                    headers["X-OTT-Diagnostics-Epoch"] = value;
                    break;
                case "content-type":
                    if (
                        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
                            value
                        )
                    )
                        fail();
                    break;
                case "accept":
                    if (value !== "application/json") fail();
                    break;
                case "x-ottplay-discovery":
                    break;
                default:
                    fail();
            }
        });
        if (Object.keys(headers).length) envelope.headers = headers;
        if (
            request.body !== undefined &&
            request.body !== null &&
            request.body !== ""
        ) {
            envelope.body = JSON.parse(request.body);
            if (
                !envelope.body ||
                typeof envelope.body !== "object" ||
                Array.isArray(envelope.body)
            )
                return fail();
        }
        if ((request.method === "POST") !== !!envelope.body) return fail();
        var body = JSON.stringify(envelope);
        if (body.length > 2105344 || bytes(body) > 2105344) return fail();
        var result: any = {};
        Object.keys(request).forEach(function (key) {
            result[key] = request[key];
        });
        result.url = endpoint.href;
        result.method = "POST";
        result.body = body;
        result.headers = {
            Accept: "application/json",
            "Content-Type": "application/json",
        };
        result.secureControl = true;
        return result;
    }
    host.__ottControlTransport = { map: map };
    host.__OTT_CONTROL_TRANSPORT_VERSION__ = 1;
})(window as any);
