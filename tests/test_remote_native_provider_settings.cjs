"use strict";
const assert = require("node:assert/strict");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
const key = "edem-key-1";
const portal = "portal::[key:PRIVATE_ONE]https://portal.example/api/";
const nextPortal = "portal::[key:PRIVATE_TWO]https://other.example/api/";
const compareKeys = [
    "context",
    "matched",
    "number",
    "provider",
    "revision",
    "runtime",
    "version",
];
const writeKeys = [
    "context",
    "fields",
    "number",
    "provider",
    "reload_required",
    "reloaded",
    "revision",
    "runtime",
    "saved",
    "version",
];
function create(active = false) {
    const f = fixture({
            edkey: key,
            edlist: "0",
            edvpurl: portal,
        }),
        w = f.host;
    const state = {
        denied: false,
        locked: false,
        reloads: 0,
        runtime: "page-123",
        scope: "scope-1",
        standby: false,
    };
    w.__ottPlayerSettingsHost = { source: () => state.scope };
    w.__ottStandby = { blocked: () => state.standby };
    w.__ottKiosk = { enabled: () => state.locked };
    w.__ottActiveProviderDriver = active
        ? {
              configuration: () => null,
              id: "edem",
              settingsChanged() {},
          }
        : { configuration: () => ({ active: 0 }), id: "m3u" };
    w.loadChannels = () => state.reloads++;
    runtime(w, "src/plugins/remote-provider-fields.ts");
    runtime(w, "src/plugins/remote-provider-settings.ts");
    const api = w.__ottRemoteProviderSettings.create(w, () => state.runtime, {
        allowed: () => !state.denied,
        url: () => true,
    });
    function request(action, params) {
        let result,
            replies = 0;
        api.request({ action, params }, (value) => {
            result = JSON.parse(JSON.stringify(value));
            replies++;
        });
        assert.equal(replies, 1);
        assert(!JSON.stringify(result).includes("PRIVATE"));
        return result;
    }
    return Object.assign(f, {
        request,
        compare(settings = { key: key, list: 0, portal: nextPortal }) {
            return request("settings_compare", {
                number: 1,
                provider: "edem",
                runtime: state.runtime,
                settings: settings,
                version: 1,
            });
        },
        state,
        write(compare, settings = { key: key, list: 0, portal: nextPortal }) {
            return request("provider_settings", {
                context: compare.data.context,
                number: 1,
                provider: "edem",
                revision: compare.data.revision,
                runtime: compare.data.runtime,
                settings: settings,
                version: 1,
            });
        },
    });
}
let passed = 0;
function check(name, test) {
    test();
    passed++;
    console.log("OK: " + name);
}
check("compare reports an exact, secret-free slot snapshot", () => {
    const f = create(),
        compare = f.compare();
    assert.equal(compare.status, "ok");
    assert.deepEqual(
        Object.keys(compare.data).sort(),
        compareKeys.slice().sort()
    );
    assert.equal(compare.data.matched, false);
    assert.equal(compare.data.number, 1);
    assert.equal(compare.data.provider, "edem");
    assert.match(compare.data.context, /^[A-Za-z0-9_.:-]{1,128}$/);
    assert.match(compare.data.revision, /^[A-Za-z0-9_.:-]{1,128}$/);
    assert.equal(f.compare({ edkey: undefined }).status, "rejected");
});
check("an already saved slot matches without writing", () => {
    const f = create(),
        compare = f.compare({ key: key, list: 0, portal: portal });
    assert.equal(compare.status, "ok");
    assert.equal(compare.data.matched, true);
    const save = f.write(compare, { key: key, list: 0, portal: portal });
    assert.equal(save.status, "ok");
    assert.equal(save.data.saved, true);
    assert.equal(save.data.reloaded, false);
    assert.equal(f.saved.get("edvpurl"), portal);
});
check("inactive save writes the slot bytes without switching provider", () => {
    const f = create(),
        before = f.host.__ottActiveProviderDriver;
    const save = f.write(f.compare());
    assert.equal(save.status, "ok");
    assert.deepEqual(Object.keys(save.data).sort(), writeKeys.slice().sort());
    assert.equal(save.data.saved, true);
    assert.equal(save.data.reloaded, false);
    assert.equal(save.data.reload_required, false);
    assert.deepEqual(save.data.fields, ["key", "list", "portal"]);
    assert.equal(f.saved.get("edkey"), key);
    assert.equal(f.saved.get("edlist"), "0");
    assert.equal(f.saved.get("edvpurl"), nextPortal);
    assert.equal(f.state.reloads, 0);
    assert.equal(f.host.__ottActiveProviderDriver, before);
    assert.equal(f.compare().data.matched, true);
});
check("the native save reuses the driver codec and one storage transaction", () => {
    const f = create(),
        writes = [];
    const commit = f.host.commitSettingsWrites;
    f.host.commitSettingsWrites = (batch, admitted, rollback) => {
        writes.push(batch.map((row) => row.storage.key));
        return commit(batch, admitted, rollback);
    };
    const settings = { key: key, list: 2, portal: nextPortal };
    const save = f.write(f.compare(settings), settings);
    assert.equal(save.status, "ok");
    assert.equal(writes.length, 1);
    assert.equal(
        JSON.stringify(Array.from(writes[0]).sort()),
        '["edkey","edlist","edvpurl"]'
    );
    assert.equal(f.saved.get("edlist"), "2");
});
check("active Edem slot reloads the catalogue once", () => {
    const f = create(true),
        save = f.write(f.compare());
    assert.equal(save.status, "ok");
    assert.equal(save.data.reloaded, true);
    assert.equal(save.data.reload_required, false);
    assert.equal(f.state.reloads, 1);
});
check("standby defers the active reload instead of fetching media", () => {
    const f = create(true);
    f.state.standby = true;
    const save = f.write(f.compare());
    assert.equal(save.status, "ok");
    assert.equal(save.data.reloaded, false);
    assert.equal(save.data.reload_required, true);
    assert.equal(f.state.reloads, 0);
});
check("unsupported slot numbers, values and providers reject without writing", () => {
    const f = create(),
        before = f.saved.get("edvpurl");
    for (const params of [
        { number: 2 },
        { settings: { key: "bad\u0000key" } },
        { settings: { key: "x".repeat(4097) } },
        { settings: { list: "1" } },
        { settings: { list: 4 } },
        { settings: { list: 1.5 } },
        { settings: { portal: "https://portal.example/api/" } },
        { settings: {} },
        { provider: "vportal" },
        { version: 2 },
        { runtime: "page-999" },
    ]) {
        const request = {
            number: 1,
            provider: "edem",
            runtime: f.state.runtime,
            settings: { portal: nextPortal },
            version: 1,
        };
        Object.assign(request, params);
        const reply = f.request("settings_compare", request);
        assert.equal(reply.status, "rejected", JSON.stringify(params));
        assert.equal(typeof reply.data.reason, "string");
        assert.equal(f.saved.get("edvpurl"), before);
    }
    assert.equal(f.saved.get("edkey"), key);
    assert.equal(f.write(f.compare()).status, "ok");
});
check("policy, runtime, source and receipt guards block stale writes", () => {
    const f = create();
    f.state.denied = true;
    assert.equal(f.compare().status, "unsupported");
    f.state.denied = false;
    f.state.locked = true;
    const lockedWrite = f.write(f.compare());
    assert.equal(lockedWrite.status, "rejected");
    assert.equal(lockedWrite.data.reason, "policy_restricted");
    f.state.locked = false;
    const before = f.compare();
    f.state.runtime = "page-456";
    assert.equal(f.write(before).data.reason, "runtime_changed");
    f.state.runtime = "page-123";
    const staleScope = f.compare();
    f.state.scope = "scope-2";
    assert.equal(f.write(staleScope).data.reason, "source_changed");
    f.state.scope = "scope-1";
    const reusable = f.compare();
    assert.equal(f.write(reusable).status, "ok");
    assert.equal(f.write(reusable).status, "rejected");
});
check("storage failure keeps the saved bytes and reports no success", () => {
    const f = create(),
        write = f.host.stbSetItem,
        before = f.saved.get("edvpurl");
    f.host.stbSetItem = () => {
        throw new Error("denied");
    };
    const save = f.write(f.compare());
    assert.equal(save.status, "rejected");
    assert.equal(save.data.reason, "storage_failed");
    assert.equal(f.saved.get("edvpurl"), before);
    assert.equal(f.state.reloads, 0);
    f.host.stbSetItem = write;
});
console.log("OK: " + passed + " native provider settings scenarios");
