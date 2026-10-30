const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("../helpers/browser-test.cjs");
const { ensure } = require("../helpers/global-mixed-browser.cjs");

test("Stalker profiles migrate, switch catalogs and restore selection after reload", async ({
    page,
    context,
    baseURL,
}) => {
    const local = new URL(baseURL).origin;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/stalker/api") {
            const request = route.request().postDataJSON();
            const portal = new URL(request.url);
            const second = portal.hostname === "second.fixture";
            const action = portal.searchParams.get("action");
            const responses = {
                get_all_channels: {
                    data: [
                        {
                            cmd: "https://media.fixture/live.m3u8",
                            id: "42",
                            name: second ? "Second channel" : "First channel",
                            tv_genre_id: "1",
                            use_http_tmp_link: 0,
                        },
                    ],
                    total_items: 1,
                },
                get_genres: [{ id: "1", title: "Fixture" }],
                get_profile: { blocked: "0", id: "1", status: "0" },
                handshake: { token: second ? "second-token" : "first-token" },
            };
            return route.fulfill({
                headers: { "access-control-allow-origin": "*" },
                json: { js: responses[action] || [] },
            });
        }
        if (url.origin === local) return route.continue();
        return route.abort();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "stalker");
        if (!localStorage.getItem("stalkerstalker_data"))
            localStorage.setItem(
                "stalkerstalker_data",
                JSON.stringify({
                    mac: "02:00:00:00:00:01",
                    portal: "https://first.fixture/c/",
                })
            );
    });
    async function channels(name) {
        await page.waitForFunction(
            (name) =>
                window.commandChannelsReady === true &&
                window.channels[42]?.channel_name === name,
            name
        );
    }
    async function openProfiles() {
        await page.evaluate(() => window.__ottEditProvider());
        await expect(page.locator("#listCaption")).toHaveText(
            "Select Stalker portal"
        );
        expect(await page.evaluate(() => window.listArray.length)).toBe(15);
    }
    await page.goto("/f/pc/");
    await channels("First channel");
    await openProfiles();
    await page.evaluate(() => {
        window.selIndex = 1;
        window.listKeyHandler(window.keys.ENTER);
    });
    await expect(page.locator("#listCaption")).toHaveText(
        "Stalker portal provider"
    );
    await page.evaluate(() => {
        for (const [index, value] of [
            [0, "https://second.fixture/c/"],
            [1, "02:00:00:00:00:02"],
            [2, "Second portal"],
        ]) {
            window.selIndex = index;
            window.listKeyHandler(window.keys.ENTER);
            window.editvar = value;
            window.setEdit();
        }
        window.selIndex = 4;
        window.listKeyHandler(window.keys.ENTER);
    });
    await channels("Second channel");
    await page.reload();
    await channels("Second channel");
    await openProfiles();
    expect(await page.evaluate(() => window.selIndex)).toBe(1);
    await expect(page.locator("#list")).toContainText("Second portal");
    await page.evaluate(() => {
        window.selIndex = 0;
        window.listKeyHandler(window.keys.ENTER);
    });
    await channels("First channel");
    await openProfiles();
    await page.evaluate(() => {
        window.selIndex = 1;
        window.listKeyHandler(window.keys.ENTER);
    });
    await channels("Second channel");
    expect(errors).toEqual([]);
});

