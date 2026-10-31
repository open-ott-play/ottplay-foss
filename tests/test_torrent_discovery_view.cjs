const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");

function setup(initial = {}) {
    const f = fixture(initial),
        h = f.host;
    const dom = new JSDOM("<div id='detail'></div>");
    let cleanup,
        listActive = true;
    const requests = [],
        details = [];
    Object.assign(h, {
        __ottChannels: { index: () => 0 },
        __ottMediaCompanion: {
            available: () => true,
            ensure() {
                throw new Error("Discovery must not start a service");
            },
            providerAvailable: () => true,
        },
        __ottTorrentCatalogLanguage: () =>
            h.settings.torrentCatalogLanguage || "en",
        channelsList: () => {
            f.manualOpened = true;
        },
        closeList() {
            f.closed = true;
            listActive = false;
            cleanup?.();
            cleanup = undefined;
        },
        document: dom.window.document,
        listDetail: dom.window.document.getElementById("detail"),
        listFooter: {},
        openGlobalFavorites: () => {
            f.favoritesOpened = true;
        },
        renderButtonHint: () => "",
        settings: { torrentCatalogEndpoint: "", torrentCatalogLanguage: "" },
        showProgramInfo: (title) => {
            f.information = title;
        },
        showShift: (text) => {
            f.message = text;
        },
        URL,
    });
    const names = [
        "ENTER",
        "RETURN",
        "EXIT",
        "BLUE",
        "PLAY",
        "PAUSE",
        "LEFT",
        "YELLOW",
        "TOOLS",
        "N0",
        "NEXT",
        "FF",
        "INFO",
        "N2",
        "RED",
        "EPG",
        "GREEN",
        "N3",
        "PIP",
        "STOP",
        "RANDOM",
        "FAVORITES",
        "N1",
        "N4",
        "N5",
        "N6",
        "N7",
        "N8",
        "N9",
    ];
    h.keys = Object.fromEntries(names.map((name, i) => [name, 100 + i]));
    f.foreground = true;
    const owner = {
        active: () => listActive,
        foreground: () => listActive && f.foreground,
    };
    h.__ottClassicScreenPort = {
        acceptsEditorSave: () => true,
        listOwner: () => owner,
        onDispose: (callback) => {
            cleanup = callback;
        },
        owner: () => ({}),
    };
    function replace(view, rows) {
        cleanup?.();
        cleanup = undefined;
        listActive = true;
        f.view = view;
        h.listArray = rows;
        h.selIndex = view.selected || 0;
        h.listKeyHandlerFn = view.key;
        view.detail?.();
    }
    h.__ottChannelListView = {
        detail: (value) => {
            f.detail = value;
        },
        show: (view) => replace(view, view.rows),
    };
    h.__ottCategoryListView = { show: (view) => replace(view, view.labels) };
    function request(kind, args, done) {
        const value = { args, done, kind };
        requests.push(value);
        return () => {
            value.cancelled = true;
        };
    }
    h.__ottTorrentDiscoveryData = {
        create(options) {
            f.options = options;
            return {
                cancel() {
                    requests.forEach((value) => {
                        value.cancelled = true;
                    });
                },
                categories: (done) => request("categories", [], done),
                details: (id, done) => {
                    details.push(id);
                    return request("details", [id], done);
                },
                dispose() {
                    f.disposed = true;
                },
                load: (id, cursor, done) => request("load", [id, cursor], done),
                search: (query, cursor, done) =>
                    request("search", [query, cursor], done),
            };
        },
    };
    f.driver = f.mount("torrent");
    f.driver.load((catalog, error) => {
        f.catalog = catalog;
        f.error = error;
    });
    f.open = () =>
        h.__ottTorrentDriver.reportLoad(h, f.driver, "torrent-empty");
    f.key = (name) => f.view.key(h.keys[name]);
    f.select = (index) => {
        h.selIndex = index;
        f.key("ENTER");
    };
    f.requests = requests;
    f.details = details;
    return f;
}
function movie(
    id,
    description = "Full movie overview. Its second sentence is kept."
) {
    return {
        description,
        id: "tmdb:movie:" + id,
        language: "en",
        poster: "https://image.tmdb.org/t/p/w500/sample.jpg",
        title: "Movie " + id,
        year: "2025",
    };
}
const page = (items, next = null) => ({ items, next, ok: true });

