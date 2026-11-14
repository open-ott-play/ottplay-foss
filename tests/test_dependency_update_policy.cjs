const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const yaml = require("yaml");
const { checkCommittedMedia } = require("../scripts/check-committed-media.cjs");
const root = path.resolve(__dirname, "..");
const policy = JSON.parse(
    fs.readFileSync(path.join(root, "renovate.json"), "utf8")
);
const updaterNames = ["@tauri-apps/plugin-updater", "tauri-plugin-updater"];

// One updater owns application and CI updates, while native migrations retain
// their explicit review boundary.
for (const filename of ["dependabot.yml", "dependabot.yaml"]) {
    assert(
        !fs.existsSync(path.join(root, ".github", filename)),
        "Do not introduce a competing dependency updater"
    );
}
for (const manager of [
    "github-actions",
    "custom.regex",
    "custom.jsonata",
    "npm",
    "cargo",
]) {
    assert(
        policy.enabledManagers.includes(manager),
        `Missing ${manager} manager`
    );
}
assert(
    policy.extends.includes(
        "local>victron-venus/venus-os-ci-toolkit:renovate-fleet"
    )
);
const baselineIndex = policy.packageRules.findIndex(
    (rule) =>
        rule.enabled === false &&
        rule.matchManagers?.includes("cargo") &&
        !rule.matchPackageNames &&
        !rule.matchFileNames
);
assert(
    baselineIndex >= 0,
    "General Cargo upgrades require the reviewed native migration"
);
assert(
    !policy.packageRules.some(
        (rule) =>
            rule.enabled === false &&
            rule.matchManagers?.includes("npm") &&
            !rule.matchPackageNames &&
            !rule.matchFileNames
    ),
    "Ordinary npm updates must remain automated"
);
assert.equal(
    policy.vulnerabilityAlerts?.enabled,
    undefined,
    "Inherit compatibility-aware security alerts without forcing or disabling them"
);
for (const name of updaterNames) {
    assert(
        policy.vulnerabilityAlerts.groupSlug.includes(JSON.stringify(name)),
        `Security updates must retain the paired updater group for ${name}`
    );
}
assert(policy.vulnerabilityAlerts.groupSlug.includes("tauri-updater"));
const groupIndex = policy.packageRules.findIndex(
    (rule) => rule.groupSlug === "tauri-updater"
);
assert(
    groupIndex > baselineIndex,
    "The narrow updater opt-in must follow the default deny rule"
);
const group = policy.packageRules[groupIndex];
assert.deepEqual([...group.matchPackageNames].sort(), [...updaterNames].sort());
assert.deepEqual([...group.matchFileNames].sort(), [
    "package.json",
    "src-tauri/Cargo.toml",
]);
assert.deepEqual([...group.matchManagers].sort(), ["cargo", "npm"]);
assert.equal(group.enabled, true);
assert.equal(
    group.minimumGroupSize,
    2,
    "Never propose a single ecosystem updater upgrade"
);
assert.equal(group.groupSingleUpdates, false);
assert.equal(group.separateMajorMinor, false);
assert.equal(group.separateMinorPatch, false);
assert.equal(
    group.rangeStrategy,
    "pin",
    "Both manifests must describe the resolved bindings"
);
assert.equal(
    group.allowedVersions,
    ">=2.12.0 <2.13.0",
    "Remove the hold only with the native WebView migration"
);
assert.equal(group.automerge, false);

const npmRules = policy.packageRules.filter((rule) =>
    rule.matchManagers?.includes("npm")
);
for (const [name, versions] of [
    ["@tauri-apps/api", "<2.12.0"],
    ["ultracite", "<7.10.3 || >8.0.1"],
    ["typescript", "<6"],
    ["video.js", "<8"],
    ["@videojs/http-streaming", "<3"],
]) {
    assert.equal(
        npmRules.find((rule) => rule.matchPackageNames?.includes(name))
            ?.allowedVersions,
        versions,
        `Retain the reviewed compatibility boundary for ${name}`
    );
}
assert(
    npmRules.some(
        (rule) =>
            rule.groupSlug === "npm-lockfile" &&
            rule.matchPackageNames?.includes("*")
    ),
    "Other npm updates retain their lockfile group"
);

// Google's published AAR manifests set AppCompat 1.8's minimum to API 23.
// Keep the API 22 flavor isolated; modern Android dependencies remain free to update.
const compatPath = "android/compat/variables.gradle";
const compatVariables = fs.readFileSync(path.join(root, compatPath), "utf8");
assert.match(compatVariables, /^\s*minSdkVersion\s*=\s*22\s*$/m);
const compatVersions = [
    ...compatVariables.matchAll(
        /^\s*androidxAppCompatVersion\s*=\s*['"]([^'"]+)['"]\s*$/gm
    ),
];
assert.equal(
    compatVersions.length,
    1,
    "Require one explicit API 22 AppCompat version"
);
assert.equal(compatVersions[0][1], "1.7.1", "AppCompat 1.8 requires API 23");
const compatRules = policy.packageRules.filter((rule) =>
    rule.matchPackageNames?.includes("androidx.appcompat:appcompat")
);
assert.equal(
    compatRules.length,
    1,
    "Require one explicit API 22 update boundary"
);
const compatRule = compatRules[0];
assert.deepEqual(compatRule.matchManagers, ["gradle"]);
assert.deepEqual(
    compatRule.matchFileNames,
    [compatPath],
    "Do not freeze modern Android"
);
assert.deepEqual(compatRule.matchPackageNames, [
    "androidx.appcompat:appcompat",
    "androidx.appcompat:appcompat-resources",
]);
assert.equal(compatRule.allowedVersions, "/^1\\.7\\.1$/");
const allowedCompatVersion = new RegExp(
    compatRule.allowedVersions.slice(1, -1)
);
assert(allowedCompatVersion.test(compatVersions[0][1]));
for (const version of ["1.8.0-alpha01", "1.8.0", "1.9.0", "2.0.0", "1.7.10"]) {
    assert(
        !allowedCompatVersion.test(version),
        `Unreviewed API 22 dependency: ${version}`
    );
}
console.log(
    "Dependency updater ownership and cross-ecosystem grouping contracts passed"
);

