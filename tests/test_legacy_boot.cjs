const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { inlineScripts } = require("../scripts/html-scripts.cjs");

assert.deepEqual(
    inlineScripts(
        '<!-- <script>ignored()</script> --><SCRIPT>var a = 1;</script\t\n bar=">">' +
            '<script data-note=">">var b = 2;</script >'
    ),
    ["var a = 1;", "var b = 2;"],
    "The ES5 gate must follow HTML parsing rules for comments, attributes and script end tags"
);

const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const scripts = inlineScripts(html);
assert(scripts.length > 0, "The real HTML boot script must be exercised");

function boot(options = {}) {
    const requests = [];
    const storage = options.storage || {};
    const elements = {};
    let starts = 0;
    let context;
    const document = {
        body: { className: "booting", style: {} },
        createElement(tagName) {
            return { style: {}, tagName };
        },
        getElementById(id) {
            return (elements[id] ||= {
                getAttribute() {
                    return null;
                },
                style: {},
                textContent: "",
            });
        },
        getElementsByTagName() {
            return [this.head];
        },
    };
    document.head = {
        appendChild(tag) {
            if (tag.tagName !== "script") return;
            requests.push(tag.src);
            if (
                options.cdnFailure &&
                new URL(tag.src).hostname === "cdn.jsdelivr.net"
            ) {
                tag.onerror(new Error("TLS/network unavailable"));
                return;
            }
            if (tag.src.indexOf("jquery-1.11.1.min.js") !== -1)
                context.jQuery = {};
            else if (tag.src.indexOf("hls.min.js") !== -1) {
                if (
                    !(
                        options.cdnMissingGlobal &&
                        new URL(tag.src).hostname === "cdn.jsdelivr.net"
                    )
                )
                    context.Hls = function Hls() {};
            } else if (tag.src.indexOf("shaka-player.compiled.js") !== -1)
                context.shaka = { Player() {} };
            else if (tag.src.indexOf("/dist/stbPlayer.js?") !== -1)
                context.startPlayer = function () {
                    starts++;
                };
            if (typeof tag.onload === "function") tag.onload();
        },
    };
    document.body.appendChild = document.head.appendChild;
    context = vm.createContext({
        clearInterval() {},
        console,
        document,
        localStorage: {
            getItem(key) {
                return storage[key] || null;
            },
            setItem(key, value) {
                storage[key] = value;
            },
        },
        // location.origin and DOM classList are deliberately missing in the legacy fixture.
        location: {
            host: "legacy-player.test:8080",
            pathname: options.pathname || "/",
            protocol: "http:",
        },
        navigator: {
            userAgent:
                options.device === "pc" ? "OldUnknownBrowser" : "Hisense TV",
        },
        setInterval() {
            return 1;
        },
        setTimeout() {
            return 1;
        },
    });
    context.window = context;
    if (options.modern) {
        context.crypto = {
            getRandomValues(bytes) {
                for (let i = 0; i < bytes.length; i++) bytes[i] = i + 16;
                return bytes;
            },
        };
    }
    if (!options.modern) {
        vm.runInContext(
            `
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
        `,
            context
        );
    }
    for (const script of scripts)
        vm.runInContext(script, context, { filename: "index.html boot" });
    assert.equal(starts, 1, "Boot must reach startPlayer exactly once");
    assert.match(context.__cv, /^dev_\d+_[0-9a-f]{8}$/);
    if (options.modern && !options.storage)
        assert.match(context.deviceUUID, /^dev_[0-9a-f]{32}$/);
    assert.equal(
        context.host,
        "http://legacy-player.test:8080",
        "Origin fallback retains the remote host"
    );
    if (context.deviceUUID)
        assert.equal(storage.ott_device_uuid, context.deviceUUID);
    else assert.equal(storage.ott_device_uuid, undefined);
    return { context, requests, storage };
}

// A recognized TV and an unknown old STB both boot with no ES2015 APIs or WebCrypto.
for (const device of ["hisense", "pc"]) {
    const result = boot({ device });
    assert(
        result.requests.every(
            (url) => url.indexOf("http://legacy-player.test:8080/") === 0
        )
    );
    assert(result.requests.some((url) => url.endsWith("/js/hls.min.js")));
    assert(
        result.requests.some((url) =>
            url.endsWith("/js/shaka-player.compiled.js")
        )
    );
    assert(
        result.requests.some((url) => url.endsWith("/js/jquery-1.11.1.min.js"))
    );
    assert(
        result.requests.some((url) => url.includes(`/stb/${device}/stb.js?`))
    );
    assert.equal(
        result.context.deviceUUID,
        "",
        "Missing crypto must not create a weak remote-access credential"
    );
    const oldId = "dev_existing-installation";
    assert.equal(
        boot({ device, storage: { ott_device_uuid: oldId } }).context
            .deviceUUID,
        oldId,
        "Existing installation identity survives on engines without crypto"
    );
}

// Modern PC retains HLS 1.6.16; TLS failures and onload-without-Hls both use local fallback.
for (const failure of [null, "cdnFailure", "cdnMissingGlobal"]) {
    const options = { device: "pc", modern: true };
    if (failure) options[failure] = true;
    const result = boot(options);
    assert(result.requests.some((url) => url.includes("hls.js@1.6.16/")));
    assert.equal(
        result.requests.some((url) => url.endsWith("/js/hls.min.js")),
        Boolean(failure)
    );
    assert(
        result.requests.some((url) =>
            url.endsWith("/js/shaka-player.compiled.js")
        )
    );
    assert(
        !result.requests.some((url) => url.includes("shaka-player@")),
        "Shaka always uses the patched local artifact"
    );
}
console.log(
    "OK: HTML boot without modern APIs, local TV libraries, persistent identity and PC CDN fallback"
);

// Explicit device routes must preserve both components of nested vendor IDs.
for (const device of [
    "lg/webos",
    "lg/netcast",
    "samsung/tizen",
    "samsung/maple",
    "dune",
    "mag",
]) {
    for (const suffix of ["/", "/index.html", ""]) {
        const result = boot({ pathname: "/f/" + device + suffix });
        assert.equal(result.context.ott_device, device);
        assert(
            result.requests.some((url) =>
                url.includes("/stb/" + device + "/stb.js")
            )
        );
    }
}
