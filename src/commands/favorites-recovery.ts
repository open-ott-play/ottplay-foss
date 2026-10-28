import { createFavoritesRecoveryCodec } from "../settings/favorites-recovery-codec";

export const FAVORITES_RECOVERY_ERRORS =
    "invalid_request envelope_too_large runtime_changed expired busy unsupported_persistence revision_conflict policy_denied storage_unavailable limits_exceeded".split(
        " "
    );
const REASON = "accept-unknown-no-replay",
    KEY = "favorites-receipts.v1";
function fail(code: string): never {
    throw new Error(code);
}
function exact(value: any, fields: string[]): boolean {
    return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getOwnPropertyNames(value).sort().join(",") ===
            fields.slice().sort().join(",") &&
        Object.getOwnPropertyNames(value).every(function (key) {
            var d = Object.getOwnPropertyDescriptor(value, key);
            return !!d && d.enumerable && "value" in d;
        })
    );
}
function hash(v: any): boolean {
    return typeof v === "string" && /^[a-f0-9]{64}(?![\s\S])/.test(v);
}
function uuid(v: any): boolean {
    return (
        typeof v === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/.test(
            v
        )
    );
}
function runtime(v: any): boolean {
    return typeof v === "string" && /^[a-z0-9-]{1,64}(?![\s\S])/.test(v);
}
function scope(v: any): boolean {
    return (
        exact(v, ["profileBindingId", "sourceBindingId", "provider"]) &&
        uuid(v.profileBindingId) &&
        uuid(v.sourceBindingId) &&
        typeof v.provider === "string" &&
        /^[a-z0-9][a-z0-9_.\/-]{0,63}(?![\s\S])/.test(v.provider)
    );
}
function sameScope(a: any, b: any): boolean {
    return (
        scope(a) &&
        scope(b) &&
        a.profileBindingId === b.profileBindingId &&
        a.sourceBindingId === b.sourceBindingId &&
        a.provider === b.provider
    );
}
function audit(v: any): boolean {
    return (
        exact(v, [
            "acknowledgement_id",
            "runtime",
            "ledger_revision_before",
            "backend_proof",
            "reason",
        ]) &&
        hash(v.acknowledgement_id) &&
        runtime(v.runtime) &&
        hash(v.ledger_revision_before) &&
        hash(v.backend_proof) &&
        v.reason === REASON
    );
}
function record(v: any): boolean {
    return (
        exact(v, [
            "operation_id",
            "scope",
            "original_state",
            "original_outcome",
            "original_entry_sha256",
            "acknowledgement",
        ]) &&
        uuid(v.operation_id) &&
        scope(v.scope) &&
        ["pending", "partial", "unknown"].indexOf(v.original_state) >= 0 &&
        v.original_outcome ===
            (v.original_state === "partial" ? "partial" : "unknown") &&
        hash(v.original_entry_sha256) &&
        (v.acknowledgement === null || audit(v.acknowledgement))
    );
}
export function validFavoritesRecoveryRequest(p: any): boolean {
    if (!p || p.op !== "recovery" || !runtime(p.runtime)) return false;
    var fields = ["op", "runtime", "mode"];
    if (p.mode === "list") return exact(p, fields);
    fields.push("operation_id");
    if (!uuid(p.operation_id)) return false;
    if (p.mode === "inspect") return exact(p, fields);
    return (
        p.mode === "acknowledge" &&
        exact(
            p,
            fields.concat([
                "scope",
                "original_entry_sha256",
                "expected_ledger_revision",
                "backend_proof",
                "reason",
                "acknowledgement_id",
                "after_ledger_sha256",
                "plan_sha256",
                "accept_unknown",
            ])
        ) &&
        scope(p.scope) &&
        p.accept_unknown === true &&
        p.reason === REASON &&
        [
            "original_entry_sha256",
            "expected_ledger_revision",
            "backend_proof",
            "acknowledgement_id",
            "after_ledger_sha256",
            "plan_sha256",
        ].every(function (k) {
            return hash(p[k]);
        })
    );
}
export function validFavoritesRecoveryResponse(v: any, p: any): boolean {
    if (
        !validFavoritesRecoveryRequest(p) ||
        !v ||
        v.version !== 1 ||
        v.op !== "recovery" ||
        v.runtime !== p.runtime ||
        v.mode !== p.mode
    )
        return false;
    var fields = ["version", "op", "runtime", "mode", "ledger_revision"];
    if (!hash(v.ledger_revision)) return false;
    if (p.mode === "acknowledge")
        return (
            exact(
                v,
                fields.concat([
                    "operation_id",
                    "acknowledgement_id",
                    "plan_sha256",
                    "acknowledged",
                    "persistence",
                    "record",
                ])
            ) &&
            v.operation_id === p.operation_id &&
            v.acknowledgement_id === p.acknowledgement_id &&
            v.plan_sha256 === p.plan_sha256 &&
            v.ledger_revision === p.after_ledger_sha256 &&
            v.acknowledged === true &&
            v.persistence === "persistent" &&
            record(v.record) &&
            v.record.operation_id === p.operation_id &&
            sameScope(v.record.scope, p.scope) &&
            v.record.original_entry_sha256 === p.original_entry_sha256 &&
            audit(v.record.acknowledgement) &&
            v.record.acknowledgement.acknowledgement_id ===
                p.acknowledgement_id &&
            v.record.acknowledgement.runtime === p.runtime &&
            v.record.acknowledgement.ledger_revision_before ===
                p.expected_ledger_revision &&
            v.record.acknowledgement.backend_proof === p.backend_proof
        );
    fields = fields.concat(["ledger_format", "backend_proof"]);
    if (
        [1, 2].indexOf(v.ledger_format) < 0 ||
        !(v.backend_proof === null || hash(v.backend_proof))
    )
        return false;
    if (p.mode === "list")
        return (
            exact(v, fields.concat(["records"])) &&
            Array.isArray(v.records) &&
            v.records.length <= 32 &&
            Object.keys(v.records).length === v.records.length &&
            v.records.every(function (r: any, i: number) {
                return (
                    record(r) &&
                    (!i || v.records[i - 1].operation_id < r.operation_id)
                );
            })
        );
    if (
        !exact(
            v,
            fields.concat([
                "operation_id",
                "record",
                "acknowledge_allowed",
                "plan_sha256",
                "acknowledgement_id",
                "after_ledger_sha256",
            ])
        ) ||
        v.operation_id !== p.operation_id ||
        !(
            v.record === null ||
            (record(v.record) && v.record.operation_id === p.operation_id)
        )
    )
        return false;
    if (v.acknowledge_allowed === false)
        return (
            v.plan_sha256 === null &&
            v.acknowledgement_id === null &&
            v.after_ledger_sha256 === null
        );
    return (
        v.acknowledge_allowed === true &&
        v.record !== null &&
        v.record.acknowledgement === null &&
        v.ledger_format === 2 &&
        hash(v.backend_proof) &&
        hash(v.plan_sha256) &&
        hash(v.acknowledgement_id) &&
        hash(v.after_ledger_sha256)
    );
}
export function createFavoritesRecoveryDispatcher(ports: {
    host: any;
    runtime(): string;
    current(): boolean;
    now(): number;
    sha256(text: string): Promise<string>;
    utf8(text: string): Uint8Array;
}) {
    var codec = createFavoritesRecoveryCodec({ sha256: ports.sha256 });
    function check(current: () => boolean, deadline: number): void {
        if (!ports.current() || !current()) fail("runtime_changed");
        if (!(ports.now() < deadline)) fail("expired");
    }
    function raw(
        reader: any,
        current: () => boolean,
        deadline: number
    ): string | null {
        check(current, deadline);
        if (!reader || !reader.current()) fail("unsupported_persistence");
        var value = reader.read(KEY);
        if (
            value !== null &&
            (typeof value !== "string" || ports.utf8(value).length > 65536)
        )
            fail("storage_unavailable");
        check(current, deadline);
        if (!reader.current()) fail("storage_unavailable");
        return value;
    }
    async function read(
        current: () => boolean,
        deadline: number,
        work: (before: string | null, proof: string | null) => Promise<any>
    ): Promise<any> {
        check(current, deadline);
        var grant = ports.host.physicalStorage();
        async function owned(reader: any, proof: string | null): Promise<any> {
            var before = raw(reader, current, deadline),
                result = await work(before, proof);
            if (raw(reader, current, deadline) !== before)
                fail("revision_conflict");
            return result;
        }
        if (!grant) return owned(ports.host.recoveryStorage(), null);
        return grant.exclusive(async function (held: any) {
            check(current, deadline);
            if (held !== grant || !grant.current()) fail("storage_unavailable");
            return owned(grant, await codec.backendProof(grant));
        });
    }
    async function execute(
        p: any,
        current: () => boolean,
        deadline: number
    ): Promise<any> {
        if (!validFavoritesRecoveryRequest(p)) fail("invalid_request");
        if (p.runtime !== ports.runtime()) fail("runtime_changed");
        check(current, deadline);
        var result: any;
        if (p.mode !== "acknowledge")
            result = await read(
                current,
                deadline,
                async function (before, proof) {
                    if (p.mode === "list") {
                        var state = await codec.snapshot(before);
                        return {
                            backend_proof: proof,
                            ledger_format: state.ledgerFormat,
                            ledger_revision: state.ledgerRevision,
                            records: state.records,
                        };
                    }
                    var view = await codec.inspect(before, {
                        backendProof: proof,
                        operationId: p.operation_id,
                        runtime: p.runtime,
                    });
                    return {
                        acknowledge_allowed: view.acknowledgeAllowed,
                        acknowledgement_id: view.acknowledgementId,
                        after_ledger_sha256: view.afterLedgerSha256,
                        backend_proof: proof,
                        ledger_format: view.ledgerFormat,
                        ledger_revision: view.ledgerRevision,
                        operation_id: p.operation_id,
                        plan_sha256: view.planDigest,
                        record: view.record,
                    };
                }
            );
        else {
            var grant = ports.host.physicalStorage();
            if (!grant) fail("unsupported_persistence");
            result = await grant.exclusive(async function (held: any) {
                var possibleWrite = false;
                try {
                    if (held !== grant) fail("storage_unavailable");
                    var before = raw(grant, current, deadline),
                        proof = await codec.backendProof(grant);
                    var view = await codec.inspect(before, {
                        backendProof: proof,
                        operationId: p.operation_id,
                        runtime: p.runtime,
                    });
                    if (
                        raw(grant, current, deadline) !== before ||
                        view.ledgerRevision !== p.expected_ledger_revision
                    )
                        fail("revision_conflict");
                    if (
                        !view.acknowledgeAllowed ||
                        !view.record ||
                        !sameScope(view.record.scope, p.scope) ||
                        view.record.original_entry_sha256 !==
                            p.original_entry_sha256 ||
                        proof !== p.backend_proof ||
                        view.planDigest !== p.plan_sha256 ||
                        view.acknowledgementId !== p.acknowledgement_id ||
                        view.afterLedgerSha256 !== p.after_ledger_sha256
                    )
                        fail("revision_conflict");
                    check(current, deadline);
                    possibleWrite = true;
                    if (
                        grant.compareAndSwap(KEY, before, view.afterRaw, () => {
                            check(current, deadline);
                            return true;
                        }) !== "confirmed"
                    )
                        fail("storage_unavailable");
                    if (
                        raw(grant, current, deadline) !== view.afterRaw ||
                        (await ports.sha256(view.afterRaw)) !==
                            p.after_ledger_sha256
                    )
                        fail("storage_unavailable");
                    var after = await codec.inspect(view.afterRaw, {
                        backendProof: proof,
                        operationId: p.operation_id,
                        runtime: p.runtime,
                    });
                    if (
                        !after.record ||
                        !after.record.acknowledgement ||
                        raw(grant, current, deadline) !== view.afterRaw
                    )
                        fail("storage_unavailable");
                    return {
                        acknowledged: true,
                        acknowledgement_id: p.acknowledgement_id,
                        ledger_revision: p.after_ledger_sha256,
                        operation_id: p.operation_id,
                        persistence: "persistent",
                        plan_sha256: p.plan_sha256,
                        record: after.record,
                    };
                } catch (error) {
                    if (possibleWrite) fail("storage_unavailable");
                    throw error;
                }
            });
        }
        check(current, deadline);
        result = Object.assign(
            { mode: p.mode, op: "recovery", runtime: p.runtime, version: 1 },
            result
        );
        if (
            !validFavoritesRecoveryResponse(result, p) ||
            ports.utf8(JSON.stringify(result)).length > 131072
        )
            fail("storage_unavailable");
        return result;
    }
    return {
        acknowledged: async function (
            expected: any,
            current: () => boolean,
            deadline: number
        ): Promise<boolean> {
            return read(current, deadline, async function (before, proof) {
                var original = codec.parse(before).entries.filter(function (
                    row: any
                ) {
                    return row.operationId === expected.operationId;
                })[0];
                var view = await codec.inspect(before, {
                    backendProof: proof,
                    operationId: expected.operationId,
                    runtime: ports.runtime(),
                });
                return (
                    !!proof &&
                    !!original &&
                    original.payloadHash === expected.payloadHash &&
                    sameScope(original.scope, expected.scope) &&
                    !!original.fence &&
                    original.fence.backendProof === proof &&
                    !!view.record &&
                    !!view.record.acknowledgement &&
                    view.record.acknowledgement.backend_proof === proof
                );
            });
        },
        execute,
        qualified: async function (
            current: () => boolean,
            deadline: number
        ): Promise<boolean> {
            if (!ports.host.physicalStorage()) return false;
            try {
                return await read(
                    current,
                    deadline,
                    async function (before, proof) {
                        await codec.snapshot(before);
                        return (
                            !!proof &&
                            (before === null || codec.capacity(before))
                        );
                    }
                );
            } catch (_) {
                return false;
            }
        },
    };
}
