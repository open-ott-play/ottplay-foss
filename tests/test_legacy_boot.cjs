const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parse } = require("parse5");
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
const runtimeVersion = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../js/media-runtime.json"), "utf8")
).runtimeVersion;
assert.match(runtimeVersion, /^[0-9a-f]{16}$/);
const mediaURL = (name) =>
    "http://legacy-player.test:8080/js/" + name + "?v=" + runtimeVersion;
const scripts = inlineScripts(html);
assert(scripts.length > 0, "The real HTML boot script must be exercised");
const bootScripts = [];
function collectScripts(node) {
    if (node.tagName === "script") {
        bootScripts.push({
            src: node.attrs.find((attr) => attr.name === "src")?.value,
            text: (node.childNodes || [])
                .map((child) => child.value || "")
                .join(""),
        });
    }
    for (const child of node.childNodes || []) collectScripts(child);
}
collectScripts(parse(html));
assert.equal(
    bootScripts[0].src,
    "/js/runtime-polyfills.js?v=" + runtimeVersion,
    "Runtime support must load before every third-party and boot script"
);

function boot(options = {}) {
    const requests = [];
    const storage = options.storage || {};
    const elements = {};
    const stoppedTimers = [];
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
            const requestPath = new URL(tag.src).pathname;
            const name = requestPath.slice(requestPath.lastIndexOf("/") + 1);
            if (name === "runtime-polyfills.js") {
                if (!options.polyfillsFailure) {
                    if (options.realLibraries)
                        vm.runInContext(
                            fs.readFileSync(
                                path.join(__dirname, "../js", name),
                                "utf8"
                            ),
                            context,
                            { filename: name }
                        );
                    else {
                        context.__ottRuntimePolyfillsReady = true;
                        context.__ottMediaRuntimeVersion = runtimeVersion;
                    }
                } else if (options.polyfillsFailure === "partial") {
                    // A script can fire onload even after an uncaught exception.
                    context.__ottRuntimePolyfillsReady = false;
                } else if (options.polyfillsFailure === "missing-version") {
                    context.__ottRuntimePolyfillsReady = true;
                }
                if (typeof tag.onload === "function") tag.onload();
                return;
            }
            if (name === "ottplay-core.js") {
                if (options.libraryFailures?.includes(name)) { tag.onerror(new Error("Missing core")); return; }
                if (options.realLibraries) {
                    vm.runInContext(fs.readFileSync(path.join(__dirname, "../vendor/ottplay-core.js"), "utf8"), context);
                    assert.equal(context.OttPlayCore.nativeGuideName("First HD", "web"), "first");
                } else if (!options.missingCoreGlobal) context.OttPlayCore = { NativeGuide: function () {}, providerArchiveUrl: function () {}, parseProviderPlaylist: function () {}, parseOperatorPlaylist: function () {}, parsePlaylistMedia: function () {}, XtreamClient: function () {}, StalkerClient: function () {}, LegacyStalkerClient: function () {}, legacyXtreamClient: function () {}, legacyGuideSelection: function () {}, legacyGuideCacheRead: function () {} };
                if (typeof tag.onload === "function") tag.onload();
                return;
            }
            assert.equal(
                context.__ottRuntimePolyfillsReady,
                true,
                "Third-party scripts must not run before runtime support finishes"
            );
            assert.equal(context.__ottMediaRuntimeVersion, runtimeVersion);
            if (options.libraryFailures?.includes(name)) {
                tag.onerror(new Error("Local library unavailable"));
                return;
            }
            if (
                options.realLibraries &&
                /^(hls.min.js|shaka-player.compiled.js)$/.test(name)
            ) {
                vm.runInContext(
                    fs.readFileSync(
                        path.join(__dirname, "../js", name),
                        "utf8"
                    ),
                    context,
                    { filename: name }
                );
                if (typeof tag.onload === "function") tag.onload();
                return;
            }
            if (/\/jquery(?:-1\.11\.1)?\.min\.js$/.test(tag.src))
                context.jQuery = {};
            else if (tag.src.indexOf("hls.min.js") !== -1) {
                if (!options.missingHlsGlobal) {
                    context.Hls = function Hls() {};
                    context.Hls.DefaultConfig = {};
                }
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
        clearInterval(timer) {
            stoppedTimers.push(timer);
        },
        console,
        document,
        localStorage: {
            getItem(key) {
                if (options.storageError === "read")
                    throw new Error("SecurityError");
                return storage[key] || null;
            },
            setItem(key, value) {
                if (options.storageError === "write")
                    throw new Error("QuotaExceededError");
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
                options.userAgent ??
                (options.device === "pc" ? "OldUnknownBrowser" : "Hisense TV"),
        },
        setInterval() {
            return 1;
        },
        setTimeout() {
            return 1;
        },
        URL: Object.assign(function URL() {}, { createObjectURL() {} }),
    });
    context.window = context;
    context.self = context;
    Object.assign(context, options.globals || {});
    const blobURLApi = {
        createObjectURL() {
            assert.equal(this.marker, "native-blob-provider");
            return "blob:legacy-player.test/runtime-check";
        },
        marker: "native-blob-provider",
        revokeObjectURL(url) {
            assert.equal(this.marker, "native-blob-provider");
            assert.equal(url, "blob:legacy-player.test/runtime-check");
        },
    };
    if (options.objectValuedURL) context.URL = blobURLApi;
    else Object.assign(context.URL, blobURLApi);
    if (options.storageError === "access") {
        Object.defineProperty(context, "localStorage", {
            get() {
                throw new Error("SecurityError");
            },
        });
    }
    if (options.noObjectURL) context.URL = undefined;
    if (options.webkitURL) context.webkitURL = blobURLApi;
    if (options.noDateNow) vm.runInContext("Date.now = undefined;", context);
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
    for (const script of bootScripts) {
        if (script.src) {
            document.head.appendChild({
                src: new URL(script.src, "http://legacy-player.test:8080/")
                    .href,
                tagName: "script",
            });
        } else
            vm.runInContext(script.text, context, {
                filename: "index.html boot",
            });
    }
    assert.equal(
        starts,
        options.polyfillsFailure || options.missingCoreGlobal ||
            options.libraryFailures?.some((name) => /^jquery|^ottplay-core/.test(name))
            ? 0
            : 1,
        "Boot must start once, or present a recoverable runtime/UI load failure"
    );
    assert.match(context.__cv, /^dev_\d+_[0-9a-f]{8}$/);
    if (options.modern && !options.storage)
        assert.match(context.deviceUUID, /^dev_[0-9a-f]{32}$/);
    assert.equal(
        context.host,
        "http://legacy-player.test:8080",
        "Origin fallback retains the remote host"
    );
    if (
        context.deviceUUID &&
        options.storageError !== "write" &&
        options.storageError !== "access"
    )
        assert.equal(storage.ott_device_uuid, context.deviceUUID);
    else assert.equal(storage.ott_device_uuid, undefined);
    return { context, elements, requests, stoppedTimers, storage };
}

