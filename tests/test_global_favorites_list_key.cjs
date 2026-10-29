"use strict";
const realCaselessKey =
    require("./helpers/global-favorites-main-ports.cjs").actualModule(
        "src/utils/caseless.ts",
        {}
    ).caselessKey;
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript");
const { load, fixture, row } = require("./global-favorites-fixture.cjs");
const root = path.resolve(__dirname, "..");
function extract(file, predicate) {
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    let found;
    function visit(n) {
        if (!found && predicate(n)) found = n;
        ts.forEachChild(n, visit);
    }
    visit(source);
    assert(found, file);
    return found.getText(source);
}
function fn(text, context) {
    vm.runInNewContext(
        ts.transpileModule("var actual=" + text.replace(/^export\s+/, ""), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        context
    );
    return context.actual;
}
function ui(w) {
    for (const file of [
        "screen-controller",
        "input-router",
        "classic-screen-port",
    ])
        vm.runInNewContext(
            ts.transpileModule(
                fs.readFileSync(
                    path.join(root, "src/ui/" + file + ".ts"),
                    "utf8"
                ),
                { compilerOptions: { target: ts.ScriptTarget.ES5 } }
            ).outputText,
            { window: w }
        );
}
const turn = () => new Promise((r) => setImmediate(r));
async function settle() {
    for (let i = 0; i < 8; i++) await turn();
}
async function setup(outcome) {
    const f = fixture();
    let initial = await f.store.snapshot();
    await f.store.mutate(initial.revision, {
        entries: [row("A <name> & B")],
        op: "put",
    });
    const w = {
        channels: new Proxy(
            {},
            {
                get() {
                    throw Error("Global UUID must never use provider channels");
                },
            }
        ),
        keys: { FAVORITES: 70 },
        ott_device: "pc",
        selIndex: 0,
        sFavorites: 0,
    };
    ui(w);
    const owner = w.__ottClassicScreenPort.screens.open({
        handle: () => {},
        kind: "list",
    });
    const banners = [],
        errors = [];
    let selectedScreen = true,
        removedCalls = 0,
        shown;
    const metadataText = fn(
        extract(
            "src/utils/helpers.ts",
            (n) =>
                ts.isFunctionDeclaration(n) && n.name?.text === "metadataText"
        ),
        {}
    );
    const removed = fn(
        extract(
            "src/commands/global-favorites.ts",
            (n) =>
                ts.isPropertyAssignment(n) &&
                n.name.getText() === "favoriteRemoved"
        ).replace(/^favoriteRemoved:\s*/, ""),
        {
            metadataText,
            remotePlayerInfo: () => ({ runtime: "runtime" }),
            runtime: "runtime",
            w: { _: (x) => x, showShift: (x) => banners.push(x) },
        }
    );
    const facade = load(
        "src/settings/global-favorites-facade.ts"
    ).createGlobalFavoritesFacade({
        caselessKey: realCaselessKey,
        codec: f.codec,
        current: () => true,
        qualify: () => f.committer.qualify(),
        store: f.store,
    });
    const hostRemove = fn(
        extract(
            "src/media/global-favorites-host.ts",
            (n) => ts.isPropertyAssignment(n) && n.name.getText() === "remove"
        ).replace(/^remove:\s*/, ""),
        {
            committer: f.committer,
            createFavoritesRecoveryCodec: load(
                "src/settings/favorites-recovery-codec.ts"
            ).createFavoritesRecoveryCodec,
            facade,
            grant: f.grant,
            ports: {
                sha256: async (x) =>
                    require("./global-favorites-fixture.cjs").hash(x),
            },
        }
    );
    const view = load(
        "src/media/global-favorites-view.ts"
    ).createGlobalFavoritesView({
        canFavorite: () => w.sFavorites !== -1 && !w.__ottStandby?.blocked(),
        captureScreen: () => () => true,
        current: () => true,
        describe: () => "",
        error: (e) => errors.push(e),
        navigation: { currentId: () => null, isPlaying: () => false },
        remove: async (id, admitted) => {
            removedCalls++;
            if (outcome) return { outcome };
            return hostRemove(id, admitted);
        },
        removed,
        router: {
            select: () => {
                throw Error("Remove must not play");
            },
        },
        selected: () => w.selIndex,
        show: (v) => {
            shown = v;
            return () => selectedScreen;
        },
        store: f.store,
        translate: (x) => x,
    });
    w.__ottGlobalFavorites = {
        favoriteSelected: (captured) =>
            captured === owner && view.favoriteSelected(),
    };
    w.__ottToggleKeyboardFavorite = () =>
        fn(
            extract(
                "src/key-handler/index.ts",
                (n) =>
                    ts.isFunctionDeclaration(n) &&
                    n.name?.text === "toggleKeyboardFavorite"
            ),
            {}
        )(w);
    const doc = { activeElement: null };
    const key = fn(
        extract(
            "src/key-handler/index.ts",
            (n) =>
                ts.isFunctionDeclaration(n) &&
                n.name?.text === "tryKeyboardFavorites"
        ),
        { document: doc, window: w }
    );
    await view.open();
    function press(extra = {}) {
        const event = {
            code: "KeyF",
            key: "f",
            keyCode: 70,
            preventDefault() {
                this.prevented = true;
            },
            stopImmediatePropagation() {},
            stopPropagation() {},
            target: null,
            ...extra,
        };
        return key(event);
    }
    return {
        banners,
        doc,
        errors,
        f,
        press,
        get removedCalls() {
            return removedCalls;
        },
        selectScreen: (value) => {
            selectedScreen = value;
        },
        get shown() {
            return shown;
        },
        view,
        w,
    };
}
function notificationBoundary() {
    const hostText = fs.readFileSync(
        path.join(root, "src/media/global-favorites-host.ts"),
        "utf8"
    );
    assert.doesNotMatch(hostText, /from ["']\.\.\/utils\/helpers["']/);
    assert.match(hostText, /removed: ports\.favoriteRemoved/);
    let active = "a";
    const banners = [],
        w = { _: (x) => x, showShift: (x) => banners.push(x) };
    const metadataText = fn(
        extract(
            "src/utils/helpers.ts",
            (n) =>
                ts.isFunctionDeclaration(n) && n.name?.text === "metadataText"
        ),
        {}
    );
    const notify = fn(
        extract(
            "src/commands/global-favorites.ts",
            (n) =>
                ts.isPropertyAssignment(n) &&
                n.name.getText() === "favoriteRemoved"
        ).replace(/^favoriteRemoved:\s*/, ""),
        {
            metadataText,
            remotePlayerInfo: () => ({ runtime: active }),
            runtime: "a",
            w,
        }
    );
    notify("<A> & B");
    assert.deepEqual(banners, ["Favorites: − &lt;A&gt; &amp; B"]);
    active = "b";
    notify("stale");
    assert.equal(banners.length, 1);
    console.log(
        "PASS MAIN-owned escaped notification port and stale-runtime suppression; no optional helper import"
    );
}
async function main() {
    notificationBoundary();
    const good = await setup();
    assert(good.press());
    assert(good.press({ repeat: true }));
    await settle();
    assert.equal((await good.f.store.snapshot()).entries.length, 0);
    assert.equal(good.removedCalls, 1);
    assert.equal(good.banners.length, 1);
    assert.match(good.banners[0], /Favorites: − A &lt;name&gt; &amp; B/);
    console.log(
        "PASS actual F capture -> input router -> screen global callback -> UUID store removal and one literal-name banner"
    );
    for (const outcome of ["not_applied", "unknown", "verified"]) {
        const failed = await setup(outcome);
        failed.press();
        await settle();
        assert.equal(failed.banners.length, 0);
        assert.equal((await failed.f.store.snapshot()).entries.length, 1);
        assert.deepEqual(failed.errors, ["storage_unavailable"]);
    }
    console.log(
        "PASS refused/uncertain storage never announces successful removal"
    );
    for (const extra of [
        { ctrlKey: true },
        { metaKey: true },
        { altKey: true },
        { shiftKey: true },
        { repeat: true },
        { target: { tagName: "INPUT" } },
        { target: { isContentEditable: true } },
    ]) {
        const guarded = await setup();
        guarded.press(extra);
        await settle();
        assert.equal(guarded.removedCalls, 0);
        assert.equal(guarded.banners.length, 0);
    }
    console.log(
        "PASS modifiers, text editing and held-repeat retain existing F guards"
    );
    for (const mode of ["kiosk", "dialog", "standby", "disabled", "stale"]) {
        const guarded = await setup();
        if (mode === "kiosk") guarded.w.__ottKiosk = { enabled: () => true };
        if (mode === "dialog")
            guarded.w.__ottClassicScreenPort.screens.open({
                handle: () => {},
                kind: "dialog",
                priority: 10,
            });
        if (mode === "standby")
            guarded.w.__ottStandby = { blocked: () => true };
        if (mode === "disabled") guarded.w.sFavorites = -1;
        if (mode === "stale") guarded.selectScreen(false);
        guarded.press();
        await settle();
        assert.equal(guarded.removedCalls, 0);
        assert.equal(guarded.banners.length, 0);
    }
    console.log("PASS modal/kiosk/standby/disabled/stale-owner refusal");
    const lost = await setup();
    lost.press();
    lost.selectScreen(false);
    await settle();
    assert.equal(lost.removedCalls, 0);
    assert.equal(lost.banners.length, 0);
    console.log("PASS owner loss before async removal writes nothing");
    const missing = await setup();
    missing.w.selIndex = 9;
    missing.press();
    await settle();
    assert.equal(missing.removedCalls, 0);
    assert.deepEqual(missing.errors, ["unavailable"]);
    console.log(
        "PASS missing/nonportable selection never falls through to provider UUID lookup"
    );
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
