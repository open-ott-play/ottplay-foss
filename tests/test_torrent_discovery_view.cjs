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
        details = [],
        streamRequests = [],
        streamOptions = [],
        playCalls = [];
    const timers = new Map();
    let timerId = 0;
    f.nextPage = () => {
        const callbacks = Array.from(timers.values());
        timers.clear();
        callbacks.forEach((callback) => callback());
    };
    f.timers = timers;
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
        clearTimeout: (id) => timers.delete(id),
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
        setTimeout(callback) {
            timers.set(++timerId, callback);
            return timerId;
        },
        settings: {
            torrentCatalogEndpoint: "",
            torrentCatalogLanguage: "",
            torrentStreamAddons: "[]",
        },
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
    h.__ottTorrentStreamData = {
        create(options) {
            streamOptions.push(options);
            const own = [];
            return {
                cancel() {
                    own.forEach((request) => {
                        request.cancelled = true;
                    });
                },
                dispose() {
                    own.forEach((request) => {
                        request.cancelled = true;
                    });
                },
                lookup(movie, done) {
                    const request = { done, movie };
                    streamRequests.push(request);
                    own.push(request);
                    return () => {
                        request.cancelled = true;
                    };
                },
            };
        },
    };
    h.__ottMedia = {
        playItem(payload, guard, dispatched, failed) {
            const call = {
                cancelled: false,
                dispatched,
                failed,
                guard,
                payload,
            };
            playCalls.push(call);
            return () => {
                call.cancelled = true;
                f.driver.mediaClient().cancel();
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
    f.streamRequests = streamRequests;
    f.streamOptions = streamOptions;
    f.playCalls = playCalls;
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

test("first page stays usable while later pages load automatically and retain live selection", () => {
    const f = setup();
    f.open();
    f.requests[0].done(page([movie(1), movie(2)], 2));
    const firstView = f.view;
    const firstRow = firstView.channel("tmdb:movie:1");
    assert.equal(firstView.rows.length, 2);
    assert.equal(f.requests.length, 1);
    assert.equal(f.timers.size, 1);
    f.nextPage();
    assert.deepEqual(f.requests[1].args, ["popular", 2]);
    assert.equal(
        f.view,
        firstView,
        "starting a background request must not redraw the list"
    );
    f.host.selIndex = 1;
    f.nextPage();
    assert.equal(f.requests.length, 2, "only one page may be in flight");
    f.requests[1].done(page([movie(2), movie(3)], 3));
    assert.equal(f.view.selected, 1);
    assert.deepEqual(Array.from(f.view.rows), [
        "tmdb:movie:1",
        "tmdb:movie:2",
        "tmdb:movie:3",
    ]);
    assert.equal(
        f.view.channel("tmdb:movie:1"),
        firstRow,
        "existing rows are reused"
    );
    f.nextPage();
    f.requests[2].done(page([]));
    assert.equal(f.timers.size, 0);
    assert.equal(f.view.more, false);
    assert.equal(f.playCalls.length, 0);
});

test("background loading admits twenty thousand movies without a 500-item cutoff", () => {
    const f = setup();
    f.open();
    for (let offset = 0; offset < 20000; offset += 100) {
        f.requests.at(-1).done(
            page(
                Array.from({ length: 100 }, (_, i) => movie(offset + i + 1)),
                offset < 19900 ? offset + 100 : null
            )
        );
        assert.equal(f.view.rows.length, offset + 100);
        if (offset === 0) f.host.selIndex = 73;
        else assert.equal(f.view.selected, 73);
        f.nextPage();
    }
    assert.equal(f.requests.length, 200);
    assert.equal(f.view.rows.at(-1), "tmdb:movie:20000");
    assert.equal(f.timers.size, 0);
    assert.equal(f.saved.size, 0);
});

test("repeated pages and non-advancing cursors stop automatic requests", () => {
    for (const result of [page([movie(1)], 3), page([movie(2)], 2)]) {
        const f = setup();
        f.open();
        f.requests[0].done(page([movie(1)], 2));
        f.nextPage();
        f.requests[1].done(result);
        f.nextPage();
        assert.equal(f.requests.length, 2);
        assert.equal(f.view.more, false);
    }
});

test("page failures retain visible movies and pause automatic retries", () => {
    const f = setup();
    f.open();
    f.requests[0].done(page([movie(1)], 2));
    f.nextPage();
    f.requests[1].done({ error: "timeout", ok: false });
    f.nextPage();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(Array.from(f.view.rows), ["tmdb:movie:1"]);
    assert.equal(f.view.more, true);
    f.key("NEXT");
    assert.deepEqual(f.requests[2].args, ["popular", 2]);
    f.requests[2].done(page([movie(2)], 3));
    f.nextPage();
    assert.deepEqual(f.requests[3].args, ["popular", 3]);
});

test("automatic pages pause for overlays and information then cancel when closing or playing", () => {
    const f = setup();
    f.open();
    f.requests[0].done(page([movie(1)], 2));
    f.foreground = false;
    f.nextPage();
    assert.equal(f.requests.length, 1);
    assert.equal(f.timers.size, 1);
    f.foreground = true;
    f.key("INFO");
    assert.equal(f.timers.size, 0);
    f.nextPage();
    assert.equal(f.requests.at(-1).kind, "details");
    f.requests
        .at(-1)
        .done({ item: movie(1, "Complete description"), ok: true });
    assert.equal(f.timers.size, 1);
    f.key("ENTER");
    assert.equal(f.timers.size, 0);
    assert.equal(f.streamRequests.length, 1);
    f.nextPage();
    assert.equal(f.requests.length, 2);
    f.key("RETURN");
    assert.equal(f.timers.size, 1);
    const staleTimer = Array.from(f.timers.values())[0];
    f.host.closeList();
    assert.equal(f.timers.size, 0);
    staleTimer();
    assert.equal(f.requests.length, 2);
});

test("new categories and settings cannot receive scheduled pages from an old catalog", () => {
    const f = setup();
    f.open();
    f.requests[0].done(page([movie(1)], 2));
    const staleTimer = Array.from(f.timers.values())[0];
    f.driver.catalogBrowser.open("new", "New releases");
    staleTimer();
    assert.equal(f.requests.length, 2);
    f.requests[1].done(page([movie(2)], 2));
    const timer = Array.from(f.timers.keys())[0];
    staleTimer();
    assert.equal(
        f.timers.has(timer),
        true,
        "stale callbacks cannot consume a new timer"
    );
    f.host.settings.torrentCatalogLanguage = "ru";
    f.nextPage();
    assert.deepEqual(f.requests.at(-1).args, ["new", null]);
    assert.equal(f.view.rows.length, 0);
});

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
    f.key("INFO");
    f.requests.at(-1).done({ item: movie(1, "Complete detail"), ok: true });
    assert.equal(f.information, "Movie 1");
    assert.match(f.detail.__ottMediaItem.description, /Complete detail/);
    assert.equal(f.saved.size, 0);
});

test("categories and search cancel stale pages and retain manual retry cursors", () => {
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
    assert.equal(f.driver.catalogBrowser.restore(), false);
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
    f.key("INFO");
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

function stream(changes = {}) {
    return {
        addon: { id: "sample", name: "Sample addon" },
        description: "Direct media source",
        id: "stremio:" + "a".repeat(64),
        kind: "url",
        source: "https://media.example/movie.mp4?token=temporary",
        title: "1080p · English",
        ...changes,
    };
}
function openMovieSources(f, item = { ...movie(1), imdbId: "tt1234567" }) {
    f.open();
    f.requests[0].done(page([item]));
    f.key("ENTER");
}
function streamPage(items, extra = {}) {
    return { failedAddons: 0, items, ok: true, unsupportedCount: 0, ...extra };
}

test("Enter chooses sources while Info stays metadata-only, and only explicit source choice is admitted", () => {
    const f = setup();
    f.host.settings.torrentStreamAddons =
        '["https://addon.example/manifest.json"]';
    openMovieSources(f, movie(1));
    assert.equal(f.view.id, "torrent:sources");
    assert.equal(f.streamRequests.length, 0);
    assert.equal(f.requests.at(-1).kind, "details");
    f.requests
        .at(-1)
        .done({ item: { ...movie(1), imdbId: "tt1234567" }, ok: true });
    assert.equal(f.streamRequests[0].movie.imdbId, "tt1234567");
    f.streamRequests[0].done(streamPage([stream()]));
    assert.equal(f.playCalls.length, 0);
    assert.equal(
        f.view.channel(stream().id).__ottMediaItem.stream_url,
        undefined
    );
    assert.match(
        f.view.channel(stream().id).__ottMediaItem.description,
        /Sample addon/
    );
    f.key("INFO");
    assert.equal(f.information, "1080p · English");
    assert.equal(f.playCalls.length, 0);
    f.key("ENTER");
    assert.equal(f.playCalls.length, 1);
    const play = f.playCalls[0];
    assert.equal(play.guard(), true);
    assert.equal(play.payload.request.kind, "torrent-discovery");
    assert.equal(play.payload.request.sourceId, stream().id);
    assert.equal(JSON.stringify(play.payload).includes("temporary"), false);
    let resolved;
    f.driver.mediaClient().resolve(play.payload, (value) => {
        resolved = value;
    });
    assert.equal(resolved.stream_url, stream().source);
    const saved = f.driver.mediaClient().persist(resolved);
    assert.equal(saved.stream_url, undefined);
    assert.equal(JSON.stringify(saved).includes("media.example"), false);
    assert.equal(saved.request.imdbId, "tt1234567");
    play.dispatched();
    assert.equal(f.closed, true);
    assert.equal(play.cancelled, false);
    assert.equal(play.guard(), true);
    f.lifetime.activate("other");
    assert.equal(play.guard(), false);
    assert.equal(f.saved.has("torrentcfg"), false);
});

test("source list has distinct unconfigured, empty, unsupported and failed states", () => {
    for (const [response, label] of [
        [{ error: "no_addons", ok: false }, "Not configured"],
        [streamPage([]), "Nothing to play"],
        [streamPage([], { unsupportedCount: 1 }), "Unsupported source"],
        [{ error: "unavailable", ok: false }, "Failed to load!"],
    ]) {
        const f = setup();
        openMovieSources(f);
        f.streamRequests[0].done(response);
        assert.equal(f.host.listDetail.textContent, label);
        assert.equal(f.playCalls.length, 0);
        f.key("RETURN");
        assert.equal(f.view.id, "torrent:discovery");
        assert.deepEqual(Array.from(f.view.rows), ["tmdb:movie:1"]);
    }
});

test("torrent selections use explicit index or largest through the owned companion URI", () => {
    for (const selection of [{ fileIndex: 4 }, { fileSelection: "largest" }]) {
        const f = setup();
        f.host.__TAURI__ = {};
        openMovieSources(f);
        const item = stream({
            ...selection,
            kind: "torrent",
            source: "magnet:?xt=urn:btih:" + "b".repeat(40),
        });
        f.streamRequests[0].done(streamPage([item]));
        f.key("ENTER");
        let result;
        f.driver.mediaClient().resolve(f.playCalls[0].payload, (value) => {
            result = value;
        });
        const url = new URL(result.stream_url);
        assert.equal(url.protocol, "ottplay-torrent:");
        assert.equal(url.searchParams.get("source"), item.source);
        assert.equal(url.searchParams.get("native"), "1");
        assert.equal(
            url.searchParams.get("selection"),
            selection.fileSelection || null
        );
        assert.equal(
            url.searchParams.get("index"),
            selection.fileIndex === undefined ? null : "4"
        );
    }
});

test("source replies stage behind overlays and Back, policy or addon changes revoke launch", () => {
    const f = setup();
    openMovieSources(f);
    const pending = f.streamRequests[0],
        view = f.view;
    f.foreground = false;
    pending.done(streamPage([stream()]));
    assert.equal(f.view, view);
    f.foreground = true;
    f.view.detail();
    assert.equal(f.view.rows[0], stream().id);
    f.key("ENTER");
    const play = f.playCalls[0];
    f.key("RETURN");
    assert.equal(play.guard(), false);
    pending.done(streamPage([stream()]));
    assert.equal(f.view.id, "torrent:discovery");
    f.key("ENTER");
    const old = f.streamRequests.at(-1);
    f.host.settings.torrentStreamAddons =
        '["https://another.example/manifest.json"]';
    f.driver.catalogBrowser.sourcesChanged();
    old.done(streamPage([stream()]));
    assert.equal(f.view.rows.length, 0);
    f.streamRequests.at(-1).done(streamPage([stream()]));
    f.host.__ottKiosk = { enabled: () => true };
    f.key("ENTER");
    assert.equal(f.playCalls.length, 1);
});

test("resuming a source resolves its exact stable reference and never substitutes another source", () => {
    const f = setup();
    const payload = {
        request: {
            imdbId: "tt1234567",
            kind: "torrent-discovery",
            movieId: "tmdb:movie:1",
            sourceId: stream().id,
        },
        title: "Movie 1",
    };
    let result = "waiting";
    f.driver.mediaClient().resolve(payload, (value) => {
        result = value;
    });
    f.streamRequests
        .at(-1)
        .done(streamPage([stream({ id: "stremio:" + "b".repeat(64) })]));
    assert.equal(result, null);
    f.driver.mediaClient().resolve(payload, (value) => {
        result = value;
    });
    f.streamRequests.at(-1).done(streamPage([stream()]));
    assert.equal(result.stream_url, stream().source);
    result = "waiting";
    f.driver.mediaClient().resolve(payload, (value) => {
        result = value;
    });
    const pending = f.streamRequests.at(-1);
    f.driver.mediaClient().cancel();
    pending.done(streamPage([stream()]));
    assert.equal(result, "waiting");
});

test("generic catalogs use their manifest names, category IDs and supported search", () => {
    const f = setup();
    f.host.settings.torrentCatalogEndpoint = "https://catalog.example";
    f.open();
    f.requests[0].done({
        ...page([movie(1)]),
        catalog: {
            id: "catalog:films",
            searchSupported: false,
            title: "Sample films",
        },
        mode: "stremio",
    });
    assert.equal(f.view.categoryName, "Sample films");
    assert.equal(f.view.search, false);
    f.key("BLUE");
    assert.equal(f.requests.at(-1).kind, "categories");
    assert.equal(
        f.host.listDetail.querySelectorAll(".ott-spinner .blob").length,
        4
    );
    f.requests.at(-1).done({
        categories: [
            {
                id: "catalog:films",
                searchSupported: false,
                title: "Sample films",
            },
            {
                id: "catalog:recent",
                searchSupported: true,
                title: "Recently added",
            },
        ],
        mode: "stremio",
        ok: true,
    });
    assert.deepEqual(Array.from(f.view.labels), [
        "Sample films",
        "Recently added",
        "My sources",
        "Favorites",
    ]);
    f.select(1);
    assert.deepEqual(f.requests.at(-1).args, ["catalog:recent", null]);
    assert.equal(f.view.search, true);
});

test("IMDb and custom catalog identities survive source admission and persistence", () => {
    for (const id of [
        "imdb:movie:tt1234567",
        "stremio:movie:sample%3Aitem%2F1",
    ]) {
        const f = setup();
        openMovieSources(f, { ...movie(1), id });
        assert.equal(f.requests.length, 1);
        assert.equal(f.streamRequests[0].movie.id, id);
        f.streamRequests[0].done(streamPage([stream()]));
        f.key("ENTER");
        assert.equal(f.playCalls.length, 1);
        const payload = f.driver.mediaClient().persist(f.playCalls[0].payload);
        assert.equal(payload.request.movieId, id);
        assert.equal(payload.request.sourceId, stream().id);
        assert.equal(payload.stream_url, undefined);
    }
});

test("resolved selection cache is single-use and Back aborts the underlying pending resolver", () => {
    const f = setup();
    openMovieSources(f);
    f.streamRequests[0].done(streamPage([stream()]));
    f.key("ENTER");
    const play = f.playCalls[0];
    let first;
    f.driver.mediaClient().resolve(play.payload, (value) => {
        first = value;
    });
    assert.equal(first.stream_url, stream().source);
    assert.equal(f.streamRequests.length, 1);
    let second = "pending";
    f.driver.mediaClient().resolve(play.payload, (value) => {
        second = value;
    });
    assert.equal(f.streamRequests.length, 2);
    const pending = f.streamRequests[1];
    f.key("RETURN");
    assert.equal(play.cancelled, true);
    assert.equal(pending.cancelled, true);
    pending.done(streamPage([stream()]));
    assert.equal(second, "pending");
});

test("cancelled or rejected admission discards unconsumed source selections", () => {
    for (const cancellation of ["client", "back", "rejected", "guard"]) {
        const f = setup();
        openMovieSources(f);
        f.streamRequests[0].done(streamPage([stream()]));
        f.key("ENTER");
        const play = f.playCalls[0];
        if (cancellation === "client") f.driver.mediaClient().cancel();
        else if (cancellation === "back") f.key("RETURN");
        else if (cancellation === "rejected") play.failed();
        else {
            const obsolete = () => {};
            obsolete.isCurrent = () => false;
            f.driver.mediaClient().resolve(play.payload, obsolete);
        }
        let result = "pending";
        f.driver.mediaClient().resolve(play.payload, (value) => {
            result = value;
        });
        assert.equal(f.streamRequests.length, 2, cancellation);
        assert.equal(result, "pending", cancellation);
        f.streamRequests[1].done(
            streamPage([
                stream({ source: "https://media.example/refreshed.mp4" }),
            ])
        );
        assert.equal(
            result.stream_url,
            "https://media.example/refreshed.mp4",
            cancellation
        );
    }
});

test("new source admission retains its own immediate selection after cancelling the old attempt", () => {
    const f = setup();
    openMovieSources(f);
    const next = stream({
        id: "stremio:" + "b".repeat(64),
        source: "https://media.example/next.mp4",
    });
    f.streamRequests[0].done(streamPage([stream(), next]));
    f.key("ENTER");
    const old = f.playCalls[0];
    f.select(1);
    const current = f.playCalls[1];
    assert.equal(old.cancelled, true);
    old.failed();
    let result;
    f.driver.mediaClient().resolve(current.payload, (value) => {
        result = value;
    });
    assert.equal(f.streamRequests.length, 1);
    assert.equal(result.stream_url, next.source);
});

function installNavigationFunctions(host) {
    const fs = require("node:fs");
    const path = require("node:path");
    const ts = require("typescript");
    const vm = require("node:vm");
    for (const [file, names] of [
        ["src/key-handler/index.ts", ["handleMainKey"]],
        ["src/ui/index.ts", ["popMedia", "mediaList"]],
        ["src/provider/index.ts", ["_channelsList"]],
    ]) {
        const source = ts.createSourceFile(
            file,
            fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
            ts.ScriptTarget.Latest,
            true
        );
        const code = source.statements
            .filter(
                (node) =>
                    ts.isFunctionDeclaration(node) &&
                    names.includes(node.name?.text)
            )
            .map((node) => node.getText(source).replace(/^export /, ""))
            .join("\n");
        vm.runInContext(
            ts.transpileModule(code, {
                compilerOptions: {
                    module: ts.ModuleKind.None,
                    target: ts.ScriptTarget.ES5,
                },
            }).outputText,
            host
        );
    }
    host.globalNumber = null;
    host.toggleMainPlayback = () => {
        throw Error("Torrent Enter must return to browsing");
    };
    host.__ottClassicScreenPort.normalize = (code) => ({
        code,
        id: { 1: "accept", 2: "back", 3: "channels" }[code],
    });
    host.__ottChannels.group = () => undefined;
    host.__ottChannels.restoreBrowsing = () => {
        throw Error("Empty manual catalog must not receive navigation");
    };
    host.__ottMedia.open = () => {
        throw Error("Legacy media list must not replace movie discovery");
    };
    host.__ottMedia.useSource = () => {};
    host.$i1 = { is: () => false };
    host.infoBox = () => {
        throw Error("No Category #0 error should appear");
    };
}

test("full-screen keys and menu return restore the movie list after selected playback without scanning or restarting", () => {
    for (const route of [
        "accept",
        "back",
        "channels",
        "menu",
        "media",
        "empty-category",
    ]) {
        const f = setup();
        f.open();
        f.requests[0].done(
            page([
                { ...movie(1), imdbId: "tt1234567" },
                { ...movie(2), imdbId: "tt1234568" },
            ])
        );
        f.select(1);
        f.streamRequests[0].done(streamPage([stream()]));
        f.key("ENTER");
        f.playCalls[0].dispatched();
        assert.equal(f.closed, true);
        const requestCount = f.requests.length;
        installNavigationFunctions(f.host);
        f.host.playType = -1e11;
        f.host.forcePlay = false;
        f.host.listArray = ["closed-settings-editor"];
        f.host.listKeyHandlerFn = () => false;
        if (route === "menu") f.host.popMedia();
        else if (route === "media") f.host.mediaList(null);
        else if (route === "empty-category") f.host._channelsList(0, 0);
        else
            f.host.handleMainKey({ accept: 1, back: 2, channels: 3 }[route], {
                preventDefault() {},
                stopPropagation() {},
            });
        assert.equal(f.view.id, "torrent:discovery", route);
        assert.equal(f.host.listArray[f.host.selIndex], "tmdb:movie:2", route);
        assert.equal(f.requests.length, requestCount, route);
        assert.equal(f.streamRequests.length, 1, route);
        assert.equal(f.playCalls.length, 1, route);
    }
});

test("catalog restore retains browse position after list close and refreshes changed settings", () => {
    const f = setup();
    f.open();
    f.requests[0].done(page([movie(1), movie(2)]));
    f.host.selIndex = 1;
    f.key("RETURN");
    assert.equal(f.driver.catalogBrowser.restore(), true);
    assert.equal(f.host.listArray[f.host.selIndex], "tmdb:movie:2");
    assert.equal(f.requests.length, 1);
    f.key("RETURN");
    f.host.settings.torrentCatalogLanguage = "ru";
    assert.equal(f.driver.catalogBrowser.restore(), true);
    assert.equal(f.requests.length, 2);
    assert.equal(f.view.rows.length, 0);
    f.requests[1].done(page([movie(3)]));
    assert.deepEqual(Array.from(f.view.rows), ["tmdb:movie:3"]);
    f.host.__ottKiosk = { enabled: () => true };
    assert.equal(f.driver.catalogBrowser.restore(), false);
    f.host.__ottKiosk = undefined;
    f.host.__ottMedia.sourceId = () => "offline:separate-library";
    assert.equal(f.driver.catalogBrowser.restore(), false);
});
