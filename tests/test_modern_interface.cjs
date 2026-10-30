const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const { settingsSource } = require("./helpers/settings-source-fixture.cjs");
const { compatibilitySource } = require("./helpers/english-source-fixture.cjs");

const root = path.resolve(__dirname, "..");
function compile(file) {
    return ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
}
function settingsFixture(stored = new Map()) {
    const dom = new JSDOM("<main></main>", {
        runScripts: "outside-only",
        url: "https://example.invalid/",
    });
    const w = dom.window;
    const effects = [];
    let provider = "one";
    require("./helpers/shared-core-runtime.cjs")(dom.getInternalVMContext());
    Object.assign(w, require("./load-wire.cjs")());
    w.eval(compatibilitySource);
    const storage = {
        del: (key) => stored.delete(key),
        get: (key) => stored.get(key) ?? null,
        getI: (key, fallback) => {
            const value = Number.parseInt(stored.get(key), 10);
            return Number.isNaN(value) ? fallback : value;
        },
        set: (key, value) => stored.set(key, String(value)),
        setI: (key, value) => stored.set(key, String(value)),
    };
    Object.assign(w, {
        _: (value) => value,
        ott_device: "pc",
        p_pref: provider,
        providerDelItem: (key) => storage.del(provider + ":" + key),
        providerGetItem: (key) => storage.get(provider + ":" + key),
        providerSetItem: (key, value) =>
            storage.set(provider + ":" + key, value),
        setInterfaceMode: () => effects.push("interface"),
        setPlayerMode: () => effects.push("player"),
        storage,
    });
    w.eval(settingsSource());
    w.loadSettings();
    return {
        dom,
        effects,
        provider(value) {
            provider = value;
            w.p_pref = value;
            w.loadProviderSettings(0);
        },
        stored,
        w,
    };
}

test("interface mode is opt-in and separate from the existing theme", () => {
    const f = settingsFixture();
    try {
        assert.equal(f.w.settings.interfaceMode, 0);
        assert.equal(f.w.settings.interfaceTheme, 2);
        assert.equal(f.stored.has("sInterfaceMode"), false);
        assert.equal(f.w.saveSettings({ interfaceMode: 1 }), true);
        assert.equal(f.w.settings.interfaceMode, 1);
        assert.equal(f.w.settings.interfaceTheme, 2);
        assert.deepEqual(f.effects, ["interface"]);
    } finally {
        f.dom.window.close();
    }
});

test("mode persists for this client across providers and a fresh session", () => {
    const stored = new Map();
    const f = settingsFixture(stored);
    try {
        assert.equal(f.w.saveSettings({ interfaceMode: 1 }), true);
        assert.equal(stored.get("sInterfaceMode"), "1");
        stored.set("two:sInterfaceMode", "0");
        f.provider("two");
        assert.equal(f.w.settings.interfaceMode, 1);
        assert.equal(f.w.sInterfaceMode, 1);
        assert.deepEqual(f.effects, ["interface"]);
    } finally {
        f.dom.window.close();
    }
    const next = settingsFixture(stored);
    try {
        assert.equal(next.w.settings.interfaceMode, 1);
        assert.equal(next.w.saveSettings({ interfaceMode: 0 }), true);
        next.provider("one");
        assert.equal(next.w.settings.interfaceMode, 0);
        assert.equal(stored.get("sInterfaceMode"), "0");
    } finally {
        next.dom.window.close();
    }
});

test("invalid modes cannot overwrite a valid setting or run effects", () => {
    const f = settingsFixture();
    try {
        assert.equal(f.w.saveSettings({ interfaceMode: 1 }), true);
        for (const value of [-1, 2, 0.5, NaN, null, "modern", {}, []]) {
            const effectsBefore = f.effects.length;
            assert.equal(f.w.saveSettings({ interfaceMode: value }), false);
            assert.equal(f.w.settings.interfaceMode, 1);
            assert.equal(f.stored.get("sInterfaceMode"), "1");
            assert.equal(f.effects.length, effectsBefore);
        }
    } finally {
        f.dom.window.close();
    }
});

