const assert = require("node:assert/strict");
const vm = require("node:vm");
const privateRuntime = require("./helpers/private-runtime.cjs");

{
    const host = vm.createContext({});
    host.window = host;
    privateRuntime(host, "src/guide/screen.ts");
    const rows = vm.runInContext(
        `[
            {id: "new", start: 9000, end: 9500, title: "Same"},
            {id: "live", start: 9900, end: 10100, title: "Current"},
            {id: "boundary", start: 6400, end: 6500, title: "Boundary"},
            {id: "alpha", start: 8500, end: 8600, title: "Alpha"},
            {id: "old", start: 8000, end: 8200, title: "Same"}
        ]`,
        host
    );
    const before = JSON.stringify(rows),
        references = Array.from(rows);
    rows.forEach(Object.freeze);
    Object.freeze(rows);
    vm.runInContext(
        `var copyCalls = 0, copiedSlots = 0, originalSlice = Array.prototype.slice;
        Array.prototype.slice = function () {
            copyCalls++;
            copiedSlots += this.length;
            return originalSlice.apply(this, arguments);
        };`,
        host
    );
    let snapshot;
    const screen = host.__ottGuideScreen.create({
        current: () => true,
        now: () => 10000,
        request(_reference, notify) {
            notify(rows);
            return () => {};
        },
        select(all, playhead, limit) {
            assert.equal(all, rows);
            assert.equal(playhead, 10000);
            assert.equal(limit, 0);
            return { current: rows[1] };
        },
    });
    screen.open({}, 0, 1, 10000, (value) => {
        snapshot = value;
    });
    vm.runInContext("Array.prototype.slice = originalSlice;", host);
    assert.deepEqual(
        Array.from(snapshot.rows, (item) => item.id),
        ["alpha", "new"]
    );
    assert.deepEqual(
        Array.from(snapshot.schedule, (item) => item.id),
        ["old", "alpha", "new", "live"]
    );
    assert.equal(snapshot.selectedId, "alpha");
    assert.equal(JSON.stringify(rows), before);
    references.forEach((item, index) => assert.equal(rows[index], item));
    snapshot.schedule[0].title = "external mutation";
    snapshot.rows.reverse();
    assert.equal(screen.snapshot().schedule[0].title, "Same");
    assert.equal(screen.snapshot().rows[0].id, "alpha");
    assert.equal(host.copyCalls, 1, "recordings need only one private copy");
    assert.equal(host.copiedSlots, 4, "only the retained schedule is copied");
}
console.log(
    "PASS guide screen: recordings preserve owned schedules with one shallow copy"
);

{
    const host = vm.createContext({});
    host.window = host;
    privateRuntime(host, "src/guide/screen.ts");
    let reads = 0,
        callback;
    const rows = Array.from({ length: 10000 }, (_, index) => {
        const row = { end: 200, start: 100, title: "Program " + index };
        Object.defineProperty(row, "id", {
            enumerable: true,
            get() {
                reads++;
                return "p" + index;
            },
        });
        return row;
    });
    const screen = host.__ottGuideScreen.create({
        current: () => true,
        now: () => 150,
        request(_ref, notify) {
            callback = notify;
            notify(rows);
            return () => {};
        },
        select: () => ({ current: rows[0] }),
    });
    screen.open({}, 1, 0, 150, () => {});
    reads = 0;
    for (let i = 0; i < 100; i++)
        assert.equal(screen.select("p9999").title, "Program 9999");
    assert(
        reads <= 100,
        "selection must inspect only the selected row, not scan 10k programmes"
    );
    const selected = screen.select("p9999");
    selected.title = "outside mutation";
    assert.equal(screen.select("p9999").title, "Program 9999");
    callback([
        { end: 200, id: "replacement", start: 100, title: "Replacement" },
    ]);
    assert.equal(
        screen.select("p9999"),
        null,
        "schedule refresh removes stale IDs"
    );
    assert.equal(screen.select("replacement").title, "Replacement");
    callback([
        { end: 200, id: "same", start: 100, title: "First" },
        { end: 201, id: "same", start: 101, title: "Second" },
    ]);
    assert.equal(
        screen.select("same").title,
        "First",
        "first duplicate retains old selection semantics"
    );
    screen.close();
    assert.equal(screen.select("same"), null);
}
console.log(
    "PASS indexed guide selection: 10k rows, refresh, duplicate identity and detached data"
);
