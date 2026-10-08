const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");
const {
    embedPlayerBuildIdentity,
} = require("../scripts/player-build-identity.cjs");
let time = 1700000000000;
const modules = {};
function load(relative) {
    const file = path.resolve(relative);
    if (modules[file]) return modules[file];
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    const exports = {};
    modules[file] = exports;
    vm.runInNewContext(code.replace(/__OTTP_VERSION__/g, "1.1.53+fixture"), {
        Date: { now: () => time },
        exports,
        require: (name) => load(path.resolve(path.dirname(file), name + ".ts")),
    });
    return exports;
}
const install = load("src/plugins/remote-inspect.ts").installRemoteInspection;
const w = new JSDOM("<!doctype html><video id='video'></video>").window;
let reads = 0;
const forbidden = () => {
    throw new Error("unexpected effect");
};
w.fetch = w.setTimeout = w.__ottCoreBackend = forbidden;
w.__ottCoreBackendPeek = () => {
    reads++;
    return null;
};
w.__ottClassicPlayback = {
    snapshot: () => ({ generation: 7, phase: "idle", target: null }),
};
w.__ottClassicScreenPort = {
    revision: () => 1,
    screens: { current: () => null },
};
const api = install(w);
const runtime = load("src/commands/remote-restart.ts").remotePlayerInfo(
    w
).runtime;
function query(section, extra = {}) {
    let response;
    api.request(
        { params: { runtime, section, version: 1, ...extra } },
        (value) => {
            response = value;
        }
    );
    return JSON.parse(JSON.stringify(response));
}
const doctor = query("doctor");
assert.equal(doctor.status, "ok");
assert.equal(doctor.data.data.build.version, "1.1.53+fixture");
assert.equal(doctor.data.data.build.identity, "partial");
assert.equal(doctor.data.data.runtime, runtime);
assert.equal(doctor.data.data.media.displayEvidence, "unavailable");
assert.ok(reads > 0);
assert.equal(query("doctor", { extra: true }).data.error, "invalid_request");
assert.equal(
    query("doctor", { runtime: "another-page" }).data.runtime,
    runtime
);
assert.equal(
    query("doctor", { runtime: "another-page" }).data.error,
    "runtime_mismatch"
);
assert.equal(
    query("operation", { operation_id: "bad" }).data.error,
    "invalid_request"
);
assert.equal(
    api.accept({ action: "inspect", params: { runtime: "another-page" } }),
    false
);
assert.equal(api.accept({ action: "inspect", params: { runtime } }), true);
assert.equal(api.accept({ action: "play" }), true);

const id = "a".repeat(32);
const result = () => query("operation", { operation_id: id }).data.data;
assert.equal(result().state, "unknown");
let effect;
let invoked = 0;
api.execute(
    { action: "restart", id, params: {} },
    () => {},
    (fn) => {
        effect = fn;
    },
    (_item, done, defer) => {
        defer(() => {
            invoked++;
        });
        done({ data: { accepted: true }, status: "ok" });
    }
);
assert.equal(result().state, "accepted");
assert.equal(invoked, 0);
effect();
assert.equal(result().state, "invoked");
assert.equal(result().evidence.kind, "handler_completed");
assert.equal(invoked, 1);
assert.equal(result().evidence.generation, null);

// Neither an accepted handler nor unrelated decoder progress is proof of effect.
api.execute(
    { action: "playback", id, params: { operation: "resume" } },
    () => {},
    undefined,
    (_item, done) => done({ data: { accepted: true }, status: "ok" })
);
w.__ottCoreBackendPeek = () => ({
    current: () => ({
        id: 3,
        snapshot: () => ({ phase: "playing", position: 900 }),
    }),
});
assert.equal(result().state, "invoked");
const readId = "b".repeat(32);
for (const [action, params] of [
    ["plex_queue", { op: "status" }],
    ["vportal_queue", { operation: "status" }],
    ["maintenance", { operation: "health" }],
]) {
    api.execute(
        { action, id: readId, params },
        () => {},
        undefined,
        (_item, done) => done({ data: {}, status: "ok" })
    );
    assert.equal(
        query("operation", { operation_id: readId }).data.data.state,
        "unknown"
    );
}
time += 600001;
assert.equal(result().state, "expired");
for (let i = 0; i < 130; i++) {
    api.execute(
        { action: "play", id: i.toString(16).padStart(32, "0"), params: {} },
        () => {},
        undefined,
        (_item, done) =>
            done({
                data: { error: "private URL must not enter journal" },
                status: "rejected",
            })
    );
}
assert.equal(result().state, "unknown");
assert.equal(
    query("operation", { operation_id: (129).toString(16).padStart(32, "0") })
        .data.data.state,
    "rejected"
);
assert.ok(
    !JSON.stringify(
        query("operation", {
            operation_id: (129).toString(16).padStart(32, "0"),
        })
    ).includes("private")
);
const pendingId = "d".repeat(32);
const cancel = api.execute(
    { action: "play", id: pendingId, params: {} },
    () => {},
    undefined,
    () => () => {}
);
cancel();
assert.equal(
    query("operation", { operation_id: pendingId }).data.data.state,
    "expired"
);

// Build identity describes the loaded code and explicitly degrades dirty sources.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ott-build-identity-"));
try {
    const git = (...args) =>
        execFileSync("git", args, { cwd: directory, stdio: "pipe" })
            .toString()
            .trim();
    git("init", "-q");
    fs.writeFileSync(path.join(directory, "source"), "first");
    git("add", "source");
    git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "Fixture"
    );
    const source = "__OTTP_SOURCE_REVISION__ __OTTP_BUILD_ID__";
    const clean = embedPlayerBuildIdentity(source, directory);
    assert.ok(clean.startsWith(git("rev-parse", "HEAD") + " bundle-"));
    assert.equal(embedPlayerBuildIdentity(source, directory), clean);
    fs.writeFileSync(path.join(directory, "source"), "edited");
    assert.ok(
        embedPlayerBuildIdentity(source, directory).startsWith(" bundle-")
    );
    assert.notEqual(
        embedPlayerBuildIdentity(source + " changed", directory).split(" ")[1],
        clean.split(" ")[1]
    );
} finally {
    fs.rmSync(directory, { force: true, recursive: true });
}
console.log(
    "remote inspection: pure snapshots, target fencing, bounded truthful receipts and loaded build identity PASS"
);
