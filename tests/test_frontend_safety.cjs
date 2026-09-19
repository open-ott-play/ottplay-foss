const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const acorn = require("acorn");
const {
    attachSourceAliases,
    classicName,
} = require("./helpers/english-source-fixture.cjs");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules/typescript"));
const asts = {};
const bundleIndex = process.argv.indexOf("--bundle");
const bundleAst =
    bundleIndex >= 0
        ? ts.createSourceFile(
              "bundle.js",
              fs.readFileSync(
                  path.resolve(process.argv[bundleIndex + 1]),
                  "utf8"
              ),
              ts.ScriptTarget.Latest,
              true
          )
        : null;
const { JSDOM } = require(path.join(root, "node_modules/jsdom"));
function ast(file) {
    return (
        asts[file] ||
        (asts[file] = ts.createSourceFile(
            file,
            fs.readFileSync(path.join(root, file), "utf8"),
            ts.ScriptTarget.Latest,
            true
        ))
    );
}
function js(text) {
    return ts.transpileModule(text.replace(/^export /gm, ""), {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
}
function func(file, name) {
    if (file.startsWith("src/") && bundleAst) name = classicName(name);
    const a = (file.startsWith("src/") && bundleAst) || ast(file),
        n = a.statements.find(
            (n) => ts.isFunctionDeclaration(n) && n.name?.text === name
        );
    if (!n) throw Error(name);
    return js(n.getText(a));
}
function variable(file, name) {
    const a = ast(file);
    for (const n of a.statements)
        if (ts.isVariableStatement(n))
            for (const d of n.declarationList.declarations)
                if (d.name.getText(a) === name)
                    return js("var " + d.getText(a) + ";");
    throw Error(name);
}
function fixture() {
    const d = new JSDOM(
        '<div id="listAbout" style="display:none"></div><div id="dialogbox" style="display:none"></div><div id="listEdit"></div><div id="listIn"></div><div id="listCaption"></div><div id="listDetail"></div><div id="listPodval"></div>',
        { runScripts: "dangerously", url: "https://localhost/index.html" }
    );
    const w = d.window;
    if (bundleAst) attachSourceAliases(w);
    w.console.warn = () => {};
    w.eval(
        fs.readFileSync(
            path.join(
                root,
                process.env.OTTPLAY_TEST_JQUERY || "js/jquery-1.11.1.min.js"
            ),
            "utf8"
        )
    );
    w.$.expr.filters.visible = (e) => e.style.display !== "none";
    if (bundleAst) {
        w.useGraphicIcons = false;
        w.translations = {};
        w.eval(func("src/localization/index.ts", "translate"));
        w.eval(
            bundleAst.statements
                .filter(
                    (n) =>
                        ts.isFunctionDeclaration(n) &&
                        /^__ottReadImport/.test(n.name?.text || "")
                )
                .map((n) => n.getText(bundleAst))
                .join("\n")
        );
    }
    Object.assign(w, {
        _: (x) => x,
        bodyColor: "#fff",
        curColor: "gold",
        curColorB: "#668",
        host: "https://localhost",
        keys: {
            ENTER: 13,
            EXIT: 27,
            FF: 70,
            INFO: 73,
            N2: 50,
            NEXT: 78,
            RETURN: 8,
            RIGHT: 39,
        },
        listCaptionElement: w.document.getElementById("listCaption"),
        listDetail: w.document.getElementById("listDetail"),
        listFooterElement: w.document.getElementById("listPodval"),
        renderButtonHint: (key, s, label) =>
            '<span data-key="' + key + '">' + label + "</span>",
        restoreListPanelState() {},
        saveListPanelState() {},
        scrollUp() {},
        showPage() {},
        stbEventToKeyCode: (e) => e.keyCode,
        stbGetItem: () => null,
        strFF: "FF",
        strInfo: "Info",
        strNEXT: "Next",
        strRETURN: "Return",
        strRIGHT: "Right",
        ui_state: { ld: "Synthetic programme description" },
    });
    for (const name of [
        "strENTER",
        "strEXIT",
        "strSTOP",
        "strPLAY",
        "strPAUSE",
        "strPREV",
        "strRW",
        "strUP",
        "strDOWN",
        "strLEFT",
        "strTools",
        "strEPG",
        "strAudio",
        "strLANG",
        "strSubt",
        "strAspect",
        "strZoom",
        "strPip",
        "strFAV",
        "strMENU",
    ])
        w[name] = name;
    w.eval(
        [
            "metadataText",
            "metadataImageUrl",
            "metadataCssUrl",
            "metadataHtml",
            "hasTmdbService",
        ]
            .map((n) => func("src/utils/helpers.ts", n))
            .join("\n")
    );
    w.setTimeout = () => 1;
    w.clearTimeout = () => {};
    w.requestAnimationFrame = () => {};
    w.eval(func("src/storage/index.ts", "isPortableSettingsKey"));
    return w;
}

let count = 0;
function test(name, run) {
    run();
    count++;
    console.log("PASS frontend safety: " + name);
}
const hostile =
    '<img src="missing" onerror="window.__executed=true"><script>window.__executed=true</script>';

test("channel list keeps hostile titles as text and preserves intentional row layout", () => {
    const w = fixture();
    try {
        const a = ast("src/provider/index.ts");
        let renderer;
        function visit(n) {
            if (
                ts.isVariableDeclaration(n) &&
                n.name.getText(a) === "channelItemFormatter" &&
                n.initializer &&
                ts.isFunctionExpression(n.initializer)
            )
                renderer = n.initializer;
            ts.forEachChild(n, visit);
        }
        visit(a);
        assert(renderer);
        Object.assign(w, {
            $infoBar: w.$("<div>"),
            archWidth: 0,
            boxH: 28,
            channelLogoSize: 0,
            channels: {
                fixture: {
                    channel_name: hostile,
                    name: hostile,
                    time: 1,
                    time_to: Date.now() / 1000 + 30,
                },
            },
            currentProgramRequestQueue: [],
            getCurProgData() {},
            getViewportWidthScale: () => 1,
            listArray: [],
            listDataArray: ["fixture"],
            listElement: null,
            listInElement: w.document.getElementById("listIn"),
            listRowHeight: () => 28,
            numWidth: 0,
            packListRowBoxes() {},
            parentalArray: [],
            parentPIN: "*",
            progBarH: 1,
            progMargin: 0,
            progWidth: 0,
            scheduleListDetailUpdate() {},
            selIndex: 0,
            settings: { noSmall: 1, pageSize: 25 },
            showName: true,
            showProgram: true,
            sPSchannels: false,
            updateChannelListRow() {},
        });
        w.eval(
            js("window.getListItemFn=" + renderer.getText(a) + ";") +
                func("src/ui/index.ts", "showPage")
        );
        w.showPage();
        assert.equal(
            w.document.querySelectorAll("#listIn img,#listIn script").length,
            0
        );
        assert(w.document.getElementById("it0").textContent.includes(hostile));
        assert.equal(
            w.document.getElementById("it0").getAttribute("role"),
            "button"
        );
        assert.equal(w.document.getElementById("it0").tabIndex, 0);
        assert.equal(w.__executed, undefined);
    } finally {
        w.close();
    }
});
test("VOD descriptions and thumbnails preserve formatting while removing active content and unsafe attributes", () => {
    const w = fixture();
    try {
        w.eval(
            func("src/channels/index.ts", "getMediaDescr") +
                func("src/utils/helpers.ts", "getThumbnail")
        );
        w.sThumbnail = 1;
        w.getViewportWidthScale = () => 1;
        w.getViewportHeightScale = () => 1;
        const description =
            "<b>Heading</b><br>Detail <i>italic</i>" +
            hostile +
            '<svg onload="window.__executed=true"></svg><img src="javascript:alert(1)"><a href="javascript:alert(1)">link</a>';
        const target = w.document.getElementById("listDetail");
        target.innerHTML = w.getMediaDescr({ description: () => description });
        assert.equal(target.querySelector("b").textContent, "Heading");
        assert(target.querySelector("br"));
        assert(target.querySelector("i"));
        assert.equal(
            target.querySelectorAll(
                "script,svg,iframe,[onerror],[onload],[href]"
            ).length,
            0
        );
        assert.equal(target.querySelectorAll("img").length, 1);
        assert.equal(w.__executed, undefined);
        target.innerHTML = w.getThumbnail(
            'https://images.invalid/a\'");color:red;" onerror="window.__executed=true'
        );
        assert.equal(target.children.length, 1);
        assert.equal(target.querySelectorAll("[onerror]").length, 0);
        assert.equal(target.firstChild.style.color, "");
        for (const url of [
            "javascript:alert(1)",
            "file:///private",
            "data:text/html,<script>x</script>",
        ])
            assert.equal(w.metadataImageUrl(url), "");
        assert.equal(
            w.metadataImageUrl("https://images.invalid/icon?a=1&b=2"),
            "https://images.invalid/icon?a=1&b=2"
        );
        acorn.parse(func("src/utils/helpers.ts", "metadataHtml"), {
            ecmaVersion: 5,
        });
    } finally {
        w.close();
    }
});
test("EPG list titles are escaped without losing current-programme highlighting", () => {
    const w = fixture();
    try {
        Object.assign(w, {
            channels: { fixture: { rec: true } },
            epg_ch_id: "fixture",
            formatEpgTime: () => "12:00",
        });
        w.eval(func("src/channels/index.ts", "itemEPG"));
        w.document.getElementById("listIn").innerHTML = w.itemEPG(
            {
                name: hostile,
                time: Date.now() / 1000 - 2,
                time_to: Date.now() / 1000 + 30,
            },
            0
        );
        assert.equal(
            w.document.querySelectorAll("#listIn img,#listIn script").length,
            0
        );
        assert(w.document.querySelector("#listIn span[style]"));
        assert(
            w.document.getElementById("listIn").textContent.includes(hostile)
        );
    } finally {
        w.close();
    }
});
test("buttons help closes with Back and existing RETURN, while native cloud save opens export", () => {
    const w = fixture();
    try {
        w.eval(
            func("src/index.ts", "buttonsInfo") +
                func("src/keyhandler/index.ts", "keyHandler") +
                func("src/settings/cloud.ts", "cloudSendSettings")
        );
        for (const key of [w.keys.EXIT, w.keys.RETURN]) {
            w.buttonsInfo();
            w.keyHandler({
                keyCode: key,
                preventDefault() {},
                stopPropagation() {},
            });
            assert.equal(
                w.document.getElementById("listAbout").style.display,
                "none"
            );
        }
        let exported = 0;
        w.exportSettingsUI = () => exported++;
        w.Capacitor = {};
        w.cloudSendSettings();
        assert.equal(exported, 1);
        delete w.Capacitor;
        w.__TAURI__ = {};
        w.cloudSendSettings();
        assert.equal(exported, 2);
        delete w.__TAURI__;
        w.host_ott = "fixture.invalid";
        w.host_ott_proto = "https://";
        w.stbGetAllItems = () => ({
            fixture: "value",
            sLocalHttpDeviceCode: "private-device-code-do-not-upload",
            sLocalHttpEnabled: "1",
        });
        let post;
        w.$.ajax = (opts) => {
            post = opts;
        };
        w.cloudSendSettings();
        assert.equal(post.url, "https://fixture.invalid/swop/a.php");
        assert(post.data.d.includes("fixture"));
        assert(!post.data.d.includes("sLocalHttpEnabled"));
        assert(!post.data.d.includes("sLocalHttpDeviceCode"));
        assert(!post.data.d.includes("private-device-code-do-not-upload"));
    } finally {
        w.close();
    }
});
test("cloud restore ignores injected local HTTP consent and credentials", () => {
    const w = fixture();
    try {
        w.eval(func("src/settings/cloud.ts", "cloudLoadSettings"));
        const stored = new Map([
            ["sLocalHttpEnabled", "1"],
            ["sLocalHttpDeviceCode", "old-local-code"],
            ["ordinary", "old-value"],
        ]);
        let cleared = 0;
        let restarted = 0;
        let post;
        let poll;
        w.host_ott = "fixture.invalid";
        w.host_ott_proto = "https://";
        w.stbClearAllItems = () => {
            cleared++;
            stored.clear();
        };
        w.stbSetItem = (key, value) => stored.set(key, value);
        w.restart = () => restarted++;
        w.setTimeout = (callback, delay) => {
            if (delay === 10000) poll = callback;
            return 1;
        };
        w.$.ajax = (options) => {
            post = options;
        };
        w.cloudLoadSettings();
        assert.equal(post.data.c, "get_code");
        post.success({ code: "transfer-code" });
        assert.equal(
            cleared,
            0,
            "requesting a cloud import must not change local consent"
        );
        poll();
        assert.equal(post.data.c, "get");
        assert.equal(post.data.d, "transfer-code");
        post.success({
            data:
                "<properties><comment>OTT-Play Preferences</comment>" +
                '<entry key="ordinary">restored-value</entry>' +
                '<entry key="sLocalHttpEnabled">1</entry>' +
                '<entry key="sLocalHttpDeviceCode">injected-code</entry>' +
                "</properties>",
            status: "success",
        });
        assert.equal(cleared, 1);
        assert.equal(restarted, 1);
        assert.equal(stored.get("ordinary"), "restored-value");
        assert.equal(
            stored.has("sLocalHttpEnabled"),
            false,
            "cloud imports cannot enable a local listener"
        );
        assert.equal(
            stored.has("sLocalHttpDeviceCode"),
            false,
            "cloud imports cannot copy another device's code"
        );
    } finally {
        w.close();
    }
});
test("Capacitor hides unavailable TMDb; web and Tauri retain the functional action", () => {
    const w = fixture();
    try {
        w.eval(
            variable("src/index.ts", "TMDb") +
                func("src/ui/index.ts", "showProgramInfo")
        );
        let calls = [];
        w.$.ajax = (opts) => calls.push(opts);
        w.Capacitor = {};
        w.showProgramInfo("A programme");
        assert(
            !w.document
                .getElementById("listPodval")
                .textContent.includes("TMDb")
        );
        w.TMDb.search("Blocked");
        assert.equal(calls.length, 0);
        delete w.Capacitor;
        w.__TAURI__ = {};
        w.showProgramInfo("A programme");
        assert(
            w.document.getElementById("listPodval").textContent.includes("TMDb")
        );
        w.aboutKeyHandler(w.keys.N2);
        assert.equal(calls.length, 1);
        assert(calls[0].url.includes("/tmdb/s/search/multi"));
        delete w.__TAURI__;
        w.TMDb.search("Web programme");
        assert.equal(calls.length, 2);
    } finally {
        w.close();
    }
});
test("real password action selects a secret editor; normal input restores text and controls are keyboard accessible", () => {
    const w = fixture();
    try {
        w.eval(
            func("src/ui/index.ts", "showEditKey2") +
                func("prov/xtream/prov.js", "editXtreamSettings") +
                func("src/ui/index.ts", "renderButtonHint")
        );
        w.xtream = {
            password: "synthetic-secret",
            server: "https://fixture.invalid",
            username: "fixture",
        };
        w.loadXtreamParams = () => {};
        w.showEditKey = w.showEditKey2;
        w.listCaption = w.document.getElementById("listCaption");
        w.listFooter = w.document.getElementById("listPodval");
        attachSourceAliases(w);
        w.editXtreamSettings();
        w.selIndex = 2;
        w.listKeyHandler(w.keys.ENTER);
        let input = w.document.getElementById("editvar");
        assert.equal(input.type, "password");
        assert.equal(input.value, "synthetic-secret");
        assert.equal(input.autocomplete, "off");
        assert.equal(input.getAttribute("aria-label"), "Enter password");
        w.editCaption = "Playlist URL";
        w.editvar = "https://fixture.invalid?a=1&b=2";
        w.showEditKey2();
        input = w.document.getElementById("editvar");
        assert.equal(input.type, "text");
        assert.equal(input.value, w.editvar);
        w.document.getElementById("listPodval").innerHTML = w.renderButtonHint(
            13,
            "▸",
            "<b>Play</b> / pause"
        );
        const control = w.document.querySelector('#listPodval [role="button"]');
        assert.equal(control.tabIndex, 0);
        assert(control.getAttribute("aria-label").includes("Play"));
        let pressed;
        w._doKey = (key) => (pressed = key);
        control.focus();
        control.dispatchEvent(
            new w.KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                keyCode: 13,
            })
        );
        assert.equal(pressed, 13);
    } finally {
        w.close();
    }
});
test("notifications and stream selectors sanitize metadata while preserving fixed legacy icon markup", () => {
    const w = fixture();
    try {
        const info = w.document.createElement("div");
        info.id = "info";
        w.document.body.appendChild(info);
        w.channelNumberElement = w.document.createElement("div");
        w.document.body.appendChild(w.channelNumberElement);
        w.closeList = () => {};
        w.eval(
            func("src/ui/index.ts", "showShift") +
                func("src/ui/index.ts", "showSelectBox")
        );
        w.showShift("<b>Notice</b>" + hostile);
        assert(info.querySelector("b"));
        assert.equal(info.querySelectorAll("script,[onerror]").length, 0);
        const legacyIcon = '<span class="fontello">&#xe811;</span>';
        const nativeBundle =
            bundleAst && /\bsystem-icons\b/.test(bundleAst.text);
        const icon = nativeBundle
            ? require("../scripts/play-system-icons.cjs").transformPlaySystemIcons(
                  legacyIcon
              )
            : legacyIcon;
        w.showSelectBox(0, [hostile, icon], () => {}, -1);
        assert.equal(
            w.channelNumberElement.querySelectorAll("script,[onerror]").length,
            0
        );
        assert(
            w.channelNumberElement.querySelector(
                "span.fontello, span.system-icons"
            )
        );
        assert.equal(
            w.channelNumberElement.querySelector(
                "span.fontello, span.system-icons"
            ).textContent,
            new JSDOM(icon).window.document.querySelector("span").textContent
        );
        assert.equal(w.__executed, undefined);
    } finally {
        w.close();
    }
});
test("Play URL policy explains remote HTTP rejection without changing Full or local endpoints", () => {
    const w = fixture();
    try {
        w.eval(
            func("src/provider/index.ts", "isPlayDistribution") +
                func("src/provider/index.ts", "checkProviderUrl")
        );
        w.providerDistribution = "play";
        let messages = [];
        w.alert = (message) => messages.push(message);
        assert.equal(
            w.checkProviderUrl("http://provider.invalid/playlist"),
            false
        );
        assert(messages[0].includes("HTTPS"));
        for (const url of [
            "https://provider.invalid/playlist",
            "http://127.0.0.1:8080/commands",
            "http://localhost/internal",
            "/demo/pattern.mp4",
        ])
            assert.equal(w.checkProviderUrl(url), true);
        w.providerDistribution = "full";
        assert.equal(
            w.checkProviderUrl("http://provider.invalid/playlist"),
            true
        );
    } finally {
        w.close();
    }
});
(async function () {
    const w = fixture();
    try {
        const a = ast("src/index.ts");
        const block = a.statements.find(
            (n) =>
                ts.isIfStatement(n) &&
                n.getText(a).includes("window.stbExit = function") &&
                n.getText(a).includes("stopBackgroundAudio")
        );
        assert(block);
        const calls = [];
        let finishStop;
        w.stbStop = () => calls.push("decoder");
        w.Capacitor = {
            Plugins: {
                App: {
                    exitApp: async () => {
                        calls.push("app-exit");
                        throw Error("fixture unavailable");
                    },
                },
                MobileNativeMedia: {
                    exitApp: async () => calls.push("fallback-exit"),
                    stopBackgroundAudio: () => {
                        calls.push("native-stop");
                        return new Promise((resolve) => (finishStop = resolve));
                    },
                },
            },
        };
        w.eval(js(block.getText(a)));
        w.stbExit();
        assert.deepEqual(calls, ["decoder", "native-stop"]);
        finishStop();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(calls, [
            "decoder",
            "native-stop",
            "app-exit",
            "fallback-exit",
        ]);
        count++;
        console.log(
            "PASS frontend safety: native exit waits for media stop and handles async App failure"
        );
    } finally {
        w.close();
    }
    console.log("Frontend safety: " + count + " scenarios passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
