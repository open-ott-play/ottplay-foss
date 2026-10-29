import { createPlexFavoriteReferences } from "../channels/favorites-plex-references";
import {
    encodeFavoritesDocumentJson,
    parseFavoritesDocumentJson,
} from "../commands/favorites-document-json";
import { createFavoritesPlexCodec } from "../media/favorites-plex-codec";
import { createPlexFavoritesDocument } from "../media/favorites-plex-document";
import { createCurrentPlexFavoritesTransferPort } from "../media/favorites-transfer-port";
import type {
    FavoritesPhysicalStorageGrant,
    FavoritesPhysicalStorageRead,
} from "../storage/favorites-physical-storage";
import { createFavoritesBindings } from "./favorites-bindings";
import { createFavoritesOperationReceipts } from "./favorites-operation-receipts";
import { createFavoritesRecoveryCodec } from "./favorites-recovery-codec";
import { isGlobalFavoriteSelector } from "./global-favorites-bindings";

/** Current, verified Plex only. Reads never initialize stores, claim legacy data or connect a provider. */
export function createFavoritesCurrentPlexHost(
    w: any,
    ports: {
        uuid(): string;
        now(): number;
        sha256(value: string | Uint8Array): string | Promise<string>;
        utf8(value: string): Uint8Array;
        storage:
            | {
                  compress(value: string): string;
                  decompress(value: string): string | null;
                  recoveryRequired(): boolean;
                  captureFavoritesPhysicalStorage?(): FavoritesPhysicalStorageGrant | null;
                  captureFavoritesPhysicalRead?(): FavoritesPhysicalStorageRead | null;
              }
            | undefined;
    }
) {
    var registryKey = "favorites-bindings.v1",
        receiptKey = "favorites-receipts.v1";
    // Main supplies its existing storage functions; this lazy module never
    // imports or initializes another storage adapter. Missing ports fail closed.
    var storagePorts = ports.storage,
        compress = storagePorts && storagePorts.compress,
        decompress = storagePorts && storagePorts.decompress,
        recoveryRequired = storagePorts && storagePorts.recoveryRequired;
    function storageCurrent(): boolean {
        try {
            return (
                !!storagePorts &&
                ports.storage === storagePorts &&
                typeof compress === "function" &&
                typeof decompress === "function" &&
                typeof recoveryRequired === "function" &&
                storagePorts.compress === compress &&
                storagePorts.decompress === decompress &&
                storagePorts.recoveryRequired === recoveryRequired &&
                recoveryRequired() === false
            );
        } catch (_) {
            return false;
        }
    }
    var physicalCapture =
        storagePorts && storagePorts.captureFavoritesPhysicalStorage;
    var readCapture = storagePorts && storagePorts.captureFavoritesPhysicalRead;
    function physicalStorage(): FavoritesPhysicalStorageGrant | null {
        try {
            if (
                !storageCurrent() ||
                typeof physicalCapture !== "function" ||
                storagePorts!.captureFavoritesPhysicalStorage !==
                    physicalCapture
            )
                return null;
            var value = physicalCapture();
            return value && value.current() ? value : null;
        } catch (_) {
            return null;
        }
    }
    function recoveryStorage(): FavoritesPhysicalStorageRead | null {
        try {
            if (
                !storageCurrent() ||
                typeof readCapture !== "function" ||
                storagePorts!.captureFavoritesPhysicalRead !== readCapture
            )
                return null;
            var value = readCapture();
            return value && value.current() ? value : null;
        } catch (_) {
            return null;
        }
    }
    var activePhysical: FavoritesPhysicalStorageGrant | null = null;
    var activeAdmission: (() => boolean) | null = null;
    var proofGrant: FavoritesPhysicalStorageGrant | null = null;
    var backendProof: string | null = null;
    var validatedLedger: string | null | undefined;
    var recoveryCodec = createFavoritesRecoveryCodec({
        sha256: async (text) => ports.sha256(ports.utf8(text)),
    });
    async function qualifyPhysical(): Promise<FavoritesPhysicalStorageGrant> {
        var value = physicalStorage();
        if (!value) fail("unsupported_persistence");
        if (proofGrant !== value || !backendProof) {
            var digest = await recoveryCodec.backendProof(value);
            if (
                !value.current() ||
                physicalStorage() !== value ||
                !/^[a-f0-9]{64}(?![\s\S])/.test(digest)
            )
                fail("unsupported_persistence");
            proofGrant = value;
            backendProof = digest;
        }
        return value;
    }
    async function validateNewAdmission(): Promise<void> {
        var value = await qualifyPhysical(),
            before = value.read(receiptKey);
        var state = await recoveryCodec.snapshot(before);
        if (
            physicalStorage() !== value ||
            !value.current() ||
            value.read(receiptKey) !== before
        )
            fail("reconciliation_required");
        if (state.records.some((record: any) => !record.acknowledgement))
            fail("reconciliation_required");
        validatedLedger = before;
    }
    function fence() {
        return proofGrant && proofGrant === physicalStorage() && backendProof
            ? {
                  backendProof: backendProof,
                  guardImplementationVersion: 1 as const,
                  version: 2 as const,
              }
            : null;
    }
    function writeGuard(value: any): boolean {
        var expected = fence();
        return (
            !!expected &&
            activePhysical === proofGrant &&
            !!activePhysical &&
            activePhysical.current() &&
            same(value, expected) &&
            !!activeAdmission &&
            activeAdmission()
        );
    }
    function exclusive<T>(
        value: FavoritesPhysicalStorageGrant,
        work: () => T | Promise<T>,
        current: () => boolean
    ): Promise<T> {
        return value.exclusive(function () {
            if (!current() || physicalStorage() !== value || activePhysical)
                fail("busy");
            activePhysical = value;
            activeAdmission = current;
            return Promise.resolve()
                .then(function () {
                    if (!current() || !value!.current())
                        fail("binding_changed");
                    return work();
                })
                .then(
                    function (result) {
                        activePhysical = null;
                        activeAdmission = null;
                        return result;
                    },
                    function (error) {
                        activePhysical = null;
                        activeAdmission = null;
                        throw error;
                    }
                );
        });
    }
    var target: any = null;
    var provisioning: { blocked: string | null } | null = null;
    var uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
    var validationScope = {
        profileBindingId: "00000000-0000-4000-8000-000000000001",
        provider: "plex",
        sourceBindingId: "00000000-0000-4000-8000-000000000002",
    };
    function fail(code: string): never {
        throw new Error(code);
    }
    function exact(v: any, fields: string[]) {
        return (
            !!v &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            Object.keys(v).sort().join(",") === fields.slice().sort().join(",")
        );
    }
    function same(a: any, b: any): boolean {
        if (a === b) return true;
        if (!a || !b || typeof a !== "object" || typeof b !== "object")
            return false;
        var keys = Object.keys(a).sort();
        return (
            keys.join(",") === Object.keys(b).sort().join(",") &&
            keys.every((k) => same(a[k], b[k]))
        );
    }
    function validScope(v: any) {
        return (
            exact(v, ["provider", "profileBindingId", "sourceBindingId"]) &&
            v.provider === "plex" &&
            uuidPattern.test(v.profileBindingId) &&
            uuidPattern.test(v.sourceBindingId) &&
            v.profileBindingId !== v.sourceBindingId
        );
    }
    function decode(raw: string | null): string | null {
        if (raw === null) return null;
        if (typeof raw !== "string" || raw.length > 1048576)
            fail("unsupported_persistence");
        var value =
            raw.slice(0, 4) === "\x01LZ\x01" ? decompress!(raw.slice(4)) : raw;
        if (typeof value !== "string" || ports.utf8(value).length > 1048576)
            fail("unsupported_persistence");
        return value;
    }
    function encode(value: string): string {
        if (ports.utf8(value).length > 1048576) fail("limits_exceeded");
        if (value.length > 200) {
            var packed = compress!(value);
            if (packed.length + 4 < value.length) return "\x01LZ\x01" + packed;
        }
        return value;
    }
    function base() {
        var driver = w.__ottActiveProviderDriver,
            storage = w.ottpStorage;
        var get = w.stbGetItem,
            set = w.stbSetItem,
            del = w.stbDelItem,
            persisted = w.stbGetPersistedItem;
        var identity = w.__ottSourceIdentity,
            favorites = w.__ottFavoritesLibrary,
            media = w.__ottMedia;
        if (
            !storageCurrent() ||
            !driver ||
            driver.id !== "plex" ||
            w.p_pref !== "plex" ||
            typeof driver.favoritesSource !== "function" ||
            !storage ||
            storage.get !== get ||
            storage.set !== set ||
            storage.del !== del ||
            typeof get !== "function" ||
            typeof set !== "function" ||
            typeof del !== "function" ||
            typeof persisted !== "function" ||
            !identity ||
            typeof identity.current !== "function" ||
            !favorites ||
            typeof favorites.transfer !== "function" ||
            !media ||
            typeof media.favoritesTransfer !== "function" ||
            w.sFavorites === -1 ||
            (storage.localPlayback && storage.localPlayback.active())
        )
            fail("unsupported_persistence");
        var provenance = driver.favoritesSource,
            proof = provenance.call(driver),
            keyFunction = driver.storageKey;
        if (
            !proof ||
            proof.verified !== true ||
            typeof proof.current !== "function" ||
            !proof.current() ||
            typeof proof.serverId !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}(?![\s\S])/.test(
                proof.serverId
            ) ||
            typeof proof.sourceId !== "string" ||
            !proof.sourceId ||
            proof.sourceId.length > 1024
        )
            fail("policy_denied");
        var channelSource = identity.current(w),
            channels = w.channels;
        if (
            typeof channelSource !== "string" ||
            !channelSource ||
            channelSource.length > 1024
        )
            fail("policy_denied");
        function physical(logical: string) {
            var key = keyFunction
                ? keyFunction.call(driver, logical)
                : "plex" + logical;
            if (
                typeof key !== "string" ||
                !key ||
                key.length > 1024 ||
                /[\u0000-\u001f\u007f]/.test(key)
            )
                fail("unsupported_persistence");
            return key;
        }
        var tvKey = physical("favoritesLibrary:" + channelSource),
            mediaKey = physical("mediaJournal.v1:" + proof.sourceId);
        if (
            tvKey === mediaKey ||
            [tvKey, mediaKey].some((k) => k === registryKey || k === receiptKey)
        )
            fail("unsupported_persistence");
        function current(): boolean {
            try {
                return (
                    storageCurrent() &&
                    w.__ottActiveProviderDriver === driver &&
                    driver.favoritesSource === provenance &&
                    proof.current() &&
                    w.p_pref === "plex" &&
                    driver.storageKey === keyFunction &&
                    w.ottpStorage === storage &&
                    storage.get === get &&
                    storage.set === set &&
                    storage.del === del &&
                    w.stbGetItem === get &&
                    w.stbSetItem === set &&
                    w.stbDelItem === del &&
                    w.stbGetPersistedItem === persisted &&
                    w.__ottSourceIdentity === identity &&
                    identity.current(w) === channelSource &&
                    physical("favoritesLibrary:" + channelSource) === tvKey &&
                    physical("mediaJournal.v1:" + proof.sourceId) ===
                        mediaKey &&
                    w.__ottFavoritesLibrary === favorites &&
                    w.__ottMedia === media &&
                    w.channels === channels &&
                    w.sFavorites !== -1 &&
                    !(
                        storage.localPlayback && storage.localPlayback.active()
                    ) &&
                    proof.current()
                );
            } catch (_) {
                return false;
            }
        }
        function raw(key: string, max = 1048576): string | null {
            if (!current()) fail("binding_changed");
            var value = get(key);
            if (
                (value !== null &&
                    (typeof value !== "string" || value.length > max)) ||
                persisted(key) !== value ||
                !current()
            )
                fail("unsupported_persistence");
            return value;
        }
        function read(logical: string) {
            return decode(raw(physical(logical)));
        }
        function emptyLegacy(
            scopedRaw: string | null,
            claim: string,
            source: string,
            keys: string[]
        ) {
            if (scopedRaw !== null) return;
            var claimed = read(claim);
            if (claimed && claimed !== source) return;
            keys.forEach((key) => {
                var value = read(key);
                if (value !== null && value !== "[]")
                    fail("unsupported_persistence");
            });
        }
        var tvRaw = raw(tvKey),
            mediaRaw = raw(mediaKey);
        emptyLegacy(tvRaw, "favoritesLibrarySource", channelSource, [
            "favoritesLists",
            "favoritesArray",
        ]);
        emptyLegacy(
            mediaRaw,
            "mediaJournalLegacyOwner:" +
                (typeof identity.legacy === "function"
                    ? identity.legacy(w)
                    : proof.sourceId),
            proof.sourceId,
            ["medFavorites", "medHistory"]
        );
        var tvValue =
            tvRaw === null
                ? {
                      defaultList: "Favorites",
                      lists: {
                          active: "Favorites",
                          lists: { Favorites: [] },
                          order: ["Favorites"],
                          v: 1,
                      },
                      sourceId: channelSource,
                      version: 2,
                  }
                : parseFavoritesDocumentJson(ports.utf8(decode(tvRaw)!));
        var mediaValue =
            mediaRaw === null
                ? {
                      favorites: [],
                      history: [],
                      sourceId: proof.sourceId,
                      version: 1,
                  }
                : parseFavoritesDocumentJson(ports.utf8(decode(mediaRaw)!));
        function validRows(rows: any) {
            return (
                Array.isArray(rows) &&
                rows.length <= 1000 &&
                rows.every(
                    (row) =>
                        row &&
                        row.sourceId === proof.sourceId &&
                        typeof row.itemId === "string" &&
                        !!row.itemId &&
                        typeof row.position === "number" &&
                        isFinite(row.position) &&
                        row.position >= 0 &&
                        row.payload &&
                        typeof row.payload === "object"
                )
            );
        }
        if (
            !mediaValue ||
            mediaValue.version !== 1 ||
            mediaValue.sourceId !== proof.sourceId ||
            !validRows(mediaValue.history) ||
            !validRows(mediaValue.favorites)
        )
            fail("unsupported_persistence");
        var tvHook = favorites.transfer,
            mediaHook = media.favoritesTransfer;
        var tv = tvHook.call(favorites, { document: tvValue, read }),
            journal = mediaHook.call(media, proof.sourceId, {
                document: mediaValue,
                read,
            });
        if (
            !tv ||
            tv.sourceId !== channelSource ||
            !journal ||
            !tv.current() ||
            !journal.current() ||
            !same(tv.snapshot(), tvValue) ||
            !same(JSON.parse(journal.snapshot()), mediaValue)
        )
            fail("revision_conflict");
        var originCurrent = current;
        var ownedCurrent = () =>
            originCurrent() &&
            favorites.transfer === tvHook &&
            media.favoritesTransfer === mediaHook &&
            tv.current() &&
            journal.current();
        return {
            channelSource,
            channels,
            contextCurrent: current,
            current: ownedCurrent,
            driver,
            get,
            journal,
            mediaKey,
            mediaRaw,
            mediaValue,
            persisted,
            proof,
            raw,
            read,
            set,
            tv,
            tvKey,
            tvRaw,
            tvValue,
        };
    }
    function authority() {
        if (!target || !target.owner.current()) {
            var owner = base(),
                id = ports.uuid();
            owner.current = owner.contextCurrent;
            if (!uuidPattern.test(id)) fail("storage_unavailable");
            target = { id: "plex-current-" + id, owner };
        }
        return target;
    }
    function selector(owner: any, kind: string) {
        return {
            channelSourceId: owner.channelSource,
            kind,
            mediaKey: owner.mediaKey,
            mediaSourceId: owner.proof.sourceId,
            serverId: owner.proof.serverId,
            tvKey: owner.tvKey,
        };
    }
    function grant(kind: string) {
        var a = authority();
        return {
            owner: "plex:" + a.owner.proof.serverId,
            selector: selector(a.owner, kind),
        };
    }
    function cas(
        owner: any,
        key: string,
        before: string | null,
        after: string,
        beforeWrite?: () => void
    ) {
        if (!owner.current() || owner.raw(key) !== before)
            return "conflict" as const;
        try {
            if (beforeWrite) beforeWrite();
            if (!owner.current() || owner.raw(key) !== before)
                return "conflict" as const;
            if (activePhysical) {
                var outcome = activePhysical.compareAndSwap(
                    key,
                    before,
                    after,
                    function () {
                        return (
                            owner.current() &&
                            !!activeAdmission &&
                            activeAdmission()
                        );
                    }
                );
                if (outcome !== "confirmed") return outcome;
            } else owner.set(key, after);
        } catch (_) {
            return "unknown" as const;
        }
        try {
            return owner.current() && owner.raw(key) === after
                ? ("confirmed" as const)
                : ("unknown" as const);
        } catch (_) {
            return "unknown" as const;
        }
    }
    var registry = createFavoritesBindings({
        compareAndSwap: (before, after) => {
            var attempt = provisioning,
                owner = authority().owner;
            if (!attempt) return "conflict" as const;
            return cas(owner, registryKey, before, after, () => {
                try {
                    unprotectedOutcomes(owner);
                } catch (error) {
                    // This guard is before target writes. Preserve the fixed wire
                    // rejection through the registry's conservative CAS wrapper.
                    attempt!.blocked =
                        error &&
                        (error as any).message === "reconciliation_required"
                            ? "reconciliation_required"
                            : "unsupported_persistence";
                    throw error;
                }
            });
        },
        current: (entry, value) => {
            try {
                return (
                    entry.provider === "plex" &&
                    same(value, grant(entry.kind)) &&
                    authority().owner.current()
                );
            } catch (_) {
                return false;
            }
        },
        persistedRead: () => authority().owner.raw(registryKey, 262144),
        provisionTarget: (id) => {
            var a = authority();
            if (id !== a.id) fail("binding_changed");
            return {
                profile: grant("profile"),
                provider: "plex",
                source: grant("source"),
                target_id: id,
                verified: true,
            };
        },
        read: () => authority().owner.raw(registryKey, 262144),
        uuid: ports.uuid,
        validateSelector: (kind, value) =>
            isGlobalFavoriteSelector(value) ||
            (exact(value, [
                "kind",
                "serverId",
                "channelSourceId",
                "mediaSourceId",
                "tvKey",
                "mediaKey",
            ]) &&
                value.kind === kind),
    });
    function binding(scope: any) {
        if (!validScope(scope)) return null;
        try {
            var p = registry.resolve(scope.profileBindingId),
                s = registry.resolve(scope.sourceBindingId),
                a = authority();
            if (
                p.entry.kind !== "profile" ||
                s.entry.kind !== "source" ||
                s.entry.profile_id !== p.entry.id ||
                p.entry.provider !== "plex" ||
                s.entry.provider !== "plex" ||
                p.revision !== s.revision
            )
                return null;
            var revision = String(p.revision),
                before = a.owner.raw(registryKey, 262144);
            return {
                current: () => {
                    try {
                        return (
                            a.owner.current() &&
                            a === target &&
                            a.owner.raw(registryKey, 262144) === before
                        );
                    } catch (_) {
                        return false;
                    }
                },
                revision,
            };
        } catch (_) {
            return null;
        }
    }
    var receiptService = createFavoritesOperationReceipts({
        compareAndSwap: (before, after) =>
            cas(authority().owner, receiptKey, before, after),
        current: (scope) => {
            var b = binding(scope);
            return !!b && b.current();
        },
        fence: fence,
        now: ports.now,
        persistedRead: () => authority().owner.raw(receiptKey, 65536),
        read: () => authority().owner.raw(receiptKey, 65536),
        writeGuard: writeGuard,
    });
    function unprotectedOutcomes(owner: any): void {
        var raw = owner.raw(receiptKey, 65536);
        try {
            receiptService.status("00000000-0000-4000-8000-000000000003");
        } catch (_) {
            fail("unsupported_persistence");
        }
        // Validation and the protected-outcome decision use the same persisted
        // physical bytes; drift never authorizes a binding mutation.
        if (owner.raw(receiptKey, 65536) !== raw)
            fail("reconciliation_required");
        if (
            raw !== null &&
            JSON.parse(raw).entries.some(
                (entry: any) =>
                    entry.state !== "verified" &&
                    entry.state !== "not_applied" &&
                    (!entry.recovery_ack || raw !== validatedLedger)
            )
        )
            fail("reconciliation_required");
    }
    function documentFor(owner: any) {
        var plex = createFavoritesPlexCodec({
            current: () =>
                owner.current()
                    ? {
                          serverId: owner.proof.serverId,
                          sourceId: owner.proof.sourceId,
                          verified: true,
                      }
                    : null,
            request: (path) => ({ path }),
        });
        return createPlexFavoritesDocument({
            current: () =>
                owner.current()
                    ? {
                          channelSourceId: owner.channelSource,
                          current: owner.current,
                          serverId: owner.proof.serverId,
                          sourceId: owner.proof.sourceId,
                          verified: true,
                      }
                    : null,
            json: {
                encode: encodeFavoritesDocumentJson,
                parse: parseFavoritesDocumentJson,
            },
            plex,
            references: createPlexFavoriteReferences(
                owner.channels,
                owner.proof
            ),
        });
    }
    var document = {
        decode: (bytes: Uint8Array, scope: any) =>
            documentFor(base()).decode(bytes, scope),
        prepare: (bytes: Uint8Array, scope: any, media: any) =>
            documentFor(base()).prepare(bytes, scope, media),
        snapshot: (scope: any, tv: any, media: any) =>
            documentFor(base()).snapshot(scope, tv, media),
        validate: (bytes: Uint8Array, scope: any) =>
            documentFor(base()).validate(bytes, scope),
    };
    function capture(expected: any) {
        var owner = base(),
            b = binding(expected);
        if (!b || !b.current()) fail("binding_changed");
        var ownedCurrent = owner.current;
        owner.current = () => ownedCurrent() && b!.current();
        // Admission spans cache adoption by this operation. Physical/profile identity
        // and the exact binding stay fixed; the write owner separately fences caches.
        var admissionCurrent = () => owner.contextCurrent() && b!.current();
        return Object.assign(owner, {
            admissionCurrent,
            binding: b,
            encodePhysical: encode,
            ledger: receiptService,
            physicalHash: (raw: string | null) =>
                JSON.stringify({ value: raw }),
            receiptKey,
            scope: JSON.parse(JSON.stringify(expected)),
        });
    }
    function qualified() {
        try {
            var owner = base();
            documentFor(owner).snapshot(
                validationScope,
                owner.tvValue,
                owner.mediaValue
            );
            registry.list();
            receiptService.status("00000000-0000-4000-8000-000000000003");
            return owner.current();
        } catch (_) {
            return false;
        }
    }
    function catalog() {
        var a = authority(),
            listing = registry.list(),
            bindings: any[] = [];
        listing.entries.forEach((row: any) => {
            if (row.kind !== "source" || row.provider !== "plex") return;
            var scope = {
                profileBindingId: row.profile_id,
                provider: "plex",
                sourceBindingId: row.id,
            };
            var b = binding(scope);
            if (b && b.current())
                bindings.push({ codecVersion: 1, scope, target_id: a.id });
        });
        if (!a.owner.current()) fail("binding_changed");
        return {
            binding_revision: String(listing.revision),
            bindings,
            targets: [
                {
                    codecVersion: 1,
                    display: "Current Plex profile / source",
                    provider: "plex",
                    serverId: a.owner.proof.serverId,
                    target_id: a.id,
                },
            ],
        };
    }
    function provision(params: any) {
        if (provisioning) fail("busy");
        var fields = [
            "op",
            "runtime",
            "mode",
            "target_id",
            "expected_binding_revision",
            "codecVersion",
        ];
        if (params && params.mode !== "create") fields.push("scope");
        if (params && params.mode === "replace-current")
            fields.push("prior_scope");
        if (
            !exact(params, fields) ||
            params.op !== "provision" ||
            typeof params.runtime !== "string" ||
            !/^[a-z0-9-]{1,64}(?![\s\S])/.test(params.runtime) ||
            ["create", "import", "pair", "replace-current"].indexOf(
                params.mode
            ) < 0 ||
            params.codecVersion !== 1 ||
            typeof params.target_id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(
                params.target_id
            ) ||
            typeof params.expected_binding_revision !== "string" ||
            !/^(?:0|[1-9][0-9]{0,15})(?![\s\S])/.test(
                params.expected_binding_revision
            ) ||
            Number(params.expected_binding_revision) > 9007199254740991 ||
            (params.mode !== "create" && !validScope(params.scope)) ||
            (params.mode === "replace-current" &&
                (!validScope(params.prior_scope) ||
                    [
                        params.scope.profileBindingId,
                        params.scope.sourceBindingId,
                    ].some(
                        (id: string) =>
                            id === params.prior_scope.profileBindingId ||
                            id === params.prior_scope.sourceBindingId
                    )))
        )
            fail("invalid_request");
        var value: any = { mode: params.mode, target_id: params.target_id };
        if (params.scope) {
            value.profile_id = params.scope.profileBindingId;
            value.source_id = params.scope.sourceBindingId;
        }
        if (params.prior_scope) {
            value.prior_profile_id = params.prior_scope.profileBindingId;
            value.prior_source_id = params.prior_scope.sourceBindingId;
        }
        unprotectedOutcomes(authority().owner);
        var attempt = { blocked: null as string | null };
        provisioning = attempt;
        try {
            var result = registry.provisionPlex(
                value,
                Number(params.expected_binding_revision)
            );
            return {
                binding_revision: String(result.revision),
                changed: result.changed,
                mode: params.mode,
                outcome: "verified",
                paired: true,
                persistence: "persistent",
                scope: {
                    profileBindingId: result.result.profile.id,
                    provider: "plex",
                    sourceBindingId: result.result.source.id,
                },
                target_id: params.target_id,
            };
        } catch (error) {
            if (attempt.blocked) fail(attempt.blocked);
            var code = error && (error as any).code;
            if (code === "outcome_unknown") fail("outcome_unknown");
            if (
                [
                    "revision_conflict",
                    "registry_changed",
                    "context_changed",
                    "target_unavailable",
                    "conflict",
                ].indexOf(code) >= 0
            )
                fail("binding_changed");
            if (["storage_unavailable", "invalid_registry"].indexOf(code) >= 0)
                fail("unsupported_persistence");
            fail("policy_denied");
        } finally {
            provisioning = null;
        }
    }
    function provisionExclusive(
        params: any,
        current: () => boolean = () => true
    ): Promise<any> {
        var value = physicalStorage();
        if (!value) return Promise.reject(new Error("unsupported_persistence"));
        return exclusive(
            value,
            async function () {
                await validateNewAdmission();
                if (!current() || !value!.current()) fail("binding_changed");
                return provision(params);
            },
            current
        );
    }
    return {
        binding,
        captureContext: function () {
            var owner = base(),
                before = owner.raw(registryKey, 262144);
            registry.list();
            unprotectedOutcomes(owner);
            return {
                current: () => {
                    try {
                        return (
                            owner.contextCurrent() &&
                            owner.raw(registryKey, 262144) === before
                        );
                    } catch (_) {
                        return false;
                    }
                },
            };
        },
        catalog,
        createAdapter: function (admitOperation: any) {
            var port = createCurrentPlexFavoritesTransferPort(w, {
                admitOperation,
                binding,
                capture,
                document,
                now: ports.now,
                receipts: {
                    current: () => {
                        try {
                            return authority().owner.current();
                        } catch (_) {
                            return false;
                        }
                    },
                    factory: createFavoritesOperationReceipts,
                    physicalKey: receiptKey,
                    service: receiptService,
                },
                sha256: ports.sha256,
                utf8: ports.utf8,
            });
            var inspect = port.inspect,
                apply = port.apply;
            port.inspect = async function (
                expected: any,
                operationId?: string,
                context?: any
            ) {
                await validateNewAdmission();
                return inspect(expected, operationId, context);
            };
            port.apply = async function (
                plan: any,
                context: any,
                current: () => boolean
            ) {
                var value = await qualifyPhysical();
                return exclusive(
                    value,
                    function () {
                        return apply(plan, context, function () {
                            return current() && value.current();
                        });
                    },
                    current
                );
            };
            return port;
        },
        document,
        physicalStorage,
        provision,
        provisionExclusive,
        qualified,
        recoveryStorage,
        validateNewAdmission,
    };
}
(window as any).__ottFavoritesCurrentPlexHost = {
    create: createFavoritesCurrentPlexHost,
};
