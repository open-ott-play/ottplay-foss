"""Keep the signed-commit requirement visible before a release pull request stalls.

The main ruleset refuses unsigned commits, and GitHub only reports it as BLOCKED
after the whole gate passed. These tests pin the checker that names the offending
commit, the always-on pull request job that runs it, and the local mode that must
not refuse a valid signature just because this checkout has no signer keys.
"""

import importlib.util
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "check_pr_commit_signatures", ROOT / "scripts/check-pr-commit-signatures.py"
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load the commit signature check")
SIGNATURES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SIGNATURES)

SIGNED_SHA = "a" * 40
UNSIGNED_SHA = "b" * 40
UNKNOWN_KEY_SHA = "c" * 40
LAST_SHA = "d" * 40


def signed(sha, subject):
    return {
        "sha": sha,
        "commit": {
            "message": subject + "\n\nbody",
            "verification": {"verified": True, "reason": "valid"},
        },
    }


def refused(sha, subject, reason="unsigned"):
    return {
        "sha": sha,
        "commit": {
            "message": subject,
            "verification": {"verified": False, "reason": reason},
        },
    }


def repository(directory, *configuration):
    root = Path(directory)

    def git(*arguments):
        return subprocess.run(
            ["git", *arguments],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )

    git("init", "--quiet")
    git("config", "user.name", "Signature Fixture")
    git("config", "user.email", "fixture@example.invalid")
    for entry in configuration:
        git("config", *entry)
    return root, git


class SignatureReportTests(unittest.TestCase):
    def test_only_unverified_commits_are_reported(self):
        failures = SIGNATURES.signature_failures(
            [
                signed(SIGNED_SHA, "fix(player): signed"),
                refused(UNSIGNED_SHA, "docs: loose commit"),
                refused(UNKNOWN_KEY_SHA, "wip", "no_user"),
            ]
        )
        self.assertEqual([item["sha"] for item in failures], [UNSIGNED_SHA, UNKNOWN_KEY_SHA])
        self.assertEqual([item["reason"] for item in failures], ["unsigned", "no_user"])
        self.assertEqual(failures[0]["subject"], "docs: loose commit")

    def test_report_names_the_blocked_merge_and_the_resign_command(self):
        output = io.StringIO()
        with mock.patch("sys.stdout", output):
            status = SIGNATURES.report(
                SIGNATURES.signature_failures([refused(UNSIGNED_SHA, "docs")]),
                (),
                "origin/main",
            )
        self.assertEqual(status, 1)
        text = output.getvalue()
        self.assertIn("BLOCKED", text)
        self.assertIn(
            'git rebase --exec "git commit --amend --no-edit -S" origin/main', text
        )
        self.assertIn(UNSIGNED_SHA[:12], text)

    def test_report_keeps_locally_unverifiable_signatures_as_a_note(self):
        output = io.StringIO()
        with mock.patch("sys.stdout", output):
            status = SIGNATURES.report(
                [],
                [{"sha": SIGNED_SHA, "reason": "N", "subject": "signed change"}],
                "origin/main",
            )
        self.assertEqual(status, 0)
        text = output.getvalue()
        self.assertIn("allowedSignersFile", text)
        self.assertNotIn("BLOCKED", text)
        self.assertIn(SIGNED_SHA[:12], text)

    def test_signed_history_is_accepted_silently(self):
        output = io.StringIO()
        with mock.patch("sys.stdout", output):
            status = SIGNATURES.report(
                SIGNATURES.signature_failures([signed(SIGNED_SHA, "chore")]),
                (),
                "origin/main",
            )
        self.assertEqual(status, 0)
        self.assertNotIn("BLOCKED", output.getvalue())

    def test_api_listing_paginates_until_a_short_page(self):
        pages = {
            1: [signed(SIGNED_SHA, "commit " + str(index)) for index in range(100)],
            2: [signed(LAST_SHA, "last commit")],
        }
        requested = []

        def fetch(request, timeout=20):
            requested.append(request.full_url)
            self.assertEqual(timeout, SIGNATURES.TIMEOUT_SECONDS)
            return io.BytesIO(json.dumps(pages[len(requested)]).encode("utf-8"))

        rows = SIGNATURES.pull_request_commits(
            "open-ott-play/ottplay-foss", 1191, "token", fetch=fetch
        )
        self.assertEqual(len(rows), 101)
        self.assertEqual(len(requested), 2)
        self.assertIn("/pulls/1191/commits", requested[0])
        self.assertIn("per_page=100", requested[0])
        self.assertIn("page=2", requested[1])


