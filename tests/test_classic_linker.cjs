const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const ts = require("typescript");
const { assembleClassic } = require("../scripts/classic-bundle.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-linker-"));
function write(name, source) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
}

function compile(source) {
    return ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            removeComments: true,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
}

function helperCount(source, name) {
    return acorn
        .parse(source, { ecmaVersion: 5 })
        .body.filter(
            (statement) =>
                statement.type === "VariableDeclaration" &&
                statement.declarations.some(
                    (declaration) => declaration.id.name === name
                )
        ).length;
}

async function testHelpers() {
    const first = compile(`
        export async function firstAsync(value: unknown, events: string[]) {
            events.push("start");
            const result = await value;
            events.push("resolved");
            return Number(result) + 1;
        }
    `);
    const second = compile(`
        export async function secondAsync(value: unknown, events: string[]) {
            try { return await value; }
            catch (error) { events.push(error.message); return "caught"; }
            finally { events.push("finally"); }
        }
        export async function rejectAsync() {
            await 1;
            throw new Error("failure after await");
        }
    `);
    write("before-helpers.js", "var beforeHelpers = true;");
    write("async-a.js", first);
    write("async-b.js", second);
    write(
        "local-helpers.js",
        `export function localHelper(__awaiter) { return __awaiter(7); }
        export function nestedHelper() {
            var __generator = function () { return 8; };
            return __generator();
        }
        export function helperProperty() {
            var object = { __awaiter: function () { return 9; } };
            return object.__awaiter();
        }`
    );
    const modules = [
        "before-helpers.js",
        "async-a.js",
        "async-b.js",
        "local-helpers.js",
    ];
    const linked = assembleClassic(root, modules);
    assert.equal(helperCount(linked, "__awaiter"), 1);
    assert.equal(helperCount(linked, "__generator"), 1);
    assert.ok(
        linked.indexOf("var beforeHelpers") < linked.indexOf("var __awaiter")
    );
    assert.ok(
        linked.indexOf("var __awaiter") < linked.indexOf("function firstAsync")
    );
    write("already-linked.js", linked);
    assert.equal(
        assembleClassic(root, ["already-linked.js"]).trim(),
        linked.trim(),
        "Linking an already-linked bundle does not change helper definitions"
    );

    // A pre-existing global implementation still wins the compiler's fallback.
    const externalAwaiter = function () {
        return "external implementation";
    };
    const externalGenerator = function () {
        return "external generator";
    };
    const external = vm.createContext({
        __awaiter: externalAwaiter,
        __generator: externalGenerator,
    });
    vm.runInContext(linked, external);
    assert.equal(external.__awaiter, externalAwaiter);
    assert.equal(external.__generator, externalGenerator);
    assert.equal(external.firstAsync(1, []), "external implementation");
    assert.equal(
        external.localHelper((value) => value + 1),
        8
    );
    assert.equal(external.nestedHelper(), 8);
    assert.equal(external.helperProperty(), 9);

    const resetHelpers = JSON.stringify(
        "__awaiter = null; __generator = null;"
    );
    for (const evaluate of [
        "eval(" + resetHelpers + ");",
        "(eval)(" + resetHelpers + ");",
        "(0, eval)(" + resetHelpers + ");",
        "var evaluateAlias = eval; evaluateAlias(" + resetHelpers + ");",
        "new Function(" + resetHelpers + ")();",
        "var constructAlias = Function; constructAlias(" +
            resetHelpers +
            ")();",
    ]) {
        write("dynamic-helpers.js", evaluate);
        const dynamic = assembleClassic(root, [
            "async-a.js",
            "dynamic-helpers.js",
            "async-b.js",
        ]);
        assert.equal(helperCount(dynamic, "__awaiter"), 2);
        assert.equal(helperCount(dynamic, "__generator"), 2);
        const dynamicContext = vm.createContext({});
        vm.runInContext(dynamic, dynamicContext);
        const events = [];
        assert.equal(await dynamicContext.secondAsync(23, events), 23);
        assert.deepEqual(events, ["finally"]);
    }
    write(
        "shadowed-eval.js",
        "function callLocalEval(eval, Function) { return eval('local') + Function('local'); }" +
            "var propertyKeys = { eval: 1, Function: 2 };"
    );
    const shadowedEval = assembleClassic(root, [
        "async-a.js",
        "shadowed-eval.js",
        "async-b.js",
    ]);
    assert.equal(helperCount(shadowedEval, "__awaiter"), 1);
    assert.equal(helperCount(shadowedEval, "__generator"), 1);

    // A different compiler/helper implementation must not be mistaken for an
    // identical definition. Preserve it when no matching duplicates exist.
    const changed = second.replace("P = Promise", "P = AlternatePromise");
    assert.notEqual(changed, second);
    write("different-helper.js", changed);
    const different = assembleClassic(root, [
        "async-a.js",
        "different-helper.js",
    ]);
    assert.equal(helperCount(different, "__awaiter"), 2);
    assert.ok(different.includes("AlternatePromise"));
    assert.throws(
        () =>
            assembleClassic(root, [
                "async-a.js",
                "async-b.js",
                "different-helper.js",
            ]),
        /conflicting classic TypeScript helper: __awaiter/
    );
    for (const mutation of [
        "__awaiter = function () {};",
        "function __awaiter() {}",
        "window.__awaiter = null;",
        'globalThis["__generator"] = null;',
        "function resetHelper() { __generator = null; }",
    ]) {
        write("helper-mutation.js", mutation);
        assert.throws(
            () =>
                assembleClassic(root, [
                    "async-a.js",
                    "helper-mutation.js",
                    "async-b.js",
                ]),
            /conflicting classic TypeScript helper/,
            mutation
        );
    }
    write("unrecognized-a.js", "var __awaiter = function () { return 1; };");
    write("unrecognized-b.js", "var __awaiter = function () { return 2; };");
    const unrecognized = assembleClassic(root, [
        "unrecognized-a.js",
        "unrecognized-b.js",
    ]);
    assert.equal(helperCount(unrecognized, "__awaiter"), 2);
    const unknownContext = vm.createContext({});
    vm.runInContext(unrecognized, unknownContext);
    assert.equal(unknownContext.__awaiter(), 2);

    // Use the shipped polyfills, not the host's Promise/Symbol, to execute
    // downlevel async functions in a separate old-engine-like global scope.
    const legacy = vm.createContext({
        clearTimeout,
        Iterator: undefined,
        Promise: undefined,
        Symbol: undefined,
        setTimeout,
    });
    legacy.self = legacy;
    assert.equal(vm.runInContext("typeof Promise", legacy), "undefined");
    vm.runInContext(
        fs.readFileSync(
            path.join(__dirname, "../js/runtime-polyfills.js"),
            "utf8"
        ),
        legacy
    );
    assert.equal(vm.runInContext("typeof Promise", legacy), "function");
    assert.equal(vm.runInContext("typeof Symbol", legacy), "function");
    vm.runInContext(linked, legacy);
    const events = [];
    const result = legacy.firstAsync(
        {
            then(resolve) {
                resolve(41);
            },
        },
        events
    );
    assert.deepEqual(
        events,
        ["start"],
        "Await continuation stays asynchronous"
    );
    assert.equal(await result, 42);
    assert.deepEqual(events, ["start", "resolved"]);
    const caught = [];
    assert.equal(
        await legacy.secondAsync(
            {
                then(_resolve, reject) {
                    reject(new Error("input rejected"));
                },
            },
            caught
        ),
        "caught"
    );
    assert.deepEqual(caught, ["input rejected", "finally"]);
    await assert.rejects(legacy.rejectAsync(), /failure after await/);
}

