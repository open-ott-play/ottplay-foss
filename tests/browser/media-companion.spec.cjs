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

for (const layout of ["/f/pc/", "/f/"]) {
    test(`companion channel resolves, decodes and releases its lease ${layout}`, async ({
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
                return route.fulfill({ body: movie, contentType: "video/mp4" });
            if (!url.pathname.startsWith(base + "/")) return route.continue();
            const api = url.pathname.slice(base.length);
            calls.push(request.method() + " " + api);
            let value;
            if (api === "/capabilities")
                value = { plugins: true, schema: 1, torrent: true };
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
            ({ origin, base }) => {
                localStorage.setItem("ottplaylang", "_eng");
                localStorage.setItem("ottplayprov", "m3u");
                localStorage.setItem("m3usPlayers", "0");
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
            { base, origin }
        );
        await page.goto(layout);
        await page.waitForFunction(() => window.commandChannelsReady === true);
        await page.waitForFunction(
            () =>
                window.video?.currentTime > 0.1 && window.video?.videoWidth > 0
        );
        expect(preparingReads).toBeGreaterThan(0);
        expect(calls).toContain("POST /sessions/viewer-one/select");
        expect(
            await page.evaluate(
                () =>
                    window.channels[window.curList[0]].url ||
                    window.getChannelUrl(window.curList[0])
            )
        ).toBe(source);
        await page.evaluate(() =>
            window.playChannel(window.catsArray.indexOf("Samples"), 1, true)
        );
        await expect
            .poll(
                () =>
                    calls.filter(
                        (call) => call === "DELETE /sessions/viewer-one"
                    ).length
            )
            .toBe(1);
        await page.waitForFunction(
            () =>
                window.video?.currentSrc.includes("/sample.mp4") &&
                window.video.currentTime > 0.1
        );
        expect(errors).toEqual([]);
    });
}
