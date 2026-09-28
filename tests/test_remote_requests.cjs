const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const now = Math.floor(Date.now() / 1000);
const entries = {
    a: [{ name: "НОВОСТИ дня", time: now - 60, time_to: now + 600 }],
    b: [{ name: "Старая", time: now - 600, time_to: now - 1 }],
    c: [],
};
let played,
    saved,
    switched,
    loaded = 0,
    locked = false;
const host = {
    __ottActiveProviderDriver: {
        credentials: () => ({
            password: "old",
            server: "https://provider.example",
            username: "old",
        }),
        id: "xtream",
        saveCredentials: (v) => (saved = v),
    },
    __ottClassicGuide: {
        peek: (id) => entries[id],
        request: (id, cb) => {
            cb(id, []);
            return () => {};
        },
        source: () => "one",
    },
    __ottParental: { needs: () => locked },
    cats: { a: ["c"], b: ["a", "b"] },
    catsArray: ["a", "b"],
    channels: {
        a: { channel_name: "Первый" },
        b: { channel_name: "Первый HD" },
        c: { channel_name: "Без EPG" },
    },
    cList: ["a", "b", "c"],
    clearTimeout,
    commandChannelsReady: true,
    curList: ["c"],
    deviceUUID: "dev_test",
    loadPlaylist: () => loaded++,
    playChannel: (...args) => (played = args),
    setTimeout,
    stbGetVolume: () => 35,
};
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
const ctx = {
    Date,
    exports: {},
    require: (name) =>
        name === "../provider"
            ? {
                  checkProviderUrl: () => true,
                  isProviderAllowed: () => true,
                  providerIds: ["m3u", "xtream", "", "stalker"],
                  providerLabels: null,
                  selectProviderByIndex: (i) => {
                      switched = i;
                      return true;
                  },
              }
            : { handleCommand: () => "accepted" },
    URL,
    window: host,
};
vm.runInNewContext(code, ctx);
function call(action, params = {}) {
    return new Promise((resolve) =>
        ctx.exports.executeRemoteRequest({ action, params }, resolve)
    );
}
(async () => {
    let r = await call("channels", { search: "ПЕРВЫЙ" });
    assert.equal(r.data.channels.length, 2);
    assert.equal(r.data.channels[0].number, 1);
    r = await call("play", { query: "Первый" });
    assert.equal(r.status, "ok");
    assert.equal(JSON.stringify(played), "[1,0]");
    r = await call("play", { query: "ПЕРВ" });
    assert.equal(r.status, "rejected");
    assert.equal(r.data.matches.length, 2);
    r = await call("play", { query: "3" });
    assert.equal(r.data.channel.name, "Без EPG");
    r = await call("play", { query: "999" });
    assert.equal(r.status, "rejected");
    r = await call("programs", { search: "новости" });
    assert.equal(r.data.programs.length, 1);
    assert.equal(r.data.programs[0].channel, "Первый");
    assert.equal(r.data.partial, false);
    r = await call("providers");
    assert.equal(r.data.providers.length, 3);
    assert.ok(!JSON.stringify(r).includes("password"));
    r = await call("provider", { query: "XTREAM" });
    assert.equal(switched, 1);
    r = await call("provider_settings", {
        provider: "xtream",
        settings: { password: "secret", username: "new" },
    });
    assert.equal(saved.username, "new");
    assert.equal(loaded, 1);
    assert.ok(!JSON.stringify(r).includes("secret"));
    r = await call("provider_settings", {
        provider: "stalker",
        settings: { mac: "00:00:00:00:00:01" },
    });
    assert.equal(r.status, "rejected");
    locked = true;
    r = await call("provider_settings", {
        provider: "xtream",
        settings: { password: "new" },
    });
    assert.equal(r.status, "rejected");
    assert.equal(loaded, 1);
    locked = false;
    for (const settings of [
        { evil: "x" },
        { server: "javascript:alert(1)" },
        { password: 5 },
    ]) {
        r = await call("provider_settings", { provider: "xtream", settings });
        assert.equal(r.status, "rejected");
    }
    host.commandChannelsReady = false;
    r = await call("channels");
    assert.equal(r.status, "rejected");
    console.log(
        "PASS remote requests: ES5, stable channel numbering, Cyrillic search, ambiguity, EPG window, provider policy and credential privacy"
    );
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
