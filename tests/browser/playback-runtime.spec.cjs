// Boot the shipped player and exercise its real HTML media events. All media
// requests use the checked-in HLS fixture; no provider account or TV is implied.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const mediaRoot = path.resolve(__dirname, "../fixtures/media-runtime");

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
        if (/\/prov\/.+\/prov\.js$/.test(url.pathname))
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
