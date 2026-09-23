const fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const ts = require("typescript");
function load(file, extra = {}) {
    const box = {
        console,
        Date,
        Error,
        exports: {},
        Request,
        Response,
        TextEncoder,
        Uint8Array,
        URL,
        ...extra,
    };
    box.require = (p) =>
        load(path.resolve(path.dirname(file), p) + ".ts", extra);
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        box,
        { filename: file }
    );
    return box.exports;
}
const fixtures = path.join(__dirname, "fixtures/wire-contracts");
const cmds = JSON.parse(fs.readFileSync(path.join(fixtures, "inputs.json")));
const provider = {
    checkProviderUrl: () => true,
    selectProviderByIndex: () => true,
};
const source = fs.readFileSync(root + "/src/commands/index.ts", "utf8");
const commandBox = {
    console,
    document: { getElementById: () => null },
    exports: {},
    require: (p) =>
        p === "../provider"
            ? provider
            : load(path.resolve(root + "/src/commands", p) + ".ts"),
    URL,
    window: {
        catsArray: [],
        channels: {},
        commandChannelsReady: true,
        curList: [],
        p_pref: "stalker",
        stbExit: () => {},
        stbGetVolume: () => 40,
        stbSetVolume: () => {},
    },
};
vm.runInNewContext(
    ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText,
    commandBox
);
const player = cmds.map((c) => {
    try {
        return {
            name: c.name,
            result: commandBox.exports.handleCommand(JSON.parse(c.body)),
        };
    } catch (e) {
        return { error: e.name, name: c.name };
    }
});
assert.deepEqual(
    player,
    JSON.parse(fs.readFileSync(path.join(fixtures, "before-js.json"))).player
);
const policy = require("./load-wire.cjs")();
for (const v of [NaN, Infinity, -Infinity])
    assert.equal(
        policy.validPlayerCommand({ command: "exit_player", volume: v }),
        false
    );
assert.equal(
    policy.validPlayerCommand(
        Object.assign(Object.create({ message: "inherited" }), {
            command: "popup_message",
        })
    ),
    true
);
assert.equal(
    policy.validPlayerCommand({ command: "popup_message", message: undefined }),
    true
);
assert.equal(
    policy.validCommandEnvelope({ commands: [{ id: "legacy-ID_1" }] }),
    true
);
assert.equal(
    policy.validCommandEnvelope({ commands: [{ id: "a".repeat(128) }] }),
    true
);
assert.equal(
    policy.validCommandEnvelope({ commands: [{ id: "a".repeat(129) }] }),
    false
);
assert.equal(
    policy.validCommandEnvelope({
        commands: Array.from({ length: 256 }, () => ({ id: "a" })),
    }),
    true
);
assert.equal(
    policy.validCommandEnvelope({
        commands: Array.from({ length: 257 }, () => ({ id: "a" })),
    }),
    false
);
console.log(
    "PASS 81 immutable command-handler contracts and ES5/non-JSON/envelope boundaries"
);
