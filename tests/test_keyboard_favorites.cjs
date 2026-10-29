const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript");
const { fixture, sourceFunctions } = require("./test_port_vod.cjs");
function keyboard(c) {
    c.ott_device = "pc";
    c.keys.FAVORITES = 70;
    c.keys.FF = 34;
    c.keys.RW = 33;
    c.channelsKeyHandler = function () {};
    c.providerGetPersistedItem = c.providerGetItem;
    let capture;
    c.document.addEventListener = (_name, fn) => (capture = fn);
    vm.runInContext(
        sourceFunctions("src/key-handler/index.ts", [
            "toggleKeyboardFavorite",
            "tryKeyboardFavorites",
            "tryKeyboardRandom",
            "tryKeyboardSeek",
            "installKeyboardSeek",
        ]),
        c
    );
    c.installKeyboardSeek();
    return (extra = {}) => {
        let prevented = false;
        const e = {
            code: "KeyF",
            key: "f",
            keyCode: 70,
            preventDefault() {
                prevented = true;
                this.defaultPrevented = true;
            },
            stopImmediatePropagation() {},
            stopPropagation() {},
            target: { tagName: "VIDEO" },
            which: 70,
            ...extra,
        };
        capture(e);
        return { e, prevented };
    };
}
function television(provider = "m3u") {
    const c = fixture();
    c.p_pref = provider;
    c.__ottActiveProviderDriver = { id: provider };
    c.channels = {
        101: { channel_name: "One", itemId: "channel:stable-one" },
        202: { channel_name: "Two", itemId: "channel:stable-two" },
    };
    c.curList = [101, 202];
    c.primaryIndex = 0;
    vm.runInContext(
        ts
            .transpileModule(
                fs.readFileSync("src/channels/favorites-lists.ts", "utf8"),
                {
                    compilerOptions: {
                        module: ts.ModuleKind.ES2015,
                        target: ts.ScriptTarget.ES5,
                    },
                }
            )
            .outputText.replace(/^export /gm, ""),
        c
    );
    vm.runInContext(
        sourceFunctions("src/channels/index.ts", [
            "addToFavorites",
            "removeFromFavorites",
            "saveChannelsCats",
        ]),
        c
    );
    c.providerGetJson = (key, fallback) => {
        const raw = c.providerGetItem(key);
        return raw ? JSON.parse(raw) : fallback;
    };
    c.loadFavoritesLists();
    c.__ottChannels.refresh = () => {};
    c.__ottClassicPlayback.snapshot = () => ({
        phase: "playing",
        target: {
            channelId: "101",
            kind: "live",
            sourceId: c.__ottSourceIdentity.current(c),
        },
    });
    return c;
}
for (const provider of ["m3u", "offline"]) {
    const c = television(provider),
        press = keyboard(c);
    press();
    assert.deepEqual(Array.from(c.favoritesArray), [101]);
    assert(
        c.stored[
            "favoritesLibrary:" + c.__ottSourceIdentity.current(c)
        ].includes("channel:stable-one")
    );
    c.curList.reverse();
    press();
    assert.equal(
        c.favoritesArray.length,
        0,
        "playing identity survives reorder"
    );
    assert.deepEqual(
        c.calls.filter((call) => call[0] === "shift").map((call) => call[1]),
        ["Favorites: + One", "Favorites: − One"],
        provider + " emits exactly one named success per TV toggle"
    );
}
for (const provider of ["m3u", "offline", "plex", "vportal"]) {
    const c = fixture();
    c.p_pref = provider;
    c.__ottActiveProviderDriver = { id: provider };
    c.providerMediaClient = {
        cancel() {},
        resolve(item, done) {
            done({
                ...item,
                stream_url: "https://access.invalid/video?token=secret",
            });
        },
    };
    c.mediaList(-1);
    const source = c.__ottMedia.sourceId(),
        payload = {
            __ottMediaRef: { itemId: "provider:item-42", sourceId: source },
            id: "item-42",
            request: {
                path:
                    provider === "offline"
                        ? "authorized/root/movie.mkv"
                        : "/library/metadata/42",
            },
            title: "Same title",
        };
    c.listArray = [payload];
    c.selIndex = 0;
    c.isListVisible = true;
    c.__ottClassicScreenPort.reconcile();
    const press = keyboard(c);
    payload.__ottMediaRef.sourceId = "foreign-source";
    press();
    assert.equal(
        c.documentState().favorites.length,
        0,
        "foreign media source refused"
    );
    payload.__ottMediaRef.sourceId = source;
    const needs = c.__ottParental.needs;
    payload.adult = 1;
    c.__ottParental.needs = (section) => section === "channels";
    press();
    assert.equal(
        c.documentState().favorites.length,
        0,
        "media PIN restriction refused"
    );
    payload.adult = 0;
    c.__ottParental.needs = needs;
    press();
    let doc = c.documentState();
    assert.equal(doc.favorites.length, 1, provider + " focused add");
    assert.equal(doc.favorites[0].itemId, "provider:item-42");
    const history = JSON.stringify(doc.history);
    press();
    assert.equal(
        c.documentState().favorites.length,
        0,
        provider + " focused remove"
    );
    assert.equal(JSON.stringify(c.documentState().history), history);
    c.isListVisible = false;
    c.playMedia({
        ...payload,
        __ottNativeFile: { transient: true },
        stream_url: "https://access.invalid/video?token=secret",
    });
    assert(c.__ottMedia.current(), provider + " playing");
    press();
    doc = c.documentState();
    assert.equal(doc.favorites.length, 1, provider + " fullscreen add");
    assert.equal(JSON.stringify(doc.favorites).includes("token=secret"), false);
    press();
    assert.equal(
        c.documentState().favorites.length,
        0,
        provider + " fullscreen remove"
    );
    assert.deepEqual(
        c.calls.filter((call) => call[0] === "shift").map((call) => call[1]),
        [
            "Favorites: + Same title",
            "Favorites: − Same title",
            "Favorites: + Same title",
            "Favorites: − Same title",
        ],
        provider +
            " focused/fullscreen media feedback is named and never doubled"
    );
    const captured = c.__ottMedia.captureFavorite();
    assert(
        captured,
        provider + " non-toggle capture still returns the reference"
    );
    assert.equal(c.documentState().favorites.length, 1);
    assert.equal(
        c.calls.filter((call) => call[0] === "shift").length,
        4,
        provider + " internal non-toggle capture stays silent"
    );
}
{
    const c = television(),
        press = keyboard(c);
    for (const extra of [
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { shiftKey: true },
        { repeat: true },
        { isComposing: true },
        { target: { tagName: "INPUT" } },
        {
            target: {
                parentElement: { isContentEditable: true },
                tagName: "SPAN",
            },
        },
    ]) {
        press(extra);
        assert.equal(c.favoritesArray.length, 0);
    }
    for (const state of ["strict", "locked", "enabled"]) {
        c.__ottKiosk = { [state]: () => true };
        press();
        assert.equal(c.favoritesArray.length, 0);
    }
    delete c.__ottKiosk;
    c.sFavorites = -1;
    press();
    assert.equal(c.favoritesArray.length, 0);
    c.sFavorites = 0;
    c.hasParentalLock = () => true;
    c.__ottParental.needs = () => true;
    press();
    assert.equal(c.favoritesArray.length, 0);
}

