// Real bundled playback and decoder; only the remote companion is a fixture.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("../helpers/browser-test.cjs");

test.use({
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

function movieFixture() {
    const bytes = fs.readFileSync(
        path.join(__dirname, "../fixtures/media-runtime/segment00.ts")
    );
    const parts = [];
    for (let index = 0; index < 15; index++) {
        const mux = new (require("mux.js").mp4.Transmuxer)({
            baseMediaDecodeTime: index * 180000,
            remux: true,
        });
        mux.on("data", (value) => {
            if (!index) parts.push(Buffer.from(value.initSegment));
            parts.push(Buffer.from(value.data));
        });
        mux.push(new Uint8Array(bytes));
        mux.flush();
    }
    return Buffer.concat(parts);
}

// Exercise the normal current-provider media admission path.
async function openPluginMedia(page, url) {
    await page.evaluate((source) => {
        window._playMedia({
            itemId: "plugin-fixture",
            stream_url: source,
            title: "Plugin fixture",
        });
    }, "ottplay-plugin:direct-url?input=" + encodeURIComponent(url));
}

for (const layout of ["/f/pc/", "/f/"]) {
    for (const mode of [0, 1, 2]) {
        test(`companion channel resolves, decodes and releases its lease ${layout} mode=${mode}`, async ({
            page,
            context,
            baseURL,
        }) => {
            const origin = new URL(baseURL).origin;
            const base = "/companion/" + "a".repeat(32) + "/v1";
            const source = "magnet:?xt=urn:btih:" + "0".repeat(40);
            const movie = movieFixture();
            const calls = [];
            const errors = [];
            let state = "select";
            let preparingReads = 0;
            page.on("pageerror", (error) => errors.push(error.message));
            const status = () => ({
                files: [{ index: 0, length: movie.length, name: "Sample.mp4" }],
                id: "viewer-one",
                state,
                ...(state === "ready"
                    ? { selected: 0, streamPath: "sessions/viewer-one/stream" }
                    : {}),
            });
            await context.routeWebSocket("**/*", (socket) => socket.close());
            await context.route("**/*", async (route) => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.origin !== origin) return route.abort();
                if (url.pathname === "/plugin-master.m3u8")
                    return route.fulfill({
                        body: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Synthetic audio",DEFAULT=YES,AUTOSELECT=YES,URI="/__device_test_media/audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2",AUDIO="audio"\n/__device_test_media/video.m3u8\n',
                        contentType: "application/vnd.apple.mpegurl",
                    });
                if (url.pathname === "/companion-fixture.m3u")
                    return route.fulfill({
                        body:
                            '#EXTM3U\n#EXTINF:-1 group-title="Samples",Torrent sample\n' +
                            source +
                            '\n#EXTINF:-1 group-title="Samples",Direct sample\n' +
                            origin +
                            "/sample.mp4\n",
                        contentType: "application/vnd.apple.mpegurl",
                    });
                if (
                    url.pathname === "/sample.mp4" ||
                    url.pathname === base + "/sessions/viewer-one/stream"
                )
                    return route.fulfill({
                        body: movie,
                        contentType: "video/mp4",
                    });
                if (!url.pathname.startsWith(base + "/"))
                    return route.continue();
                const api = url.pathname.slice(base.length);
                calls.push(request.method() + " " + api);
                let value;
                if (api === "/capabilities")
                    value = { plugins: true, schema: 1, torrent: true };
                else if (api === "/plugins/direct-url/resolve")
                    value = {
                        streams: [
                            {
                                title: "Plugin source",
                                url: request.postDataJSON().input.url,
                            },
                        ],
                    };
                else if (api === "/sessions" && request.method() === "POST") {
                    expect(request.postDataJSON().source).toBe(source);
                    value = { files: [], id: "viewer-one", state: "metadata" };
                } else if (api === "/sessions/viewer-one/select") {
                    expect(request.postDataJSON().fileIndex).toBe(0);
                    state = "preparing";
                    value = status();
                } else if (
                    api === "/sessions/viewer-one" &&
                    request.method() === "GET"
                ) {
                    if (state === "preparing" && preparingReads++ > 0)
                        state = "ready";
                    value = status();
                } else if (
                    api === "/sessions/viewer-one" &&
                    request.method() === "DELETE"
                )
                    value = {};
                else throw new Error("Unexpected companion request " + api);
                return route.fulfill({ json: value });
            });
            await context.addInitScript(
                ({ origin, base, mode }) => {
                    localStorage.setItem("ottplaylang", "_eng");
                    localStorage.setItem("ottplayprov", "m3u");
                    localStorage.setItem("m3usPlayers", String(mode));
                    localStorage.setItem("sCompanionEndpoint", origin + base);
                    localStorage.setItem(
                        "m3um3uArr",
                        JSON.stringify({
                            active: 0,
                            M3Us: [{ www: origin + "/companion-fixture.m3u" }],
                        })
                    );
                    const play = HTMLMediaElement.prototype.play;
                    HTMLMediaElement.prototype.play = function () {
                        this.muted = true;
                        return play.call(this);
                    };
                },
                { base, mode, origin }
            );
            await page.goto(layout);
            await page.waitForFunction(
                () => window.commandChannelsReady === true
            );
            await page.waitForFunction(
                () =>
                    window.video?.currentTime > 0.1 &&
                    window.video?.videoWidth > 0
            );
            expect(
                await page.evaluate(() => localStorage.getItem("m3usPlayers"))
            ).toBe(String(mode));
            expect(preparingReads).toBeGreaterThan(0);
            expect(calls).toContain("POST /sessions/viewer-one/select");
            expect(
                await page.evaluate(
                    () =>
                        window.channels[window.curList[0]].url ||
                        window.getChannelUrl(window.curList[0])
                )
            ).toBe(source);
            expect(
                await page.evaluate(() =>
                    window.__ottCoreBackend().current().diagnosticEngine()
                )
            ).toBe("html5");
            if (mode === 0) {
                await page.evaluate(() =>
                    window.playChannel(
                        window.catsArray.indexOf("Samples"),
                        1,
                        true
                    )
                );
            } else {
                await openPluginMedia(page, origin + "/plugin-master.m3u8");
                await page.waitForFunction(
                    (engine) =>
                        window
                            .__ottCoreBackend()
                            .current()
                            ?.diagnosticEngine() === engine &&
                        window.video?.currentTime > 0.1 &&
                        window.video?.videoWidth > 0,
                    mode === 1 ? "hls.js" : "shaka"
                );
                expect(calls).toContain("POST /plugins/direct-url/resolve");
                expect(
                    await page.evaluate(() =>
                        localStorage.getItem("m3usPlayers")
                    )
                ).toBe(String(mode));
            }
            await expect
                .poll(
                    () =>
                        calls.filter(
                            (call) => call === "DELETE /sessions/viewer-one"
                        ).length
                )
                .toBe(1);
            if (mode === 0)
                await page.waitForFunction(
                    () =>
                        window.video?.currentSrc.includes("/sample.mp4") &&
                        window.video.currentTime > 0.1
                );
            await openPluginMedia(page, origin + "/sample.mp4");
            await page.waitForFunction(
                () =>
                    window.__ottCoreBackend().current()?.diagnosticEngine() ===
                        "html5" &&
                    window.video?.currentSrc.includes("/sample.mp4") &&
                    window.video.currentTime > 0.1 &&
                    window.video.videoWidth > 0
            );
            expect(
                await page.evaluate(() => localStorage.getItem("m3usPlayers"))
            ).toBe(String(mode));
            await page.evaluate((source) => window.stbPlayPip(source), source);
            await page.waitForFunction(
                () =>
                    window.videoPip?.currentTime > 0.1 &&
                    window.videoPip?.videoWidth > 0
            );
            await page.evaluate(() => window.stbStopPip());
            await expect
                .poll(
                    () =>
                        calls.filter(
                            (call) => call === "DELETE /sessions/viewer-one"
                        ).length
                )
                .toBe(2);
            expect(errors).toEqual([]);
        });
    }
}

