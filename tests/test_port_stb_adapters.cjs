const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");

const adapters = ["android", "dune", "mag", "spark", "lg/webos", "samsung/tizen", "samsung/maple"];
for (const adapter of adapters) {
    const file = path.join(__dirname, "..", "stb", adapter, "stb.js");
    const code = fs.readFileSync(file, "utf8");
    acorn.parse(code, { ecmaVersion: 5 });
    for (const result of [undefined, true, false, { then() {} }]) {
        const calls = [];
        const callbacks = [];
        let readyCalls = 0;
        const deviceCalls = [];
        const w = {
            version: "test",
            console: { log() {} },
            stb: { getMacAddress: () => "base-mac" },
            Android: {}, Dune: {}, STB: {}, tizen: {}, Common: { API: {} },
            gSTB: { GetMACAddress: () => "device-mac" },
            webOS: {
                system: { hideSplashScreen: () => deviceCalls.push("splash") },
                device: { cursorVisible: () => deviceCalls.push("cursor") },
                platform: { setWindowOrientation: () => deviceCalls.push("orientation") },
                app: { requestWindowFocus: () => deviceCalls.push("focus") },
            },
            onStbReady() { readyCalls++; },
            stbInit() {
                calls.push({ receiver: this, args: Array.from(arguments) });
                if (result === false) callbacks.push(() => w.onStbReady());
                return result;
            },
        };
        w.window = w;
        vm.createContext(w);
        const originalInit = w.stbInit;
        vm.runInContext(code, w, { filename: file });
        assert.notEqual(w.stbInit, originalInit, adapter + " installs its wrapper");
        assert.equal(calls.length, 0, adapter + " must not initialize while loading");
        const receiver = { name: "caller" };
        const actual = w.stbInit.call(receiver, "argument");
        assert.equal(calls.length, 1, adapter + " must call the original initializer once");
        assert.equal(calls[0].receiver, receiver);
        assert.deepEqual(calls[0].args, ["argument"]);
        assert.equal(actual, result, adapter + " must preserve false/async return contracts");
        assert.equal(readyCalls, 0, adapter + " must not finish an asynchronous initializer early");
        callbacks.forEach((callback) => callback());
        assert.equal(readyCalls, result === false ? 1 : 0);
        if (adapter === "mag") assert.equal(w.stb.getMacAddress(), "device-mac");
        if (adapter === "lg/webos") {
            assert.deepEqual(deviceCalls, ["splash", "cursor", "orientation", "focus"]);
        }
    }
    // Native platform APIs are optional; an absent API must retain the base result too.
    const w = { version: "test", stb: { getMacAddress: () => "base-mac" }, stbInit: () => false };
    w.window = w;
    vm.createContext(w);
    vm.runInContext(code, w, { filename: file });
    assert.equal(w.stbInit(), false, adapter + " must preserve deferred init without platform APIs");
}
console.log("OK: seven ES5 device adapters call base init once and preserve deferred readiness");
