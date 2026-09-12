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
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
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
        (elements[id] ||= { innerHTML: "", style: {}, textContent: "" });
    function $(selector) {
        const el = typeof selector === "string" ? element(selector) : selector;
        return {
            css(name, value) {
                if (value !== undefined) el.style[name] = value;
                return this;
            },
            height() {
                return 0;
            },
            hide() {
                el.style.display = "none";
                return this;
            },
            html(value) {
                if (value !== undefined) el.innerHTML = value;
                return this;
            },
            not() {
                return this;
            },
            remove() {
                return this;
            },
            show() {
                el.style.display = "";
                return this;
            },
            text(value) {
                if (value !== undefined) el.textContent = String(value);
                return this;
            },
        };
    }
    const c = {
        _: (text) => text,
        _prog100: { name: "Live" },
        $,
        btnDiv: (key, icon, text) => text,
        calls,
        catIndex: 0,
        cats: { All: [1] },
        catsArray: ["All"],
        clearTimeout() {},
        closeList() {
            calls.push(["close"]);
        },
        confirmBox(message, yes) {
            calls.push(["confirm", message]);
            c.confirm = yes;
        },
        console,
        curColor: "white",
        curColorB: "black",
        curList: [1],
        Date,
        document: { getElementById: (id) => element(`#${id}`) },
        elements,
        encodeURIComponent,
        enterPinAndSetAccess(next) {
            calls.push(["pin"]);
            c.unlock = next;
        },
        getHeightK: () => 1,
        getThumbnail: () => "",
        getWidthK: () => 1,
        infoBox(text) {
            calls.push(["message", text]);
        },
        infoMedia() {
            calls.push(["info"]);
        },
        innerHeight: 720,
        isFinite,
        JSON,
        keys: {
            DOWN: 40,
            ENTER: 13,
            EXIT: 27,
            FF: 34,
            GREEN: 404,
            LEFT: 37,
            N0: 48,
            N2: 50,
            N8: 56,
            NEXT: 35,
            PRECH: 191,
            PREV: 36,
            RED: 403,
            RETURN: 8,
            RIGHT: 39,
            RW: 33,
            TOOLS: 84,
            UP: 38,
            YELLOW: 405,
        },
        listArray: [],
        listDataArray: [],
        Math,
        medFavorites: [],
        medHistory: [],
        mediaCheckTimer: null,
        mediaName: "",
        mediaNames: [],
        mediaRecords: [],
        mediaRecordsPar: null,
        mediaSelects: [],
        mediaUrls: null,
        Number,
        numprogElement: element("#numprog"),
        parentAccess: false,
        parentPIN: "1234",
        playTime: 0,
        playType: 0,
        popupList() {
            calls.push(["popup"]);
        },
        prevArr: [],
        primaryIndex: 0,
        providerSetItem: (key, value) => (stored[key] = value),
        refreshAudioBadge() {},
        sArrowFun: 0,
        selIndex: 0,
        setInterval: (fn) => (timers.push(fn), timers.length),
        setTimeout: (fn) => (timers.push(fn), timers.length),
        settings: { favorites: 0, pageSize: 25, prevCount: 2 },
        sFavorites: 0,
        showEditKey() {
            calls.push(["edit"]);
        },
        showPage() {
            calls.push(["render", c.mediaName]);
        },
        showShift(text) {
            calls.push(["shift", text]);
        },
        sInfoSwitch: 0,
        sMedCount: 2,
        sNoSmall: 1,
        sPNFun: 1,
        sPSchannels: 1,
        sRewFun: 1,
        sShowPikon: 0,
        sStopPlay: 0,
        stbGetItem: () => "",
        stbGetLen: () => 600,
        stbGetPosTime: () => 125.9,
        stbIsPlaying: () => false,
        stbPlay(url) {
            calls.push(["play", url]);
        },
        stbSetItem: (key, value) => (stored[key] = value),
        stbSetPosTime(value) {
            calls.push(["seek", value]);
        },
        stbStop() {
            calls.push(["stop"]);
        },
        step2text: String,
        stored,
        timers,
        video: null,
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
            { stream_url: "movie.mp4", title: "Movie" },
            { playlist_url: "catalog.xml", title: "Folder" },
            {
                playlist_url: "search.xml?sort=name",
                search_on: true,
                title: "Search",
            },
            {
                playlist_url: "submenu",
                submenu: [{ stream_url: "sub.mp4", title: "Submovie" }],
                title: "Submenu",
            },
        ],
        "catalog.xml": [{ stream_url: "nested.mp4", title: "Nested movie" }],
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
        current: 125,
        stream_url: "watched.mp4",
        title: "Watched",
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
    c.listArray = [{ adult: "1", stream_url: "locked.mp4", title: "Locked" }];
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

// Edem lazy descriptions fetch pages: one Info action must trigger only one request.
{
    const c = fixture();
    c.saveCPD = () => {};
    c.listCaptionElement = null;
    c.listPodvalElement = null;
    c.host = "";
    c._vpurl = "https://example.invalid/vportal";
    let requests = 0;
    c.$.ajax = () => requests++;
    vm.runInContext(
        sourceFunctions("prov/edem/prov.js", ["addMedias2"]) +
            sourceFunctions("src/ui/index.ts", ["infoMedia"]),
        c
    );
    c.listArray = [
        {
            description: () => c.addMedias2({ limit: 300 }),
            title: "Loading movie",
        },
    ];
    c.infoMedia();
    assert.equal(
        requests,
        1,
        "Info must evaluate the provider description once"
    );
    assert.equal(
        c.elements["#listAbout"].innerHTML,
        '<div id="_prd">Download! Wait ...</div>'
    );
}

// Adapter position persists on leaving VOD, enables resume, and history=0 remains disabled.
{
    const c = fixture();
    c.mediaUrls = [""];
    c._playMedia({ stream_url: "first.mp4", title: "First" });
    c.setCurrent(0, -1);
    assert.equal(JSON.parse(c.stored.medHistory)[0].current, 125);
    c._playMedia({ stream_url: "second.mp4", title: "Second" });
    c._playMedia({ stream_url: "first.mp4", title: "First" });
    assert.equal(typeof c.confirm, "function");
    c.confirm();
    assert.deepEqual(c.calls.at(-1), ["seek", 120]);
    c.sMedCount = 0;
    c._playMedia({ stream_url: "third.mp4", title: "No history" });
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
