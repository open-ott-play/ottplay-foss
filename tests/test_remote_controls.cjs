const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");

function emit(file) {
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
const context = { exports: {} };
vm.runInNewContext(emit("src/commands/remote-restart.ts"), context);
const execute = context.exports.executeRemoteControl;
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
    const effects = [];
    let locked = false,
        kiosk = false,
        protectedSurface = false;
    let active = true,
        standby = false,
        revision = 0;
    let kind = "vod",
        phase = "playing";
    const handle = {
        active: () => active,
        pause: () => {
            effects.push("pause");
            phase = "paused";
        },
        resume: () => {
            effects.push("resume");
            phase = "playing";
        },
        seek: (position) => effects.push(["seek", position]),
        snapshot: () => ({ phase }),
    };
    const backend = {
        current: () => handle,
        restart: () => ({ accepted: true, dispatched: true, target: "stream" }),
    };
    const play = () => {};
    const w = {
        __ottClassicPlayback: { snapshot: () => ({ target: { kind } }) },
        __ottCoreBackend: () => backend,
        __ottCoreTransport: { play },
        __ottKiosk: { enabled: () => kiosk },
        __ottParental: { needs: () => locked },
        __ottRemoteLifecycle: {
            exit: () => effects.push("exit"),
            platform: "tauri",
            restart: () => effects.push("restart"),
        },
        $: () => ({ is: () => protectedSurface }),
        keyHandler: (event) => effects.push(["key", event.keyCode]),
        keys: {
            AUDIO: 83,
            DOWN: 40,
            ENTER: 13,
            LEFT: 37,
            MENU: 179,
            MUTE: 173,
            PLAY: 80,
            RETURN: 8,
            RIGHT: 39,
            STOP: 83,
            SUBTITLE: 76,
            UP: 38,
            VOL_DOWN: 174,
            VOL_UP: 175,
        },
        restart: () => effects.push("reload"),
        stbIsStandby: () => standby,
        stbPlay: play,
        stbToggleStandby: () => {
            standby = !standby;
            effects.push("standby");
        },
    };
    vm.runInNewContext(emit("src/ui/input-router.ts"), { window: w });
    const router = w.__ottInputRouter.create({ keys: () => w.keys });
    w.__ottClassicScreenPort = {
        normalize: router.normalize,
        revision: () => revision,
        screens: { current: () => null },
    };
    function run(action, params = {}, acknowledged = true) {
        let result, effect;
        execute(
            w,
            action,
            params,
            (value) => {
                result = plain(value);
            },
            acknowledged
                ? (value) => {
                      effect = value;
                  }
                : undefined
        );
        return { effect, result };
    }
    return {
        active: (value) => {
            active = value;
        },
        effects,
        handle,
        kind: (value) => {
            kind = value;
        },
        kiosk: (value) => {
            kiosk = value;
        },
        lock: (value) => {
            locked = value;
        },
        phase: (value) => {
            phase = value;
        },
        protect: (value) => {
            protectedSurface = value;
        },
        revise: () => revision++,
        run,
        w,
    };
}

{
    const f = fixture();
    const caps = f.run("capabilities").result.data;
    assert.equal(caps.version, 1);
    assert.deepEqual(caps.player, plain(context.exports.remotePlayerInfo(f.w)));
    assert.equal(caps.player.platform, "tauri");
    assert.match(caps.player.runtime, /^[a-z0-9-]{1,64}$/);
    assert.equal(caps.player.version, "__OTTP_VERSION__");
    assert.deepEqual(caps.playback, ["pause", "resume", "seek"]);
    assert.ok(caps.lifecycle.includes("exit_app"));
    assert.ok(caps.lifecycle.includes("restart_app"));
    assert.ok(!caps.lifecycle.includes("reboot_device"));
    assert.ok(
        !caps.input.includes("audio"),
        "AUDIO/STOP collision cannot dispatch STOP"
    );
    assert.ok(
        !caps.input.includes("channels"),
        "missing hardware key is not claimed"
    );
    assert.equal(f.effects.length, 0, "capability reads have no effects");
    f.w.__ottRemoteLifecycle = { platform: "credentials@example.test" };
    const browser = f.run("capabilities").result.data;
    assert.equal(browser.player.platform, "browser");
    assert.equal(browser.player.runtime, caps.player.runtime);
    assert.ok(!browser.lifecycle.includes("exit_app"));
    assert.ok(!JSON.stringify(browser).includes("credentials"));
}

