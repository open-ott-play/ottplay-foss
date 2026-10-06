// Exercise the shipped bundle, real settings UI, logger and outbound transport.
// Only the controller is simulated; all non-local network traffic is intercepted.
const { test, expect } = require("@playwright/test");

const CONTROLLER = "https://diagnostics.fixture.invalid";
const HTTP_CONTROLLER = "http://diagnostics.fixture.invalid";
const DEVICE_TOKEN = "synthetic_browser_device_" + "d".repeat(32);
const RUNTIME_TOKEN = "synthetic_browser_runtime_" + "r".repeat(32);
const EPOCH = "00000000000000000000000000000001";
const RUNTIME = "00000000000000000000000000000002";

async function fixture(page, context, baseURL) {
    const local = new URL(baseURL).origin;
    const observed = {
        blocked: [],
        calls: [],
        errors: [],
        legacy: [],
        localDebug: [],
    };
    let consentEpoch = "";
    let revision = 0;
    let control = null;
    page.on("pageerror", (error) => observed.errors.push(error.message));
    await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === local) {
            if (url.pathname.startsWith("/debug/"))
                observed.localDebug.push(url.pathname);
            return route.continue();
        }
        if (![CONTROLLER, HTTP_CONTROLLER].includes(url.origin)) {
            observed.blocked.push(url.origin + url.pathname);
            return route.abort("blockedbyclient");
        }
        const headers = {
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Origin": local,
        };
        if (request.method() === "OPTIONS")
            return route.fulfill({ headers, status: 204 });
        if (url.pathname === "/api/webhook/commands") {
            observed.legacy.push(request.method());
            return route.fulfill({ headers, json: { commands: [] } });
        }
        const path = url.pathname.replace("/api/v2/diagnostics", "");
        const body = request.postDataJSON();
        observed.calls.push({
            authorization: request.headers().authorization,
            body,
            path,
        });
        const envelope = { diagnostics_protocol: 2, server_epoch: EPOCH };
        let reply;
        let status = 200;
        if (path === "/runtimes") {
            consentEpoch = body.consent.epoch;
            revision = 0;
            control = null;
            status = 201;
            reply = {
                device_id: "browser-fixture",
                limits: {
                    event_bytes_max: 1024,
                    events_body_bytes: 16384,
                    events_per_batch: 32,
                    poll_after_ms: 100,
                    session_lease_ms_max: 600000,
                },
                runtime_credential: RUNTIME_TOKEN,
                runtime_id: RUNTIME,
                runtime_ttl_ms: 600000,
            };
        } else if (path === "/poll") {
            reply = {
                control: body.consent.granted ? control : null,
                control_revision: revision,
                poll_after_ms: 100,
                runtime_id: RUNTIME,
            };
        } else if (path === "/results") {
            if (body.control_revision === revision) control = null;
            reply = { status: "recorded" };
        } else if (path === "/events") {
            reply = {
                accepted_through_seq: body.first_seq + body.events.length - 1,
                dropped_total: 0,
            };
        } else if (path === "/repairs/poll") {
            reply = { repair: null };
        } else {
            status = 404;
            reply = { error: { code: "not_found" } };
        }
        return route.fulfill({
            headers,
            json: { ...envelope, ...reply },
            status,
        });
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
        const intervals = new Set();
        const originalInterval = window.setInterval;
        const originalClear = window.clearInterval;
        window.setInterval = function (...args) {
            const handle = originalInterval.apply(this, args);
            intervals.add(handle);
            return handle;
        };
        window.clearInterval = function (handle) {
            intervals.delete(handle);
            return originalClear.call(this, handle);
        };
        const listeners = [];
        const watched = new Set([
            "visibilitychange",
            "pagehide",
            "beforeunload",
            "freeze",
            "offline",
            "keydown",
        ]);
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        const capture = (value) =>
            typeof value === "boolean" ? value : !!value?.capture;
        EventTarget.prototype.addEventListener = function (
            type,
            listener,
            options
        ) {
            if (
                (this === window || this === document) &&
                watched.has(type) &&
                !listeners.some(
                    (entry) =>
                        entry.target === this &&
                        entry.type === type &&
                        entry.listener === listener &&
                        entry.capture === capture(options)
                )
            )
                listeners.push({
                    capture: capture(options),
                    listener,
                    target: this,
                    type,
                });
            return add.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function (
            type,
            listener,
            options
        ) {
            const index = listeners.findIndex(
                (entry) =>
                    entry.target === this &&
                    entry.type === type &&
                    entry.listener === listener &&
                    entry.capture === capture(options)
            );
            if (index >= 0) listeners.splice(index, 1);
            return remove.call(this, type, listener, options);
        };
        window.__diagnosticBrowserProbe = () => ({
            intervalHandles: Array.from(intervals),
            intervals: intervals.size,
            listeners: listeners
                .map(
                    (entry) =>
                        (entry.target === window ? "window:" : "document:") +
                        entry.type +
                        ":" +
                        entry.capture
                )
                .sort(),
        });
    });
    await page.goto("/f/pc/");
    await expect(page.locator("#listCaption")).toHaveText("First-run setup");
    await page.waitForFunction(
        () => !!window.__ottRemoteDiagnostics && !!window.__ottDebug
    );
    return {
        ...observed,
        start(session) {
            revision += 1;
            control = {
                action: "start",
                consent_epoch: consentEpoch,
                lease_ms: 600000,
                profile: "standard",
                request_id: "request-" + revision,
                session_id: session,
            };
        },
        stop(session) {
            revision += 1;
            control = {
                action: "stop",
                consent_epoch: consentEpoch,
                lease_ms: 0,
                request_id: "request-" + revision,
                session_id: session,
            };
        },
    };
}

