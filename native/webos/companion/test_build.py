import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

LOADER = importlib.util.spec_from_file_location("webos_companion_build", Path(__file__).with_name("build.py"))
build = importlib.util.module_from_spec(LOADER)
LOADER.loader.exec_module(build)


def executable(flags=0x5000200, interpreter=b"/lib/ld-linux.so.3\0", stack_flags=6):
    data = bytearray(256)
    data[:7] = b"\x7fELF\x01\x01\x01"
    struct.pack_into("<HHIIIIIHHHHHH", data, 16, 3, 40, 1, 0, 52, 0, flags, 52, 32, 2, 0, 0, 0)
    struct.pack_into("<IIIIIIII", data, 52, 3, 128, 0, 0, len(interpreter), len(interpreter), 4, 1)
    struct.pack_into("<IIIIIIII", data, 84, 0x6474E551, 0, 0, 0, 0, 0, stack_flags, 16)
    data[128:128 + len(interpreter)] = interpreter
    return data


REPORT = """
  0x00000001 (NEEDED) Shared library: [libc.so.6]
  0x00000001 (NEEDED) Shared library: [libgcc_s.so.1]
  Name: GLIBC_2.4
  Name: GLIBC_2.12
  Name: GCC_4.3.0
"""


class ElfTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.binary = Path(self.temp.name) / "companion"
        self.binary.write_bytes(executable())

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_arm_soft_float(self):
        result = build.inspect_elf(self.binary, REPORT)
        self.assertEqual(result["float_abi"], "soft")
        self.assertFalse(result["device_executed"])
        self.assertEqual(result["sha256"], build.sha(self.binary))

    def test_wrong_class_or_machine(self):
        for index, value in ((4, 2), (5, 2), (18, 62)):
            with self.subTest(index=index):
                data = executable()
                data[index] = value
                self.binary.write_bytes(data)
                with self.assertRaises(ValueError):
                    build.inspect_elf(self.binary, REPORT)

    def test_hard_float_or_wrong_eabi(self):
        for flags in (0x5000400, 0x5000600, 0x4000200, 0x5000000):
            with self.subTest(flags=flags):
                self.binary.write_bytes(executable(flags=flags))
                with self.assertRaisesRegex(ValueError, "soft-float"):
                    build.inspect_elf(self.binary, REPORT)

    def test_interpreter(self):
        self.binary.write_bytes(executable(interpreter=b"/lib/ld-linux-armhf.so.3\0"))
        with self.assertRaisesRegex(ValueError, "interpreter"):
            build.inspect_elf(self.binary, REPORT)

    def test_executable_stack(self):
        self.binary.write_bytes(executable(stack_flags=7))
        with self.assertRaisesRegex(ValueError, "stack"):
            build.inspect_elf(self.binary, REPORT)

    def test_missing_stack(self):
        data = executable()
        struct.pack_into("<I", data, 84, 0)
        self.binary.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "stack"):
            build.inspect_elf(self.binary, REPORT)

    def test_truncated_segment(self):
        data = executable()
        struct.pack_into("<I", data, 52 + 16, 9000)
        self.binary.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "outside"):
            build.inspect_elf(self.binary, REPORT)

    def test_unsupported_dynamic_requirements(self):
        reports = [REPORT + "Name: GLIBC_2.17", REPORT + "Name: GLIBC_PRIVATE",
                   REPORT + "Name: GCC_4.8.0", REPORT + " (NEEDED) [libssl.so.3]",
                   REPORT + " (RPATH) [/tmp/build]", REPORT + " (RUNPATH) [$ORIGIN]",
                   REPORT + " (TEXTREL) 0", REPORT + " GLOBAL DEFAULT UND getauxval@GLIBC_2.16"]
        for report in reports:
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    build.inspect_elf(self.binary, report)

    def test_unversioned_getauxval(self):
        with self.assertRaisesRegex(ValueError, "getauxval"):
            build.inspect_elf(self.binary, REPORT + " 9: GLOBAL DEFAULT UND getauxval\n")

    def test_missing_dynamic_evidence(self):
        with self.assertRaises(ValueError):
            build.inspect_elf(self.binary, "")


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        (self.root / "src").mkdir()
        (self.root / "src/code.rs").write_text("fn main() {}\n")
        (self.root / ".gitignore").write_text("src/cache/\n")
        (self.root / "src/cache").mkdir()
        (self.root / "src/cache/generated").write_text("not source")
        self.spec = {"source_roots": ["src"], "required_source_files": ["src/code.rs"]}

    def tearDown(self):
        self.temp.cleanup()

    def test_untracked_source_included_output_excluded(self):
        rows = build.source_inventory(self.root, self.spec)
        self.assertEqual([row["path"] for row in rows], ["src/code.rs"])

    def test_changed_source_changes_receipt(self):
        before = build.source_inventory(self.root, self.spec)
        (self.root / "src/code.rs").write_text("fn main() { panic!(); }")
        self.assertNotEqual(before, build.source_inventory(self.root, self.spec))

    def test_symlink_source_rejected(self):
        (self.root / "src/link.rs").symlink_to(self.root / "src/code.rs")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            build.source_inventory(self.root, self.spec)

    def test_missing_required_source_rejected(self):
        (self.root / "src/code.rs").unlink()
        with self.assertRaisesRegex(ValueError, "Required"):
            build.source_inventory(self.root, self.spec)

    def test_stable_local_archive_and_source_paths(self):
        rows = build.source_inventory(self.root, self.spec)
        source = {"local_inputs": rows, "complete_corresponding_source": False}
        with patch.object(build, "assert_sources"):
            for name in ("one.tgz", "two.tgz"):
                build.local_source_archive(self.root / name, source, self.root)
        self.assertEqual(build.sha(self.root / "one.tgz"), build.sha(self.root / "two.tgz"))
        with tarfile.open(self.root / "one.tgz") as archive:
            self.assertEqual(archive.getnames(), ["source/src/code.rs", "source-receipt.json"])
            self.assertEqual(archive.getmember("source/src/code.rs").mtime, 0)
            self.assertFalse(json.load(archive.extractfile("source-receipt.json"))["complete_corresponding_source"])

    def test_archive_rejects_changed_source_bytes(self):
        source = {"local_inputs": build.source_inventory(self.root, self.spec)}
        (self.root / "src/code.rs").write_text("changed")
        with patch.object(build, "assert_sources"), self.assertRaisesRegex(ValueError, "changed"):
            build.local_source_archive(self.root / "bad.tgz", source, self.root)
        self.assertFalse((self.root / "bad.tgz").exists())

    def test_unsafe_paths(self):
        for path in ("../escape", "/absolute", "a/../../b", "a\\b", ""):
            with self.subTest(path=path), self.assertRaises(ValueError):
                build.safe_relative(path)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "ottplay-companion").write_bytes(executable())
        (self.root / "source-receipt.json").write_text('{"local_inputs": []}')
        (self.root / "local-source.tar.gz").write_bytes(b"local source")
        (self.root / "ottplay-companion.link.map").write_text("normal linker evidence")
        self.receipt = {
            "manifest_sha256": build.sha(build.HERE / "manifest.json"),
            "source_receipt_sha256": build.sha(self.root / "source-receipt.json"),
            "local_source_archive_sha256": build.sha(self.root / "local-source.tar.gz"),
            "link_map_sha256": build.sha(self.root / "ottplay-companion.link.map"),
            "elf": build.inspect_elf(self.root / "ottplay-companion", REPORT)}
        self.save()

    def save(self):
        (self.root / "receipt.json").write_bytes(build.canonical(self.receipt))

    def tearDown(self):
        self.temp.cleanup()

    def check(self):
        with patch.object(build, "assert_sources"), patch.object(build, "elf_report", return_value=REPORT):
            return build.checked_bundle(self.root, Path("readelf"))

    def test_valid_receipt(self):
        self.assertEqual(self.check()[0], self.receipt)

    def test_changed_binary_rejected(self):
        with (self.root / "ottplay-companion").open("ab") as stream:
            stream.write(b"changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.check()

    def test_changed_source_receipt_rejected(self):
        (self.root / "source-receipt.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.check()

    def test_changed_source_archive_rejected(self):
        (self.root / "local-source.tar.gz").write_text("changed")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.check()

    def test_polyfill_rejected_even_with_updated_checksum(self):
        (self.root / "ottplay-companion.link.map").write_text("/sdk/libglibc_polyfills.a(member.o)")
        self.receipt["link_map_sha256"] = build.sha(self.root / "ottplay-companion.link.map")
        self.save()
        with self.assertRaisesRegex(ValueError, "polyfills"):
            self.check()

    def test_staging_installs_only_binary_and_public_metadata(self):
        source = {"local_inputs_sha256": "source-hash"}
        destination = self.root / "ipk"
        args = SimpleNamespace(bundle=self.root, readelf=Path("readelf"), destination=destination)
        with patch.object(build, "checked_bundle", return_value=(self.receipt, source)), \
                patch.object(build, "assert_sources"), patch("builtins.print"):
            build.stage(args)
        binary = destination / "bin/ottplay-companion"
        self.assertEqual(binary.stat().st_mode & 0o777, 0o755)
        self.assertEqual(build.sha(binary), self.receipt["elf"]["sha256"])
        self.assertTrue((destination / "companion/licenses/LICENSE").is_file())
        self.assertFalse(list(destination.rglob("*.link.map")))
        self.assertFalse(list(destination.rglob("*.tar.gz")))
        with patch.object(build, "checked_bundle", return_value=(self.receipt, source)), \
                self.assertRaisesRegex(ValueError, "already staged"):
            build.stage(args)

    def test_staging_refuses_symlink_install_parent(self):
        destination = self.root / "ipk"
        destination.mkdir()
        (destination / "bin").symlink_to(self.root, target_is_directory=True)
        args = SimpleNamespace(bundle=self.root, readelf=Path("readelf"), destination=destination)
        with patch.object(build, "checked_bundle", return_value=(self.receipt, {})), \
                self.assertRaisesRegex(ValueError, "already staged|symlink"):
            build.stage(args)


if __name__ == "__main__":
    unittest.main()
