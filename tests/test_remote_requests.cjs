const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const sharedCore = require("./helpers/shared-core-runtime.cjs");
const casingCode = ts.transpileModule(
    fs.readFileSync("src/utils/caseless.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(casingCode, { ecmaVersion: 5 });
const casingContext = vm.createContext({ exports: {} });
// The helper needs no normalization, locale, code-point or modern string APIs.
vm.runInContext(
    "String.prototype.normalize = String.prototype.toLocaleLowerCase = " +
        "String.prototype.toLocaleUpperCase = String.prototype.codePointAt = " +
        "String.fromCodePoint = undefined;",
    casingContext
);
vm.runInContext(casingCode, casingContext);
const { caselessKey } = casingContext.exports;
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
            : name === "./remote-profiles"
              ? loadRemoteHelper("remote-profiles")
              : name === "../plugins/vportal"
                ? loadRemoteHelper("vportal", "src/plugins/vportal.ts")
                : name === "./remote-archive"
                  ? loadRemoteHelper("remote-archive")
                  : name === "./remote-restart"
                    ? loadRemoteHelper("remote-restart")
                    : name === "../utils/caseless"
                      ? casingContext.exports
                      : { handleCommand: () => "accepted" },
    URL,
    window: host,
};
function loadRemoteHelper(name, file = "src/commands/" + name + ".ts") {
    const helper = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(helper, { ecmaVersion: 5 });
    const context = vm.createContext({ ...ctx, exports: {} });
    vm.runInContext(helper, context);
    return context.exports;
}
vm.createContext(ctx);
sharedCore(ctx, { vendorOnly: true });
vm.runInContext(code, ctx);
function call(action, params = {}) {
    return new Promise((resolve) =>
        ctx.exports.executeRemoteRequest({ action, params }, resolve)
    );
}
function checkRealSettingsPolicy() {
    let saves = 0,
        reloads = 0,
        restarts = 0;
    const queryHost = {
        ...host,
        __ottActiveProviderDriver: {
            ...host.__ottActiveProviderDriver,
            saveCredentials: () => saves++,
        },
        __ottParental: undefined,
        loadPlaylist: () => reloads++,
        parentAccess: false,
        parentPIN: "1234",
        restart: () => restarts++,
    };
    const queryContext = vm.createContext({
        ...ctx,
        exports: {},
        window: queryHost,
    });
    require("./helpers/access-runtime.cjs")(queryContext);
    vm.runInContext(code, queryContext);
    function policy(settings, providers, channels) {
        queryHost.settings = {
            psChannels: channels,
            psOptions: settings,
            requirePinForProviderSelection: providers,
        };
        queryHost.parentAccess = false;
    }
    function run(action, params) {
        let result, effect;
        queryContext.exports.executeRemoteRequest(
            { action, params },
            (value) => {
                result = value;
            },
            (value) => {
                effect = value;
            }
        );
        return { effect, result };
    }
    const edit = { provider: "xtream", settings: { username: "changed" } };
    for (const selected of [
        [1, 0, 0],
        [0, 1, 0],
    ]) {
        policy(...selected);
        assert.equal(run("provider_settings", edit).result.status, "rejected");
        const restart = run("restart", { target: "player" });
        assert.equal(restart.result.status, "rejected");
        assert.equal(restart.effect, undefined);
    }
    assert.equal(saves + reloads + restarts, 0);
    policy(0, 0, 1);
    assert.equal(queryHost.__ottParental.needs("channels"), true);
    assert.equal(run("provider_settings", edit).result.status, "ok");
    assert.equal(saves, 1);
    assert.equal(reloads, 1);
    const accepted = run("restart", { target: "player" });
    assert.equal(accepted.result.status, "ok");
    assert.equal(restarts, 0, "player restart waits for acknowledged delivery");
    policy(1, 0, 0);
    accepted.effect();
    assert.equal(
        restarts,
        0,
        "a settings lock acquired before ACK cancels restart"
    );
    policy(0, 0, 1);
    run("restart", { target: "player" }).effect();
    assert.equal(
        restarts,
        1,
        "channel policy alone does not lock player settings"
    );
    console.log(
        "PASS remote real settings policy: settings/providers locks, channels-only access and pre-ACK revocation"
    );
}
function checkUnicodeReference() {
    const reference = new Map();
    const fixture = fs.readFileSync(
        "tests/fixtures/unicode/CaseFolding-17.0.0.txt",
        "utf8"
    );
    for (const line of fixture.split("\n")) {
        const [point, status, mapping] = line.split("#")[0].split(";");
        if (!status || !["C", "F"].includes(status.trim())) continue;
        reference.set(
            Number.parseInt(point, 16),
            String.fromCodePoint(
                ...mapping
                    .trim()
                    .split(/\s+/)
                    .map((v) => Number.parseInt(v, 16))
            )
        );
    }
    const canonical = (value) =>
        Array.from(value, (c) => reference.get(c.codePointAt(0)) || c).join("");
    assert.equal(reference.size, 1585, "pin the complete Unicode 17 C/F data");
    for (let point = 0; point <= 0x10ffff; point++) {
        const original = String.fromCodePoint(point);
        const folded = reference.get(point) || original;
        const actual = caselessKey(original);
        assert.equal(
            actual,
            caselessKey(folded),
            "C/F pair U+" + point.toString(16)
        );
        assert.equal(
            canonical(actual),
            folded,
            "no additional equivalence U+" + point.toString(16)
        );
    }
    assert.equal(caselessKey("\ud800x\udfff"), "\ud800X\udfff");
    console.log(
        "PASS remote Unicode 17 C/F pairs and negative equivalence: 1114112 codepoints"
    );
}
function unicodeRequests(names) {
    let played;
    const folded = [];
    const ids = names.map((_, i) => "Mixed_ID_" + i);
    const queryHost = {
        ...host,
        __ottClassicGuide: {
            peek: (id) => [
                {
                    name: names[ids.indexOf(id)],
                    time: now - 1,
                    time_to: now + 60,
                },
            ],
            source: () => "unicode",
        },
        cats: { one: ids },
        catsArray: ["one"],
        channels: Object.fromEntries(
            ids.map((id, i) => [id, { channel_name: names[i] }])
        ),
        cList: ids,
        playChannel: (...args) => (played = args),
    };
    const queryContext = vm.createContext({
        ...ctx,
        exports: {},
        require: (name) =>
            name === "../utils/caseless"
                ? {
                      caselessKey: (value) => {
                          folded.push(value);
                          return caselessKey(value);
                      },
                  }
                : ctx.require(name),
        window: queryHost,
    });
    sharedCore(queryContext, { vendorOnly: true });
    vm.runInContext(code, queryContext);
    return {
        folded,
        get played() {
            return played;
        },
        run(action, query) {
            let result;
            queryContext.exports.executeRemoteRequest(
                { action, params: { query, search: query } },
                (value) => (result = value)
            );
            assert.ok(result, "small cached catalogue replies synchronously");
            return result;
        },
    };
}
function checkUnicodeRequests() {
    for (const [title, query] of [
        ["Straße", "STRASSE"],
        ["STRAẞE", "strasse"],
        ["ΟΣ", "οσ"],
        ["Ος", "οσ"],
        ["Первый Новости", "ПЕРВЫЙ НОВОСТИ"],
        ["İx", "i\u0307x"],
        ["ıx", "ıX"],
        ["ıΣıΣ", "ıσıσ"],
        ["ΟΣ'Α", "οσ'α"],
        ["Երևան", "երեւան"],
        ["ᾼΣ", "αισ"],
        ["\u{10400} Channel", "\u{10428} CHANNEL"],
    ]) {
        const f = unicodeRequests([title]);
        const channels = f.run("channels", query).data.channels;
        assert.equal(channels.length, 1, title);
        assert.equal(channels[0].name, title, "preserve channel spelling");
        assert.equal(channels[0].id, "Mixed_ID_0", "preserve channel ID case");
        const programs = f.run("programs", query).data.programs;
        assert.equal(programs.length, 1, title);
        assert.equal(programs[0].title, title, "preserve programme spelling");
        assert.equal(programs[0].channel, title);
        const play = f.run("play", query);
        assert.equal(play.status, "ok", title);
        assert.equal(play.data.channel.name, title);
        assert.deepEqual(f.played, [0, 0]);
    }
    for (const [title, query] of [
        ["ıx", "ix"],
        ["ix", "ıx"],
        ["İx", "ix"],
        ["ix", "İx"],
        ["café", "cafe"],
        ["café", "cafe\u0301"],
        ["ＡＢＣ", "abc"],
        ["абв", "abv"],
        ["άλφα", "αλφα"],
        ["Maßstab", "MASSTAB"],
        ["և", "եվ"],
        ["ĳ", "ij"],
        ["Α\u0345\u0301", "Α\u0301\u0345"],
    ]) {
        const f = unicodeRequests([title]);
        assert.equal(f.run("channels", query).data.channels.length, 0, title);
        assert.equal(f.run("programs", query).data.programs.length, 0, title);
        assert.equal(f.run("play", query).status, "rejected", title);
        assert.equal(f.played, undefined);
    }
    const ambiguous = unicodeRequests(["Straße", "STRASSE"]);
    const rejected = ambiguous.run("play", "strasse");
    assert.equal(rejected.status, "rejected");
    assert.equal(
        rejected.data.matches.length,
        2,
        "folded exact matches remain ambiguous"
    );
    assert.equal(ambiguous.played, undefined);
    assert.equal(ambiguous.run("play", "2").data.channel.name, "STRASSE");
    const substring = unicodeRequests(["Die Straße HD"]);
    assert.equal(substring.run("play", "STRASSE").status, "ok");
    for (const [title, query] of [
        ["İ", "i"],
        ["xևy", "ւy"],
        ["X\u0345Y", "ιy"],
    ]) {
        assert.notEqual(caselessKey(title), caselessKey(query));
        const f = unicodeRequests([title]);
        assert.equal(f.run("channels", query).data.channels.length, 1);
        assert.equal(f.run("programs", query).data.programs.length, 1);
        assert.equal(
            f.run("play", query).status,
            "ok",
            "expansion substrings remain valid"
        );
    }
    assert.equal(
        substring.run("CHANNELS", "STRASSE").status,
        "unsupported",
        "action IDs stay exact"
    );
    const once = unicodeRequests(["One", "Two", "Needle"]);
    for (const action of ["channels", "programs", "play"]) {
        once.folded.length = 0;
        once.run(action, "nEeDlE");
        assert.equal(
            once.folded.filter((value) => value === "nEeDlE").length,
            1,
            action + " folds the query once across the catalogue"
        );
    }
}
function checkPendingGuideSnapshot() {
    let pending, result;
    let nextTimer = 0;
    let clock = now * 1000;
    const timers = new Map();
    const pendingHost = {
        ...host,
        __ottClassicGuide: {
            peek: (id) =>
                id === "a"
                    ? [
                          {
                              name: "At query start",
                              time: now - 60,
                              time_to: now + 5,
                          },
                      ]
                    : [],
            request: (_id, callback) => {
                pending = callback;
                return () => {};
            },
            source: () => "one",
        },
        cList: ["a", "c"],
        clearTimeout: (id) => timers.delete(id),
        commandChannelsReady: true,
        setTimeout: (fn, delay) => {
            const id = ++nextTimer;
            timers.set(id, { delay, fn });
            return id;
        },
    };
    const pendingContext = {
        ...ctx,
        Date: { now: () => clock },
        exports: {},
        window: pendingHost,
    };
    vm.createContext(pendingContext);
    sharedCore(pendingContext, { vendorOnly: true });
    vm.runInContext(code, pendingContext);
    pendingContext.exports.executeRemoteRequest(
        { action: "programs", params: {} },
        (value) => (result = value)
    );
    assert.equal(result, undefined);
    assert.deepEqual(
        [...timers.values()].map((timer) => timer.delay),
        [25000],
        "after dispatching the final row, wait for its callback without empty pump timers"
    );
    clock += 10000;
    pending("c", [
        { name: "Started after the query", time: now + 8, time_to: now + 130 },
    ]);
    const continuation = [...timers.entries()].find(
        (entry) => entry[1].delay === 0
    );
    assert.ok(continuation, "the guide callback resumes collection");
    timers.delete(continuation[0]);
    continuation[1].fn();
    assert.equal(result.data.partial, false);
    assert.equal(result.data.checked, 2);
    assert.equal(result.data.as_of, now);
    assert.equal(result.data.programs.length, 1);
    assert.equal(result.data.programs[0].title, "At query start");
    assert.equal(timers.size, 0, "completion clears the deadline");
}
function guideQueryFixture(count, guide, params = {}) {
    let nextTimer = 0,
        peakTimers = 0,
        result;
    const timers = new Map();
    const queryHost = {
        ...host,
        __ottClassicGuide: guide,
        __ottCommandChannelLoad: {},
        channels: {},
        cList: Array.from({ length: count }, (_, id) => id),
        clearTimeout: (id) => timers.delete(id),
        setTimeout: (fn, delay) => {
            const id = ++nextTimer;
            timers.set(id, { delay, fn });
            peakTimers = Math.max(peakTimers, timers.size);
            return id;
        },
    };
    for (const id of queryHost.cList)
        queryHost.channels[id] = { channel_name: "Channel " + id };
    const queryContext = vm.createContext({
        ...ctx,
        Date: { now: () => now * 1000 },
        exports: {},
        window: queryHost,
    });
    sharedCore(queryContext, { vendorOnly: true });
    vm.runInContext(code, queryContext);
    const cancel = queryContext.exports.executeRemoteRequest(
        { action: "programs", params },
        (value) => {
            assert.equal(result, undefined, "one query has one reply");
            result = value;
        }
    );
    return {
        cancel,
        flush(delay = 0) {
            let task,
                iterations = 0;
            while (
                (task = [...timers].find(([, timer]) => timer.delay === delay))
            ) {
                assert(++iterations <= count + 10, "query timers converge");
                timers.delete(task[0]);
                task[1].fn();
            }
        },
        host: queryHost,
        get result() {
            return result;
        },
        stats: () => ({ created: nextTimer, peak: peakTimers }),
        timers,
    };
}
function checkGuideBatchingAndCancellation() {
    const count = 1565;
    let checked = 0;
    const f = guideQueryFixture(count, {
        peek: () => null,
        request: (id, callback) => {
            checked++;
            callback(id, null);
            return () => {};
        },
        source: () => "one",
    });
    assert.equal(checked, 64, "large synchronous results yield after a batch");
    assert.equal(f.result, undefined);
    f.flush();
    assert.equal(f.result.data.checked, count);
    assert.equal(f.result.data.partial, false);
    assert.equal(f.result.data.programs.length, 0);
    assert.ok(f.stats().created <= Math.ceil(count / 64) + 1);
    assert.equal(f.stats().peak, 2, "only a deadline and one continuation");
    assert.equal(f.timers.size, 0, "no canceled work remains queued");

    const cached = guideQueryFixture(count, {
        peek: () => entries.a,
        request: () => {
            throw new Error("cached current schedules need no fetch");
        },
        source: () => "one",
    });
    assert.equal(cached.result, undefined, "cached schedules also yield");
    cached.flush();
    assert.equal(cached.result.data.programs.length, count);
    assert.equal(cached.result.data.programs[0].number, 1);
    assert.equal(cached.result.data.programs[count - 1].number, count);
    assert.equal(cached.result.data.partial, false);

    const pending = [];
    let released = 0;
    const canceled = guideQueryFixture(count, {
        peek: () => null,
        request: (id, callback) => {
            pending.push(() => callback(id, entries.a));
            return () => released++;
        },
        source: () => "one",
    });
    assert.equal(pending.length, 4, "guide concurrency stays bounded");
    pending[0]();
    assert.equal(canceled.timers.size, 2);
    canceled.cancel();
    pending.forEach((notify) => notify());
    canceled.flush();
    assert.equal(released, 4);
    assert.equal(canceled.result, undefined, "late callbacks cannot reply");
    assert.equal(canceled.timers.size, 0, "cancel removes the continuation");
    assert.equal(pending.length, 4, "cancel cannot dispatch more guide work");

    const deadline = guideQueryFixture(count, {
        peek: (id) => (id === 0 ? entries.a : null),
        request: () => () => {},
        source: () => "one",
    });
    deadline.flush(25000);
    assert.equal(deadline.result.data.partial, true);
    assert.equal(deadline.result.data.checked, 1);
    assert.equal(deadline.result.data.total, count);
    assert.equal(deadline.result.data.programs.length, 1);
    assert.equal(deadline.timers.size, 0);
    console.log(
        "PASS remote EPG 1565-channel batching: " +
            f.stats().created +
            " timers, peak " +
            f.stats().peak
    );
}
function checkGuideSelectionAndReload() {
    const schedules = [
        { name: "Long overlap", time: now - 60, time_to: now + 60 },
        { name: "Current latest", time: now - 5, time_to: now + 5 },
        { name: "Same-start correction", time: now - 5, time_to: now + 10 },
        { name: "Future", time: now + 5, time_to: now + 60 },
    ];
    const guide = {
        peek: () => schedules,
        request: () => {
            throw new Error("cached schedules need no fetch");
        },
        source: () => "one",
    };
    const f = guideQueryFixture(1, guide);
    assert.equal(f.result.data.programs[0].title, "Current latest");
    assert.equal(
        guideQueryFixture(1, guide, { search: "Long" }).result.data.programs
            .length,
        0,
        "filter the chosen current programme, not an older overlap"
    );
    for (const reload of [
        (queryHost) => (queryHost.__ottCommandChannelLoad = {}),
        (queryHost) => (queryHost.commandChannelsReady = false),
        (queryHost) => (queryHost.__ottClassicGuide.source = () => "two"),
    ]) {
        let late,
            released = 0;
        const pending = guideQueryFixture(2, {
            peek: (id) => (id === 0 ? schedules : null),
            request: (id, callback) => {
                late = () => callback(id, schedules);
                return () => released++;
            },
            source: () => "one",
        });
        reload(pending.host);
        pending.flush(25000);
        assert.equal(pending.result.status, "rejected");
        assert.equal(pending.result.data.programs, undefined);
        assert.equal(released, 1);
        late();
        assert.equal(pending.timers.size, 0);
    }
    for (const reenter of [
        (queryHost) => (queryHost.__ottCommandChannelLoad = {}),
        (queryHost) => (queryHost.__ottClassicGuide.source = () => "two"),
    ]) {
        const pending = guideQueryFixture(2, {
            peek: (id) => (id === 0 ? schedules : null),
            request: () => () => reenter(pending.host),
            source: () => "one",
        });
        pending.flush(25000);
        assert.equal(
            pending.result.status,
            "rejected",
            "guide cancellation can synchronously replace the catalog/source"
        );
        assert.equal(pending.result.data.programs, undefined);
        assert.equal(pending.timers.size, 0);
    }
}
async function checkStatusDiagnostics() {
    const snapshot = async () =>
        JSON.parse(JSON.stringify((await call("status")).data));
    const forbidden = () =>
        assert.fail("status must not read raw logs or enable collection");
    const safe = { available: true, enabled: false };
    host.__ottDebugInputInit = forbidden;
    host.__ottDebug = { dump: forbidden, toggleHud: forbidden };
    host.fetch = forbidden;
    try {
        let data = await snapshot();
        assert.deepEqual(data, {
            channels: 3,
            diagnostics: {
                epg: { available: false },
                input: { available: false },
                version: 1,
            },
            provider: "xtream",
            ready: true,
            uuid: "dev_test",
            volume: 35,
        });
        host.__ottHostedEpg = {
            diagnostics: forbidden,
            remoteSnapshot: () => ({ ...safe }),
        };
        host.__ottDebugInputSnapshot = () => ({ ...safe });
        data = await snapshot();
        assert.deepEqual(data.diagnostics.epg, safe);
        assert.deepEqual(data.diagnostics.input, safe);
        const active = {
            available: true,
            elapsedMs: 96000,
            enabled: true,
            failedPhase: null,
            phase: "download",
            timingsMs: { cache: 1000, download: 90000, parse: 5000 },
        };
        host.__ottHostedEpg.remoteSnapshot = () => ({ ...active });
        assert.deepEqual((await snapshot()).diagnostics.epg, active);
        const secret = "private_subscription_token";
        for (const unavailable of [
            () => null,
            () => true,
            () => 1,
            () => secret,
            () => [],
            () => ({ enabled: true }),
            () => ({ available: true, enabled: "yes" }),
            () => {
                throw new Error(secret);
            },
        ]) {
            host.__ottHostedEpg.remoteSnapshot = unavailable;
            data = await snapshot();
            assert.deepEqual(data.diagnostics.epg, {
                available: true,
                enabled: null,
            });
            assert.deepEqual(
                data.diagnostics.input,
                safe,
                "failed EPG does not block input"
            );
            assert.equal(
                data.volume,
                35,
                "failed diagnostics do not block ordinary status"
            );
            assert.ok(!JSON.stringify(data).includes(secret));
            host.__ottHostedEpg.remoteSnapshot = () => ({ ...active });
            host.__ottDebugInputSnapshot = unavailable;
            data = await snapshot();
            assert.deepEqual(data.diagnostics.input, {
                available: true,
                enabled: null,
            });
            assert.deepEqual(
                data.diagnostics.epg,
                active,
                "failed input does not block EPG"
            );
            assert.ok(!JSON.stringify(data).includes(secret));
            host.__ottDebugInputSnapshot = () => ({ ...safe });
        }
    } finally {
        for (const key of [
            "__ottHostedEpg",
            "__ottDebugInputSnapshot",
            "__ottDebugInputInit",
            "__ottDebug",
            "fetch",
        ])
            delete host[key];
    }
}

function checkRemoteEpgCatalog() {
    function fixture(provider = "m3u") {
        let source = "private-source-identity";
        let clock = Date.now();
        const plays = [];
        const archives = [];
        const h = {
            ...host,
            __ottActiveProviderDriver: { id: provider },
            __ottClassicArchive: { open: (start) => archives.push(start) },
            __ottClassicGuide: {
                peek() {
                    throw new Error("EPG must not be read on the player");
                },
                request() {
                    throw new Error("EPG must not be fetched on the player");
                },
            },
            __ottCommandChannelLoad: 3,
            __ottSourceIdentity: { current: () => source },
            cats: { all: [7, "second"] },
            catsArray: ["all"],
            channels: {
                7: {
                    channel_name: "РЕН ТВ +2",
                    epg: "ren",
                    rec: 144,
                    stream_url: "secret-stream",
                    tn: "РЕН ТВ",
                    ts: 900,
                },
                second: { channel_name: "Другой", password: "secret-password" },
            },
            cList: [7, "second"],
            getArchiveUrl: (_id, start) =>
                "https://archive.example/channel?secret=private&utc=" + start,
            ifParentalAccessChId: () => false,
            parentalArray: [],
            playChannel: (...args) => plays.push(args),
            setCurrent: (...args) => plays.push(args),
        };
        const context = vm.createContext({
            ...ctx,
            Date: { now: () => clock },
            exports: {},
            window: h,
        });
        vm.runInContext(code, context);
        return {
            archives,
            expire: () => {
                clock += 120001;
            },
            h,
            plays,
            run(action, params = {}) {
                let result;
                context.exports.executeRemoteRequest(
                    { action, params },
                    (value) => {
                        result = JSON.parse(JSON.stringify(value));
                    }
                );
                assert.ok(
                    result,
                    "metadata and guarded play reply synchronously"
                );
                return result;
            },
            source: () => {
                source = "replacement-source";
            },
        };
    }
    const f = fixture();
    const snapshot = f.run("epg_catalog");
    assert.equal(snapshot.status, "ok");
    assert.deepEqual(snapshot.data.channels, [
        {
            archiveHours: 144,
            id: "7",
            name: "РЕН ТВ +2",
            number: 1,
            shift: 900,
            tvgId: "ren",
            tvgName: "РЕН ТВ",
        },
        {
            archiveHours: 0,
            id: "second",
            name: "Другой",
            number: 2,
            shift: 0,
            tvgId: "",
            tvgName: "",
        },
    ]);
    assert.equal(
        f.run("epg_catalog").data.catalog,
        snapshot.data.catalog,
        "unchanged catalog retains its receipt"
    );
    assert(!JSON.stringify(snapshot).includes("secret"));
    assert(!JSON.stringify(snapshot).includes("private-source"));
    const played = f.run("play_catalog", {
        catalog: snapshot.data.catalog,
        id: "7",
    });
    assert.equal(played.status, "ok");
    assert.deepEqual(played.data, {
        channel: { id: "7", name: "РЕН ТВ +2", number: 1 },
        dispatched: true,
    });
    assert.deepEqual(f.plays, [[0, 0]]);
    const a = fixture();
    const archiveSnapshot = a.run("epg_catalog");
    const params = {
        catalog: archiveSnapshot.data.catalog,
        end: now - 300,
        id: "7",
        start: now - 600,
        title: "Archive programme",
    };
    assert.equal(a.run("resolve_archive", params).data.resolved, true);
    assert.deepEqual(a.archives, [], "a probe must not start playback");
    const archive = a.run("play_archive_catalog", params);
    assert.equal(archive.status, "ok");
    assert.equal(archive.data.start, params.start);
    assert.deepEqual(a.archives, [params.start]);
    assert.deepEqual(a.plays[0], [0, 0, true]);
    assert.equal(a.h.epgArray[0].name, params.title);
    assert(!JSON.stringify(archive).includes("secret"));
    for (const changed of [
        { start: now - 144 * 3600 - 1 },
        { end: now + 1 },
        { start: true },
        { start: params.end },
        { id: "second" },
        { url: "https://other.example" },
    ]) {
        assert.equal(
            a.run("play_archive_catalog", { ...params, ...changed }).status,
            "rejected"
        );
    }
    a.h.parentalArray = [7];
    a.h.__ottParental = { needs: () => true };
    assert.equal(a.run("resolve_archive", params).status, "rejected");
    assert.equal(a.run("play_archive_catalog", params).status, "rejected");
    a.h.parentalArray = [];
    a.expire();
    const renewed = a.run("epg_catalog");
    assert.equal(
        renewed.data.archive.revision,
        archiveSnapshot.data.archive.revision,
        "receipt expiry must not invalidate the archive availability cache"
    );
    assert.notEqual(renewed.data.catalog, archiveSnapshot.data.catalog);

    for (const provider of ["edem", "xtream", "stalker"]) {
        const named = fixture(provider);
        const row = named.run("epg_catalog").data.channels[0];
        assert.equal(row.name, "РЕН ТВ +2");
        assert.equal(row.tvgId, "", "provider IDs are not public XMLTV IDs");
        assert.equal(row.tvgName, "");
    }

    for (const change of [
        (f) => f.h.cList.reverse(),
        (f) => {
            f.h.channels[7].channel_name = "Changed";
        },
        (f) => {
            f.h.channels[7].epg = "different-guide";
        },
        (f) => {
            f.h.channels[7].ts = 3600;
        },
        (f) => {
            f.h.__ottCommandChannelLoad++;
        },
        (f) => {
            f.h.commandChannelsReady = false;
        },
        (f) => {
            f.h.cats.all = ["second"];
        },
        (f) => f.source(),
        (f) => f.expire(),
    ]) {
        const f = fixture();
        const receipt = f.run("epg_catalog").data.catalog;
        change(f);
        assert.equal(
            f.run("play_catalog", { catalog: receipt, id: "7" }).status,
            "rejected"
        );
        assert.equal(f.plays.length, 0);
    }
    for (const params of [
        {},
        { catalog: "wrong", id: "7" },
        { catalog: snapshot.data.catalog, id: "missing" },
        { catalog: snapshot.data.catalog, extra: true, id: "7" },
    ]) {
        assert.equal(f.run("play_catalog", params).status, "rejected");
        assert.equal(f.plays.length, 1);
    }
    for (const value of [Infinity, 86401, -86401, 0.5]) {
        const f = fixture();
        f.h.channels[7].ts = value;
        assert.equal(f.run("epg_catalog").status, "rejected");
    }
    const huge = fixture();
    huge.h.cList = Array.from({ length: 1565 }, (_, i) => String(i));
    huge.h.channels = Object.fromEntries(
        huge.h.cList.map((id) => [id, { channel_name: "Channel " + id }])
    );
    assert.equal(
        huge.run("epg_catalog").data.channels.length,
        1565,
        "a full player catalogue is read without any guide request"
    );
    huge.h.cList = Array.from({ length: 2049 }, (_, i) => String(i));
    huge.h.channels = Object.fromEntries(
        huge.h.cList.map((id) => [id, { channel_name: id }])
    );
    assert.equal(huge.run("epg_catalog").status, "rejected");
    const longName = fixture();
    longName.h.channels[7].channel_name = "я".repeat(513);
    assert.equal(longName.run("epg_catalog").status, "rejected");
    const empty = fixture();
    empty.h.cList = [];
    assert.deepEqual(empty.run("epg_catalog").data.channels, []);
    console.log(
        "PASS server EPG catalog: metadata-only reads, shifts, bounded fields and source/reload/order/expiry playback guards"
    );
}

(async () => {
    checkRealSettingsPolicy();
    checkRemoteEpgCatalog();
    await checkStatusDiagnostics();
    checkUnicodeReference();
    checkUnicodeRequests();
    checkPendingGuideSnapshot();
    checkGuideBatchingAndCancellation();
    checkGuideSelectionAndReload();
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
        provider: "XTREAM",
        settings: { password: "different" },
    });
    assert.equal(
        r.status,
        "rejected",
        "provider setting IDs remain case-sensitive"
    );
    assert.equal(saved.password, "secret");
    assert.equal(loaded, 1);
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
    host.__ottActiveProviderDriver = {
        credentials: () => ({ server: "club.test", username: "old-key" }),
        id: "ottclub",
        saveCredentials: (value) => (saved = value),
    };
    r = await call("provider_settings", {
        provider: "ottclub",
        settings: { key: "new-key" },
    });
    assert.equal(r.status, "ok");
    assert.equal(saved.server, "club.test");
    assert.equal(saved.username, "new-key");
    assert.ok(!JSON.stringify(r).includes("new-key"));
    r = await call("provider_settings", {
        provider: "ottclub",
        settings: { server: "new.test:8080" },
    });
    assert.equal(r.status, "ok");
    assert.equal(saved.server, "new.test:8080");
    const priorSaves = loaded;
    for (const server of [
        "https://new.test",
        "new.test/path",
        "user@new.test",
        "new.test?key=secret",
        "new.test\\path",
        "bad host",
    ]) {
        r = await call("provider_settings", {
            provider: "ottclub",
            settings: { server },
        });
        assert.equal(r.status, "rejected", server);
        assert.equal(loaded, priorSaves);
    }
    host.commandChannelsReady = false;
    r = await call("channels");
    assert.equal(r.status, "rejected");
    require("./test_remote_profiles.cjs");
    console.log(
        "PASS remote requests: ES5, stable channel numbering, Cyrillic search, ambiguity, EPG window, provider policy and credential privacy"
    );
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
