// Future browser qualification. Real production list/host/router; no live providers.
const { test, expect } = require("../helpers/browser-test.cjs");
const {
    fixture,
    install,
    pair,
    ensure,
    importDocument,
    scenarioTargets,
    openFavorites,
} = require("../helpers/global-mixed-browser.cjs");
test("receiver with reordered profiles plays imported mixed Favorites through the real list", async ({
    browser,
    baseURL,
}) => {
    test.setTimeout(180000);
    const origin = await browser.newContext({ baseURL }),
        receiver = await browser.newContext({ baseURL });
    try {
        await install(origin, baseURL, "origin");
        await install(receiver, baseURL, "receiver");
        const first = await origin.newPage(),
            second = await receiver.newPage();
        for (const [page, name] of [
            [first, "origin"],
            [second, "receiver"],
        ]) {
            await page.goto("/f/pc/");
            await page.waitForFunction(() => window.commandChannelsReady);
            await pair(page, fixture.hosts[name].targets);
        }
        const originRows = await importDocument(
            first,
            fixture.portable_document
        );
        const exported = await first.evaluate(
            async () =>
                (await window.__ottGlobalFavorites.facade.exportSnapshot())
                    .document
        );
        expect(exported).toEqual(fixture.portable_document);
        const settingsBefore = await second.evaluate(() =>
            [
                "m3um3uArr",
                "vportalprofiles",
                "offlineProfiles",
                "offlineProfileBindings",
                "plexcfg",
            ].map((key) => window.stbGetPersistedItem(key))
        );
        const rows = await importDocument(second, exported),
            ids = rows.map((row) => row.id);
        expect(rows).toHaveLength(5);
        expect(new Set(ids).size).toBe(5);
        expect(ids).not.toEqual(originRows.map((row) => row.id));
        expect(
            await second.evaluate(() =>
                [
                    "m3um3uArr",
                    "vportalprofiles",
                    "offlineProfiles",
                    "offlineProfileBindings",
                    "plexcfg",
                ].map((key) => window.stbGetPersistedItem(key))
            )
        ).toEqual(settingsBefore);
        const secondMerge = await importDocument(second, exported);
        expect(secondMerge.map((row) => row.id)).toEqual(ids);
        async function check(index, observationStart = 0) {
            const provider =
                    fixture.hosts.receiver.targets[index].configured_origin
                        .provider,
                suffix = [
                    "local.mp4",
                    "one.mp4",
                    "portal.mp4",
                    "/library/parts/42/file.mp4",
                    "two.mp4",
                ][index];
            await second.waitForFunction(
                ({ provider, suffix }) =>
                    window.__ottActiveProviderDriver?.id ===
                        (provider === "local" ? "offline" : provider) &&
                    !window.__ottGlobalFavorites.router.busy() &&
                    window.video?.readyState >= 2 &&
                    window.video.currentTime > 0.1 &&
                    window.video.currentSrc.includes(suffix),
                { provider, suffix }
            );
            const state = await second.evaluate(
                (observationStart) => ({
                    observed: window.__mixedObserved.slice(observationStart),
                    provider: window.__ottActiveProviderDriver.id,
                    src: window.video.currentSrc,
                }),
                observationStart
            );
            expect(state.provider).toBe(
                provider === "local" ? "offline" : provider
            );
            expect(state.observed.length).toBeGreaterThan(0);
            expect(
                state.observed.every(
                    (row) =>
                        row.provider === state.provider &&
                        row.url.includes(suffix)
                )
            ).toBe(true);
            const current = await second.evaluate(
                async () =>
                    (await window.__ottGlobalFavorites.currentItem()).entry
            );
            expect(current).toEqual(rows[index].entry);
            const previousScreen = await second.evaluate((ids) => {
                const owner = window.__ottClassicScreenPort.screens.current(),
                    list = document.getElementById("list");
                const globalList =
                    !!owner &&
                    owner.kind === "list" &&
                    owner.active() &&
                    owner.foreground() &&
                    window.isListVisible === true &&
                    !!list &&
                    list.getClientRects().length > 0 &&
                    owner.model.items === window.listArray &&
                    owner.model.handler === window.listKeyHandlerFn &&
                    JSON.stringify(window.listArray) === JSON.stringify(ids);
                return {
                    globalList,
                    id: owner ? owner.id : null,
                    otherOwner: !!owner && !globalList,
                };
            }, ids);
            // Escape only an actual global list. Fullscreen Back is configurable
            // and must not accidentally invoke previous-channel/menu/exit here.
            expect(previousScreen.otherOwner).toBe(false);
            if (previousScreen.globalList) {
                await second.keyboard.press("Escape");
                await second.waitForFunction(
                    () =>
                        !window.__ottClassicScreenPort.screens.current() &&
                        window.isListVisible !== true
                );
            }
            // Exercise ordinary fullscreen Enter, not the direct open helper.
            await second.keyboard.press("Enter");
            await second.waitForFunction(
                ({ ids, selectedId, previous }) => {
                    const owner =
                            window.__ottClassicScreenPort?.screens.current(),
                        list = document.getElementById("list");
                    return (
                        !!owner &&
                        owner.id !== previous &&
                        owner.kind === "list" &&
                        owner.active() &&
                        owner.foreground() &&
                        window.isListVisible === true &&
                        !!list &&
                        list.getClientRects().length > 0 &&
                        owner.model.items === window.listArray &&
                        owner.model.handler === window.listKeyHandlerFn &&
                        JSON.stringify(window.listArray) ===
                            JSON.stringify(ids) &&
                        window.listArray[window.selIndex] === selectedId
                    );
                },
                { ids, previous: previousScreen.id, selectedId: ids[index] }
            );
            await expect(second.locator("#list")).toContainText(
                rows[index].entry.title
            );
            expect(
                await second.evaluate(() => window.listArray[window.selIndex])
            ).toBe(ids[index]);
        }
        await ensure(second);
        await openFavorites(second, ids, ids[0]);
        await expect(second.locator("#list")).toContainText(
            rows[0].entry.title
        );
        const selected = await second.evaluate((id) => {
            const at = window.listArray.indexOf(id);
            if (at < 0) throw Error("favorite row absent");
            window.__mixedObserved = [];
            window.selIndex = at;
            return window.listKeyHandlerFn(window.keys.ENTER);
        }, ids[0]);
        expect(selected).toBe(true);
        await check(0);
        for (let index = 1; index < ids.length; index++) {
            await second.keyboard.press("Escape");
            await second.evaluate(() => {
                window.__mixedObserved = [];
            });
            await second.keyboard.press("="); // Existing PC CH_UP/plusProg path, no private navigation shortcut.
            await check(index);
        }
        await second.keyboard.press("Escape");
        await second.evaluate(() => {
            window.__mixedObserved = [];
        });
        await second.keyboard.press("-");
        await check(3);
        await second.keyboard.press("Escape");
        await second.evaluate(() => {
            window.__mixedObserved = [];
        });
        // Real media end must continue global order, never a Plex-only queue.
        await second.evaluate(() => {
            const video = window.video;
            if (!Number.isFinite(video.duration) || video.duration < 0.2)
                throw Error("finite fixture required");
            window.__mixedEnded = {
                count: 0,
                expectedProvider: window.__ottActiveProviderDriver.id,
                expectedUrl: video.currentSrc,
            };
            window.__mixedEndedListener = (event) => {
                if (event.target !== video) return;
                const ended = window.__mixedEnded;
                ended.count++;
                if (ended.count !== 1) return;
                ended.boundary = window.__mixedObserved.length;
                ended.provider = window.__ottActiveProviderDriver.id;
                ended.trusted = event.isTrusted;
                ended.url = video.currentSrc;
            };
            // Capture precedes the app's target handler and next-source play.
            document.addEventListener(
                "ended",
                window.__mixedEndedListener,
                true
            );
            video.currentTime = video.duration - 0.15;
        });
        await second.waitForFunction(() => window.__mixedEnded.count > 0);
        const boundary = await second.evaluate(
            () => window.__mixedEnded.boundary
        );
        await check(4, boundary);
        const ended = await second.evaluate(() => {
            document.removeEventListener(
                "ended",
                window.__mixedEndedListener,
                true
            );
            window.__mixedEnded.observed = window.__mixedObserved;
            return window.__mixedEnded;
        });
        expect(ended.count).toBe(1);
        expect(ended.trusted).toBe(true);
        expect(ended.expectedProvider).toBe("plex");
        expect(ended.expectedUrl).toContain("/library/parts/42/file.mp4");
        expect(ended.provider).toBe(ended.expectedProvider);
        expect(ended.url).toBe(ended.expectedUrl);
        expect(
            ended.observed
                .slice(0, boundary)
                .every(
                    (row) =>
                        row.provider === ended.expectedProvider &&
                        row.url === ended.expectedUrl
                )
        ).toBe(true);
        const suffix = ended.observed.slice(boundary);
        const nextUrl = new URL("/mixed/media/two.mp4", baseURL).href;
        expect(suffix.length).toBeGreaterThan(0);
        expect(
            suffix.every((row) => row.provider === "m3u" && row.url === nextUrl)
        ).toBe(true);
        // Plain fullscreen F, not a direct store.remove call. Other providers survive.
        await second.keyboard.press("Escape");
        await second.keyboard.press("f");
        await expect
            .poll(() =>
                second.evaluate(async () =>
                    (
                        await window.__ottGlobalFavorites.store.snapshot()
                    ).entries.map((row) => row.id)
                )
            )
            .toEqual(ids.slice(0, 4));
        await openFavorites(second, ids.slice(0, 4), ids[0]);
        await expect(second.locator("#list")).not.toContainText(
            rows[4].entry.title
        );
        for (const row of rows.slice(0, 4))
            await expect(second.locator("#list")).toContainText(
                row.entry.title
            );
        await second.keyboard.press("Escape");
        await second.keyboard.press("f");
        await expect
            .poll(() =>
                second.evaluate(async () =>
                    (
                        await window.__ottGlobalFavorites.store.snapshot()
                    ).entries.map((row) => ({
                        locator: row.locator,
                        origin: row.origin,
                        title: row.title,
                    }))
                )
            )
            .toEqual(rows.map((row) => row.entry));
        // Opening is asynchronous: wait for the fresh re-added UUID and actual selection.
        const freshIds = await second.evaluate(async () =>
            (await window.__ottGlobalFavorites.store.snapshot()).entries.map(
                (row) => row.id
            )
        );
        await openFavorites(second, freshIds, freshIds[4]);
        // Focus Local while M3U Two remains the actual playing item.
        for (let step = 0; step < 4; step++)
            await second.keyboard.press("ArrowUp");
        expect(
            await second.evaluate(() => window.listArray[window.selIndex])
        ).toBe(ids[0]);
        const playingBeforeFocusedF = await second.evaluate(async () => ({
            entry: (await window.__ottGlobalFavorites.currentItem()).entry,
            generation: window.__ottClassicPlayback.snapshot().generation,
            provider: window.__ottActiveProviderDriver.id,
        }));
        await second.keyboard.press("f");
        await expect
            .poll(() =>
                second.evaluate(async () =>
                    (
                        await window.__ottGlobalFavorites.store.snapshot()
                    ).entries.map((row) => ({
                        locator: row.locator,
                        origin: row.origin,
                        title: row.title,
                    }))
                )
            )
            .toEqual(rows.slice(1).map((row) => row.entry));
        expect(
            await second.evaluate(async () => ({
                entry: (await window.__ottGlobalFavorites.currentItem()).entry,
                generation: window.__ottClassicPlayback.snapshot().generation,
                provider: window.__ottActiveProviderDriver.id,
            }))
        ).toEqual(playingBeforeFocusedF);
        await expect(second.locator("#info")).toHaveText(
            "Favorites: − " + rows[0].entry.title
        );
    } finally {
        await origin.close();
        await receiver.close();
    }
});

