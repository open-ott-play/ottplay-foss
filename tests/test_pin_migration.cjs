const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const { test } = require("node:test");
const salt = "0123456789abcdef0123456789abcdef";
const hashed =
    "pbkdf2-sha256$600000$" +
    salt +
    "$" +
    crypto
        .pbkdf2Sync("2468", Buffer.from(salt, "hex"), 600000, 32, "sha256")
        .toString("hex");
function compile(file) {
    return ts.transpileModule(
        fs.readFileSync(file, "utf8").replace(/^export /gm, ""),
        {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
}
function fixture(initial = "2468") {
    const dom = new JSDOM(
        '<div id="dialogbox"></div><div id="list_window"></div>',
        { runScripts: "outside-only", url: "https://example.invalid" }
    );
    const w = dom.window,
        pending = [],
        writes = [];
    let raw = initial,
        mode = "normal";
    Object.defineProperty(w, "crypto", {
        value: {
            getRandomValues: crypto.webcrypto.getRandomValues.bind(
                crypto.webcrypto
            ),
            subtle: {
                deriveBits(...args) {
                    return crypto.webcrypto.subtle
                        .deriveBits(...args)
                        .then(
                            (result) =>
                                new Promise((resolve) =>
                                    pending.push(() => resolve(result))
                                )
                        );
                },
                importKey: crypto.webcrypto.subtle.importKey.bind(
                    crypto.webcrypto.subtle
                ),
            },
        },
    });
    w.eval(fs.readFileSync("js/jquery-1.11.1.min.js", "utf8"));
    w.$.expr.filters.visible = (e) => e.style.display !== "none";
    Object.assign(w, {
        _: (t) => t,
        keys: {
            DOWN: 40,
            ENTER: 13,
            EXIT: 27,
            LEFT: 37,
            RETURN: 8,
            RIGHT: 39,
            UP: 38,
            ...Object.fromEntries(
                Array.from({ length: 10 }, (_, d) => ["N" + d, 48 + d])
            ),
        },
        p_pref: "one",
        providerGetItem: () => null,
        providerSetItem() {},
        showShift() {},
        sPSchannels: 1,
        sPSoptions: 1,
        sPSprovs: 1,
    });
    require("./helpers/screen-runtime.cjs")(w);
    require("./helpers/access-runtime.cjs")(w);
    w.eval(compile("src/settings/store.ts"));
    const store = w.createSettingsStore(
        [
            {
                defaultValue: "1234",
                effects: [],
                id: "parentPin",
                invalidValue: "!locked-invalid-pin",
                key: "parentPIN",
                prepare: w.__ottPinSecurity.prepare,
                scope: "application",
                validate: w.__ottPinSecurity.valid,
            },
        ],
        {
            context: () => w.p_pref,
            effect() {},
            storage: () => ({
                read: () => {
                    if (mode === "read-error") throw Error("read");
                    return raw;
                },
                remove: () => {
                    raw = null;
                },
                write: (value) => {
                    writes.push(value);
                    if (mode === "throw") throw Error("write");
                    if (mode !== "silent") raw = value;
                },
            }),
        }
    );
    w.settingsStore = store;
    store.reload();
    Object.defineProperty(w, "parentPIN", {
        get: () => store.get("parentPin"),
        set: (v) => store.observe("parentPin", v),
    });
    return {
        answer() {
            for (const d of "2468")
                w.__ottClassicScreenPort.dispatch(
                    w.keys["N" + d],
                    null,
                    () => {}
                );
        },
        dom,
        mode: (v) => {
            mode = v;
        },
        pending,
        raw: () => raw,
        async ready() {
            for (let i = 0; pending.length === 0 && i < 200; i++)
                await new Promise((r) => setTimeout(r, 5));
            assert.equal(pending.length, 1);
        },
        async release() {
            await this.ready();
            pending.shift()();
            await new Promise((r) => setTimeout(r, 20));
        },
        store,
        w,
        writes,
    };
}
test("legacy unlock preserves immediate access then migrates exact stored bytes", async () => {
    const f = fixture();
    try {
        let calls = 0;
        f.w.__ottParental.request(() => calls++);
        f.answer();
        assert.equal(calls, 1);
        assert.equal(f.w.parentAccess, true);
        await f.release();
        assert.match(f.raw(), /^pbkdf2-sha256\$600000\$/);
        assert.equal(f.w.parentPIN, f.raw());
        assert.equal(f.w.parentAccess, true);
        assert.equal(f.writes.length, 1);
        assert.equal(calls, 1);
    } finally {
        f.dom.window.close();
    }
});
for (const change of [
    "revoke",
    "source",
    "pin",
    "policy",
    "new-challenge",
    "pagehide",
])
    test("pending legacy migration cannot cross " + change, async () => {
        const f = fixture();
        try {
            let calls = 0;
            f.w.__ottParental.request(() => calls++);
            f.answer();
            await f.ready();
            if (change === "revoke") f.w.__ottParental.revoke();
            if (change === "source") f.w.p_pref = "two";
            if (change === "pin") f.w.parentPIN = "9876";
            if (change === "policy") f.w.sPSchannels = 0;
            if (change === "new-challenge")
                f.w.__ottParental.request(() => calls++);
            if (change === "pagehide")
                f.w.dispatchEvent(new f.w.Event("pagehide"));
            // If cancellation happened before native import completed no derivation starts.
            await new Promise((r) => setTimeout(r, 100));
            if (f.pending.length) await f.release();
            assert.equal(f.raw(), "2468");
            assert.equal(f.writes.length, 0);
            assert.equal(calls, 1);
            if (change !== "new-challenge")
                assert.equal(f.w.parentAccess, false);
        } finally {
            f.dom.window.close();
        }
    });
for (const change of [
    "revoke",
    "source",
    "pin",
    "policy",
    "new-challenge",
    "pagehide",
])
    test(
        "pending hashed verification cannot grant after " + change,
        async () => {
            const f = fixture(hashed);
            try {
                let calls = 0;
                f.w.__ottParental.request(() => calls++);
                f.answer();
                await f.ready();
                if (change === "revoke") f.w.__ottParental.revoke();
                if (change === "source") f.w.p_pref = "two";
                if (change === "pin") f.w.parentPIN = "9876";
                if (change === "policy") f.w.sPSchannels = 0;
                if (change === "new-challenge")
                    f.w.__ottParental.request(() => calls++);
                if (change === "pagehide")
                    f.w.dispatchEvent(new f.w.Event("pagehide"));
                await new Promise((r) => setTimeout(r, 100));
                if (f.pending.length) await f.release();
                assert.equal(calls, 0);
                assert.equal(f.w.parentAccess, false);
                assert.equal(f.writes.length, 0);
            } finally {
                f.dom.window.close();
            }
        }
    );
for (const mode of ["silent", "throw"])
    test(
        "failed migration write never publishes a hash or creates a new grant: " +
            mode,
        async () => {
            const f = fixture();
            try {
                let calls = 0;
                f.mode(mode);
                f.w.__ottParental.request(() => calls++);
                f.answer();
                await f.release();
                assert.equal(f.raw(), "2468");
                assert.equal(f.w.parentPIN, "2468");
                assert.equal(calls, 1);
            } finally {
                f.dom.window.close();
            }
        }
    );
test("corrupt and unreadable stored PIN fail closed instead of selecting default1234", () => {
    for (const value of [
        "",
        hashed + "x",
        "pbkdf2-sha256$999999999$",
        "garbage",
    ]) {
        const f = fixture(value);
        try {
            assert.equal(f.w.parentPIN, "!locked-invalid-pin");
            assert.equal(f.w.__ottParental.needs("control"), true);
        } finally {
            f.dom.window.close();
        }
    }
    const f = fixture();
    try {
        f.mode("read-error");
        f.store.reload();
        assert.equal(f.w.parentPIN, "!locked-invalid-pin");
    } finally {
        f.dom.window.close();
    }
});
test("legacy import and sync export convert to hashed record; an existing hash survives exactly", () => {
    const f = fixture();
    try {
        const draft = f.store.begin();
        assert.equal(draft.set("parentPin", "9876"), true);
        assert.equal(draft.commit(), true);
        assert.match(f.raw(), /^pbkdf2/);
        assert.equal(f.writes.includes("9876"), false);
        const s = f.w.__ottPinSecurity;
        const exported = s.protectSnapshot(
            { other: "kept", parentPin: "2468" },
            "parentPin"
        );
        assert.match(exported.parentPin, /^pbkdf2/);
        assert.equal(exported.other, "kept");
        assert.equal(
            s.protectSnapshot({ parentPIN: hashed }, "parentPIN").parentPIN,
            hashed
        );
        assert.throws(() => s.prepare("malformed"));
    } finally {
        f.dom.window.close();
    }
});

test("local backup restore never clears an existing PIN, including omitted keys and write failures", () => {
    const source = fs.readFileSync("src/storage/index.ts", "utf8");
    const ast = ts.createSourceFile(
        "storage.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const names = [
        "isStorageMetadataKey",
        "isPortableSettingsKey",
        "portableSettingsSnapshot",
        "restoreLocalSettingsSnapshot",
    ];
    const functions = ast.statements.filter(
        (n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)
    );
    assert.equal(functions.length, names.length);
    const marker = ast.statements.find(
        (n) =>
            ts.isVariableStatement(n) &&
            n.declarationList.declarations.some(
                (d) => d.name.getText(ast) === "STORAGE_FALLBACK_KEYS"
            )
    );
    assert(marker);
    const code = ts.transpileModule(
        [marker, ...functions]
            .map((n) => n.getText(ast).replace(/^export /, ""))
            .join("\n"),
        {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    for (const mode of ["normal", "silent-pin", "throw-other"]) {
        const f = fixture(hashed);
        try {
            const state = { ordinary: "before", parentPIN: hashed };
            Object.assign(f.w, {
                stbClearAllItems() {
                    throw Error("must never clear PIN");
                },
                stbDelItem(key) {
                    assert.notEqual(key, "parentPIN");
                    delete state[key];
                },
                stbGetAllItems: () => ({ ...state }),
                stbSetItem(key, value) {
                    if (mode === "silent-pin" && key === "parentPIN") return;
                    if (mode === "throw-other" && key === "ordinary")
                        throw Error("disk full");
                    state[key] = value;
                },
            });
            f.w.eval(fs.readFileSync("vendor/ottplay-core.js", "utf8"));
            f.w.OttPlayCore = f.w["play.ott:ottplay-shared-core"];
            f.w.eval(code);
            if (mode === "normal") {
                f.w.restoreLocalSettingsSnapshot({ ordinary: "after" });
                assert.equal(
                    state.parentPIN,
                    hashed,
                    "omitted PIN is retained exactly"
                );
                assert.equal(state.ordinary, "after");
            } else if (mode === "silent-pin") {
                const other = hashed.replace(
                    /.$/,
                    hashed.endsWith("a") ? "b" : "a"
                );
                assert.throws(
                    () =>
                        f.w.restoreLocalSettingsSnapshot({
                            ordinary: "after",
                            parentPIN: other,
                        }),
                    /rejected/
                );
                assert.equal(state.parentPIN, hashed);
                assert.equal(
                    state.ordinary,
                    "before",
                    "rejected credential aborts before clearing other keys"
                );
            } else {
                assert.throws(
                    () =>
                        f.w.restoreLocalSettingsSnapshot({ ordinary: "after" }),
                    /disk full/
                );
                assert.equal(
                    state.parentPIN,
                    hashed,
                    "later failure cannot remove credential"
                );
            }
        } finally {
            f.dom.window.close();
        }
    }
});

for (const change of [
    "none",
    "pagehide",
    "new-challenge",
    "source",
    "pin",
    "toggle",
    "cancel",
    "storage-port",
    "access-lock",
])
    test("new PIN setup cannot publish after " + change, async () => {
        const f = fixture("*");
        try {
            const w = f.w;
            let save;
            w.beginSettingsDraft = () => f.store.begin();
            w.settingsSchema = f.store.schema.concat(
                [
                    "psChannels",
                    "psOptions",
                    "requirePinForProviderSelection",
                ].map((id) => ({ id }))
            );
            w.enterPinCode = (...args) => w.__ottParental.pin(...args);
            w.setParentAccess = (...args) => w.__ottParental.setAccess(...args);
            w.optionsList = () => {};
            w.closeList = () => {};
            w._setSetup = (fn) => {
                save = fn;
            };
            const editor = fs
                .readFileSync("src/settings/editor.ts", "utf8")
                .replace(/^import .*$/gm, "")
                .replace(/^export /gm, "");
            w.eval(
                ts.transpileModule(editor, {
                    compilerOptions: {
                        module: ts.ModuleKind.None,
                        target: ts.ScriptTarget.ES5,
                    },
                }).outputText
            );
            const text = fs.readFileSync("src/channels/index.ts", "utf8");
            const ast = ts.createSourceFile(
                "channels.ts",
                text,
                ts.ScriptTarget.Latest,
                true
            );
            const node = ast.statements.find(
                (n) =>
                    ts.isFunctionDeclaration(n) &&
                    n.name.text === "parentControlSetup"
            );
            w.eval(
                ts.transpileModule(node.getText(ast).replace(/^export /, ""), {
                    compilerOptions: {
                        module: ts.ModuleKind.None,
                        target: ts.ScriptTarget.ES5,
                    },
                }).outputText
            );
            w.parentControlSetup();
            w.listArray[0].val = 1;
            save();
            f.answer();
            f.answer();
            await f.ready();
            if (change === "pagehide") w.dispatchEvent(new w.Event("pagehide"));
            if (change === "new-challenge")
                w.__ottParental.pin("new", () => {});
            if (change === "source") w.p_pref = "two";
            if (change === "pin") w.parentPIN = "9876";
            if (change === "toggle") w.listArray[0].val = 0;
            if (change === "cancel") w.__ottSettingsEditor.cancel();
            if (change === "storage-port") w.providerSetItem = () => {};
            if (change === "access-lock") w.parentAccess = false;
            await f.release();
            if (change === "none") {
                assert.match(f.raw(), /^pbkdf2-sha256\$600000\$/);
                assert.equal(w.parentAccess, true);
            } else {
                assert.equal(f.raw(), "*");
                assert.equal(f.writes.length, 0);
                assert.equal(w.parentAccess, false);
            }
        } finally {
            f.dom.window.close();
        }
    });
