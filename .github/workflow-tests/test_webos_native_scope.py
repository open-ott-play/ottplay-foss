"""The optional native build must never fall outside the required CI gate."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("webos_scope", ROOT / "scripts/webos-native-scope.py")
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)
BASE, HEAD = "a" * 40, "b" * 40


class NativeScopeTests(unittest.TestCase):
    def test_native_inputs_require_build(self):
        for path in (*SCOPE.PATHS, "native/webos/build.py", "native/webos/patches/fix.patch",
                     "scripts/webos-runtime-sources.json", "scripts/webos-runtime-sources.py",
                     "scripts/verify-webos-native-release.py", "tests/test_webos_native_release.py"):
            with self.subTest(path=path):
                self.assertTrue(SCOPE.requires_build("pull_request", BASE, HEAD, lambda *_, path=path: [path]))

    def test_unrelated_pr_keeps_only_fast_contracts(self):
        self.assertFalse(SCOPE.requires_build("pull_request", BASE, HEAD,
                         lambda *_: ["README.md", "src/plugins/plex.ts", ""]))

    def test_all_companion_source_roots_require_build(self):
        manifest = json.loads((ROOT / "native/webos/companion/manifest.json").read_text())
        for path in manifest["source_roots"]:
            candidate = path + "/example.rs" if (ROOT / path).is_dir() else path
            with self.subTest(path=candidate):
                self.assertTrue(SCOPE.requires_build("pull_request", BASE, HEAD,
                                                    lambda *_, candidate=candidate: [candidate]))

    def test_non_pr_builds_without_git_metadata(self):
        for event in ("workflow_dispatch", "push", "merge_group"):
            with self.subTest(event=event):
                self.assertTrue(SCOPE.requires_build(event, "", "", lambda *_: self.fail("unexpected diff")))

    def test_bad_pr_metadata_cannot_skip_build(self):
        for base, head in (("", HEAD), (BASE, "--help"), (BASE, "main")):
            with self.subTest(base=base, head=head), self.assertRaises(ValueError):
                SCOPE.requires_build("pull_request", base, head, lambda *_: [])

    def test_diff_error_cannot_skip_build(self):
        def fail(*_):
            raise RuntimeError("missing commit")
        with self.assertRaises(RuntimeError):
            SCOPE.requires_build("pull_request", BASE, HEAD, fail)

    def test_moving_source_out_of_native_still_requires_build(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=directory).decode().strip()
            git("init", "--quiet")
            git("config", "user.name", "Workflow Fixture")
            git("config", "user.email", "fixture@example.invalid")
            original = Path(directory) / "native/webos/example"
            original.parent.mkdir(parents=True)
            original.write_text("native build input\n")
            git("add", ".")
            git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "base")
            base = git("rev-parse", "HEAD")
            original.rename(Path(directory) / "README.md")
            git("add", "-A")
            git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "move")
            head = git("rev-parse", "HEAD")
            self.assertTrue(SCOPE.requires_build("pull_request", base, head,
                            lambda a, b: SCOPE.changed_paths(a, b, cwd=directory)))

    def test_reusable_workflow_is_nested_in_required_ci(self):
        def load(name):
            return yaml.load((ROOT / ".github/workflows" / name).read_text(), Loader=yaml.BaseLoader)
        ci, native = load("ci.yml"), load("webos-native.yml")
        self.assertEqual(ci["jobs"]["native-webos"]["uses"], "./.github/workflows/webos-native.yml")
        self.assertEqual(set(native["on"]), {"workflow_call", "workflow_dispatch"})
        contracts = native["jobs"]["contracts"]
        self.assertEqual(contracts["timeout-minutes"], "5")
        self.assertEqual(contracts["outputs"]["build"], "${{ steps.scope.outputs.build }}")
        self.assertEqual(contracts["steps"][0]["with"]["fetch-depth"], "0")
        self.assertEqual(native["jobs"]["native-candidate"]["needs"], "contracts")
        self.assertEqual(native["jobs"]["native-candidate"]["if"],
                         "${{ needs.contracts.outputs.build == 'true' }}")

    def test_native_jobs_do_not_persist_checkout_credentials(self):
        workflow = yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                             Loader=yaml.BaseLoader)
        for name, job in workflow["jobs"].items():
            checkouts = [step for step in job["steps"]
                         if step.get("uses", "").startswith("actions/checkout@")]
            self.assertTrue(checkouts, name)
            for step in checkouts:
                with self.subTest(job=name):
                    self.assertEqual(step.get("with", {}).get("persist-credentials"), "false")

    def test_complete_bundle_is_verified_before_upload(self):
        workflow = yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                             Loader=yaml.BaseLoader)
        contracts = workflow["jobs"]["contracts"]["steps"]
        self.assertTrue(any("test_webos_native_release.py" in step.get("run", "")
                            for step in contracts))
        steps = workflow["jobs"]["native-candidate"]["steps"]
        collector = next(i for i, step in enumerate(steps)
                         if "scripts/webos-runtime-sources.py" in step.get("run", ""))
        verifier = next(i for i, step in enumerate(steps)
                        if "scripts/verify-webos-native-release.py" in step.get("run", ""))
        upload = next(i for i, step in enumerate(steps)
                      if step.get("uses", "").startswith("actions/upload-artifact@")
                      and step.get("with", {}).get("name") == "ottplay-native-webos-candidate")
        self.assertLess(collector, verifier)
        self.assertLess(verifier, upload)
        self.assertNotIn("continue-on-error", steps[verifier])
        self.assertNotIn("if", steps[verifier])
        self.assertNotIn("if", steps[upload])
        self.assertNotIn("continue-on-error", steps[upload])
        self.assertEqual(steps[upload]["with"]["if-no-files-found"], "error")
        self.assertIn('--metadata "build/native-webos/dist/ottplay-native-webos-${native_version}.json"',
                      steps[verifier]["run"])
        self.assertIn("--check-checkout", steps[verifier]["run"])
        self.assertEqual(steps[verifier]["id"], "bundle")
        self.assertIn('"$GITHUB_OUTPUT"', steps[verifier]["run"])
        stem = "build/native-webos/dist/ottplay-native-webos-${{ steps.bundle.outputs.version }}"
        expected = {stem + suffix for suffix in (
            ".ipk", ".json", ".sha256", "-source.tar.gz", "-source.tar.gz.release.json",
            "-runtime-source.tar.gz", "-source-set.json",
            "-cargo-artifacts.jsonl", "-build-config.txt",
        )}
        expected.add("build/native-webos/dist/ottplay-native-webos-icon.png")
        self.assertEqual(set(steps[upload]["with"]["path"].splitlines()), expected)

    def test_host_qualification_precedes_arm_and_preserves_failure_evidence(self):
        workflow = yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                             Loader=yaml.BaseLoader)
        job = workflow["jobs"]["native-candidate"]
        self.assertEqual(job["runs-on"], "ubuntu-24.04-arm")
        self.assertEqual(job["timeout-minutes"], "90")
        self.assertNotIn("continue-on-error", job)
        self.assertEqual(job["env"]["JOBS"], "2")
        self.assertEqual(job["env"]["CARGO_BUILD_JOBS"], "2")
        self.assertFalse(any(key.startswith("CARGO_PROFILE_") for key in job["env"]))
        steps = job["steps"]
        commands = [step.get("run", "") for step in steps]
        markers = (
            "native/webos/build.py bootstrap", "rustup component add",
            "make check 2>&1",
            "make sim-linux", "python3 tests/replay_fixtures.py",
            "source-recheck.log", "native/webos/companion/prepare.py",
            '"native/webos/companion/build.py", "build"', "native/webos/build.py all",
        )
        indexes = [next(i for i, command in enumerate(commands) if marker in command)
                   for marker in markers]
        self.assertEqual(indexes, sorted(set(indexes)))
        for index in indexes:
            self.assertNotIn("if", steps[index])
            self.assertNotIn("continue-on-error", steps[index])
        for index in indexes[1:5]:
            step = steps[index]
            self.assertEqual(step["working-directory"], "build/native-webos/source")
            self.assertEqual(step["shell"], "bash")
            self.assertIn("set -euo pipefail", step["run"])
            self.assertIn("tee", step["run"])
            self.assertGreater(int(step["timeout-minutes"]), 0)
            for key, value in {"CARGO_INCREMENTAL": "0", "PLX_CARGO_SEED": "off",
                               "HOST_THREADS": "0", "RELEASE": "", "PLX_TEST_JOBS": "2"}.items():
                self.assertEqual(step["env"][key], value)
            self.assertFalse(any(key.startswith("CARGO_PROFILE_") for key in step["env"]))
        self.assertIn("rust-modules/rust-toolchain.toml", commands[indexes[1]])
        self.assertIn('clippy rustfmt', commands[indexes[1]])
        self.assertIn("make check-nodef", commands[indexes[2]])
        package_commands = commands[indexes[2]]
        selftest = "python3 ci/check-package.py --selftest"
        product_tests = "python3 ci/test_package_product_config.py"
        self.assertLess(package_commands.index(selftest), package_commands.index(product_tests))
        self.assertLess(package_commands.index(product_tests), package_commands.index("make check 2>&1"))
        self.assertIn("package-selftest.log", package_commands)
        self.assertIn("product-config-tests.log", package_commands)
        self.assertIn('make check 2>&1 | tee "$RUNNER_TEMP/native-host-verification/check.log"',
                      package_commands.splitlines())
        self.assertLess(package_commands.index("make check 2>&1"),
                        package_commands.index("make check-nodef"))
        self.assertEqual(sum(command.count("make check 2>&1") for command in commands), 1)
        for partial in ("make check-cargo-lint", "make check-cargo-unit-default",
                        "make check-cargo-unit-hostsim"):
            self.assertFalse(any(partial in command for command in commands), partial)
        self.assertIn("SIM_TDIR=rust-modules/target-sim-ci", commands[indexes[3]])
        replay = steps[indexes[4]]
        self.assertEqual(replay["env"]["LIBGL_ALWAYS_SOFTWARE"], "1")
        for argument in ("xvfb-run", '"$PWD/rust-modules/target-sim-ci/release/plxnative-sim"',
                         '--assets "$PWD/pkg"', "--jobs 1", "--timeout 300"):
            self.assertIn(argument, replay["run"])
        recheck = commands[indexes[5]]
        self.assertIn("native/webos/build.py prepare", recheck)
        self.assertIn("prepared-after.json", recheck)
        self.assertIn("--rust-opt-level s", commands[indexes[8]])
        dependencies = next(command for command in commands if "apt-get install" in command)
        for package in ("libsdl2-dev", "libsdl2-ttf-dev", "libgl1-mesa-dev",
                        "libgl1-mesa-dri", "xvfb", "xauth"):
            self.assertIn(package, dependencies.split())
        evidence = next(step for step in steps
                        if step.get("with", {}).get("name", "").startswith("ottplay-native-host-verification-"))
        self.assertTrue(evidence["uses"].startswith("actions/upload-artifact@"))
        self.assertEqual(evidence["if"], "always()")
        stem = "${{ runner.temp }}/native-host-verification/"
        self.assertEqual(set(evidence["with"]["path"].splitlines()), {
            stem + suffix for suffix in ("*.log", "*.json", "rust-toolchain.txt",
                                        "replay/**/plxnative-events.log", "replay/**/sim.out")
        })

    def test_complete_candidate_requires_companion_before_packaging(self):
        workflow = yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                             Loader=yaml.BaseLoader)
        contracts = workflow["jobs"]["contracts"]["steps"]
        self.assertTrue(any("-s native/webos/companion" in step.get("run", "")
                            for step in contracts))
        steps = workflow["jobs"]["native-candidate"]["steps"]
        commands = [step.get("run", "") for step in steps]
        indexes = [next(i for i, command in enumerate(commands) if marker in command)
                   for marker in ("native/webos/build.py bootstrap",
                                  "native/webos/companion/prepare.py",
                                  '"native/webos/companion/build.py", "build"',
                                  "native/webos/build.py all",
                                  "scripts/webos-runtime-sources.py")]
        self.assertEqual(indexes, sorted(set(indexes)))
        for index in indexes:
            self.assertNotIn("if", steps[index])
            self.assertNotIn("continue-on-error", steps[index])
        self.assertIn('--companion-bundle "$RUNNER_TEMP/companion-bundle"', commands[indexes[3]])
        self.assertIn('--companion-bundle "$RUNNER_TEMP/companion-bundle"', commands[indexes[4]])
        self.assertIn('--companion-sources "$RUNNER_TEMP/companion-source"', commands[indexes[4]])
        self.assertIn('--sdk-archive "$WEBOS_SDK_ARCHIVE"', commands[indexes[4]])

    def test_cold_prerequisites_are_installed_and_checked_before_host_gates(self):
        workflow = yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                             Loader=yaml.BaseLoader)
        steps = workflow["jobs"]["native-candidate"]["steps"]
        install = next(i for i, step in enumerate(steps) if "apt-get install" in step.get("run", ""))
        probe = next(i for i, step in enumerate(steps) if "curl_version_info" in step.get("run", ""))
        lint = next(i for i, step in enumerate(steps) if "make check 2>&1" in step.get("run", ""))
        self.assertLess(install, probe)
        self.assertLess(probe, lint)
        command = steps[install]["run"]
        for package in ("openssl", "curl", "libcurl4t64", "libwayland-dev", "libglib2.0-dev"):
            self.assertIn(package, command.split())
        self.assertIn("--force-reinstall --require-hashes --only-binary=:all:", command)
        self.assertIn("Pillow==13.0.0", command)
        self.assertIn("--hash=sha256:8bf295fe459343bc6093c8e5e0df60bfa189e0fcb775a22e2c2488fdeccc6c0d", command)
        for index in (install, probe):
            self.assertNotIn("if", steps[index])
            self.assertNotIn("continue-on-error", steps[index])

    def test_cold_prerequisite_probe_fails_closed(self):
        workflow = yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                             Loader=yaml.BaseLoader)
        run = next(step["run"] for step in workflow["jobs"]["native-candidate"]["steps"]
                   if "curl_version_info" in step.get("run", ""))
        code = run.split("python3 - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
        for case in ("ok", "no-curl", "no-http2", "no-tls", "no-alpn", "openssl-fails",
                     "no-pillow", "wrong-pillow", "bad-png"):
            with self.subTest(case=case):
                features = (1 << 2) | (1 << 16)
                if case == "no-http2":
                    features &= ~(1 << 16)
                if case == "no-tls":
                    features &= ~(1 << 2)
                library = mock.Mock()
                library.curl_version_info.return_value = types.SimpleNamespace(
                    contents=types.SimpleNamespace(features=features, version=b"fixture"))
                pil = types.ModuleType("PIL")
                pil.__version__ = "wrong" if case == "wrong-pillow" else "13.0.0"
                pil.Image = mock.MagicMock()
                if case == "bad-png":
                    pil.Image.open.side_effect = OSError("invalid PNG")
                with mock.patch("ctypes.CDLL", return_value=library) as load, \
                        mock.patch("ssl.HAS_ALPN", case != "no-alpn"), \
                        mock.patch("ssl.SSLContext") as context, \
                        mock.patch("subprocess.run") as execute, \
                        mock.patch.dict(sys.modules, {"PIL": None if case == "no-pillow" else pil}), \
                        mock.patch("builtins.print"):
                    if case == "no-curl":
                        load.side_effect = OSError("missing libcurl")
                    if case == "openssl-fails":
                        execute.side_effect = subprocess.CalledProcessError(1, ["openssl"])
                    if case == "ok":
                        exec(compile(code, "webos-native.yml prerequisites", "exec"), {})  # noqa: S102
                        load.assert_called_once_with("libcurl.so.4")
                        self.assertEqual(execute.call_args.args[0][:3], ["openssl", "req", "-x509"])
                        self.assertTrue(execute.call_args.kwargs["check"])
                        self.assertEqual(execute.call_args.kwargs["timeout"], 15)
                        context.return_value.set_alpn_protocols.assert_called_once_with(["h2"])
                        context.return_value.load_cert_chain.assert_called_once()
                        pil.Image.open.assert_called_once_with("build/native-webos/source/pkg/largeIcon.png")
                    else:
                        with self.assertRaises((RuntimeError, OSError, ImportError, subprocess.CalledProcessError)):
                            exec(compile(code, "webos-native.yml prerequisites", "exec"), {})  # noqa: S102

    def test_helper_build_and_sources_share_prepared_offline_environment(self):
        workflow = yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                             Loader=yaml.BaseLoader)
        run = next(step["run"] for step in workflow["jobs"]["native-candidate"]["steps"]
                   if '"native/webos/companion/build.py", "build"' in step.get("run", ""))
        code = run.split("python3 - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
        with tempfile.TemporaryDirectory(prefix="companion workflow ") as directory:
            prepared = {
                "environment": {"CARGO_HOME": directory + "/cargo", "CARGO_NET_OFFLINE": "true",
                                "CARGO_INCREMENTAL": "0", "RUSTUP_TOOLCHAIN": "1.96.1"},
                "target_dir": directory + "/target", "libclang": directory + "/clang",
                "rust_sysroot": directory + "/rust", "rust_source_archive": directory + "/rust.tar.xz",
            }
            (Path(directory) / "companion-prepared.json").write_text(json.dumps(prepared))
            with mock.patch.dict(os.environ, {"RUNNER_TEMP": directory, "WEBOS_SDK": "/sdk fixture",
                                              "WEBOS_SDK_ARCHIVE": "/sdk fixture.tar.bz2",
                                              "CARGO_PROFILE_RELEASE_OPT_LEVEL": "s",
                                              "RUSTFLAGS": "--cfg wrong", "RUSTC_WRAPPER": "/wrong"}), \
                    mock.patch("subprocess.run") as execute:
                # Execute only the checked-in workflow body with process launches mocked.
                exec(compile(code, "webos-native.yml companion", "exec"), {})  # noqa: S102
            self.assertEqual(execute.call_count, 2)
            build, source = execute.call_args_list
            self.assertEqual(build.kwargs["env"], source.kwargs["env"])
            for call in (build, source):
                self.assertIs(call.kwargs["check"], True)
                self.assertFalse(any(key.startswith("CARGO_PROFILE_") for key in call.kwargs["env"]))
                self.assertNotIn("RUSTFLAGS", call.kwargs["env"])
                self.assertNotIn("RUSTC_WRAPPER", call.kwargs["env"])
                self.assertEqual(call.kwargs["env"]["RUSTUP_AUTO_INSTALL"], "0")
                for key, value in prepared["environment"].items():
                    self.assertEqual(call.kwargs["env"][key], value)
            build_args, source_args = build.args[0], source.args[0]
            self.assertEqual(build_args[build_args.index("--output") + 1],
                             source_args[source_args.index("--bundle") + 1])
            self.assertEqual(build_args[build_args.index("--sdk-archive") + 1], "/sdk fixture.tar.bz2")
            self.assertEqual(source_args[source_args.index("--rust-source-archive") + 1],
                             prepared["rust_source_archive"])



class NativeBuildBenchWorkflowTests(unittest.TestCase):
    def workflow(self):
        return yaml.load((ROOT / ".github/workflows/webos-native.yml").read_text(),
                         Loader=yaml.BaseLoader)

    def bench_code(self):
        steps = self.workflow()["jobs"]["native-build-bench"]["steps"]
        run = next(step["run"] for step in steps if "<<'PYBENCH'" in step.get("run", ""))
        return run.split("python3 - <<'PYBENCH'\n", 1)[1].rsplit("\nPYBENCH", 1)[0]

    def test_bench_is_explicit_dispatch_only_and_read_only(self):
        workflow = self.workflow()
        inputs = workflow["on"]["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["build_bench"]["type"], "boolean")
        self.assertEqual(inputs["build_bench"]["default"], "false")
        self.assertEqual(inputs["bench_head_tree"]["type"], "string")
        self.assertEqual(inputs["bench_head_tree"]["default"], "")
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        predicate = "github.event_name == 'workflow_dispatch' && inputs.build_bench"
        self.assertEqual(workflow["jobs"]["native-build-bench"]["if"], "${{ " + predicate + " }}")
        self.assertEqual(workflow["jobs"]["contracts"]["if"], "${{ !(" + predicate + ") }}")

    def test_bench_does_not_change_normal_gate_dependency_or_limits(self):
        jobs = self.workflow()["jobs"]
        self.assertEqual(jobs["native-candidate"]["needs"], "contracts")
        self.assertEqual(jobs["native-candidate"]["if"], "${{ needs.contracts.outputs.build == 'true' }}")
        self.assertEqual(jobs["native-candidate"]["timeout-minutes"], "90")
        self.assertEqual(jobs["contracts"]["timeout-minutes"], "5")
        self.assertNotIn("continue-on-error", jobs["native-build-bench"])
        self.assertNotIn("needs", jobs["native-build-bench"])
        self.assertEqual(jobs["native-build-bench"]["runs-on"], "ubuntu-24.04-arm")
        for job in jobs.values():
            self.assertNotIn("permissions", job)  # inherit the read-only workflow grant

    def test_bench_concurrency_cannot_cancel_ordinary_ci(self):
        group = self.workflow()["concurrency"]["group"]
        self.assertEqual(group, "webos-native-${{ github.event_name == 'workflow_dispatch' && inputs.build_bench && 'bench-' || '' }}${{ github.event.pull_request.number || github.ref }}")
        ref = "refs/heads/fixture"
        ordinary = "webos-native-" + ref
        benchmark = "webos-native-bench-" + ref
        self.assertNotEqual(ordinary, benchmark)

    def test_bench_binds_exact_base_and_dispatch_head_tree(self):
        job = self.workflow()["jobs"]["native-build-bench"]
        checkouts = [step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@")]
        self.assertEqual(len(checkouts), 2)
        self.assertNotIn("ref", checkouts[0]["with"])
        self.assertEqual(checkouts[1]["with"]["ref"], "39dd8b4581a3375558fd6e15827c5cb17bf4c4f8")
        self.assertEqual(checkouts[1]["with"]["path"], "benchmark-before")
        self.assertEqual(job["env"]["BENCH_HEAD_TREE"], "${{ inputs.bench_head_tree }}")
        code = self.bench_code()
        self.assertIn("head = os.environ['GITHUB_SHA']", code)
        self.assertIn("head_tree = os.environ['BENCH_HEAD_TREE']", code)
        self.assertIn("'5c2d31b2adf3386b84f99dd0d91f9be8a9dbaae0'", code)
        self.assertIn("if prepared['tree'] != expected_tree:", code)
        self.assertIn("if git(outer, 'rev-parse', 'HEAD') != outer_sha:", code)
        self.assertIn("builder_sha256=digest(mod_path)", code)

    def test_invalid_bench_pins_refuse_before_any_process(self):
        code = compile(self.bench_code(), "webos-native.yml benchmark", "exec")
        for head, tree in (("a" * 40, ""), ("a" * 40, "main"), ("bad", "b" * 40),
                           ("a" * 40, "B" * 40),
                           ("39dd8b4581a3375558fd6e15827c5cb17bf4c4f8", "b" * 40)):
            with self.subTest(head=head, tree=tree), tempfile.TemporaryDirectory() as directory:
                environment = {"GITHUB_WORKSPACE": directory, "RUNNER_TEMP": directory,
                               "GITHUB_SHA": head, "BENCH_HEAD_TREE": tree}
                with mock.patch.dict(os.environ, environment), \
                        mock.patch("subprocess.run") as run, \
                        mock.patch("subprocess.check_output") as output:
                    with self.assertRaises(ValueError):
                        exec(code, {})  # noqa: S102: invalid-input preflight; process APIs are mocked
                    run.assert_not_called()
                    output.assert_not_called()

    def test_bench_result_predicate_rejects_partial_failed_or_zero_samples(self):
        import ast
        import copy
        import math
        node = next(node for node in ast.parse(self.bench_code()).body
                    if isinstance(node, ast.FunctionDef) and node.name == "checked_document")
        scope = {"json": json, "math": math}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "benchmark result predicate", "exec"), scope)  # noqa: S102
        good = {"failure": None, "red": [], "restored_clean": True, "via_make": True, "runs": 3,
                "scenarios": [{"id": "noop", "status": "ok", "samples": [
                    {"seconds": 1.0, "app_rebuilt": False} for _ in range(3)]},
                    {"id": "sizes", "status": "ok", "samples": []}]}
        for case in ("good", "missing", "extra", "duplicate", "failed", "skipped", "short", "zero",
                     "nonfinite", "failure", "red", "not-restored", "not-make", "wrong-runs", "dirty-noop"):
            doc = copy.deepcopy(good)
            if case == "missing": doc["scenarios"].pop()
            if case == "extra": doc["scenarios"].append({"id": "arm", "status": "ok", "samples": []})
            if case == "duplicate": doc["scenarios"].append(copy.deepcopy(doc["scenarios"][0]))
            if case in ("failed", "skipped"): doc["scenarios"][0]["status"] = case
            if case == "short": doc["scenarios"][0]["samples"].pop()
            if case == "zero": doc["scenarios"][0]["samples"] = []
            if case == "nonfinite": doc["scenarios"][0]["samples"][0]["seconds"] = float("nan")
            if case == "failure": doc["failure"] = "synthetic failure"
            if case == "red": doc["red"] = ["noop"]
            if case == "not-restored": doc["restored_clean"] = False
            if case == "not-make": doc["via_make"] = False
            if case == "wrong-runs": doc["runs"] = 1
            if case == "dirty-noop": doc["scenarios"][0]["samples"][0]["app_rebuilt"] = True
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "result.json"
                path.write_text(json.dumps(doc))
                if case == "good":
                    self.assertEqual(scope["checked_document"](path, ["noop", "sizes"], 3), doc)
                else:
                    with self.assertRaises(ValueError):
                        scope["checked_document"](path, ["noop", "sizes"], 3)

    def test_bench_keeps_exact_tree_snapshot_and_restores_in_finally(self):
        import ast
        code = self.bench_code()
        nodes = list(ast.walk(ast.parse(code)))
        final = next(node.finalbody for node in nodes if isinstance(node, ast.Try) and node.finalbody)
        self.assertEqual(ast.unparse(final[0]), "git(source, 'update-ref', '--no-deref', 'HEAD', upstream, bench_commit)")
        self.assertEqual(ast.unparse(final[1]), "builder.check_source(args, manifest)")
        self.assertIn("git(source, 'commit-tree', expected_tree, '-p', upstream", code)
        self.assertIn("'update-ref', '--no-deref', 'HEAD', bench_commit, upstream", code)
        self.assertIn("with builder.cargo_environment(args) as isolated:", code)
        self.assertIn("synthetic_benchmark_commit=bench_commit", code)
        self.assertNotIn("reset --hard", code)
        self.assertNotIn("git push", code)

    def test_bench_is_sequential_supported_make_subset_with_raw_evidence(self):
        code = self.bench_code()
        self.assertIn("rows = 'noop,leaf,platform,ui,plex,data,session,media,appkit,screens,app,hub,sizes'", code)
        self.assertIn("for label, outer, outer_sha, expected_tree in phases:", code)
        self.assertIn("[('rows', rows, 3), ('check', 'check', 1)]", code)
        self.assertIn("['make', 'build-bench'", code)
        self.assertIn("stderr=subprocess.STDOUT, check=True", code)
        self.assertIn("if benchmark_hash is not None and benchmark_hash != tool_hash:", code)
        self.assertIn("('toolchain','host','runner')", code)
        self.assertIn("'complete-pair.json'", code)
        job = self.workflow()["jobs"]["native-build-bench"]
        self.assertNotIn("strategy", job)
        upload = job["steps"][-1]
        self.assertEqual(upload["if"], "always()")
        self.assertEqual(upload["with"]["if-no-files-found"], "error")
        self.assertEqual(upload["with"]["name"], "native-build-bench-${{ github.sha }}")


    def test_bench_requires_the_edited_crate_to_rebuild(self):
        import ast
        import copy
        import math
        node = next(node for node in ast.parse(self.bench_code()).body
                    if isinstance(node, ast.FunctionDef) and node.name == "checked_document")
        scope = {"json": json, "math": math}
        exec(compile(ast.Module(body=[node], type_ignores=[]), "benchmark result predicate", "exec"), scope)  # noqa: S102
        # Existing build-bench edit targets and Cargo's owning-crate evidence.
        # UI's hub must rebuild UI; it need not rebuild every downstream crate.
        targets = (("app", "app_rebuilt"), ("leaf", "base_rebuilt"),
                   ("platform", "platform_rebuilt"), ("ui", "ui_rebuilt"),
                   ("plex", "plex_rebuilt"), ("data", "data_rebuilt"),
                   ("session", "session_rebuilt"), ("media", "media_rebuilt"),
                   ("appkit", "appkit_rebuilt"), ("screens", "screens_rebuilt"),
                   ("hub", "ui_rebuilt"))
        for row_id, flag in targets:
            good = {"failure": None, "red": [], "restored_clean": True,
                    "via_make": True, "runs": 3, "scenarios": [{
                        "id": row_id, "status": "ok", "samples": [
                            {"seconds": 1.0, flag: True} for _ in range(3)]}]}
            for outcome in ("rebuilt", "one-not-rebuilt", "missing", "not-a-boolean"):
                doc = copy.deepcopy(good)
                if outcome == "one-not-rebuilt":
                    doc["scenarios"][0]["samples"][1][flag] = False
                if outcome == "missing":
                    doc["scenarios"][0]["samples"][1].pop(flag)
                if outcome == "not-a-boolean":
                    doc["scenarios"][0]["samples"][1][flag] = "true"
                with self.subTest(row=row_id, outcome=outcome), tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "result.json"
                    path.write_text(json.dumps(doc))
                    if outcome == "rebuilt":
                        self.assertEqual(scope["checked_document"](path, [row_id], 3), doc)
                    else:
                        with self.assertRaises(ValueError):
                            scope["checked_document"](path, [row_id], 3)

    def test_bench_restores_snapshot_after_binding_failure(self):
        import ast
        tree = ast.parse(self.bench_code())
        phase = next(node for node in tree.body if isinstance(node, ast.For)
                     and isinstance(node.target, ast.Tuple)
                     and node.target.elts[0].id == "label")
        swap = next(i for i, node in enumerate(phase.body)
                    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
                    and isinstance(node.value.func, ast.Name) and node.value.func.id == "git"
                    and ast.unparse(node).endswith("'HEAD', bench_commit, upstream)"))
        end = next(i for i in range(swap + 1, len(phase.body))
                   if isinstance(phase.body[i], ast.Try))
        start = swap
        while start and isinstance(phase.body[start - 1], ast.Assign) and all(
                isinstance(target, ast.Name) and target.id in ("binding", "prepared_sha256")
                for target in phase.body[start - 1].targets):
            start -= 1
        # Execute the workflow's actual swap-to-finally transaction, with no Git/build process.
        code = compile(ast.Module(body=phase.body[start:end + 1], type_ignores=[]),
                       "benchmark snapshot transaction", "exec")
        for point in ("binding-digest", "binding-write", "benchmark-entry"):
            with self.subTest(point=point), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                prepared_path = root / "prepared.json"
                prepared_path.write_text("{}\n")
                upstream, snapshot = "a" * 40, "b" * 40
                current = [upstream]
                transitions = []
                failure = OSError("injected " + point)

                def git(source, *args):
                    self.assertEqual(args[:3], ("update-ref", "--no-deref", "HEAD"))
                    new, old = args[3:]
                    self.assertEqual(current[0], old)  # Preserve real compare-and-swap semantics.
                    current[0] = new
                    transitions.append(new)
                    return ""

                def digest(path):
                    if point == "binding-digest" and path.name == "Makefile":
                        raise failure
                    return "c" * 64

                def check_source(*_):
                    self.assertEqual(current[0], upstream)

                original_write = Path.write_text
                def write_text(path, *args, **kwargs):
                    if point == "binding-write" and path.name == "before-binding-before.json":
                        raise failure
                    return original_write(path, *args, **kwargs)

                builder = types.SimpleNamespace(check_source=mock.Mock(side_effect=check_source),
                    cargo_environment=mock.Mock(side_effect=failure))
                scope = dict(git=git, digest=digest, builder=builder, source=root / "source",
                             upstream=upstream, bench_commit=snapshot, label="before",
                             outer_sha="d" * 40, prepared={}, prepared_path=prepared_path,
                             provenance=root / "PROVENANCE.json", tool_hash="e" * 64,
                             mod_path=root / "build.py", evidence=root, args=object(),
                             manifest={}, json=json, os=os, subprocess=subprocess)
                with mock.patch.object(Path, "write_text", new=write_text), \
                        mock.patch("subprocess.run") as run, \
                        mock.patch("subprocess.check_output") as output:
                    with self.assertRaises(OSError) as caught:
                        exec(code, scope)  # noqa: S102: real transaction; process adapters are mocked
                    self.assertIs(caught.exception, failure)
                    run.assert_not_called()
                    output.assert_not_called()
                self.assertEqual(current[0], upstream, "failure must restore the prepared HEAD")
                self.assertEqual(transitions, [snapshot, upstream])
                builder.check_source.assert_called_once()
                if point != "benchmark-entry":
                    builder.cargo_environment.assert_not_called()
                else:
                    builder.cargo_environment.assert_called_once()
                self.assertFalse((root / "complete-pair.json").exists())


if __name__ == "__main__":
    unittest.main()