for (const scenario of fixture.receiver_scenarios.filter(
    (row) => row.name !== "complete-reordered"
)) {
    test(
        "mixed Favorites refuses fallback: " + scenario.name,
        async ({ browser, baseURL }) => {
            test.setTimeout(120000);
            const context = await browser.newContext({ baseURL });
            try {
                await install(context, baseURL, "receiver", scenario);
                const page = await context.newPage();
                await page.goto("/f/pc/");
                await page.waitForFunction(() => window.commandChannelsReady);
                await pair(page, scenarioTargets("receiver", scenario));
                const rows = await importDocument(
                    page,
                    fixture.portable_document
                );
                const index = scenario.expected.findIndex(
                        (value) => value !== "resolved"
                    ),
                    expected = scenario.expected[index];
                await ensure(page);
                // Transparent observation of the real route selected by the production list.
                await page.evaluate(() => {
                    const router = window.__ottGlobalFavorites.router,
                        select = router.select;
                    window.__mixedResults = [];
                    router.select = function () {
                        const ticket = select.apply(this, arguments);
                        ticket.result.then((result) =>
                            window.__mixedResults.push(result)
                        );
                        return ticket;
                    };
                });
                await openFavorites(
                    page,
                    rows.map((row) => row.id),
                    rows[0].id
                );
                // biome-ignore assist/source/useSortedKeys: Observe provider before the playback snapshot call.
                const before = await page.evaluate(() => ({
                    provider: window.__ottActiveProviderDriver.id,
                    generation:
                        window.__ottClassicPlayback.snapshot().generation,
                }));
                await page.evaluate((id) => {
                    window.__mixedObserved = [];
                    const at = window.listArray.indexOf(id);
                    if (at < 0) throw Error("unresolved row dropped");
                    window.selIndex = at;
                    window.listKeyHandlerFn(window.keys.ENTER);
                }, rows[index].id);
                await expect
                    .poll(() =>
                        page.evaluate(() => window.__mixedResults.length)
                    )
                    .toBe(1);
                expect(
                    await page.evaluate(() => window.__mixedResults[0].status)
                ).toBe(expected);
                expect(
                    await page.evaluate(() => window.__mixedObserved)
                ).toEqual([]);
                expect(
                    // biome-ignore assist/source/useSortedKeys: Observe provider before the playback snapshot call.
                    await page.evaluate(() => ({
                        provider: window.__ottActiveProviderDriver.id,
                        generation:
                            window.__ottClassicPlayback.snapshot().generation,
                    }))
                ).toEqual(before);
                expect(
                    await page.evaluate(async () =>
                        (
                            await window.__ottGlobalFavorites.store.snapshot()
                        ).entries.map((row) => ({
                            locator: row.locator,
                            origin: row.origin,
                            title: row.title,
                        }))
                    )
                ).toEqual(rows.map((row) => row.entry));
            } finally {
                await context.close();
            }
        }
    );
}
