#!/usr/bin/env python3
"""Offline package and explicit installation contracts; no SDK/device required."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('tizen_installer', ROOT / 'scripts/tizen-install.py')
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)
SDK_HOST = os.name == 'posix' and sys.platform in ('darwin', 'linux')
sdk_host_only = unittest.skipUnless(SDK_HOST, 'Only macOS/Linux support SDK operations; portable verification and rejection tests still run')


def sha(data):
    return hashlib.sha256(data).hexdigest()


FAKE_CLI = '''#!/usr/bin/env python3
import hashlib, json, pathlib, sys, zipfile
root=pathlib.Path(__file__).parent
args=sys.argv[1:]
with (root/'calls').open('a') as out: out.write(json.dumps(args)+'\\n')
mode=(root/'mode').read_text()
if mode=='exit-error': sys.exit(9)
if args[0]=='package':
    stage=pathlib.Path(args[args.index('--')+1])
    output=pathlib.Path(args[args.index('-o')+1])
    with zipfile.ZipFile(output/'SDK Package.wgt','w',compression=zipfile.ZIP_DEFLATED) as archive:
        for file in stage.rglob('*'):
            if file.is_file():
                data=file.read_bytes()
                if mode=='changed-payload' and file.name=='index.html': data+=b'changed'
                archive.writestr(file.relative_to(stage).as_posix(), data)
        if mode!='missing-signatures':
            signature=b'<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>'
            archive.writestr('author-signature.xml',signature)
            archive.writestr('signature1.xml',signature)
    if mode=='multiple': (output/'other.wgt').write_bytes(b'other')
elif args[0]=='install':
    if mode=='mutate-original':
        original=root/'signed'/'ottplay-foss-tizen-signed.wgt'
        expected=json.loads((root/'signed'/'ottplay-foss-tizen-signed.json').read_text())['signedSha256']
        original.write_bytes(b'changed by another build')
        actual=(pathlib.Path(args[args.index('--')+1])/args[args.index('-n')+1]).read_bytes()
        if hashlib.sha256(actual).hexdigest()!=expected: sys.exit(17)
    if mode=='false-success': print('error: certificate failure')
    elif mode=='ambiguous': print('Starting installation')
    else: print('install completed')
else: sys.exit(11)
'''


class TizenInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ottplay tizen test ')
        self.root = Path(self.temp.name)
        self.package = self.root / INSTALLER.UNSIGNED_NAME
        self.metadata = self.root / INSTALLER.METADATA_NAME
        self.checksum = self.root / INSTALLER.CHECKSUM_NAME
        self.cli = self.root / 'tizen'
        self.cli.write_text(FAKE_CLI)
        self.cli.chmod(0o700)
        self.mode('ok')
        self.identity = {'buildNumber': 10531, 'local': False, 'packageVersion': '1.1.62-beta.6',
                         'planSha256': 'b' * 64, 'releaseTag': 'v1.1.62-beta.6',
                         'source': 'a' * 40, 'tizenVersion': '1.0.10531'}
        self.files = {
            'index.html': b'<script>window.__OTTPLAY_TIZEN_PACKAGE__={schema:1};</script>',
            'icon.png': (ROOT / 'tizen/icon.png').read_bytes(),
            'config.xml': (ROOT / 'tizen/config.xml').read_bytes().replace(b'@TIZEN_VERSION@', b'1.0.10531'),
            'js/runtime-polyfills.js': b'/* polyfills */',
            'dist/player.js': b'/* classic player */',
            'dist/provider-fixture.js': b'/* provider */',
            'tizen-build-info.json': json.dumps(self.identity).encode(),
        }
        self.files['build-info.json'] = json.dumps({
            'revision': self.identity['source'], 'version': self.identity['packageVersion'],
            'bundleSha256': sha(self.files['dist/player.js']),
            'providerBundles': {'fixture': {'file': 'dist/provider-fixture.js',
                                           'sha256': sha(self.files['dist/provider-fixture.js'])}},
            'optionalBundles': {},
        }).encode()
        self.write_unsigned()

    def tearDown(self):
        self.temp.cleanup()

    def mode(self, value):
        (self.root / 'mode').write_text(value)

    def calls(self):
        file = self.root / 'calls'
        return [json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []

    def write_unsigned(self, data=None):
        data = INSTALLER.write_zip(self.files) if data is None else data
        self.package.write_bytes(data)
        self.meta = dict(self.identity, schema=1, appId=INSTALLER.APP_ID, packageId=INSTALLER.PACKAGE_ID,
                         profile=INSTALLER.PROFILE, requiredVersion=INSTALLER.REQUIRED_VERSION,
                         unsigned=True, bytes=len(data), sha256=sha(data),
                         installerSha256=sha((ROOT / 'scripts/tizen-install.py').read_bytes()),
                         entries=[{'path': name, 'bytes': len(value), 'sha256': sha(value)}
                                  for name, value in sorted(self.files.items())])
        self.metadata.write_text(json.dumps(self.meta))
        self.checksum.write_text(sha(data) + '  ' + INSTALLER.UNSIGNED_NAME + '\n')

    def verify(self):
        return INSTALLER.verify_unsigned(self.package, self.metadata, self.checksum)

    def sign(self, output=None):
        return INSTALLER.sign_package(self.package, self.metadata, self.checksum,
                                      output or self.root / 'signed', 'Profile with spaces', str(self.cli))

    def test_verify_is_offline_and_unsigned(self):
        meta, files = self.verify()
        self.assertTrue(meta['unsigned'])
        self.assertEqual(files, self.files)
        self.assertEqual(self.calls(), [])
        self.assertEqual(INSTALLER.write_zip(self.files), self.package.read_bytes())

    def test_portable_verifier_cli(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(ROOT / 'scripts/tizen-install.py'),
                                 '--package', str(self.package), '--metadata', str(self.metadata),
                                 '--checksum', str(self.checksum), 'verify'],
                                capture_output=True, text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['unsigned'])
        self.assertEqual(self.calls(), [])

    def test_unsupported_hosts_reject_sdk_work_but_allow_verification(self):
        for host in ('win32', 'freebsd13'):
            with self.subTest(host=host), mock.patch.object(INSTALLER.sys, 'platform', host):
                with mock.patch.object(INSTALLER.subprocess, 'run') as run:
                    with self.assertRaisesRegex(ValueError, 'macOS and Linux only'):
                        self.sign()
                    with self.assertRaisesRegex(ValueError, 'official Tizen Studio'):
                        INSTALLER.install_package(self.package, self.metadata, self.checksum,
                                                  self.root / 'signed', 'MyTV', str(self.cli))
                    self.verify()
                    run.assert_not_called()
        self.assertFalse((self.root / 'signed').exists())

    def test_sdk_failures_give_safe_actionable_guidance(self):
        result = subprocess.CompletedProcess(['tizen'], 9, 'private profile diagnostic', 'private stderr')
        with mock.patch.object(INSTALLER.subprocess, 'run', return_value=result):
            for operation, guidance in [('package', 'Certificate Manager'), ('install', 'Device Manager')]:
                with self.subTest(operation=operation), self.assertRaises(ValueError) as caught:
                    INSTALLER.run_tool(['tizen', operation])
                self.assertIn(guidance, str(caught.exception))
                self.assertNotIn('private', str(caught.exception))

    @sdk_host_only
    def test_signed_payload_is_checked_and_install_is_explicit(self):
        receipt = self.sign()
        self.assertEqual([call[0] for call in self.calls()], ['package'])
        self.assertEqual(receipt['unsignedSha256'], self.meta['sha256'])
        self.assertNotEqual(receipt['signedSha256'], receipt['unsignedSha256'])
        result = INSTALLER.install_package(self.package, self.metadata, self.checksum,
                                          self.root / 'signed', 'Living room TV', str(self.cli))
        self.assertTrue(result['installed'])
        self.assertEqual([call[0] for call in self.calls()], ['package', 'install'])
        self.assertIn('Living room TV', self.calls()[-1])
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.sign()

    @sdk_host_only
    def test_signer_may_not_modify_payload_or_omit_signatures(self):
        for mode in ('changed-payload', 'missing-signatures', 'multiple', 'exit-error'):
            with self.subTest(mode=mode):
                self.mode(mode)
                output = self.root / mode
                with self.assertRaises(ValueError):
                    self.sign(output)
                self.assertFalse(output.exists())
        self.assertTrue(all(call[0] == 'package' for call in self.calls()))

    @sdk_host_only
    def test_install_errors_are_not_reported_as_success(self):
        self.sign()
        for mode in ('exit-error', 'false-success', 'ambiguous'):
            with self.subTest(mode=mode):
                self.mode(mode)
                with self.assertRaises(ValueError):
                    INSTALLER.install_package(self.package, self.metadata, self.checksum,
                                              self.root / 'signed', 'MyTV', str(self.cli))

    @sdk_host_only
    def test_install_uses_verified_snapshot(self):
        self.sign()
        self.mode('mutate-original')
        result = INSTALLER.install_package(self.package, self.metadata, self.checksum,
                                          self.root / 'signed', 'MyTV', str(self.cli))
        self.assertTrue(result['installed'])
        self.assertEqual((self.root / 'signed' / INSTALLER.SIGNED_NAME).read_bytes(),
                         b'changed by another build')

    @sdk_host_only
    def test_stale_signed_receipt_is_rejected_before_sdk_call(self):
        self.sign()
        file = self.root / 'signed' / INSTALLER.RECEIPT_NAME
        receipt = json.loads(file.read_text())
        receipt['source'] = 'c' * 40
        file.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'receipt'):
            INSTALLER.install_package(self.package, self.metadata, self.checksum,
                                      self.root / 'signed', 'MyTV', str(self.cli))
        self.assertEqual(len(self.calls()), 1)

    def test_checksum_source_version_and_helper_mismatch(self):
        for key, value in [('sha256', 'c' * 64), ('source', 'c' * 40),
                           ('tizenVersion', '1.0.1'), ('installerSha256', 'c' * 64)]:
            with self.subTest(key=key):
                changed = dict(self.meta, **{key: value})
                self.metadata.write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    self.verify()
        self.metadata.write_text(json.dumps(self.meta))
        self.checksum.write_text('wrong')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.verify()

    def test_unsafe_archive_paths_and_links(self):
        for name, mode in [('../outside', 0o100644), ('/outside', 0o100644),
                           ('a\\b', 0o100644), ('link', stat.S_IFLNK | 0o777),
                           ('cert.p12', 0o100600), ('.env', 0o100600)]:
            with self.subTest(name=name):
                raw = io.BytesIO()
                with zipfile.ZipFile(raw, 'w') as archive:
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = mode << 16
                    archive.writestr(info, b'data')
                with self.assertRaises(ValueError):
                    INSTALLER.zip_files(raw.getvalue())

    def test_duplicate_casefolded_paths_and_size_cap(self):
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, 'w') as archive:
            archive.writestr('Player.js', 'one')
            archive.writestr('player.js', 'two')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            INSTALLER.zip_files(raw.getvalue())
        old = INSTALLER.MAX_UNPACKED
        try:
            INSTALLER.MAX_UNPACKED = 2
            with self.assertRaisesRegex(ValueError, 'size limit'):
                INSTALLER.zip_files(self.package.read_bytes())
        finally:
            INSTALLER.MAX_UNPACKED = old

    def test_changed_tv_privileges_are_rejected(self):
        self.files['config.xml'] = self.files['config.xml'].replace(b'tv.inputdevice', b'filesystem.write')
        self.write_unsigned()
        with self.assertRaisesRegex(ValueError, 'privileges'):
            self.verify()

    def test_numeric_version_rollovers(self):
        self.assertEqual(INSTALLER.version_for(10531), '1.0.10531')
        self.assertEqual(INSTALLER.version_for(65535), '1.0.65535')
        self.assertEqual(INSTALLER.version_for(65536), '1.1.0')
        self.assertEqual(INSTALLER.version_for(16777216), '2.0.0')
        with self.assertRaises(ValueError):
            INSTALLER.version_for(True)


if __name__ == '__main__':
    unittest.main()