for (const [action, invalid] of [
    ["capabilities", [{ unknown: true }, [], null, 5]],
    [
        "lifecycle",
        [{}, { operation: "exit" }, { js: "1", operation: "exit_app" }],
    ],
    [
        "input",
        [
            {},
            { key: "power" },
            { key: "exit" },
            { key: "stop" },
            { key: "1" },
            { key: "__proto__" },
            { key: "ok", repeat: 100 },
        ],
    ],
    [
        "playback",
        [
            {},
            { operation: "toggle" },
            { operation: "seek" },
            { operation: "seek", position: -1 },
            { operation: "seek", position: Infinity },
            { operation: "seek", position: "10" },
            { operation: "pause", position: 1 },
        ],
    ],
]) {
    for (const params of invalid) {
        const f = fixture();
        assert.equal(
            f.run(action, params).result.status,
            "rejected",
            action + JSON.stringify(params)
        );
        assert.equal(f.effects.length, 0);
    }
}

for (const operation of ["exit_app", "restart_app", "standby", "wake"]) {
    for (const changed of ["none", "lock", "kiosk", "replace", "missing-ack"]) {
        const f = fixture();
        const pending = f.run(
            "lifecycle",
            { operation },
            changed !== "missing-ack"
        );
        assert.equal(f.effects.length, 0, operation + " waits for ACK");
        if (changed === "missing-ack") {
            assert.equal(pending.result.status, "unsupported");
            assert.equal(pending.effect, undefined);
            continue;
        }
        assert.deepEqual(pending.result.data, {
            accepted: true,
            dispatched: false,
            effect: "lifecycle-after-ack",
            operation,
        });
        if (changed === "lock") f.lock(true);
        if (changed === "kiosk") f.kiosk(true);
        if (changed === "replace") {
            f.w.__ottRemoteLifecycle = { ...f.w.__ottRemoteLifecycle };
            f.w.stbToggleStandby = () => f.effects.push("replacement");
        }
        pending.effect();
        assert.equal(
            f.effects.length,
            changed === "none" && operation !== "wake" ? 1 : 0,
            operation + " " + changed
        );
    }
}
{
    const f = fixture();
    f.run("lifecycle", { operation: "standby" }).effect();
    f.run("lifecycle", { operation: "standby" }).effect();
    assert.deepEqual(f.effects, ["standby"], "standby is a state setter");
    f.run("lifecycle", { operation: "wake" }).effect();
    f.run("lifecycle", { operation: "wake" }).effect();
    assert.deepEqual(
        f.effects,
        ["standby", "standby"],
        "wake is a state setter"
    );
    assert.equal(
        f.run("lifecycle", { operation: "reboot_device" }).result.status,
        "unsupported"
    );
    const reload = f.run("lifecycle", { operation: "reload_player" });
    assert.equal(reload.result.data.effect, "lifecycle-after-ack");
    reload.effect();
    assert.equal(f.effects.at(-1), "reload");
    assert.equal(
        f.run("lifecycle", { operation: "restart_stream" }).result.data
            .dispatched,
        true
    );
}

for (const changed of [
    "none",
    "pin",
    "consent",
    "parental-editor",
    "revision",
    "handler",
    "key",
    "mapping",
    "kiosk",
]) {
    const f = fixture();
    const pending = f.run("input", { key: "ok" });
    assert.deepEqual(pending.result.data, {
        accepted: true,
        dispatched: false,
        effect: "input-after-ack",
        key: "ok",
    });
    assert.equal(f.effects.length, 0);
    if (changed === "pin" || changed === "consent") f.protect(true);
    if (changed === "parental-editor") {
        f.w.isListVisible = true;
        f.w.listArray = [{ editorAction: "parentalEnabled" }];
    }
    if (changed === "revision") f.revise();
    if (changed === "handler")
        f.w.keyHandler = () => f.effects.push("replacement");
    if (changed === "key") f.w.keys.ENTER = 27;
    if (changed === "mapping") f.w.__ottDevice = { eventToKeyCode: () => 83 };
    if (changed === "kiosk") f.kiosk(true);
    pending.effect();
    assert.deepEqual(
        f.effects,
        changed === "none" ? [["key", 13]] : [],
        changed
    );
}
{
    const f = fixture();
    f.protect(true);
    for (const key of ["up", "down", "left", "right", "ok", "mute"])
        assert.equal(
            f.run("input", { key }).result.status,
            "rejected",
            "local-only surface " + key
        );
    f.protect(false);
    f.lock(true);
    f.kiosk(true);
    assert.equal(f.run("input", { key: "ok" }).result.status, "rejected");
    assert.equal(f.run("input", { key: "mute" }).result.status, "ok");
    f.run("input", { key: "volume_up" }).effect();
    assert.deepEqual(
        f.effects,
        [["key", 175]],
        "volume remains available under settings/kiosk policy"
    );
    assert.equal(
        f.run("input", { key: "mute" }, false).result.status,
        "unsupported"
    );
}

