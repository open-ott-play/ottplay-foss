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
    ),
    ast = ts.createSourceFile(
        "remote-requests.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
let branch;
function visit(node) {
    if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "executeRemoteControl"
    ) {
        let at = node;
        while (at && !ts.isIfStatement(at)) at = at.parent;
        assert(at);
        const text = at.getText(ast);
        if (text.includes("remoteFavoritesTransferCapability")) {
            assert.equal(branch, undefined);
            branch = text;
        }
    }
    ts.forEachChild(node, visit);
}
visit(ast);
assert(branch);
const global = load("src/commands/remote-favorites-global.ts"),
    items = load("src/commands/remote-favorites-global-items.ts"),
    recovery = load("src/commands/remote-favorites-global-recovery.ts");
function scenario(change) {
    let runtime = "runtime-old",
        clock = 1000,
        pending,
        initializations = 0,
        delivered = [],
        cancelled = 0;
    const w = {
        __ottGlobalFavorites: {
            committer: { canWrite: () => true },
            createItems() {},
        },
        __ottGlobalFavoritesFacade: {},
        __ottGlobalFavoritesPorts: {},
        __ottGlobalFavoritesProtocol: {},
        __ottGlobalFavoritesRecovery: {},
        __ottInitializeGlobalFavorites() {
            initializations++;
        },
        clearTimeout() {},
        setTimeout() {
            return 1;
        },
        stbGetPersistedItem: () => null,
    };
    const exported = {};
    const loader = ts.transpileModule(
        fs.readFileSync(
            path.join(
                __dirname,
                "../src/commands/remote-favorites-transfer.ts"
            ),
            "utf8"
        ),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    vm.runInNewContext(loader, {
        Date: { now: () => clock },
        exports: exported,
        Promise,
        require: (name) => {
            if (name === "./remote-feature")
                return {
                    loadRemoteFeature(_w, id, done) {
                        assert.equal(id, "favorites-transfer");
                        pending = done;
                    },
                };
            if (name === "../storage/index")
                return {
                    captureFavoritesPhysicalRead() {
                        throw Error("unexpected read");
                    },
                    captureFavoritesPhysicalStorage() {
                        throw Error("unexpected write");
                    },
                    settingsRecoveryRequired: () => false,
                };
            if (name === "../utils/lzstring") return {};
            throw Error(name);
        },
    });
    const run = vm.runInNewContext(
        ts.transpileModule("(function(){" + branch + "})", {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        {
            activeProvider: () => "",
            afterReply() {},
            Date: { now: () => clock },
            done: (r) => delivered.push(r),
            executeRemoteControl(_w, _action, _params, done) {
                done({ data: { runtime }, status: "ok" });
                return () => {
                    cancelled++;
                };
            },
            globalFavoritesCapability: global.globalFavoritesCapability,
            globalFavoritesItemsCapability:
                items.globalFavoritesItemsCapability,
            globalFavoritesRecoveryCapability:
                recovery.globalFavoritesRecoveryCapability,
            legacyFavoritesCapability: global.legacyFavoritesCapability,
            params: {},
            remoteFavoritesTransferCapability:
                exported.remoteFavoritesTransferCapability,
            remotePlayerInfo: () => ({ runtime }),
            request: { action: "capabilities", expires_at: 1.5 },
            w,
        }
    );
    const cancel = run();
    assert.equal(
        initializations,
        0,
        "no global recompute before actual loader completion"
    );
    assert.equal(
        typeof pending,
        "function",
        JSON.stringify({ change, clock, delivered, initializations, runtime })
    );
    if (change === "runtime") runtime = "runtime-new";
    if (change === "expiry") clock = 1600;
    if (change === "cancel") cancel();
    pending("unsupported");
    if (change === "cancel") {
        assert.equal(delivered.length, 0);
        assert.equal(cancelled, 1);
    } else {
        assert.equal(delivered.length, 1);
        assert.equal(delivered[0].data.runtime, "runtime-old");
    }
    if (change === "legitimate-null") {
        assert(initializations > 0);
        assert.equal(delivered[0].data.favorites_global.version, 1);
    } else {
        assert.equal(initializations, 0);
        if (delivered.length)
            assert.equal(delivered[0].data.favorites_global, undefined);
    }
}
for (const change of ["runtime", "expiry", "cancel", "legitimate-null"])
    scenario(change);
console.log(
    "PASS actual control-to-loader chain: stale runtime/expiry/cancel blocked; legitimate unsupported-null retains current global capabilities"
);
