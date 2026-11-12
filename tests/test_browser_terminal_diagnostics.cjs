const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const observeTerminal = require("../scripts/browser-terminal-diagnostics.cjs");
const source = fs.readFileSync(
    path.join(__dirname, "../scripts/browser-acceptance.cjs"),
    "utf8"
);
const sha = "a".repeat(40);
function fixture(t) {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "browser-terminal-"));
    t.after(() => fs.rmSync(output, { force: true, recursive: true }));
    const options = {
        candidate: { sourceSha: sha },
        output,
        runtime: {
            browserVersion: "153.0",
            engine: "firefox",
            playwrightVersion: "1.62.1",
            sourceSha: sha,
            target: "ubuntu-latest-firefox-1-62-1",
        },
    };
    return {
        file: path.join(output, "acceptance-terminal.json"),
        options,
        read() {
            return JSON.parse(fs.readFileSync(this.file, "utf8"));
        },
    };
}

test("terminal observer preserves success and writes diagnostic-only metadata", async (t) => {
    const f = fixture(t);
    const expected = {};
    assert.equal(
        await observeTerminal(f.options, (observer) => {
            observer.phase("write-acceptance");
            observer.process({ signal: null, status: 0 });
            return expected;
        }),
        expected
    );
    assert.equal(f.read().acceptance, false);
    assert.equal(f.read().outcome, "passed");
    assert.equal(f.read().sourceSha, sha);
    assert.equal(f.read().phase, "write-acceptance");
    assert.equal(f.read().scenarioProcess.status, 0);
    if (process.platform !== "win32")
        assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});

test("failure preserves exact rejection and never serializes messages or buffers", async (t) => {
    const f = fixture(t);
    const secret = "must-not-be-written";
    const failure = Object.assign(new Error(secret), { code: "ETIMEDOUT" });
    await assert.rejects(
        observeTerminal(f.options, (observer) => {
            observer.phase("scenario-process");
            observer.process({
                args: [secret],
                error: failure,
                signal: "SIGTERM",
                status: null,
                stderr: Buffer.from(secret),
                stdout: Buffer.from(secret),
            });
            throw failure;
        }),
        (error) => error === failure
    );
    const record = f.read();
    assert.equal(record.outcome, "failed");
    assert.equal(record.errorCode, "ETIMEDOUT");
    assert.deepEqual(record.scenarioProcess, {
        errorCode: "ETIMEDOUT",
        signal: "SIGTERM",
        status: null,
    });
    assert.equal(fs.readFileSync(f.file, "utf8").includes(secret), false);
});

test("untrusted metadata is omitted and the diagnostic stays below two KiB", async (t) => {
    const f = fixture(t);
    const secret = "https://private.invalid/" + "x".repeat(100000);
    Object.keys(f.options.runtime).forEach((key) => {
        f.options.runtime[key] = secret;
    });
    f.options.candidate.sourceSha = secret;
    await observeTerminal(f.options, (observer) => {
        observer.phase(secret);
        observer.process({
            error: { code: secret },
            signal: secret,
            status: secret,
        });
    });
    assert.equal(
        fs.readFileSync(f.file, "utf8").includes("private.invalid"),
        false
    );
    assert.ok(fs.statSync(f.file).size < 2048);
    assert.equal(f.read().sourceSha, null);
    assert.equal(f.read().engine, null);
    assert.equal(f.read().phase, "initializing");
});

test("error code is read once before allowlisting an alternating getter", async (t) => {
    const f = fixture(t);
    let reads = 0;
    const original = {};
    Object.defineProperty(original, "code", {
        get() {
            return ++reads === 1 ? "ETIMEDOUT" : "private alternating value";
        },
    });
    await assert.rejects(
        observeTerminal(f.options, () => Promise.reject(original)),
        (error) => error === original
    );
    assert.equal(reads, 1);
    assert.equal(f.read().errorCode, "ETIMEDOUT");
    assert.equal(
        fs.readFileSync(f.file, "utf8").includes("private alternating value"),
        false
    );
});

test("a hostile error getter cannot replace the original rejection", async (t) => {
    const f = fixture(t);
    const original = {};
    Object.defineProperty(original, "code", {
        get() {
            throw new Error("getter failed");
        },
    });
    await assert.rejects(
        observeTerminal(f.options, () => Promise.reject(original)),
        (error) => error === original
    );
    assert.equal(f.read().errorCode, null);
});

test("an existing file is not overwritten and does not alter a successful result", async (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.file, "prior evidence");
    assert.equal(await observeTerminal(f.options, () => 42), 42);
    assert.equal(fs.readFileSync(f.file, "utf8"), "prior evidence");
});

