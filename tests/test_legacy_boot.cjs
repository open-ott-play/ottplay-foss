const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), match => match[1]);
assert(scripts.length > 0, "The real HTML boot script must be exercised");

function boot(options = {}) {
    const requests = [];
    const storage = options.storage || {};
    const elements = {};
    let starts = 0;
    let context;
    const document = {
        body: { className: "booting", style: {} },
        getElementById(id) {
            return elements[id] ||= { textContent: "", style: {}, getAttribute() { return null; } };
        },
        createElement(tagName) { return { tagName, style: {} }; },
        getElementsByTagName() { return [this.head]; },
    };
    document.head = {
        appendChild(tag) {
            if (tag.tagName !== "script") return;
            requests.push(tag.src);
            if (options.cdnFailure && tag.src.indexOf("cdn.jsdelivr.net") !== -1) {
                tag.onerror(new Error("TLS/network unavailable"));
                return;
            }
            if (tag.src.indexOf("jquery-1.11.1.min.js") !== -1) context.jQuery = {};
            else if (tag.src.indexOf("hls.min.js") !== -1) {
                if (!(options.cdnMissingGlobal && tag.src.indexOf("cdn.jsdelivr.net") !== -1))
                    context.Hls = function Hls() {};
            } else if (tag.src.indexOf("shaka-player.compiled.js") !== -1)
                context.shaka = { Player() {} };
            else if (tag.src.indexOf("/dist/stbPlayer.js?") !== -1)
                context.startPlayer = function () { starts++; };
            if (typeof tag.onload === "function") tag.onload();
        },
    };
    document.body.appendChild = document.head.appendChild;
    context = vm.createContext({
        document,
        navigator: { userAgent: options.device === "pc" ? "OldUnknownBrowser" : "Hisense TV" },
        // location.origin and DOM classList are deliberately missing in the legacy fixture.
        location: { protocol: "http:", host: "legacy-player.test:8080", pathname: "/" },
        localStorage: {
            getItem(key) { return storage[key] || null; },
            setItem(key, value) { storage[key] = value; },
        },
        setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; },
        console,
    });
    context.window = context;
    if (!options.modern) {
        vm.runInContext(`
            Array.from = undefined;
            Promise = undefined;
            Uint8Array = undefined;
            crypto = undefined;
            Map = undefined;
            Set = undefined;
            Symbol = undefined;
            Object.assign = undefined;
            String.prototype.includes = undefined;
            Math.imul = undefined;
        `, context);
    }
    for (const script of scripts) vm.runInContext(script, context, { filename: "index.html boot" });
    assert.equal(starts, 1, "Boot must reach startPlayer exactly once");
    assert.match(context.__cv, /^dev_\d+_[0-9a-f]{8}$/);
    assert.match(context.deviceUUID, /^dev_[0-9a-f]{8}$/);
    assert.equal(context.host, "http://legacy-player.test:8080", "Origin fallback retains the remote host");
    assert.equal(storage.ott_device_uuid, context.deviceUUID);
    return { requests, storage, context };
}

// A recognized TV and an unknown old STB both boot with no ES2015 APIs or WebCrypto.
for (const device of ["hisense", "pc"]) {
    const result = boot({ device });
    assert(result.requests.every(url => url.indexOf("http://legacy-player.test:8080/") === 0));
    assert(result.requests.some(url => url.endsWith("/js/hls.min.js")));
    assert(result.requests.some(url => url.endsWith("/js/shaka-player.compiled.js")));
    assert(result.requests.some(url => url.endsWith("/js/jquery-1.11.1.min.js")));
    assert(result.requests.some(url => url.includes(`/stb/${device}/stb.js?`)));
    const oldId = result.context.deviceUUID;
    assert.equal(boot({ device, storage: result.storage }).context.deviceUUID, oldId,
        "Existing installation identity survives the fallback generator");
}

// Modern PC retains HLS 1.6.16; TLS failures and onload-without-Hls both use local fallback.
for (const failure of [null, "cdnFailure", "cdnMissingGlobal"]) {
    const options = { modern: true, device: "pc" };
    if (failure) options[failure] = true;
    const result = boot(options);
    assert(result.requests.some(url => url.includes("hls.js@1.6.16/")));
    assert.equal(result.requests.some(url => url.endsWith("/js/hls.min.js")), Boolean(failure));
    assert(result.requests.some(url => url.endsWith("/js/shaka-player.compiled.js")));
    assert(!result.requests.some(url => url.includes("shaka-player@")), "Shaka always uses the patched local artifact");
}
console.log("OK: HTML boot without modern APIs, local TV libraries, persistent identity and PC CDN fallback");
