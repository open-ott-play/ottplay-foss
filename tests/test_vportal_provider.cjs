const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
const portal = "portal::[key:PRIVATE_ONE]https://portal.example/api/";
const other = "portal::[key:PRIVATE_TWO]https://other.example/api/";
function config() {
    return {
        active: 0,
        portals: Array.from({ length: 15 }, (_, i) => ({
            link: i ? "" : portal,
            name: i ? "" : "Films",
            sections: i ? [] : [{ request: { cmd: "films" }, title: "Films" }],
        })),
    };
}
function create(initial = {}) {
    const f = fixture(initial);
    const ast = ts.createSourceFile(
        "vportal.ts",
        fs.readFileSync("src/plugins/vportal.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const parse = ast.statements.find(
        (n) =>
            ts.isFunctionDeclaration(n) && n.name?.text === "parseVPortalLink"
    );
    vm.runInContext(
        ts.transpileModule(parse.getText(ast).replace(/^export /, ""), {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        f.host
    );
    const clients = [];
    f.host.__ottVPortal = {
        create: (link, options) => {
            const c = {
                dispose() {
                    this.disposed++;
                },
                disposed: 0,
                link,
                load() {},
                options,
                playlist(sections, done) {
                    this.roots = sections;
                    this.progress = done;
                    done(
                        [
                            {
                                __ottPlaylistId: "film",
                                stream_url: "https://stream.example/film",
                                title: "Film",
                            },
                        ],
                        false
                    );
                },
                resolve() {},
                sections(done) {
                    done({
                        items: [
                            { request: { cmd: "films" }, title: "Films" },
                            { request: { cmd: "series" }, title: "Series" },
                        ],
                    });
                },
            };
            clients.push(c);
            return c;
        },
        parse: f.host.parseVPortalLink,
    };
    runtime(f.host, "src/provider/vportal-driver.ts");
    runtime(f.host, "src/provider/source-identity.ts");
    const driver = f.mount("vportal");
    f.host.duneAddSettings(0);
    return { ...f, clients, driver };
}
{
    const f = create({ m3um3uArr: "M3U_UNTOUCHED" });
    let done = 0;
    f.host.getChannelsArray(() => done++);
    assert.equal(done, 0);
    assert.equal(f.host.listCaption.innerHTML, "VPortal profiles");
    assert.equal(f.driver.capabilities.libraryOnly, false);
    assert.equal(f.driver.capabilities.mediaPlaylist, true);
    assert.equal(f.clients.length, 0);
    assert.equal(f.saved.get("m3um3uArr"), "M3U_UNTOUCHED");
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    let done = 0;
    f.host.getChannelsArray(() => done++);
    assert.equal(done, 1);
    assert.equal(f.host.cList.length, 1);
    assert.equal(f.driver.mediaItem(f.host.cList[0]).title, "Film");
    assert.equal(f.host.providerMediaClient, f.clients[0]);
    assert.equal(f.driver.libraryReady(), true);
    assert.equal(f.clients[0].options.title, "Films");
    const identity = f.host.__ottSourceIdentity.current(f.host);
    assert.match(identity, /^vportal:0@/);
    assert(!identity.includes("PRIVATE"));
    const snapshot = f.driver.configuration();
    snapshot.portals[0].link = other;
    assert.equal(
        f.driver.configuration().portals[0].link,
        portal,
        "configuration is detached"
    );
    const value = f.driver.configuration();
    value.portals[1] = {
        link: other,
        name: "Second",
        sections: [{ request: { cmd: "series" }, title: "Series" }],
    };
    assert.equal(f.driver.saveConfiguration(value), true);
    assert.equal(
        f.clients[0].disposed,
        0,
        "editing an inactive slot preserves playback"
    );
    value.active = 1;
    assert.equal(f.driver.saveConfiguration(value), true);
    assert.equal(f.clients[0].disposed, 1);
    assert.equal(f.clients[0].options.isCurrent(), false);
    f.host.getChannelsArray(() => done++);
    assert.notEqual(f.host.__ottSourceIdentity.current(f.host), identity);
    assert.equal(f.host.providerMediaClient, f.clients[1]);
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    const before = f.saved.get("vportalprofiles");
    for (const bad of [
        "https://ordinary.example/file.m3u",
        "portal::[key:bad]javascript:alert(1)",
        "\n" + portal,
    ]) {
        const value = f.driver.configuration();
        value.portals[0].link = bad;
        assert.equal(f.driver.saveConfiguration(value), false);
        assert.equal(f.saved.get("vportalprofiles"), before);
    }
    f.host.checkProviderUrl = () => false;
    const value = f.driver.configuration();
    value.portals[0].link = other;
    assert.equal(f.driver.saveConfiguration(value), false);
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    const request = (action, params) =>
        f.driver.remoteProfiles({ action, params });
    const listing = request("profiles", {});
    assert.equal(listing.status, "ok");
    assert.equal(listing.data.provider, "vportal");
    assert.equal(listing.data.profiles.length, 15);
    assert(!JSON.stringify(listing).includes("PRIVATE"));
    assert(!JSON.stringify(listing).includes("https:"));
    assert.equal(request("profile", { number: 2 }).status, "rejected");
    assert.equal(
        request("profile_settings", {
            number: 2,
            settings: { name: "Cartoons", vportal: other },
        }).status,
        "ok"
    );
    assert.equal(request("profile", { number: 2 }).data.profile.active, true);
    assert.equal(
        request("profile_settings", {
            number: 1,
            settings: { playlist: "https://tv.example/" },
        }).status,
        "rejected"
    );
    f.host.__ottKiosk = { enabled: () => true };
    assert.equal(request("profiles", {}).status, "ok");
    assert.equal(request("profile", { number: 1 }).status, "rejected");
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    const before = f.saved.get("vportalprofiles");
    f.host.__ottEditProvider();
    f.host.selIndex = 0;
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.selIndex = 1;
    f.host.listKeyHandler(f.host.keys.ENTER);
    const late = f.host.setEdit;
    const result = f.driver.remoteProfiles({
        action: "profile_settings",
        params: { number: 1, settings: { vportal: other } },
    });
    assert.equal(result.status, "ok");
    f.host.editvar = portal;
    late();
    assert.notEqual(f.saved.get("vportalprofiles"), before);
    assert.equal(f.driver.configuration().portals[0].link, other);
    assert(!JSON.stringify(f.host.listArray).includes("PRIVATE"));
}
{
    const value = config();
    value.portals[0].sections = [];
    const f = create({ vportalprofiles: JSON.stringify(value) });
    let loads = 0;
    f.host.getChannelsArray(() => loads++);
    assert.equal(
        loads,
        1,
        "configured links load every category without selecting roots"
    );
    assert.equal(f.clients.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.clients[0].roots)), [
        { __ottCategoryRoot: true, request: {}, title: "Films" },
    ]);
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    let done = 0;
    f.host.getChannelsArray(() => done++);
    const firstId = f.host.cList[0];
    f.clients[0].progress(
        [
            {
                __ottPlaylistId: "film",
                stream_url: "https://stream.example/film",
                title: "Film",
            },
            {
                __ottPlaylistId: "second",
                request: { cmd: "play", id: 2 },
                title: "Second",
            },
        ],
        false
    );
    assert.equal(done, 1, "incremental append does not restart playback");
    assert.equal(f.host.cList.length, 2);
    assert.equal(f.host.cList[0], firstId);
    assert.equal(f.driver.mediaItem(f.host.cList[1]).title, "Second");
    assert.equal(f.host.chanels[f.host.cList[1]].url, "vportal:request");
    assert.equal(f.driver.mediaItem(f.host.cList[1]).stream_url, undefined);
    assert.deepEqual(f.driver.mediaItem(f.host.cList[1]).request, {
        cmd: "play",
        id: 2,
    });
    const old = f.clients[0];
    const value = f.driver.configuration();
    value.portals[0].sections = [{ request: { cmd: "other" }, title: "Other" }];
    assert.equal(f.driver.saveConfiguration(value), true);
    old.progress([{ __ottPlaylistId: "stale", title: "Stale" }], true);
    assert.equal(
        f.host.cList.length,
        2,
        "stale catalog cannot replace visible list"
    );
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.__ottEditProvider();
    f.host.selIndex = 0;
    f.host.listKeyHandler(f.host.keys.ENTER);
    assert.equal(
        f.host.listArray.length,
        3,
        "profile editor only asks for name/link and save"
    );
    assert(
        !f.host.listArray.some((value) => value.includes("Category selection"))
    );
    let reloads = 0;
    f.host.loadChannels = () => reloads++;
    f.host.selIndex = 2;
    f.host.listKeyHandler(f.host.keys.ENTER);
    assert.equal(reloads, 1, "save requests loading without a section chooser");
    f.host.getChannelsArray(() => {});
    assert.deepEqual(
        JSON.parse(JSON.stringify(f.clients[0].roots[0].request)),
        {}
    );
}

{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    for (const sections of [
        null,
        [{ request: [], title: "Bad" }],
        [{ request: { key: "secret" }, title: "Bad" }],
    ]) {
        const value = f.driver.configuration();
        value.portals[0].sections = sections;
        assert.equal(f.driver.saveConfiguration(value), false);
    }
}

{
    const value = config();
    value.portals[0].sections = [{}];
    const f = create({ vportalprofiles: JSON.stringify(value) });
    let loads = 0;
    f.host.getChannelsArray(() => loads++);
    assert.equal(
        loads,
        1,
        "obsolete section metadata cannot block a configured portal"
    );
    assert.equal(f.clients.length, 1);
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    const result = f.driver.remoteProfiles({
        action: "profile_settings",
        params: {
            number: 1,
            settings: {
                sections: [{ request: { cmd: "selected" }, title: "Selected" }],
            },
        },
    });
    assert.equal(
        result.status,
        "rejected",
        "existing remote contract remains unchanged"
    );
}
{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    f.clients[0].progress(
        [
            {
                __ottPlaylistId: "film",
                stream_url: "https://stream.example/film",
                title: "Film",
            },
        ],
        true,
        "failure"
    );
    assert.equal(f.host.cList.length, 1);
    assert.equal(f.errors.at(-1), "VPortal request failed");
}

{
    const value = config();
    value.portals[0].sections[0].adult = true;
    value.portals[0].sections[0].sequence = true;
    const f = create({
        vportalprimaryIndex: "1",
        vportalprofiles: JSON.stringify(value),
    });
    let done = 0;
    f.host.getChannelsArray(() => done++);
    assert.equal(
        done,
        0,
        "restore waits for saved second item instead of starting the first episode"
    );
    f.clients[0].progress(
        [
            {
                __ottPlaylistId: "first",
                stream_url: "https://stream.example/first",
                title: "First",
            },
            {
                __ottPlaylistId: "saved",
                stream_url: "https://stream.example/saved",
                title: "Saved",
            },
        ],
        false
    );
    assert.equal(done, 1);
    assert.equal(f.driver.configuration().portals[0].sections[0].adult, true);
    assert.equal(
        f.driver.configuration().portals[0].sections[0].sequence,
        true
    );
}

{
    const f = create({
        vportalprimaryIndex: "1",
        vportalprofiles: JSON.stringify(config()),
    });
    let starts = 0;
    f.host.getChannelsArray(() => starts++);
    const loading = f.clients[0];
    assert.equal(starts, 0);
    f.host.__ottEditProvider();
    assert.equal(loading.disposed, 1);
    loading.progress(
        [
            { __ottPlaylistId: "first", title: "First" },
            { __ottPlaylistId: "saved", title: "Saved" },
        ],
        true
    );
    assert.equal(
        starts,
        0,
        "opening profile settings cancels startup instead of playing behind the editor"
    );
}

{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    const source = f.host.__ottSourceIdentity.current(f.host);
    f.saved.set(
        "vportalchannelLibrary:" + source,
        JSON.stringify({ selected: { itemId: "channel:missing" } })
    );
    const loads = [];
    f.driver.load((catalog) => loads.push(catalog));
    assert.equal(loads.length, 0);
    f.clients[0].progress(
        [
            {
                __ottPlaylistId: "film",
                stream_url: "https://stream.example/film",
                title: "Film",
            },
        ],
        true
    );
    assert.equal(loads.length, 1);
    assert.equal(
        loads[0].selectionMissing,
        true,
        "missing saved episode opens the list instead of playing an unrelated first entry"
    );
}

{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    runtime(f.host, "src/channels/library.ts");
    const source = f.host.__ottSourceIdentity.current(f.host);
    const library = f.host.__ottChannelLibrary.create(
        {
            current: () => true,
            get: (key) => f.saved.get("vportal" + key) || null,
            set: (key, value) => f.saved.set("vportal" + key, value),
            sourceId: source,
        },
        [
            {
                groupId: "vportal",
                groupLabel: "Films",
                id: 123,
                itemId: "vportal:saved",
                label: "Saved",
            },
        ]
    );
    assert.equal(library.select("vportal", 123), true);
    assert.equal(
        JSON.parse(f.saved.get("vportalchannelLibrary:" + source)).selected
            .itemId,
        "vportal:saved"
    );
    const loads = [];
    f.driver.load((catalog) => loads.push(catalog));
    assert.equal(loads.length, 0);
    f.clients[0].progress(
        [
            {
                __ottPlaylistId: "film",
                stream_url: "https://stream.example/film",
                title: "Film",
            },
            {
                __ottPlaylistId: "saved",
                stream_url: "https://stream.example/saved",
                title: "Saved",
            },
        ],
        false
    );
    assert.equal(
        loads.length,
        1,
        "actual channel library stable item identity resolves to projected numeric ID"
    );
    assert.equal(loads[0].selectionMissing, false);
}

{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    f.clients[0].progress(
        [
            {
                __ottPlaylistId: "film",
                stream_url: "https://stream.example/film",
                title: "Film",
            },
            {
                __ottPlaylistId: "adult",
                adult: 1,
                stream_url: "vportal:request",
                title: "Restricted",
            },
        ],
        false
    );
    const restricted = f.host.cList[1];
    assert.equal(
        f.host.channels[restricted].adult,
        1,
        "inherited adult metadata reaches ordinary channel rendering and admission"
    );
    assert.equal(f.driver.mediaItem(restricted).adult, 1);
    assert.equal(f.host.channels[f.host.cList[0]].adult, 0);
}
console.log(
    "VPortal provider profiles, isolation, validation, redaction and editor lifetime tests passed"
);

{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    const first = f.host.cList[0];
    f.clients[0].progress(
        [
            {
                __ottMediaCategories: [],
                __ottPlaylistId: "film",
                title: "Film",
            },
            {
                __ottMediaCategories: [
                    { id: "section:cartoons", name: "Cartoons" },
                    { id: "folder:series", name: "Cartoons / Series" },
                ],
                __ottPlaylistId: "cartoon",
                title: "Episode",
            },
        ],
        false
    );
    assert.equal(
        f.host.cList[0],
        first,
        "category discovery preserves existing channel identity"
    );
    const channel = f.host.chanels[f.host.cList[1]];
    assert.equal(channel.category.name, "Cartoons / Series");
    assert.equal(channel.groupId, "folder:series");
    assert.deepEqual(
        Array.from(channel.__ottMediaCategories, (x) => x.id),
        ["section:cartoons", "folder:series"]
    );
}

{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    assert.equal(f.driver.catalogLoading(), true);
    const firstId = f.host.cList[0];
    f.clients[0].progress(
        [
            {
                __ottMediaCategories: [{ id: "other", name: "Other folder" }],
                __ottPlaylistId: "film",
                title: "Film",
            },
        ],
        false
    );
    assert.equal(
        f.host.cList.length,
        1,
        "new category membership does not duplicate All"
    );
    assert.equal(f.host.cList[0], firstId);
    assert.equal(f.host.chanels[firstId].__ottMediaCategories[0].id, "other");
    f.clients[0].progress(
        [
            {
                __ottMediaCategories: [{ id: "other", name: "Other folder" }],
                __ottPlaylistId: "film",
                title: "Film",
            },
        ],
        true
    );
    assert.equal(f.driver.catalogLoading(), false);
}

{
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    assert.equal(f.driver.catalogError(), false);
    f.clients[0].progress(
        [{ __ottPlaylistId: "film", title: "Film" }],
        true,
        "partial failure"
    );
    assert.equal(
        f.driver.catalogError(),
        true,
        "partial catalog remains explicitly incomplete"
    );
    assert.equal(f.driver.catalogLoading(), false);
    assert.equal(
        f.host.cList.length,
        1,
        "partial UI playback remains available"
    );
    f.host.getChannelsArray(() => {});
    assert.equal(
        f.driver.catalogError(),
        false,
        "new scan resets terminal failure"
    );
    const id = f.host.cList[0];
    f.clients
        .at(-1)
        .progress(
            [{ __ottPlaylistId: "film", adult: 1, title: "Film" }],
            false
        );
    assert.equal(
        f.driver.mediaItem(id).adult,
        1,
        "protected duplicate upgrades the driver record"
    );
}

for (const title of [
    "Cartoon — 第1話 🐈",
    "м".repeat(300),
    "猫".repeat(300),
    "🐈".repeat(200),
    "a".repeat(512),
    "a".repeat(509) + "🐈",
]) {
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    f.host.getChannelsArray(() => {});
    const item = {
        __ottPlaylistId: "stable-long-title",
        request: { cmd: "play", id: 92, query: title },
        title,
    };
    f.clients[0].progress(
        [{ __ottPlaylistId: "film", title: "Film" }, item],
        false
    );
    const id = f.host.cList[1];
    const channel = f.host.chanels[id];
    assert(Buffer.byteLength(channel.channel_name, "utf8") <= 512);
    assert.equal(
        channel.tn,
        channel.channel_name,
        "list and search share one bounded canonical label"
    );
    assert.doesNotThrow(
        () => encodeURIComponent(channel.channel_name),
        "label cannot split surrogate pairs"
    );
    assert.equal(channel.itemId, "vportal:stable-long-title");
    assert.equal(
        f.driver.mediaItem(id),
        item,
        "full playback metadata is not truncated or rewritten"
    );
    assert.equal(item.title, title);
    assert.equal(item.request.query, title);
    if (Buffer.byteLength(title, "utf8") <= 512)
        assert.equal(channel.channel_name, title);
    else {
        assert(channel.channel_name.endsWith("…"));
        assert(title.startsWith(channel.channel_name.slice(0, -1)));
    }
}

{
    // A late category discovery can update a whole page while another page is
    // appended. Membership checks must not scan the growing delta per row.
    const f = create({ vportalprofiles: JSON.stringify(config()) });
    const batch = 2048;
    const items = Array.from({ length: batch }, (_, i) => ({
        __ottMediaCategories: [],
        __ottPlaylistId:
            i === 0
                ? "film"
                : i === 1
                  ? "__proto__"
                  : i === 2
                    ? "constructor"
                    : "bulk-" + i,
        title: "Film " + i,
    }));
    const loads = [];
    f.driver.load((catalog) => loads.push(catalog));
    f.clients[0].progress(items, false);
    const before = loads.flatMap((catalog) => Array.from(catalog.ids));
    items.forEach((item) => {
        item.__ottMediaCategories = [{ id: "series", name: "Series" }];
    });
    const appended = Array.from({ length: batch }, (_, i) => ({
        __ottPlaylistId: "next-" + i,
        title: "Next " + i,
    }));
    vm.runInContext(
        `
        var largeMembershipScans = 0;
        var savedIndexOf = Array.prototype.indexOf;
        Array.prototype.indexOf = function (value) {
            if (this.length >= 2048 && typeof value === "number")
                largeMembershipScans++;
            return savedIndexOf.apply(this, arguments);
        };
    `,
        f.host
    );
    f.clients[0].progress(items.concat(appended), true);
    const delta = loads[loads.length - 1];
    assert.equal(delta.incremental, true);
    assert.equal(delta.ids.length, batch * 2);
    assert.equal(new Set(delta.ids).size, batch * 2);
    assert.deepEqual(Array.from(delta.ids.slice(batch)), Array.from(before));
    assert(delta.ids.every((id) => delta.channels[id]));
    assert.equal(
        f.host.largeMembershipScans,
        0,
        "category deltas do not perform a linear membership scan per changed row"
    );
    assert(before.every((id) => delta.channels[id].groupId === "series"));
}
