// Boot the shipped player and exercise its real HTML media events. All media
// requests use the checked-in HLS fixture; no provider account or TV is implied.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const mediaRoot = path.resolve(__dirname, "../fixtures/media-runtime");

async function episodeFixture(page, context, baseURL, holdNext = false) {
    const origin = new URL(baseURL).origin;
    const errors = [];
    const resolutions = [];
    const manifests = [];
    let releaseNext;
    const nextResponse = new Promise((resolve) => {
        releaseNext = resolve;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin && url.pathname === "/vportal/api") {
            const { params } = request.postDataJSON();
            if (params.cmd === "play") {
                const revision = resolutions.push(params.id);
                if (holdNext && revision === 2) await nextResponse;
                const media = (quality) =>
                    "https://media.test/" +
                    params.id +
                    "/" +
                    quality +
                    "/index.m3u8?revision=" +
                    revision;
                return route.fulfill({
                    json: {
                        url: media("SD"),
                        variants: { HD: media("HD"), SD: media("SD") },
                    },
                });
            }
            return route.fulfill({
                json: {
                    items: [1, 2].map((id) => ({
                        request: { cmd: "play", id },
                        title: "Episode " + id,
                        type: "stream",
                    })),
                    title: "Fixture series",
                    type: "multistream",
                },
            });
        }
        if (
            url.hostname === "media.test" ||
            url.pathname.startsWith("/demo/")
        ) {
            const segment = url.pathname.endsWith(".ts");
            if (url.hostname === "media.test" && !segment)
                manifests.push(url.pathname + url.search);
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
                headers: { "Access-Control-Allow-Origin": "*" },
            });
        }
        return url.origin === origin
            ? route.continue()
            : route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "demo");
    });
    await page.goto(process.env.OTTP_EPISODE_ENTRY || "/f/pc/");
    await page.waitForFunction(
        () => window.__ottDevice && !document.body.classList.contains("booting")
    );
    await page.evaluate(() => {
        window.stbStop();
        window.__ottMedia.cancel();
        window.host = location.origin;
        window.p_pref = "episode-browser-fixture";
        window.m3uArr = null;
        window.ottplayDemoActive = false;
        window.sFavorites = 1;
        window.sMedCount = 2;
        window.parentPIN = "";
        window.settings.stopPlay = true;
        const saved = {};
        window.providerGetItem = (key) => saved[key] || null;
        window.providerSetItem = (key, value) => {
            saved[key] = value;
        };
        const client = window.createVPortalClient(
            "portal::[key:SYNTHETIC_FIXTURE_KEY]http://portal.invalid/api/v1/",
            { sourceId: "browser-fixture", title: "VPortal" }
        );
        window.providerMediaClient = client;
        window.getMediaArray = client.load;
        window.playMedia = client.play;
        const sourceId = window.__ottSourceIdentity.media(window);
        // An unfinished second episode must not interrupt automatic playback
        // with the manual resume prompt or start from its saved position.
        saved["mediaJournal.v1:" + sourceId] = JSON.stringify({
            favorites: [],
            history: [
                {
                    itemId: 'request:{"cmd":"play","id":2}',
                    payload: { title: "Fixture series - Episode 2" },
                    position: 90,
                    sourceId,
                },
            ],
            sourceId,
            version: 1,
        });
        window.__episodeEvents = [];
        document.querySelector("video").addEventListener("ended", (event) => {
            window.__episodeEvents.push({ trusted: event.isTrusted });
        });
        window.__episodePickers = 0;
        const showSelectBox = window.showSelectBox;
        window.showSelectBox = function (...args) {
            window.__episodePickers++;
            return showSelectBox.apply(this, args);
        };
        window.__ottMedia.open("");
    });
    await page.waitForFunction(() => {
        const view = window.__ottMedia.snapshot();
        return (
            !view.loading &&
            view.frame?.items.filter((item) => item.payload.__ottMediaSequence)
                .length === 2
        );
    });
    expect(
        await page.evaluate(() =>
            window.__ottMedia
                .snapshot()
                .frame.items.filter((item) => item.payload.__ottMediaSequence)
                .map((item) => ({
                    sequence: item.payload.__ottMediaSequence,
                    title: item.title,
                }))
        )
    ).toEqual([
        { sequence: true, title: "Fixture series - Episode 1" },
        { sequence: true, title: "Fixture series - Episode 2" },
    ]);
    await page.evaluate(() => window.__ottMedia.select(0));
    await expect(page.locator("#numprog")).toContainText("HD");
    await page.evaluate(() => {
        window._doKey(window.keys.DOWN);
        window._doKey(window.keys.ENTER);
    });
    await pauseEpisode(page, 1);
    return { errors, manifests, releaseNext, resolutions };
}

async function pauseEpisode(page, id) {
    await page.waitForFunction((episode) => {
        const state = window.__ottClassicPlayback.snapshot();
        const video = document.querySelector("video");
        if (
            state.phase !== "playing" ||
            state.target?.channelId !==
                'request:{"cmd":"play","id":' + episode + "}" ||
            video.readyState < 2
        )
            return false;
        window.stbPause();
        return true;
    }, id);
    await expect(page.locator("#dialogbox")).toBeHidden();
    await expect(page.locator("#numprog")).toBeHidden();
}

