const assert = require("node:assert/strict");

function trackMediaSnapshots(host) {
    const create = host.__ottMediaLibrary.create;
    const counts = { selects: 0, snapshots: 0 };
    host.__ottMediaLibrary.create = (ports) => {
        const library = create(ports);
        const snapshot = library.snapshot;
        const select = library.select;
        library.snapshot = () => {
            counts.snapshots++;
            return snapshot();
        };
        library.select = (index) => {
            counts.selects++;
            return select(index);
        };
        return library;
    };
    counts.reset = () => {
        counts.selects = counts.snapshots = 0;
    };
    return counts;
}

function assertMediaReadContract(host) {
    let reads = 0;
    const items = Array.from({ length: 1000 }, (_, index) => ({
        payload: {
            nested: {
                get value() {
                    reads++;
                    return index;
                },
            },
        },
        ref: { itemId: String(index), sourceId: "read-contract" },
        title: "Item " + index,
    }));
    const library = host.__ottMediaLibrary.create({
        describe: () => items,
        items: () => [],
        load: (_route, done) => done([]),
        render() {},
    });
    library.open({ kind: "catalog", title: "Large catalog" });
    const revision = library.snapshot().revision;
    const firstSelection = library.capture();
    reads = 0;
    assert.equal(library.revision(), revision);
    assert.equal(library.highlight(999), undefined);
    assert.equal(library.revision(), revision);
    assert.equal(reads, 0, "revision and highlight must not traverse payloads");
    assert.equal(
        firstSelection(),
        false,
        "highlight retires old selection guards"
    );
    const highlighted = library.capture();
    library.highlight(-1);
    assert.equal(highlighted(), true, "missing rows cannot change selection");
    const selected = library.select(999);
    assert.equal(reads, 1, "reading a selected item detaches only that item");
    selected.payload.nested.value = -1;
    const snapshot = library.snapshot();
    assert.equal(snapshot.frame.selected, 999);
    assert.equal(snapshot.frame.items[999].payload.nested.value, 999);
    snapshot.frame.items[999].payload.nested.value = -2;
    assert.equal(library.select(999).payload.nested.value, 999);
    assert.equal(library.select(-1), null);
    library.cancel();
    assert.notEqual(library.revision(), revision);
    assert.equal(highlighted(), false, "cancellation retires selection guards");
}

module.exports = { assertMediaReadContract, trackMediaSnapshots };
