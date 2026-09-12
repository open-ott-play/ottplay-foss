"""Real JDK signing contracts using disposable keys and a minimal ZIP fixture, not an Android build."""

import base64
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIGN = ROOT / "scripts/android/sign-play-bundle.py"
VERIFY = ROOT / "scripts/android/VerifyUploadBundle.java"


class UploadSigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for command in ("java", "keytool", "jarsigner"):
            if not shutil.which(command):
                raise RuntimeError(f"{command} is required for real signing tests")
        cls.temp = tempfile.TemporaryDirectory(prefix="ott-signing-contract-")
        cls.directory = Path(cls.temp.name)
        cls.environment = dict(
            os.environ,
            PLAY_UPLOAD_STORE_PASSWORD="disposable-test-password",
            PLAY_UPLOAD_KEY_PASSWORD="disposable-test-password",
            PLAY_UPLOAD_KEY_ALIAS="upload",
            RUNNER_TEMP=cls.temp.name,
        )
        for name in ("intended", "other"):
            key = cls.directory / (name + ".p12")
            subprocess.run(
                [
                    "keytool",
                    "-genkeypair",
                    "-alias",
                    "upload",
                    "-keyalg",
                    "RSA",
                    "-keysize",
                    "2048",
                    "-validity",
                    "2",
                    "-dname",
                    "CN=Disposable test only",
                    "-storetype",
                    "PKCS12",
                    "-keystore",
                    str(key),
                    "-storepass:env",
                    "PLAY_UPLOAD_STORE_PASSWORD",
                    "-keypass:env",
                    "PLAY_UPLOAD_KEY_PASSWORD",
                ],
                env=cls.environment,
                check=True,
                capture_output=True,
            )
            cert = subprocess.run(
                [
                    "keytool",
                    "-exportcert",
                    "-alias",
                    "upload",
                    "-keystore",
                    str(key),
                    "-storepass:env",
                    "PLAY_UPLOAD_STORE_PASSWORD",
                ],
                env=cls.environment,
                check=True,
                capture_output=True,
            ).stdout
            (cls.directory / (name + ".der")).write_bytes(cert)
        cls.environment["PLAY_UPLOAD_KEYSTORE_BASE64"] = base64.b64encode(
            (cls.directory / "intended.p12").read_bytes()
        ).decode()
        cls.source = cls.directory / "unsigned bundle.aab"
        with zipfile.ZipFile(cls.source, "w") as bundle:
            bundle.writestr("BundleConfig.pb", b"opaque fixture config")
            bundle.writestr("base/manifest/AndroidManifest.xml", b"opaque fixture manifest")
            bundle.writestr("base/assets/value.txt", "Payload & <literal> value")
        cls.signed = cls.directory / "verified bundle.aab"
        cls.result = cls.invoke(cls.source, cls.signed)
        if cls.result.returncode:
            raise AssertionError(cls.result.stderr.decode())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @classmethod
    def invoke(cls, source, output, **changes):
        return subprocess.run(
            [sys.executable, str(SIGN), str(source), str(output)],
            env=dict(cls.environment, **changes),
            check=False,
            capture_output=True,
        )

    def verify(self, source, certificate="intended.der"):
        return subprocess.run(
            ["java", str(VERIFY), str(source), str(self.directory / certificate)], check=False, capture_output=True
        )

    def test_positive_signature_and_no_secret_output(self):
        self.assertEqual(self.verify(self.signed).returncode, 0)
        for secret in (self.environment["PLAY_UPLOAD_STORE_PASSWORD"], self.environment["PLAY_UPLOAD_KEYSTORE_BASE64"]):
            self.assertNotIn(secret.encode(), self.result.stdout + self.result.stderr)
        self.assertEqual(list(self.directory.glob("ott-play-upload-*")), [], "decoded keys must be removed")

    def test_unsigned_and_wrong_certificate_rejected(self):
        self.assertNotEqual(self.verify(self.source).returncode, 0)
        self.assertNotEqual(self.verify(self.signed, "other.der").returncode, 0)

    def test_modified_and_unsigned_added_entries_rejected(self):
        for added in (False, True):
            target = self.directory / ("added.aab" if added else "modified.aab")
            with zipfile.ZipFile(self.signed) as original, zipfile.ZipFile(target, "w") as changed:
                for item in original.infolist():
                    value = original.read(item)
                    if not added and item.filename == "base/assets/value.txt":
                        value = b"modified"
                    changed.writestr(item, value)
                if added:
                    changed.writestr("base/assets/untrusted.txt", b"unsigned")
            self.assertNotEqual(self.verify(target).returncode, 0)

    def test_bad_configuration_fails_without_output_or_key_leak(self):
        for name, value in (
            ("PLAY_UPLOAD_STORE_PASSWORD", "wrong"),
            ("PLAY_UPLOAD_KEY_ALIAS", "missing"),
            ("PLAY_UPLOAD_KEY_PASSWORD", "wrong"),
            ("PLAY_UPLOAD_KEYSTORE_BASE64", "!invalid!"),
            ("PLAY_UPLOAD_KEY_ALIAS", ""),
        ):
            with self.subTest(name=name, value=value):
                output = self.directory / "must-not-exist.aab"
                result = self.invoke(self.source, output, **{name: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())
                self.assertEqual(list(self.directory.glob("ott-play-upload-*")), [])
                self.assertNotIn(self.environment["PLAY_UPLOAD_STORE_PASSWORD"].encode(), result.stdout + result.stderr)

    def test_existing_output_and_signed_input_are_preserved(self):
        before = self.signed.read_bytes()
        self.assertNotEqual(self.invoke(self.source, self.signed).returncode, 0)
        self.assertEqual(self.signed.read_bytes(), before)
        target = self.directory / "resigned.aab"
        self.assertNotEqual(self.invoke(self.signed, target).returncode, 0)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