async function openRemoteSettings(page) {
    await page.evaluate(() => window.optionsList(window.settingsCommands));
    await expect(page.locator("#listCaption")).toHaveText("Settings");
    await page.keyboard.press("Enter");
    await expect(page.locator("#listCaption")).toHaveText("Remote control");
    await expect(page.locator("#remoteDiagnosticsToggle")).toHaveText(
        "Allow diagnostics for 10 minutes"
    );
}

async function configure(page, address) {
    // This is the production save callback and settings store, not a mocked controller.
    await page.evaluate(
        ({ address, token }) => {
            window.__ottCommandServer.configure({
                address,
                enabled: true,
                token,
            });
        },
        { address, token: DEVICE_TOKEN }
    );
}

test("remote named input cannot grant local diagnostic consent or cross an ACK UI transition", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    const request = (action, params = {}) =>
        page.evaluate(
            ({ action, params }) =>
                new Promise((resolve) => {
                    window.__pendingRemoteInput = null;
                    executeRemoteRequest(
                        { action, params },
                        resolve,
                        (effect) => {
                            window.__pendingRemoteInput = effect;
                        }
                    );
                }),
            { action, params }
        );
    await page.evaluate(() => window.optionsList(window.settingsCommands));
    await expect(page.locator("#listCaption")).toHaveText("Settings");
    const caps = await request("capabilities");
    expect(caps.status).toBe("ok");
    expect(caps.data.player.platform).toBe("browser");
    expect(caps.data.input).toContain("ok");
    expect(caps.data.lifecycle).not.toContain("reboot_device");
    expect(caps.data.lifecycle).not.toContain("exit_app");
    const queued = await request("input", { key: "ok" });
    expect(queued).toMatchObject({
        data: { accepted: true, dispatched: false, effect: "input-after-ack" },
        status: "ok",
    });
    // A real local key opens the consent-bearing screen before the remote ACK.
    await page.keyboard.press("Enter");
    await expect(page.locator("#remoteDiagnosticsToggle")).toBeVisible();
    await page.evaluate(() => window.__pendingRemoteInput());
    for (const key of ["down", "right", "ok", "back"]) {
        expect((await request("input", { key })).status).toBe("rejected");
        expect(
            await page.evaluate(() => window.__pendingRemoteInput)
        ).toBeNull();
    }
    expect((await request("capabilities")).data.input).toEqual([]);
    await expect(page.locator("#remoteDiagnosticsToggle")).toHaveText(
        "Allow diagnostics for 10 minutes"
    );
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().trusted
        )
    ).toBe(false);
    expect(server.calls).toEqual([]);
    expect(server.errors).toEqual([]);
});

