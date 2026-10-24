// Exercise the shipped player and its actual transport/DOM; no HA or real devices.
const { test, expect } = require("../helpers/browser-test.cjs");

test("active player renders a literal banner and standby removes it immediately", async ({
    page,
    context,
    baseURL,
}) => {
    const origin = new URL(baseURL).origin;
    const polls = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort("blockedbyclient");
        if (url.pathname === "/ha-control/api/notifications") {
            const active = url.searchParams.get("active") === "true";
            const runtime = url.searchParams.get("runtime");
            polls.push({ active, runtime });
            const now = Date.now() / 1000;
            return route.fulfill({
                json: {
                    notifications:
                        active && polls.length === 1
                            ? [
                                  {
                                      duration_ms: 15000,
                                      expires_at: now + 15,
                                      id: "a".repeat(32),
                                      message:
                                          '<img src=x onerror="bad()"> Door opened',
                                      runtime,
                                      severity: "critical",
                                      title: "Home Assistant",
                                  },
                              ]
                            : [],
                    poll_after_ms: 5000,
                    server_time: now,
                    version: 1,
                },
            });
        }
        if (url.pathname.startsWith("/ha-control/"))
            return route.fulfill({
                json: { commands: [], server_time: Date.now() / 1000 },
            });
        return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await page.goto("/f/pc/");
    await page.waitForFunction(
        () =>
            !!window.__ottCommandServer &&
            !document.body.classList.contains("booting")
    );
    await page.evaluate((address) => {
        window.__ottCommandServer.configure({
            address,
            enabled: true,
            token: "notification_fixture_" + "b".repeat(32),
        });
    }, origin + "/ha-control");
    const banner = page.locator(".remote-notify");
    await expect(banner).toBeVisible();
    await expect(banner.locator(".remote-notify-title")).toHaveText(
        "Home Assistant"
    );
    await expect(banner.locator(".remote-notify-message")).toHaveText(
        '<img src=x onerror="bad()"> Door opened'
    );
    await expect(banner.locator("img")).toHaveCount(0);
    await expect(banner).toHaveCSS("border-left-color", "rgb(255, 146, 156)");
    await expect(banner).toHaveCSS("pointer-events", "none");
    await expect(banner.locator(".remote-notify-message")).toHaveCSS(
        "white-space",
        "pre-wrap"
    );
    await page.evaluate(() => window.__ottStandby.set(true));
    await expect(banner).toHaveCount(0);
    await expect.poll(() => polls.some((poll) => !poll.active)).toBe(true);
    expect(
        await page.evaluate(() => window.__ottCommandServer.status().state)
    ).toBe("connected");
    expect(polls.at(-1).runtime).not.toBe(polls[0].runtime);
    expect(errors).toEqual([]);
});

