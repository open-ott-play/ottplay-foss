const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const { settingsSource } = require("./helpers/settings-source-fixture.cjs");
const { compatibilitySource } = require("./helpers/english-source-fixture.cjs");
const root = path.resolve(__dirname, "..");
const domain = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(
        fs.readFileSync(path.join(root, "src/settings/store.ts"), "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText,
    domain
);
const create = domain.exports.createSettingsStore;
let passed = 0;
function check(name, run) {
    run();
    passed++;
    console.log("OK: " + name);
}
function fixture() {
    const data = new Map(),
        writes = [],
        effects = [];
    let source = "one",
        fail = null,
        reenter = null;
    const schema = [
        {
            defaultValue: 1,
            effects: ["layout"],
            id: "layout",
            key: "layout-old",
            scope: "application",
            validate: (v) => Number.isInteger(v) && v >= 0 && v <= 5,
        },
        {
            defaultValue: 1,
            effects: ["layout"],
            id: "logo",
            key: "logo-old",
            scope: "provider",
            validate: (v) => Number.isInteger(v) && v >= 0 && v <= 2,
        },
        {
            defaultValue: 20,
            effects: ["layout"],
            id: "rows",
            key: "rows-old",
            scope: "application",
            validate: (v) => Number.isInteger(v) && v >= 10 && v <= 30,
        },
    ];
    const store = create(schema, {
        context: () => source,
        effect: (name) =>
            effects.push({ data: Object.fromEntries(data), name }),
        storage(entry) {
            const key =
                (entry.scope === "provider" ? source + ":" : "") + entry.key;
            return {
                read: () => data.get(key) ?? null,
                remove: () => data.delete(key),
                write(value) {
                    writes.push([key, value]);
                    if (fail === key) return;
                    data.set(key, value);
                    if (reenter) {
                        const fn = reenter;
                        reenter = null;
                        fn();
                    }
                },
            };
        },
    });
    return {
        data,
        effects,
        fail(v) {
            fail = v;
        },
        reenter(v) {
            reenter = v;
        },
        source(v) {
            source = v;
        },
        store,
        writes,
    };
}
check(
    "field versions detect ABA changes without exposing values or unrelated edits",
    () => {
        const f = fixture(),
            ids = ["logo"];
        const initial = f.store.version(ids);
        f.store.observe("logo", 2);
        f.store.observe("logo", 1);
        const returned = f.store.version(ids);
        assert.notEqual(returned, initial);
        f.store.observe("logo", 1);
        f.store.observe("logo", -1);
        f.store.observe("layout", 3);
        assert.equal(f.store.version(ids), returned);
        f.data.set("one:logo-old", "2");
        f.store.reload();
        const loaded = f.store.version(ids);
        assert.notEqual(loaded, returned);
        f.store.reload();
        assert.equal(f.store.version(ids), loaded);
        const failed = f.store.begin();
        failed.set("logo", 1);
        f.fail("one:logo-old");
        assert.equal(failed.commit(), false);
        assert.equal(f.store.version(ids), loaded);
        f.fail(null);
        const accepted = f.store.begin();
        accepted.set("logo", 1);
        assert.equal(accepted.commit(), true);
        assert.notEqual(f.store.version(ids), loaded);
    }
);
check("draft cancel has no state/storage/effect changes", () => {
    const f = fixture(),
        d = f.store.begin();
    assert.equal(d.set("logo", 2), true);
    d.cancel();
    assert.equal(d.commit(), false);
    assert.equal(f.store.get("logo"), 1);
    assert.equal(f.writes.length, 0);
    assert.equal(f.effects.length, 0);
});
check("commit writes both scopes before one deduplicated effect", () => {
    const f = fixture(),
        d = f.store.begin();
    d.set("logo", 2);
    d.set("rows", 25);
    assert.equal(d.commit(), true);
    assert.equal(d.commit(), false);
    assert.equal(f.effects.length, 1);
    assert.equal(f.effects[0].data["one:logo-old"], "2");
    assert.equal(f.effects[0].data["rows-old"], "25");
});
check("invalid draft data cannot enter state or persistence", () => {
    const f = fixture(),
        d = f.store.begin();
    for (const value of [-1, 2.5, NaN, "2", null])
        assert.equal(d.set("logo", value), false);
    assert.equal(d.set("not-a-setting", 1), false);
    assert.equal(d.set("__proto__", 1), false);
    assert.equal(d.set("constructor", 1), false);
    assert.equal(d.commit(), true);
    assert.equal(f.writes.length, 0);
});
check("source replacement and reload invalidate old drafts", () => {
    const f = fixture(),
        old = f.store.begin();
    old.set("logo", 2);
    f.source("two");
    assert.equal(old.commit(), false);
    assert.equal(f.writes.length, 0);
    const next = f.store.begin();
    next.set("layout", 3);
    f.store.reload();
    assert.equal(next.commit(), false);
});
check("a later observed change rejects stale same-field commit", () => {
    const f = fixture(),
        d = f.store.begin();
    d.set("rows", 25);
    f.store.observe("rows", 30);
    assert.equal(d.commit(), false);
    assert.equal(f.store.get("rows"), 30);
    assert.equal(f.writes.length, 0);
});
check(
    "a fresh editor hydrates a replaced source even before catalog completion",
    () => {
        const f = fixture();
        f.store.observe("rows", 27);
        const old = f.store.begin();
        old.set("logo", 0);
        f.data.set("two:logo-old", "2");
        f.source("two");
        const current = f.store.begin();
        assert.equal(old.active(), false);
        assert.equal(current.active(), true);
        assert.equal(current.get("logo"), 2);
        assert.equal(current.get("rows"), 27);
        assert.equal(f.writes.length, 0);
        assert.equal(current.set("logo", 1), true);
        assert.equal(current.commit(), true);
        assert.equal(f.data.get("two:logo-old"), "1");
        assert.equal(f.data.has("one:logo-old"), false);
    }
);
check("unrelated updates survive a draft commit", () => {
    const f = fixture(),
        d = f.store.begin();
    d.set("logo", 2);
    f.store.observe("rows", 30);
    assert.equal(d.commit(), true);
    assert.equal(f.store.get("rows"), 30);
});
check(
    "silent storage rejection rolls back earlier writes and publishes no effects",
    () => {
        const f = fixture();
        f.data.set("rows-old", "20");
        f.fail("one:logo-old");
        const d = f.store.begin();
        d.set("rows", 25);
        d.set("logo", 2);
        assert.equal(d.commit(), false);
        assert.equal(f.data.get("rows-old"), "20");
        assert.equal(f.store.get("rows"), 20);
        assert.equal(f.effects.length, 0);
        assert.match(d.error(), /storage rejected/);
    }
);
check("storage reentry cannot commit into a replacement source", () => {
    const f = fixture(),
        d = f.store.begin();
    d.set("logo", 2);
    f.reenter(() => f.source("two"));
    assert.equal(d.commit(), false);
    assert.equal(f.data.size, 0);
    assert.equal(f.store.get("logo"), 1);
});
check(
    "provider reload retains application preferences and rejects malformed persisted values",
    () => {
        const f = fixture();
        f.data.set("layout-old", "3");
        f.data.set("one:logo-old", "2");
        f.store.reload();
        f.source("two");
        f.data.set("two:logo-old", "-1");
        f.store.reload("provider");
        assert.equal(f.store.get("layout"), 3);
        assert.equal(f.store.get("logo"), 1);
    }
);
function actual() {
    const data = new Map(),
        events = [];
    const storage = {
        del: (k) => data.delete(k),
        get: (k) => data.get(k) ?? null,
        set: (k, v) => data.set(k, String(v)),
        setI: (k, v) => data.set(k, String(v)),
    };
    const w = {
        _: (s) => s,
        console,
        setColor: () => events.push("color"),
        showShift: (s) => events.push(s),
        storage,
    };
    w.window = w;
    vm.createContext(w);
    vm.runInContext(compatibilitySource + settingsSource(), w);
    const store = vm.runInContext("settingsStore", w),
        typed = vm.runInContext("settings", w);
    return { data, events, store, typed, w };
}
check(
    "typed and legacy properties are one store; array reads cannot mutate it",
    () => {
        const { w, store, typed } = actual();
        w.sInfoTimeout = 7;
        assert.equal(typed.infoTimeout, 7);
        typed.infoTimeout = 9;
        assert.equal(w.sInfoTimeout, 9);
        assert.equal(store.get("infoTimeout"), 9);
        w.sHideMenus = ["menu"];
        w.sHideMenus.push("mutated");
        assert.deepEqual(Array.from(typed.hideMenus), ["menu"]);
    }
);
check(
    "stable row IDs survive hidden/reordered rows with explicit draft cancel",
    () => {
        const { w, typed, data } = actual();
        const rows = [
            { settingId: "volumeStep", settingOffset: 3 },
            { settingId: "pageSize", settingOffset: 10 },
        ];
        w.listArray = rows;
        const editor = w.createSettingsEditor(w, rows);
        rows.reverse();
        rows[0].val = 19;
        rows[1].val = 4;
        assert.equal(typed.pageSize, 25);
        assert.equal(data.size, 0);
        assert.equal(editor.save(), true);
        assert.equal(typed.pageSize, 29);
        assert.equal(typed.volumeStep, 7);
        assert.equal(data.get("sPageSize"), "29");
        assert.equal(data.get("sVolumeStep"), "7");
        const second = w.createSettingsEditor(w, rows);
        rows[0].val = 10;
        second.cancel();
        assert.equal(typed.pageSize, 29);
    }
);
check(
    "menu IDs and colour pickers write only draft values, preserving absent menu IDs",
    () => {
        const { w, typed, data } = actual();
        w.sHideMenus = ["unavailable"];
        const rows = [{ optionId: "live", settingId: "hideMenus" }];
        w.listArray = rows;
        const editor = w.createSettingsEditor(w, rows);
        rows[0].val = 1;
        w.eSHLcolor = "90,85";
        assert.equal(typed.highlightColor, "50,85");
        assert.equal(data.size, 0);
        assert.equal(editor.save(), true);
        assert.deepEqual(Array.from(typed.hideMenus), ["unavailable", "live"]);
        assert.equal(typed.highlightColor, "90,85");
    }
);
check(
    "drafts attach to list lifetime and reject retired save/colour callbacks",
    () => {
        const { w, typed, data } = actual();
        let cleanup;
        w.__ottClassicScreenPort = {
            listOwner: () => ({
                active: () => true,
                own: (fn) => {
                    cleanup = fn;
                },
            }),
        };
        const rows = [{ settingId: "pageSize" }];
        w.listArray = rows;
        const e = w.createSettingsEditor(w, rows);
        e.attach();
        rows[0].val = 30;
        cleanup();
        w.eSHLcolor = "0,0";
        assert.equal(e.save(), false);
        assert.equal(data.size, 0);
        assert.equal(typed.highlightColor, "50,85");
    }
);
check(
    "15 M3U namespaces are captured by the active driver's storage key",
    () => {
        const { w, typed, data } = actual();
        let slot = 0;
        w.__ottActiveProviderDriver = {
            id: "m3u",
            storageKey: (key) => "m3u-slot-" + slot + ":" + key,
        };
        for (slot = 0; slot < 15; slot++) {
            w.loadProviderSettings(0);
            const d = w.beginSettingsDraft();
            d.set("showNumber", slot % 2);
            d.commit();
        }
        for (slot = 0; slot < 15; slot++) {
            w.loadProviderSettings(0);
            assert.equal(typed.showNumber, slot % 2);
        }
        assert.equal(
            data.has("sShowNum"),
            false,
            "no global mirror leaks provider preferences"
        );
    }
);
check(
    "next programme legacy key is encoded without a second mutable derived value",
    () => {
        const { w, typed, data } = actual();
        const d = w.beginSettingsDraft();
        d.set("nextCountList", 0);
        assert.equal(d.commit(), true);
        assert.equal(data.get("sNextCount"), "-1");
        assert.equal(w.sNextCount, 0);
        assert.equal(typed.nextCount, 0);
        w.loadSettings();
        assert.equal(typed.nextCountList, 0);
        assert.equal(typed.nextCount, 0);
    }
);
check(
    "old backup aliases import through schema; rejected storage cannot report successful import",
    () => {
        const f = actual(),
            w = f.w;
        require("./helpers/shared-core-runtime.cjs")(w);
        let confirm,
            outcome,
            restarts = 0;
        w.confirmBox = (_message, yes) => {
            confirm = yes;
        };
        w.restart = () => {
            restarts++;
        };
        w.importSettings(
            JSON.stringify({
                settings: {
                    fontSize: 3,
                    psProvs: 1,
                    res10Resume: 0,
                    showPicon: 2,
                },
                version: 1,
            }),
            (value) => {
                outcome = value;
            }
        );
        assert.equal(f.data.size, 0, "preparing import cannot write");
        confirm();
        assert.equal(outcome, true);
        assert.equal(restarts, 1);
        assert.equal(f.typed.channelLogoMode, 2);
        assert.equal(w.sPSprovs, 1);
        assert.equal(w.s10resum, 0);
        assert.equal(f.data.get("sFont"), "3");
        w.storage.set = () => {};
        w.importSettings(
            JSON.stringify({ settings: { fontSize: 2 }, version: 1 }),
            (value) => {
                outcome = value;
            }
        );
        confirm();
        assert.equal(outcome, false);
        assert.equal(restarts, 1);
        assert.equal(f.typed.fontSize, 3);
    }
);
check(
    "import confirmation is one-shot and bound to its captured source",
    () => {
        const f = actual(),
            w = f.w;
        require("./helpers/shared-core-runtime.cjs")(w);
        let yes,
            no,
            completions = [];
        w.confirmBox = (_message, accept, cancel) => {
            yes = accept;
            no = cancel;
        };
        const payload = JSON.stringify({
            settings: { fontSize: 3 },
            version: 1,
        });
        w.importSettings(payload, (ok) => completions.push(ok));
        w.providerId = "replacement";
        yes();
        assert.deepEqual(completions, [false]);
        assert.equal(f.data.size, 0);
        w.importSettings(payload, (ok) => completions.push(ok));
        no();
        yes();
        assert.deepEqual(completions, [false, false]);
        assert.equal(f.data.size, 0);
    }
);
console.log("OK: " + passed + " settings store/domain/editor scenarios");