function loaderFixture() {
    const dom = new JSDOM("<main></main>", {
        runScripts: "outside-only",
        url: "https://example.invalid/player/",
    });
    const w = dom.window;
    const timers = new Map();
    const notices = [];
    let sequence = 0;
    Object.assign(w, {
        __cv: "fixture version",
        clearTimeout: (id) => timers.delete(id),
        hostUrl: "https://example.invalid/player/",
        loadChannels: () => assert.fail("view mode must not reload the source"),
        setTimeout: (callback) => {
            const id = ++sequence;
            timers.set(id, callback);
            return id;
        },
        showPopup: (message) => notices.push(message),
        sInterfaceMode: 0,
        stopPlayer: () => assert.fail("view mode must not stop playback"),
    });
    w.eval(compile("src/ui/interface-mode.ts"));
    return {
        dom,
        notices,
        ready(refresh = () => {}) {
            w.__ottModernUi = { prepare() {}, refresh };
            const script = this.script();
            assert(script, "a module request must exist before completion");
            script.onload();
        },
        script: () => w.document.querySelector("script"),
        timers,
        w,
    };
}

test("Classic makes no optional request; concurrent Modern loads are coalesced", () => {
    const f = loaderFixture();
    try {
        assert.equal(f.script(), null);
        const results = [];
        f.w.__ottEnsureModernUi((value) => results.push(["first", value]));
        f.w.__ottEnsureModernUi((value) => results.push(["second", value]));
        assert.equal(f.w.document.querySelectorAll("script").length, 1);
        assert.equal(
            f.script().src,
            "https://example.invalid/player/dist/modern-interface.js?fixture%20version"
        );
        f.ready();
        assert.deepEqual(results, [
            ["first", true],
            ["second", true],
        ]);
        assert.equal(f.timers.size, 0);
        assert.equal(f.script(), null);
    } finally {
        f.dom.window.close();
    }
});

test("late optional load cannot undo a user's return to Classic", () => {
    const f = loaderFixture();
    let paints = 0;
    try {
        f.w.sInterfaceMode = 1;
        f.w.setInterfaceMode();
        assert.equal(f.w.__ottInterfaceModeState.status, "loading");
        f.w.sInterfaceMode = 0;
        f.w.setInterfaceMode();
        f.ready(() => paints++);
        assert.equal(f.w.__ottInterfaceModeState.status, "classic");
        assert.equal(f.w.__ottInterfaceModeState.effective, 0);
        assert.equal(
            f.w.document.body.classList.contains("interface-modern"),
            false
        );
        assert.equal(paints, 0);
    } finally {
        f.dom.window.close();
    }
});

for (const failure of [
    "error",
    "timeout",
    "incomplete-module",
    "unsupported",
]) {
    test(`${failure} keeps Classic usable and prevents retry storms`, () => {
        const f = loaderFixture();
        try {
            f.w.sInterfaceMode = 1;
            f.w.setInterfaceMode();
            if (failure === "timeout") [...f.timers.values()][0]();
            else if (failure === "error") f.script().onerror();
            else {
                if (failure === "unsupported")
                    f.w.__ottModernUi = {
                        prepare() {},
                        refresh() {
                            assert.fail("unsupported renderer cannot repaint");
                        },
                        supported: () => false,
                    };
                f.script().onload();
            }
            assert.equal(f.w.__ottInterfaceModeState.status, "fallback");
            assert.equal(f.w.__ottInterfaceModeState.effective, 0);
            assert.equal(
                f.w.document.body.classList.contains("interface-modern"),
                false
            );
            assert.equal(f.script(), null);
            assert.equal(f.timers.size, 0);
            f.w.setInterfaceMode();
            assert.equal(
                f.script(),
                null,
                "failure must not create a request loop"
            );
            f.w.sInterfaceMode = 0;
            f.w.setInterfaceMode();
            f.w.sInterfaceMode = 1;
            f.w.setInterfaceMode();
            assert(
                f.script(),
                "explicit Classic→Modern choice permits a retry"
            );
        } finally {
            f.dom.window.close();
        }
    });
}

test("successful mode changes only repaint and keep one renderer instance", () => {
    const f = loaderFixture();
    const paints = [];
    try {
        f.w.sInterfaceMode = 1;
        f.w.setInterfaceMode();
        f.ready(() => paints.push(f.w.__ottInterfaceModeState.effective));
        const renderer = f.w.__ottModernUi;
        assert.equal(f.w.__ottInterfaceModeState.status, "modern");
        assert.equal(
            f.w.document.body.classList.contains("interface-modern"),
            true
        );
        f.w.sInterfaceMode = 0;
        f.w.setInterfaceMode();
        f.w.sInterfaceMode = 1;
        f.w.setInterfaceMode();
        assert.deepEqual(paints, [1, 0, 1]);
        assert.equal(f.w.__ottModernUi, renderer);
        assert.equal(f.script(), null);
        assert.deepEqual(f.notices, []);
    } finally {
        f.dom.window.close();
    }
});

