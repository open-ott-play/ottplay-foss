#!/usr/bin/env python3
"""Negative AAB fixtures decoded by the actual official bundletool, not a mock.

Only the tiny fixture encoder is local. Field numbers follow AOSP Resources.proto:
https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Resources.proto
Run with BUNDLETOOL_JAR set; this test does not install tools or use the network.
"""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "aab_manifest", ROOT / "scripts/android/verify-bundle-manifest.py"
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
NS = "http://schemas.android.com/apk/res/android"


def varint(value):
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(number, value):
    if isinstance(value, str):
        value = value.encode()
    return varint(number << 3 | 2) + varint(len(value)) + value


def integer(number, value):
    return varint(number << 3) + varint(value)


def attribute(name, value, namespace="", primitive=None):
    # XmlAttribute: namespace_uri=1,name=2,value=3,compiled_item=6;
    # Item.prim=7; Primitive int_decimal_value=6,boolean_value=8.
    data = field(1, namespace) + field(2, name)
    if value is not None:
        data += field(3, value)
    if primitive is not None:
        number, compiled_value = primitive
        data += field(6, field(7, integer(number, compiled_value)))
    return data


def element(name, attrs=(), children=(), root=False):
    data = field(3, name)
    if root:
        data += field(1, field(1, "android") + field(2, NS))
    data += b"".join(field(4, item) for item in attrs)
    data += b"".join(field(5, item) for item in children)
    return field(1, data)  # XmlNode.element


def manifest(package="play.ott.foss.play", version=10141, debug=False,
             permission=None, compiled=False, app_count=1, version_major=None):
    attrs = [attribute("package", package)]
    attrs.append(attribute("versionCode", None if compiled else str(version), NS,
                           (6, version) if compiled else None))
    if version_major is not None:
        attrs.append(attribute("versionCodeMajor", str(version_major), NS))
    app_attrs = [attribute("label", "OTT-play FOSS", NS)]
    if debug is not None:
        app_attrs.append(attribute("debuggable", None if compiled else str(debug).lower(), NS,
                                   (8, int(debug)) if compiled else None))
    children = [element("application", app_attrs) for _ in range(app_count)]
    if permission:
        tag, name = permission
        children.append(element(tag, [attribute("name", name, NS)]))
    return element("manifest", attrs, children, root=True)


class BundleManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        gate.tool_command()  # Fail clearly rather than skip the real decoder tests.

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aab-manifest-test-")
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name) / "fixture.aab"

    def write_bundle(self, base, feature=None, duplicate=False):
        with zipfile.ZipFile(self.bundle, "w") as archive:
            archive.writestr("BundleConfig.pb", b"")
            archive.writestr("base/manifest/AndroidManifest.xml", base)
            # Deliberately forged Play metadata cannot override the native manifest.
            archive.writestr("base/assets/public/android-distribution.json", json.dumps({
                "applicationId": "play.ott.foss.play", "distribution": "play"
            }))
            if feature is not None:
                archive.writestr("feature/manifest/AndroidManifest.xml", feature)
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr("base/manifest/AndroidManifest.xml", manifest())

    def verify(self, flavor="play"):
        return gate.verify_bundle(self.bundle, flavor, 10141)

    def test_release_passes_raw_and_compiled_attributes(self):
        for compiled in (False, True):
            with self.subTest(compiled=compiled):
                self.write_bundle(manifest(compiled=compiled))
                result = self.verify()
                self.assertTrue(result["ok"])
                self.assertEqual(result["modules"][0]["package"], "play.ott.foss.play")
                self.assertEqual(result["modules"][0]["versionCode"], "10141")

    def test_android_default_debuggable_is_false(self):
        self.write_bundle(manifest(debug=None))
        self.assertTrue(self.verify()["ok"])

    def test_full_native_package_rejected_despite_forged_play_assets(self):
        self.write_bundle(manifest(package="play.ott.foss"))
        with self.assertRaisesRegex(ValueError, "Native package mismatch"):
            self.verify()
        self.assertTrue(self.verify("full")["ok"])

    def test_debuggable_release_rejected_in_raw_and_compiled_forms(self):
        for compiled in (False, True):
            with self.subTest(compiled=compiled):
                self.write_bundle(manifest(debug=True, compiled=compiled))
                with self.assertRaisesRegex(ValueError, "debuggable"):
                    self.verify()

    def test_wrong_version_and_nonzero_major_rejected(self):
        for content in (manifest(version=10140), manifest(version_major=1)):
            self.write_bundle(content)
            with self.assertRaisesRegex(ValueError, "versionCode"):
                self.verify()

    def test_forbidden_permissions_rejected_in_both_declaration_forms(self):
        for permission in sorted(gate.FORBIDDEN_PERMISSIONS):
            for tag in ("uses-permission", "uses-permission-sdk-23"):
                with self.subTest(permission=permission, tag=tag):
                    self.write_bundle(manifest(permission=(tag, permission)))
                    with self.assertRaisesRegex(ValueError, "Forbidden native permissions"):
                        self.verify()

    def test_feature_manifest_cannot_hide_forbidden_permissions(self):
        feature = manifest(permission=("uses-permission", "android.permission.QUERY_ALL_PACKAGES"))
        self.write_bundle(manifest(), feature=feature)
        with self.assertRaisesRegex(ValueError, "Forbidden native permissions in feature"):
            self.verify()

    def test_missing_or_duplicate_application_rejected(self):
        for count in (0, 2):
            self.write_bundle(manifest(app_count=count))
            with self.assertRaisesRegex(ValueError, "application"):
                self.verify()

    def test_duplicate_manifest_rejected_before_bundletool(self):
        self.write_bundle(manifest(package="play.ott.foss"), duplicate=True)
        with self.assertRaisesRegex(ValueError, "Duplicate bundle entry"):
            self.verify()

    def test_truncated_protobuf_rejected(self):
        self.write_bundle(manifest()[:-1])
        with self.assertRaisesRegex(ValueError, "bundletool could not decode"):
            self.verify()

    def test_missing_base_manifest_rejected(self):
        with zipfile.ZipFile(self.bundle, "w") as archive:
            archive.writestr("base/assets/public/android-distribution.json", "{}")
        with self.assertRaisesRegex(ValueError, "no base compiled"):
            self.verify()

    def test_version_code_follows_package(self):
        major, minor, patch = map(int, json.loads((ROOT / "package.json").read_text())["version"].split("."))
        self.assertEqual(gate.package_version_code(), major * 10000 + minor * 100 + patch)


if __name__ == "__main__":
    unittest.main()