test("Stalker movies and nested episodes join the live list and current movie Favorites", async ({
    page,
    context,
    baseURL,
}) => {
    const local = new URL(baseURL).origin;
    const mediaRoot = local + "/stalker-media-fixture/";
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== local) return route.abort("blockedbyclient");
        if (url.pathname === "/stalker/api") {
            const portal = new URL(route.request().postDataJSON().url);
            expect(portal.hostname).toBe("catalog.fixture");
            const params = portal.searchParams;
            const action = params.get("action");
            const paged = (data) => ({ data, total_items: data.length });
            let response = [];
            if (action === "handshake") response = { token: "fixture-token" };
            else if (action === "get_profile")
                response = { blocked: "0", id: "1", status: "0" };
            else if (action === "get_genres")
                response = [{ id: "1", title: "Live" }];
            else if (action === "get_all_channels")
                response = paged([
                    {
                        cmd: mediaRoot + "video.m3u8?live=1",
                        id: "42",
                        name: "Fixture live",
                        tv_genre_id: "1",
                        use_http_tmp_link: 0,
                    },
                ]);
            else if (action === "create_link")
                response = { cmd: "ffmpeg " + mediaRoot + "video.m3u8" };
            else if (params.get("type") === "vod") {
                if (action === "get_categories")
                    response = [
                        { id: "films", title: "Films" },
                        { id: "series", title: "Series" },
                    ];
                else if (action === "get_ordered_list") {
                    if (params.get("category") === "films")
                        response = paged([
                            {
                                cmd: "ffmpeg " + mediaRoot + "video.m3u8",
                                description: "A film from the Stalker catalog.",
                                id: "42",
                                name: "Fixture movie",
                                screenshot_uri: mediaRoot + "poster.png",
                            },
                        ]);
                    else if (params.get("season_id") === "2")
                        response = paged([
                            {
                                cmd: "ffmpeg " + mediaRoot + "video.m3u8",
                                description: "A nested Stalker episode.",
                                id: "42",
                                name: "Fixture episode",
                                screenshot_uri: mediaRoot + "poster.png",
                            },
                        ]);
                    else if (params.get("movie_id") === "20")
                        response = paged([
                            { id: "2", is_season: 1, name: "Season 1" },
                        ]);
                    else
                        response = paged([
                            { id: "20", is_series: 1, name: "Fixture show" },
                        ]);
                }
            }
            return route.fulfill({ json: { js: response } });
        }
        if (url.pathname === "/stalker-media-fixture/poster.png")
            return route.fulfill({
                body: Buffer.from(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
                    "base64"
                ),
                contentType: "image/png",
            });
        if (url.pathname === "/stalker-media-fixture/video.m3u8")
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
        if (url.pathname === "/stalker-media-fixture/segment00.ts")
            return route.fulfill({
                body: fs.readFileSync(
                    path.resolve(
                        __dirname,
                        "../fixtures/media-runtime/segment00.ts"
                    )
                ),
                contentType: "video/mp2t",
            });
        return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript((local) => {
        if (location.origin !== local) return;
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            this.muted = true;
            return play.call(this);
        };
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "stalker");
        localStorage.setItem("stalkersPlayers", "1");
        localStorage.setItem(
            "stalkerstalker_data",
            JSON.stringify({
                mac: "02:00:00:00:00:01",
                name: "Cinema fixture",
                portal: "https://catalog.fixture/c/",
            })
        );
    }, local);
    await page.goto("/f/pc/");
    await page.waitForFunction(
        () =>
            window.commandChannelsReady &&
            window.cList.length === 3 &&
            !window.__ottActiveProviderDriver.catalogLoading()
    );
    await ensure(page);
    await page.evaluate(() =>
        window.bucketsList(window.__ottChannels.index("system:all"))
    );
    await expect(page.locator("#list")).toContainText("Films");
    await expect(page.locator("#list")).toContainText("Series");
    await expect(page.locator("#list")).toContainText("Season 1");
    await page.keyboard.press("Enter");
    await expect(page.locator("#list")).toContainText("Fixture live");
    await expect(page.locator("#list")).toContainText("Fixture movie");
    await expect(page.locator("#list")).toContainText("Fixture episode");
    await page.evaluate(() => {
        const all = window.__ottChannels.index("system:all");
        const index = window.cats[window.catsArray[all]].findIndex(
            (id) => window.channels[id].channel_name === "Fixture movie"
        );
        window.channelsList(all, index);
    });
    await expect(page.locator("#list .item.ott-selected")).toContainText(
        "Fixture movie"
    );
    await expect(page.locator("#listDetail")).toContainText(
        "A film from the Stalker catalog."
    );
    const poster = page.locator("#listDetail .ott-channel-thumbnail");
    await expect(poster).toHaveAttribute("src", mediaRoot + "poster.png");
    await expect
        .poll(() =>
            poster.evaluate((image) => image.complete && image.naturalWidth > 0)
        )
        .toBe(true);
    await page.keyboard.press("Enter");
    await expect
        .poll(() =>
            page.evaluate(() => ({
                advancing: document.querySelector("video")?.currentTime > 0.2,
                phase: window.__ottClassicPlayback.snapshot().phase,
                title: window.__ottMedia.current()?.payload?.title,
            }))
        )
        .toEqual({
            advancing: true,
            phase: "playing",
            title: "Fixture movie",
        });
    // With no list owner, desktop F captures the actual playing media copy.
    // The same catalog still contains its live row with no media payload.
    await page.keyboard.press("f");
    await expect
        .poll(() =>
            page.evaluate(async () =>
                (
                    await window.__ottGlobalFavorites.store.snapshot()
                ).entries.map((entry) => entry.title)
            )
        )
        .toEqual(["Fixture movie"]);
    await page.evaluate(() => window.openGlobalFavorites());
    await expect(page.locator("#list")).toContainText("Fixture movie");
    expect(errors).toEqual([]);
});
