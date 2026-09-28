const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const {
    audit,
    collectSourceKeys,
    languageAssets,
    languageAssetPath,
    readDictionary,
    validateDictionary,
} = require("../scripts/localization-catalog.cjs");
const root = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-localization-"));
function write(file, source) {
    const target = path.join(fixture, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
    return target;
}
try {
    for (const directory of ["src", "devices", "providers"])
        fs.mkdirSync(path.join(fixture, directory));
    write(
        "src/index.ts",
        `
        _( "New static message %1", version );
        w._(enabled ? "Enabled status" : "Disabled status");
        label("New setting label");
        renderButtonHint(13, "OK", "New action caption");
        createSettingsPage(w, "privateId", "New settings title", true, false);
        const choices = ["First choice", "Second choice"];
        w._(choices[index]);
        const object = { first: "First prompt", second: "Second prompt" };
        w._(object[index]);
        const raw = "Finite label";
        _(raw);
        optionsArr.push({ action: action, name: "New option", desc: "Option explanation" });
        var infoArr = [{ action: action, name: "New information", desc: "Information explanation" }];
        function it(value, title) { return _(title); }
        it(year, "New metadata heading");
        _(externalProvider.title);
        console.log("Not a translated message");
    `
    );
    write(
        "src/ui/menu-registry.ts",
        `var screenMenuDefinitions = [
        ["pip.toggle", "action", "Start PiP / Swap PiP", "PiP explanation"],
        ["settings.open", "action", "Another menu label", "Menu explanation"]
    ];`
    );
    write("devices/example.js", '_("Adapter message");');
    write("providers/example/provider.js", 'translate("Provider message");');
    const fixtureKeys = collectSourceKeys(fixture);
    for (const key of [
        "New static message %1",
        "Enabled status",
        "Disabled status",
        "New setting label",
        "New action caption",
        "New settings title",
        "First choice",
        "Second choice",
        "First prompt",
        "Second prompt",
        "Finite label",
        "New option",
        "Option explanation",
        "New information",
        "Information explanation",
        "New metadata heading",
        "Start PiP",
        "Swap PiP",
        "PiP explanation",
        "Another menu label",
        "Menu explanation",
        "Adapter message",
        "Provider message",
    ])
        assert(
            fixtureKeys.keys.has(key),
            `New source key must be discovered: ${key}`
        );
    assert(!fixtureKeys.keys.has("Not a translated message"));
    assert(!fixtureKeys.keys.has("privateId"));
    assert(
        fixtureKeys.dynamic.some(
            (entry) => entry.expression === "externalProvider.title"
        )
    );
    const duplicate = write(
        "duplicate.js",
        'var keyStrings = { "Same": "First", "Same": "Second" };'
    );
    assert.throws(() => readDictionary(duplicate), /duplicate key/);
    const english = { greeting: " %1<br/>%2 ", label: "Label" };
    assert.deepEqual(
        validateDictionary(
            english,
            { greeting: " %2<br>%1 ", label: "Tłumaczenie" },
            "example"
        ),
        []
    );
    for (const translation of [
        { greeting: " %1<br/>%1 ", label: "Label" },
        { greeting: " %1 %2 ", label: "Label" },
        { greeting: "%1<br/>%2", label: "Label" },
        { greeting: " %1<br/>%2 ", label: "" },
        { greeting: " %1<br/>%2 " },
        { greeting: " %1<br/>%2 ", label: "Label", stale: "Stale" },
    ])
        assert(
            validateDictionary(english, translation, "broken").length,
            "Broken locale must fail"
        );
    const alphabets = JSON.parse(
        fs.readFileSync(
            path.join(root, "tests/fixtures/locale-alphabets.json"),
            "utf8"
        )
    );
    assert.equal(Object.keys(languageAssets).length, 28);
    assert.deepEqual(
        Object.keys(languageAssets).sort(),
        Object.keys(alphabets.locales).sort(),
        "Every persisted language identifier retains its complete keyboard alphabet"
    );
    assert.equal(languageAssetPath("_eng"), "/locales/english.js");
    assert.equal(languageAssetPath("_rus"), "/locales/russian.js");
    for (const [code, file] of Object.entries(languageAssets)) {
        assert.equal(languageAssetPath(code), file);
        assert.equal(
            readDictionary(path.join(root, file)).alhabet,
            alphabets.locales[code].alphabet,
            "Saved language preference loads the matching alphabet: " + code
        );
    }
    for (const code of [
        "",
        "unknown",
        "_xyz",
        "constructor",
        "toString",
        "__proto__",
        "../../x",
    ])
        assert.equal(languageAssetPath(code), "/locales/english.js");

    const scripts = [];
    const loader = { exports: {} };
    const browser = {
        __cv: "test-version",
        __host: "https://player.example/base",
    };
    vm.runInNewContext(
        ts.transpileModule(
            fs.readFileSync(
                path.join(root, "src/localization/loader.ts"),
                "utf8"
            ),
            {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText,
        {
            document: {
                body: { appendChild: (script) => scripts.push(script) },
                createElement: () => ({ crossOrigin: "" }),
            },
            exports: loader.exports,
            require: (specifier) => {
                if (specifier === "./assets") return { languageAssetPath };
                if (specifier === "./index") return { setTranslations() {} };
                throw new Error(
                    "Unexpected language loader dependency: " + specifier
                );
            },
            window: browser,
        },
        { timeout: 1000 }
    );
    for (const code of [...Object.keys(languageAssets), "unknown"])
        loader.exports.loadLanguage(code, () => {});
    assert.deepEqual(
        scripts.map((script) => script.src),
        [...Object.values(languageAssets), "/locales/english.js"].map(
            (file) => "https://player.example/base" + file + "?test-version"
        ),
        "Module loader uses renamed assets without changing host or version handling"
    );
    delete browser.__host;
    delete browser.__cv;
    loader.exports.loadLanguage("_rus", () => {});
    assert.equal(scripts.at(-1).src, "/locales/russian.js?local");

    const reference = readDictionary(
        path.join(root, languageAssetPath("_eng"))
    );
    for (const key of [
        "Number of rows in lists",
        "Next keyboard page",
        "Call PiP",
        "PiP exchange",
        "Player and device info",
        "Filter",
        "Enter the command server IP or address.",
        "OttPlay FOSS %1 is available. Download and install now?",
    ])
        assert(Object.hasOwn(reference, key), `Audited UI key missing: ${key}`);
    const result = audit({
        englishOnly: process.argv.includes("--english-only"),
    });
    assert.deepEqual(result.errors, [], result.errors.join("\n"));
    assert.equal(result.localeCount, 28);
    assert.equal(result.keyCount, 630);
    console.log(
        `PASS localization: ${result.keyCount} canonical keys, ${result.sourceKeyCount} source-derived keys, ${result.localeCount} locale assets; missing/duplicate keys, placeholders, HTML, whitespace and selector coverage`
    );
} finally {
    fs.rmSync(fixture, { force: true, recursive: true });
}
