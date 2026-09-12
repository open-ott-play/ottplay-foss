const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
function extract(file, names, assignments = []) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const source = ast.statements
        .filter(
            (node) =>
                (ts.isFunctionDeclaration(node) &&
                    names.includes(node.name?.text)) ||
                (ts.isExpressionStatement(node) &&
                    ts.isBinaryExpression(node.expression) &&
                    assignments.includes(node.expression.left.getText(ast)))
        )
        .map((node) => node.getText(ast))
        .join("\n");
    return ts
        .transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES2018,
            },
        })
        .outputText.replace(/^export /gm, "");
}
// Only checked-in scripts run. Network/resources and device APIs are not enabled.
const dom = new JSDOM(
    '<div id="listCaption">Settings</div><div id="listDetail">Parent detail</div><div id="listPodval">Parent footer</div><div id="listEdit" style="display:none"></div><div id="listAbout" style="display:none;height:321px"></div>',
    { runScripts: "dangerously", url: "https://example.invalid/" }
);
const w = dom.window;
w.eval(fs.readFileSync(path.join(root, "js/jquery-1.11.1.min.js"), "utf8"));
const stored = new Map();
Object.assign(w, {
    _: (text) => text,
    deviceUUID: "<script>window.injected=true</script>" + "uid".repeat(100),
    keys: { DOWN: 40, ENTER: 13, EXIT: 8, N2: 50, RETURN: 27, UP: 38 },
    listCaptionElement: w.document.getElementById("listCaption"),
    listDetailElement: w.document.getElementById("listDetail"),
    listPodvalElement: w.document.getElementById("listPodval"),
    saveSettings(settings) {
        stored.set("bulkLocal", settings.localCmdUrl);
        stored.set("bulkSwop", settings.swopBaseUrl);
    },
    settings: { localCmdUrl: "", rFun: 4, swopBaseUrl: "" },
    sLocalCmdUrl:
        "https://example.invalid/" +
        "long".repeat(100) +
        '<img src=x onerror="window.injected=true">',
    sSwopBaseUrl: "https://example.invalid/swop",
    stbSetItem: (key, value) => stored.set(key, value),
    ui_state: {},
});
w.eval(
    extract("src/ui/index.ts", [
        "saveCPD",
        "restoreCPD",
        "btnDiv",
        "showEditKey2",
        "editKey2",
    ])
);
w.eval(
    extract(
        "src/index.ts",
        ["pullSettingsFromWindow", "editSettingsText"],
        ["window.settingsCommands", "window.importSettingsUI"]
    )
);
let saves = 0;
const originalSave = w.saveCPD;
w.saveCPD = () => {
    saves++;
    originalSave();
};
let restored;
w.optionsList = () => {
    restored = [
        w.listCaptionElement.innerHTML,
        w.listDetailElement.innerHTML,
        w.listPodvalElement.innerHTML,
    ];
};
w._doKey = (key) =>
    w.document.getElementById("listEdit").style.display !== "none"
        ? w.editKey2(key)
        : w.aboutKeyHandler(key);
