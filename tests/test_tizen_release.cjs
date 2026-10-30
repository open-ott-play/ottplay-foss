const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const policy = JSON.parse(read(".release-policy.json"));
const scripts = JSON.parse(read("package.json")).scripts;
const names = [
    "ottplay-foss-tizen-unsigned.wgt",
    "ottplay-foss-tizen.sha256",
    "ottplay-foss-tizen.json",
    "ottplay-foss-tizen-install.py",
];

function workflow(name) {
    const document = YAML.parseDocument(read(".github/workflows/" + name), {
        uniqueKeys: true,
    });
    assert.deepEqual(document.errors, [], name + " must be valid YAML");
    return document.toJS();
}

const release = workflow("release-build.yml");
const job = release.jobs.build;
const steps = job.steps;
function singleStep(command) {
    const matches = steps.filter((step) => (step.run || "").includes(command));
    assert.equal(matches.length, 1, command + " must run exactly once");
    return matches[0];
}

const prepare = singleStep("scripts/version_plan.py sync");
const modea = singleStep("npm run package:modea");
const packageStep = singleStep("npm run package:tizen --");
const stage = singleStep("scripts/stage_release_assets.py");
const archiveCopies = singleStep("cp build/packages/ottplay-foss-modea.tar.gz");
const upload = steps.find((step) => step.id === "browser-artifact");
assert.deepEqual(packageStep.run.trim().split("\n"), [
    "npm run package:tizen -- --plan .release-plan.json",
    "npm run verify:tizen -- --plan .release-plan.json",
]);
assert(steps.indexOf(prepare) < steps.indexOf(modea));
assert(steps.indexOf(modea) < steps.indexOf(packageStep));
// Source-bound verification must finish before root-level generated archives appear.
assert(steps.indexOf(packageStep) < steps.indexOf(archiveCopies));
assert(steps.indexOf(archiveCopies) < steps.indexOf(stage));
assert(steps.indexOf(stage) < steps.indexOf(upload));
for (const required of [job, prepare, modea, packageStep, stage, upload]) {
    assert.equal(required.if, undefined, "Tizen delivery must not be optional");
    assert.equal(required["continue-on-error"], undefined);
}
assert.equal(
    release.on.workflow_call.inputs.release_plan_artifact.required,
    true
);
assert(
    steps.some(
        (step) => step.with?.name === "${{ inputs.release_plan_artifact }}"
    ),
    "Packaging must consume the centrally frozen plan artifact"
);
assert.equal(stage.env.RELEASE_ASSET_TARGET, "web");
assert.equal(upload.with.path, "release-assets/web/*");
assert.equal(upload.with["if-no-files-found"], "error");
assert.equal(
    upload.with.name,
    "release-assets-web-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}"
);
const staged = Object.entries(stage.env).filter(([key]) =>
    key.startsWith("RELEASE_ASSET_PATTERN_")
);
for (const name of names) {
    const matches = staged.filter(
        ([, value]) => value === "build/packages/" + name
    );
    assert.equal(matches.length, 1, name + " needs one exact receipt input");
    assert(stage.run.includes('--pattern "$' + matches[0][0] + '"'));
}
assert.deepEqual(
    staged
        .filter(([, value]) => value.includes("tizen"))
        .map(([, value]) => value)
        .sort(),
    names.map((name) => "build/packages/" + name).sort(),
    "Do not publish signed personal packages or certificate files"
);
// This job only creates unsigned packages; signing remains an operator action.
assert(!JSON.stringify(job).includes("secrets."));
assert(
    !Object.keys(release.on.workflow_call.secrets).some((name) =>
        /tizen|samsung|distributor|author_certificate/i.test(name)
    )
);
assert(
    !policy.build_secrets.some((name) =>
        /tizen|samsung|distributor|author_certificate/i.test(name)
    )
);

