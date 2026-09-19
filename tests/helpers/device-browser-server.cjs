// Serve the production build using the same URL layout as the Mode A package.
// Only staged public assets are exposed; source, operator settings and .git
// are never served. No real provider/backend or external network is needed.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const dist = path.resolve(__dirname, "../../dist");
const port = Number(process.env.OTTP_DEVICE_TEST_PORT || 4179);
const diagnostics = process.env.OTTP_DEVICE_TEST_DIAGNOSTICS === "1";
const diagnosticScript = diagnostics
    ? fs.readFileSync(
          path.join(__dirname, "device-browser-diagnostics.js"),
          "utf8"
      )
    : "";
for (const filename of ["index.html", "stbPlayer.js"]) {
    if (!fs.existsSync(path.join(dist, filename))) {
        throw new Error(
            "Missing dist/" + filename + "; run npm run build first."
        );
    }
}

const types = {
    ".css": "text/css",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".webmanifest": "application/manifest+json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

http.createServer((request, response) => {
    let pathname;
    let url;
    try {
        url = new URL(request.url, "http://localhost");
        pathname = decodeURIComponent(url.pathname);
    } catch (_) {
        response.writeHead(400).end();
        return;
    }
    // Log only route classes, never playlist bodies, channel IDs or query data.
    if (diagnostics) {
        const epgRoute = /^\/m3u\/(?:match-channels|match-logos|cp\.php)$/.test(
            pathname
        )
            ? pathname
            : pathname.startsWith("/epg/")
              ? "/epg/:channel"
              : "";
        if (epgRoute)
            response.on("finish", () => {
                console.log(
                    "Device EPG request: " +
                        request.method +
                        " " +
                        epgRoute +
                        " -> " +
                        response.statusCode
                );
            });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
    }
    if (diagnostics && pathname === "/__device_test_runtime") {
        try {
            const raw = url.searchParams.get("data") || "";
            if (raw.length > 4096)
                throw new Error("Diagnostic payload too large");
            const input = JSON.parse(raw);
            const snapshot = {};
            for (const name of ["device", "userAgent"]) {
                if (typeof input[name] === "string")
                    snapshot[name] = input[name].slice(
                        0,
                        name === "device" ? 64 : 512
                    );
            }
            for (const name of ["left", "right", "back", "alFun", "arFun"]) {
                if (
                    typeof input[name] === "number" &&
                    Number.isFinite(input[name])
                )
                    snapshot[name] = input[name];
            }
            console.log("Device runtime: " + JSON.stringify(snapshot));
            response.writeHead(204).end();
        } catch (_) {
            response.writeHead(400).end();
        }
        return;
    }
    if (
        pathname === "/__device_test_health" ||
        pathname === "/local/swop.json"
    ) {
        response
            .writeHead(200, { "Content-Type": "application/json" })
            .end("{}");
        return;
    }
    let relative;
    if (
        pathname === "/" ||
        pathname === "/index.html" ||
        pathname.startsWith("/f/")
    ) {
        relative = pathname.endsWith("/favicon.ico")
            ? "favicon.ico"
            : "index.html";
    } else if (pathname === "/dist/stbPlayer.js") {
        relative = "stbPlayer.js";
    } else if (
        /^\/(?:fonts|js|stb|stbPlayer|prov)\//.test(pathname) ||
        pathname === "/favicon.ico"
    ) {
        relative = pathname.slice(1);
    } else {
        response.writeHead(404).end();
        return;
    }
    const filename = path.resolve(dist, relative);
    if (!filename.startsWith(dist + path.sep)) {
        response.writeHead(403).end();
        return;
    }
    fs.readFile(filename, (error, bytes) => {
        if (error) {
            response.writeHead(404).end();
            return;
        }
        if (diagnostics && relative === "index.html") {
            bytes = Buffer.from(
                bytes
                    .toString("utf8")
                    .replace(
                        "</body>",
                        "<script>\n" + diagnosticScript + "\n</script>\n</body>"
                    )
            );
        }
        response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type":
                types[path.extname(filename)] || "application/octet-stream",
        });
        response.end(request.method === "HEAD" ? undefined : bytes);
    });
}).listen(port, "127.0.0.1", () => {
    console.log("Device browser test server: http://127.0.0.1:" + port);
});
