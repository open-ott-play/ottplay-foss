"""Offline safety/ABI tests; no compiler, downloads, or native media execution."""

import copy
import hashlib
import importlib.util
import io
import json
import ssl
import tarfile
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import call, patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("playback_builder", ROOT / "scripts/build-linux-playback-compat.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)
CONFIG = json.loads((Path(__file__).parent / "sources.json").read_text())


class DownloadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.destination = self.directory / "output"
        self.destination.write_bytes(b"previous verified bytes")
        self.item = {"name": "input", "size": 4, "sha256": hashlib.sha256(b"good").hexdigest(),
                     "url": "https://ports.ubuntu.com/ubuntu-ports/pool/main/example"}

    def response(self, data=b"good", url=None):
        response = io.BytesIO(data)
        response.url = url or self.item["url"]
        response.read = unittest.mock.Mock(wraps=response.read)
        return response

    def test_initial_success_keeps_exact_request_and_read_bound(self):
        response = self.response()
        with patch.object(BUILDER.urllib.request, "urlopen", return_value=response) as request, \
                patch.object(BUILDER.time, "sleep") as sleep:
            BUILDER.fetch(self.item, self.destination)
        request.assert_called_once_with(self.item["url"], timeout=60)
        response.read.assert_called_once_with(5)
        self.assertTrue(response.closed)
        sleep.assert_not_called()
        self.assertEqual(self.destination.read_bytes(), b"good")
        self.assertEqual(list(self.directory.iterdir()), [self.destination])

    def test_transient_connect_and_server_errors_retry_same_request(self):
        failures = [TimeoutError("connect"), ConnectionResetError("reset"),
                    urllib.error.URLError(TimeoutError("wrapped connect"))]
        failures.extend(urllib.error.HTTPError(self.item["url"], code, "temporary", {}, io.BytesIO())
                        for code in (500, 502, 503, 504))
        for failure in failures:
            with self.subTest(failure=failure), \
                    patch.object(BUILDER.urllib.request, "urlopen", side_effect=[failure, self.response()]) as request, \
                    patch.object(BUILDER.time, "sleep") as sleep:
                BUILDER.fetch(self.item, self.destination)
                self.assertEqual(request.call_args_list, [call(self.item["url"], timeout=60)] * 2)
                sleep.assert_called_once_with(1)
                self.assertEqual(self.destination.read_bytes(), b"good")

    def test_read_timeout_discards_partial_attempt_and_closes_response(self):
        failed = self.response()
        failed.read.side_effect = TimeoutError("read")
        with patch.object(BUILDER.urllib.request, "urlopen", side_effect=[failed, self.response()]) as request, \
                patch.object(BUILDER.time, "sleep") as sleep:
            BUILDER.fetch(self.item, self.destination)
        self.assertTrue(failed.closed)
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertEqual(self.destination.read_bytes(), b"good")

    def test_exhaustion_is_bounded_and_leaves_destination_unchanged(self):
        failure = urllib.error.URLError(TimeoutError("connect"))
        with patch.object(BUILDER.urllib.request, "urlopen", side_effect=failure) as request, \
                patch.object(BUILDER.time, "sleep") as sleep, \
                self.assertRaises(urllib.error.URLError) as raised:
            BUILDER.fetch(self.item, self.destination)
        self.assertIs(raised.exception, failure)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(2)])
        self.assertEqual(self.destination.read_bytes(), b"previous verified bytes")

    def test_nontransient_and_tls_failures_are_not_retried(self):
        failures = [ssl.SSLError("TLS"), urllib.error.URLError(ssl.SSLCertVerificationError("certificate")),
                    urllib.error.URLError("DNS failure"),
                    urllib.error.HTTPError("https://example.invalid/redirect", 503, "temporary", {}, io.BytesIO())]
        failures.extend(urllib.error.HTTPError(self.item["url"], code, "terminal", {}, io.BytesIO())
                        for code in (401, 404, 429, 501))
        for failure in failures:
            with self.subTest(failure=failure), \
                    patch.object(BUILDER.urllib.request, "urlopen", side_effect=failure) as request, \
                    patch.object(BUILDER.time, "sleep") as sleep, self.assertRaises(type(failure)):
                BUILDER.fetch(self.item, self.destination)
            request.assert_called_once()
            sleep.assert_not_called()
            self.assertEqual(self.destination.read_bytes(), b"previous verified bytes")

    def test_integrity_or_redirect_failure_after_retry_is_terminal(self):
        for response in (self.response(b"bad"), self.response(b"evil"), self.response(b"toolong"),
                         self.response(url="https://example.invalid/redirect")):
            with patch.object(BUILDER.urllib.request, "urlopen", side_effect=[TimeoutError(), response]) as request, \
                    patch.object(BUILDER.time, "sleep") as sleep, self.assertRaises(ValueError):
                BUILDER.fetch(self.item, self.destination)
            self.assertEqual(request.call_count, 2)
            sleep.assert_called_once_with(1)
            self.assertTrue(response.closed)
            self.assertEqual(self.destination.read_bytes(), b"previous verified bytes")

    def test_cache_never_opens_network_or_retries(self):
        with patch.object(BUILDER.urllib.request, "urlopen") as request, patch.object(BUILDER.time, "sleep") as sleep:
            cached = self.directory / self.item["name"]
            cached.write_bytes(b"good")
            BUILDER.fetch(self.item, self.destination, self.directory)
            cached.write_bytes(b"evil")
            with self.assertRaises(ValueError):
                BUILDER.fetch(self.item, self.destination, self.directory)
        request.assert_not_called()
        sleep.assert_not_called()
        self.assertEqual(self.destination.read_bytes(), b"good")

    def test_failed_atomic_publish_preserves_previous_file_and_removes_staging(self):
        with patch.object(BUILDER.urllib.request, "urlopen", return_value=self.response()), \
                patch.object(Path, "replace", side_effect=OSError("rename failed")), self.assertRaises(OSError):
            BUILDER.fetch(self.item, self.destination)
        self.assertEqual(self.destination.read_bytes(), b"previous verified bytes")
        self.assertEqual(list(self.directory.iterdir()), [self.destination])