const artifactRules = policy.versioning.artifacts.filter((entry) =>
    names.includes(entry.path)
);
assert.deepEqual(artifactRules, [
    {
        field: "packageVersion",
        format: "json",
        path: names[2],
        value: "package",
    },
    { field: "buildNumber", format: "json", path: names[2], value: "build" },
    {
        field: "packageVersion",
        format: "zip-json",
        member: "tizen-build-info.json",
        path: names[0],
        value: "package",
    },
    {
        field: "buildNumber",
        format: "zip-json",
        member: "tizen-build-info.json",
        path: names[0],
        value: "build",
    },
]);
assert.equal(policy.versioning.promotion, "promote-bytes");
const pipeline = workflow("release-pipeline.yml");
assert.equal(
    pipeline.jobs.build.if,
    "${{ needs.prepare.outputs.build == 'true' }}"
);
assert.equal(
    pipeline.jobs.stable.if,
    "${{ needs.prepare.outputs.channel == 'stable' && needs.prepare.outputs.build == 'false' }}"
);
assert(
    pipeline.jobs.stable.steps.some((step) =>
        (step.run || "").includes("scripts/release_control.py promote")
    )
);
assert.equal(scripts["package:tizen"], "node scripts/package-tizen.cjs");
assert.equal(
    scripts["verify:tizen"],
    "node scripts/package-tizen.cjs --verify"
);
assert(scripts["test:unified"].includes("npm run test:tizen"));
for (const command of [
    "node tests/test_package_tizen.cjs",
    "python3 tests/test_tizen_install.py",
    "node tests/test_tizen_package_runtime.cjs",
    "node tests/test_tizen_release.cjs",
])
    assert(scripts["test:tizen"].includes(command));
assert(
    workflow("beta-checks.yml").jobs["fast-checks"].steps.some(
        (step) => step.run === "npm run test:unified"
    )
);
for (const command of [
    "npm run package:tizen -- --local",
    "npm run verify:tizen -- --local",
]) {
    assert(policy.local_checks.includes(command));
    assert(read("scripts/ci.sh").includes(command));
}