async function main() {
    try {
        write(
            "dep.js",
            "export var video = null; export function setVideo(v) { video = v; }"
        );
        write(
            "entry.js",
            `
        import {
            video as videoElement,
            setVideo
        } from "./dep";
        export function read(video) { return videoElement; }
        export function shadow(videoElement) { return videoElement; }
        export function record() { return { videoElement }; }
        export function property(object) { return object.videoElement; }
        export function valueType() { return typeof videoElement; }
    `
        );
        const linked = assembleClassic(root, ["dep.js", "entry.js"]);
        acorn.parse(linked, { ecmaVersion: 5 });
        const context = vm.createContext({});
        vm.runInContext(linked, context);
        assert.equal(context.read("wrong captured parameter"), null);
        const player = { position: 12 };
        context.setVideo(player);
        assert.equal(
            context.read("wrong captured parameter"),
            player,
            "Imported mutable binding stays live"
        );
        assert.equal(
            context.shadow("local"),
            "local",
            "Do not rewrite locally shadowed bindings"
        );
        assert.equal(
            context.record().videoElement,
            player,
            "Preserve shorthand property keys"
        );
        assert.equal(
            context.property({ videoElement: 5 }),
            5,
            "Do not rewrite member names"
        );
        assert.equal(context.valueType(), "object");
        assert.throws(
            () => assembleClassic(root, ["entry.js"]),
            /not in CLASSIC_MODULES/
        );
        write(
            "external.js",
            'import { video } from "unknown-package"; export function read() { return video; }'
        );
        assert.throws(
            () => assembleClassic(root, ["external.js"]),
            /not in CLASSIC_MODULES/
        );
        write(
            "namespace.js",
            'import * as data from "./dep"; export function read() { return data.video; }'
        );
        assert.throws(
            () => assembleClassic(root, ["dep.js", "namespace.js"]),
            /named imports/
        );
        write(
            "build/app/state.js",
            "export var popupActions = []; export var arbitrary = 1;"
        );
        write(
            "build/index.js",
            'var popupActions = ["provided by classic entry"];'
        );
        write(
            "build/provider.js",
            'import { popupActions as actions } from "./app/state"; export function getActions() { return actions; }'
        );
        const bridgeContext = vm.createContext({});
        vm.runInContext(
            assembleClassic(root, ["build/provider.js", "build/index.js"]),
            bridgeContext
        );
        assert.equal(
            bridgeContext.getActions()[0],
            "provided by classic entry"
        );
        assert.throws(
            () => assembleClassic(root, ["build/provider.js"]),
            /missing explicit classic bridge/
        );
        write(
            "build/provider.js",
            'import { arbitrary } from "./app/state"; export function get() { return arbitrary; }'
        );
        assert.throws(
            () =>
                assembleClassic(root, ["build/provider.js", "build/index.js"]),
            /missing explicit classic bridge/
        );
        await testHelpers();
        console.log(
            "PASS: classic ES5 linker preserves live aliases, lexical bindings and async behavior; validates ABI bridges and deduplicates identical TypeScript helpers"
        );
    } finally {
        fs.rmSync(root, { force: true, recursive: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
