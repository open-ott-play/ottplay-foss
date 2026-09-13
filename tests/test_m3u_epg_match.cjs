// Exercise late M3U matching through the real provider, queue and EPG cache.
// Only HTTP responses, timers and UI callbacks are controlled by this fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function functions(file, names) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const selected = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name.text)
    );
    assert.equal(
        selected.length,
        names.length,
        "All production functions found"
    );
    const source = selected
        .map((node) => node.getText(ast).replace(/^export\s+/, ""))
        .join("\n");
    const code = file.endsWith(".js")
        ? source
        : ts.transpileModule(source, {
              compilerOptions: {
                  module: ts.ModuleKind.None,
                  target: ts.ScriptTarget.ES5,
              },
          }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
const provider = functions("prov/m3u/prov.js", [
    "postMatch",
    "getEpgList",
    "getEPGurl",
    "getEPGchanel",
    "provEpgLoader",
]);
const channels = functions("src/channels/index.ts", [
    "epgCacheLimit",
    "readEpgCache",
    "cacheFetchedEpg",
    "getEPGchanelCached",
    "doGetCurProg",
    "getCurProgData",
    "setCurProg",
]);

function fixture(cacheLimit = 16) {
    const now = Date.now() / 1000;
    const calls = [];
    const requests = [];
    const timers = [];
    const pending = [];
    const existingSchedule = [
        { name: "Cached programme", time: now - 60, time_to: now + 600 },
    ];
    const $ = () => ({ append() {} });
    $.ajax = (request) => {
        requests.push(request);
        const callbacks = {};
        const response = {
            always(callback) {
                callbacks.always = callback;
                if (request.type === "GET") callback();
                return this;
            },
            done(callback) {
                callbacks.done = callback;
                if (request.type === "GET") {
                    callback({
                        epg_data: [
                            {
                                name: "Fetched programme",
                                time: now - 60,
                                time_to: now + 600,
                            },
                        ],
                    });
                }
                return this;
            },
            fail(callback) {
                callbacks.fail = callback;
                return this;
            },
        };
        if (request.type === "POST") pending.push(callbacks);
        return response;
    };
    const c = vm.createContext({
        _: (text) => text,
        $,
        arrayGetCurProg: [],
        channels: { 1: {}, 2: {}, 3: {} },
        cList: [1, 2, 3],
        client_can: { crossxhr: true },
        console: { error() {}, log() {} },
        curList: [1, 2, 3],
        EPG_CACHE_TTL_MS: 900000,
        epg: { 3: existingSchedule },
        epg_sources: {},
        epgCacheFetchedAt: { 3: Date.now() },
        epgCacheGeneration: 0,
        epgCash: cacheLimit,
        epgCashArr: [3],
        epgCashObj: { 3: existingSchedule },
        epgPending: {},
        launch_id: "#launch",
        m3u_defaults: { epg_server: "http://epg.test" },
        nativeMatchMetadata: () => ({}),
        primaryIndex: 0,
        setTimeout(callback) {
            timers.push(callback);
        },
        updateChanelInfo(id) {
            calls.push("info:" + id);
            c.getCurProgData(id, c.updateChanelList);
        },
        updateChanelList(id) {
            calls.push("row:" + id);
        },
    });
    c.window = c;
    c.chanels = c.channels;
    vm.runInContext(provider + "\n" + channels, c);
    c.setCurProg(3, existingSchedule);
    function drain() {
        let count = 0;
        while (timers.length) {
            assert(
                ++count < 100,
                "EPG queue must terminate after an empty response"
            );
            timers.shift()();
        }
    }
    function start() {
        // Rendering starts before match-channels responds. Both visible rows
        // have no epg_src/epg_url yet and enter the ordinary missing-EPG lock.
        c.getCurProgData(1, c.updateChanelList);
        c.getCurProgData(2, c.updateChanelList);
        c.provEpgLoader({ raw: [] }, "synthetic channels");
        drain();
        assert(c.chanels[1].time_request > now);
        assert(c.chanels[2].time_request > now);
        assert.equal(pending.length, 1);
        assert.equal(
            requests.filter((request) => request.type === "GET").length,
            0
        );
        calls.length = 0;
    }
    function finish(body) {
        const callbacks = pending.shift();
        if (body === null)
            callbacks.fail({ status: 503 }, "error", "unavailable");
        else callbacks.done(body);
        callbacks.always();
        drain();
    }
    return { c, calls, drain, existingSchedule, finish, now, requests, start };
}

const matchResponse =
    "{}\n\t\n1~local~one\n2~local~two\n3~local~three\n\t\nlocal~http://epg.test/";
const failures = [];
function check(name, run) {
    try {
        run();
    } catch (error) {
        failures.push(name + ": " + error.message);
    }
}

for (const cacheLimit of [0, 16]) {
    check(
        "Previously visible rows recover after late matching, cache " +
            cacheLimit,
        () => {
            const f = fixture(cacheLimit);
            f.start();
            f.finish(matchResponse);
            for (const id of [1, 2]) {
                assert.equal(
                    f.c.chanels[id].name,
                    "Fetched programme",
                    "Programme for channel " + id
                );
                assert.equal(
                    f.c.chanels[id].time_request,
                    0,
                    "Miss lock cleared for channel " + id
                );
                assert(
                    f.calls.includes("row:" + id),
                    "Previously rendered row refreshes"
                );
            }
            assert.deepEqual(
                f.requests
                    .filter((request) => request.type === "GET")
                    .map((request) => request.url)
                    .sort(),
                [
                    "http://epg.test/epg/one.json",
                    "http://epg.test/epg/two.json",
                ],
                "Only previously missing channels fetch EPG; cache hits do not refetch"
            );
            assert.equal(
                f.c.epg[3],
                f.existingSchedule,
                "Keep the valid full-schedule cache"
            );
            assert.equal(f.c.chanels[3].name, "Cached programme");
            assert.equal(f.c.chanels[3].time, f.existingSchedule[0].time);
            assert.equal(f.c.chanels[3].time_to, f.existingSchedule[0].time_to);
        }
    );
}

check(
    "Late response from previous provider does not mutate the new channels",
    () => {
        const f = fixture();
        f.start();
        // loadChannels replaces cList and clears/repopulates the shared channel
        // map in place. Reused channel IDs must not accept the previous response.
        f.c.cList = [1, 2];
        f.c.chanels[1] = {
            epg_src: "new",
            epg_url: "new-one",
            name: "New provider",
            time_request: f.now + 700,
        };
        f.c.chanels[2] = {
            epg_src: "new",
            epg_url: "new-two",
            name: "New provider",
            time_request: f.now + 700,
        };
        f.c.epg_sources = { new: "http://new-provider.test/epg/" };
        f.finish(matchResponse);
        assert.equal(f.c.chanels[1].epg_url, "new-one");
        assert.equal(f.c.chanels[2].epg_url, "new-two");
        assert.equal(f.c.chanels[2].time_request, f.now + 700);
        assert.equal(f.c.epg_sources.local, undefined);
        assert.deepEqual(f.calls, [], "No previous-provider UI callbacks");
    }
);

check("Partial matching retries only channels with a resolved EPG URL", () => {
    const f = fixture();
    f.start();
    const originalLock = f.c.chanels[2].time_request;
    f.finish("{}\n\t\n1~local~one\n\t\nlocal~http://epg.test/");
    assert.equal(f.c.chanels[1].name, "Fetched programme");
    assert.equal(f.c.chanels[2].time_request, originalLock);
    assert.equal(f.c.getEPGurl(2), null);
    assert.equal(f.calls.includes("row:2"), false);
    assert.deepEqual(
        f.requests
            .filter((request) => request.type === "GET")
            .map((request) => request.url),
        ["http://epg.test/epg/one.json"]
    );
});

for (const response of [null, "malformed matching response"]) {
    check(
        "Unsuccessful matching retains bounded retry behavior: " + response,
        () => {
            const f = fixture();
            f.start();
            f.finish(response);
            assert.equal(f.c.chanels[1].name, "");
            assert.equal(f.c.chanels[2].name, "");
            assert(f.c.chanels[1].time_request > f.now);
            assert(f.c.chanels[2].time_request > f.now);
            assert.equal(
                f.requests.filter((request) => request.type === "GET").length,
                0
            );
            assert.equal(f.c.arrayGetCurProg.length, 0);
            assert.equal(f.c.epg[3], f.existingSchedule);
            assert.equal(
                f.calls.includes("row:2"),
                false,
                "Failed matching does not requeue unmatched rows"
            );
        }
    );
}
assert.equal(failures.length, 0, failures.join("\n"));
console.log(
    "PASS: late M3U matching refreshes missing visible EPG, preserves valid cache and rejects previous-provider responses"
);
