const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const sharedCore = require("./helpers/shared-core-runtime.cjs");
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
vm.createContext(ctx);
sharedCore(ctx, { vendorOnly: true });
vm.runInContext(code, ctx);
function call(action, params = {}) {
    return new Promise((resolve) =>
        ctx.exports.executeRemoteRequest({ action, params }, resolve)
    );
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
(async () => {
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
    console.log(
        "PASS remote requests: ES5, stable channel numbering, Cyrillic search, ambiguity, EPG window, provider policy and credential privacy"
    );
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
