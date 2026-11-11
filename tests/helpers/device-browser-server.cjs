// Serve the production build using the same URL layout as the Mode A package.
// Only staged public assets are exposed; source, operator settings and .git
// are never served. No real provider/backend or external network is needed.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
    CLASSIC_PROVIDER_BUNDLES,
    CLASSIC_OPTIONAL_BUNDLES,
} = require("../../scripts/classic-bundle.cjs");
const playerScripts = new Set([
    "player.js",
    ...Object.keys(CLASSIC_OPTIONAL_BUNDLES).map((name) => name + ".js"),
    ...Object.keys(CLASSIC_PROVIDER_BUNDLES).map(
        (kind) => "provider-" + kind + ".js"
    ),
]);

const packaged = !!process.env.CI_BROWSER_WEB_ROOT;
const dist = packaged
    ? path.resolve(process.env.CI_BROWSER_WEB_ROOT)
    : path.resolve(__dirname, "../../dist");
function playerPath(filename) {
    return packaged && playerScripts.has(filename)
        ? "dist/" + filename
        : filename;
}
const port = Number(process.env.OTTP_DEVICE_TEST_PORT || 4179);
const diagnostics = process.env.OTTP_DEVICE_TEST_DIAGNOSTICS === "1";
const nativeGeometry = process.env.OTTP_NATIVE_VIDEO_GEOMETRY === "1";
let aspectFixture;
const nativeAdmissions = new Set();
const pendingNativeMedia = new Map();
const nativeBootAdmissions = new Set();
const pendingNativeBoot = new Map();
function aspectMedia() {
    if (!aspectFixture) {
        aspectFixture =
            require("./hls-aspect-fixture.cjs").createHlsAspectFixture(
                fs.readFileSync(
                    path.join(
                        __dirname,
                        "../fixtures/media-runtime/segment00.ts"
                    )
                )
            );
    }
    return aspectFixture;
}
const diagnosticScript = diagnostics
    ? fs.readFileSync(
          path.join(__dirname, "device-browser-diagnostics.js"),
          "utf8"
      )
    : "";
