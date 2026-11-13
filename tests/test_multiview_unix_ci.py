"""Offline contracts only: no native, Rust, FFmpeg, media or device execution."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'scripts/ci-multiview-unix.py'
REFERENCE = ROOT / 'scripts/ci-native-favorites.py'
if not REFERENCE.exists():
    REFERENCE = ROOT.parent / 'reference/scripts/ci-native-favorites.py'
EXPECTED_TESTS = (
    'real_four_nine_and_perimeter_frames_and_selected_audio',
    'owned_worker_cancellation_deadlines_busy_and_cleanup',
    'fixture_http_source_cas_dedupe_media_custody_and_retirement',
)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ci = load('multiview_ci_offline_under_test', HELPER)
guard = load('multiview_ci_reviewed_guard', REFERENCE)


def setUpModule():
    global no_processes
    no_processes = mock.patch.object(guard.subprocess, 'Popen',
        side_effect=AssertionError('Offline contracts must never launch a process'))
    no_processes.start()


def tearDownModule():
    no_processes.stop()


def artifact(executable, manifest, name='multiview_fixtures', kind='test', test_profile=True):
    return json.dumps({
        'reason': 'compiler-artifact',
        'target': {'name': name, 'kind': [kind]}, 'profile': {'test': test_profile},
        'manifest_path': str(manifest), 'executable': str(executable),
    }) + '\n'


def passed(name):
    return ('running 1 test\ntest ' + name + ' ... ok\n\n'
            'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.01s\n')


def suite_passed(names, ignored=()):
    total = len(names) + len(ignored)
    return (f'running {total} tests\n' + ''.join('test ' + name + ' ... ok\n' for name in names)
            + ''.join('test ' + name + ' ... ignored, synthetic reason\n' for name in ignored)
            + f'test result: ok. {len(names)} passed; 0 failed; {len(ignored)} ignored; 0 measured; 0 filtered out; finished in 0.01s\n')


CORE_NAMES = ('multiview::frames::synthetic_contract', 'multiview::encoder::synthetic_stop_contract')
CORE_IGNORED = ('multiview::synthetic_ignored',)
SERVER_NAMES = ('geometry_and_fixture_success_do_not_grant_production_admission',
                'worker_rejects_ungranted_files_modified_plans_and_pre_cancelled_work')


class Attempt:
    """Real bounded evidence/finalization; every command and supplier is mocked."""

    def __init__(self, case=None, environment='github-hosted', system='Linux'):
        self.case, self.environment, self.system = case, environment, system
        self.driver = None

    def __enter__(self):
        self.stack = contextlib.ExitStack()
        self.directory = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='multiview-ci-offline-'))).resolve()
        self.root, self.parent = self.directory / 'source', self.directory / 'runner-temp'
        self.root.mkdir()
        self.parent.mkdir()
        self.output = self.parent / 'ottplay-multiview-unix-123-2'
        for name in ('Cargo.toml', 'Cargo.lock', 'src-rs/core/Cargo.toml',
                     'src-rs/server/Cargo.toml', 'src-rs/server/tests/multiview_fixtures.rs',
                     'scripts/ci-native-favorites.py', 'scripts/ci-multiview-unix.py',
                     'scripts/ci-apt-mirror.py'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic bounded source: ' + name)
        self.supplied = {}
        for name in ('ffmpeg', 'ffprobe'):
            path = self.directory / name
            path.write_text('synthetic executable bytes; never executed')
            path.chmod(0o700)
            self.supplied[name] = str(path)
        attempt = self

        class MockDriver(guard.Driver):
            def __init__(self, root, output, budget):
                super().__init__(root, output, budget)
                attempt.driver = self

            def run(self, name, argv, limit=1500):
                # Deliberately no subprocess, shell or native-runtime access.
                self.commands.append({'name': name, 'argv': argv, 'limit': limit,
                                      'cleanup_confirmed': attempt.case != 'unknown-cleanup'})
                text = attempt.response(name, argv)
                self.budget.atomic(self.evidence / 'logs' / (name + '.log'),
                                   text.encode(), evidence=True)

        fake_guard = types.SimpleNamespace(Budget=guard.Budget, Driver=MockDriver,
            FLOOR=guard.FLOOR, GROWTH_CAP=guard.GROWTH_CAP,
            LOG_CAP=guard.LOG_CAP, EVIDENCE_CAP=guard.EVIDENCE_CAP)
        env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': self.environment,
               'GITHUB_WORKSPACE': str(self.root), 'GITHUB_RUN_ID': '123',
               'GITHUB_RUN_ATTEMPT': '2', 'RUNNER_TEMP': str(self.parent),
               'GITHUB_SHA': 'a' * 40, 'PATH': '/synthetic-never-executed',
               'RUSTC_WRAPPER': 'must-remove', 'RUSTC_WORKSPACE_WRAPPER': 'must-remove',
               'RUSTFLAGS': 'must-remove', 'CARGO_ENCODED_RUSTFLAGS': 'must-remove'}
        self.stack.enter_context(mock.patch.dict(os.environ, env, clear=True))
        self.stack.enter_context(mock.patch.object(ci, '__file__', str(self.root / 'scripts/ci-multiview-unix.py')))
        self.stack.enter_context(mock.patch.object(ci, 'load_guard', return_value=fake_guard))
        self.stack.enter_context(mock.patch.object(ci, 'provision_tools', return_value=(self.supplied, 'synthetic mock supplier')))
        self.stack.enter_context(mock.patch.object(ci.platform, 'system', return_value=self.system))
        self.stack.enter_context(mock.patch.object(Path, 'cwd', return_value=self.root))
        self.stack.enter_context(mock.patch.object(ci.shutil, 'disk_usage',
            return_value=types.SimpleNamespace(free=16 * 1024**3)))
        return self

    def __exit__(self, *args):
        return self.stack.__exit__(*args)

    def response(self, name, argv):
        if name.endswith('-head'):
            return 'a' * 40 + '\n'
        if name.endswith('-tree'):
            return 'b' * 40 + '\n'
        if name.endswith('-status'):
            return ''
        if name.endswith('-protocols'):
            if self.case == 'output-only-fd':
                return 'Input:\n  file\nOutput:\n  fd\n'
            return 'Input:\n  fd\n  file\nOutput:\n  fd\n'
        if name == 'ffmpeg-encoders':
            return ' V....D libx264 synthetic\n A..... aac synthetic\n'
        if name == 'ffmpeg-filters':
            return ''.join(' ... ' + value + ' synthetic\n' for value in ci.FILTERS)
        if name == 'ffmpeg-muxers':
            return ' E hls synthetic\n'
        if name in ('fixture-build', 'core-fixture-build'):
            core = name == 'core-fixture-build'
            path = self.output / ('target/debug/deps/' + ('ottplay_core' if core else 'multiview_fixtures') + '-synthetic')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic test executable; never executed')
            path.chmod(0o700)
            if core:
                self.core_executable = path
                text = artifact(path, self.root / 'src-rs/core/Cargo.toml', name='ottplay_core', kind='lib')
                return text + text if self.case == 'duplicate-core-target' else text
            self.executable = path
            manifest = self.root / 'src-rs/server/Cargo.toml'
            text = artifact(path, manifest)
            if self.case == 'duplicate-cargo-target':
                return text + text
            if self.case == 'escaped-cargo-target':
                return artifact(Path(self.supplied['ffmpeg']), manifest)
            return 'synthetic cargo diagnostic\n' + text
        if name == 'core-multiview-inventory':
            if self.case == 'core-zero-inventory':
                return ''
            names = list(CORE_NAMES) + list(CORE_IGNORED)
            if self.case == 'core-wrong-prefix':
                names[0] = 'other::synthetic_contract'
            return ''.join(value + ': test\n' for value in names)
        if name == 'core-multiview-ignored-inventory':
            return ''.join(value + ': test\n' for value in CORE_IGNORED)
        if name == 'core-multiview-ordinary':
            text = suite_passed(CORE_NAMES, CORE_IGNORED)
            if self.case == 'core-zero-executed':
                return suite_passed((), CORE_IGNORED)
            if self.case == 'core-failed-ordinary':
                return text.replace(CORE_NAMES[0] + ' ... ok', CORE_NAMES[0] + ' ... FAILED')
            return text
        if name == 'ignored-fixtures':
            names = list(EXPECTED_TESTS)
            if self.case == 'changed-inventory':
                names[-1] = 'unexpected_new_ignored_fixture'
            if self.case == 'duplicate-inventory':
                names.append(names[0])
            return ''.join(value + ': test\n' for value in names)
        if name == 'server-fixture-inventory':
            return ''.join(value + ': test\n' for value in list(SERVER_NAMES) + list(EXPECTED_TESTS))
        if name == 'server-fixtures-ordinary':
            text = suite_passed(SERVER_NAMES, EXPECTED_TESTS)
            if self.case == 'server-failed-ordinary':
                return text.replace(SERVER_NAMES[0] + ' ... ok', SERVER_NAMES[0] + ' ... FAILED')
            return text
        if name.startswith('fixture-'):
            if self.case == 'zero-tests':
                return 'running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 3 filtered out\n'
            text = passed(argv[1])
            if self.case == 'contradictory-status':
                text += 'test result: FAILED. 0 passed; 1 failed; 0 ignored;\n'
            if name == 'fixture-3' and self.case == 'changed-lock':
                (self.root / 'Cargo.lock').write_text('synthetic changed lock')
            if name == 'fixture-3' and self.case == 'changed-binary':
                self.executable.write_text('synthetic changed executable')
            if name == 'fixture-3' and self.case == 'changed-core-binary':
                self.core_executable.write_text('synthetic changed core executable')
            return text
        return 'synthetic tool metadata only\n'

    def run(self, path=None, required_core=(), required_server=()):
        argv = ['--work-root', str(path or self.output)]
        for name in required_core:
            argv.extend(['--required-core-test', name])
        for name in required_server:
            argv.extend(['--required-server-test', name])
        ci.main(argv)

    def terminal(self):
        return json.loads((self.output / 'evidence/terminal.json').read_text())


class ParsingTests(unittest.TestCase):
    def test_pinned_guard_and_exact_existing_fixture_inventory(self):
        self.assertEqual(hashlib.sha256(REFERENCE.read_bytes()).hexdigest(), ci.GUARD_SHA256)
        self.assertEqual(tuple(name for name, _ in ci.TESTS), EXPECTED_TESTS)

    def test_fd_must_be_in_input_section(self):
        self.assertTrue(ci.has_input_fd('Input:\n fd\nOutput:\n file\n'))
        for value in ('Output:\n fd\n', 'Input:\n file\nOutput:\n fd\n',
                      'Input:\n fd-other\n', 'fd\nInput:\n file\n'):
            with self.subTest(value=value):
                self.assertFalse(ci.has_input_fd(value))

    def test_exact_single_pass_and_zero_test_refusal(self):
        name = EXPECTED_TESTS[0]
        ci.require_one_pass(passed(name), name)
        for value in ('running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;\n',
                      passed('wrong_fixture'), passed(name).replace('0 ignored', '1 ignored'),
                      passed(name) + passed(name)):
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    ci.require_one_pass(value, name)

    def test_conflicting_results_are_not_a_pass(self):
        name = EXPECTED_TESTS[0]
        with self.assertRaises(RuntimeError):
            ci.require_one_pass(passed(name) + 'test result: FAILED. 0 passed; 1 failed; 0 ignored;\n', name)

    def test_table_flags_do_not_accept_description_only_tokens(self):
        self.assertEqual(ci.table_names(' V....D libx264 note\n A..... aac note\nnotice hls\n',
                                       r'[VAS.][A-Z.]{5}'), {'libx264', 'aac'})

    def test_suite_pass_requires_nonzero_disjoint_exact_execution_and_summary(self):
        names, ignored = {'multiview::one', 'multiview::two'}, {'multiview::optional'}
        text = suite_passed(sorted(names), sorted(ignored))
        ci.require_suite_pass(text, names, ignored)
        for modified in (text.replace('running 3 tests', 'running 0 tests'),
                         text.replace('multiview::one ... ok', 'unexpected ... ok'),
                         text.replace('multiview::two ... ok', 'multiview::one ... ok'),
                         text.replace('multiview::one ... ok', 'multiview::one ... FAILED'),
                         text.replace('optional ... ignored', 'wrong ... ignored'),
                         text.replace('2 passed', '0 passed'), text + text,
                         text + 'test result: FAILED. 0 passed; 1 failed; 0 ignored;\n'):
            with self.subTest(modified=modified):
                with self.assertRaises(RuntimeError):
                    ci.require_suite_pass(modified, names, ignored)
        for ordinary, skipped in ((set(), ignored), (names, names)):
            with self.assertRaises(RuntimeError):
                ci.require_suite_pass(text, ordinary, skipped)

    def test_cargo_target_is_unique_owned_and_exact_manifest(self):
        with tempfile.TemporaryDirectory(prefix='multiview-ci-cargo-offline-') as raw:
            root = Path(raw).resolve()
            target = root / 'target'
            target.mkdir()
            executable = target / 'fixture'
            executable.write_text('not executed')
            executable.chmod(0o700)
            manifest = root / 'Cargo.toml'
            good = artifact(executable, manifest)
            self.assertEqual(ci.test_executable('diagnostic\n' + good, target, manifest), executable)
            outside = root / 'outside'
            outside.write_text('not executed')
            outside.chmod(0o700)
            link = target / 'link'
            link.symlink_to(outside)
            for text in (good + good, '', artifact(outside, manifest), artifact(link, manifest),
                         artifact(executable, root / 'wrong.toml'), artifact(executable, manifest, test_profile=False)):
                with self.subTest(text=text):
                    with self.assertRaises(RuntimeError):
                        ci.test_executable(text, target, manifest)
            core = artifact(executable, manifest, name='ottplay_core', kind='lib')
            self.assertEqual(ci.test_executable(core, target, manifest, name='ottplay_core', kind='lib'), executable)
            with self.assertRaises(RuntimeError):
                ci.test_executable(core, target, manifest)

    def test_changed_guard_is_refused_before_import(self):
        with tempfile.TemporaryDirectory(prefix='multiview-ci-guard-offline-') as raw:
            root = Path(raw)
            sibling = root / 'ci-native-favorites.py'
            sibling.write_text('raise AssertionError("must never be imported")\n')
            with mock.patch.object(ci, '__file__', str(root / 'ci-multiview-unix.py')):
                with self.assertRaisesRegex(RuntimeError, 'Reviewed process guard changed'):
                    ci.load_guard()


class ProvisionTests(unittest.TestCase):
    def test_ubuntu_supplier_is_pinned_and_commands_share_remaining_allowance(self):
        now, calls = [0.0], []
        budget = types.SimpleNamespace(clock=lambda: now[0], work_deadline=900,
            read=lambda path, cap: b'ID=ubuntu\nVERSION_ID="26.04"\n')
        driver = types.SimpleNamespace(root=Path('/synthetic-source'), env={'PATH': '/synthetic'})

        def command(name, argv, seconds=15):
            calls.append((name, argv, seconds))
            now[0] += 10
            if name == 'ffmpeg-package-owner':
                return 'ffmpeg: /usr/bin/ffmpeg\nffmpeg: /usr/bin/ffprobe\n'
            return 'synthetic metadata'

        with mock.patch.object(ci.platform, 'system', return_value='Linux'):
            tools, source = ci.provision_tools(driver, budget, command)
        self.assertEqual(tools, {'ffmpeg': '/usr/bin/ffmpeg', 'ffprobe': '/usr/bin/ffprobe'})
        self.assertIn('signed APT', source)
        self.assertEqual([name for name, _, _ in calls[:3]], ['apt-mirror', 'apt-update', 'apt-ffmpeg'])
        self.assertEqual([limit for _, _, limit in calls[:3]], [300, 290, 280])
        self.assertEqual([limit for _, _, limit in calls], [300, 290, 280, 270, 260, 250])
        install = calls[2][1]
        self.assertIn('--no-install-recommends', install)
        self.assertIn('Acquire::Retries=0', install)
        self.assertIn('DEBIAN_FRONTEND=noninteractive', install)

    def test_ubuntu_mismatch_denies_before_any_command(self):
        budget = types.SimpleNamespace(clock=lambda: 0, work_deadline=900,
            read=lambda path, cap: b'ID=ubuntu\nVERSION_ID="24.04"\n')
        driver = types.SimpleNamespace(root=Path('/synthetic-source'), env={})
        command = mock.Mock()
        with mock.patch.object(ci.platform, 'system', return_value='Linux'):
            with self.assertRaisesRegex(RuntimeError, 'Expected Ubuntu26.04 image'):
                ci.provision_tools(driver, budget, command)
        command.assert_not_called()

    def test_brew_only_installs_official_available_image_bottle(self):
        for case in ('good', 'foreign-tap', 'missing-bottle', 'foreign-url'):
            with self.subTest(case=case), tempfile.TemporaryDirectory(prefix='multiview-ci-brew-offline-') as raw:
                prefix = Path(raw).resolve() / 'formula'
                calls = []
                formula = {'name': 'ffmpeg', 'tap': 'homebrew/core', 'installed': [],
                    'bottle': {'stable': {'files': {'arm64_sequoia': {
                        'sha256': 'c' * 64, 'url': 'https://ghcr.io/v2/homebrew/core/ffmpeg/blobs/sha256:synthetic'}}}}}
                if case == 'foreign-tap':
                    formula['tap'] = 'synthetic/foreign'
                elif case == 'missing-bottle':
                    formula['bottle']['stable']['files'] = {}
                elif case == 'foreign-url':
                    formula['bottle']['stable']['files']['arm64_sequoia']['url'] = 'https://synthetic.invalid/foreign'
                driver = types.SimpleNamespace(root=Path('/synthetic-source'), env={'PATH': '/synthetic'})
                budget = types.SimpleNamespace(clock=lambda: 0, work_deadline=900)

                def command(name, argv, seconds=15):
                    calls.append((name, argv, seconds))
                    if name == 'brew-ffmpeg-info-before':
                        return json.dumps({'formulae': [formula]})
                    if name == 'brew-ffmpeg-install':
                        (prefix / 'bin').mkdir(parents=True)
                        for tool in ('ffmpeg', 'ffprobe'):
                            (prefix / 'bin' / tool).write_text('synthetic bytes; not executed')
                    if name == 'brew-ffmpeg-prefix':
                        return str(prefix) + '\n'
                    return json.dumps({'formulae': [formula]})

                with mock.patch.object(ci.platform, 'system', return_value='Darwin'), \
                     mock.patch.object(ci.platform, 'mac_ver', return_value=('15.7', (), '')), \
                     mock.patch.object(ci.platform, 'machine', return_value='arm64'), \
                     mock.patch.object(ci.shutil, 'which', return_value='/synthetic/brew'):
                    if case == 'good':
                        tools, _ = ci.provision_tools(driver, budget, command)
                        self.assertEqual(tools['ffmpeg'], str(prefix / 'bin/ffmpeg'))
                    else:
                        with self.assertRaises(RuntimeError):
                            ci.provision_tools(driver, budget, command)
                installs = [argv for name, argv, _ in calls if name == 'brew-ffmpeg-install']
                self.assertEqual(installs, [['/synthetic/brew', 'install', '--force-bottle', 'homebrew/core/ffmpeg']]
                                 if case == 'good' else [])
                self.assertEqual(driver.env['HOMEBREW_NO_AUTO_UPDATE'], '1')


class MockMainTests(unittest.TestCase):
    def test_required_regressions_must_be_present_and_nonignored(self):
        with Attempt() as attempt:
            attempt.run(required_core=CORE_NAMES, required_server=SERVER_NAMES)
            self.assertEqual(attempt.terminal()['status'], 'pass')
        cases = ((('multiview::missing',), (), 'core'),
                 (CORE_IGNORED, (), 'core'),
                 (('wrong_namespace::test',), (), 'core'),
                 ((), ('missing_server_fixture',), 'server'),
                 ((), (EXPECTED_TESTS[0],), 'server'))
        for required_core, required_server, domain in cases:
            with self.subTest(required_core=required_core, required_server=required_server), Attempt() as attempt:
                with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                    attempt.run(required_core=required_core, required_server=required_server)
                self.assertIn('Required ordinary ' + domain + ' regression is absent or ignored',
                              attempt.terminal()['error'])

    def test_happy_mocked_linux_and_darwin_keep_qualification_limits(self):
        for system in ('Linux', 'Darwin'):
            with self.subTest(system=system), Attempt(system=system) as attempt:
                attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['status'], 'pass')
                self.assertFalse(result['production_admission'])
                self.assertFalse(result['sustained_media_e2e'])
                self.assertFalse(result['generated_media_hashes_available'])
                self.assertEqual(result['tests'], list(EXPECTED_TESTS))
                self.assertEqual(result['ordinary_core_tests'], sorted(CORE_NAMES))
                self.assertEqual(result['ordinary_server_tests'], sorted(SERVER_NAMES))
                for key in ('RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS'):
                    self.assertNotIn(key, attempt.driver.env)
                self.assertEqual(attempt.driver.env['CARGO_HOME'], str(attempt.output / 'cargo-home'))
                fixtures = [entry for entry in attempt.driver.commands if entry['name'].startswith('fixture-')
                            and entry['name'] != 'fixture-build']
                self.assertEqual(len(fixtures), 3)
                self.assertTrue(all('--exact' in entry['argv'] and '--ignored' in entry['argv'] for entry in fixtures))
                self.assertTrue(all('--nocapture' not in entry['argv'] for entry in fixtures))
                commands = [entry['name'] for entry in attempt.driver.commands]
                self.assertLess(commands.index('core-multiview-ordinary'), commands.index('fixture-1'))
                self.assertLess(commands.index('server-fixtures-ordinary'), commands.index('fixture-1'))

    def test_local_selfhosted_and_non_unix_are_denied_before_output_or_commands(self):
        for environment, system in (('self-hosted', 'Linux'), ('', 'Darwin'), ('github-hosted', 'Windows')):
            with self.subTest(environment=environment, system=system), Attempt(environment=environment, system=system) as attempt:
                with self.assertRaisesRegex(RuntimeError, 'Disposable hosted Unix CI only'):
                    attempt.run()
                self.assertIsNone(attempt.driver)
                self.assertFalse(attempt.output.exists())

    def test_unowned_output_is_denied_before_commands(self):
        with Attempt() as attempt:
            with self.assertRaisesRegex(RuntimeError, 'Unexpected owned output path'):
                attempt.run(attempt.parent / 'not-owned')
            self.assertIsNone(attempt.driver)

    def test_refusals_preserve_failed_terminal_and_never_report_admission(self):
        cases = {'zero-tests': 'Expected exactly one executed test',
                 'output-only-fd': 'requires Input fd',
                 'changed-inventory': 'Exact ignored fixture inventory changed',
                 'duplicate-cargo-target': 'exactly one fixture executable',
                 'escaped-cargo-target': 'Fixture executable escaped owned target',
                 'unknown-cleanup': 'Owned process cleanup unknown',
                 'changed-lock': 'Source or root lock changed',
                 'changed-binary': 'Fixture executable changed',
                 'changed-core-binary': 'Core test executable changed',
                 'duplicate-core-target': 'exactly one fixture executable',
                 'core-zero-inventory': 'Core multiview test inventory differs',
                 'core-wrong-prefix': 'Core multiview test inventory differs',
                 'core-zero-executed': 'Ordinary suite count differs',
                 'core-failed-ordinary': 'Ordinary suite execution/status differs',
                 'server-failed-ordinary': 'Ordinary suite execution/status differs'}
        for case, reason in cases.items():
            with self.subTest(case=case), Attempt(case) as attempt:
                with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                    attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['status'], 'fail')
                self.assertFalse(result['production_admission'])
                self.assertFalse(result['sustained_media_e2e'])
                self.assertIn(reason, result['error'])

    def test_duplicate_inventory_is_refused(self):
        with Attempt('duplicate-inventory') as attempt:
            with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                attempt.run()
            self.assertEqual(attempt.terminal()['status'], 'fail')
            self.assertIn('Duplicate ignored fixture inventory', attempt.terminal()['error'])

    def test_conflicting_status_is_refused_by_main(self):
        with Attempt('contradictory-status') as attempt:
            with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                attempt.run()
            self.assertEqual(attempt.terminal()['status'], 'fail')
            self.assertIn('Fixture count/status differs', attempt.terminal()['error'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