class BuilderTests(unittest.TestCase):
    def test_known_architectures_require_exact_host_bytes(self):
        for machine, entry in CONFIG["architectures"].items():
            with self.subTest(machine=machine):
                args = (CONFIG, {"ID": "ubuntu", "VERSION_ID": "24.04"}, machine,
                        CONFIG["source_package_version"])
                BUILDER.validate_host(*args, entry["original_plugin_sha256"])
                with self.assertRaisesRegex(ValueError, "differs"):
                    BUILDER.validate_host(*args, "0" * 64)

    def test_newer_or_foreign_host_cannot_receive_stale_override(self):
        args = [CONFIG, {"ID": "ubuntu", "VERSION_ID": "24.04"}, "aarch64",
                CONFIG["source_package_version"], CONFIG["architectures"]["aarch64"]["original_plugin_sha256"]]
        for index, value in [(1, {"ID": "ubuntu", "VERSION_ID": "26.04"}),
                             (1, {"ID": "debian", "VERSION_ID": "24.04"}),
                             (2, "armv7l"), (3, "1.24.2-1ubuntu0.6")]:
            with self.subTest(index=index, value=value):
                changed = copy.deepcopy(args)
                changed[index] = value
                with self.assertRaises(ValueError):
                    BUILDER.validate_host(*changed)

    def test_cache_requires_size_and_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "input").write_bytes(b"good")
            item = {"name": "input", "size": 4, "sha256": hashlib.sha256(b"good").hexdigest(),
                    "url": "https://ports.ubuntu.com/ubuntu-ports/pool/main/example"}
            BUILDER.fetch(item, directory / "output", directory)
            self.assertEqual((directory / "output").read_bytes(), b"good")
            for bad in (b"evil", b"toolong"):
                (directory / "input").write_bytes(bad)
                with self.assertRaises(ValueError):
                    BUILDER.fetch(item, directory / "output", directory)

    def test_archive_rejects_escape_and_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, kind in [("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                               ("link", tarfile.SYMTYPE)]:
                with self.subTest(name=name):
                    archive = directory / "input.tar.xz"
                    with tarfile.open(archive, "w:xz") as output:
                        member = tarfile.TarInfo(name)
                        member.type = kind
                        member.linkname = "../../escape"
                        output.addfile(member, io.BytesIO(b""))
                    with self.assertRaises(ValueError):
                        BUILDER.extract_source(archive, directory / "source")

    def test_abi_and_hardening_fail_closed(self):
        original = {"class": "ELF64", "machine": "AArch64", "needed": ["libc.so.6"],
                    "soname": [], "exports": ["gst_plugin_playback_get_desc"],
                    "glibc_versions": ["GLIBC_2.17"], "bind_now": True,
                    "relro": True, "has_rpath": False}
        BUILDER.validate_elf(original, original, "AArch64")
        for key, value in [("bind_now", False), ("relro", False), ("has_rpath", True),
                           ("needed", ["libnew.so"]), ("exports", []), ("machine", "x86"),
                           ("glibc_versions", ["GLIBC_2.38"])]:
            with self.subTest(key=key):
                changed = dict(original, **{key: value})
                with self.assertRaises(ValueError):
                    BUILDER.validate_elf(original, changed, "AArch64")

    def test_corresponding_source_archive_is_reproducible(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / "recipe.py"
            source.write_text("# full recipe\n")
            files = {"scripts/recipe.py": source}
            BUILDER.source_archive(directory / "first.tar.xz", files)
            BUILDER.source_archive(directory / "second.tar.xz", files)
            self.assertEqual(BUILDER.sha(directory / "first.tar.xz"), BUILDER.sha(directory / "second.tar.xz"))
            with tarfile.open(directory / "first.tar.xz") as archive:
                self.assertEqual(archive.extractfile("linux-playback-compat/scripts/recipe.py").read(),
                                 source.read_bytes())

    def test_only_known_real_development_directory_is_excluded(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            plugin = directory / "libgstplayback.so"
            plugin.write_bytes(b"runtime")
            headers = directory / "include"
            headers.mkdir()
            (headers / "header.h").write_text("/* development only */")
            self.assertEqual(BUILDER.plugin_inventory(directory),
                             {plugin.name: BUILDER.sha(plugin)})
            unknown = directory / "unexpected"
            unknown.mkdir()
            with self.assertRaisesRegex(ValueError, "entry: unexpected"):
                BUILDER.plugin_inventory(directory)
            unknown.rmdir()
            linked = directory / "linked.so"
            linked.symlink_to(plugin)
            with self.assertRaisesRegex(ValueError, "Linked.*linked.so"):
                BUILDER.plugin_inventory(directory)
            linked.unlink()
            (headers / "header.h").unlink()
            headers.rmdir()
            headers.symlink_to(directory, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "Linked.*include"):
                BUILDER.plugin_inventory(directory)
            headers.unlink()
            headers.write_text("not a directory")
            with self.assertRaisesRegex(ValueError, "development entry: include"):
                BUILDER.plugin_inventory(directory)

    def test_regression_requires_both_completion_and_segment_acceptance(self):
        passed = {"variant": "patched", "audio_segment_blocked": False,
                  "expected_blocked": False, "audio_segment_accepted": True,
                  "released_for_cleanup": False}
        BUILDER.validate_regression(passed)
        for key, value in [("variant", "unpatched"), ("audio_segment_blocked", True),
                           ("audio_segment_accepted", False), ("released_for_cleanup", True)]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "did not complete"):
                BUILDER.validate_regression(dict(passed, **{key: value}))


if __name__ == "__main__":
    unittest.main()
