const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("../helpers/browser-test.cjs");
const link = "portal::[key:FIXTURE_VPORTAL_SECRET]https://portal.fixture/api/";
test.use({
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});
async function installPortal(context, baseURL, attemptStart = 0) {
    const origin = new URL(baseURL).origin;
    let resolutions = attemptStart;
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/vportal/api")) {
            const body = route.request().postDataJSON();
            expect(body.params.key).toBe("FIXTURE_VPORTAL_SECRET");
            if (body.params.cmd === "play") {
                resolutions++;
                return route.fulfill({
                    json: {
                        type: "stream",
                        url:
                            origin +
                            "/fixture/video.m3u8?attempt=" +
                            resolutions,
                    },
                });
            }
            return route.fulfill({
                json: {
                    items: [
                        {
                            description: "A selected film description.",
                            img: origin + "/fixture/poster.png",
                            request: { cmd: "play", id: 42 },
                            title: "Fixture film",
                            type: "stream",
                        },
                    ],
                    type: "videoportal",
                },
            });
        }
        if (url.pathname === "/fixture/poster.png")
            return route.fulfill({
                body: Buffer.from(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=",
                    "base64"
                ),
                contentType: "image/png",
            });
        if (url.pathname === "/fixture/video.m3u8")
            return route.fulfill({
                body:
                    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
                    Array.from(
                        { length: 60 },
                        (_, i) =>
                            (i ? "#EXT-X-DISCONTINUITY\n" : "") +
                            "#EXTINF:2.000000,\nsegment00.ts?segment=" +
                            i +
                            "\n"
                    ).join("") +
                    "#EXT-X-ENDLIST\n",
                contentType: "application/vnd.apple.mpegurl",
            });
        if (url.pathname === "/fixture/segment00.ts")
            return route.fulfill({
                body: fs.readFileSync(
                    path.resolve(
                        __dirname,
                        "../fixtures/media-runtime/segment00.ts"
                    )
                ),
                contentType: "video/mp2t",
            });
        if (url.origin === origin) return route.continue();
        return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript((link) => {
        if (!localStorage.getItem("vportalprofiles")) {
            localStorage.setItem("ottplaylang", "_rus");
            localStorage.setItem("ottplayprov", "vportal");
            localStorage.setItem(
                "vportalprofiles",
                JSON.stringify({
                    active: 0,
                    portals: Array.from({ length: 15 }, (_, i) => ({
                        link: i ? "" : link,
                        name: i ? "" : "Кино",
                        sections: [],
                    })),
                })
            );
            localStorage.setItem("m3um3uArr", "M3U_MUST_NOT_CHANGE");
        }
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            this.muted = true;
            return play.call(this);
        };
    }, link);
    return () => resolutions;
}

test("VPortal flat channel playlist locks playback and restores after reload", async ({
    page,
    context,
    baseURL,
}) => {
    const resolutions = await installPortal(context, baseURL);
    await page.goto("/f/pc/");
    await expect
        .poll(() => page.evaluate(() => window.commandChannelsReady))
        .toBe(true);
    expect(await page.evaluate(() => window.cList.length)).toBe(1);
    await page.waitForFunction(
        () => document.querySelector("video")?.currentTime > 0.2
    );
    await page.evaluate(() => window.channelsList(0, 0));
    await expect(page.locator("#list")).toContainText("Fixture film");
    await expect(page.locator("#listDetail")).toContainText(
        "A selected film description."
    );
    await expect(
        page.locator("#listDetail .ott-channel-detail-time")
    ).toHaveCount(0);
    await expect(page.locator("#listDetail .ott-channel-thumbnail")).toHaveCSS(
        "background-image",
        /poster\.png/
    );
    await expect(page.locator("#listIn")).not.toContainText(
        /no epg|нет программы/i
    );
    await page.evaluate(() => window.channelsKeyHandler(window.keys.N2));
    await expect(page.locator("#listAbout")).toContainText(
        "A selected film description."
    );
    await expect(page.locator("#listAbout")).not.toContainText(
        /no epg|нет программы/i
    );
    await page.evaluate(() => window.aboutKeyHandler(window.keys.RETURN));
    await page.evaluate(() => window.showProviderSelection());
    await expect(page.locator("#list")).toContainText("VPortal");
    await page.evaluate(() => window.__ottEditProvider());
    await expect(page.locator("#listCaption")).toHaveText("Профили VPortal");
    await page.screenshot({
        path: test.info().outputPath("vportal-profiles-ru.png"),
    });
    expect(await page.locator("#list").innerText()).not.toContain(
        "FIXTURE_VPORTAL_SECRET"
    );
    await page.evaluate(() => window.channelsList(0, 0));
    await expect(page.locator("#list")).toContainText("Fixture film");
    await page.evaluate(() => {
        window.selIndex = 0;
        window.listKeyHandler(window.keys.ENTER);
    });
    await page.waitForFunction(
        () => document.querySelector("video")?.currentTime > 0.2
    );
    const lock = await page.evaluate(
        () =>
            new Promise((resolve) =>
                window.__ottKiosk.request(
                    { mode: "on", query: "Fixture film" },
                    resolve
                )
            )
    );
    expect(lock.status).toBe("ok");
    expect(lock.data.media).toBeUndefined();
    expect(lock.data.channel, JSON.stringify(lock)).toBeTruthy();
    const stored = await page.evaluate(() =>
        localStorage.getItem("__ottKioskV1")
    );
    expect(stored).not.toContain("video.m3u8");
    expect(stored).not.toContain("FIXTURE_VPORTAL_SECRET");
    const before = resolutions();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.__ottKiosk.locked())).toBe(true);
    await page.reload();
    await expect.poll(resolutions).toBeGreaterThan(before);
    await page.waitForFunction(
        () => document.querySelector("video")?.currentTime > 0.2
    );
    expect(await page.evaluate(() => window.__ottKiosk.snapshot().state)).toBe(
        "locked"
    );
    expect(await page.evaluate(() => localStorage.getItem("m3um3uArr"))).toBe(
        "M3U_MUST_NOT_CHANGE"
    );
    const unlock = await page.evaluate(
        () =>
            new Promise((resolve) =>
                window.__ottKiosk.request({ mode: "off" }, resolve)
            )
    );
    expect(unlock.data.state).toBe("off");
    await page.evaluate(() => window.showProviderSelection());
    await expect(page.locator("#list")).toContainText("VPortal");
});