test("remote channel steps close a different browsing category and discard its preview", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    const request = (action, params = {}) =>
        page.evaluate(
            ({ action, params }) =>
                new Promise((resolve) =>
                    executeRemoteRequest({ action, params }, resolve)
                ),
            { action, params }
        );
    await page.evaluate(() => {
        window.closeList();
        window.infoBarHide();
        window.settings.preview = 1;
        window.settings.noSmall = 0;
        window.settings.infoSwitch = 0;
        window.settings.stopPlay = 0;
        window.favoritesArray = [];
        window.channels = {};
        for (const [id, name, group] of [
            [101, "Playing first", "Playing category"],
            [102, "Playing middle", "Playing category"],
            [103, "Playing last", "Playing category"],
            [104, "Browsing preview", "Browsing category"],
        ])
            window.channels[id] = {
                category: { name: group },
                channel_name: name,
                url: "https://media.fixture.invalid/" + id + ".m3u8",
            };
        window.cList = [101, 104, 102, 103];
        window.__ottChannels.mount(window);
        window.setCurrent(window.catsArray.indexOf("Playing category"), 0);
        window.commandChannelsReady = true;
        // Only the decoder effect is intercepted. The bundled channel list,
        // preview timer, parental admission, playChannel and closeList are real.
        window.__remoteChannelPlays = [];
        window.stbPlay = (url) => window.__remoteChannelPlays.push(url);
    });
    for (const [operation, id, name, number] of [
        ["previous_channel", 103, "Playing last", 4],
        ["next_channel", 101, "Playing first", 1],
    ]) {
        await page.evaluate(() => {
            _channelsList(window.catsArray.indexOf("Browsing category"), 0);
            window.previewChId(104);
        });
        await expect(page.locator("#list_window")).toBeVisible();
        await expect(page.locator("#list")).toContainText("Browsing preview");
        await expect
            .poll(() =>
                page.evaluate(
                    () => window.previewChan && window.previewChan.ch_id
                )
            )
            .toBe(104);
        expect(
            await page.evaluate(() => ({
                browsing: window.catsArray[window.listCatIndex],
                playing: window.catsArray[window.catIndex],
            }))
        ).toEqual({
            browsing: "Browsing category",
            playing: "Playing category",
        });
        const caps = await request("capabilities");
        expect(caps.status).toBe("ok");
        expect(caps.data.playback).toEqual(
            expect.arrayContaining(["previous_channel", "next_channel"])
        );
        const before = await page.evaluate(
            () => window.__remoteChannelPlays.length
        );
        expect(await request("playback", { operation })).toEqual({
            data: {
                channel: { id, name, number },
                dispatched: true,
                operation,
            },
            status: "ok",
        });
        await expect(page.locator("#list")).toBeHidden();
        await expect(page.locator("#list_window")).toBeHidden();
        await expect(page.locator("#list_osd")).toBeHidden();
        expect(
            await page.evaluate(() => ({
                channel: window.curList[window.primaryIndex],
                group: window.catsArray[window.catIndex],
                preview: window.previewChan,
                visible: window.isListVisible,
            }))
        ).toEqual({
            channel: id,
            group: "Playing category",
            preview: null,
            visible: false,
        });
        expect(
            await page.evaluate(
                (start) => window.__remoteChannelPlays.slice(start),
                before
            )
        ).toEqual(["https://media.fixture.invalid/" + id + ".m3u8"]);
    }
    expect(
        await page.evaluate(() => {
            window.settings.psChannels = 1;
            window.settings.psOptions = 0;
            window.settings.requirePinForProviderSelection = 0;
            window.parentPIN = "1234";
            window.__ottParental.revoke();
            const locked = window.__ottChannels.change("lock", 104, true);
            _channelsList(window.catsArray.indexOf("Browsing category"), 0);
            window.__remotePipPlays = [];
            window.stbPlayPip = (url) => window.__remotePipPlays.push(url);
            window.pipCatIndex = window.catsArray.indexOf("Browsing category");
            window.pipIndex = window.cats["Browsing category"].indexOf(104);
            return {
                locked,
                needsPin: window.__ottParental.needs("channels"),
                preview: window.sNoSmall,
            };
        })
    ).toEqual({ locked: true, needsPin: true, preview: 0 });
    await expect(page.locator("#list_window")).toBeVisible();
    const pipBefore = await page.evaluate(
        () => window.__remoteChannelPlays.length
    );
    expect(
        await request("playback", { operation: "next_channel" })
    ).toMatchObject({
        data: {
            channel: { id: 102, name: "Playing middle", number: 3 },
            dispatched: true,
        },
        status: "ok",
    });
    await expect(page.locator("#list")).toBeHidden();
    await expect(page.locator("#dialogbox")).toBeHidden();
    await expect(page.locator("#listEdit")).toBeHidden();
    expect(await page.evaluate(() => window.__remotePipPlays)).toEqual([]);
    expect(
        await page.evaluate(
            (start) => window.__remoteChannelPlays.slice(start),
            pipBefore
        )
    ).toEqual(["https://media.fixture.invalid/102.m3u8"]);

    await page.evaluate(() => window.infoBox("Local modal must remain open"));
    await expect(page.locator("#dialogbox")).toBeVisible();
    const before = await page.evaluate(
        () => window.__remoteChannelPlays.length
    );
    expect(
        (await request("playback", { operation: "next_channel" })).status
    ).toBe("rejected");
    expect((await request("capabilities")).data.playback).not.toContain(
        "next_channel"
    );
    await expect(page.locator("#dialogbox")).toBeVisible();
    expect(await page.evaluate(() => window.__remoteChannelPlays.length)).toBe(
        before
    );
    expect(await page.evaluate(() => window.curList[window.primaryIndex])).toBe(
        102
    );
    expect(server.calls).toEqual([]);
    expect(server.errors).toEqual([]);
});

