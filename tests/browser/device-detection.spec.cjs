// Browser emulation of UA/native API signals, not firmware or decoder emulation.
// Exercise the shipped HTML loader, built classic bundle and real STB adapter.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const fixtures = require("../fixtures/device-detection.json");
const runtimeVersion = require("../../js/media-runtime.json").runtimeVersion;

const adapterRoot = path.resolve(__dirname, "../../stb");
const adapterNames = [];
function collectAdapters(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = prefix + entry.name;
        const child = path.join(directory, entry.name);
        if (fs.existsSync(path.join(child, "stb.js"))) adapterNames.push(name);
        else collectAdapters(child, name + "/");
    }
}
collectAdapters(adapterRoot);

// Deliberately independent expected remote codes: reading the adapter's own
// values as expectations would miss loading another valid but wrong adapter.
const remoteOverrides = {
    android: { DOWN: 20, ENTER: 66, RETURN: 4 },
    "lg/webos": { RETURN: 461 },
    "samsung/maple": { DOWN: 5, ENTER: 12, RETURN: 88 },
    "samsung/tizen": { ENTER: 13, RETURN: 10009 },
};
const routeFixtures = adapterNames.sort().map((name) => ({
    expectedDevice: name,
    name: "explicit adapter route " + name,
    pathname: "/f/" + name + "/",
    userAgent:
        "Mozilla/5.0 (SmartTV; Linux; Web0S) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
}));

async function remoteKey(page, keyCode, key) {
    // Chromium's input dispatch emits a browser keyboard event with the TV's
    // numeric code, through window.onkeydown and the real list key handler.
    const cdp = await page.context().newCDPSession(page);
    try {
        const event = {
            key,
            nativeVirtualKeyCode: keyCode,
            windowsVirtualKeyCode: keyCode,
        };
        await cdp.send("Input.dispatchKeyEvent", {
            ...event,
            type: "rawKeyDown",
        });
        await cdp.send("Input.dispatchKeyEvent", { ...event, type: "keyUp" });
    } finally {
        await cdp.detach();
    }
}