async function finishEpisode(page) {
    await page.evaluate(() => {
        const video = document.querySelector("video");
        if (!Number.isFinite(video.duration))
            throw new Error("Missing HLS duration");
        window.stbSetPosTime(video.duration - 0.15);
        window.stbContinue();
    });
}

test("natural episode completion resolves the next episode and loops with fresh URLs", async ({
    page,
    context,
    baseURL,
}) => {
    const fixture = await episodeFixture(page, context, baseURL);
    await finishEpisode(page);
    await pauseEpisode(page, 2);
    expect(fixture.resolutions).toEqual([1, 2]);
    expect(
        await page.evaluate(() => document.querySelector("video").currentTime)
    ).toBeLessThan(1);
    await finishEpisode(page);
    await pauseEpisode(page, 1);
    expect(fixture.resolutions).toEqual([1, 2, 1]);
    expect(fixture.manifests).toEqual([
        "/1/HD/index.m3u8?revision=1",
        "/2/HD/index.m3u8?revision=2",
        "/1/HD/index.m3u8?revision=3",
    ]);
    expect(await page.evaluate(() => window.__episodePickers)).toBe(1);
    expect(await page.evaluate(() => window.__episodeEvents)).toEqual([
        { trusted: true },
        { trusted: true },
    ]);
    expect(fixture.errors).toEqual([]);
});

test("manual Stop cancels the pending automatic episode resolution", async ({
    page,
    context,
    baseURL,
}) => {
    const fixture = await episodeFixture(page, context, baseURL, true);
    await finishEpisode(page);
    await expect.poll(() => fixture.resolutions).toEqual([1, 2]);
    const cancelled = page.waitForEvent("requestfailed", {
        predicate: (request) =>
            new URL(request.url()).pathname === "/vportal/api" &&
            request.postDataJSON().params.id === 2,
    });
    await page.evaluate(() => window.stbStop());
    await cancelled;
    fixture.releaseNext();
    await page.evaluate(
        () =>
            new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
    );
    expect(
        await page.evaluate(() => window.__ottClassicPlayback.snapshot().phase)
    ).toBe("stopped");
    expect(fixture.manifests).toEqual(["/1/HD/index.m3u8?revision=1"]);
    expect(await page.evaluate(() => window.__episodeEvents)).toEqual([
        { trusted: true },
    ]);
    expect(fixture.errors).toEqual([]);
});

for (const [guideIds, names] of [
    [
        ["one", "two", "three"],
        ["One", "Two", "Three"],
    ],
    [
        ["same", "same", "same"],
        ["One", "Two", "Three"],
    ],
    [
        ["", "", ""],
        ["One", "Two", "Three"],
    ],
    [
        ["same", "same", "same"],
        ["Same", "Same", "Same"],
    ],
]) {
    test(
        "M3U restart restores station after URL rotation: " +
            JSON.stringify([guideIds, names]),
        async ({ page, context, baseURL }) => {
            const origin = new URL(baseURL).origin;
            let revision = 0;
            const errors = [];
            const providerBundles = [];
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("request", (request) => {
                const pathname = new URL(request.url()).pathname;
                if (/^\/dist\/provider-[^/]+\.js$/.test(pathname))
                    providerBundles.push(pathname);
            });
            await context.route("**/*", async (route) => {
                const url = new URL(route.request().url());
                if (url.href.includes("fixture-channels.m3u")) {
                    const order = revision ? [2, 0, 1] : [0, 1, 2];
                    return route.fulfill({
                        body:
                            "#EXTM3U\n" +
                            order
                                .map(
                                    (index) =>
                                        '#EXTINF:-1 tvg-id="' +
                                        guideIds[index] +
                                        '" group-title="News",' +
                                        names[index] +
                                        "\nhttps://media.test/" +
                                        index +
                                        "/index.m3u8?token=" +
                                        revision +
                                        "\n"
                                )
                                .join(""),
                        contentType: "text/plain",
                        headers: { "Access-Control-Allow-Origin": "*" },
                    });
                }
                if (url.hostname === "media.test") {
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
                        headers: { "Access-Control-Allow-Origin": "*" },
                    });
                }
                return url.origin === origin
                    ? route.continue()
                    : route.abort("blockedbyclient");
            });
            await context.routeWebSocket("**/*", (socket) => socket.close());
            await context.addInitScript(() => {
                if (localStorage.getItem("ottplayprov")) return;
                localStorage.setItem("ottplaylang", "_eng");
                localStorage.setItem("ottplayprov", "m3u");
                localStorage.setItem(
                    "m3um3uArr",
                    JSON.stringify({
                        active: 0,
                        M3Us: [
                            {
                                www: "https://playlist.test/fixture-channels.m3u",
                            },
                        ],
                    })
                );
            });
            await page.goto("/f/pc/");
            await page.waitForFunction(() => window.curList?.length === 3);
            await page.evaluate(() =>
                window.playChannel(window.catsArray.indexOf("News"), 1)
            );
            const before = await page.evaluate(
                () => window.curList[window.primaryIndex]
            );
            await expect
                .poll(() =>
                    page.evaluate(
                        () => window.__ottClassicPlayback.snapshot().phase
                    )
                )
                .toBe("playing");
            expect(providerBundles).toEqual(["/dist/provider-m3u.js"]);
            revision++;
            // A new document reloads the playlist and reconstructs all private stores.
            await page.reload();
            await page.waitForFunction(() => window.curList?.length === 3);
            const after = await page.evaluate(() => {
                const id = window.curList[window.primaryIndex];
                return {
                    group: window.catsArray[window.catIndex],
                    id,
                    index: window.primaryIndex,
                    name: window.channels[id].channel_name,
                    route: new URL(window.channels[id].url).pathname,
                };
            });
            expect(after.id).not.toBe(before);
            expect(after).toMatchObject({
                group: "News",
                index: 2,
                name: names[1],
                route: "/1/index.m3u8",
            });
            await expect
                .poll(() =>
                    page.evaluate(
                        () => window.__ottClassicPlayback.snapshot().phase
                    )
                )
                .toBe("playing");
            // Each cold document loads its selected family once; playback and
            // channel rotation must not eagerly fetch any other provider.
            expect(providerBundles).toEqual([
                "/dist/provider-m3u.js",
                "/dist/provider-m3u.js",
            ]);
            expect(errors).toEqual([]);
        }
    );
}

