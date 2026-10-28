const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto, createHash } = require("node:crypto");
const ts = require("typescript");
const acorn = require("acorn");
const plain = (value) => JSON.parse(JSON.stringify(value));
const scope = {
    profileBindingId: "11111111-1111-4111-8111-111111111111",
    provider: "plex",
    sourceBindingId: "22222222-2222-4222-8222-222222222222",
};
const real = new Set([
    "src/commands/remote-requests.ts",
    "src/commands/remote-restart.ts",
    "src/commands/remote-favorites-transfer.ts",
    "src/commands/remote-feature.ts",
    "src/plugins/favorites-transfer-runtime.ts",
    "src/commands/favorites-transfer.ts",
    "src/commands/favorites-document-json.ts",
    "src/plugins/remote-inspect.ts",
    "src/plugins/command-server.ts",
    "src/shared/wire-contracts.ts",
    "src/utils/lzstring.ts",
]);
const compiled = {};
function compile(file) {
    if (!compiled[file]) {
        const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        });
        acorn.parse(result.outputText, { ecmaVersion: 5 });
        compiled[file] = result.outputText;
    }
    return compiled[file];
}
function fixture() {
    let clock = 1700000000000,
        id = 0,
        qualified = true;
    const timers = new Map(),
        scripts = [],
        calls = [],
        modules = {};
    const stats = { catalogs: 0, creates: 0, inspections: 0, writes: 0 };
    const recoveryRequired = () => false;
    const w = {
        __cv: "review 1",
        __ottActiveProviderDriver: { id: "plex" },
        __ottKiosk: { enabled: () => false },
        __ottParental: { needs: () => false },
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        btoa: (value) => Buffer.from(value, "binary").toString("base64"),
        clearTimeout(key) {
            timers.delete(key);
        },
        crypto: webcrypto,
        host: "https://player.example/base/",
        p_pref: "plex",
        setTimeout(fn, ms) {
            timers.set(++id, { at: clock + ms, fn });
            return id;
        },
        stbGetItem: () => "",
    };
    const adapter = {
        inspect: async () => {
            stats.inspections++;
            return {
                binding_revision: "0",
                current: () => true,
                persistence: "persistent",
                revision: "opaque-revision",
            };
        },
        status: async () => null,
    };
    const host = {
        captureContext: () => ({ current: () => true }),
        catalog() {
            stats.catalogs++;
            return { binding_revision: "0", bindings: [], targets: [] };
        },
        createAdapter: (admission) => ({
            ...adapter,
            inspect: async (selected, operation, context) => {
                const result = await adapter.inspect(
                    selected,
                    operation,
                    context
                );
                return operation
                    ? { ...result, ...admission(selected, operation, context) }
                    : result;
            },
        }),
        document: { validate: () => {} },
        provision() {
            stats.writes++;
            throw new Error("fixture does not write");
        },
        qualified: () => qualified,
    };
    function load(file) {
        file = path.normalize(file);
        if (modules[file]) return modules[file];
        if (file === "src/storage/index.ts")
            return { settingsRecoveryRequired: recoveryRequired };
        if (file === "src/plugins/remote-notifications.ts")
            return {
                createRemoteNotifications: () => ({
                    configure() {},
                    poll() {},
                    stop() {},
                }),
            };
        if (file === "src/utils/helpers.ts")
            return {
                getScriptDOM(url, success, failure) {
                    scripts.push({ failure, success, url });
                },
            };
        if (file === "src/settings/favorites-current-plex-host.ts")
            return {
                createFavoritesCurrentPlexHost(_window, ports) {
                    stats.creates++;
                    stats.storage = ports.storage;
                    return host;
                },
            };
        if (file === "src/commands/remote-plex.ts")
            return { remotePlexQueue: () => ({ retained: () => false }) };
        if (file === "src/commands/remote-app-update.ts")
            return { remoteAppUpdateAvailable: () => false };
        if (file === "src/commands/remote-favorites-contract.ts")
            return {
                remoteFavoritesCapability: {
                    max_items: 100,
                    operations: ["list", "add", "play", "remove"],
                    version: 1,
                },
            };
        if (!real.has(file)) return {};
        const exports = {};
        modules[file] = exports;
        vm.runInNewContext(
            compile(file),
            {
                ArrayBuffer,
                clearTimeout: w.clearTimeout,
                console,
                Date: class extends Date {
                    static now() {
                        return clock;
                    }
                },
                exports,
                Math,
                Promise,
                require: (name) =>
                    load(path.join(path.dirname(file), name + ".ts")),
                setTimeout: w.setTimeout,
                Uint8Array,
                URL,
                window: w,
            },
            { filename: file }
        );
        return exports;
    }
    const routes = load("src/commands/remote-requests.ts");
    const restart = load("src/commands/remote-restart.ts");
    const runtime = () => restart.remotePlayerInfo(w).runtime;
    function request(op, extra = {}) {
        return {
            action: "favorites_transfer",
            expires_at: (clock + 60000) / 1000,
            id: (++id).toString(16).padStart(32, "0"),
            params: { op, runtime: runtime(), ...extra },
        };
    }
    function start(req) {
        const values = [];
        const cancel = routes.executeRemoteRequest(req, (value) => {
            values.push(plain(value));
            calls.push(plain(value));
        });
        return { cancel, values };
    }
    function finishLoad(index = 0) {
        load("src/plugins/favorites-transfer-runtime.ts");
        scripts[index].success();
    }
    return {
        adapter,
        advance(ms) {
            clock += ms;
        },
        finishLoad,
        host,
        load,
        now: () => clock,
        recoveryRequired,
        request,
        runtime,
        scripts,
        setQualified(value) {
            qualified = value;
        },
        start,
        stats,
        timers,
        w,
    };
}
async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}
async function ready(work) {
    for (let i = 0; i < 100 && !work.values.length; i++)
        await new Promise((resolve) => setImmediate(resolve));
    assert.equal(work.values.length, 1, "one bounded result");
    return work.values[0];
}
let passed = 0;
async function scenario(name, run) {
    await run();
    passed++;
    console.log("PASS " + name);
}
(async () => {
    await scenario(
        "non-Plex capability hint preserves exact legacy caps without optional loads or writes",
        async () => {
            for (const [prefix, driver] of [
                ["m3u", "m3u"],
                ["m3u", "plex"],
                ["plex", "m3u"],
            ]) {
                const f = fixture();
                f.w.p_pref = prefix;
                f.w.__ottActiveProviderDriver = { id: driver };
                const baseline = [];
                f.load("src/commands/remote-restart.ts").executeRemoteControl(
                    f.w,
                    "capabilities",
                    {},
                    (value) => baseline.push(plain(value))
                );
                assert.equal(baseline.length, 1);
                const expected = baseline[0];
                expected.data.notifications = {
                    operations: ["get", "set"],
                    version: 1,
                };
                expected.data.random = { version: 1 };
                const result = await ready(
                    f.start({ action: "capabilities", params: {} })
                );
                assert.deepEqual(result, expected);
                assert.equal(f.scripts.length, 0);
                assert.equal(f.stats.creates, 0);
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "Plex hint still requires authoritative gateway qualification",
        async () => {
            const f = fixture();
            f.setQualified(false);
            const pending = f.start({ action: "capabilities", params: {} });
            assert.equal(f.scripts.length, 1);
            f.finishLoad();
            const result = await ready(pending);
            assert.equal(result.status, "ok");
            assert.equal(result.data.favorites_transfer, undefined);
            assert.equal(f.stats.creates, 1);
            assert.equal(f.stats.writes, 0);
        }
    );
    await scenario(
        "non-Plex recovery status remains reachable despite the capability hint",
        async () => {
            const f = fixture();
            f.w.p_pref = "m3u";
            f.w.__ottActiveProviderDriver = { id: "m3u" };
            f.setQualified(false);
            const pending = f.start(
                f.request("status", {
                    operation_id: "33333333-3333-4333-8333-333333333333",
                })
            );
            assert.equal(f.scripts.length, 1);
            f.finishLoad();
            const result = await ready(pending);
            assert.equal(result.status, "ok");
            assert.equal(result.data.outcome, "unknown");
            assert.equal(f.stats.writes, 0);
        }
    );
    await scenario(
        "actual request route loads only the fixed optional asset and reaches real gateway",
        async () => {
            const f = fixture(),
                req = f.request("bindingcatalog"),
                work = f.start(req);
            assert.equal(f.stats.creates, 0);
            assert.equal(work.values.length, 0);
            assert.equal(
                f.scripts[0].url,
                "https://player.example/base/dist/favorites-transfer.js?review%201"
            );
            // An external caller cannot replace the accepted envelope during the load.
            req.params.op = "provision";
            f.finishLoad();
            const result = await ready(work);
            assert.equal(result.status, "ok");
            assert.equal(result.data.op, "bindingcatalog");
            assert.equal(f.stats.catalogs, 1);
            assert.equal(f.stats.writes, 0);
            const compression = f.load("src/utils/lzstring.ts");
            assert.equal(f.stats.storage.compress, compression.compress);
            assert.equal(f.stats.storage.decompress, compression.decompress);
            assert.equal(f.stats.storage.recoveryRequired, f.recoveryRequired);
            assert.deepEqual(Object.keys(f.stats.storage).sort(), [
                "compress",
                "decompress",
                "recoveryRequired",
            ]);
            assert.equal(f.w.__ottFavoritesTransferStorage, undefined);
            assert.equal(
                JSON.stringify(result).includes("recoveryRequired"),
                false
            );
            await ready(f.start(f.request("bindingcatalog")));
            assert.equal(f.scripts.length, 1);
            assert.equal(f.stats.creates, 1);
        }
    );
    await scenario(
        "actual capabilities route advertises only asynchronous qualified gateway capability",
        async () => {
            const f = fixture(),
                work = f.start({ action: "capabilities", params: {} });
            assert.equal(work.values.length, 0);
            assert.equal(f.scripts.length, 1);
            f.finishLoad();
            const result = await ready(work);
            assert.equal(result.status, "ok");
            assert.equal(
                result.data.favorites_transfer.admission.op,
                "prepare"
            );
            assert.equal(f.stats.inspections, 0);
            assert.equal(f.stats.writes, 0);
            assert.equal(f.stats.catalogs, 0);
        }
    );
    await scenario(
        "unqualified or unavailable optional asset preserves legacy capabilities",
        async () => {
            const f = fixture();
            f.setQualified(false);
            const work = f.start({ action: "capabilities", params: {} });
            f.finishLoad();
            assert.equal(
                (await ready(work)).data.favorites_transfer,
                undefined
            );
            const g = fixture(),
                failed = g.start({ action: "capabilities", params: {} });
            g.scripts[0].failure();
            assert.equal(
                (await ready(failed)).data.favorites_transfer,
                undefined
            );
        }
    );
    await scenario(
        "expired or cancelled lazy requests cannot create host or dispatch writes",
        async () => {
            const f = fixture(),
                work = f.start(f.request("bindingcatalog"));
            f.advance(60000);
            f.finishLoad();
            assert.equal((await ready(work)).data.error, "expired");
            assert.equal(f.stats.creates, 0);
            const g = fixture(),
                cancelled = g.start(g.request("bindingcatalog"));
            cancelled.cancel();
            g.finishLoad();
            await flush();
            assert.equal(cancelled.values.length, 0);
            assert.equal(g.stats.creates, 0);
        }
    );
    await scenario(
        "late PIN/kiosk policy and changed runtime fence lazy dispatch",
        async () => {
            const f = fixture(),
                work = f.start(f.request("bindingcatalog"));
            f.w.__ottParental.needs = () => true;
            f.finishLoad();
            assert.equal((await ready(work)).data.error, "policy_denied");
            assert.equal(f.stats.creates, 0);
            const g = fixture(),
                request = g.request("bindingcatalog"),
                requestedRuntime = request.params.runtime,
                pending = g.start(request);
            request.params.runtime = "mutated-after-admission";
            g.load("src/commands/remote-restart.ts").remotePlayerInfo = () => ({
                runtime: "different-runtime",
            });
            g.finishLoad();
            const rejected = await ready(pending);
            assert.equal(rejected.data.error, "runtime_changed");
            assert.equal(rejected.data.runtime, requestedRuntime);
            assert.equal(g.stats.creates, 0);
        }
    );
    await scenario(
        "stale runtime rejection echoes the validated request identity",
        async () => {
            const f = fixture(),
                request = f.request("bindingcatalog", {
                    runtime: "previous-page-runtime",
                });
            const rejected = await ready(f.start(request));
            assert.deepEqual(rejected, {
                data: {
                    error: "runtime_changed",
                    op: "bindingcatalog",
                    runtime: "previous-page-runtime",
                    version: 1,
                },
                status: "rejected",
            });
            assert.equal(f.scripts.length, 0);
            assert.equal(f.stats.creates, 0);
        }
    );
    await scenario(
        "malformed unbound envelope and oversized request fail before asset load",
        async () => {
            const f = fixture();
            for (const transform of [
                (r) => {
                    delete r.id;
                },
                (r) => {
                    r.params.runtime = "foreign";
                },
                (r) => {
                    r.ts = 1;
                },
                (r) => {
                    r.params.payload = "x".repeat(16384);
                },
            ]) {
                const req = f.request("bindingcatalog");
                transform(req);
                const result = await ready(f.start(req));
                assert.equal(result.status, "rejected");
            }
            assert.equal(f.scripts.length, 0);
            assert.equal(f.stats.creates, 0);
        }
    );
    await scenario(
        "cancellation during real prepare invalidates delayed admission and suppresses ACK",
        async () => {
            const f = fixture();
            let release;
            f.adapter.inspect = () =>
                new Promise((resolve) => {
                    release = resolve;
                });
            const work = f.start(
                f.request("prepare", {
                    binding_revision: "0",
                    budget_ms: 300000,
                    document_sha256: "a".repeat(64),
                    expected_revision: "opaque-revision",
                    scope,
                    size_bytes: 10,
                })
            );
            f.finishLoad();
            await flush();
            assert.equal(typeof release, "function");
            work.cancel();
            release({
                binding_revision: "0",
                current: () => true,
                persistence: "persistent",
                revision: "opaque-revision",
            });
            await flush();
            assert.equal(work.values.length, 0);
            assert.equal(f.stats.writes, 0);
            // Cancelled admission does not leave a busy grant behind.
            assert.equal(
                (await ready(f.start(f.request("bindingcatalog")))).status,
                "ok"
            );
        }
    );
    await scenario(
        "prepare budget survives shorter queue expiry and completed ACK without replay",
        async () => {
            const f = fixture();
            const params = {
                binding_revision: "0",
                budget_ms: 300000,
                document_sha256: "a".repeat(64),
                expected_revision: "opaque-revision",
                scope,
                size_bytes: 10,
            };
            const req = f.request("prepare", params);
            req.expires_at = (f.now() + 1000) / 1000;
            const work = f.start(req);
            f.finishLoad();
            const result = await ready(work);
            assert.equal(result.data.budget_ms, 300000);
            assert.equal(result.status, "ok");
            // The prepare grant stays current after its ACK. A duplicate begin without
            // matching admission is still denied by the actual gateway/foundation.
            f.advance(1500);
            const begin = await ready(
                f.start(
                    f.request("begin", {
                        ...params,
                        budget_ms: undefined,
                        chunk_count: 1,
                        operation_id: result.data.operation_id,
                        persistence: "persistent",
                    })
                )
            );
            assert.equal(begin.status, "ok");
            f.advance(61000);
            const bytes = Buffer.from("0123456789");
            const append = await ready(
                f.start(
                    f.request("append", {
                        chunk_sha256: createHash("sha256")
                            .update(bytes)
                            .digest("hex"),
                        data_base64: bytes.toString("base64"),
                        offset: 0,
                        seq: 0,
                        transaction_id: begin.data.transaction_id,
                    })
                )
            );
            assert.equal(append.status, "ok");
            assert.equal(append.data.received_bytes, 10);
        }
    );
    await scenario(
        "shared lazy loading isolates cancellation and loader timeout suppresses late execution",
        async () => {
            const f = fixture(),
                caps = f.start({ action: "capabilities", params: {} });
            const other = f.start(f.request("bindingcatalog"));
            assert.equal(f.scripts.length, 1);
            caps.cancel();
            f.finishLoad();
            assert.equal((await ready(other)).status, "ok");
            assert.equal(caps.values.length, 0);
            assert.equal(f.stats.creates, 1);
            const g = fixture(),
                pending = g.start(g.request("bindingcatalog"));
            const timer = [...g.timers.values()][0];
            g.advance(15000);
            timer.fn();
            assert.equal((await ready(pending)).status, "unsupported");
            g.finishLoad();
            await flush();
            assert.equal(g.stats.creates, 0);
            assert.equal(pending.values.length, 1);
        }
    );
    await scenario(
        "gateway errors are minimal fixed protocol codes and never leak unexpected messages",
        async () => {
            const f = fixture();
            let result = { error: "private_fixture_secret" };
            f.w.__ottFavoritesTransferRuntime = {
                create: () => ({
                    capability: async () => null,
                    dispose() {},
                    execute: async (params) => ({
                        op: params.op,
                        runtime: params.runtime,
                        version: 1,
                        ...result,
                    }),
                }),
            };
            const first = await ready(f.start(f.request("bindingcatalog")));
            assert.equal(first.data.error, "storage_unavailable");
            assert.equal(
                JSON.stringify(first).includes("private_fixture"),
                false
            );
            result = {
                error: "storage_unavailable",
                private: "private_fixture_secret",
            };
            const second = await ready(f.start(f.request("bindingcatalog")));
            assert.deepEqual(Object.keys(second.data).sort(), [
                "error",
                "op",
                "runtime",
                "version",
            ]);
            assert.equal(
                JSON.stringify(second).includes("private_fixture"),
                false
            );
        }
    );
    await scenario(
        "disable and reenable cannot reuse an acknowledged prepare grant",
        async () => {
            const f = fixture(),
                params = {
                    binding_revision: "0",
                    budget_ms: 300000,
                    document_sha256: "a".repeat(64),
                    expected_revision: "opaque-revision",
                    scope,
                    size_bytes: 10,
                };
            const prepared = f.start(f.request("prepare", params));
            f.finishLoad();
            const accepted = await ready(prepared);
            assert.equal(accepted.status, "ok");
            const previous = f.w.__ottRemoteFavoritesTransfer;
            const controller = f
                .load("src/plugins/command-server.ts")
                .createCommandServer(
                    f.w,
                    () => () => {},
                    () => {},
                    () => {}
                );
            const config = {
                address: "controller.example",
                enabled: false,
                token: "device_read_code_" + "a".repeat(32),
            };
            controller.configure(config);
            assert.equal(f.w.__ottRemoteFavoritesTransfer, undefined);
            controller.configure({ ...config, enabled: true });
            const begin = await ready(
                f.start(
                    f.request("begin", {
                        ...params,
                        budget_ms: undefined,
                        chunk_count: 1,
                        operation_id: accepted.data.operation_id,
                        persistence: "persistent",
                    })
                )
            );
            assert.equal(begin.data.error, "reconciliation_required");
            assert.notEqual(f.w.__ottRemoteFavoritesTransfer, previous);
            assert.equal(f.stats.creates, 2);
            assert.equal(f.stats.writes, 0);
        }
    );
    await scenario(
        "inspection runtime filter rejects another page without invoking transfer route",
        async () => {
            const f = fixture(),
                inspect = f
                    .load("src/plugins/remote-inspect.ts")
                    .installRemoteInspection(f.w);
            const req = f.request("bindingcatalog");
            assert.equal(inspect.accept(req), true);
            req.params.runtime = "another-runtime";
            assert.equal(inspect.accept(req), false);
        }
    );
    console.log(passed + " reachable favorites transfer groups passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
