// Test-only hosted launcher: exercise automatic detection at the server root.
// The vendor SDK is installed separately; no SDK files or product IPK are built.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "build/device-webos-simulator");
const port = Number(process.env.OTTP_DEVICE_TEST_PORT || 4179);
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("OTTP_DEVICE_TEST_PORT must be a valid TCP port");
if (!fs.existsSync(path.join(root, "dist/stbPlayer.js")))
    throw new Error("Run npm run build first");
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(
    path.join(destination, "appinfo.json"),
    JSON.stringify(
        {
            disableBackHistoryAPI: true,
            icon: "icon.png",
            id: "com.openottplay.devicedetection",
            main: "index.html",
            title: "OTT device detection test",
            type: "web",
            vendor: "open-ott-play",
            version: "0.0.1",
        },
        null,
        2
    ) + "\n"
);
fs.copyFileSync(
    path.join(root, "stbPlayer/icon.png"),
    path.join(destination, "icon.png")
);
fs.writeFileSync(
    path.join(destination, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>OTT device test</title></head>' +
        '<body><script>location.replace("http://127.0.0.1:' +
        port +
        '/");</script></body></html>\n'
);
console.log("Simulator app directory: " + destination);
console.log("Player target: http://127.0.0.1:" + port + "/");
console.log(
    "Use ottplay-server for EPG, or the static device-browser-server.cjs for detection/button checks only."
);
console.log(
    "Then use the LG Simulator File > Launch App menu to select this directory."
);
