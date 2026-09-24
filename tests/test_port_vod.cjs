/* Exercise the actual legacy-bundle function bodies with a deterministic DOM/provider fixture. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { settingsSource } = require("./helpers/settings-source-fixture.cjs");
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
        calls,
        catIndex: 0,
        cats: { All: [1] },
        catsArray: ["All"],
        channelNumberElement: element("#numprog"),
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
        formatSeekOffset: String,
        getThumbnail: () => "",
        getViewportHeightScale: () => 1,
        getViewportWidthScale: () => 1,
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
        parentAccess: false,
        parentPIN: "1234",
        playTime: 0,
        playType: 0,
        popupList() {
            calls.push(["popup"]);
        },
        prevArr: [],
        primaryIndex: 0,
        providerGetItem: (key) => stored[key] ?? null,
        providerSetItem: (key, value) => (stored[key] = value),
        refreshAudioBadge() {},
        renderButtonHint: (key, icon, text) => text,
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
            // This synchronous adapter fixture represents an already started backend.
            c.__ottClassicPlayback.command({ type: "playing" });
        },
        stbSetItem: (key, value) => (stored[key] = value),
        stbSetPosTime(value) {
            calls.push(["seek", value]);
        },
        stbStop() {
            calls.push(["stop"]);
        },
        stored,
        timers,
        video: null,
    };
    c.window = c;
    const context = vm.createContext(c);
    const initialPreferences = Object.fromEntries(
        Object.entries(c).filter(
            ([key]) => /^s[A-Z]/.test(key) || key === "parentPIN"
        )
    );
    c.storage = {
        del: (key) => delete stored[key],
        get: (key) => stored[key] ?? null,
        set: (key, value) => (stored[key] = String(value)),
        setI: (key, value) => (stored[key] = String(value)),
    };
    vm.runInContext(settingsSource(), context);
    Object.assign(c, initialPreferences);
    c.OttPlayCore = require("./helpers/shared-core-runtime.cjs")(context);
    vm.runInContext(
        sourceFunctions("src/utils/helpers.ts", [
            "metadataText",
            "metadataImageUrl",
            "metadataCssUrl",
            "metadataHtml",
            "hasTmdbService",
        ]) +
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
            sourceFunctions("src/core/index.ts", ["updateCoreVideoInfo"]) +
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
    c.__ottRenderMedia = c.showMediaList1;
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
    c.catalogs = catalogs;
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
    c.documentState = () =>
        JSON.parse(
            stored["mediaJournal.v1:" + c.__ottMedia.sourceId()] || "null"
        );
    return c;
}

module.exports = { fixture, sourceFunctions };

if (require.main === module) {
    // Root, folder, owned Back, local favorites/history, inline submenu.
    {
        const c = fixture();
        c.mediaList(null);
        assert.equal(c.listArray[1].title, "Folder");
        assert(c.listArray.some((item) => item.__ottMediaRoute === "history"));
        c.selectMedia(1);
        assert.equal(c.listArray[0].title, "Nested movie");
        c.mediaKeyHandler(c.keys.GREEN);
        assert.equal(
            c.documentState().favorites[0].payload.stream_url,
            "nested.mp4"
        );
        const fetched = c.calls.filter((call) => call[0] === "fetch").length;
        c.mediaKeyHandler(c.keys.RETURN);
        assert.equal(c.selIndex, 1);
        assert.equal(
            c.calls.filter((call) => call[0] === "fetch").length,
            fetched,
            "Back restores owned parent without another request"
        );
        c.selectMedia(
            c.listArray.findIndex(
                (item) => item.__ottMediaRoute === "favorites"
            )
        );
        assert.equal(c.listArray[0].title, "Nested movie");
        c.mediaKeyHandler(c.keys.GREEN);
        assert.equal(c.listArray.length, 0);
        assert.equal(c.documentState().favorites.length, 0);
        c.mediaKeyHandler(c.keys.RETURN);
        c.selIndex = 3;
        c.selectMedia();
        assert.equal(c.listArray[0].title, "Submovie");
        c.mediaKeyHandler(c.keys.RETURN);
        assert.equal(c.selIndex, 3);
    }
    // Search and PIN are captured intents; replacing navigation revokes old approvals.
    {
        const c = fixture();
        c.catalogs[""] = [
            { adult: 1, id: 9, stream_url: "locked.mp4", title: "Locked" },
            {
                playlist_url: "search.xml?sort=name",
                search_on: 1,
                title: "Search",
            },
        ];
        c.mediaList(null);
        c.selectMedia(1);
        c.editvar = "a & b";
        c.setEdit();
        assert(
            c.calls.some(
                (call) =>
                    call[0] === "fetch" &&
                    call[1] === "search.xml?sort=name&search=a%20%26%20b"
            )
        );
        c.mediaKeyHandler(c.keys.RETURN);
        c.selectMedia(0);
        assert.equal(typeof c.unlock, "function");
        const obsolete = c.unlock;
        c.mediaList("catalog.xml");
        c.parentAccess = true;
        obsolete();
        assert(!c.calls.some((call) => call[0] === "play"));
        c.mediaKeyHandler(c.keys.RETURN);
        c.selectMedia(0);
        assert(
            c.calls.some(
                (call) => call[0] === "play" && call[1] === "locked.mp4"
            )
        );
        assert.equal(
            c.getMediaDescr({ description: () => "Lazy description" }),
            "Lazy description"
        );
    }
    // Late providers may mutate their globals, but cannot replace an accepted parent/view.
    {
        const c = fixture(),
            pending = [];
        c.getMediaArray = (route, done) => pending.push({ done, route });
        const complete = (index, title, records) => {
            c.mediaName = title;
            c.mediaRecords = records;
            pending[index].done();
        };
        c.mediaList(null);
        complete(0, "Root", [{ playlist_url: "folder", title: "Folder" }]);
        c.selectMedia(0);
        c.mediaKeyHandler(c.keys.RETURN);
        const renders = c.calls.filter((call) => call[0] === "render").length;
        complete(1, "Late child", [{ stream_url: "stale", title: "Stale" }]);
        assert.equal(c.listArray[0].title, "Folder");
        assert.equal(c.mediaName, "Root");
        assert.equal(
            c.calls.filter((call) => call[0] === "render").length,
            renders
        );
        c.selectMedia(0);
        c.cancelMediaLoad();
        complete(2, "Closed", [{ stream_url: "closed", title: "Closed" }]);
        assert.equal(c.listArray[0].title, "Folder");
        c.getMediaArray = (_route, done) => {
            c.mediaRecords = [
                { id: 2, stream_url: "new", title: "New provider" },
            ];
            done();
        };
        c.mediaList(null);
        complete(2, "Old provider", [{ stream_url: "old", title: "Old" }]);
        assert.equal(c.listArray[0].title, "New provider");
    }
    // Search from a disposed source must not query a replacement provider.
    {
        const c = fixture();
        c.mediaList(null);
        c.selectMedia(2);
        let fetched = false;
        c.getMediaArray = () => {
            fetched = true;
        };
        c.editvar = "movie";
        c.setEdit();
        assert.equal(fetched, false);
    }
    // Actual _playMedia consumer uses owned identity and stored positions, never mutable history[0].
    {
        const c = fixture();
        const first = { id: 1, stream_url: "first.mp4", title: "First" };
        c._playMedia(first);
        c.setCurrent(0, -1);
        assert.equal(c.documentState().history[0].position, 125.9);
        c._playMedia({ id: 2, stream_url: "second.mp4", title: "Second" });
        c._playMedia({ ...first, stream_url: "renewed.mp4" });
        assert.equal(typeof c.confirm, "function");
        const oldConfirm = c.confirm;
        c.confirm();
        assert.deepEqual(c.calls.at(-1), ["seek", 120]);
        c.medHistory.unshift({
            current: 999,
            stream_url: "injected.mp4",
            title: "Injected",
        });
        assert.equal(
            c.__ottClassicPlayback.snapshot().target.channelId,
            "provider:1"
        );
        c._playMedia({ id: 3, stream_url: "other.mp4", title: "Other" });
        oldConfirm();
        assert.equal(c.calls.filter((call) => call[0] === "seek").length, 1);
        c.sMedCount = 0;
        c._playMedia({
            id: 4,
            stream_url: "fourth.mp4",
            title: "Disabled history",
        });
        assert.equal(c.documentState().history.length, 0);
        c.updateMediaInfo();
        assert.equal(c.elements["#begin_time"].textContent, "2");
        assert.equal(c.elements["#end_time"].textContent, "+8");
        c.initBackgroundIntervals();
        c.elements["#begin_time"].textContent = "";
        c.timers.at(-2)();
        assert.equal(c.elements["#begin_time"].textContent, "2");
        assert.equal(first.stream_url, "first.mp4");
    }
    // Legacy history imports once and resume uses provider item identity across URL rotation.
    {
        const c = fixture();
        c.stored.medHistory = JSON.stringify([
            { current: 125, id: 7, stream_url: "expired.mp4", title: "Film" },
        ]);
        c._playMedia({ id: 7, stream_url: () => "fresh.mp4", title: "Film" });
        c.confirm();
        assert.deepEqual(c.calls.at(-1), ["seek", 120]);
        assert.equal(c.documentState().history.length, 1);
        assert.equal(
            c.documentState().history[0].payload.stream_url,
            "fresh.mp4"
        );
        assert.equal(
            JSON.parse(c.stored.medHistory)[0].stream_url,
            "expired.mp4",
            "Importer never rewrites old storage"
        );
    }
    // Selector input remains compatible with mouse row codes and remote extremes.
    {
        const c = fixture(),
            selected = [];
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
        "PASS active VOD navigation, favorites, search/PIN, stale callbacks, identity/resume, progress and input"
    );
}
