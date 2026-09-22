const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");
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

function sourceDefinitions(file, names) {
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(repository, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const wanted = new Set(names);
    const result = [];
    for (const statement of source.statements) {
        const declarations = ts.isVariableStatement(statement)
            ? statement.declarationList.declarations
            : [statement];
        if (
            declarations.some(
                (declaration) =>
                    declaration.name && wanted.has(declaration.name.text)
            )
        ) {
            result.push(statement.getText(source));
            for (const declaration of declarations) {
                if (declaration.name) wanted.delete(declaration.name.text);
            }
        }
    }
    assert.deepEqual(
        Array.from(wanted),
        [],
        "Extract actual renamed implementations: " + file
    );
    return result.join("\n");
}

async function testRenamedHelpers() {
    const pairs = [
        ["sendClientFeedback", "client_feedb"],
        ["queueFeedbackPost", "PostFeedback"],
        ["sendFeedback", "FeedbPOST"],
        ["hideInfoBarWhenReady", "infoBarHideT"],
        ["scheduleListDetailUpdate", "detailListActionWithTimeOut"],
        ["findOptionIndex", "optIndexOf"],
        ["removeOption", "delOption"],
        ["prependMenuButtonHint", "addBtn2menu"],
    ];
    write(
        "renamed-helpers.js",
        compile(
            "var optionsArr=[], listArray=[], infoTimeout=null, detailTimer=null, _fbBuffer=[], _fbTimer=null;\n" +
                sourceDefinitions("src/utils/helpers.ts", [
                    "sendClientFeedback",
                    "queueFeedbackPost",
                    "sendFeedback",
                ]) +
                "\n" +
                sourceDefinitions("src/ui/index.ts", [
                    "hideInfoBarWhenReady",
                    "scheduleListDetailUpdate",
                ]) +
                "\n" +
                sourceDefinitions("src/index.ts", [
                    "indexOfAction",
                    "findOptionIndex",
                    "removeOption",
                    "prependMenuButtonHint",
                ])
        )
    );
    const source = assembleClassic(root, [manifest, "renamed-helpers.js"]);
    const optimized = await optimizeClassic(source);
    for (const code of [source, optimized.code]) {
        acorn.parse(code, { ecmaVersion: 5 });
        const timers = [];
        const requests = [];
        let buffering = true;
        let hidden = 0;
        let details = 0;
        const c = context();
        c.host = "https://player.example";
        c.setTimeout = (callback, delay) => {
            timers.push({ active: true, callback, delay });
            return timers.length;
        };
        c.clearTimeout = (id) => {
            if (timers[id - 1]) timers[id - 1].active = false;
        };
        c.$ = (selector) => ({
            is: () => selector === "#buffering" && buffering,
        });
        c.$.ajax = (request) => requests.push(request);
        c.stbIsPlaying = () => true;
        c.infoBarHide = () => hidden++;
        c.listDetailElement = { innerHTML: "old details" };
        c.detailListActionFn = () => details++;
        vm.runInContext(code, c);
        for (const [canonical, legacy] of pairs) {
            assert.equal(typeof c[canonical], "function");
            assert.equal(
                c[canonical],
                c[legacy],
                canonical + " retains its classic identity"
            );
        }
        c.sendClientFeedback("first");
        c.FeedbPOST("second");
        c.queueFeedbackPost({ message: "third" }, "/custom-report");
        assert.equal(timers.length, 1);
        assert.equal(timers[0].delay, 5000);
        timers[0].callback();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, "https://player.example/api/feedback");
        assert.deepEqual(
            JSON.parse(requests[0].data).map((entry) => [
                entry.msg,
                entry.path,
            ]),
            [
                ["first", "/report_feedb"],
                ["second", "/report_feedb"],
                [{ message: "third" }, "/custom-report"],
            ]
        );
        c.hideInfoBarWhenReady();
        assert.equal(hidden, 0);
        assert.equal(timers[1].callback, c.infoBarHideT);
        assert.equal(timers[1].delay, 5000);
        buffering = false;
        timers[1].callback();
        assert.equal(hidden, 1);
        c.scheduleListDetailUpdate();
        c.scheduleListDetailUpdate();
        assert.equal(c.listDetailElement.innerHTML, "");
        assert.equal(timers[2].active, false);
        assert.equal(timers[3].delay, 200);
        timers[3].callback();
        assert.equal(details, 1);
        const first = () => {};
        const second = () => {};
        c.optionsArr.push({ action: first }, { action: second });
        c.listArray.push("first", "second");
        assert.equal(c.findOptionIndex(second), 1);
        c.prependMenuButtonHint(c.optionsArr, second, "9");
        assert.equal(c.listArray[0], "first");
        assert.equal(c.listArray[1], '<div class="btn">9</div> second');
        c.delOption(first);
        assert.equal(c.findOptionIndex(first), -1);
        assert.equal(c.findOptionIndex(second), 0);
        for (const [canonical, legacy] of pairs) {
            const original = c[legacy];
            const replacement = function providerReplacement() {};
            c[canonical] = replacement;
            assert.equal(c[legacy], replacement);
            c[legacy] = original;
            assert.equal(c[canonical], original);
        }
    }
}