function rendererFixture() {
    const dom = new JSDOM(
        '<div id="listIn"></div><div id="listDetail"></div>',
        {
            runScripts: "outside-only",
            url: "https://example.invalid/",
        }
    );
    const w = dom.window;
    const container = w.document.getElementById("listIn");
    Object.defineProperties(container, {
        clientHeight: { value: 570 },
        clientWidth: { value: 760 },
    });
    Object.assign(w, {
        changeSelect(delta) {
            w.selIndex += delta;
        },
        changeVolume: () =>
            assert.fail("grid navigation must not adjust volume"),
        innerHeight: 720,
        innerWidth: 1280,
        isListVisible: true,
        loadChannels: () => assert.fail("renderer must not reload a source"),
        playChannel: () =>
            assert.fail("navigation must not activate a channel"),
        selIndex: 3450,
        settings: { interfaceMode: 1 },
        sUiFontScale: 100,
    });
    w.eval(compile("src/ui/modern.ts"));
    const ids = Array.from({ length: 10000 }, (_, index) => "item-" + index);
    let reads = 0;
    const formatter = () => "Classic row";
    formatter.__ottCatalog = {
        playing: (id) => id === ids[3450],
        row(id) {
            reads++;
            return {
                __ottMediaItem: {
                    __ottMediaCollection: "Library",
                    description: "Shared source metadata",
                    poster: "https://example.invalid/poster.jpg",
                },
                channel_name: "Film " + id,
            };
        },
    };
    return {
        api: w.__ottModernUi,
        container,
        dom,
        formatter,
        ids,
        reads: () => reads,
        w,
    };
}

test("10k catalogue renders a bounded window without cloning or traversing it", () => {
    const f = rendererFixture();
    try {
        const original = f.ids.slice();
        const layout = f.api.prepare(f.ids, f.formatter, f.container);
        assert.equal(layout.grid, true);
        assert(layout.pageSize > 0 && layout.pageSize <= 30);
        assert(f.reads() <= 2, "layout must not read all source metadata");
        const start = 3450;
        for (let index = start; index < start + layout.pageSize; index++) {
            const item = f.w.document.createElement("div");
            item.className = "item";
            item.id = "it" + index;
            item.dataset.idx = index;
            item.innerHTML = f.api.render(f.ids[index], index);
            f.container.appendChild(item);
        }
        f.api.decorate(f.container, start, start + layout.pageSize);
        assert.equal(
            f.container.querySelectorAll(".modern-card").length,
            layout.pageSize
        );
        assert(f.reads() <= layout.pageSize * 3 + 2);
        assert.equal(f.w.document.querySelectorAll(".ott-playing").length, 1);
        assert.equal(
            f.w.document.querySelector(".modern-title").textContent,
            "Film item-3450"
        );
        assert.deepEqual(
            f.ids,
            original,
            "view must not reorder the shared catalogue"
        );
        assert.equal(f.w.selIndex, 3450);
    } finally {
        f.dom.window.close();
    }
});

test("grid owns directional input only for its current foreground catalogue", () => {
    const f = rendererFixture();
    try {
        const layout = f.api.prepare(f.ids, f.formatter, f.container);
        let foreground = true;
        const owner = {
            foreground: () => foreground,
            model: { render: f.formatter },
        };
        assert.equal(f.api.navigation({ id: "right" }, owner), true);
        assert.equal(f.w.selIndex, 3451);
        assert.equal(f.api.navigation({ id: "down" }, owner), true);
        assert.equal(f.w.selIndex, 3451 + layout.columns);
        const selected = f.w.selIndex;
        f.w.isListVisible = false;
        assert.equal(f.api.navigation({ id: "left" }, owner), false);
        f.w.isListVisible = true;
        foreground = false;
        assert.equal(f.api.navigation({ id: "left" }, owner), false);
        foreground = true;
        owner.model.render = () => "Other screen";
        assert.equal(f.api.navigation({ id: "left" }, owner), false);
        owner.model.render = f.formatter;
        f.w.settings.interfaceMode = 0;
        assert.equal(f.api.navigation({ id: "left" }, owner), false);
        assert.equal(f.w.selIndex, selected);
    } finally {
        f.dom.window.close();
    }
});

