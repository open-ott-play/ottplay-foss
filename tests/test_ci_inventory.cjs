const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspect } = require("../scripts/check-test-inventory.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-ci-inventory-"));
function write(file, content) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}
try {
    write("tests/test_parent.cjs", 'require("./test_child.cjs");\n');
    write("tests/test_child.cjs", "// executed through the parent\n");
    write("tests/test_native.py", "# platform-specific behavioral harness\n");
    write("tests/test_forgotten.py", "# newly introduced suite\n");
    write(
        "tests/ci-inventory.json",
        JSON.stringify({
            excluded: {},
            requiredVariants: {
                "tests/test_native.py": [
                    ["--platform", "android"],
                    ["--platform", "ios"],
                ],
            },
        })
    );
    write(
        "package.json",
        JSON.stringify({
            scripts: {
                parent: "node tests/test_parent.cjs",
                test: "npm run parent",
                unused: "python3 tests/test_forgotten.py",
            },
        })
    );
    write(
        ".github/workflows/ci.yml",
        "on: pull_request\njobs:\n  test:\n    steps:\n      - run: |\n          npm test\n          # python3 tests/test_forgotten.py\n          python3 tests/test_native.py --check-mirrors-only\n"
    );
    let result = inspect(root);
    assert(!result.errors.some((error) => error.includes("test_child")));
    assert(
        result.errors.some(
            (error) =>
                error.includes("unreachable") &&
                error.includes("test_forgotten")
        )
    );
    assert.equal(
        result.errors.filter((error) => error.includes("Missing CI variant"))
            .length,
        2
    );
    // Merely reading a test or mentioning an invocation in a string is not executing it.
    write(
        "tests/test_parent.cjs",
        'require("node:fs").readFileSync("./test_child.cjs");\nconst example = "require(\\\"./test_child.cjs\\\")";\n'
    );
    assert(
        inspect(root).errors.some(
            (error) =>
                error.includes("unreachable") && error.includes("test_child")
        )
    );
    write("tests/test_parent.cjs", 'require("./test_child.cjs");\n');
    write(
        ".github/workflows/ci.yml",
        "on: pull_request\njobs:\n  test:\n    steps:\n      - run: |\n          npm test\n          python3 tests/test_native.py --platform android\n          python3 tests/test_native.py --platform ios\n          python3 -m unittest discover -s tests -p 'test_forgotten.py' -v\n"
    );
    write(
        ".github/workflows/unused.yml",
        "on: workflow_call\njobs:\n  orphan:\n    steps:\n      - run: node tests/test_orphan.cjs\n"
    );
    write(
        "tests/test_orphan.cjs",
        "// unreachable reusable workflow is not CI coverage\n"
    );
    assert(inspect(root).errors.some((error) => error.includes("test_orphan")));
    fs.unlinkSync(path.join(root, "tests/test_orphan.cjs"));
    result = inspect(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.reached, 4);
    write(
        "tests/browser/device.spec.cjs",
        "// browser boot and keyboard scenarios\n"
    );
    assert(
        inspect(root).errors.some((error) => error.includes("device.spec.cjs"))
    );
    const workflowPath = path.join(root, ".github/workflows/ci.yml");
    const workflow = fs.readFileSync(workflowPath, "utf8");
    write(
        ".github/workflows/ci.yml",
        workflow + "          npx playwright install chromium\n"
    );
    assert(
        inspect(root).errors.some((error) => error.includes("device.spec.cjs"))
    );
    for (const runner of ["playwright", "npx playwright"]) {
        write(
            ".github/workflows/ci.yml",
            workflow +
                `          ${runner} test --list tests/browser/device.spec.cjs\n`
        );
        assert(
            inspect(root).errors.some((error) =>
                error.includes("device.spec.cjs")
            )
        );
        write(
            ".github/workflows/ci.yml",
            workflow +
                `          ${runner} test tests/browser/device.spec.cjs\n`
        );
        assert.deepEqual(inspect(root).errors, []);
    }
    write(
        "tests/python-suites.json",
        JSON.stringify({ portable: [["tests/test_python_suite.py"]] })
    );
    write("tests/test_python_suite.py", "# registered portable test\n");
    write(
        ".github/workflows/ci.yml",
        workflow + "          python3 scripts/test-python.py --help\n"
    );
    assert(
        inspect(root).errors.some((error) =>
            error.includes("test_python_suite.py")
        )
    );
    write(
        ".github/workflows/ci.yml",
        workflow +
            "          python3 scripts/test-python.py --profile portable\n          playwright test tests/browser/device.spec.cjs\n"
    );
    assert.deepEqual(inspect(root).errors, []);
    write("tests/test_new.cjs", "// uncovered test must fail the next PR\n");
    assert(inspect(root).errors.some((error) => error.includes("test_new")));
    write(
        "tests/ci-inventory.json",
        JSON.stringify({
            excluded: {
                "tests/test_new.cjs":
                    "Manual physical-device fixture requires connected TV firmware",
            },
        })
    );
    assert.deepEqual(inspect(root).errors, []);
    write(
        "tests/ci-inventory.json",
        JSON.stringify({ excluded: { "tests/test_new.cjs": "" } })
    );
    assert(
        inspect(root).errors.some((error) => error.includes("concrete reason"))
    );
    // Manual dispatch is an explicit structural path, never automatic execution.
    write("tests/ci-inventory.json", JSON.stringify({ excluded: {} }));
    write("tests/test_new.cjs", 'require("./test_manual_child.cjs");\n');
    write("tests/test_manual_child.cjs", "// reached through manual test\n");
    const manual = ".github/workflows/manual.yml";
    write(
        manual,
        "on: workflow_call\njobs:\n  test:\n    steps:\n      - run: node tests/test_new.cjs\n"
    );
    assert(inspect(root).errors.some((error) => error.includes("test_new")));
    write(
        manual,
        "on: workflow_dispatch\njobs:\n  test:\n    if: false\n    steps:\n      - run: node tests/test_new.cjs\n"
    );
    assert(inspect(root).errors.some((error) => error.includes("test_new")));
    write(
        manual,
        "on: workflow_dispatch\njobs:\n  test:\n    steps:\n      - if: false\n        run: node tests/test_new.cjs\n      - run: |\n          # node tests/test_new.cjs\n"
    );
    assert(inspect(root).errors.some((error) => error.includes("test_new")));
    write(
        manual,
        "on: workflow_dispatch\njobs:\n  test:\n    steps:\n      - run: node tests/test_new.cjs\n"
    );
    result = inspect(root);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.manualOnly, [
        "tests/test_manual_child.cjs",
        "tests/test_new.cjs",
    ]);
    assert.equal(result.reached - result.automaticReached, 2);
    // A manual variant does not satisfy an explicitly required automatic variant.
    write(
        "tests/ci-inventory.json",
        JSON.stringify({ requiredVariants: { "tests/test_new.cjs": [[]] } })
    );
    assert(
        inspect(root).errors.some((error) =>
            error.includes("Missing CI variant: tests/test_new.cjs")
        )
    );
    write(
        ".github/workflows/automatic.yml",
        "on: pull_request\njobs:\n  test:\n    steps:\n      - run: node tests/test_new.cjs\n"
    );
    result = inspect(root);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.manualOnly, []);
    assert.equal(result.reached, result.automaticReached);
    write("tests/test_scope_all.cjs", "// platform-specific harness\n");
    write("tests/test_scope_windows.cjs", "// Windows harness\n");
    write("tests/ci-inventory.json", JSON.stringify({ excluded: {} }));
    write(
        ".github/workflows/scoped.yml",
        `on:
  workflow_call:
    inputs:
      runtime-platform-scope:
        type: string
        default: all
jobs:
  other:
    if: \${{ inputs.runtime-platform-scope != 'windows' && github.event_name != 'never' }}
    steps:
      - run: node tests/test_scope_all.cjs --platform ios
  windows:
    if: \${{ inputs.runtime-platform-scope == 'windows' }}
    steps:
      - run: node tests/test_scope_windows.cjs
`
    );
    write(
        ".github/workflows/scope-forward.yml",
        `on:
  workflow_call:
    inputs:
      runtime-platform-scope:
        type: string
        default: all
jobs:
  nested:
    uses: ./.github/workflows/scoped.yml
    with:
      runtime-platform-scope: \${{ inputs.runtime-platform-scope }}
`
    );
    const scopeCaller = (scope) => `on: pull_request
jobs:
  scoped:
    uses: ./.github/workflows/scope-forward.yml
    with:
      runtime-platform-scope: ${scope}
`;
    write(".github/workflows/scope-auto.yml", scopeCaller("windows"));
    const scopeManual = `on: workflow_dispatch
jobs:
  full:
    uses: ./.github/workflows/scoped.yml
`;
    write(".github/workflows/scope-manual.yml", scopeManual);
    result = inspect(root);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.manualOnly, ["tests/test_scope_all.cjs"]);
    const scopedWorkflow = fs.readFileSync(
        path.join(root, ".github/workflows/scoped.yml"),
        "utf8"
    );
    // An outer OR can make the whole condition true despite a false selector.
    write(
        ".github/workflows/scoped.yml",
        scopedWorkflow.replace(
            "&& github.event_name != 'never' }}",
            "&& github.event_name != 'never' || true }}"
        )
    );
    assert.deepEqual(inspect(root).manualOnly, []);
    // Nested OR inside a conjunction does not bypass the false selector.
    write(
        ".github/workflows/scoped.yml",
        scopedWorkflow.replace(
            "&& github.event_name != 'never' }}",
            "&& !(github.event_name == 'never' || inputs.manual == true) }}"
        )
    );
    assert.deepEqual(inspect(root).manualOnly, ["tests/test_scope_all.cjs"]);
    write(".github/workflows/scoped.yml", scopedWorkflow);

    // Every (workflow, known scope) pair must be visited, regardless of order.
    write(
        ".github/workflows/scope-auto.yml",
        scopeCaller("windows") +
            "  full:\n    uses: ./.github/workflows/scoped.yml\n"
    );
    assert.deepEqual(inspect(root).manualOnly, []);
    // Unknown dynamic values cannot be evaluated as false or replaced by defaults.
    write(
        ".github/workflows/scope-auto.yml",
        scopeCaller("${{ vars.UNKNOWN_SCOPE }}")
    );
    assert.deepEqual(inspect(root).manualOnly, []);
    write(".github/workflows/scope-auto.yml", scopeCaller("windows"));
    write(
        "tests/ci-inventory.json",
        JSON.stringify({
            manualRequiredVariants: {
                "tests/test_scope_all.cjs": [["--platform", "ios"]],
            },
        })
    );
    assert.deepEqual(inspect(root).errors, []);
    write(
        "tests/ci-inventory.json",
        JSON.stringify({
            manualRequiredVariants: {
                "tests/test_scope_all.cjs": [["--platform", "android"]],
            },
        })
    );
    assert(
        inspect(root).errors.some((error) =>
            error.includes("Missing manual CI variant")
        )
    );
    write(
        "tests/ci-inventory.json",
        JSON.stringify({
            manualRequiredVariants: {
                "tests/test_scope_all.cjs": "--platform ios",
            },
        })
    );
    assert(
        inspect(root).errors.some((error) =>
            error.includes("Invalid required manual variants")
        )
    );
    write(
        "tests/ci-inventory.json",
        JSON.stringify({
            manualRequiredVariants: {
                "tests/test_scope_all.cjs": [["--platform", "ios"]],
            },
        })
    );
    // An automatic all-scope invocation cannot substitute for manual provenance.
    write(".github/workflows/scope-auto.yml", scopeCaller("all"));
    write(
        ".github/workflows/scope-manual.yml",
        scopeManual + "    with:\n      runtime-platform-scope: windows\n"
    );
    assert(
        inspect(root).errors.some((error) =>
            error.includes("Missing manual CI variant")
        )
    );
    write(".github/workflows/scope-manual.yml", scopeManual);
    write(".github/workflows/scope-auto.yml", scopeCaller("windows"));
    assert.deepEqual(inspect(root).errors, []);
    const repository = inspect(path.resolve(__dirname, ".."));
    assert.deepEqual(repository.errors, []);
    assert.deepEqual(repository.manualRequiredVariants, {
        "tests/test_native_xmltv_records.py": [
            ["--platform", "android"],
            ["--platform", "ios"],
        ],
        "tests/test_native_epg_cache.py": [
            ["--platform", "android"],
            ["--platform", "ios"],
        ],
        "tests/test_native_media_lifecycle.py": [
            ["--platform", "android"],
            ["--platform", "ios"],
        ],
    });
    assert.deepEqual(repository.manualOnly, [
        "tests/glib-variant-regression/tests/variant_str_iter.rs",
        "tests/test_android_activity.cjs",
        "tests/test_android_app_update_recovery.py",
        "tests/test_android_epg_editions.py",
        "tests/test_android_home_setup.cjs",
        "tests/test_android_local_media_availability.py",
        "tests/test_android_network_policy.py",
        "tests/test_android_queue.py",
        "tests/test_android_screenshot.py",
        "tests/test_android_tv_webview.cjs",
        "tests/test_android_update_tls.py",
        "tests/test_ios_access_auth.py",
        "tests/test_ios_access_media.py",
        "tests/test_ios_command_queue.py",
        "tests/test_ios_demo_media.py",
        "tests/test_ios_proxy.py",
        "tests/test_ios_public_http.py",
        "tests/test_mobile_local_paths.py",
        "tests/test_mobile_metadata_standby.py",
        "tests/test_native_dash_state.py",
        "tests/test_native_favorites_provider_compression.cjs",
        "tests/test_native_media_lifecycle.py",
        "tests/test_native_screenshot_transport_swift.py",
        "tests/test_native_swop_swift.py",
        "tests/test_native_xmltv_records.py",
        "tests/test_normalization_webkit.cjs",
        "tests/test_runtime_diagnostics_native.py",
    ]);
    console.log(
        "PASS CI inventory: npm reachability, AST child tests, comments/source reads, required platforms, discovery and explicit exclusions"
    );
} finally {
    fs.rmSync(root, { force: true, recursive: true });
}
