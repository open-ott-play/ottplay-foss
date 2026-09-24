// Samsung Simulator 10.0.6 replaces the app iframe's onkeydown on focus/blur.
// Use real DOM event delivery to check that remote input survives those writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
function read(file) {
    return fs.readFileSync(path.join(root, file), "utf8");
}
function declarations(code, names, label) {
    const ast = acorn.parse(code, { ecmaVersion: 5 });
    return names
        .map((name) => {
            const matches = ast.body.filter(
                (node) =>
                    node.type === "FunctionDeclaration" && node.id.name === name
            );
            assert.equal(matches.length, 1, label + " exposes " + name);
            return code.slice(matches[0].start, matches[0].end);
        })
        .join("\n");
}
function compile(file) {
    return ts
        .transpileModule(read(file), {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.split("\n")
        .filter(
            (line) =>
                !line.trim().startsWith("import ") && !/^export\s*\{/.test(line)
        )
        .map((line) => line.replace(/^export /, ""))
        .join("\n");
}
const adapter = read("stb/samsung/tizen/stb.js");
const typedCore = compile("src/core/index.ts");
const typedHandlers = compile("src/keyhandler/index.ts");
const sourceHandlers =
    declarations(typedCore, ["stbEventToKeyCode"], "source") +
    declarations(typedHandlers, ["keyHandler"], "source");
const cases = [
    { core: typedCore, handlers: sourceHandlers, name: "source" },
    {
        core: read("stb/core.js"),
        handlers: sourceHandlers,
        name: "legacy core",
    },
];
if (process.argv.includes("--bundle")) {
    const bundle = read("dist/stbPlayer.js");
    cases.push({
        core: bundle,
        handlers: declarations(
            bundle,
            ["stbEventToKeyCode", "keyHandler"],
            "classic bundle"
        ),
        name: "classic bundle",
    });
}

for (const testCase of cases) {
    const binding = declarations(
        testCase.core,
        ["stbBindKeyHandler"],
        testCase.name
    );
    const initializer = declarations(testCase.core, ["stbInit"], testCase.name);
    assert.match(
        initializer,
        /\bstbBindKeyHandler\(\)/,
        "Player init installs the tested binding"
    );
    for (const legacy of [false, true]) {
        const dom = new JSDOM("<!doctype html><body></body>", {
            runScripts: "outside-only",
        });
        const w = dom.window;
        require("./helpers/screen-runtime.cjs")(w);
        const addEventListener = w.addEventListener;
        try {
            let selected = 5;
            let oldPropertyCalls = 0;
            Object.assign(w, {
                $: () => ({ is: () => false }),
                changeSelect: (delta) => {
                    selected += delta;
                },
                isEditMode: false,
                isListVisible: true,
                isSelectBox: false,
                listKeyHandlerFn: () => false,
                settings: { volumeStep: 5 },
                stbInit() {},
                version: "test",
            });
            w.console.log = () => {};
            w.eval(testCase.handlers);
            w.eval(adapter);
            w.eval(binding);
            function remoteKey(code) {
                // The SDK uses Event, not KeyboardEvent, and sets only keyCode.
                const event = w.document.createEvent("Events");
                event.initEvent("keydown", true, true);
                event.keyCode = code;
                w.document.body.dispatchEvent(event);
            }
            // Model the SDK's app-iframe focus handlers. A property-only app
            // binding really does lose arrow delivery after either transition.
            w.onfocus = () => {
                w.onkeydown = () => {};
            };
            w.onblur = () => {
                w.onkeydown = null;
            };
            w.onkeydown = w.keyHandler;
            remoteKey(40);
            assert.equal(selected, 6);
            w.dispatchEvent(new w.Event("focus"));
            remoteKey(40);
            assert.equal(selected, 6, "SDK focus reproduces the old failure");
            w.onkeydown = w.keyHandler;
            w.dispatchEvent(new w.Event("blur"));
            remoteKey(38);
            assert.equal(selected, 6, "SDK blur reproduces the old failure");

            if (legacy) w.addEventListener = undefined;
            w.onkeydown = () => {
                oldPropertyCalls++;
            };
            w.stbBindKeyHandler();
            remoteKey(40);
            assert.equal(selected, 7, "Bound Down is delivered once");
            assert.equal(
                oldPropertyCalls,
                0,
                "Init still replaces the previous property binding"
            );
            w.stbBindKeyHandler();
            w.stbBindKeyHandler();
            remoteKey(38);
            assert.equal(selected, 6, "Repeated init must not duplicate Up");

            if (!legacy) {
                w.dispatchEvent(new w.Event("focus"));
                remoteKey(40);
                assert.equal(
                    selected,
                    7,
                    "Arrow survives SDK onfocus overwrite"
                );
                w.dispatchEvent(new w.Event("blur"));
                remoteKey(38);
                assert.equal(selected, 6, "Arrow survives SDK onblur clearing");
            }
            const originalHandler = w.keyHandler;
            let replacementCalls = 0;
            w.keyHandler = function (event) {
                assert.equal(
                    this,
                    w,
                    "Current handler retains window receiver"
                );
                replacementCalls++;
                originalHandler.call(this, event);
            };
            remoteKey(40);
            assert.equal(
                selected,
                7,
                "The listener uses a later handler replacement"
            );
            assert.equal(replacementCalls, 1);
            // Remove an old-style property binding when upgrading/reinitializing.
            w.onkeydown = w.keyHandler;
            w.stbBindKeyHandler();
            remoteKey(38);
            assert.equal(
                selected,
                6,
                "Listener and property must not double-deliver"
            );
            assert.equal(replacementCalls, 2);
            delete w.keyHandler;
            assert.doesNotThrow(() => remoteKey(40));
            assert.equal(
                selected,
                6,
                "An unavailable current handler is ignored"
            );
        } finally {
            w.addEventListener = addEventListener;
            w.close();
        }
    }
}
console.log(
    "Keyboard binding survives host focus changes, repeated init and handler replacement (" +
        cases.map((item) => item.name).join(", ") +
        ")"
);
