const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/ui/subtitle-appearance.ts", "utf8");
const code = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
require("acorn").parse(code, { ecmaVersion: 5 });
const host = {
    getComputedStyle: () => ({ objectFit: "contain" }),
    settings: {},
    window: null,
};
host.window = host;
vm.runInNewContext(code, host);
const api = host.__ottSubtitleAppearance;
const media = (width, height, vw = 1920, vh = 1080) => ({
    getBoundingClientRect: () => ({ height, width }),
    videoHeight: vh,
    videoWidth: vw,
});
assert.equal(
    api.declarations(media(1280, 720), {}),
    "",
    "default leaves source appearance alone"
);
const settings = {
    subtitleBackground: 3,
    subtitleFontFamily: 2,
    subtitleFontSize: 3,
    subtitleOutline: 3,
    subtitleTextColor: 2,
};
const css = api.declarations(media(1280, 720), settings);
assert.match(css, /font-family:Georgia,serif/);
assert.match(css, /font-size:36px/);
assert.match(css, /color:#ffff00/);
assert.match(css, /text-shadow:.*2px/);
assert.match(css, /background-color:rgba\(0,0,0,0.5\)/);
assert.doesNotMatch(
    css,
    /(?:^|;)(?:position|top|bottom|left|right|line|align|transform|padding|width|height):/
);
assert.match(
    api.declarations(media(320, 180), settings),
    /font-size:9px/,
    "PiP scales to its own rendered video height"
);
assert.match(
    api.declarations(media(1280, 720, 1920, 800), settings),
    /font-size:26.67px/,
    "letterbox content, not viewport, determines font size"
);
assert.equal(
    api.declarations(media(0, 0), { subtitleFontSize: 2 }),
    "",
    "hidden video never receives a synthetic minimum font size"
);
for (const value of [-1, 99, NaN, Infinity, 1.5, "1", "url(https://invalid)"])
    assert.equal(
        api.declarations(media(1280, 720), {
            subtitleBackground: value,
            subtitleFontFamily: value,
            subtitleFontSize: value,
            subtitleOutline: value,
            subtitleTextColor: value,
        }),
        "",
        "invalid persisted settings cannot inject CSS"
    );
const elements = [],
    video = media(1280, 720);
video.setAttribute = () => {};
video.closest = () => null;
host.document = {
    createElement: () => ({}),
    head: { appendChild: (node) => elements.push(node) },
    querySelectorAll: () => [video],
};
host.settings = settings;
api.apply();
assert.equal(elements.length, 1);
assert.match(
    elements[0].textContent,
    /video\[data-ott-subtitle-style="0"\]::cue/
);
host.settings = {};
api.apply();
assert.equal(
    elements[0].textContent,
    "",
    "reset removes all prior style overrides"
);
console.log(
    "PASS subtitle appearance defaults, validation, per-video scale and reset"
);

const entry = fs.readFileSync("src/index.ts", "utf8");
const ast = ts.createSourceFile(
    "entry.ts",
    entry,
    ts.ScriptTarget.Latest,
    true
);
const loaderSource = ast.statements
    .filter(
        (node) =>
            (ts.isFunctionDeclaration(node) &&
                [
                    "loadSubtitleAppearance",
                    "openSubtitleAppearance",
                    "notifySubtitleAppearanceReady",
                ].includes(node.name?.text)) ||
            (ts.isVariableStatement(node) &&
                node.declarationList.declarations.some((item) =>
                    [
                        "subtitleAppearanceLoading",
                        "subtitleAppearanceGeneration",
                        "subtitleAppearanceOpen",
                        "subtitleAppearanceReady",
                    ].includes(item.name.getText(ast))
                )) ||
            (ts.isExpressionStatement(node) &&
                ts.isBinaryExpression(node.expression) &&
                node.expression.left
                    .getText(ast)
                    .match(/\.(applySubtitleAppearance|__ottAppearanceHost)/))
    )
    .map((node) => node.getText(ast))
    .join("\n");
function loaderFixture() {
    const calls = [],
        timers = new Map(),
        notices = [],
        f = { active: true, applied: 0, opened: 0, settings: {} };
    let nextTimer = 0;
    Object.assign(f, {
        _: (text) => text,
        __ottActiveProviderDriver: {},
        __ottClassicScreenPort: {
            listOwner: () => ({ active: () => f.active }),
        },
        clearTimeout: (id) => timers.delete(id),
        createSettingsPage() {},
        document: {
            createElement: () => ({}),
            head: {
                appendChild(node) {
                    node.parentNode = {
                        removeChild() {
                            node.parentNode = null;
                        },
                    };
                    calls.push(node);
                },
            },
        },
        hostUrl: "https://player.example",
        languageNames: {},
        PLAYER_VERSION: "test-version",
        p_pref: "source-one",
        setListArrays() {},
        setTimeout: (fn) => {
            timers.set(++nextTimer, fn);
            return nextTimer;
        },
        showShift: (text) => notices.push(text),
    });
    f.window = f;
    vm.createContext(f);
    vm.runInContext(
        ts.transpileModule(loaderSource, {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        f
    );
    f.ready = () => {
        f.__ottSubtitleAppearance = {
            apply: () => f.applied++,
            open: () => f.opened++,
        };
        calls.at(-1).onload();
    };
    return { calls, f, notices, timers };
}
{
    const { f, calls } = loaderFixture();
    f.applySubtitleAppearance();
    assert.equal(
        calls.length,
        0,
        "default startup loads no appearance or editor code"
    );
    f.settings.subtitleFontSize = 2;
    f.applySubtitleAppearance();
    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].src,
        "https://player.example/dist/subtitle-appearance.js?test-version"
    );
    f.ready();
    assert.equal(f.applied, 1);
}
for (const revoke of [
    (f) => {
        f.active = false;
    },
    (f) => {
        f.p_pref = "source-two";
    },
]) {
    const { f, calls } = loaderFixture();
    f.openSubtitleAppearance("open");
    revoke(f);
    f.ready();
    assert.equal(
        f.opened,
        0,
        "late load cannot reopen after Back or source change"
    );
    assert.equal(calls.length, 1);
}

{
    const { f, calls, timers, notices } = loaderFixture();
    f.openSubtitleAppearance("open");
    const late = calls[0].onload;
    [...timers.values()][0]();
    assert.deepEqual(notices, ["Failed to load!"]);
    assert.equal(f.opened, 0);
    assert.equal(calls[0].parentNode, null);
    f.openSubtitleAppearance("open");
    assert.equal(calls.length, 2, "timeout permits an immediate retry");
    late();
    assert.equal(
        f.opened,
        0,
        "late completion from expired generation is ignored"
    );
    f.ready();
    assert.equal(f.opened, 1);
    assert.equal(timers.size, 0);
}
{
    const { f, calls, notices } = loaderFixture();
    f.openSubtitleAppearance("open");
    calls[0].onerror();
    assert.deepEqual(notices, ["Failed to load!"]);
    f.openSubtitleAppearance("open");
    assert.equal(calls.length, 2, "failed asset permits retry without reload");
}
console.log(
    "PASS subtitle lazy loader: no default request, versioned asset, stale UI cancellation"
);
{
    const watching = new Set();
    let current = video;
    const observedHost = {
        addEventListener() {},
        document: {
            ...host.document,
            addEventListener() {},
            querySelectorAll: () => [current],
        },
        getComputedStyle: host.getComputedStyle,
        ResizeObserver: class {
            observe(target) {
                watching.add(target);
            }
            unobserve(target) {
                watching.delete(target);
            }
        },
        settings,
        window: null,
    };
    observedHost.window = observedHost;
    vm.runInNewContext(
        ts.transpileModule(
            fs.readFileSync("src/ui/subtitle-appearance.ts", "utf8"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.None,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText,
        observedHost
    );
    observedHost.__ottSubtitleAppearance.apply();
    assert(watching.has(current));
    const removed = current;
    current = { ...video };
    observedHost.__ottSubtitleAppearance.apply();
    assert(
        !watching.has(removed),
        "replaced engine video is released by ResizeObserver"
    );
    assert(watching.has(current));
    assert.equal(watching.size, 1);
}
console.log("PASS subtitle observer releases a replaced engine video");

{
    const { f, calls } = loaderFixture();
    const results = [];
    f.__ottAppearanceHost.ready((ready) => results.push(ready));
    const cancel = f.__ottAppearanceHost.ready(() =>
        assert.fail("cancelled readiness callback")
    );
    f.openSubtitleAppearance("open");
    cancel();
    assert.equal(
        calls.length,
        1,
        "UI and remote readiness share one asset load"
    );
    f.ready();
    assert.deepEqual(results, [true]);
    assert.equal(
        f.opened,
        1,
        "readiness callback preserves the pending UI open"
    );
    f.__ottAppearanceHost.ready((ready) => results.push(ready));
    assert.deepEqual(results, [true, true]);
    assert.equal(calls.length, 1);
}
{
    const { f, calls } = loaderFixture();
    const results = [];
    f.__ottAppearanceHost.ready((ready) => results.push(ready));
    calls[0].onerror();
    assert.deepEqual(results, [false]);
    assert.equal(f.opened, 0);
}
console.log(
    "PASS shared subtitle readiness: single load, cancelled observers, preserved UI open, explicit failure"
);