class LocalSignatureTests(unittest.TestCase):
    def test_local_checkout_reports_an_unsigned_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root, git = repository(directory, ("commit.gpgsign", "false"))
            git("commit", "--allow-empty", "--quiet", "-m", "base commit")
            base = git("rev-parse", "HEAD").stdout.strip()
            git("commit", "--allow-empty", "--quiet", "-m", "unsigned change")
            failures, unverifiable = SIGNATURES.git_signature_states(root, base, "HEAD")
            self.assertEqual(len(failures), 1)
            self.assertEqual(failures[0]["subject"], "unsigned change")
            self.assertEqual(unverifiable, [])

    @unittest.skipUnless(shutil.which("ssh-keygen"), "needs ssh-keygen for SSH signing")
    def test_local_checkout_accepts_a_signature_it_cannot_verify(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = root / "signing_key"
            subprocess.run(
                [
                    "ssh-keygen",
                    "-q",
                    "-t",
                    "ed25519",
                    "-N",
                    "",
                    "-C",
                    "fixture@example.invalid",
                    "-f",
                    str(key),
                ],
                check=True,
                capture_output=True,
            )
            root, git = repository(
                directory,
                ("gpg.format", "ssh"),
                ("user.signingkey", str(key) + ".pub"),
            )
            git("commit", "--allow-empty", "--quiet", "-m", "base commit")
            base = git("rev-parse", "HEAD").stdout.strip()
            git("config", "commit.gpgSign", "true")
            git("commit", "--allow-empty", "--quiet", "-m", "signed change")
            # No gpg.ssh.allowedSignersFile here: git keeps the signature but
            # cannot verify it, and the commit must not be refused for that.
            self.assertNotEqual(
                git("show", "-s", "--format=%G?", "HEAD").stdout.strip(), "G"
            )
            failures, unverifiable = SIGNATURES.git_signature_states(root, base, "HEAD")
            self.assertEqual(failures, [])
            self.assertEqual(len(unverifiable), 1)
            self.assertEqual(unverifiable[0]["subject"], "signed change")


class GatePlacementTests(unittest.TestCase):
    """The gate rejects a pull request validator that lives outside it.

    Runtime validation is skipped for documentation-only changes, so the check is
    configured as an always-validated workflow of the gate instead.
    """

    def workflow(self, name):
        return yaml.safe_load(
            (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
        )

    def policy(self):
        return json.loads((ROOT / ".release-policy.json").read_text(encoding="utf-8"))

    def test_validator_is_callable_and_never_runs_on_its_own(self):
        workflow = self.workflow("commit-signatures.yml")
        # YAML 1.1 loaders read the unquoted key as true; accept either form.
        triggers = workflow.get("on") or workflow.get(True)
        self.assertEqual(triggers, {"workflow_call": {}})

    def test_job_checks_the_pull_request_commits(self):
        job = self.workflow("commit-signatures.yml")["jobs"]["signatures"]
        self.assertEqual(job["name"], "Commit signatures")
        self.assertEqual(job["timeout-minutes"], 5)
        steps = job["steps"]
        self.assertEqual(
            steps[0]["uses"],
            "step-security/harden-runner@aebdcf6156ab6691adf63218240e476564a1ed4c",
        )
        self.assertEqual(
            steps[1]["uses"],
            "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        )
        self.assertEqual(steps[1]["with"]["persist-credentials"], False)
        checks = [
            step
            for step in steps
            if "check-pr-commit-signatures.py" in step.get("run", "")
        ]
        self.assertEqual(len(checks), 1)
        self.assertIn(
            '--pull-request "${{ github.event.pull_request.number }}"',
            checks[0]["run"],
        )
        self.assertIn('--repo "${{ github.repository }}"', checks[0]["run"])
        self.assertEqual(checks[0]["env"]["GITHUB_TOKEN"], "${{ github.token }}")

    def test_policy_schedules_the_validator_for_every_pull_request(self):
        policy = self.policy()
        index = policy["validation_workflows"].index("commit-signatures.yml")
        self.assertIn(f"check-{index}", self.workflow("quality-gate.yml")["jobs"])
        self.assertIn(
            "commit-signatures.yml",
            policy["change_scope"]["always_validate_workflows"],
        )

    def test_gate_runs_the_validator_when_the_scope_skips_runtime_checks(self):
        gate = self.workflow("quality-gate.yml")["jobs"]
        check = gate["check-3"]
        self.assertEqual(check["uses"], "./.github/workflows/commit-signatures.yml")
        self.assertNotIn("if", check)
        self.assertEqual(check["needs"], ["scope", "workflow-contracts"])
        self.assertIn("check-3", gate["gate"]["needs"])
        # Runtime validation is what a documentation-only change skips.
        self.assertIn("if", gate["check-0"])
        self.assertIn("if", gate["check-2"])
        inventory = next(
            step
            for step in gate["gate"]["steps"]
            if step.get("name") == "Require every validation workflow"
        )
        self.assertIn("'check-3'", inventory["run"].split("expected = ")[1])
        self.assertIn("'check-3'", inventory["run"].split("always = ")[1])

    def test_scope_gated_runtime_workflow_does_not_own_the_check(self):
        self.assertNotIn(
            "commit-signatures", self.workflow("windows-validation.yml")["jobs"]
        )


if __name__ == "__main__":
    unittest.main()
