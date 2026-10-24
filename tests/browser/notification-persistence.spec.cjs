// Real built player, storage and RPC handlers; only external controller/media are fixtures.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("../helpers/browser-test.cjs");
const TOKEN = "notification_persistence_" + "e".repeat(32);
const mediaRoot = path.join(__dirname, "../fixtures/media-runtime");
test.use({
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

async function setup(page, context, baseURL, legacy = false) {
    const origin = new URL(baseURL).origin;
    const polls = [];
    const errors = [];
    let sequence = 0;
    let message = "Before disabling";
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort("blockedbyclient");
        if (url.pathname === "/notification-fixture/list.m3u")
            return route.fulfill({
                body:
                    "#EXTM3U\n#EXTINF:-1,Notification fixture\n" +
                    origin +
                    "/notification-fixture/index.m3u8\n",
                contentType: "audio/x-mpegurl",
            });
        if (url.pathname.startsWith("/notification-fixture/")) {
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
        if (url.pathname.startsWith("/notification-control/")) {
            expect(route.request().headers().authorization).toBe(
                "Bearer " + TOKEN
            );
            if (url.pathname.endsWith("/api/notifications")) {
                const runtime = url.searchParams.get("runtime");
                polls.push({
                    active: url.searchParams.get("active"),
                    enabled: url.searchParams.get("enabled"),
                    media: url.searchParams.get("media"),
                    runtime,
                });
                if (
                    legacy &&
                    (url.searchParams.has("enabled") ||
                        url.searchParams.has("media"))
                )
                    return route.fulfill({
                        json: { error: "unknown query" },
                        status: 400,
                    });
                const now = Date.now() / 1000;
                return route.fulfill({
                    json: {
                        poll_after_ms: 5000,
                        server_time: now,
                        version: 1,
                        ...(legacy
                            ? {}
                            : { capabilities: { enabled: true, media: [] } }),
                        notifications: [
                            {
                                duration_ms: 15000,
                                expires_at: now + 15,
                                id: (++sequence).toString(16).padStart(32, "0"),
                                message,
                                runtime,
                                severity: "info",
                                title: "Home Assistant",
                            },
                        ],
                    },
                });
            }
            return route.fulfill({
                json: { commands: [], server_time: Date.now() / 1000 },
            });
        }
        return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(
        ({ origin, token }) => {
            const nativeGet = Storage.prototype.getItem;
            if (!localStorage.getItem("notificationFixtureSeeded")) {
                localStorage.setItem("notificationFixtureSeeded", "1");
                localStorage.setItem("ottplaylang", "_eng");
                localStorage.setItem("ottplayprov", "m3u");
                localStorage.setItem(
                    "m3um3uArr",
                    JSON.stringify({
                        active: 0,
                        M3Us: [
                            { www: origin + "/notification-fixture/list.m3u" },
                        ],
                    })
                );
                localStorage.setItem("m3usPlayers", "1");
                localStorage.setItem(
                    "commandServerAddress",
                    origin + "/notification-control/api/webhook/commands"
                );
                localStorage.setItem("commandServerEnabled", "1");
                localStorage.setItem("commandServerToken", token);
            }
            if (
                nativeGet.call(localStorage, "notificationFixtureBlockRead") ===
                "1"
            ) {
                Storage.prototype.getItem = function (key) {
                    if (key === "sNotificationsEnabled")
                        throw new Error("fixture blocked notification read");
                    return nativeGet.call(this, key);
                };
            }
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                this.muted = true;
                return play.call(this);
            };
        },
        { origin, token: TOKEN }
    );
    async function ready() {
        await page.waitForFunction(
            () =>
                window.commandChannelsReady === true &&
                window.__ottRemoteNotifications &&
                !document.body.classList.contains("booting")
        );
    }
    async function rpc(action, params = {}) {
        return page.evaluate(
            ({ action, params }) =>
                new Promise((resolve) =>
                    window.executeRemoteRequest({ action, params }, resolve)
                ),
            { action, params }
        );
    }
    async function policy(operation, enabled) {
        const runtime = (await rpc("capabilities")).data.player.runtime;
        return rpc("notifications", {
            operation,
            runtime,
            version: 1,
            ...(operation === "set" ? { enabled } : {}),
        });
    }
    await page.goto("/f/pc/");
    await ready();
    return {
        errors,
        policy,
        polls,
        ready,
        rpc,
        setMessage: (value) => (message = value),
    };
}

test("durable notification OFF survives reload and ON receives only a new session", async ({
    page,
    context,
    baseURL,
}) => {
    const h = await setup(page, context, baseURL);
    await expect(page.locator(".remote-notify-message")).toHaveText(
        "Before disabling"
    );
    const originalRuntime = (await h.rpc("capabilities")).data.player.runtime;
    expect((await h.policy("get")).data).toMatchObject({
        enabled: true,
        persisted: true,
        version: 1,
    });
    expect((await h.policy("set", false)).data).toMatchObject({
        enabled: false,
        persisted: true,
    });
    await expect(page.locator(".remote-notify")).toHaveCount(0);
    expect(
        await page.evaluate(() => localStorage.getItem("sNotificationsEnabled"))
    ).toBe("0");
    const beforeReload = h.polls.length;
    await page.reload();
    await h.ready();
    await expect.poll(() => h.polls.length).toBeGreaterThan(beforeReload);
    expect(h.polls.slice(beforeReload).every((p) => p.active === "false")).toBe(
        true
    );
    expect((await h.policy("get")).data).toMatchObject({
        enabled: false,
        persisted: true,
    });
    expect(
        await h.rpc("notifications", {
            operation: "get",
            runtime: originalRuntime,
            version: 1,
        })
    ).toEqual({
        data: {
            error: "runtime_mismatch",
            operation: "get",
            runtime: originalRuntime,
            version: 1,
        },
        status: "rejected",
    });
    await expect(page.locator(".remote-notify")).toHaveCount(0);
    const disabledRuntime = h.polls.at(-1).runtime;
    h.setMessage("After enabling");
    expect((await h.policy("set", true)).data).toMatchObject({
        enabled: true,
        persisted: true,
    });
    await expect(page.locator(".remote-notify-message")).toHaveText(
        "After enabling"
    );
    expect(h.polls.at(-1).runtime).not.toBe(disabledRuntime);
    expect(h.errors).toEqual([]);
});

test("profile import and local backup cannot overwrite the installation opt-out", async ({
    page,
    context,
    baseURL,
}) => {
    const h = await setup(page, context, baseURL);
    await h.policy("set", false);
    await page.evaluate(() => {
        const snapshot = JSON.parse(window.exportSettings());
        snapshot.settings.sNotificationsEnabled = "1";
        snapshot.settings.notificationsEnabled = 1;
        localStorage.removeItem("notificationFixtureImportResult");
        window.importSettings(JSON.stringify(snapshot), (ok) =>
            localStorage.setItem("notificationFixtureImportResult", String(ok))
        );
    });
    await expect(page.locator("#dialogbox")).toBeVisible();
    const reloaded = page.waitForEvent("domcontentloaded");
    await page.keyboard.press("Enter");
    await reloaded;
    await h.ready();
    expect(
        await page.evaluate(() =>
            localStorage.getItem("notificationFixtureImportResult")
        )
    ).toBe("true");
    expect(
        await page.evaluate(() => localStorage.getItem("sNotificationsEnabled"))
    ).toBe("0");
    await page.evaluate(() => {
        window.saveAllOptions();
        const snapshot = JSON.parse(
            localStorage.getItem("stb_settings_backup")
        );
        window.__notificationBackupExcluded =
            !Object.prototype.hasOwnProperty.call(
                snapshot,
                "sNotificationsEnabled"
            );
        snapshot.sNotificationsEnabled = "1";
        snapshot.notificationFixtureRestored = "yes";
        localStorage.setItem("stb_settings_backup", JSON.stringify(snapshot));
        window.loadAllOptions();
    });
    expect(await page.evaluate(() => window.__notificationBackupExcluded)).toBe(
        true
    );
    expect(
        await page.evaluate(() =>
            localStorage.getItem("notificationFixtureRestored")
        )
    ).toBe("yes");
    expect(
        await page.evaluate(() => localStorage.getItem("sNotificationsEnabled"))
    ).toBe("0");
    expect((await h.policy("get")).data.enabled).toBe(false);
    await expect(page.locator(".remote-notify")).toHaveCount(0);
    expect(h.errors).toEqual([]);
});

test("unreadable saved OFF on restart fails closed instead of becoming default ON", async ({
    page,
    context,
    baseURL,
}) => {
    const h = await setup(page, context, baseURL);
    await h.policy("set", false);
    await page.evaluate(() =>
        localStorage.setItem("notificationFixtureBlockRead", "1")
    );
    const beforeReload = h.polls.length;
    await page.reload();
    await h.ready();
    await expect.poll(() => h.polls.length).toBeGreaterThan(beforeReload);
    expect(h.polls.slice(beforeReload).every((p) => p.active === "false")).toBe(
        true
    );
    expect((await h.policy("get")).data.error).toBe("storage_unavailable");
    await expect(page.locator(".remote-notify")).toHaveCount(0);
    expect(h.errors).toEqual([]);
});

test("legacy controller keeps text notifications without new query parameters", async ({
    page,
    context,
    baseURL,
}) => {
    const h = await setup(page, context, baseURL, true);
    await expect(page.locator(".remote-notify-message")).toHaveText(
        "Before disabling"
    );
    await h.policy("set", false);
    await expect(page.locator(".remote-notify")).toHaveCount(0);
    h.setMessage("Legacy after enabling");
    await h.policy("set", true);
    await expect(page.locator(".remote-notify-message")).toHaveText(
        "Legacy after enabling"
    );
    expect(h.polls.every((p) => p.enabled === null && p.media === null)).toBe(
        true
    );
    expect(h.errors).toEqual([]);
});
