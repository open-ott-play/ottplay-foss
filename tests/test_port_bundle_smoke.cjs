const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");

// No network requests or timer callbacks are run. This checks script loading and
// wiring against a minimal DOM, not media decoding or a full browser UI session.
const bundlePath = path.resolve(process.argv[2] || path.join(__dirname, "../dist/stbPlayer.js"));
const bundle = fs.readFileSync(bundlePath, "utf8");
const globalNames = new Set();
function collectGlobals(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "FunctionDeclaration") { globalNames.add(node.id.name); return; }
    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") return;
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") globalNames.add(node.id.name);
    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach(collectGlobals);
        else if (child && typeof child === "object") collectGlobals(child);
    }
}
collectGlobals(acorn.parse(bundle, { ecmaVersion: 5 }));

function fixture(profile) {
    const elements = new Map();
    const listeners = [];
    let timerId = 0;
    const timers = new Map();
    function element(name) {
        if (elements.has(name)) return elements.get(name);
        const e = {
            id: name, tagName: name.toUpperCase(), nodeType: 1,
            style: {}, children: [], childNodes: [], attributes: {},
            innerHTML: "", textContent: "", value: "", offsetWidth: 1280, offsetHeight: 720,
            clientWidth: 1280, clientHeight: 720, scrollTop: 0,
            appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
            removeChild(child) { this.children = this.children.filter((x) => x !== child); return child; },
            insertBefore(child) { return this.appendChild(child); },
            setAttribute(key, value) { this.attributes[key] = String(value); },
            getAttribute(key) { return this.attributes[key] || null; },
            removeAttribute(key) { delete this.attributes[key]; },
            addEventListener(...args) { listeners.push([name, ...args]); },
            removeEventListener() {}, dispatchEvent() { return true; },
            getElementsByTagName() { return []; }, querySelectorAll() { return []; },
            focus() {}, blur() {}, click() {},
            getBoundingClientRect() { return { top: 0, left: 0, bottom: 720, right: 1280, width: 1280, height: 720 }; },
            classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        };
        elements.set(name, e);
        return e;
    }
    const document = {
        body: element("body"), head: element("head"), documentElement: element("html"),
        readyState: "complete", cookie: "", title: "", activeElement: null,
        getElementById: (id) => element(id),
        createElement: (tag) => element(tag),
        getElementsByTagName: (tag) => tag === "head" ? [element("head")] : [],
        querySelector: () => null, querySelectorAll: () => [],
        addEventListener(...args) { listeners.push(["document", ...args]); },
        removeEventListener() {},
    };
    function jquery(selector) {
        const el = typeof selector === "string" ? element(selector.replace(/^#/, "")) : selector || element("body");
        const chain = {
            0: el, length: 1,
            is: () => false, width: () => 1280, height: () => 720,
            position: () => ({ top: 0, left: 0 }), offset: () => ({ top: 0, left: 0 }),
            val(value) { return arguments.length ? this : ""; },
            text(value) { return arguments.length ? this : ""; },
            html(value) { return arguments.length ? this : ""; },
            css() { return arguments.length > 1 || typeof arguments[0] === "object" ? this : ""; },
            get(i) { return i === undefined ? [el] : el; },
            each(callback) { callback.call(el, 0, el); return this; },
        };
        for (const name of ["on", "off", "bind", "unbind", "click", "ready", "show", "hide", "toggle",
            "append", "prepend", "appendTo", "remove", "empty", "attr", "removeAttr", "addClass", "removeClass",
            "toggleClass", "find", "children", "parent", "eq", "first", "last", "focus", "blur", "trigger",
            "scrollTop", "animate", "stop", "fadeIn", "fadeOut", "prop", "data"]) {
            chain[name] = function () { return this; };
        }
        return chain;
    }
    jquery.extend = Object.assign;
    jquery.isArray = Array.isArray;
    jquery.parseJSON = JSON.parse;
    jquery.each = (object, fn) => Object.keys(object).forEach((key) => fn(key, object[key]));
    jquery.ajax = () => ({ abort() {} });
    jquery.get = jquery.post = jquery.getJSON = jquery.ajax;
    const storage = {};
    const w = {
        document, navigator: { userAgent: "Legacy STB smoke", language: "en", platform: "STB", onLine: true },
        screen: { width: 1280, height: 720, availWidth: 1280, availHeight: 720 },
        location: { protocol: "http:", origin: "http://localhost", host: "localhost", hostname: "localhost", pathname: "/", search: "", hash: "", href: "http://localhost/" },
        localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; }, clear: () => { for (const key of Object.keys(storage)) delete storage[key]; } },
        console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
        $: jquery, jQuery: jquery, innerWidth: 1280, innerHeight: 720,
        setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
        clearInterval(id) { timers.delete(id); },
        addEventListener(...args) { listeners.push(["window", ...args]); }, removeEventListener() {},
        alert() {}, confirm: () => false, open() {}, close() {}, focus() {},
        getComputedStyle: () => ({ getPropertyValue: () => "", display: "block" }),
        __cv: "smoke", __av: "smoke", ott_device: "pc", deviceUUID: "smoke-device", host_ott: "http://localhost",
    };
    if (profile === "capacitor-fallback") w.Capacitor = { Plugins: {} };
    if (profile === "capacitor-native") {
        w.Capacitor = { Plugins: {
            MobileNativeMedia: { getVolume: () => Promise.resolve({ ok: true, volume: 37 }) },
            DashExoPlayer: { isDashSupported: () => Promise.resolve({ ok: true }) },
        } };
    }
    w.window = w; w.self = w; w.globalThis = w;
    // Browsers create nonconfigurable Window properties for global var/function
    // declarations. Node's contextified sandbox can otherwise allow accessors to
    // replace an uninitialized declaration, producing a VM-only recursion.
    for (const name of globalNames) {
        Object.defineProperty(w, name, {
            configurable: false, enumerable: true, writable: true, value: w[name],
        });
    }
    vm.createContext(w);
    if (profile === "legacy") {
        vm.runInContext(`
            Promise = undefined; Map = undefined; Set = undefined; WeakMap = undefined;
            WeakSet = undefined; Symbol = undefined; Reflect = undefined; Proxy = undefined;
            Number.isFinite = undefined; Number.isNaN = undefined; Number.isInteger = undefined;
            Number.parseInt = undefined; Number.parseFloat = undefined; Object.assign = undefined;
            String.prototype.includes = undefined; String.prototype.startsWith = undefined;
            String.prototype.endsWith = undefined; String.prototype.repeat = undefined;
            Array.prototype.findIndex = undefined; Array.prototype.find = undefined;
            Array.prototype.includes = undefined; Array.from = undefined;
            Object.entries = undefined; Object.values = undefined;
            TextEncoder = undefined; performance = undefined;
        `, w);
    }
    return w;
}

