/* Exercise the actual legacy-bundle function bodies with a deterministic DOM/provider fixture. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function sourceFunctions(file, names) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const found = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) &&
            node.body &&
            names.includes(node.name.text)
    );
    assert.equal(
        found.length,
        names.length,
        `Every function must exist in ${file}`
    );
    return ts.transpileModule(
        found
            .map((node) => node.getText(ast).replace(/^export\s+/, ""))
            .join("\n"),
        {
            compilerOptions: {
                target: ts.ScriptTarget.ES5,
                module: ts.ModuleKind.None,
            },
        }
    ).outputText;
}

function fixture() {
    const elements = {};
    const calls = [];
    const stored = {};
    const timers = [];
    const element = (id) =>
        (elements[id] ||= { innerHTML: "", textContent: "", style: {} });
    function $(selector) {
        const el = typeof selector === "string" ? element(selector) : selector;
        return {
            html(value) {
                if (value !== undefined) el.innerHTML = value;
                return this;
            },
            text(value) {
                if (value !== undefined) el.textContent = String(value);
                return this;
            },
            css(name, value) {
                if (value !== undefined) el.style[name] = value;
                return this;
            },
            hide() {
                el.style.display = "none";
                return this;
            },
            show() {
                el.style.display = "";
                return this;
            },
            not() {
                return this;
            },
            remove() {
                return this;
            },
            height() {
                return 0;
            },
        };
    }
    const c = {
        console,
        Date,
        Math,
        Number,
        JSON,
        encodeURIComponent,
        isFinite,
        document: { getElementById: (id) => element(`#${id}`) },
        innerHeight: 720,
        $,
        elements,
        calls,
        stored,
        timers,
        settings: { pageSize: 25, favorites: 0, prevCount: 2 },
        keys: {
            ENTER: 13,
            RETURN: 8,
            EXIT: 27,
            LEFT: 37,
            UP: 38,
            RIGHT: 39,
            DOWN: 40,
            N0: 48,
            N2: 50,
            N8: 56,
            RED: 403,
            GREEN: 404,
            YELLOW: 405,
            PRECH: 191,
            TOOLS: 84,
            RW: 33,
            FF: 34,
            PREV: 36,
            NEXT: 35,
        },
        _: (text) => text,
        getHeightK: () => 1,
        getWidthK: () => 1,
        getThumbnail: () => "",
        refreshAudioBadge() {},
        video: null,
        setTimeout: (fn) => (timers.push(fn), timers.length),
        clearTimeout() {},
        setInterval: (fn) => (timers.push(fn), timers.length),
        mediaUrls: null,
        mediaNames: [],
        mediaSelects: [],
        mediaRecords: [],
        mediaRecordsPar: null,
        mediaName: "",
        medHistory: [],
        medFavorites: [],
        listArray: [],
        listDataArray: [],
        selIndex: 0,
        sFavorites: 0,
        sMedCount: 2,
        sShowPikon: 0,
        sNoSmall: 1,
        sArrowFun: 0,
        sRewFun: 1,
        sPNFun: 1,
        sPSchannels: 1,
        parentPIN: "1234",
        parentAccess: false,
        mediaCheckTimer: null,
        sStopPlay: 0,
        sInfoSwitch: 0,
        playType: 0,
        playTime: 0,
        catIndex: 0,
        primaryIndex: 0,
        catsArray: ["All"],
        cats: { All: [1] },
        curList: [1],
        prevArr: [],
        _prog100: { name: "Live" },
        numprogElement: element("#numprog"),
        curColor: "white",
        curColorB: "black",
        showPage() {
            calls.push(["render", c.mediaName]);
        },
        closeList() {
            calls.push(["close"]);
        },
        showShift(text) {
            calls.push(["shift", text]);
        },
        popupList() {
            calls.push(["popup"]);
        },
        infoMedia() {
            calls.push(["info"]);
        },
        infoBox(text) {
            calls.push(["message", text]);
        },
        btnDiv: (key, icon, text) => text,
        showEditKey() {
            calls.push(["edit"]);
        },
        stbGetItem: () => "",
        stbSetItem: (key, value) => (stored[key] = value),
        providerSetItem: (key, value) => (stored[key] = value),
        stbGetPosTime: () => 125.9,
        stbGetLen: () => 600,
        stbIsPlaying: () => false,
        stbStop() {
            calls.push(["stop"]);
        },
        stbPlay(url) {
            calls.push(["play", url]);
        },
        stbSetPosTime(value) {
            calls.push(["seek", value]);
        },
        step2text: String,
        confirmBox(message, yes) {
            calls.push(["confirm", message]);
            c.confirm = yes;
        },
        enterPinAndSetAccess(next) {
            calls.push(["pin"]);
            c.unlock = next;
        },
    };
    c.window = c;
    const context = vm.createContext(c);
    vm.runInContext(
        sourceFunctions("src/channels/index.ts", [
            "mediaBack",
            "mediaKeyHandler",
            "addToMedFavorites",
            "selectMedia",
            "showMediaList",
            "getMediaDescr",
            "searchMedia",
            "setCurrent",
        ]) +
            sourceFunctions("src/ui/index.ts", [
                "showMediaList1",
                "mediaList",
                "showSelectBox",
                "updateMediaInfo",
                "initBackgroundIntervals",
                "_t2",
            ]) +
            sourceFunctions("src/index.ts", ["_playMedia"]),
        context
    );
    c.playMedia = c._playMedia;
    const catalogs = {
        "": [
            { title: "Movie", stream_url: "movie.mp4" },
            { title: "Folder", playlist_url: "catalog.xml" },
            {
                title: "Search",
                playlist_url: "search.xml?sort=name",
                search_on: true,
            },
            {
                title: "Submenu",
                playlist_url: "submenu",
                submenu: [{ title: "Submovie", stream_url: "sub.mp4" }],
            },
        ],
        "catalog.xml": [{ title: "Nested movie", stream_url: "nested.mp4" }],
    };
    c.getMediaArray = function (url, done) {
        assert.equal(
            typeof url,
            "string",
            "Provider receives a URL, not a callback in the first position"
        );
        assert.equal(
            typeof done,
            "function",
            "Provider receives its completion callback"
        );
        calls.push(["fetch", url]);
        c.mediaRecords = (catalogs[url] || []).map((item) => ({ ...item }));
        done(); // Real providers mutate mediaRecords and do not pass an array to the callback.
    };
    return c;
}

// First open -> provider callback -> nested folder -> Back -> local history/favorites.
{
    const c = fixture();
    c.mediaList(null);
    assert.deepEqual(Array.from(c.mediaUrls), [""]);
    assert.equal(c.listArray[1].title, "Folder");
    assert(c.listArray.some((item) => item.playlist_url === -1));
    assert(c.listArray.some((item) => item.playlist_url === -2));
    assert.strictEqual(c.listDataArray, c.listArray);
    c.selectMedia(1);
    assert.equal(c.listArray[0].title, "Nested movie");
    c.mediaKeyHandler(c.keys.GREEN);
    assert.equal(JSON.parse(c.stored.medFavorites)[0].stream_url, "nested.mp4");
    c.mediaKeyHandler(c.keys.RETURN);
    assert.equal(
        c.selIndex,
        1,
        "Returning to parent restores its selected row"
    );
    c.medHistory.push({
        title: "Watched",
        stream_url: "watched.mp4",
        current: 125,
    });
    let fetched = c.calls.filter((call) => call[0] === "fetch").length;
    c.selectMedia(c.listArray.findIndex((item) => item.playlist_url === -1));
    assert.strictEqual(c.listArray, c.medHistory);
    assert.equal(c.calls.filter((call) => call[0] === "fetch").length, fetched);
    c.mediaKeyHandler(c.keys.RETURN);
    fetched = c.calls.filter((call) => call[0] === "fetch").length;
    c.selectMedia(c.listArray.findIndex((item) => item.playlist_url === -2));
    assert.strictEqual(c.listArray, c.medFavorites);
    c.mediaKeyHandler(c.keys.GREEN);
    assert.equal(c.listArray.length, 0);
    assert.equal(c.selIndex, 0);
    assert.equal(c.stored.medFavorites, "[]");
    assert.equal(c.calls.filter((call) => call[0] === "fetch").length, fetched);
    c.mediaKeyHandler(c.keys.RETURN); // Empty list still supports Back.
    assert.equal(c.listArray[1].title, "Folder");
    c.selIndex = 3;
    c.selectMedia();
    assert.equal(c.listArray[0].title, "Submovie");
    c.mediaKeyHandler(c.keys.RETURN);
    assert.equal(c.listArray[3].title, "Submenu");
    assert.equal(c.selIndex, 3);
}

// Search accepts special characters; adult playback waits until PIN access is granted.
{
    const c = fixture();
    c.mediaList(null);
    c.selectMedia(2);
    assert.equal(c.calls.at(-1)[0], "edit");
    c.editvar = "a & b";
    c.setEdit();
    assert(
        c.calls.some(
            (call) =>
                call[0] === "fetch" &&
                call[1] === "search.xml?sort=name&search=a%20%26%20b"
        )
    );
    c.listArray = [{ title: "Locked", adult: "1", stream_url: "locked.mp4" }];
    c.selectMedia(0);
    assert.equal(c.calls.at(-1)[0], "pin");
    assert(!c.calls.some((call) => call[0] === "play"));
    c.parentAccess = true;
    c.unlock();
    assert(
        c.calls.some((call) => call[0] === "play" && call[1] === "locked.mp4")
    );
    assert.equal(
        c.getMediaDescr({ description: () => "Lazy description" }),
        "Lazy description"
    );
}

// Adapter position persists on leaving VOD, enables resume, and history=0 remains disabled.
{
    const c = fixture();
    c.mediaUrls = [""];
    c._playMedia({ title: "First", stream_url: "first.mp4" });
    c.setCurrent(0, -1);
    assert.equal(JSON.parse(c.stored.medHistory)[0].current, 125);
    c._playMedia({ title: "Second", stream_url: "second.mp4" });
    c._playMedia({ title: "First", stream_url: "first.mp4" });
    assert.equal(typeof c.confirm, "function");
    c.confirm();
    assert.deepEqual(c.calls.at(-1), ["seek", 120]);
    c.sMedCount = 0;
    c._playMedia({ title: "No history", stream_url: "third.mp4" });
    assert.equal(c.medHistory.length, 0);
    assert.equal(c.stored.medHistory, "[]");
    c.updateMediaInfo();
    assert.equal(c.elements["#begin_time"].textContent, "2");
    assert.equal(c.elements["#end_time"].textContent, "+8");
    assert.equal(
        c.elements["#progress"].style.width,
        (125.9 / 600) * 100 + "%"
    );
    c.initBackgroundIntervals();
    c.elements["#begin_time"].textContent = "";
    c.timers.at(-2)();
    assert.equal(
        c.elements["#begin_time"].textContent,
        "2",
        "The 1s timer refreshes VOD progress"
    );
}

// The second row dispatches -99, which must select it; left/right retain legacy extremes.
{
    const c = fixture();
    const selected = [];
    c.showSelectBox(
        0,
        ["First", "Second", "Third"],
        (index) => selected.push(index),
        -1
    );
    c.selectBoxKeyHandler(-99);
    c.selectBoxKeyHandler(c.keys.ENTER);
    assert.deepEqual(selected, [1]);
    c.showSelectBox(
        0,
        ["First", "Second", "Third"],
        (index) => selected.push(index),
        -1
    );
    c.selectBoxKeyHandler(c.keys.RIGHT);
    c.selectBoxKeyHandler(c.keys.ENTER);
    assert.deepEqual(selected, [1, 2]);
    assert.equal(c.selectBoxKeyHandler, null);
}
console.log(
    "OK: VOD provider flow, navigation, favorites/history, search/PIN, resume/progress and selector input"
);