test("remote navigation cannot enter or confirm legacy exit while local controls still work", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await page.evaluate(() => {
        window.closeList();
        window.infoBarHide();
        window.settings.eFun = 1;
        window.__remoteExitCount = 0;
        // Keep the production UI and admission; intercept only the native exit.
        window.stbExit = () => window.__remoteExitCount++;
    });
    const input = (key) =>
        page.evaluate(
            (key) =>
                new Promise((resolve) => {
                    let effect;
                    executeRemoteRequest(
                        { action: "input", params: { key } },
                        (result) => {
                            if (effect) effect();
                            resolve(result);
                        },
                        (pending) => {
                            effect = pending;
                        }
                    );
                }),
            key
        );
    expect((await input("back")).status).toBe("ok");
    await expect(page.locator("#dialogbox")).toBeHidden();
    expect(await page.evaluate(() => window.__remoteExitCount)).toBe(0);
    await page.evaluate(() => window.exitPortal());
    await expect(page.locator("#dialogbox")).toBeVisible();
    expect((await input("ok")).status).toBe("rejected");
    await expect(page.locator("#dialogbox")).toBeVisible();
    expect(await page.evaluate(() => window.__remoteExitCount)).toBe(0);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.__remoteExitCount)).toBe(1);
    await expect(page.locator("#dialogbox")).toBeHidden();
    // Private settings transfers remain local, including a dialog layered
    // above their owner. A remote key must not consume its confirmation.
    await page.evaluate(() => window.settingsManage());
    expect((await input("ok")).status).toBe("rejected");
    await page.evaluate(() => {
        window.__remoteConfirmationCount = 0;
        window.confirmBox(
            "Fixture confirmation",
            () => window.__remoteConfirmationCount++
        );
    });
    expect((await input("ok")).status).toBe("rejected");
    expect(await page.evaluate(() => window.__remoteConfirmationCount)).toBe(0);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.__remoteConfirmationCount)).toBe(1);
    expect(server.errors).toEqual([]);
});

for (const trusted of [false, true]) {
    test(`locked kiosk permits local ${trusted ? "STOP-key trusted" : "indicator temporary"} support revocation`, async ({
        page,
        context,
        baseURL,
    }) => {
        const server = await fixture(page, context, baseURL);
        await configure(page, CONTROLLER);
        await openRemoteSettings(page);
        await page
            .locator(
                trusted ? "#remoteDiagnosticsTrust" : "#remoteDiagnosticsToggle"
            )
            .click();
        await expect
            .poll(
                () =>
                    server.calls.filter((call) => call.path === "/runtimes")
                        .length
            )
            .toBe(1);
        server.start("kiosk-local-stop");
        await expect
            .poll(() => page.evaluate(() => window.__ottDebug.enabled))
            .toBe(true);
        // Restore a real persisted policy without requiring a provider or decoder.
        // The production kiosk capture listeners and key dispatcher remain intact.
        await page.evaluate(() => {
            window.stbSetItem(
                "__ottKioskV1",
                JSON.stringify({
                    channel: { id: "fixture-channel", name: "Fixture channel" },
                    provider: "fixture",
                    source: "fixture-source",
                })
            );
            window.__ottKiosk.init();
            window.closeList();
        });
        expect(await page.evaluate(() => window.__ottKiosk.locked())).toBe(
            true
        );
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
        expect(
            await page.evaluate(
                () => window.__ottRemoteDiagnostics.status().enabled
            )
        ).toBe(true);
        if (trusted) {
            // The desktop adapter's S key maps to the logical TV STOP action.
            await page.keyboard.press("s");
        } else {
            await page.locator("#remoteDiagnosticsIndicator").click();
        }
        await expect(page.locator("#remoteDiagnosticsIndicator")).toHaveCount(
            0
        );
        await expect
            .poll(() =>
                page.evaluate(
                    () => window.__ottRemoteDiagnostics.status().pending
                )
            )
            .toBe(false);
        expect(
            await page.evaluate(() => ({
                collecting: window.__ottDebug.enabled,
                enabled: window.__ottRemoteDiagnostics.status().enabled,
                locked: window.__ottKiosk.locked(),
                trusted: window.__ottRemoteDiagnostics.status().trusted,
            }))
        ).toEqual({
            collecting: false,
            enabled: false,
            locked: true,
            trusted: false,
        });
        await expect
            .poll(() =>
                server.calls.some(
                    (call) =>
                        call.path === "/poll" &&
                        call.body.consent.granted === false
                )
            )
            .toBe(true);
        expect(server.errors).toEqual([]);
    });
}

