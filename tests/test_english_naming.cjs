const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { assembleClassic } = require("../scripts/classic-bundle.cjs");
const { optimizeClassic } = require("../scripts/classic-optimizer.cjs");
const repository = path.resolve(__dirname, "..");
const manifestSource = fs.readFileSync(
    path.join(repository, "src/compatibility/legacy-names.ts"),
    "utf8"
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-english-names-"));
function write(name, code) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, code);
}
function compile(code) {
    return ts.transpileModule(code, {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
}
const manifest = "build/compatibility/legacy-names.js";
write(manifest, compile(manifestSource));
write(
    "provider.js",
    compile(`
    export function getChannelsArray(value) { return "default:" + value; }
    export function getChannelEpg(value) { return "epg:" + value; }
    export var epgCacheCapacity = 2;
    export var channels = { initial: true };
    export function readChannels() { return channels; }
    export function readCapacity() { return epgCacheCapacity; }
    export function noop() {}
    export function toggleProviderSettingsVisibility() { return "settings"; }
    export function invokeProvider(value) { return getChannelsArray(value); }
    export function lexical(getChannelsArray) { return getChannelsArray; }
    export function nested() {
        function getChannelEpg(value) { return "local:" + value; }
        return [getChannelEpg.name, getChannelEpg(4)];
    }
    export function captured(getChanelsArray) { return getChannelsArray; }
    export function objectProperty(window) { return window.getChannelsArray; }
    export var publicObject = { getChannelsArray: getChannelsArray };
    export var literalName = "getChannelsArray";
`)
);
write(
    "consumer.js",
    compile(`
    import { getChannelsArray as readChannels } from "./provider";
    export function imported(getChanelsArray) { return readChannels("import"); }
    export var originalCallback = readChannels;
`)
);
const linked = assembleClassic(root, [manifest, "provider.js", "consumer.js"]);
function context() {
    const result = vm.createContext({});
    result.window = result;
    return result;
}
async function run() {
    const optimized = await optimizeClassic(linked);
    for (const code of [linked, optimized.code]) {
        acorn.parse(code, { ecmaVersion: 5 });
        const c = context();
        vm.runInContext(code, c);
        assert.equal(c.getChannelsArray, c.getChanelsArray);
        assert.equal(c.getChannelEpg, c.getEPGchanel);
        assert.equal(c.getChannelsArray.name, "getChanelsArray");
        assert.equal(c.getChannelsArray.length, 1);
        assert.equal(c.invokeProvider("a"), "default:a");
        assert.equal(c.originalCallback, c.getChanelsArray);
        assert.equal(c.publicObject.getChannelsArray, c.getChanelsArray);
        assert.equal(c.literalName, "getChannelsArray");
        assert.equal(c.lexical("own value"), "own value");
        assert.deepEqual(Array.from(c.nested()), ["getChannelEpg", "local:4"]);
        assert.equal(c.captured("shadow"), c.getChanelsArray);
        assert.equal(
            c.objectProperty({ getChannelsArray: "own object" }),
            "own object"
        );
        assert.equal(c.imported("shadow"), "default:import");
        // Browser global var/function properties are nonconfigurable. A later
        // provider script may still replace their writable values by declaration.
        for (const name of ["getChanelsArray", "getEPGchanel", "epgCash"]) {
            Object.defineProperty(c, name, {
                configurable: false,
                writable: true,
            });
        }
        vm.runInContext(
            "function getChanelsArray(value) { return 'plugin:' + value; }",
            c
        );
        assert.equal(c.getChannelsArray, c.getChanelsArray);
        assert.equal(c.invokeProvider("b"), "plugin:b");
        assert.equal(c.imported("shadow"), "plugin:import");
        assert.notEqual(
            c.originalCallback,
            c.getChannelsArray,
            "Captured callbacks must not become wrappers"
        );
        const replacement = function replacement(value) {
            return "new:" + value;
        };
        c.getChannelsArray = replacement;
        assert.equal(c.getChanelsArray, replacement);
        assert.equal(c.invokeProvider("c"), "new:c");
        const previous = function previous(value) {
            return "old:" + value;
        };
        c.getChanelsArray = previous;
        assert.equal(c.getChannelsArray, previous);
        assert.equal(c.invokeProvider("d"), "old:d");
        c.epgCacheCapacity = 7;
        assert.equal(c.epgCash, 7);
        assert.equal(c.readCapacity(), 7);
        c.epgCash = 9;
        assert.equal(c.epgCacheCapacity, 9);
        assert.equal(c.readCapacity(), 9);
        assert.equal(c.channels, c.chanels);
        c.chanels = { fromLegacyProvider: true };
        assert.equal(c.readChannels(), c.channels);
        c.channels = { fromCanonicalClient: true };
        assert.equal(c.readChannels(), c.chanels);
        const actions = [c.toggleProviderSettingsVisibility, c.noop];
        assert.equal(actions.indexOf(c.noProvParam), 0);
        assert.equal(actions.indexOf(c.nofun), 1);
        assert.equal(c.popupActionId(actions[0]), "noProvParam");
        assert.equal(c.popupActionId(actions[1]), "nofun");
        const hidden = ["noProvParam"];
        assert.equal(hidden.includes(c.popupActionId(actions[0])), true);
        assert.equal(hidden.includes(c.popupActionId(actions[1])), false);
        // ES5 engines need not provide Function.name; known action IDs use identity.
        Object.defineProperty(c.noop, "name", { value: "" });
        assert.equal(c.popupActionId(c.noop), "nofun");
        const pluginAction = function customProviderAction() {};
        assert.equal(c.popupActionId(pluginAction), "customProviderAction");
        assert.equal(c.popupActionId(null), "");
    }
    const sourceContext = context();
    // Source-module function names are English before classic ABI lowering.
    vm.runInContext(
        compile(manifestSource).replace(/^export /gm, ""),
        sourceContext
    );
    const englishAction = function toggleProviderSettingsVisibility() {};
    sourceContext.noProvParam = englishAction;
    assert.equal(sourceContext.popupActionId(englishAction), "noProvParam");
    const oldSettings = {
        custom: 17,
        grapI: 1,
        hideMenus: ["noProvParam"],
        psProvs: 1,
        res10Resume: 1,
        showPicon: 2,
    };
    const oldCopy = JSON.stringify(oldSettings);
    const canonical = sourceContext.readLegacySettingsFields(oldSettings);
    assert.equal(canonical.channelLogoMode, 2);
    assert.equal(canonical.useGraphicalIndicators, 1);
    assert.equal(canonical.resumeWithTenSecondRewind, 1);
    assert.equal(canonical.requirePinForProviderSelection, 1);
    assert.equal(canonical.showPicon, undefined);
    assert.equal(JSON.stringify(oldSettings), oldCopy);
    assert.deepEqual(
        JSON.parse(
            JSON.stringify(sourceContext.writeLegacySettingsFields(canonical))
        ),
        oldSettings
    );
    assert.equal(
        sourceContext.readLegacySettingsFields({
            channelLogoMode: 0,
            showPicon: 2,
        }).channelLogoMode,
        0
    );
    const special = JSON.parse('{"__proto__":{"polluted":true},"showPicon":2}');
    const copied = sourceContext.readLegacySettingsFields(special);
    assert.equal(copied.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.hasOwn(copied, "__proto__"), true);
    write(
        "collision.js",
        "function getChannelsArray() {} function getChanelsArray() {}"
    );
    assert.throws(
        () => assembleClassic(root, [manifest, "collision.js"]),
        /declarations collide/
    );
    write(
        "capture-write.js",
        "var epgCacheCapacity=1; function bad(epgCash) { epgCacheCapacity=3; }"
    );
    assert.throws(
        () => assembleClassic(root, [manifest, "capture-write.js"]),
        /capture a local binding/
    );
    write(
        "shorthand.js",
        "function getChannelsArray(){} var record={getChannelsArray};"
    );
    const shorthand = assembleClassic(root, [manifest, "shorthand.js"]);
    acorn.parse(shorthand, { ecmaVersion: 5 });
    const s = context();
    vm.runInContext(shorthand, s);
    assert.equal(s.record.getChannelsArray, s.getChanelsArray);
    const oldNames = new Set(
        Array.from(
            sourceContext.legacyPlayerBindings,
            (pair) => pair[1]
        ).concat(
            Array.from(sourceContext.legacySettingsFields, (pair) => pair[1])
        )
    );
    const stale = [];
    function auditSource(directory) {
        for (const entry of fs.readdirSync(directory, {
            withFileTypes: true,
        })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) auditSource(filename);
            else if (
                filename.endsWith(".ts") &&
                filename !==
                    path.join(repository, "src/compatibility/legacy-names.ts")
            ) {
                const source = ts.createSourceFile(
                    filename,
                    fs.readFileSync(filename, "utf8"),
                    ts.ScriptTarget.Latest,
                    true
                );
                function visit(node) {
                    if (ts.isIdentifier(node) && oldNames.has(node.text))
                        stale.push(
                            path.relative(repository, filename) +
                                ": " +
                                node.text
                        );
                    ts.forEachChild(node, visit);
                }
                visit(source);
            }
        }
    }
    auditSource(path.join(repository, "src"));
    assert.deepEqual(
        stale,
        [],
        "Legacy identifiers belong only at the explicit compatibility boundary; stored strings and DOM IDs remain allowed"
    );
    console.log(
        "PASS English naming: source/classic identities, live provider declarations and assignments, lexical scope, stable action IDs, legacy settings and ES5 optimizer"
    );
}
run()
    .finally(() => fs.rmSync(root, { force: true, recursive: true }))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
