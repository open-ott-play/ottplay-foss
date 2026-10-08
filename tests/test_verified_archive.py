"""Exercise download integrity without accessing the network or installing tools."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    "verified_archive", Path(__file__).resolve().parents[1] / "scripts/download-verified-archive.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
URL = "https://registry.npmjs.org/example.tgz"


class Response(io.BytesIO):
    def geturl(self):
        return URL


class ArchiveTest(unittest.TestCase):
    def test_exact_content_survives(self):
        data = b"a" * 70000
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "archive"
            with mock.patch.object(MODULE, "open_archive", return_value=Response(data)):
                MODULE.download(URL, target, len(data), hashlib.sha512(data).hexdigest())
            self.assertEqual(target.read_bytes(), data)

    def test_wrong_hash_truncation_and_overflow_are_removed(self):
        expected = b"trusted archive"
        for data in [b"changed archive", expected[:-1], expected + b"x"]:
            with self.subTest(data=data), tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / "archive"
                with mock.patch.object(MODULE, "open_archive", return_value=Response(data)):
                    with self.assertRaises(ValueError):
                        MODULE.download(URL, target, len(expected), hashlib.sha512(expected).hexdigest())
                self.assertFalse(target.exists())

    def test_download_failure_and_insecure_redirect_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "archive"
            with mock.patch.object(MODULE, "open_archive", side_effect=OSError("offline")):
                with self.assertRaises(OSError):
                    MODULE.download(URL, target, 1, "0" * 128)
            self.assertFalse(target.exists())
            with mock.patch.object(Response, "geturl", return_value="http://example.invalid/archive"):
                with mock.patch.object(MODULE, "open_archive", return_value=Response(b"x")):
                    with self.assertRaises(ValueError):
                        MODULE.download(URL, target, 1, hashlib.sha512(b"x").hexdigest())
            self.assertFalse(target.exists())

    def test_http_redirect_is_rejected_before_fetch(self):
        handler = MODULE.HTTPSRedirectHandler()
        with self.assertRaises(ValueError):
            handler.redirect_request(
                MODULE.urllib.request.Request(URL), None, 302, "Found", {},
                "http://example.invalid/archive",
            )

    def test_existing_target_and_invalid_parameters_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "archive"
            target.write_bytes(b"keep")
            with mock.patch.object(MODULE, "open_archive") as fetch:
                with self.assertRaises(FileExistsError):
                    MODULE.download(URL, target, 1, "0" * 128)
                for url, size, digest in [("http://example.invalid", 1, "0" * 128), (URL, 0, "0" * 128), (URL, 1, "bad")]:
                    with self.assertRaises(ValueError):
                        MODULE.download(url, target, size, digest)
                fetch.assert_not_called()
            self.assertEqual(target.read_bytes(), b"keep")


if __name__ == "__main__":
    unittest.main()