// Persisted bytes are captured before closing the old page. The replacement
// context cannot benefit from visibilitychange, beforeunload or close handlers.
for (const device of ["pc", "lg/webos"]) {
    test(`VPortal periodic checkpoint restores a cold ${device} launch`, async ({
        browser,
        baseURL,
    }) => {
        test.setTimeout(45000);
        const first = await browser.newContext({
            serviceWorkers: "block",
            viewport: { height: 720, width: 1280 },
        });
        let second;
        try {
            await installPortal(first, baseURL);
            const playing = await first.newPage();
            await playing.goto(new URL(`/f/${device}/`, baseURL).href);
            await playing.waitForFunction(
                () => document.querySelector("video")?.currentTime > 0.2,
                null,
                { timeout: 20000 }
            );
            // A public user seek keeps the saved cursor beyond the cold-start
            // polling window, so playback from zero cannot mimic restoration.
            // Only normal decoder sampling may persist the new position.
            await playing.evaluate(() => window.stbSetPosTime(60));
            const read = () =>
                playing.evaluate(() => {
                    const media = window.__ottMedia.current();
                    const raw = window.providerGetItem(
                        "mediaJournal.v1:" + media.ref.sourceId
                    );
                    const journal = raw && JSON.parse(raw);
                    const saved = journal?.history.find(
                        (row) => row.itemId === media.ref.itemId
                    );
                    return {
                        ref: media.ref,
                        saved: saved?.position || 0,
                        state: window.__ottClassicPlayback.snapshot(),
                        url: media.payload.stream_url,
                    };
                });
            await expect
                .poll(async () => (await read()).saved)
                .toBeGreaterThan(61);
            const before = await read();
            expect(before.state.target.kind).toBe("vod");
            expect(before.state.historyTarget.kind).toBe("live");
            expect(before.state.target.channelId).toBe(before.ref.itemId);
            const persisted = await first.storageState();
            await first.close();

            second = await browser.newContext({
                serviceWorkers: "block",
                storageState: persisted,
                viewport: { height: 720, width: 1280 },
            });
            // The new signed URL belongs to a fresh provider session. Resume
            // identity must come from the source/item, never the expired URL.
            const resolutions = await installPortal(second, baseURL, 100);
            const restored = await second.newPage();
            await restored.goto(new URL(`/f/${device}/`, baseURL).href);
            await expect.poll(resolutions).toBeGreaterThan(100);
            await expect
                .poll(() =>
                    restored.evaluate(() => window.video?.currentTime || 0)
                )
                .toBeGreaterThan(before.saved - 1);
            const after = await restored.evaluate(() => ({
                position: window.__ottClassicPlayback.snapshot().position,
                ref: window.__ottMedia.current().ref,
                url: window.__ottMedia.current().payload.stream_url,
            }));
            expect(after.ref).toEqual(before.ref);
            expect(after.url).not.toBe(before.url);
            expect(after.position).toBeGreaterThan(before.saved - 1);
        } finally {
            if (second) await second.close();
            await first.close();
        }
    });
}