for (const viewport of [
    { height: 360, width: 640 },
    { height: 360, overlay: true, width: 640 },
    { height: 540, width: 960 },
    { height: 568, width: 320 },
    { height: 390, width: 844 },
    { height: 1080, width: 1920 },
]) {
    test(`notification cards fit ${viewport.width}x${viewport.height}${viewport.overlay ? " overlay" : ""} independently of player text`, async ({
        page,
        context,
        baseURL,
    }, testInfo) => {
        await page.setViewportSize({
            height: viewport.height,
            width: viewport.width,
        });
        const origin = new URL(baseURL).origin;
        let delivered = false;
        await context.route("**/*", async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort("blockedbyclient");
            if (url.pathname === "/ha-layout/api/notifications") {
                const now = Date.now() / 1000;
                const send =
                    !delivered && url.searchParams.get("active") === "true";
                if (send) delivered = true;
                return route.fulfill({
                    json: {
                        notifications: send
                            ? ["info", "warning", "critical"].map(
                                  (severity, index) => ({
                                      duration_ms: 15000,
                                      expires_at: now + 15,
                                      id: String(index).repeat(32),
                                      message:
                                          index === 0
                                              ? "Someone is at the door."
                                              : index === 1
                                                ? "Air quality needs attention. Open a window when convenient. "
                                                      .repeat(9)
                                                      .slice(0, 512)
                                                : "W".repeat(512),
                                      runtime: url.searchParams.get("runtime"),
                                      severity,
                                      title:
                                          index === 0
                                              ? "Front door"
                                              : "Living room ventilation and climate monitor "
                                                    .repeat(3)
                                                    .slice(0, 128),
                                  })
                              )
                            : [],
                        poll_after_ms: 5000,
                        server_time: now,
                        version: 1,
                    },
                });
            }
            if (url.pathname.startsWith("/ha-layout/"))
                return route.fulfill({
                    json: { commands: [], server_time: Date.now() / 1000 },
                });
            return route.continue();
        });
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await page.goto("/f/pc/");
        await page.waitForFunction(
            () =>
                !!window.__ottCommandServer &&
                !document.body.classList.contains("booting")
        );
        await page.evaluate((address) => {
            document.body.style.fontSize = "48px";
            window.__ottCommandServer.configure({
                address,
                enabled: true,
                token: "layout_fixture_" + "b".repeat(32),
            });
        }, origin + "/ha-layout");
        if (viewport.overlay) {
            // Exercise the shipped titlebar geometry rules in headless browsers.
            const fs = require("node:fs");
            const css = fs
                .readFileSync(
                    require("node:path").join(
                        __dirname,
                        "../../js/browser-app/window-controls.css"
                    ),
                    "utf8"
                )
                .replace(
                    "@media (display-mode: window-controls-overlay)",
                    "@media all"
                );
            await page.addStyleTag({ content: css });
            await page.evaluate(() =>
                document.documentElement.classList.add("ott-window-controls")
            );
        }
        const cards = page.locator(".remote-notify");
        await expect(cards).toHaveCount(3);
        const geometry = await cards.evaluateAll((nodes) =>
            nodes.map((node) => {
                const r = node.getBoundingClientRect(),
                    s = getComputedStyle(node);
                return {
                    bottom: r.bottom,
                    font: parseFloat(s.fontSize),
                    height: r.height,
                    pointer: s.pointerEvents,
                    right: r.right,
                    width: r.width,
                    x: r.x,
                    y: r.y,
                };
            })
        );
        const colors = [
            "rgb(121, 187, 255)",
            "rgb(255, 208, 121)",
            "rgb(255, 146, 156)",
        ];
        for (let i = 0; i < colors.length; i++) {
            const card = cards.nth(i);
            for (const side of ["top", "right", "bottom", "left"]) {
                await expect(card).toHaveCSS(`border-${side}-color`, colors[i]);
                await expect(card).toHaveCSS(`border-${side}-width`, "1px");
                await expect(card).toHaveCSS(`border-${side}-style`, "solid");
            }
        }
        await expect(cards.first()).toHaveCSS("opacity", "1");
        await expect(cards.first()).toHaveCSS(
            "background-color",
            "rgba(22, 28, 39, 0.78)"
        );
        await expect(cards.first().locator(".remote-notify-message")).toHaveCSS(
            "opacity",
            "1"
        );
        await expect(cards.first().locator(".remote-notify-icon")).toHaveCSS(
            "opacity",
            "1"
        );
        const footerAlpha = await page
            .locator("#info1")
            .evaluate((node) =>
                Number(
                    getComputedStyle(node).backgroundColor.match(
                        /, ([\d.]+)\)$/
                    )[1]
                )
            );
        expect(footerAlpha).toBeCloseTo(0.7);
        await page.evaluate(() => window.stbSetOsdOpacity(90));
        await expect(cards.first()).toHaveCSS(
            "background-color",
            "rgba(22, 28, 39, 0.98)"
        );
        await page.evaluate(() => window.stbSetOsdOpacity(100));
        await expect(cards.first()).toHaveCSS(
            "background-color",
            "rgb(22, 28, 39)"
        );
        await page.evaluate(() => window.stbSetOsdOpacity(70));

        for (const g of geometry) {
            expect(g.x).toBeGreaterThanOrEqual(0);
            expect(g.y).toBeGreaterThanOrEqual(0);
            expect(g.right).toBeLessThanOrEqual(viewport.width);
            expect(g.bottom).toBeLessThanOrEqual(viewport.height);
            expect(g.font).toBeLessThanOrEqual(20);
            expect(g.pointer).toBe("none");
        }
        for (let i = 1; i < geometry.length; i++)
            expect(geometry[i].y).toBeGreaterThanOrEqual(
                geometry[i - 1].bottom
            );
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(cards.first()).toHaveCSS("animation-name", "none");
        for (const tone of ["bright", "dark"]) {
            await page.evaluate((tone) => {
                let back = document.getElementById(
                    "notification-visual-background"
                );
                if (!back) {
                    back = document.createElement("div");
                    back.id = "notification-visual-background";
                    document.body.appendChild(back);
                }
                back.style.cssText =
                    "position:fixed;inset:0;z-index:9998;pointer-events:none;background:" +
                    (tone === "bright"
                        ? "linear-gradient(125deg,#f5f0df,#b6d6d5 48%,#f9dda1)"
                        : "linear-gradient(125deg,#060c16,#19343d 48%,#0b1220)");
            }, tone);
            await page.screenshot({
                path: testInfo.outputPath(
                    `banner-${viewport.width}x${viewport.height}-${tone}.png`
                ),
            });
            await testInfo.attach(`${tone} background`, {
                contentType: "image/png",
                path: testInfo.outputPath(
                    `banner-${viewport.width}x${viewport.height}-${tone}.png`
                ),
            });
        }
    });
}

