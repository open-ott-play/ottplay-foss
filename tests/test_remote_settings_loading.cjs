"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync("src/commands/remote-settings.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
function fixture() {
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
            return name === "../provider"
                ? {
                      checkProviderUrl: () => true,
                      isProviderAllowed: () => true,
                  }
                : { remotePlayerInfo: () => ({ runtime: state.runtime }) };
        },
    };
    vm.runInNewContext(code, context);
    function install() {
        w.__ottPlayerSettingsFactory = {
            create: () => ({
                request(request, done) {
                    calls.push(request.action);
                    done({ data: { op: request.params.op }, status: "ok" });
                },
            }),
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
    return {
        calls,
        install,
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
console.log("OK: " + passed + " remote settings loader scenarios");