{
    const f = fixture();
    for (const operation of ["pause", "pause", "resume", "resume"])
        assert.deepEqual(f.run("playback", { operation }).result.data, {
            dispatched: true,
            operation,
        });
    assert.deepEqual(
        f.run("playback", { operation: "seek", position: 20.5 }).result.data,
        { dispatched: true, operation: "seek", position: 20.5 }
    );
    assert.deepEqual(f.effects.at(-1), ["seek", 20.5]);
    f.kind("archive");
    assert.equal(
        f.run("playback", { operation: "seek", position: 5 }).result.status,
        "unsupported",
        "archive timeline uses domain-specific seek, not decoder seconds"
    );
    assert.equal(f.run("playback", { operation: "pause" }).result.status, "ok");
    f.kind("live");
    assert.deepEqual(f.run("capabilities").result.data.playback, []);
    assert.equal(
        f.run("playback", { operation: "resume" }).result.status,
        "unsupported"
    );
    f.kind("vod");
    f.active(false);
    assert.ok(
        !f.run("capabilities").result.data.lifecycle.includes("restart_stream")
    );
    assert.equal(
        f.run("playback", { operation: "pause" }).result.status,
        "unsupported"
    );
    f.active(true);
    f.phase("loading");
    assert.equal(
        f.run("playback", { operation: "pause" }).result.status,
        "unsupported"
    );
    f.phase("playing");
    f.w.stbPlay = () => {};
    assert.equal(
        f.run("playback", { operation: "resume" }).result.status,
        "unsupported"
    );
}
{
    const f = fixture();
    const order = [];
    f.handle.sample = () => order.push("sample");
    f.w.__ottClassicPlayback.checkpoint = (_state, force) => {
        assert.equal(force, true);
        order.push("checkpoint");
        f.lock(true);
    };
    const pending = f.run("lifecycle", { operation: "restart_app" });
    assert.deepEqual(order, []);
    pending.effect();
    assert.deepEqual(order, ["sample", "checkpoint"]);
    assert.deepEqual(
        f.effects,
        [],
        "policy change during persistence cancels native effect"
    );
}
console.log(
    "PASS remote controls: ES5 schemas, public identity, honest capabilities, native ACK fencing, kiosk/PIN/local consent, key collisions and owned playback"
);