test("offline locked kiosk keeps trusted support locally revocable", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await configure(page, CONTROLLER);
    await openRemoteSettings(page);
    await page.locator("#remoteDiagnosticsTrust").click();
    const registrations = () =>
        server.calls.filter((call) => call.path === "/runtimes");
    await expect.poll(() => registrations().length).toBe(1);
    server.start("offline-kiosk-revoke");
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(true);
    const policy = await page.evaluate(() => {
        const saved = JSON.stringify({
            channel: { id: "fixture-channel", name: "Fixture channel" },
            provider: "fixture",
            source: "fixture-source",
        });
        window.stbSetItem("__ottKioskV1", saved);
        window.__ottKiosk.init();
        window.closeList();
        return saved;
    });
    await context.setOffline(true);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const status = window.__ottRemoteDiagnostics.status();
                return {
                    collecting: window.__ottDebug.enabled,
                    enabled: status.enabled,
                    locked: window.__ottKiosk.locked(),
                    pending: status.pending,
                    state: status.state,
                    trusted: status.trusted,
                };
            })
        )
        .toEqual({
            collecting: false,
            enabled: false,
            locked: true,
            pending: true,
            state: "suspended",
            trusted: true,
        });
    const indicator = page.locator("#remoteDiagnosticsIndicator");
    await expect(indicator).toBeVisible();
    await indicator.click();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const status = window.__ottRemoteDiagnostics.status();
                return {
                    enabled: status.enabled,
                    pending: status.pending,
                    trusted: status.trusted,
                };
            })
        )
        .toEqual({ enabled: false, pending: false, trusted: false });
    await expect(indicator).toHaveCount(0);
    expect(
        await page.evaluate(() => ({
            collecting: window.__ottDebug.enabled,
            locked: window.__ottKiosk.locked(),
            policy: window.stbGetItem("__ottKioskV1"),
        }))
    ).toEqual({ collecting: false, locked: true, policy });
    await context.setOffline(false);
    await page.waitForTimeout(1200);
    expect(registrations()).toHaveLength(1);
    // Remove only this synthetic policy so the normal first-run boot can resume.
    await page.evaluate(() => window.stbSetItem("__ottKioskV1", "null"));
    await page.reload();
    await page.waitForFunction(
        () =>
            window.__ottRemoteDiagnostics &&
            !window.__ottRemoteDiagnostics.status().pending
    );
    await page.waitForTimeout(1200);
    expect(registrations()).toHaveLength(1);
    expect(
        await page.evaluate(() => ({
            collecting: window.__ottDebug.enabled,
            enabled: window.__ottRemoteDiagnostics.status().enabled,
            trusted: window.__ottRemoteDiagnostics.status().trusted,
        }))
    ).toEqual({ collecting: false, enabled: false, trusted: false });
    expect(server.errors).toEqual([]);
});

test("failed durable revocation stays visible and retryable in a locked kiosk", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await configure(page, CONTROLLER);
    await openRemoteSettings(page);
    await page.locator("#remoteDiagnosticsTrust").click();
    const registrations = () =>
        server.calls.filter((call) => call.path === "/runtimes");
    await expect.poll(() => registrations().length).toBe(1);
    server.start("durable-revoke-failure");
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(true);
    await page.evaluate(() => {
        window.stbSetItem(
            "__ottKioskV1",
            JSON.stringify({
                channel: { id: "fixture-channel", name: "Fixture channel" },
                provider: "fixture",
                source: "fixture-source",
            })
        );
        window.__ottKiosk.init();
        window.closeList();
        const transaction = IDBDatabase.prototype.transaction;
        const erase = IDBFactory.prototype.deleteDatabase;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
            if (
                this.name === "ottplay-diagnostics-permission-v1" &&
                mode === "readwrite"
            )
                throw new DOMException(
                    "Synthetic device storage failure",
                    "UnknownError"
                );
            return transaction.call(this, stores, mode, ...rest);
        };
        IDBFactory.prototype.deleteDatabase = function (name) {
            if (name === "ottplay-diagnostics-permission-v1")
                throw new DOMException(
                    "Synthetic deletion failure",
                    "UnknownError"
                );
            return erase.call(this, name);
        };
        window.__restoreDiagnosticStorage = () => {
            IDBDatabase.prototype.transaction = transaction;
            IDBFactory.prototype.deleteDatabase = erase;
        };
    });
    const indicator = page.locator("#remoteDiagnosticsIndicator");
    for (let attempt = 0; attempt < 2; attempt++) {
        await indicator.click();
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const status = window.__ottRemoteDiagnostics.status();
                    return { pending: status.pending, state: status.state };
                })
            )
            .toEqual({ pending: false, state: "storage-error" });
        await expect(indicator).toBeVisible();
        await expect(indicator).toContainText("could not be removed");
        await expect(indicator).toContainText("Retry");
        await page.evaluate(() => {
            window.__ottRemoteDiagnostics.setEnabled(true);
            window.__ottRemoteDiagnostics.setTrusted(true);
        });
        expect(
            await page.evaluate(() => ({
                capture: window.__ottDebug.enabled,
                enabled: window.__ottRemoteDiagnostics.status().enabled,
                locked: window.__ottKiosk.locked(),
            }))
        ).toEqual({ capture: false, enabled: false, locked: true });
    }
    await page.evaluate(() => window.__restoreDiagnosticStorage());
    await indicator.click();
    await expect(indicator).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottRemoteDiagnostics.status().pending)
        )
        .toBe(false);
    expect(await page.evaluate(() => window.__ottKiosk.locked())).toBe(true);
    // Remove only this synthetic kiosk fixture so boot can resume normally.
    await page.evaluate(() => window.stbSetItem("__ottKioskV1", "null"));
    await page.reload();
    await page.waitForFunction(
        () =>
            window.__ottRemoteDiagnostics &&
            !window.__ottRemoteDiagnostics.status().pending
    );
    await page.waitForTimeout(1200);
    expect(registrations()).toHaveLength(1);
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().trusted
        )
    ).toBe(false);
    expect(server.errors).toEqual([]);
});

