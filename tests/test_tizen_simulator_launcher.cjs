const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay Samsung launch "));
const root = path.join(tmp, "project with spaces");
const sdk = path.join(tmp, "SDK with spaces");
const log = path.join(tmp, "calls.jsonl");
const tools = path.join(tmp, "fake tools");
const fake = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({ name, args: process.argv.slice(2) })+'\\n');
if (name === 'uname') console.log('Darwin');
else if (name !== 'nwjs') process.exit(98);
`;
function executable(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fake, { mode: 0o755 });
}
function calls() {
    return fs
        .readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
}
function run(mode, args = [], success = true) {
    fs.writeFileSync(log, "");
    const result = spawnSync(
        "bash",
        [path.join(root, "scripts", `${mode}-tizen-simulator.sh`), ...args],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                CALL_LOG: log,
                PATH: tools + path.delimiter + process.env.PATH,
                TIZEN_SIMULATOR_SDK: sdk,
            },
            timeout: 15000,
        }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, success ? 0 : 1, result.stdout + result.stderr);
    return result.stdout + result.stderr;
}

try {
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    for (const name of ["setup-tizen-simulator.sh", "run-tizen-simulator.sh"])
        fs.copyFileSync(
            path.join(__dirname, "../scripts", name),
            path.join(root, "scripts", name)
        );
    for (const name of ["curl", "ditto", "uname"])
        executable(path.join(tools, name));
    const appBundle = path.join(sdk, "tools/sec-tv-simulator/nwjs.app");
    executable(path.join(appBundle, "Contents/MacOS/nwjs"));
    const app = path.join(tmp, "local app [test] #1.html");
    fs.writeFileSync(app, "<!doctype html><title>Local test</title>");

    assert.match(run("run", ["--dry-run"]), /nwjs/);
    assert.equal(calls().length, 0);
    run("run", ["--app", app]);
    assert.deepEqual(calls(), [
        { args: ["--file=" + pathToFileURL(app).href], name: "nwjs" },
    ]);
    for (const directory of [sdk, path.dirname(appBundle), appBundle]) {
        run("run", ["--sdk", directory]);
        assert.deepEqual(calls(), [{ args: [], name: "nwjs" }]);
    }
    const nestedSdk = path.join(tmp, "nested vendor package");
    const relativeApp = "vendor/resources/nwjs.app";
    executable(path.join(nestedSdk, relativeApp, "Contents/MacOS/nwjs"));
    const marker = path.join(nestedSdk, "simulator-app-path.txt");
    fs.writeFileSync(marker, relativeApp + "\n");
    run("run", ["--sdk", nestedSdk, "--app", app]);
    assert.deepEqual(calls()[0].args, ["--file=" + pathToFileURL(app).href]);
    for (const invalid of [
        "",
        "..",
        "../outside/nwjs.app",
        "vendor/../nwjs.app",
        "vendor/..",
        "/tmp/nwjs.app",
        "vendor\\nwjs.app",
        "vendor/nwjs.app\nextra",
        "vendor/not-an-app",
    ]) {
        fs.writeFileSync(marker, invalid + "\n");
        assert.match(
            run("run", ["--sdk", nestedSdk, "--dry-run"], false),
            /Invalid local simulator path marker/
        );
        assert.equal(calls().length, 0);
    }
    const apk = path.join(tmp, "app.apk");
    fs.writeFileSync(apk, "not HTML");
    for (const invalid of [apk, "http://127.0.0.1:8095/", tmp]) {
        assert.match(run("run", ["--app", invalid], false), /HTML/);
        assert.equal(calls().length, 0);
    }
    assert.match(run("run", ["--app"], false), /requires a value/);
    assert.match(run("run", ["--app", "--dry-run"], false), /requires a value/);
    assert.match(
        run("run", ["--sdk", path.join(tmp, "missing SDK")], false),
        /Simulator not found/
    );
    assert.equal(calls().length, 0);

    const cache = path.join(tmp, "new cache");
    const destination = path.join(tmp, "new destination");
    assert.match(
        run("setup", [
            "--cache",
            cache,
            "--destination",
            destination,
            "--dry-run",
        ]),
        /tv-samsung-websimulator-core_10\.0\.6_macos-64\.zip/
    );
    assert.equal(calls().length, 0);
    assert.equal(fs.existsSync(cache), false);
    assert.equal(fs.existsSync(destination), false);
    fs.mkdirSync(destination);
    const sentinel = path.join(destination, "preserve.txt");
    fs.writeFileSync(sentinel, "keep existing SDK");
    assert.match(
        run("setup", ["--destination", destination], false),
        /refusing to overwrite/
    );
    assert.equal(fs.readFileSync(sentinel, "utf8"), "keep existing SDK");
    assert.equal(calls().length, 0);
    const link = path.join(tmp, "existing SDK link");
    fs.symlinkSync(destination, link);
    assert.match(
        run("setup", ["--destination", link], false),
        /refusing to overwrite/
    );
    assert.equal(calls().length, 0);
    assert.match(run("setup", ["--destination"], false), /requires a value/);
    assert.match(
        run("setup", ["--cache", "--dry-run"], false),
        /requires a value/
    );
    assert.equal(calls().length, 0);

    fs.mkdirSync(cache);
    fs.writeFileSync(
        path.join(cache, "tv-samsung-websimulator-core_10.0.6_macos-64.zip"),
        "partial download"
    );
    assert.match(
        run(
            "setup",
            [
                "--cache",
                cache,
                "--destination",
                path.join(tmp, "invalid archive destination"),
            ],
            false
        ),
        /Archive size differs/
    );
    assert.deepEqual(calls(), [{ args: ["-s"], name: "uname" }]);
    console.log("Samsung TV Simulator setup/launcher integration tests passed");
} finally {
    fs.rmSync(tmp, { force: true, recursive: true });
}