{
    const c = television(),
        press = keyboard(c);
    c.listKeyHandlerFn = c.channelsKeyHandler;
    c.listArray = ["202", "101"];
    c.selIndex = 0;
    c.isListVisible = true;
    c.__ottClassicScreenPort.reconcile();
    press();
    assert.deepEqual(
        Array.from(c.favoritesArray),
        [202],
        "focused channel wins over playing channel"
    );
    c.listArray.reverse();
    c.selIndex = 1;
    c.__ottClassicScreenPort.reconcile();
    press();
    assert.equal(
        c.favoritesArray.length,
        0,
        "focused stable identity survives reorder"
    );
    c.isListVisible = false;
    for (const kind of ["dialog", "editor", "pin"]) {
        const owner = c.__ottClassicScreenPort.screens.open({
            handle() {},
            kind,
            model: {},
        });
        press();
        assert.equal(c.favoritesArray.length, 0, kind + " is modal");
        owner.close();
    }
    c.document.activeElement = { tagName: "TEXTAREA" };
    assert.equal(press().prevented, false);
    assert.equal(c.favoritesArray.length, 0);
    c.document.activeElement = null;
    for (const modifier of ["ctrlKey", "metaKey"])
        assert.equal(
            press({ [modifier]: true }).prevented,
            false,
            "browser Find remains native"
        );
    const oldDriver = c.__ottActiveProviderDriver;
    c.hasParentalLock = () => {
        c.__ottActiveProviderDriver = { id: "replacement" };
        return false;
    };
    press();
    assert.equal(
        c.favoritesArray.length,
        0,
        "synchronous owner replacement fences write"
    );
    c.__ottActiveProviderDriver = oldDriver;
    c.hasParentalLock = () => false;
    const seek = [];
    c.shiftArchive = (delta) => seek.push(delta);
    press({
        altKey: true,
        code: "ArrowLeft",
        key: "ArrowLeft",
        keyCode: 37,
        which: 37,
    });
    press({
        code: "ArrowRight",
        ctrlKey: true,
        key: "ArrowRight",
        keyCode: 39,
        which: 39,
    });
    assert.deepEqual(seek, [-10, 10], "existing Alt/Ctrl seek remains routed");
    assert.equal(
        c.tryKeyboardFavorites({ code: "KeyR", key: "r", keyCode: 82 }),
        false,
        "R belongs to existing random handler"
    );
    const played = [];
    c.curList = [101, 202];
    c.primaryIndex = 0;
    c.cats = { All: c.curList };
    c.catsArray = ["All"];
    c.catIndex = 0;
    c.playChannel = (category, index) => played.push(c.cats.All[index]);
    press({ code: "KeyR", key: "r", keyCode: 82, which: 82 });
    assert.deepEqual(
        played,
        [202],
        "actual capture still invokes existing R random action"
    );
    assert.equal(c.favoritesArray.length, 0);
}

