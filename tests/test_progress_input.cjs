const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");
const { classicName } = require("./helpers/english-source-fixture.cjs");
const root = path.resolve(__dirname, "..");
const bundle = process.argv[2];
const runtimeName = (name) => (bundle ? classicName(name) : name);
const source = fs.readFileSync(
    bundle || path.join(root, "src/ui/index.ts"),
    "utf8"
);
const ast = ts.createSourceFile(
    bundle || "ui.ts",
    source,
    ts.ScriptTarget.Latest,
    true
);
const names = [
    "uiInit",
    "usesLgPointerInput",
    "virtualTimeshiftProg",
    "_t2",
    "formatClockTime",
].map(runtimeName);
const functions = ast.statements.filter(
    (n) => ts.isFunctionDeclaration(n) && names.includes(n.name.text)
);
assert.equal(functions.length, names.length, "extract actual UI functions");
const code = ts
    .transpileModule(functions.map((n) => n.getText(ast)).join("\n"), {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    })
    .outputText.replace(/^export /gm, "");
acorn.parse(code, { ecmaVersion: 5 });
function fixture(options = {}) {
    const dom = new JSDOM(
        '<link href="1280.css"><div id="progress_div" style="width:200px;height:10px"></div><div id="progress_span"><span></span></div>',
        { runScripts: "outside-only" }
    );
    const w = dom.window,
        calls = [];
    w.eval(fs.readFileSync(path.join(root, "js/jquery-1.11.1.min.js"), "utf8"));
    const oldPosition = w.$.fn.position;
    w.$.fn.position = function () {
        return this[0]?.id === "progress_div"
            ? { left: 10, top: 100 }
            : oldPosition.call(this);
    };
    Object.assign(w, {
        _: (s) => s,
        catIndex: 3,
        channels: { 7: { rec: 2 } },
        curList: [7],
        keys: {},
        list_OnClick() {},
        playArchive: (at) => calls.push(["archive", at]),
        playChannel: (category, index) => calls.push(["live", category, index]),
        playTime: 95,
        playType: -1e11,
        primaryIndex: 0,
        replayFromLiveOffset: (delta) => calls.push(["rewind", delta]),
        showShift: (text) => calls.push(["message", text]),
        stbGetLen: () => 3700,
        stbSetPosTime: (at) => calls.push(["seek", at]),
        ...options,
    });
    // Source uses canonical ports; optimized artifacts retain the provider ABI.
    for (const name of ["channels", "replayFromLiveOffset"])
        w[runtimeName(name)] = w[name];
    w.Date.now = () => 1800000;
    w.console.error = (text) => calls.push(["error", text]);
    w.eval(code);
    w.uiInit();
    const element = w.document.getElementById("progress_div");
    const events = w.$._data(element, "events");
    function send(type, x, fallback = false) {
        const event = {
            clientX: x,
            stopPropagation: () => calls.push(["stop"]),
        };
        if (fallback)
            Object.defineProperty(w, "event", {
                configurable: true,
                value: event,
            });
        return events[type][0].handler.call(
            element,
            fallback ? undefined : event
        );
    }
    return {
        calls,
        clock: (at) => w[runtimeName("formatClockTime")](at),
        close: () => w.close(),
        send,
        w,
    };
}
let passed = 0;
function check(name, options, run) {
    const f = fixture(options);
    try {
        run(f);
        passed++;
        console.log("PASS progress: " + name);
    } finally {
        f.close();
    }
}
for (const kind of ["click", "mouseup"]) {
    for (const [x, at, label] of [
        [-100, 0, "00:00"],
        [10, 0, "00:00"],
        [110, 1850, "30:50"],
        [210, 3700, "1:01:40"],
        [310, 5550, "1:32:30"],
    ]) {
        check(kind + " VOD " + x, {}, ({ calls, send }) => {
            if (kind === "mouseup") send("mousedown", 10);
            send(kind, x);
            assert.deepEqual(calls, [
                ["stop"],
                ["message", ">> " + label + " <<"],
                ["seek", at],
            ]);
        });
    }
    for (const mode of [0, 1000]) {
        check(
            kind + " programme " + mode,
            { _prog100: { time: 1000, time_to: 2000 }, playType: mode },
            ({ calls, send, clock }) => {
                if (kind === "mouseup") send("mousedown", 10);
                send(kind, 110);
                assert.deepEqual(
                    calls,
                    mode
                        ? [
                              ["stop"],
                              ["message", ">> " + clock(1500) + " <<"],
                              ["archive", 1500],
                          ]
                        : [["stop"], ["rewind", 300]]
                );
            }
        );
        check(
            kind + " future programme " + mode,
            { _prog100: { time: 1000, time_to: 2000 }, playType: mode },
            ({ calls, send }) => {
                if (kind === "mouseup") send("mousedown", 10);
                send(kind, 210);
                assert.deepEqual(calls, [
                    ["stop"],
                    ["message", mode ? "Live" : "Restart stream"],
                    ["live", 3, 0],
                ]);
            }
        );
        check(
            kind + " virtual programme " + mode,
            { playType: mode },
            ({ w, calls, send, clock }) => {
                if (kind === "mouseup") send("mousedown", 10);
                send(kind, 110);
                assert.equal(w._prog100.time, -1800);
                assert.equal(w._prog100.time_to, 2700);
                assert.deepEqual(
                    calls,
                    mode
                        ? [
                              ["stop"],
                              ["message", ">> " + clock(450) + " <<"],
                              ["archive", 450],
                          ]
                        : [["stop"], ["rewind", 1350]]
                );
            }
        );
    }
}
check(
    "drag admission is cleared before callbacks and click stays independent",
    {},
    ({ calls, send }) => {
        send("mouseup", 110);
        assert.deepEqual(calls, []);
        send("mousedown", 10);
        send("mouseup", 110);
        send("mouseup", 110);
        send("click", 110);
        assert.equal(calls.filter((c) => c[0] === "seek").length, 2);
    }
);
check(
    "missing client coordinate keeps event-specific diagnostics",
    {},
    ({ calls, send }) => {
        send("mousedown");
        send("mouseup", 110);
        send("click");
        send("mousemove");
        send("mousedown", 10);
        send("mouseup");
        send("mouseup", 110);
        assert.deepEqual(
            calls,
            ["mousedown", "click", "mousemove", "mouseup"].map((type) => [
                "error",
                "$progress_div[" + type + "] evt.clientX not exist",
            ])
        );
    }
);
check("old global event fallback", {}, ({ calls, send }) => {
    send("click", 110, true);
    assert.deepEqual(calls, [
        ["stop"],
        ["message", ">> 30:50 <<"],
        ["seek", 1850],
    ]);
});
for (const channels of [{ 7: { rec: 0 } }, {}, null]) {
    check(
        "live without archive is inert",
        { channels, playType: 0 },
        ({ calls, send }) => {
            send("click", 110);
            send("mousedown", 10);
            send("mouseup", 110);
            send("mousemove", 110);
            assert.deepEqual(calls, [["stop"], ["stop"]]);
        }
    );
}
for (const [mode, programme, position] of [
    [-1e11, undefined, 1850],
    [0, { time: 1000, time_to: 2000 }, 1500],
    [1000, { time: 0, time_to: 1000 }, 500],
    [1000, undefined, 95],
    [0, undefined, 0],
]) {
    check(
        "tooltip " + mode + " " + position,
        { _prog100: programme, playType: mode },
        ({ w, calls, send, clock }) => {
            send("mousemove", 110);
            const text = w.document.querySelector(
                "#progress_span span"
            ).textContent;
            assert.equal(text, mode < 0 ? "30:50" : clock(position));
            assert.equal(
                w.document.getElementById("progress_span").style.display,
                "block"
            );
            assert.equal(
                w._prog100,
                programme,
                "tooltip does not create programme state"
            );
            assert.deepEqual(calls, []);
        }
    );
}
console.log(
    "PASS progress input: " +
        passed +
        " actual uiInit ES5 scenarios" +
        (bundle ? " from " + bundle : "")
);
