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
                const originalLog = console.log;
                window.__testPlayerStarts = [];
                console.log = function (...args) {
                    if (args[0] === "startPlayer") {
                        window.__testPlayerStarts.push({
                            back: window.keys && window.keys.RETURN,
                            device: window.ott_device,
                        });
                    }
                    return originalLog.apply(this, args);
                };
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
            expect(
                await page.evaluate(() => window.__testPlayerStarts)
            ).toEqual([
                { back: remote.RETURN, device: fixture.expectedDevice },
            ]);
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

async function bootForMagicRemote(page, context, baseURL, device, visible) {
    const origin = new URL(baseURL).origin;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).origin === origin)
            await route.continue();
        else await route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript((initialVisibility) => {
        localStorage.setItem("ottplaylang", "_eng");
        window.__testCursor = {
            changes: [],
            visible: initialVisibility,
        };
        // Model the optional shim called by the shipped adapter. This is an
        // observable native boundary, not an emulation of LG firmware APIs.
        window.webOS = {
            device: {
                cursorVisible: function (nextVisibility) {
                    window.__testCursor.changes.push(nextVisibility);
                    window.__testCursor.visible = nextVisibility;
                },
            },
        };
    }, visible);
    await page.goto("/f/" + device + "/", { waitUntil: "load" });
    await expect(page.locator("#listCaption")).toHaveText("First-run setup");
    expect(await page.evaluate(() => window.ott_device)).toBe(device);
    await page.evaluate(() => {
        // Observe the real router without replacing page actions or selection.
        const original = window.keyHandler;
        window.__testEnterCount = 0;
        window.keyHandler = function (event) {
            if (event.keyCode === 13) window.__testEnterCount++;
            return original.apply(this, arguments);
        };
    });
    return errors;
}

test("command server settings start and stop polling in the shipped player", async ({
    page,
    context,
    baseURL,
}) => {
    const errors = await bootForMagicRemote(
        page,
        context,
        baseURL,
        "pc",
        false
    );
    const token = "browser-fixture-device-code-1234567890";
    const requests = [];
    await context.route("http://192.0.2.20:8081/**", async (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") {
            await route.fulfill({
                headers: {
                    "Access-Control-Allow-Headers": "authorization",
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Allow-Origin": new URL(baseURL).origin,
                },
                status: 204,
            });
            return;
        }
        requests.push({
            authorization: request.headers().authorization,
            method: request.method(),
            url: request.url(),
        });
        await route.fulfill({
            body: JSON.stringify({
                commands: [],
                server_time: Date.now() / 1000,
            }),
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": new URL(baseURL).origin },
        });
    });
    await page.evaluate(() => window.settingsCommands());
    await page.locator("#commandServerAddress").click();
    await page.locator("#editvar").fill("192.0.2.20");
    await page.locator("#editvar").press("Enter");
    await expect(page.locator("#commandServerStatus")).toContainText(
        "device access code"
    );
    expect(requests).toHaveLength(0);
    await page.locator("#commandServerToken").click();
    await expect(page.locator("#editvar")).toHaveAttribute("type", "password");
    await page.locator("#editvar").fill(token);
    await page.locator("#editvar").press("Enter");
    await expect(page.locator("#commandServerStatus")).toHaveText("Connected");
    expect(requests[0]).toEqual({
        authorization: "Bearer " + token,
        method: "GET",
        url: "http://192.0.2.20:8081/api/webhook/commands?delivery=ack",
    });
    await expect(page.locator("#remoteSettingsContent")).not.toContainText(
        token
    );
    const beforeReload = requests.length;
    await page.reload({ waitUntil: "load" });
    await expect.poll(() => requests.length).toBeGreaterThan(beforeReload);
    await page.evaluate(() => window.settingsCommands());
    await expect(page.locator("#commandServerStatus")).toHaveText("Connected");
    await page.locator("#commandServerConnect").click();
    await expect(page.locator("#commandServerStatus")).toHaveText(
        "Disconnected"
    );
    const stoppedCount = requests.length;
    await page.reload({ waitUntil: "load" });
    await expect(page.locator("#listCaption")).toHaveText("First-run setup");
    await page.evaluate(() => window.settingsCommands());
    // Saving the equivalent bare IP must not undo the user's Disconnect.
    await page.locator("#commandServerAddress").click();
    await page.locator("#editvar").fill("192.0.2.20");
    await page.locator("#editvar").press("Enter");
    await expect(page.locator("#commandServerStatus")).toHaveText(
        "Disconnected"
    );
    await page.waitForTimeout(1200);
    expect(requests).toHaveLength(stoppedCount);
    expect(errors).toEqual([]);
});

