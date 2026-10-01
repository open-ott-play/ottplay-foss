const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const plex = "https://plex.fixture";
const token = "fixture-plex-secret";
const mediaRoot = path.resolve(__dirname, "../fixtures/media-runtime");
test.use({
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});

test("Plex account sign-in selects a server without retaining the account token", async ({
    page,
    context,
    baseURL,
}) => {
    const local = new URL(baseURL).origin;
    const accountToken = "fixture-account-access";
    const serverToken = "fixture-server-access";
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const headers = { "access-control-allow-origin": "*" };
        if (url.origin === local) return route.continue();
        if (
            url.origin === "https://plex.tv" ||
            url.origin === "https://clients.plex.tv"
        ) {
            if (url.pathname === "/api/v2/pins")
                return route.fulfill({
                    headers,
                    json: { code: "ABCD", expiresIn: 900, id: 7 },
                });
            if (url.pathname === "/api/v2/pins/7")
                return route.fulfill({
                    headers,
                    json: {
                        authToken: accountToken,
                        code: "ABCD",
                        expiresIn: 900,
                        id: 7,
                    },
                });
            if (url.pathname === "/api/v2/resources")
                return route.fulfill({
                    headers,
                    json: [
                        {
                            accessToken: serverToken,
                            clientIdentifier: "fixture-server",
                            connections: [
                                { local: false, relay: false, uri: plex },
                            ],
                            name: "Fixture server",
                            owned: true,
                            provides: "server",
                        },
                    ],
                });
        }
        if (url.origin === plex) {
            if (url.pathname === "/identity") {
                expect(url.searchParams.get("X-Plex-Token")).toBeNull();
                return route.fulfill({
                    headers,
                    json: {
                        MediaContainer: { machineIdentifier: "fixture-server" },
                    },
                });
            }
            if (url.pathname === "/library/sections")
                return route.fulfill({
                    headers,
                    json: {
                        MediaContainer: {
                            Directory: [
                                {
                                    key: "7",
                                    title: "Account library",
                                    type: "movie",
                                },
                            ],
                        },
                    },
                });
        }
        return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "plex");
    });
    await page.goto("/f/pc/");
    await expect(page.locator("body")).toContainText("Sign in with Plex");
    await page.evaluate(() => {
        window.selIndex = 0;
        window.listKeyHandler(window.keys.ENTER);
    });
    await page.waitForFunction(() =>
        window.listArray?.some((row) => String(row).includes("Fixture server"))
    );
    await page.evaluate(() => {
        window.selIndex = window.listArray.findIndex((row) =>
            String(row).includes("Fixture server")
        );
        window.listKeyHandler(window.keys.ENTER);
    });
    await expect(page.locator("body")).toContainText("Account library");
    const stored = await page.evaluate(() =>
        Object.fromEntries(
            Object.keys(localStorage).map((key) => [
                key,
                localStorage.getItem(key),
            ])
        )
    );
    expect(JSON.parse(stored.plexcfg)).toMatchObject({
        address: plex,
        token: serverToken,
    });
    expect(JSON.stringify(stored)).not.toContain(accountToken);
});

async function select(page, title) {
    await page.waitForFunction(
        (title) =>
            window.__ottMedia
                ?.snapshot()
                .frame?.items.some((item) => item.title === title),
        title
    );
    await page.evaluate((title) => {
        const index = window.__ottMedia
            .snapshot()
            .frame.items.findIndex((item) => item.title === title);
        window.__ottMedia.select(index);
    }, title);
}

