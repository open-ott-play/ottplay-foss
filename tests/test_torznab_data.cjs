const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const flush = async () => {
    for (let i = 0; i < 80; i++) await Promise.resolve();
};
const copy = (v) => JSON.parse(JSON.stringify(v));
function fixture(override) {
    const host = { window: {} };
    const code = ts.transpileModule(
        fs.readFileSync("src/provider/torznab-data.ts", "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    require("acorn").parse(code, { ecmaVersion: 5 });
    vm.runInNewContext(code, host);
    const calls = [];
    const data = host.window.__ottTorznabData.create({
        controller: () => new AbortController(),
        language: () => "ru",
        request: async (op, p, signal) => {
            calls.push({ op, p: copy(p) });
            if (override) {
                const result = override(op, p, signal);
                if (result !== undefined) return result;
            }
            if (op === "list")
                return { schema: 1, sources: [{ id: "home", label: "Home" }] };
            if (op === "caps")
                return {
                    categories: [{ id: 2000, name: "Movies" }],
                    maxLimit: 100,
                    schema: 1,
                    searchAvailable: true,
                    sourceId: "home",
                };
            if (op === "search")
                return {
                    items: [
                        {
                            categoryIds: [],
                            languages: [],
                            resultRef: "1".repeat(32),
                            title: "Unknown",
                        },
                        {
                            categoryIds: [],
                            languages: ["rus"],
                            resultRef: "2".repeat(32),
                            title: "Russian",
                        },
                        {
                            categoryIds: [],
                            languages: ["en"],
                            resultRef: "3".repeat(32),
                            title: "English",
                        },
                    ],
                    nextOffset: 50,
                    schema: 1,
                    sourceId: "home",
                    total: null,
                };
            if (op === "prepare")
                return {
                    schema: 1,
                    sourceId: "home",
                    sourceRef: "a".repeat(32),
                };
            throw new Error("unexpected operation");
        },
    });
    return { calls, data };
}
test("local discovery requests caps first, uses raw next offset, ranks known language without hiding unknown", async () => {
    const { data, calls } = fixture();
    let result;
    data.load("popular", null, (r) => (result = r));
    await flush();
    assert.equal(result.ok, true);
    assert.deepEqual(copy(result.items.map((r) => r.title)), [
        "Russian",
        "Unknown",
        "English",
    ]);
    assert.equal(result.next, 50);
    assert.deepEqual(
        calls.map((r) => r.op),
        ["list", "caps", "search"]
    );
    data.search(
        "open film",
        50,
        (r) => (result = r),
        "catalog:torznab:home:2000"
    );
    await flush();
    assert.deepEqual(calls.at(-1).p, {
        categoryIds: [2000],
        limit: 50,
        offset: 50,
        query: "open film",
        sourceId: "home",
    });
    let stream;
    data.lookup(result.items[0], (r) => (stream = r));
    await flush();
    assert.equal(
        stream.items[0].source,
        "ottplay-local-torrent:home/" + "a".repeat(32)
    );
    assert.equal(JSON.stringify(stream).includes("apiKey"), false);
});
test("cancellation and reset prevent late search/prepare from replacing a newer screen", async () => {
    let release;
    const { data } = fixture((op) =>
        op === "search"
            ? new Promise((resolve) => (release = resolve))
            : undefined
    );
    let called = 0;
    data.load("popular", null, () => called++);
    await flush();
    data.cancel();
    release({ items: [], nextOffset: null, schema: 1, sourceId: "home" });
    await flush();
    assert.equal(called, 0);
    data.dispose();
});
test("no configured sources is explicit, and one failed caps source does not hide other sources", async () => {
    const { data, calls } = fixture((op) =>
        op === "list" ? { schema: 1, sources: [] } : undefined
    );
    let result;
    data.load("popular", null, (r) => (result = r));
    await flush();
    assert.equal(result.error, "not_configured");
    assert.equal(calls.length, 1);
    const other = fixture((op) =>
        op === "caps" ? Promise.reject(new Error("offline")) : undefined
    );
    other.data.categories((r) => (result = r));
    await flush();
    assert.equal(result.ok, true);
    assert.equal(result.categories[0].title, "Home");
});
test("cancel and superseding pages release owned request slots without late callbacks", async () => {
    let active = 0;
    const pending = [];
    const f = fixture((op, _params, signal) => {
        if (op !== "search") return;
        if (active === 2) return Promise.reject(new Error("torznab_busy"));
        active++;
        signal?.addEventListener("abort", () => active--, { once: true });
        return new Promise((resolve) => pending.push(resolve));
    });
    let called = 0;
    f.data.load("popular", null, () => called++);
    await flush();
    assert.equal(active, 1);
    f.data.cancel();
    assert.equal(active, 0);
    f.data.load("popular", null, () => called++);
    await flush();
    f.data.load("popular", null, () => called++);
    await flush();
    assert.equal(active, 1, "only the current page retains an HTTP slot");
    for (const resolve of pending)
        resolve({ items: [], nextOffset: null, schema: 1, sourceId: "home" });
    await flush();
    assert.equal(called, 1);
});
test("reset and dispose abort prepare, and cancel before dispatch starts no request", async () => {
    for (const method of ["reset", "dispose"]) {
        let signal,
            release,
            called = 0;
        const f = fixture((op, _params, currentSignal) => {
            if (op !== "prepare") return;
            signal = currentSignal;
            return new Promise((resolve) => (release = resolve));
        });
        f.data.lookup(
            { resultRef: "a".repeat(32), sourceId: "home" },
            () => called++
        );
        await flush();
        f.data[method]();
        assert.equal(signal?.aborted, true, method);
        release({ schema: 1, sourceId: "home", sourceRef: "b".repeat(32) });
        await flush();
        assert.equal(called, 0);
    }
    const f = fixture();
    f.data.load("popular", null, () => assert.fail("cancelled page"));
    f.data.cancel();
    await flush();
    assert.equal(f.calls.length, 0);
});