test("unreadable saved permission is not forgotten during temporary support revocation", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await configure(page, CONTROLLER);
    await openRemoteSettings(page);
    await page.locator("#remoteDiagnosticsTrust").click();
    const registrations = () =>
        server.calls.filter((call) => call.path === "/runtimes");
    await expect.poll(() => registrations().length).toBe(1);
    await page.evaluate(() =>
        sessionStorage.setItem("permission-fault-once", "1")
    );
    await page.addInitScript(() => {
        if (sessionStorage.getItem("permission-fault-once") !== "1") return;
        sessionStorage.removeItem("permission-fault-once");
        const transaction = IDBDatabase.prototype.transaction;
        const erase = IDBFactory.prototype.deleteDatabase;
        IDBDatabase.prototype.transaction = function (...args) {
            if (this.name === "ottplay-diagnostics-permission-v1")
                throw new DOMException(
                    "Synthetic unreadable storage",
                    "UnknownError"
                );
            return transaction.apply(this, args);
        };
        IDBFactory.prototype.deleteDatabase = function (name) {
            if (name === "ottplay-diagnostics-permission-v1")
                throw new DOMException(
                    "Synthetic deletion failure",
                    "UnknownError"
                );
            return erase.call(this, name);
        };
        window.__restoreDiagnosticStorage = () => {
            IDBDatabase.prototype.transaction = transaction;
            IDBFactory.prototype.deleteDatabase = erase;
        };
    });
    await page.reload();
    await page.waitForFunction(
        () =>
            window.__ottRemoteDiagnostics &&
            !window.__ottRemoteDiagnostics.status().pending
    );
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().trusted
        )
    ).toBe(false);
    expect(registrations()).toHaveLength(1);
    // Explicit temporary support does not prove absence of the unreadable old grant.
    await page.evaluate(() => window.__ottRemoteDiagnostics.setEnabled(true));
    await expect.poll(() => registrations().length).toBe(2);
    await page.evaluate(() => window.__ottRemoteDiagnostics.setEnabled(false));
    const indicator = page.locator("#remoteDiagnosticsIndicator");
    await expect(indicator).toContainText("could not be removed");
    await expect(indicator).toContainText("Retry");
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().enabled
        )
    ).toBe(false);
    await page.evaluate(() => window.__restoreDiagnosticStorage());
    await indicator.click();
    await expect(indicator).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottRemoteDiagnostics.status().pending)
        )
        .toBe(false);
    await page.reload();
    await page.waitForFunction(
        () =>
            window.__ottRemoteDiagnostics &&
            !window.__ottRemoteDiagnostics.status().pending
    );
    await page.waitForTimeout(1200);
    expect(registrations()).toHaveLength(2);
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().trusted
        )
    ).toBe(false);
    expect(server.errors).toEqual([]);
});

