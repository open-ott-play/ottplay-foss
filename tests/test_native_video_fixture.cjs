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
const {
    cases,
    pageStartupDiagnostic,
    redactDiagnosticText,
    validateCaptureInterval,
} = require("../scripts/check-windows-video-geometry.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("capture guard rejects a later same-color cycle and slow or reversed intervals", () => {
    validateCaptureInterval(0.5, 0.7, 0);
    validateCaptureInterval(2.0, 2.2, 1);
    for (const args of [
        [0.5, 3.5, 0],
        [1.95, 5.0, 1],
        [3.5, 3.6, 0],
        [2.0, 3.0, 1],
        [0.7, 0.5, 0],
        [NaN, 0.5, 0],
    ])
        assert.throws(
            () => validateCaptureInterval(...args),
            /absolute initial phase/
        );
});

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

test("failure summaries remove URL credentials and respect their output bound", () => {
    const failure = new Error(
        "Request https://person:private-password@private.invalid/path?token=private-key failed at D:\\a\\private\\client.js"
    );
    const output = redactDiagnosticText(failure.stack, 160);
    assert.ok(output.length <= 160);
    for (const privateValue of [
        "private-password",
        "private.invalid",
        "private-key",
        "D:\\a",
    ])
        assert.equal(output.includes(privateValue), false);
});

test("startup diagnostics retain fixture state without body, list or source secrets", async () => {
    const origin = "http://127.0.0.1:8443";
    const id = "abcdef1234";
    const secret = "do-not-publish-this-private-token";
    const source = origin + "/__native_video_geometry/wide.mp4?case=" + id;
    const launch = {
        getBoundingClientRect: () => ({ height: 450, width: 800 }),
        innerText:
            "Startup failed at https://private.invalid/path?token=" + secret,
    };
    const list = {
        getBoundingClientRect: () => ({ height: 300, width: 300 }),
        get innerText() {
            throw new Error("Do not collect list contents");
        },
    };
    const video = {
        currentSrc: "",
        currentTime: 0,
        error: null,
        getAttribute: () => source,
        networkState: 2,
        paused: true,
        readyState: 0,
        src: source,
        videoHeight: 0,
        videoWidth: 0,
    };
    const stored = new Map([
        ["ottplaylang", "_eng"],
        ["ottplayprov", "m3u"],
        [
            "m3um3uArr",
            JSON.stringify({
                active: 0,
                M3Us: [
                    {
                        www:
                            origin +
                            "/__native_video_geometry/channels.m3u?case=" +
                            id,
                    },
                ],
            }),
        ],
    ]);
    const scope = {
        clearTimeout,
        document: {
            get body() {
                throw new Error("Do not collect page contents");
            },
            querySelector: (selector) =>
                selector === "#video"
                    ? video
                    : selector === "#launch"
                      ? launch
                      : selector === "#list"
                        ? list
                        : null,
            readyState: "complete",
            title: "Fixture",
            visibilityState: "visible",
        },
        getComputedStyle: () => ({
            display: "block",
            opacity: "1",
            visibility: "visible",
        }),
        localStorage: { getItem: (key) => stored.get(key) || null },
        location: {
            href: origin + "/index.html?nativecase=" + id,
            origin,
            pathname: "/index.html",
            search: "?nativecase=" + id,
        },
        performance: {
            getEntriesByType: () => [
                {
                    name: origin + "/asset.js?token=" + secret,
                    responseStatus: 404,
                },
                {
                    name: "https://private.invalid/" + secret,
                    responseStatus: 400,
                },
            ],
        },
        setTimeout,
        URL,
        URLSearchParams,
        window: {
            __nativeGeometryEvents: [
                {
                    kind: "loadstart",
                    source: "https://private.invalid/" + secret,
                },
            ],
            __ottActiveProviderDriver: { id: "m3u" },
            __ottStandby: {
                blocked: () => true,
                generation: () => 0,
                snapshot: () => ({ pending: null, state: "error" }),
            },
            cList: [],
            commandChannelsReady: false,
            ott_device: "pc",
            playerMode: 0,
        },
    };
    const page = {
        evaluate: (fn, args) => {
            scope.args = args;
            return vm.runInNewContext("(" + fn.toString() + ")(args)", scope);
        },
        isClosed: () => false,
    };
    const result = await pageStartupDiagnostic(page, origin, id);
    assert.equal(result.status, "captured");
    assert.equal(result.standby.blocked, true);
    assert.equal(result.runtime.seededM3uValid, true);
    const output = JSON.stringify(result);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("private.invalid"), false);
    assert.equal(output.includes("visibleText"), false);
    assert.equal(output.includes(source), false);
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
        assert.equal((await fetch(origin + "/index.html")).status, 400);
        const guide = await fetch(
            origin + "/__native_video_geometry/guide.xml"
        );
        assert.equal(guide.status, 200);
        assert.equal(guide.headers.get("content-type"), "application/xml");
        const guideBody = await guide.text();
        assert.ok(guideBody.includes('<channel id="native-geometry">'));
        assert.ok(
            guideBody.includes(
                "<display-name>Native geometry fixture</display-name>"
            )
        );
        assert.equal(guideBody.includes("http:"), false);
        assert.equal(guideBody.includes("https:"), false);
        let bootResolved = false;
        const pendingPage = fetch(origin + "/index.html?nativecase=" + caseId, {
            signal: AbortSignal.timeout(5000),
        }).then(async (response) => {
            bootResolved = true;
            return response.text();
        });
        await pause(100);
        assert.equal(
            bootResolved,
            false,
            "startup must wait for cold CDP fencing"
        );
        await fetch(
            origin + "/__native_video_geometry/boot-admit?case=0000000000"
        );
        await pause(100);
        assert.equal(
            bootResolved,
            false,
            "another case cannot start this page"
        );
        assert.deepEqual(
            await (
                await fetch(
                    origin +
                        "/__native_video_geometry/boot-admit?case=" +
                        caseId
                )
            ).json(),
            { bootAdmitted: caseId }
        );
        const html = await pendingPage;
        const items = new Map();
        const scope = {
            document: { addEventListener() {} },
            localStorage: { setItem: (k, v) => items.set(k, v) },
            location: {
                href: origin + "/index.html?nativecase=" + caseId,
                origin,
            },
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
