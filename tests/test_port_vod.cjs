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
            toggle(visible) {
                el.style.display = visible ? "" : "none";
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
            "rememberMediaView",
            "cancelMediaLoad",
            "requestMediaList",
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

// The real M3U provider mutates global records before calling done: reject stale completions.
{
    const c = fixture();
    const pending = [];
    c.host = "";
    c.$.ajax = (request) => pending.push(request);
    vm.runInContext(
        sourceFunctions("prov/m3u/prov.js", ["getMediaArrayXML"]) +
            sourceFunctions("src/ui/index.ts", ["closeList"]),
        c
    );
    c.listElement = null;
    c.getMediaArray = (url, done) =>
        c.getMediaArrayXML(url || "root.json", done);
    function complete(index, title, rows) {
        pending[index].success(JSON.stringify({ channels: rows, title }));
        pending[index].complete();
    }
    const folders = [{ playlist_url: "folder.json", title: "Folder" }];
    c.mediaList(null);
    complete(0, "Root", folders);
    c.selectMedia(0);
    c.mediaKeyHandler(c.keys.RETURN); // Back reloads the root while the child is pending.
    complete(2, "New root", folders);
    const renderCount = c.calls.filter((call) => call[0] === "render").length;
    complete(1, "Stale folder", [{ stream_url: "old.mp4", title: "Old" }]);
    assert.equal(c.listArray[0].title, "Folder");
    assert.strictEqual(c.mediaRecords, c.listArray);
    assert.equal(c.mediaName, "New root");
    assert.equal(
        c.calls.filter((call) => call[0] === "render").length,
        renderCount
    );

    c.selectMedia(0);
    c.closeList();
    complete(3, "Closed folder", [
        { stream_url: "closed.mp4", title: "Closed" },
    ]);
    assert.equal(c.isListVisible, false);
    assert.equal(
        c.mediaUrls,
        null,
        "Reopening a cancelled load must restart from a valid root"
    );
    assert.equal(c.mediaRecords.length, 0);
    assert.equal(
        c.calls.filter((call) => call[0] === "render").length,
        renderCount
    );

    c.mediaList(null);
    c.cancelMediaLoad(); // loadProv cancels before replacing the provider globals.
    c.getMediaArray = (_target, done) => {
        c.mediaRecords = [{ stream_url: "new.mp4", title: "New provider" }];
        done();
    };
    c.mediaList(null);
    complete(4, "Old provider", [
        { stream_url: "wrong.mp4", title: "Wrong provider" },
    ]);
    assert.equal(c.listArray[0].title, "New provider");
    assert.strictEqual(c.mediaRecords, c.listArray);
}

// A PIN result is valid only for the item/list that requested it.
{
    const c = fixture();
    c.listArray = [{ adult: 1, stream_url: "locked.mp4", title: "Locked" }];
    c.selectMedia(0);
    c.listArray = [{ stream_url: "other.mp4", title: "Other" }];
    c.parentAccess = true;
    c.unlock();
    assert(!c.calls.some((call) => call[0] === "play"));
}

// Third-party providers without isCurrent still get a guarded legacy completion callback.
{
    const c = fixture();
    const pending = [];
    c.getMediaArray = (_url, done) =>
        pending.push((title) => {
            c.mediaName = title;
            c.mediaRecords = [{ stream_url: title + ".mp4", title }];
            done();
        });
    c.mediaList(null);
    c.mediaUrls = null;
    c.mediaList(null);
    pending[1]("New");
    pending[0]("Old");
    assert.equal(c.listArray[0].title, "New");
    assert.strictEqual(c.mediaRecords, c.listArray);
    assert.equal(c.mediaName, "New");
}

// Edem page responses keep their own offsets and cannot modify another page/view.
{
    const c = fixture();
    c.host = "";
    c._vpurl = "https://example.invalid/vportal";
    const pending = [];
    c.$.ajax = (request) => pending.push(request);
    vm.runInContext(
        sourceFunctions("prov/edem/prov.js", [
            "addMedias2",
            "createMedia",
            "item2descr",
        ]),
        c
    );
    c.mediaRecords = Array.from({ length: 6 }, () => ({
        description: () => "Loading",
    }));
    c.listArray = c.mediaRecords;
    c.rememberMediaView();
    const params = { limit: 2 };
    c.selIndex = 0;
    c.addMedias2(params);
    c.selIndex = 2;
    c.addMedias2(params);
    assert.equal(JSON.parse(pending[0].data).offset, 0);
    assert.equal(JSON.parse(pending[1].data).offset, 2);
    pending[0].success({
        items: [{ title: "First page", type: "stream", url: "first.mp4" }],
    });
    pending[0].complete();
    assert.equal(
        c.mediaRecords.length,
        6,
        "A different pending page must not be truncated"
    );
    pending[1].success({
        items: [{ title: "Second page", type: "stream", url: "second.mp4" }],
    });
    pending[1].complete();
    assert.equal(c.mediaRecords[0].title, "First page");
    assert.equal(c.mediaRecords[2].title, "Second page");
    c.selIndex = 4;
    c.addMedias2(params);
    c.cancelMediaLoad();
    const renders = c.calls.filter((call) => call[0] === "render").length;
    pending[2].success({
        items: [{ title: "Closed page", type: "stream", url: "closed.mp4" }],
    });
    pending[2].complete();
    assert.equal(c.mediaRecords[4].title, undefined);
    assert.equal(
        c.calls.filter((call) => call[0] === "render").length,
        renders
    );
}

// Submitting an old provider's search dialog must not send its URL to a new provider.
{
    const c = fixture();
    c.mediaList(null);
    c.selectMedia(2);
    let fetched = false;
    c.getMediaArray = () => {
        fetched = true;
    };
    c.editvar = "movie";
    const selections = Array.from(c.mediaSelects);
    c.setEdit();
    assert.equal(fetched, false);
    assert.deepEqual(Array.from(c.mediaSelects), selections);
}

// Resolve lazy stream URLs before matching/persisting history; stale resume prompts cannot seek a new movie.
{
    const c = fixture();
    c.medHistory = [
        { current: 125, stream_url: "resume.mp4", title: "Resume" },
    ];
    let resolves = 0;
    c._playMedia({
        stream_url: () => {
            resolves++;
            return "resume.mp4";
        },
        title: "Lazy",
    });
    assert.equal(resolves, 1);
    assert.equal(c.medHistory.length, 1);
    assert.equal(JSON.parse(c.stored.medHistory)[0].stream_url, "resume.mp4");
    assert.equal(typeof c.confirm, "function");
    const previousConfirmation = c.confirm;
    c._playMedia({ stream_url: "other.mp4", title: "Other" });
    previousConfirmation();
    assert(!c.calls.some((call) => call[0] === "seek"));
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
