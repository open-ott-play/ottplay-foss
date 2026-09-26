const { test, expect } = require("@playwright/test");
const {
    initializeKeyboard,
    keyboardCode,
    read,
} = require("../helpers/localized-keyboard.cjs");
const fixtures = JSON.parse(read("tests/fixtures/locale-alphabets.json"));
const code = keyboardCode();

test("remote keyboard keeps every alphabet page visible at supported densities and resolutions", async ({
    page,
}) => {
    await page.setContent(
        "<style>" +
            read("stbPlayer/1280.css") +
            '</style><div id="listEdit"></div><div id="listPodval"></div>'
    );
    await page.addScriptTag({ content: read("js/jquery-1.11.1.min.js") });
    await page.evaluate(initializeKeyboard);
    await page.addScriptTag({ content: code });
    // Complete fixture alphabets isolate geometry from translation content;
    // test_localized_keyboard.cjs separately asserts every shipped pack matches.
    for (const [width, height] of [
        [640, 360],
        [900, 506],
        [1280, 720],
        [1920, 1080],
        [3840, 2160],
    ]) {
        await page.setViewportSize({ height, width });
        for (const density of [10, 25, 30]) {
            for (const theme of [0, 1, 2]) {
                const result = await page.evaluate(
                    ({ width, height, density, theme, locales }) => {
                        const x = width / 1280,
                            y = height / 720;
                        const inset = theme === 2 ? 40 : theme === 1 ? 60 : 0;
                        const top =
                            (theme === 2 ? 100 : theme === 1 ? 110 : 53) * y;
                        const bottom =
                            (theme === 2 ? 80 : theme === 1 ? 100 : 53) * y;
                        const split =
                            theme === 2 ? 520 : theme === 1 ? 530 : 522;
                        const panel = document.getElementById("listEdit");
                        Object.assign(panel.style, {
                            bottom: bottom + "px",
                            fontSize: (height - 130 * y) / density + "px",
                            left: split * x + "px",
                            padding: 14 * y + "px " + 16 * x + "px",
                            right: inset * x + "px",
                            top: top + "px",
                        });
                        const violations = [];
                        for (const [lang, locale] of Object.entries(locales)) {
                            window.fixtureLocale = lang;
                            window.keyStrings = {
                                alhabet: locale.alphabet,
                                "Next keyboard page": "Next keyboard page",
                            };
                            window.editCaption = "Search / Edit playlist URL";
                            window.editvar =
                                "https://example.com/playlist.m3u8?token=long-value&name=letters";
                            window.editPos = window.editvar.length;
                            _keyP = false;
                            _setLang(false);
                            for (let p = 0; p < _keyPages; p++) {
                                _keyPage = p;
                                _buildKeyboard();
                                _setCase(true);
                                showEdit();
                                const outer = panel.getBoundingClientRect();
                                for (const cell of panel.querySelectorAll(
                                    ".osk-key"
                                )) {
                                    const rect = cell.getBoundingClientRect();
                                    if (
                                        rect.left < outer.left - 1 ||
                                        rect.right > outer.right + 1 ||
                                        rect.bottom > outer.bottom + 1
                                    )
                                        violations.push({
                                            bottom: rect.bottom,
                                            cell: cell.textContent,
                                            lang,
                                            p,
                                            panelBottom: outer.bottom,
                                            panelRight: outer.right,
                                            right: rect.right,
                                        });
                                }
                            }
                        }
                        return violations.slice(0, 3);
                    },
                    {
                        density,
                        height,
                        locales: Object.fromEntries(
                            [
                                "_rus",
                                "_ger",
                                "_arm",
                                "_gre",
                                "_heb",
                                "_dut",
                                "_vie",
                            ].map((name) => [name, fixtures.locales[name]])
                        ),
                        theme,
                        width,
                    }
                );
                expect(
                    result,
                    JSON.stringify({ density, height, theme, width })
                ).toEqual([]);
            }
        }
    }
});

test("remote and pointer input reach later pages and preserve expanded case text", async ({
    page,
}) => {
    await page.setContent(
        "<style>" +
            read("stbPlayer/1280.css") +
            '</style><div id="listEdit"></div><div id="listPodval"></div>'
    );
    await page.addScriptTag({ content: read("js/jquery-1.11.1.min.js") });
    await page.evaluate(initializeKeyboard);
    await page.addScriptTag({ content: code });
    await page.evaluate((locale) => {
        window.fixtureLocale = "_vie";
        window.keyStrings = { alhabet: locale.alphabet };
        _keyP = false;
        _setLang(false);
        _setCase(false);
        showEdit();
    }, fixtures.locales._vie);
    await page.getByLabel("Next keyboard page").click();
    await expect(page.getByLabel("Next keyboard page")).toHaveText("2/3 ›");
    const value = await page.evaluate(() => {
        _keyCur = 10;
        const expected = _keys[_keyCur];
        editKey1(keys.ENTER);
        return { actual: editvar, expected };
    });
    expect(value.actual).toBe(value.expected);
    await page.evaluate(() => {
        _keyCur = _keys.length - 2;
        editKey1(keys.ENTER);
    });
    await expect(page.getByLabel("Next keyboard page")).toHaveText("3/3 ›");
});
