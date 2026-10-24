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
        stbGetNotificationSetting: () => {
            events.push("read");
            return stored.get("sNotificationsEnabled") ?? null;
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
    assert.deepEqual(f.events, ["write", "read", ["enabled", false], "poll"]);
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
    params("get", { runtime: "x".repeat(65) }),
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
    assert.equal(
        f.call(params("set", { enabled: true, runtime: "old-runtime" })).data
            .runtime,
        "old-runtime"
    );
    assert.deepEqual(
        f.call(params("set", { enabled: true, runtime: "old-runtime" })),
        {
            data: {
                error: "runtime_mismatch",
                operation: "set",
                runtime: "old-runtime",
                version: 1,
            },
            status: "rejected",
        }
    );
    assert.deepEqual(f.events, []);
}
for (const fault of ["write", "read", "volatile"]) {
    const f = fixture("0");
    if (fault === "write")
        f.w.stbSetItem = () => {
            throw Error("disk full");
        };
    if (fault === "read")
        f.w.stbGetNotificationSetting = () => {
            throw Error("blocked");
        };
    if (fault === "volatile") f.w.stbSetItem = () => {};
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
    f.w.stbGetNotificationSetting = () => {
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

// Exercise the actual storage module, including its legacy permissive reader.
const { JSDOM } = require("jsdom");
const storageCode = ts.transpileModule(
    fs.readFileSync("src/storage/index.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
function realStorage(options = {}) {
    const dom = new JSDOM("", { url: "https://notification-storage.fixture/" });
    const w = dom.window;
    if (options.initial)
        for (const [key, value] of Object.entries(options.initial))
            w.localStorage.setItem(key, value);
    if (options.cookies)
        for (const cookie of options.cookies) w.document.cookie = cookie;
    if (options.blocked)
        Object.defineProperty(w, "localStorage", {
            get() {
                throw Error("unavailable");
            },
        });
    if (options.readThrows)
        Object.defineProperty(w, "localStorage", {
            value: {
                getItem() {
                    throw Error("unavailable");
                },
            },
        });
    if (options.cookieThrows)
        Object.defineProperty(w.document, "cookie", {
            get() {
                throw Error("unavailable");
            },
        });
    const loaded = { document: w.document, exports: {}, window: w };
    vm.runInNewContext(storageCode, loaded);
    w.stbGetNotificationSetting = loaded.exports.stbGetNotificationSetting;
    w.stbSetItem = loaded.exports.stbSetItem;
    w.__ottRemoteNotifications = { poll() {}, setEnabled() {} };
    return { api: loaded.exports, dom, w };
}
{
    const f = realStorage();
    assert.equal(f.api.stbGetNotificationSetting(), null);
    assert.equal(
        readNotificationsEnabled(f.w),
        true,
        "known missing durable key defaults on"
    );
    f.dom.window.close();
}
for (const options of [
    { blocked: true },
    { readThrows: true },
    { cookieThrows: true },
    { initial: { ottplaySettingsJournalV1: '{"version":0}' } },
    {
        cookies: ["ottplayStorageFallback=broken"],
        initial: { sNotificationsEnabled: "1" },
    },
]) {
    const f = realStorage(options);
    assert.throws(() => f.api.stbGetNotificationSetting());
    assert.equal(
        readNotificationsEnabled(f.w),
        false,
        "unavailable/recovery state never defaults on"
    );
    let reply;
    executeRemoteNotifications(f.w, "runtime-1", params(), (value) => {
        reply = value;
    });
    assert.equal(reply.data.error, "storage_unavailable");
    f.dom.window.close();
}
{
    const f = realStorage({ blocked: true });
    assert.equal(
        f.api.stbGetPersistedItem("sNotificationsEnabled"),
        null,
        "reproduces legacy unknown/null result"
    );
    let reply;
    executeRemoteNotifications(
        f.w,
        "runtime-1",
        params("set", { enabled: false }),
        (value) => {
            reply = value;
        }
    );
    assert.equal(
        reply.status,
        "ok",
        "explicit durable cookie-backed choice can recover unavailable native storage"
    );
    assert.equal(f.api.stbGetNotificationSetting(), "0");
    assert.equal(readNotificationsEnabled(f.w), false);
    f.dom.window.close();
}
console.log(
    "PASS actual storage notification policy: known absence, blocked reads, durable cookie fallback, corruption and recovery quarantine"
);

for (const broken of ["%", "deleted"]) {
    const f = realStorage({
        blocked: true,
        initial: { sNotificationsEnabled: "0" },
    });
    f.w.stbSetItem("sNotificationsEnabled", "0");
    assert.equal(f.api.stbGetNotificationSetting(), "0");
    f.w.document.cookie =
        broken === "deleted"
            ? "sNotificationsEnabled=; Max-Age=0; path=/"
            : "sNotificationsEnabled=%; path=/";
    assert.throws(
        () => f.api.stbGetNotificationSetting(),
        /storage_unavailable/
    );
    assert.equal(
        readNotificationsEnabled(f.w),
        false,
        "unreadable override never resets saved OFF"
    );
    let reply;
    executeRemoteNotifications(
        f.w,
        "runtime-1",
        params(),
        (value) => (reply = value)
    );
    assert.equal(reply.data.error, "storage_unavailable");
    f.dom.window.close();
}
console.log("PASS notification cookie override corruption fails closed");
