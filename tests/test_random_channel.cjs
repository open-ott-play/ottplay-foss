const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");

function load(file, host, imports = {}) {
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    const context = {
        Date,
        exports: {},
        Math,
        require: (name) => imports[name] || {},
        window: host,
    };
    vm.runInNewContext(code, context);
    return context.exports;
}
const casing = { caselessKey: (value) => value.normalize("NFC").toLowerCase() };
const api = load(
    "src/commands/random-channel.ts",
    {},
    { "../utils/caseless": casing }
);
const { classify, valid, pick, play } = api.randomChannels;
const all = () => true;
function host(count = 1002) {
    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const channels = Object.fromEntries(
        ids.map((id) => [
            id,
            { category: { name: "News" }, channel_name: "Channel " + id },
        ])
    );
    const w = {
        __ottActiveProviderDriver: { id: "m3u" },
        __ottChannels: { index: () => 0 },
        __ottClassicScreenPort: { screens: { current: () => null } },
        __ottCommandChannelLoad: 1,
        __ottParental: { needs: () => false },
        __ottSourceIdentity: { current: () => "source-a" },
        cats: { All: ids },
        catsArray: ["All"],
        channels,
        cList: ids,
        commandChannelsReady: true,
        curList: ids,
        parental: /взрослые|custom-adult/i,
        parentalArray: [],
        played: [],
        stbGetVolume: () => 10,
    };
    w.playChannel = (category, index, fullscreen, admit) => {
        assert.equal(admit(), true);
        w.played.push({ category, fullscreen, index });
        return true;
    };
    return w;
}
const w = host();
assert.equal(classify(w, 1), 0);
w.channels[1].adult = 1;
assert.equal(classify(w, 1), 1);
delete w.channels[1].adult;
w.channels[1].channel_name = "SpaceStream";
assert.equal(
    classify(w, 1),
    0,
    "an incidental substring is not the AceStream marker"
);
w.channels[1].channel_name = "Channel 1";
w.channels[1].category.name = "CUSTOM-ADULT";
assert.equal(
    classify(w, 1),
    1,
    "provider's actual parental predicate is authoritative"
);
w.channels[1].category.name = "News";
w.parentalArray = ["1"];
assert.equal(
    classify(w, 1),
    1,
    "manual locks use equivalent string/numeric identity"
);
w.parentalArray = [];
w.channels[1].channel_name = "News [AceStream]";
assert.equal(classify(w, 1), -1);
w.channels[1].adult = 1;
assert.equal(
    classify(w, 1),
    -1,
    "AceStream is never part of the adult pool either"
);
w.channels[1].channel_name = "Channel 1";
delete w.channels[1].adult;
assert.equal(classify(w, 999999), -1);
assert.equal(classify({ ...w, parentalArray: undefined }, 1), -1);
w.channels[1].channel_name = "bad\u0000name";
assert.equal(classify(w, 1), -1);
w.channels[1].channel_name = "Channel 1";

for (const option of [
    {},
    { search: "РЕН" },
    { range: [1, 1000] },
    { mode: "adult" },
])
    assert(valid(option));
for (const option of [
    null,
    [],
    { mode: "safe" },
    { extra: 1 },
    { search: " " },
    { search: "x\n" },
    { search: "\ud800" },
    { search: "Ж".repeat(513) },
    { range: [0, 1] },
    { range: [2, 1] },
    { range: [1, 2.5] },
    { range: [1, Infinity] },
    { range: [1, 9007199254740992] },
])
    assert(!valid(option));
let state = 123456;
const rng = () => (state = (1664525 * state + 1013904223) >>> 0) / 4294967296;
let preferred = 0;
for (let i = 0; i < 4000; i++)
    if (pick(w, w.cList, {}, all, rng) < 1000) preferred++;
assert(
    preferred > 3000 && preferred < 3400,
    "default selection has an 80/20 split between pools"
);
let lower = 0;
for (let i = 0; i < 2000; i++)
    if (pick(w, w.cList, { range: [1000, 1001] }, all, rng) === 999) lower++;
assert(
    lower > 850 && lower < 1150,
    "an explicit range is uniform across the 1000 boundary"
);
assert.equal(pick(w, w.cList, { range: [9000, 9999] }, all), -1);
assert.equal(
    pick(w, [1001, 1002], {}, all, () => 0),
    0,
    "single pool remains selectable"
);
w.channels[1].channel_name = "РЕН";
w.channels[2].channel_name = "РЕН HD";
assert.equal(
    pick(w, w.cList, { search: "рен" }, all, () => 0.99),
    0,
    "exact normalized names win"
);
w.parentalArray = [1];
assert.equal(
    pick(w, w.cList, { search: "РЕН" }, all),
    -1,
    "protected exact match must not fall through to partial names"
);
assert.equal(
    pick(w, w.cList, { mode: "adult" }, all, () => 0),
    0
);
assert.equal(play(w, w.cList, { mode: "adult" }, all, all).id, "1");
w.__ottParental.needs = () => true;
assert.equal(
    play(w, w.cList, { mode: "adult" }, all, all),
    null,
    "adult mode never authorizes a PIN"
);
w.parentalArray = [];
w.channels[1].adult = true;
assert.equal(
    play(w, w.cList, { mode: "adult" }, all, all).id,
    "1",
    "an explicitly unlocked adult channel retains existing PIN admission behavior"
);
assert.equal(
    pick(w, w.cList, { search: "РЕН" }, all),
    -1,
    "explicit unlock does not admit an adult channel to safe random"
);
delete w.channels[1].adult;
w.__ottParental.needs = () => false;
w.parentalArray = [];
w.playChannel = (_c, i, _f, admit) => {
    w.parentalArray.push(w.cList[i]);
    assert(!admit());
    return false;
};
assert.equal(
    play(w, w.cList, {}, all, all),
    null,
    "a lock changed during handoff prevents playback"
);

