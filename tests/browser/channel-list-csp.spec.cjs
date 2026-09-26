const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "../..");
const origin = "http://127.0.0.1:4198";
const nonce = "ottplay-channel-fixture";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function nativePolicy() {
    const security = JSON.parse(read("src-tauri/tauri.conf.json")).app.security;
    const disabled = security.dangerousDisableAssetCspModification;
    assert.notEqual(
        disabled,
        true,
        "Native CSP modification must remain enabled"
    );
    for (const directive of ["script-src", "style-src"]) {
        assert(
            !Array.isArray(disabled) || !disabled.includes(directive),
            directive + " must retain Tauri's nonce protection"
        );
    }
    // Tauri codegen 2.6.3 adds nonces to embedded script/style tags; Tauri
    // 2.11.5 appends those nonces to the effective CSP. A config-only policy
    // misses this regression: nonce sources make unsafe-inline ineffective.
    return security.csp
        .split(";")
        .map((part) => {
            const directive = part.trim();
            return /^(script-src|style-src)\s/.test(directive)
                ? directive + " 'nonce-" + nonce + "'"
                : directive;
        })
        .join("; ");
}

function initializeFixture(native) {
    window.ott_device = "pc";
    window.__fixtureViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
        window.__fixtureViolations.push(event.effectiveDirective);
    });
    if (native) {
        window.__TAURI__ = {
            core: {
                invoke: async (command) =>
                    command === "plugin:updater|check" ? null : { ok: true },
            },
        };
    }
}

function renderFixture(initialSettings) {
    document.body.classList.remove("booting");
    document.getElementById("launch").remove();
    uiInit();
    listDetail = document.getElementById("listDetail");
    listPodval = document.getElementById("listPodval");
    const now = Date.now() / 1000;
    const logo =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="blue"/></svg>'
        );
    catsArray = ["Fixture"];
    cats = { Fixture: ["one", "two"] };
    channels = {
        one: {
            channel_name: "News",
            descr: '<b>Trusted description text</b><span style="color:red" onclick="window.__metadataExecuted=true">Metadata text</span><script>window.__metadataExecuted=true</script>',
            icon: logo,
            name: "Current bulletin",
            nextpr: [{ name: "Next bulletin", time: now + 1800 }],
            rec: 1,
            time: now - 1800,
            time_to: now + 1800,
        },
        two: {
            channel_name: "Films",
            descr: "Second description",
            name: "Current film",
            rec: 0,
            time: now - 1800,
            time_to: now + 1800,
        },
    };
    for (let number = 3; number <= 40; number++) {
        const id = "fixture" + number;
        cats.Fixture.push(id);
        channels[id] = {
            channel_name: "Fixture channel " + number,
            descr: "Fixture description " + number,
            name: "Programme " + number,
            rec: 1,
            time: now - 1800,
            time_to: now + 1800,
        };
    }
    channels.fixture3.name = "";
    channels.fixture3.time = channels.fixture3.time_to = 0;
    window.channels = window.chanels = channels;
    getCurProgData = () => true;
    getChannelPicon = () => logo;
    settings.pageSize = 25;
    settings.interfaceTheme = 0;
    settings.noSmall = 1;
    window.sNoSmall = 1;
    settings.showScroll = window.sShowScroll = 1;
    sShowNum =
        sShowName =
        sShowPikon =
        sShowProgress =
        sShowProgram =
        sShowArchive =
            1;
    sShowDescr = 1;
    sThumbnail = window.sThumbnail = 1;
    sNextCountL = 1;
    sPreview = 0;
    sPSchannels = 0;
    parentPIN = "";
    parentalArray = [];
    sSHLcolor = "120,100";
    sSHLcolSel = "240,100";
    sSHLcolorB = "255,0";
    window.sSHLcolor = sSHLcolor;
    window.sSHLcolSel = sSHLcolSel;
    window.sSHLcolorB = sSHLcolorB;
    if (initialSettings) {
        loadSettings();
        Object.keys(initialSettings).forEach((key) => {
            settings[key] = initialSettings[key];
        });
    }
    bodyColor = "#f0f0f0";
    setColor();
    setFontSize();
    setListPos();
    _channelsList(0, 0);
    window.__fixtureReady = true;
}

