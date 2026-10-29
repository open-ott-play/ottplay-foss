"use strict";
const {
    createMainPorts,
} = require("./helpers/global-favorites-main-ports.cjs");
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript"),
    crypto = require("node:crypto");
function declaration(source, predicate) {
    const ast = ts.createSourceFile(
        "fixture.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
    let found;
    function visit(node) {
        if (predicate(node)) {
            assert.equal(found, undefined);
            found = node.getText(ast);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert(found);
    return found;
}
const entry = fs.readFileSync("src/commands/global-favorites.ts", "utf8");
const writable = declaration(
    entry,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "writable"
);
// Select the actual function expression without splitting its arrow/comparison operators.
const ast = ts.createSourceFile(
    "entry.ts",
    entry,
    ts.ScriptTarget.Latest,
    true
);
let authorized;
function find(node) {
    if (
        ts.isBinaryExpression(node) &&
        node.left.getText(ast) === "ports.authorized"
    )
        authorized = node.right.getText(ast);
    ts.forEachChild(node, find);
}
find(ast);
assert(authorized.includes('"inspect"'));
let fixtureSource = declaration(
    fs.readFileSync("tests/test_global_favorites_host.cjs", "utf8"),
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "fixture"
);
const fixtureAst = ts.createSourceFile(
    "host-fixture.ts",
    fixtureSource,
    ts.ScriptTarget.Latest,
    true
);
let authorization;
function locateAuthorization(node) {
    if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(fixtureAst) === "authorized"
    ) {
        assert.equal(authorization, undefined);
        authorization = node.initializer;
    }
    ts.forEachChild(node, locateAuthorization);
}
locateAuthorization(fixtureAst);
assert(authorization && ts.isArrowFunction(authorization));
assert.equal(authorization.parameters.length, 0);
assert.equal(authorization.body.kind, ts.SyntaxKind.TrueKeyword);
const fixtureDeclaration = fixtureAst.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "fixture"
);
assert(fixtureDeclaration?.body);
const brace = fixtureDeclaration.body.getStart(fixtureAst);
fixtureSource =
    fixtureSource.slice(0, authorization.getStart(fixtureAst)) +
    authorized +
    fixtureSource.slice(authorization.end);
fixtureSource =
    fixtureSource.slice(0, brace + 1) +
    "\n" +
    writable +
    "\n" +
    fixtureSource.slice(brace + 1);
const create = vm.runInNewContext(
    ts.transpileModule("(" + fixtureSource + ")", {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText,
    {
        assert,
        fs,
        path,
        vm,
        ts,
        crypto,
        Map,
        Buffer,
        Promise,
        Uint8Array,
        console,
        createMainPorts,
    }
);
async function main() {
    const f = create(),
        host = f.host,
        runtime = "runtime-one";
    let wakes = 0;
    f.w.stbOn = () => {
        wakes++;
    };
    f.w.wakeup = () => {
        wakes++;
    };
    const description = await host.protocol.execute(
        { op: "describe", runtime },
        128,
        1030
    );
    const document = host.codec.document({
            version: 1,
            entries: [
                {
                    title: "News",
                    origin: {
                        provider: "m3u",
                        profile: "Profile",
                        subprofile: null,
                        sourceAlias: "News",
                    },
                    locator: { kind: "channel", channelId: "news" },
                },
            ],
        }),
        bytes = Buffer.from(JSON.stringify(document));
    const begin = await host.protocol.execute(
        {
            op: "begin",
            runtime,
            operation_id: description.admission.operation_id,
            mode: "merge",
            expected_revision: description.revision,
            expected_context_revision: description.context_revision,
            document_sha256: f.hash(bytes),
            size_bytes: bytes.length,
            chunk_count: 1,
            budget_ms: 45000,
            required_kinds: ["channel"],
        },
        512,
        1030
    );
    assert.equal(begin.error, undefined);
    await host.protocol.execute(
        {
            op: "append",
            runtime,
            transaction_id: begin.transaction_id,
            seq: 0,
            offset: 0,
            chunk_sha256: f.hash(bytes),
            data_base64: bytes.toString("base64"),
        },
        1024,
        1030
    );
    const preview = await host.protocol.execute(
        {
            op: "preview",
            runtime,
            transaction_id: begin.transaction_id,
            page_offset: 0,
            max_entries: 64,
        },
        256,
        1030
    );
    assert.equal(preview.error, undefined);
    const originalSet = f.data.set.bind(f.data);
    let fault = true;
    f.data.set = function (key, value) {
        originalSet(key, value);
        if (fault && key === "remoteFavorites.v1") {
            fault = false;
            throw Error("uncertain target write");
        }
        return f.data;
    };
    const committed = await host.protocol.execute(
        {
            op: "commit",
            runtime,
            transaction_id: begin.transaction_id,
            operation_id: begin.operation_id,
            plan_digest: preview.plan_digest,
        },
        256,
        1030
    );
    assert(committed.error);
    const request = (params) => ({
        params: { runtime, subject: "global", ...params },
        expires_at: 1030,
    });
    const prior = await host.recovery.execute(
        request({ op: "inspect", operation_id: begin.operation_id })
    );
    assert.equal(prior.acknowledge_allowed, true);
    f.w.__ottStandby.blocked = () => true;
    const count = f.writes.length;
    const inspected = await host.recovery.execute(
        request({ op: "inspect", operation_id: begin.operation_id })
    );
    assert(inspected.record);
    assert.equal(inspected.acknowledge_allowed, false);
    assert.equal(inspected.plan_sha256, null);
    const status = await host.protocol.execute(
        { op: "status", runtime, operation_id: begin.operation_id },
        128,
        1030
    );
    assert.equal(status.error, undefined);
    assert.equal(status.state, "unknown");
    await assert.rejects(
        host.recovery.execute(
            request({ op: "acknowledge", operation_id: begin.operation_id })
        ),
        /policy_denied/
    );
    assert.equal(f.writes.length, count);
    assert.equal(wakes, 0);
    host.dispose();
    console.log(
        "PASS actual host authorizer: standby inspect/status read retained uncertainty without writes/wake, acknowledgement refused"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
