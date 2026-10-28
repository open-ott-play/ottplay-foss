const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(
    path.join(__dirname, "../src/settings/favorites-bindings.ts"),
    "utf8",
);
const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES5 },
}).outputText;
const host = {};
vm.runInNewContext(output, { window: host });
const plain = (value) => JSON.parse(JSON.stringify(value));
const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const bind = (slot, owner = "current") => ({ owner, selector: { slot } });
function fixture() {
    const state = { raw: null, writes: 0, next: 1, stale: new Set() };
    const ports = {
        read: () => state.raw,
        compareAndSwap: (before, after) => {
            state.writes++;
            if (state.raw !== before) return "conflict";
            state.raw = after;
            return "confirmed";
        },
        uuid: () => id(state.next++),
        validateSelector: (_kind, value) => Number.isInteger(value.slot),
        current: (entry, value) =>
            value.owner === "current" && !state.stale.has(entry.id),
    };
    const api = host.__ottFavoritesBindings.create(ports);
    const profile = (slot = 1) =>
        api.create(
            { kind: "profile", provider: "m3u", binding: bind(slot) },
            api.list().revision,
        ).result;
    const media = (profileId, slot = 1) =>
        api.create(
            {
                kind: "source",
                provider: "m3u",
                profile_id: profileId,
                binding: bind(slot),
            },
            api.list().revision,
        ).result;
    return { state, ports, api, profile, media };
}
function rejected(code, operation) {
    assert.throws(
        operation,
        (error) =>
            error.code === code && !error.message.includes("fixture-secret"),
    );
}
let passed = 0;
function test(name, operation) {
    operation();
    passed++;
    console.log(`PASS ${name}`);
}
test("create/resolve/reload/public projection keeps private bindings out", () => {
    const f = fixture();
    assert.deepEqual(plain(f.api.list()), {
        version: 1,
        revision: 0,
        entries: [],
    });
    const p = f.profile(),
        s = f.media(p.id);
    f.ports.validateSelector = () => true;
    f.api.bind(
        s.id,
        {
            owner: "current",
            selector: {
                path: "/private/fixture-secret",
                grant: "fixture-secret",
            },
        },
        2,
    );
    const publicText = JSON.stringify(f.api.list());
    assert(!publicText.includes("fixture-secret"));
    assert(!publicText.includes("selector"));
    assert.equal(f.api.lookup(s.id).entry.profile_id, p.id);
    const reload = host.__ottFavoritesBindings.create(f.ports);
    assert.equal(
        reload.resolve(s.id).binding.selector.path,
        "/private/fixture-secret",
    );
    assert.equal(reload.resolve(s.id).revision, 3);
    rejected("missing_binding", () => reload.lookup(id(99)));
});
test("save/rebind keeps IDs and identical repeat is no-op", () => {
    const f = fixture(),
        p = f.profile();
    const changed = f.api.bind(p.id, bind(2), 1);
    assert.equal(changed.result.id, p.id);
    assert.equal(changed.revision, 2);
    const raw = f.state.raw,
        writes = f.state.writes;
    assert.equal(f.api.bind(p.id, bind(2), 2).changed, false);
    assert.equal(f.state.raw, raw);
    assert.equal(f.state.writes, writes);
    rejected("registry_changed", () => f.api.bind(p.id, bind(3), 1));
});
test("public import preserves IDs, imports no grants and requires explicit binding", () => {
    const f = fixture(),
        p = f.profile(),
        s = f.media(p.id);
    const g = fixture(),
        rows = plain(f.api.list().entries);
    assert.equal(g.api.importPublic(rows, 0).revision, 1);
    assert.deepEqual(plain(g.api.list().entries), rows);
    rejected("unbound", () => g.api.resolve(s.id));
    rejected("unbound", () => g.api.bind(s.id, bind(1), 1));
    g.api.bind(p.id, bind(3), 1);
    g.api.bind(s.id, bind(4), 2);
    assert.equal(g.api.resolve(s.id).entry.id, s.id);
    const writes = g.state.writes;
    assert.equal(g.api.importPublic(rows, 3).changed, false);
    assert.equal(g.state.writes, writes);
    rejected("invalid_registry", () =>
        g.api.importPublic([{ ...rows[0], binding: bind(1) }], 3),
    );
});
test("conflicting import is all-or-nothing and exact parent is required", () => {
    const f = fixture(),
        p = f.profile(),
        before = f.state.raw;
    rejected("conflict", () =>
        f.api.importPublic(
            [
                { id: id(9), kind: "profile", provider: "plex" },
                { ...p, provider: "plex" },
            ],
            1,
        ),
    );
    assert.equal(f.state.raw, before);
    rejected("missing_profile", () =>
        f.api.importPublic(
            [{ id: id(9), kind: "source", provider: "m3u", profile_id: id(8) }],
            1,
        ),
    );
    rejected("missing_profile", () =>
        f.api.importPublic(
            [{ id: id(9), kind: "source", provider: "plex", profile_id: p.id }],
            1,
        ),
    );
    f.api.importPublic(
        [{ id: id(9), kind: "source", provider: "m3u", profile_id: p.id }],
        1,
    );
    assert.equal(f.api.lookup(id(9)).entry.profile_id, p.id);
});
test("duplicate exact targets refuse ambiguity; same name is never a lookup", () => {
    const f = fixture(),
        p = f.profile();
    rejected("ambiguous_binding", () => f.profile(1));
    f.ports.validateSelector = () => true;
    f.api.bind(
        p.id,
        { owner: "current", selector: { slot: 1, label: "Home" } },
        1,
    );
    rejected("ambiguous_binding", () =>
        f.api.create(
            {
                kind: "profile",
                provider: "m3u",
                binding: {
                    owner: "current",
                    selector: { label: "Home", slot: 1 },
                },
            },
            2,
        ),
    );
    rejected("invalid_id", () => f.api.resolve("Home"));
});
test("source resolve verifies both its own and parent current owner", () => {
    const f = fixture(),
        p = f.profile(),
        s = f.media(p.id);
    f.state.stale.add(p.id);
    rejected("stale_context", () => f.api.resolve(s.id));
    f.state.stale.clear();
    f.state.stale.add(s.id);
    rejected("stale_context", () => f.api.resolve(s.id));
    f.ports.current = () => {
        throw Error("fixture-secret");
    };
    rejected("stale_context", () => f.api.resolve(p.id));
});
test("copy-as-new remaps profile and every source without retaining private grants", () => {
    const f = fixture(),
        p = f.profile(),
        s = f.media(p.id),
        s2 = f.media(p.id, 2);
    const copied = f.api.copyProfile(
        p.id,
        {
            profile: bind(9),
            sources: [
                { id: s.id, binding: bind(5) },
                { id: s2.id, binding: bind(6) },
            ],
        },
        3,
    ).result;
    assert.equal(copied.length, 3);
    assert.equal(
        new Set([...copied.map((r) => r.id), p.id, s.id, s2.id]).size,
        6,
    );
    assert(copied.slice(1).every((r) => r.profile_id === copied[0].id));
    assert.equal(f.api.resolve(copied[1].id).binding.selector.slot, 5);
    assert.equal(f.api.resolve(p.id).binding.selector.slot, 1);
    rejected("invalid_binding", () =>
        f.api.copyProfile(p.id, { profile: bind(10), sources: [] }, 4),
    );
});
test("UUID format and collision errors never mutate", () => {
    const f = fixture(),
        p = f.profile(),
        before = f.state.raw;
    f.ports.uuid = () => p.id;
    rejected("conflict", () => f.profile(2));
    for (const value of [
        "Home",
        "00000000-0000-0000-8000-000000000000",
        id(10).toUpperCase(),
    ]) {
        f.ports.uuid = () => value;
        rejected("identity_unavailable", () => f.profile(2));
    }
    assert.equal(f.state.raw, before);
});
test("conflict and uncertain persistence are distinct and never retried", () => {
    for (const mode of [
        "conflict",
        "unknown",
        "throw",
        "after_throw",
        "lying_confirmed",
    ]) {
        const f = fixture();
        let calls = 0;
        f.ports.compareAndSwap = (_before, after) => {
            calls++;
            if (mode === "after_throw") f.state.raw = after;
            if (mode.includes("throw")) throw Error("fixture-secret");
            return mode === "lying_confirmed" ? "confirmed" : mode;
        };
        rejected(
            mode === "conflict" ? "registry_changed" : "outcome_unknown",
            () => f.profile(),
        );
        assert.equal(calls, 1);
        if (mode === "after_throw")
            assert.equal(f.api.list().entries.length, 1);
    }
});
test("reentrant writer and changed snapshot fail closed", () => {
    const f = fixture(),
        p = f.profile();
    f.ports.current = () => {
        rejected("busy", () => f.api.bind(p.id, bind(3), 1));
        return true;
    };
    f.api.bind(p.id, bind(2), 1);
    f.ports.current = () => {
        f.state.raw += " ";
        return true;
    };
    rejected("registry_changed", () => f.api.bind(p.id, bind(2), 2));
    rejected("registry_changed", () => f.api.resolve(p.id));
});
test("bounded strict documents and selectors reject malformed state", () => {
    const f = fixture();
    for (const raw of [
        "{",
        "[]",
        JSON.stringify({ version: true, revision: 0, entries: [] }),
        JSON.stringify({ version: 1, revision: 0.5, entries: [] }),
        " ".repeat(524289),
    ]) {
        f.state.raw = raw;
        rejected("invalid_registry", () => f.api.list());
    }
    f.state.raw = null;
    f.ports.validateSelector = () => true;
    for (const selector of [
        { text: "x".repeat(4097) },
        { n: Infinity },
        JSON.parse('{"__proto__":{}}'),
        { x: [undefined] },
    ]) {
        rejected("invalid_selector", () =>
            f.api.create(
                {
                    kind: "profile",
                    provider: "m3u",
                    binding: { owner: "current", selector },
                },
                0,
            ),
        );
    }
    f.ports.validateSelector = () => {
        throw Error("fixture-secret");
    };
    rejected("invalid_selector", () => f.profile());
});
test("entry capacity is bounded without partial import", () => {
    const f = fixture();
    const rows = Array.from({ length: 256 }, (_v, i) => ({
        id: id(i + 1),
        kind: "profile",
        provider: "m3u",
    }));
    f.api.importPublic(rows, 0);
    const before = f.state.raw;
    rejected("invalid_registry", () =>
        f.api.importPublic(
            [{ id: id(500), kind: "profile", provider: "m3u" }],
            1,
        ),
    );
    assert.equal(f.state.raw, before);
});
test("selector depth, collection and byte limits are checked before CAS", () => {
    const f = fixture();
    f.ports.validateSelector = () => true;
    let deep = {};
    for (let i = 0; i < 10; i++) deep = { child: deep };
    for (const selector of [
        deep,
        { values: Array(65).fill(1) },
        {
            a: "x".repeat(4096),
            b: "x".repeat(4096),
            c: "x".repeat(4096),
            d: "x".repeat(4096),
        },
    ]) {
        rejected("invalid_selector", () =>
            f.api.create(
                {
                    kind: "profile",
                    provider: "m3u",
                    binding: { owner: "current", selector },
                },
                0,
            ),
        );
    }
    assert.equal(f.state.writes, 0);
});
test("post-confirmation read failure is unknown, not an unchanged result", () => {
    const f = fixture();
    const compare = f.ports.compareAndSwap;
    f.ports.compareAndSwap = (before, after) => {
        const result = compare(before, after);
        f.ports.read = () => {
            throw Error("fixture-secret");
        };
        return result;
    };
    rejected("outcome_unknown", () => f.profile());
    assert.equal(f.state.writes, 1);
    assert.equal(JSON.parse(f.state.raw).entries.length, 1);
});
test("shared traversal budget stops before later selector fields", () => {
    const f = fixture();
    let validated = 0;
    f.ports.validateSelector = () => {
        validated++;
        return true;
    };
    const nodes = {};
    for (const key of "abcdefgh") nodes[key] = Array(64).fill(1);
    let laterReads = 0;
    Object.defineProperty(nodes.h, 63, {
        enumerable: true,
        get: () => {
            laterReads++;
            return 1;
        },
    });
    const bytes = { a: "é".repeat(4096), b: "é".repeat(4096) };
    Object.defineProperty(bytes, "z", {
        enumerable: true,
        get: () => {
            laterReads++;
            return 1;
        },
    });
    for (const selector of [nodes, bytes]) {
        rejected("invalid_selector", () =>
            f.api.create(
                {
                    kind: "profile",
                    provider: "m3u",
                    binding: { owner: "current", selector },
                },
                0,
            ),
        );
    }
    assert.equal(
        laterReads,
        0,
        "reject before expanding the tail, not after constructing the whole selector",
    );
    assert.equal(validated, 0);
    assert.equal(f.state.writes, 0);
    const ordinary = {
        slot: 1,
        folders: ["Films", "répertoire"],
        options: { enabled: true, position: null },
    };
    const created = f.api.create(
        {
            kind: "profile",
            provider: "m3u",
            binding: { owner: "current", selector: ordinary },
        },
        0,
    );
    assert.deepEqual(
        plain(f.api.resolve(created.result.id).binding.selector),
        ordinary,
    );
});
function provisioningFixture() {
    const f = fixture();
    f.grant = {
        verified: true,
        provider: "plex",
        target_id: "plex-current-target",
        profile: bind(10),
        source: bind(11),
    };
    f.ports.persistedRead = () => f.state.raw;
    f.ports.provisionTarget = (targetId) =>
        targetId === f.grant.target_id ? plain(f.grant) : null;
    f.ports.current = (entry, binding) =>
        entry.provider === "plex" &&
        f.grant.verified === true &&
        binding.owner === "current" &&
        binding.selector.slot === (entry.kind === "profile" ? 10 : 11);
    return f;
}
const bootstrap = { mode: "create", target_id: "plex-current-target" };
test("empty-player Plex bootstrap creates and pairs parent/source in ONE physical CAS", () => {
    const f = provisioningFixture();
    const result = f.api.provisionPlex(bootstrap, 0);
    assert.equal(result.revision, 1);
    assert.equal(f.state.writes, 1);
    assert.equal(result.result.profile.id, id(1));
    assert.equal(result.result.source.id, id(2));
    assert.equal(result.result.source.profile_id, id(1));
    assert.equal(f.api.resolve(id(1)).binding.selector.slot, 10);
    assert.equal(f.api.resolve(id(2)).binding.selector.slot, 11);
    assert(!JSON.stringify(result).includes("selector"));
    assert(!JSON.stringify(result).includes("owner"));
    const before = f.state.raw;
    rejected("ambiguous_binding", () => f.api.provisionPlex(bootstrap, 1));
    assert.equal(f.state.raw, before);
    assert.equal(f.state.writes, 1);
});
test("second player explicitly imports portable UUIDs and pairs only local target grants", () => {
    const first = provisioningFixture(),
        second = provisioningFixture();
    const ids = first.api.provisionPlex(bootstrap, 0).result;
    second.grant.profile.selector.slot = 20;
    second.grant.source.selector.slot = 21;
    second.ports.current = (entry, binding) =>
        entry.provider === "plex" &&
        binding.owner === "current" &&
        binding.selector.slot === (entry.kind === "profile" ? 20 : 21);
    const result = second.api.provisionPlex(
        {
            mode: "import",
            target_id: second.grant.target_id,
            profile_id: ids.profile.id,
            source_id: ids.source.id,
        },
        0,
    );
    assert.equal(result.result.profile.id, ids.profile.id);
    assert.equal(result.result.source.id, ids.source.id);
    assert.equal(second.state.writes, 1);
    assert.equal(second.api.resolve(ids.source.id).binding.selector.slot, 21);
    const imported = provisioningFixture();
    imported.api.importPublic(first.api.list().entries, 0);
    rejected("unbound", () => imported.api.resolve(ids.source.id));
    assert.equal(
        imported.api.provisionPlex(
            {
                mode: "pair",
                target_id: imported.grant.target_id,
                profile_id: ids.profile.id,
                source_id: ids.source.id,
            },
            1,
        ).revision,
        2,
    );
});
test("explicit identical pair is idempotent and cannot silently rebind", () => {
    const f = provisioningFixture(),
        result = f.api.provisionPlex(bootstrap, 0).result;
    const request = {
        mode: "pair",
        target_id: f.grant.target_id,
        profile_id: result.profile.id,
        source_id: result.source.id,
    };
    assert.equal(f.api.provisionPlex(request, 1).changed, false);
    assert.equal(f.state.writes, 1);
    f.grant.source.selector.slot = 12;
    rejected("already_bound", () => f.api.provisionPlex(request, 1));
    assert.equal(f.state.writes, 1);
});
test("provisioning refuses foreign provider parent relation and owner mismatches", () => {
    const f = provisioningFixture();
    const p = { id: id(10) };
    f.api.importPublic([{ id: p.id, kind: "profile", provider: "m3u" }], 0);
    rejected("conflict", () =>
        f.api.provisionPlex(
            {
                mode: "import",
                target_id: f.grant.target_id,
                profile_id: p.id,
                source_id: id(99),
            },
            1,
        ),
    );
    assert.equal(f.state.writes, 1);
    const g = provisioningFixture();
    g.grant.source.owner = "foreign";
    rejected("parent_owner_mismatch", () => g.api.provisionPlex(bootstrap, 0));
    assert.equal(g.state.writes, 0);
    const h = provisioningFixture();
    h.ports.current = (entry) => entry.kind !== "source";
    rejected("stale_context", () => h.api.provisionPlex(bootstrap, 0));
    assert.equal(h.state.writes, 0);
    const i = provisioningFixture();
    i.api.importPublic(
        [
            { id: id(10), kind: "profile", provider: "plex" },
            { id: id(11), kind: "profile", provider: "plex" },
            {
                id: id(12),
                kind: "source",
                provider: "plex",
                profile_id: id(11),
            },
        ],
        0,
    );
    rejected("conflict", () =>
        i.api.provisionPlex(
            {
                mode: "pair",
                target_id: i.grant.target_id,
                profile_id: id(10),
                source_id: id(12),
            },
            1,
        ),
    );
});
test("provisioning storage unavailable conflict and uncertain reserve remain honest", () => {
    const f = provisioningFixture();
    delete f.ports.persistedRead;
    rejected("storage_unavailable", () => f.api.provisionPlex(bootstrap, 0));
    assert.equal(f.state.writes, 0);
    const g = provisioningFixture();
    g.ports.persistedRead = () => {
        throw Error("fixture-secret");
    };
    rejected("storage_unavailable", () => g.api.provisionPlex(bootstrap, 0));
    assert.equal(g.state.writes, 0);
    for (const result of ["conflict", "unknown", "confirmed"]) {
        const h = provisioningFixture();
        h.ports.compareAndSwap = () => result;
        rejected(
            result === "conflict" ? "registry_changed" : "outcome_unknown",
            () => h.api.provisionPlex(bootstrap, 0),
        );
    }
    const i = provisioningFixture();
    const compare = i.ports.compareAndSwap;
    i.ports.compareAndSwap = (before, after) => {
        compare(before, after);
        i.ports.persistedRead = () => {
            throw Error("fixture-secret");
        };
        return "confirmed";
    };
    rejected("outcome_unknown", () => i.api.provisionPlex(bootstrap, 0));
    assert.equal(JSON.parse(i.state.raw).entries.length, 2);
});
test("current target and exact physical bytes rechecked before and after provisioning CAS", () => {
    const f = provisioningFixture();
    let calls = 0;
    f.ports.provisionTarget = () => {
        if (++calls > 1) f.grant.profile.selector.slot = 99;
        return plain(f.grant);
    };
    rejected("target_changed", () => f.api.provisionPlex(bootstrap, 0));
    assert.equal(f.state.writes, 0);
    const g = provisioningFixture();
    const compare = g.ports.compareAndSwap;
    g.ports.compareAndSwap = (before, after) => {
        compare(before, after);
        g.grant.verified = false;
        return "confirmed";
    };
    rejected("outcome_unknown", () => g.api.provisionPlex(bootstrap, 0));
    const h = provisioningFixture();
    let reads = 0;
    h.ports.persistedRead = () => {
        if (++reads > 1) return '{"version":1,"revision":0,"entries":[]}';
        return h.state.raw;
    };
    rejected("registry_changed", () => h.api.provisionPlex(bootstrap, 0));
    assert.equal(h.state.writes, 0);
});
test("wire selectors unknown targets and unverified manual server grants are refused", () => {
    const f = provisioningFixture();
    for (const value of [
        { ...bootstrap, selector: { slot: 1 } },
        { ...bootstrap, target_id: "https://secret" },
        { ...bootstrap, target_id: "other-target" },
    ])
        rejected(
            value.target_id === "other-target"
                ? "target_unavailable"
                : "invalid_provision",
            () => f.api.provisionPlex(value, 0),
        );
    for (const verified of [false, "true", 1]) {
        f.grant.verified = verified;
        rejected("target_unavailable", () => f.api.provisionPlex(bootstrap, 0));
    }
    assert.equal(f.state.writes, 0);
});
test("UUID final newline is rejected in existing import creation and new pairing", () => {
    const f = provisioningFixture();
    rejected("invalid_registry", () =>
        f.api.importPublic(
            [{ id: id(1) + "\n", kind: "profile", provider: "plex" }],
            0,
        ),
    );
    rejected("invalid_id", () => f.api.lookup(id(1) + "\n"));
    f.ports.uuid = () => id(1) + "\n";
    rejected("identity_unavailable", () => f.api.provisionPlex(bootstrap, 0));
    rejected("invalid_provision", () =>
        f.api.provisionPlex(
            {
                mode: "import",
                target_id: f.grant.target_id,
                profile_id: id(1) + "\n",
                source_id: id(2),
            },
            0,
        ),
    );
    const g = provisioningFixture(),
        ids = g.api.provisionPlex(bootstrap, 0).result;
    rejected("invalid_provision", () =>
        g.api.provisionPlex(
            {
                mode: "pair",
                target_id: g.grant.target_id,
                profile_id: ids.profile.id,
                source_id: ids.source.id + "\n",
            },
            1,
        ),
    );
});
function replacementRequest(previous, profile_id = id(50), source_id = id(51)) {
    return {
        mode: "replace-current",
        target_id: "plex-current-target",
        profile_id,
        source_id,
        prior_profile_id: previous.profile.id,
        prior_source_id: previous.source.id,
    };
}
test("explicit replacement moves ONLY pair grants in one CAS and retains old public IDs", () => {
    const f = provisioningFixture(),
        prior = f.api.provisionPlex(bootstrap, 0).result;
    const before = f.state.raw,
        calls = [];
    const compare = f.ports.compareAndSwap;
    f.ports.compareAndSwap = (raw, after) => {
        calls.push([raw, after]);
        return compare(raw, after);
    };
    const result = f.api.provisionPlex(replacementRequest(prior), 1);
    assert.equal(result.changed, true);
    assert.equal(result.revision, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], before);
    assert.equal(f.api.list().entries.length, 4);
    assert.deepEqual(
        plain(f.api.lookup(prior.profile.id).entry),
        plain(prior.profile),
    );
    assert.deepEqual(
        plain(f.api.lookup(prior.source.id).entry),
        plain(prior.source),
    );
    const raw = JSON.parse(f.state.raw);
    assert.equal(
        Object.hasOwn(
            raw.entries.find((row) => row.id === prior.profile.id),
            "binding",
        ),
        false,
    );
    assert.equal(
        Object.hasOwn(
            raw.entries.find((row) => row.id === prior.source.id),
            "binding",
        ),
        false,
    );
    rejected("unbound", () => f.api.resolve(prior.source.id));
    assert.equal(f.api.resolve(id(51)).binding.selector.slot, 11);
    assert(!JSON.stringify(result).includes("selector"));
});
test("replacement requires distinct complete scopes; same scope uses idempotent pair", () => {
    const f = provisioningFixture(),
        prior = f.api.provisionPlex(bootstrap, 0).result;
    for (const request of [
        replacementRequest(prior, prior.profile.id, prior.source.id),
        replacementRequest(prior, prior.profile.id, id(51)),
        replacementRequest(prior, id(50), prior.source.id),
    ])
        rejected("conflict", () => f.api.provisionPlex(request, 1));
    const same = f.api.provisionPlex(
        {
            mode: "pair",
            target_id: f.grant.target_id,
            profile_id: prior.profile.id,
            source_id: prior.source.id,
        },
        1,
    );
    assert.equal(same.changed, false);
    assert.equal(same.revision, 1);
    assert.equal(f.state.writes, 1);
});
test("stale or foreign prior and additional bound children block replacement", () => {
    const f = provisioningFixture(),
        prior = f.api.provisionPlex(bootstrap, 0).result;
    rejected("missing_binding", () =>
        f.api.provisionPlex(
            { ...replacementRequest(prior), prior_source_id: id(99) },
            1,
        ),
    );
    const foreign = JSON.parse(f.state.raw);
    foreign.entries.find((row) => row.kind === "source").binding.selector.slot =
        99;
    f.state.raw = JSON.stringify(foreign);
    rejected("prior_scope_mismatch", () =>
        f.api.provisionPlex(replacementRequest(prior), 1),
    );
    assert.equal(f.state.writes, 1);
    const g = provisioningFixture(),
        gp = g.api.provisionPlex(bootstrap, 0).result;
    const value = JSON.parse(g.state.raw);
    value.entries.push({
        id: id(99),
        kind: "source",
        provider: "plex",
        profile_id: gp.profile.id,
        binding: bind(99),
    });
    g.state.raw = JSON.stringify(value);
    const before = g.state.raw;
    rejected("bound_children", () =>
        g.api.provisionPlex(replacementRequest(gp), 1),
    );
    assert.equal(g.state.raw, before);
});
test("new provider parent and existing private binding conflicts never withdraw old grants", () => {
    for (const incoming of [
        [{ id: id(50), kind: "profile", provider: "m3u" }],
        [
            { id: id(50), kind: "profile", provider: "plex" },
            { id: id(52), kind: "profile", provider: "plex" },
            {
                id: id(51),
                kind: "source",
                provider: "plex",
                profile_id: id(52),
            },
        ],
        [{ id: id(50), kind: "profile", provider: "plex", binding: bind(90) }],
    ]) {
        const f = provisioningFixture(),
            prior = f.api.provisionPlex(bootstrap, 0).result;
        const value = JSON.parse(f.state.raw);
        value.entries.push(...incoming);
        f.state.raw = JSON.stringify(value);
        const before = f.state.raw;
        rejected(incoming[0].binding ? "already_bound" : "conflict", () =>
            f.api.provisionPlex(replacementRequest(prior), 1),
        );
        assert.equal(f.state.raw, before);
        assert.equal(f.state.writes, 1);
    }
});
test("replacement uncertainty and current drift never claim verified or retry CAS", () => {
    const f = provisioningFixture(),
        prior = f.api.provisionPlex(bootstrap, 0).result;
    const compare = f.ports.compareAndSwap;
    f.ports.compareAndSwap = (before, after) => {
        compare(before, after);
        return "unknown";
    };
    rejected("outcome_unknown", () =>
        f.api.provisionPlex(replacementRequest(prior), 1),
    );
    assert.equal(f.state.writes, 2);
    const value = JSON.parse(f.state.raw);
    assert.equal(
        value.entries.find((row) => row.id === prior.profile.id).binding,
        undefined,
    );
    const g = provisioningFixture(),
        gp = g.api.provisionPlex(bootstrap, 0).result;
    let calls = 0;
    g.ports.provisionTarget = () => {
        if (++calls > 1) g.grant.source.selector.slot = 99;
        return plain(g.grant);
    };
    rejected("target_changed", () =>
        g.api.provisionPlex(replacementRequest(gp), 1),
    );
    assert.equal(g.state.writes, 1);
    const h = provisioningFixture(),
        hp = h.api.provisionPlex(bootstrap, 0).result;
    const hc = h.ports.compareAndSwap;
    h.ports.compareAndSwap = (before, after) => {
        hc(before, after);
        h.grant.verified = false;
        return "confirmed";
    };
    rejected("outcome_unknown", () =>
        h.api.provisionPlex(replacementRequest(hp), 1),
    );
});
test("frozen additive provisioning DTO fixtures map exactly to registry results", () => {
    const document = JSON.parse(
        fs.readFileSync(
            path.join(
                __dirname,
                "../docs/design/favorites-provisioning-v1.json",
            ),
            "utf8",
        ),
    );
    assert.equal(document.seven_transfer_operations, "UNCHANGED");
    for (const [mode, example] of Object.entries(document.examples)) {
        const f = provisioningFixture(),
            request = example.request;
        f.grant.target_id = request.target_id;
        function flat(value) {
            const result = { mode: value.mode, target_id: value.target_id };
            if (value.scope) {
                result.profile_id = value.scope.profileBindingId;
                result.source_id = value.scope.sourceBindingId;
            }
            if (value.prior_scope) {
                result.prior_profile_id = value.prior_scope.profileBindingId;
                result.prior_source_id = value.prior_scope.sourceBindingId;
            }
            return result;
        }
        if (mode === "create") {
            const ids = [
                example.response.scope.profileBindingId,
                example.response.scope.sourceBindingId,
            ];
            f.ports.uuid = () => ids.shift();
        }
        if (mode === "pair" || mode === "replace-current") {
            const scope = request.prior_scope || request.scope;
            f.api.provisionPlex(
                {
                    mode: "import",
                    target_id: request.target_id,
                    profile_id: scope.profileBindingId,
                    source_id: scope.sourceBindingId,
                },
                0,
            );
        }
        const result = f.api.provisionPlex(
            flat(request),
            Number(request.expected_binding_revision),
        );
        const wire = {
            version: 1,
            runtime: request.runtime,
            op: "provision",
            mode,
            paired: true,
            changed: result.changed,
            binding_revision: String(result.revision),
            target_id: result.result.target_id,
            scope: {
                profileBindingId: result.result.profile.id,
                sourceBindingId: result.result.source.id,
                provider: "plex",
            },
            persistence: "persistent",
            outcome: "verified",
        };
        assert.deepEqual(wire, example.response);
        assert.deepEqual(
            Object.keys(wire).sort(),
            document.response_fields_exact.slice().sort(),
        );
        assert.equal(
            result.changed
                ? String(result.revision) !== request.expected_binding_revision
                : String(result.revision) === request.expected_binding_revision,
            true,
        );
    }
});
console.log(`Favorites bindings: ${passed} tests passed`);