test("missing output preserves failure and a final symlink is never followed", async (t) => {
    const f = fixture(t);
    const original = new Error("original");
    await assert.rejects(
        observeTerminal(
            { ...f.options, output: path.join(f.options.output, "missing") },
            () => {
                throw original;
            }
        ),
        (error) => error === original
    );
    // Windows CI may prohibit ordinary-user symlink creation.
    if (process.platform !== "win32") {
        const target = path.join(f.options.output, "target");
        fs.writeFileSync(target, "do not overwrite");
        fs.symlinkSync(target, f.file);
        assert.equal(await observeTerminal(f.options, () => 7), 7);
        assert.equal(fs.readFileSync(target, "utf8"), "do not overwrite");
        assert.equal(fs.lstatSync(f.file).isSymbolicLink(), true);
    }
});

async function runCaller(t, failure, crashOptions = {}) {
    const f = fixture(t);
    const evidence = path.join(f.options.output, "acceptance.json");
    const capabilities = { hlsVersion: "fixture" };
    const profile = { media: "required", scenarios: ["required scenario"] };
    const report = {
        errors: [],
        suites: [
            {
                specs: [
                    {
                        ok: true,
                        tests: [
                            {
                                results: [{ status: "passed" }],
                                status: "expected",
                            },
                        ],
                        title: "required scenario",
                    },
                ],
            },
        ],
    };
    if (failure === "retried")
        report.suites[0].specs[0].tests[0].results.push({ status: "passed" });
    if (failure === "missing-scenario") report.suites = [];
    let reportReads = 0;
    let spawned = 0;
    const child = { error: undefined, signal: null, status: 0 };
    if (failure === "child-exit") child.status = 1;
    if (failure === "child-signal") {
        child.status = null;
        child.signal = "SIGKILL";
    }
    if (failure === "child-timeout") {
        child.status = null;
        child.error = Object.assign(new Error("synthetic timeout"), {
            code: "ETIMEDOUT",
        });
    }
    const fakeProcess = {
        env: {
            CI_BROWSER_DIAGNOSTICS: f.options.output,
            CI_BROWSER_EVIDENCE: evidence,
            CI_PLAYWRIGHT_MODULE: "/synthetic-playwright",
            ...(crashOptions.enabled
                ? { CI_FIREFOX_CRASH_DIAGNOSTICS: "1" }
                : {}),
        },
        execPath: process.execPath,
    };
    const modules = {
        "../package.json": { dependencies: { "hls.js": "fixture" } },
        "./browser-compatibility-profile.cjs": {
            selectProfile: () => profile,
            verifyCapabilities: () => assert.notEqual(failure, "capabilities"),
        },
        "./browser-media-capabilities.cjs": {
            readBrowserMediaCapabilities: () => {},
        },
        "./browser-terminal-diagnostics.cjs": observeTerminal,
        "./firefox-crash-diagnostics.cjs": {
            childEnvironment(owner, env) {
                assert.ok(
                    owner === undefined ||
                        owner === null ||
                        owner === "synthetic-owner"
                );
                return owner
                    ? { ...env }
                    : require("../scripts/firefox-crash-diagnostics.cjs").childEnvironment(
                          null,
                          env
                      );
            },
            // Caller-outcome tests exercise the actual acceptance runner, not
            // POSIX collector permissions on the host filesystem. Binary and
            // ownership/retention behavior have their own dedicated suite.
            create(engine, env) {
                if (crashOptions.createError)
                    throw new Error("SECRET startup failure /private/path");
                assert.equal(engine, "firefox");
                return env.CI_FIREFOX_CRASH_DIAGNOSTICS === "1"
                    ? "synthetic-owner"
                    : null;
            },
            finish(owner, output, options) {
                if (options.env.CI_FIREFOX_CRASH_DIAGNOSTICS !== "1") return;
                assert.ok(owner === undefined || owner === "synthetic-owner");
                const result = {
                    dumps: [],
                    enabled: true,
                    schema: 1,
                    status: owner
                        ? "unavailable"
                        : "initialization-unavailable",
                };
                fs.writeFileSync(
                    path.join(output, "firefox-crash-summary.json"),
                    JSON.stringify(result),
                    { flag: "wx", mode: 0o600 }
                );
                if (crashOptions.finishError)
                    throw new Error("diagnostic write failed");
                return result;
            },
            launchEnvironment(owner, env) {
                assert.ok(
                    owner === undefined ||
                        owner === null ||
                        owner === "synthetic-owner"
                );
                return owner ? { ...env } : undefined;
            },
        },
        "/synthetic-playwright": {
            firefox: {
                async launch() {
                    if (failure === "probe-launch")
                        throw new Error("probe launch");
                    return {
                        close: async () => {},
                        newPage: async () => ({
                            addScriptTag: async () => {},
                            evaluate: async () => {
                                if (failure === "probe-evaluate")
                                    throw new Error("probe evaluate");
                                return capabilities;
                            },
                        }),
                        version: () => "153.0",
                    };
                },
            },
        },
        "node:assert/strict": assert,
        "node:child_process": {
            spawnSync(executable, args, options) {
                spawned++;
                assert.equal(executable, process.execPath);
                assert.deepEqual(Array.from(args), [
                    "/synthetic-playwright/cli.js",
                    "test",
                    "--config=playwright.compatibility.config.cjs",
                ]);
                assert.equal(options.timeout, 8 * 60 * 1000);
                assert.equal(options.stdio, "inherit");
                assert.equal(options.env.CI, "1");
                if (crashOptions.createError) {
                    assert.equal(
                        options.env.CI_FIREFOX_CRASH_DIAGNOSTICS,
                        undefined
                    );
                    assert.equal(options.env.CI_FIREFOX_CRASH_ROOT, undefined);
                    assert.equal(options.env.CI_FIREFOX_CRASH_TOKEN, undefined);
                    assert.equal(
                        require("../scripts/firefox-crash-diagnostics.cjs").session(
                            options.env,
                            "linux"
                        ),
                        null
                    );
                }
                return child;
            },
        },
        "node:fs": {
            readFileSync(file) {
                if (file.endsWith("runtime.json"))
                    return JSON.stringify(f.options.runtime);
                if (file.endsWith("candidate.json"))
                    return JSON.stringify({
                        sourceSha: failure === "source" ? "b".repeat(40) : sha,
                    });
                if (file.endsWith("playwright.json")) {
                    reportReads++;
                    return failure === "malformed-report"
                        ? "invalid json"
                        : JSON.stringify(report);
                }
                throw new Error("Unexpected file read");
            },
            writeFileSync: fs.writeFileSync,
        },
        "node:path": path,
    };
    await vm.runInNewContext(source, {
        console: { error() {} },
        process: fakeProcess,
        require(name) {
            assert.ok(Object.hasOwn(modules, name), name);
            return modules[name];
        },
    });
    return { ...f, evidence, fakeProcess, reportReads, spawned };
}

