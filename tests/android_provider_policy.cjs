const {
    attachSourceAliases,
    sourceNames,
} = require("./helpers/english-source-fixture.cjs");
/* Exercise the shipped distribution transform and production provider entry points. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");
const {
    prepareDistributionModules,
} = require("../scripts/android-distribution.cjs");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
    path.join(root, "src/provider/index.ts"),
    "utf8"
);
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2015,
        removeComments: false,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;

// Compile the actual boot function with comments preserved, exactly as the
// distribution pipeline does before removing Full-only source regions.
const indexSource = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");
const indexAst = ts.createSourceFile(
    "index.ts",
    indexSource,
    ts.ScriptTarget.Latest,
    true
);
const startupNode = indexAst.statements.find(
    (node) =>
        ts.isFunctionDeclaration(node) && node.name?.text === "startPlayer"
);
assert(startupNode, "production startPlayer exists");
const startupCompiled = ts.transpileModule(
    startupNode.getText(indexAst).replace(/^export\s+/, ""),
    {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            removeComments: false,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
const startupProfiles = {};
const pluginInfoNode = indexAst.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "pluginInfo"
);
assert(pluginInfoNode, "production About entry exists");
const pluginInfoCompiled = ts.transpileModule(
    pluginInfoNode.getText(indexAst),
    {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
const coreSource = fs.readFileSync(
    path.join(root, "src/core/index.ts"),
    "utf8"
);
const coreAst = ts.createSourceFile(
    "core.ts",
    coreSource,
    ts.ScriptTarget.Latest,
    true
);
const diagnosticNode = coreAst.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "stbInfo"
);
assert(diagnosticNode, "production stbInfo exists");
const diagnosticCompiled = ts.transpileModule(
    diagnosticNode.getText(coreAst).replace(/^export\s+/, ""),
    {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            removeComments: false,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
const diagnosticProfiles = {};

function distribution(flavor) {
    const folder = fs.mkdtempSync(
        path.join(os.tmpdir(), "ottplay-provider-policy-")
    );
    try {
        const provider = path.join(folder, "build/provider/index.js");
        fs.mkdirSync(path.dirname(provider), { recursive: true });
        fs.writeFileSync(provider, compiled);
        const startup = path.join(folder, "build/index.js");
        fs.writeFileSync(startup, startupCompiled);
        const diagnostic = path.join(folder, "build/core/index.js");
        fs.mkdirSync(path.dirname(diagnostic), { recursive: true });
        fs.writeFileSync(diagnostic, diagnosticCompiled);
        prepareDistributionModules(folder, flavor);
        startupProfiles[flavor] = fs.readFileSync(startup, "utf8");
        diagnosticProfiles[flavor] = fs.readFileSync(diagnostic, "utf8");
        return fs.readFileSync(provider, "utf8");
    } finally {
        fs.rmSync(folder, { force: true, recursive: true });
    }
}
const profiles = { full: distribution("full"), play: distribution("play") };
const names = sourceNames("src/provider/index.ts", [
    "__spreadArray",
    "providerDistribution",
    "isPlayDistribution",
    "isProviderAllowed",
    "arrayProvaiders",
    "provArray",
    "loadProv",
    "firstRun",
    "selectProvaider",
    "edit_dealer",
    "edit_dealer_remote",
    "optionsList",
    "syncFromWindow",
]);
function executable(code) {
    const parsed = ts.createSourceFile(
        "provider.js",
        code,
        ts.ScriptTarget.Latest,
        true
    );
    const selected = [];
    const found = [];
    for (const node of parsed.statements) {
        if (ts.isFunctionDeclaration(node) && names.includes(node.name.text)) {
            selected.push(node.getText(parsed).replace(/^export\s+/, ""));
            found.push(node.name.text);
        } else if (ts.isVariableStatement(node)) {
            for (const variable of node.declarationList.declarations) {
                const name = variable.name.getText(parsed);
                if (names.includes(name)) {
                    selected.push("var " + variable.getText(parsed) + ";");
                    found.push(name);
                }
            }
        }
    }
    assert.deepEqual(found.slice().sort(), names.slice().sort());
    const result = selected.join("\n");
    acorn.parse(result, { ecmaVersion: 5 });
    return result;
}
const code = {
    full: executable(profiles.full),
    play: executable(profiles.play),
};

function fixture(
    flavor = "play",
    initial = {},
    search = "",
    launchVisible = true
) {
    const stored = new Map(Object.entries(initial));
    const scripts = [];
    const requests = [];
    const timers = [];
    const about = [];
    const scriptCallbacks = [];
    const images = [];
    const appendedImages = [];
    const errors = [];
    let pinRequests = 0;
    const w = {
        _: (text) => text,
        __av: "fixture",
        __cv: "fixture",
        __test: "",
        addBtn2menu() {},
        alert() {},
        browserName: () => "browser",
        btnDiv: () => "",
        cancelMediaLoad() {},
        cancelPortChannelIdMigration() {},
        clearTimeout() {},
        closeList() {},
        console: {
            error(...args) {
                errors.push(args);
            },
            log() {},
            warn() {},
        },
        curColor: "white",
        delOption() {},
        document: {
            createTextNode: (text) => text,
            getElementById: () => null,
        },
        enterPinAndSetAccess() {
            pinRequests++;
        },
        epgCash: 0,
        getScriptDOM: (url, callback) => {
            scripts.push(url);
            scriptCallbacks.push(callback);
        },
        host: "https://player.invalid",
        host_ott: "cloud.invalid",
        host_ott_proto: "https://",
        invalidateEpgCache() {},
        keys: { ENTER: 13, GREEN: 402, RED: 401, RETURN: 27, YELLOW: 403 },
        launch_id: "#launch",
        listCaptionElement: {},
        listDetail: {},
        listPodval: {},
        loadChannels() {},
        loadOpt() {},
        loadSettings() {},
        location: { search },
        nofun() {},
        noProvParam() {},
        optIndexOf: () => -1,
        optionsArr: [],
        parentPIN: "*",
        popupActions: [],
        popupArray: [],
        popupDetail: [],
        restoreDemoMute() {},
        savedPopup: {
            popupActions: [() => {}],
            popupArray: ["Menu"],
            popupDetail: [""],
            ver: "fixture",
        },
        selectLang() {},
        setTimeout: (action, delay) => {
            timers.push({ action, delay });
            return timers.length;
        },
        showEditKey() {},
        showPage() {},
        sNoColorKeys: false,
        sNoNumbersKeys: false,
        sPSoptions: 0,
        sPSprovs: 0,
        stbGetItem: (key) => stored.get(key) || null,
        stbIsPlaying: () => false,
        stbSetItem: (key, value) => stored.set(key, String(value)),
        stbStopPip() {},
        strInfo: "",
        strRETURN: "",
        strTools: "",
    };
    w.$ = (selector) => {
        const image =
            selector === "<img>" ? { attrs: {}, css: {}, events: {} } : null;
        if (image) images.push(image);
        const chain = {
            append(item) {
                if (item && item.image)
                    appendedImages.push({
                        image: item.image,
                        target: selector,
                    });
                return chain;
            },
            attr(name, value) {
                if (image) image.attrs[name] = value;
                return chain;
            },
            css(name, value) {
                if (image) image.css[name] = value;
                return chain;
            },
            hide() {
                return chain;
            },
            html() {
                return chain;
            },
            image,
            is: () => launchVisible,
            load: (url) => about.push(url),
            on(name, handler) {
                if (image) image.events[name] = handler;
                return chain;
            },
            show() {
                return chain;
            },
        };
        return chain;
    };
    w.$.ajax = (request) => requests.push(request);
    w.window = w;
    vm.createContext(w);
    require("./helpers/private-runtime.cjs")(w, "src/provider/runtime.ts");
    require("./helpers/private-runtime.cjs")(
        w,
        "src/provider/driver-profiles.ts"
    );
    require("./helpers/private-runtime.cjs")(
        w,
        "src/provider/stalker-driver.ts"
    );
    require("./helpers/private-runtime.cjs")(
        w,
        "src/provider/catalog-drivers.ts"
    );
    for (const module of [
        "catalog-xml",
        "media-catalog",
        "playlist-drivers",
        "edem-driver",
        "m3u-settings",
        "m3u-driver",
    ])
        require("./helpers/private-runtime.cjs")(
            w,
            "src/provider/" + module + ".ts"
        );
    require("./helpers/private-runtime.cjs")(w, "src/provider/drivers.ts");
    vm.runInContext(code[flavor], w);
    attachSourceAliases(w);
    return {
        about,
        appendedImages,
        errors,
        images,
        get pinRequests() {
            return pinRequests;
        },
        requests,
        scriptCallbacks,
        scripts,
        stored,
        timers,
        w,
    };
}
let cases = 0;
function test(name, run) {
    run();
    cases++;
    console.log("PASS Android provider policy: " + name);
}
const permitted = ["m3u", "stalker", "xtream", "demo"];
const fullIds = Array.from(fixture("full").w.arrayProvaiders).filter(Boolean);
const excluded = fullIds.filter((id) => !permitted.includes(id));

test("actual build transform removes every branded provider ID and label", () => {
    const full = fixture("full");
    const play = fixture();
    full.w.selectProvaider();
    play.w.selectProvaider();
    assert.deepEqual(
        Array.from(play.w.arrayProvaiders).filter(Boolean),
        permitted
    );
    assert.equal(play.w.provArray.length, 5);
    // Parse all literal strings in the transformed module: hidden registry names
    // or unreachable activation implementations must not survive the Play build.
    const parsed = ts.createSourceFile(
        "play.js",
        profiles.play,
        ts.ScriptTarget.Latest,
        true
    );
    const literals = [];
    function visit(node) {
        if (ts.isStringLiteral(node)) literals.push(node.text);
        ts.forEachChild(node, visit);
    }
    visit(parsed);
    // "top" is also an unrelated CSS property used by the shared menu.
    for (const id of excluded)
        if (id !== "top") assert(!literals.includes(id), "unshipped ID " + id);
    for (const name of full.w.provArray.slice(5))
        assert(!literals.includes(name), "unshipped display label " + name);
    assert(
        !literals.some(
            (value) =>
                value.includes("/d/") ||
                value.includes("/swop/") ||
                value.includes("Enter Provider Code")
        )
    );
    assert(profiles.full.includes('"OTTCLUB"'));
    assert(profiles.full.includes('"/d/"'));
});

test("Play first-run offers explicit Demo, manual generic setup and privacy", () => {
    const f = fixture();
    f.w.firstRun();
    assert.deepEqual(
        Array.from(f.w.listArray, (item) => item.name),
        ["Try demo", "Manual setup", "Privacy policy"]
    );
    f.w.listArray[0].action();
    assert.equal(f.stored.get("ottplayprov"), "demo");
    assert.deepEqual(f.scripts, []);
    assert.equal(f.w.__ottActiveProviderDriver.id, "demo");
    f.w.firstRun();
    f.w.listArray[1].action();
    assert.equal(f.w.listCaptionElement.innerHTML, "Choose provider");
    assert.deepEqual(f.requests, []);
});

test("first-run Privacy action returns to its actual caller without touching provider storage", () => {
    const f = fixture("play", {
        m3uCredentials: "unchanged",
        ottplayprov: "m3u",
    });
    let returnTo;
    f.w.privacyPolicy = (callback) => {
        returnTo = callback;
    };
    f.w.firstRun();
    f.w.selIndex = 2;
    f.w.listKeyHandlerFn(f.w.keys.ENTER);
    assert.equal(returnTo, f.w.firstRun);
    f.w.listCaptionElement.innerHTML = "Privacy policy";
    returnTo();
    assert.equal(f.w.listCaptionElement.innerHTML, "First Run Setup");
    assert.equal(f.stored.get("ottplayprov"), "m3u");
    assert.equal(f.stored.get("m3uCredentials"), "unchanged");
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.scripts, []);
});

test("Full retains activation and both settings import actions", () => {
    const f = fixture("full");
    f.w.firstRun();
    assert.deepEqual(
        Array.from(f.w.listArray, (item) => item.name),
        [
            "Try demo",
            "Enter Provider Code",
            "Enter Provider Code on PC or Phone",
            "Load settings",
            "Load settings from storage",
            "",
            "Manual setup",
        ]
    );
});

for (const id of permitted) {
    test("Play loads permitted saved provider " + id, () => {
        const f = fixture("play", { ottplayprov: id });
        f.w.loadProv();
        assert.deepEqual(f.scripts, []);
        assert.equal(f.w.__ottActiveProviderDriver.id, id);
    });
}

test("completed provider loads omit unavailable logos but preserve Full logo and visibility rules", () => {
    for (const flavor of ["full", "play"]) {
        const ids = flavor === "full" ? [...permitted, "edem"] : permitted;
        for (const id of ids) {
            for (const launchVisible of [true, false]) {
                for (const flags of [0, 1, 2, 3]) {
                    const f = fixture(
                        flavor,
                        {
                            noProvParam: String((flags >> 1) & 1),
                            noSelProv: String(flags & 1),
                            ottplayprov: id,
                        },
                        "",
                        launchVisible
                    );
                    let channelLoads = 0;
                    Object.assign(f.w, {
                        duneAddSettings() {},
                        epgCash: false,
                        getEPGchanel() {},
                        loadChannels() {
                            channelLoads++;
                        },
                        noProvParam() {},
                        optIndexOf: () => -1,
                    });
                    f.w.loadProv();
                    assert.equal(f.scriptCallbacks.length, 0);
                    assert.equal(f.w.__ottActiveProviderDriver.id, id);
                    assert.deepEqual(
                        f.errors,
                        [],
                        "provider callback completed"
                    );
                    assert.equal(channelLoads, 1);
                    const expected =
                        flavor === "full" && id !== "demo" && flags !== 3;
                    assert.equal(
                        f.images.length,
                        Number(expected),
                        flavor +
                            "/" +
                            id +
                            ": do not even create an unavailable image"
                    );
                    assert.equal(f.appendedImages.length, Number(expected));
                    if (!expected) continue;
                    const image = f.images[0];
                    assert.equal(
                        image.attrs.src,
                        "https://player.invalid/prov/" +
                            id +
                            "/logo.png?fixture"
                    );
                    assert.equal(
                        f.appendedImages[0].target,
                        launchVisible ? "#launch" : "#dialogbox"
                    );
                    assert.equal(
                        image.css.top,
                        launchVisible ? "100px" : "6px"
                    );
                    assert.equal(
                        image.css.right,
                        launchVisible ? "100px" : "6px"
                    );
                    assert.equal(
                        image.attrs[launchVisible ? "width" : "height"],
                        launchVisible ? "25%" : "40"
                    );
                    const failedImage = { width: 25 };
                    image.events.error.call(failedImage);
                    assert.equal(
                        failedImage.width,
                        0,
                        "Full retains failed-logo collapse"
                    );
                }
            }
        }
    }
});

test("every stale Full selection is blocked without deleting its saved credentials", () => {
    for (const id of excluded) {
        const f = fixture("play", {
            ottplayprov: id,
            secretProfile: "unchanged",
        });
        f.w._pendingProvId = id;
        f.w.loadProv();
        assert.deepEqual(f.scripts, [], id);
        assert.equal(f.w._pendingProvId, "", id);
        assert.equal(f.w.listCaptionElement.innerHTML, "First Run Setup", id);
        assert.equal(f.stored.get("ottplayprov"), id);
        assert.equal(f.stored.get("secretProfile"), "unchanged");
    }
});

test("URL aliases, starred activation pins and injected registry entries cannot load excluded code", () => {
    for (const id of excluded) {
        for (const query of [
            "?" + id,
            "?" + id + "*",
            "?" + id + "!&other=value",
        ]) {
            const f = fixture("play", {}, query);
            f.w.arrayProvaiders.push(id);
            f.w.loadProv();
            assert.deepEqual(f.scripts, [], query);
            assert.equal(f.stored.has("ottplayprov"), false, query);
            assert.equal(f.stored.has("noSelProv"), false, query);
        }
    }
});

test("excluded URL cannot override a saved permitted provider", () => {
    const f = fixture("play", { ottplayprov: "m3u" }, "?edem");
    f.w.loadProv();
    assert.deepEqual(f.scripts, []);
    assert.equal(f.w.__ottActiveProviderDriver.id, "m3u");
});

test("settings restored after startup still pass policy at the script boundary", () => {
    const f = fixture();
    const imported = JSON.parse(
        '{"ottplayprov":"edem","ottplayprovs":"[\\"edem\\",\\"stalker\\"]","noSelProv":"1"}'
    );
    for (const [key, value] of Object.entries(imported))
        f.stored.set(key, value);
    f.w.arrayProvaiders.push("edem");
    f.w.loadProv();
    assert.deepEqual(f.scripts, []);
    f.w.selectProvaider();
    assert.deepEqual(Array.from(f.w.arrayProvaiders), [
        "m3u",
        "stalker",
        "xtream",
        "",
        "demo",
    ]);
    f.w.listKeyHandlerFn(f.w.keys.GREEN);
    assert.deepEqual(f.scripts, []);
    assert.equal(f.w.__ottActiveProviderDriver.id, "stalker");
    assert.equal(f.stored.get("noSelProv"), "1");
});

test("late forged selector entry cannot persist, load or fetch excluded about page", () => {
    const f = fixture();
    f.w.selectProvaider();
    f.w.arrayProvaiders.push("edem");
    f.w.selIndex = f.w.arrayProvaiders.length - 1;
    f.w.listKeyHandlerFn(f.w.keys.ENTER);
    f.w.detailListAction();
    assert.deepEqual(f.scripts, []);
    assert.deepEqual(f.about, []);
    assert.equal(f.stored.has("ottplayprov"), false);
});

test("explicit exit from Demo accepts permitted choice once, then honors original permitted URL pin", () => {
    const f = fixture("play", { noSelProv: "1", ottplayprov: "demo" }, "?m3u");
    f.w.ottplayDemoActive = true;
    f.w.selectProvaider();
    f.w.listKeyHandlerFn(f.w.keys.GREEN);
    assert.deepEqual(f.scripts, []);
    assert.equal(f.w.__ottActiveProviderDriver.id, "stalker");
    f.w.loadProv();
    assert.deepEqual(f.scripts, []);
    assert.equal(f.w.__ottActiveProviderDriver.id, "m3u");
    assert.equal(f.stored.get("noSelProv"), "1");
});

test("Demo one-shot explicit provider cannot bypass the allowlist", () => {
    const f = fixture("play", { ottplayprov: "demo" });
    f.w.ottplayDemoActive = true;
    f.w.arrayProvaiders.push("edem");
    f.w.loadProv("edem");
    assert.deepEqual(f.scripts, []);
});

for (const method of ["edit_dealer", "edit_dealer_remote"]) {
    test(
        "direct " + method + " cannot execute activation or networking in Play",
        () => {
            const f = fixture();
            f.w[method]();
            assert.equal(f.w.listCaptionElement.innerHTML, "Choose provider");
            assert.deepEqual(f.requests, []);
            assert.deepEqual(f.scripts, []);
            assert.deepEqual(f.timers, []);
            assert.equal(typeof f.w.setEdit, "undefined");
        }
    );
    test(
        "direct " + method + " retains the parent PIN gate for generic setup",
        () => {
            const f = fixture();
            f.w.sPSprovs = 1;
            f.w.parentPIN = "1234";
            f.w[method]();
            assert.equal(f.pinRequests, 1);
            assert.equal(f.w.listCaptionElement.innerHTML, undefined);
            assert.deepEqual(f.requests, []);
        }
    );
}

test("Full local and remote activation implementations remain callable", () => {
    const f = fixture("full");
    f.w.edit_dealer();
    f.w.editvar = "example:opaque-code";
    f.w.setEdit();
    assert.deepEqual(f.scripts, [
        "https://player.invalid/d/example.js?fixture",
    ]);
    f.w.edit_dealer_remote();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].data.c, "get_var");
});

test("Play options omit legacy dealer actions in place while retaining generic setup", () => {
    const f = fixture();
    const options = f.w.optionsArr;
    options.push(
        { action: f.w.edit_dealer, name: "Activate" },
        { action: f.w.selectProvaider, name: "Change provider" },
        { action: f.w.edit_dealer_remote, name: "Activate remote" }
    );
    f.w.optionsList();
    assert.equal(f.w.optionsArr, options);
    assert.deepEqual(Array.from(f.w.listArray), ["Change provider"]);
    f.w.listKeyHandlerFn(f.w.keys.ENTER);
    assert.equal(f.w.listCaptionElement.innerHTML, "Choose provider");
});

test("Full still loads branded stored and URL-pinned providers", () => {
    const f = fixture("full", { ottplayprov: "ottclub" });
    f.w.loadProv();
    assert.deepEqual(f.scripts, []);
    assert.equal(f.w.__ottActiveProviderDriver.id, "ottclub");
    f.w.location.search = "?edem";
    f.w.loadProv();
    assert.deepEqual(f.scripts, []);
    assert.equal(f.w.__ottActiveProviderDriver.id, "edem");
});

function startupFixture(
    flavor,
    startup = startupProfiles[flavor],
    ready = true
) {
    // No resources are enabled: any img DOM would expose its request URL,
    // but the test never performs a network fetch.
    const dom = new JSDOM(
        '<div id="launch">Starting</div><div id="listPodval"></div>',
        {
            runScripts: "outside-only",
            url: "https://localhost/index.html",
        }
    );
    const w = dom.window;
    const calls = [];
    const errors = [];
    Object.assign(w, {
        __iid: "private-install-1234567",
        console: { error: (error) => errors.push(error), log() {}, warn() {} },
        host: "https://localhost",
        hostUrl: "",
        initBackgroundIntervals: () => calls.push("intervals"),
        listPodvalElement: w.document.getElementById("listPodval"),
        onPlayerStart: () => calls.push("start"),
        onStbReady: () => calls.push("ready"),
        PLAYER_VERSION: "42.7.fixture",
        stbInit: () => {
            calls.push("stb");
            return ready;
        },
        storage: { reset: () => calls.push("storage") },
        uiInit: () => calls.push("ui"),
    });
    require("./helpers/private-runtime.cjs")(
        dom.getInternalVMContext(),
        "src/device/adapter.ts"
    );
    w.stbPlay = function () {};
    w.__ottCoreTransport = { play: w.stbPlay };
    w.eval(code[flavor] + startup);
    attachSourceAliases(w);
    w.startPlayer();
    return { calls, close: () => w.close(), errors, w };
}

for (const flavor of ["full", "play"]) {
    test(
        flavor +
            " actual startup renders its version and completes initialization with the correct logo policy",
        () => {
            const f = startupFixture(flavor);
            try {
                const launch = f.w.document.getElementById("launch");
                assert(launch.textContent.includes("VER: 42.7.fixture"));
                assert(launch.textContent.includes("IID: ...1234567"));
                assert.equal(f.w.hostUrl, "https://localhost");
                assert.equal(f.w.listPodval, f.w.listPodvalElement);
                assert.deepEqual(f.calls, [
                    "start",
                    "storage",
                    "ui",
                    "intervals",
                    "stb",
                    "ready",
                ]);
                assert.deepEqual(f.errors, []);
                const images = Array.from(launch.querySelectorAll("img"));
                assert.equal(images.length, flavor === "full" ? 1 : 0);
                if (flavor === "full")
                    assert.equal(
                        images[0].src,
                        "https://localhost/stbPlayer/icon.png?42.7.fixture"
                    );
                // Inspect actual emitted string literals, alongside live DOM. A
                // hidden or unreachable request must not remain in Play JavaScript.
                const parsed = ts.createSourceFile(
                    "startup.js",
                    startupProfiles[flavor],
                    ts.ScriptTarget.Latest,
                    true
                );
                const iconLiterals = [];
                function visit(node) {
                    if (
                        ts.isStringLiteral(node) &&
                        node.text.includes("icon.png")
                    )
                        iconLiterals.push(node.text);
                    ts.forEachChild(node, visit);
                }
                visit(parsed);
                assert.equal(iconLiterals.length, flavor === "full" ? 1 : 0);
                acorn.parse(startupProfiles[flavor], { ecmaVersion: 5 });
            } finally {
                f.close();
            }
        }
    );
}

test("Play source guard omits startup logo even before region stripping and preserves deferred STB initialization", () => {
    const f = startupFixture("play", startupCompiled, false);
    try {
        assert.equal(f.w.document.querySelectorAll("#launch img").length, 0);
        assert.deepEqual(f.calls, [
            "start",
            "storage",
            "ui",
            "intervals",
            "stb",
        ]);
        assert.deepEqual(f.errors, []);
        assert(
            f.w.document
                .getElementById("launch")
                .textContent.includes("VER: 42.7.fixture")
        );
    } finally {
        f.close();
    }
});

for (const flavor of ["full", "play"]) {
    test(
        flavor +
            " About retains local diagnostics with the correct public IP request policy",
        () => {
            const dom = new JSDOM('<div id="listAbout"></div>', {
                runScripts: "outside-only",
                url: "https://localhost/index.html",
            });
            const w = dom.window;
            const requests = [];
            try {
                w.eval(
                    fs.readFileSync(
                        path.join(root, "js/jquery-1.11.1.min.js"),
                        "utf8"
                    )
                );
                attachSourceAliases(w);
                Object.defineProperty(w.navigator, "userAgent", {
                    value: "Fixture Android Agent",
                });
                w.localStorage.setItem("deviceId", "fixture-device-id");
                w.localStorage.setItem(
                    "local_poll_url",
                    "https://local.invalid/commands"
                );
                Object.assign(w, {
                    _: (value) => value,
                    client_can_https: true,
                    host: "https://localhost",
                    saveCPD() {},
                    version: "Fixture version",
                });
                // Stub only $.get's I/O boundary. The real About entry and stbInfo
                // execute, and real jQuery appends their text to the DOM.
                w.$.get = (url, callback) => {
                    requests.push({ callback, url });
                };
                w.eval(
                    code[flavor] +
                        diagnosticProfiles[flavor] +
                        pluginInfoCompiled
                );
                attachSourceAliases(w);
                w.pluginInfo();
                const panel = w.document.getElementById("listAbout");
                assert(
                    panel.textContent.includes(
                        "userAgent: Fixture Android Agent"
                    )
                );
                assert(
                    panel.textContent.includes("Device ID: fixture-device-id")
                );
                assert(
                    panel.textContent.includes(
                        "Local Poll URL: https://local.invalid/commands"
                    )
                );
                assert.equal(
                    panel.textContent.includes("Ip address:"),
                    false,
                    "there is no fake or stale public IP before a response"
                );
                assert.equal(requests.length, flavor === "full" ? 1 : 0);
                if (flavor === "full") {
                    assert.equal(requests[0].url, "http://api.ipify.org");
                    requests[0].callback("203.0.113.45");
                    assert(
                        panel.textContent.includes("Ip address: 203.0.113.45"),
                        "Full keeps its actual callback rendering"
                    );
                }
                // Runtime absence is not enough: Play must physically omit both
                // the request call and its endpoint/result-label strings.
                const ast = ts.createSourceFile(
                    "diagnostic.js",
                    diagnosticProfiles[flavor],
                    ts.ScriptTarget.Latest,
                    true
                );
                const literals = [];
                let getCalls = 0;
                function visit(node) {
                    if (ts.isStringLiteral(node)) literals.push(node.text);
                    if (
                        ts.isCallExpression(node) &&
                        ts.isPropertyAccessExpression(node.expression) &&
                        node.expression.expression.getText(ast) === "$" &&
                        node.expression.name.text === "get"
                    )
                        getCalls++;
                    ts.forEachChild(node, visit);
                }
                visit(ast);
                assert.equal(getCalls, flavor === "full" ? 1 : 0);
                assert.equal(
                    literals.some((value) => value.includes("api.ipify.org")),
                    flavor === "full"
                );
                assert.equal(
                    literals.some((value) => value.includes("Ip address:")),
                    flavor === "full"
                );
                acorn.parse(diagnosticProfiles[flavor], { ecmaVersion: 5 });
            } finally {
                w.close();
            }
        }
    );
}

console.log(
    "Android provider distribution policy: " + cases + " scenarios passed"
);
