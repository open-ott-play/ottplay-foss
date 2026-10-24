const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync("src/commands/remote-notifications.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
const context = {
    exports: {},
    require: () => ({ remotePlayerInfo: (w) => ({ runtime: w.runtime }) }),
};
vm.runInNewContext(code, context);
const { executeRemoteNotifications, readNotificationsEnabled } =
    context.exports;
function fixture(value = null) {
    const events = [];
    const stored = new Map(
        value === null ? [] : [["sNotificationsEnabled", value]]
    );
    const w = {
        __ottRemoteNotifications: {
            poll: () => events.push("poll"),
            setEnabled: (value) => events.push(["enabled", value]),
        },
        runtime: "runtime-1",
        stbGetPersistedItem: (key) => {
            events.push("read");
            return stored.get(key) ?? null;
        },
        stbSetItem: (key, value) => {
            events.push("write");
            stored.set(key, value);
        },
    };
    const call = (params) => {
        let result;
        executeRemoteNotifications(
            w,
            w.runtime,
            params,
            (value) => (result = JSON.parse(JSON.stringify(value)))
        );
        return result;
    };
    return { call, events, stored, w };
}
const params = (operation = "get", extra = {}) => ({
    operation,
    runtime: "runtime-1",
    version: 1,
    ...extra,
});
{
    const f = fixture();
    assert.equal(readNotificationsEnabled(f.w), true);
    assert.deepEqual(f.call(params()).data, {
        enabled: true,
        operation: "get",
        persisted: true,
        runtime: "runtime-1",
        version: 1,
    });
    assert.equal(f.events.includes("write"), false);
    f.events.length = 0;
    assert.equal(f.call(params("set", { enabled: false })).status, "ok");
    assert.equal(f.stored.get("sNotificationsEnabled"), "0");
    assert.deepEqual(f.events, [
        "read",
        "write",
        "read",
        ["enabled", false],
        "poll",
    ]);
    assert.equal(readNotificationsEnabled(f.w), false);
    assert.equal(f.call(params("set", { enabled: true })).data.enabled, true);
    assert.equal(f.stored.get("sNotificationsEnabled"), "1");
    assert.equal(readNotificationsEnabled(f.w), true);
}
for (const bad of [
    null,
    [],
    {},
    params("set"),
    params("set", { enabled: 1 }),
    params("get", { enabled: true }),
    params("set", { enabled: false, extra: 1 }),
    params("get", { version: 2 }),
]) {
    const f = fixture("0");
    assert.equal(f.call(bad).data.error, "invalid_request");
    assert.equal(f.events.includes("write"), false);
}
{
    const f = fixture("0");
    assert.equal(
        f.call(params("set", { enabled: true, runtime: "old-runtime" })).data
            .error,
        "runtime_mismatch"
    );
    assert.deepEqual(f.events, []);
}
for (const fault of ["write", "read", "volatile", "corrupt"]) {
    const f = fixture("0");
    if (fault === "write")
        f.w.stbSetItem = () => {
            throw Error("disk full");
        };
    if (fault === "read")
        f.w.stbGetPersistedItem = () => {
            throw Error("blocked");
        };
    if (fault === "volatile") f.w.stbSetItem = () => {};
    if (fault === "corrupt")
        f.stored.set("sNotificationsEnabled", "not-a-boolean");
    assert.equal(
        f.call(params("set", { enabled: true })).data.error,
        "storage_unavailable"
    );
    assert.equal(
        f.events.some((x) => Array.isArray(x) && x[0] === "enabled"),
        false
    );
    assert.equal(f.events.includes("poll"), false);
}
{
    const f = fixture("0");
    delete f.w.__ottRemoteNotifications;
    assert.equal(
        f.call(params("set", { enabled: true })).data.error,
        "unsupported"
    );
    assert.equal(f.stored.get("sNotificationsEnabled"), "0");
}
{
    const f = fixture("0");
    f.w.stbGetPersistedItem = () => {
        throw Error("blocked");
    };
    assert.equal(readNotificationsEnabled(f.w), false);
    const reboot = fixture("0");
    assert.equal(readNotificationsEnabled(reboot.w), false);
    // No foreground, player or kiosk dependency: the same policy works while asleep.
    reboot.w.__ottKiosk = { enabled: () => true };
    reboot.w.stbIsStandby = () => true;
    assert.equal(reboot.call(params("set", { enabled: true })).status, "ok");
}
console.log(
    "PASS global notification policy: durable readback, runtime fencing, failure isolation, default and standby"
);
