"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const contract = require("./fixtures/remote/player-settings-patch-v1.json");
const clone = (value) => JSON.parse(JSON.stringify(value));
function source(path) {
    const result = ts.transpileModule(fs.readFileSync(path, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(result, { ecmaVersion: 5 });
    return result;
}
const domain = { exports: {} };
vm.runInNewContext(source("src/settings/store.ts"), domain);
const plugin = source("src/plugins/remote-settings-lifecycle.ts");
function fixture() {
    let now = 1000000,
        sequence = 0;
    const data = new Map(),
        timers = new Map(),
        calls = [],
        acks = [];
    const f = { locked: false, runtime: "page-123", scope: "m3u:1" };
    const fields = Object.assign({}, ...Object.values(contract.groups));
    const schema = Object.entries(fields).map(([id, meta]) => ({
        defaultValue: meta.type === "integer" ? 0 : "",
        effects: [],
        id,
        key: id,
        scope: "application",
        validate: (v) =>
            meta.type === "integer"
                ? v === 0 || v === 1
                : typeof v === "string",
    }));
    function storage(key) {
        return {
            read: () => data.get(key) ?? null,
            remove: () => data.delete(key),
            write: (value) => {
                if (f.reject !== key) data.set(key, value);
            },
        };
    }
    const store = domain.exports.createSettingsStore(schema, {
        context: () => f.scope,
        effect: () => {},
        storage: (entry) => storage(entry.id),
    });
    const w = {
        __ottActiveProviderDriver: {
            configuration: () => ({ active: 0 }),
            id: "m3u",
        },
        __ottKiosk: { enabled: () => f.locked },
        __ottPlayerSettingsHost: { schema, source: () => f.scope, store },
        __ottRemoteLifecycleHost: {
            applied: () => !!f.ownerReady,
            apply(group, values, done) {
                calls.push({ done, group, values: clone(values) });
            },
            journal: (group) => storage("journal:" + group),
            validate(group, values) {
                const expected = contract.groups[group];
                if (!expected || Object.keys(values).length !== 3) return null;
                for (const [id, meta] of Object.entries(expected)) {
                    const value = values[id];
                    if (
                        meta.type === "integer"
                            ? value !== 0 && value !== 1
                            : typeof value !== "string" ||
                              value.length > meta.max_utf8_bytes
                    )
                        return null;
                }
                return values;
            },
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        setTimeout(fn, ms) {
            const id = ++sequence;
            timers.set(id, { fn, ms });
            return id;
        },
    };
    vm.runInNewContext(plugin, { Date: { now: () => now }, window: w });
    let api = w.__ottRemoteLifecycleFields.create(w, () => f.runtime);
    w.__ottRemoteSettingsLifecycle = api;
    vm.runInNewContext(source("src/plugins/remote-settings.ts"), { window: w });
    const generic = w.__ottPlayerSettingsFactory.create(w, () => f.runtime);
    Object.assign(f, {
        acks,
        advance(ms) {
            now += ms;
        },
        calls,
        capture(id) {
            return api.capture(id);
        },
        data,
        expire() {
            for (const [id, timer] of [...timers])
                if (timer.ms === 120000) {
                    timers.delete(id);
                    timer.fn();
                }
        },
        generic(params) {
            let result;
            generic.request(
                { params },
                (value) => {
                    result = clone(value);
                },
                (effect) => acks.push(effect)
            );
            return result;
        },
        get(group = "command_server") {
            return this.request({ group, op: "get", runtime: this.runtime });
        },
        reboot() {
            api = w.__ottRemoteLifecycleFields.create(w, () => f.runtime);
            api.recover();
        },
        request(params, extra = {}, ack = true) {
            let response,
                count = 0;
            api.patch(
                { action: "player_settings_patch", params, ...extra },
                (r) => {
                    response = clone(r);
                    count++;
                },
                ack ? (effect) => acks.push(effect) : undefined
            );
            assert.equal(count, 1);
            return response;
        },
        save(id, value, capture) {
            return api.save(
                id,
                value,
                capture,
                () => !f.locked,
                (effect) => acks.push(effect)
            );
        },
        seed(group = "command_server") {
            const initial =
                group === "command_server"
                    ? {
                          commandServerAddress:
                              "https://old.example/api/command",
                          commandServerEnabled: 1,
                          commandServerToken:
                              "old_device_token_01234567890123456789",
                      }
                    : {
                          localCmdUrl: "https://old.example/local",
                          localHttpDeviceCode:
                              "old_device_token_01234567890123456789",
                          localHttpEnabled: 1,
                      };
            for (const [id, v] of Object.entries(initial))
                data.set(id, String(v));
            store.reload();
            return initial;
        },
        set(get, values, extra, ack = true) {
            return this.request(
                {
                    context: get.data.context.token,
                    group: get.data.group,
                    op: "set",
                    revision: get.data.revision,
                    runtime: get.data.runtime,
                    values,
                },
                extra,
                ack
            );
        },
        store,
        timers,
        w,
    });
    return f;
}
let count = 0;
function test(name, fn) {
    fn();
    count++;
    console.log("OK: " + name);
}
test("group save is durable before ACK, applies once after ACK, then discards private tuples", () => {
    const f = fixture();
    f.seed();
    const result = f.set(f.get(), {
        commandServerAddress: "https://new.example/api/command",
        commandServerToken: "new_device_token_01234567890123456789",
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(result.data.application, {
        reason: "after_ack",
        state: "deferred",
    });
    assert.deepEqual(result.data.transition, { state: "pending" });
    assert.equal(f.calls.length, 0);
    assert.equal(
        f.data.get("commandServerAddress"),
        "https://new.example/api/command"
    );
    assert.ok(!JSON.stringify(result).includes("new_device_token"));
    f.acks[0]();
    assert.equal(f.calls.length, 1);
    f.calls[0].done();
    assert.deepEqual(f.get().data.transition, { state: "applied" });
    assert.ok(!f.data.get("journal:command_server").includes("device_token"));
    f.acks[0]();
    assert.equal(f.calls.length, 1);
});
test("failed handshake restores all previous fields through the real owner", () => {
    const f = fixture(),
        initial = f.seed();
    f.set(f.get(), {
        commandServerToken: "new_device_token_01234567890123456789",
    });
    f.acks[0]();
    f.calls[0].done("authorization_failed");
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[1].values, initial);
    f.calls[1].done();
    assert.deepEqual(f.get().data.transition, {
        reason: "authorization_failed",
        state: "rolled_back",
    });
    assert.equal(f.data.get("commandServerToken"), initial.commandServerToken);
});
test("missing ACK rolls back stored intent without touching the live owner", () => {
    const f = fixture(),
        initial = f.seed();
    f.set(f.get(), { commandServerEnabled: 0 });
    assert.equal(
        f.set(f.get(), { commandServerEnabled: 1 }).data.reason,
        "revision_conflict"
    );
    f.expire();
    assert.equal(f.calls.length, 0);
    assert.equal(
        f.data.get("commandServerEnabled"),
        String(initial.commandServerEnabled)
    );
    assert.deepEqual(f.get().data.transition, {
        reason: "ack_timeout",
        state: "rolled_back",
    });
    f.acks[0]();
    assert.equal(f.calls.length, 0);
});
test("newer tuple edits suppress pending apply and late rollback", () => {
    const f = fixture();
    f.seed();
    f.set(f.get(), { commandServerEnabled: 0 });
    f.data.set("commandServerToken", "human_new_device_token_0123456789012345");
    f.store.reload();
    f.acks[0]();
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.get().data.transition, {
        reason: "superseded",
        state: "failed",
    });
    const g = fixture();
    g.seed();
    g.set(g.get(), { commandServerEnabled: 0 });
    g.acks[0]();
    g.data.set("commandServerToken", "human_new_device_token_0123456789012345");
    g.store.reload();
    g.calls[0].done("handshake_timeout");
    assert.equal(g.calls.length, 1);
    assert.deepEqual(g.get().data.transition, {
        reason: "superseded",
        state: "failed",
    });
});
test("every companion value and source is bound by the group receipt", () => {
    for (const change of [
        (f) => {
            f.data.set("commandServerToken", "changed");
        },
        (f) => (f.scope = "m3u:2"),
        (f) => {
            f.w.__ottActiveProviderDriver = {
                configuration: () => ({ active: 0 }),
                id: "m3u",
            };
        },
        (f) => f.advance(120000),
    ]) {
        const f = fixture();
        f.seed();
        const read = f.get();
        change(f);
        const r = f.set(read, { commandServerEnabled: 0 });
        assert.equal(r.status, "rejected");
        assert.equal(f.acks.length, 0);
    }
    const f = fixture();
    f.seed();
    const c = f.capture("commandServerEnabled");
    f.data.set("commandServerToken", "changed");
    assert.equal(c.current(), false);
});
test("fresh tuple reads preserve direct legacy UI writes before registry cache publication", () => {
    const f = fixture();
    f.seed();
    const token = "legacy_ui_token_01234567890123456789012";
    f.data.set("commandServerToken", token);
    const result = f.set(f.get(), { commandServerEnabled: 0 });
    assert.equal(result.status, "ok");
    assert.equal(f.data.get("commandServerToken"), token);
    f.acks[0]();
    assert.equal(f.calls[0].values.commandServerToken, token);
});
test("invalid fields, primitive types, missing ACK support, runtime and policy reject without mutation", () => {
    for (const patch of [
        {},
        { token: "x" },
        { commandServerEnabled: true },
        { commandServerEnabled: "1" },
        { commandServerToken: null },
        { commandServerToken: "x".repeat(257) },
    ]) {
        const f = fixture();
        f.seed();
        const before = [...f.data];
        assert.equal(f.set(f.get(), patch).status, "rejected");
        assert.deepEqual([...f.data], before);
    }
    const f = fixture();
    f.seed();
    assert.equal(
        f.set(f.get(), { commandServerEnabled: 0 }, {}, false).data.reason,
        "unsupported"
    );
    const read = f.get();
    f.locked = true;
    assert.equal(
        f.set(read, { commandServerEnabled: 0 }).data.reason,
        "policy_restricted"
    );
    f.locked = false;
    f.runtime = "page-456";
    assert.equal(
        f.set(read, { commandServerEnabled: 0 }).data.reason,
        "runtime_changed"
    );
});
test("failed storage commit restores previous bytes and never schedules an effect", () => {
    const f = fixture();
    f.seed();
    f.reject = "commandServerToken";
    const r = f.set(f.get(), {
        commandServerAddress: "https://new.example",
        commandServerToken: "new_device_token_01234567890123456789",
    });
    assert.equal(r.data.reason, "storage_failed");
    assert.equal(f.acks.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(
        f.data.get("commandServerAddress"),
        "https://old.example/api/command"
    );
    assert.equal(f.data.has("journal:command_server"), false);
});
test("boot recovers only an owned pending desired tuple", () => {
    const f = fixture();
    f.seed();
    f.set(f.get(), { commandServerEnabled: 0 });
    f.reboot();
    assert.equal(f.calls.length, 1);
    f.calls[0].done();
    assert.equal(f.get().data.transition.state, "applied");
    const g = fixture();
    g.seed();
    g.set(g.get(), { commandServerEnabled: 0 });
    g.data.set("commandServerToken", "newer_token");
    g.store.reload();
    g.reboot();
    assert.equal(g.calls.length, 0);
    assert.equal(g.get().data.transition.reason, "superseded");
});
test("scalar save uses the same guarded group engine", () => {
    const f = fixture();
    f.seed();
    const r = f.save(
        "commandServerEnabled",
        0,
        f.capture("commandServerEnabled")
    );
    assert.equal(r.changed, true);
    assert.equal(r.capture.value, 0);
    assert.equal(f.calls.length, 0);
    f.acks[0]();
    assert.equal(f.calls[0].values.commandServerEnabled, 0);
});
test("the real typed scalar adapter forwards after-ACK ownership to the grouped engine", () => {
    const f = fixture();
    f.seed();
    const get = f.generic({
        id: "commandServerEnabled",
        op: "get",
        runtime: f.runtime,
    });
    assert.equal(get.status, "ok");
    const result = f.generic({
        context: get.data.context.token,
        id: "commandServerEnabled",
        op: "set",
        revision: get.data.setting.revision,
        runtime: f.runtime,
        value: 0,
    });
    assert.equal(result.status, "ok");
    assert.deepEqual(result.data.application, {
        reason: "after_ack",
        state: "deferred",
    });
    assert.equal(result.data.setting.persisted_value, 0);
    assert.equal(f.calls.length, 0);
    f.acks[0]();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].values.commandServerEnabled, 0);
});
test("local HTTP group has the same redaction and transition rules", () => {
    const f = fixture();
    f.seed("local_http");
    const r = f.set(f.get("local_http"), { localHttpEnabled: 0 });
    assert.equal(r.status, "ok");
    assert.equal(r.data.settings.filter((s) => s.redacted === true).length, 2);
    assert.ok(r.data.settings.every((s) => !("revision" in s)));
    f.acks[0]();
    f.calls[0].done();
    assert.equal(f.get("local_http").data.transition.state, "applied");
});
test("unchanged tuples persist without reconnecting and active scalar credential edits require a patch", () => {
    const f = fixture();
    f.ownerReady = true;
    f.seed();
    const result = f.set(f.get(), { commandServerEnabled: 1 });
    assert.equal(result.status, "ok");
    assert.equal(result.data.changed, false);
    assert.deepEqual(result.data.application, { state: "completed" });
    assert.equal(result.data.transition.state, "applied");
    assert.equal(f.acks.length, 0);
    assert.equal(
        f.save(
            "commandServerToken",
            "other_device_token_0123456789012345678",
            f.capture("commandServerToken")
        ).reason,
        "atomic_patch_required"
    );
});
test("unchanged saved tuples reconnect after ACK when the actual owner is not ready", () => {
    const f = fixture();
    f.seed();
    const result = f.set(f.get(), { commandServerEnabled: 1 });
    assert.equal(result.data.changed, false);
    assert.deepEqual(result.data.application, {
        reason: "after_ack",
        state: "deferred",
    });
    assert.equal(result.data.transition.state, "pending");
    assert.equal(f.calls.length, 0);
    f.acks[0]();
    f.calls[0].done();
    assert.equal(f.get().data.transition.state, "applied");
});
test("raw changes without reload and same-value ABA suppress a deferred operation", () => {
    for (const edit of [
        (f) => f.data.set("commandServerToken", "newer_raw"),
        (f) => {
            f.store.observe("commandServerEnabled", 1);
            f.store.observe("commandServerEnabled", 0);
        },
    ]) {
        const f = fixture();
        f.seed();
        f.set(f.get(), { commandServerEnabled: 0 });
        edit(f);
        f.acks[0]();
        assert.equal(f.calls.length, 0);
    }
});
test("synchronous apply failure rolls back; throwing rollback remains honestly failed", () => {
    for (const rollbackThrows of [false, true]) {
        const f = fixture(),
            initial = f.seed();
        let attempt = 0;
        f.w.__ottRemoteLifecycleHost.apply = (_group, _values, done) => {
            if (++attempt === 1 || rollbackThrows)
                throw new Error("private owner detail");
            done();
        };
        f.set(f.get(), { commandServerEnabled: 0 });
        f.acks[0]();
        assert.equal(
            f.data.get("commandServerEnabled"),
            String(initial.commandServerEnabled)
        );
        assert.equal(
            f.get().data.transition.state,
            rollbackThrows ? "failed" : "rolled_back"
        );
        assert.ok(!f.data.get("journal:command_server").includes("private"));
    }
});
test("duplicate old ACK does not cancel a newer pending operation", () => {
    const f = fixture();
    f.seed();
    f.set(f.get(), { commandServerEnabled: 0 });
    f.acks[0]();
    f.calls[0].done();
    f.set(f.get(), { commandServerEnabled: 1 });
    f.acks[0]();
    f.expire();
    assert.equal(f.get().data.transition.reason, "ack_timeout");
    assert.equal(f.data.get("commandServerEnabled"), "0");
});
test("policy revocation after persistence prevents the deferred owner change", () => {
    const f = fixture();
    f.seed();
    f.set(f.get(), { commandServerEnabled: 0 });
    f.locked = true;
    f.acks[0]();
    assert.equal(f.calls.length, 0);
    assert.equal(f.data.get("commandServerEnabled"), "1");
    assert.equal(f.get().data.transition.reason, "superseded");
    const boot = fixture();
    boot.seed();
    boot.set(boot.get(), { commandServerEnabled: 0 });
    boot.locked = true;
    boot.reboot();
    assert.equal(boot.calls.length, 0);
    assert.equal(boot.data.get("commandServerEnabled"), "1");
});
console.log(`OK: ${count} lifecycle transaction scenarios`);
