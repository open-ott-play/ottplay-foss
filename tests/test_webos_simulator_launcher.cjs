// Exercise the real shell launcher with a local HTTP companion and a fake CLI.
// Vendor software is not installed or started by this test.
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const exec = promisify(execFile);
const root = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "ottplay webos launcher ")
);
const capture = path.join(fixture, "cli args.json");
const sdk = path.join(fixture, "SDK with spaces");
const cli = path.join(fixture, "ares launch");
const app = path.join(fixture, "build/device-webos-simulator");
const script = path.join(fixture, "scripts/run-webos-simulator.sh");
const env = { ...process.env, CAPTURE_FILE: capture };
for (const key of [
    "WEBOS_VERSION",
    "WEBOS_SDK_PATH",
    "WEBOS_CLI",
    "OTTP_PLAYER_URL",
    "OTTP_DEVICE_TEST_PORT",
])
    delete env[key];
env.WEBOS_CLI = cli;
for (const file of [
    "scripts/run-webos-simulator.sh",
    "scripts/prepare-webos-simulator.cjs",
    "stbPlayer/icon.png",
]) {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
}
fs.mkdirSync(sdk);
fs.writeFileSync(
    cli,
    '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.CAPTURE_FILE, JSON.stringify(process.argv.slice(2)));\n',
    { mode: 0o755 }
);

async function run(args, extraEnv = {}) {
    return exec("bash", [script, ...args], {
        env: { ...env, ...extraEnv },
        timeout: 15000,
    });
}
async function rejects(args, pattern) {
    await assert.rejects(run(args), (error) => pattern.test(error.stderr));
    assert(!fs.existsSync(capture), "Failed preflight must not launch the SDK");
}

let healthStatus = 200;
const requests = [];
const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(request.url === "/health" ? healthStatus : 200);
    response.end(
        request.url === "/health"
            ? "ok"
            : "<!doctype html><title>Player</title>"
    );
});

(async () => {
    try {
        const help = await run(["--help"]);
        assert(help.stdout.includes("8095"));
        await run(["--dry-run"]);
        assert(
            fs
                .readFileSync(path.join(app, "index.html"), "utf8")
                .includes('location.replace("http://127.0.0.1:8095/")')
        );
        assert(!fs.existsSync(capture));
        assert(
            !fs.existsSync(path.join(fixture, "dist")),
            "Hosted launcher needs no local build"
        );
        await run(["--dry-run"], { OTTP_DEVICE_TEST_PORT: "4179" });
        assert(
            fs
                .readFileSync(path.join(app, "index.html"), "utf8")
                .includes("127.0.0.1:4179")
        );
        await run(
            [
                "--dry-run",
                "--url",
                "http://localhost:8095/?q=</script><script>",
            ],
            { OTTP_DEVICE_TEST_PORT: "invalid" }
        );
        assert.equal(
            (
                fs
                    .readFileSync(path.join(app, "index.html"), "utf8")
                    .match(/<\/script>/g) || []
            ).length,
            1
        );
        await rejects(
            ["--url", "file:///etc/passwd", "--dry-run"],
            /HTTP\(S\)/
        );
        await rejects(
            ["--url", "http://user:secret@localhost/", "--dry-run"],
            /without credentials/
        );
        await rejects(
            ["--version", "26;echo injected", "--dry-run"],
            /positive integer/
        );
        await rejects(["--url"], /requires a value/);
        await rejects(["--unknown"], /Unknown option/);

        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const origin = "http://127.0.0.1:" + server.address().port;
        const args = [
            "--url",
            origin + "/f/lg/webos/?config[provider]=m3u",
            "--sdk",
            sdk,
            "--version",
            "25",
        ];
        await run(args);
        assert.deepEqual(JSON.parse(fs.readFileSync(capture, "utf8")), [
            "-s",
            "25",
            "-sp",
            sdk,
            app,
        ]);
        assert.deepEqual(requests, [
            "/health",
            "/f/lg/webos/?config[provider]=m3u",
        ]);
        fs.unlinkSync(capture);
        healthStatus = 503;
        await rejects(args, /companion is unavailable/);
        await new Promise((resolve) => server.close(resolve));
        await rejects(args, /companion is unavailable/);
        console.log(
            "PASS webOS shell launcher: existing stack, exact CLI arguments, offline preparation, URL validation and failed preflight"
        );
    } finally {
        server.close();
        fs.rmSync(fixture, { force: true, recursive: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