test("Torrent provider keeps categories and global Favorites across reloads without catalog leases", async ({
    page,
    context,
    baseURL,
}) => {
    const origin = new URL(baseURL).origin;
    const base = "/companion/" + "c".repeat(32) + "/v1";
    const source = "magnet:?xt=urn:btih:" + "1".repeat(40);
    const movie = movieFixture(),
        calls = [],
        errors = [];
    let serial = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
        const request = route.request(),
            url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith(base + "/")) return route.continue();
        const api = url.pathname.slice(base.length);
        calls.push(request.method() + " " + api);
        if (/\/stream$/.test(api))
            return route.fulfill({ body: movie, contentType: "video/mp4" });
        if (api === "/capabilities")
            return route.fulfill({
                json: { plugins: true, schema: 1, torrent: true },
            });
        if (api === "/sessions" && request.method() === "POST") {
            expect(
                new URL(request.postDataJSON().source).searchParams.get("xt")
            ).toBe(new URL(source).searchParams.get("xt"));
            const id = "provider-" + ++serial;
            return route.fulfill({
                json: {
                    files: [
                        { index: 0, length: movie.length, name: "sample.mp4" },
                    ],
                    id,
                    selected: 0,
                    state: "ready",
                    streamPath: "sessions/" + id + "/stream",
                },
            });
        }
        if (/^\/sessions\/provider-\d+$/.test(api)) {
            if (request.method() === "DELETE")
                return route.fulfill({ json: {} });
            const id = api.split("/").pop();
            return route.fulfill({
                json: {
                    id,
                    state: "ready",
                    streamPath: "sessions/" + id + "/stream",
                },
            });
        }
        throw new Error("Unexpected provider request " + api);
    });
    await context.addInitScript(
        ({ origin, base, source }) => {
            localStorage.setItem("ottplaylang", "_eng");
            localStorage.setItem("ottplayprov", "demo");
            localStorage.setItem("sCompanionEndpoint", origin + base);
            localStorage.setItem(
                "torrentcfg",
                JSON.stringify({
                    entries: [
                        {
                            category: "First source",
                            files: [
                                { index: 0, length: 100, name: "sample.mp4" },
                            ],
                            id: "one",
                            source,
                            title: "First sample",
                        },
                        {
                            category: "Second source",
                            files: [
                                { index: 0, length: 100, name: "sample.mp4" },
                            ],
                            id: "two",
                            source,
                            title: "Second sample",
                        },
                    ],
                    id: "persistent-catalog",
                    name: "Torrent",
                    schema: 1,
                })
            );
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                this.muted = true;
                return play.call(this);
            };
        },
        { base, origin, source }
    );
    await page.goto("/f/");
    async function openProvider() {
        await page.waitForFunction(() => window.commandChannelsReady === true);
        await page.evaluate(() => {
            // Browser decoder fixture stands in for an attested native capability.
            // Production visibility and native ownership are tested separately.
            window.__ottMediaCompanion.providerAvailable = () => true;
            window.stbSetItem("ottplayprov", "torrent");
            window.loadProv();
        });
    }
    await openProvider();
    await page.waitForFunction(
        () =>
            window.commandChannelsReady === true &&
            window.video?.currentTime > 0.1
    );
    expect(await page.evaluate(() => window.__ottActiveProviderDriver.id)).toBe(
        "torrent"
    );
    expect(await page.evaluate(() => window.cList.length)).toBe(2);
    const categories = await page.evaluate(() => window.catsArray);
    expect(categories).toContain("First source");
    expect(categories).toContain("Second source");
    expect(categories).toContain("Favorites");
    expect(calls.filter((call) => call === "POST /sessions").length).toBe(1);
    await require("../helpers/global-mixed-browser.cjs").ensure(page);
    expect(
        await page.evaluate(() =>
            window.setGlobalChannelFavorite(window.cList[1], true)
        )
    ).toBe(true);
    await expect
        .poll(() =>
            page.evaluate(
                async () =>
                    (await window.__ottGlobalFavorites.store.snapshot()).entries
                        .length
            )
        )
        .toBe(1);
    const entry = await page.evaluate(
        async () =>
            (await window.__ottGlobalFavorites.store.snapshot()).entries[0]
    );
    expect(entry.locator).toEqual({
        channelId: "torrent:persistent-catalog:two:0",
        kind: "channel",
    });
    expect(JSON.stringify(entry)).not.toContain("magnet:");
    expect(JSON.stringify(entry)).not.toContain("/sessions/");
    await page.evaluate(() => {
        window.stbSetItem("ottplayprov", "demo");
        window.loadProv("demo");
    });
    await page.waitForFunction(
        () =>
            window.__ottActiveProviderDriver?.id === "demo" &&
            window.commandChannelsReady === true
    );
    const replay = await page.evaluate(
        async (id) => window.__ottGlobalFavorites.router.select(id).result,
        entry.id
    );
    expect(replay.status).toBe("ok");
    await page.waitForFunction(
        () =>
            window.__ottActiveProviderDriver?.id === "torrent" &&
            window.video?.currentTime > 0.1
    );
    await page.reload();
    await openProvider();
    await require("../helpers/global-mixed-browser.cjs").ensure(page);
    await page.waitForFunction(
        () =>
            window.commandChannelsReady === true &&
            window.video?.currentTime > 0.1
    );
    expect(
        await page.evaluate(
            async () =>
                (await window.__ottGlobalFavorites.store.snapshot()).entries[0]
                    .locator.channelId
        )
    ).toBe(entry.locator.channelId);
    const stored = await page.evaluate(() =>
        Object.keys(localStorage)
            .filter((key) => key.startsWith("torrent"))
            .map((key) => localStorage.getItem(key))
            .join("\n")
    );
    expect(stored).not.toContain("/sessions/");
    expect(stored).not.toContain("companion/" + "c".repeat(32));
    expect(errors).toEqual([]);
});

