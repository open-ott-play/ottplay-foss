const crypto = require("node:crypto"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript");
const root = path.resolve(__dirname, ".."),
    cache = {};
function load(name) {
    if (name === "src/utils/caseless.ts")
        return require("./helpers/global-favorites-main-ports.cjs").actualModule(
            name,
            {}
        );
    if (cache[name]) return cache[name];
    const exports = (cache[name] = {});
    const code = ts.transpileModule(
        fs.readFileSync(path.join(root, name), "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    vm.runInNewContext(code, {
        exports,
        Uint8Array,
        require: (p) =>
            load(
                path.posix.normalize(
                    path.posix.join(path.posix.dirname(name), p + ".ts")
                )
            ),
    });
    return exports;
}
const hash = (x) =>
    crypto
        .createHash("sha256")
        .update(typeof x === "string" ? x : Buffer.from(x))
        .digest("hex");
function fixture() {
    const data = new Map(),
        events = [],
        authorized = new Set();
    let active = true,
        held = false,
        serial = 0,
        committer = null;
    const hooks = {};
    const grant = {
        origin: "https://fixture.invalid",
        privateLedgerKey: "favorites-receipts.v1",
        lockName: "ottplay:favorites-ledger",
        implementationVersion: 1,
        kind: "synchronous-localstorage",
        current: () => active,
        read: (key) => (data.has(key) ? data.get(key) : null),
        async exclusive(work) {
            if (held) throw Error("busy");
            held = true;
            try {
                return await work(grant);
            } finally {
                held = false;
            }
        },
        compareAndSwap(key, before, after, admission) {
            if (
                !held ||
                !active ||
                (admission && !admission()) ||
                grant.read(key) !== before
            )
                return "conflict";
            if (hooks.before) hooks.before(key);
            if (
                !active ||
                (admission && !admission()) ||
                grant.read(key) !== before
            )
                return "conflict";
            events.push(key);
            data.set(key, after);
            if (hooks.after) hooks.after(key);
            return hooks.unknown === key ? "unknown" : "confirmed";
        },
    };
    const codec = load(
        "src/settings/global-favorites-portable.ts"
    ).createGlobalFavoritesPortableCodec();
    const store = load(
        "src/settings/global-favorites.ts"
    ).createGlobalFavoritesStore({
        capture: () => grant,
        current: () => active,
        migrationCurrent: () => true,
        canWrite: () => !!committer && committer.canWrite(),
        sha256: async (x) => hash(x),
        uuid: () =>
            `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
        codec,
    });
    const context = hash("context");
    committer = load(
        "src/settings/global-favorites-receipts.ts"
    ).createGlobalFavoritesCommitter({
        store,
        codec,
        capture: () => grant,
        current: () => active,
        sha256: async (x) => hash(x),
        contextRevision: async () => context,
        captureContext: async () => ({
            revision: context,
            current: () => active,
        }),
        now: () => 1000000,
        freshAdmission: async (id, hash) =>
            authorized.has(id) ||
            !!(hooks.authority && hooks.authority(id, hash)),
        authorizedOperation: async (id) =>
            authorized.has(id) || hooks.statusAllowed === true,
    });
    return {
        data,
        events,
        hooks,
        grant,
        codec,
        store,
        committer,
        context,
        authorize: (id) => authorized.add(id),
        deactivate: () => {
            active = false;
        },
    };
}
const row = (title = "Film") => ({
    title,
    origin: {
        provider: "m3u",
        profile: "TV",
        subprofile: null,
        sourceAlias: "TV",
    },
    locator: { kind: "channel", channelId: "001" },
});
module.exports = { load, hash, fixture, row };
