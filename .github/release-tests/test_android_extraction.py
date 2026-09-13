"""Android builds live in the native repository; old RCs cannot republish APK/AAB."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("android_extraction_release", ROOT / "scripts/release_control.py")
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class AndroidExtractionTests(unittest.TestCase):
    def test_repository_has_no_android_application_build_entry_points(self):
        package = json.loads((ROOT / "package.json").read_text())
        self.assertFalse(any(name.startswith("android:") or name == "cap:android" for name in package["scripts"]))
        self.assertEqual(package["scripts"]["build:mobile"], "npm run build:ios")
        self.assertEqual(package["scripts"]["cap:sync"], "npx cap sync ios")
        self.assertNotIn("@capacitor/android", package["dependencies"])
        for path in ("android/gradlew", "android/gradlew.bat", "android/build.gradle", "android/app/build.gradle",
                     "scripts/build-android.cjs", "build-android-local.sh", ".github/workflows/play-bundle.yml"):
            self.assertFalse((ROOT / path).exists(), path)
        self.assertTrue((ROOT / "android/app/src/main/java/play/ott/foss/MainActivity.java").is_file())
        policy = json.loads((ROOT / ".release-policy.json").read_text())
        self.assertFalse(any(path.startswith("android/") for path in policy["version_companions"]))

    def test_workflows_do_not_assemble_or_upload_android_packages(self):
        for workflow in (ROOT / ".github/workflows").glob("*.yml"):
            source = workflow.read_text()
            for forbidden in ("./gradlew", "scripts/build-android.cjs", "release-assets-mobile-android", "build-tools;"):
                self.assertNotIn(forbidden, source, workflow.name)
        parity = (ROOT / ".github/workflows/native-parity.yml").read_text()
        self.assertIn('"platforms;android-36"', parity)
        self.assertIn('test -s "$ANDROID_HOME/platforms/android-36/android.jar"', parity)
        build = (ROOT / ".github/workflows/release-build.yml").read_text()
        self.assertIn("npm run build:ios", build)
        self.assertIn("npx tauri build", build)
        self.assertIn("npm run package:modea", build)

    def test_candidate_staging_rejects_apk_and_aab_case_insensitively(self):
        for extension in ("apk", "APK", "aab", "AaB"):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source, target = root / "source", root / "target"
                source.mkdir(); target.mkdir()
                (source / f"retired.{extension}").write_bytes(b"old Android release")
                with self.assertRaisesRegex(Exception, "APK/AAB publication moved"):
                    RELEASE.stage_assets(source, target)
                self.assertEqual(list(target.iterdir()), [])

    def test_old_rc_publish_rejects_android_before_any_github_call(self):
        class NoGitHubCalls:
            def __getattr__(self, name):
                raise AssertionError(f"Publication must be rejected before GitHub call: {name}")
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            (stage / "retired.apk").write_bytes(b"previously verified RC bytes")
            with self.assertRaisesRegex(Exception, "APK/AAB publication moved"):
                RELEASE.publish(NoGitHubCalls(), "v1.2.3", "a" * 40, stage, False, "")

    def test_desktop_ios_and_web_assets_still_stage_without_changes(self):
        payloads = {"player.ipa": b"ios", "player.dmg": b"mac", "player.exe": b"win", "player.tar.gz": b"web"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / "source", root / "target"
            source.mkdir(); target.mkdir()
            for name, content in payloads.items(): (source / name).write_bytes(content)
            staged = RELEASE.stage_assets(source, target)
            self.assertEqual({item["name"] for item in staged}, set(payloads))
            for name, content in payloads.items(): self.assertEqual((target / name).read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
