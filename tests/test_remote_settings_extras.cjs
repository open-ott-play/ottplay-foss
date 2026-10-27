"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
function compile(file) {
    const value = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(value, { ecmaVersion: 5 });
    return value;
}
const store = { exports: {} };
vm.runInNewContext(compile("src/settings/store.ts"), store);
const extra = compile("src/plugins/remote-settings-extras.ts");
const generic = compile("src/plugins/remote-settings.ts");
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
    const data = new Map(),
        effects = [],
        acks = [];
    const f = { blocked: false, native: false, reject: null, source: true };
    let mediaRevision = 0;
    const read = (key) => data.get(key) ?? null;
    const write = (key, value) => {
        if (f.reject !== key) data.set(key, value);
        if (f.onWrite) f.onWrite(key);
    };
    const w = {
        __ottActiveProviderDriver: {
            id: "m3u",
            storageKey: (key) => "m3u:" + key,
        },
        __ottDebug: {
            disable() {
                this.enabled = false;
                effects.push("debug-off");
            },
            enable(preserve) {
                assert.equal(preserve, true);
                this.enabled = true;
                effects.push("debug-on");
            },
            enabled: false,
            setHud(value) {
                write("ottplay_debug_hud", value ? "1" : "0");
                effects.push(["hud", value]);
            },
        },
        __ottKiosk: { enabled: () => f.blocked },
        __ottLocalMedia: {
            didRestoreLibrary() {
                mediaRevision++;
                effects.push("invalidate");
            },
            libraryIdentity: () => (f.native ? "tauri" : "browser:"),
            libraryWrite(identity) {
                effects.push("validate");
                const value = identity.slice(8);
                if (value && !/^https?:\/\//.test(value))
                    throw new Error("bad URL");
                return { key: "localMediaEndpoint", value };
            },
            settingsRevision: () => mediaRevision,
        },
        __ottParental: { needs: () => f.pin },
        __ottPlayerSettingsHost: { commit: store.exports.commitSettingsWrites },
        localStorage: {
            getItem: read,
            removeItem: (key) => data.delete(key),
            setItem: write,
        },
        restart: () => effects.push("restart"),
        showPage: () => effects.push("render"),
        sortChannels: (value) => {
            effects.push(["sort", value]);
            if (f.onEffect) f.onEffect();
        },
        stbDelItem: (key) => data.delete(key),
        stbGetItem: read,
        stbSetItem: write,
    };
    w.stbGetNotificationSetting = () => read("sNotificationsEnabled");
    w.__ottRemoteNotifications =
        require("./helpers/remote-notifications.cjs")().createRemoteNotifications(
            w,
            () => {
                throw new Error("unexpected network");
            }
        );
    vm.runInNewContext(extra, { window: w });
    const api = w.__ottRemoteSettingsExtras.create(w, () => {
        effects.push("checkpoint");
        if (f.onCheckpoint) f.onCheckpoint();
    });
    Object.assign(w.__ottPlayerSettingsHost, {
        schema: [],
        source: () => "extras",
        store: {},
    });
    vm.runInNewContext(generic, { window: w });
    let runtime = "page-123";
    const player = w.__ottPlayerSettingsFactory.create(w, () => runtime);
    function request(params, envelope = {}) {
        let result,
            replies = 0;
        player.request(
            {
                action: "player_settings",
                params: { runtime, ...params },
                ...envelope,
            },
            (value) => {
                result = clone(value);
                replies++;
            },
            (effect) => acks.push(effect)
        );
        assert.equal(replies, 1);
        return result;
    }
    return {
        ...f,
        acks,
        api,
        changeRuntime: (value) => {
            runtime = value;
        },
        data,
        effects,
        get: (id) => request({ id, op: "get" }),
        remoteSet: (get, value, envelope) =>
            request(
                {
                    context: get.data.context.token,
                    id: get.data.setting.id,
                    op: "set",
                    revision: get.data.setting.revision,
                    value,
                },
                envelope
            ),
        request,
        set(id, value, capture = api.capture(id)) {
            return api.save(
                id,
                value,
                capture,
                () => f.source,
                (callback) => acks.push(callback)
            );
        },
        state: f,
        w,
    };
}
let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log("PASS extra settings: " + name);
}
test("typed fields expose platform limitations and redact the browser URL", () => {
    const f = fixture();
    assert.equal(f.api.schema.length, 7);
    assert.equal(f.api.descriptor("localMediaEndpoint").sensitive, true);
    f.state.native = true;
    const d = f.api.descriptor("localMediaEndpoint");
    assert.equal(d.access.read, false);
    assert.equal(d.access.write, false);
    assert.equal(d.access.reason, "local_action_required");
    assert.throws(
        () => f.set("localMediaEndpoint", "https://media.test"),
        /local_only/
    );
    assert.equal(f.data.size, 0);
});
test("visibility persists once and reload waits for an acknowledged, still-authorized request", () => {
    const f = fixture();
    const result = f.set("noSelProv", 1);
    assert.equal(f.data.get("noSelProv"), "1");
    assert.deepEqual(f.effects, []);
    assert.deepEqual(clone(result.application), {
        reason: "after_ack",
        state: "deferred",
    });
    f.acks[0]();
    f.acks[0]();
    assert.deepEqual(f.effects, ["checkpoint", "restart"]);
    const other = fixture();
    other.set("noProvParam", 1);
    other.state.pin = true;
    other.acks[0]();
    assert.deepEqual(other.effects, []);
});
test("rejected persistence never invokes an owner effect", () => {
    const f = fixture();
    f.data.set("noSelProv", "0");
    f.state.reject = "noSelProv";
    assert.throws(() => f.set("noSelProv", 1), /storage_failed/);
    assert.equal(f.data.get("noSelProv"), "0");
    assert.equal(f.effects.length, 0);
    assert.equal(f.acks.length, 0);
});
test("default values are explicitly persisted and ABA revisions reject stale drafts", () => {
    const f = fixture();
    f.set("noSelProv", 0);
    assert.equal(f.data.get("noSelProv"), "0");
    const before = f.api.capture("noSelProv");
    f.api.changed("noSelProv");
    f.api.changed("noSelProv");
    assert.throws(() => f.set("noSelProv", 1, before), /revision_conflict/);
});
test("alphabetical order is scoped to a provider and never overwrites a replacement owner", () => {
    const f = fixture();
    f.set("sortAlphabetically", 1);
    assert.equal(f.data.get("m3u:sSortAbc"), "1");
    assert.deepEqual(f.effects, [["sort", 1], "render"]);
    const before = f.api.capture("sortAlphabetically");
    f.w.__ottActiveProviderDriver = {
        id: "m3u",
        storageKey: (key) => "m3u:" + key,
    };
    assert.throws(
        () => f.set("sortAlphabetically", 0, before),
        /revision_conflict/
    );
    assert.equal(f.data.get("m3u:sSortAbc"), "1");
});
test("media URL uses the real owner protocol and invalidates its catalogue only after saving", () => {
    const f = fixture(),
        before = f.api.capture("localMediaEndpoint");
    const result = f.set("localMediaEndpoint", " https://media.test/ ");
    assert.equal(f.data.get("localMediaEndpoint"), "https://media.test");
    assert.equal(result.capture.stored, "https://media.test");
    assert.deepEqual(f.effects, ["validate", "invalidate"]);
    assert.equal(before.current(), false);
    assert.deepEqual(clone(result.application), {
        reason: "manual",
        state: "deferred",
    });
    assert.throws(
        () => f.set("localMediaEndpoint", "file:///bad"),
        /invalid_value/
    );
});
test("debug enable preserves saved HUD choice, and a hidden collector defers HUD display", () => {
    const f = fixture();
    f.data.set("ottplay_debug_hud", "0");
    f.set("debugEnabled", 1);
    assert.equal(f.data.get("ottplay_debug"), "1");
    assert.equal(f.data.get("ottplay_debug_hud"), "0");
    f.set("debugEnabled", 0);
    const hud = f.set("debugHud", 1);
    assert.deepEqual(clone(hud.application), {
        reason: "manual",
        state: "deferred",
    });
    assert.equal(f.data.get("ottplay_debug_hud"), "1");
});
test("an effect failure remains a verified save while a newer value is never reported as ours", () => {
    const f = fixture();
    f.w.sortChannels = () => {
        throw new Error("effect");
    };
    const result = f.set("sortAlphabetically", 1);
    assert.equal(result.capture.stored, 1);
    assert.deepEqual(clone(result.application), {
        reason: "effect_failed",
        state: "failed",
    });
    const g = fixture();
    g.state.onEffect = () => g.data.set("m3u:sSortAbc", "0");
    assert.throws(() => g.set("sortAlphabetically", 1), /source_changed/);
});
test("malformed typed values, source revocation and PIN restrictions cause no writes", () => {
    const f = fixture();
    for (const value of [true, "1", 2, -1])
        assert.throws(() => f.set("noSelProv", value), /invalid_value/);
    assert.throws(() => f.set("localMediaEndpoint", "\ud800"), /invalid_value/);
    f.state.source = false;
    assert.throws(() => f.set("debugEnabled", 1), /revision_conflict/);
    f.state.source = true;
    f.state.pin = true;
    assert.throws(() => f.set("noSelProv", 1), /policy_restricted/);
    assert.equal(f.data.size, 0);
});
function functionSource(file, names) {
    const text = fs.readFileSync(file, "utf8"),
        ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
        found = [];
    function visit(node) {
        if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
            found.push(node.getText(ast).replace(/^export /, ""));
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(found.length, names.length);
    return ts.transpileModule(found.join("\n"), {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
}
test("real visibility confirmation callbacks cannot overwrite a newer remote save", () => {
    const code = functionSource("src/provider/index.ts", [
        "visibilityRevision",
        "confirmProviderVisibility",
        "toggleProviderSelectionVisibility",
        "toggleProviderSettingsVisibility",
    ]);
    for (const [id, fn] of [
        ["noSelProv", "toggleProviderSelectionVisibility"],
        ["noProvParam", "toggleProviderSettingsVisibility"],
    ]) {
        const f = fixture(),
            confirmations = [];
        const context = {
            confirmBox: (_title, done) => confirmations.push(done),
            providerSelectionUnlockCount: 0,
            providerSettingsUnlockCount: 0,
            restart: f.w.restart,
            stbGetItem: f.w.stbGetItem,
            stbSetItem: f.w.stbSetItem,
            window: f.w,
        };
        vm.runInNewContext(code, context);
        for (let i = 0; i < 7; i++) context[fn]();
        assert.equal(confirmations.length, 1);
        f.set(id, 0);
        confirmations[0]();
        assert.equal(f.data.get(id), "0");
        assert.deepEqual(f.effects, []);
    }
});
test("real local media editor rejects its stale draft after catalogue invalidation", () => {
    const f = fixture();
    f.w._ = (value) => value;
    f.w.showEditKey = () => {};
    const context = {
        catalogRevision: 0,
        current: () => true,
        finishLoading() {},
        list() {},
        locked: () => false,
        remoteEndpoint: () => f.w.stbGetItem("localMediaEndpoint") || "",
        render() {},
        revision: 0,
        run() {
            throw new Error("stale editor must not refresh");
        },
        settingsLocked: () => false,
        URL,
        w: f.w,
    };
    vm.runInNewContext(
        functionSource("src/plugins/local-media-ui.ts", ["editServer"]).replace(
            /p\s*\.\s*/g,
            ""
        ),
        context
    );
    context.editServer();
    context.catalogRevision++;
    f.data.set("localMediaEndpoint", "https://newer.test");
    f.w.editvar = "https://stale.test";
    f.w.setEdit();
    assert.equal(f.data.get("localMediaEndpoint"), "https://newer.test");
});
test("real debug enable can preserve HUD preferences while ordinary local toggles still reveal it", () => {
    const calls = [],
        context = {
            _ottDbgEnabled: true,
            _ottDbgLocal: false,
            ottDebugActivate: () => {
                throw new Error("already active");
            },
            ottDebugSetHud: (value) => calls.push(value),
            window: {},
        };
    vm.runInNewContext(
        functionSource("src/debug/playback-debug.ts", ["ottDebugEnable"]),
        context
    );
    context.ottDebugEnable(true);
    assert.deepEqual(calls, []);
    context.ottDebugEnable();
    assert.deepEqual(calls, [true]);
});
test("typed facade exposes extras and confirms persisted writes without a catalogue", () => {
    const f = fixture();
    const schema = f.request({ op: "schema" });
    assert.equal(schema.status, "ok");
    assert.equal(schema.data.settings.length, 7);
    f.w.__ottActiveProviderDriver = null;
    const get = f.get("noSelProv");
    assert.equal(get.data.setting.storage, "default");
    const set = f.remoteSet(get, 1);
    assert.equal(set.status, "ok");
    assert.equal(set.data.persisted, true);
    assert.equal(set.data.setting.persisted_value, 1);
    assert.deepEqual(set.data.application, {
        reason: "after_ack",
        state: "deferred",
    });
    assert.equal(f.effects.length, 0);
    f.acks[0]();
    assert.deepEqual(f.effects, ["checkpoint", "restart"]);
    assert.equal(
        f.get("sortAlphabetically").data.setting.storage,
        "unavailable"
    );
});
test("typed facade redacts endpoint values and reports native local-action requirements", () => {
    const f = fixture();
    f.data.set("localMediaEndpoint", "https://private.test/library");
    const get = f.get("localMediaEndpoint");
    assert.equal(get.data.setting.redacted, true);
    assert(!JSON.stringify(get).includes("private.test"));
    const set = f.remoteSet(get, "https://next.test/library");
    assert.equal(set.status, "ok");
    assert.equal(set.data.setting.redacted, true);
    assert(!JSON.stringify(set).includes("next.test"));
    f.state.native = true;
    const native = f.get("localMediaEndpoint");
    assert.equal(native.data.descriptor.access.reason, "local_action_required");
    const rejected = f.remoteSet(native, "https://unwritten.test");
    assert.equal(rejected.data.reason, "local_only");
    assert.equal(f.data.get("localMediaEndpoint"), "https://next.test/library");
});
test("typed facade enforces revision, runtime and expiry before effects", () => {
    const f = fixture();
    const old = f.get("debugEnabled");
    f.api.changed("debugEnabled");
    assert.equal(f.remoteSet(old, 1).data.reason, "revision_conflict");
    const expiring = f.get("debugEnabled");
    assert.equal(
        f.remoteSet(expiring, 1, { expires_at: 1 }).data.reason,
        "source_changed"
    );
    const stale = f.get("debugEnabled");
    f.changeRuntime("new-page");
    assert.equal(f.remoteSet(stale, 1).data.reason, "source_changed");
    assert.equal(f.data.has("ottplay_debug"), false);
    assert.equal(f.effects.length, 0);
});
test("platform preferences have explicit read-only descriptors and shared contract reasons", () => {
    const f = fixture();
    f.w.__ottPlayerSettingsHost.schema = ["autorun", "hdmiSupport"].map(
        (id) => ({
            defaultValue: 0,
            effects: [],
            id,
            rules: { range: [0, 1] },
            scope: "application",
        })
    );
    const schema = f.request({ op: "schema" });
    for (const id of ["autorun", "hdmiSupport"]) {
        const entry = schema.data.settings.find((entry) => entry.id === id);
        assert.deepEqual(entry.access, {
            read: true,
            reason: "unsupported",
            write: false,
        });
    }
    const contract = JSON.parse(
        fs.readFileSync("tests/fixtures/remote/player-settings-v1.json", "utf8")
    );
    assert(contract.access_reasons.includes("local_action_required"));
    assert(contract.reasons.includes("atomic_patch_required"));
    assert(contract.application_reasons.includes("after_ack"));
    assert(contract.application_matrix.deferred.includes("after_ack"));
});
test("visibility acknowledgement captures its restart owner and rechecks after checkpoint", () => {
    for (const when of ["before", "checkpoint"]) {
        const f = fixture();
        f.set("noSelProv", 1);
        const replace = () => {
            f.w.restart = () => f.effects.push("replacement");
        };
        if (when === "before") replace();
        else f.state.onCheckpoint = replace;
        f.acks[0]();
        assert.deepEqual(f.effects, when === "before" ? [] : ["checkpoint"]);
    }
});
console.log("PASS " + passed + " extra settings scenarios");

test("notification policy alone remains editable in kiosk/PIN mode and confirms its real owner", () => {
    const f = fixture();
    f.state.blocked = true;
    f.state.pin = true;
    const get = f.get("notificationsEnabled");
    assert.equal(get.data.descriptor.access.write, true);
    assert.equal(get.data.setting.value, 1);
    assert.equal(get.data.setting.effective_value, 1);
    const set = f.remoteSet(get, 0);
    assert.equal(set.status, "ok");
    assert.equal(set.data.persisted, true);
    assert.equal(set.data.setting.persisted_value, 0);
    assert.equal(set.data.setting.effective_value, 0);
    assert.deepEqual(set.data.application, { state: "completed" });
    assert.equal(f.w.__ottRemoteNotifications.enabled(), false);
    for (const id of [
        "noSelProv",
        "noProvParam",
        "debugEnabled",
        "sortAlphabetically",
    ]) {
        const before = f.get(id);
        assert.equal(before.data.descriptor.access.write, false);
        assert.notEqual(f.remoteSet(before, 1).status, "ok");
    }
});
test("same-value local or legacy notification setter and ABA invalidate stale typed receipts", () => {
    const f = fixture();
    const first = f.get("notificationsEnabled");
    f.w.__ottRemoteNotifications.setEnabled(true);
    assert.equal(f.remoteSet(first, 0).data.reason, "revision_conflict");
    assert.equal(f.data.has("sNotificationsEnabled"), false);
    const second = f.get("notificationsEnabled");
    f.w.__ottRemoteNotifications.setEnabled(false);
    f.w.__ottRemoteNotifications.setEnabled(true);
    assert.equal(f.remoteSet(second, 0).data.reason, "revision_conflict");
    const legacy = { window: {} };
    vm.runInNewContext(
        compile("src/plugins/remote-notification-settings.ts"),
        legacy
    );
    f.data.set("sNotificationsEnabled", "1");
    const before = f.get("notificationsEnabled");
    let result;
    legacy.window.__ottRemoteNotificationSettings.execute(
        f.w,
        "page-123",
        { enabled: true, operation: "set", runtime: "page-123", version: 1 },
        (r) => (result = r)
    );
    assert.equal(result.status, "ok");
    assert.equal(f.remoteSet(before, 0).data.reason, "revision_conflict");
});
test("notification save failure has no owner effect and an external change is never rolled back", () => {
    const f = fixture();
    f.state.reject = "sNotificationsEnabled";
    const before = f.get("notificationsEnabled"),
        revision = f.w.__ottRemoteNotifications.policyRevision();
    assert.notEqual(f.remoteSet(before, 0).status, "ok");
    assert.equal(f.w.__ottRemoteNotifications.policyRevision(), revision);
    assert.equal(f.w.__ottRemoteNotifications.enabled(), true);
    f.state.reject = null;
    const own = f.remoteSet(f.get("notificationsEnabled"), 0);
    assert.equal(own.status, "ok");
    const restore = f.get("notificationsEnabled");
    f.w.__ottRemoteNotifications.setEnabled(false);
    assert.equal(f.remoteSet(restore, 1).data.reason, "revision_conflict");
    assert.equal(f.w.__ottRemoteNotifications.enabled(), false);
});
