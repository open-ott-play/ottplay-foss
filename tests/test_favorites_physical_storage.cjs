"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript");
const root = path.resolve(__dirname, "..");
function lockManager() {
    let held = false;
    const calls = [];
    return {
        calls,
        get held() {
            return held;
        },
        request(name, options, callback) {
            calls.push({ name, options });
            assert.equal(name, "ottplay:favorites-ledger");
            assert.deepEqual(JSON.parse(JSON.stringify(options)), {
                ifAvailable: true,
                mode: "exclusive",
            });
            if (held) return Promise.resolve().then(() => callback(null));
            held = true;
            return Promise.resolve()
                .then(() => callback({ name }))
                .finally(() => {
                    held = false;
                });
        },
    };
}
function environment(locks = lockManager()) {
    const values = new Map(),
        writes = [];
    const native = {
        clear() {
            values.clear();
        },
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        key(i) {
            return [...values.keys()][i] || null;
        },
        get length() {
            return values.size;
        },
        removeItem(key) {
            writes.push(key);
            values.delete(key);
        },
        setItem(key, value) {
            writes.push(key);
            values.set(key, String(value));
        },
    };
    const w = {
        localStorage: native,
        location: { origin: "https://player.example" },
        navigator: { locks },
    };
    return { locks, native, values, w, writes };
}
function load(file, w, cache = {}) {
    file = path.resolve(root, file);
    if (cache[file]) return cache[file];
    const exports = {},
        context = vm.createContext({
            console,
            document: { cookie: "" },
            exports,
            Promise,
            require(name) {
                return load(
                    path.resolve(path.dirname(file), name + ".ts"),
                    w,
                    cache
                );
            },
            window: w,
        });
    cache[file] = exports;
    vm.runInContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        context,
        { filename: file }
    );
    return exports;
}
async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}
function hostFixture(origin = "https://player.example") {
    const file = path.join(root, "tests/test_favorites_current_plex_host.cjs");
    let source = fs.readFileSync(file, "utf8");
    source = source.slice(0, source.indexOf("(async () => {"));
    const originLiteral = 'origin: "https://player.example"';
    assert.equal(source.split(originLiteral).length, 2);
    source = source.replace(originLiteral, "origin: " + JSON.stringify(origin));
    const locks = lockManager(),
        context = vm.createContext({
            __dirname: path.dirname(file),
            __locks: locks,
            Buffer,
            clearTimeout,
            console,
            require,
            setTimeout,
        });
    vm.runInContext(
        source +
            ";this.testAPI = {fixture,provision,staged,scope,retainedOutcome,hash};",
        context,
        { filename: file }
    );
    return { ...context.testAPI, locks };
}
(async () => {
    const env = environment(),
        api = load("src/storage/favorites-physical-storage.ts", env.w);
    const grant = api.createFavoritesPhysicalStorageGrant(
        env.w,
        env.native,
        () => true
    );
    assert(grant && grant.current());
    assert.equal(env.writes.length, 0);
    assert.equal(grant.compareAndSwap("ledger", null, "bad"), "conflict");
    let settle;
    const underlying = grant.exclusive(
        () =>
            new Promise((resolve) => {
                settle = resolve;
            })
    );
    await flush();
    assert(env.locks.held);
    const second = environment(env.locks),
        other = api.createFavoritesPhysicalStorageGrant(
            second.w,
            second.native,
            () => true
        );
    assert.equal(
        await Promise.race([underlying, Promise.resolve("outer-timeout")]),
        "outer-timeout"
    );
    await assert.rejects(
        other.exclusive(() => {
            throw Error("must not run");
        }),
        /busy/
    );
    assert(env.locks.held, "outer timeout never releases actual pending work");
    settle("complete");
    assert.equal(await underlying, "complete");
    assert.equal(
        await other.exclusive((g) => g.compareAndSwap("ledger", null, "done")),
        "confirmed"
    );
    assert.equal(second.values.get("ledger"), "done");
    await assert.rejects(
        other.exclusive(() => Promise.reject(Error("failed"))),
        /failed/
    );
    assert.equal(env.locks.held, false);
    console.log(
        "PASS actual full work settlement owns common exclusive lock; timeout/rejection do not steal or leak"
    );
    for (const mutate of [
        (e) => {
            e.w.localStorage = {};
        },
        (e) => {
            e.native.getItem = () => null;
        },
        (e) => {
            e.w.navigator.locks = lockManager();
        },
        (e) => {
            e.w.navigator.locks.request = () => {};
        },
        (e) => {
            e.w.location.origin = "https://other.example";
        },
        (e) => {
            Object.defineProperty(e.native, "setItem", { enumerable: false });
        },
    ]) {
        const e = environment(),
            g = api.createFavoritesPhysicalStorageGrant(
                e.w,
                e.native,
                () => true
            );
        mutate(e);
        assert.equal(g.current(), false);
        await assert.rejects(
            g.exclusive(() => {}),
            /unsupported_persistence/
        );
        assert.equal(e.writes.length, 0);
    }
    const accessor = environment();
    let invoked = 0;
    Object.defineProperty(accessor.native, "getItem", {
        get() {
            invoked++;
            throw Error("must not invoke accessor");
        },
    });
    assert.equal(
        api.createFavoritesPhysicalStorageRead(
            accessor.w,
            accessor.native,
            () => true
        ),
        null
    );
    assert.equal(
        invoked,
        0,
        "descriptor rejection never invokes a replaced method getter"
    );
    const uncertain = environment();
    let failRead = false;
    const physicalGet = uncertain.native.getItem,
        physicalSet = uncertain.native.setItem;
    uncertain.native.getItem = function (key) {
        if (failRead) throw Error("unreadable after actual write");
        return physicalGet.call(this, key);
    };
    uncertain.native.setItem = function (key, value) {
        physicalSet.call(this, key, value);
        failRead = true;
    };
    const uncertainGrant = api.createFavoritesPhysicalStorageGrant(
        uncertain.w,
        uncertain.native,
        () => true
    );
    assert.equal(
        await uncertainGrant.exclusive((g) =>
            g.compareAndSwap("ledger", null, "possibly-written")
        ),
        "unknown"
    );
    assert.equal(
        uncertain.values.get("ledger"),
        "possibly-written",
        "uncertain readback never implies no write"
    );
    const unavailable = environment();
    delete unavailable.w.navigator.locks;
    assert.equal(
        api.createFavoritesPhysicalStorageGrant(
            unavailable.w,
            unavailable.native,
            () => true
        ),
        null
    );
    const reader = api.createFavoritesPhysicalStorageRead(
        unavailable.w,
        unavailable.native,
        () => true
    );
    assert(reader);
    assert.equal(reader.read("missing"), null);
    assert.equal(unavailable.writes.length, 0);
    console.log(
        "PASS exact backend/function/descriptor/lock/origin replacement fails closed; unsupported locks retain readonly access"
    );
    const e = environment(),
        storage = load("src/storage/index.ts", e.w);
    assert(storage.captureFavoritesPhysicalStorage());
    assert(storage.captureFavoritesPhysicalRead());
    assert.equal(e.writes.length, 0);
    const previous = e.native.getItem;
    e.native.getItem = () => null;
    assert.equal(storage.captureFavoritesPhysicalStorage(), null);
    assert.equal(storage.captureFavoritesPhysicalRead(), null);
    e.native.getItem = previous;
    console.log(
        "PASS actual real adapter capture is read-only and identity pinned"
    );
    const f = hostFixture(),
        current = f.fixture({ locks: f.locks });
    const before = [...current.saved];
    assert(current.host.physicalStorage());
    assert(current.host.recoveryStorage());
    assert.deepEqual([...current.saved], before);
    const paired = await current.host.provisionExclusive({
        codecVersion: 1,
        expected_binding_revision: "0",
        mode: "import",
        op: "provision",
        runtime: "test-runtime",
        scope: f.scope,
        target_id: current.host.catalog().targets[0].target_id,
    });
    assert.equal(paired.outcome, "verified");
    let finishRead,
        paused = false,
        armed = false;
    const physicalWrites = [],
        setRaw = current.saved.set.bind(current.saved);
    current.saved.set = (key, value) => {
        physicalWrites.push(key);
        assert(
            f.locks.held,
            "every actual target and ledger write remains locked"
        );
        return setRaw(key, value);
    };
    const get = current.w.localStorage.getItem;
    // Pause the real apply digest, then observe all native writes through completion.
    const sha = current.hostPorts.sha256;
    current.hostPorts.sha256 = (value) => {
        if (armed && !paused) {
            paused = true;
            return new Promise((resolve) => {
                finishRead = () => resolve(sha(value));
            });
        }
        return sha(value);
    };
    const stage = await f.staged(current, paired.scope);
    armed = true;
    const apply = stage.adapter.apply(stage.preview, stage.context, () => true);
    await flush();
    assert(paused, "actual apply awaits its digest while lock held");
    assert(f.locks.held);
    await assert.rejects(current.host.provisionExclusive({}), /busy/);
    const outside = current.host.physicalStorage();
    await assert.rejects(
        outside.exclusive(() => {}),
        /busy/
    );
    finishRead();
    const result = await apply;
    assert.equal(result.outcome, "verified");
    assert.equal(f.locks.held, false);
    assert.equal(current.w.localStorage.getItem, get);
    assert.equal(
        physicalWrites.filter((key) => key === "favorites-receipts.v1").length,
        2,
        "both reservation and completion ledger writes locked"
    );
    assert(physicalWrites.includes("plexmediaJournal.v1:plex@media-source"));
    console.log(
        "PASS real host apply holds same guard through reservation, targets, completion and cache adoption; provisioning contends"
    );
    const revoked = f.fixture();
    const revokedTarget = revoked.host.catalog().targets[0].target_id;
    let permitted = true,
        admissionChecks = 0,
        revokedDuringRead = false;
    const nativeHas = revoked.saved.has.bind(revoked.saved);
    const priorRegistry = nativeHas("favorites-bindings.v1");
    revoked.saved.has = (key) => {
        if (admissionChecks >= 4 && key === "favorites-bindings.v1") {
            permitted = false;
            revokedDuringRead = true;
        }
        return nativeHas(key);
    };
    await assert.rejects(
        revoked.host.provisionExclusive(
            {
                codecVersion: 1,
                expected_binding_revision: "0",
                mode: "import",
                op: "provision",
                runtime: "runtime-1",
                scope: f.scope,
                target_id: revokedTarget,
            },
            () => {
                admissionChecks++;
                return permitted;
            }
        )
    );
    assert(
        revokedDuringRead,
        "authenticated admission was revoked inside actual registry read"
    );
    assert.equal(revoked.saved.has("favorites-bindings.v1"), priorRegistry);
    assert.equal(
        revoked.writes.length,
        0,
        "no target/native writes after synchronous prewrite revocation"
    );
    const lost = f.fixture(),
        lostTarget = lost.host.catalog().targets[0].target_id;
    let lostPermitted = true,
        lostChecks = 0;
    const afterWriteRead = lost.saved.get.bind(lost.saved);
    lost.saved.get = (key) => {
        if (lostChecks >= 2 && key === "favorites-bindings.v1")
            lostPermitted = false;
        return afterWriteRead(key);
    };
    await assert.rejects(
        lost.host.provisionExclusive(
            {
                codecVersion: 1,
                expected_binding_revision: "0",
                mode: "import",
                op: "provision",
                runtime: "runtime-1",
                scope: f.scope,
                target_id: lostTarget,
            },
            () => {
                lostChecks++;
                return lostPermitted;
            }
        ),
        /outcome_unknown/
    );
    assert.equal(
        lost.writes.length,
        1,
        "original peer injection occurs only at postwrite readback for absent registry"
    );
    assert(lost.saved.has("favorites-bindings.v1"));
    const competing = environment();
    competing.values.set("ledger", "before");
    const competingGrant = api.createFavoritesPhysicalStorageGrant(
        competing.w,
        competing.native,
        () => true
    );
    let lastAdmission = 0;
    const contested = await competingGrant.exclusive((g) =>
        g.compareAndSwap("ledger", "before", "after", () => {
            lastAdmission++;
            if (lastAdmission === 2)
                competing.native.setItem("ledger", "competing");
            return true;
        })
    );
    assert.equal(contested, "conflict");
    assert.equal(competing.values.get("ledger"), "competing");
    assert.equal(
        competing.writes.length,
        1,
        "only competing callback wrote; guarded CAS never overwrites it"
    );
    const denied = environment(),
        deniedGrant = api.createFavoritesPhysicalStorageGrant(
            denied.w,
            denied.native,
            () => true
        );
    assert.equal(
        await deniedGrant.exclusive((g) =>
            g.compareAndSwap("ledger", null, "after", () => false)
        ),
        "conflict"
    );
    assert.equal(denied.writes.length, 0);
    const postWrite = environment();
    let stillPermitted = true;
    const actualSet = postWrite.native.setItem;
    postWrite.native.setItem = function (key, value) {
        actualSet.call(this, key, value);
        stillPermitted = false;
    };
    const postWriteGrant = api.createFavoritesPhysicalStorageGrant(
        postWrite.w,
        postWrite.native,
        () => true
    );
    assert.equal(
        await postWriteGrant.exclusive((g) =>
            g.compareAndSwap("ledger", null, "written", () => stillPermitted)
        ),
        "unknown"
    );
    assert.equal(
        postWrite.values.get("ledger"),
        "written",
        "revocation after an actual write never means unchanged"
    );
    console.log(
        "PASS authenticated current is fenced after synchronous reads; prewrite preserves bytes, postwrite returns unknown"
    );
    const recovery = hostFixture(),
        owner = recovery.fixture({ locks: recovery.locks });
    const pair = recovery.provision(owner, "import", { scope: recovery.scope });
    await recovery.retainedOutcome(owner, pair.scope);
    const raw = owner.saved.get("favorites-receipts.v1");
    await assert.rejects(
        owner.host.validateNewAdmission(),
        /reconciliation_required/
    );
    const codec = owner
        .load("src/settings/favorites-recovery-codec.ts")
        .createFavoritesRecoveryCodec({
            sha256: async (value) => recovery.hash(value),
        });
    const operationId = "33333333-3333-4333-8333-333333333333";
    const inspected = await codec.inspect(raw, {
        backendProof: JSON.parse(raw).entries[0].fence.backendProof,
        operationId,
        runtime: "recovery-runtime",
    });
    assert.equal(inspected.acknowledgeAllowed, true);
    const physical = owner.host.physicalStorage();
    assert.equal(
        await physical.exclusive((g) =>
            g.compareAndSwap("favorites-receipts.v1", raw, inspected.afterRaw)
        ),
        "confirmed"
    );
    await owner.host.validateNewAdmission();
    assert.equal(
        JSON.parse(owner.saved.get("favorites-receipts.v1")).entries.length,
        1,
        "acknowledgement preserves bounded original row"
    );
    assert.equal(
        JSON.parse(owner.saved.get("favorites-receipts.v1")).entries[0].state,
        "pending"
    );
    owner.w.p_pref = "m3u";
    owner.w.__ottActiveProviderDriver = { id: "m3u" };
    assert.equal(
        owner.host.recoveryStorage().read("favorites-receipts.v1"),
        inspected.afterRaw,
        "global readonly recovery independent current Plex source"
    );
    const invalid = JSON.parse(inspected.afterRaw);
    invalid.entries[0].recovery_ack.acknowledgement_id = "0".repeat(64);
    owner.saved.set("favorites-receipts.v1", JSON.stringify(invalid));
    await assert.rejects(owner.host.validateNewAdmission(), /invalid_ledger/);
    owner.saved.set("favorites-receipts.v1", inspected.afterRaw);
    let releaseHash,
        heldHash = false;
    const auditSha = owner.hostPorts.sha256;
    owner.hostPorts.sha256 = (value) => {
        if (!heldHash) {
            heldHash = true;
            return new Promise((resolve) => {
                releaseHash = () => resolve(auditSha(value));
            });
        }
        return auditSha(value);
    };
    const checking = owner.host.validateNewAdmission();
    await flush();
    assert(heldHash);
    owner.saved.set("favorites-receipts.v1", raw);
    releaseHash();
    await assert.rejects(
        checking,
        /reconciliation_required/,
        "same-source ledger drift during async audit verification never clears admission"
    );
    owner.hostPorts.sha256 = auditSha;
    const legacy = JSON.parse(raw);
    legacy.version = 1;
    delete legacy.entries[0].fence;
    owner.saved.set("favorites-receipts.v1", JSON.stringify(legacy));
    await assert.rejects(
        owner.host.validateNewAdmission(),
        /reconciliation_required/
    );
    console.log(
        "PASS new admission blocks legacy/unacknowledged globally; only cryptographically validated exact ack bytes clear block, original row retained"
    );
    for (const origin of [
        "tauri://localhost",
        "app://localhost",
        "null",
        "file://local",
    ]) {
        const native = hostFixture(origin),
            local = native.fixture({ locks: native.locks });
        const codec = local
            .load("src/settings/favorites-recovery-codec.ts")
            .createFavoritesRecoveryCodec({
                sha256: async (text) => native.hash(text),
            });
        const before = [...local.saved],
            beforeWrites = local.writes.length;
        await assert.rejects(
            codec.backendProof(local.host.physicalStorage()),
            /unsupported_persistence/
        );
        await assert.rejects(
            local.host.validateNewAdmission(),
            /unsupported_persistence/
        );
        await assert.rejects(
            local.host.provisionExclusive({
                codecVersion: 1,
                expected_binding_revision: "0",
                mode: "import",
                op: "provision",
                runtime: "origin-runtime",
                scope: native.scope,
                target_id: local.host.catalog().targets[0].target_id,
            }),
            /unsupported_persistence/
        );
        await assert.rejects(
            local.host.createAdapter(() => null).inspect(native.scope),
            /unsupported_persistence/
        );
        assert.deepEqual(
            [...local.saved],
            before,
            "unsupported original capture must not initialize or mutate v2 stores: " +
                origin
        );
        assert.equal(local.writes.length, beforeWrites);
        assert(
            local.host.recoveryStorage(),
            "readonly physical recovery remains independent origin proof"
        );
        assert.equal(
            local.host.qualified(),
            true,
            "legacy read-only Plex/favorites qualification is unchanged"
        );
    }
    for (const origin of ["http://127.0.0.1:4179", "https://player.example"]) {
        const supported = hostFixture(origin),
            local = supported.fixture({ locks: supported.locks });
        const codec = local
            .load("src/settings/favorites-recovery-codec.ts")
            .createFavoritesRecoveryCodec({
                sha256: async (text) => supported.hash(text),
            });
        const expectedProof = await codec.backendProof(
            local.host.physicalStorage()
        );
        await local.host.validateNewAdmission();
        assert.equal(
            local.writes.length,
            0,
            "qualification stays pure for supported origin"
        );
        const paired = await local.host.provisionExclusive({
            codecVersion: 1,
            expected_binding_revision: "0",
            mode: "import",
            op: "provision",
            runtime: "origin-runtime",
            scope: supported.scope,
            target_id: local.host.catalog().targets[0].target_id,
        });
        const staged = await supported.staged(local, paired.scope);
        assert.equal(
            (
                await staged.adapter.apply(
                    staged.preview,
                    staged.context,
                    () => true
                )
            ).outcome,
            "verified"
        );
        assert.equal(
            JSON.parse(local.saved.get("favorites-receipts.v1")).entries[0]
                .fence.backendProof,
            expectedProof,
            "actual persistent producer uses the canonical recovery codec proof"
        );
    }
    console.log(
        "PASS actual capture origin qualification matches canonical recovery proof; unsupported native fails closed without writes, HTTP(S) producer proof exact"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
