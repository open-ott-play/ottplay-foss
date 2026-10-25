const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync("src/plugins/control-discovery.ts", "utf8"),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
const server = {
    address: "https://control.example/ott-control",
    domain: "example.test",
    id: "home._ottplay-ctrl._tcp.example.test.",
};
const receipt = {
    code: "ABC12345",
    expires_in: 600,
    id: "a".repeat(32),
    secret: "s".repeat(32),
};
const approval = {
    address: server.address,
    device_id: "dev_test",
    status: "approved",
    token: "t".repeat(32),
};
function fixture(config = {}, nativeDiscover) {
    const settings = {
        address: "",
        enabled: false,
        generation: 1,
        token: "",
        ...config,
    };
    const calls = [],
        applied = [],
        timers = new Map();
    let sequence = 0,
        clock = 0,
        saveFailure = false,
        uuid = "dev_test";
    const w = {
        __OTT_CONTROL_DISCOVERY_URL__:
            "https://control.example/api/control-discovery",
        clearTimeout(id) {
            timers.delete(id);
        },
        location: new URL("https://player.example/"),
        setTimeout(fn, delay) {
            const id = ++sequence;
            timers.set(id, { at: clock + delay, fn });
            return id;
        },
    };
    const ctx = {
        exports: {},
        require: () => require("./load-wire.cjs")(),
        URL,
    };
    vm.runInNewContext(code, ctx);
    const controller = ctx.exports.createControlDiscovery(
        w,
        (request, done) => {
            const call = { aborted: false, done, request };
            calls.push(call);
            return () => {
                call.aborted = true;
            };
        },
        () => settings,
        (value) => {
            if (saveFailure) throw new Error("storage unavailable");
            applied.push(value);
            Object.assign(settings, value);
            settings.generation++;
        },
        () => uuid,
        nativeDiscover
    );
    function respond(data, status = 200, call = calls.at(-1)) {
        call.done({ body: JSON.stringify(data), status });
    }
    function tick(ms) {
        const until = clock + ms;
        let count = 0;
        while (true) {
            const task = [...timers]
                .filter(([, t]) => t.at <= until)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!task) break;
            assert(++count < 1000, "bounded timer work");
            clock = task[1].at;
            timers.delete(task[0]);
            task[1].fn();
        }
        clock = until;
    }
    function discover(servers = [server]) {
        controller.start();
        respond({ servers, version: 1 });
    }
    return {
        applied,
        calls,
        controller,
        discover,
        failSave() {
            saveFailure = true;
        },
        respond,
        settings,
        setUuid(value) {
            uuid = value;
        },
        tick,
        timers,
        w,
    };
}
let passed = 0;
function check(name, test) {
    test();
    passed++;
    console.log("PASS discovery: " + name);
}
check("metadata pairing URL does not override the selected DNS service", () => {
    for (const servers of [
        [],
        [server],
        [server, { ...server, id: "other.example." }],
    ]) {
        const f = fixture();
        f.controller.start();
        f.respond({
            pairing_url: "https://foreign.example/api/pairings",
            servers,
            version: 1,
        });
        assert.equal(
            f.controller.status().state,
            servers.length === 0
                ? "unavailable"
                : servers.length === 1
                  ? "pairing"
                  : "choose"
        );
        if (servers.length === 1)
            assert.equal(
                f.calls.at(-1).request.url,
                server.address + "/api/pairings"
            );
    }
});
check(
    "automatic discovery preserves configured and deliberately disabled installations",
    () => {
        for (const config of [
            { address: server.address },
            { token: approval.token },
            { enabled: true },
            { address: server.address, enabled: false, token: approval.token },
        ]) {
            const f = fixture(config);
            f.controller.start();
            assert.equal(f.calls.length, 0);
            assert.equal(f.applied.length, 0);
        }
    }
);
check(
    "one server pairs only after matching approval; private credentials never enter status",
    () => {
        const f = fixture();
        f.discover();
        const post = f.calls.at(-1).request;
        assert.equal(f.calls[0].request.secureControl, true);
        assert.equal(post.secureControl, true);
        assert.equal(post.url, server.address + "/api/pairings");
        assert.deepEqual(JSON.parse(post.body), {
            device_id: "dev_test",
            server_id: server.id,
        });
        f.respond(receipt, 201);
        assert.equal(f.controller.status().code, receipt.code);
        assert.ok(
            !JSON.stringify(f.controller.status()).includes(receipt.secret)
        );
        f.tick(2000);
        assert.equal(f.calls.at(-1).request.secureControl, true);
        assert.equal(
            f.calls.at(-1).request.headers.Authorization,
            "Bearer " + receipt.secret
        );
        f.respond({ status: "pending" }, 202);
        f.tick(2000);
        f.respond(approval);
        assert.equal(f.applied.length, 1);
        assert.equal(f.settings.enabled, true);
        assert.equal(f.controller.status().state, "connected");
        assert.equal(f.controller.status().code, "");
        assert.equal(f.calls.at(-1).request.method, "DELETE");
        assert.equal(f.calls.at(-1).request.secureControl, true);
        assert.equal(f.timers.size, 0);
        assert.ok(
            !JSON.stringify(f.controller.status()).includes(approval.token)
        );
    }
);
check(
    "explicit retry stages replacement without disconnecting or clearing existing settings",
    () => {
        const f = fixture({
            address: "https://old.example",
            enabled: false,
            token: "o".repeat(32),
        });
        f.controller.start(true);
        f.respond({ servers: [server], version: 1 });
        f.respond(receipt, 201);
        assert.equal(f.settings.address, "https://old.example");
        assert.equal(f.settings.enabled, false);
        f.tick(2000);
        f.respond(approval);
        assert.equal(f.settings.address, server.address);
    }
);
check("multiple servers require explicit selection", () => {
    const second = {
        ...server,
        address: "https://second.example",
        id: "other._ottplay-ctrl._tcp.example.test.",
    };
    const f = fixture();
    f.discover([server, second]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.controller.status().state, "choose");
    f.controller.choose(1);
    assert.equal(JSON.parse(f.calls.at(-1).request.body).server_id, second.id);
    assert.equal(f.calls.at(-1).request.url, second.address + "/api/pairings");
});
check(
    "manual settings, disconnect/reconnect and device changes revoke late approval",
    () => {
        for (const mutate of [
            (f) => (f.settings.address = "https://manual.example"),
            (f) => f.settings.generation++,
            (f) => f.setUuid("dev_other"),
        ]) {
            const f = fixture();
            f.discover();
            f.respond(receipt, 201);
            f.tick(2000);
            mutate(f);
            f.respond(approval);
            assert.equal(f.applied.length, 0);
            assert.equal(f.controller.status().state, "canceled");
            assert.equal(f.timers.size, 0);
        }
    }
);
check("cancel aborts requests and ignores late callbacks", () => {
    const f = fixture();
    f.discover();
    const stale = f.calls.at(-1);
    f.controller.cancel();
    assert.equal(stale.aborted, true);
    f.respond(receipt, 201, stale);
    assert.equal(f.timers.size, 0);
    assert.equal(f.applied.length, 0);
    f.controller.start();
    assert.equal(f.calls.length, 2, "automatic discovery attempts only once");
});
check(
    "expiry aborts an outstanding approval read and cannot enable later",
    () => {
        const f = fixture();
        f.discover();
        f.respond({ ...receipt, expires_in: 3 }, 201);
        f.tick(2000);
        const stale = f.calls.at(-1);
        f.tick(1000);
        assert.equal(f.controller.status().state, "expired");
        assert.equal(stale.aborted, true);
        f.respond(approval, 200, stale);
        assert.equal(f.applied.length, 0);
        assert.equal(f.timers.size, 0);
    }
);
check(
    "malformed, insecure and foreign discovery metadata cannot start pairing",
    () => {
        for (const data of [
            null,
            { servers: [server], version: 2 },
            { servers: [server, server], version: 1 },
            {
                servers: [{ ...server, address: "http://control.example" }],
                version: 1,
            },
            {
                servers: [
                    { ...server, address: "https://u:p@control.example" },
                ],
                version: 1,
            },
            { servers: Array.from({ length: 17 }, () => server), version: 1 },
        ]) {
            const f = fixture();
            f.controller.start();
            f.respond(data);
            assert.equal(f.calls.length, 1);
            assert.equal(f.controller.status().state, "error");
        }
    }
);
check(
    "malformed pairing receipts do not expose codes or send bearer credentials",
    () => {
        for (const data of [
            null,
            { ...receipt, id: "bad" },
            { ...receipt, secret: "short" },
            { ...receipt, code: "<script>" },
            { ...receipt, expires_in: 601 },
        ]) {
            const f = fixture();
            f.discover();
            f.respond(data, 201);
            assert.equal(f.controller.status().state, "error");
            assert.equal(f.controller.status().code, "");
            assert.equal(f.calls.length, 2);
            assert.equal(f.timers.size, 0);
        }
    }
);
check("approval binds exact device and discovered address", () => {
    for (const data of [
        { ...approval, device_id: "dev_other" },
        { ...approval, address: "https://foreign.example" },
        { ...approval, token: "short" },
        { ...approval, status: "pending" },
    ]) {
        const f = fixture();
        f.discover();
        f.respond(receipt, 201);
        f.tick(2000);
        f.respond(data);
        assert.equal(f.applied.length, 0);
        assert.equal(f.controller.status().state, "error");
    }
});
check(
    "temporary readback failures are bounded without repeating the pairing POST",
    () => {
        const f = fixture();
        f.discover();
        f.respond(receipt, 201);
        f.tick(2000);
        for (let i = 0; i < 6; i++) {
            f.respond({}, 503);
            if (i < 5) f.tick(Math.min(10000, (i + 1) * 2000));
        }
        assert.equal(f.controller.status().state, "error");
        assert.equal(
            f.calls.filter((x) => x.request.method === "POST").length,
            1
        );
    }
);
check("listener reentry cancels before another poll can be scheduled", () => {
    const f = fixture();
    f.controller.subscribe(() => {
        if (f.controller.status().state === "waiting") f.controller.cancel();
    });
    f.discover();
    f.respond(receipt, 201);
    assert.equal(f.timers.size, 0);
    assert.equal(f.applied.length, 0);
});
check("receipt cleanup is bounded and waits for durable settings", () => {
    const f = fixture();
    f.discover();
    f.respond(receipt, 201);
    f.tick(2000);
    f.failSave();
    f.respond(approval);
    assert.equal(f.controller.status().state, "error");
    assert.equal(
        f.calls.filter((call) => call.request.method === "DELETE").length,
        0
    );
    f.controller.cancel();
    const cleanup = f.calls.at(-1).request;
    assert.equal(cleanup.method, "DELETE");
    assert.equal(cleanup.timeoutMs, 2000);
    assert.equal(cleanup.headers.Authorization, "Bearer " + receipt.secret);
    assert.equal(
        cleanup.url,
        server.address + "/api/pairings?id=" + receipt.id
    );
    const saved = fixture();
    saved.discover();
    saved.respond(receipt, 201);
    saved.tick(2000);
    saved.respond(approval);
    assert.equal(saved.applied.length, 1);
    assert.equal(saved.calls.at(-1).request.method, "DELETE");
});
check(
    "browser fallback is local and arbitrary pages need an explicit profile",
    () => {
        const f = fixture();
        delete f.w.__OTT_CONTROL_DISCOVERY_URL__;
        f.controller.start();
        assert.equal(f.calls.length, 0);
        f.w.location = new URL("http://127.0.0.1:8443/");
        f.controller.start(true);
        assert.equal(
            f.calls.at(-1).request.url,
            "http://127.0.0.1:8443/api/control-discovery"
        );
        assert.equal(
            f.calls.at(-1).request.headers["X-Ottplay-Discovery"],
            "1"
        );
        assert.equal(f.calls.at(-1).request.secureControl, false);
        const hosted = fixture();
        hosted.controller.start();
        assert.equal(
            hosted.calls[0].request.headers["X-Ottplay-Discovery"],
            undefined
        );
    }
);
check(
    "unsupported secure browser transport offers manual setup without pairing",
    () => {
        const f = fixture();
        f.controller.start();
        f.calls[0].done({
            body: "",
            error: "secure_control_unavailable",
            status: 0,
        });
        assert.equal(f.controller.status().state, "error");
        assert.match(f.controller.status().message, /settings manually/);
        assert.equal(f.calls.length, 1);
        assert.equal(f.timers.size, 0);
    }
);
check("hosted pairing binds the selected public alias", () => {
    const f = fixture();
    f.w.__OTTPLAY_HOSTED__ = {
        controlTransport: { bases: [server.address], version: 1 },
    };
    f.discover();
    const body = JSON.parse(f.calls.at(-1).request.body);
    assert.equal(body.server_address, server.address);
    f.respond(receipt, 201);
    f.tick(2000);
    f.respond({ ...approval, address: "https://wrong.example/" });
    assert.equal(
        f.applied.length,
        0,
        "an alias mismatch cannot store credentials"
    );
});