for (const fixture of fixtures.concat(routeFixtures)) {
    test.describe(fixture.name, () => {
        test.use({ userAgent: fixture.userAgent });
        test("boots the selected adapter and handles remote navigation", async ({
            page,
            context,
            baseURL,
        }, testInfo) => {
            const localOrigin = new URL(baseURL).origin;
            const loadedScripts = [];
            const mediaVersions = [];
            const blockedRequests = [];
            const pageErrors = [];
            page.on("pageerror", (error) => pageErrors.push(error.message));
            page.on("response", (response) => {
                if (
                    response.request().resourceType() === "script" &&
                    response.ok()
                ) {
                    const url = new URL(response.url());
                    loadedScripts.push(url.pathname);
                    if (
                        /\/js\/(runtime-polyfills|hls.min)\.js$/.test(
                            url.pathname
                        )
                    )
                        mediaVersions.push(url.searchParams.get("v"));
                }
            });
            await context.route("**/*", async (route) => {
                if (new URL(route.request().url()).origin === localOrigin) {
                    await route.continue();
                } else {
                    // Keep the device matrix independent of live providers.
                    blockedRequests.push(route.request().url());
                    await route.abort("blockedbyclient");
                }
            });
            await context.routeWebSocket("**/*", (socket) => {
                blockedRequests.push(socket.url());
                socket.close();
            });
            await context.addInitScript((capability) => {
                localStorage.setItem("ottplaylang", "_eng");
                if (capability === "mag") {
                    window.gSTB = {
                        GetDeviceMacAddress: function () {
                            return "02:00:00:00:00:01";
                        },
                        GetDeviceModel: function () {
                            return "MAG250";
                        },
                    };
                } else if (capability === "empty-gstb") {
                    window.gSTB = {};
                } else if (capability === "throwing-gstb") {
                    Object.defineProperty(window, "gSTB", {
                        get: function () {
                            throw new Error("Native bridge unavailable");
                        },
                    });
                }
            }, fixture.capability);

            await page.goto(fixture.pathname, { waitUntil: "load" });
            await expect(page.locator("#listCaption")).toHaveText(
                "First-run setup"
            );
            await expect(page.locator("#list")).toBeVisible();
            await expect(page.locator("#boot-log")).toContainText(
                "device: " + fixture.expectedDevice
            );
            const remote = {
                DOWN: 40,
                ENTER: 13,
                RETURN: 8,
                ...remoteOverrides[fixture.expectedDevice],
            };
            expect(
                await page.evaluate(() => ({
                    back: window.keys.RETURN,
                    device: window.ott_device,
                    down: window.keys.DOWN,
                    enter: window.keys.ENTER,
                }))
            ).toEqual({
                back: remote.RETURN,
                device: fixture.expectedDevice,
                down: remote.DOWN,
                enter: remote.ENTER,
            });
            expect(loadedScripts).toContain("/dist/stbPlayer.js");
            expect(loadedScripts[0]).toBe("/js/runtime-polyfills.js");
            expect(loadedScripts).toContain("/js/hls.min.js");
            expect(
                await page.evaluate(() => ({
                    ready: window.__ottRuntimePolyfillsReady,
                    runtimeVersion: window.__ottMediaRuntimeVersion,
                    version: window.Hls.version,
                    worker: window.Hls.DefaultConfig.workerPath,
                }))
            ).toEqual({
                ready: true,
                runtimeVersion,
                version: "1.7.3",
                worker: localOrigin + "/js/hls.worker.js?v=" + runtimeVersion,
            });
            expect(mediaVersions).toEqual([runtimeVersion, runtimeVersion]);
            expect(
                loadedScripts.filter((url) => /^\/stb\/.+\/stb\.js$/.test(url))
            ).toEqual(["/stb/" + fixture.expectedDevice + "/stb.js"]);

            // Browser keyboard input must move the first-run selection. Maple
            // and Android emit their platform keycodes for the same arrow.
            const firstDetail = await page.locator("#listDetail").innerText();
            if (remote.DOWN === 40) await page.keyboard.press("ArrowDown");
            else await remoteKey(page, remote.DOWN, "ArrowDown");
            await expect(page.locator("#listDetail")).not.toHaveText(
                firstDetail
            );
            // The platform-specific Back code must reach firstRun's handler,
            // which opens language selection. Then its Enter returns to setup.
            await remoteKey(page, remote.RETURN, "BrowserBack");
            await expect(page.locator("#listCaption")).toHaveText(
                "Choose language"
            );
            await remoteKey(page, remote.ENTER, "Enter");
            await expect(page.locator("#listCaption")).toHaveText(
                "First-run setup"
            );
            expect(pageErrors).toEqual([]);
            await testInfo.attach("device-runtime", {
                body: JSON.stringify(
                    { blockedRequests, fixture, loadedScripts, pageErrors },
                    null,
                    2
                ),
                contentType: "application/json",
            });
        });
    });
}

test("a failed runtime download shows a retry message before loading libraries", async ({
    page,
    context,
    baseURL,
}) => {
    const requestedScripts = [];
    page.on("request", (request) => {
        if (request.resourceType() === "script")
            requestedScripts.push(new URL(request.url()).pathname);
    });
    const localOrigin = new URL(baseURL).origin;
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
            url.origin !== localOrigin ||
            url.pathname === "/js/runtime-polyfills.js"
        )
            await route.abort("blockedbyclient");
        else await route.continue();
    });
    await page.goto("/f/lg/webos/", { waitUntil: "load" });
    await expect(page.locator("#boot-status")).toHaveText(
        "Failed to load runtime support"
    );
    await expect(page.locator("#boot-log")).toContainText("Reload the player");
    await expect(page.locator("body")).not.toHaveClass(/\bbooting\b/);
    expect(requestedScripts).toEqual(["/js/runtime-polyfills.js"]);
});