test("Plex boots as a nested library, plays direct HLS and keeps access URLs out of history", async ({
    page,
    context,
    baseURL,
}) => {
    const local = new URL(baseURL).origin;
    const requests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === local) return route.continue();
        if (url.origin !== plex) return route.abort();
        requests.push(url.pathname);
        const headers = { "access-control-allow-origin": "*" };
        const json = (body) =>
            route.fulfill({ headers, json: { MediaContainer: body } });
        if (url.pathname === "/library/sections")
            return json({
                Directory: [{ key: "7", title: "My library", type: "movie" }],
            });
        if (url.pathname === "/library/sections/7/all")
            return json({ Metadata: [] });
        if (url.pathname === "/hubs/search")
            return json({
                Hub: [
                    {
                        Metadata: [
                            {
                                ratingKey: "42",
                                title: "Test film",
                                type: "movie",
                            },
                        ],
                    },
                ],
            });
        if (url.pathname === "/library/sections/7/folder") {
            const level = Number(url.searchParams.get("parent") || 0);
            return json(
                level < 3
                    ? {
                          Metadata: [
                              {
                                  key:
                                      "/library/sections/7/folder?parent=" +
                                      (level + 1),
                                  title: "Folder " + (level + 1),
                              },
                          ],
                      }
                    : {
                          Metadata: [
                              {
                                  ratingKey: "42",
                                  title: "  ",
                                  titleSort: "Test film",
                                  type: "movie",
                              },
                          ],
                          offset: 0,
                          size: 1,
                          totalSize: 1,
                      }
            );
        }
        if (url.pathname === "/library/metadata/42")
            return json({
                Metadata: [
                    {
                        Media: [
                            {
                                audioCodec: "mp3",
                                container: "avi",
                                Part: [{ key: "/library/parts/42/file.avi" }],
                                videoCodec: "mpeg4",
                            },
                        ],
                        ratingKey: "42",
                        type: "movie",
                    },
                ],
            });
        if (url.pathname.endsWith("/decision"))
            return json({
                generalDecisionCode: 1001,
                Metadata: [{ Media: [{ Part: [{ decision: "transcode" }] }] }],
            });
        if (url.pathname.endsWith("/start.m3u8"))
            return route.fulfill({
                body:
                    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
                    Array.from(
                        { length: 30 },
                        (_, index) =>
                            (index ? "#EXT-X-DISCONTINUITY\n" : "") +
                            "#EXTINF:2.000000,\nsegment00.ts?segment=" +
                            index +
                            "\n"
                    ).join("") +
                    "#EXT-X-ENDLIST\n",
                contentType: "application/vnd.apple.mpegurl",
                headers,
            });
        if (url.pathname.endsWith(".ts"))
            return route.fulfill({
                body: fs.readFileSync(path.join(mediaRoot, "segment00.ts")),
                contentType: "video/mp2t",
                headers,
            });
        if (url.pathname.endsWith("/stop") || url.pathname.endsWith("/ping"))
            return route.fulfill({ body: "", headers, status: 200 });
        return route.fulfill({
            body: "missing fixture route",
            headers,
            status: 404,
        });
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(
        ({ plex, token }) => {
            // Silent AAC can stall Chromium's audio clock without OS output.
            // Muting each attempt also covers the real page reload below.
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                this.muted = true;
                return play.call(this);
            };
            localStorage.setItem("ottplaylang", "_eng");
            localStorage.setItem("ottplayprov", "plex");
            localStorage.setItem(
                "plexcfg",
                JSON.stringify({ address: plex, playback: "compatible", token })
            );
        },
        { plex, token }
    );
    await page.goto("/f/pc/");
    // Real users activate the page with a remote/key/click before selecting media.
    await page.keyboard.press("Shift");
    await select(page, "My library");
    await select(page, "Browse folders");
    for (let level = 1; level <= 3; level++)
        await select(page, "Folder " + level);
    const depth = await page.evaluate(
        () => window.__ottMedia.snapshot().frames.length
    );
    expect(depth).toBeGreaterThanOrEqual(5);
    await page.evaluate(() => window.__ottMedia.back());
    await select(page, "Folder 3");
    await page.evaluate(() => {
        window.sFavorites = 1;
        document.querySelector("video").muted = true;
    });
    const controls = page.locator("#mediaPlaybackControls");
    await expect(
        controls.getByRole("button", { name: "Shuffle and play" })
    ).toBeVisible();
    await expect(
        controls.getByRole("button", { name: "Repeat: All" })
    ).toBeVisible();
    await controls.getByRole("button", { name: "Repeat: All" }).click();
    await expect(
        controls.getByRole("button", { name: "Repeat: One" })
    ).toBeVisible();
    await controls.getByRole("button", { name: "Repeat: One" }).click();
    await expect(
        controls.getByRole("button", { name: "Repeat: Off" })
    ).toBeVisible();
    const panel = await page.locator("#listDetail").boundingBox();
    const toolbar = await controls.boundingBox();
    expect(toolbar.x).toBeGreaterThanOrEqual(panel.x);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(
        panel.x + panel.width
    );
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(
        panel.y + panel.height
    );
    await page.screenshot({
        path: test.info().outputPath("plex-controls.png"),
    });
    expect(await page.locator("#list").innerText()).toContain("Test film");
    await controls.getByRole("button", { name: "Shuffle and play" }).click();
    await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("video")).some(
            (video) => video.currentTime > 0.2 && !video.error
        )
    );
    const state = await page.evaluate(() => ({
        current: window.__ottMedia.current()?.payload.__ottPlexPlayback.type,
        journals: Object.keys(localStorage)
            .filter((key) => key.includes("mediaJournal.v1:"))
            .map((key) => localStorage.getItem(key)),
        provider: localStorage.getItem("ottplayprov"),
        queue: window.__ottMedia
            .current()
            ?.sequence.items.map((item) => item.title),
        repeat: window.__ottMedia.current()?.sequence.repeat,
    }));
    expect(state.provider).toBe("plex");
    expect(state.current).toBe("hls");
    expect(state.queue).toEqual(["Test film"]);
    expect(state.repeat).toBe("off");
    expect(state.journals.length).toBeGreaterThan(0);
    expect(JSON.stringify(state.journals)).not.toContain(token);
    expect(requests).toContain("/video/:/transcode/universal/decision");
    await page.evaluate(() => {
        const video = document.querySelector("video");
        video.pause();
        video.currentTime = 12.375;
    });
    await page.waitForFunction(() => {
        const video = document.querySelector("video");
        return !video.seeking && Math.abs(video.currentTime - 12.375) < 0.05;
    });
    const bookmark = await page.evaluate(() => {
        window.body_onUnload();
        const key = Object.keys(localStorage).find((key) =>
            key.includes("mediaJournal.v1:")
        );
        return JSON.parse(localStorage.getItem(key)).history[0];
    });
    expect(bookmark.position).toBeCloseTo(12.375, 2);
    const resolvesBeforeReload = requests.filter(
        (path) => path === "/library/metadata/42"
    ).length;
    await page.reload();
    await page.waitForFunction(() => {
        const video = document.querySelector("video");
        return (
            window.__ottMedia?.current() &&
            video.currentTime >= 12.375 &&
            !video.error
        );
    });
    expect(
        await page.evaluate(() => window.__ottMedia.current().ref.itemId)
    ).toBe(bookmark.itemId);
    expect(
        requests.filter((path) => path === "/library/metadata/42").length
    ).toBeGreaterThan(resolvesBeforeReload);
    expect(
        await page.evaluate(() => document.querySelector("video").currentTime)
    ).toBeLessThan(15);
    const stopsBefore = requests.filter((path) =>
        path.endsWith("/stop")
    ).length;
    await page.evaluate(() => window.stbStop());
    await expect
        .poll(() => requests.filter((path) => path.endsWith("/stop")).length)
        .toBe(stopsBefore + 1);
    await page.evaluate(() => window.__ottMedia.open("plexsearch?search=Test"));
    await expect(
        controls.getByRole("button", { name: "Repeat: Off" })
    ).toBeVisible();
    await expect(
        controls.getByRole("button", { name: "Shuffle and play" })
    ).toHaveCount(0);
    const stoppedGeneration = await page.evaluate(
        () => window.__ottClassicPlayback.snapshot().generation
    );
    await select(page, "Test film");
    await page.waitForFunction((previousGeneration) => {
        const state = window.__ottClassicPlayback.snapshot();
        const video = document.querySelector("video");
        return (
            state.generation > previousGeneration &&
            state.phase === "playing" &&
            video.currentTime > 0.2 &&
            video.readyState >= 2 &&
            Number.isFinite(video.duration) &&
            video.duration > 0.2 &&
            !video.seeking &&
            !video.error
        );
    }, stoppedGeneration);
    await page.evaluate(() => {
        const video = document.querySelector("video");
        // Leave actual media before EOF: the transport stream's audio ends
        // slightly before the duration advertised by the synthetic playlist.
        video.currentTime = video.duration - 1;
    });
    await page.waitForFunction(() => {
        const key = Object.keys(localStorage).find((key) =>
            key.includes("mediaJournal.v1:")
        );
        return (
            window.__ottClassicPlayback.snapshot().phase === "stopped" &&
            JSON.parse(localStorage.getItem(key)).history[0].position === 0
        );
    });
    const completedResolves = requests.filter(
        (path) => path === "/library/metadata/42"
    ).length;
    await page.reload();
    await expect(page.locator("body")).toContainText("My library");
    expect(await page.evaluate(() => window.__ottMedia.current())).toBeNull();
    expect(
        requests.filter((path) => path === "/library/metadata/42").length
    ).toBe(completedResolves);
    expect(errors).toEqual([]);
});