test.describe("LG Magic Remote pointer and button transitions", () => {
    test.use({
        userAgent:
            "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 WebAppManager",
    });

    for (const visible of [true, false]) {
        test(
            "webOS boot preserves a " +
                (visible ? "visible" : "hidden") +
                " system pointer",
            async ({ page, context, baseURL }) => {
                const errors = await bootForMagicRemote(
                    page,
                    context,
                    baseURL,
                    "lg/webos",
                    visible
                );
                expect(await page.evaluate(() => window.__testCursor)).toEqual({
                    changes: [],
                    visible,
                });
                expect(errors).toEqual([]);
            }
        );
    }

    for (const device of ["lg/webos", "lg/netcast"]) {
        test(
            device +
                " hover, wheel, arrows and one-click activation share selection",
            async ({ page, context, baseURL }) => {
                const errors = await bootForMagicRemote(
                    page,
                    context,
                    baseURL,
                    device,
                    true
                );
                const manual = page.locator("#listIn").getByRole("button", {
                    exact: true,
                    name: "Manual setup",
                });
                const manualIndex = Number(
                    await manual.getAttribute("data-idx")
                );
                expect(manualIndex).toBeGreaterThan(0);
                // Genuine pointer movement must focus an unselected row without
                // activating it. A click can then perform the same action as OK.
                await manual.hover();
                await expect
                    .poll(() => page.evaluate(() => window.selIndex))
                    .toBe(manualIndex);
                await expect(page.locator("#listCaption")).toHaveText(
                    "First-run setup"
                );
                expect(await page.evaluate(() => window.__testEnterCount)).toBe(
                    0
                );
                await page.mouse.wheel(0, -120);
                await expect
                    .poll(() => page.evaluate(() => window.selIndex))
                    .toBe(manualIndex - 1);
                await page.evaluate(() => {
                    // Native 5-way navigation hides the pointer. This event
                    // reports the system state, rather than requesting it.
                    document.dispatchEvent(
                        new CustomEvent("cursorStateChange", {
                            detail: { visibility: false },
                        })
                    );
                });
                await page.keyboard.press("ArrowDown");
                await expect
                    .poll(() => page.evaluate(() => window.selIndex))
                    .toBe(manualIndex);
                await page.keyboard.press("ArrowUp");
                await expect
                    .poll(() => page.evaluate(() => window.selIndex))
                    .toBe(manualIndex - 1);
                // Return to pointer mode after buttons changed focus. Move away
                // first so this exercises a fresh pointer entry into the row.
                await page.evaluate(() => {
                    document.dispatchEvent(
                        new CustomEvent("cursorStateChange", {
                            detail: { visibility: true },
                        })
                    );
                });
                await page.mouse.move(1100, 100);
                await manual.hover();
                await expect
                    .poll(() => page.evaluate(() => window.selIndex))
                    .toBe(manualIndex);
                // The pointer can stay on a row while a key or page change
                // moves selection elsewhere. Click without a mousemove must
                // still focus and activate the row exactly once.
                await page.keyboard.press("ArrowUp");
                await expect
                    .poll(() => page.evaluate(() => window.selIndex))
                    .toBe(manualIndex - 1);
                await page.mouse.down();
                await page.mouse.up();
                await expect(page.locator("#listCaption")).toHaveText(
                    "Choose provider"
                );
                expect(await page.evaluate(() => window.__testEnterCount)).toBe(
                    1
                );
                const back = device === "lg/webos" ? 461 : 8;
                await remoteKey(page, back, "BrowserBack");
                await expect(page.locator("#listCaption")).toHaveText(
                    "First-run setup"
                );
                await remoteKey(page, back, "BrowserBack");
                await expect(page.locator("#listCaption")).toHaveText(
                    "Choose language"
                );
                await remoteKey(page, 13, "Enter");
                await expect(page.locator("#listCaption")).toHaveText(
                    "First-run setup"
                );
                expect(await page.evaluate(() => window.__testEnterCount)).toBe(
                    2
                );
                expect(
                    await page.evaluate(() => window.__testCursor.changes)
                ).toEqual([]);
                expect(errors).toEqual([]);
            }
        );
    }

    test("PC keeps click-to-select then click-to-activate behavior", async ({
        page,
        context,
        baseURL,
    }) => {
        const errors = await bootForMagicRemote(
            page,
            context,
            baseURL,
            "pc",
            true
        );
        const manual = page.locator("#listIn").getByRole("button", {
            exact: true,
            name: "Manual setup",
        });
        const manualIndex = Number(await manual.getAttribute("data-idx"));
        await manual.hover();
        expect(await page.evaluate(() => window.selIndex)).toBe(0);
        await manual.click();
        expect(await page.evaluate(() => window.selIndex)).toBe(manualIndex);
        await expect(page.locator("#listCaption")).toHaveText(
            "First-run setup"
        );
        expect(await page.evaluate(() => window.__testEnterCount)).toBe(0);
        await manual.click();
        await expect(page.locator("#listCaption")).toHaveText(
            "Choose provider"
        );
        expect(await page.evaluate(() => window.__testEnterCount)).toBe(1);
        expect(errors).toEqual([]);
    });
});
