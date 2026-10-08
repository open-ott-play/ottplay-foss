// Production bundle/dispatcher, real owned playback and real Chromium CSS.
// Synthetic local media only; no capture permission, device or controller.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { test, expect } = require("@playwright/test");

const mediaRoot = path.resolve(__dirname, "../fixtures/media-runtime");
const dist = path.resolve(__dirname, "../../dist");
const SECRET = "DOCTOR_FIXTURE_PRIVATE_VALUE";
test.use({
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

async function fixture(page, context, baseURL) {
    const origin = new URL(baseURL).origin;
    const errors = [];
    const requests = [];
    const manifest = {
        buildId: "wrong-build",
        revision: "f".repeat(40),
        version: "0.0.0-wrong",
    };
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) =>
        requests.push(new URL(request.url()).pathname)
    );
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort("blockedbyclient");
        if (url.pathname.endsWith("/build-info.json"))
            return route.fulfill({ json: manifest });
        if (url.pathname === "/doctor-fixture/channels.m3u")
            return route.fulfill({
                body:
                    '#EXTM3U\n#EXTINF:-1 group-title="Doctor fixture",' +
                    SECRET +
                    "\n" +
                    origin +
                    "/doctor-fixture/index.m3u8?token=" +
                    SECRET +
                    "\n",
                contentType: "text/plain",
            });
        if (url.pathname.startsWith("/doctor-fixture/")) {
            const segment = url.pathname.endsWith(".ts");
            return route.fulfill({
                body: fs.readFileSync(
                    path.join(
                        mediaRoot,
                        segment ? "segment00.ts" : "index.m3u8"
                    )
                ),
                contentType: segment
                    ? "video/mp2t"
                    : "application/vnd.apple.mpegurl",
            });
        }
        return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript((playlist) => {
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "m3u");
        localStorage.setItem("m3usPlayers", "1");
        localStorage.setItem(
            "m3um3uArr",
            JSON.stringify({ active: 0, M3Us: [{ www: playlist }] })
        );
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            this.muted = true;
            this.loop = true;
            return play.call(this);
        };
    }, origin + "/doctor-fixture/channels.m3u");
    const response = page.waitForResponse(
        (value) => new URL(value.url()).pathname === "/dist/player.js"
    );
    await page.goto("/f/pc/");
    const loaded = await (await response).body();
    const artifact = fs.readFileSync(path.join(dist, "player.js"));
    expect(createHash("sha256").update(loaded).digest("hex")).toBe(
        createHash("sha256").update(artifact).digest("hex")
    );
    await page.waitForFunction(
        () =>
            window.commandChannelsReady === true && !!window.__ottRemoteInspect
    );
    await page.keyboard.press("Shift");
    await page.waitForFunction(() => {
        const video = document.getElementById("video");
        return (
            video?.readyState >= 2 &&
            video.currentTime > 0.1 &&
            !video.paused &&
            window.__ottClassicPlayback.snapshot().phase === "playing"
        );
    });
    return { artifact: artifact.toString("utf8"), errors, manifest, requests };
}

async function caps(page) {
    return page.evaluate(
        () =>
            new Promise((resolve) =>
                window.executeRemoteRequest(
                    { action: "capabilities", params: {} },
                    resolve
                )
            )
    );
}

async function inspect(page, runtime, section = "doctor", extra = {}) {
    return page.evaluate(
        ({ runtime, section, extra }) => {
            const effects = [];
            const restores = [];
            function block(owner, key) {
                if (!owner || typeof owner[key] !== "function") return;
                const original = owner[key];
                owner[key] = function () {
                    effects.push(key);
                    throw new Error("Unexpected inspection effect: " + key);
                };
                restores.push(() => {
                    owner[key] = original;
                });
            }
            const video = document.getElementById("video");
            const before = {
                generation: window.__ottClassicPlayback.snapshot().generation,
                paused: video.paused,
                src: video.currentSrc,
            };
            block(window, "fetch");
            block(window, "__ottCoreBackend");
            block(window, "restart");
            block(window.XMLHttpRequest?.prototype, "open");
            block(window.HTMLMediaElement?.prototype, "play");
            block(window.HTMLMediaElement?.prototype, "pause");
            block(window.navigator.mediaDevices, "getDisplayMedia");
            block(window.__ottRemoteScreenshot, "capture");
            block(window.__ottRemoteScreenshot, "selectSource");
            let result;
            try {
                window.executeRemoteRequest(
                    {
                        action: "inspect",
                        params: { runtime, section, version: 1, ...extra },
                    },
                    (value) => {
                        result = value;
                    }
                );
                if (!result)
                    throw new Error("inspect must complete synchronously");
            } finally {
                restores.reverse().forEach((restore) => restore());
            }
            return {
                effects,
                result,
                unchanged:
                    before.generation ===
                        window.__ottClassicPlayback.snapshot().generation &&
                    before.src === video.currentSrc &&
                    before.paused === video.paused,
            };
        },
        { extra, runtime, section }
    );
}