async function enterViewingMode(page) {
    await expect(page.locator("#listCaption")).toHaveText("First-run setup");
    // No channel or stream is needed to exercise viewing-mode keyboard actions.
    // Use the player's real list/volume APIs; keep its handlers unchanged.
    await page.evaluate(() => {
        window.closeList();
        window.stbSetVolume(50);
    });
    await expect(page.locator("#list")).toBeHidden();
}

async function bootForArrowBehavior(page, context, baseURL, device) {
    const origin = new URL(baseURL).origin;
    await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).origin === origin)
            await route.continue();
        else await route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
    });
    await page.goto("/f/" + device + "/", { waitUntil: "load" });
    await enterViewingMode(page);
}

test.describe("viewing-mode arrow behavior", () => {
    for (const device of ["lg/webos", "lg/netcast"]) {
        test(
            device + " fresh Left opens the main Menu",
            async ({ page, context, baseURL }) => {
                const errors = [];
                page.on("pageerror", (error) => errors.push(error.message));
                await bootForArrowBehavior(page, context, baseURL, device);
                await page.keyboard.press("ArrowLeft");
                await expect(page.locator("#list")).toBeVisible();
                await expect(page.locator("#listCaption")).toHaveText("Menu");
                expect(await page.evaluate(() => window.stbGetVolume())).toBe(
                    50
                );
                expect(errors).toEqual([]);
            }
        );

        test(
            device + " saved Left volume choice survives reload",
            async ({ page, context, baseURL }) => {
                const errors = [];
                page.on("pageerror", (error) => errors.push(error.message));
                await bootForArrowBehavior(page, context, baseURL, device);
                // Model an existing explicit setting once. The init script does
                // not seed it again, so reloading must preserve the stored choice.
                await page.evaluate(() => localStorage.setItem("sALfun", "14"));
                await page.reload({ waitUntil: "load" });
                await enterViewingMode(page);
                await page.keyboard.press("ArrowLeft");
                await expect
                    .poll(() => page.evaluate(() => window.stbGetVolume()))
                    .toBe(45);
                await expect(page.locator("#list")).toBeHidden();
                expect(
                    await page.evaluate(() => localStorage.getItem("sALfun"))
                ).toBe("14");
                expect(errors).toEqual([]);
            }
        );
    }

    test("PC default Left and Right retain volume control", async ({
        page,
        context,
        baseURL,
    }) => {
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await bootForArrowBehavior(page, context, baseURL, "pc");
        await page.keyboard.press("ArrowLeft");
        await expect
            .poll(() => page.evaluate(() => window.stbGetVolume()))
            .toBe(45);
        await expect(page.locator("#list")).toBeHidden();
        await page.keyboard.press("ArrowRight");
        await expect
            .poll(() => page.evaluate(() => window.stbGetVolume()))
            .toBe(50);
        await expect(page.locator("#list")).toBeHidden();
        expect(errors).toEqual([]);
    });
});

for (const device of ["lg/webos", "lg/netcast", "pc"]) {
    test(
        device + " settings expose only the appropriate engine controls",
        async ({ page, context, baseURL }) => {
            const errors = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await bootForArrowBehavior(page, context, baseURL, device);
            for (const menu of ["stbOptions", "settingsInterface"]) {
                await page.evaluate((name) => window[name](), menu);
                await expect(page.locator("#list")).toBeVisible();
                await expect(
                    page
                        .locator("#list")
                        .getByRole("button", { name: /^Streaming player type/ })
                ).toHaveCount(device === "lg/webos" ? 0 : 1);
                await expect(
                    page
                        .locator("#list")
                        .getByText("Buffer Size, s", { exact: false })
                ).toBeVisible();
            }
            if (device === "lg/webos") {
                expect(
                    await page.evaluate(() => {
                        window.setPlayerMode(2);
                        return window.playerMode;
                    })
                ).toBe(3);
            }
            expect(errors).toEqual([]);
        }
    );
}