const prompts = [];
let response = null;
w.prompt = (message, initial) => {
    prompts.push({ initial, message });
    return response;
};
w.settingsCommands();
assert.equal(w.listCaptionElement.textContent, "Remote control");
assert.equal(w.listDetailElement.textContent, "");
assert.equal(saves, 0);
const content = w.document.getElementById("remoteSettingsContent");
assert.equal(content.style.height, "100%");
assert.equal(content.style.overflowY, "auto");
assert.equal(content.style.overflowWrap, "anywhere");
assert.equal(
    content.querySelector("img,script"),
    null,
    "UID and URLs remain literal text"
);
assert.equal(w.injected, undefined);
assert.ok(content.textContent.includes(w.deviceUUID));
Object.defineProperty(content, "clientHeight", { value: 200 });
assert.equal(w.aboutKeyHandler(w.keys.DOWN), true);
assert.equal(content.scrollTop, 100);
w.aboutKeyHandler(w.keys.UP);
assert.equal(content.scrollTop, 0);
let controls = w.listPodvalElement.querySelectorAll("span[onclick]");
assert.equal(
    controls.length,
    3,
    "controls stay outside the scrollable overlay"
);
function editor() {
    return w.document.getElementById("editvar");
}
function submit(value) {
    editor().value = value;
    editor().dispatchEvent(
        new w.KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
}
const initial = w.sLocalCmdUrl;
controls[1].click();
assert.equal(
    w.document.getElementById("listAbout").style.display,
    "none",
    "about overlay cannot intercept editor keys"
);
assert.equal(editor().value, initial);
assert.ok(
    w.listCaptionElement.textContent.includes(
        "empty disables local command polling"
    )
);
submit("  https://example.invalid/local?x=&amp;<literal>  ");
assert.equal(w.sLocalCmdUrl, "https://example.invalid/local?x=&amp;<literal>");
assert.equal(stored.get("sLocalCmdUrl"), w.sLocalCmdUrl);
assert.equal(w.settings.localCmdUrl, w.sLocalCmdUrl);
assert.equal(w.document.getElementById("listEdit").style.display, "none");
assert.equal(w.listCaptionElement.textContent, "Remote control");
assert.ok(w.listPodvalElement.textContent.includes("↑↓ Scroll"));
controls = w.listPodvalElement.querySelectorAll("span[onclick]");
controls[2].click();
submit(" https://example.invalid/new-swop/// ");
assert.equal(w.sSwopBaseUrl, "https://example.invalid/new-swop");
assert.equal(stored.get("bulkLocal"), w.sLocalCmdUrl);
assert.equal(stored.get("bulkSwop"), w.sSwopBaseUrl);
w.aboutKeyHandler(w.keys.ENTER);
assert.equal(
    editor().value,
    w.sLocalCmdUrl,
    "subsequent edit uses literal current URL"
);
editor().value = "discard this";
editor().dispatchEvent(
    new w.KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
);
assert.equal(w.sLocalCmdUrl, "https://example.invalid/local?x=&amp;<literal>");
w.aboutKeyHandler(w.keys.ENTER);
submit("   ");
assert.equal(stored.get("sLocalCmdUrl"), "", "empty URL disables polling");
w.aboutKeyHandler(w.keys.N2);
submit("   ");
assert.equal(
    stored.get("sSwopBaseUrl"),
    "",
    "empty URL disables remote text entry"
);
assert.equal(
    saves,
    5,
    "only nested editor visits use the single-level CPD buffer"
);
assert.equal(
    prompts.length,
    0,
    "shared editor does not rely on native prompt support"
);
w.listPodvalElement.querySelector("span[onclick]").click();
assert.deepEqual(restored, ["Settings", "Parent detail", "Parent footer"]);
assert.equal(w.document.getElementById("listAbout").style.display, "none");
assert.equal(w.document.getElementById("remoteSettingsContent"), null);
assert.equal(w.aboutKeyHandler(999), false);
w.settingsCommands();
w.aboutKeyHandler(w.keys.EXIT);
assert.deepEqual(restored, ["Settings", "Parent detail", "Parent footer"]);
// Exercise the actual import validation/confirmation/apply functions after real editor teardown.
w.eval(extract("src/settings/index.ts", ["importSettings", "applyImport"]));
let confirmation;
let successes = 0;
let reloads = 0;
let restarts = 0;
w.confirmBox = (_message, yes, no) => {
    assert.equal(w.document.getElementById("listEdit").style.display, "none");
    assert.equal(w.listCaptionElement.textContent, "Settings");
    confirmation = { no, yes };
};
w.loadSettings = () => {
    reloads++;
};
w.restart = () => {
    restarts++;
};
w.showShift = () => {
    successes++;
};
w.providerSetItem = (key, value) => stored.set(key, value);
const beforeImport = [...stored];
w.importSettingsUI();
editor().value = '{"version":1}';
editor().dispatchEvent(
    new w.KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
);
assert.deepEqual(
    [...stored],
    beforeImport,
    "cancelled editor cannot write settings"
);
assert.equal(confirmation, undefined);
for (const invalid of ["", "not JSON", '{"version":2,"settings":{}}']) {
    w.importSettingsUI();
    submit(invalid);
    assert.equal(confirmation, undefined);
    assert.equal(successes, 0, "malformed import cannot report success");
    assert.deepEqual([...stored], beforeImport);
}
const envelope = JSON.stringify({
    favoritesArray: [3],
    parentalArray: [2],
    settings: {
        localCmdUrl: "http://lan/?literal=&amp;<text>",
        swopBaseUrl: "",
    },
    version: 1,
});
w.importSettingsUI();
submit(envelope);
assert.ok(confirmation, "valid import still requires existing confirmation");
assert.deepEqual([...stored], beforeImport);
confirmation.no();
assert.deepEqual(
    [...stored],
    beforeImport,
    "rejected confirmation cannot write settings"
);
w.importSettingsUI();
submit(envelope);
confirmation.yes();
assert.equal(stored.get("bulkLocal"), "http://lan/?literal=&amp;<text>");
assert.equal(stored.get("parentalArray"), "[2]");
assert.equal(stored.get("favoritesArray"), "[3]");
assert.equal(successes, 1);
assert.equal(reloads, 1);
assert.equal(restarts, 1);
// Touch controls use the real dialog renderer and btnDiv dispatch boundary.
const dialog = w.document.createElement("div");
dialog.id = "dialogbox";
w.document.body.appendChild(dialog);
w.strENTER = "Enter";
w.strRETURN = "Back";
w.eval(extract("src/ui/index.ts", ["escapeHtml", "confirmBox"]));
let accepted = 0,
    cancelled = 0,
    resumed = 0;
let playing = true;
w.stbIsPlaying = () => playing;
w.stbContinue = () => {
    playing = true;
    resumed++;
};
w._doKey = (key) => w.dialogBoxKeyHandler(key);
let bubbled = 0;
dialog.addEventListener("click", () => {
    bubbled++;
});
function openConfirmation() {
    w.confirmBox(
        "Replace settings?",
        () => {
            accepted++;
        },
        () => {
            cancelled++;
        }
    );
    const buttons = [...dialog.querySelectorAll("span[onclick]")];
    assert.equal(
        buttons.length,
        2,
        "Touch users need visible Yes and No controls"
    );
    assert.match(buttons[0].textContent, /Yes/);
    assert.match(buttons[1].textContent, /No/);
    return buttons;
}
let choices = openConfirmation();
playing = false;
choices[1].click();
assert.equal(accepted, 0);
assert.equal(cancelled, 1);
assert.equal(
    resumed,
    1,
    "No resumes playback paused while the dialog was open"
);
assert.equal(dialog.style.display, "none");
assert.equal(w.dialogBoxKeyHandler, null);
choices = openConfirmation();
choices[0].click();
assert.equal(accepted, 1);
assert.equal(cancelled, 1);
assert.equal(resumed, 1, "Yes must not invoke cancellation playback recovery");
assert.equal(dialog.style.display, "none");
assert.equal(w.dialogBoxKeyHandler, null);
assert.equal(
    bubbled,
    0,
    "Dialog buttons must not trigger underlying body actions"
);
openConfirmation();
w._doKey(w.keys.UP);
assert.equal(accepted, 1);
assert.equal(cancelled, 2, "Existing non-ENTER cancellation remains available");
assert.equal(dialog.style.display, "none");
dom.window.close();
console.log(
    "OK: Remote settings own caption/footer, escaped wrapping content, arrow scroll, real controls and one-shot parent restoration"
);
