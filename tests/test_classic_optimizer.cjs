const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const vm = require("node:vm");
const { parse } = require("acorn");
const {
    classicOptimizerMetadata,
    optimizeClassic,
} = require("../scripts/classic-optimizer.cjs");

let count = 0;
async function test(name, source, exercise) {
    const optimized = await optimizeClassic(source);
    parse(optimized.code, { ecmaVersion: 5, sourceType: "script" });
    for (const code of [source, optimized.code]) {
        const context = vm.createContext({});
        context.window = context;
        vm.runInContext(code, context);
        exercise(context);
    }
    count++;
    console.log("PASS classic optimizer: " + name);
    return optimized;
}

async function main() {
    await test(
        "later scripts mutate state, replace callbacks and add providers",
        `var playerMode = 0;
        var settings = { volume: 10 };
        var providerState;
        function getMode() { return playerMode; }
        function getVolume() { return settings.volume; }
        function playChannel(id) { return "initial:" + id; }
        function invokePlayback(id) { return playChannel(id); }
        function getProvider() { return providerState; }
        function lateProvider(id) { return providerLoadedLater(id); }
        function unusedPublicCallback(id) { return "late:" + id; }`,
        (context) => {
            assert.equal(context.getMode(), 0);
            vm.runInContext(
                `playerMode = 2; settings.volume = 35;
                playChannel = function(id) { return "provider:" + id; };
                providerState = { ready: true };
                function providerLoadedLater(id) { return "loaded:" + id; }`,
                context
            );
            assert.equal(context.getMode(), 2);
            assert.equal(context.getVolume(), 35);
            assert.equal(context.invokePlayback("news"), "provider:news");
            assert.equal(context.getProvider().ready, true);
            assert.equal(context.lateProvider("sport"), "loaded:sport");
            assert.equal(context.unusedPublicCallback("film"), "late:film");
            context.settings = { volume: 70 };
            assert.equal(context.getVolume(), 70);
        }
    );
    await test(
        "escaped closures and reentrant host callbacks observe live bindings",
        `var channelIndex = 1;
        var getListItemFn = function(id) { return "initial:" + id; };
        function createLegacyCallback(register) {
            var callbackCount = 0;
            register(function legacyCallback() {
                callbackCount++;
                return [callbackCount, channelIndex, getListItemFn(channelIndex)];
            });
        }
        function inspectAfterHostCall(hostCall) {
            var previousChannel = channelIndex;
            hostCall();
            return [previousChannel, channelIndex, getListItemFn(channelIndex)];
        }`,
        (context) => {
            let callback;
            context.createLegacyCallback((value) => {
                callback = value;
            });
            assert.equal(callback.name, "legacyCallback");
            assert.deepEqual(Array.from(callback()), [1, 1, "initial:1"]);
            const after = context.inspectAfterHostCall(() => {
                context.channelIndex = 4;
                context.getListItemFn = (id) => "provider:" + id;
            });
            assert.deepEqual(Array.from(after), [1, 4, "provider:4"]);
            assert.deepEqual(Array.from(callback()), [2, 4, "provider:4"]);
        }
    );
    await test(
        "callback names, arity, receiver, arguments and menu identities survive",
        `function createMenu() {
            function showSettings(unusedEvent, unusedState) { return this.label; }
            var selectChannel = function(unusedEvent, unusedState, unusedMode) {
                return arguments.length;
            };
            return { showSettings: showSettings, selectChannel: selectChannel };
        }
        var menu = createMenu();
        function publicCallback(event, unusedState, unusedMode) { return event; }`,
        (context) => {
            const { menu } = context;
            assert.equal(menu.showSettings.name, "showSettings");
            assert.equal(menu.selectChannel.name, "selectChannel");
            assert.equal(menu.showSettings.length, 2);
            assert.equal(menu.selectChannel.length, 3);
            assert.equal(context.publicCallback.name, "publicCallback");
            assert.equal(context.publicCallback.length, 3);
            assert.equal(
                menu.showSettings.call({ label: "Settings" }),
                "Settings"
            );
            assert.equal(menu.selectChannel(1), 1);
            assert.equal(menu.selectChannel(1, 2, 3, 4), 4);
            const hidden = ["showSettings"];
            assert.equal(hidden.indexOf(menu.showSettings.name), 0);
        }
    );
    await test(
        "direct eval keeps lexical names; dynamic code keeps classic globals",
        `var globalChannel = "first";
        function directLookup(value) {
            var localChannelName = value;
            return eval("localChannelName");
        }
        function indirectLookup() { return (0, eval)("globalChannel"); }
        function dynamicLookup() { return new Function("return globalChannel")(); }
        function withLookup(nativeState) {
            var currentChannelName = "fallback";
            with (nativeState) { return currentChannelName; }
        }
        function legacyLookup() { return window["directLookup"]("legacy"); }`,
        (context) => {
            assert.equal(context.directLookup("local"), "local");
            assert.equal(context.legacyLookup(), "legacy");
            context.globalChannel = "changed";
            assert.equal(context.indirectLookup(), "changed");
            assert.equal(context.dynamicLookup(), "changed");
            assert.equal(context.withLookup({}), "fallback");
            assert.equal(
                context.withLookup({ currentChannelName: "native" }),
                "native"
            );
        }
    );
    await test(
        "host getters and externally replaceable methods retain side effects",
        `var reads = 0;
        var nativePlayer = {};
        Object.defineProperty(nativePlayer, "status", {
            get: function() { reads++; return "playing"; }
        });
        function observePlayer() { nativePlayer.status; return reads; }
        function readMissing() { return unknownNativeBridge.status; }
        function optionalBridge() { return typeof optionalNativeBridge; }
        function channelText(value) { return value.toString(); }`,
        (context) => {
            assert.equal(context.observePlayer(), 1);
            assert.equal(context.observePlayer(), 2);
            assert.throws(() => context.readMissing(), /unknownNativeBridge/);
            assert.equal(context.optionalBridge(), "undefined");
            context.optionalNativeBridge = {};
            assert.equal(context.optionalBridge(), "object");
            assert.equal(
                context.channelText({ toString: () => "provider" }),
                "provider"
            );
        }
    );
    await test(
        "hoisted globals, startup ordering and sloppy-script receiver are preserved",
        `var firstUse = getInitialChannel();
        var laterValue = "ready";
        if (false) { var externalFutureState = 1; }
        for (var startupIndex = 0; startupIndex < 2; startupIndex++) {}
        function getInitialChannel() { return laterValue; }
        function getReceiver() { return this; }
        function readFutureState() { return externalFutureState; }`,
        (context) => {
            assert.equal(context.firstUse, undefined);
            assert.equal(context.getInitialChannel(), "ready");
            assert.equal(context.startupIndex, 2);
            assert.equal(context.getReceiver().window, context.window);
            assert.equal(context.readFutureState(), undefined);
            context.externalFutureState = "provided";
            assert.equal(context.readFutureState(), "provided");
        }
    );
    const measured = await test(
        "local optimization shrinks code while preserving public entry points",
        `function calculateProgress(currentPosition, programmeStart, programmeEnd) {
            var boundedProgrammeDuration = programmeEnd - programmeStart;
            var elapsedProgrammeDuration = currentPosition - programmeStart;
            var currentProgrammePercentage = elapsedProgrammeDuration / boundedProgrammeDuration * 100;
            if (false) { throw new Error("unreachable programme branch"); }
            return Math.max(0, Math.min(100, currentProgrammePercentage));
        }`,
        (context) => {
            assert.equal(context.calculateProgress(25, 0, 100), 25);
            assert.equal(context.calculateProgress(-1, 0, 100), 0);
            assert.equal(context.calculateProgress(101, 0, 100), 100);
        }
    );
    assert(measured.report.outputBytes < measured.report.inputBytes / 2);
    assert.deepEqual(measured.report.globalNames, ["calculateProgress"]);
    assert.equal(
        measured.report.outputSha256,
        createHash("sha256").update(measured.code).digest("hex")
    );
    assert.equal(measured.report.outputBytes, Buffer.byteLength(measured.code));
    const first = await optimizeClassic('var channel = "Новости";');
    const second = await optimizeClassic('var channel = "Новости";');
    assert.deepEqual(
        first,
        second,
        "Optimizer output and reports are deterministic"
    );
    assert.equal(
        first.report.inputBytes,
        Buffer.byteLength('var channel = "Новости";')
    );
    const metadata = classicOptimizerMetadata();
    metadata.options.mangle.toplevel = true;
    assert.equal(classicOptimizerMetadata().options.mangle.toplevel, false);
    await assert.rejects(
        optimizeClassic("var modern = () => 1;"),
        /Unexpected token/
    );
    await assert.rejects(optimizeClassic(null), /ES5 source string/);
    console.log("Classic optimizer: " + count + " runtime scenarios passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