test("Classic and non-catalogue screens remove Modern layout without changing selection", () => {
    const f = rendererFixture();
    try {
        f.api.prepare(f.ids, f.formatter, f.container);
        assert(f.container.classList.contains("modern-grid"));
        assert.equal(
            f.api.prepare(f.ids, () => "Settings row", f.container),
            null
        );
        assert.equal(f.container.classList.contains("modern-catalog"), false);
        assert.equal(f.container.style.gridTemplateColumns, "");
        assert.equal(f.api.prepare(f.ids, f.formatter, null), null);
        f.w.settings.interfaceMode = 0;
        assert.equal(f.api.prepare(f.ids, f.formatter, f.container), null);
        assert.equal(f.api.render(f.ids[0], 0), null);
        assert.equal(f.w.selIndex, 3450);
    } finally {
        f.dom.window.close();
    }
});

test("a failed Modern render can use Classic while retaining the user's saved preference", () => {
    const f = rendererFixture();
    try {
        f.w.__ottInterfaceModeState = { effective: 1 };
        assert(f.api.prepare(f.ids, f.formatter, f.container));
        f.w.__ottInterfaceModeState.effective = 0;
        assert.equal(f.api.prepare(f.ids, f.formatter, f.container), null);
        assert.equal(f.api.render(f.ids[0], 0), null);
        assert.equal(f.container.classList.contains("modern-catalog"), false);
        assert.equal(f.w.settings.interfaceMode, 1);
    } finally {
        f.dom.window.close();
    }
});

test("metadata remains text and rejected artwork leaves a usable fallback", () => {
    const f = rendererFixture();
    try {
        f.w.selIndex = 0;
        f.formatter.__ottCatalog.row = () => ({
            __ottMediaItem: { poster: "javascript:alert(1)" },
            channel_name:
                'Movie <img src=x onerror="window.changed=1"> & title',
        });
        assert(f.api.prepare(["id"], f.formatter, f.container));
        f.container.innerHTML = f.api.render("id", 0);
        assert.equal(f.container.querySelectorAll("img,script").length, 0);
        assert.equal(
            f.container.querySelector(".modern-title").textContent,
            'Movie <img src=x onerror="window.changed=1"> & title'
        );
        assert.equal(
            f.container.querySelector(".modern-art-fallback").textContent,
            "M"
        );
        assert.equal(f.w.changed, undefined);
    } finally {
        f.dom.window.close();
    }
});

test("mixed Favorites keep one list shape while focus moves between films and live channels", () => {
    const f = rendererFixture();
    try {
        f.formatter.__ottCatalog.kind = "mixed";
        f.formatter.__ottCatalog.row = (id) => ({
            __ottMediaItem: id === "live" ? null : { name: id },
            channel_name: id,
        });
        const rows = ["film", "live", "film-two"];
        for (let selected = 0; selected < rows.length; selected++) {
            f.w.selIndex = selected;
            const layout = f.api.prepare(rows, f.formatter, f.container);
            assert.equal(layout.grid, false);
            assert.equal(f.container.classList.contains("modern-live"), true);
            assert.equal(f.container.classList.contains("modern-grid"), false);
        }
    } finally {
        f.dom.window.close();
    }
});

test("live artwork comes from the same provider projection as the Classic list", () => {
    const f = rendererFixture();
    try {
        const requested = [];
        f.w.selIndex = 0;
        f.formatter.__ottCatalog.row = (id) => ({ channel_name: id });
        f.formatter.__ottCatalog.picon = (id) => {
            requested.push(id);
            return "https://example.invalid/provider-logo.png";
        };
        const layout = f.api.prepare(["station"], f.formatter, f.container);
        assert.equal(layout.grid, false);
        f.container.innerHTML = f.api.render("station", 0);
        assert.equal(
            f.container.querySelector("img").src,
            "https://example.invalid/provider-logo.png"
        );
        assert(requested.length > 0);
        assert.equal(
            requested.every((id) => id === "station"),
            true
        );
    } finally {
        f.dom.window.close();
    }
});