for (const device of ["pc", ""]) {
    test(`VPortal whole portal and category visibility ${device || "generic"}`, async ({
        page,
        context,
        baseURL,
    }) => {
        const origin = new URL(baseURL).origin;
        let releaseFilms;
        const filmsGate = new Promise((resolve) => {
            releaseFilms = resolve;
        });
        await context.route("**/vportal/api", async (route) => {
            const params = route.request().postDataJSON().params;
            let response;
            if (params.cmd === "play") {
                response = {
                    type: "stream",
                    url: origin + "/fixture/video.m3u8",
                };
            } else if (params.cmd === "cartoons") {
                response = {
                    items: [
                        {
                            description: "Cartoon selected from its category.",
                            request: { cmd: "play", id: 1 },
                            title: "Cartoon",
                            type: "stream",
                        },
                        {
                            request: { cmd: "series" },
                            title: "Series",
                            type: "multistream",
                        },
                    ],
                    type: "category",
                };
            } else if (params.cmd === "series") {
                response = {
                    items: [
                        {
                            request: { cmd: "play", id: 2 },
                            title: "Episode",
                            type: "stream",
                        },
                    ],
                    type: "multistream",
                };
            } else if (params.cmd === "films") {
                await filmsGate;
                response = {
                    items: [
                        {
                            request: { cmd: "play", id: 3 },
                            title: "Film",
                            type: "stream",
                        },
                    ],
                    type: "category",
                };
            } else {
                response = {
                    items: [
                        {
                            request: { cmd: "cartoons" },
                            title: "Cartoons",
                            type: "category",
                        },
                        {
                            request: { cmd: "films" },
                            title: "Films",
                            type: "category",
                        },
                    ],
                    type: "videoportal",
                };
            }
            await route.fulfill({ json: response });
        });
        await context.route("**/fixture/video.m3u8", (route) =>
            route.fulfill({
                body:
                    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
                    Array.from(
                        { length: 60 },
                        (_, i) =>
                            (i ? "#EXT-X-DISCONTINUITY\n" : "") +
                            "#EXTINF:2.000000,\nsegment00.ts?segment=" +
                            i +
                            "\n"
                    ).join("") +
                    "#EXT-X-ENDLIST\n",
                contentType: "application/vnd.apple.mpegurl",
            })
        );
        await context.route("**/fixture/segment00.ts?*", (route) =>
            route.fulfill({
                body: fs.readFileSync(
                    path.resolve(
                        __dirname,
                        "../fixtures/media-runtime/segment00.ts"
                    )
                ),
                contentType: "video/mp2t",
            })
        );
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await context.addInitScript((portal) => {
            localStorage.setItem("ottplaylang", "_eng");
            localStorage.setItem("ottplayprov", "vportal");
            localStorage.setItem(
                "vportalprofiles",
                JSON.stringify({
                    active: 0,
                    portals: Array.from({ length: 15 }, (_, index) => ({
                        link: index ? "" : portal,
                        name: index ? "" : "Portal",
                        // Old selected roots are retained but do not constrain visibility.
                        sections: index
                            ? []
                            : [
                                  {
                                      request: { cmd: "obsolete" },
                                      title: "Old selection",
                                  },
                              ],
                    })),
                })
            );
        }, link);
        await page.goto(`/f/${device ? device + "/" : ""}`);
        await expect
            .poll(() => page.evaluate(() => window.commandChannelsReady))
            .toBe(true);
        expect(await page.evaluate(() => window.cList.length)).toBe(1);
        releaseFilms();
        await expect
            .poll(() => page.evaluate(() => window.cList.length))
            .toBe(3);
        expect(
            await page.evaluate(() => window.cats[window._("All")].length)
        ).toBe(3);
        await page.evaluate(() => window.bucketsList(window.catIndex));
        await expect(page.locator("#listCaption")).toHaveText(
            "Category selection"
        );
        await expect(page.locator("#list")).toContainText("Cartoons / Series");
        await page.evaluate(() => {
            window.selIndex = window.catsArray.indexOf("Cartoons");
            window.listKeyHandler(window.keys.ENTER);
        });
        await expect(page.locator("#list")).toContainText("Cartoon");
        await expect(page.locator("#list")).toContainText("Episode");
        await expect(page.locator("#list")).not.toContainText("Film");
        await expect(page.locator("#listDetail")).toContainText(
            "Cartoon selected from its category."
        );
        await expect(
            page.locator("#listDetail .ott-channel-detail-time")
        ).toHaveCount(0);
        await expect(page.locator("#listIn")).not.toContainText(
            "no epg at current time"
        );
        expect(await page.evaluate(() => window.cList.length)).toBe(3);
        await page.screenshot({
            path: test.info().outputPath("vportal-category-list.png"),
        });
    });
}