function testProviderLocalNames() {
    let settingsLists = 0;
    let archiveTemplates = 0;
    function walk(directory) {
        for (const entry of fs.readdirSync(directory, {
            withFileTypes: true,
        })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(file);
                continue;
            }
            if (!file.endsWith(".js")) continue;
            const text = fs.readFileSync(file, "utf8");
            const source = ts.createSourceFile(
                file,
                text,
                ts.ScriptTarget.Latest,
                true
            );
            function visit(node) {
                if (ts.isFunctionDeclaration(node) && node.name) {
                    assert(
                        !["bl", "insPar"].includes(node.name.text),
                        "Provider-local helpers use descriptive names: " + file
                    );
                    if (node.name.text === "rebuildSettingsList") {
                        settingsLists++;
                        const c = vm.createContext({
                            _: (value) => value,
                            listArray: [],
                        });
                        const render = vm.runInContext(
                            "(function(){var srv='',usr='viewer',pwd='secret',m3u='https://playlist.example/list.m3u';" +
                                node.getText(source) +
                                "; return function(server){srv=server;rebuildSettingsList();return listArray;};})()",
                            c
                        );
                        assert.equal(
                            render("https://one.example")[0],
                            "Server: https://one.example"
                        );
                        const rows = render("https://two.example");
                        assert.equal(rows[0], "Server: https://two.example");
                        assert.equal(rows[2], "Password: ********");
                        assert.equal(
                            c.rebuildSettingsList,
                            undefined,
                            "Settings helper remains private to its provider editor"
                        );
                    } else if (node.name.text === "expandArchiveTemplate") {
                        archiveTemplates++;
                        const c = vm.createContext({ time: 100, time_to: 160 });
                        vm.runInContext(node.getText(source), c);
                        assert.equal(
                            c.expandArchiveTemplate(
                                "s=${start}&e=${end}&d=${duration}"
                            ),
                            "s=100&e=160&d=60"
                        );
                    }
                }
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    }
    walk(path.join(repository, "prov"));
    assert.equal(settingsLists, 34);
    assert.equal(archiveTemplates, 0, "Archive templates belong to the shared core");
}

function testFooterNaming() {
    const dom = new JSDOM(
        fs.readFileSync(path.join(repository, "index.html"), "utf8"),
        {
            runScripts: "outside-only",
        }
    );
    const style = dom.window.document.createElement("style");
    style.textContent = fs.readFileSync(
        path.join(repository, "stbPlayer/1280.css"),
        "utf8"
    );
    dom.window.document.head.appendChild(style);
    Object.assign(dom.window, {
        channels: { 1: { rec: 1 } },
        epg_ch_id: 1,
        epgListMode: 0,
        keys: { BLUE: 2, GREEN: 3, N2: 50, RED: 1, YELLOW: 4 },
        renderButtonHint: () => "",
    });
    try {
        vm.runInContext(
            compile(
                sourceDefinitions("src/channels/index.ts", ["renderEpgFooter"])
            ).replace(/^export /gm, ""),
            dom.getInternalVMContext()
        );
        dom.window.renderEpgFooter();
        const footer = dom.window.document.getElementById("listPodval");
        assert(footer, "The provider-visible footer DOM ID stays compatible");
        const archive = footer.querySelector(".epg-footer-archive");
        assert(archive, "The actual EPG renderer uses the English CSS class");
        assert.equal(archive.textContent, "Archive: ENTER on past programs");
        const computed = dom.window.getComputedStyle(archive);
        assert.equal(computed.marginLeft, "12px");
        assert.equal(computed.fontSize, "12px");
        assert.equal(computed.color, "rgb(0, 255, 0)");
    } finally {
        dom.window.close();
    }
}

async function run() {
    await testRenamedHelpers();
    testProviderLocalNames();
    testFooterNaming();
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
    for (const name of [
        "nofunLock",
        "__ottPodvalClickBound",
        "detFlag",
        "listFlag",
    ])
        oldNames.add(name);
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
        "PASS English naming: actual helper behavior and live classic aliases, provider-local closures, footer CSS/DOM contract, stable action IDs/settings and ES5 optimizer"
    );
}
run()
    .finally(() => fs.rmSync(root, { force: true, recursive: true }))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
