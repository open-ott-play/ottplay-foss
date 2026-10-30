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
        require: (p) =>
            load(
                path.posix.normalize(
                    path.posix.join(path.posix.dirname(name), p + ".ts")
                )
            ),
        Uint8Array,
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
        current: () => active,
        async exclusive(work) {
            if (held) throw Error("busy");
            held = true;
            try {
                return await work(grant);
            } finally {
                held = false;
            }
        },
        implementationVersion: 1,
        kind: "synchronous-localstorage",
        lockName: "ottplay:favorites-ledger",
        origin: "https://fixture.invalid",
        privateLedgerKey: "favorites-receipts.v1",
        read: (key) => (data.has(key) ? data.get(key) : null),
    };
    const codec = load(
        "src/settings/global-favorites-portable.ts"
    ).createGlobalFavoritesPortableCodec();
    const store = load(
        "src/settings/global-favorites.ts"
    ).createGlobalFavoritesStore({
        canWrite: () => !!committer && committer.canWrite(),
        capture: () => grant,
        codec,
        current: () => active,
        migrationCurrent: () => true,
        sha256: async (x) => hash(x),
        uuid: () =>
            `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    });
    const context = hash("context");
    committer = load(
        "src/settings/global-favorites-receipts.ts"
    ).createGlobalFavoritesCommitter({
        authorizedOperation: async (id) =>
            authorized.has(id) || hooks.statusAllowed === true,
        capture: () => grant,
        captureContext: async () => ({
            current: () => active,
            revision: context,
        }),
        codec,
        contextRevision: async () => context,
        current: () => active,
        freshAdmission: async (id, hash) =>
            authorized.has(id) ||
            !!(hooks.authority && hooks.authority(id, hash)),
        now: () => 1000000,
        sha256: async (x) => hash(x),
        store,
    });
    return {
        authorize: (id) => authorized.add(id),
        codec,
        committer,
        context,
        data,
        deactivate: () => {
            active = false;
        },
        events,
        grant,
        hooks,
        store,
    };
}
const row = (title = "Film") => ({
    locator: { channelId: "001", kind: "channel" },
    origin: {
        profile: "TV",
        provider: "m3u",
        sourceAlias: "TV",
        subprofile: null,
    },
    title,
});
module.exports = { fixture, hash, load, row };
