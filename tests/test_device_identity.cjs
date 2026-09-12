/* Exercise the actual boot and swop identity code with and without secure RNG APIs. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptStart = html.indexOf("<script>") + "<script>".length;
const closingScript = /<\/script\s*>/i.exec(html.slice(scriptStart));
const scriptEnd = closingScript ? scriptStart + closingScript.index : -1;
assert(scriptStart >= "<script>".length && scriptEnd > scriptStart);
const boot = html.slice(scriptStart, scriptEnd);
acorn.parse(boot, { ecmaVersion: 5 });
const identityStart = boot.indexOf("function bootSecureDeviceId()");
const identityEnd = boot.indexOf("window.deviceUUID = deviceUUID;");
assert(identityStart >= 0 && identityEnd > identityStart);
const bootIdentity = boot.slice(
    identityStart,
    identityEnd + "window.deviceUUID = deviceUUID;".length
);

const file = path.join(root, "src/swop/index.ts");
const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
);
const swop = ts.transpileModule(
    source.statements
        .filter((node) => !ts.isImportDeclaration(node))
        .map((node) => node.getText(source).replace(/^export\s+/, ""))
        .join("\n"),
    {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(swop, { ecmaVersion: 5 });

function fixture(options = {}) {
    const storage = { ...(options.storage || {}) };
    const requests = [];
    const alerts = [];
    const rngCalls = [];
    const ui = {
        find() {
            return this;
        },
        hide() {
            return this;
        },
        html() {
            return this;
        },
        show() {
            return this;
        },
        text() {
            return this;
        },
    };
    const $ = () => ui;
    $.ajax = (request) => requests.push(request);
    const c = vm.createContext({
        _: (message) => message,
        $,
        alert: (message) => alerts.push(message),
        alerts,
        clearTimeout() {},
        console,
        document: {
            getElementById() {
                return null;
            },
        },
        localStorage: {
            getItem: (key) => storage[key] || null,
            setItem: (key, value) => {
                storage[key] = value;
            },
        },
        requests,
        rngCalls,
        saveSettings() {},
        setTimeout() {
            return 1;
        },
        settings: { deviceUuid: "", swopBaseUrl: "https://swop.test" },
        storage,
    });
    c.window = c;
    vm.runInContext(
        "Array.from = undefined; Math.random = function () { throw new Error('Weak RNG must not generate credentials'); };",
        c
    );
    if (options.noTypedArrays) vm.runInContext("Uint8Array = undefined;", c);
    if (options.crypto) c.crypto = options.crypto;
    if (options.rng) {
        c[options.rng] = {
            getRandomValues(bytes) {
                assert.equal(
                    this,
                    c[options.rng],
                    "Preserve the crypto API receiver"
                );
                rngCalls.push(bytes.length);
                if (options.rngThrows) throw new Error("RNG unavailable");
                for (let i = 0; i < bytes.length; i++) bytes[i] = 0xa0 + i;
                return bytes;
            },
        };
    }
    vm.runInContext(bootIdentity, c, { filename: "real boot identity" });
    vm.runInContext(swop, c, { filename: "real swop module" });
    return c;
}

const expected = "dev_a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
for (const rng of ["crypto", "msCrypto"]) {
    const c = fixture({ rng });
    assert.equal(c.deviceUUID, expected, "Boot retains all 128 random bits");
    assert.equal(c.storage.ott_device_uuid, expected);
    assert.deepEqual(c.rngCalls, [16]);
    assert.equal(c.ensureDeviceClientId(), expected);
    assert.equal(c.storage.deviceId, expected);
    c.deviceUUID = "";
    delete c.storage.ott_device_uuid;
    delete c.storage.deviceId;
    c.settings.deviceUuid = "";
    assert.equal(
        c.ensureDeviceClientId(),
        expected,
        "Standalone swop generation uses the same secure contract"
    );
    assert.deepEqual(c.rngCalls, [16, 16]);
}
assert.equal(fixture({ crypto: {}, rng: "msCrypto" }).deviceUUID, expected);

for (const options of [
    {},
    { noTypedArrays: true },
    { noTypedArrays: true, rng: "crypto" },
    { rng: "crypto", rngThrows: true },
]) {
    const c = fixture(options);
    assert.equal(
        c.deviceUUID,
        "",
        "Basic startup continues without generating a weak credential"
    );
    assert.equal(c.storage.ott_device_uuid, undefined);
    assert.equal(c.ensureDeviceClientId(), "");
    assert.equal(c.storage.deviceId, undefined);
    c.swopLoadValue();
    assert.equal(
        c.requests.length,
        0,
        "No remote session request without an identity"
    );
    assert.equal(c.alerts.length, 1);

    let configured = false;
    c.applyLocalSwopConfig(() => {
        configured = true;
    });
    assert.equal(c.requests.length, 1);
    assert.equal(c.requests[0].url, "/local/swop.json");
    c.requests[0].success({
        clientId: "operator-provisioned-device",
        swopBaseUrl: "https://swop.test",
    });
    assert(configured);
    assert.equal(c.ensureDeviceClientId(), "operator-provisioned-device");
    c.swopLoadValue();
    const session = c.requests[1];
    assert.equal(session.url, "https://swop.test/session");
    assert.equal(
        session.headers["X-Swop-Client-Id"],
        "operator-provisioned-device"
    );
}

for (const storage of [
    { ott_device_uuid: "dev_existing_id" },
    { deviceId: "dev_previous_id" },
]) {
    const c = fixture({ noTypedArrays: true, storage });
    assert.equal(
        c.ensureDeviceClientId(),
        storage.ott_device_uuid || storage.deviceId
    );
    assert.deepEqual(c.rngCalls, []);
    const modern = fixture({ rng: "crypto", storage });
    assert.equal(
        modern.ensureDeviceClientId(),
        storage.ott_device_uuid || storage.deviceId
    );
    assert.deepEqual(
        modern.rngCalls,
        [],
        "An available RNG must not replace a stored identity"
    );
}
console.log(
    "PASS: secure 128-bit device IDs, msCrypto, ES5 API guards, preserved/provisioned IDs and swop fail-closed"
);
