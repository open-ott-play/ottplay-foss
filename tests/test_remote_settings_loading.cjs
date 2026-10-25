"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync("src/plugins/remote-settings-dispatch.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
const bridgeCode = ts.transpileModule(
    fs.readFileSync("src/commands/remote-settings.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(bridgeCode, { ecmaVersion: 5 });
function fixture(bridge = false) {
    const scripts = [],
        timers = new Map(),
        calls = [];
    const state = { clock: 1000, runtime: "page-123", scope: "m3u:1" };
    const w = {
        __cv: "beta-test",
        __ottActiveProviderDriver: {
            configuration: () => ({ active: 0 }),
            id: "m3u",
        },
        __ottPlayerSettingsHost: { source: () => state.scope },
        clearTimeout(id) {
            timers.delete(id);
        },
        document: {
            createElement() {
                return {};
            },
            head: {
                appendChild(script) {
                    scripts.push(script);
                    script.parentNode = { removeChild() {} };
                },
            },
        },
        host: "https://player.example",
        setTimeout(fn) {
            const id = timers.size + 1;
            timers.set(id, fn);
            return id;
        },
    };
    const context = {
        Date: { now: () => state.clock },
        exports: {},
        require(name) {
            if (name === "../utils/helpers")
                return {
                    getScriptDOM(url, done, error) {
                        const script = {
                            onerror: error,
                            onload: done,
                            src: url,
                        };
                        w.document.head.appendChild(script);
                    },
                };
            return name === "../provider"
                ? {
                      checkProviderUrl: () => true,
                      isProviderAllowed: () => true,
                  }
                : { remotePlayerInfo: () => ({ runtime: state.runtime }) };
        },
        window: w,
    };
    const originalRequire = context.require;
    const feature = { exports: {}, require: originalRequire };
    vm.runInNewContext(
        ts.transpileModule(
            fs.readFileSync("src/commands/remote-feature.ts", "utf8"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText,
        feature
    );
    context.require = (name) =>
        name === "./remote-feature" ? feature.exports : originalRequire(name);
    function installDispatch() {
        vm.runInNewContext(code, context);
    }
    if (bridge) vm.runInNewContext(bridgeCode, context);
    else {
        installDispatch();
        context.exports.executeRemoteSettings = (
            host,
            request,
            done,
            afterReply
        ) =>
            w.__ottRemoteSettingsDispatch.execute(
                host,
                request,
                done,
                afterReply,
                {
                    allowed: () => true,
                    runtime: () => state.runtime,
                    url: () => true,
                }
            );
    }
    function install() {
        w.__ottRemoteSettingsExtras = {};
        w.__ottPlayerSettingsFactory = {
            create: () => ({
                request(request, done) {
                    calls.push(request.action);
                    done({ data: { op: request.params.op }, status: "ok" });
                },
            }),
        };
        w.__ottRemoteHandoff = {
            execute(_w, request, done) {
                calls.push(request.action);
                done({ data: {}, status: "ok" });
            },
        };
        w.__ottRemoteNotificationSettings = {
            execute(_w, _runtime, _params, done) {
                calls.push("notifications");
                done({ data: {}, status: "ok" });
            },
        };
        w.__ottRemoteProviderSettings = {
            create: () => ({
                request(request, done) {
                    calls.push("vportal");
                    done({ data: {}, status: "ok" });
                },
            }),
        };
        w.__ottRemoteLegacySettings = {
            compare() {
                calls.push("compare");
                return { data: { matched: true }, status: "ok" };
            },
            write(_w, _p, done) {
                calls.push("write");
                done({ data: { saved: true }, status: "ok" });
            },
        };
    }
    function installFields() {
        w.__ottRemoteProviderFields = {};
        w.__ottRemotePlexFolders = {
            create: () => ({
                request(request, done) {
                    calls.push("folders:" + request.params.op);
                    done({ data: {}, status: "ok" });
                },
            }),
        };
    }
    return {
        calls,
        install,
        installDispatch,
        installFields,
        run(
            action = "player_settings",
            params = { id: "bufSize", op: "get", runtime: state.runtime },
            extra = {}
        ) {
            const replies = [];
            const cancel = context.exports.executeRemoteSettings(
                w,
                { action, params, ...extra },
                (r) => replies.push(r)
            );
            return { cancel, replies };
        },
        scripts,
        state,
        timers,
        w,
    };
}
let passed = 0;
function check(name, test) {
    test();
    passed++;
    console.log("OK: " + name);
}
check(
    "parallel requests share one versioned module load and each responds once",
    () => {
        const f = fixture(),
            a = f.run(),
            b = f.run();
        assert.equal(f.scripts.length, 1);
        assert.equal(
            f.scripts[0].src,
            "https://player.example/dist/remote-settings.js?beta-test"
        );
        const loaded = f.scripts[0].onload;
        f.install();
        loaded();
        loaded();
        assert.equal(a.replies.length, 1);
        assert.equal(b.replies.length, 1);
        assert.equal(f.calls.length, 2);
        assert.equal(f.timers.size, 0);
    }
);
check("cancelled requests detach without cancelling other waiters", () => {
    const f = fixture(),
        a = f.run(),
        b = f.run();
    a.cancel();
    f.install();
    f.scripts[0].onload();
    assert.equal(a.replies.length, 0);
    assert.equal(b.replies.length, 1);
    assert.equal(f.calls.length, 1);
});
check(
    "load failure and timeout return once and a later request can retry",
    () => {
        for (const fail of [
            (f) => f.scripts[0].onerror(),
            (f) => [...f.timers.values()][0](),
        ]) {
            const f = fixture(),
                a = f.run();
            fail(f);
            assert.equal(a.replies.length, 1);
            assert.equal(a.replies[0].status, "unsupported");
            const b = f.run();
            assert.equal(f.scripts.length, 2);
            f.install();
            f.scripts[1].onload();
            assert.equal(b.replies[0].status, "ok");
        }
    }
);
check(
    "runtime source profile and expiry changes while loading prevent execution",
    () => {
        for (const change of [
            (f) => {
                f.state.runtime = "page-new";
            },
            (f) => {
                f.state.scope = "m3u:2";
            },
            (f) => {
                f.w.__ottActiveProviderDriver = { id: "plex" };
            },
            (f) => {
                f.state.clock = 3000;
            },
        ]) {
            const f = fixture(),
                a = f.run(undefined, undefined, { expires_at: 2 });
            change(f);
            f.install();
            f.scripts[0].onload();
            assert.equal(a.replies.length, 1);
            assert.equal(a.replies[0].status, "rejected");
            assert.equal(f.calls.length, 0);
        }
    }
);
check(
    "legacy compare and provider writes retain first-load single-call semantics",
    () => {
        const f = fixture(),
            a = f.run("settings_compare", { provider: "m3u" }),
            b = f.run("provider_settings", { provider: "m3u" });
        f.install();
        f.scripts[0].onload();
        assert.deepEqual(f.calls, ["compare", "write"]);
        assert.equal(a.replies.length, 1);
        assert.equal(b.replies.length, 1);
    }
);
check(
    "VPortal only loads its pure driver asset and is allowed during standby",
    () => {
        const f = fixture();
        f.w.__ottStandby = { blocked: () => true };
        const a = f.run("settings_compare", {
            number: 1,
            provider: "vportal",
            runtime: f.state.runtime,
            settings: { vportal: "" },
        });
        f.install();
        f.scripts[0].onload();
        assert.equal(f.scripts.length, 2);
        assert(f.scripts[1].src.includes("provider-vportal.js"));
        assert.equal(a.replies.length, 0);
        f.w.__ottVPortalDriver = {};
        f.scripts[1].onload();
        assert.deepEqual(f.calls, ["vportal"]);
        assert.equal(a.replies.length, 1);
    }
);
check(
    "subtitle writes await shared readiness and recheck source/expiry/cancellation",
    () => {
        for (const outcome of [
            "ready",
            "failed",
            "source",
            "expired",
            "cancelled",
        ]) {
            const f = fixture();
            f.install();
            let finish,
                released = 0;
            f.w.__ottAppearanceHost = {
                ready(done) {
                    finish = done;
                    return () => released++;
                },
            };
            const result = f.run(
                "player_settings",
                {
                    context: "context-1",
                    id: "subtitleFontSize",
                    op: "set",
                    revision: "revision-1",
                    runtime: f.state.runtime,
                    value: 2,
                },
                { expires_at: 2 }
            );
            assert.equal(f.calls.length, 0);
            assert.equal(f.scripts.length, 0);
            if (outcome === "source") f.state.scope = "different";
            if (outcome === "expired") f.state.clock = 3000;
            if (outcome === "cancelled") result.cancel();
            finish(outcome !== "failed");
            assert.equal(f.calls.length, outcome === "ready" ? 1 : 0);
            assert.equal(
                result.replies.length,
                outcome === "cancelled" ? 0 : 1
            );
            if (outcome === "cancelled") assert.equal(released, 1);
        }
    }
);
check(
    "startup bridge shares its optional load and retains pre-load source/cancel ownership",
    () => {
        const f = fixture(true),
            first = f.run(),
            second = f.run();
        assert.equal(f.scripts.length, 1);
        assert.match(f.scripts[0].src, /remote-settings-lifecycle\.js/);
        first.cancel();
        f.install();
        f.installDispatch();
        f.scripts[0].onload();
        assert.equal(first.replies.length, 0);
        assert.equal(second.replies.length, 1);
        assert.deepEqual(f.calls, ["player_settings"]);
        const g = fixture(true),
            stale = g.run();
        g.state.scope = "m3u:2";
        g.install();
        g.installDispatch();
        g.scripts[0].onload();
        assert.equal(stale.replies[0].data.reason, "source_changed");
        assert.equal(g.calls.length, 0);
    }
);
check(
    "startup bridge times out once and allows an independent later load",
    () => {
        const f = fixture(true),
            first = f.run();
        const late = f.scripts[0].onload;
        [...f.timers.values()][0]();
        assert.equal(first.replies[0].data.reason, "unsupported");
        f.install();
        f.installDispatch();
        late();
        assert.equal(first.replies.length, 1);
        assert.equal(f.run().replies[0].status, "ok");
    }
);
check(
    "settings lifecycle instance never replaces or reuses the native lifecycle hook",
    () => {
        const f = fixture();
        f.install();
        const native = { platform: "tauri", restart: () => {} };
        const settings = {
            capture: () => {},
            patch: (_request, done) => done({ data: {}, status: "ok" }),
        };
        f.w.__ottRemoteLifecycle = native;
        f.w.__ottRemoteLifecyclePorts = {};
        f.w.__ottRemoteLifecycleHostFactory = {
            create: (host) => {
                host.__ottRemoteLifecycleHost = {};
            },
        };
        f.w.__ottRemoteLifecycleFields = { create: () => settings };
        const result = f.run("player_settings_patch", {
            group: "command_server",
            op: "get",
            runtime: f.state.runtime,
        });
        assert.equal(result.replies[0].status, "ok");
        assert.equal(f.w.__ottRemoteLifecycle, native);
        assert.equal(f.w.__ottRemoteSettingsLifecycle, settings);
    }
);
check(
    "provider schema, scalar, folder and legacy Plex writes share one optional load",
    () => {
        const f = fixture();
        f.install();
        const schema = f.run("player_settings", {
            op: "schema",
            runtime: f.state.runtime,
        });
        const scalar = f.run("player_settings", {
            id: "providerUsername",
            op: "get",
            runtime: f.state.runtime,
        });
        const folders = f.run("plex_folders", {
            op: "list",
            runtime: f.state.runtime,
        });
        const legacy = f.run("provider_settings", {
            provider: "plex",
            settings: { server: "https://plex.test", token: "private" },
        });
        assert.equal(f.scripts.length, 1);
        assert(
            f.scripts[0].src.includes("remote-provider-fields.js?beta-test")
        );
        assert.equal(f.calls.length, 0);
        const loaded = f.scripts[0].onload;
        f.installFields();
        loaded();
        loaded();
        assert.deepEqual(f.calls, [
            "player_settings",
            "player_settings",
            "folders:list",
            "write",
        ]);
        for (const result of [schema, scalar, folders, legacy])
            assert.equal(result.replies.length, 1);
    }
);
check(
    "provider optional load failure and source replacement cannot dispatch writes",
    () => {
        for (const outcome of [
            "failed",
            "runtime",
            "source",
            "expired",
            "cancelled",
        ]) {
            const f = fixture();
            f.install();
            const result = f.run(
                "plex_folders",
                { op: "clear", runtime: f.state.runtime },
                { expires_at: 2 }
            );
            if (outcome === "failed") f.scripts[0].onerror();
            else {
                if (outcome === "runtime") f.state.runtime = "new-runtime";
                if (outcome === "source") f.state.scope = "another-profile";
                if (outcome === "expired") f.state.clock = 3000;
                if (outcome === "cancelled") result.cancel();
                f.installFields();
                f.scripts[0].onload();
            }
            assert.equal(f.calls.length, 0);
            assert.equal(
                result.replies.length,
                outcome === "cancelled" ? 0 : 1
            );
            if (result.replies.length)
                assert.notEqual(result.replies[0].status, "ok");
        }
    }
);
check(
    "application repairs do not wait for provider assets or a loaded catalogue",
    () => {
        const f = fixture();
        f.install();
        delete f.w.__ottActiveProviderDriver;
        const result = f.run();
        assert.equal(f.scripts.length, 0);
        assert.equal(result.replies[0].status, "ok");
    }
);
check(
    "handoff and notification commands are fenced while their optional implementation loads",
    () => {
        for (const action of ["playback_handoff_import", "notifications"]) {
            const f = fixture(true);
            const result = f.run(action, {
                operation: "set",
                runtime: f.state.runtime,
            });
            assert.equal(f.calls.length, 0);
            f.installDispatch();
            f.install();
            f.scripts[0].onload();
            assert.deepEqual(f.calls, [action]);
            assert.equal(result.replies.length, 1);
            const stale = fixture(true);
            const rejected = stale.run(action, {
                operation: "set",
                runtime: stale.state.runtime,
            });
            stale.state.scope = "m3u:2";
            stale.installDispatch();
            stale.install();
            stale.scripts[0].onload();
            assert.equal(stale.calls.length, 0);
            assert.equal(rejected.replies[0].data.error, "unsupported");
        }
    }
);
check(
    "extras load once for schema and scalar requests, and stale callers cannot write",
    () => {
        for (const outcome of ["success", "source", "cancel", "failure"]) {
            const f = fixture();
            f.install();
            f.installFields();
            delete f.w.__ottRemoteSettingsExtras;
            const first = f.run("player_settings", {
                op: "schema",
                runtime: f.state.runtime,
            });
            const second = f.run("player_settings", {
                id: "noSelProv",
                op: "set",
                runtime: f.state.runtime,
            });
            assert.equal(f.scripts.length, 1);
            assert.match(f.scripts[0].src, /remote-settings-extras\.js/);
            const loaded = f.scripts[0].onload;
            if (outcome === "source") f.state.scope = "replacement";
            if (outcome === "cancel") {
                first.cancel();
                second.cancel();
            }
            f.w.__ottRemoteSettingsExtras = {};
            if (outcome === "failure") f.scripts[0].onerror();
            else {
                loaded();
                loaded();
            }
            assert.equal(f.calls.length, outcome === "success" ? 2 : 0);
            for (const item of [first, second])
                assert.equal(item.replies.length, outcome === "cancel" ? 0 : 1);
            if (outcome === "source")
                assert.equal(second.replies[0].data.reason, "source_changed");
            if (outcome === "failure")
                assert.equal(second.replies[0].status, "unsupported");
        }
    }
);
console.log("OK: " + passed + " remote settings loader scenarios");
