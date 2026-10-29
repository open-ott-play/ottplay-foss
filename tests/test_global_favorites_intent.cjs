"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const load = require("./helpers/private-runtime.cjs");
const source = ts.createSourceFile(
    "core.ts",
    fs.readFileSync("src/core/index.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const owner = source.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "getCoreMediaBackend"
);
let intent;
function visit(node) {
    if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(source) === "beforeIntent"
    )
        intent = node.initializer;
    else ts.forEachChild(node, visit);
}
visit(owner);
assert(intent, "actual core intent port exists");
function fixture() {
    const context = vm.createContext({ console });
    context.window = context;
    context._playSession = 1;
    for (const name of ["adapter", "media-backend"])
        load(context, "src/device/" + name + ".ts");
    vm.runInContext(
        ts.transpileModule(
            "var actualIntent = " + intent.getText(source) + ";",
            { compilerOptions: { target: ts.ScriptTarget.ES5 } }
        ).outputText,
        context
    );
    const actions = [],
        order = [];
    let busy = true;
    context.__ottGlobalFavorites = {
        router: {
            busy: () => busy,
            cancel() {
                order.push("cancel");
                busy = false;
            },
        },
    };
    context.__ottActiveProviderDriver = {
        commitStartupPreview() {
            order.push("preview");
            return true;
        },
        id: "offline",
    };
    const ports = {
        beforeIntent: context.actualIntent,
        clearInterval() {},
        context: () => ({ generation: 1, kind: "vod", position: 0 }),
        emit() {},
        open(request, event) {
            actions.push(["open", request.position]);
            return {
                dispose() {
                    actions.push(["dispose"]);
                },
                pause() {
                    actions.push(["pause"]);
                    event("pause");
                },
                resume() {
                    actions.push(["resume"]);
                },
                sample: () => ({
                    duration: 100,
                    paused: false,
                    position: 0,
                    ready: 2,
                }),
                seek(value) {
                    actions.push(["seek", value]);
                },
            };
        },
        setInterval: () => 1,
    };
    const backend = context.__ottMediaBackend.create(ports);
    return { actions, backend, context, order, ports };
}
for (const operation of ["pause", "seek"]) {
    const f = fixture(),
        handle = f.backend.open({ paused: true, position: 17, url: "fixture" });
    assert.deepEqual(
        f.order,
        [],
        "owned initial engine setup does not enter the public manual-intent hook"
    );
    if (operation === "pause") handle.pause();
    else handle.seek(24);
    assert.deepEqual(
        f.order,
        ["cancel", "preview"],
        "manual intent cancels global routing then chains existing Local preview owner"
    );
    f.backend.dispose();
}
{
    const f = fixture(),
        handle = f.backend.open({ url: "fixture" });
    f.context.__ottGlobalFavorites.router.cancel = () => {
        f.order.push("cancel");
        f.context._playSession++;
    };
    handle.seek(24);
    assert.deepEqual(f.order, ["cancel"]);
    assert.equal(
        f.actions.some((a) => a[0] === "seek" && a[1] === 24),
        false,
        "synchronous source replacement aborts manual transport action"
    );
    f.backend.dispose();
}
console.log(
    "PASS actual core + actual backend intent chaining and owned initial setup"
);
