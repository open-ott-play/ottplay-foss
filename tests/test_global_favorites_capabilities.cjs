"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript");
const { load } = require("./global-favorites-fixture.cjs");
const source = fs.readFileSync(
    path.join(__dirname, "../src/commands/remote-requests.ts"),
    "utf8"
);
const file = ts.createSourceFile(
    "remote-requests.ts",
    source,
    ts.ScriptTarget.Latest,
    true
);
let callback, currentGuard;
function visit(node) {
    if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(file) === "controlCurrent"
    )
        currentGuard = node.initializer.getText(file);
    if (
        ts.isCallExpression(node) &&
        node.expression.getText(file) === "remoteFavoritesTransferCapability"
    ) {
        assert.equal(callback, undefined);
        callback = node.arguments[2].getText(file);
    }
    ts.forEachChild(node, visit);
}
visit(file);
assert(callback);
const core = load("src/commands/remote-favorites-global.ts"),
    items = load("src/commands/remote-favorites-global-items.ts"),
    recovery = load("src/commands/remote-favorites-global-recovery.ts");
let reads = 0,
    writes = 0,
    delivered;
const w = {
        stbGetPersistedItem() {
            reads++;
            return null;
        },
        stbSetItem() {
            writes++;
            throw Error("capability must not write");
        },
    },
    result = { status: "ok", data: {} };
assert.equal(core.globalFavoritesCapability(w), null);
assert(currentGuard); // Use the actual enclosing admission closure, not a permissive stub.
const context = {
    w,
    result,
    Date: { now: () => 1000 },
    remotePlayerInfo: () => ({ runtime: "current-owner" }),
    done: (v) => {
        delivered = v;
    },
    globalFavoritesCapability: core.globalFavoritesCapability,
    globalFavoritesItemsCapability: items.globalFavoritesItemsCapability,
    globalFavoritesRecoveryCapability:
        recovery.globalFavoritesRecoveryCapability,
    legacyFavoritesCapability: core.legacyFavoritesCapability,
};
vm.runInNewContext(
    ts.transpileModule(
        "var run=(function(){var controlCancelled=false,controlRuntime=remotePlayerInfo(w).runtime,controlDeadline=1500;var controlCurrent=" +
            currentGuard +
            ";return (" +
            callback +
            ");})();",
        { compilerOptions: { target: ts.ScriptTarget.ES5 } }
    ).outputText,
    context
);
const run = context.run;
// The existing asynchronous loader has now made its fixed optional module available.
w.__ottGlobalFavoritesProtocol = {};
w.__ottGlobalFavoritesFacade = {};
w.__ottGlobalFavoritesPorts = {};
w.__ottGlobalFavoritesRecovery = {};
w.__ottGlobalFavorites = {
    createItems() {},
    committer: { canWrite: () => true },
};
run(null, null);
assert.equal(delivered, result);
for (const key of [
    "favorites_global",
    "favorites_global_items",
    "favorites_global_recovery",
])
    assert.equal(result.data[key].version, 1);
assert.equal(writes, 0);
delete w.__ottGlobalFavorites;
delete w.__ottGlobalFavoritesFacade;
assert.deepEqual(Array.from(core.legacyFavoritesCapability(w).operations), [
    "list",
    "play",
]);
w.stbGetPersistedItem = () => '{"version":2,"entries":[]}';
assert.equal(core.legacyFavoritesCapability(w).operations.length, 0);
assert.equal(writes, 0);
console.log(
    "PASS actual post-loader capability callback and truthful no-lock legacy operation subsets"
);