test("remote diagnostics is opt-in, captures only an authorized runtime and stops cleanly", async ({
    page,
    context,
    baseURL,
}, testInfo) => {
    const server = await fixture(page, context, baseURL);
    expect(
        await page.evaluate(() => window.__ottDebug.snapshot().enabled)
    ).toBe(false);
    expect(server.calls).toEqual([]);
    await openRemoteSettings(page);
    await expect(page.locator("#remoteDiagnosticsStatus")).toHaveText(
        "Remote diagnostics is off."
    );
    await expect(page.locator("#remoteDiagnosticsIndicator")).toHaveCount(0);
    await configure(page, CONTROLLER);
    await expect.poll(() => server.legacy.length).toBeGreaterThan(0);
    expect(server.calls).toEqual([]);
    const baseline = await page.evaluate(() =>
        window.__diagnosticBrowserProbe()
    );
    await page.locator("#remoteDiagnosticsToggle").click();
    await expect
        .poll(
            () =>
                server.calls.filter((call) => call.path === "/runtimes").length
        )
        .toBe(1);
    await expect(page.locator("#remoteDiagnosticsToggle")).toHaveText(
        "Stop diagnostics"
    );
    await expect(page.locator("#remoteDiagnosticsStatus")).toContainText(
        "ready for an authorized operator"
    );
    expect(await page.evaluate(() => window.__ottDebug.enabled)).toBe(false);
    server.start("session-one");
    await expect(page.locator("#remoteDiagnosticsIndicator")).toContainText(
        "collecting for this page"
    );
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(true);
    await expect
        .poll(
            () => server.calls.filter((call) => call.path === "/events").length
        )
        .toBeGreaterThan(0);
    const active = await page.evaluate(() => window.__diagnosticBrowserProbe());
    expect(active.intervals).toBeGreaterThan(baseline.intervals);
    expect(active.listeners.length).toBeGreaterThan(baseline.listeners.length);
    const screenshot = testInfo.outputPath("remote-diagnostics-active.png");
    await page.screenshot({ fullPage: true, path: screenshot });
    await testInfo.attach("remote diagnostics collecting", {
        contentType: "image/png",
        path: screenshot,
    });

    server.stop("session-one");
    await expect
        .poll(() =>
            server.calls.some(
                (call) =>
                    call.path === "/results" &&
                    call.body.request_id === "request-2" &&
                    call.body.status === "applied"
            )
        )
        .toBe(true);
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(false);
    await expect(page.locator("#remoteDiagnosticsIndicator")).toContainText(
        "ready for an authorized operator"
    );
    server.start("session-two");
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(true);
    await page.locator("#remoteDiagnosticsToggle").click();
    await expect(page.locator("#remoteDiagnosticsToggle")).toHaveText(
        "Allow diagnostics for 10 minutes"
    );
    await expect(page.locator("#remoteDiagnosticsIndicator")).toHaveCount(0);
    expect(
        await page.evaluate(() => window.__ottDebug.snapshot().enabled)
    ).toBe(false);
    const stopped = await page.evaluate(() =>
        window.__diagnosticBrowserProbe()
    );
    expect(stopped.listeners).toEqual(baseline.listeners);
    // An unrelated boot interval may finish during capture. Every surviving
    // interval must still be from before capture; no new handle may leak.
    expect(
        stopped.intervalHandles.every((handle) =>
            baseline.intervalHandles.includes(handle)
        )
    ).toBe(true);
    await expect
        .poll(() =>
            server.calls.some(
                (call) =>
                    call.path === "/poll" && call.body.consent.granted === false
            )
        )
        .toBe(true);
    const stoppedUploads = server.calls.filter(
        (call) => call.path === "/events"
    ).length;
    await page.waitForTimeout(1200);
    expect(server.calls.filter((call) => call.path === "/events").length).toBe(
        stoppedUploads
    );
    expect(
        server.calls.filter((call) => call.path === "/runtimes")[0]
            .authorization
    ).toBe("Bearer " + DEVICE_TOKEN);
    expect(
        server.calls
            .filter((call) => call.path !== "/runtimes")
            .every((call) => call.authorization === "Bearer " + RUNTIME_TOKEN)
    ).toBe(true);
    expect(server.errors).toEqual([]);
    expect(server.localDebug).toEqual([]);
});

test("a saved controller connection never restores diagnostic consent after reload", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await configure(page, CONTROLLER);
    await openRemoteSettings(page);
    await page.locator("#remoteDiagnosticsToggle").click();
    await expect(page.locator("#remoteDiagnosticsIndicator")).toContainText(
        "ready for an authorized operator"
    );
    server.start("before-reload");
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(true);
    await page.reload();
    await expect(page.locator("#listCaption")).toHaveText("First-run setup");
    await expect(page.locator("#remoteDiagnosticsIndicator")).toHaveCount(0);
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().enabled
        )
    ).toBe(false);
    expect(await page.evaluate(() => window.__ottDebug.enabled)).toBe(false);
    await openRemoteSettings(page);
    await expect(page.locator("#commandServerTokenPresence")).toHaveText(
        "saved on this device"
    );
    const registrations = server.calls.filter(
        (call) => call.path === "/runtimes"
    ).length;
    await page.waitForTimeout(1200);
    expect(
        server.calls.filter((call) => call.path === "/runtimes").length
    ).toBe(registrations);
    expect(server.errors).toEqual([]);
});

