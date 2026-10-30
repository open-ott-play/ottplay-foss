// Read-only CORS transport for public, exact-release Homebrew Channel metadata.
// IPK downloads remain direct GitHub downloads by the installer's backend.
export const ASSETS = Object.freeze({
    "ottplay-foss-webos-description.html": "text/html; charset=utf-8",
    "ottplay-foss-webos-icon.png": "image/png",
    "ottplay-foss-webos-manifest.json": "application/json; charset=utf-8",
    "ottplay-foss-webos-repository.json": "application/json; charset=utf-8",
    "ottplay-native-webos-icon.png": "image/png",
    "ottplay-native-webos-manifest.json": "application/json; charset=utf-8",
    "ottplay-native-webos-repository.json": "application/json; charset=utf-8",
});
export const MAX_BYTES = 256 * 1024;
export const DEADLINE_MS = 10000;
export const MAX_REDIRECTS = 3;
const RELEASE_TAG =
    /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:beta|rc)\.[1-9]\d*|-nightly\.\d{14}\.[1-9]\d*\.[1-9]\d*)?$/;
const NATIVE_TAG =
    /^native-webos-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:beta|rc)\.[1-9]\d*)?$/;
const DOWNLOAD_PREFIX =
    "https://github.com/open-ott-play/ottplay-foss/releases/download/";
const DOWNLOAD_HOSTS = new Set([
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function headers(type, cache = "no-store") {
    return {
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": cache,
        "Content-Type": type,
        "X-Content-Type-Options": "nosniff",
    };
}

function errorResponse(status, message, method) {
    const responseHeaders = headers("application/json; charset=utf-8");
    if (status === 405) responseHeaders.Allow = "GET, HEAD, OPTIONS";
    return new Response(
        method === "HEAD" ? null : JSON.stringify({ error: message }) + "\n",
        { headers: responseHeaders, status }
    );
}

function route(request) {
    const url = new URL(request.url);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
    )
        return null;
    const match = url.pathname.match(/^\/v1\/([^/]{1,128})\/([^/]{1,64})$/);
    if (!match || !Object.hasOwn(ASSETS, match[2])) return null;
    const native = match[2].startsWith("ottplay-native-");
    if (!(native ? NATIVE_TAG : RELEASE_TAG).test(match[1])) return null;
    return { name: match[2], tag: match[1], type: ASSETS[match[2]] };
}

function redirectTarget(value, current, original) {
    const url = new URL(value, current);
    if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        url.hash
    )
        throw new Error("Unsupported upstream redirect");
    if (url.hostname === "github.com") {
        if (url.href !== original)
            throw new Error("Unexpected GitHub download path");
    } else if (!DOWNLOAD_HOSTS.has(url.hostname)) {
        throw new Error("Unexpected download host");
    }
    return url.href;
}

function cancelBody(response) {
    try {
        const pending = response.body?.cancel();
        pending?.catch(() => {});
    } catch (_) {
        /* An already closed body needs no cleanup. */
    }
}

async function resource(selected, fetchImpl, state) {
    const original = DOWNLOAD_PREFIX + selected.tag + "/" + selected.name;
    let url = original;
    const visited = new Set();
    let response;
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
        if (visited.has(url)) throw new Error("Redirect loop");
        visited.add(url);
        // Reconstruct the request: no client cookies, Authorization, Origin,
        // conditional headers, ranges, or arbitrary request body are forwarded.
        response = await fetchImpl(url, {
            headers: { Accept: selected.type.split(";")[0] },
            method: "GET",
            redirect: "manual",
            signal: state.controller.signal,
        });
        if (state.timedOut) {
            cancelBody(response);
            throw new Error("Deadline");
        }
        if (!REDIRECTS.has(response.status)) break;
        const location = response.headers.get("Location");
        cancelBody(response);
        if (!location || attempt === MAX_REDIRECTS)
            throw new Error("Invalid redirect chain");
        url = redirectTarget(location, url, original);
    }
    if (response.status !== 200) {
        cancelBody(response);
        return { missing: response.status === 404 };
    }
    const length = response.headers.get("Content-Length");
    if (
        length !== null &&
        (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)
    ) {
        cancelBody(response);
        throw new Error("Invalid metadata size");
    }
    if (!response.body) throw new Error("Missing metadata body");
    const reader = response.body.getReader();
    state.reader = reader;
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES)
                throw new Error("Metadata exceeds size limit");
            chunks.push(value);
        }
    } finally {
        state.reader = null;
        // cancel() is intentionally not awaited: a remote body cannot delay cleanup.
        reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    if (!size) throw new Error("Empty metadata body");
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    if (selected.type.startsWith("application/json")) {
        const value = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(body)
        );
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Invalid metadata JSON");
    } else if (selected.type === "image/png") {
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (body.length < 33 || !signature.every((byte, i) => body[i] === byte))
            throw new Error("Invalid PNG metadata");
    } else if (
        !/^<!doctype html>/i.test(
            new TextDecoder("utf-8", { fatal: true }).decode(body).trimStart()
        )
    ) {
        throw new Error("Invalid HTML metadata");
    }
    return { body };
}

// Dependency injection is for offline fixtures; the deployed handler uses the
// fixed deadline, size, hosts and public route set above, with no environment keys.
export function createHandler({
    fetchImpl = globalThis.fetch,
    deadlineMs = DEADLINE_MS,
} = {}) {
    if (
        !Number.isInteger(deadlineMs) ||
        deadlineMs < 1 ||
        deadlineMs > DEADLINE_MS
    )
        throw new Error("Invalid metadata deadline");
    return async function handle(request) {
        const selected = route(request);
        if (!selected)
            return errorResponse(404, "Unknown metadata route", request.method);
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
            return errorResponse(405, "Method not allowed", request.method);
        if (request.method === "OPTIONS") {
            const desired = request.headers.get(
                "Access-Control-Request-Method"
            );
            if (desired && desired !== "GET" && desired !== "HEAD")
                return errorResponse(405, "Method not allowed", request.method);
            return new Response(null, {
                headers: {
                    ...headers("text/plain; charset=utf-8"),
                    "Access-Control-Max-Age": "86400",
                },
                status: 204,
            });
        }
        const state = {
            controller: new AbortController(),
            reader: null,
            timedOut: false,
        };
        let timer;
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => {
                state.timedOut = true;
                state.controller.abort();
                state.reader?.cancel().catch(() => {});
                reject(new Error("Deadline"));
            }, deadlineMs);
        });
        try {
            const result = await Promise.race([
                resource(selected, fetchImpl, state),
                deadline,
            ]);
            if (!result.body)
                return errorResponse(
                    result.missing ? 404 : 502,
                    "Release metadata is unavailable",
                    request.method
                );
            const responseHeaders = headers(
                selected.type,
                "public, max-age=300"
            );
            responseHeaders["Content-Length"] = String(result.body.byteLength);
            if (selected.type.startsWith("text/html"))
                responseHeaders["Content-Security-Policy"] =
                    "default-src 'none'";
            return new Response(
                request.method === "HEAD" ? null : result.body,
                { headers: responseHeaders, status: 200 }
            );
        } catch (_) {
            return errorResponse(
                state.timedOut ? 504 : 502,
                state.timedOut
                    ? "Release metadata request timed out"
                    : "Release metadata is unavailable",
                request.method
            );
        } finally {
            clearTimeout(timer);
        }
    };
}

export default { fetch: createHandler() };