test("empty Torrent configuration shows a standard metadata catalog without playback or persistence", () => {
    const f = setup();
    assert.equal(f.open(), false);
    assert.deepEqual(f.requests[0].args, ["popular", null]);
    assert.equal(
        f.host.listDetail.querySelectorAll(".ott-spinner .blob").length,
        4
    );
    f.requests[0].done(page([movie(1)]));
    assert.deepEqual(Array.from(f.view.rows), ["tmdb:movie:1"]);
    const row = f.view.channel("tmdb:movie:1");
    assert.equal(row.__ottMediaItem.stream_url, undefined);
    assert.equal(row.__ottMediaItem.request, undefined);
    assert.equal(row.logo, movie(1).poster);
    assert.match(row.__ottMediaItem.description, /second sentence/);
    assert.equal(f.details.length, 0);
    for (const key of ["FAVORITES", "RANDOM", "PIP", "STOP"])
        assert.equal(f.key(key), true);
    assert.equal(f.requests.length, 1);
    f.key("ENTER");
    f.requests.at(-1).done({ item: movie(1, "Complete detail"), ok: true });
    assert.equal(f.information, "Movie 1");
    assert.match(f.detail.__ottMediaItem.description, /Complete detail/);
    assert.equal(f.saved.size, 0);
});

test("categories and search cancel stale pages, paginate only on demand, and retain retry cursors", () => {
    const f = setup();
    f.open();
    const initial = f.requests[0];
    f.key("BLUE");
    assert.deepEqual(Array.from(f.view.labels), [
        "Popular",
        "New releases",
        "Genre",
        "My sources",
        "Favorites",
    ]);
    f.select(1);
    initial.done(page([movie(99)]));
    assert.equal(f.view.rows.length, 0);
    f.requests.at(-1).done(page([movie(1)], 2));
    assert.equal(f.requests.length, 2);
    f.key("NEXT");
    assert.deepEqual(f.requests.at(-1).args, ["new", 2]);
    f.requests.at(-1).done({ error: "timeout", ok: false });
    f.key("NEXT");
    assert.deepEqual(f.requests.at(-1).args, ["new", 2]);
    f.requests.at(-1).done(page([movie(1), movie(2)], 3));
    assert.deepEqual(Array.from(f.view.rows), ["tmdb:movie:1", "tmdb:movie:2"]);
    f.key("NEXT");
    const pending = f.requests.at(-1);
    f.key("YELLOW");
    pending.done(page([movie(3)]));
    assert.equal(f.view.rows.length, 2);
    f.host.editvar = "Планета";
    f.host.setEdit();
    assert.deepEqual(f.requests.at(-1).args, ["Планета", null]);
    f.host.settings.torrentCatalogLanguage = "ru";
    assert.equal(f.options.language(), "ru");
    f.key("RETURN");
    f.requests.at(-1).done(page([movie(4)]));
    assert.equal(f.view.rows.length, 0);
    assert.equal(f.saved.size, 0);
});

test("manual lists coexist unchanged with genres and the global Favorites route", () => {
    const config = {
        entries: [
            {
                category: "Sample",
                files: [{ index: 0, length: 20, name: "Sample.mp4" }],
                id: "one",
                source: "magnet:?xt=urn:btih:" + "a".repeat(40),
                title: "Sample",
            },
        ],
        id: "manual",
        name: "Torrent",
        schema: 1,
    };
    const raw = JSON.stringify(config),
        f = setup({ torrentcfg: raw });
    assert.equal(f.catalog.ids.length, 1);
    f.driver.catalogBrowser.categories();
    f.select(3);
    assert.equal(f.manualOpened, true);
    f.driver.catalogBrowser.categories();
    f.select(4);
    assert.equal(f.favoritesOpened, true);
    f.driver.catalogBrowser.categories();
    f.select(2);
    assert.equal(f.requests.at(-1).kind, "categories");
    f.requests.at(-1).done({
        categories: [
            { id: "popular", title: "" },
            { id: "genre:28", title: "Action" },
        ],
        ok: true,
    });
    assert.deepEqual(Array.from(f.view.labels), ["Action"]);
    f.select(0);
    assert.deepEqual(f.requests.at(-1).args, ["genre:28", null]);
    const pending = f.requests.at(-1);
    f.lifetime.activate("other");
    pending.done(page([movie(8)]));
    assert.equal(f.disposed, true);
    assert.equal(f.view.rows.length, 0);
    assert.equal(f.saved.get("torrentcfg"), raw);
});

