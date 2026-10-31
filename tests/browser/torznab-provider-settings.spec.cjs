// Use the actual provider, editor and catalogue; the private native API is a fixture.
const { test, expect } = require("../helpers/browser-test.cjs");

async function chooseRow(page, label) {
    await page.waitForFunction(
        (label) =>
            Array.isArray(window.listArray) &&
            window.listArray.some((row) =>
                String(row.name || row).startsWith(label)
            ),
        label
    );
    const position = await page.evaluate((label) => {
        const index = window.listArray.findIndex((row) =>
            String(row.name || row).startsWith(label)
        );
        return { index, selected: window.selIndex };
    }, label);
    expect(position.index).toBeGreaterThanOrEqual(0);
    for (let index = position.selected; index < position.index; index++)
        await page.keyboard.press("ArrowDown");
    for (let index = position.selected; index > position.index; index--)
        await page.keyboard.press("ArrowUp");
    await expect(page.locator("#list .item.ott-selected")).toContainText(label);
    await page.keyboard.press("Enter");
}

async function enterField(page, label, value, secret = false) {
    await chooseRow(page, label);
    await expect(page.locator("#listEdit")).toBeVisible();
    const input = page.locator("#editvar");
    await expect(input).toHaveAttribute("type", secret ? "password" : "text");
    await input.fill(value);
    await page
        .locator("#listEdit [data-ott-key]")
        .filter({ hasText: "Set" })
        .click();
    await expect(page.locator("#listEdit")).toBeHidden();
}

async function startNativePlayer(page, context, baseURL, mode, options = {}) {
    const origin = new URL(baseURL).origin;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin)
            return route.abort();
        return route.continue();
    });
    await context.addInitScript(() => {
        localStorage.setItem("ottplaylang", "_eng");
        localStorage.setItem("ottplayprov", "demo");
    });
    await page.goto("/f/pc/");
    await page.waitForFunction(() => window.commandChannelsReady === true);
    await page.evaluate(
        ({ mode, initialSource, searchMode }) => {
            let source = initialSource;
            window.__settingsSearchMode = searchMode;
            window.__settingsConfigureFailure = false;
            window.__settingsIndexerCalls = [];
            window.__settingsNativeOnly = [];
            window.__ottMediaCompanion.providerAvailable = () => true;
            window.__ottMediaCompanion.indexerAvailable = () => true;
            window.__ottMediaCompanion.ensure = async (nativeOnly) => {
                window.__settingsNativeOnly.push(nativeOnly);
                return {
                    torznab: async (operation, params) => {
                        window.__settingsIndexerCalls.push({
                            operation,
                            params: JSON.parse(JSON.stringify(params)),
                        });
                        if (operation === "list")
                            return {
                                schema: 1,
                                sources: source ? [source] : [],
                            };
                        if (operation === "configure") {
                            if (window.__settingsConfigureFailure)
                                throw new Error("torznab_store_unavailable");
                            source = {
                                id: params.sourceId,
                                label: params.label,
                            };
                            return { schema: 1, source };
                        }
                        if (operation === "caps")
                            return {
                                categories: [],
                                schema: 1,
                                searchAvailable: true,
                                sourceId: source.id,
                            };
                        if (operation === "search") {
                            if (window.__settingsSearchMode === "loading")
                                return new Promise((resolve, reject) => {
                                    window.__settingsPendingSearch = {
                                        reject,
                                        resolve,
                                    };
                                });
                            return {
                                items:
                                    window.__settingsSearchMode === "empty"
                                        ? []
                                        : [
                                              {
                                                  resultRef: "1".repeat(32),
                                                  title: "Open catalogue fixture",
                                              },
                                          ],
                                nextOffset: null,
                                schema: 1,
                                sourceId: source.id,
                            };
                        }
                        throw new Error("Unexpected native operation");
                    },
                };
            };
            window.saveSettings({ interfaceMode: mode });
            window.stbSetItem("ottplayprov", "torrent");
            window.loadProv();
        },
        {
            initialSource: options.initialSource || null,
            mode,
            searchMode: options.searchMode || "items",
        }
    );
    await page.waitForFunction(
        () => window.__ottActiveProviderDriver?.id === "torrent"
    );
    return errors;
}