(async () => {
    async function nativeCheck(name, test) {
        await test();
        passed++;
        console.log("PASS discovery: " + name);
    }
    await nativeCheck(
        "empty native DNS uses the profile and still requires approval",
        async () => {
            const empty = { servers: [], version: 1 };
            const f = fixture({}, () => Promise.resolve(empty));
            f.controller.start();
            await Promise.resolve();
            assert.equal(f.calls.length, 1);
            assert.equal(f.calls[0].request.method, "GET");
            assert.equal(
                f.calls[0].request.url,
                f.w.__OTT_CONTROL_DISCOVERY_URL__
            );
            assert.equal(f.calls[0].request.headers.Authorization, undefined);
            assert.equal(f.calls[0].request.secureControl, true);
            assert.equal(f.applied.length, 0);
            f.respond({ servers: [server], version: 1 });
            assert.equal(f.calls.length, 2);
            assert.equal(f.calls[1].request.method, "POST");
            assert.equal(
                f.calls[1].request.url,
                server.address + "/api/pairings"
            );
            assert.equal(f.applied.length, 0);
            f.respond(receipt, 201);
            f.tick(2000);
            f.respond(approval);
            assert.equal(f.applied.length, 1);
            assert.equal(f.settings.address, server.address);
            assert.equal(f.settings.token, approval.token);
            assert.equal(f.controller.status().state, "connected");
        }
    );
    await nativeCheck(
        "nonempty native DNS retains priority over the profile",
        async () => {
            for (const servers of [
                [server],
                [server, { ...server, id: "other.example." }],
            ]) {
                const f = fixture({}, () =>
                    Promise.resolve({ servers, version: 1 })
                );
                f.controller.start();
                await Promise.resolve();
                assert.equal(
                    f.calls.filter((call) => call.request.method === "GET")
                        .length,
                    0
                );
                assert.equal(f.calls.length, servers.length === 1 ? 1 : 0);
                assert.equal(
                    f.controller.status().state,
                    servers.length === 1 ? "pairing" : "choose"
                );
                assert.equal(f.applied.length, 0);
            }
        }
    );
    await nativeCheck(
        "native fallback rejects malformed DNS and never invents a profile",
        async () => {
            for (const value of [
                null,
                {},
                { servers: [], version: 2 },
                { servers: {}, version: 1 },
                {
                    servers: [{ ...server, address: "http://unsafe.example" }],
                    version: 1,
                },
            ]) {
                const f = fixture({}, () => Promise.resolve(value));
                f.controller.start();
                await Promise.resolve();
                assert.equal(f.controller.status().state, "error");
                assert.equal(f.calls.length, 0);
            }
            for (const profile of [
                undefined,
                null,
                "",
                false,
                0,
                true,
                42,
                {},
                [],
                ["https://controller.example/discovery"],
                "http://unsafe.example/discovery",
                "https://user:secret@example.test/discovery",
            ]) {
                const f = fixture({}, () =>
                    Promise.resolve({ servers: [], version: 1 })
                );
                f.w.__OTT_CONTROL_DISCOVERY_URL__ = profile;
                f.w.location = new URL("http://127.0.0.1:8443/");
                f.controller.start();
                await Promise.resolve();
                assert.ok(
                    ["error", "unavailable"].includes(
                        f.controller.status().state
                    )
                );
                assert.equal(f.calls.length, 0);
                assert.equal(f.applied.length, 0);
            }
        }
    );
    await nativeCheck(
        "empty or invalid profile responses stop without another lookup",
        async () => {
            for (const value of [
                { servers: [], version: 1 },
                { servers: [], version: 2 },
            ]) {
                const f = fixture({}, () =>
                    Promise.resolve({ servers: [], version: 1 })
                );
                f.controller.start();
                await Promise.resolve();
                f.respond(value);
                f.tick(20000);
                assert.equal(f.calls.length, 1);
                assert.equal(f.applied.length, 0);
                assert.ok(
                    ["error", "unavailable"].includes(
                        f.controller.status().state
                    )
                );
                assert.equal(f.timers.size, 0);
            }
        }
    );
    await nativeCheck(
        "saved and deliberately disconnected settings suppress native fallback",
        async () => {
            for (const config of [
                { address: server.address },
                { token: approval.token },
                { enabled: true },
                {
                    address: server.address,
                    enabled: false,
                    token: approval.token,
                },
            ]) {
                let lookups = 0;
                const f = fixture(config, () => {
                    lookups++;
                    return Promise.resolve({ servers: [], version: 1 });
                });
                f.controller.start();
                await Promise.resolve();
                assert.equal(lookups, 0);
                assert.equal(f.calls.length, 0);
                assert.equal(f.applied.length, 0);
                for (const key of Object.keys(config))
                    assert.equal(f.settings[key], config[key]);
            }
        }
    );
    await nativeCheck(
        "stale empty native results cannot begin profile discovery",
        async () => {
            for (const cancel of [
                (f) => f.controller.cancel(),
                (f) => f.tick(15000),
                (f) => {
                    f.settings.address = "https://manual.example";
                },
                (f) => f.setUuid("changed_device"),
            ]) {
                let resolve;
                const f = fixture(
                    {},
                    () =>
                        new Promise((done) => {
                            resolve = done;
                        })
                );
                f.controller.start();
                cancel(f);
                resolve({ servers: [], version: 1 });
                await Promise.resolve();
                assert.equal(f.calls.length, 0);
                assert.equal(f.applied.length, 0);
            }
            const pending = [];
            const f = fixture(
                {},
                () => new Promise((done) => pending.push(done))
            );
            f.controller.start();
            f.controller.start(true);
            pending[0]({ servers: [], version: 1 });
            await Promise.resolve();
            assert.equal(f.calls.length, 0);
            pending[1]({ servers: [], version: 1 });
            await Promise.resolve();
            assert.equal(f.calls.length, 1);
        }
    );
    await nativeCheck(
        "profile fallback keeps the original deadline and ignores canceled replies",
        async () => {
            for (const cancel of [
                (f) => f.controller.cancel(),
                (f) => f.tick(3000),
            ]) {
                let resolve;
                const f = fixture(
                    {},
                    () =>
                        new Promise((done) => {
                            resolve = done;
                        })
                );
                f.controller.start();
                f.tick(12000);
                resolve({ servers: [], version: 1 });
                await Promise.resolve();
                assert.equal(f.calls.length, 1);
                cancel(f);
                assert.equal(f.calls[0].aborted, true);
                f.respond({ servers: [server], version: 1 }, 200, f.calls[0]);
                assert.equal(f.calls.length, 1);
                assert.equal(f.applied.length, 0);
                assert.equal(f.timers.size, 0);
            }
        }
    );
    let resolve;
    const f = fixture(
        {},
        () =>
            new Promise((done) => {
                resolve = done;
            })
    );
    f.controller.start();
    f.tick(15000);
    resolve({ servers: [server], version: 1 });
    await Promise.resolve();
    assert.equal(f.calls.length, 0);
    assert.equal(f.controller.status().state, "error");
    const native = fixture({}, () =>
        Promise.resolve({ servers: [server], version: 1 })
    );
    native.controller.start();
    await Promise.resolve();
    assert.equal(native.calls.at(-1).request.method, "POST");
    assert.match(
        fs.readFileSync("src/index.ts", "utf8"),
        /__OTT_CONTROL_DISCOVERY_VERSION__ = 1/
    );
    console.log(
        "PASS discovery: native timeout/late result, bridge routing, capability marker; " +
            passed +
            " controller groups"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
