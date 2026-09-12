const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require(require.resolve("typescript", { paths: [process.cwd()] }));
const source = fs.readFileSync(
    process.argv[2] || path.join(__dirname, "../src/index.ts"),
    "utf8"
);
const marker = "// Mode B only: Tauri updater check";
assert(source.includes(marker));
const code = ts.transpileModule(source.slice(source.indexOf(marker)), {
    compilerOptions: {
        module: ts.ModuleKind.ES2015,
        target: ts.ScriptTarget.ES2020,
    },
}).outputText;
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(options = {}) {
    const calls = [],
        confirmations = [],
        notices = [],
        errors = [];
    const window = {
        alert: () => {
            throw new Error("Native alert must not be used");
        },
        confirm: () => {
            throw new Error("Native confirm must not be used");
        },
    };
    if (!options.browser)
        window.__TAURI__ = { core: { Channel: class Channel {} } };
    if (options.noChannel) delete window.__TAURI__.core.Channel;
    if (options.relaunch)
        window.__TAURI__.process = { relaunch: options.relaunch };
    vm.runInNewContext(code, {
        confirmBox: (message, yes, no) =>
            confirmations.push({ message, no, yes }),
        console: { debug: (...args) => errors.push(args) },
        infoBox: (message) => notices.push(message),
        tauriInvoke: async (command, args) => {
            calls.push({ args, command });
            if (command === "plugin:updater|check")
                return options.noUpdate ? null : { rid: 42, version: "1.1.41" };
            if (options.installFails) throw new Error("Download failed");
        },
        window,
    });
    return { calls, confirmations, errors, notices };
}
(async () => {
    const pending = fixture();
    await settle();
    assert.equal(
        pending.calls.length,
        1,
        "Installation must wait for explicit confirmation"
    );
    assert.equal(pending.confirmations.length, 1);
    pending.confirmations[0].no();
    await settle();
    assert.equal(pending.calls.length, 1, "Cancellation must not install");
    const accepted = fixture();
    await settle();
    accepted.confirmations[0].yes();
    await settle();
    assert.equal(
        accepted.calls[1].command,
        "plugin:updater|download_and_install"
    );
    assert.equal(accepted.calls[1].args.rid, 42);
    assert.equal(typeof accepted.calls[1].args.onEvent, "object");
    assert.deepEqual(accepted.notices, [
        "Update installed. Please restart OttPlay FOSS.",
    ]);
    let restarted = 0;
    const restart = fixture({
        relaunch: async () => {
            restarted++;
        },
    });
    await settle();
    restart.confirmations[0].yes();
    await settle();
    assert.equal(restarted, 1);
    assert.equal(restart.notices.length, 0);
    const restartFailure = fixture({
        relaunch: async () => {
            throw new Error("Unavailable");
        },
    });
    await settle();
    restartFailure.confirmations[0].yes();
    await settle();
    assert.equal(restartFailure.notices.length, 1);
    for (const option of [{ installFails: true }, { noChannel: true }]) {
        const failed = fixture(option);
        await settle();
        failed.confirmations[0].yes();
        await settle();
        assert.equal(
            failed.notices.length,
            0,
            "Never report a failed installation as installed"
        );
        assert.equal(failed.errors.length, 1);
    }
    const noUpdate = fixture({ noUpdate: true });
    await settle();
    assert.equal(noUpdate.confirmations.length, 0);
    const browser = fixture({ browser: true });
    await settle();
    assert.equal(browser.calls.length, 0);
    console.log("Tauri updater DOM dialog contracts passed (8 scenarios)");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
