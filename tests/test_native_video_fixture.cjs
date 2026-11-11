const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const {
    CLASSIC_PROVIDER_BUNDLES,
    CLASSIC_OPTIONAL_BUNDLES,
} = require("../scripts/classic-bundle.cjs");
const { cases } = require("../scripts/check-windows-video-geometry.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("native matrix includes exact locked/unlocked starts and all one-pixel controls", () => {
    const matrix = cases();
    assert.equal(matrix.length, 12);
    assert.equal(matrix.filter((item) => item.lock).length, 2);
    for (const [width, height] of [
        [800, 450],
        [1280, 720],
    ]) {
        assert.deepEqual(
            matrix
                .filter((x) => x.width === width && x.height === height)
                .map((x) => x.lock),
            [false, true]
        );
        for (const [w, h] of [
            [width - 1, height],
            [width + 1, height],
            [width, height - 1],
            [width, height + 1],
        ])
            assert.deepEqual(
                matrix.filter((x) => x.width === w && x.height === h),
                [{ height: h, lock: false, width: w }]
            );
    }
});

test("first native media remains undecodable until owned cold-capture admission", {
    timeout: 10000,
}, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-video-server-"));
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(
        path.join(root, "index.html"),
        "<html><head></head><body></body></html>"
    );
    const scripts = [
        "player",
        ...Object.keys(CLASSIC_OPTIONAL_BUNDLES),
        ...Object.keys(CLASSIC_PROVIDER_BUNDLES).map(
            (name) => "provider-" + name
        ),
    ];
    for (const name of scripts)
        fs.writeFileSync(path.join(root, "dist", name + ".js"), "");
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const origin = "http://127.0.0.1:" + port;
    const child = spawn(
        process.execPath,
        [path.join(__dirname, "helpers/device-browser-server.cjs")],
        {
            env: {
                ...process.env,
                CI_BROWSER_WEB_ROOT: root,
                OTTP_DEVICE_TEST_PORT: String(port),
                OTTP_NATIVE_VIDEO_GEOMETRY: "1",
            },
            stdio: "ignore",
        }
    );
    const caseId = "abcdef1234";
    try {
        let ready = false;
        for (let n = 0; n < 50; n++) {
            try {
                ready = (await fetch(origin + "/__device_test_health")).ok;
            } catch (_) {}
            if (ready) break;
            await pause(50);
        }
        assert.ok(ready, "owned fixture server must become ready");
        const html = await (
            await fetch(origin + "/f/pc/?nativecase=" + caseId)
        ).text();
        const items = new Map();
        const scope = {
            document: { addEventListener() {} },
            localStorage: { setItem: (k, v) => items.set(k, v) },
            location: { href: origin + "/f/pc/?nativecase=" + caseId, origin },
            URL,
            window: {},
        };
        // Extract our known generated bootstrap; this is not an HTML filter.
        const start = html.indexOf("<script>");
        const end = html.indexOf("</script>", start);
        assert.ok(start >= 0 && end > start, "generated bootstrap is present");
        vm.runInNewContext(html.slice(start + "<script>".length, end), scope);
        assert.equal(items.get("ottplayprov"), "m3u");
        assert.equal(items.get("sInfoSwitch"), "0");
        assert.equal(items.get("sInfoChange"), "0");
        const playlist = JSON.parse(items.get("m3um3uArr")).M3Us[0].www;
        const body = await (await fetch(playlist)).text();
        const media = body.trim().split("\n").at(-1);
        assert.equal(
            media,
            origin + "/__native_video_geometry/wide.mp4?case=" + caseId
        );
        assert.equal(
            (await fetch(origin + "/__native_video_geometry/wide.mp4")).status,
            400
        );
        let resolved = false;
        const pending = fetch(media, {
            signal: AbortSignal.timeout(5000),
        }).then(async (r) => {
            resolved = true;
            return Buffer.from(await r.arrayBuffer());
        });
        await pause(150);
        assert.equal(
            resolved,
            false,
            "no first decoder bytes may escape before admission"
        );
        await fetch(origin + "/__native_video_geometry/admit?case=0000000000");
        await pause(150);
        assert.equal(
            resolved,
            false,
            "another process case must not admit this first frame"
        );
        assert.deepEqual(
            await (
                await fetch(
                    origin + "/__native_video_geometry/admit?case=" + caseId
                )
            ).json(),
            { admitted: caseId }
        );
        assert.deepEqual(
            await pending,
            fs.readFileSync(
                path.join(__dirname, "fixtures/windows-video-geometry/wide.mp4")
            )
        );
    } finally {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
        fs.rmSync(root, { force: true, recursive: true });
    }
});
