const { settingsSource } = require("./helpers/settings-source-fixture.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");
const { compatibilitySource } = require("./helpers/english-source-fixture.cjs");
const root = path.resolve(__dirname, "..");

function parse(file) {
    return ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
}
function compile(text) {
    const code = ts
        .transpileModule(text, {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.replace(/^export /gm, "");
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
function functions(file, names) {
    const source = parse(file);
    const found = source.statements.filter(
        (node) =>
            ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    );
    assert.equal(found.length, names.length, "All production functions exist");
    return compile(found.map((node) => node.getText(source)).join("\n"));
}
const index = parse("src/index.ts");
function assignment(property) {
    const node = index.statements.find(
        (node) =>
            ts.isExpressionStatement(node) &&
            ts.isBinaryExpression(node.expression) &&
            ts.isPropertyAccessExpression(node.expression.left) &&
            node.expression.left.name.text === property
    );
    assert.ok(node, "Production window assignment exists: " + property);
    return compile(node.getText(index));
}
const ready = index.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "onStbReady"
);
const startup = ready.body.statements.find(ts.isTryStatement).tryBlock
    .statements;
const load = startup.findIndex(
    (node) => node.getText(index) === "loadSettings();"
);
const configure = startup.findIndex((node) =>
    node
        .getText(index)
        .startsWith("(window as any).__ottCommandServer.configure(")
);
assert.ok(
    load >= 0 && configure > load,
    "Startup restores settings before connection consent"
);
const bootSource = compile(
    startup
        .slice(load, configure + 1)
        .map((node) => node.getText(index))
        .join("\n")
);
const controllerSource = functions("src/plugins/command-server.ts", [
    "normalizeCommandServerAddress",
    "createCommandServer",
    "createCommandServerTransport",
]);
const token = "fixture_device_code_" + "a".repeat(40);
const nextToken = "fixture_device_code_" + "b".repeat(40);

function fixture(initial = []) {
    // No resource loader, real requests, device bridge, or user profile exists.
    const dom = new JSDOM(
        '<div id="listCaption">Settings</div><div id="listDetail">Parent</div><div id="listPodval">Footer</div><div id="listEdit" style="display:none"></div><div id="listAbout" style="display:none"></div>',
        { runScripts: "dangerously", url: "http://player.invalid/" }
    );
    const w = dom.window;
    Object.assign(w, require("./load-wire.cjs")());
    const stored = new Map(initial);
    const writes = [];
    const requests = [];
    const delivered = [];
    const jobs = new Map();
    let sequence = 0;
    w.eval(compatibilitySource);
    w.eval(fs.readFileSync(path.join(root, "js/jquery-1.11.1.min.js"), "utf8"));
    const storage = {
        del(name) {
            stored.delete(name);
        },
        get: (name) => stored.get(name) ?? null,
        getI(name, fallback) {
            const value = Number.parseInt(stored.get(name), 10);
            return Number.isNaN(value) ? fallback : value;
        },
        set(name, value) {
            stored.set(name, String(value));
            writes.push([name, String(value)]);
        },
        setI(name, value) {
            this.set(name, value);
        },
    };
    Object.assign(w, {
        _: (value) => value,
        __ottLocalHttpRemote: { init() {}, status: () => ({ enabled: false }) },
        deviceUUID: "fixture-device",
        handleCommand: (command) => delivered.push(command),
        keys: {
            DOWN: 40,
            ENTER: 13,
            EXIT: 8,
            LEFT: 37,
            N2: 50,
            RETURN: 27,
            RIGHT: 39,
            UP: 38,
        },
        listCaptionElement: w.document.getElementById("listCaption"),
        listDetailElement: w.document.getElementById("listDetail"),
        listFooterElement: w.document.getElementById("listPodval"),
        optionsList() {},
        stbSetItem: (name, value) => storage.set(name, value),
        storage,
        ui_state: {},
    });
    w.eval(settingsSource());
    w.eval(
        functions("src/utils/helpers.ts", [
            "metadataText",
            "metadataImageUrl",
            "metadataCssUrl",
            "metadataHtml",
            "hasTmdbService",
        ])
    );
    w.eval(
        functions("src/ui/index.ts", [
            "saveListPanelState",
            "restoreListPanelState",
            "renderButtonHint",
            "showEditKey2",
            "editKey2",
        ])
    );
    w.eval(functions("src/settings/transfer-ui.ts", ["editSettingsText"]));
    w.eval(controllerSource);
    w.XMLHttpRequest = class {
        constructor() {
            this.headers = {};
            this.aborted = false;
        }
        open(method, url) {
            Object.assign(this, { method, url });
        }
        setRequestHeader(name, value) {
            this.headers[name] = value;
        }
        send(body) {
            this.body = body;
            requests.push(this);
        }
        abort() {
            this.aborted = true;
            if (this.onabort) this.onabort();
        }
        respond(body, status = 200) {
            this.status = status;
            this.responseText = JSON.stringify(body);
            this.onload();
        }
    };
    // The production transport/controller use deterministic isolated timers.
    w.setTimeout = (fn, delay) => {
        jobs.set(++sequence, { delay, fn });
        return sequence;
    };
    w.clearTimeout = (id) => jobs.delete(id);
    w.eval(assignment("__ottCommandServer"));
    w.eval(assignment("settingsCommands"));
    w.eval(bootSource);
    const controller = w.__ottCommandServer;
    function open() {
        w.settingsCommands();
    }
    function close() {
        w.aboutKeyHandler(w.keys.RETURN);
    }
    function edit(property, value, cancel = false) {
        w.document
            .getElementById(
                property === "address"
                    ? "commandServerAddress"
                    : "commandServerToken"
            )
            .click();
        const field = w.document.getElementById("editvar");
        assert.ok(field, "Real shared editor is open");
        if (property === "token") assert.equal(field.type, "password");
        field.value = value;
        field.dispatchEvent(
            new w.KeyboardEvent("keydown", {
                bubbles: true,
                key: cancel ? "Escape" : "Enter",
            })
        );
        assert.equal(
            w.document.getElementById("listEdit").style.display,
            "none"
        );
    }
    function destroy() {
        // Release only this fixture's fake timers and detached document.
        jobs.clear();
        dom.window.close();
    }
    return {
        close,
        controller,
        delivered,
        destroy,
        edit,
        jobs,
        open,
        requests,
        stored,
        w,
        writes,
    };
}

for (const first of ["address", "token"]) {
    const h = fixture();
    try {
        h.open();
        const second = first === "address" ? "token" : "address";
        const values = { address: " 192.168.1.20 ", token: " " + token + " " };
        h.edit(first, values[first]);
        assert.equal(
            h.requests.length,
            0,
            "A single field cannot authorize polling"
        );
        assert.equal(h.controller.status().enabled, false);
        assert.match(
            h.w.document.getElementById("commandServerStatus").textContent,
            first === "address" ? /access code/i : /server.*address/i
        );
        h.edit(second, values[second]);
        assert.equal(
            h.requests.length,
            1,
            "Saving the second field starts one request immediately"
        );
        assert.equal(h.requests[0].method, "GET");
        assert.equal(
            h.requests[0].url,
            "http://192.168.1.20:8081/api/webhook/commands?delivery=ack"
        );
        assert.equal(h.requests[0].headers.Authorization, "Bearer " + token);
        assert.equal(h.stored.get("commandServerEnabled"), "1");
        assert.ok(!h.requests[0].url.includes(token));
        assert.ok(
            !h.w.document
                .getElementById("listAbout")
                .textContent.includes(token)
        );
        assert.ok(!JSON.stringify(h.controller.status()).includes(token));
        assert.equal(
            h.w.document.getElementById("commandServerConnectLabel")
                .textContent,
            "Disconnect"
        );
        assert.deepEqual(
            h.writes.slice(-4),
            [
                ["commandServerEnabled", "0"],
                [
                    "commandServerAddress",
                    "http://192.168.1.20:8081/api/webhook/commands",
                ],
                ["commandServerToken", token],
                ["commandServerEnabled", "1"],
            ],
            "The real persist callback revokes before saving connection consent"
        );

        const generation = h.controller.status().generation;
        const writesBeforeNoop = h.writes.length;
        h.edit("address", "192.168.1.20:8081/");
        h.edit("token", "  " + token + "  ");
        h.edit("address", "cancelled.invalid", true);
        h.close();
        h.open();
        assert.equal(
            h.requests.length,
            1,
            "Equivalent edits, cancel and reopening do not reconnect"
        );
        assert.equal(h.controller.status().generation, generation);
        assert.equal(h.writes.length, writesBeforeNoop);
        assert.equal(h.requests[0].aborted, false);

        h.edit("address", "192.168.1.21");
        assert.equal(h.requests.length, 2);
        assert.equal(h.requests[0].aborted, true);
        assert.equal(h.requests[1].headers.Authorization, "Bearer " + token);
        assert.match(h.requests[1].url, /^http:\/\/192\.168\.1\.21:8081\//);
        h.requests[0].respond({
            commands: [{ command: "exit_player", id: "old-address" }],
        });
        assert.equal(
            h.delivered.length,
            0,
            "Old-address completion cannot dispatch after editing"
        );
        h.edit("token", nextToken);
        assert.equal(
            h.requests.length,
            3,
            "An access-code change reconnects once"
        );
        assert.equal(h.requests[1].aborted, true);
        assert.equal(
            h.requests[2].headers.Authorization,
            "Bearer " + nextToken
        );
        h.requests[1].respond({
            commands: [{ command: "exit_player", id: "old-token" }],
        });
        assert.equal(h.delivered.length, 0);

        const persisted = [...h.stored];
        const resumed = fixture(persisted);
        try {
            assert.equal(
                resumed.requests.length,
                1,
                "Actual settings load and boot configure resume saved consent"
            );
            assert.equal(
                resumed.requests[0].headers.Authorization,
                "Bearer " + nextToken
            );
            assert.equal(resumed.controller.status().enabled, true);
        } finally {
            resumed.destroy();
        }

        h.w.document.getElementById("commandServerConnect").click();
        assert.equal(h.controller.status().enabled, false);
        assert.equal(h.requests[2].aborted, true);
        assert.equal(h.stored.get("commandServerEnabled"), "0");
        const disconnectedGeneration = h.controller.status().generation;
        h.close();
        h.open();
        h.edit("address", "http://192.168.1.21:8081/");
        h.edit("token", " " + nextToken + " ");
        h.edit("token", token, true);
        assert.equal(h.controller.status().enabled, false);
        assert.equal(h.controller.status().generation, disconnectedGeneration);
        assert.equal(h.requests.length, 3);
        const disconnected = fixture([...h.stored]);
        try {
            assert.equal(
                disconnected.requests.length,
                0,
                "Explicit Disconnect survives persisted startup"
            );
            assert.equal(disconnected.controller.status().enabled, false);
        } finally {
            disconnected.destroy();
        }
        h.w.document.getElementById("commandServerConnect").click();
        assert.equal(
            h.requests.length,
            4,
            "Explicit Connect can resume the unchanged configuration"
        );
        assert.equal(h.controller.status().enabled, true);
        h.w.document.getElementById("commandServerConnect").click();
        h.edit("address", "192.168.1.22");
        assert.equal(
            h.requests.length,
            5,
            "A changed valid configuration resumes after Disconnect"
        );
        h.edit("address", "   ");
        assert.equal(h.controller.status().enabled, false);
        assert.equal(h.requests[4].aborted, true);
        assert.equal(h.requests.length, 5);
        assert.equal(
            h.jobs.size,
            0,
            "Clearing the address retires all request and retry timers"
        );
        assert.equal(h.stored.get("commandServerAddress"), "");
        assert.equal(h.stored.get("commandServerEnabled"), "0");
        h.requests[4].respond({
            commands: [{ command: "exit_player", id: "cleared" }],
        });
        assert.equal(h.delivered.length, 0);
        h.edit("address", "192.168.1.22");
        assert.equal(h.requests.length, 6);
        h.edit("token", "");
        assert.equal(h.requests.length, 6);
        assert.equal(h.requests[5].aborted, true);
        assert.equal(h.controller.status().enabled, false);
    } finally {
        h.destroy();
    }
}

for (const invalid of [
    { address: "https://host?token=secret", token },
    { address: "192.168.1.20", token: "short" },
]) {
    const h = fixture();
    try {
        h.open();
        h.edit("address", invalid.address);
        h.edit("token", invalid.token);
        assert.equal(
            h.requests.length,
            0,
            "Invalid complete credentials never send requests"
        );
        assert.equal(h.controller.status().state, "error");
        assert.equal(h.stored.get("commandServerEnabled"), "0");
        assert.notEqual(
            h.w.document.getElementById("commandServerStatus").textContent,
            "Disconnected"
        );
        h.edit("address", "192.168.1.20");
        h.edit("token", token);
        assert.equal(
            h.requests.length,
            1,
            "Correcting the invalid field connects without a separate button"
        );
        h.requests[0].respond({}, 401);
        assert.equal(h.controller.status().state, "error");
        assert.match(
            h.w.document.getElementById("commandServerStatus").textContent,
            /access code/i
        );
        const retryTimers = [...h.jobs.keys()];
        const retryGeneration = h.controller.status().generation;
        h.edit("address", "192.168.1.20:8081/");
        h.edit("token", " " + token + " ");
        assert.equal(
            h.requests.length,
            1,
            "No-op edits preserve an existing retry instead of polling again"
        );
        assert.deepEqual([...h.jobs.keys()], retryTimers);
        assert.equal(h.controller.status().generation, retryGeneration);
        assert.equal(h.controller.status().state, "error");
    } finally {
        h.destroy();
    }
}
console.log(
    "PASS command settings: real ES5 UI/controller/transport, authenticated auto-connect, no-op saves, revocation and persisted explicit disconnect"
);