async function fixturePage(browser, profile, initialSettings) {
    const native = profile === "tauri";
    const stage = native ? "src-tauri/frontend/" : "";
    const html = read(native ? stage + "index.html" : "dist/index.html");
    const parsed = new JSDOM(html);
    const document = parsed.window.document;
    for (const script of document.querySelectorAll("script")) script.remove();
    const body = document.body.outerHTML;
    const styles = Array.from(document.querySelectorAll("style"), (style) => {
        style.setAttribute("nonce", nonce);
        return style.outerHTML;
    });
    parsed.window.close();
    const scripts = [
        "/fixture-init.js",
        "/js/runtime-polyfills.js",
        ...(native ? ["/js/native-environment.js"] : []),
        native ? "/js/jquery.min.js" : "/js/jquery-1.11.1.min.js",
        "/js/ottplay-core.js",
        "/dist/stbPlayer.js",
        "/fixture-render.js",
    ];
    const assets = new Map([
        [
            "/fixture-init.js",
            "(" + initializeFixture.toString() + ")(" + native + ");",
        ],
        [
            "/fixture-render.js",
            "(" +
                renderFixture.toString() +
                ")(" +
                JSON.stringify(initialSettings) +
                ");",
        ],
        ["/js/runtime-polyfills.js", read(stage + "js/runtime-polyfills.js")],
        ["/js/ottplay-core.js", read(stage + "js/ottplay-core.js")],
        ["/dist/stbPlayer.js", read(stage + "dist/stbPlayer.js")],
        ["/stbPlayer/1280.css", read(stage + "stbPlayer/1280.css")],
    ]);
    for (const file of scripts.filter((file) =>
        /jquery|native-environment/.test(file)
    ))
        assets.set(file, read(stage + file.slice(1)));
    if (!native) {
        for (const file of fs.readdirSync(path.join(root, "fonts"))) {
            if (/\.(woff2?|ttf|eot|svg)$/.test(file))
                assets.set(
                    "/fonts/" + file,
                    fs.readFileSync(path.join(root, "fonts", file))
                );
        }
    }
    const context = await browser.newContext({
        viewport: { height: 720, width: 1280 },
    });
    const page = await context.newPage();
    const errors = [];
    const unexpectedRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (
            message.type() === "error" &&
            message.text().startsWith("[window.onerror]")
        )
            errors.push(message.text());
    });
    await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
            unexpectedRequests.push(url.origin + url.pathname);
            return route.abort("blockedbyclient");
        }
        if (url.pathname === "/") {
            return route.fulfill({
                body:
                    '<!doctype html><html><head><meta charset="utf-8">' +
                    styles.join("\n") +
                    '<link rel="stylesheet" href="/stbPlayer/1280.css"></head>' +
                    body.replace(
                        /<\/body>/i,
                        scripts
                            .map(
                                (src) =>
                                    '<script nonce="' +
                                    nonce +
                                    '" src="' +
                                    src +
                                    '"></script>'
                            )
                            .join("\n") + "</body>"
                    ) +
                    "</html>",
                contentType: "text/html; charset=utf-8",
                headers: native
                    ? { "Content-Security-Policy": nativePolicy() }
                    : {},
                status: 200,
            });
        }
        if (!assets.has(url.pathname)) {
            unexpectedRequests.push(url.pathname);
            return route.abort("blockedbyclient");
        }
        return route.fulfill({
            body: assets.get(url.pathname),
            contentType: url.pathname.endsWith(".css")
                ? "text/css"
                : url.pathname.startsWith("/fonts/")
                  ? "application/octet-stream"
                  : "text/javascript",
            status: 200,
        });
    });
    await page.goto(origin + "/");
    await expect
        .poll(() => page.evaluate(() => window.__fixtureReady), {
            message:
                profile +
                " fixture must finish the actual channel renderer: " +
                errors.join("; "),
        })
        .toBe(true);
    await expect(page.locator("#_name")).toContainText("Current bulletin");
    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
    return { close: () => context.close(), errors, page, unexpectedRequests };
}

async function snapshot(page) {
    return page.evaluate(async () => {
        await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        const row = document.getElementById("it0");
        const picon = row.querySelector(".img");
        const progress = document.getElementById("prone");
        const archive = picon.previousElementSibling;
        const programme = document.getElementById("pnone");
        const scrollbar = document.querySelector(".list-scroll");
        const size = (element) => {
            const rect = element.getBoundingClientRect();
            return {
                height: Math.round(rect.height),
                width: Math.round(rect.width),
            };
        };
        return {
            archive: size(archive),
            archiveColor: getComputedStyle(archive).backgroundColor,
            detailAccent: getComputedStyle(
                document.querySelector("#_name > div")
            ).color,
            nextAccent: getComputedStyle(
                document.querySelector("#_nextpr span")
            ).color,
            picon: size(picon),
            piconImage: getComputedStyle(picon).backgroundImage,
            programmeAccent: getComputedStyle(programme).color,
            progress: size(progress.parentElement),
            progressColor: getComputedStyle(progress).backgroundColor,
            rowHeight: Math.round(row.getBoundingClientRect().height),
            scrollbar: size(scrollbar),
            scrollThumb: size(scrollbar.children[1]),
            scrollThumbColor: getComputedStyle(scrollbar.children[1])
                .backgroundColor,
            selection: getComputedStyle(row).backgroundColor,
            thumbnail: size(document.querySelector("#_prd .img")),
            titleColor: getComputedStyle(programme.parentElement).color,
        };
    });
}

