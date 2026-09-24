const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
function functions(file, names) {
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    return ts
        .transpileModule(
            source.statements
                .filter(
                    (n) =>
                        ts.isFunctionDeclaration(n) &&
                        names.includes(n.name?.text)
                )
                .map((n) => n.getText(source))
                .join("\n"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.ES2015,
                    target: ts.ScriptTarget.ES5,
                },
            }
        )
        .outputText.replace(/^export /gm, "");
}
function fixture() {
    const dom = new JSDOM(
        '<div id="dialogbox" style="display:none"></div><div id="listEdit" style="display:none"></div><div id="listAbout" style="display:none"></div><div id="listCaption">Parent</div><div id="listPodval">Footer</div><div id="listDetail">Detail</div><div id="numprog"></div><div id="list_window"></div><div id="list_osd"></div>',
        { runScripts: "outside-only" }
    );
    const w = dom.window,
        jobs = [],
        events = [];
    w.eval(fs.readFileSync(path.join(root, "js/jquery-1.11.1.min.js"), "utf8"));
    const originalIs = w.$.fn.is;
    w.$.fn.is = function (q) {
        return q === ":visible"
            ? !!this[0] && this[0].style.display !== "none"
            : originalIs.call(this, q);
    };
    Object.assign(w, {
        _: (x) => x,
        changeSelect: (delta) => events.push(["move", delta]),
        changeVolume: (value) => events.push(["volume", value]),
        channelNumberElement: w.document.getElementById("numprog"),
        clearTimeout(id) {
            if (jobs[id - 1]) jobs[id - 1].active = false;
        },
        closeList() {
            events.push(["close"]);
            w.__ottClassicScreenPort.closeList();
        },
        curColor: "#fff",
        curColorB: "#000",
        detailTimer: null,
        keys: {
            BLUE: 406,
            CH_DOWN: 189,
            CH_UP: 187,
            DOWN: 40,
            ENTER: 13,
            EXIT: 27,
            FF: 34,
            GREEN: 404,
            LEFT: 37,
            MUTE: 173,
            N0: 48,
            N1: 49,
            N2: 50,
            N3: 51,
            N4: 52,
            N5: 53,
            N6: 54,
            N7: 55,
            N8: 56,
            N9: 57,
            NEXT: 35,
            PAUSE: 19,
            PLAY: 80,
            PLAYPAUSE: 10252,
            POWER: 81,
            PREV: 36,
            RED: 403,
            RETURN: 8,
            RIGHT: 39,
            RW: 33,
            TOOLS: 84,
            UP: 38,
            VOL_DOWN: 174,
            VOL_UP: 175,
            YELLOW: 405,
        },
        listCaptionElement: w.document.getElementById("listCaption"),
        listDetailElement: w.document.getElementById("listDetail"),
        listElement: w.document.getElementById("list_window"),
        listFooterElement: w.document.getElementById("listPodval"),
        setTimeout(callback, delay) {
            jobs.push({ active: true, callback, delay });
            return jobs.length;
        },
        showPage() {
            w.__ottClassicScreenPort.commitList();
            w.listElement.style.display = "";
        },
        showShift: (value) => events.push(["shift", value]),
        stbEventToKeyCode: (event) => event.keyCode || event.which,
        stbSetWindow() {},
        strDOWN: "Down",
        strENTER: "OK",
        strEXIT: "Esc",
        strLEFT: "Left",
        strRETURN: "Back",
        strRIGHT: "Right",
        strUP: "Up",
        sVolumeStep: 7,
    });
    require("./helpers/screen-runtime.cjs")(w);
    w.eval(
        functions("src/utils/helpers.ts", [
            "metadataText",
            "metadataHtml",
            "metadataImageUrl",
            "metadataCssUrl",
        ])
    );
    w.eval(
        functions("src/ui/index.ts", [
            "_changeEdit",
            "escapeHtml",
            "infoBox",
            "confirmBox",
            "showSelectBox",
            "saveListPanelState",
            "restoreListPanelState",
            "showEditKey2",
            "editKey2",
            "renderButtonHint",
            "scheduleListDetailUpdate",
            "popupList",
            "hsvToRgb",
            "colorDialog",
            "selColorDialog",
            "backColorDialog",
        ])
    );
    w.eval(functions("src/keyhandler/index.ts", ["keyHandler", "dispatchKey"]));
    w.editKey = w.editKey2;
    return {
        close: () => dom.window.close(),
        events,
        jobs,
        key: (code) =>
            w.keyHandler({
                keyCode: code,
                preventDefault() {},
                stopPropagation() {},
            }),
        w,
    };
}
let passed = 0;
function test(name, fn) {
    const f = fixture();
    try {
        fn(f);
        passed++;
        console.log("PASS screen: " + name);
    } finally {
        f.close();
    }
}
for (const name of [
    "screen-controller",
    "input-router",
    "classic-screen-port",
    "menu-registry",
]) {
    const text = fs.readFileSync(
        path.join(root, "src/ui/" + name + ".ts"),
        "utf8"
    );
    acorn.parse(
        ts.transpileModule(text, {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        { ecmaVersion: 5 }
    );
}
test("screen invalidation detaches every old owner before reentrant cleanup", ({
    w,
}) => {
    const c = w.__ottScreenController.create(),
        calls = [];
    const first = c.open({ handle: () => calls.push("old"), kind: "list" });
    const last = c.open({ handle: () => {}, kind: "dialog", priority: 50 });
    const stale = first.guard(() => calls.push("stale"));
    last.own(() => {
        stale();
        c.open({ handle: () => calls.push("new"), kind: "list" });
    });
    c.invalidate();
    c.dispatch({ id: "accept" });
    assert.deepEqual(calls, ["new"]);
    assert.equal(first.active(), false);
});
test("list callbacks, focus and cleanup have one authoritative owner", ({
    w,
    key,
    events,
}) => {
    let disposed = 0;
    w.listArray = ["a", "b"];
    w.listDataArray = w.listArray;
    w.listKeyHandler = () => false;
    const owner = w.__ottClassicScreenPort.commitList();
    owner.own(() => disposed++);
    assert.equal(w.__ottClassicScreenPort.commitList(), owner);
    w.selIndex = 1;
    assert.equal(owner.model.focus, 1);
    key(40);
    key(175);
    assert.deepEqual(events, [
        ["move", 1],
        ["volume", 7],
    ]);
    w.listKeyHandlerFn = () => true;
    w.__ottClassicScreenPort.commitList();
    assert.equal(disposed, 1);
    assert.equal(owner.active(), false);
});
test("list handler opening replacement cannot move replacement focus on fallthrough", ({
    w,
    key,
    events,
}) => {
    w.listKeyHandler = () => {
        w.listKeyHandler = () => false;
        w.__ottClassicScreenPort.commitList();
        return false;
    };
    w.__ottClassicScreenPort.commitList();
    key(40);
    assert.deepEqual(events, []);
});
test("nested dialog/editor suspend list and dialog closes once", ({
    w,
    key,
}) => {
    w.listKeyHandler = () => false;
    const list = w.__ottClassicScreenPort.commitList();
    let saves = 0;
    w.editvar = "old";
    w.setEdit = () => saves++;
    w.showEditKey2();
    const editor = w.__ottClassicScreenPort.owner("editor");
    let yes = 0;
    w.confirmBox("Continue?", () => yes++);
    const old = w.dialogBoxKeyHandler;
    key(13);
    old(13);
    assert.equal(yes, 1);
    assert(editor.active());
    assert(list.active());
    w.document.getElementById("editvar").value = "new";
    key(13);
    assert.equal(saves, 1);
    assert.equal(w.__ottScreens.current(), list);
});
test("saved native key callback cannot save a replacement editor", ({ w }) => {
    let oldSaves = 0,
        newSaves = 0;
    w.editvar = "old";
    w.setEdit = () => oldSaves++;
    w.showEditKey2();
    const handler = w.document.getElementById("editvar").__ottEditKey2Handler;
    w.setEdit = () => newSaves++;
    w.editvar = "new";
    w.showEditKey2();
    handler({ key: "Enter", preventDefault() {}, stopPropagation() {} });
    assert.equal(oldSaves, 0);
    assert.equal(newSaves, 0);
    assert.equal(w.document.getElementById("editvar").value, "new");
});
test("editor save reentry preserves replacement editor and callback", ({
    w,
}) => {
    let saved = 0;
    w.editvar = "first";
    w.setEdit = () => {
        saved++;
        w.setEdit = () => (saved += 10);
        w.editvar = "second";
        w.showEditKey2();
    };
    w.showEditKey2();
    w.editKey2(13);
    assert.equal(saved, 1);
    assert.equal(w.document.getElementById("editvar").value, "second");
    assert.notEqual(
        w.document.getElementById("listEdit").style.display,
        "none"
    );
    w.editKey2(13);
    assert.equal(saved, 11);
});
test("source replacement retires dialogs, editor and scheduled list detail", ({
    w,
    jobs,
}) => {
    let calls = 0;
    w.detailListActionFn = () => calls++;
    w.__ottClassicScreenPort.commitList();
    w.scheduleListDetailUpdate();
    w.confirmBox("old", () => calls++);
    const old = w.dialogBoxKeyHandler;
    w.__ottClassicScreenPort.invalidate();
    old(13);
    jobs.forEach((j) => j.callback());
    assert.equal(calls, 0);
});
test("dialog callback opens a replacement without old closure closing it", ({
    w,
    key,
}) => {
    let calls = 0;
    w.confirmBox("first", () => w.confirmBox("second", () => calls++));
    const old = w.dialogBoxKeyHandler;
    key(13);
    old(13);
    assert.equal(calls, 0);
    assert.notEqual(
        w.document.getElementById("dialogbox").style.display,
        "none"
    );
    key(13);
    assert.equal(calls, 1);
});
test("picker timeout and saved callback cannot affect newer picker", ({
    w,
    jobs,
}) => {
    const chosen = [];
    w.showSelectBox(0, ["a", "b"], (v) => chosen.push(["old", v]), 0);
    const first = w.selectBoxKeyHandler;
    w.showSelectBox(0, ["c", "d"], (v) => chosen.push(["new", v]), -1);
    jobs[0].callback();
    first(13);
    assert.deepEqual(chosen, []);
    w.selectBoxKeyHandler(40);
    w.selectBoxKeyHandler(13);
    assert.deepEqual(chosen, [["new", 1]]);
});
test("quality picker suspends and restores its media parent", ({
    w,
    events,
}) => {
    const list = w.__ottClassicScreenPort.commitList();
    let cleanup = 0;
    list.own(() => cleanup++);
    w.showSelectBox(0, ["HD", "SD"], () => {}, -1, true);
    assert(list.active());
    assert.equal(cleanup, 0);
    assert.deepEqual(events, []);
    w.selectBoxKeyHandler(8);
    assert.equal(w.__ottScreens.current(), list);
    assert.equal(w.listElement.style.display, "");
});
test("immediate picker reentry cannot overwrite newer markup or timer", ({
    w,
    jobs,
}) => {
    w.showSelectBox(
        0,
        ["old-a", "old-b"],
        () => w.showSelectBox(0, ["new-a", "new-b"], () => {}, -1),
        1000
    );
    assert.match(w.channelNumberElement.innerHTML, /new-a/);
    assert.doesNotMatch(w.channelNumberElement.innerHTML, /old-a/);
    assert.equal(jobs.length, 0);
});
test("color picker old callback cannot commit to a new settings draft", ({
    w,
}) => {
    w.eSHLcolor = "50,85";
    w.colorDialog();
    const old = w.aboutKeyHandler;
    w.__ottClassicScreenPort.invalidate();
    w.eSHLcolor = "90,90";
    old(13);
    assert.equal(w.eSHLcolor, "90,90");
});
test("menu IDs survive labels, host function names and legacy hide imports", ({
    w,
}) => {
    w.toggleAspectRatio = function renamed() {};
    w.toggleProviderSettingsVisibility = function unlock() {};
    w.popupActions = [w.toggleAspectRatio, w.toggleProviderSettingsVisibility];
    w.popupArray = ["Translated", ""];
    w.popupDetail = [];
    w.sHideMenus = ["noProvParam"];
    const first = w.__ottMenuRegistry.open(w);
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].id, "video.aspect");
    w.sHideMenus = ["video.aspect"];
    const second = w.__ottMenuRegistry.open(w);
    assert.equal(second.rows[0].id, "provider.unlock");
});
test("actual popup has owned menu command dispatch and rejects captured retired handler", ({
    w,
    key,
}) => {
    let calls = 0;
    w.optionsList = () => calls++;
    w.popupActions = [w.optionsList];
    w.popupArray = ["Settings"];
    w.popupDetail = [];
    w.popupList("settings.open");
    const old = w.listKeyHandlerFn;
    key(13);
    assert.equal(calls, 1);
    w.__ottClassicScreenPort.invalidate();
    old(13);
    assert.equal(calls, 1);
});
test("menu capability filtering preserves legacy archive and media availability", ({
    w,
}) => {
    w.popPause = () => {};
    w.popMedia = () => {};
    w.popupActions = [w.popPause, w.popMedia];
    w.popupArray = ["Pause/Play", "Media"];
    w.channels = { x: { rec: 0 } };
    w.curList = ["x"];
    w.primaryIndex = 0;
    w.playType = 0;
    assert.equal(w.__ottMenuRegistry.open(w).rows.length, 0);
    w.playType = -1;
    w.getMediaArray = () => {};
    assert.equal(w.__ottMenuRegistry.open(w).rows.length, 2);
});
test("closing the parent revokes nested callbacks and hides their surfaces", ({
    w,
}) => {
    const list = w.__ottClassicScreenPort.commitList();
    w.editvar = "old";
    w.setEdit = () => {
        throw new Error("retired save");
    };
    w.showEditKey2();
    w.confirmBox("old", () => {
        throw new Error("retired confirmation");
    });
    const stale = w.dialogBoxKeyHandler;
    w.__ottClassicScreenPort.closeList();
    stale(w.keys.ENTER);
    assert.equal(list.active(), false);
    assert.equal(w.__ottScreens.current(), null);
    assert.equal(w.document.getElementById("dialogbox").style.display, "none");
    assert.equal(w.document.getElementById("listEdit").style.display, "none");
});
test("retired list models do not alias replacement fields", ({ w }) => {
    w.listArray = ["old"];
    w.listDataArray = w.listArray;
    const first = w.__ottClassicScreenPort.commitList();
    w.listArray = ["new"];
    w.listDataArray = w.listArray;
    const second = w.__ottClassicScreenPort.commitList();
    assert.notEqual(first.model, second.model);
    assert.equal(first.model.items[0], "old");
    assert.equal(second.model.items[0], "new");
});
test("overlay cleanup reentry keeps the latest owner and callback", ({ w }) => {
    const calls = [];
    w.__ottClassicScreenPort.setOwnedCallback("dialog", () =>
        calls.push("first")
    );
    w.__ottClassicScreenPort.owner("dialog").own(() => {
        w.__ottClassicScreenPort.setOwnedCallback("dialog", () =>
            calls.push("newest")
        );
    });
    const abandoned = w.__ottClassicScreenPort.setOwnedCallback("dialog", () =>
        calls.push("abandoned")
    );
    abandoned(w.keys.ENTER);
    w.dialogBoxKeyHandler(w.keys.ENTER);
    assert.deepEqual(calls, ["newest"]);
});
test("list cleanup source replacement cannot resurrect an abandoned screen", ({
    w,
}) => {
    const port = w.__ottClassicScreenPort;
    w.listKeyHandler = () => false;
    const first = port.commitList();
    first.own(() => port.invalidate());
    w.listKeyHandler = () => true;
    const abandoned = port.commitList();
    assert.equal(abandoned.active(), false);
    assert.equal(w.__ottScreens.current(), null);
});
test("picker cleanup reentry cannot render an abandoned choice", ({ w }) => {
    w.showSelectBox(0, ["first", "first2"], () => {}, -1);
    w.__ottClassicScreenPort.owner("picker").own(() => {
        w.showSelectBox(0, ["newest", "newest2"], () => {}, -1);
    });
    w.showSelectBox(0, ["abandoned", "abandoned2"], () => {}, -1);
    assert.match(w.channelNumberElement.innerHTML, /newest/);
    assert.doesNotMatch(w.channelNumberElement.innerHTML, /abandoned/);
});
test("nested about screens resume the saved owner and isolate suspended input", ({
    w,
}) => {
    let parentCalls = 0;
    w.__ottClassicScreenPort.setOwnedCallback("about", () => {
        parentCalls++;
        return true;
    });
    const parent = w.__ottClassicScreenPort.owner("about");
    const parentCallback = w.aboutKeyHandler;
    w.saveListPanelState();
    w.__ottClassicScreenPort.setOwnedCallback("about", () => true);
    parentCallback(w.keys.ENTER);
    assert.equal(parentCalls, 0);
    assert.equal(parent.active(), true);
    w.restoreListPanelState();
    assert.equal(w.__ottScreens.current(), parent);
    parentCallback(w.keys.ENTER);
    assert.equal(parentCalls, 1);
});
test("saved panels are released with their parent and cursor timers with the editor", ({
    w,
}) => {
    const port = w.__ottClassicScreenPort;
    w.listKeyHandler = () => false;
    const parent = port.commitList();
    port.savePanel({ retained: "parent" });
    parent.close();
    assert.equal(port.savedPanel().retained, undefined);
    const cleared = [];
    const intervals = [];
    w.cursorInterval = null;
    w.setInterval = (callback) => {
        intervals.push(callback);
        return intervals.length;
    };
    w.clearInterval = (id) => cleared.push(id);
    w.editvar = "text";
    const editor = port.openEditor();
    w._changeEdit();
    w._changeEdit();
    assert(cleared.includes(1), "redraw releases the previous cursor interval");
    port.invalidate();
    assert.equal(editor.active(), false);
    assert(
        cleared.includes(2),
        "source replacement releases the latest cursor interval"
    );
});
test("numeric button settings import to stable command identities without mutation", ({
    w,
}) => {
    const expected = [
        "archive.records",
        "menu.open",
        "channel.previous",
        "archive.seek",
        "information.channel",
        "video.aspect",
        "audio.track",
        "pip.toggle",
        "pip.close",
        "channels.categories",
        "guide.open",
        "media.open",
        "navigation.quick",
        "volume.increase",
        "volume.decrease",
        "navigation.forward",
        "navigation.backward",
        "subtitle.track",
        "archive.minute-back",
        "archive.minute-forward",
        "program.previous",
        "program.next",
    ];
    assert.deepEqual(
        expected.map((_, index) => w.__ottInputRouter.binding(index)),
        expected
    );
    assert.equal(w.__ottInputRouter.binding(-1), undefined);
    assert.equal(w.__ottInputRouter.binding(22), undefined);
});
console.log(
    "PASS screen ownership: " +
        passed +
        " groups, actual ES5 private modules and UI/input functions"
);