// Run the real metadata and receipt validators against tiny WGTs, not SDK builds.
// Toolchain discovery is mocked so this fixture never launches Go or platform SDKs.
const receiptFixture = String.raw`
import hashlib, json, os, pathlib, sys, tempfile, zipfile
from unittest import mock
sys.path.insert(0, str(pathlib.Path(sys.argv[1]) / 'scripts'))
import stage_release_assets as stage
import version_plan as vp
import version_receipt as vr

config = json.loads(sys.stdin.read())
rules = config['rules']
names = config['names']
policy = {'versioning': {'schema': 1, 'promotion': 'promote-bytes',
    'files': [{'path': 'package.json', 'format': 'json', 'value': 'package', 'field': 'version'}],
    'artifacts': rules}}

def rejected(call, fragment):
    try:
        call()
    except ValueError as error:
        assert fragment in str(error), str(error)
    else:
        raise AssertionError('Invalid Tizen release was accepted: ' + fragment)

with tempfile.TemporaryDirectory(prefix='ott-tizen-receipt-') as temporary:
    root = pathlib.Path(temporary)
    for channel, sequence, number in [('beta', 7, 10532), ('rc', 1, 10533)]:
        project = root / channel
        project.mkdir()
        (project / 'package.json').write_text('{"version":"1.2.3"}\n')
        plan = vp.create_plan('1.2.3', channel, sequence, 'a' * 40, policy, number)
        vp.validate_plan(plan, policy, 'a' * 40)
        rejected(lambda: vp.validate_plan(plan, policy, 'b' * 40), 'source SHA mismatch')
        evidence = vp.sync_versions(project, policy, plan)
        plan_path = project / '.release-plan.json'
        plan_path.write_text(json.dumps(plan))
        inputs_path = project / '.release-inputs.json'
        inputs_path.write_text(json.dumps({'schema': 1, 'source_sha': plan['source_sha'],
            'plan_sha256': vp.plan_digest(plan), 'files': evidence,
            'effective_inputs_sha256': vp.effective_inputs_digest(evidence)}))
        assets = project / 'web'
        assets.mkdir()
        metadata = {'packageVersion': vp.projections(plan)['package'], 'buildNumber': number}
        (assets / names[2]).write_text(json.dumps(metadata))
        def write_wgt(value):
            with zipfile.ZipFile(assets / names[0], 'w') as archive:
                archive.writestr('tizen-build-info.json', json.dumps(value))
        write_wgt(metadata)
        wgt_hash = hashlib.sha256((assets / names[0]).read_bytes()).hexdigest()
        (assets / names[1]).write_text(wgt_hash + '  ' + names[0] + '\n')
        (assets / names[3]).write_text('# standalone unsigned-package installer fixture\n')
        files = {name: assets / name for name in names}
        inspected = stage.inspect_staged_artifacts(assets, files, policy, plan)
        assert len(inspected) == 4
        assert {item['path'] for item in inspected} == {names[0], names[2]}
        assert all(item['plan_sha256'] == vp.plan_digest(plan) for item in inspected)
        assert len(vr.verify_declared_artifacts(assets, policy, plan)) == 4
        receipt_path = assets / 'release-inputs-web.json'
        producer = vr.producer_identity('open-ott-play/ottplay-foss', 123, 2, plan['source_sha'])
        with mock.patch.object(vr, 'capture_toolchain', return_value={'python': sys.version.split()[0]}), \
             mock.patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'GITHUB_RUN_ID': '123',
                'GITHUB_RUN_ATTEMPT': '2', 'GITHUB_REPOSITORY': 'open-ott-play/ottplay-foss'}):
            receipt = vr.create_receipt(plan_path, inputs_path, assets, receipt_path)
        assert {entry['name'] for entry in receipt['artifacts']} == set(names)
        vr.verify_receipt_evidence(receipt, plan, receipt_path.name, policy, producer)
        def inventory():
            return [{'name': item.name, 'size': item.stat().st_size,
                'sha256': hashlib.sha256(item.read_bytes()).hexdigest()}
                for item in assets.iterdir()]
        vr.verify_receipts(assets, plan, inventory(), policy, producer)
        wrong_producer = {**producer, 'run_attempt': 3}
        rejected(lambda: vr.verify_receipts(assets, plan, inventory(), policy, wrong_producer),
            'different package producer attempt')
        (assets / names[3]).write_text('# changed after receipt\n')
        rejected(lambda: vr.verify_receipts(assets, plan, inventory(), policy, producer),
            'does not match staged payload')
        (assets / names[3]).write_text('# standalone unsigned-package installer fixture\n')
        write_wgt({**metadata, 'buildNumber': number - 1})
        rejected(lambda: vr.verify_declared_artifacts(assets, policy, plan), 'mismatch')
        write_wgt(metadata)
        (assets / names[2]).write_text(json.dumps({**metadata, 'packageVersion': '0.0.0'}))
        rejected(lambda: vr.verify_declared_artifacts(assets, policy, plan), 'mismatch')
        (assets / names[2]).unlink()
        rejected(lambda: vr.verify_declared_artifacts(assets, policy, plan), 'target is missing')
        (assets / names[2]).write_text(json.dumps(metadata))
        (project / 'package.json').write_text('{"version":"9.9.9"}\n')
        rejected(lambda: vr.verify_current_inputs(project, evidence), 'changed after version sync')
        if channel == 'rc':
            before = {name: (assets / name).read_bytes() for name in names}
            stable = vp.create_plan('1.2.3', 'stable', None, plan['source_sha'], policy, number)
            assert vp.projections(plan)['package'] == vp.projections(stable)['package'] == '1.2.3'
            assert len(vr.verify_declared_artifacts(assets, policy, stable)) == 4
            assert before == {name: (assets / name).read_bytes() for name in names}
            # Promotion preserves the original RC receipt instead of inventing a new build.
            rejected(lambda: vr.verify_receipt_evidence(receipt, stable, receipt_path.name, policy),
                'different release plan')
print('PASS Tizen release metadata: embedded and sidecar versions, source/attempt receipts, tamper rejection, RC byte promotion')
`;
const python = spawnSync("python3", ["-I", "-B", "-c", receiptFixture, root], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ names, rules: artifactRules }),
    timeout: 30000,
});
assert.equal(python.error, undefined);
assert.equal(python.status, 0, python.stdout + python.stderr);
process.stdout.write(python.stdout);

