const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const policy = JSON.parse(
    fs.readFileSync(path.join(root, ".release-policy.json"), "utf8")
);
const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
);
const document = YAML.parseDocument(
    fs.readFileSync(
        path.join(root, ".github/workflows/release-build.yml"),
        "utf8"
    ),
    { uniqueKeys: true }
);
assert.deepEqual(document.errors, [], "release workflow must be valid YAML");
const workflow = document.toJS();
const web = workflow.jobs.build;
const steps = web.steps;
const commandSteps = (part) =>
    steps.filter((step) => (step.run || "").includes(part));
const packaging = commandSteps("npm run package:webos --");
const staging = commandSteps("scripts/stage_release_assets.py");
assert.equal(packaging.length, 1, "webOS package must be built exactly once");
assert.equal(staging.length, 1, "web payloads must have one staging receipt");
const packageStep = packaging[0];
const stageStep = staging[0];
assert.deepEqual(packageStep.run.trim().split("\n"), [
    "npm run package:webos -- --plan .release-plan.json",
    "npm run verify:webos -- --plan .release-plan.json",
    "npm run package:webos-homebrew -- --plan .release-plan.json",
]);
const prepared = commandSteps("scripts/version_plan.py sync")[0];
assert(prepared, "package must use the prepared frozen release identity");
assert(steps.indexOf(prepared) < steps.indexOf(packageStep));
assert(steps.indexOf(packageStep) < steps.indexOf(stageStep));
// Strict source verification runs while all generated files are still in ignored build/.
const legacyDownloads = commandSteps(
    "cp build/packages/ottplay-foss-modea.tar.gz"
)[0];
assert(legacyDownloads);
assert(steps.indexOf(packageStep) < steps.indexOf(legacyDownloads));
assert(steps.indexOf(legacyDownloads) < steps.indexOf(stageStep));
const upload = steps.find((step) => step.id === "browser-artifact");
assert(steps.indexOf(stageStep) < steps.indexOf(upload));
for (const step of [prepared, packageStep, stageStep, upload]) {
    assert.equal(
        step.if,
        undefined,
        "required webOS delivery cannot be skipped"
    );
    assert.equal(step["continue-on-error"], undefined);
}
assert.equal(web.if, undefined);
assert.equal(web["continue-on-error"], undefined);
assert.equal(
    upload.with.name,
    "release-assets-web-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}"
);
assert.equal(upload.with.path, "release-assets/web/*");
assert.equal(upload.with["if-no-files-found"], "error");

const assets = Object.entries(stageStep.env)
    .filter(([key]) => key.startsWith("RELEASE_ASSET_PATTERN_"))
    .map(([key, value]) => {
        assert(
            stageStep.run.includes('--pattern "$' + key + '"'),
            key + " must be passed to the receipt staging command"
        );
        return value;
    });
assert.deepEqual(
    new Set(assets),
    new Set([
        "ottplay-foss-dist.tar.gz",
        "checksums.txt",
        "ottplay-foss-modea.tar.gz",
        "ottplay-foss-modea.sha256",
        "build/packages/ottplay-foss-webos.ipk",
        "build/packages/ottplay-foss-webos.sha256",
        "build/packages/ottplay-foss-webos.json",
        "build/packages/ottplay-foss-webos-manifest.json",
        "build/packages/ottplay-foss-webos-repository.json",
        "build/packages/ottplay-foss-webos-icon.png",
        "build/packages/ottplay-foss-webos-description.html",
    ])
);
assert.equal(assets.length, new Set(assets).size);
assert.equal(stageStep.env.RELEASE_ASSET_TARGET, "web");

const metadata = policy.versioning.artifacts.filter(
    (entry) => entry.path === "ottplay-foss-webos.json"
);
assert.deepEqual(metadata, [
    {
        field: "packageVersion",
        format: "json",
        path: "ottplay-foss-webos.json",
        value: "package",
    },
    {
        field: "buildNumber",
        format: "json",
        path: "ottplay-foss-webos.json",
        value: "build",
    },
]);
assert.equal(policy.versioning.promotion, "promote-bytes");
assert.equal(
    packageJson.scripts["package:webos"],
    "node scripts/package-webos.cjs"
);
assert.equal(
    packageJson.scripts["verify:webos"],
    "node scripts/package-webos.cjs --verify"
);
assert.equal(
    packageJson.scripts["package:webos-homebrew"],
    "node scripts/webos-homebrew.cjs"
);
assert(packageJson.scripts["test:unified"].includes("npm run test:webos"));
for (const suite of [
    "test_package_webos",
    "test_webos_homebrew",
    "test_webos_release",
    "test_webos_feed_worker",
]) {
    assert(
        packageJson.scripts["test:webos"].includes(
            "node tests/" + suite + ".cjs"
        )
    );
}
for (const command of [
    "npm run package:webos -- --local",
    "npm run verify:webos -- --local",
]) {
    assert(policy.local_checks.includes(command));
    assert(
        fs
            .readFileSync(path.join(root, "scripts/ci.sh"), "utf8")
            .includes(command)
    );
}