test("actual acceptance caller preserves success and original acceptance fields", async (t) => {
    const f = await runCaller(t);
    assert.equal(f.fakeProcess.exitCode, undefined);
    assert.equal(f.read().outcome, "passed");
    assert.equal(f.read().phase, "write-acceptance");
    const evidence = JSON.parse(fs.readFileSync(f.evidence, "utf8"));
    assert.equal(evidence.testsPassed, 1);
    assert.equal(evidence.testsFailed, 0);
    assert.equal(evidence.coverage.media, "passed");
    assert.equal(f.spawned, 1);
});

for (const [failure, phase, spawned] of [
    ["source", "verify-inputs", 0],
    ["probe-launch", "probe-launch", 0],
    ["probe-evaluate", "probe-session", 0],
    ["capabilities", "verify-capabilities", 0],
    ["child-exit", "scenario-process", 1],
    ["child-signal", "scenario-process", 1],
    ["child-timeout", "scenario-process", 1],
    ["malformed-report", "verify-scenarios", 1],
    ["retried", "verify-scenarios", 1],
    ["missing-scenario", "verify-scenarios", 1],
]) {
    test(
        "actual caller retains failure without acceptance: " + failure,
        async (t) => {
            const f = await runCaller(t, failure);
            assert.equal(f.fakeProcess.exitCode, 1);
            assert.equal(fs.existsSync(f.evidence), false);
            assert.equal(f.read().outcome, "failed");
            assert.equal(f.read().phase, phase);
            assert.equal(f.spawned, spawned);
            if (phase === "scenario-process") assert.equal(f.reportReads, 0);
        }
    );
}

for (const finishError of [false, true]) {
    test(
        "opt-in crash collection preserves original child failure, diagnostic error=" +
            finishError,
        async (t) => {
            const f = await runCaller(t, "child-exit", {
                enabled: true,
                finishError,
            });
            assert.equal(f.fakeProcess.exitCode, 1);
            assert.equal(f.read().outcome, "failed");
            assert.equal(f.read().phase, "scenario-process");
            assert.equal(f.read().scenarioProcess.status, 1);
            assert.equal(fs.existsSync(f.evidence), false);
            const diagnostic = JSON.parse(
                fs.readFileSync(
                    path.join(f.options.output, "firefox-crash-summary.json"),
                    "utf8"
                )
            );
            assert.equal(diagnostic.status, "unavailable");
            assert.deepEqual(diagnostic.dumps, []);
        }
    );
}

for (const failure of [undefined, "child-exit"]) {
    test(
        "collector startup failure preserves actual scenarios and original outcome: " +
            (failure || "success"),
        async (t) => {
            const f = await runCaller(t, failure, {
                createError: true,
                enabled: true,
            });
            assert.equal(
                f.spawned,
                1,
                "the original scenario process must still run"
            );
            assert.equal(f.fakeProcess.exitCode, failure ? 1 : undefined);
            assert.equal(f.read().outcome, failure ? "failed" : "passed");
            assert.equal(fs.existsSync(f.evidence), !failure);
            const serialized = fs.readFileSync(
                path.join(f.options.output, "firefox-crash-summary.json"),
                "utf8"
            );
            const report = JSON.parse(serialized);
            assert.equal(report.status, "initialization-unavailable");
            assert.deepEqual(report.dumps, []);
            assert.doesNotMatch(serialized, /SECRET|private|path|failure/);
        }
    );
}
