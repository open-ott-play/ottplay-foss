"""The optional native build must never fall outside the required CI gate."""

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("webos_scope", ROOT / "scripts/webos-native-scope.py")
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)
BASE, HEAD = "a" * 40, "b" * 40


class NativeScopeTests(unittest.TestCase):
    def test_native_inputs_require_build(self):
        for path in (*SCOPE.PATHS, "native/webos/build.py", "native/webos/patches/fix.patch",
                     "scripts/webos-runtime-sources.json", "scripts/webos-runtime-sources.py"):
            with self.subTest(path=path):
                self.assertTrue(SCOPE.requires_build("pull_request", BASE, HEAD, lambda *_: [path]))

    def test_unrelated_pr_keeps_only_fast_contracts(self):
        self.assertFalse(SCOPE.requires_build("pull_request", BASE, HEAD,
                         lambda *_: ["README.md", "src/plugins/plex.ts", ""]))

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


if __name__ == "__main__":
    unittest.main()
