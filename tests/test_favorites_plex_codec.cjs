const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(
    path.join(__dirname, "../src/media/favorites-plex-codec.ts"),
    "utf8",
);
const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES5 },
    reportDiagnostics: true,
});
assert.equal(output.diagnostics.length, 0);
const host = { exports: {} };
vm.runInNewContext(output.outputText, host);
const plain = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
    const state = {
        owner: {
            verified: true,
            serverId: "verified-pms-123",
            sourceId: "private-fixture-secret",
        },
        calls: [],
    };
    const ports = {
        current: () => state.owner,
        request: (route) => {
            state.calls.push(route);
            return {
                route,
                token: "fixture-secret",
                address: "https://private.invalid",
            };
        },
    };
    return { state, ports, api: host.createFavoritesPlexCodec(ports) };
}
function rejected(code, run) {
    assert.throws(
        run,
        (error) =>
            error.code === code && !error.message.includes("fixture-secret"),
    );
}
let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log("PASS " + name);
}
const locator = (ratingKey = "12345") => ({
    kind: "plex-media",
    serverId: "verified-pms-123",
    ratingKey,
});
test("exact wire projection and receiver-private request reconstruction", () => {
    const f = fixture();
    const value = f.api.encode({
        sourceId: f.state.owner.sourceId,
        request: "/library/metadata/12345",
    });
    assert.deepEqual(plain(value), locator());
    assert.equal(JSON.stringify(value).includes("fixture-secret"), false);
    assert.equal(JSON.stringify(value).includes("request"), false);
    const decoded = f.api.decode(value);
    assert.equal(decoded.sourceId, "private-fixture-secret");
    assert.deepEqual(plain(decoded.request), {
        route: "/library/metadata/12345",
        token: "fixture-secret",
        address: "https://private.invalid",
    });
    assert.deepEqual(f.state.calls, ["/library/metadata/12345"]);
});
test("rating keys remain exact decimal strings without numeric precision loss", () => {
    const f = fixture();
    for (const key of ["1", "99999999999999999999"]) {
        assert.equal(
            f.api.encode({
                sourceId: f.state.owner.sourceId,
                request: "/library/metadata/" + key,
            }).ratingKey,
            key,
        );
        assert.equal(
            f.api.decode(locator(key)).request.route,
            "/library/metadata/" + key,
        );
    }
});
test("unsafe rating keys and nonexact private paths are rejected", () => {
    const f = fixture();
    for (const key of [
        "0",
        "01",
        "-1",
        "1.0",
        "1e2",
        "1/children",
        "1?X-Plex-Token=fixture-secret",
        "1#x",
        "1%2f",
        "١",
        "1\n",
        "9".repeat(21),
        1,
        null,
    ]) {
        rejected("invalid_locator", () => f.api.decode(locator(key)));
        if (typeof key === "string")
            rejected("invalid_item", () =>
                f.api.encode({
                    sourceId: f.state.owner.sourceId,
                    request: "/library/metadata/" + key,
                }),
            );
    }
    for (const route of [
        "https://private.invalid/library/metadata/1",
        "//library/metadata/1",
        "/library/metadata/1/",
        "/library/metadata/../1",
        "/library/metadata/%31",
    ]) {
        rejected("invalid_item", () =>
            f.api.encode({ sourceId: f.state.owner.sourceId, request: route }),
        );
    }
    assert.equal(f.state.calls.length, 0);
});
test("wire fields, kind and machine identifier are strict and bounded", () => {
    const f = fixture();
    for (const value of [
        null,
        [],
        {},
        { ...locator(), token: "fixture-secret" },
        { ...locator(), sourceId: "private" },
        { ...locator(), kind: "plex" },
        {
            kind: "plex-media",
            serverMachineId: "verified-pms-123",
            ratingKey: "1",
        },
    ])
        rejected("invalid_locator", () => f.api.decode(value));
    for (const serverId of [
        "",
        "https://pms.invalid",
        "pms?token=fixture-secret",
        "pms/1",
        "a\n",
        "a".repeat(257),
        3,
    ])
        rejected("invalid_locator", () =>
            f.api.decode({ ...locator(), serverId }),
        );
    rejected("invalid_item", () =>
        f.api.encode({
            sourceId: "private",
            request: "/library/metadata/1",
            token: "fixture-secret",
        }),
    );
    assert.equal(f.state.calls.length, 0);
});
test("unverified manual and foreign PMS/source are never resolved", () => {
    for (const verified of [false, "true", 1, undefined]) {
        const f = fixture();
        f.state.owner.verified = verified;
        rejected("source_unavailable", () => f.api.decode(locator()));
        rejected("source_unavailable", () =>
            f.api.encode({
                sourceId: f.state.owner.sourceId,
                request: "/library/metadata/1",
            }),
        );
        assert.equal(f.state.calls.length, 0);
    }
    const f = fixture();
    rejected("item_unavailable", () =>
        f.api.decode({ ...locator(), serverId: "foreign-pms" }),
    );
    rejected("item_unavailable", () =>
        f.api.encode({
            sourceId: "foreign-source",
            request: "/library/metadata/1",
        }),
    );
    assert.equal(f.state.calls.length, 0);
});
test("request construction and current failures expose no private errors", () => {
    const f = fixture();
    f.ports.request = () => {
        throw Error("fixture-secret");
    };
    rejected("request_unavailable", () => f.api.decode(locator()));
    for (const result of [null, undefined]) {
        f.ports.request = () => result;
        rejected("request_unavailable", () => f.api.decode(locator()));
    }
    f.ports.current = () => {
        throw Error("fixture-secret");
    };
    rejected("source_unavailable", () => f.api.decode(locator()));
});
test("context rechecked after receiver request construction and before encode return", () => {
    const f = fixture();
    f.ports.request = () => {
        f.state.owner = { ...f.state.owner, sourceId: "replaced" };
        return "private";
    };
    rejected("context_changed", () => f.api.decode(locator()));
    const g = fixture();
    let reads = 0;
    g.ports.current = () => ({
        ...g.state.owner,
        serverId: ++reads === 1 ? "verified-pms-123" : "replaced",
    });
    rejected("context_changed", () =>
        g.api.encode({
            sourceId: g.state.owner.sourceId,
            request: "/library/metadata/1",
        }),
    );
});
test("accessors and hidden unsafe fields cannot cross codec boundary", () => {
    const f = fixture();
    let reads = 0;
    const value = locator();
    Object.defineProperty(value, "ratingKey", {
        enumerable: true,
        get: () => {
            reads++;
            return "1";
        },
    });
    rejected("invalid_locator", () => f.api.decode(value));
    const hidden = locator();
    Object.defineProperty(hidden, "token", { value: "fixture-secret" });
    rejected("invalid_locator", () => f.api.decode(hidden));
    assert.equal(reads, 0);
    assert.equal(f.state.calls.length, 0);
});
console.log(`Favorites Plex codec: ${passed} tests passed`);