for (const mode of [0, 1]) {
    test(`Private Torznab settings mask the key and Load the catalogue (interface ${mode})`, async ({
        page,
        context,
        baseURL,
    }) => {
        const errors = await startNativePlayer(page, context, baseURL, mode);
        expect(await page.evaluate(() => window.__ottEditProvider())).toBe(
            true
        );
        await chooseRow(page, "Prowlarr / Torznab");
        await expect(page.locator("#list")).toContainText("Server address");
        await expect(page.locator("#list")).toContainText("Label (optional)");

        await chooseRow(page, "Access key");
        await page.locator("#editvar").fill("discarded-fixture-key");
        await page.locator('#listEdit [data-ott-key="27"]').click();
        await expect(page.locator("#listEdit")).toBeHidden();
        expect(await page.evaluate(() => window.editvar)).toBe("");
        await enterField(page, "Server address", "http://127.0.0.1:9696/1/api");
        await enterField(page, "Access key", "private-fixture-key", true);
        await expect(page.locator("#list")).toContainText("••••••••");
        await expect(page.locator("#list")).not.toContainText(
            "private-fixture-key"
        );
        await chooseRow(page, "Load");
        await expect(page.locator("#list")).toContainText(
            "Open catalogue fixture"
        );
        const state = await page.evaluate(() => ({
            calls: window.__settingsIndexerCalls,
            mode: window.settings.torrentDiscoveryMode,
            nativeOnly: window.__settingsNativeOnly,
            stored: JSON.stringify(Object.entries(localStorage)),
        }));
        const configured = state.calls.find(
            (call) => call.operation === "configure"
        );
        expect(configured.params).toEqual({
            apiKey: "private-fixture-key",
            endpoint: "http://127.0.0.1:9696/1/api",
            label: "Prowlarr / Torznab",
            sourceId: expect.stringMatching(/^torznab-[a-z0-9-]+$/),
        });
        expect(state.mode).toBe("local");
        expect(state.nativeOnly.length).toBeGreaterThan(0);
        expect(state.nativeOnly.every((value) => value === true)).toBe(true);
        expect(state.stored).not.toContain("private-fixture-key");
        expect(state.stored).not.toContain("127.0.0.1:9696");

        await page.evaluate(() => window.__ottEditProvider());
        await chooseRow(page, "Prowlarr / Torznab");
        await chooseRow(page, "Prowlarr / Torznab");
        await chooseRow(page, "Replace");
        await expect(page.locator("#list")).toContainText(
            "Server address: Not configured"
        );
        await expect(page.locator("#list")).not.toContainText("••••••••");
        await expect(page.locator("#list")).not.toContainText("127.0.0.1:9696");
        await chooseRow(page, "Cancel");
        await expect(page.locator("#list")).toContainText("Add new list");
        expect(errors).toEqual([]);
    });
}

async function expectVisibleStatus(page, message) {
    const detail = page.locator("#listDetail");
    await expect(detail).toContainText(message);
    await expect(detail).toBeVisible();
    const box = await detail.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    return box;
}

for (const viewport of [
    { height: 720, width: 1280 },
    { height: 852, width: 393 },
]) {
    test(`Modern empty Torznab catalogue exposes loading, errors and no results at ${viewport.width}px`, async ({
        page,
        context,
        baseURL,
    }) => {
        await page.setViewportSize(viewport);
        const errors = await startNativePlayer(page, context, baseURL, 1, {
            initialSource: { id: "fixture", label: "Test library" },
            searchMode: "loading",
        });
        await page.waitForFunction(() => !!window.__settingsPendingSearch);
        await expectVisibleStatus(page, "Loading… please wait…");
        await expect(page.locator("#listDetail .ott-spinner")).toBeVisible();
        await page.evaluate(() => {
            window.__settingsPendingSearch.reject(
                new Error("torznab_network_error")
            );
            window.__settingsPendingSearch = null;
        });
        await expectVisibleStatus(page, "Failed to load!");
        await expect(page.locator("#listDetail .ott-spinner")).toHaveCount(0);

        await page.evaluate(() => {
            window.__settingsSearchMode = "empty";
            window.__ottEditProvider();
        });
        await chooseRow(page, "Load");
        await expectVisibleStatus(page, "Not found");
        await expect(page.locator("#list .item")).toHaveCount(0);

        await page.evaluate(() => {
            window.__settingsSearchMode = "items";
            window.__ottEditProvider();
        });
        await chooseRow(page, "Load");
        await expect(page.locator("#list .item")).toContainText(
            "Open catalogue fixture"
        );
        await expect(page.locator("#listDetail")).toBeHidden();
        expect(errors).toEqual([]);
    });
}

test("Modern Torznab settings expose invalid address and Load failures on a narrow screen, then recover", async ({
    page,
    context,
    baseURL,
}) => {
    await page.setViewportSize({ height: 852, width: 393 });
    const errors = await startNativePlayer(page, context, baseURL, 1);
    await page.evaluate(() => window.__ottEditProvider());
    await chooseRow(page, "Prowlarr / Torznab");
    await enterField(page, "Server address", "not-an-address");
    await chooseRow(page, "Load");
    const invalid = await expectVisibleStatus(
        page,
        "Use HTTP or HTTPS without a username or password in the address."
    );
    const list = await page.locator("#listIn").boundingBox();
    expect(list.y + list.height).toBeLessThanOrEqual(invalid.y + 1);
    expect(
        await page.evaluate(() =>
            window.__settingsIndexerCalls.some(
                (call) => call.operation === "configure"
            )
        )
    ).toBe(false);

    await enterField(page, "Server address", "http://127.0.0.1:9696/1/api");
    await page.evaluate(() => {
        window.__settingsConfigureFailure = true;
    });
    await chooseRow(page, "Load");
    await expectVisibleStatus(page, "Failed to load!");
    await expect(
        page.locator("#list .item").filter({ hasText: /^\s*Load\s*$/ })
    ).toBeVisible();

    await page.evaluate(() => {
        window.__settingsConfigureFailure = false;
    });
    await chooseRow(page, "Load");
    await expect(page.locator("#list .item")).toContainText(
        "Open catalogue fixture"
    );
    expect(
        await page.evaluate(
            () =>
                window.__settingsIndexerCalls.filter(
                    (call) => call.operation === "configure"
                ).length
        )
    ).toBe(2);
    expect(errors).toEqual([]);
});
