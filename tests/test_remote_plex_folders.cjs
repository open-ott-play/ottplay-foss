"use strict";
const assert = require("node:assert/strict");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
const contract = require("./fixtures/remote/plex-folders-v1.json");
let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log("PASS Plex folders: " + name);
}
function setup(count = 0) {
    const items = Array.from({ length: count }, (_, i) => ({
        path: `/library/sections/${i + 1}/all`,
        title: `Folder ${i + 1}`,
    }));
    const f = fixture({
        plexcfg: JSON.stringify({
            address: "https://plex.test",
            folderSelection: true,
            folders: items,
            playback: "auto",
            token: "private-token",
        }),
    });
    const driver = f.mount("plex");
    runtime(f.host, "src/plugins/remote-provider-fields.ts");
    runtime(f.host, "src/plugins/remote-plex-folders.ts");
    let now = "runtime-1";
    const api = f.host.__ottRemotePlexFolders.create(f.host, () => now);
    function request(params, extra = {}) {
        let result;
        api.request(
            { params: { runtime: now, ...params }, ...extra },
            (value) => (result = JSON.parse(JSON.stringify(value)))
        );
        return result;
    }
    function list() {
        return request({ op: "list" });
    }
    function mutate(op, params = {}) {
        const read = list();
        assert.equal(read.status, "ok");
        return request({
            context: read.data.context.token,
            op,
            revision: read.data.revision,
            ...params,
        });
    }
    return {
        ...f,
        driver,
        list,
        mutate,
        request,
        setRuntime(value) {
            now = value;
        },
    };
}
test("1000 selections page without truncation under one revision", () => {
    const f = setup(1000),
        all = [];
    let result = f.list(),
        revision = result.data.revision,
        context = result.data.context.token;
    for (;;) {
        assert.equal(result.status, "ok");
        assert.equal(result.data.total, 1000);
        assert.equal(result.data.revision, revision);
        assert.equal(result.data.context.token, context);
        assert(result.data.items.length <= 10);
        all.push(...result.data.items);
        if (!result.data.next_cursor) break;
        result = f.request({ cursor: result.data.next_cursor, op: "list" });
    }
    assert.equal(all.length, 1000);
    assert.equal(new Set(all.map((row) => row.path)).size, 1000);
    assert.equal(f.requests.length, 0);
});
test("add, duplicate title preservation, remove and clear use real saved config", () => {
    const f = setup(1);
    let result = f.mutate("add", {
        path: "/library/sections/2/all",
        title: "New folder",
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(result.data.total, 2);
    assert.equal(result.data.changed, true);
    assert.deepEqual(result.data.application, {
        reason: "next_catalogue",
        state: "deferred",
    });
    result = f.mutate("add", {
        path: "/library/sections/2/all",
        title: "Replacement",
    });
    assert.equal(result.data.changed, false);
    assert.equal(f.list().data.items[1].title, "New folder");
    result = f.mutate("remove", { path: "/library/sections/1/all" });
    assert.equal(result.data.total, 1);
    result = f.mutate("remove", { path: "/library/sections/1/all" });
    assert.equal(result.data.changed, false);
    result = f.mutate("clear");
    assert.equal(result.data.total, 0);
    assert.deepEqual(JSON.parse(f.saved.get("plexcfg")).folders, []);
    assert.equal(f.requests.length, 0);
    assert.equal(f.reloads, 0);
});
test("capacity blocks only new additions; existing/remove/clear remain usable", () => {
    const f = setup(1000),
        before = f.saved.get("plexcfg");
    assert.equal(
        f.mutate("add", {
            path: "/library/sections/1001/all",
            title: "Too many",
        }).data.reason,
        "capacity_exceeded"
    );
    assert.equal(f.saved.get("plexcfg"), before);
    assert.equal(
        f.mutate("add", { path: "/library/sections/1/all", title: "Same" }).data
            .changed,
        false
    );
    assert.equal(
        f.mutate("remove", { path: "/library/sections/1000/all" }).data.total,
        999
    );
    assert.equal(
        f.mutate("add", {
            path: "/library/sections/1001/all",
            title: "Allowed",
        }).data.total,
        1000
    );
    assert.equal(f.mutate("clear").data.total, 0);
});
test("stale revisions, source replacement, deadlines and malformed paths reject", () => {
    const f = setup(12),
        page = f.list();
    f.mutate("remove", { path: "/library/sections/1/all" });
    assert.equal(
        f.request({ cursor: page.data.next_cursor, op: "list" }).data.reason,
        "source_changed"
    );
    assert.equal(
        f.request({
            context: page.data.context.token,
            op: "clear",
            revision: page.data.revision,
        }).data.reason,
        "revision_conflict"
    );
    for (const path of [
        "https://other.test/",
        "/library/../secret",
        "/library/sections/0/all",
    ]) {
        assert.equal(
            f.mutate("add", { path, title: "No" }).data.reason,
            "invalid_value"
        );
    }
    assert.equal(
        f.request({ op: "list" }, { expires_at: 1 }).data.reason,
        "source_changed"
    );
    const next = f.list();
    f.mount("demo");
    assert.equal(
        f.request({
            context: next.data.context.token,
            op: "clear",
            revision: next.data.revision,
        }).data.reason,
        "unsupported"
    );
});
test("title limits, policy and contract grammar match", () => {
    const f = setup();
    const pattern = new RegExp(contract.path_pattern);
    assert(pattern.test("/library/sections/1/folder?parent=23"));
    assert.equal(
        f.mutate("add", {
            path: "/library/sections/1/all",
            title: "🙂".repeat(513),
        }).data.reason,
        "invalid_value"
    );
    f.host.__ottKiosk = { enabled: () => true };
    assert.equal(f.list().status, "ok");
    assert.equal(f.mutate("clear").data.reason, "policy_restricted");
});
test("failed storage keeps the old selection and post-save effect failure is explicit", () => {
    const f = setup(1),
        before = f.saved.get("plexcfg");
    f.host.stbSetItem = () => {};
    assert.equal(f.mutate("clear").data.reason, "storage_failed");
    assert.equal(f.saved.get("plexcfg"), before);
    const g = setup(1);
    g.driver.publishLibrary = () => {
        throw new Error("PRIVATE_EFFECT");
    };
    const result = g.mutate("clear");
    assert.equal(result.status, "ok");
    assert.equal(result.data.persisted, true);
    assert.deepEqual(result.data.application, {
        reason: "effect_failed",
        state: "failed",
    });
    assert.deepEqual(JSON.parse(g.saved.get("plexcfg")).folders, []);
    assert(!JSON.stringify(result).includes("PRIVATE_EFFECT"));
});
console.log("PASS " + passed + " Plex folder scenarios");