test("remote diagnostics rejects an HTTP controller without enabling capture", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await configure(page, HTTP_CONTROLLER);
    await openRemoteSettings(page);
    await page.locator("#remoteDiagnosticsToggle").click();
    await expect(page.locator("#remoteDiagnosticsStatus")).toHaveText(
        "Use an HTTPS command server for remote diagnostics."
    );
    await expect(page.locator("#remoteDiagnosticsToggle")).toHaveText(
        "Allow diagnostics for 10 minutes"
    );
    expect(await page.evaluate(() => window.__ottDebug.enabled)).toBe(false);
    await expect(page.locator("#remoteDiagnosticsIndicator")).toHaveCount(0);
    expect(server.calls).toEqual([]);
    expect(server.errors).toEqual([]);
});

test("trusted support survives reload and network recovery, but never restores a capture", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await configure(page, CONTROLLER);
    await openRemoteSettings(page);
    await page.locator("#remoteDiagnosticsTrust").click();
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottRemoteDiagnostics.status().trusted)
        )
        .toBe(true);
    const registrations = () =>
        server.calls.filter((call) => call.path === "/runtimes");
    await expect.poll(() => registrations().length).toBe(1);
    expect(registrations()[0].body.capabilities).toContain("repairs");
    server.start("trusted-before-reload");
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(true);
    await page.reload();
    await expect.poll(() => registrations().length).toBe(2);
    expect(registrations()[1].body.consent.epoch).not.toBe(
        registrations()[0].body.consent.epoch
    );
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().trusted
        )
    ).toBe(true);
    expect(await page.evaluate(() => window.__ottDebug.enabled)).toBe(false);
    await context.setOffline(true);
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottRemoteDiagnostics.status().enabled)
        )
        .toBe(false);
    await context.setOffline(false);
    await expect.poll(() => registrations().length, { timeout: 15000 }).toBe(3);
    expect(registrations()[2].body.consent.epoch).not.toBe(
        registrations()[1].body.consent.epoch
    );
    expect(await page.evaluate(() => window.__ottDebug.enabled)).toBe(false);
    await page.evaluate(() => window.optionsList(window.settingsCommands));
    await page.keyboard.press("Enter");
    await expect(page.locator("#remoteDiagnosticsTrust")).toHaveText(
        "Disable trusted remote support"
    );
    server.start("trusted-second-capture");
    await expect
        .poll(() => page.evaluate(() => window.__ottDebug.enabled))
        .toBe(true);
    await page.locator("#remoteDiagnosticsStopSession").click();
    await expect.poll(() => registrations().length).toBe(4);
    expect(await page.evaluate(() => window.__ottDebug.enabled)).toBe(false);
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().trusted
        )
    ).toBe(true);
    await page.locator("#remoteDiagnosticsTrust").click();
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottRemoteDiagnostics.status().pending)
        )
        .toBe(false);
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().trusted
        )
    ).toBe(false);
    await page.reload();
    await page.waitForFunction(
        () =>
            window.__ottRemoteDiagnostics &&
            !window.__ottRemoteDiagnostics.status().pending
    );
    await page.waitForTimeout(1200);
    expect(registrations()).toHaveLength(4);
    expect(
        await page.evaluate(
            () => window.__ottRemoteDiagnostics.status().enabled
        )
    ).toBe(false);
    expect(server.errors).toEqual([]);
});

test("revoking installation trust stops another already connected tab", async ({
    page,
    context,
    baseURL,
}) => {
    const server = await fixture(page, context, baseURL);
    await configure(page, CONTROLLER);
    await openRemoteSettings(page);
    await page.locator("#remoteDiagnosticsTrust").click();
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottRemoteDiagnostics.status().trusted)
        )
        .toBe(true);
    const other = await context.newPage();
    await other.goto("/f/pc/");
    await other.waitForFunction(
        () => window.__ottRemoteDiagnostics?.status().trusted
    );
    await expect
        .poll(() =>
            other.evaluate(() => window.__ottRemoteDiagnostics.status().enabled)
        )
        .toBe(true);
    const registrations = () =>
        server.calls.filter((call) => call.path === "/runtimes").length;
    await expect.poll(registrations).toBe(2);
    await page.locator("#remoteDiagnosticsTrust").click();
    await expect
        .poll(
            () =>
                other.evaluate(
                    () => window.__ottRemoteDiagnostics.status().trusted
                ),
            { timeout: 10000 }
        )
        .toBe(false);
    expect(
        await other.evaluate(
            () => window.__ottRemoteDiagnostics.status().enabled
        )
    ).toBe(false);
    await other.reload();
    await other.waitForFunction(
        () =>
            window.__ottRemoteDiagnostics &&
            !window.__ottRemoteDiagnostics.status().pending
    );
    await other.waitForTimeout(1200);
    expect(registrations()).toBe(2);
    await other.close();
    expect(server.errors).toEqual([]);
});
