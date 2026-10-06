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
    write(
        "src/plugins/control-discovery.ts",
        `
        var message = "Discovery initial status";
        notify("waiting", "Approve at %1", address);
        finish("error", "Discovery failed");
    `
    );
    write("providers/example/provider.js", 'translate("Provider message");');
    write("src/settings/transfer-ui.ts", 'notice("New settings notice");');
    write(
        "index.html",
        '<script>bootStatus("Early startup status"); bootText("Early restart action"); console.log("Boot diagnostic");</script>'
    );
    const fixtureKeys = collectSourceKeys(fixture);
    assert(fixtureKeys.keys.has("Early startup status"));
    assert(fixtureKeys.keys.has("Early restart action"));
    assert(!fixtureKeys.keys.has("Boot diagnostic"));
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
        "New settings notice",
        "Discovery initial status",
        "Approve at %1",
        "Discovery failed",
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

    const runtime = { exports: {}, window: {} };
    vm.runInNewContext(
        ts.transpileModule(
            fs.readFileSync(
                path.join(root, "src/localization/index.ts"),
                "utf8"
            ),
            {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText,
        runtime
    );
    const translate = runtime.exports.translate;
    runtime.window.keyStrings = readDictionary(
        path.join(root, "locales/russian.js")
    );
    assert.equal(
        translate(
            "Reminder: %1 — %2 in %3 min",
            "Канал $& %2",
            "Новости $$ %3",
            5
        ),
        "Напоминание: Канал $& %2 — Новости $$ %3 через 5 мин",
        "EPG metadata must remain literal when substituted into translated reminders"
    );
    assert.equal(translate("%1 / %10 / %2", "one", "two"), "one / %10 / two");
    assert.equal(
        translate("%2 %1 %2", "first", "second"),
        "second first second"
    );
    for (const key of ["constructor", "toString", "__proto__"])
        assert.equal(
            translate(key, "argument"),
            key,
            "Unknown keys cannot resolve prototype members"
        );

    // A failed language download must leave the current Russian UI and saved
    // preference intact, so a transient network error cannot force English.
    const selectionSource = ts.createSourceFile(
        "src/index.ts",
        fs.readFileSync(path.join(root, "src/index.ts"), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const selectLang = selectionSource.statements.find(
        (node) =>
            ts.isFunctionDeclaration(node) && node.name.text === "selectLang"
    );
    let savedLanguage = "_rus";
    let languageRequest;
    let resumed = 0;
    const messages = [];
    const timers = new Map();
    let timerId = 0;
    const selection = {
        _: translate,
        checkTauriUpdatesAfterLanguage() {},
        clearTimeout: (id) => timers.delete(id),
        document: { getElementById: () => null },
        duneAddSettings() {},
        getScriptDOM: (url, success, error) => {
            languageRequest = { error, success, url };
        },
        hostUrl: "",
        infoBox: (message) => messages.push(message),
        keys: { ENTER: 13, EXIT: 27, RETURN: 8 },
        languageAssetPath,
        languageNames: {},
        PLAYER_VERSION: "test",
        renderButtonHint: () => "",
        setTimeout: (callback, delay) => {
            assert.equal(delay, 10000);
            timers.set(++timerId, callback);
            return timerId;
        },
        showPage() {},
        stbGetItem: () => savedLanguage,
        stbSetItem: (_key, value) => {
            savedLanguage = value;
        },
        strRETURN: "BACK",
        window: {
            keyStrings: runtime.window.keyStrings,
            optionsList: () => {
                resumed++;
            },
        },
    };
    vm.createContext(selection);
    vm.runInContext(
        ts.transpileModule(selectLang.getText(selectionSource), {}).outputText,
        selection
    );
    selection.selectLang();
    selection.selIndex = 0;
    selection.listKeyHandlerFn(13);
    assert.match(languageRequest.url, /locales\/english\.js/);
    assert.equal(savedLanguage, "_rus");
    assert.equal(selection.window.keyStrings, runtime.window.keyStrings);
    languageRequest.error();
    assert.deepEqual(messages, [translate("Failed to load!")]);
    assert.equal(savedLanguage, "_rus");
    assert.equal(resumed, 0);
    selection.listKeyHandlerFn(13);
    languageRequest.success();
    assert.equal(savedLanguage, "_eng");
    assert.equal(resumed, 1);
    savedLanguage = "_rus";
    languageRequest = null;
    selection.selectLang(true);
    selection.listKeyHandlerFn(13);
    assert.match(languageRequest.url, /locales\/russian\.js/);
    assert.equal(
        resumed,
        1,
        "Retrying the saved language waits for its dictionary"
    );
    languageRequest.success();
    assert.equal(resumed, 2);

    // A cancelled or stalled script can finish late, even while a newer
    // request is pending. Only the current request may persist or resume.
    savedLanguage = "_rus";
    selection.window.keyStrings = runtime.window.keyStrings;
    selection.selectLang();
    selection.selIndex = 0;
    selection.listKeyHandlerFn(13);
    const cancelledLanguage = languageRequest;
    selection.selIndex = 2;
    selection.listKeyHandlerFn(13);
    assert.equal(
        languageRequest,
        cancelledLanguage,
        "Only one active choice loads"
    );
    selection.listKeyHandlerFn(8);
    const afterCancel = resumed;
    assert.equal(timers.size, 0, "Back releases its timeout");
    selection.selectLang();
    selection.selIndex = 2;
    selection.listKeyHandlerFn(13);
    const stalledLanguage = languageRequest;
    const owner = selection.window.__ottLanguagePending;
    assert.notEqual(
        stalledLanguage,
        cancelledLanguage,
        "Back allows immediate retry"
    );
    selection.window.keyStrings = { stale: "cancelled" };
    cancelledLanguage.success();
    assert.equal(selection.window.keyStrings, runtime.window.keyStrings);
    assert.equal(selection.window.__ottLanguagePending, owner);
    assert.equal(savedLanguage, "_rus");
    assert.equal(resumed, afterCancel);
    const timeout = [...timers.values()][0];
    timeout();
    assert.equal(selection.window.__ottLanguagePending, null);
    assert.equal(timers.size, 0);
    assert.equal(savedLanguage, "_rus");
    assert.equal(messages.at(-1), translate("Failed to load!"));
    selection.selIndex = 0;
    selection.listKeyHandlerFn(13);
    const newestLanguage = languageRequest;
    assert.notEqual(
        newestLanguage,
        stalledLanguage,
        "A timed-out choice is retryable"
    );
    selection.window.keyStrings = { stale: "timed out" };
    stalledLanguage.success();
    assert.equal(selection.window.keyStrings, runtime.window.keyStrings);
    assert(
        selection.window.__ottLanguagePending,
        "Late load keeps newer owner"
    );
    const englishDictionary = { "Failed to load!": "Failed to load!" };
    selection.window.keyStrings = englishDictionary;
    newestLanguage.success();
    assert.equal(savedLanguage, "_eng");
    assert.equal(resumed, afterCancel + 1);
    assert.equal(timers.size, 0);
    selection.window.keyStrings = { stale: "after commit" };
    cancelledLanguage.success();
    stalledLanguage.error();
    assert.equal(selection.window.keyStrings, englishDictionary);
    assert.equal(savedLanguage, "_eng");
    assert.equal(resumed, afterCancel + 1);

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
        "Folders",
        "Sign in with Plex",
        "Save and open library",
        "VPortal profiles",
        "Not configured",
        "Could not save provider settings.",
        "Remote text entry",
        "Find command server",
        "Cancel pairing",
        "Enter the command server IP or address.",
        "OttPlay FOSS %1 is available. Download and install now?",
        "EPG diagnostics could not load. Open it again to retry.",
        "ERROR: Category #%1 does not exist!<br>Please select another category.",
    ])
        assert(Object.hasOwn(reference, key), `Audited UI key missing: ${key}`);
    const result = audit({
        englishOnly: process.argv.includes("--english-only"),
    });
    assert.deepEqual(result.errors, [], result.errors.join("\n"));
    assert.equal(result.localeCount, 28);
    assert.equal(result.keyCount, 806);
    console.log(
        `PASS localization: ${result.keyCount} canonical keys, ${result.sourceKeyCount} source-derived keys, ${result.localeCount} locale assets; missing/duplicate keys, placeholders, HTML, whitespace and selector coverage`
    );
} finally {
    fs.rmSync(fixture, { force: true, recursive: true });
}