// Exercise the POSIX adapter independently of compilation and package validation.
// Its dependencies are fixtures; the real packager suite verifies their contents.
if (process.platform !== "win32") {
    for (const mode of ["local", "plan", "verify-failure"]) {
        const fixture = fs.mkdtempSync(
            path.join(os.tmpdir(), "ott-webos-release-")
        );
        try {
            for (const folder of ["scripts", "bin", "build/packages"])
                fs.mkdirSync(path.join(fixture, folder), { recursive: true });
            fs.copyFileSync(
                path.join(root, "scripts/release-build.sh"),
                path.join(fixture, "scripts/release-build.sh")
            );
            const sourceAssets = assets
                .filter((asset) => asset.startsWith("build/packages/"))
                .map((asset) => path.basename(asset));
            sourceAssets.push(
                "ottplay-foss-modea.tar.gz",
                "ottplay-foss-modea.sha256"
            );
            for (const name of sourceAssets)
                fs.writeFileSync(
                    path.join(fixture, "build/packages", name),
                    name + "\n"
                );
            const log = path.join(fixture, "calls.log");
            fs.writeFileSync(
                path.join(fixture, "bin/npm"),
                '#!/usr/bin/env node\nconst fs = require("node:fs");\n' +
                    'const args = process.argv.slice(2).join(" ");\n' +
                    'fs.appendFileSync(process.env.WEBOS_FIXTURE_LOG, args + "\\n");\n' +
                    'if (process.env.WEBOS_FIXTURE_FAIL === "1" && args.startsWith("run verify:webos ")) process.exit(23);\n',
                { mode: 0o755 }
            );
            fs.writeFileSync(
                path.join(fixture, "bin/python3"),
                "#!/bin/sh\nexit 0\n",
                { mode: 0o755 }
            );
            const env = {
                ...process.env,
                PATH: [
                    path.join(fixture, "bin"),
                    path.dirname(process.execPath),
                    process.env.PATH,
                ].join(path.delimiter),
                WEBOS_FIXTURE_FAIL: mode === "verify-failure" ? "1" : "0",
                WEBOS_FIXTURE_LOG: log,
            };
            delete env.RELEASE_VERSION_PLAN;
            if (mode !== "local") {
                env.RELEASE_VERSION_PLAN = path.join(
                    fixture,
                    "frozen plan.json"
                );
                fs.writeFileSync(env.RELEASE_VERSION_PLAN, "{}\n");
            }
            const result = spawnSync(
                "bash",
                ["scripts/release-build.sh", "1.2.3", "beta"],
                {
                    cwd: fixture,
                    encoding: "utf8",
                    env,
                    timeout: 10000,
                }
            );
            assert.equal(result.error, undefined);
            const calls = fs.readFileSync(log, "utf8").trim().split("\n");
            if (mode === "verify-failure") {
                assert.equal(result.status, 23, result.stderr);
                assert(
                    !calls.some((call) =>
                        call.includes("package:webos-homebrew")
                    )
                );
                assert(
                    !fs.existsSync(
                        path.join(
                            fixture,
                            "release-output/ottplay-foss-webos.ipk"
                        )
                    )
                );
            } else {
                assert.equal(result.status, 0, result.stderr);
                const target =
                    mode === "local"
                        ? "release-output/webos-development"
                        : "release-output";
                assert(
                    fs.existsSync(
                        path.join(fixture, target, "ottplay-foss-webos.ipk")
                    )
                );
                const feed = path.join(
                    fixture,
                    target,
                    "ottplay-foss-webos-repository.json"
                );
                assert.equal(fs.existsSync(feed), mode === "plan");
                assert.equal(
                    calls.some((call) =>
                        call.includes("package:webos-homebrew")
                    ),
                    mode === "plan"
                );
                assert.equal(
                    calls.some((call) => call.includes("--local")),
                    mode === "local"
                );
            }
        } finally {
            fs.rmSync(fixture, { force: true, recursive: true });
        }
    }
}

console.log(
    "PASS webOS release: frozen plan, mandatory verification, complete receipt inventory, beta test coverage and unchanged promotion policy"
);