test("Torrent provider is hidden for external endpoints until native capability is confirmed", async ({
    page,
    context,
    baseURL,
}) => {
    const origin = new URL(baseURL).origin;
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
            ? route.continue()
            : route.abort()
    );
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "demo");
        localStorage.setItem(
            "sCompanionEndpoint",
            "https://external.invalid/companion/" + "a".repeat(32) + "/v1"
        );
    });
    await page.goto("/f/");
    await page.waitForFunction(() => window.commandChannelsReady === true);
    expect(
        await page.evaluate(() => {
            window.showProviderSelection();
            return window.providerIds.includes("torrent");
        })
    ).toBe(false);
    const commands = await page.evaluate(async () => {
        const calls = [];
        let answer;
        window.__TAURI__ = {
            core: {
                invoke: (command) => {
                    calls.push(command);
                    return new Promise((resolve) => {
                        answer = resolve;
                    });
                },
            },
        };
        const ready = window.__ottMediaCompanion.capabilities();
        if (window.isProviderAllowed("torrent"))
            throw Error("Optimistic native provider visibility");
        await Promise.resolve();
        answer({
            available: true,
            local: true,
            plugins: true,
            schema: 1,
            torrent: true,
        });
        await ready;
        window.showProviderSelection();
        if (!window.providerIds.includes("torrent"))
            throw Error("Native provider missing");
        return calls;
    });
    expect(commands).toEqual(["companion_capabilities"]);
});
