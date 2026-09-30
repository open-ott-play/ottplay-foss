const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const plex = "https://plex.fixture";
const token = "fixture-plex-secret";
const mediaRoot = path.resolve(__dirname, "../fixtures/media-runtime");

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
                                  title: "Test film",
                                  type: "movie",
                              },
                          ],
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
                body: fs.readFileSync(path.join(mediaRoot, "index.m3u8")),
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
    await select(page, "Folders");
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
    await select(page, "Test film");
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
    }));
    expect(state.provider).toBe("plex");
    expect(state.current).toBe("hls");
    expect(state.journals.length).toBeGreaterThan(0);
    expect(JSON.stringify(state.journals)).not.toContain(token);
    expect(requests).toContain("/video/:/transcode/universal/decision");
    await page.evaluate(() => window.stbStop());
    await expect
        .poll(() => requests.filter((path) => path.endsWith("/stop")).length)
        .toBe(1);
    expect(errors).toEqual([]);
});
