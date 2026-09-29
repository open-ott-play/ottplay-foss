const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { languageAssetPath } = require("../scripts/localization-catalog.cjs");
const {
    initializeKeyboard,
    keyboardCode,
    read,
    root,
} = require("./helpers/localized-keyboard.cjs");
const fixture = JSON.parse(read("tests/fixtures/locale-alphabets.json"));
const selector = /var langCodes = (\[[\s\S]*?\]);/.exec(read("src/index.ts"));
assert(selector, "language selection remains explicit");
const codes = Array.from(vm.runInNewContext(selector[1]));
assert.deepEqual(codes.slice(0, 20), [
    "_eng",
    "_arm",
    "_bel",
    "_bul",
    "_fra",
    "_ger",
    "_gre",
    "_heb",
    "_hun",
    "_ita",
    "_lat",
    "_lit",
    "_pol",
    "_por",
    "_rou",
    "_rus",
    "_spa",
    "_tur",
    "_ukr",
    "_uzb",
]);
assert.deepEqual(codes.slice(20), [
    "_ind",
    "_vie",
    "_may",
    "_dut",
    "_cze",
    "_swe",
    "_aze",
    "_kaz",
]);
const dom = new JSDOM(
    '<div id="listEdit" style="width:700px;height:520px"></div><div id="listPodval"></div>',
    { runScripts: "outside-only" }
);
const w = dom.window;
w.eval(read("js/jquery-1.11.1.min.js"));
w.eval("(" + initializeKeyboard.toString() + ")()");
w.eval(
    keyboardCode(
        process.argv.includes("--bundle") ? "dist/player.js" : undefined
    )
);
let languageReads = 0;
const getLanguage = w.stbGetItem;
w.stbGetItem = function (key) {
    if (key === "ottplaylang") languageReads++;
    return getLanguage(key);
};
try {
    for (const [code, locale] of Object.entries(fixture.locales)) {
        const file = path.join(root, languageAssetPath(code));
        assert(fs.existsSync(file), "Packaged locale must exist: " + code);
        w.eval(fs.readFileSync(file, "utf8"));
        if (process.argv.includes("--bundle")) {
            for (const directory of [
                "dist",
                "src-tauri/frontend",
                "dist-mobile",
            ]) {
                const packaged = {};
                vm.runInNewContext(
                    read(directory + languageAssetPath(code)),
                    packaged
                );
                assert.deepEqual(
                    { ...packaged.keyStrings },
                    { ...w.keyStrings },
                    directory + " preserves the complete dictionary for " + code
                );
                assert(
                    fs.existsSync(
                        path.join(
                            root,
                            directory,
                            "js/licenses/Unicode-3.0.txt"
                        )
                    ),
                    "Unicode license is packaged"
                );
            }
        }
        assert.equal(
            w.keyStrings.alhabet,
            locale.alphabet,
            code + " canonical alphabet"
        );
        w.fixtureLocale = code;
        w._keyP = false;
        w._setLang(false);
        const reachable = new Set(fixture.builtInLatin);
        const pages = w._keyPages;
        for (let page = 0; page < pages; page++) {
            const original = w._keys;
            assert.equal(original.length % 10, 0, "complete navigation rows");
            assert(original.length <= 60, "bounded grid height");
            w._setCase(false);
            for (const char of w._keys) reachable.add(char);
            w._setCase(true);
            for (const char of w._keys)
                for (const upper of w._keyboardCharacter(char))
                    reachable.add(upper);
            languageReads = 0;
            w.showEdit();
            assert.equal(
                languageReads,
                1,
                code + " uppercase page reads the language once per render"
            );
            w._setCase(false);
            assert.equal(
                w._keys,
                original,
                code + " case round trip preserves every cell"
            );
            w.showEdit();
            for (let index = 0; index < w._keys.length; index++) {
                w._keyCur = index;
                for (const direction of [
                    w.keys.UP,
                    w.keys.DOWN,
                    w.keys.LEFT,
                    w.keys.RIGHT,
                ]) {
                    w.editKey1(direction);
                    assert(
                        w._keyCur >= 0 && w._keyCur < w._keys.length,
                        code + " reachable focus"
                    );
                }
            }
            if (pages > 1) {
                assert(
                    w.document.querySelector(
                        '[aria-label="' +
                            w.keyStrings["Next keyboard page"] +
                            '"]'
                    )
                );
                w._keysSymbol[8].a();
            }
        }
        assert.equal(w._keyPage, 0, code + " page wrap");
        for (const char of locale.requiredCharacters)
            assert(reachable.has(char), code + " missing " + char);
        for (const upper of locale.requiredUppercase || "")
            assert(reachable.has(upper), code + " missing uppercase " + upper);
        w._setPunct(true);
        assert.equal(
            w._keys.length % 10,
            0,
            "punctuation rows remain navigable"
        );
        assert.equal(w._keyPages, 1);
        w._setPunct(false);
        assert.equal(w._keyPages, pages);
    }
    function layout(code) {
        w.eval(read(languageAssetPath(code)));
        w.fixtureLocale = code;
        w._keyP = false;
        w._setLang(false);
        w._setCase(true);
    }
    for (const previousFocus of [49, 50, 59]) {
        layout("_vie");
        w._keyCur = previousFocus;
        w.editKey1(w.keys.RETURN);
        w.eval(read(languageAssetPath("_eng")));
        w.fixtureLocale = "_eng";
        w.showEditKey1();
        assert(w._keyCur >= 0 && w._keyCur < w._keys.length);
        assert(w.document.getElementById("ik" + w._keyCur));
        assert.doesNotThrow(() => w.editKey1(w.keys.ENTER));
    }
    layout("_ger");
    assert.equal(w._keyboardCharacter("ß"), "ẞ");
    for (const code of ["_tur", "_aze"]) {
        layout(code);
        assert.equal(w._keyboardCharacter("i"), "İ");
        assert.equal(w._keyboardCharacter("ı"), "I");
        w.showEdit();
        const iKey = w._keys.indexOf("i");
        assert.equal(w.document.getElementById("ik" + iKey).textContent, "İ");
        w.fixtureLocale = "_eng";
        languageReads = 0;
        w.showEdit();
        assert.equal(
            languageReads,
            1,
            "the next render refreshes the language"
        );
        assert.equal(w.document.getElementById("ik" + iKey).textContent, "I");
        w.fixtureLocale = code;
        w.editvar = "";
        w.editPos = 0;
        w._keyCur = iKey;
        w.editKey1(w.keys.ENTER);
        assert.equal(w.editvar, "İ", "insertion reads the current language");
        w._setLang(true);
        assert.equal(
            w._keyboardCharacter("i"),
            "I",
            "English layout ignores UI locale casing"
        );
    }
    layout("_tur");
    w.fixtureLocale = undefined;
    languageReads = 0;
    w.showEdit();
    assert.equal(
        languageReads,
        1,
        "missing language is resolved once per render"
    );
    assert.equal(
        w.document.getElementById("ik" + w._keys.indexOf("i")).textContent,
        "I",
        "missing language uses default casing"
    );
    layout("_arm");
    w.editvar = "ab";
    w.editPos = 1;
    w._keyCur = w._keys.indexOf("և");
    w.editKey1(w.keys.ENTER);
    assert.equal(w.editvar, "aԵՒb");
    assert.equal(
        w.editPos,
        3,
        "expanded uppercase advances caret by inserted code units"
    );
    w._setCase(false);
    assert.equal(w._keyboardCharacter("և"), "և");
    layout("_gre");
    assert.equal(w._keyboardCharacter("ΐ"), "Ι\u0308\u0301");
    w._setCase(false);
    assert.equal(w._keyboardCharacter("ς"), "ς");
    layout("_dut");
    w._setCase(false);
    w._keyPage = Math.floor(w.keyStrings.alhabet.indexOf("\u0301") / 40);
    w._buildKeyboard();
    w.showEdit();
    assert(w.document.getElementById("listEdit").textContent.includes("◌́"));
    w.editvar = "j";
    w.editPos = 1;
    w._keyCur = w._keys.indexOf("\u0301");
    w.editKey1(w.keys.ENTER);
    assert.equal(
        w.editvar,
        "j́",
        "dotted circle is a label, never inserted text"
    );
    w.editvar = '<img src=x onerror="bad()">&';
    w.editPos = w.editvar.length;
    w._changeEdit();
    assert.equal(w.document.querySelector("#ee img"), null);
    assert.equal(w.document.getElementById("ee").textContent, w.editvar);
    console.log(
        "PASS localized keyboard: 28 alphabets, paging, all focus directions, case round trips and multicodepoint insertion"
    );
} finally {
    w.close();
}
