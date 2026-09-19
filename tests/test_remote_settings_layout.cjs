const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { compatibilitySource } = require("./helpers/english-source-fixture.cjs");
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
w.eval(compatibilitySource);
w.eval(fs.readFileSync(path.join(root, "js/jquery-1.11.1.min.js"), "utf8"));
const stored = new Map();
Object.assign(w, {
    _: (text) => text,
    deviceUUID: "<script>window.injected=true</script>" + "uid".repeat(100),
    keys: { DOWN: 40, ENTER: 13, EXIT: 8, N2: 50, RETURN: 27, UP: 38 },
    listCaptionElement: w.document.getElementById("listCaption"),
    listDetailElement: w.document.getElementById("listDetail"),
    listFooterElement: w.document.getElementById("listPodval"),
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
    extract("src/utils/helpers.ts", [
        "metadataText",
        "metadataImageUrl",
        "metadataCssUrl",
        "metadataHtml",
        "hasTmdbService",
    ])
);
w.eval(
    extract("src/ui/index.ts", [
        "saveListPanelState",
        "restoreListPanelState",
        "renderButtonHint",
        "showEditKey2",
        "editKey2",
    ])
);
w.eval(
    extract("src/plugins/command-server.ts", ["normalizeCommandServerAddress"])
);
w.eval(
    extract(
        "src/index.ts",
        ["pullSettingsFromWindow", "editSettingsText"],
        ["window.settingsCommands", "window.importSettingsUI"]
    )
);
let saves = 0;
const originalSave = w.saveListPanelState;
w.saveListPanelState = () => {
    saves++;
    originalSave();
};
let restored;
w.optionsList = () => {
    restored = [
        w.listCaptionElement.innerHTML,
        w.listDetailElement.innerHTML,
        w.listFooterElement.innerHTML,
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
let controls = w.listFooterElement.querySelectorAll("span[onclick]");
assert.equal(
    controls.length,
    4,
    "existing footer actions fit one row; server shortcuts stay on their visible buttons"
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
assert.ok(w.listFooterElement.textContent.includes("↑↓ Scroll"));
controls = w.listFooterElement.querySelectorAll("span[onclick]");
controls[2].click();
submit(" https://example.invalid/new-swop/// ");
assert.equal(w.sSwopBaseUrl, "https://example.invalid/new-swop");
assert.equal(stored.get("bulkLocal"), w.sLocalCmdUrl);
assert.equal(stored.get("bulkSwop"), w.sSwopBaseUrl);
w.listFooterElement.querySelectorAll("span[onclick]")[1].click();
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
w.listFooterElement.querySelector("span[onclick]").click();
assert.deepEqual(restored, ["Settings", "Parent detail", "Parent footer"]);
assert.equal(w.document.getElementById("listAbout").style.display, "none");
assert.equal(w.document.getElementById("remoteSettingsContent"), null);
assert.equal(w.aboutKeyHandler(999), false);
w.settingsCommands();
w.aboutKeyHandler(w.keys.EXIT);
assert.deepEqual(restored, ["Settings", "Parent detail", "Parent footer"]);
// Outbound controls are separate from the inbound listener and never expose the saved code.
let serverListener = null;
let serverState = { enabled: false, message: "Disconnected" };
const serverChanges = [];
w.__ottCommandServer = {
    configure(config) {
        serverChanges.push({ ...config });
        w.settings.commandServerAddress = config.address.trim();
        w.settings.commandServerToken = config.token.trim();
        w.settings.commandServerEnabled = config.enabled ? 1 : 0;
        serverState = {
            enabled: config.enabled,
            message: config.enabled ? "Connecting..." : "Disconnected",
        };
        if (serverListener) serverListener();
    },
    status() {
        return serverState;
    },
    subscribe(listener) {
        serverListener = listener;
    },
};
w.settings.commandServerAddress = "";
w.settings.commandServerToken = "";
w.settingsCommands();
w.document.getElementById("commandServerAddress").click();
submit(" 192.168.1.20:8081 ");
assert.equal(w.settings.commandServerAddress, "192.168.1.20:8081");
assert.equal(
    serverChanges.at(-1).enabled,
    false,
    "an address without an access code does not connect"
);
w.aboutKeyHandler(52);
assert.equal(editor().type, "password", "access code editor must be masked");
const serverSecret = "s".repeat(64);
submit(serverSecret);
assert.equal(w.settings.commandServerToken, serverSecret);
assert.ok(
    !w.document.getElementById("listAbout").textContent.includes(serverSecret)
);
assert.equal(
    serverChanges.at(-1).enabled,
    true,
    "saving the second required field connects without an extra action"
);
assert.equal(
    w.document.getElementById("commandServerStatus").textContent,
    "Connecting..."
);
serverState = { enabled: true, message: "Connected" };
serverListener();
assert.equal(
    w.document.getElementById("commandServerStatus").textContent,
    "Connected"
);
w.aboutKeyHandler(53);
assert.equal(serverChanges.at(-1).enabled, false);
w.aboutKeyHandler(w.keys.RETURN);
assert.equal(
    serverListener,
    null,
    "closed settings unsubscribe status updates"
);

// A remote without digits or a pointer can configure the new server with
// directional keys and OK. Exercise actual DOM key events and selected controls.
w.sNoNumbersKeys = 1;
w.keys.LEFT = 37;
w.keys.RIGHT = 39;
w.settingsCommands();
function remoteKey(key) {
    const event = new w.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        keyCode: key,
    });
    w.document.activeElement.dispatchEvent(event);
    assert.equal(
        event.defaultPrevented,
        true,
        "focused control consumes remote key once"
    );
}
assert.deepEqual(
    [...w.document.querySelectorAll("#remoteSettingsContent button .btn")].map(
        (badge) => badge.textContent
    ),
    ["3", "4", "5"],
    "numeric shortcuts remain visible without duplicated footer hints"
);
assert.equal(w.document.activeElement.id, "commandServerAddress");
assert.match(w.document.activeElement.style.outline, /2px solid/);
remoteKey(w.keys.ENTER);
assert.equal(editor().value, "192.168.1.20:8081");
submit("192.168.1.30:8081");
assert.equal(w.settings.commandServerAddress, "192.168.1.30:8081");
assert.equal(w.document.activeElement.id, "commandServerAddress");
remoteKey(w.keys.RIGHT);
assert.equal(w.document.activeElement.id, "commandServerToken");
remoteKey(w.keys.ENTER);
assert.equal(editor().type, "password");
submit("d".repeat(64));
assert.equal(w.settings.commandServerToken, "d".repeat(64));
remoteKey(w.keys.RIGHT);
assert.equal(w.document.activeElement.id, "commandServerConnect");
const previousChanges = serverChanges.length;
remoteKey(w.keys.ENTER);
assert.equal(
    serverChanges.length,
    previousChanges + 1,
    "OK performs one connection toggle"
);
assert.equal(serverChanges.at(-1).enabled, false);
assert.equal(w.document.activeElement.id, "commandServerConnect");
const keyboardContent = w.document.getElementById("remoteSettingsContent");
Object.defineProperty(keyboardContent, "clientHeight", { value: 200 });
remoteKey(w.keys.DOWN);
assert.equal(keyboardContent.scrollTop, 100, "UP/DOWN retain scrolling");
remoteKey(w.keys.UP);
assert.equal(keyboardContent.scrollTop, 0);
remoteKey(w.keys.RIGHT);
assert.match(w.document.activeElement.textContent, /Local URL/);
remoteKey(w.keys.ENTER);
assert.match(w.editCaption, /Local command URL/);
w.editKey2(w.keys.RETURN);
remoteKey(w.keys.RIGHT);
assert.match(w.document.activeElement.textContent, /Swop URL/);
remoteKey(w.keys.RIGHT);
assert.match(w.document.activeElement.textContent, /HTTP remote/);
remoteKey(w.keys.RIGHT);
assert.match(w.document.activeElement.textContent, /Close/);
remoteKey(w.keys.RIGHT);
assert.equal(
    w.document.activeElement.id,
    "commandServerAddress",
    "selection wraps"
);
remoteKey(w.keys.LEFT);
assert.match(w.document.activeElement.textContent, /Close/);
remoteKey(w.keys.ENTER);
assert.equal(w.document.getElementById("listAbout").style.display, "none");
assert.equal(serverListener, null);
w.sNoNumbersKeys = 0;

// New server copy uses the existing translator; missing entries remain English.
const originalTranslate = w._;
const translated = {
    "Access code": "Translated access code",
    "Command server": "Translated server",
    Connected: "Translated connected",
    Disconnect: "Translated disconnect",
    "Server address": "Translated address",
    "Server device access code": "Translated code editor",
};
w._ = (key) => translated[key] || key;
serverState = { enabled: true, message: "Connected" };
w.settingsCommands();
assert.equal(
    w.document.querySelector("#remoteSettingsContent b").textContent,
    translated["Command server"]
);
assert.equal(
    w.document.getElementById("commandServerAddress").textContent,
    "3 " + translated["Server address"]
);
assert.equal(
    w.document.getElementById("commandServerToken").textContent,
    "4 " + translated["Access code"]
);
assert.equal(
    w.document.getElementById("commandServerStatus").textContent,
    translated.Connected
);
assert.equal(
    w.document.getElementById("commandServerConnect").textContent,
    "5 " + translated.Disconnect
);
w.aboutKeyHandler(52);
assert.equal(w.editCaption, translated["Server device access code"]);
w.editKey2(w.keys.RETURN);
w.aboutKeyHandler(w.keys.RETURN);
w._ = originalTranslate;

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
// Touch controls use the real dialog renderer and renderButtonHint dispatch boundary.
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
async function testHttpRemoteSettings() {
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const requests = [];
    let state = { code: "", enabled: false, port: 0 };
    let complete;
    let fail;
    w.__ottLocalHttpRemote = {
        setEnabled(enabled) {
            requests.push(enabled);
            return new Promise((resolve, reject) => {
                complete = () => {
                    state = {
                        code: enabled ? String(requests.length).repeat(64) : "",
                        enabled,
                        port: enabled ? 19999 : 0,
                    };
                    resolve();
                };
                fail = reject;
            });
        },
        status: () => state,
    };
    w._doKey = (key) => w.aboutKeyHandler(key);
    w.settingsCommands();
    assert.equal(
        requests.length,
        0,
        "opening settings cannot enable the listener"
    );
    assert.equal(w.document.getElementById("localHttpDeviceCode"), null);
    assert.match(
        w.document.getElementById("remoteSettingsContent").textContent,
        /HTTP remote control: off/
    );
    const httpToggle = w.listFooterElement.querySelectorAll("span[onclick]")[3];
    assert.match(httpToggle.textContent, /Enable HTTP remote/);
    httpToggle.click();
    w.aboutKeyHandler(49);
    await tick();
    assert.deepEqual(
        requests,
        [true],
        "repeated keys cannot race pending enable"
    );
    assert.equal(
        w.document.getElementById("localHttpDeviceCode"),
        null,
        "credentials require backend acknowledgement"
    );
    assert.match(
        w.document.getElementById("remoteSettingsContent").textContent,
        /Applying HTTP remote settings/
    );
    complete();
    await tick();
    const code = w.document.getElementById("localHttpDeviceCode");
    assert.equal(code.value, "1".repeat(64));
    assert.equal(code.readOnly, true);
    code.click();
    assert.equal(code.selectionStart, 0);
    assert.equal(
        code.selectionEnd,
        64,
        "a touch/click selects the complete code for copying"
    );
    assert.match(
        w.document.getElementById("remoteSettingsContent").textContent,
        /HTTP port: 19999/
    );
    assert.match(
        w.document.getElementById("remoteSettingsContent").textContent,
        /Authorization: Bearer/
    );
    assert.match(w.listFooterElement.textContent, /Disable HTTP remote/);
    w.aboutKeyHandler(49);
    await tick();
    assert.deepEqual(requests, [true, false]);
    complete();
    await tick();
    assert.equal(
        w.document.getElementById("localHttpDeviceCode"),
        null,
        "disabled access must hide the old credential"
    );
    w.aboutKeyHandler(49);
    await tick();
    fail(new Error("native listener unavailable"));
    await tick();
    assert.match(
        w.document.getElementById("remoteSettingsContent").textContent,
        /Could not update HTTP remote control/
    );
    assert.equal(w.document.getElementById("localHttpDeviceCode"), null);
    w.aboutKeyHandler(49);
    await tick();
    w.aboutKeyHandler(w.keys.RETURN);
    complete();
    await tick();
    assert.equal(
        w.document.getElementById("listAbout").style.display,
        "none",
        "async completion cannot reopen a closed settings screen"
    );
    assert.equal(w.document.getElementById("remoteSettingsContent"), null);

    const keys = [
        "Remote control",
        "Local HTTP remote control",
        "Enable HTTP remote",
        "Disable HTTP remote",
        "Device access code",
        "HTTP port",
        "Disabled by default. Enabling creates a new device access code.",
        "Send this code from your proxy in the Authorization: Bearer header.",
        "HTTP remote control is unavailable on this device.",
        "Could not update HTTP remote control.",
        "Applying HTTP remote settings...",
        "on",
    ];
    const dictionaries = fs
        .readdirSync(path.join(root, "stbPlayer"))
        .filter((name) => /^_[a-z]{3}\.js$/.test(name));
    assert.equal(dictionaries.length, 20);
    for (const name of dictionaries) {
        w.eval(fs.readFileSync(path.join(root, "stbPlayer", name), "utf8"));
        for (const key of keys) assert.ok(w.keyStrings[key], `${name}: ${key}`);
    }
    w._ = (key) => w.keyStrings[key] || key;
    w.eval(fs.readFileSync(path.join(root, "stbPlayer/_rus.js"), "utf8"));
    w.settingsCommands();
    assert.equal(w.listCaptionElement.textContent, "Удалённое управление");
    assert.match(
        w.document.getElementById("remoteSettingsContent").textContent,
        /Код доступа к устройству/
    );
    assert.match(w.listFooterElement.textContent, /Выключить HTTP-пульт/);
    w.aboutKeyHandler(w.keys.RETURN);
}
testHttpRemoteSettings()
    .then(() => {
        dom.window.close();
        console.log(
            "OK: Remote settings layout, authenticated HTTP controls, selectable credentials, async lifecycle and 20 translations"
        );
    })
    .catch((error) => {
        dom.window.close();
        console.error(error);
        process.exitCode = 1;
    });