test("doctor observes real CSS, owned dialogs and media without causing effects", async ({
    page,
    context,
    baseURL,
}) => {
    const observed = await fixture(page, context, baseURL);
    const initial = await caps(page);
    const runtime = initial.data.player.runtime;
    expect(initial.data.inspect).toEqual({
        sections: ["doctor", "snapshot", "operation"],
        version: 1,
    });
    await page.evaluate(() => {
        document.getElementById("video").style.cssText =
            "position:fixed;display:block;left:70px;top:40px;width:420px;height:236px;opacity:1;visibility:visible";
    });
    let reply = await inspect(page, runtime);
    expect(reply.effects).toEqual([]);
    expect(reply.unchanged).toBe(true);
    expect(reply.result.status).toBe("ok");
    const baseline = reply.result.data.data;
    expect(baseline.consistent).toBe(true);
    expect(baseline.media.generation).toBeGreaterThan(0);
    expect(baseline.media.kind).toBe("live");
    expect(baseline.media.displayEvidence).toBe("unavailable");
    expect(baseline.media.lanes[0]).toMatchObject({
        lane: "main",
        phase: "playing",
        video: {
            cssVisible: true,
            ended: false,
            exists: true,
            paused: false,
            rect: { height: 236, width: 420, x: 70, y: 40 },
        },
    });
    expect(baseline.media.lanes[0].video.videoWidth).toBeGreaterThan(0);
    expect(baseline.media.lanes[0].handleId).toBeGreaterThan(0);

    await page.evaluate((secret) => {
        window.confirmBox(
            secret,
            () => {},
            () => {}
        );
        const dialog = document.getElementById("dialogbox");
        const input = document.createElement("input");
        input.type = "password";
        input.value = secret;
        dialog.appendChild(input);
        input.focus();
    }, SECRET);
    await expect(page.locator("#dialogbox")).toBeVisible();
    reply = await inspect(page, runtime);
    expect(reply.effects).toEqual([]);
    expect(reply.unchanged).toBe(true);
    const dialog = reply.result.data.data;
    expect(dialog.ui.owner.kind).toBe("dialog");
    expect(dialog.ui.focus).toBe("dialog");
    expect(
        dialog.ui.panes.find((pane) => pane.kind === "dialog").cssVisible
    ).toBe(true);
    expect(dialog.reasons).toContain("owned_overlay_open");
    expect(dialog.media.lanes[0].video.cssVisible).toBe(true);
    expect(dialog.reasons).not.toContain("video_css_hidden");
    expect(JSON.stringify(dialog)).not.toContain(SECRET);
    expect(JSON.stringify(dialog)).not.toContain("channels.m3u");
    expect(JSON.stringify(dialog)).not.toContain("healthy");
    expect(
        Buffer.byteLength(JSON.stringify(dialog), "utf8")
    ).toBeLessThanOrEqual(8192);

    await page.evaluate(() => {
        document.getElementById("video").parentElement.style.display = "none";
    });
    reply = await inspect(page, runtime, "snapshot");
    expect(reply.effects).toEqual([]);
    expect(reply.unchanged).toBe(true);
    expect(reply.result.data.data.media.lanes[0].video.cssVisible).toBe(false);
    expect(reply.result.data.data.reasons).toContain("video_css_hidden");
    expect(reply.result.data.data.reasons).toContain("video_zero_rect");
    expect(reply.result.data.data.media.displayEvidence).toBe("unavailable");
    await page.evaluate(() => {
        document.getElementById("video").parentElement.style.display = "block";
        window.dialogBoxKeyHandler(window.keys.RETURN);
        window.showSelectBox(0, ["Doctor one", "Doctor two"], () => {}, -1);
    });
    await expect(page.locator("#numprog")).toBeVisible();
    reply = await inspect(page, runtime);
    expect(reply.result.data.data.ui.owner.kind).toBe("picker");
    expect(
        reply.result.data.data.ui.panes.find((pane) => pane.kind === "picker")
            .cssVisible
    ).toBe(true);
    expect(reply.effects).toEqual([]);
    expect(reply.unchanged).toBe(true);
    expect(observed.errors).toEqual([]);
});

test("inspection identifies the loaded artifact and rejects an old runtime after reload", async ({
    page,
    context,
    baseURL,
}) => {
    const observed = await fixture(page, context, baseURL);
    const runtime = (await caps(page)).data.player.runtime;
    const first = await inspect(page, runtime);
    expect(first.result.status).toBe("ok");
    const snapshot = first.result.data.data;
    expect(first.result.data).toMatchObject({
        runtime,
        section: "doctor",
        version: 1,
    });
    expect(snapshot.runtime).toBe(runtime);
    expect(snapshot.build.buildId).toMatch(/^bundle-[a-f0-9]{64}$/);
    expect(observed.artifact).toContain(snapshot.build.buildId);
    expect(snapshot.build.version).not.toContain("__OTTP_");
    expect(snapshot.build.version).not.toBe(observed.manifest.version);
    expect(snapshot.build.buildId).not.toBe(observed.manifest.buildId);
    expect(
        observed.requests.some((url) => url.endsWith("/build-info.json"))
    ).toBe(false);
    const unknown = await inspect(page, runtime, "operation", {
        operation_id: "1".repeat(32),
    });
    expect(unknown.result.status).toBe("ok");
    expect(unknown.result.data.data).toMatchObject({
        action: null,
        operation_id: "1".repeat(32),
        state: "unknown",
    });
    expect(unknown.effects).toEqual([]);
    await page.reload();
    await page.waitForFunction(
        () => !!window.__ottRemoteInspect && !!document.getElementById("video")
    );
    const nextRuntime = (await caps(page)).data.player.runtime;
    expect(nextRuntime).not.toBe(runtime);
    const stale = await inspect(page, runtime);
    expect(stale.result).toEqual({
        data: {
            error: "runtime_mismatch",
            runtime: nextRuntime,
            section: "doctor",
            version: 1,
        },
        status: "rejected",
    });
    const fresh = await inspect(page, nextRuntime, "snapshot");
    expect(fresh.result.status).toBe("ok");
    expect(fresh.result.data.data.build).toEqual(snapshot.build);
    expect(fresh.effects).toEqual([]);
    expect(
        observed.requests.some((url) => url.endsWith("/build-info.json"))
    ).toBe(false);
    expect(observed.errors).toEqual([]);
});
