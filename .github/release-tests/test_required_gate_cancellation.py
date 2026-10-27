"""Required aggregate checks run after cancellation and reject incomplete validation."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


class RequiredGateCancellationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = yaml.safe_load((ROOT / ".github/workflows/quality-gate.yml").read_text())
        cls.gate = workflow["jobs"]["gate"]
        step = next(step for step in cls.gate["steps"] if step.get("name") == "Require every validation workflow")
        lines = step["run"].splitlines()
        if lines[0] != "python3 - <<'PY'" or lines[-1] != "PY":
            raise AssertionError("Unexpected aggregate validator wrapper")
        cls.validator = "\n".join(lines[1:-1])

    def results(self, docs_only=False):
        required = {"scope", "workflow-contracts", "check-2"}
        results = {
            name: {"result": "success" if not docs_only or name in required else "skipped"}
            for name in self.gate["needs"]
        }
        results["scope"]["outputs"] = {
            "run": "false" if docs_only else "true",
            "reason": "documentation-only" if docs_only else "code",
        }
        return results

    def evaluate(self, results):
        return subprocess.run(
            [sys.executable, "-c", self.validator],
            env={"RESULTS": json.dumps(results)},
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

    def test_required_gate_runs_after_dependency_cancellation(self):
        self.assertEqual(self.gate["if"], "${{ always() }}")

    def test_successful_code_and_documentation_validation_pass(self):
        for docs_only in (False, True):
            with self.subTest(docs_only=docs_only):
                result = self.evaluate(self.results(docs_only))
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_cancelled_failed_or_skipped_code_validation_fails(self):
        for status in ("cancelled", "failure", "skipped"):
            with self.subTest(status=status):
                results = self.results()
                results["check-0"]["result"] = status
                self.assertNotEqual(self.evaluate(results).returncode, 0)

    def test_cancelled_scope_fails_even_when_every_other_check_passed(self):
        results = self.results()
        results["scope"]["result"] = "cancelled"
        self.assertNotEqual(self.evaluate(results).returncode, 0)

    def test_cancelled_required_documentation_check_fails(self):
        results = self.results(True)
        results["workflow-contracts"]["result"] = "cancelled"
        self.assertNotEqual(self.evaluate(results).returncode, 0)

    def test_missing_validation_job_fails(self):
        results = self.results()
        results.pop("check-0")
        self.assertNotEqual(self.evaluate(results).returncode, 0)


if __name__ == "__main__":
    unittest.main()
