"""Pure driver-entrypoint tests. No subprocess/native/WebKit/workflow runs."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

driver_path = Path(__file__).with_name('ci-native-favorites.py')
if not driver_path.is_file():
    driver_path = Path(__file__).parent.parent / 'scripts/ci-native-favorites.py'
spec = importlib.util.spec_from_file_location('ci_native_favorites', driver_path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Clock:
    def __init__(self):
        self.now = 0
    def __call__(self):
        return self.now


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.clock = Clock()
        self.budget = m.Budget(self.clock)
        self.output = self.base / 'attempt'
        self.output.mkdir()
        self.driver = m.Driver(self.base, self.output, self.budget)

    def tearDown(self):
        self.temp.cleanup()

    def runtime(self, label='stage-a-runtime'):
        root = self.driver.runtime_root / label
        root.mkdir()
        return root

    def test_main_clock_precedes_disk_preflight_and_output(self):
        root = self.base / 'preflight'
        root.mkdir()
        clock = Clock()
        def disk(_path):
            clock.now = 1681
            return shutil._ntuple_diskusage(100 * 1024**3, 0, 100 * 1024**3)
        env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
               'RUNNER_TEMP': str(root), 'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1'}
        with mock.patch.dict(os.environ, env), mock.patch.object(m.platform, 'system', return_value='Darwin'), mock.patch.object(m.shutil, 'disk_usage', side_effect=disk), mock.patch.object(m.subprocess, 'Popen') as spawn:
            with self.assertRaises(m.DeadlineError):
                m.main(['--mode', 'physical'], clock=clock)
            spawn.assert_not_called()
        self.assertFalse((root / 'ottplay-favorites-1-1').exists())

    def test_sample_deadline_checked_per_entry(self):
        (self.output / 'first').write_text('one')
        original = Path.lstat
        def slow(path, *args, **kwargs):
            value = original(path, *args, **kwargs)
            if path.name == 'first':
                self.clock.now = 1681
            return value
        self.clock.now = 10
        with mock.patch.object(Path, 'lstat', slow):
            with self.assertRaises(m.DeadlineError):
                self.driver.sample()

    def test_binary_copy_deadline_is_not_just_command_deadline(self):
        source = self.base / 'binary'
        source.write_bytes(b'x' * (m.BLOCK * 3))
        calls = 0
        original = self.budget.tick
        def tick(cleanup=False):
            nonlocal calls
            calls += 1
            if calls == 5:
                self.clock.now = 1681
            return original(cleanup)
        with mock.patch.object(self.budget, 'tick', side_effect=tick):
            with self.assertRaises(m.DeadlineError):
                self.driver.copy_binary(source, self.output / 'bundle/bin')

    def test_hash_deadline_checked_per_block(self):
        source = self.base / 'hash-input'
        source.write_bytes(b'x' * (m.BLOCK * 3))
        calls = 0
        original = self.budget.tick
        def tick(cleanup=False):
            nonlocal calls
            calls += 1
            if calls == 6:
                self.clock.now = 1681
            return original(cleanup)
        with mock.patch.object(self.budget, 'tick', side_effect=tick):
            with self.assertRaises(m.DeadlineError):
                self.budget.digest(source)

    def test_codec_restore_and_after_write_clock_checked(self):
        codec = self.base / 'codec.ts'
        codec.write_bytes(b'candidate')
        calls = 0
        original = self.budget.tick
        def tick(cleanup=False):
            nonlocal calls
            calls += 1
            if calls == 4:
                self.clock.now = 1681
            return original(cleanup)
        with mock.patch.object(self.budget, 'tick', side_effect=tick):
            with self.assertRaises(m.DeadlineError):
                self.driver.restore_codec(codec, b'original')
        self.assertFalse(codec.with_name('codec.ts.owned-tmp').exists())
        self.driver.restore_codec(codec, b'original', cleanup=True)
        self.assertEqual(codec.read_bytes(), b'original')

    def test_terminal_late_after_write_cannot_pass(self):
        original = self.budget.json_evidence
        def slow(path, value, cleanup=False):
            original(path, value, cleanup)
            if value.get('status') == 'pass':
                self.clock.now = 1681
        with mock.patch.object(self.budget, 'json_evidence', side_effect=slow):
            self.assertFalse(self.driver.terminal({'status': 'fail'}, True))
        self.assertEqual(json.loads((self.driver.evidence / 'terminal.json').read_text())['status'], 'fail')

    def test_terminal_readback_late_cannot_pass(self):
        original = self.budget.read
        def slow(path, cap, cleanup=False):
            data = original(path, cap, cleanup)
            if path.name == 'terminal.json' and not cleanup:
                self.clock.now = 1681
            return data
        with mock.patch.object(self.budget, 'read', side_effect=slow):
            self.assertFalse(self.driver.terminal({'status': 'fail'}, True))
        self.assertEqual(json.loads((self.driver.evidence / 'terminal.json').read_text())['status'], 'fail')

    def test_terminal_scan_late_cannot_pass(self):
        self.budget.json_evidence(self.driver.evidence / 'x.json', {'x': 1})
        original = self.driver.scan_evidence
        def scan(cleanup=False):
            original(cleanup)
            if not cleanup:
                self.clock.now = 1681
        with mock.patch.object(self.driver, 'scan_evidence', side_effect=scan):
            self.assertFalse(self.driver.terminal({'status': 'fail'}, True))
        self.assertEqual(json.loads((self.driver.evidence / 'terminal.json').read_text())['status'], 'fail')

    def test_allowed_native_json_and_failure_intent_copy_only(self):
        root = self.runtime()
        (root / 'intent.json').write_text('{"own_test_store_ids":[]}')
        (root / 'result.json').write_text('{"status":"fail"}')
        (root / 'slot1/webview').mkdir(parents=True)
        (root / 'slot1/webview/LocalStorage').write_text('PRIVATE-DO-NOT-UPLOAD')
        (root / 'other.json').write_text('{"private":true}')
        self.driver.copy_runtime_metadata('stage-a-runtime')
        uploaded = self.driver.evidence / 'stage-a-runtime'
        self.assertEqual(sorted(p.name for p in uploaded.iterdir()), ['intent.json', 'result.json'])
        self.assertNotIn('PRIVATE-DO-NOT-UPLOAD', ''.join(p.read_text() for p in uploaded.iterdir()))
        self.assertFalse(self.driver.runtime_root.is_relative_to(self.driver.evidence))

    def test_symlink_native_json_rejected(self):
        root = self.runtime()
        secret = self.base / 'private.json'
        secret.write_text('{"secret":true}')
        (root / 'intent.json').symlink_to(secret)
        with self.assertRaises(RuntimeError):
            self.driver.copy_runtime_metadata('stage-a-runtime')
        self.assertFalse((self.driver.evidence / 'stage-a-runtime/intent.json').exists())

    def test_hardlinked_native_json_rejected(self):
        root = self.runtime()
        secret = self.base / 'private.json'
        secret.write_text('{"secret":true}')
        os.link(secret, root / 'intent.json')
        with self.assertRaises(RuntimeError):
            self.driver.copy_runtime_metadata('stage-a-runtime')

    def test_symlink_runtime_parent_rejected(self):
        shutil.rmtree(self.driver.runtime_root)
        foreign = self.base / 'foreign'
        (foreign / 'stage-a-runtime').mkdir(parents=True)
        (foreign / 'stage-a-runtime/intent.json').write_text('{}')
        self.driver.runtime_root.symlink_to(foreign)
        with self.assertRaises(RuntimeError):
            self.driver.copy_runtime_metadata('stage-a-runtime')

    def test_oversized_json_rejected_before_copy(self):
        root = self.runtime()
        (root / 'intent.json').write_bytes(b' ' * (m.JSON_CAP + 1))
        with self.assertRaises(RuntimeError):
            self.driver.copy_runtime_metadata('stage-a-runtime')
        self.assertFalse((self.driver.evidence / 'stage-a-runtime/intent.json').exists())

    def test_malformed_or_nonobject_json_rejected(self):
        root = self.runtime()
        for text in ('not-json', '[1,2,3]'):
            (root / 'intent.json').write_text(text)
            with self.assertRaises((RuntimeError, ValueError)):
                self.driver.copy_runtime_metadata('stage-a-runtime')
        self.assertFalse((self.driver.evidence / 'stage-a-runtime/intent.json').exists())

    def test_cumulative_budget_rejects_before_extra_native_copy(self):
        root = self.runtime()
        (root / 'intent.json').write_text('{}')
        self.budget.evidence_total = m.EVIDENCE_CAP - 1
        with self.assertRaises(RuntimeError):
            self.driver.copy_runtime_metadata('stage-a-runtime')
        self.assertFalse((self.driver.evidence / 'stage-a-runtime/intent.json').exists())
        self.assertEqual(self.budget.evidence_total, m.EVIDENCE_CAP - 1)

    def test_log_cap_rejects_before_allocation(self):
        self.budget.log_total = m.LOG_CAP
        with self.assertRaises(RuntimeError):
            self.budget.allocate(1, log=True)
        self.assertEqual(self.budget.evidence_total, 0)

    def test_metadata_copy_deadline_checked_after_read(self):
        root = self.runtime()
        (root / 'intent.json').write_text('{}')
        original = self.budget.read
        def slow(*args, **kwargs):
            data = original(*args, **kwargs)
            self.clock.now = 1681
            return data
        with mock.patch.object(self.budget, 'read', side_effect=slow):
            with self.assertRaises(m.DeadlineError):
                self.driver.copy_runtime_metadata('stage-a-runtime')
        self.assertFalse((self.driver.evidence / 'stage-a-runtime/intent.json').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