test("PLi-HD switches the shipped UI and restores custom Classic colours", async ({
    browser,
}, testInfo) => {
    for (const profile of ["server", "tauri"]) {
        const fixture = await fixturePage(browser, profile);
        const page = fixture.page;
        try {
            const classic = await snapshot(page);
            await page.screenshot({
                path: testInfo.outputPath(profile + "-classic.png"),
            });
            const saved = await page.evaluate(() => {
                const saved = saveSettings({ interfaceTheme: 1 });
                _channelsList(0, 0);
                return saved;
            });
            expect(saved).toBe(true);
            await expect(page.locator("body")).toHaveClass(/theme-pli-hd/);
            await expect(page.locator("#_name")).toContainText(
                "Current bulletin"
            );
            const pli = await snapshot(page);
            expect(pli.selection).toBe("rgb(48, 50, 64)");
            expect(pli.programmeAccent).toBe("rgb(252, 192, 0)");
            expect(pli.detailAccent).toBe("rgb(252, 192, 0)");
            expect(pli.progressColor).toBe("rgb(252, 192, 0)");
            expect(pli.rowHeight).toBe(20);
            expect(pli.picon.height).toBeLessThanOrEqual(pli.rowHeight);
            expect(
                await page.evaluate(() => {
                    const clock = document.getElementById("listTime");
                    clock.textContent = "18:30:00";
                    const rect = clock.getBoundingClientRect();
                    return clock.contains(
                        document.elementFromPoint(
                            rect.x + rect.width / 2,
                            rect.y + rect.height / 2
                        )
                    );
                })
            ).toBe(true);
            await expect(page.locator("#listCaption")).toHaveCSS(
                "background-color",
                "rgb(36, 36, 36)"
            );
            await expect(page.locator("#it0")).toHaveCSS(
                "border-radius",
                "0px"
            );
            await expect(page.locator("#dialogbox")).toHaveCSS(
                "border-radius",
                "0px"
            );
            await expect(page.locator("#listIn .item")).toHaveCount(25);
            await page.screenshot({
                path: testInfo.outputPath(profile + "-pli-hd.png"),
            });
            await page.locator("#it1").click();
            await expect(page.locator("#it1")).toHaveCSS(
                "background-color",
                "rgb(48, 50, 64)"
            );
            await expect(page.locator("#_name")).toContainText("Current film");
            expect(
                await page.evaluate(() => {
                    const saved = saveSettings({ interfaceTheme: 0 });
                    _channelsList(0, 0);
                    return saved;
                })
            ).toBe(true);
            await expect(page.locator("body")).not.toHaveClass(/theme-pli-hd/);
            await expect(page.locator("#_name")).toContainText(
                "Current bulletin"
            );
            expect(await snapshot(page)).toEqual(classic);
            expect(fixture.errors).toEqual([]);
            expect(fixture.unexpectedRequests).toEqual([]);
        } finally {
            await fixture.close();
        }
    }
});

test("PLi-HD keeps preview, mask and list aligned after mirroring and resize", async ({
    browser,
}) => {
    for (const profile of ["server", "tauri"]) {
        const fixture = await fixturePage(browser, profile);
        const page = fixture.page;
        try {
            await page.evaluate(() => {
                const videoBox = document.createElement("div");
                videoBox.id = "vdiv";
                document.body.prepend(videoBox);
            });
            for (const viewport of [
                { height: 720, width: 1280 },
                { height: 1080, width: 1920 },
                { height: 540, width: 960 },
            ]) {
                await page.setViewportSize(viewport);
                for (const side of [0, 1]) {
                    for (const noSmall of [0, 1]) {
                        const boxes = await page.evaluate(
                            ({ side, noSmall }) => {
                                saveSettings({
                                    interfaceTheme: 1,
                                    listPosition: side,
                                    noSmall,
                                });
                                setFontSize();
                                _channelsList(0, 0);
                                const rect = (id) => {
                                    const r = document
                                        .getElementById(id)
                                        .getBoundingClientRect();
                                    return {
                                        bottom: r.bottom,
                                        height: r.height,
                                        right: r.right,
                                        width: r.width,
                                        x: r.x,
                                        y: r.y,
                                    };
                                };
                                return {
                                    bottom: rect("_b"),
                                    detail: rect("listDetail"),
                                    last: rect("it24"),
                                    left: rect("_l"),
                                    list: rect("listIn"),
                                    preview: rect("vdiv"),
                                    right: rect("_r"),
                                    top: rect("_t"),
                                };
                            },
                            { noSmall, side }
                        );
                        const x = viewport.width / 1280;
                        const y = viewport.height / 720;
                        expect(boxes.list.x).toBeCloseTo(
                            (side ? 60 : 530) * x,
                            0
                        );
                        expect(boxes.list.y).toBeCloseTo(110 * y, 0);
                        expect(boxes.list.width).toBeCloseTo(690 * x, 0);
                        expect(boxes.list.height).toBeCloseTo(510 * y, 0);
                        expect(boxes.last.bottom).toBeLessThanOrEqual(
                            boxes.list.bottom + 0.5
                        );
                        expect(boxes.detail.x).toBeCloseTo(
                            (side ? 778 : 85) * x,
                            0
                        );
                        expect(boxes.detail.y).toBeCloseTo(
                            (noSmall ? 110 : 360) * y,
                            0
                        );
                        if (!noSmall) {
                            expect(boxes.preview.x).toBeCloseTo(
                                (side ? 778 : 85) * x,
                                0
                            );
                            expect(boxes.preview.y).toBeCloseTo(110 * y, 0);
                            expect(boxes.preview.width).toBeCloseTo(417 * x, 0);
                            expect(boxes.preview.height).toBeCloseTo(
                                243 * y,
                                0
                            );
                            expect(boxes.top.bottom).toBeCloseTo(
                                boxes.preview.y,
                                0
                            );
                            expect(boxes.left.right).toBeCloseTo(
                                boxes.preview.x,
                                0
                            );
                            expect(boxes.right.x).toBeCloseTo(
                                boxes.preview.right,
                                0
                            );
                            expect(boxes.bottom.y).toBeCloseTo(
                                boxes.preview.bottom,
                                0
                            );
                        }
                    }
                }
            }
            expect(fixture.errors).toEqual([]);
            expect(fixture.unexpectedRequests).toEqual([]);
        } finally {
            await fixture.close();
        }
    }
});

