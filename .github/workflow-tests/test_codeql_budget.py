"""Keep the complete Swift security analysis within its explicit job budget."""
import shlex
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


class CodeQLBudgetTests(unittest.TestCase):
    def setUp(self):
        self.jobs = yaml.load(
            (ROOT / ".github/workflows/codeql.yml").read_text(),
            Loader=yaml.BaseLoader,
        )["jobs"]

    def test_swift_budget_covers_observed_compile_and_complete_analysis(self):
        # Failure job 131643778534: setup 99s, successful compile 37m25s.
        # Successful same-workflow job 131632186538: analysis 90s, cleanup 27s.
        # The old 40-minute cap cannot fit even this observed combination.
        observed_seconds = 99 + 37 * 60 + 25 + 90 + 27
        minutes = int(self.jobs["analyze-swift"]["timeout-minutes"])
        self.assertGreater(minutes * 60, observed_seconds)
        self.assertEqual(minutes, 60, "Keep the reviewed Swift-only upper bound")
        other_jobs = {name: job for name, job in self.jobs.items() if name != "analyze-swift"}
        self.assertTrue(other_jobs)
        for name, job in other_jobs.items():
            with self.subTest(job=name):
                self.assertEqual(job["timeout-minutes"], "30")

    def test_swift_keeps_manual_generic_simulator_build_and_required_analysis(self):
        job = self.jobs["analyze-swift"]
        self.assertEqual(job["runs-on"], "macos-latest")
        self.assertNotIn("if", job)
        self.assertNotIn("continue-on-error", job)
        self.assertEqual(job["permissions"], {
            "actions": "read", "contents": "read", "security-events": "write",
        })
        steps = job["steps"]
        init = next(step for step in steps if step.get("name") == "Initialize Swift CodeQL analysis")
        build = next(step for step in steps if step.get("name") == "Compile iOS plugins without signing")
        analyze = next(step for step in steps if step.get("name") == "Analyze compiled Swift code")
        self.assertEqual(init["with"], {"languages": "swift", "build-mode": "manual"})
        self.assertEqual(analyze["with"], {"category": "/language:swift"})
        self.assertRegex(init["uses"], r"^github/codeql-action/init@[0-9a-f]{40}$")
        self.assertEqual(analyze["uses"], init["uses"].replace("/init@", "/analyze@"))
        self.assertLess(steps.index(init), steps.index(build))
        self.assertLess(steps.index(build), steps.index(analyze))
        for step in (init, build, analyze):
            self.assertNotIn("continue-on-error", step)
            self.assertNotIn("if", step)
        # No host-only ARCHS/ONLY_ACTIVE_ARCH shortcut or skipped compilation.
        self.assertEqual(shlex.split(build["run"]), [
            "xcodebuild", "-project", "ios/App/App.xcodeproj", "-scheme", "App",
            "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator",
            "-derivedDataPath", "$RUNNER_TEMP/ottplay-codeql-ios", "CODE_SIGNING_ALLOWED=NO", "build",
        ])


if __name__ == "__main__":
    unittest.main()
