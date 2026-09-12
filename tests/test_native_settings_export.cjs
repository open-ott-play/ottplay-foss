const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");
const ast = ts.createSourceFile(
    "index.ts",
    source,
    ts.ScriptTarget.Latest,
    true
);
const statement = ast.statements.find(
    (node) =>
        ts.isExpressionStatement(node) &&
        ts.isBinaryExpression(node.expression) &&
        node.expression.left.getText(ast) === "window.exportSettingsUI"
);
const code = ts.transpileModule(statement.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText;
const backup = JSON.stringify(
    {
        settings: {
            localCmdUrl:
                "https://example.invalid/?literal=&amp;<script>bad()</script>",
        },
        version: 1,
    },
    null,
    2
);
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function testNative(profile, clipboardMode) {
    const dom = new JSDOM(
        '<div id="listCaption"></div><div id="listDetail"></div><div id="listPodval"></div><div id="listAbout"></div>',
        { runScripts: "outside-only", url: "https://example.invalid/" }
    );
    const w = dom.window;
    w.eval(fs.readFileSync(path.join(root, "js/jquery-1.11.1.min.js"), "utf8"));
    let saved = 0,
        restored = 0;
    const notices = [],
        copies = [];
    const previous = () => false;
    Object.assign(w, {
        _: (value) => value,
        aboutKeyHandler: previous,
        btnDiv: (_key, _icon, title) => title,
        exportSettings: () => backup,
        keys: { ENTER: 13, EXIT: 27, RETURN: 8 },
        restoreCPD() {
            restored++;
        },
        saveCPD() {
            saved++;
        },
        showShift(message) {
            notices.push(message);
        },
    });
    if (profile === "tauri") w.__TAURI__ = {};
    else w.Capacitor = { getPlatform: () => profile };
    w.URL.createObjectURL = () =>
        assert.fail(
            "Native export must not request an unhandled Blob download"
        );
    if (clipboardMode !== "missing")
        Object.defineProperty(w.navigator, "clipboard", {
            value: {
                async writeText(value) {
                    if (clipboardMode === "denied")
                        throw new Error("Permission denied");
                    copies.push(value);
                },
            },
        });
    w.eval(code);
    w.exportSettingsUI();
    const output = w.document.getElementById("settingsExportText");
    assert.equal(output.value, backup);
    assert.equal(output.readOnly, true);
    assert.equal(output.selectionEnd, backup.length);
    assert.equal(w.document.querySelector("script"), null);
    assert.match(
        w.document.getElementById("listPodval").textContent,
        /Close.*Copy JSON/
    );
    assert.deepEqual(
        notices,
        [],
        "Opening a backup does not claim it was delivered"
    );
    assert.equal(saved, 1);
    w.aboutKeyHandler(w.keys.ENTER);
    await settle();
    if (clipboardMode === "success") {
        assert.deepEqual(copies, [backup]);
        assert.deepEqual(notices, ["Settings copied"]);
    } else {
        assert.deepEqual(copies, []);
        assert.deepEqual(notices, [
            "Copy the selected JSON with your device's copy command",
        ]);
        assert.equal(output.selectionEnd, backup.length);
    }
    output.dispatchEvent(
        new w.KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
    );
    assert.equal(restored, 1);
    assert.equal(w.aboutKeyHandler, previous);
    assert.equal(w.document.getElementById("settingsExportText"), null);
    dom.window.close();
}

async function testClosedBackup(complete) {
    const dom = new JSDOM('<div id="listAbout"></div>', {
        runScripts: "outside-only",
        url: "https://example.invalid/",
    });
    const w = dom.window;
    w.eval(fs.readFileSync(path.join(root, "js/jquery-1.11.1.min.js"), "utf8"));
    const notices = [];
    let resolveCopy, rejectCopy;
    Object.assign(w, {
        _: (value) => value,
        __TAURI__: {},
        exportSettings: () => backup,
        keys: { ENTER: 13, EXIT: 27, RETURN: 8 },
        restoreCPD() {},
        saveCPD() {},
        showShift: (message) => notices.push(message),
    });
    Object.defineProperty(w.navigator, "clipboard", {
        value: {
            writeText: () =>
                new Promise((resolve, reject) => {
                    resolveCopy = resolve;
                    rejectCopy = reject;
                }),
        },
    });
    w.eval(code);
    w.exportSettingsUI();
    const output = w.document.getElementById("settingsExportText");
    let focusCalls = 0,
        selectionCalls = 0;
    output.focus = () => {
        focusCalls++;
    };
    output.select = () => {
        selectionCalls++;
    };
    w.aboutKeyHandler(w.keys.ENTER);
    w.aboutKeyHandler(w.keys.RETURN);
    assert.equal(output.isConnected, false);
    if (complete) resolveCopy();
    else rejectCopy(new Error("Permission denied after closing"));
    await settle();
    assert.equal(focusCalls, 0, "Closed export must not regain focus");
    assert.equal(selectionCalls, 0, "Detached backup must not be selected");
    assert.deepEqual(
        notices,
        [],
        "Closed export must not show stale notifications"
    );
    dom.window.close();
}

(async () => {
    await testClosedBackup(true);
    await testClosedBackup(false);
    for (const profile of ["tauri", "ios", "android"])
        for (const clipboard of ["success", "denied", "missing"])
            await testNative(profile, clipboard);
    const dom = new JSDOM("<body></body>", { runScripts: "outside-only" });
    const w = dom.window;
    const downloads = [],
        revoked = [],
        notices = [];
    Object.assign(w, {
        exportSettings: () => backup,
        showShift: (message) => notices.push(message),
    });
    w.URL.createObjectURL = () => "blob:backup-fixture";
    w.URL.revokeObjectURL = (value) => revoked.push(value);
    w.HTMLAnchorElement.prototype.click = function () {
        downloads.push([this.download, this.href]);
    };
    w.eval(code);
    w.exportSettingsUI();
    assert.deepEqual(downloads, [
        ["ottplay-settings-v1.json", "blob:backup-fixture"],
    ]);
    assert.deepEqual(revoked, ["blob:backup-fixture"]);
    assert.deepEqual(notices, ["Settings download requested"]);
    assert.equal(w.document.querySelector("a"), null);
    dom.window.close();
    console.log(
        "OK: native backup copy/manual fallback and browser download contract"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