// Exercise the actual shell adapter with harmless build commands and no SDKs.
if (process.platform !== "win32") {
    for (const mode of [
        "local",
        "default-plan",
        "explicit-plan",
        "package-failure",
        "verify-failure",
    ]) {
        const fixture = fs.mkdtempSync(
            path.join(os.tmpdir(), "ott-tizen-release-")
        );
        try {
            for (const folder of [
                "scripts",
                "bin",
                "build/packages",
                "release-output/tizen-development",
            ])
                fs.mkdirSync(path.join(fixture, folder), { recursive: true });
            fs.copyFileSync(
                path.join(root, "scripts/release-build.sh"),
                path.join(fixture, "scripts/release-build.sh")
            );
            for (const [, source] of staged) {
                if (
                    !source.startsWith("build/packages/") ||
                    names.includes(path.basename(source))
                )
                    continue;
                fs.writeFileSync(
                    path.join(fixture, source),
                    "other platform fixture\n"
                );
            }
            for (const name of [
                "ottplay-foss-modea.tar.gz",
                "ottplay-foss-modea.sha256",
            ])
                fs.writeFileSync(
                    path.join(fixture, "build/packages", name),
                    "other platform fixture\n"
                );
            for (const name of names) {
                fs.writeFileSync(
                    path.join(fixture, "release-output", name),
                    "previous release\n"
                );
                fs.writeFileSync(
                    path.join(
                        fixture,
                        "release-output/tizen-development",
                        name
                    ),
                    "previous development\n"
                );
            }
            const log = path.join(fixture, "calls.jsonl");
            fs.writeFileSync(
                path.join(fixture, "bin/npm"),
                '#!/usr/bin/env node\nconst fs = require("node:fs");\n' +
                    "const args = process.argv.slice(2);\n" +
                    'fs.appendFileSync(process.env.TIZEN_FIXTURE_LOG, JSON.stringify(args) + "\\n");\n' +
                    "if (args[1] === process.env.TIZEN_FIXTURE_FAIL) process.exit(23);\n" +
                    'if (args[1] === "package:tizen") for (const name of JSON.parse(process.env.TIZEN_FIXTURE_NAMES)) fs.writeFileSync("build/packages/" + name, "new unsigned fixture\\n");\n',
                { mode: 0o755 }
            );
            fs.writeFileSync(
                path.join(fixture, "bin/python3"),
                "#!/bin/sh\nexit 0\n",
                { mode: 0o755 }
            );
            for (const forbidden of ["tizen", "sdb", "go"])
                fs.writeFileSync(
                    path.join(fixture, "bin", forbidden),
                    "#!/bin/sh\nexit 91\n",
                    { mode: 0o755 }
                );
            const env = {
                ...process.env,
                PATH: [
                    path.join(fixture, "bin"),
                    path.dirname(process.execPath),
                    process.env.PATH,
                ].join(path.delimiter),
                TIZEN_FIXTURE_FAIL:
                    mode === "package-failure"
                        ? "package:tizen"
                        : mode === "verify-failure"
                          ? "verify:tizen"
                          : "",
                TIZEN_FIXTURE_LOG: log,
                TIZEN_FIXTURE_NAMES: JSON.stringify(names),
            };
            delete env.RELEASE_VERSION_PLAN;
            for (const name of Object.keys(env))
                if (
                    /^(TIZEN|SAMSUNG|AUTHOR|DISTRIBUTOR)_/.test(name) &&
                    !name.startsWith("TIZEN_FIXTURE_")
                )
                    delete env[name];
            let plan;
            if (mode !== "local") {
                plan =
                    mode === "explicit-plan"
                        ? path.join(fixture, "frozen plan.json")
                        : ".release-plan.json";
                fs.writeFileSync(path.resolve(fixture, plan), "{}\n");
                if (mode === "explicit-plan") env.RELEASE_VERSION_PLAN = plan;
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
            const calls = fs
                .readFileSync(log, "utf8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            const tizenCalls = calls.filter((call) =>
                ["package:tizen", "verify:tizen"].includes(call[1])
            );
            const expected = plan ? ["--plan", plan] : ["--local"];
            assert.deepEqual(tizenCalls[0], [
                "run",
                "package:tizen",
                "--",
                ...expected,
            ]);
            if (mode !== "package-failure")
                assert.deepEqual(tizenCalls[1], [
                    "run",
                    "verify:tizen",
                    "--",
                    ...expected,
                ]);
            assert.equal(tizenCalls.length, mode === "package-failure" ? 1 : 2);
            assert.equal(
                result.status,
                mode.endsWith("failure") ? 23 : 0,
                result.stderr
            );
            for (const name of names) {
                assert.equal(
                    fs.readFileSync(
                        path.join(fixture, "release-output", name),
                        "utf8"
                    ),
                    mode === "local" || mode.endsWith("failure")
                        ? "previous release\n"
                        : "new unsigned fixture\n"
                );
                assert.equal(
                    fs.readFileSync(
                        path.join(
                            fixture,
                            "release-output/tizen-development",
                            name
                        ),
                        "utf8"
                    ),
                    mode === "local"
                        ? "new unsigned fixture\n"
                        : "previous development\n"
                );
            }
        } finally {
            fs.rmSync(fixture, { force: true, recursive: true });
        }
    }
}

console.log(
    "PASS Tizen release wiring: mandatory source-bound packaging, complete artifact inventory, unsigned delivery and local/release isolation"
);