test("built driver, media session and journal stay connected through playback", async ({
    page,
    context,
    baseURL,
}) => {
    const origin = new URL(baseURL).origin;
    const errors = [];
    const providerScripts = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (/\/providers\/.+\/provider\.js$/.test(url.pathname))
            providerScripts.push(url.pathname);
    });
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/demo/pattern.m3u8")
            return route.fulfill({
                body: fs.readFileSync(path.join(mediaRoot, "index.m3u8")),
                contentType: "application/vnd.apple.mpegurl",
                headers: { "Access-Control-Allow-Origin": "*" },
            });
        if (url.pathname === "/demo/segment00.ts")
            return route.fulfill({
                body: fs.readFileSync(path.join(mediaRoot, "segment00.ts")),
                contentType: "video/mp2t",
                headers: { "Access-Control-Allow-Origin": "*" },
            });
        if (url.origin === origin) return route.continue();
        return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "demo");
        localStorage.setItem(
            "demoplaybackJournal",
            JSON.stringify({
                bookmark: {
                    channelId: "900000002",
                    groupId: "Demo",
                    kind: "live",
                },
                history: [],
                sourceId: "demo",
                updatedAt: Date.now(),
                version: 2,
            })
        );
    });
    await page.goto("/f/pc/", { waitUntil: "load" });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const video = document.querySelector("video");
                return (
                    video &&
                    video.readyState >= 2 &&
                    video.currentTime > 0 &&
                    video.getVideoPlaybackQuality().totalVideoFrames > 0
                );
            })
        )
        .toBe(true);
    expect(providerScripts).toEqual([]);

    // Use the actual user-facing media command. The provider supplies the URL,
    // while engine events drive typed state and the source-scoped media journal.
    await page.evaluate(() => {
        window.playMedia({
            stream_url:
                "https://liminal-sketch-vv8r.here.now/demo/pattern.m3u8",
            title: "Local browser fixture",
        });
    });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const state = window.__ottClassicPlayback.snapshot();
                return state.phase === "playing" && state.target.kind === "vod";
            })
        )
        .toBe(true);
    await page.evaluate(() => window.stbPause());
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottClassicPlayback.snapshot().phase)
        )
        .toBe("paused");
    await page.evaluate(() => {
        window.stbSetPosTime(0.5);
        window.dispatchEvent(new Event("beforeunload"));
    });
    const paused = await page.evaluate(() => ({
        channelBookmark: JSON.parse(window.providerGetItem("playbackJournal"))
            .bookmark,
        media: JSON.parse(
            window.providerGetItem(
                "mediaJournal.v1:" + window.__ottMedia.sourceId()
            )
        ).history[0],
        phase: window.__ottClassicPlayback.snapshot().phase,
        position: document.querySelector("video").currentTime,
        ref: window.__ottMedia.current().ref,
    }));
    expect(paused.channelBookmark.kind).toBe("live");
    expect(paused.media.itemId).toBe(paused.ref.itemId);
    expect(paused.media.sourceId).toBe(paused.ref.sourceId);
    expect(paused.media.payload.title).toBe("Local browser fixture");
    expect(paused.media.position).toBeCloseTo(0.5, 1);
    expect(paused.position).toBeCloseTo(0.5, 1);
    expect(paused.phase).toBe("paused");
    await page.evaluate(() => window.stbContinue());
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottClassicPlayback.snapshot().phase)
        )
        .toBe("playing");
    await page.evaluate(() => window.stbStop());
    await expect
        .poll(() =>
            page.evaluate(() => window.__ottClassicPlayback.snapshot().phase)
        )
        .toBe("stopped");
    expect(errors).toEqual([]);
});