// A recognized TV and an unknown old STB both boot with no ES2015 APIs or WebCrypto.
for (const device of ["hisense", "pc"]) {
    const result = boot({ device });
    assert(
        result.requests.every(
            (url) => url.indexOf("http://legacy-player.test:8080/") === 0
        )
    );
    assert(result.requests.includes(mediaURL("hls.min.js")));
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

// Platform detection chooses the device adapter, never a different HLS release.
const androidWebViewUA =
    "Mozilla/5.0 (Linux; Android 16; SDK TV; wv) AppleWebKit/537.36 " +
    "Version/4.0 Chrome/143.0.7499.24 Safari/537.36";
const testWebViewUA = androidWebViewUA + " OttplayTestWebView/1.0";
for (const options of [
    { device: "pc" },
    { device: "pc", modern: false },
    { userAgent: androidWebViewUA },
    { userAgent: testWebViewUA },
    { userAgent: androidWebViewUA + " NotOttplayTestWebView/1.0" },
    { userAgent: testWebViewUA + "1" },
    { modern: false, userAgent: testWebViewUA },
    { globals: { Capacitor: {} }, userAgent: testWebViewUA },
    { globals: { Android: {} }, userAgent: testWebViewUA },
    { globals: { __ottNativeRuntime: {} }, userAgent: testWebViewUA },
    { globals: { __TAURI__: {} }, userAgent: testWebViewUA },
    { globals: { __TAURI_INTERNALS__: {} }, userAgent: testWebViewUA },
    { pathname: "/f/lg/webos/", userAgent: testWebViewUA },
]) {
    const result = boot({ modern: true, ...options });
    const local = (name) => "http://legacy-player.test:8080/js/" + name;
    assert.equal(result.requests[0], mediaURL("runtime-polyfills.js"));
    assert(result.requests[1].startsWith(local("ottplay-core.js?")));
    assert.equal(
        result.requests[2],
        local(
            options.globals?.__ottNativeRuntime
                ? "jquery.min.js"
                : "jquery-1.11.1.min.js"
        )
    );
    assert.equal(result.requests[3], mediaURL("hls.min.js"));
    assert.equal(result.requests[4], local("shaka-player.compiled.js"));
    assert(result.requests[5].includes("/dist/stbPlayer.js?"));
    assert.equal(
        result.context.Hls.DefaultConfig.workerPath,
        mediaURL("hls.worker.js")
    );
    assert(
        !result.requests.some(
            (url) => new URL(url).hostname === "cdn.jsdelivr.net"
        )
    );
}
// A preloaded HLS constructor must receive the same worker configuration.
const preloadedHls = function Hls() {};
preloadedHls.DefaultConfig = {};
const preloaded = boot({ globals: { Hls: preloadedHls, jQuery: {} } });
assert.equal(preloadedHls.DefaultConfig.workerPath, mediaURL("hls.worker.js"));
assert(!preloaded.requests.includes(mediaURL("hls.min.js")));

for (const options of [
    { libraryFailures: ["hls.min.js"] },
    { missingHlsGlobal: true },
    { libraryFailures: ["shaka-player.compiled.js"] },
    { libraryFailures: ["hls.min.js", "shaka-player.compiled.js"] },
]) {
    const result = boot(options);
    assert.match(
        result.elements["boot-log"].textContent,
        /unavailable; using device playback/
    );
    assert(result.requests.some((url) => url.includes("/stb/hisense/stb.js?")));
}
for (const polyfillsFailure of ["network", "partial", "missing-version"]) {
    const result = boot({ polyfillsFailure });
    assert.deepEqual(result.requests, [mediaURL("runtime-polyfills.js")]);
    assert.equal(
        result.elements["boot-status"].textContent,
        "Failed to load runtime support"
    );
    assert.match(result.elements["boot-log"].textContent, /Reload the player/);
    assert.equal(result.context.document.body.className, "");
    assert(
        result.stoppedTimers.includes(1),
        "A failed runtime load must stop the loading animation"
    );
}
console.log(
    "OK: polyfills load first, unified local HLS and worker, visible failure and device playback fallback"
);

// LG's Web0S token uses a zero and does not require an LG vendor marker.
const lgWeb0SUserAgent =
    "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.6099.270 Safari/537.36 WebAppManager";
for (const userAgent of [
    lgWeb0SUserAgent,
    "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.41 " +
        "(KHTML, like Gecko) Large Screen WebAppManager",
    "Mozilla/5.0 (webOS; Linux/SmartTV) AppleWebKit/537.36",
    "Mozilla/5.0 (LG SmartTV) AppleWebKit/537.36",
]) {
    for (const modern of [false, true]) {
        const result = boot({ modern, userAgent });
        assert.equal(
            result.context.ott_device,
            "lg/webos",
            "LG browser must select webOS without an explicit device route"
        );
        assert(
            result.requests.some((url) =>
                url.includes("/stb/lg/webos/stb.js?")
            ),
            "LG boot must request the webOS remote and playback adapter"
        );
        assert(
            result.requests.includes(mediaURL("hls.min.js")),
            "LG boot must retain the local TV library path even with modern APIs"
        );
        assert(
            !result.requests.some(
                (url) => new URL(url).hostname === "cdn.jsdelivr.net"
            ),
            "LG must use the same local libraries as every other device"
        );
    }
}

// Explicit device routes must preserve both components of nested vendor IDs.
for (const device of [
    "lg/webos",
    "lg/netcast",
    "samsung/tizen",
    "samsung/maple",
    "dune",
    "mag",
    "pc",
]) {
    for (const suffix of ["/", "/index.html", "/nested/index.html", ""]) {
        for (const userAgent of ["OldUnknownBrowser", lgWeb0SUserAgent]) {
            const result = boot({
                pathname: "/f/" + device + suffix,
                userAgent,
            });
            assert.equal(
                result.context.ott_device,
                device,
                "Explicit device route must override browser detection"
            );
            assert(
                result.requests.some((url) =>
                    url.includes("/stb/" + device + "/stb.js?")
                ),
                "The requested adapter must retain the complete route platform"
            );
        }
    }
}
console.log(
    "OK: LG Web0S/webOS detection and explicit nested device route precedence"
);

// Storage policy and quota errors must not abort basic boot or replace secure RNG.
for (const storageError of ["access", "read", "write"]) {
    const result = boot({ modern: true, noDateNow: true, storageError });
    assert.match(result.context.deviceUUID, /^dev_[0-9a-f]{32}$/);
}
// Execute the actual vendor payloads, not a fake successful script download.
for (const options of [
    { realLibraries: true },
    { objectValuedURL: true, realLibraries: true },
    { noObjectURL: true, realLibraries: true },
    { noObjectURL: true, realLibraries: true, webkitURL: true },
]) {
    const result = boot(options);
    assert.equal(typeof result.context.Hls, "function");
    assert.equal(result.context.Hls.version, "1.7.3");
    assert.equal(
        result.context.Hls.DefaultConfig.workerPath,
        mediaURL("hls.worker.js")
    );
    if (options.noObjectURL && !options.webkitURL) {
        assert(
            !result.requests.some((url) =>
                url.endsWith("/js/shaka-player.compiled.js")
            )
        );
    } else {
        assert.equal(typeof result.context.shaka.Player, "function");
        const blobURL = result.context.URL.createObjectURL({});
        assert.equal(blobURL, "blob:legacy-player.test/runtime-check");
        result.context.URL.revokeObjectURL(blobURL);
    }
}
console.log(
    "OK: denied/quota storage, pre-bundle Date.now and actual old-API vendor payloads"
);

for (const options of [{ libraryFailures: ["ottplay-core.js"] }, { missingCoreGlobal: true }]) {
    const result = boot(options);
    assert.equal(result.elements["boot-status"].textContent, "Failed to load shared core");
    assert.equal(result.requests.length, 2, "A broken core must not start the player");
}
