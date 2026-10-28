// Production bundles and authenticated command polling; no live providers.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const TOKEN = "synthetic_favorites_" + "d".repeat(32);
const STREAM = "https://favorites-stream.fixture";
const media = path.resolve(__dirname, "../fixtures/media-runtime");
const recoveryFixtureSources = Object.fromEntries(
    [
        "src/storage/favorites-physical-storage.ts",
        "src/settings/favorites-operation-receipts.ts",
        "src/settings/favorites-recovery-codec.ts",
        "src/commands/favorites-recovery.ts",
    ].map((file) => [
        path.basename(file, ".ts"),
        require("typescript").transpileModule(
            fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"),
            { compilerOptions: { module: 1, target: 1 } }
        ).outputText,
    ])
);

test.use({
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

test("physical favorites recovery acknowledges exact pending rows after real writer settlement or realm closure", async ({
    page,
    context,
    baseURL,
}) => {
    const fixture = new URL("/__favorites_physical_guard", baseURL).href;
    await context.route(fixture, (route) =>
        route.fulfill({
            body: "<!doctype html><title>Favorites recovery guard fixture</title>",
            contentType: "text/html",
        })
    );
    const other = await context.newPage();
    for (const [target, runtime] of [
        [page, "writer-runtime"],
        [other, "observer-runtime"],
    ]) {
        await target.goto(fixture);
        await target.evaluate(
            async ({ sources, runtime }) => {
                const modules = {};
                function load(name) {
                    name = name.split("/").pop();
                    if (!Object.prototype.hasOwnProperty.call(sources, name))
                        throw Error("Unknown recovery fixture module: " + name);
                    if (modules[name]) return modules[name];
                    const exports = {};
                    modules[name] = exports;
                    new Function("exports", "require", sources[name])(
                        exports,
                        load
                    );
                    return exports;
                }
                const key = "favorites-receipts.v1";
                const utf8 = (text) => new TextEncoder().encode(text);
                const sha256 = async (text) =>
                    Array.from(
                        new Uint8Array(
                            await crypto.subtle.digest("SHA-256", utf8(text))
                        )
                    )
                        .map((byte) => byte.toString(16).padStart(2, "0"))
                        .join("");
                const physical = load("favorites-physical-storage");
                const grant = physical.createFavoritesPhysicalStorageGrant(
                    window,
                    window.localStorage,
                    () => true
                );
                const reader = physical.createFavoritesPhysicalStorageRead(
                    window,
                    window.localStorage,
                    () => true
                );
                if (!grant || !reader)
                    throw Error(
                        "Actual localStorage/WebLocks guard unavailable"
                    );
                const codec = load(
                    "favorites-recovery-codec"
                ).createFavoritesRecoveryCodec({ sha256 });
                const backendProof = await codec.backendProof(grant);
                const fence = {
                    backendProof,
                    guardImplementationVersion: 1,
                    version: 2,
                };
                let writerActive = false;
                const receipts = load(
                    "favorites-operation-receipts"
                ).createFavoritesOperationReceipts({
                    compareAndSwap: (before, after) =>
                        grant.compareAndSwap(
                            key,
                            before,
                            after,
                            () => writerActive && grant.current()
                        ),
                    current: () => true,
                    fence: () => fence,
                    now: () => Date.now(),
                    persistedRead: () => reader.read(key),
                    read: () => reader.read(key),
                    writeGuard: (value) =>
                        writerActive &&
                        grant.current() &&
                        JSON.stringify(value) === JSON.stringify(fence),
                });
                const dispatcher = load(
                    "favorites-recovery"
                ).createFavoritesRecoveryDispatcher({
                    current: () => true,
                    host: {
                        physicalStorage: () => grant,
                        recoveryStorage: () => reader,
                    },
                    now: () => Date.now(),
                    runtime: () => runtime,
                    sha256,
                    utf8,
                });
                const scope = {
                    profileBindingId: "00000000-0000-4000-8000-000000000010",
                    provider: "plex",
                    sourceBindingId: "00000000-0000-4000-8000-000000000011",
                };
                window.recoveryFixture = {
                    events: [],
                    async execute(params) {
                        const request = { op: "recovery", runtime, ...params };
                        try {
                            const value = await dispatcher.execute(
                                request,
                                () => true,
                                Date.now() + 5000
                            );
                            if (
                                !load(
                                    "favorites-recovery"
                                ).validFavoritesRecoveryResponse(value, request)
                            )
                                throw Error("Invalid actual recovery result");
                            return value;
                        } catch (error) {
                            return { error: error.message };
                        }
                    },
                    grant,
                    key,
                    receipts,
                    scope,
                    async startWriter(operationId) {
                        this.entered = false;
                        this.heldAck = null;
                        this.work = grant.exclusive(async () => {
                            writerActive = true;
                            try {
                                this.ticket = receipts.reserve(
                                    {
                                        operationId,
                                        payloadHash: await sha256(
                                            "synthetic-favorites-" + operationId
                                        ),
                                        refs: {
                                            runtimeId: runtime,
                                            stageId: operationId,
                                        },
                                        scope,
                                    },
                                    { freshAdmission: true }
                                );
                                // The owner may compute a private plan while held; the public observer must still get busy.
                                const view = await codec.inspect(
                                    reader.read(key),
                                    {
                                        backendProof,
                                        operationId,
                                        runtime: "observer-runtime",
                                    }
                                );
                                this.heldAck = {
                                    accept_unknown: true,
                                    acknowledgement_id: view.acknowledgementId,
                                    after_ledger_sha256: view.afterLedgerSha256,
                                    backend_proof: backendProof,
                                    expected_ledger_revision:
                                        view.ledgerRevision,
                                    mode: "acknowledge",
                                    op: "recovery",
                                    operation_id: operationId,
                                    original_entry_sha256:
                                        view.record.original_entry_sha256,
                                    plan_sha256: view.planDigest,
                                    reason: "accept-unknown-no-replay",
                                    runtime: "observer-runtime",
                                    scope: view.record.scope,
                                };
                                this.entered = true;
                                await new Promise((resolve) => {
                                    this.settle = resolve;
                                });
                            } finally {
                                writerActive = false;
                            }
                        });
                        this.rpcResult = await Promise.race([
                            this.work,
                            new Promise((resolve) =>
                                setTimeout(() => resolve("unknown"), 20)
                            ),
                        ]);
                    },
                };
                window.addEventListener("storage", (event) => {
                    if (event.key === key)
                        window.recoveryFixture.events.push({
                            key: event.key,
                            value: event.newValue,
                        });
                });
            },
            { runtime, sources: recoveryFixtureSources }
        );
    }
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await other.evaluate(() => localStorage.length)).toBe(0);
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    async function heldBusy(operationId) {
        await page.evaluate(
            (id) => window.recoveryFixture.startWriter(id),
            operationId
        );
        await page.waitForFunction(
            () =>
                window.recoveryFixture.entered && window.recoveryFixture.heldAck
        );
        expect(
            await page.evaluate(() => window.recoveryFixture.rpcResult)
        ).toBe("unknown");
        await other.waitForFunction(
            (id) =>
                window.recoveryFixture.events.some((event) =>
                    JSON.parse(event.value).entries.some(
                        (row) => row.operationId === id
                    )
                ),
            operationId
        );
        const initialPlan = await page.evaluate(
            () => window.recoveryFixture.heldAck
        );
        await page.evaluate(
            () => new Promise((resolve) => setTimeout(resolve, 0))
        );
        const writerEvents = await page.evaluate(
            () => window.recoveryFixture.events.length
        );
        const before = await other.evaluate(() => ({
            events: window.recoveryFixture.events.length,
            raw: localStorage.getItem(window.recoveryFixture.key),
        }));
        expect(
            await other.evaluate(
                (id) =>
                    window.recoveryFixture.execute({
                        mode: "inspect",
                        operation_id: id,
                    }),
                operationId
            )
        ).toEqual({ error: "busy" });
        // Exactly one initial ACK attempt, never a polling/retry loop.
        expect(
            await other.evaluate(
                (plan) => window.recoveryFixture.execute(plan),
                initialPlan
            )
        ).toEqual({ error: "busy" });
        expect(
            await other.evaluate(() =>
                localStorage.getItem(window.recoveryFixture.key)
            )
        ).toBe(before.raw);
        // Storage events are cross-document: observe the writer too, never patch native storage.
        await page.waitForTimeout(50);
        expect(
            await other.evaluate(() => window.recoveryFixture.events.length)
        ).toBe(before.events);
        expect(
            await page.evaluate(() => window.recoveryFixture.events.length)
        ).toBe(writerEvents);
        return before.raw;
    }
    async function inspectAndAcknowledge(operationId) {
        let inspected;
        // Only read-only inspect is polled while actual Web Locks releases ownership.
        await expect
            .poll(async () => {
                inspected = await other.evaluate(
                    (id) =>
                        window.recoveryFixture.execute({
                            mode: "inspect",
                            operation_id: id,
                        }),
                    operationId
                );
                return inspected.acknowledge_allowed === true;
            })
            .toBe(true);
        expect(inspected.record.original_state).toBe("pending");
        expect(inspected.record.original_outcome).toBe("unknown");
        const request = {
            accept_unknown: true,
            acknowledgement_id: inspected.acknowledgement_id,
            after_ledger_sha256: inspected.after_ledger_sha256,
            backend_proof: inspected.backend_proof,
            expected_ledger_revision: inspected.ledger_revision,
            mode: "acknowledge",
            operation_id: operationId,
            original_entry_sha256: inspected.record.original_entry_sha256,
            plan_sha256: inspected.plan_sha256,
            reason: "accept-unknown-no-replay",
            scope: inspected.record.scope,
        };
        // One exact ACK from a fresh PUBLIC inspect; no mutation retry.
        const acknowledged = await other.evaluate(
            (params) => window.recoveryFixture.execute(params),
            request
        );
        expect(acknowledged.acknowledged).toBe(true);
        expect(acknowledged.persistence).toBe("persistent");
        expect(acknowledged.ledger_revision).toBe(
            inspected.after_ledger_sha256
        );
        expect(acknowledged.record.original_state).toBe("pending");
        expect(acknowledged.record.original_outcome).toBe("unknown");
        expect(acknowledged.record.original_entry_sha256).toBe(
            inspected.record.original_entry_sha256
        );
        expect(acknowledged.record.acknowledgement.acknowledgement_id).toBe(
            inspected.acknowledgement_id
        );
        const observed = await other.evaluate(
            (id) =>
                window.recoveryFixture.execute({
                    mode: "inspect",
                    operation_id: id,
                }),
            operationId
        );
        expect(observed.acknowledge_allowed).toBe(false);
        expect(observed.record.acknowledgement).toEqual(
            acknowledged.record.acknowledgement
        );
        return acknowledged;
    }
    await heldBusy(first);
    await page.evaluate(async () => {
        window.recoveryFixture.settle();
        await window.recoveryFixture.work;
    });
    const firstAck = await inspectAndAcknowledge(first);
    const afterFirst = await other.evaluate(() =>
        localStorage.getItem(window.recoveryFixture.key)
    );
    expect(
        await page.evaluate(() => {
            try {
                window.recoveryFixture.receipts.verifyPending(
                    window.recoveryFixture.ticket
                );
                return "incorrectly-admitted";
            } catch (error) {
                return error.code;
            }
        })
    ).toBe("invalid_ticket");
    expect(
        await other.evaluate(() =>
            localStorage.getItem(window.recoveryFixture.key)
        )
    ).toBe(afterFirst);
    const beforeClose = await heldBusy(second);
    const originalFirst = JSON.parse(beforeClose).entries.find(
        (row) => row.operationId === first
    );
    expect(originalFirst.recovery_ack).toEqual(firstAck.record.acknowledgement);
    await page.close();
    await inspectAndAcknowledge(second);
    const final = await other.evaluate(() =>
        JSON.parse(localStorage.getItem(window.recoveryFixture.key))
    );
    expect(final.entries).toHaveLength(2);
    expect(
        final.entries.every(
            (row) => row.state === "pending" && row.recovery_ack
        )
    ).toBe(true);
    expect(final.entries.find((row) => row.operationId === first)).toEqual(
        originalFirst
    );
});

test("current favorites survive reload and resolve the correct Stalker profile with fresh links", async ({
    page,
    context,
    baseURL,
}) => {
    test.setTimeout(90000);
    const local = new URL(baseURL).origin;
    const pending = [];
    const replies = new Map();
    const resolutions = [];
    const errors = [];
    let sequence = 0;
    let ticket = 0;
    let failedProfile = "";
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const headers = { "Access-Control-Allow-Origin": "*" };
        if (
            url.origin === local &&
            url.pathname.startsWith("/favorites-controller/")
        ) {
            expect(request.headers().authorization).toBe("Bearer " + TOKEN);
            if (url.pathname.endsWith("/api/responses")) {
                const response = request.postDataJSON();
                replies.set(response.id, response);
                return route.fulfill({ json: { status: "ok" } });
            }
            if (url.pathname.endsWith("/api/webhook/commands")) {
                const now = Date.now() / 1000;
                const next = pending.shift();
                return route.fulfill({
                    json: {
                        commands: [],
                        requests: next
                            ? [{ ...next, expires_at: now + 40 }]
                            : [],
                        server_time: now,
                    },
                });
            }
            return route.fulfill({ json: {}, status: 404 });
        }
        if (url.pathname === "/stalker/api") {
            const portal = new URL(request.postDataJSON().url);
            const profile =
                portal.hostname === "second.fixture" ? "Second" : "First";
            const action = portal.searchParams.get("action");
            if (profile === failedProfile && action === "get_all_channels")
                return route.fulfill({
                    body: "Unavailable",
                    headers,
                    status: 503,
                });
            if (action === "create_link") {
                const cmd = portal.searchParams.get("cmd") || "";
                const id = cmd.includes("43") ? "43" : "42";
                const stream = `${STREAM}/${profile}/${id}/index.m3u8?ticket=${++ticket}`;
                resolutions.push({ id, profile, stream });
                return route.fulfill({
                    headers,
                    json: { js: { cmd: "ffmpeg " + stream } },
                });
            }
            const responses = {
                get_all_channels: {
                    data: [42, 43].map((id) => ({
                        cmd: "ffmpeg http://localhost/ch/" + id + "_",
                        id: String(id),
                        name: profile + " channel " + id,
                        tv_genre_id: "1",
                        use_http_tmp_link: 1,
                    })),
                    total_items: 2,
                },
                get_genres: [{ id: "1", title: "Fixture" }],
                get_profile: { blocked: "0", id: "1", status: "0" },
                handshake: { token: profile + "-synthetic-token" },
            };
            return route.fulfill({
                headers,
                json: { js: responses[action] || [] },
            });
        }
        if (url.origin === STREAM) {
            const playlist = url.pathname.endsWith(".m3u8");
            return route.fulfill({
                body: fs.readFileSync(
                    path.join(media, playlist ? "index.m3u8" : "segment00.ts")
                ),
                contentType: playlist
                    ? "application/vnd.apple.mpegurl"
                    : "video/mp2t",
                headers,
            });
        }
        if (url.origin === local) return route.continue();
        return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            this.muted = true;
            return play.call(this);
        };
        if (localStorage.getItem("favoritesFixtureSeeded")) return;
        localStorage.setItem("favoritesFixtureSeeded", "1");
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "stalker");
        localStorage.setItem(
            "stalkerstalker_data",
            JSON.stringify({
                active: 0,
                portals: [
                    {
                        mac: "02:00:00:00:00:01",
                        name: "First portal",
                        portal: "https://first.fixture/c/",
                    },
                    {
                        mac: "02:00:00:00:00:02",
                        name: "Second portal",
                        portal: "https://second.fixture/c/",
                    },
                ],
            })
        );
    });
    async function ready(profile) {
        await page.waitForFunction(
            (profile) =>
                window.commandChannelsReady === true &&
                window.channels[42]?.channel_name === profile + " channel 42",
            profile
        );
    }
    async function rpc(action, params = {}) {
        const id = String(++sequence).padStart(32, "0");
        pending.push({ action, id, params });
        await expect.poll(() => replies.has(id), { timeout: 20000 }).toBe(true);
        return replies.get(id);
    }
    async function selectProfile(index) {
        await page.evaluate((index) => {
            window.__ottEditProvider();
            window.selIndex = index;
            window.listKeyHandler(window.keys.ENTER);
        }, index);
        await ready(index ? "Second" : "First");
    }
    await page.goto("/f/pc/");
    await ready("First");
    await page.keyboard.press("Shift");
    await page.evaluate(
        (token) =>
            window.__ottCommandServer.configure({
                address: location.origin + "/favorites-controller",
                enabled: true,
                token,
            }),
        TOKEN
    );
    let caps = await rpc("capabilities");
    expect(caps.data.favorites.operations).toContain("add");
    let runtime = caps.data.player.runtime;
    const favorite = (op, params = {}) =>
        rpc("favorites", { op, runtime, ...params });
    expect((await rpc("play", { query: "First channel 42" })).status).toBe(
        "ok"
    );
    await expect
        .poll(() =>
            resolutions.some(
                (row) => row.profile === "First" && row.id === "42"
            )
        )
        .toBe(true);
    await page.evaluate(() => {
        window.sPreview = 0;
        window._channelsList(window.catsArray.indexOf("Fixture"), 1);
    });
    const first = await favorite("add", { name: "First favorite" });
    expect(first.status).toBe("ok");
    expect(first.data.entry).toMatchObject({
        kind: "live",
        profile_number: 1,
        title: "First channel 42",
    });
    const again = await favorite("add", { name: "First favorite" });
    expect(again.data.entry.id).toBe(first.data.entry.id);
    expect(again.data.created).toBe(false);
    const sameProfileTicket = ticket;
    expect((await favorite("play", { id: first.data.entry.id })).status).toBe(
        "ok"
    );
    await expect.poll(() => ticket).toBeGreaterThan(sameProfileTicket);
    expect(resolutions.at(-1)).toMatchObject({ id: "42", profile: "First" });
    await expect(page.locator("#list_window")).toBeHidden();
    await selectProfile(1);
    expect((await rpc("play", { query: "Second channel 42" })).status).toBe(
        "ok"
    );
    await expect
        .poll(() =>
            resolutions.some(
                (row) => row.profile === "Second" && row.id === "42"
            )
        )
        .toBe(true);
    const second = await favorite("add", { name: "Second favorite" });
    expect(second.status).toBe("ok");
    expect(second.data.entry.profile_number).toBe(2);
    expect(second.data.entry.id).not.toBe(first.data.entry.id);
    const before = ticket;
    const back = await favorite("play", { id: first.data.entry.id });
    expect(back.status).toBe("ok");
    expect(back.data.dispatched).toBe(true);
    await ready("First");
    await expect.poll(() => ticket).toBeGreaterThan(before);
    expect(resolutions.at(-1)).toMatchObject({ id: "42", profile: "First" });
    const initialRuntime = runtime;
    await page.reload();
    await ready("First");
    caps = await rpc("capabilities");
    runtime = caps.data.player.runtime;
    expect(runtime).not.toBe(initialRuntime);
    const list = await favorite("list");
    expect(list.status).toBe("ok");
    expect(list.data.entries.map((entry) => entry.id).sort()).toEqual(
        [first.data.entry.id, second.data.entry.id].sort()
    );
    const afterReload = ticket;
    expect((await favorite("play", { id: second.data.entry.id })).status).toBe(
        "ok"
    );
    await ready("Second");
    await expect.poll(() => ticket).toBeGreaterThan(afterReload);
    expect(resolutions.at(-1)).toMatchObject({ id: "42", profile: "Second" });
    expect(new Set(resolutions.map((row) => row.stream)).size).toBe(
        resolutions.length
    );
    // A broken current profile must not trap the user away from saved channels.
    failedProfile = "First";
    await page.evaluate(() => {
        window.__ottEditProvider();
        window.selIndex = 0;
        window.listKeyHandler(window.keys.ENTER);
    });
    await page.waitForFunction(() => window.commandChannelsReady === false);
    const recoveryTicket = ticket;
    expect((await favorite("play", { id: second.data.entry.id })).status).toBe(
        "ok"
    );
    await ready("Second");
    await expect.poll(() => ticket).toBeGreaterThan(recoveryTicket);
    expect(resolutions.at(-1)).toMatchObject({ id: "42", profile: "Second" });
    expect(errors).toEqual([]);
});