test("failed initial page is retryable and Return cancels late completion", () => {
    const f = setup();
    f.open();
    f.requests[0].done({ error: "unavailable", ok: false });
    assert.equal(f.host.listDetail.textContent, "Failed to load!");
    f.key("ENTER");
    assert.equal(f.requests.length, 2);
    f.key("RETURN");
    f.requests[1].done(page([movie(1)]));
    assert.equal(f.view.rows.length, 0);
    assert.equal(f.saved.size, 0);
});

test("language and endpoint changes restart page one without mixing or reopening hidden views", () => {
    const f = setup();
    f.open();
    const original = f.requests[0];
    f.host.settings.torrentCatalogLanguage = "ru";
    f.options.onContextChanged();
    assert.equal(f.requests.length, 2);
    original.done(page([movie(90)]));
    assert.equal(f.view.rows.length, 0);
    f.requests[1].done(page([movie(1)], 2));
    f.host.settings.torrentCatalogEndpoint = "https://catalog.example";
    f.key("NEXT");
    assert.deepEqual(f.requests.at(-1).args, ["popular", null]);
    assert.equal(f.view.rows.length, 0);
    f.requests.at(-1).done(page([movie(2)], 2));
    f.foreground = false;
    f.host.settings.torrentCatalogLanguage = "en";
    assert.equal(f.driver.catalogBrowser.settingsChanged(), false);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(Array.from(f.view.rows), ["tmdb:movie:2"]);
    f.foreground = true;
    f.key("ENTER");
    assert.equal(f.requests.length, 4);
    assert.equal(f.requests.at(-1).kind, "load");
    assert.deepEqual(f.requests.at(-1).args, ["popular", null]);
    assert.equal(f.details.length, 0);
});

test("category controls recover after settings change behind an overlay", () => {
    for (const key of ["ENTER", "RETURN", "EXIT"]) {
        const f = setup();
        f.driver.catalogBrowser.categories();
        const originalView = f.view;
        f.foreground = false;
        f.host.settings.torrentCatalogLanguage = "ru";
        assert.equal(f.driver.catalogBrowser.settingsChanged(), false);
        assert.equal(f.view, originalView);
        f.foreground = true;
        f.key(key);
        if (key === "ENTER") {
            assert.notEqual(f.view, originalView);
            f.key("ENTER");
            assert.deepEqual(f.requests.at(-1).args, ["popular", null]);
        } else assert.equal(f.closed, true);
    }
});

test("page, information and genre responses wait for the overlay to close", () => {
    const f = setup();
    f.open();
    const initialView = f.view;
    f.foreground = false;
    f.requests[0].done(page([movie(1)]));
    assert.equal(f.view, initialView);
    assert.equal(f.view.rows.length, 0);
    f.foreground = true;
    f.view.detail();
    assert.deepEqual(Array.from(f.view.rows), ["tmdb:movie:1"]);
    f.key("ENTER");
    const informationView = f.view;
    f.foreground = false;
    f.requests.at(-1).done({ item: movie(1, "Full detail"), ok: true });
    assert.equal(f.view, informationView);
    assert.equal(f.information, undefined);
    f.foreground = true;
    f.view.detail();
    assert.equal(f.information, "Movie 1");
    f.driver.catalogBrowser.categories();
    f.select(2);
    const categoryView = f.view;
    f.foreground = false;
    f.requests
        .at(-1)
        .done({ categories: [{ id: "genre:28", title: "Action" }], ok: true });
    assert.equal(f.view, categoryView);
    f.foreground = true;
    f.view.detail();
    assert.deepEqual(Array.from(f.view.labels), ["Action"]);
});

test("staged overlay responses cannot survive configuration changes or closing the parent", () => {
    const f = setup();
    f.open();
    f.foreground = false;
    f.requests[0].done(page([movie(1)]));
    f.host.settings.torrentCatalogLanguage = "ru";
    f.foreground = true;
    f.view.detail();
    assert.equal(f.requests.length, 2);
    assert.equal(f.view.rows.length, 0);
    f.foreground = false;
    f.requests[1].done(page([movie(2)]));
    f.host.closeList();
    const closedView = f.view;
    f.foreground = true;
    f.view.detail();
    assert.equal(f.view, closedView);
    assert.equal(f.view.rows.length, 0);
});
