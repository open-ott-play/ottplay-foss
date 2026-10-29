"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript");
const { load } = require("./global-favorites-fixture.cjs");
const create = load(
    "src/media/global-favorites-navigation.ts"
).createGlobalFavoritesNavigation;
const makeRouter = load(
    "src/media/global-favorites-router.ts"
).createGlobalFavoritesRouter;
const codec = load(
    "src/settings/global-favorites-portable.ts"
).createGlobalFavoritesPortableCodec();
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
        if (!found && predicate(n, source)) found = n;
        ts.forEachChild(n, visit);
    }
    visit(source);
    assert(found, file);
    return found.getText(source);
}
function compiled(expression, globals) {
    const js = ts.transpileModule("var actual=" + expression, {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
    const context = { ...globals };
    vm.runInNewContext(js, context);
    return context.actual;
}
const turn = () => new Promise((r) => setImmediate(r));
async function settle() {
    for (let i = 0; i < 8; i++) await turn();
}
const kinds = [
    [
        "local",
        { kind: "local-media", relativePath: "a.mp4", rootAlias: "Files" },
    ],
    ["m3u", { channelId: "101", kind: "channel" }],
    ["vportal", { id: "movie", idField: "id", kind: "vportal-media" }],
    ["plex", { kind: "plex-media", ratingKey: "43", serverId: "PMS" }],
    ["m3u", { channelId: "201", kind: "channel" }],
];
function setup() {
    let rows = kinds.map(([provider, locator], i) => ({
            id: "id" + i,
            locator,
            origin: {
                profile: "Profile " + i,
                provider,
                sourceAlias: "Alias " + i,
                subprofile: null,
            },
            title: "Item " + i,
        })),
        active = true,
        allowed = true,
        version = 0,
        gen = 0,
        phase = "idle",
        position = 0,
        snapshotHook = null,
        unavailable = null;
    const calls = [],
        errors = [];
    let nav;
    const snapshot = async () => {
        if (snapshotHook) await snapshotHook();
        const captured = version;
        return {
            current: () => captured === version && active,
            entries: rows.slice(),
        };
    };
    const router = makeRouter({
        activate: async (target) => ({
            capturePlayback: () => {
                const g = gen;
                const current = () =>
                    active &&
                    g === gen &&
                    phase !== "stopped" &&
                    phase !== "idle";
                return {
                    current,
                    matches: () => true,
                    prepareEnded: (expected) =>
                        expected === g && current() && phase === "playing"
                            ? () =>
                                  active && gen === g + 1 && phase === "stopped"
                            : null,
                };
            },
            complete: () => {},
            current: () => active,
            origin: target.origin,
            play: async () => {
                calls.push(target.origin.provider);
                gen++;
                phase = "playing";
                position = 0;
                return true;
            },
            release: () => {},
            resolve: async (locator) => ({
                available:
                    unavailable !==
                    codec.identity({
                        locator,
                        origin: target.origin,
                        title: "x",
                    }),
                locator,
            }),
        }),
        allowed: () => allowed,
        changed: (s) => nav.routeState(s),
        clearTimer: () => {},
        codec,
        current: () => active,
        now: () => 0,
        setTimer: () => 1,
        snapshot,
        targets: async (origin) => [{ current: () => active, origin }],
    });
    nav = create({
        allowed: () => allowed,
        cancel: router.cancel,
        capture: router.captureCurrent,
        captureEnding: router.captureEnding,
        current: () => active,
        failed: (e) => errors.push(e),
        identity: (r) =>
            codec.identity({
                locator: r.locator,
                origin: r.origin,
                title: r.title,
            }),
        select: router.select,
        snapshot,
    });
    return {
        calls,
        defer: (fn) => {
            snapshotHook = fn;
        },
        errors,
        get gen() {
            return gen;
        },
        nav,
        get phase() {
            return phase;
        },
        remove: (i) => {
            rows = rows.filter((r) => r.id !== i);
            version++;
        },
        reorder: () => {
            rows = [rows[0], rows[3], rows[1], rows[2], rows[4]];
            version++;
        },
        router,
        get rows() {
            return rows;
        },
        seek: () => {
            position = 17;
        },
        setPhase: (v) => {
            phase = v;
        },
        standby: () => {
            allowed = false;
            nav.retire();
        },
        stop: () => {
            gen++;
            phase = "stopped";
        },
        unavailable: (id) => {
            const r = rows.find((r) => r.id === id);
            unavailable = codec.identity({
                locator: r.locator,
                origin: r.origin,
                title: r.title,
            });
        },
    };
}
async function start(f, id = "id0") {
    assert.equal((await f.router.select(id).result).status, "ok");
    assert.equal(f.nav.currentId(), id);
}
async function main() {
    let count = 0;
    async function test(name, fn) {
        await fn();
        count++;
        console.log("PASS " + name);
    }
    await test("actual router mixed next/previous and wrapped order", async () => {
        const f = setup();
        await start(f);
        for (const id of ["id1", "id2", "id3", "id4", "id0"]) {
            assert.equal(f.nav.move(1), true);
            await settle();
            assert.equal(f.nav.currentId(), id);
        }
        f.nav.move(-1);
        await settle();
        assert.equal(f.nav.currentId(), "id4");
        assert.deepEqual(f.calls, [
            "local",
            "m3u",
            "vportal",
            "plex",
            "m3u",
            "local",
            "m3u",
        ]);
    });
    await test("fresh snapshot order, repeat keys consumed, unavailable stops without skipping", async () => {
        const f = setup();
        await start(f);
        f.reorder();
        let release;
        f.defer(
            () =>
                new Promise((r) => {
                    release = r;
                })
        );
        assert(f.nav.move(1));
        assert(f.nav.move(1));
        await turn();
        f.defer(null);
        release();
        await settle();
        assert.equal(f.nav.currentId(), "id3");
        f.unavailable("id1");
        f.nav.move(1);
        await settle();
        assert.equal(f.nav.currentId(), null);
        assert.equal(f.calls.length, 2);
        assert.equal(f.errors.length, 1);
    });
    await test("retirement cancels delayed selection and manual content proof invalidates", async () => {
        const f = setup();
        await start(f);
        let release;
        f.defer(
            () =>
                new Promise((r) => {
                    release = r;
                })
        );
        f.nav.move(1);
        await turn();
        f.nav.retire();
        release();
        await settle();
        assert.equal(f.calls.length, 1);
        assert.equal(f.nav.currentId(), null);
        f.defer(null);
        await start(f);
        f.stop();
        assert.equal(f.nav.move(1), false);
        assert.equal(f.nav.currentId(), null);
    });
    await test("pause/resume/seek with unchanged session preserves current row", async () => {
        const f = setup();
        await start(f, "id3");
        f.setPhase("paused");
        f.seek();
        assert.equal(f.nav.currentId(), "id3");
        assert.equal(f.nav.isPlaying("id3", f.rows), true);
        f.setPhase("playing");
        assert.equal(f.nav.currentId(), "id3");
    });
    await test("pre-stop EOF token advances mixed order once; no caller generation authority", async () => {
        const f = setup();
        await start(f, "id3");
        const token = f.nav.prepareEnded(f.gen);
        assert(token);
        f.stop();
        assert(f.nav.complete(f.gen, token, "all"));
        assert(f.nav.complete(f.gen, token, "all"));
        await settle();
        assert.equal(f.nav.currentId(), "id4");
        assert.equal(f.calls.length, 2);
        assert(f.nav.complete(f.gen - 1, token, "all"));
        await settle();
        assert.equal(f.nav.currentId(), "id4");
        assert.equal(f.calls.length, 2);
    });
    await test("manual stop before stale EOF cannot mint or advance", async () => {
        const f = setup();
        await start(f, "id3");
        f.stop();
        assert.equal(f.nav.prepareEnded(f.gen - 1), null);
        assert(f.nav.complete(f.gen, null, "all"));
        await settle();
        assert.equal(f.calls.length, 1);
        assert.equal(f.nav.currentId(), null);
    });
    await test("standby and retirement invalidate captured token", async () => {
        for (const standby of [false, true]) {
            const f = setup();
            await start(f);
            const token = f.nav.prepareEnded(f.gen);
            f.stop();
            if (standby) f.standby();
            else f.nav.retire();
            assert.equal(f.nav.complete(f.gen, token, "all"), false);
            await settle();
            assert.equal(f.calls.length, 1);
        }
    });
    await test("explicit pending navigation beats departing EOF", async () => {
        const f = setup();
        await start(f);
        let release;
        f.defer(
            () =>
                new Promise((r) => {
                    release = r;
                })
        );
        f.nav.move(1);
        await turn();
        assert.equal(f.nav.prepareEnded(f.gen), null);
        assert(f.nav.complete(f.gen, null, "all"));
        f.defer(null);
        release();
        await settle();
        assert.equal(f.nav.currentId(), "id1");
        assert.equal(f.calls.length, 2);
    });
    await test("repeat off stops at end; one repeats exact UUID; removed current does not skip", async () => {
        for (const mode of ["off", "one"]) {
            const f = setup();
            await start(f, "id4");
            const token = f.nav.prepareEnded(f.gen);
            f.stop();
            assert(f.nav.complete(f.gen, token, mode));
            await settle();
            assert.equal(f.calls.length, mode === "off" ? 1 : 2);
            assert.equal(f.nav.currentId(), mode === "off" ? null : "id4");
        }
        const f = setup();
        await start(f);
        const token = f.nav.prepareEnded(f.gen);
        f.stop();
        f.remove("id0");
        assert(f.nav.complete(f.gen, token, "all"));
        await settle();
        assert.equal(f.calls.length, 1);
        assert.equal(f.errors.length, 1);
    });
    await test("actual core emit captures before stop and actual media ended intercepts provider queue", async () => {
        const f = setup();
        await start(f, "id3");
        const w = {
            __ottClassicPlayback: {
                command: () => f.stop(),
                snapshot: () => ({ generation: f.gen }),
            },
            __ottGlobalFavorites: { navigation: f.nav },
            __ottStandby: { blocked: () => false },
        };
        const endedText = extract(
            "src/media/classic-adapter.ts",
            (n) =>
                ts.isPropertyAssignment(n) &&
                n.name.getText() === "ended" &&
                n.getText().includes("completedGlobalGeneration")
        ).replace(/^ended:\s*/, "");
        const ended = compiled(endedText, {
            api: { checkpoint: () => {} },
            completedGlobalGeneration: -1,
            deferLocalEnd: () => {
                throw Error("provider queue must not run");
            },
            manualLoading: null,
            mediaClassicPlayback: null,
            repeat: "all",
            skipRequest: null,
            w,
        });
        w.__ottMedia = { ended };
        const emitText = extract(
            "src/core/index.ts",
            (n) =>
                ts.isPropertyAssignment(n) &&
                n.name.getText() === "emit" &&
                n.getText().includes("prepareEnded")
        ).replace(/^emit:\s*/, "");
        const emit = compiled(emitText, { window: w });
        const before = f.gen;
        emit({ generation: before, kind: "vod" }, "ended", 9, 9);
        ended(before + 1, null);
        await settle();
        assert.equal(f.nav.currentId(), "id4");
        assert.equal(f.calls.length, 2);
    });
    await test("actual public Stop cancels active handoff; only internal source stop preserves it", async () => {
        const f = setup();
        await start(f);
        let release;
        f.defer(
            () =>
                new Promise((r) => {
                    release = r;
                })
        );
        const pending = f.router.select("id1");
        await turn();
        const w = {
            __ottClassicPlayback: { cancel: () => {} },
            __ottGlobalFavorites: { navigation: f.nav },
            __ottGlobalFavoritesHandoff: { current: () => true },
            __ottMedia: { cancelAuto: () => {} },
        };
        const privateText = extract(
            "src/core/index.ts",
            (n) =>
                ts.isFunctionDeclaration(n) &&
                n.name?.text === "stopCorePlayback"
        );
        const privateStop = compiled(privateText, {
            getCoreMediaBackend: () => ({ stop: f.stop }),
            window: w,
        });
        const stopText = extract(
            "src/core/index.ts",
            (n) => ts.isFunctionDeclaration(n) && n.name?.text === "stbStop"
        ).replace(/^export\s+/, "");
        const stop = compiled(stopText, {
            stopCorePlayback: privateStop,
            window: w,
        });
        stop();
        release();
        await settle();
        assert.equal((await pending.result).status, "cancelled");
        assert.equal(f.calls.length, 1);
        assert.equal(f.nav.currentId(), null);
        assert.equal(f.nav.prepareEnded(f.gen - 1), null);
        let retired = 0,
            stopped = 0;
        w.__ottGlobalFavorites.navigation = { retire: () => retired++ };
        const internal = compiled(
            extract(
                "src/core/index.ts",
                (n) =>
                    ts.isPropertyAssignment(n) &&
                    n.name.getText() === "stopForSource"
            ).replace(/^stopForSource:\s*/, ""),
            {
                stbStop: () => retired++,
                stopCorePlayback: () => stopped++,
                window: w,
            }
        );
        internal();
        assert.equal(stopped, 1);
        assert.equal(retired, 0);
        w.__ottGlobalFavoritesHandoff.current = () => false;
        internal();
        assert.equal(retired, 1);
        for (const file of ["src/provider/index.ts", "src/index.ts"])
            assert.equal(
                (
                    fs
                        .readFileSync(path.join(root, file), "utf8")
                        .match(/stopSourcePlayback\(\);/g) || []
                ).length,
                2
            );
    });
    await test("actual plusProg calls global navigation before provider fallback", async () => {
        let fallbacks = 0;
        const f = setup();
        await start(f);
        const text = extract(
            "src/key-handler/index.ts",
            (n) => ts.isFunctionDeclaration(n) && n.name?.text === "plusProg"
        ).replace(/^export\s+/, "");
        const plus = compiled(text, {
            nextChannel: () => fallbacks++,
            stbIsStandby: () => false,
            w: { __ottGlobalFavorites: { navigation: f.nav } },
            window: { __ottGlobalFavorites: { navigation: f.nav } },
        });
        plus();
        await settle();
        assert.equal(f.nav.currentId(), "id1");
        assert.equal(fallbacks, 0);
    });
    await test("actual view reopen highlights proved row and closes without retiring", async () => {
        const f = setup();
        await start(f, "id2");
        let shown;
        const view = load(
            "src/media/global-favorites-view.ts"
        ).createGlobalFavoritesView({
            captureScreen: () => () => true,
            current: () => true,
            describe: (x) => x.provider,
            error: () => {},
            navigation: f.nav,
            router: f.router,
            show: (v) => {
                shown = v;
                return () => true;
            },
            store: {
                snapshot: async () => ({
                    current: () => true,
                    entries: f.rows,
                    unresolvedLegacy: [],
                }),
            },
            translate: (x) => x,
        });
        await view.open();
        assert.equal(shown.selected, "id2");
        assert(shown.playing("id2"));
        view.close();
        assert.equal(f.nav.currentId(), "id2");
        await view.open();
        assert.equal(shown.selected, "id2");
    });
    function keyboard(f) {
        let command = "",
            timer = null,
            reopened = 0,
            provider = 0,
            seeks = 0,
            screenRevision = 0;
        const osd = { innerHTML: "", style: {}, textContent: "" };
        const w = {
            __ottClassicScreenPort: {
                dispatch: (_code, _event, callback) => callback({ code: 1 }),
                normalize: () => ({ id: command }),
                revision: () => screenRevision,
            },
            __ottGlobalFavorites: { navigation: f.nav },
            catIndex: 7,
            channels: [{ channel_name: "Provider row" }],
            channelsList: () => provider++,
            curList: [0],
            forcePlay: false,
            openGlobalFavorites: () => reopened++,
            playChannel: () => provider++,
            playType: -1,
            primaryIndex: -1,
            s13dur: 15,
            shiftArchive: () => seeks++,
        };
        const names = ["keyHandler", "handleMainKey", "numberProg"];
        const source = names
            .map((name) =>
                extract(
                    "src/key-handler/index.ts",
                    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name
                ).replace(/^export\s+/, "")
            )
            .join("\n");
        const metadata = extract(
            "src/utils/helpers.ts",
            (n) =>
                ts.isFunctionDeclaration(n) && n.name?.text === "metadataText"
        ).replace(/^export\s+/, "");
        const context = {
            cancelNativeListInertia: () => {},
            clearTimeout: () => {
                timer = null;
            },
            document: { getElementById: () => osd },
            keys: {},
            setTimeout: (fn) => {
                timer = fn;
                return 1;
            },
            settings: { okFun: false },
            stbEventToKeyCode: () => 1,
            toggleMainPlayback: () => provider++,
            window: w,
        };
        const js = ts.transpileModule(
            'var nProg="",numTimeout=null,numProgEl=null,globalNumber=null;\n' +
                metadata +
                "\n" +
                source,
            { compilerOptions: { target: ts.ScriptTarget.ES5 } }
        ).outputText;
        vm.runInNewContext(js, context);
        w.numberProg = context.numberProg;
        return {
            finish: () => {
                const fn = timer;
                timer = null;
                if (fn) fn();
            },
            modal: () => screenRevision++,
            osd,
            press: (id, target = { tagName: "BODY" }) => {
                command = id;
                context.keyHandler({
                    code: "",
                    key: id,
                    preventDefault() {},
                    stopPropagation() {},
                    target,
                });
            },
            get provider() {
                return provider;
            },
            get reopened() {
                return reopened;
            },
            get seeks() {
                return seeks;
            },
            w,
        };
    }
    await test("real key ingress selects global ordinal during media and reopens on OK/Channels", async () => {
        const f = setup();
        await start(f);
        f.rows[2].title = '<img src=x onerror="bad">';
        const k = keyboard(f);
        k.press("digit-3");
        await settle();
        assert(k.osd.innerHTML.includes("&lt;img"));
        assert(!k.osd.innerHTML.includes("<img"));
        k.finish();
        await settle();
        assert.equal(f.nav.currentId(), "id2");
        assert.equal(k.seeks, 0);
        assert.equal(k.provider, 0);
        k.press("accept");
        k.press("channels");
        assert.equal(k.reopened, 2);
        assert.equal(k.provider, 0);
        k.press("digit-2", { tagName: "INPUT" });
        k.finish();
        await settle();
        assert.equal(f.nav.currentId(), "id2");
    });
    await test("numeric snapshot cannot retarget after reorder/delete or manual departure", async () => {
        for (const change of [
            (f) => f.reorder(),
            (f) => f.remove("id1"),
            (f) => f.nav.retire(),
        ]) {
            const f = setup();
            await start(f);
            const k = keyboard(f);
            k.press("digit-2");
            await settle();
            const before = f.calls.length;
            change(f);
            k.finish();
            await settle();
            assert.equal(f.calls.length, before);
            assert.equal(k.provider, 0);
            assert.equal(k.osd.style.display, "none");
        }
    });
    await test("numeric entry is retired by another UI and unavailable target reports failure", async () => {
        const f = setup();
        await start(f);
        const k = keyboard(f);
        k.press("digit-0");
        f.reorder();
        k.press("digit-2");
        await settle();
        k.modal();
        const before = f.calls.length;
        k.finish();
        await settle();
        assert.equal(f.calls.length, before);
        k.press("digit-2");
        await settle();
        k.press("channels");
        k.finish();
        await settle();
        assert.equal(f.calls.length, before);
        f.unavailable("id3");
        k.press("digit-2");
        await settle();
        k.finish();
        await settle();
        assert(f.errors.includes("unavailable"));
        assert.equal(k.provider, 0);
    });
    await test("late numeric snapshot cannot dispatch after a modal takes ownership", async () => {
        const f = setup();
        await start(f);
        const k = keyboard(f);
        let release;
        f.defer(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );
        k.press("digit-2");
        k.finish();
        k.modal();
        f.defer(null);
        release();
        await settle();
        assert.equal(f.calls.length, 1);
        assert.equal(k.provider, 0);
    });
    await test("committed numeric handoff survives loading UI and newer selection wins", async () => {
        for (const supersede of [false, true]) {
            const f = setup();
            await start(f);
            const k = keyboard(f);
            k.press("digit-2");
            await settle();
            let release;
            f.defer(
                () =>
                    new Promise((resolve) => {
                        release = resolve;
                    })
            );
            k.finish();
            await turn();
            // Timer committed: normal loading UI may now change screens, just
            // as it does for an ENTER selection in the Favorites list.
            k.modal();
            f.defer(null);
            if (supersede) await start(f, "id4");
            release();
            await settle();
            assert.equal(f.nav.currentId(), supersede ? "id4" : "id1");
            assert.equal(f.calls.length, 2);
            assert.equal(f.errors.length, 0);
            assert.equal(k.provider, 0);
        }
    });
    await test("removed current UUID keeps numeric global order and out-of-range never uses provider", async () => {
        const f = setup();
        await start(f);
        f.remove("id0");
        const k = keyboard(f);
        k.press("channels");
        assert.equal(k.reopened, 1);
        k.press("digit-1");
        await settle();
        k.finish();
        await settle();
        assert.equal(f.nav.currentId(), "id1");
        const before = f.calls.length;
        k.press("digit-9");
        await settle();
        k.finish();
        await settle();
        assert.equal(f.calls.length, before);
        assert.equal(k.provider, 0);
        assert.equal(f.errors[f.errors.length - 1], "missing");
        f.nav.retire();
        k.press("digit-3");
        assert.equal(k.seeks, 1);
        k.w.playType = 0;
        k.press("channels");
        assert.equal(k.provider, 1);
    });
    console.log("PASS " + count + " navigation groups");
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