for (const viewport of [
    { height: 360, imageHeight: 90, imageWidth: 160, width: 640 },
    { height: 1080, imageHeight: 90, imageWidth: 160, width: 1920 },
    { height: 360, imageHeight: 120, imageWidth: 160, width: 640 },
    { height: 1080, imageHeight: 120, imageWidth: 160, width: 1920 },
    { height: 360, imageHeight: 160, imageWidth: 90, width: 640 },
    { height: 1080, imageHeight: 160, imageWidth: 90, width: 1920 },
    { height: 568, imageHeight: 160, imageWidth: 90, width: 320 },
    { height: 540, imageHeight: 120, imageWidth: 160, width: 960 },
    { failed: true, height: 360, imageHeight: 90, imageWidth: 160, width: 640 },
    {
        failed: true,
        height: 1080,
        imageHeight: 90,
        imageWidth: 160,
        width: 1920,
    },
]) {
    test(`JPEG notification and durable receive gate ${viewport.width}x${viewport.height} image ${viewport.imageWidth}x${viewport.imageHeight}${viewport.failed ? " failed snapshot" : ""}`, async ({
        page,
        context,
        baseURL,
    }, testInfo) => {
        await page.setViewportSize(viewport);
        const origin = new URL(baseURL).origin;
        const polls = [];
        const frames = [];
        let jpeg;
        let finishImage;
        const imageReady = new Promise((resolve) => {
            finishImage = resolve;
        });
        let delivered = false;
        const imageId = "f".repeat(32);
        await context.route("**/*", async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort("blockedbyclient");
            if (url.pathname === "/camera-fixture/api/notifications") {
                polls.push(Object.fromEntries(url.searchParams));
                const now = Date.now() / 1000;
                const send =
                    !delivered &&
                    url.searchParams.get("active") === "true" &&
                    url.searchParams.get("media") === "jpeg-v1";
                if (send) delivered = true;
                return route.fulfill({
                    json: {
                        capabilities: { enabled: true, media: ["jpeg-v1"] },
                        notifications: send
                            ? [
                                  {
                                      duration_ms: 15000,
                                      expires_at: now + 15,
                                      id: "e".repeat(32),
                                      media: {
                                          bytes: jpeg.bytes,
                                          content_type: "image/jpeg",
                                          height: viewport.imageHeight,
                                          id: imageId,
                                          kind: "image",
                                          width: viewport.imageWidth,
                                      },
                                      message: "Front door",
                                      runtime: url.searchParams.get("runtime"),
                                      severity: "info",
                                      title: "Motion",
                                  },
                              ]
                            : [],
                        poll_after_ms: 5000,
                        server_time: now,
                        version: 1,
                    },
                });
            }
            if (url.pathname === "/camera-fixture/api/notifications/media") {
                frames.push(url.toString());
                await imageReady;
                expect(route.request().headers().authorization).toBe(
                    "Bearer camera_fixture_" + "b".repeat(32)
                );
                if (viewport.failed)
                    return route.fulfill({ body: "Unavailable", status: 503 });
                const now = Date.now() / 1000;
                return route.fulfill({
                    json: {
                        bytes: jpeg.bytes,
                        content_type: "image/jpeg",
                        data_base64: jpeg.data,
                        expires_at: now + 15,
                        height: viewport.imageHeight,
                        id: imageId,
                        runtime: url.searchParams.get("runtime"),
                        server_time: now,
                        version: 1,
                        width: viewport.imageWidth,
                    },
                });
            }
            if (url.pathname.startsWith("/camera-fixture/"))
                return route.fulfill({
                    json: { commands: [], server_time: Date.now() / 1000 },
                });
            return route.continue();
        });
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await page.goto("/f/pc/");
        await page.waitForFunction(
            () =>
                !!window.__ottCommandServer &&
                !document.body.classList.contains("booting")
        );
        jpeg = await page.evaluate(({ imageWidth, imageHeight }) => {
            const canvas = document.createElement("canvas");
            canvas.width = imageWidth;
            canvas.height = imageHeight;
            const paint = canvas.getContext("2d");
            paint.fillStyle = "#234d64";
            paint.fillRect(0, 0, imageWidth, imageHeight);
            paint.fillStyle = "#c5ddaa";
            paint.fillRect(45, 15, 70, 75);
            const data = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
            return { bytes: atob(data).length, data };
        }, viewport);
        const rpc = (action, params = {}) =>
            page.evaluate(
                ({ action, params }) =>
                    new Promise((resolve) =>
                        executeRemoteRequest({ action, params }, resolve)
                    ),
                { action, params }
            );
        const caps = (await rpc("capabilities")).data;
        const primary = await page.locator("#video").getAttribute("src");
        await page.evaluate(
            (address) =>
                window.__ottCommandServer.configure({
                    address,
                    enabled: true,
                    token: "camera_fixture_" + "b".repeat(32),
                }),
            origin + "/camera-fixture"
        );
        const image = page.locator(".remote-notify-image");
        await expect.poll(() => frames.length, { timeout: 15000 }).toBe(1);
        await expect(page.locator(".remote-notify-message")).toHaveCount(0);
        await expect(page.locator(".remote-notify-with-image")).toHaveCount(0);
        finishImage();
        if (viewport.failed) {
            await expect.poll(() => frames.length).toBe(1);
            await page.waitForTimeout(200);
            await expect(image).toHaveCount(0);
            await expect(page.locator(".remote-notify-with-image")).toHaveCount(
                0
            );
            await expect(page.locator(".remote-notify-message")).toHaveCount(0);
            await expect(page.locator(".remote-notify")).toHaveCount(0);
            expect(await page.locator("#video").getAttribute("src")).toBe(
                primary
            );
            return;
        }
        await expect(image).toBeVisible({ timeout: 15000 });
        await expect(page.locator(".remote-notify-title")).toHaveCount(0);
        await expect(page.locator(".remote-notify-message")).toHaveCount(0);
        await expect(page.locator(".remote-notify-label")).toHaveCount(0);
        await expect(page.locator(".remote-notify-icon")).toHaveCount(0);
        const geometry = await image.evaluate((img) => {
            const card = img.parentElement;
            const outer = card.getBoundingClientRect();
            const inner = img.getBoundingClientRect();
            const style = getComputedStyle(card);
            return {
                border: parseFloat(style.borderLeftWidth),
                dx: inner.x - outer.x,
                dy: inner.y - outer.y,
                fit: getComputedStyle(img).objectFit,
                height: outer.height - inner.height,
                padding: style.padding,
                width: outer.width - inner.width,
            };
        });
        expect(geometry.padding).toBe("0px");
        expect(geometry.border).toBe(1);
        expect(geometry.dx).toBeCloseTo(1, 0);
        expect(geometry.dy).toBeCloseTo(1, 0);
        expect(geometry.width).toBeCloseTo(2, 0);
        expect(geometry.height).toBeCloseTo(2, 0);
        const box = await image.boundingBox();
        expect(box.width / box.height).toBeCloseTo(
            viewport.imageWidth / viewport.imageHeight,
            2
        );
        expect(box.height).toBeLessThanOrEqual(viewport.height * 0.4 + 1);
        await page.screenshot({
            animations: "disabled",
            path: testInfo.outputPath("camera-notification.png"),
        });
        expect(frames).toHaveLength(1);
        expect(polls[0].media).toBeUndefined();
        expect(await page.locator("#video").getAttribute("src")).toBe(primary);
        const result = await rpc("notifications", {
            enabled: false,
            operation: "set",
            runtime: caps.player.runtime,
            version: 1,
        });
        expect(result.data).toMatchObject({ enabled: false, persisted: true });
        await expect(page.locator(".remote-notify")).toHaveCount(0);
        await expect
            .poll(() =>
                polls.some((p) => p.active === "false" && p.enabled === "false")
            )
            .toBe(true);
        expect(
            (
                await rpc("notifications", {
                    operation: "get",
                    runtime: caps.player.runtime,
                    version: 1,
                })
            ).data.enabled
        ).toBe(false);
        await rpc("notifications", {
            enabled: true,
            operation: "set",
            runtime: caps.player.runtime,
            version: 1,
        });
        await page.waitForTimeout(5500);
        expect(frames).toHaveLength(1);
        await expect(image).toHaveCount(0);
        expect(await page.locator("#video").getAttribute("src")).toBe(primary);
    });
}