async function main() {
    for (const profile of ["legacy", "modern", "capacitor-fallback", "capacitor-native"]) {
        const w = fixture(profile);
        try {
            vm.runInContext(bundle, w, { filename: bundlePath, timeout: 5000 });
        } catch (error) {
            throw new Error(profile + " bundle execution failed: " + error.message, { cause: error });
        }
        for (const name of ["startPlayer", "stbInit", "stbPlay", "stbStop", "keyHandler", "playArchive", "playChannel", "playMedia", "showSelectBox", "handleCommand", "settingsCommands", "resolveNativePlugin"]) {
            assert.equal(typeof w[name], "function", profile + ": missing global " + name);
        }
        assert.ok(w.optionsArr.some((item) => item.name === "Remote control" && item.action === w.settingsCommands),
            profile + ": final options wiring must execute");
        assert.equal(Array.isArray(w.listDataArray), true, profile + ": listDataArray must remain an array");
        for (const name of ["listKeyHandlerFn", "getListItemFn", "detailListActionFn", "aboutKeyHandler"]) {
            assert.ok(w[name] === null || typeof w[name] === "function", profile + ": callback " + name + " has been replaced with a wrapper object");
        }
        const callback = function () { return true; };
        w.listKeyHandler = callback;
        assert.equal(w.listKeyHandlerFn, callback, profile + ": public list callback must reach its backing global");
        w.listKeyHandlerFn = null;
        assert.equal(w.listKeyHandler, null, profile + ": reverse list callback alias must stay synchronized");
        w.getListItemFn = callback;
        assert.equal(w.getListItem, callback, profile + ": item renderer alias must stay synchronized");
        w.detailListAction = callback;
        assert.equal(w.detailListActionFn, callback, profile + ": detail callback alias must stay synchronized");
        for (const name of ["MobileNativeMedia", "DashExoPlayer", "M3UProxy", "StalkerPortal"]) {
            assert.equal(typeof w[name], "object", profile + ": missing native bridge " + name);
        }
        vm.runInContext(`
            if (typeof Number.isFinite !== "function" || !Number.isFinite(2) || Number.isFinite("2")) throw Error("Number polyfills");
            if (Object.assign({}, { x: 1 }).x !== 1 || !"abc".includes("b")) throw Error("Object/String polyfills");
            if ([4, 5].findIndex(function (n) { return n === 5; }) !== 1) throw Error("Array polyfill");
        `, w);
        if (profile === "legacy") {
            assert.equal(w.Promise, undefined, "generic STB startup must not require Promise");
        } else {
            const dash = await w.DashExoPlayer.isDashSupported();
            const media = await w.MobileNativeMedia.getVolume();
            if (profile === "capacitor-native") {
                assert.equal(w.MobileNativeMedia, w.Capacitor.Plugins.MobileNativeMedia);
                assert.equal(w.DashExoPlayer, w.Capacitor.Plugins.DashExoPlayer);
                assert.equal(dash.ok, true);
                assert.equal(media.volume, 37);
            } else {
                assert.equal(dash.ok, false); assert.equal(dash.unsupported, true);
                assert.equal(media.ok, false); assert.equal(media.unsupported, true);
            }
        }
        console.log("OK: actual classic bundle " + profile + " profile, globals and native bridges");
    }
}
main().catch((error) => {
    console.error(error.message);
    if (error.cause) console.error(String(error.cause.stack).split("\n").slice(-8).join("\n"));
    process.exitCode = 1;
});
