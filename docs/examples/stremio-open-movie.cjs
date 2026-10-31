#!/usr/bin/env node
"use strict";

// JSON-only qualification addon. Video and artwork stay on Blender's servers.
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const MOVIE_ID = "ottplay:big-buck-bunny";
const MEDIA_URL =
    "https://video.blender.org/object-storage/web_videos/bf1f3fb5-b119-4f9f-9930-8e20e892b898-720.mp4";
const MOVIE = {
    description:
        "Big Buck Bunny (2008), an animated short by the Blender Foundation. " +
        "Licensed under CC BY 3.0: https://creativecommons.org/licenses/by/3.0/ " +
        "Official film and attribution: https://peach.blender.org/about/",
    genres: ["Animation"],
    id: MOVIE_ID,
    name: "Big Buck Bunny",
    poster: "https://video.blender.org/lazy-static/thumbnails/bf1f3fb5-b119-4f9f-9930-8e20e892b898.jpg",
    posterShape: "landscape",
    releaseInfo: "2008",
    runtime: "10 min",
    type: "movie",
};
const MANIFEST = {
    catalogs: [
        {
            extra: [{ name: "search" }, { name: "skip" }],
            id: "open-movies",
            name: "Blender open movie",
            type: "movie",
        },
    ],
    description:
        "One-film qualification addon: Big Buck Bunny, Blender Foundation, CC BY 3.0. No video is hosted or proxied here.",
    id: "org.ottplay.examples.openmovie",
    idPrefixes: ["ottplay:"],
    name: "Big Buck Bunny qualification",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    version: "1.0.0",
};

function response(pathname, mediaUrl) {
    if (pathname === "/manifest.json") return [200, MANIFEST];
    const catalog = /^\/catalog\/movie\/open-movies(?:\/([^/]*))?\.json$/.exec(
        pathname
    );
    if (catalog) {
        const extra = new URLSearchParams(catalog[1] || "");
        for (const key of extra.keys()) {
            if (
                !["search", "skip"].includes(key) ||
                extra.getAll(key).length !== 1
            )
                return [400, { error: "Invalid catalog parameters" }];
        }
        const skip = extra.get("skip") || "0";
        if (!/^(0|[1-9][0-9]{0,4})$/.test(skip))
            return [400, { error: "Invalid offset" }];
        const query = (extra.get("search") || "").trim().toLowerCase();
        const matches = MOVIE.name.toLowerCase().includes(query);
        return [200, { metas: skip === "0" && matches ? [MOVIE] : [] }];
    }
    const resource = /^\/(meta|stream)\/movie\/([^/]+)\.json$/.exec(pathname);
    if (resource) {
        let id;
        try {
            id = decodeURIComponent(resource[2]);
        } catch (_) {
            return [400, { error: "Invalid movie identifier" }];
        }
        if (resource[1] === "meta")
            return [200, { meta: id === MOVIE_ID ? MOVIE : null }];
        return [
            200,
            {
                streams:
                    id === MOVIE_ID
                        ? [
                              {
                                  description: "Blender Foundation · CC BY 3.0",
                                  name: "Big Buck Bunny · HTTPS MP4",
                                  url: mediaUrl,
                              },
                          ]
                        : [],
            },
        ];
    }
    return [404, { error: "Not found" }];
}

function createDemoServer({ cert, key, mediaUrl = MEDIA_URL } = {}) {
    if (!!cert !== !!key)
        throw new Error("Supply both TLS certificate and key");
    const media = new URL(mediaUrl);
    if (
        media.protocol !== "https:" ||
        media.username ||
        media.password ||
        media.hash
    )
        throw new Error(
            "Media URL must use HTTPS without credentials or a fragment"
        );
    function handler(req, res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        let result;
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.setHeader("Allow", "GET, HEAD, OPTIONS");
            result = [405, { error: "Method not allowed" }];
        } else if (!req.url || req.url.length > 4096) {
            result = [414, { error: "Request URL too long" }];
        } else {
            try {
                result = response(
                    new URL(req.url, "http://localhost").pathname,
                    mediaUrl
                );
            } catch (_) {
                result = [400, { error: "Invalid request" }];
            }
        }
        const body = JSON.stringify(result[1]);
        res.setHeader("Content-Length", Buffer.byteLength(body));
        res.writeHead(result[0]);
        res.end(req.method === "HEAD" ? undefined : body);
    }
    const server = cert
        ? https.createServer(
              { cert: fs.readFileSync(cert), key: fs.readFileSync(key) },
              handler
          )
        : http.createServer(handler);
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    return server;
}

function main(args = process.argv.slice(2), env = process.env) {
    const options = {
        cert: env.OTT_OPEN_MOVIE_TLS_CERT || "",
        host: env.OTT_OPEN_MOVIE_HOST || "127.0.0.1",
        key: env.OTT_OPEN_MOVIE_TLS_KEY || "",
        mediaUrl: env.OTT_OPEN_MOVIE_MEDIA_URL || MEDIA_URL,
        port: env.OTT_OPEN_MOVIE_PORT || "8794",
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--help") {
            console.log(
                "Usage: node stremio-open-movie.cjs [--host ADDRESS] [--port PORT] [--cert FILE --key FILE] [--media-url HTTPS_URL]"
            );
            return;
        }
        const name = args[i] === "--media-url" ? "mediaUrl" : args[i].slice(2);
        if (
            !args[i].startsWith("--") ||
            !Object.hasOwn(options, name) ||
            !args[i + 1]
        )
            throw new Error("Unknown or incomplete option");
        options[name] = args[++i];
    }
    if (!/^[0-9]{1,5}$/.test(options.port) || Number(options.port) > 65535)
        throw new Error("Invalid port");
    const server = createDemoServer(options);
    server.on("error", (error) => {
        console.error("Demo addon failed: " + (error.code || "server error"));
        process.exitCode = 1;
    });
    server.listen(Number(options.port), options.host, () => {
        const host = options.host.includes(":")
            ? "[" + options.host + "]"
            : options.host;
        console.log(
            "Open movie addon: " +
                (options.cert ? "https" : "http") +
                "://" +
                host +
                ":" +
                server.address().port +
                "/manifest.json"
        );
    });
    const stop = () => {
        server.close();
        server.closeIdleConnections();
        setTimeout(() => server.closeAllConnections(), 1000).unref();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
}

module.exports = { createDemoServer, MEDIA_URL, MOVIE_ID, main };
if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
