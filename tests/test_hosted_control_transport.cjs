const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(
    "src/plugins/hosted-control-transport.ts",
    "utf8"
);
const code = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
require("acorn").parse(code, { ecmaVersion: 5 });
const origin = "https://player.example";
const base = origin + "/ott-control";
const old = "https://old.example/ott-control";
const config = {
    bases: [base, old],
    endpoint: "/ott-control/api/device-transport",
    version: 1,
};
const host = {
    __OTTPLAY_HOSTED__: { controlTransport: config },
    location: new URL(origin + "/f/pc/"),
};
vm.runInNewContext(code, { URL, window: host });
const map = host.__ottControlTransport.map;
const token = "A".repeat(43);
const request = (
    url,
    method = "GET",
    body,
    headers = { Authorization: "Bearer " + token }
) => ({ body, headers, method, timeoutMs: 8000, url });
for (const target of [base, old]) {
    const input = request(
        target + "/api/webhook/commands?device_id=dev_test&delivery=ack"
    );
    const saved = JSON.stringify(input);
    const output = map(input);
    assert.equal(output.url, base + "/api/device-transport");
    assert.equal(output.method, "POST");
    assert.equal(output.headers.Authorization, undefined);
    assert.equal(JSON.stringify(input), saved);
    assert.deepEqual(JSON.parse(output.body), {
        method: "GET",
        path: "/api/webhook/commands?device_id=dev_test&delivery=ack",
        token,
        version: 1,
    });
}
const custom = request("https://custom.example/api/webhook/commands");
assert.equal(map(custom), custom, "manual external servers remain direct");
const posted = map(
    request(base + "/api/responses", "POST", '{"result":{"ok":true}}', {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
    })
);
assert.deepEqual(JSON.parse(posted.body).body, { result: { ok: true } });
const presence = map(
    request(base + "/api/player-state", "POST", '{"version":1}', {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
    })
);
assert.equal(presence.url, base + "/api/device-transport");
assert.equal(presence.headers.Authorization, undefined);
assert.deepEqual(JSON.parse(presence.body), {
    body: { version: 1 },
    method: "POST",
    path: "/api/player-state",
    token,
    version: 1,
});
const diagnostic = map(
    request(base + "/api/v2/diagnostics/poll", "POST", "{}", {
        Authorization: "Bearer " + token,
        "X-OTT-Diagnostics-Epoch": "epoch-1",
    })
);
assert.deepEqual(JSON.parse(diagnostic.body).headers, {
    "X-OTT-Diagnostics-Epoch": "epoch-1",
});
const media = map(
    request(
        base + "/api/notifications/media?id=abc&runtime=run",
        "GET",
        undefined,
        { Accept: "application/json", Authorization: "Bearer " + token }
    )
);
assert.equal(
    JSON.parse(media.body).path,
    "/api/notifications/media?id=abc&runtime=run"
);
const pairing = map(
    request(base + "/api/pairings", "POST", '{"device_id":"dev_test"}', {
        "Content-Type": "application/json",
    })
);
assert.equal(JSON.parse(pairing.body).token, undefined);
assert.equal(
    map(request(base + "/api/pairings?id=" + "a".repeat(32), "DELETE"))
        .secureControl,
    true
);
for (const path of [
    "/api/requests",
    "/api/devices",
    "/api/pairings/approve",
    "/api/v2/diagnostics/sessions",
    "/api/../requests",
    "/api/webhook/commands#secret",
]) {
    assert.throws(
        () => map(request(base + path, "POST", "{}")),
        /Invalid hosted/
    );
}
for (const headers of [
    { Authorization: "Bearer short" },
    { Authorization: "Bearer " + token, authorization: "Bearer " + token },
    { "X-OTT-Diagnostics-Epoch": "bad value" },
    { "X-Arbitrary": "bad" },
    { Host: "evil.example" },
]) {
    assert.throws(
        () =>
            map(
                request(
                    base + "/api/webhook/commands",
                    "GET",
                    undefined,
                    headers
                )
            ),
        /Invalid hosted/
    );
}
for (const body of [
    "[]",
    "null",
    "not-json",
    JSON.stringify({ value: "x".repeat(2105344) }),
]) {
    assert.throws(() => map(request(base + "/api/responses", "POST", body)));
}
for (const noncanonical of [
    base + "/",
    base.replace("player.example", "PLAYER.example"),
    "https://player.example:443/ott-control",
]) {
    config.bases = [noncanonical];
    assert.throws(
        () => map(request(base + "/api/discovery")),
        /Invalid hosted/
    );
}
config.bases = [base, old];
config.endpoint = "https://evil.example/api/device-transport";
assert.throws(
    () => map(request(base + "/api/webhook/commands")),
    /Invalid hosted/
);
config.endpoint = "/ott-control/api/device-transport";
host.__OTTPLAY_HOSTED__ = {};
assert.equal(map(custom), custom);
console.log(
    "PASS hosted control: exact bases, private body tokens, allowed routes, media URL and malformed request rejection"
);

(async () => {
    const transportSource = fs.readFileSync(
        "src/plugins/command-server.ts",
        "utf8"
    );
    const ast = ts.createSourceFile(
        "command-server.ts",
        transportSource,
        ts.ScriptTarget.Latest,
        true
    );
    const fn = ast.statements.find(
        (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "createCommandServerTransport"
    );
    const transportCode = ts
        .transpileModule(fn.getText(ast), {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.replace(/^export /gm, "");
    host.__OTTPLAY_HOSTED__ = { controlTransport: config };
    host.setTimeout = setTimeout;
    host.clearTimeout = clearTimeout;
    const context = { URL, window: host };
    vm.runInNewContext(transportCode, context);
    let sent;
    const transport = context.createCommandServerTransport(
        host,
        async (value) => {
            sent = value;
            return { body: '{"status":"pending"}', status: 202 };
        }
    );
    const response = await new Promise((resolve) =>
        transport(request(base + "/api/pairings?id=" + "a".repeat(32)), resolve)
    );
    assert.equal(response.status, 202);
    assert.equal(sent.url, base + "/api/device-transport");
    assert.equal(JSON.parse(sent.body).token, token);
    assert.equal(sent.headers.Authorization, undefined);
    host.__ottControlTransport = undefined;
    const rejected = await new Promise((resolve) =>
        transport(request(base + "/api/webhook/commands"), resolve)
    );
    assert.equal(rejected.status, 0);
    assert.equal(rejected.error, "hosted_control_unavailable");
    console.log(
        "PASS hosted control integration: response preserved, absent helper fails closed"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
