const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const ts = require("typescript");
const { assembleClassic } = require("../scripts/classic-bundle.cjs");
const { optimizeClassic } = require("../scripts/classic-optimizer.cjs");
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

// Exercise Windows path identities with the real compiler on every CI host.
// TypeScript's SourceFile paths use '/', even when root file names use '\\'.
function windowsLinker(files) {
    const normalize = (file) => path.win32.resolve(file).replace(/\\/g, "/");
    const contents = new Map(
        Object.entries(files).map(([file, text]) => [normalize(file), text])
    );
    const observed = { roots: [], sources: [] };
    function compilerHost(options) {
        const host = ts.createCompilerHost(options);
        host.getCurrentDirectory = () => "C:/checkout";
        host.getCanonicalFileName = (file) => file.toLowerCase();
        host.useCaseSensitiveFileNames = () => false;
        host.fileExists = (file) => contents.has(normalize(file));
        host.readFile = (file) => contents.get(normalize(file));
        host.directoryExists = (directory) =>
            Array.from(contents.keys()).some((file) =>
                file.startsWith(normalize(directory) + "/")
            );
        host.getSourceFile = (file, languageVersion) => {
            const text = host.readFile(file);
            if (text === undefined) return undefined;
            const source = ts.createSourceFile(
                file,
                text,
                languageVersion,
                true
            );
            observed.sources.push(source.fileName);
            return source;
        };
        return host;
    }
    const compiler = {
        ...ts,
        createCompilerHost: compilerHost,
        createProgram(files, options) {
            observed.roots.push(...files);
            return ts.createProgram(files, options, compilerHost(options));
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(
        fs.readFileSync(
            path.join(__dirname, "../scripts/classic-bundle.cjs"),
            "utf8"
        ),
        {
            module,
            require(name) {
                if (name === "node:path") return path.win32;
                if (name === "node:fs")
                    return {
                        existsSync: (file) => contents.has(normalize(file)),
                    };
                if (name === "typescript") return compiler;
                throw new Error(
                    "Unexpected classic linker dependency: " + name
                );
            },
        }
    );
    return { assemble: module.exports.assembleClassic, observed };
}

async function testWindowsPaths() {
    const windowsRoot = "C:\\checkout";
    const manifest = "build/compatibility/legacy-names.js";
    const privateFile = "build/debug/playback-debug.js";
    const modules = [manifest, "before.js", "dep.js", privateFile, "entry.js"];
    const files = {
        [path.win32.join(windowsRoot, manifest)]:
            'var legacyPlayerBindings = [["channelName", "chName"], ["getChannel", "getCh"]];',
        [path.win32.join(windowsRoot, "before.js")]: "var events = ['before'];",
        [path.win32.join(windowsRoot, "dep.js")]:
            'export var channelName = "first"; export function getChannel() { return channelName; }',
        [path.win32.join(windowsRoot, privateFile)]:
            "var privateState = 3; function privateRead() { return privateState; } " +
            "window.__ottDebug = { read: privateRead }; events.push('private');",
        [path.win32.join(windowsRoot, "entry.js")]:
            'import { channelName as currentName, getChannel } from "./dep"; ' +
            "export function publicRead(channelName) { return [getChannel(), currentName, channelName]; } " +
            "events.push('after');",
    };
    const linker = windowsLinker(files);
    const linked = linker.assemble(windowsRoot, modules);
    assert(
        linker.observed.roots.every((file) =>
            file.startsWith("C:\\checkout\\")
        ),
        "The compiler receives Windows-native root paths"
    );
    assert(
        linker.observed.sources.every((file) =>
            file.startsWith("C:/checkout/")
        ),
        "The real compiler normalizes source-file paths to forward slashes"
    );
    const optimized = await optimizeClassic(linked);
    for (const source of [linked, optimized.code]) {
        acorn.parse(source, { ecmaVersion: 5 });
        const context = vm.createContext({ privateState: 100 });
        context.window = context;
        vm.runInContext(source, context);
        assert.equal(
            typeof context.getCh,
            "function",
            "Keep the provider's legacy global ABI on Windows"
        );
        assert.equal(context.getChannel, undefined);
        assert.equal(context.chName, "first");
        assert.deepEqual(Array.from(context.publicRead("local")), [
            "first",
            "first",
            "local",
        ]);
        context.chName = "changed by provider";
        assert.deepEqual(Array.from(context.publicRead("local")), [
            "changed by provider",
            "changed by provider",
            "local",
        ]);
        vm.runInContext(
            'function getCh() { return "provider hook"; }',
            context
        );
        assert.deepEqual(Array.from(context.publicRead("local")), [
            "provider hook",
            "changed by provider",
            "local",
        ]);
        assert.equal(
            context.privateState,
            100,
            "The Windows build isolates debug state"
        );
        assert.equal(context.privateRead, undefined);
        assert.equal(context.__ottDebug.read(), 3);
        assert.deepEqual(Array.from(context.events), [
            "before",
            "private",
            "after",
        ]);
    }
    for (const reference of ["privateState", "window.privateState"]) {
        const leakingFiles = {
            ...files,
            [path.win32.join(windowsRoot, "entry.js")]:
                "var leaked = " + reference + ";",
        };
        assert.throws(
            () => windowsLinker(leakingFiles).assemble(windowsRoot, modules),
            /reference to private classic binding/,
            "Windows cannot bypass private-boundary validation"
        );
    }
}

async function testPrivateBoundary() {
    const privateFile = "build/debug/playback-debug.js";
    write("private-before.js", "var events = ['before']; var liveValue = 2;");
    write(
        privateFile,
        `
        var privateState = 3;
        var moduleReceiver = this;
        function privateRead(value) { return privateState + liveValue + value; }
        function unusedPrivateFunction() { return 'unreachable'; }
        window.__ottDebug = {
            read: privateRead,
            change: function(value) { privateState = value; },
            receiver: moduleReceiver
        };
        events.push('private');
    `
    );
    write(
        "private-after.js",
        "events.push('after'); var publicCallback = window.__ottDebug.read;"
    );
    const linked = assembleClassic(root, [
        "private-before.js",
        privateFile,
        "private-after.js",
    ]);
    const optimized = await optimizeClassic(linked);
    for (const source of [linked, optimized.code]) {
        acorn.parse(source, { ecmaVersion: 5 });
        const context = vm.createContext({ privateState: 100 });
        context.window = context;
        vm.runInContext(source, context);
        assert.deepEqual(Array.from(context.events), [
            "before",
            "private",
            "after",
        ]);
        assert.equal(
            context.__ottDebug.receiver,
            vm.runInContext("this", context)
        );
        assert.equal(
            context.privateState,
            100,
            "An existing global cannot overwrite private state"
        );
        assert.equal(context.privateRead, undefined);
        assert.equal(context.unusedPrivateFunction, undefined);
        assert.equal(context.publicCallback(1), 6);
        assert.equal(context.publicCallback.name, "privateRead");
        assert.equal(context.publicCallback.length, 1);
        context.liveValue = 10;
        context.__ottDebug.change(5);
        assert.equal(
            context.publicCallback(2),
            17,
            "Public callbacks retain private state and live global reads"
        );
        context.__ottDebug.read = () => 99;
        assert.equal(
            context.__ottDebug.read(),
            99,
            "Public API properties remain replaceable"
        );
        assert.equal(context.publicCallback(2), 17);
    }
    assert(
        !optimized.code.includes("unusedPrivateFunction"),
        "The real optimizer can eliminate an unreferenced private function"
    );
    for (const reference of [
        "var leaked = privateState;",
        "var leaked = window.privateState;",
        "var leaked = window['privateState'];",
        "import { privateState } from './build/debug/playback-debug';",
    ]) {
        write("private-leak.js", reference);
        assert.throws(
            () => assembleClassic(root, [privateFile, "private-leak.js"]),
            /private classic/
        );
    }
    write(
        "private-shadow.js",
        "function ownState(privateState) { return privateState; }" +
            "function ownWindow(window) { return window.privateState; }"
    );
    assert.doesNotThrow(() =>
        assembleClassic(root, [privateFile, "private-shadow.js"])
    );
    for (const invalid of [
        "export var leaked = 1;",
        "export { privateState }; var privateState = 1;",
        "export {}; var privateState = 1;",
        "import { video } from '../../dep';",
    ]) {
        write(privateFile, invalid);
        assert.throws(
            () => assembleClassic(root, ["dep.js", privateFile]),
            /private classic module must publish window properties/
        );
    }
    write(
        privateFile,
        `
        if (true) { var branchState = 1; }
        for (var loopState = 0; loopState < 1; loopState++) {}
        window.__ottDebug = { value: branchState + loopState };
    `
    );
    for (const reference of [
        "branchState",
        "loopState",
        "window.branchState",
        "window['loopState']",
    ]) {
        write("private-hoisted-leak.js", "var leaked = " + reference + ";");
        assert.throws(
            () =>
                assembleClassic(root, [privateFile, "private-hoisted-leak.js"]),
            /reference to private classic binding/
        );
    }
    write(
        privateFile,
        compile(`
        async function privateAwait(value) { return await value; }
        window.__ottDebug = { wait: privateAwait };
    `)
    );
    write(
        "public-async.js",
        compile(
            "export async function publicAwait(value) { return await value; }"
        )
    );
    const asyncSource = assembleClassic(root, [privateFile, "public-async.js"]);
    assert.equal(
        helperCount(asyncSource, "__awaiter"),
        1,
        "A private helper must not replace the global helper initialization"
    );
    const asyncContext = vm.createContext({});
    asyncContext.window = asyncContext;
    vm.runInContext(asyncSource, asyncContext);
    assert.equal(await asyncContext.__ottDebug.wait(Promise.resolve(7)), 7);
    assert.equal(await asyncContext.publicAwait(Promise.resolve(9)), 9);
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
        await testPrivateBoundary();
        await testWindowsPaths();
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
