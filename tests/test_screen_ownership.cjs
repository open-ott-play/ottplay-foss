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
            "bindColorDialogInput",
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
function layoutFixture(w) {
    const frames = [];
    const listIn = w.document.createElement("div");
    listIn.id = "listIn";
    w.listElement.appendChild(listIn);
    Object.defineProperty(listIn, "clientHeight", {
        configurable: true,
        value: 100,
    });
    listIn.getBoundingClientRect = () => ({ bottom: -2, top: 0 });
    let layouts = 0;
    Object.assign(w, {
        __ottClassicGuide: { cancelConsumers() {} },
        $infoBar: w.$("#numprog"),
        getListItemFn: (row) => row,
        getViewportWidthScale: () => 1,
        listArray: ["One"],
        listInElement: listIn,
        listKeyHandler: () => false,
        listRowHeight: () => 20,
        packListRowBoxes() {
            layouts++;
            return 20;
        },
        requestAnimationFrame(callback) {
            frames.push(callback);
        },
        selIndex: 0,
        settings: { noSmall: 1, pageSize: 25, showScroll: 0 },
    });
    w.listDataArray = w.listArray;
    w.eval(functions("src/ui/index.ts", ["showPage"]));
    return { frames, layouts: () => layouts, listIn };
}
test("retired list layout frames cannot resize or reopen the list", ({ w }) => {
    const { frames, layouts, listIn } = layoutFixture(w);
    w.showPage();
    assert.equal(
        frames.length,
        2,
        "layout and clipped-cursor retries are queued"
    );
    const owner = w.__ottClassicScreenPort.listOwner();
    w.closeList();
    assert.equal(owner.active(), false);
    const html = listIn.innerHTML;
    const pending = frames.splice(0);
    pending.forEach((callback) => callback());
    assert.equal(layouts(), 1, "retired rows are not measured again");
    assert.equal(w.__ottClassicScreenPort.listOwner(), null);
    assert.equal(listIn.innerHTML, html);
    assert.equal(
        frames.length,
        0,
        "a retired retry cannot schedule more frames"
    );
    assert.equal(w.__ottListCursorRetry, false);
});
for (const kind of ["cursor", "fit"])
    test(
        "replacement list owns its " +
            kind +
            " retry before the retired frame runs",
        ({ w }) => {
            const { frames, layouts, listIn } = layoutFixture(w);
            const slot =
                kind === "cursor"
                    ? "__ottListCursorRetry"
                    : "__ottListFitRetry";
            if (kind === "fit") {
                Object.defineProperty(listIn, "clientHeight", { value: 0 });
                listIn.getBoundingClientRect = () => ({ bottom: 100, top: 0 });
            }
            w.showPage();
            const oldOwner = w.__ottClassicScreenPort.listOwner();
            const oldRetry = w[slot];
            w.listArray = ["Replacement"];
            w.listDataArray = w.listArray;
            w.showPage();
            const replacement = w.__ottClassicScreenPort.listOwner();
            const replacementRetry = w[slot];
            assert.equal(oldOwner.active(), false);
            assert.equal(replacement.active(), true);
            assert.equal(
                frames.length,
                4,
                "replacement queues its own layout retry"
            );
            assert.notEqual(replacementRetry, oldRetry);
            w.showPage();
            assert.equal(
                frames.length,
                5,
                "same owner coalesces a pending layout retry"
            );
            assert.equal(w[slot], replacementRetry);
            const pending = frames.splice(0);
            pending[0]();
            pending[1]();
            assert.equal(
                layouts(),
                3,
                "retired layout cannot touch replacement rows"
            );
            assert.equal(
                w[slot],
                replacementRetry,
                "retired retry cannot clear replacement state"
            );
            assert.equal(frames.length, 0);
            Object.defineProperty(listIn, "clientHeight", { value: 100 });
            listIn.getBoundingClientRect = () => ({ bottom: 100, top: 0 });
            pending.slice(2).forEach((callback) => callback());
            assert.equal(w.__ottClassicScreenPort.listOwner(), replacement);
            assert.equal(w[slot], false);
            assert.equal(
                frames.length,
                1,
                "replacement rerenders exactly once, then only queues layout"
            );
            assert.equal(layouts(), 6);
        }
    );
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
test("rapid list selection owns only the pending detail timer", ({
    w,
    jobs,
}) => {
    const owner = w.__ottClassicScreenPort.commitList();
    const own = owner.own;
    let cleanups = 0;
    const rendered = [];
    owner.own = (cleanup) => {
        cleanups++;
        return own(() => {
            cleanups--;
            cleanup();
        });
    };
    for (let selection = 0; selection < 100; selection++) {
        w.detailListActionFn = () => rendered.push(selection);
        w.scheduleListDetailUpdate();
    }
    assert.equal(jobs.filter((job) => job.active).length, 1);
    assert.equal(cleanups, 1, "canceled debounce cleanups are released");
    jobs.forEach((job) => job.callback());
    assert.deepEqual(rendered, [99], "queued canceled callbacks are inert");
    assert.equal(cleanups, 0, "completed timer releases its cleanup");
    assert.equal(jobs.filter((job) => job.active).length, 0);
    w.scheduleListDetailUpdate();
    assert.equal(cleanups, 1);
    owner.close();
    assert.equal(cleanups, 0, "closing the list releases the final timer");
    assert.equal(jobs.filter((job) => job.active).length, 0);
    jobs[jobs.length - 1].callback();
    assert.deepEqual(rendered, [99]);
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
test("explicit picker decoration preserves its owner, input dispatch and stale guards", ({
    w,
    key,
}) => {
    const port = w.__ottClassicScreenPort,
        parent = port.commitList(),
        chosen = [];
    let cleanup = 0,
        calls = 0;
    parent.own(() => cleanup++);
    w.showSelectBox(0, ["HD", "SD"], (value) => chosen.push(value), -1, true);
    const original = w.selectBoxKeyHandler,
        owner = port.owner("picker");
    const decorated = port.decorateOwnedCallback("picker", original, (code) => {
        calls++;
        return original(code);
    });
    assert.equal(port.owner("picker"), owner);
    assert.equal(cleanup, 0);
    assert.equal(
        port.decorateOwnedCallback("picker", original, () => {}),
        null
    );
    key(40);
    key(13);
    assert.deepEqual(chosen, [1]);
    assert.equal(calls, 2);
    assert(parent.active());
    w.showSelectBox(0, ["new", "other"], () => {}, -1, true);
    decorated(13);
    assert.equal(calls, 2);
    assert.deepEqual(chosen, [1]);
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
const colorCases = require("./fixtures/ui/color-dialogs-before-shared.json");
function colorSetting(name) {
    return name === "colorDialog"
        ? "eSHLcolor"
        : name === "selColorDialog"
          ? "eSHLcolSel"
          : "eSHLcolorB";
}
function colorSnapshot(w, setting) {
    return {
        caption: w.listCaptionElement.innerHTML,
        detail: w.listDetailElement.innerHTML,
        focus: w.selIndex,
        preview: w.document.getElementById("step")?.style.cssText ?? null,
        value: w[setting] ?? null,
        visible: w.$("#listAbout").is(":visible"),
    };
}
for (const scenario of colorCases.records) {
    test(
        "captured color input " +
            scenario.name +
            " " +
            scenario.initial +
            " " +
            scenario.keys.join("/"),
        ({ w }) => {
            const setting = colorSetting(scenario.name);
            if (scenario.initial !== null) w[setting] = scenario.initial;
            if (scenario.keyCodes) Object.assign(w.keys, scenario.keyCodes);
            w.listArray = ["first", "second"];
            w.listDataArray = w.listArray;
            w.listKeyHandler = () => false;
            w.selIndex = 1;
            w.__ottClassicScreenPort.commitList();
            assert.equal(w[scenario.name].length, 0, "public dialog arity");
            w[scenario.name]();
            const states = [colorSnapshot(w, setting)];
            for (const keyName of scenario.keys) {
                const handled = w.aboutKeyHandler(w.keys[keyName]);
                states.push({ handled, ...colorSnapshot(w, setting) });
            }
            assert.deepEqual(states, scenario.states);
        }
    );
}
function clickColorControl(w, element) {
    assert(element, "rendered mouse control exists");
    // JSDOM outside-only does not execute inline handlers automatically.
    w.Function("event", element.getAttribute("onclick")).call(element, {
        stopPropagation() {},
    });
}
for (const name of ["colorDialog", "selColorDialog", "backColorDialog"]) {
    test("color remote/mouse save and parent focus " + name, ({ w, key }) => {
        const setting = colorSetting(name),
            writes = [];
        let saved = "20,30";
        Object.defineProperty(w, setting, {
            configurable: true,
            get: () => saved,
            set: (value) => {
                saved = value;
                writes.push(value);
            },
        });
        w.listArray = ["first", "second"];
        w.listDataArray = w.listArray;
        w.selIndex = 1;
        const listKeys = [];
        w.listKeyHandler = (code) => {
            listKeys.push(code);
            return true;
        };
        const parent = w.__ottClassicScreenPort.commitList();
        w._doKey = key;
        w[name]();
        key(w.keys.RIGHT);
        key(w.keys.UP);
        assert.deepEqual(writes, [], "preview does not commit");
        assert.deepEqual(listKeys, [], "overlay suspends parent input");
        assert.equal(w.selIndex, 1);
        clickColorControl(
            w,
            w.listFooterElement.querySelector('[aria-label="Set"]')
        );
        assert.deepEqual(
            writes,
            ["30,35"],
            "commit invokes original setting setter once"
        );
        assert.equal(w.listCaptionElement.innerHTML, "Parent");
        assert.equal(w.listFooterElement.innerHTML, "Footer");
        assert.equal(w.listDetailElement.innerHTML, "Detail");
        assert.equal(w.$("#listAbout").is(":visible"), false);
        assert(parent.active());
        assert.equal(w.selIndex, 1);
        key(w.keys.ENTER);
        assert.deepEqual(
            listKeys,
            [w.keys.ENTER],
            "parent receives input again"
        );
        w[name]();
        key(w.keys.BLUE);
        clickColorControl(
            w,
            w.listFooterElement.querySelector('[aria-label="Close"]')
        );
        assert.deepEqual(writes, ["30,35"], "mouse cancel discards preview");
    });
    test(
        "retired color input cannot overwrite replacement " + name,
        ({ w }) => {
            const setting = colorSetting(name);
            w[setting] = "20,30";
            w[name]();
            const retired = w.aboutKeyHandler;
            w.__ottClassicScreenPort.invalidate();
            w[name]();
            const preview = w.document.getElementById("step").style.cssText;
            retired(w.keys.BLUE);
            retired(w.keys.ENTER);
            assert.equal(w[setting], "20,30");
            assert.equal(
                w.document.getElementById("step").style.cssText,
                preview
            );
            assert.equal(w.$("#listAbout").is(":visible"), true);
        }
    );
}
test("foreground mouse arrows and color presets dispatch the same owned input", ({
    w,
    key,
}) => {
    w.eSHLcolor = "20,30";
    w._doKey = key;
    w.colorDialog();
    for (const name of ["RIGHT", "UP"]) {
        clickColorControl(
            w,
            w.document.querySelector(
                '#listAbout [onclick="_doKey(keys.' + name + ');"]'
            )
        );
    }
    assert.equal(
        w.document.getElementById("step").style.color,
        "rgb(255, 210, 166)"
    );
    clickColorControl(
        w,
        w.document.querySelector('#listAbout [aria-label="Green"]')
    );
    assert.equal(
        w.document.getElementById("step").style.color,
        "rgb(147, 255, 38)"
    );
    clickColorControl(
        w,
        w.listFooterElement.querySelector('[aria-label="Set"]')
    );
    assert.equal(w.eSHLcolor, "90,85");
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