const releasePolicy = JSON.parse(
    fs.readFileSync(path.join(root, ".release-policy.json"))
);
assert(releasePolicy.validation_workflows.includes("windows-validation.yml"));
for (const workflowFile of ["ci.yml", "windows-validation.yml"]) {
    const workflow = yaml.parse(
        fs.readFileSync(
            path.join(root, ".github/workflows", workflowFile),
            "utf8"
        )
    );
    const frontend = workflow.jobs["frontend-tests"];
    assert.equal(
        frontend.if,
        undefined,
        "The early audit is not path-filtered"
    );
    assert.equal(frontend["continue-on-error"], undefined);
    const auditIndex = frontend.steps.findIndex(
        (step) => step.run === "node scripts/check-committed-media.cjs"
    );
    assert(auditIndex >= 0, "Required frontend job must audit committed media");
    assert.equal(frontend.steps[auditIndex].if, undefined);
    assert.equal(frontend.steps[auditIndex]["continue-on-error"], undefined);
    assert.deepEqual(
        frontend.steps.slice(0, auditIndex).flatMap((step) => step.run || []),
        ["npm ci --ignore-scripts"],
        "Audit before any test/build can repair the source tree"
    );
    assert(
        frontend.steps.findIndex((step) => step.run === "npm test") > auditIndex
    );
}

function runMediaAudit(audit) {
    const errors = [];
    const logs = [];
    const status = checkCommittedMedia(audit, {
        error: (value) => errors.push(value),
        log: (value) => logs.push(value),
    });
    return { errors, logs, status };
}
assert.equal(runMediaAudit(() => {}).status, 0);
const originalError = new Error("fixture audit failure");
const rejected = runMediaAudit(() => {
    throw originalError;
});
assert.equal(rejected.status, 1);
assert.equal(rejected.errors[0], originalError, "Preserve the original cause");
assert.deepEqual(rejected.logs, []);
for (const command of [
    "npm ci --ignore-scripts",
    "npm run build:media",
    "npm run check:media",
]) {
    assert(rejected.errors[1].includes(command));
}

// Execute the real auditor against committed bytes with clean-install metadata.
// Only the lockfile and its installed package versions are replaced in memory;
// no real dependency install, media compiler or source mutation is needed.
const auditorSource = fs.readFileSync(
    path.join(root, "scripts/media-runtime.cjs"),
    "utf8"
);
const locked = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"))
);
const committed = fs.readFileSync(path.join(root, "js/media-runtime.json"));
for (const kind of ["bundler update", "unrelated lockfile update"]) {
    const changed = structuredClone(locked);
    if (kind === "bundler update") {
        changed.packages["node_modules/rollup"].version += "-fixture";
    } else {
        changed.packages["node_modules/non-media-fixture"] = {
            version: "1.0.0",
        };
    }
    const before = JSON.stringify(changed);
    const readonlyFs = {
        readFileSync(filename, encoding) {
            const relative = path
                .relative(root, filename)
                .split(path.sep)
                .join("/");
            if (relative === "package-lock.json") return Buffer.from(before);
            if (relative === "js/media-runtime.json") return committed;
            if (
                relative.startsWith("node_modules/") &&
                relative.endsWith("/package.json")
            ) {
                const key = relative.slice(0, -"/package.json".length);
                return Buffer.from(
                    JSON.stringify({ version: changed.packages[key].version })
                );
            }
            return fs.readFileSync(filename, encoding);
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(
        auditorSource,
        {
            __dirname: path.join(root, "scripts"),
            module,
            require(name) {
                if (name === "node:fs") return readonlyFs;
                assert(
                    [
                        "node:assert/strict",
                        "node:crypto",
                        "node:path",
                        "acorn",
                    ].includes(name),
                    "The nonfixing audit must not load a compiler or cache repair"
                );
                return require(name);
            },
        },
        { timeout: 1000 }
    );
    const result = runMediaAudit(() => module.exports.auditMediaRuntime());
    assert.equal(result.status, 1, kind);
    assert.match(result.errors[0].message, /Stale media URL version/, kind);
    assert.deepEqual(result.logs, []);
    assert.equal(JSON.stringify(changed), before);
    assert.equal(
        createHash("sha256")
            .update(fs.readFileSync(path.join(root, "js/media-runtime.json")))
            .digest("hex"),
        createHash("sha256").update(committed).digest("hex"),
        "A failed audit must leave the committed manifest unchanged"
    );
}
console.log(
    "Early committed-media audit rejects lock drift without regeneration"
);