const parsed = require("./helpers/playlist-fixture.cjs").main(
    "#EXTM3U\n#EXTINF:-1,Fixture\n#EXTGRP:взрослые\nhttps://stream.test/fixture\n"
);
const parsedId = parsed.ids[0];
assert.equal(
    classify(
        { channels: parsed.channels, parental: /взрослые/i, parentalArray: [] },
        parsedId
    ),
    1,
    "the shared M3U parser's EXTGRP category is protected"
);

function remote(w) {
    const imports = {
        "../utils/caseless": casing,
        "./random-channel": api,
        "./remote-restart": {
            executeRemoteControl: (_w, _a, _p, done) =>
                done({ data: {}, status: "ok" }),
            remotePlayerInfo: () => ({ runtime: "page-1" }),
        },
    };
    const execute = load(
        "src/commands/remote-requests.ts",
        w,
        imports
    ).executeRemoteRequest;
    return (action, params = {}, extra = {}) => {
        let result;
        execute({ action, params, ...extra }, (response) => {
            result = response;
        });
        assert(result, "request must settle synchronously");
        return result;
    };
}
const epgHost = host(3),
    request = remote(epgHost);
assert.equal(request("capabilities").data.random.version, 1);
let catalog = request("epg_catalog").data.catalog;
epgHost.parentalArray = [1, 2];
let reply = request("play_catalog", { catalog, random: {} });
assert.equal(reply.status, "ok");
assert.equal(reply.data.channel.id, "3");
assert.equal(reply.data.channel.number, 3);
epgHost.parentalArray = [1, 2, 3];
assert.equal(
    request("play_catalog", { catalog, random: {} }).status,
    "rejected"
);
assert.equal(epgHost.played.length, 1);
epgHost.parentalArray = [];
assert.equal(
    request("play_catalog", { catalog, id: "1", random: {} }).status,
    "rejected"
);
assert.equal(
    request("play_catalog", { catalog, random: {} }, { expires_at: 1 }).status,
    "rejected"
);
epgHost.__ottCommandChannelLoad++;
assert.equal(
    request("play_catalog", { catalog, random: {} }).status,
    "rejected",
    "stale loading generation is rejected"
);

const mediaHost = host(10005);
mediaHost.__ottActiveProviderDriver = {
    catalogLoading: () => false,
    id: "plex",
};
let active = true;
const snapshot = {
    active: () => active,
    all: mediaHost.cList,
    canonicalIds: mediaHost.cList,
    groups: [{ id: "system:all", members: mediaHost.cList, name: "All" }],
};
mediaHost.__ottChannels = {
    browse() {},
    index: () => 0,
    remoteCatalog: () => snapshot,
};
const mediaRequest = remote(mediaHost);
catalog = mediaRequest("categories", {
    limit: 1,
    offset: 0,
    op: "list",
    runtime: "page-1",
}).data.catalog;
reply = mediaRequest("play_catalog", {
    catalog,
    random: { range: [10005, 10005] },
});
assert.equal(reply.status, "ok");
assert.equal(
    reply.data.channel.number,
    10005,
    "top-level media receipt supports catalogs over the EPG 10k bound"
);
for (const restricted of ["providers", "settings"]) {
    mediaHost.__ottParental.needs = (section) => section === restricted;
    assert.equal(
        mediaRequest("play_catalog", { catalog, random: {} }).status,
        "rejected",
        "random media retains the " + restricted + " PIN policy"
    );
}
mediaHost.__ottParental.needs = () => false;
const originalPlay = mediaHost.playChannel;
mediaHost.playChannel = (_c, _i, _f, admit) => {
    mediaHost.__ottParental.needs = (section) => section === "providers";
    assert.equal(
        admit(),
        false,
        "provider restriction is rechecked at handoff"
    );
    return false;
};
assert.equal(
    mediaRequest("play_catalog", { catalog, random: {} }).status,
    "rejected"
);
mediaHost.playChannel = originalPlay;
mediaHost.__ottParental.needs = () => false;
for (const invalid of [
    { channel_name: "x".repeat(513) },
    { channel_name: "\ud800" },
    { itemId: "x".repeat(2049) },
    { itemId: "bad\n" },
    { itemId: "2" },
]) {
    const original = mediaHost.channels[1];
    mediaHost.channels[1] = { ...original, ...invalid };
    assert.equal(
        mediaRequest("play_catalog", { catalog, random: {} }).status,
        "rejected",
        "random selection preserves the full media descriptor contract"
    );
    mediaHost.channels[1] = original;
}
mediaHost.__ottActiveProviderDriver.catalogLoading = () => true;
assert.equal(
    mediaRequest("play_catalog", { catalog, random: {} }).status,
    "rejected"
);
mediaHost.__ottActiveProviderDriver.catalogLoading = () => false;
active = false;
assert.equal(
    mediaRequest("play_catalog", { catalog, random: {} }).status,
    "rejected"
);
console.log(
    "PASS safe weighted random selection, parser metadata, PIN handoff, and fenced IPTV/large-media RPCs"
);
