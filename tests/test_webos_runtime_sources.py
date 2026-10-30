"""Runtime source evidence must remain bound to the final native package."""

import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/webos-runtime-sources.py"
SPEC = importlib.util.spec_from_file_location("runtime_sources", SCRIPT)
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


class RuntimeSourceTests(unittest.TestCase):
    def test_glibc_and_gcc_members_have_source_owners(self):
        rows = runtime.runtime_inputs(
            "/sdk/usr/lib/libc_nonshared.a(elf-init.oS)\n/sdk/lib/libgcc.a(_muldi3.o)\n"
            "LOAD /sdk/usr/lib/crt1.o\nLOAD /sdk/lib/crtbegin.o\n",
            Path("/app"),
            Path("/sdk"),
        )
        self.assertEqual({r["source"] for r in rows}, {"gcc-runtime", "glibc-runtime"})
        self.assertEqual(len(rows), 4)

    def test_unknown_static_sdk_code_requires_review(self):
        with self.assertRaisesRegex(ValueError, "Unclassified static SDK"):
            runtime.runtime_inputs("/sdk/usr/lib/libunknown.a(runtime.o)", Path("/app"), Path("/sdk"))

    def test_unknown_static_sdk_object_requires_review(self):
        with self.assertRaisesRegex(ValueError, "Unclassified static SDK object"):
            runtime.runtime_inputs("LOAD /sdk/usr/lib/unreviewed.o", Path("/app"), Path("/sdk"))

    def test_shared_startup_object_is_identified(self):
        rows = runtime.runtime_inputs("LOAD /sdk/usr/lib/Scrt1.o", Path("/app"), Path("/sdk"))
        self.assertEqual(rows[0]["source"], "glibc-runtime")
        self.assertEqual(rows[0]["sdk_path"], "usr/lib/Scrt1.o")

    def test_linked_runtime_must_match_pinned_sdk_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sdk = root / "sdk"
            (sdk / "lib").mkdir(parents=True)
            (sdk / "lib/libgcc.a").write_bytes(b"expected runtime")
            archive = root / "sdk.tar.bz2"
            with tarfile.open(archive, "w:bz2") as output:
                member = tarfile.TarInfo("sdk/lib/libgcc.a")
                member.size = len(b"expected runtime")
                output.addfile(member, io.BytesIO(b"expected runtime"))
            spec = {
                "sdk": {"directory": "sdk", "version": "test", "assets": {"test": {"sha256": runtime.digest(archive)}}}
            }
            source = root / "source/ci/ottplay-integration"
            source.mkdir(parents=True)
            (source / "upstream.json").write_text(json.dumps(spec))
            args = SimpleNamespace(source=root / "source", sdk=sdk, sdk_archive=archive)
            evidence = {"player": {"runtime_inputs": [{"sdk_path": "lib/libgcc.a"}]}}
            result = runtime.attest_sdk(args, evidence)
            self.assertEqual(result["runtime_archive_match"], "PASS")
            (sdk / "lib/libgcc.a").write_bytes(b"another runtime")
            with self.assertRaisesRegex(ValueError, "differs from pinned archive"):
                runtime.attest_sdk(args, evidence)

    def test_cached_source_cannot_have_another_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "source.tar.gz").write_bytes(b"modified")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                runtime.fetch({"file": "source.tar.gz", "sha256": "0" * 64}, path)

    def evidence(self, directory, binary=b"\x7fELFfixture"):
        root = Path(directory)
        base = root / "pkg/link-evidence/stable/player"
        base.parent.mkdir(parents=True)
        link_map = b"LOAD /sdk/usr/lib/crt1.o\n/sdk/usr/lib/libc_nonshared.a(elf-init.oS)\n"
        trace = b"/sdk/usr/lib/crt1.o\n"
        record = {
            "elf_sha256": hashlib.sha256(binary).hexdigest(),
            "map_sha256": hashlib.sha256(link_map).hexdigest(),
            "trace_sha256": hashlib.sha256(trace).hexdigest(),
            "archive_excluded": True,
        }
        Path(str(base) + ".link.map").write_bytes(link_map)
        Path(str(base) + ".link.trace").write_bytes(trace)
        Path(str(base) + ".link.json").write_text(json.dumps(record))
        return root, binary

    def test_elf_changed_after_link_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _ = self.evidence(directory)
            with self.assertRaisesRegex(ValueError, "differs from shipped ELF"):
                runtime.link_evidence({"player": b"\x7fELFother"}, root, Path("/sdk"))

    def test_unknown_dynamic_dependency_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root, binary = self.evidence(directory)
            with (
                patch.object(
                    runtime.subprocess, "check_output", side_effect=["(NEEDED) Shared library: [libunknown.so.1]", ""]
                ),
                self.assertRaisesRegex(ValueError, "Unclassified runtime shared"),
            ):
                runtime.link_evidence({"player": binary}, root, Path("/sdk"))

    def test_known_runtime_evidence_retains_original_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root, binary = self.evidence(directory)
            with patch.object(
                runtime.subprocess,
                "check_output",
                side_effect=[
                    "(NEEDED) Shared library: [libc.so.6]",
                    "[Requesting program interpreter: /lib/ld-linux.so.3]",
                ],
            ):
                result, files, system = runtime.link_evidence({"player": binary}, root, Path("/sdk"))
            self.assertEqual(system, ["libc.so.6"])
            self.assertEqual(result["player"]["elf_sha256"], hashlib.sha256(binary).hexdigest())
            self.assertIn(b"/build/webos-sdk/", files["evidence/player.link.map"])

    def test_source_set_binds_both_archives_and_includes_reusable_collector(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = root / "native.json"
            (root / "native.ipk").write_bytes(b"fixture IPK")
            (root / "primary.tar.gz").write_bytes(b"fixture primary source")
            metadata.write_text(
                json.dumps(
                    {
                        "sha256": runtime.digest(root / "native.ipk"),
                        "build": {"tree": "fixture"},
                        "corresponding_source": {
                            "file": "primary.tar.gz",
                            "sha256": runtime.digest(root / "primary.tar.gz"),
                            "snapshot_sha256": "fixture",
                        },
                    }
                )
            )
            source = root / "dependency.tar.gz"
            with tarfile.open(source, "w:gz") as archive:
                member = tarfile.TarInfo("dependency/COPYING")
                member.size = len(b"fixture license")
                archive.addfile(member, io.BytesIO(b"fixture license"))
            spec = root / "inputs.json"
            spec.write_text(
                json.dumps(
                    {
                        "sdk_recipe_reference": {"revision": "fixture"},
                        "inputs": [
                            {
                                "id": "runtime",
                                "file": source.name,
                                "sha256": runtime.digest(source),
                                "licenses": ["COPYING"],
                            }
                        ],
                    }
                )
            )
            args = SimpleNamespace(metadata=metadata, source=root, sdk=root, cache=root)
            with (
                patch.object(runtime, "MANIFEST", spec),
                patch.object(runtime, "package_elfs", return_value={}),
                patch.object(runtime, "link_evidence", return_value=({}, {}, [])),
                patch.object(runtime, "attest_sdk", return_value={}),
                patch("builtins.print"),
            ):
                runtime.collect(args)
            receipt = json.loads((root / "native-source-set.json").read_text())
            self.assertEqual(len(receipt["source_archives"]), 2)
            self.assertEqual(receipt["ipk"]["sha256"], runtime.digest(root / "native.ipk"))
            with tarfile.open(root / "native-runtime-source.tar.gz") as archive:
                self.assertIn("tools/webos-runtime-sources.README.txt", archive.getnames())
                manifest = json.load(archive.extractfile("RUNTIME-SOURCE-MANIFEST.json"))
                self.assertEqual(manifest["sdk_recipe_reference"]["revision"], "fixture")


if __name__ == "__main__":
    unittest.main()
