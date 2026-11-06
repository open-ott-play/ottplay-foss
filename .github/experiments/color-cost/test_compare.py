"""Small synthetic control tests. Never invoke build, npm, or hosted main."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("color_cost", Path(__file__).with_name("compare.py"))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def manifest():
    return {"schemaVersion": 1, "status": "bound", "baseCommit": c.HEAD,
            "nodeVersion": c.NODE, "zlibVersion": c.ZLIB, "featurePatchSha256": "a" * 64, "upstreamManifestSha256": "e" * 64,
            "tools": {name: "b" * 64 for name in ("compare.py", "collect-assets.cjs")},
            "unchanged": {name: "c" * 64 for name in c.FROZEN},
            "files": {"src/settings/interface-colors.ts": {"before": None, "after": {"sha256": "d" * 64, "mode": "100644"}}},
            "expectedNewRootJs": ["color-appearance.js"], "expectedRootJavaScriptFiles": {"A": 3, "B": 6}}


class Controls(unittest.TestCase):
    def test_added_file_has_explicit_absence(self):
        c.validate_manifest(manifest())

    def test_unbound_and_wrong_pins_rejected(self):
        for key, value in (("status", "unbound"), ("baseCommit", "0" * 40),
                           ("nodeVersion", "latest"), ("zlibVersion", "other"),
                           ("featurePatchSha256", "")):
            m = manifest(); m[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): c.validate_manifest(m)

    def test_path_escape_and_private_inputs_rejected(self):
        for name in ("../src/a.ts", "/src/a.ts", "src/../../secret", ".git/config", ".env", "src//a.ts"):
            m = manifest(); m["files"] = {name: next(iter(m["files"].values()))}
            with self.subTest(name=name), self.assertRaises(ValueError): c.validate_manifest(m)

    def test_changed_controls_and_noop_entries_rejected(self):
        m = manifest(); m["unchanged"].pop("scripts/classic-size.cjs")
        with self.assertRaises(ValueError): c.validate_manifest(m)
        m = manifest(); m["files"]["src/a.ts"] = {"before": None, "after": None}
        with self.assertRaises(ValueError): c.validate_manifest(m)
        m = manifest(); m["tools"]["collect-assets.cjs"] = "no hash"
        with self.assertRaises(ValueError): c.validate_manifest(m)

    def test_no_comparison_for_incomplete_source(self):
        result = c.comparison(Path("/not-read"), {"arms": {"A": {}, "B": {}}}, manifest())
        self.assertFalse(result["available"])

    def test_partial_css_cost_and_failed_gate_remain_separate(self):
        with tempfile.TemporaryDirectory(prefix="color-cost-unit-") as temporary:
            root = Path(temporary)
            arms = {name: {"measurementComplete": True, "sourceValidatedAfter": True,
                           "identityProbe": {"sourceRevision": ""}} for name in ("A", "B")}
            for arm in ("A", "B"):
                records = []
                for family, directory in (("web", "dist"), ("tauri", "src-tauri/frontend/dist"), ("mobile", "dist-mobile/dist")):
                    records.append({"path": directory + "/player.js", "family": family,
                                    "category": "rootJavaScript", "bytes": 100, "gzipBytes": 50, "sha256": "a" * 64})
                    if arm == "B":
                        records.append({"path": directory + "/color-appearance.js", "family": family,
                                        "category": "rootJavaScript", "bytes": 20, "gzipBytes": 10, "sha256": "b" * 64})
                records.append({"path": "dist/styles/player.css", "family": "web", "category": "stylesheets",
                                "bytes": 5 if arm == "A" else 15, "gzipBytes": 4 if arm == "A" else 8,
                                "sha256": arm * 64})
                target = root / arm / "assets"; target.mkdir(parents=True)
                c.save(target / "inventory.json", {"complete": True, "node": c.NODE, "zlib": c.ZLIB, "records": records})
            result = c.comparison(root, {"arms": arms, "allCommandsPassed": False}, manifest())
            self.assertTrue(result["available"])
            self.assertFalse(result["allCommandsPassed"])
            self.assertEqual(result["totalsByCategory"]["rootJavaScript"]["deltaBytes"], 60)
            self.assertEqual(result["totalsByCategory"]["stylesheets"]["deltaBytes"], 10)
            inv = c.read_json(root / "B/assets/inventory.json")
            inv["records"] = [r for r in inv["records"] if not r["path"].endswith("color-appearance.js")]
            c.save(root / "B/assets/inventory.json", inv)
            with self.assertRaises(ValueError): c.comparison(root, {"arms": arms}, manifest())

    def test_unexpected_cleanup_error_is_terminal(self):
        with patch.object(c, "_clean_group", side_effect=PermissionError("fixture")):
            with self.assertRaises(c.CleanupError): c.clean_group(object())

    def test_host_guard_prevents_local_commands(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), patch.object(c.subprocess, "Popen") as popen:
            with self.assertRaises(RuntimeError): c.main()
            popen.assert_not_called()

    def test_environment_drops_secrets_keeps_hosted_guard(self):
        with patch.dict(os.environ, {"RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_TOKEN": "fixture", "NODE_OPTIONS": "fixture"}):
            env = c.environment(Path("/fixture"))
        self.assertEqual(env["RUNNER_ENVIRONMENT"], "github-hosted")
        self.assertNotIn("GITHUB_TOKEN", env)
        self.assertNotIn("NODE_OPTIONS", env)


if __name__ == "__main__":
    unittest.main()