test("English interface credits are readable offline and return to the list", async ({
    browser,
}) => {
    const fixture = await fixturePage(browser, "tauri");
    const page = fixture.page;
    try {
        const title = await page.locator("#listCaption").textContent();
        await page.evaluate(() => {
            infoArr
                .find((entry) => entry.name === "Interface credits")
                .action();
        });
        const credits = page.locator("#listAbout .interface-credits");
        await expect(credits).toHaveAttribute("lang", "en");
        await expect(credits).toContainText("Vali (2009–2010)");
        await expect(credits).toContainText("VU+NL, Milo");
        await expect(credits).toContainText("alex_qr");
        await expect(credits.locator("a").first()).toHaveAttribute(
            "href",
            "https://github.com/littlesat/skin-PLiHD"
        );
        expect(
            await page.evaluate(() => {
                aboutKeyHandler(keys.DOWN);
                return document.querySelector("#listAbout .interface-credits")
                    .scrollTop;
            })
        ).toBeGreaterThan(0);
        await page.evaluate(() => aboutKeyHandler(keys.RETURN));
        await expect(credits).toHaveCount(0);
        await expect(page.locator("#listCaption")).toHaveText(title);
        await expect(page.locator("#it0")).toBeVisible();
        await page.evaluate(() => {
            infoArr
                .find((entry) => entry.name === "Interface credits")
                .action();
        });
        await page.locator('#listPodval [role="button"]').click();
        await expect(credits).toHaveCount(0);
        await expect(page.locator("#it0")).toBeVisible();
        expect(fixture.errors).toEqual([]);
        expect(fixture.unexpectedRequests).toEqual([]);
    } finally {
        await fixture.close();
    }
});

test("active Tauri CSP reproduces the former inline-style failure", async ({
    browser,
}) => {
    const fixture = await fixturePage(browser, "tauri");
    try {
        const result = await fixture.page.evaluate(async () => {
            window.__fixtureViolations.length = 0;
            const example = document.createElement("div");
            example.innerHTML =
                '<span id="old-accent" style="color:rgb(1,2,3)">Old programme</span><div id="old-picon" style="width:24px;height:24px"></div>';
            document.body.appendChild(example);
            const trusted = document.createElement("span");
            trusted.style.color = "rgb(1, 2, 3)";
            example.appendChild(trusted);
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
                attrColor: getComputedStyle(
                    document.getElementById("old-accent")
                ).color,
                attrHeight: document
                    .getElementById("old-picon")
                    .getBoundingClientRect().height,
                propertyColor: getComputedStyle(trusted).color,
                violations: window.__fixtureViolations,
            };
        });
        expect(result.attrColor).not.toBe("rgb(1, 2, 3)");
        expect(result.attrHeight).toBe(0);
        expect(result.propertyColor).toBe("rgb(1, 2, 3)");
        expect(
            result.violations.some((directive) =>
                directive.startsWith("style-src")
            )
        ).toBe(true);
    } finally {
        await fixture.close();
    }
});

