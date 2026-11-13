#!/usr/bin/env python3
"""Pure and mocked scope contracts; never creates or changes a Git repository."""

import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "ci-multiview-unix-scope.py"
if not SOURCE.is_file():
    SOURCE = HERE.parent / "scripts" / "ci-multiview-unix-scope.py"
SPEC = importlib.util.spec_from_file_location("multiview_unix_scope", SOURCE)
scope = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scope)
BASE, HEAD = "1" * 40, "2" * 40


def record(path, status="M", before="100644", after="100644"):
    old = "0" * 40 if status == "A" else BASE
    new = "0" * 40 if status == "D" else HEAD
    return f":{before} {after} {old} {new} {status}\0{path}\0".encode()


def fake_reader(raw, *, shallow=b"false\n", commit=b"commit\n"):
    calls = []

    def reader(_repo, args):
        calls.append(args)
        if args[0] == "rev-parse":
            return shallow
        if args[0] == "cat-file":
            return commit
        return raw

    return reader, calls


class DiffContracts(unittest.TestCase):
    def test_each_related_input_runs(self):
        for path in [
            "src-rs/core/src/multiview/encoder.rs", "src-rs/core/build.rs",
            "src-rs/server/src/main.rs", "src-rs/server/src/helper.rs",
            "src-rs/server/src/multiview_operator.rs", "src-rs/server/src/multiview_service.rs",
            "src-rs/server/tests/multiview_activation.rs", "src-rs/server/Cargo.toml",
            "src-rs/server/tests/multiview_fixtures.rs", "Cargo.toml", "Cargo.lock",
            ".cargo/config.toml", "rust-toolchain.toml", "vendor/library/src/lib.rs",
            ".github/workflows/windows-validation.yml", ".release-policy.json",
            "scripts/ci-multiview-unix.py", "scripts/ci-multiview-unix-scope.py",
            "scripts/ci-native-favorites.py", "tests/test_multiview_unix_scope.py",
        ]:
            with self.subTest(path=path):
                self.assertTrue(scope.classify_diff(record(path))["run"])

    def test_complete_unrelated_docs_and_windows_paths_skip(self):
        raw = record("docs/installation.md") + record("src-tauri/src/windows_video.rs")
        self.assertEqual(scope.classify_diff(raw), {
            "run": False, "reason": "complete-unrelated-diff",
        })

    def test_deletion_is_not_hidden(self):
        self.assertTrue(scope.classify_diff(record(
            "src-rs/server/tests/multiview_fixtures.rs", "D", after="000000"))["run"])
        self.assertFalse(scope.classify_diff(record(
            "docs/obsolete.md", "D", after="000000"))["run"])

    def test_related_rename_as_delete_add_runs_both_directions(self):
        raw = record("src-rs/core/src/multiview/old.rs", "D", after="000000")
        raw += record("docs/new.md", "A", before="000000")
        self.assertTrue(scope.classify_diff(raw)["run"])
        raw = record("docs/old.md", "D", after="000000")
        raw += record("src-rs/core/src/multiview/new.rs", "A", before="000000")
        self.assertTrue(scope.classify_diff(raw)["run"])

    def test_empty_or_ambiguous_diff_never_skips(self):
        normal = record("docs/a.md")
        for raw in [
            b"", normal[:-1], normal + b"extra\0", normal + normal,
            record("docs/a.md", "R100"), record("docs/a.md", after="120000"),
            record("../docs/a.md"), record("docs/./a.md"), record("docs/a\nb.md"),
            record("docs\\a.md"), normal.replace(HEAD.encode(), b"not-a-sha"),
            normal.replace(b"docs/a.md", b"docs/\xff.md"),
        ]:
            with self.subTest(raw=raw[:90]):
                self.assertTrue(scope.classify_diff(raw)["run"])

    def test_zero_hash_contradictions_run(self):
        raw = record("docs/a.md", "A", before="000000").replace(
            ("0" * 40).encode(), BASE.encode(), 1)
        self.assertTrue(scope.classify_diff(raw)["run"])

    def test_diff_size_limit_runs(self):
        with mock.patch.object(scope, "MAX_DIFF_BYTES", 8):
            self.assertTrue(scope.classify_diff(record("docs/a.md"))["run"])


class EventContracts(unittest.TestCase):
    def event(self, kind):
        if kind == "pull_request":
            return {"pull_request": {"base": {"sha": BASE}, "head": {"sha": HEAD}}}
        if kind == "merge_group":
            return {"merge_group": {"base_sha": BASE, "head_sha": HEAD}}
        return {"before": BASE, "after": HEAD}

    def test_complete_event_ranges(self):
        for kind, separator in [("pull_request", "..."), ("merge_group", ".."), ("push", "..")]:
            with self.subTest(kind=kind):
                reader, calls = fake_reader(record("docs/a.md"))
                self.assertFalse(scope.classify("unused", kind, self.event(kind), reader=reader)["run"])
                self.assertIn(BASE + separator + HEAD, calls[-1])
                self.assertIn("--no-renames", calls[-1])
                self.assertIn("--no-ext-diff", calls[-1])

    def test_unknown_or_manual_event_runs_without_git(self):
        reader = mock.Mock(side_effect=AssertionError("Git must not run"))
        for kind in ["", "workflow_dispatch", "schedule", "workflow_call", "unknown"]:
            self.assertTrue(scope.classify("unused", kind, None, reader=reader)["run"])

    def test_explicit_caller_force_runs_without_git(self):
        reader = mock.Mock(side_effect=AssertionError("Git must not run"))
        self.assertEqual(scope.classify("unused", "pull_request", None, force=True, reader=reader), {
            "run": True, "reason": "forced-by-caller",
        })

    def test_invalid_or_missing_base_runs_without_git(self):
        reader = mock.Mock(side_effect=AssertionError("Git must not run"))
        for event in [{}, None, {"before": "0" * 40, "after": HEAD},
                      {"before": "main", "after": HEAD}]:
            self.assertTrue(scope.classify("unused", "push", event, reader=reader)["run"])

    def test_shallow_and_unresolvable_base_never_skip(self):
        for kwargs in [{"shallow": b"true\n"}, {"commit": b"blob\n"}]:
            reader, _ = fake_reader(record("docs/a.md"), **kwargs)
            self.assertTrue(scope.classify("unused", "push", self.event("push"), reader=reader)["run"])

    def test_git_failures_and_limits_never_become_skip(self):
        for error in [scope.GitReadError("size limit"), scope.GitReadError("deadline"),
                      OSError("missing git"), subprocess.TimeoutExpired("git", 30),
                      subprocess.CalledProcessError(1, "git")]:
            reader = mock.Mock(side_effect=error)
            self.assertEqual(scope.classify("unused", "push", self.event("push"), reader=reader), {
                "run": True, "reason": "git-read-incomplete",
            })


if __name__ == "__main__":
    unittest.main()
