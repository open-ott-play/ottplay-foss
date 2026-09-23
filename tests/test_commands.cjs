const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
    path.join(root, "src/commands/index.ts"),
    "utf8"
);
const provider = fs.readFileSync(
    path.join(root, "src/provider/index.ts"),
    "utf8"
);
const ast = ts.createSourceFile(
    "provider.ts",
    provider,
    ts.ScriptTarget.Latest,
    true
);
const selected = ast.statements
    .filter(
        (node) =>
            ts.isFunctionDeclaration(node) &&
            ["selectProviderByIndex", "isProviderAllowed"].includes(
                node.name?.text
            )
    )
    .map((node) => node.getText(ast))
    .join("\n");
function emit(text) {
    return ts.transpileModule(text, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
}
const storage = new Map();
const loaded = [];
const pins = [];
const context = {
    console,
    enterPinAndSetAccess(callback) {
        pins.push(callback);
    },
    exports: {},
    isPlayDistribution() {
        return context.playDistribution;
    },
    loadProv(id) {
        loaded.push({ id, saved: storage.get("ottplayprov") });
    },
    parentAccess: false,
    parentPIN: "1234",
    playDistribution: false,
    providerIds: ["m3u", "stalker", "xtream", "", "demo", "commercial"],
    sPSprovs: false,
    stbGetItem(key) {
        return storage.get(key);
    },
    stbSetItem(key, value) {
        storage.set(key, value);
    },
};
context.window = context;
vm.createContext(context);
vm.runInContext(emit(selected), context);
const select = context.exports.selectProviderByIndex;
assert.equal(select(1), true);
assert.deepEqual(loaded.at(-1), { id: undefined, saved: "stalker" });
assert.equal(select(1), true);
assert.equal(loaded.length, 1, "current provider does not restart");
assert.equal(select(4), true);
assert.deepEqual(loaded.at(-1), { id: "demo", saved: "demo" });
assert.deepEqual(JSON.parse(storage.get("ottplayprovs")), ["demo"]);
context.ottplayDemoActive = true;
select(0);
assert.equal(loaded.at(-1).id, "m3u", "leaving demo passes explicit provider");
context.playDistribution = true;
assert.equal(select(5), false);
assert.equal(
    storage.get("ottplayprov"),
    "m3u",
    "Play registry cannot select commercial providers"
);
for (const invalid of [-1, 0.5, NaN, Infinity, 99, "1", 3])
    assert.equal(select(invalid), false);
context.sPSprovs = true;
assert.equal(select(2), false);
assert.equal(pins.length, 1);
assert.equal(storage.get("ottplayprov"), "m3u");
context.parentAccess = true;
pins[0]();
assert.equal(
    storage.get("ottplayprov"),
    "xtream",
    "selection only occurs after PIN access"
);

const delivered = [];
let volume = 40;
const w = {
    cats: { first: ["a"], second: ["b", "zero"] },
    catsArray: ["first", "second"],
    channels: {
        a: { channel_name: "News" },
        b: { channel_name: "Science" },
        zero: { channel_name: "Zero" },
    },
    curList: ["a", "b", "zero"],
    playChannel(cat, channel) {
        delivered.push([cat, channel]);
    },
    stbGetVolume() {
        return volume;
    },
    stbSetVolume(value) {
        volume = value;
    },
};
const cmdContext = {
    console,
    document: {
        getElementById() {
            return null;
        },
    },
    exports: {},
    require(name) {
        if (name === "../shared/wire-contracts")
            return require("./load-wire.cjs")();
        assert.equal(name, "../provider");
        return {
            checkProviderUrl: (url) =>
                !w.rejectHttp || !url.startsWith("http:"),
            selectProviderByIndex: select,
        };
    },
    URL,
    window: w,
};
vm.runInNewContext(emit(source), cmdContext);
const handle = cmdContext.exports.handleCommand;
handle({ channel_name: "SCIENCE", command: "channel_by_name" });
assert.deepEqual(delivered, [[1, 0]], "name search reaches later categories");
handle({ channel_name: "absent", command: "channel_by_name" });
assert.equal(delivered.length, 1, "not found must not play (-1,-1)");
handle({ channel_number: 3, command: "channel_by_number" });
assert.deepEqual(delivered.at(-1), [1, 1]);
handle({ command: "set_volume", volume: 150 });
assert.equal(volume, 100);
handle({ command: "set_volume", volume_step: -25 });
assert.equal(volume, 75);
for (const invalid of [NaN, Infinity, -Infinity, "5", null, {}, []]) {
    handle({ command: "set_volume", volume: invalid });
    assert.equal(volume, 75);
    handle({ command: "set_volume", volume_step: invalid });
    assert.equal(volume, 75);
}
for (const number of [0, -1, 1.5, NaN, Infinity, "2", null])
    handle({ channel_number: number, command: "channel_by_number" });
assert.equal(delivered.length, 2);
for (const range of [
    [0, 2],
    [2, 1],
    [1.5, 2],
    [1, Infinity],
    ["1", 2],
    {},
    null,
    [1],
])
    handle({ command: "random_channel", random_range: range });
assert.equal(delivered.length, 2);
handle({ command: "random_channel", random_range: [2, 2] });
assert.deepEqual(delivered.at(-1), [1, 0]);
handle({ channel_name: {}, command: "channel_by_name" });
handle({ command: "change_provider", provider: 1 });
assert.equal(
    storage.get("ottplayprov"),
    "stalker",
    "dispatcher changes actual provider"
);
handle({ command: "change_provider", provider: "2" });
assert.equal(storage.get("ottplayprov"), "stalker");
w.catsArray = undefined;
w.cats = undefined;
handle({ channel_name: "early", command: "channel_by_name" });
handle({ channel_number: 1, command: "channel_by_number" });
assert.equal(
    delivered.length,
    3,
    "early startup does not dispatch an invalid channel"
);
console.log(
    "PASS commands: later-category/no-match channels, string IDs, numeric validation, actual provider selection and PIN/Play policy"
);

const writes = [];
let playlistLoads = 0;
w.p_pref = "stalker";
w.providerSetItem = (key, value) => writes.push({ key, value });
w.restart = () =>
    assert.fail("remote command must not restart after writing unused keys");
assert.equal(
    handle({ command: "change_provider_settings", provider_settings: "{}" }),
    "unsupported"
);
assert.equal(
    handle({
        command: "change_playlist",
        playlist: "https://example.invalid/new.m3u",
    }),
    "unsupported"
);
assert.equal(writes.length, 0);
w.p_pref = "m3u";
w.m3uArr = {
    active: 1,
    M3Us: [
        { name: "first", www: "https://old/a" },
        {
            medUrl: "https://old/media",
            name: "second",
            rechours: 12,
            www: "https://old/b",
        },
    ],
};
const m3uSource = fs.readFileSync(path.join(root, "prov/m3u/prov.js"), "utf8");
const m3uAst = ts.createSourceFile(
    "prov.js",
    m3uSource,
    ts.ScriptTarget.Latest,
    true
);
const actualPlaylistLoader = m3uAst.statements
    .filter(
        (node) =>
            ts.isFunctionDeclaration(node) &&
            ["loadM3Uparams", "loadPlaylist"].includes(node.name?.text)
    )
    .map((node) => node.getText(m3uAst))
    .join("\n");
w.m3uCap = 15;
w._number = 0;
w.browserName = () => "pc";
w.providerGetItem = (key) => {
    assert.equal(key, "m3uArr");
    return writes.at(-1).value;
};
w._m3u2popup = () => {};
w.m3uUpdateMedia = () => {};
w.loadChannels = () => {
    playlistLoads++;
};
vm.runInNewContext(actualPlaylistLoader, w);
assert.equal(
    handle({
        command: "change_playlist",
        playlist: "https://example.invalid/new.m3u",
    }),
    "accepted"
);
assert.equal(writes[0].key, "m3uArr");
assert.equal(playlistLoads, 1);
assert.equal(w.m3uArr.M3Us[1].www, "https://example.invalid/new.m3u");
assert.equal(w.m3uArr.M3Us[0].www, "https://old/a");
assert.equal(w.m3uArr.M3Us[1].medUrl, "https://old/media");
assert.equal(w.m3uArr.M3Us[1].rechours, 12);
for (const playlist of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a URL",
])
    assert.equal(handle({ command: "change_playlist", playlist }), "rejected");
w.rejectHttp = true;
assert.equal(
    handle({
        command: "change_playlist",
        playlist: "http://example.invalid/new.m3u",
    }),
    "rejected",
    "Play HTTPS policy survives remote commands"
);
w.sPSoptions = true;
w.parentPIN = "1234";
w.parentAccess = false;
assert.equal(
    handle({
        command: "change_playlist",
        playlist: "https://example.invalid/new.m3u",
    }),
    "rejected",
    "remote playlist change cannot bypass settings lock"
);
assert.equal(writes.length, 1);
w.commandChannelsReady = false;
assert.equal(
    handle({ channel_number: 1, command: "channel_by_number" }),
    "deferred"
);
assert.equal(
    handle({ channel_name: "News", command: "channel_by_name" }),
    "deferred"
);
assert.equal(handle({ command: "random_channel" }), "deferred");
w.commandChannelsReady = true;
assert.equal(
    handle({ channel_number: 1, command: "channel_by_number" }),
    "accepted",
    "finished empty provider reports no match instead of waiting forever"
);
console.log(
    "PASS command outcomes: active M3U persistence/reload, unsupported provider settings, protocol/parental/Play validation and startup deferral"
);