test("server and Tauri retain rich channel formatting under the native CSP", async ({
    browser,
}) => {
    const server = await fixturePage(browser, "server");
    const native = await fixturePage(browser, "tauri");
    try {
        const expected = await snapshot(server.page);
        const actual = await snapshot(native.page);
        for (const state of [expected, actual]) {
            expect(state.programmeAccent).toBe("rgb(0, 255, 0)");
            expect(state.detailAccent).toBe("rgb(0, 255, 0)");
            expect(state.nextAccent).toBe("rgb(0, 255, 0)");
            expect(state.titleColor).toBe("rgb(240, 240, 240)");
            expect(state.selection).toBe("rgb(0, 0, 128)");
            expect(state.archiveColor).toBe("rgb(0, 255, 0)");
            expect(state.progressColor).toBe("rgb(0, 255, 0)");
            expect(state.picon.width).toBeGreaterThan(10);
            expect(state.picon.height).toBeGreaterThan(10);
            expect(state.piconImage).toContain("data:image/svg+xml");
            expect(state.archive.height).toBeGreaterThan(0);
            expect(state.progress.width).toBe(40);
            expect(state.progress.height).toBeGreaterThan(0);
            expect(state.scrollbar.width).toBeGreaterThan(0);
            expect(state.scrollbar.height).toBeGreaterThan(0);
            expect(state.scrollThumb.height).toBeGreaterThan(0);
            expect(state.scrollThumb.height).toBeLessThan(
                state.scrollbar.height
            );
            expect(state.scrollThumbColor).toBe("rgba(180, 180, 200, 0.85)");
            expect(state.thumbnail).toEqual({ height: 200, width: 133 });
        }
        // OS fonts intentionally differ, so compare box geometry and colors,
        // not glyph widths or platform-specific rasterized text.
        expect(actual).toEqual(expected);
        for (const fixture of [server, native]) {
            const page = fixture.page;
            expect(await page.locator("#_prd b").textContent()).toBe(
                "Trusted description text"
            );
            expect(
                await page.locator("#_prd span").getAttribute("style")
            ).toBeNull();
            expect(
                await page.locator("#_prd span").getAttribute("onclick")
            ).toBeNull();
            expect(await page.locator("#_prd script").count()).toBe(0);
            expect(
                await page.evaluate(() => window.__metadataExecuted)
            ).toBeUndefined();
            await page.evaluate(() => {
                const valid = getChannelPicon("two");
                getChannelPicon = (id) =>
                    id === "one" ? { toString: null } : valid;
                _channelsList(0, 0);
            });
            await expect(page.locator("#it0 .img")).toHaveCSS(
                "background-image",
                "none"
            );
            await expect(page.locator("#it1 .img")).toHaveCSS(
                "background-image",
                /data:image\/svg\+xml/
            );
            await expect(page.locator("#pntwo")).toHaveCSS(
                "color",
                "rgb(0, 255, 0)"
            );
            await page.evaluate(() => {
                const valid = getChannelPicon("two");
                getChannelPicon = () => valid;
                _channelsList(0, 0);
            });
            await expect(page.locator("#pnfixture3")).toHaveText("");
            await page.evaluate(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
                const channel = channels.fixture3;
                channel.name = "Arrived programme";
                channel.time = Date.now() / 1000 - 1800;
                channel.time_to = channel.time + 3600;
                updateChanelList("fixture3");
            });
            await expect(page.locator("#pnfixture3")).toHaveText(
                "Arrived programme"
            );
            await expect(page.locator("#pnfixture3")).toHaveCSS(
                "color",
                "rgb(0, 255, 0)"
            );
            expect(
                await page
                    .locator("#prfixture3")
                    .evaluate(
                        (element) => element.getBoundingClientRect().width
                    )
            ).toBeGreaterThan(0);
            await page.evaluate(() => {
                window.sThumbnail = 0;
                updateChanelList("one");
            });
            await expect(page.locator("#_prd .img")).toHaveCount(0);
            await page.locator("#it1").click();
            await expect(page.locator("#_name")).toContainText("Current film");
            await expect(page.locator("#it1")).toHaveCSS(
                "background-color",
                "rgb(0, 0, 128)"
            );
            await expect(page.locator("#it0")).not.toHaveCSS(
                "background-color",
                "rgb(0, 0, 128)"
            );
            await expect(page.locator("#listIn .item")).toHaveCount(25);
            await page.locator(".list-scroll-thumb").click();
            await expect(page.locator("#_name")).toContainText("Programme 27");
            await expect(page.locator("#listIn .item")).toHaveCount(15);
            await expect(page.locator("#it26")).toHaveCSS(
                "background-color",
                "rgb(0, 0, 128)"
            );
            const secondPage = await page.evaluate(() => {
                const scroll = document.querySelector(".list-scroll");
                const list = document
                    .getElementById("listIn")
                    .getBoundingClientRect();
                const selected = document
                    .getElementById("it26")
                    .getBoundingClientRect();
                return {
                    beforeHeight:
                        scroll.children[0].getBoundingClientRect().height,
                    piconWidth: document
                        .querySelector("#it26 .img")
                        .getBoundingClientRect().width,
                    programmeColor: getComputedStyle(
                        document.getElementById("pnfixture27")
                    ).color,
                    selectedVisible:
                        selected.top >= list.top &&
                        selected.bottom <= list.bottom,
                    thumbHeight:
                        scroll.children[1].getBoundingClientRect().height,
                };
            });
            expect(secondPage.beforeHeight).toBeGreaterThan(0);
            expect(secondPage.thumbHeight).toBeGreaterThan(0);
            expect(secondPage.piconWidth).toBeGreaterThan(10);
            expect(secondPage.programmeColor).toBe("rgb(0, 255, 0)");
            expect(secondPage.selectedVisible).toBe(true);
            await page.locator(".list-scroll-before").click();
            await expect(page.locator("#_name")).toContainText("Current film");
            await expect(page.locator("#it1")).toHaveCSS(
                "background-color",
                "rgb(0, 0, 128)"
            );
            await page.evaluate(() => {
                window.sShowPikon =
                    window.sShowProgress =
                    window.sShowArchive =
                    window.sShowProgram =
                        0;
                _channelsList(0, 0);
            });
            await expect(
                page.locator(
                    "#listIn .img, #listIn .progress_div, #listIn .ott-channel-archive, #pnone"
                )
            ).toHaveCount(0);
            await page.evaluate(() => bucketsList(0));
            await expect(page.locator("#it0")).toContainText("Fixture");
            await expect(
                page.locator(
                    "#listIn .ott-channel-label, #listIn .ott-channel-archive, #listIn .progress_div"
                )
            ).toHaveCount(0);
            expect(fixture.errors).toEqual([]);
            expect(fixture.unexpectedRequests).toEqual([]);
        }
        const scriptSecurity = await native.page.evaluate(async () => {
            window.__fixtureViolations.length = 0;
            const script = document.createElement("script");
            script.textContent = "window.__untrustedScriptExecuted = true";
            document.body.appendChild(script);
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
                executed: window.__untrustedScriptExecuted === true,
                violations: window.__fixtureViolations,
            };
        });
        expect(scriptSecurity.executed).toBe(false);
        expect(
            scriptSecurity.violations.some((directive) =>
                directive.startsWith("script-src")
            )
        ).toBe(true);
    } finally {
        await server.close();
        await native.close();
    }
});

