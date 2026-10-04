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
