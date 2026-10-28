const remoteTransferDependency = require("./helpers/remote-transfer-dependency.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");

const code = ts.transpileModule(
    fs.readFileSync("src/commands/remote-requests.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(provider = "vportal") {
    let clock = 1000;
    let loading = true;
    let restricted = false;
    let kiosk = false;
    let modal = null;
    let runtime = "page-123";
    let source = "source-a";
    let snapshot;
    const effects = [];
    const host = {
        __ottActiveProviderDriver: {
            catalogLoading: () => loading,
            id: provider,
        },
        __ottClassicScreenPort: {
            listOwner: () => null,
            screens: { current: () => modal },
        },
        __ottKiosk: { enabled: () => kiosk },
        __ottParental: { needs: () => restricted },
        catIndex: 0,
        cats: { All: [101, 909, 303], Overlap: [101], Сериал: [303, 101] },
        catsArray: ["All", "Сериал", "Overlap"],
        channels: {
            101: { channel_name: "Один", itemId: "vportal:one" },
            303: { channel_name: "Три", itemId: "vportal:three" },
            909: { channel_name: "Два", itemId: "vportal:two" },
        },
        cList: [101, 909, 303],
        commandChannelsReady: true,
        curList: [101, 909, 303],
        listCatIndex: 0,
        playChannel(category, index, remote) {
            effects.push(["play", category, index, remote]);
            this.catIndex = category;
            this.primaryIndex = index;
            this.curList = this.cats[this.catsArray[category]];
            return true;
        },
        primaryIndex: 1,
        queue: { ids: ["explicit-a", "explicit-b"], index: 1 },
        stbGetVolume: () => 20,
    };
    const groups = ["system:all", "vportal:series", "vportal:overlap"];
    host.__ottChannels = {
        browse(id) {
            effects.push(["browse", id]);
            host.listCatIndex = groups.indexOf(id);
            return true;
        },
        browsingGroup: () => groups[host.listCatIndex],
        group: (index) => groups[index],
        index: (id) => groups.indexOf(id),
        remoteCatalog: () => snapshot,
    };
    function refresh() {
        const snapshotSource = source;
        const next = {
            active: () => snapshot === next && source === snapshotSource,
            all: host.cats.All.slice(),
            canonicalIds: host.cList.slice(),
            groups: groups.map((id, index) => ({
                id,
                members: host.cats[host.catsArray[index]].slice(),
                name: host.catsArray[index],
            })),
        };
        snapshot = next;
    }
    refresh();
    const context = {
        Date: { now: () => clock },
        exports: {},
        require(name) {
            const actual = remoteTransferDependency(name, host, {
                Date: { now: () => clock },
            });
            if (actual) return actual;
            if (name === "../utils/caseless")
                return { caselessKey: (value) => value.toLowerCase() };
            if (name === "./remote-restart")
                return {
                    executeRemoteControl: (_w, action, _params, done) =>
                        done({ data: { action, version: 1 }, status: "ok" }),
                    remotePlayerInfo: () => ({
                        platform: "browser",
                        runtime,
                        version: "test",
                    }),
                };
            return {};
        },
        window: host,
    };
    vm.runInNewContext(code, context);
    function call(action, params = {}) {
        let result;
        context.exports.executeRemoteRequest(
            { action, params },
            (value) => (result = plain(value))
        );
        assert.ok(result, "request completed synchronously");
        return result;
    }
    const list = (params = {}) =>
        call("categories", {
            limit: 200,
            offset: 0,
            op: "list",
            runtime: "page-123",
            ...params,
        });
    const select = (catalog, category) =>
        call("categories", {
            catalog,
            category,
            op: "select",
            runtime: "page-123",
        });
    const rows = (catalog, category = "all", params = {}) =>
        call("channels", {
            catalog,
            category,
            limit: 200,
            offset: 0,
            runtime: "page-123",
            ...params,
        });
    return {
        advance: (value) => (clock += value),
        call,
        effects,
        host,
        kiosk: (value) => (kiosk = value),
        list,
        loading: (value) => (loading = value),
        modal: (value) => (modal = value),
        refresh,
        restricted: (value) => (restricted = value),
        rows,
        runtime: (value) => (runtime = value),
        select,
        source: (value) => (source = value),
    };
}

{
    const f = fixture();
    const capability = f.call("capabilities").data;
    assert.equal(
        Object.hasOwn(capability, "favorites_transfer"),
        false,
        "real transfer qualification leaves unsupported provider capabilities unchanged"
    );
    assert.deepEqual(capability.categories, {
        maxPageSize: 200,
        operations: ["list", "select"],
        version: 1,
    });
    const first = f.list({ limit: 2 });
    assert.equal(first.status, "ok");
    assert.deepEqual(first.data.categories, [
        { count: 3, id: "all", name: "All" },
        { count: 2, id: "vportal:series", name: "Сериал" },
    ]);
    assert.equal(first.data.loading, true);
    assert.equal(first.data.has_more, true);
    const last = f.list({ catalog: first.data.catalog, limit: 2, offset: 2 });
    assert.deepEqual(last.data.categories, [
        { count: 1, id: "vportal:overlap", name: "Overlap" },
    ]);
    assert.equal(last.data.catalog, first.data.catalog);
    assert.equal(last.data.has_more, false);
    f.loading(false);
    assert.equal(
        f.list({ catalog: first.data.catalog }).data.loading,
        false,
        "completion with no appended IDs is observable"
    );
    const before = plain({
        category: f.host.catIndex,
        index: f.host.primaryIndex,
        list: f.host.curList,
        queue: f.host.queue,
    });
    assert.equal(f.select(first.data.catalog, "vportal:series").status, "ok");
    assert.deepEqual(
        plain({
            category: f.host.catIndex,
            index: f.host.primaryIndex,
            list: f.host.curList,
            queue: f.host.queue,
        }),
        before
    );
    assert.equal(f.list().data.selected, "vportal:series");
    const rows = f.rows(first.data.catalog, "vportal:series", { limit: 1 });
    assert.deepEqual(
        rows.data.channels,
        [{ id: "vportal:one", name: "Один", number: 1 }],
        "global order overrides the group's custom order"
    );
    assert.notEqual(rows.data.catalog, first.data.catalog);
    const next = f.rows(rows.data.catalog, "vportal:series", {
        limit: 1,
        offset: 1,
    });
    assert.deepEqual(next.data.channels, [
        { id: "vportal:three", name: "Три", number: 3 },
    ]);
    assert.equal(next.data.catalog, rows.data.catalog);
    const played = f.call("play_catalog", {
        catalog: rows.data.catalog,
        id: "vportal:three",
    });
    assert.deepEqual(played.data, {
        channel: next.data.channels[0],
        dispatched: true,
    });
    assert.deepEqual(
        f.effects.at(-1),
        ["play", 1, 0, true],
        "stable item identity resolves the provider map key in the bound category"
    );
    assert.deepEqual(
        f.host.curList,
        [303, 101],
        "next/previous retain the actual playing category order"
    );
}

{
    const f = fixture();
    const catalog = f.list().data.catalog;
    f.select(catalog, "vportal:series");
    assert.equal(f.call("play", { query: "3" }).status, "ok");
    assert.deepEqual(
        f.effects.at(-1),
        ["play", 1, 0, true],
        "global numeric play prefers the browsed category when it contains the item"
    );
    assert.equal(f.call("play", { query: "2" }).status, "ok");
    assert.deepEqual(
        f.effects.at(-1),
        ["play", 0, 1, true],
        "outside-category global number retains the prior fallback"
    );
    assert.deepEqual(
        f.call("channels", { query: "ignored legacy field", search: "" }).data
            .channels,
        [
            { id: 101, name: "Один", number: 1 },
            { id: 909, name: "Два", number: 2 },
            { id: 303, name: "Три", number: 3 },
        ],
        "legacy channels keep their exact contract"
    );
}

{
    const f = fixture();
    const catalog = f.list().data.catalog;
    const rows = f.rows(catalog, "vportal:series");
    const count = f.effects.length;
    for (const change of [
        () => f.kiosk(true),
        () => {
            f.kiosk(false);
            f.restricted(true);
        },
        () => {
            f.restricted(false);
            f.modal({ kind: "dialog" });
        },
        () => f.modal({ kind: "list", model: { localOnlyInput: true } }),
    ]) {
        change();
        assert.equal(
            f.list().status,
            "ok",
            "read-only category metadata remains available under locks"
        );
        assert.equal(
            f.select(catalog, "vportal:series").data.error,
            "restricted"
        );
        assert.equal(
            f.call("play_catalog", {
                catalog: rows.data.catalog,
                id: "vportal:one",
            }).status,
            "rejected"
        );
        assert.equal(f.effects.length, count);
    }
}

{
    const f = fixture();
    const catalog = f.list().data.catalog;
    const rows = f.rows(catalog, "vportal:series", { search: "О" });
    assert.equal(
        f.rows(rows.data.catalog, "vportal:series", { search: "Т" }).data.error,
        "catalog_changed"
    );
    assert.equal(
        f.rows(rows.data.catalog, "vportal:overlap", { search: "О" }).data
            .error,
        "catalog_changed"
    );
    assert.equal(
        f.call("play_catalog", {
            catalog: rows.data.catalog,
            id: "vportal:three",
        }).status,
        "rejected",
        "search binding excludes a nonmatch"
    );
    f.host.cList.push(404);
    f.host.channels[404] = { channel_name: "Четыре", itemId: "vportal:four" };
    f.host.cats.All.push(404);
    f.refresh();
    assert.equal(
        f.rows(rows.data.catalog, "vportal:series", { search: "О" }).data.error,
        "catalog_changed"
    );
    assert.equal(
        f.select(catalog, "vportal:series").data.error,
        "catalog_changed"
    );
    assert.equal(
        f.call("play_catalog", {
            catalog: rows.data.catalog,
            id: "vportal:one",
        }).status,
        "rejected"
    );
    assert.equal(
        f.effects.length,
        0,
        "progressive append invalidates old reads without a playback fallback"
    );
    const newRows = f.rows(f.list().data.catalog);
    f.host.__ottActiveProviderDriver.id = "plex";
    assert.equal(
        f.call("play_catalog", {
            catalog: newRows.data.catalog,
            id: "vportal:one",
        }).status,
        "rejected",
        "provider change is fenced even if a producer is buggy"
    );
}

{
    const f = fixture();
    const catalog = f.list().data.catalog;
    for (const params of [
        { offset: true },
        { offset: -1 },
        { limit: 0 },
        { limit: 201 },
        { offset: 1 },
        { op: "other" },
        { extra: "secret" },
        { runtime: "bad\n" },
    ]) {
        assert.equal(f.list(params).data.error, "invalid_request");
    }
    assert.equal(f.list({ runtime: "other" }).data.error, "runtime_mismatch");
    assert.equal(
        f.list({ runtime: "other" }).data.runtime,
        "other",
        "a mismatch receipt binds to the submitted request"
    );
    assert.equal(f.select(catalog, "bad\u0085").data.error, "invalid_request");
    assert.equal(f.list({ catalog, offset: 4 }).data.error, "invalid_request");
    assert.equal(f.select(catalog, "missing").data.error, "category_not_found");
    assert.equal(f.select(catalog, "bad\n").data.error, "invalid_request");
    assert.equal(
        f.rows(catalog, "all", { search: "secret\n" }).data.error,
        "invalid_request"
    );
    assert.equal(
        f.rows(catalog, "all", { extra: "secret" }).data.error,
        "invalid_request"
    );
    assert.equal(f.effects.length, 0);
    f.host.channels[909].itemId = "vportal:one";
    assert.equal(
        f.rows(catalog).data.error,
        "unavailable",
        "colliding stable identities never produce an ambiguous play receipt"
    );
}

{
    const f = fixture();
    f.host.cats.All.reverse();
    f.refresh();
    const all = f.rows(f.list().data.catalog);
    assert.deepEqual(
        all.data.channels.map((row) => [row.id, row.number]),
        [
            ["vportal:one", 1],
            ["vportal:two", 2],
            ["vportal:three", 3],
        ],
        "editing All order never changes canonical video numbers"
    );
    assert.equal(f.call("play", { query: "1" }).data.channel.id, 101);
    assert.deepEqual(f.effects.at(-1), ["play", 0, 2, true]);
    f.host.cats.All = [909];
    f.refresh();
    const category = f.rows(f.list().data.catalog, "vportal:series");
    assert.deepEqual(
        category.data.channels.map((row) => [row.id, row.number]),
        [
            ["vportal:one", 1],
            ["vportal:three", 3],
        ],
        "a video removed from editable All remains discoverable in its other categories"
    );
    assert.equal(
        f.call("play_catalog", {
            catalog: category.data.catalog,
            id: "vportal:three",
        }).status,
        "ok"
    );
    assert.deepEqual(f.effects.at(-1), ["play", 1, 0, true]);
}

{
    const f = fixture("m3u");
    assert.equal(f.call("capabilities").data.categories, undefined);
    assert.equal(f.list().status, "unsupported");
    const media = fixture();
    const catalog = media.list().data.catalog;
    const rows = media.rows(catalog);
    media.advance(120001);
    assert.equal(media.rows(rows.data.catalog).data.error, "catalog_changed");
    assert.equal(
        media.call("play_catalog", {
            catalog: rows.data.catalog,
            id: "vportal:one",
        }).status,
        "rejected"
    );
    const oldest = media.list().data.catalog;
    for (let index = 0; index < 40; index++) media.list();
    assert.equal(
        media.select(oldest, "all").data.error,
        "catalog_changed",
        "the receipt registry is bounded"
    );
}
{
    const f = fixture();
    f.host.channels[101].channel_name = " Один ";
    const rows = f.rows(f.list().data.catalog);
    assert.equal(rows.status, "ok");
    assert.equal(
        rows.data.channels[0].name,
        " Один ",
        "bounded display whitespace is retained"
    );
}
{
    const f = fixture();
    let failed = false;
    f.host.__ottActiveProviderDriver.catalogError = () => failed;
    const catalog = f.list().data.catalog;
    const bound = f.rows(catalog, "vportal:series").data.catalog;
    const before = plain({
        browse: f.host.listCatIndex,
        category: f.host.catIndex,
        channels: f.host.channels,
        index: f.host.primaryIndex,
        list: f.host.curList,
        queue: f.host.queue,
    });
    f.loading(false);
    failed = true;
    for (const response of [
        f.list(),
        f.rows(bound, "vportal:series"),
        f.select(catalog, "vportal:series"),
    ]) {
        assert.equal(response.status, "rejected");
        assert.equal(response.data.error, "catalog_incomplete");
        assert.equal(response.data.state, "error");
    }
    const play = f.call("play_catalog", { catalog: bound, id: "vportal:one" });
    assert.equal(play.status, "rejected");
    assert.match(play.data.error, /catalogue scan failed/);
    assert.equal(
        f.effects.length,
        0,
        "a terminal partial scan never authorizes a modern mutation"
    );
    assert.deepEqual(
        plain({
            browse: f.host.listCatIndex,
            category: f.host.catIndex,
            channels: f.host.channels,
            index: f.host.primaryIndex,
            list: f.host.curList,
            queue: f.host.queue,
        }),
        before,
        "incomplete catalogue reads preserve loaded UI rows and playback"
    );
    assert.equal(
        f.call("channels", {}).data.channels.length,
        3,
        "legacy loaded-row listing remains available"
    );
    failed = false;
    assert.equal(
        f.rows(bound, "vportal:series").data.error,
        "catalog_changed",
        "observed failure invalidates retained receipts"
    );
    delete f.host.__ottActiveProviderDriver.catalogError;
    const compatible = f.list();
    assert.equal(
        compatible.status,
        "ok",
        "an absent optional error hook preserves compatibility"
    );
    assert.equal(f.rows(compatible.data.catalog).status, "ok");
}
{
    for (const label of [
        "Ж".repeat(300),
        "📂".repeat(200),
        "a".repeat(509) + "📂",
        "a".repeat(507) + "📂xx",
    ]) {
        const f = fixture();
        f.host.catsArray[1] = label;
        f.host.cats[label] = f.host.cats.Сериал;
        f.refresh();
        const listing = f.list();
        assert.equal(
            listing.status,
            "ok",
            "a long category breadcrumb remains listable"
        );
        const category = listing.data.categories[1];
        assert.equal(
            category.id,
            "vportal:series",
            "projection does not alter stable category IDs"
        );
        assert.ok(Buffer.byteLength(category.name, "utf8") <= 512);
        assert.ok(category.name.endsWith("…"));
        assert.equal(
            Buffer.from(category.name, "utf8").toString("utf8"),
            category.name,
            "UTF-8 projection never splits surrogate pairs"
        );
        assert.equal(
            f.select(listing.data.catalog, category.id).status,
            "ok",
            "truncated labels remain selectable by exact ID"
        );
        assert.equal(
            f.rows(listing.data.catalog, category.id).data.channels[0].name,
            "Один",
            "video title display and matching are unchanged"
        );
    }
    const f = fixture();
    const exact = "a".repeat(508) + "📂";
    f.host.__ottChannels.remoteCatalog().groups[1].name = exact;
    assert.equal(
        f.list().data.categories[1].name,
        exact,
        "an exact 512-byte label remains intact"
    );
    for (const label of [
        "a".repeat(600) + "\ud800",
        "a".repeat(600) + "\u0085",
        { request: { url: "private-provider-url" }, title: "a".repeat(600) },
    ]) {
        f.host.__ottChannels.remoteCatalog().groups[1].name = label;
        const rejected = f.list();
        assert.equal(rejected.status, "rejected");
        assert.equal(rejected.data.error, "unavailable");
        assert.ok(
            !JSON.stringify(rejected).includes("private-provider-url"),
            "provider objects are never display-label fallbacks"
        );
    }
}
function pagedFixture(kind) {
    const f = fixture();
    const first = f.list({ limit: 1 });
    const catalog =
        kind === "categories"
            ? first.data.catalog
            : f.rows(first.data.catalog, "all", { limit: 1 }).data.catalog;
    return {
        ...f,
        catalog,
        read: (params = {}) =>
            kind === "categories"
                ? f.list({ catalog, limit: 1, ...params })
                : f.rows(catalog, "all", { limit: 1, ...params }),
    };
}

for (const kind of ["categories", "channels"]) {
    const f = pagedFixture(kind);
    for (const offset of [1, 2]) {
        f.advance(60000);
        const page = f.read({ offset });
        assert.equal(
            page.status,
            "ok",
            `${kind}: active pagination survives the original 120s deadline`
        );
        assert.equal(page.data.catalog, f.catalog);
        assert.equal(page.data.offset, offset);
        assert.equal(page.data[kind].length, 1);
    }
    f.advance(119999);
    assert.equal(f.read({ offset: 2 }).status, "ok");
    f.advance(120000);
    assert.equal(
        f.read({ offset: 2 }).data.error,
        "catalog_changed",
        `${kind}: the renewed receipt expires at exactly 120s of inactivity`
    );
    assert.equal(f.effects.length, 0, "pagination never changes playback");

    const idle = pagedFixture(kind);
    idle.advance(120000);
    assert.equal(
        idle.read().data.error,
        "catalog_changed",
        `${kind}: an idle receipt cannot be revived at its expiry boundary`
    );
}

for (const kind of ["categories", "channels"]) {
    for (const params of [
        { extra: "unexpected" },
        { limit: 201 },
        { offset: 4 },
        { runtime: "page-other" },
        ...(kind === "channels"
            ? [{ category: "missing" }, { search: "different" }]
            : []),
    ]) {
        const f = pagedFixture(kind);
        f.advance(119999);
        assert.equal(f.read(params).status, "rejected");
        f.advance(1);
        assert.equal(
            f.read().data.error,
            "catalog_changed",
            `${kind}: rejected access ${JSON.stringify(params)} does not renew`
        );
    }

    const malformed = pagedFixture(kind);
    const record =
        kind === "categories"
            ? malformed.host.__ottChannels.remoteCatalog().groups[1]
            : malformed.host.channels[909];
    const field = kind === "categories" ? "name" : "channel_name";
    const original = record[field];
    malformed.advance(119999);
    record[field] = "invalid\n";
    assert.equal(malformed.read().data.error, "unavailable");
    record[field] = original;
    malformed.advance(1);
    assert.equal(
        malformed.read().data.error,
        "catalog_changed",
        `${kind}: failed result validation does not renew a receipt`
    );

    const selection = pagedFixture(kind);
    selection.advance(119999);
    assert.equal(selection.select(selection.catalog, "all").status, "ok");
    selection.advance(1);
    assert.equal(
        selection.read().data.error,
        "catalog_changed",
        `${kind}: successful category selection does not renew a receipt`
    );
}

{
    const f = pagedFixture("channels");
    f.advance(119999);
    assert.equal(
        f.call("play_catalog", { catalog: f.catalog, id: "vportal:one" })
            .status,
        "ok"
    );
    f.advance(1);
    assert.equal(
        f.read().data.error,
        "catalog_changed",
        "successful playback does not renew a receipt"
    );
}

for (const kind of ["categories", "channels"]) {
    for (const change of ["snapshot", "source", "provider", "runtime"]) {
        const f = pagedFixture(kind);
        f.advance(60000);
        assert.equal(f.read({ offset: 1 }).status, "ok");
        if (change === "snapshot") f.refresh();
        if (change === "source") f.source("source-b");
        if (change === "provider") f.host.__ottActiveProviderDriver.id = "plex";
        if (change === "runtime") f.runtime("page-other");
        const result = f.read(
            change === "runtime" ? { runtime: "page-other" } : {}
        );
        assert.equal(
            result.status,
            "rejected",
            `${kind}: renewed receipts remain fenced by ${change}`
        );
        assert.equal(
            result.data.error,
            change === "source" ? "unavailable" : "catalog_changed"
        );
    }

    const f = pagedFixture(kind);
    f.advance(119999);
    f.host.__ottActiveProviderDriver.catalogLoading = () => {
        f.refresh();
        return false;
    };
    assert.equal(
        f.read().status,
        "rejected",
        `${kind}: a snapshot retired during page validation cannot be renewed`
    );
}

{
    const f = pagedFixture("categories");
    for (let index = 0; index < 40; index++) {
        f.advance(60000);
        assert.equal(f.read().status, "ok");
    }
    for (let index = 0; index < 31; index++) f.list();
    assert.equal(
        f.read().status,
        "ok",
        "renewal updates the existing receipt without consuming registry slots"
    );
    f.list();
    assert.equal(
        f.read().data.error,
        "catalog_changed",
        "renewal does not remove the 32-entry retention bound"
    );
}

console.log(
    "PASS remote media categories: ES5, paged metadata, stable IDs, global numbering, browse/play separation, kiosk policy, stale receipts, active pagination, exact idle expiry, bounded retention and legacy compatibility"
);
