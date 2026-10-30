const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
    const { ASSETS, MAX_BYTES, MAX_REDIRECTS, createHandler } = await import(
        pathToFileURL(
            path.resolve(__dirname, "../scripts/webos-feed-worker.mjs")
        )
    );
    const tag = "v1.1.62-beta.3";
    const base = "https://ottplay-webos.igw-2560801.workers.dev/v1/";
    const file = "ottplay-foss-webos-repository.json";
    const origin =
        "https://github.com/open-ott-play/ottplay-foss/releases/download/";
    const json = Buffer.from('{"packages":[],"label":"日本語"}\n');
    const request = (name = file, options) =>
        new Request(base + tag + "/" + name, options);
    const calls = [];
    const handler = createHandler({
        fetchImpl: async (url, init) => {
            calls.push({ init, url });
            if (url.startsWith(origin))
                return new Response(null, {
                    headers: {
                        Location:
                            "https://release-assets.githubusercontent.com/test/asset?signature=example",
                    },
                    status: 302,
                });
            return new Response(json, {
                headers: {
                    "Access-Control-Allow-Credentials": "true",
                    "Set-Cookie": "private=value",
                },
            });
        },
    });
    let response = await handler(
        request(file, {
            headers: {
                Authorization: "Bearer do-not-forward",
                Cookie: "private=do-not-forward",
                "If-None-Match": "do-not-forward",
                Origin: "https://untrusted.example",
                Range: "bytes=0-1",
                "X-Api-Key": "do-not-forward",
            },
        })
    );
    assert.equal(response.status, 200);
    assert(
        Buffer.from(await response.arrayBuffer()).equals(json),
        "Successful metadata must be byte-exact"
    );
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Content-Type"), ASSETS[file]);
    assert.equal(response.headers.get("Content-Length"), String(json.length));
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(
        response.headers.get("Access-Control-Allow-Credentials"),
        null
    );
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, origin + tag + "/" + file);
    for (const call of calls) {
        assert.equal(call.init.method, "GET");
        assert.equal(call.init.redirect, "manual");
        assert.deepEqual(call.init.headers, { Accept: "application/json" });
        assert(call.init.signal instanceof AbortSignal);
        assert.equal(call.init.body, undefined);
    }

    response = await handler(request(file, { method: "HEAD" }));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("Content-Length"), String(json.length));

    let requests = 0;
    const direct = createHandler({
        fetchImpl: async () => {
            requests++;
            return new Response(json);
        },
    });
    for (const suffix of [
        "latest/" + file,
        "v01.2.3/" + file,
        "v1.2/" + file,
        "native-webos-v0.1.0-beta.1/" + file,
        "native-webos-latest/ottplay-native-webos-repository.json",
        "native-webos-v01.1.0/ottplay-native-webos-repository.json",
        "native-webos-v0.1.0-beta.1/ottplay-native-webos-0.1.0.ipk",
        tag + "/ottplay-native-webos-repository.json",
        tag + "/ottplay-foss-webos.ipk",
        tag + "/video.mp4",
        tag + "/app.js",
        tag + "/" + file + "?url=https://elsewhere.example/",
        tag + "/" + file + "#fragment",
        tag + "/" + file + "/extra",
        tag + "/%6fttplay-foss-webos-repository.json",
        "https://elsewhere.example/" + file,
    ]) {
        response = await direct(new Request(base + suffix));
        assert.equal(response.status, 404, suffix);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
    response = await direct(
        new Request(
            "http://ottplay-webos.igw-2560801.workers.dev/v1/" +
                tag +
                "/" +
                file
        )
    );
    assert.equal(response.status, 404);
    response = await direct(request(file, { body: "ignored", method: "POST" }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD, OPTIONS");
    assert.equal(requests, 0, "Rejected requests must not access GitHub");
    response = await direct(
        request(file, {
            headers: { "Access-Control-Request-Method": "GET" },
            method: "OPTIONS",
        })
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(
        response.headers.get("Access-Control-Allow-Methods"),
        "GET, HEAD, OPTIONS"
    );
    assert.equal(response.headers.get("Access-Control-Allow-Headers"), null);
    response = await direct(
        request(file, {
            headers: { "Access-Control-Request-Method": "POST" },
            method: "OPTIONS",
        })
    );
    assert.equal(response.status, 405);
    assert.equal(requests, 0, "Preflights must not access GitHub");

    for (const release of [
        "v1.2.3",
        "v1.2.3-rc.1",
        "v1.2.3-nightly.20261030010203.1.1",
    ]) {
        response = await direct(new Request(base + release + "/" + file));
        assert.equal(response.status, 200, release);
    }
    const icon = fs.readFileSync(
        path.resolve(__dirname, "../webos/largeIcon.png")
    );
    const bodies = {
        "ottplay-foss-webos-description.html": Buffer.from(
            "<!doctype html><html><p>OTT-play FOSS</p></html>\n"
        ),
        "ottplay-foss-webos-icon.png": icon,
        "ottplay-foss-webos-manifest.json": Buffer.from(
            '{"id":"com.openottplay.player"}\n'
        ),
        "ottplay-foss-webos-repository.json": json,
    };
    for (const [name, bytes] of Object.entries(bodies)) {
        const h = createHandler({ fetchImpl: async () => new Response(bytes) });
        response = await h(request(name));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Content-Type"), ASSETS[name]);
        assert(Buffer.from(await response.arrayBuffer()).equals(bytes));
    }
    for (const nativeTag of [
        "native-webos-v0.1.0-beta.1",
        "native-webos-v0.1.0",
    ]) {
        for (const name of [
            "ottplay-native-webos-repository.json",
            "ottplay-native-webos-manifest.json",
            "ottplay-native-webos-icon.png",
        ]) {
            const bytes = name.endsWith(".png") ? icon : json;
            const h = createHandler({
                fetchImpl: async (url) => {
                    assert.equal(url, origin + nativeTag + "/" + name);
                    return new Response(bytes);
                },
            });
            response = await h(new Request(base + nativeTag + "/" + name));
            assert.equal(response.status, 200);
            assert.equal(
                response.headers.get("Access-Control-Allow-Origin"),
                "*"
            );
            assert.equal(response.headers.get("Content-Type"), ASSETS[name]);
            assert(Buffer.from(await response.arrayBuffer()).equals(bytes));
        }
    }

    for (const location of [
        "http://release-assets.githubusercontent.com/test",
        "https://attacker.example/test",
        "https://release-assets.githubusercontent.com.attacker.example/test",
        "https://user:password@release-assets.githubusercontent.com/test",
        "https://release-assets.githubusercontent.com:444/test",
        "https://github.com/another/repo/releases/download/" + tag + "/" + file,
        "https://github.com/open-ott-play/ottplay-foss/releases/download/" +
            tag +
            "/" +
            file +
            "?query=1",
        "https://api.github.com/repos/open-ott-play/ottplay-foss",
        "file:///tmp/private",
    ]) {
        let redirects = 0;
        const h = createHandler({
            fetchImpl: async () => {
                redirects++;
                return new Response(null, {
                    headers: { Location: location },
                    status: 302,
                });
            },
        });
        response = await h(request());
        assert.equal(response.status, 502, location);
        assert.equal(redirects, 1, "Unapproved redirect must not be followed");
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert(
            !(await response.text()).includes(location),
            "Do not expose signed redirect URLs"
        );
    }
    let hops = 0;
    const endlessRedirects = createHandler({
        fetchImpl: async () =>
            new Response(null, {
                headers: {
                    Location:
                        "https://objects.githubusercontent.com/asset-" + ++hops,
                },
                status: 307,
            }),
    });
    response = await endlessRedirects(request());
    assert.equal(response.status, 502);
    assert.equal(hops, MAX_REDIRECTS + 1);
    const looping = createHandler({
        fetchImpl: async () =>
            new Response(null, {
                headers: { Location: origin + tag + "/" + file },
                status: 302,
            }),
    });
    assert.equal((await looping(request())).status, 502);

    for (const status of [401, 403, 404, 429, 500, 503]) {
        const h = createHandler({
            fetchImpl: async () =>
                new Response("private upstream detail", { status }),
        });
        response = await h(request());
        assert.equal(response.status, status === 404 ? 404 : 502);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert(!(await response.text()).includes("private upstream detail"));
    }
    for (const body of [
        "",
        "not-json",
        "<html>error</html>",
        "null",
        "[]",
        Buffer.from([0xff]),
    ]) {
        const h = createHandler({ fetchImpl: async () => new Response(body) });
        assert.equal((await h(request())).status, 502);
    }
    const misleadingSize = createHandler({
        fetchImpl: async () =>
            new Response(json, {
                headers: { "Content-Length": String(MAX_BYTES + 1) },
            }),
    });
    assert.equal((await misleadingSize(request())).status, 502);
    let cancelled = false;
    const oversized = createHandler({
        fetchImpl: async () =>
            new Response(
                new ReadableStream({
                    cancel() {
                        cancelled = true;
                    },
                    start(controller) {
                        controller.enqueue(new Uint8Array(MAX_BYTES));
                        controller.enqueue(new Uint8Array(1));
                    },
                })
            ),
    });
    assert.equal((await oversized(request())).status, 502);
    assert.equal(cancelled, true, "Oversized body must be cancelled");
    const badIcon = createHandler({
        fetchImpl: async () => new Response("not a PNG"),
    });
    assert.equal(
        (await badIcon(request("ottplay-foss-webos-icon.png"))).status,
        502
    );

    let signal;
    const hungFetch = createHandler({
        deadlineMs: 10,
        fetchImpl: (_url, init) => {
            signal = init.signal;
            return new Promise(() => {});
        },
    });
    response = await hungFetch(request());
    assert.equal(response.status, 504);
    assert.equal(signal.aborted, true);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    let cancelledHungBody = false;
    const hungBody = createHandler({
        deadlineMs: 10,
        fetchImpl: async () =>
            new Response(
                new ReadableStream({
                    cancel() {
                        cancelledHungBody = true;
                    },
                })
            ),
    });
    response = await hungBody(request());
    assert.equal(response.status, 504);
    assert.equal(cancelledHungBody, true);
    assert.throws(() => createHandler({ deadlineMs: 0 }));
    assert.throws(() => createHandler({ deadlineMs: 10001 }));
    console.log(
        "PASS webOS feed Worker: exact bytes, CORS, fixed destinations, no credentials, redirect/size/deadline limits, no-store failures"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
