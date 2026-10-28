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
    "src/commands/favorites-recovery.ts",
    "src/settings/favorites-recovery-codec.ts",
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
    const physical = {
        current: () => true,
        exclusive: async (work) => work(physical),
        implementationVersion: 1,
        kind: "synchronous-localstorage",
        lockName: "ottplay:favorites-ledger",
        origin: "https://synthetic.invalid",
        privateLedgerKey: "favorites-receipts.v1",
        read: () => null,
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
        physicalStorage: () => (qualified ? physical : null),
        async provisionExclusive() {
            stats.writes++;
            throw new Error("fixture does not write");
        },
        qualified: () => qualified,
        recoveryStorage: () => physical,
        validateNewAdmission: async () => {},
    };
    function load(file) {
        file = path.normalize(file);
        if (modules[file]) return modules[file];
        if (file === "src/storage/index.ts")
            return {
                captureFavoritesPhysicalRead: () => physical,
                captureFavoritesPhysicalStorage: () =>
                    qualified ? physical : null,
                settingsRecoveryRequired: recoveryRequired,
            };
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
                getScriptDOM(url, success, failure, readOnly) {
                    scripts.push({ failure, readOnly, success, url });
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
        "fractional Unix-second envelopes retain bytes and floor only runtime deadlines",
        async () => {
            for (const offset of [60000.75, 60000, 1.75, 1, 0.75, 0, -1]) {
                const f = fixture();
                f.load("src/plugins/favorites-transfer-runtime.ts");
                const factory = f.w.__ottFavoritesTransferRuntime;
                const create = factory.create;
                let transport;
                factory.create = (...args) => {
                    const api = create(...args);
                    const execute = api.execute;
                    api.execute = (params, supplied) => {
                        transport = supplied;
                        return execute(params, supplied);
                    };
                    return api;
                };
                const req = f.request("bindingcatalog");
                req.expires_at = (f.now() + offset) / 1000;
                const original = JSON.stringify(req);
                const deadline = Math.floor(req.expires_at * 1000);
                const result = await ready(f.start(req));
                if (deadline > f.now()) {
                    assert.equal(result.status, "ok", "future " + offset);
                    assert.equal(f.stats.catalogs, 1);
                } else {
                    assert.equal(
                        result.data.error,
                        "expired",
                        "expired " + offset
                    );
                    assert.equal(f.stats.catalogs, 0);
                }
                if (transport) {
                    assert.equal(transport.deadlineAt, deadline);
                    assert(Number.isInteger(transport.deadlineAt));
                    assert(transport.deadlineAt <= req.expires_at * 1000);
                    assert.equal(JSON.stringify(transport.envelope), original);
                } else
                    assert(
                        offset <= 0,
                        "valid future envelope reaches runtime"
                    );
                assert.equal(JSON.stringify(req), original);
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "capability crypto resolving after envelope expiry yields null and clears timer",
        async () => {
            const f = fixture();
            let resolve;
            f.w.__ottFavoritesTransferRuntime = {
                create: () => ({
                    capability: () =>
                        new Promise((done) => {
                            resolve = done;
                        }),
                    dispose() {},
                    execute() {},
                    recoveryCapability: async () => ({ version: 1 }),
                    validateRecoveryResponse: () => false,
                }),
            };
            const values = [];
            f.load(
                "src/commands/remote-favorites-transfer.ts"
            ).remoteFavoritesTransferCapability(
                f.w,
                f.runtime,
                (v) => values.push(v),
                (f.now() + 800) / 1000
            );
            f.advance(801);
            resolve({ version: 1 });
            await flush();
            assert.deepEqual(values, [null]);
            assert.equal(f.timers.size, 0);
            assert.equal(f.stats.writes, 0);
        }
    );
    await scenario(
        "Plex capability stalled load returns base caps within one second and ignores late load",
        async () => {
            const f = fixture();
            const work = f.start({
                action: "capabilities",
                expires_at: (f.now() + 8000) / 1000,
                params: {},
            });
            const timer = [...f.timers.values()].find(
                (t) => t.at === f.now() + 1000
            );
            assert(timer);
            f.advance(1000);
            timer.fn();
            assert.equal(work.values.length, 1);
            assert.equal(work.values[0].status, "ok");
            assert.equal(work.values[0].data.favorites_transfer, undefined);
            f.finishLoad();
            await flush();
            assert.equal(f.stats.creates, 0);
            assert.equal(f.stats.writes, 0);
            assert.equal(work.values.length, 1);
            assert.equal(f.timers.size, 0);
        }
    );
    await scenario(
        "capability shared qualification promise is bounded and late success cannot read cache",
        async () => {
            const f = fixture();
            let resolve,
                reads = 0;
            const pending = new Promise((done) => {
                resolve = done;
            });
            f.w.__ottFavoritesTransferRuntime = {
                create: () => ({
                    capability: () => pending,
                    dispose() {},
                    execute() {},
                    recoveryCapability: async () => ({ version: 1 }),
                    validateRecoveryResponse: () => false,
                }),
            };
            const values = [];
            f.load(
                "src/commands/remote-favorites-transfer.ts"
            ).remoteFavoritesTransferCapability(f.w, f.runtime, (v) =>
                values.push(v)
            );
            const timer = [...f.timers.values()][0];
            f.advance(1000);
            timer.fn();
            assert.deepEqual(values, [null]);
            Object.defineProperty(f.w, "__ottRemoteFavoritesTransfer", {
                configurable: true,
                get() {
                    reads++;
                    throw Error("late cache read");
                },
            });
            resolve({ version: 1 });
            await flush();
            assert.equal(reads, 0);
            assert.equal(values.length, 1);
            assert.equal(f.stats.writes, 0);
            // A fired fake timer remains in the map unless manually removed by finish.
            assert.equal(f.timers.size, 0);
        }
    );
    await scenario(
        "capability deadline reserves250ms and no headroom performs no load",
        async () => {
            for (const left of [0, 249, 250]) {
                const f = fixture(),
                    values = [];
                f.load(
                    "src/commands/remote-favorites-transfer.ts"
                ).remoteFavoritesTransferCapability(
                    f.w,
                    f.runtime,
                    (v) => values.push(v),
                    (f.now() + left) / 1000
                );
                assert.deepEqual(values, [null]);
                assert.equal(f.scripts.length, 0);
                assert.equal(f.timers.size, 0);
            }
            const f = fixture(),
                values = [];
            f.load(
                "src/commands/remote-favorites-transfer.ts"
            ).remoteFavoritesTransferCapability(
                f.w,
                f.runtime,
                (v) => values.push(v),
                (f.now() + 800) / 1000
            );
            const timer = [...f.timers.values()].find(
                (t) => t.at === f.now() + 550
            );
            assert(timer);
            f.advance(550);
            timer.fn();
            assert.deepEqual(values, [null]);
            f.finishLoad();
            await flush();
            assert.equal(f.stats.creates, 0);
            assert.equal(values.length, 1);
        }
    );
    await scenario(
        "capability cancellation clears own timer and suppresses late load and crypto",
        async () => {
            for (const duringPromise of [false, true]) {
                const f = fixture();
                let resolve;
                if (duringPromise)
                    f.w.__ottFavoritesTransferRuntime = {
                        create: () => ({
                            capability: () =>
                                new Promise((done) => {
                                    resolve = done;
                                }),
                            dispose() {},
                            execute() {},
                            recoveryCapability: async () => ({ version: 1 }),
                            validateRecoveryResponse: () => false,
                        }),
                    };
                const values = [],
                    cancel = f
                        .load("src/commands/remote-favorites-transfer.ts")
                        .remoteFavoritesTransferCapability(
                            f.w,
                            f.runtime,
                            (v) => values.push(v)
                        );
                cancel();
                assert.equal(
                    [...f.timers.values()].some((t) => t.at === f.now() + 1000),
                    false
                );
                if (duringPromise) resolve({ version: 1 });
                else f.finishLoad();
                await flush();
                assert.equal(values.length, 0);
                assert.equal(f.stats.creates, 0);
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "capability early authoritative success clears budget and callback fires once",
        async () => {
            const f = fixture(),
                work = f.start({
                    action: "capabilities",
                    expires_at: (f.now() + 8000) / 1000,
                    params: {},
                });
            const lateTimer = [...f.timers.values()].find(
                (t) => t.at === f.now() + 1000
            );
            f.finishLoad();
            const result = await ready(work);
            assert.equal(result.data.favorites_transfer.version, 1);
            assert.equal(f.timers.size, 0);
            lateTimer.fn();
            await flush();
            assert.equal(work.values.length, 1);
            assert.equal(f.stats.writes, 0);
        }
    );
    await scenario(
        "non-Plex discovery preserves legacy caps and exposes global recovery",
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
                f.setQualified(false);
                expected.data.favorites_transfer_recovery = { version: 1 };
                const pending = f.start({ action: "capabilities", params: {} });
                f.finishLoad();
                const result = await ready(pending);
                assert.deepEqual(result, expected);
                assert.equal(f.scripts.length, 1);
                assert.equal(f.stats.creates, 1);
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
                "captureFavoritesPhysicalRead",
                "captureFavoritesPhysicalStorage",
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
                    recoveryCapability: async () => ({ version: 1 }),
                    validateRecoveryResponse: () => false,
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
    await scenario(
        "global recovery route reads absent ledger without Plex and validates correlation",
        async () => {
            const f = fixture();
            f.w.p_pref = "m3u";
            f.w.__ottActiveProviderDriver = { id: "m3u" };
            f.setQualified(false);
            const pending = f.start(f.request("recovery", { mode: "list" }));
            f.finishLoad();
            const result = await ready(pending);
            assert.equal(result.status, "ok");
            assert.equal(result.data.ledger_format, 2);
            assert.deepEqual(result.data.records, []);
            assert.equal(result.data.backend_proof, null);
            assert.equal(f.stats.writes, 0);
            const missing = await ready(
                f.start(
                    f.request("recovery", {
                        mode: "inspect",
                        operation_id: "33333333-3333-4333-8333-333333333333",
                    })
                )
            );
            assert.equal(missing.data.record, null);
            assert.equal(missing.data.acknowledge_allowed, false);
            assert.equal(missing.data.plan_sha256, null);
            const api = f.w.__ottRemoteFavoritesTransfer.value,
                original = api.execute;
            api.execute = async (params, transport) => ({
                ...(await original(params, transport)),
                runtime: "foreign",
            });
            const bad = await ready(
                f.start(f.request("recovery", { mode: "list" }))
            );
            assert.equal(bad.data.error, "storage_unavailable");
            assert.equal(f.stats.writes, 0);
        }
    );
    await scenario(
        "capability deadline retains each ready sibling independently and fences late work",
        async () => {
            for (const readyIndex of [0, 1]) {
                const f = fixture(),
                    values = [];
                let resolve;
                const pending = new Promise((done) => {
                    resolve = done;
                });
                const full = { codecs: [{ provider: "plex" }], version: 1 },
                    recovery = { version: 1 };
                f.w.__ottFavoritesTransferRuntime = {
                    create: () => ({
                        capability: () =>
                            readyIndex === 0 ? Promise.resolve(full) : pending,
                        dispose() {},
                        execute() {},
                        recoveryCapability: () =>
                            readyIndex === 1
                                ? Promise.resolve(recovery)
                                : pending,
                        validateRecoveryResponse: () => false,
                    }),
                };
                f.load(
                    "src/commands/remote-favorites-transfer.ts"
                ).remoteFavoritesTransferCapability(
                    f.w,
                    () => "runtime-1",
                    (a, b) => values.push(plain([a, b]))
                );
                await flush();
                assert.equal(values.length, 0);
                const timer = [...f.timers.values()][0];
                f.advance(1000);
                timer.fn();
                assert.deepEqual(values, [
                    [
                        readyIndex === 0 ? full : null,
                        readyIndex === 1 ? recovery : null,
                    ],
                ]);
                let reads = 0;
                Object.defineProperty(f.w, "__ottRemoteFavoritesTransfer", {
                    get() {
                        reads++;
                        throw Error("late cache");
                    },
                });
                resolve({ version: 1 });
                await flush();
                assert.equal(reads, 0);
                assert.equal(values.length, 1);
                assert.equal(f.timers.size, 0);
            }
        }
    );
    await scenario(
        "ready sibling cannot survive cancellation, stale runtime, or replaced factory",
        async () => {
            for (const change of ["cancel", "runtime", "factory"]) {
                const f = fixture(),
                    values = [];
                let owner = "runtime-1",
                    resolve;
                const pending = new Promise((done) => {
                    resolve = done;
                });
                f.w.__ottFavoritesTransferRuntime = {
                    create: () => ({
                        capability: () => pending,
                        dispose() {},
                        execute() {},
                        recoveryCapability: async () => ({ version: 1 }),
                        validateRecoveryResponse: () => false,
                    }),
                };
                const cancel = f
                    .load("src/commands/remote-favorites-transfer.ts")
                    .remoteFavoritesTransferCapability(
                        f.w,
                        () => owner,
                        (a, b) => values.push(plain([a, b]))
                    );
                await flush();
                const timer = [...f.timers.values()][0];
                if (change === "cancel") cancel();
                else if (change === "runtime") owner = "runtime-2";
                else
                    f.w.__ottFavoritesTransferRuntime = {
                        create() {
                            throw Error("not called");
                        },
                    };
                f.advance(1000);
                timer.fn();
                resolve({ version: 1 });
                await flush();
                assert.deepEqual(
                    values,
                    change === "cancel" ? [] : [[null, null]]
                );
                assert.equal(f.timers.size, 0);
            }
        }
    );
    await scenario(
        "recovery errors are restricted to the accepted ten-code wire union at runtime and bridge",
        async () => {
            const allowed = [
                "invalid_request",
                "envelope_too_large",
                "runtime_changed",
                "expired",
                "busy",
                "unsupported_persistence",
                "revision_conflict",
                "policy_denied",
                "storage_unavailable",
                "limits_exceeded",
            ];
            const legacy = [
                "binding_changed",
                "reconciliation_required",
                "operation_conflict",
                "not_ready",
                "codec_error",
                "transaction_not_found",
            ];
            for (const layer of ["runtime", "bridge"])
                for (const error of allowed.concat(legacy)) {
                    const f = fixture();
                    let pending;
                    if (layer === "runtime") {
                        f.host.physicalStorage = () => {
                            throw Error(error);
                        };
                        pending = f.start(
                            f.request("recovery", { mode: "list" })
                        );
                        f.finishLoad();
                    } else {
                        f.w.__ottFavoritesTransferRuntime = {
                            create: () => ({
                                capability: async () => null,
                                dispose() {},
                                execute: async (params) => ({
                                    error,
                                    op: params.op,
                                    runtime: params.runtime,
                                    version: 1,
                                }),
                                recoveryCapability: async () => null,
                                validateRecoveryResponse() {
                                    throw Error(
                                        "error must not validate success"
                                    );
                                },
                            }),
                        };
                        pending = f.start(
                            f.request("recovery", { mode: "list" })
                        );
                    }
                    const result = await ready(pending);
                    assert.equal(
                        result.data.error,
                        allowed.includes(error) ? error : "storage_unavailable"
                    );
                    assert.deepEqual(Object.keys(result.data).sort(), [
                        "error",
                        "op",
                        "runtime",
                        "version",
                    ]);
                    assert.equal(f.stats.writes, 0);
                }
        }
    );
    await scenario(
        "recovery restriction does not change legacy seven-operation error forwarding",
        async () => {
            for (const error of [
                "binding_changed",
                "reconciliation_required",
                "operation_conflict",
                "not_ready",
                "codec_error",
                "transaction_not_found",
            ]) {
                const f = fixture();
                f.w.__ottFavoritesTransferRuntime = {
                    create: () => ({
                        capability: async () => null,
                        dispose() {},
                        execute: async (params) => ({
                            error,
                            op: params.op,
                            runtime: params.runtime,
                            version: 1,
                        }),
                        recoveryCapability: async () => null,
                        validateRecoveryResponse: () => false,
                    }),
                };
                const result = await ready(f.start(f.request("snapshot")));
                assert.equal(result.data.error, error);
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "standby permits only preloaded recovery list/inspect and preserves policy",
        async () => {
            const operationId = "33333333-3333-4333-8333-333333333333";
            for (const mode of ["list", "inspect"]) {
                const f = fixture();
                f.load("src/plugins/favorites-transfer-runtime.ts");
                f.w.__ottStandby = {
                    blocked: () => true,
                    snapshot: () => ({ standby: true }),
                };
                const req = f.request("recovery", {
                    mode,
                    ...(mode === "inspect"
                        ? { operation_id: operationId }
                        : {}),
                });
                const result = await ready(f.start(req));
                assert.equal(result.status, "ok");
                assert.equal(result.data.mode, mode);
                assert.equal(f.scripts.length, 0);
                assert.equal(f.stats.writes, 0);
                for (const deny of ["kiosk", "parental"]) {
                    const blocked = fixture();
                    blocked.load("src/plugins/favorites-transfer-runtime.ts");
                    blocked.w.__ottStandby = {
                        blocked: () => true,
                        snapshot: () => ({ standby: true }),
                    };
                    if (deny === "kiosk")
                        blocked.w.__ottKiosk.enabled = () => true;
                    else blocked.w.__ottParental.needs = () => true;
                    const denied = await ready(
                        blocked.start(
                            blocked.request("recovery", {
                                mode,
                                ...(mode === "inspect"
                                    ? { operation_id: operationId }
                                    : {}),
                            })
                        )
                    );
                    assert.equal(denied.data.error, "policy_denied");
                    assert.equal(blocked.stats.creates, 0);
                    assert.equal(blocked.stats.writes, 0);
                }
            }
        }
    );
    await scenario(
        "standby keeps ACK and all transfer mutations denied without loading",
        async () => {
            for (const [op, extra] of [
                ["recovery", { mode: "acknowledge" }],
                ["prepare", {}],
                ["commit", {}],
                ["provision", {}],
                ["bind", {}],
                ["status", {}],
                ["recovery", { mode: "LIST" }],
            ]) {
                const f = fixture();
                f.w.__ottStandby = {
                    blocked: () => true,
                    snapshot: () => ({ standby: true }),
                };
                const result = await ready(f.start(f.request(op, extra)));
                assert.equal(result.data.error, "policy_denied");
                assert.equal(f.scripts.length, 0);
                assert.equal(f.stats.creates, 0);
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "standby readonly exception retains exact schema/runtime/deadline validation",
        async () => {
            for (const shape of ["extra", "runtime", "expired"]) {
                const f = fixture();
                f.load("src/plugins/favorites-transfer-runtime.ts");
                f.w.__ottStandby = {
                    blocked: () => true,
                    snapshot: () => ({ standby: true }),
                };
                const req = f.request("recovery", { mode: "list" });
                if (shape === "extra") req.params.extra = true;
                if (shape === "runtime") req.params.runtime = "other-runtime";
                if (shape === "expired") req.expires_at = f.now() / 1000;
                const result = await ready(f.start(req));
                assert.equal(
                    result.data.error,
                    shape === "extra"
                        ? "policy_denied"
                        : shape === "runtime"
                          ? "runtime_changed"
                          : "expired"
                );
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "cold standby recovery read uses fixed readonly asset and cloned intent",
        async () => {
            for (const mode of ["list", "inspect"]) {
                const f = fixture();
                f.w.__ottStandby = {
                    blocked: () => true,
                    snapshot: () => ({ standby: true }),
                };
                const req = f.request("recovery", {
                    mode,
                    ...(mode === "inspect"
                        ? {
                              operation_id:
                                  "33333333-3333-4333-8333-333333333333",
                          }
                        : {}),
                });
                const work = f.start(req);
                assert.equal(f.scripts.length, 1);
                assert.equal(f.scripts[0].readOnly, "favorites-recovery");
                assert.equal(
                    f.scripts[0].url,
                    "https://player.example/base/dist/favorites-transfer.js?review%201"
                );
                req.params.mode = "acknowledge";
                f.finishLoad();
                const result = await ready(work);
                assert.equal(result.status, "ok");
                assert.equal(result.data.mode, mode);
                assert.equal(f.stats.writes, 0);
            }
            for (const invalid of [
                { extra: true, mode: "list" },
                { mode: "inspect", operation_id: "invalid" },
                {
                    mode: "inspect",
                    operation_id: "33333333-3333-1333-8333-333333333333",
                },
            ]) {
                const f = fixture();
                f.w.__ottStandby = {
                    blocked: () => true,
                    snapshot: () => ({ standby: true }),
                };
                const result = await ready(
                    f.start(f.request("recovery", invalid))
                );
                assert.equal(result.data.error, "policy_denied");
                assert.equal(f.scripts.length, 0);
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "cold standby readonly recovery rechecks late policy and cancellation",
        async () => {
            for (const kind of [
                "parental",
                "kiosk",
                "runtime",
                "expiry",
                "cancel",
            ]) {
                const f = fixture();
                f.w.__ottStandby = {
                    blocked: () => true,
                    snapshot: () => ({ standby: true }),
                };
                const work = f.start(f.request("recovery", { mode: "list" }));
                assert.equal(f.scripts.length, 1);
                if (kind === "parental") f.w.__ottParental.needs = () => true;
                if (kind === "kiosk") f.w.__ottKiosk.enabled = () => true;
                if (kind === "runtime")
                    f.load("src/commands/remote-restart.ts").remotePlayerInfo =
                        () => ({ runtime: "changed-runtime" });
                if (kind === "expiry") f.advance(60001);
                if (kind === "cancel") work.cancel();
                f.finishLoad();
                await flush();
                if (kind === "cancel") assert.equal(work.values.length, 0);
                else {
                    const result = await ready(work);
                    assert.equal(result.status, "rejected");
                    if (kind === "runtime")
                        assert.equal(result.data.error, "runtime_changed");
                }
                assert.equal(f.stats.creates, 0);
                assert.equal(f.stats.writes, 0);
            }
        }
    );
    await scenario(
        "cold standby capabilities load read-only graph without Plex and retain recovery marker",
        async () => {
            const f = fixture();
            f.w.__ottStandby = {
                blocked: () => true,
                snapshot: () => ({ standby: true }),
            };
            f.w.p_pref = "m3u";
            f.w.__ottActiveProviderDriver = { id: "m3u" };
            f.setQualified(false);
            const work = f.start({ action: "capabilities", params: {} });
            assert.equal(f.scripts.length, 1);
            assert.equal(f.scripts[0].readOnly, "favorites-recovery");
            f.finishLoad();
            const result = await ready(work);
            assert.deepEqual(result.data.favorites_transfer_recovery, {
                version: 1,
            });
            assert.equal(result.data.favorites_transfer, undefined);
            assert.equal(f.stats.writes, 0);
        }
    );
    console.log(passed + " reachable favorites transfer groups passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