for (const filename of ["index.html", ...playerScripts]) {
    if (!fs.existsSync(path.join(dist, playerPath(filename)))) {
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
    // This isolated fixture reports route classes, never request queries or bodies.
    if (nativeGeometry) {
        let route = "asset";
        if (pathname === "/index.html") route = "index";
        else if (pathname === "/dist/player.js") route = "player";
        else if (pathname === "/__native_video_geometry/guide.xml")
            route = "guide";
        else if (/^\/devices\/[^/]+\/device\.js$/.test(pathname))
            route = "device";
        else if (pathname === "/__native_video_geometry/channels.m3u")
            route = "playlist";
        else if (
            /^\/__native_video_geometry\/(wide|standard)\.mp4$/.test(pathname)
        )
            route = "media";
        else if (pathname === "/__native_video_geometry/admit")
            route = "admission";
        if (route !== "asset") console.log("Native fixture request: " + route);
        response.on("finish", () => {
            if (route !== "asset" || response.statusCode >= 400)
                console.log(
                    "Native fixture route: " +
                        route +
                        " -> " +
                        response.statusCode
                );
        });
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
    if (nativeGeometry && pathname === "/__native_video_geometry/guide.xml") {
        response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "application/xml",
        });
        response.end(
            '<?xml version="1.0" encoding="UTF-8"?><tv><channel id="native-geometry"><display-name>Native geometry fixture</display-name></channel></tv>'
        );
        return;
    }
    const nativeCase = url.searchParams.get("case");
    const validNativeCase = /^[a-f0-9]{10}$/.test(nativeCase || "");
    if (
        nativeGeometry &&
        pathname === "/__native_video_geometry/boot-admit" &&
        validNativeCase
    ) {
        nativeBootAdmissions.add(nativeCase);
        const pending = pendingNativeBoot.get(nativeCase) || new Set();
        for (const send of pending) send();
        pendingNativeBoot.delete(nativeCase);
        response
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ bootAdmitted: nativeCase }));
        return;
    }
    if (
        nativeGeometry &&
        pathname === "/__native_video_geometry/channels.m3u" &&
        validNativeCase
    ) {
        response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "audio/x-mpegurl",
        });
        response.end(
            "#EXTM3U\n#EXTINF:-1,Native geometry fixture\nhttp://127.0.0.1:" +
                port +
                "/__native_video_geometry/wide.mp4?case=" +
                nativeCase +
                "\n"
        );
        return;
    }
    if (
        nativeGeometry &&
        pathname === "/__native_video_geometry/admit" &&
        validNativeCase
    ) {
        nativeAdmissions.add(nativeCase);
        const pending = pendingNativeMedia.get(nativeCase) || new Set();
        for (const send of pending) send();
        pendingNativeMedia.delete(nativeCase);
        response
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ admitted: nativeCase }));
        return;
    }
    if (/^\/__native_video_geometry\/(wide|standard)\.mp4$/.test(pathname)) {
        if (nativeGeometry && !validNativeCase) {
            response.writeHead(400).end();
            return;
        }
        const bytes = fs.readFileSync(
            path.join(
                __dirname,
                "../fixtures/windows-video-geometry",
                path.basename(pathname)
            )
        );
        const send = () => {
            clearTimeout(timer);
            pendingNativeMedia.get(nativeCase)?.delete(send);
            if (response.destroyed) return;
            response.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Length": bytes.length,
                "Content-Type": "video/mp4",
            });
            response.end(request.method === "HEAD" ? undefined : bytes);
        };
        let timer;
        if (
            nativeGeometry &&
            validNativeCase &&
            !nativeAdmissions.has(nativeCase)
        ) {
            const pending = pendingNativeMedia.get(nativeCase) || new Set();
            pendingNativeMedia.set(nativeCase, pending);
            pending.add(send);
            timer = setTimeout(() => {
                pending.delete(send);
                response.writeHead(504).end();
            }, 60000);
            response.on("close", () => {
                clearTimeout(timer);
                pending.delete(send);
            });
        } else send();
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
    // Native WebKit media requests can bypass Playwright route interception.
    // Serve only the checked-in synthetic HLS fixture for real decoder tests.
    const plexFixture = pathname === "/video/:/transcode/universal/start.m3u8";
    if (
        plexFixture ||
        /^\/__device_test_media\/(audio|video)(\.m3u8|-init\.mp4|-segment\.m4s)$/.test(
            pathname
        )
    ) {
        response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": pathname.endsWith(".m3u8")
                ? "application/vnd.apple.mpegurl"
                : pathname.includes("/audio-")
                  ? "audio/mp4"
                  : "video/mp4",
        });
        let fixture;
        if (plexFixture)
            fixture =
                '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Synthetic audio",DEFAULT=YES,AUTOSELECT=YES,URI="/__device_test_media/audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2",AUDIO="audio"\n/__device_test_media/video.m3u8\n';
        else fixture = aspectMedia()[path.basename(pathname)];
        response.end(fixture);
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
    } else if (
        pathname.startsWith("/dist/") &&
        playerScripts.has(pathname.slice(6))
    ) {
        relative = playerPath(pathname.slice(6));
    } else if (
        /^\/(?:fonts|js|devices|providers|styles|images|locales)\//.test(
            pathname
        ) ||
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
        if (nativeGeometry && relative === "index.html") {
            if (
                !/^[a-f0-9]{10}$/.test(url.searchParams.get("nativecase") || "")
            ) {
                response.writeHead(400).end();
                return;
            }
            // Test-only state seeding before the first production script runs.
            // No DOM sizing, media methods, engine or native host is replaced.
            bytes = Buffer.from(
                bytes
                    .toString("utf8")
                    .replace(
                        "<head>",
                        '<head><script>localStorage.setItem("ottplaylang","_eng");' +
                            'localStorage.setItem("ottplayprov","m3u");' +
                            'localStorage.setItem("sInfoSwitch","0");localStorage.setItem("sInfoChange","0");' +
                            'localStorage.setItem("m3um3uArr",JSON.stringify({active:0,M3Us:[{www:location.origin+"/__native_video_geometry/channels.m3u?case="+new URL(location.href).searchParams.get("nativecase")}]}));' +
                            'window.__nativeGeometryEvents=[];for(const kind of ["loadstart","loadeddata","playing"])document.addEventListener(kind,e=>{if(e.target.tagName==="VIDEO")window.__nativeGeometryEvents.push({kind,source:e.target.currentSrc});},true);' +
                            "</script>"
                    )
            );
        }
        let bootTimer;
        const bootCase = url.searchParams.get("nativecase");
        const sendPage = () => {
            clearTimeout(bootTimer);
            pendingNativeBoot.get(bootCase)?.delete(sendPage);
            if (response.destroyed) return;
            response.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Type":
                    types[path.extname(filename)] || "application/octet-stream",
            });
            response.end(request.method === "HEAD" ? undefined : bytes);
        };
        if (
            nativeGeometry &&
            relative === "index.html" &&
            !nativeBootAdmissions.has(bootCase)
        ) {
            // Install CDP fencing before normal startup creates AJAX requests.
            // Release this first response once; never reload/restart the player.
            const pending = pendingNativeBoot.get(bootCase) || new Set();
            pendingNativeBoot.set(bootCase, pending);
            pending.add(sendPage);
            bootTimer = setTimeout(() => {
                pending.delete(sendPage);
                response.writeHead(504).end();
            }, 60000);
            response.on("close", () => {
                clearTimeout(bootTimer);
                pending.delete(sendPage);
            });
        } else sendPage();
    });
}).listen(port, "127.0.0.1", () => {
    console.log("Device browser test server: http://127.0.0.1:" + port);
});
