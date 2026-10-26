"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript"),
    acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync("src/commands/remote-perf.ts", "utf8"),
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
        replies = [],
        calls = [];
    let revision = 0,
        runtime = "page-1",
        time = 1000;
    const w = {
        __cv: "version",
        __ottRuntimeDebug: { configurationRevision: () => revision },
        clearTimeout: (id) => timers.delete(id),
        host: "https://player.example",
        setTimeout: (f) => {
            const id = timers.size + 1;
            timers.set(id, f);
            return id;
        },
    };
    const c = {
        Date: { now: () => time },
        exports: {},
        require: (name) =>
            name === "../utils/helpers"
                ? {
                      getScriptDOM: (url, done, fail) =>
                          scripts.push({ done, fail, url }),
                  }
                : { remotePlayerInfo: () => ({ runtime }) },
    };
    const originalRequire = c.require;
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
    c.require = (name) =>
        name === "./remote-feature" ? feature.exports : originalRequire(name);
    vm.runInNewContext(code, c);
    const request = (extra = {}, done = (x) => replies.push(x)) =>
        c.exports.executeRemotePerformance(
            w,
            {
                action: "perf_capture",
                params: {
                    op: "start",
                    runtime: "page-1",
                    session_id: "a".repeat(32),
                    version: 1,
                },
                ...extra,
            },
            done
        );
    const settingsContext = { ...c, exports: {} };
    vm.runInNewContext(
        ts.transpileModule(
            fs.readFileSync("src/commands/remote-settings.ts", "utf8"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText,
        settingsContext
    );
    return {
        calls,
        change: () => revision++,
        install() {
            w.__ottPerfCaptureFactory = {
                create: () => ({
                    request: (r) => {
                        calls.push(r);
                        return { data: {}, status: "ok" };
                    },
                }),
            };
        },
        replies,
        request,
        runtime: (v) => (runtime = v),
        scripts,
        startSettings() {
            settingsContext.exports.executeRemoteSettings(
                w,
                {
                    action: "player_settings",
                    params: { op: "schema", runtime: "page-1" },
                },
                (result) => replies.push(result)
            );
        },
        time: (v) => (time = v),
        timers,
        w,
    };
}
{
    const f = fixture(),
        cancel = f.request();
    f.request();
    assert.equal(f.scripts.length, 1);
    assert.match(f.scripts[0].url, /\/dist\/perf-capture.js\?version$/);
    cancel();
    f.install();
    f.scripts[0].done();
    f.scripts[0].done();
    assert.equal(f.calls.length, 1);
    assert.equal(f.replies.length, 1);
    assert.equal(f.timers.size, 0);
}
for (const change of [
    (f) => f.change(),
    (f) => f.runtime("page-2"),
    (f) => f.time(99999),
]) {
    const f = fixture();
    f.request({ expires_at: 50 });
    f.install();
    change(f);
    f.scripts[0].done();
    assert.equal(f.calls.length, 0);
    assert.equal(f.replies.length, 1);
    assert.equal(f.replies[0].status, "rejected");
}
{
    const f = fixture();
    f.request({
        params: {
            op: "start",
            runtime: "page-1",
            session_id: "a".repeat(32),
            version: 2,
        },
    });
    f.scripts[0].fail();
    assert.equal(f.replies[0].data.version, 2);
    assert.equal(f.replies[0].data.error, "unsupported");
    assert.equal(f.calls.length, 0);
}
{
    const f = fixture();
    for (let i = 0; i < 33; i++) f.request();
    assert.equal(f.scripts.length, 1);
    assert.equal(f.replies.length, 1);
    assert.equal(f.replies[0].data.error, "unsupported");
    [...f.timers.values()][0]();
    assert.equal(f.replies.length, 33);
    f.install();
    f.scripts[0].done();
    assert.equal(f.calls.length, 0);
}
{
    const f = fixture();
    f.install();
    let calls = 0;
    assert.throws(
        () =>
            f.request({}, () => {
                calls++;
                throw Error("consumer");
            }),
        /consumer/
    );
    assert.equal(calls, 1);
}
console.log(
    "PASS performance loading: bounded sharing, cancellation, expiry, scope retirement and exactly-once callbacks"
);

{
    const f = fixture();
    f.request();
    f.startSettings();
    assert.equal(f.scripts.length, 2);
    const perf = f.scripts.find((x) => x.url.includes("perf-capture")),
        settings = f.scripts.find((x) =>
            x.url.includes("remote-settings-lifecycle")
        );
    perf.fail();
    assert.equal(f.replies.length, 1);
    assert.equal(f.timers.size, 1);
    f.w.__ottRemoteSettingsDispatch = {
        execute(_w, _request, done) {
            done({ data: { settings: true }, status: "ok" });
        },
    };
    settings.done();
    assert.equal(f.replies.length, 2);
    assert.equal(f.replies[1].status, "ok");
    assert.equal(f.timers.size, 0);
}