// TV import boundaries must never round or normalize one identity into another.
for (const id of [
    "001",
    "9007199254740993",
    "9007199254740992",
    9007199254740992,
    "+101",
    "101.0",
    "1e2",
    "-0",
]) {
    const c = television(),
        press = keyboard(c);
    c.channels[String(id)] = {
        channel_name: "Exact raw",
        itemId: "channel:exact-raw",
    };
    c.channels[Number(id)] = {
        channel_name: "Wrong identity",
        itemId: "channel:rounded-or-normalized",
    };
    c.__ottClassicPlayback.snapshot = () => ({
        phase: "playing",
        target: {
            channelId: id,
            kind: "live",
            sourceId: c.__ottSourceIdentity.current(c),
        },
    });
    press();
    assert.equal(
        c.favoritesArray.length,
        0,
        "invalid TV identity never favorites a collision: " + id
    );
    assert.equal(c.__ottToggleKeyboardFavorite(), false);
}
{
    const c = television(),
        press = keyboard(c);
    vm.runInContext(
        sourceFunctions("src/channels/index.ts", ["hasParentalLock"]),
        c
    );
    c.parentalArray = [101];
    let locked = true;
    c.__ottParental.needs = (section) => section === "channels" && locked;
    assert.equal(c.hasParentalLock(101), true);
    assert.equal(
        c.hasParentalLock("101"),
        false,
        "actual numeric membership boundary is exercised"
    );
    press();
    assert.equal(
        c.favoritesArray.length,
        0,
        "string playback target normalizes BEFORE real numeric PIN lookup"
    );
    locked = false;
    press();
    assert.deepEqual(Array.from(c.favoritesArray), [101]);
    locked = true;
    press();
    assert.deepEqual(
        Array.from(c.favoritesArray),
        [101],
        "locked removal is blocked too"
    );
    locked = false;
    press();
    assert.equal(c.favoritesArray.length, 0);
}
// Opaque provider keys are resolved exactly, before ordinary-TV numeric handling.
{
    const c = fixture();
    c.p_pref = "plex";
    c.__ottActiveProviderDriver = { id: "plex" };
    c.mediaList(-1);
    const source = c.__ottMedia.sourceId(),
        press = keyboard(c);
    c.channels = {};
    for (const id of ["001", "9007199254740993"])
        c.channels[id] = {
            __ottMediaItem: {
                __ottMediaRef: { itemId: "provider:" + id, sourceId: source },
                request: { path: "/library/metadata/42" },
                title: "Exact opaque",
            },
        };
    c.channels[1] = {
        __ottMediaItem: {
            __ottMediaRef: { itemId: "provider:wrong", sourceId: source },
            request: { path: "/library/metadata/99" },
            title: "Wrong",
        },
    };
    c.listKeyHandlerFn = c.channelsKeyHandler;
    c.isListVisible = true;
    for (const id of ["001", "9007199254740993"]) {
        c.listArray = [id];
        c.selIndex = 0;
        c.__ottClassicScreenPort.reconcile();
        press();
        assert.equal(
            c
                .documentState()
                .favorites.some((row) => row.itemId === "provider:" + id),
            true
        );
    }
    assert.equal(
        c
            .documentState()
            .favorites.some((row) => row.itemId === "provider:wrong"),
        false
    );
}
for (const mode of [
    "refuse",
    "throw",
    "write-then-throw",
    "write-then-owner-switch",
]) {
    const c = television(),
        write = c.providerSetItem;
    let enabled = false;
    c.providerSetItem = (key, value) => {
        if (!enabled || !key.startsWith("favoritesLibrary:"))
            return write(key, value);
        if (mode === "refuse") return;
        if (mode === "throw") throw Error("synthetic storage failure");
        write(key, value);
        if (mode === "write-then-throw")
            throw Error("synthetic lost acknowledgement");
        c.p_pref = "replacement-profile";
    };
    c.loadFavoritesLists();
    assert.equal(
        c.saveChannelsCats(),
        true,
        "actual save helper reports verified initial persistence"
    );
    const key = "favoritesLibrary:" + c.__ottSourceIdentity.current(c),
        before = c.stored[key];
    keyboard(c);
    enabled = true;
    assert.equal(
        c.__ottToggleKeyboardFavorite(),
        false,
        "actual failed/uncertain save cannot be success: " + mode
    );
    if (mode === "refuse" || mode === "throw")
        assert.equal(c.stored[key], before);
    else
        assert.notEqual(
            c.stored[key],
            before,
            "never undo bytes after an uncertain write or owner switch"
        );
    assert.deepEqual(
        Array.from(c.favoritesArray),
        [101],
        "no blind RAM rollback after potentially uncertain writes"
    );
    assert.equal(
        c.calls.filter((call) => call[0] === "shift").length,
        0,
        "failed or uncertain TV persistence never shows success: " + mode
    );
}
// Removing in the favorites view still acknowledges the persisted item,
// before its row is removed from the active selection.
{
    const c = fixture();
    c.mediaList(null);
    c.selectMedia(1);
    c.mediaKeyHandler(c.keys.GREEN);
    c.mediaKeyHandler(c.keys.RETURN);
    c.selectMedia(
        c.listArray.findIndex((item) => item.__ottMediaRoute === "favorites")
    );
    c.mediaKeyHandler(c.keys.GREEN);
    assert.equal(c.documentState().favorites.length, 0);
    assert.deepEqual(
        c.calls.filter((call) => call[0] === "shift").map((call) => call[1]),
        ["Favorites: + Nested movie", "Favorites: − Nested movie"]
    );
}
// Feedback uses the current display name and the existing localized label.
{
    const c = television(),
        press = keyboard(c);
    c._ = (text) => (text === "Favorites" ? "Избранное" : text);
    press();
    c.channels[101].channel_name = "Renamed channel";
    press();
    assert.deepEqual(
        c.calls.filter((call) => call[0] === "shift").map((call) => call[1]),
        ["Избранное: + One", "Избранное: − Renamed channel"]
    );
}
// showShift accepts safe HTML: inserted names must be escaped exactly once.
{
    const title = "<b>A & B</b> &amp;",
        escaped = "&lt;b&gt;A &amp; B&lt;/b&gt; &amp;amp;";
    const c = television(),
        press = keyboard(c);
    c.channels[101].channel_name = title;
    press();
    press();
    assert.deepEqual(
        c.calls.filter((call) => call[0] === "shift").map((call) => call[1]),
        ["Favorites: + " + escaped, "Favorites: − " + escaped],
        "TV name is literal text, including literal entity syntax"
    );
    const media = fixture();
    media.mediaList(-1);
    const item = {
        __ottMediaRef: {
            itemId: "provider:literal-title",
            sourceId: media.__ottMedia.sourceId(),
        },
        request: { path: "/library/metadata/42" },
        title,
    };
    media.__ottMedia.toggleFavorite(item);
    media.__ottMedia.toggleFavorite(item);
    assert.deepEqual(
        media.calls
            .filter((call) => call[0] === "shift")
            .map((call) => call[1]),
        ["Favorites: + " + escaped, "Favorites: − " + escaped],
        "media name is escaped once before the shared HTML notification renderer"
    );
}
// A source replaced after a successful write cannot receive the old toast.
{
    const c = television(),
        save = c.saveChannelsCats;
    keyboard(c);
    c.saveChannelsCats = () => {
        const saved = save();
        c.__ottActiveProviderDriver = { id: "new-owner" };
        return saved;
    };
    assert.equal(c.__ottToggleKeyboardFavorite(), false);
    assert.equal(c.calls.filter((call) => call[0] === "shift").length, 0);
}
// The media journal must confirm persistence before any success indication.
for (const failure of ["refuse", "throw", "write-then-throw"]) {
    const c = fixture();
    let enabled = false;
    const write = c.providerSetItem;
    c.providerSetItem = (key, value) => {
        if (!enabled || !key.startsWith("mediaJournal.v1:"))
            return write(key, value);
        if (failure === "refuse") return;
        if (failure === "write-then-throw") write(key, value);
        throw Error("synthetic media persistence failure");
    };
    c.mediaList(-1);
    const item = {
        __ottMediaRef: {
            itemId: "provider:failure",
            sourceId: c.__ottMedia.sourceId(),
        },
        request: { path: "/library/metadata/42" },
        title: "Failed item",
    };
    enabled = true;
    assert.equal(c.__ottMedia.toggleFavorite(item), undefined);
    assert.equal(
        c.calls.filter((call) => call[0] === "shift").length,
        0,
        failure
    );
}
for (const device of ["pc", "pc2"])
    for (const file of [
        "src/devices/" + device + "/device.ts",
        "devices/" + device + "/device.js",
    ])
        for (const [name, value] of [
            ["FAVORITES", 70],
            ["FF", 34],
            ["RW", 33],
            ["RANDOM", 82],
        ])
            assert(
                new RegExp(name + ": " + value + "[,\\n]").test(
                    fs.readFileSync(file, "utf8")
                )
            );
console.log(
    "PASS desktop key capture/router, stable TV favorites and focused/fullscreen media journal toggles, shortcut guards and shipped map parity"
);