function sourceFunction(file, name) {
    const ast = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    return ast.statements
        .find(
            (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
        )
        .getText(ast);
}
function isolated(source, globals) {
    const code = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    const context = { ...globals, exports: {} };
    vm.runInNewContext(code, context);
    return context.exports;
}

// The actual UI exit producer marks its owned confirmation as local-only.
{
    const f = fixture();
    const owner = { model: {} };
    let confirmation;
    f.w.stbExit = () => f.effects.push("legacy-exit");
    f.w.__ottClassicScreenPort.owner = () => owner;
    const { exitPortal } = isolated(
        sourceFunction("src/ui/index.ts", "exitPortal"),
        {
            _: (value) => value,
            confirmBox: (_message, yes) => {
                confirmation = yes;
            },
            window: f.w,
        }
    );
    f.w.keyHandler = exitPortal;
    f.run("input", { key: "back" }).effect();
    assert.equal(
        confirmation,
        undefined,
        "remote Back cannot create a native exit route"
    );
    assert.equal(f.w.__ottRemoteInputActive, undefined);
    exitPortal();
    assert.equal(owner.model.localOnlyInput, true);
    f.w.__ottClassicScreenPort.screens.current = () => owner;
    assert.equal(
        f.run("input", { key: "ok" }).result.status,
        "rejected",
        "remote OK cannot consume a local exit confirmation"
    );
    f.w.__ottRemoteInputActive = true;
    confirmation();
    assert.deepEqual(
        f.effects,
        [],
        "exit continuation independently rejects remote provenance"
    );
    f.w.__ottRemoteInputActive = false;
    confirmation();
    assert.deepEqual(
        f.effects,
        ["legacy-exit"],
        "local confirmation still works"
    );
}

// Direct language-cancel, menu-restart and native legacy sinks cannot bypass
// typed capability dispatch, including native exits that start async work.
const indexAst = ts.createSourceFile(
    "index.ts",
    fs.readFileSync("src/index.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const nativeAssignments = [];
function collectNative(node) {
    if (
        ts.isBinaryExpression(node) &&
        node.left.getText(indexAst) === "window.stbExit" &&
        ts.isFunctionExpression(node.right)
    )
        nativeAssignments.push(node.getText(indexAst));
    ts.forEachChild(node, collectNative);
}
collectNative(indexAst);
assert.equal(nativeAssignments.length, 2);
const sinkSources = [
    sourceFunction("src/core/index.ts", "stbExit"),
    sourceFunction("src/provider/index.ts", "restart"),
    ...nativeAssignments,
    "export " + sourceFunction("devices/legacy-core.js", "stbExit"),
];
const webosAst = ts.createSourceFile(
    "webos.js",
    fs.readFileSync("devices/lg/webos/device.js", "utf8"),
    ts.ScriptTarget.Latest,
    true
);
sinkSources.push(
    webosAst.statements
        .find(
            (node) =>
                ts.isExpressionStatement(node) &&
                ts.isBinaryExpression(node.expression) &&
                node.expression.left.getText(webosAst) === "window.stbExit"
        )
        .getText(webosAst)
);
for (const [index, source] of sinkSources.entries()) {
    const f = fixture();
    const unexpected = () => f.effects.push("lifecycle");
    f.w.close = unexpected;
    f.w.stbStop = unexpected;
    f.w.setTimeout = unexpected;
    f.w.location = { href: "https://player.example", reload: unexpected };
    f.w.Capacitor = {
        Plugins: {
            App: {
                exitApp: () => {
                    unexpected();
                    return Promise.resolve();
                },
            },
        },
    };
    const api = isolated(source, {
        _baseWebosExit: unexpected,
        _webosBackActive: true,
        _webosBackDepth: 3,
        body_onUnload: unexpected,
        console,
        setCoreDemoMute: unexpected,
        stbStop: unexpected,
        tauriInvoke: () => {
            unexpected();
            return { catch() {} };
        },
        window: f.w,
    });
    f.w.keyHandler = api.stbExit || api.restart || f.w.stbExit;
    f.run("input", { key: "up" }).effect();
    assert.deepEqual(
        f.effects,
        [],
        "actual lifecycle sink " + index + " blocks remote key provenance"
    );
    assert.equal(f.w.__ottRemoteInputActive, undefined);
    f.w.keyHandler();
    assert.ok(
        f.effects.length > 0,
        "local lifecycle sink " + index + " remains functional"
    );
}
{
    const f = fixture();
    f.w.keyHandler = () => {
        assert.equal(f.w.__ottRemoteInputActive, true);
        throw new Error("UI failure");
    };
    assert.throws(f.run("input", { key: "up" }).effect, /UI failure/);
    assert.equal(
        f.w.__ottRemoteInputActive,
        undefined,
        "throw cannot retain remote provenance"
    );
    f.lock(true);
    assert.equal(f.run("input", { key: "menu" }).result.status, "rejected");
    assert.equal(f.run("input", { key: "volume_down" }).result.status, "ok");
}
console.log(
    "PASS real lifecycle sinks: local-only exit confirmation, language cancel, menu restart, Tauri/Capacitor/LG/legacy exit fencing and exception-safe provenance"
);

{
    const f = fixture();
    const owner = { model: {} };
    f.w._ = (value) => value;
    f.w.__ottClassicScreenPort.listOwner = () => owner;
    f.w.showPage = () => {
        f.w.isListVisible = true;
    };
    const manage = indexAst.statements.find(
        (node) =>
            ts.isExpressionStatement(node) &&
            ts.isBinaryExpression(node.expression) &&
            node.expression.left.getText(indexAst) === "window.settingsManage"
    );
    isolated(manage.getText(indexAst), {
        accessMediaPlugin: () => null,
        document: { getElementById: () => null },
        isPlayDistribution: () => false,
        window: f.w,
    });
    f.w.settingsManage();
    assert.equal(
        owner.model.localOnlyInput,
        true,
        "actual Manage settings producer owns local-only admission"
    );
    f.w.__ottClassicScreenPort.screens.current = () => ({ model: {} });
    assert.equal(
        f.run("input", { key: "ok" }).result.status,
        "rejected",
        "a modal confirmation above local-only management cannot be consumed remotely"
    );
}
for (const name of ["exportSettingsUI", "importSettingsUI"]) {
    const f = fixture();
    f.w.exportSettings = f.w.importSettings = () =>
        assert.fail("private settings cannot be transferred remotely");
    const api = isolated(sourceFunction("src/settings/transfer-ui.ts", name), {
        window: f.w,
    });
    f.w.keyHandler = api[name];
    f.run("input", { key: "ok" }).effect();
    assert.equal(f.w.__ottRemoteInputActive, undefined);
}
console.log(
    "PASS private transfer boundaries: real Manage settings owner protects child dialogs and import/export refuse remote initiation"
);
