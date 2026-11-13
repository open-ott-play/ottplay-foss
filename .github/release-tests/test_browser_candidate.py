"""Candidate bytes, source identity and reusable browser-gate regression checks."""
import copy
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
SPEC = importlib.util.spec_from_file_location('candidate', ROOT / 'scripts/prepare_browser_candidate.py')
CANDIDATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CANDIDATE)
SHA = 'a' * 40


class CandidateTests(unittest.TestCase):
    def test_rejects_limits_before_scanning_the_remaining_archive(self):
        class GuardedArchive:
            def __init__(self, count, size):
                self.count, self.size, self.visited = count, size, 0

            def __iter__(self):
                for index in range(self.count):
                    self.visited += 1
                    item = tarfile.TarInfo(f'entry-{index}')
                    item.size = self.size
                    yield item
                raise AssertionError('Scanned past the first over-limit member')

            def getmembers(self):
                return list(self)

        for count, size in [(10_001, 0), (2, CANDIDATE.MAX_UNPACKED_BYTES), (1, -1)]:
            with self.subTest(count=count, size=size):
                archive = GuardedArchive(count, size)
                with self.assertRaisesRegex(ValueError, 'invalid unpacked size'):
                    CANDIDATE.archive_files(archive)
                self.assertEqual(archive.visited, count)

    def setUp(self):
        self.enterContext(patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.artifacts = self.root / 'artifacts'
        self.artifacts.mkdir()
        self.payload = {'index.html': b'<html>Player</html>', 'dist/player.js': b'player()',
                        'dist/provider-plex.js': b'plex()', 'devices/pc2/device.js': b'pc2()'}
        self.metadata = {'revision': SHA, 'version': '1.2.3',
                         'bundleSha256': hashlib.sha256(self.payload['dist/player.js']).hexdigest(),
                         'providerBundles': {'plex': {'file': 'dist/provider-plex.js',
                             'sha256': hashlib.sha256(self.payload['dist/provider-plex.js']).hexdigest()}}}

    def archive(self, extra=None):
        payload = {**self.payload, 'build-info.json': json.dumps(self.metadata).encode()}
        archive = self.artifacts / 'ottplay-foss-modea.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            for name, data in payload.items():
                item = tarfile.TarInfo('./' + name)
                item.size = len(data)
                bundle.addfile(item, io.BytesIO(data))
            if extra:
                bundle.addfile(extra, io.BytesIO(b'x') if extra.isfile() else None)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        (self.artifacts / 'ottplay-foss-modea.sha256').write_text(digest + '  ' + archive.name + '\n')
        (self.artifacts / 'release-inputs-web.json').write_text(json.dumps({
            'source_sha': SHA, 'artifacts': [{'name': archive.name, 'sha256': digest,
                                           'size': archive.stat().st_size}]}))
        return archive

    def prepare(self, release=True):
        return CANDIDATE.prepare(self.artifacts, self.root / 'web', self.root / 'evidence', SHA, release)

    def test_exact_candidate_bytes_in_both_modes(self):
        self.archive()
        for release in [False, True]:
            with self.subTest(release=release):
                dest = self.root / ('web-' + str(release))
                identity = CANDIDATE.prepare(self.artifacts, dest, self.root / 'evidence', SHA, release)
                self.assertEqual(identity['filesVerified'], 5)
                self.assertEqual(identity['sourceSha'], SHA)
                for name, data in self.payload.items():
                    self.assertEqual((dest / name).read_bytes(), data)

    def test_wrong_source_and_bundle_hash(self):
        original = copy.deepcopy(self.metadata)
        for field in ['revision', 'bundleSha256']:
            with self.subTest(field=field):
                self.metadata = {**original, field: 'b' * 64}
                self.archive()
                with self.assertRaises(ValueError): self.prepare()

    def test_receipt_required_and_binds_archive(self):
        self.archive()
        receipt = self.artifacts / 'release-inputs-web.json'
        receipt.unlink()
        with self.assertRaises(ValueError): self.prepare()
        self.archive()
        value = json.loads(receipt.read_text())
        value['artifacts'][0]['sha256'] = 'b' * 64
        receipt.write_text(json.dumps(value))
        with self.assertRaises(ValueError): self.prepare()

    def test_actions_candidate_requires_the_current_producer_attempt(self):
        self.archive()
        receipt = self.artifacts / 'release-inputs-web.json'
        original = json.loads(receipt.read_text())
        producer = {'repository': 'example/player', 'run_id': 42,
                    'run_attempt': 2, 'source_sha': SHA}
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true',
                                    'GITHUB_REPOSITORY': 'example/player',
                                    'GITHUB_RUN_ID': '42', 'GITHUB_RUN_ATTEMPT': '2'}):
            for invalid in (None, {**producer, 'run_attempt': 1},
                            {**producer, 'run_id': 41},
                            {**producer, 'repository': 'other/player'},
                            {**producer, 'source_sha': 'b' * 40}):
                with self.subTest(producer=invalid):
                    receipt.write_text(json.dumps({**original, 'producer': invalid}))
                    with self.assertRaisesRegex(ValueError, 'producer'):
                        self.prepare()
                    self.assertFalse((self.root / 'web').exists())
            receipt.write_text(json.dumps({**original, 'producer': producer}))
            self.assertEqual(self.prepare()['sourceSha'], SHA)

    def test_archive_checksum_and_symlink_rejected(self):
        archive = self.archive()
        archive.write_bytes(archive.read_bytes() + b'changed')
        with self.assertRaises(ValueError): self.prepare()
        self.archive()
        actual = self.root / 'outside.tar.gz'
        archive.rename(actual)
        archive.symlink_to(actual)
        with self.assertRaises(ValueError): self.prepare()

    def test_archive_traversal_links_duplicates_rejected(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/escape', tarfile.REGTYPE),
                           ('dir\\escape', tarfile.REGTYPE), ('linked', tarfile.SYMTYPE),
                           ('hard', tarfile.LNKTYPE), ('INDEX.HTML', tarfile.REGTYPE)]:
            with self.subTest(name=name):
                item = tarfile.TarInfo(name)
                item.type = kind
                item.size = 1 if kind == tarfile.REGTYPE else 0
                item.linkname = '../escape' if kind != tarfile.REGTYPE else ''
                self.archive(item)
                with self.assertRaises(ValueError): self.prepare()
                self.assertFalse((self.root / 'web').exists())

    def test_incomplete_provider_inventory_rejected(self):
        self.payload['dist/provider-extra.js'] = b'extra()'
        self.archive()
        with self.assertRaises(ValueError): self.prepare()

    def test_existing_destination_never_overwritten(self):
        self.archive()
        (self.root / 'web').mkdir()
        with self.assertRaises(ValueError): self.prepare()

    def test_source_and_release_gates_use_exact_built_artifact(self):
        for filename, job_id in [('ci.yml', 'browser-compatibility'), ('release-build.yml', 'browser-release')]:
            workflow = yaml.safe_load((ROOT / '.github/workflows' / filename).read_text())
            job = workflow['jobs'][job_id]
            self.assertEqual(job['with'].get('browser-platform-scope', 'all'), 'windows' if job_id == 'browser-release' else 'all')
            self.assertEqual(job['needs'], 'build')
            self.assertIn('/typescript-ci.yml@', job['uses'])
            self.assertEqual(job['with']['browser-artifact-id'], '${{ needs.build.outputs.browser-artifact-id }}')
            self.assertFalse(job['with']['run-node-ci'])
            self.assertEqual(job['with']['browser-test-command'], 'CI_FIREFOX_CRASH_DIAGNOSTICS=1 node scripts/browser-acceptance.cjs')
            self.assertTrue(job['with']['browser-evidence-upload-retry'])
            self.assertNotIn('npm run build', job['with']['browser-prepare-command'])
            expected_extended = "${{ inputs.channel == 'rc' || inputs.channel == 'stable' }}" if job_id == 'browser-release' else False
            self.assertEqual(job['with'].get('browser-extended', False), expected_extended)
            self.assertEqual(job['with'].get('browser-release-channel', ''), '${{ inputs.channel }}' if job_id == 'browser-release' else '')
            self.assertEqual('--release' in job['with']['browser-prepare-command'], job_id == 'browser-release')
            if job_id == 'browser-release':
                self.assertEqual(job['with']['browser-evidence-prefix'], 'browser-release')

    def test_explicit_windows_policy_keeps_portable_security_and_full_native_checks(self):
        policy = json.loads((ROOT / '.release-policy.json').read_text())
        self.assertEqual(policy['validation_workflows'],
                         ['windows-validation.yml', 'codeql.yml', 'dependency-review.yml'])
        self.assertEqual(policy['channel_validation_workflows'], {'beta': ['beta-checks.yml']})
        def load(name):
            return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)
        wrapper = load('windows-validation.yml')['jobs']
        self.assertEqual(wrapper['portable']['uses'], './.github/workflows/beta-checks.yml')
        self.assertEqual(wrapper['native-windows']['uses'], './.github/workflows/native-parity.yml')
        self.assertEqual(wrapper['native-windows']['with'], {'runtime-platform-scope': 'windows'})
        self.assertTrue(all('if' not in job and 'continue-on-error' not in job for job in wrapper.values()))
        native = load('native-parity.yml')
        scope = native['on']['workflow_call']['inputs']['runtime-platform-scope']
        self.assertEqual(scope['type'], 'string')
        self.assertEqual(scope['default'], 'all')
        jobs = native['jobs']
        self.assertIn('all|windows)', jobs['runtime-scope']['steps'][0]['run'])
        self.assertIn('exit 1', jobs['runtime-scope']['steps'][0]['run'])
        self.assertIn("'[\"windows-latest\"]'", jobs['shared-guide']['strategy']['matrix']['os'])
        for name in ('android', 'apple', 'favorites-native', 'linux-window-controls'):
            self.assertIn("inputs.runtime-platform-scope != 'windows'", jobs[name]['if'])
            self.assertEqual(jobs[name]['needs'], 'runtime-scope')
        windows = jobs['windows-installers']
        self.assertNotIn('runtime-platform-scope', windows['if'])
        self.assertEqual(windows['needs'], 'runtime-scope')
        commands = [step.get('run', '') for step in windows['steps']]
        self.assertIn('cargo test --locked -p ottplay-core -p ottplay-server -p ottplay-companion', commands)
        self.assertTrue(any('tauri build --ci --bundles "nsis,msi"' in command for command in commands))
        self.assertIn('node scripts/check-windows-video-geometry.cjs', commands)
        self.assertTrue(all('continue-on-error' not in step for step in windows['steps']))

    def test_windows_profile_preserves_full_portable_remote_and_fuzz_regressions(self):
        def load(name):
            return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)
        source, selected = load('ci.yml')['jobs'], load('windows-validation.yml')['jobs']
        for job in ('frontend-tests', 'remote-integration'):
            actual = copy.deepcopy(selected[job])
            if job == 'frontend-tests':
                self.assertIn({'run': 'node tests/test_release_envelope_size.cjs'}, actual['steps'])
                actual['steps'].remove({'run': 'node tests/test_release_envelope_size.cjs'})
            self.assertEqual(actual, source[job], job)
            self.assertNotIn('if', selected[job])
        frontend = '\n'.join(step.get('run', '') for step in selected['frontend-tests']['steps'])
        for command in ('npm test', 'npm run test:python', '--require-hashes --only-binary=:all:'):
            self.assertIn(command, frontend)
        remote = '\n'.join(step.get('run', '') for step in selected['remote-integration']['steps'])
        for command in ('node scripts/smoke-diagnostics.cjs', 'node scripts/smoke-remote-cli.cjs'):
            self.assertIn(command, remote)
        fuzz = selected['common-fuzz']
        self.assertNotIn('if', fuzz)
        self.assertTrue(all('continue-on-error' not in step for step in fuzz['steps']))
        commands = '\n'.join(step.get('run', '') for step in fuzz['steps'])
        for command in ('cargo fmt --manifest-path fuzz/Cargo.toml -- --check',
                        'cargo clippy --locked --manifest-path fuzz/Cargo.toml --lib -- -D warnings',
                        'cargo test --locked --manifest-path fuzz/Cargo.toml --lib'):
            self.assertIn(command, commands)
        self.assertEqual(selected['frontend-tests']['timeout-minutes'], source['frontend-tests']['timeout-minutes'])
        self.assertEqual(selected['remote-integration']['timeout-minutes'], source['remote-integration']['timeout-minutes'])

    def test_shared_browser_contracts_run_on_windows_separate_from_native_budget(self):
        workflow = yaml.load((ROOT / '.github/workflows/windows-validation.yml').read_text(), Loader=yaml.BaseLoader)
        job = workflow['jobs']['shared-browser-windows']
        self.assertEqual(job['runs-on'], 'windows-latest')
        self.assertNotIn('if', job)
        self.assertTrue(all('continue-on-error' not in step for step in job['steps']))
        commands = '\n'.join(step.get('run', '') for step in job['steps'])
        for command in ('npm run build', 'npx playwright install chromium',
                        'npm run test:devices:browser', 'npm run test:native:ui -- --project=chromium',
                        'node tests/test_browser_direct_media.cjs',
                        'node tests/test_browser_local_media.cjs --built-ui',
                        'node tests/test_browser_local_media.cjs --built-ui --initial-retry',
                        'npm run test:hosted:browser'):
            self.assertIn(command, commands)
        config = (ROOT / 'playwright.native-ui.config.cjs').read_text()
        self.assertIn('name: "chromium", use: { browserName: "chromium" }', config)
        full = yaml.load((ROOT / '.github/workflows/ci.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertIn('workflow_dispatch', full['on'])
        self.assertIn('linux-playback-compat', full['jobs'])

    def test_runtime_scope_guard_rejects_unknown_values(self):
        workflow = yaml.load((ROOT / '.github/workflows/native-parity.yml').read_text(), Loader=yaml.BaseLoader)
        command = workflow['jobs']['runtime-scope']['steps'][0]['run']
        for scope in ('all', 'windows', 'linux', 'Windows', 'windows-only', ''):
            with self.subTest(scope=scope):
                result = subprocess.run(['bash', '-c', command],
                                        env={**os.environ, 'RUNTIME_PLATFORM_SCOPE': scope},
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode == 0, scope in ('all', 'windows'))

    def test_native_ui_has_a_separate_budget_and_consumes_the_build_outputs(self):
        workflow = yaml.safe_load((ROOT / '.github/workflows/ci.yml').read_text())
        build = workflow['jobs']['build']
        job = workflow['jobs']['native-ui']
        self.assertEqual(build['timeout-minutes'], 40)
        self.assertEqual(job['timeout-minutes'], 25)
        self.assertEqual(job['needs'], 'build')
        self.assertEqual(job['runs-on'], build['runs-on'])
        self.assertNotIn('if', job)  # A required reusable-workflow job, never optional.
        self.assertNotIn('continue-on-error', job)
        build_commands = '\n'.join(step.get('run', '') for step in build['steps'])
        commands = '\n'.join(step.get('run', '') for step in job['steps'])
        self.assertNotIn('test:native:ui', build_commands)
        self.assertIn('tar -czf build/native-ui-candidate.tar.gz dist dist-mobile src-tauri/frontend js/ottplay-core.js', build_commands)
        self.assertNotIn('npm run build', commands)
        self.assertIn('sha256sum -c native-ui-candidate.sha256', commands)
        self.assertEqual([s['run'] for s in job['steps'] if 'test:native:ui' in s.get('run', '')],
                         ['npm run test:native:ui'])
        self.assertTrue(all('continue-on-error' not in s for s in job['steps']))
        self.assertEqual(build['outputs']['native-ui-artifact-id'],
                         '${{ steps.native-ui-artifact.outputs.artifact-id }}')
        upload = next(s for s in build['steps'] if s.get('id') == 'native-ui-artifact')
        self.assertEqual(upload['with']['if-no-files-found'], 'error')
        download = next(s for s in job['steps'] if s.get('name') == 'Download native UI candidate')
        self.assertEqual(download['with']['artifact-ids'],
                         '${{ needs.build.outputs.native-ui-artifact-id }}')
        self.assertNotIn('name', download['with'])
        guard = next(s for s in job['steps'] if s.get('name') == 'Require the exact native UI artifact')
        self.assertLess(job['steps'].index(guard), job['steps'].index(download))
        self.assertEqual(guard['env']['ARTIFACT_ID'], download['with']['artifact-ids'])
        self.assertIn('^[1-9][0-9]*$', guard['run'])
        checkout = next(s for s in job['steps'] if 'actions/checkout@' in s.get('uses', ''))
        self.assertEqual(checkout['with']['ref'], '${{ github.sha }}')
