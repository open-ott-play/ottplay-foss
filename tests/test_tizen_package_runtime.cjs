const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const { inlineScripts } = require("../scripts/html-scripts.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function functions(file, names) {
    const text = read(file);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const selected = ast.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    );
    assert.equal(
        selected.length,
        names.length,
        file + " real function declarations"
    );
    return ts
        .transpileModule(selected.map((node) => node.getText(ast)).join("\n"), {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.replace(/^export /gm, "");
}

const html = inlineScripts(read("index.html")).join("\n");
const declaration = acorn
    .parse(html, { ecmaVersion: 5 })
    .body.find(
        (node) =>
            node.type === "FunctionDeclaration" &&
            node.id.name === "packagedTizenAssetBase"
    );
assert(declaration, "Production boot exposes its package asset resolver");
const resolvers = [html.slice(declaration.start, declaration.end)];
const deviceSource = ts.createSourceFile(
    "device.ts",
    read("src/app/device.ts"),
    ts.ScriptTarget.Latest,
    true
);
const hostDeclaration = deviceSource.statements.find(
    (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
            (item) => item.name.getText(deviceSource) === "host"
        )
);
assert(hostDeclaration, "Production module has its host declaration");
const moduleHost = ts
    .transpileModule(hostDeclaration.getText(deviceSource), {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    })
    .outputText.replace(/^export /gm, "");
const local = "file:///opt/usr/apps/OttPlayFOS/res/wgt";
const defaultLocation = {
    href: local + "/index.html?return=https://unrelated.invalid/#screen",
    protocol: "file:",
};
for (const code of resolvers) {
    function resolve(change = () => {}) {
        let nativeCalls = 0;
        const context = {
            __OTTPLAY_TIZEN_PACKAGE__: { schema: 1 },
            location: { ...defaultLocation },
            tizen: {
                application: {
                    getCurrentApplication() {
                        nativeCalls++;
                    },
                },
            },
        };
        context.window = context;
        change(context);
        vm.runInNewContext(
            code + "\nresult = packagedTizenAssetBase();",
            context
        );
        context.__ottPkgBase = context.result;
        vm.runInNewContext(moduleHost, context);
        assert.equal(
            context.host,
            context.result || "http://localhost:8080",
            "Bundle consumes the base validated by boot"
        );
        assert.equal(
            nativeCalls,
            0,
            "Asset resolution does not invoke native APIs"
        );
        return context.result;
    }
    assert.equal(resolve(), local);
    assert.equal(
        resolve((c) => {
            c.location.href = "file:///tmp/space%20dir/%23media/index.html";
        }),
        "file:///tmp/space%20dir/%23media"
    );
    assert.equal(
        resolve((c) => {
            delete c.__OTTPLAY_TIZEN_PACKAGE__;
        }),
        ""
    );
    assert.equal(
        resolve((c) => {
            c.__OTTPLAY_TIZEN_PACKAGE__.schema = 2;
        }),
        ""
    );
    assert.equal(
        resolve((c) => {
            delete c.tizen;
        }),
        ""
    );
    assert.equal(
        resolve((c) => {
            c.tizen.application.getCurrentApplication = true;
        }),
        ""
    );
    assert.equal(
        resolve((c) => {
            c.location.href = "file://server/share/index.html";
        }),
        ""
    );
    assert.equal(
        resolve((c) => {
            c.location.href = "file:///index.html";
        }),
        ""
    );
    assert.equal(
        resolve((c) => {
            c.location.href = "https://unrelated.invalid/index.html";
        }),
        ""
    );
    for (const protocol of ["http:", "https:", "tauri:", "capacitor:"]) {
        let bridgeReads = 0;
        assert.equal(
            resolve((c) => {
                c.location.protocol = protocol;
                c.location.href =
                    protocol +
                    "//localhost/index.html?__OTTPLAY_TIZEN_PACKAGE__=1";
                Object.defineProperty(c, "tizen", {
                    get() {
                        bridgeReads++;
                        throw new Error("Unexpected bridge access");
                    },
                });
            }),
            "",
            "Hosted/native web-root behavior remains unchanged"
        );
        assert.equal(
            bridgeReads,
            0,
            "Web-root URLs do not inspect the native API"
        );
    }
    assert.equal(
        resolve((c) => {
            Object.defineProperty(c.tizen, "application", {
                get() {
                    throw new Error("Unavailable API");
                },
            });
        }),
        ""
    );
}

function documentFixture() {
    const appended = [];
    const document = {
        body: { appendChild: (script) => appended.push(script) },
        createElement: () => ({ crossOrigin: "", style: {} }),
    };
    document.head = document.body;
    return { appended, document };
}
for (const base of [local, "https://player.example"]) {
    const expectedCors = base.startsWith("file:") ? "" : "anonymous";
    const fixture = documentFixture();
    const context = { ...fixture, alert() {}, console };
    context.window = context;
    vm.runInNewContext(
        functions("src/utils/helpers.ts", ["loadScript"]),
        context
    );
    context.loadScript(
        base + "/dist/provider-plex.js",
        null,
        null,
        fixture.document.body
    );
    assert.equal(fixture.appended[0].src, base + "/dist/provider-plex.js");
    assert.equal(fixture.appended[0].crossOrigin, expectedCors);

    const languageFixture = documentFixture();
    const language = {
        ...languageFixture,
        __cv: "package-test",
        __host: base,
        console,
        host: base,
        languageAssetPath: () => "/locales/_eng.js",
        setTranslations() {},
    };
    language.window = language;
    vm.runInNewContext(
        functions("src/localization/loader.ts", ["loadLanguage"]),
        language
    );
    language.loadLanguage("_eng", () => {});
    assert.equal(
        languageFixture.appended[0].src,
        base + "/locales/_eng.js?package-test"
    );
    assert.equal(languageFixture.appended[0].crossOrigin, expectedCors);

    const subtitleFixture = documentFixture();
    const subtitles = {
        ...subtitleFixture,
        clearTimeout() {},
        hostUrl: base,
        PLAYER_VERSION: "package-test",
        setTimeout: () => 1,
        subtitleAppearanceGeneration: 0,
        subtitleAppearanceLoading: false,
        subtitleAppearanceOpen: null,
        subtitleAppearanceReady: [],
    };
    subtitles.window = subtitles;
    vm.runInNewContext(
        functions("src/index.ts", [
            "loadSubtitleAppearance",
            "notifySubtitleAppearanceReady",
        ]),
        subtitles
    );
    subtitles.loadSubtitleAppearance();
    assert.equal(
        subtitleFixture.appended[0].src,
        base + "/dist/subtitle-appearance.js?package-test"
    );
    assert.equal(subtitleFixture.appended[0].crossOrigin, expectedCors);
}

for (const base of [local, "https://player.example"]) {
    const dom = new JSDOM("<!doctype html><body></body>", {
        url: base + "/index.html",
    });
    try {
        const context = {
            alert() {},
            console,
            document: dom.window.document,
            window: dom.window,
        };
        vm.runInNewContext(
            functions("src/utils/helpers.ts", ["loadScript"]),
            context
        );
        context.loadScript(
            "dist/provider-plex.js",
            null,
            null,
            context.document.body
        );
        const script = context.document.querySelector("script");
        assert.equal(script.src, base + "/dist/provider-plex.js");
        assert.equal(
            script.getAttribute("crossorigin"),
            base.startsWith("file:") ? null : "anonymous"
        );
    } finally {
        dom.window.close();
    }
}

const fontUrls = [
    ...read("styles/player.css").matchAll(/url\(["']?(\.\.\/fonts\/[^)"']+)/g),
].map((match) => match[1]);
assert(fontUrls.length >= 12, "All packaged font formats remain available");
for (const relative of fontUrls) {
    for (const base of [local, "https://player.example"]) {
        assert.equal(
            new URL(relative, base + "/styles/player.css").href,
            base + "/" + relative.slice(3)
        );
    }
}
assert(
    !/url\(["']?\/fonts\//.test(read("styles/player.css")),
    "Fonts must not resolve against the device filesystem root"
);
console.log(
    "PASS: packaged Tizen asset base, HTTP/native-root preservation, local script loading, language/subtitle assets and fonts"
);