for (const profile of ["server", "tauri"]) {
    test(
        profile + ": Studio defaults and focus survive paging and EPG updates",
        async ({ browser }, testInfo) => {
            const fixture = await fixturePage(browser, profile, {});
            const page = fixture.page;
            try {
                await expect(page.locator("body")).toHaveClass(/theme-studio/);
                await expect(page.locator("#listIn .item")).toHaveCount(25);
                await expect(page.locator("#it0")).toHaveCSS(
                    "background-color",
                    "rgb(231, 241, 235)"
                );
                await expect(page.locator("#it0 .ott-channel-label")).toHaveCSS(
                    "color",
                    "rgb(17, 33, 25)"
                );
                await expect(
                    page.locator("#it0 .ott-channel-programme")
                ).toHaveCSS("color", "rgb(74, 98, 85)");
                expect(
                    await page.evaluate(
                        () =>
                            parseFloat(
                                getComputedStyle(
                                    document.getElementById("list")
                                ).fontSize
                            ) <= document.getElementById("it0").offsetHeight
                    )
                ).toBe(true);
                await page.screenshot({
                    path: testInfo.outputPath(
                        profile + "-studio-2026-default.png"
                    ),
                });
                await page.evaluate(() => {
                    changeSelect(1);
                    updateChannelListRow("two");
                });
                await expect(page.locator("#it0")).not.toHaveClass(
                    /ott-selected/
                );
                await expect(page.locator("#it1 .ott-channel-label")).toHaveCSS(
                    "color",
                    "rgb(17, 33, 25)"
                );
                await page.evaluate(() => changeSelect(24));
                await expect(page.locator("#listIn .item")).toHaveCount(15);
                await expect(page.locator("#it25")).toHaveClass(/ott-selected/);
                await page.evaluate(() => changeSelect(-1));
                await expect(page.locator("#it24")).toHaveClass(/ott-selected/);
                await page.evaluate(() => {
                    channels[101] = channels.one;
                    cats.Fixture[0] = 101;
                    curList = [101];
                    primaryIndex = 0;
                    _channelsList(0, 0);
                    changeSelect(1);
                });
                await expect(page.locator("#it0")).toHaveClass(/ott-playing/);
                await expect(page.locator("#it1")).not.toHaveClass(
                    /ott-playing/
                );
                await page.evaluate(() => changeSelect(1));
                await expect(page.locator("#_name")).toHaveCount(0);
                await page.evaluate(() => settingsInterface());
                await expect(page.locator("#listIn .ott-selected")).toHaveCSS(
                    "color",
                    "rgb(17, 33, 25)"
                );
                expect(fixture.errors).toEqual([]);
                expect(fixture.unexpectedRequests).toEqual([]);
            } finally {
                await fixture.close();
            }
        }
    );

    test(
        profile +
            ": all themes honor row count, list side and video mode across resolutions",
        async ({ browser }) => {
            test.setTimeout(120000);
            const fixture = await fixturePage(browser, profile);
            const page = fixture.page;
            try {
                await page.evaluate(() => {
                    const videoBox = document.createElement("div");
                    videoBox.id = "vdiv";
                    document.body.prepend(videoBox);
                });
                for (const viewport of [
                    { height: 506, width: 900 },
                    { height: 720, width: 1280 },
                    { height: 1080, width: 1920 },
                    { height: 2160, width: 3840 },
                ]) {
                    await page.setViewportSize(viewport);
                    for (const theme of [0, 1, 2]) {
                        for (const pageSize of [10, 25, 30]) {
                            for (const side of [0, 1]) {
                                for (const noSmall of [0, 1]) {
                                    const result = await page.evaluate(
                                        (input) => {
                                            const saved = saveSettings(input);
                                            _channelsList(0, 0);
                                            const rect = (id) => {
                                                const r = document
                                                    .getElementById(id)
                                                    .getBoundingClientRect();
                                                return {
                                                    bottom: r.bottom,
                                                    height: r.height,
                                                    right: r.right,
                                                    x: r.x,
                                                    y: r.y,
                                                };
                                            };
                                            const row =
                                                document.getElementById("it0");
                                            return {
                                                bottom: rect("_b"),
                                                caption: rect("listCaption"),
                                                count: document.querySelectorAll(
                                                    "#listIn .item"
                                                ).length,
                                                detail: rect("listDetail"),
                                                last: rect(
                                                    "it" + (input.pageSize - 1)
                                                ),
                                                left: rect("_l"),
                                                list: rect("listIn"),
                                                osdVisible:
                                                    $("#list_osd").is(
                                                        ":visible"
                                                    ),
                                                piconHeight:
                                                    row.querySelector(".img")
                                                        .offsetHeight,
                                                preview: rect("vdiv"),
                                                right: rect("_r"),
                                                rowHeight: row.offsetHeight,
                                                saved,
                                                top: rect("_t"),
                                                windowVisible:
                                                    $("#list_window").is(
                                                        ":visible"
                                                    ),
                                            };
                                        },
                                        {
                                            interfaceTheme: theme,
                                            listPosition: side,
                                            noSmall,
                                            pageSize,
                                        }
                                    );
                                    expect(result.saved).toBe(true);
                                    expect(result.count).toBe(pageSize);
                                    expect(
                                        result.last.bottom
                                    ).toBeLessThanOrEqual(
                                        result.list.bottom + 0.5
                                    );
                                    expect(
                                        result.last.right
                                    ).toBeLessThanOrEqual(
                                        result.list.right + 0.5
                                    );
                                    expect(
                                        result.piconHeight
                                    ).toBeLessThanOrEqual(result.rowHeight);
                                    expect(result.windowVisible).toBe(!noSmall);
                                    expect(result.osdVisible).toBe(!!noSmall);
                                    expect(
                                        result.detail.y
                                    ).toBeGreaterThanOrEqual(
                                        result.caption.bottom
                                    );
                                    expect(
                                        side
                                            ? result.list.x < result.detail.x
                                            : result.list.x > result.detail.x
                                    ).toBe(true);
                                    if (!noSmall) {
                                        expect(result.top.bottom).toBeCloseTo(
                                            result.preview.y,
                                            0
                                        );
                                        expect(result.left.right).toBeCloseTo(
                                            result.preview.x,
                                            0
                                        );
                                        expect(result.right.x).toBeCloseTo(
                                            result.preview.right,
                                            0
                                        );
                                        expect(result.bottom.y).toBeCloseTo(
                                            result.preview.bottom,
                                            0
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                // Resize an already mounted channel formatter, without reopening it.
                await page.setViewportSize({ height: 360, width: 640 });
                await expect
                    .poll(() =>
                        page.evaluate(() => {
                            const row = document.getElementById("it0");
                            return (
                                row.querySelector(".img").offsetHeight <=
                                row.offsetHeight
                            );
                        })
                    )
                    .toBe(true);
                expect(fixture.errors).toEqual([]);
                expect(fixture.unexpectedRequests).toEqual([]);
            } finally {
                await fixture.close();
            }
        }
    );

    test(
        profile +
            ": display switches, fonts, clock and opacity apply from saved settings",
        async ({ browser }) => {
            const fixture = await fixturePage(browser, profile, {});
            const page = fixture.page;
            try {
                for (const theme of [0, 1, 2]) {
                    for (const enabled of [0, 1]) {
                        expect(
                            await page.evaluate(
                                ({ theme, enabled }) => {
                                    const saved = saveSettings({
                                        channelLogoMode: enabled * 2,
                                        interfaceTheme: theme,
                                        nextCountList: enabled,
                                        showArchive: enabled,
                                        showDescription: enabled,
                                        showName: enabled,
                                        showNumber: enabled,
                                        showProgram: enabled,
                                        showProgress: enabled,
                                        showScroll: enabled,
                                        thumbnail: enabled,
                                    });
                                    _channelsList(0, 0);
                                    return saved;
                                },
                                { enabled, theme }
                            )
                        ).toBe(true);
                        for (const selector of [
                            ".ott-channel-number",
                            ".ott-channel-picon",
                            ".ott-channel-programme",
                            ".ott-channel-progress",
                            ".ott-channel-archive",
                        ])
                            await expect(
                                page.locator("#it0 " + selector)
                            ).toHaveCount(enabled);
                        await expect(page.locator(".list-scroll")).toHaveCount(
                            enabled
                        );
                        await expect
                            .poll(() =>
                                page
                                    .locator("#_descr")
                                    .evaluate((el) => el.offsetHeight > 0)
                            )
                            .toBe(!!enabled);
                        await expect(
                            page.locator(".ott-channel-thumbnail")
                        ).toHaveCount(enabled);
                        await expect(page.locator("#_nextpr span")).toHaveCount(
                            enabled
                        );
                        expect(
                            (await page.locator("#it0").textContent()).includes(
                                "News"
                            )
                        ).toBe(!!enabled);
                    }
                }
                for (const fontSize of [0, 1, 2, 3, 4, 5, 6]) {
                    const sizes = [];
                    for (const fontShift of [0, 30]) {
                        sizes.push(
                            await page.evaluate(
                                ({ fontSize, fontShift }) => {
                                    saveSettings({
                                        fontShift,
                                        fontSize,
                                        pageSize: 10,
                                    });
                                    _channelsList(0, 0);
                                    return {
                                        family: getComputedStyle(document.body)
                                            .fontFamily,
                                        size: parseFloat(
                                            getComputedStyle(
                                                document.getElementById("list")
                                            ).fontSize
                                        ),
                                    };
                                },
                                { fontShift, fontSize }
                            )
                        );
                    }
                    expect(sizes[0].family).not.toContain("undefined");
                    expect(sizes[0].size).toBeGreaterThan(sizes[1].size);
                }
                for (const count of [0, 1, 20]) {
                    await page.evaluate((nextCountList) => {
                        const now = Date.now() / 1000;
                        channels.one.nextpr = Array.from(
                            { length: 20 },
                            (_, i) => ({
                                name: "Upcoming " + i,
                                time: now + 1800 * (i + 1),
                            })
                        );
                        saveSettings({
                            fontShift: 0,
                            nextCountList,
                            pageSize: 30,
                        });
                        _channelsList(0, 0);
                    }, count);
                    await expect(page.locator("#_nextpr span")).toHaveCount(
                        count
                    );
                    if (count) {
                        expect(
                            await page.evaluate(
                                () =>
                                    document
                                        .getElementById("_nextpr")
                                        .getBoundingClientRect().top >=
                                    document
                                        .getElementById("_name")
                                        .getBoundingClientRect().bottom
                            )
                        ).toBe(true);
                    }
                }
                for (const preview of [0, 1, 2]) {
                    await page.evaluate((preview) => {
                        window.__previewCalls = 0;
                        window.previewChId = () => window.__previewCalls++;
                        saveSettings({ preview });
                        _channelsList(0, 0);
                    }, preview);
                    await expect
                        .poll(() => page.locator("#_name").count())
                        .toBe(1);
                    // Flush the renderer's deferred detail callback.
                    await page.evaluate(
                        () => new Promise((resolve) => setTimeout(resolve, 250))
                    );
                    expect(
                        await page.evaluate(() => window.__previewCalls > 0)
                    ).toBe(preview === 1);
                }
                await page.evaluate(() => {
                    saveSettings({ preview: 0 });
                    closeList();
                });
                for (const opacity of [0, 3, 10]) {
                    await page.evaluate(
                        (osdOpacity) =>
                            saveSettings({ osdOpacity, permanentTime: 1 }),
                        opacity
                    );
                    await expect(page.locator("#permanentTime")).toBeVisible();
                    const alpha = await page
                        .locator("#permanentTime")
                        .evaluate((el) => {
                            const parts =
                                getComputedStyle(el).backgroundColor.match(
                                    /[\d.]+/g
                                );
                            return parts.length === 4 ? Number(parts[3]) : 1;
                        });
                    expect(alpha).toBe(opacity / 10);
                }
                await page.evaluate(() => saveSettings({ permanentTime: 2 }));
                await expect(page.locator("#permanentTime")).not.toHaveClass(
                    /osd/
                );
                await expect(page.locator("#permanentTime")).toHaveCSS(
                    "background-color",
                    "rgba(0, 0, 0, 0)"
                );
                await page.evaluate(() => {
                    saveSettings({ osdOpacity: 3, permanentTime: 1 });
                    saveSettings({ fontShift: 4 });
                });
                await expect(page.locator("#permanentTime")).toHaveCSS(
                    "background-color",
                    "rgba(14, 17, 20, 0.3)"
                );
                await page.evaluate(() => saveSettings({ permanentTime: 0 }));
                await expect(page.locator("#permanentTime")).toBeHidden();
                for (const enabled of [1, 0]) {
                    const label = await page.evaluate(
                        (useGraphicalIndicators) => {
                            saveSettings({ useGraphicalIndicators });
                            return _("yes");
                        },
                        enabled
                    );
                    expect(label.includes("<span")).toBe(!!enabled);
                }
                expect(fixture.errors).toEqual([]);
                expect(fixture.unexpectedRequests).toEqual([]);
            } finally {
                await fixture.close();
            }
        }
    );
}
