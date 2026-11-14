"""Offline contracts only: no native, Rust, FFmpeg, media or device execution."""
import contextlib
import hashlib
import importlib.util
import json
import os
import stat
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
    'streamed_session_two_owner_continuity',
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


CORE_REQUIRED_NAMES = (
    'multiview::broker::registry::try_authority_tests::try_session_authority_returns_busy_without_callback_then_recovers',
    'multiview::broker::registry::try_authority_tests::try_session_authority_maps_poison_to_unavailable_without_callback',
    'multiview::broker::registry::try_authority_tests::try_session_authority_preserves_authorization_and_output_block',
)
CORE_NAMES = ('multiview::frames::synthetic_contract', 'multiview::encoder::synthetic_stop_contract',
              *CORE_REQUIRED_NAMES)
CORE_IGNORED = ('multiview::synthetic_ignored',)
SERVER_NAMES = ('geometry_and_fixture_success_do_not_grant_production_admission',
                'worker_rejects_ungranted_files_modified_plans_and_pre_cancelled_work')

ACTIVATION_NAMES = (
    'no_flag_keeps_private_paths_absent_and_health_available',
    'valid_loopback_activation_is_authenticated_zero_capacity_and_cannot_play',
    'selected_tls_listener_isolated_from_http_and_other_tls_ports',
    'explicit_loopback_http_selects_only_one_port',
    'unsafe_configuration_rejected_before_reserved_port_bind',
    'invalid_listener_selection_rejected_before_bind',
    'incompatible_dedicated_modes_reject_opt_in_before_binding',
    'restart_issues_fresh_epoch_without_promoting_capacity',
)
# These are deliberately synthetic; the production broker inventory is owner-frozen separately.
BROKER_NAMES = (
    'synthetic_broker_boundary_rejects_foreign_context',
    'synthetic_broker_boundary_requires_authenticated_owner',
)
LISTENER_NAMES = (
    'listener_tests::selected_media_dispatch_preserves_public_request_context_and_response',
    'listener_tests::media_transport_failure_response_is_fixed_and_private',
    'listener_tests::synthetic_additional_namespace_regression',
)

# Exact required-filter rows shared by both hosted OS logs in run43510059683.
CAPTURED_FILTER_ROWS = ''' .. sine              |->A       Generate sine wave audio signal.
 .. crop              V->V       Crop the input video.
 T. drawbox           V->V       Draw a colored box on the input video.
 .. format            V->V       Convert the input video to one of the specified pixel formats.
 .. fps               V->V       Force constant framerate.
 TS overlay           VV->V      Overlay a video source on top of the input.
 .. pad               V->V       Pad the input video.
 .. scale             V->V       Scale the input video size and/or convert the image format.
 .. setpts            V->V       Set PTS for the output video frame.
 .. setsar            V->V       Set the pixel sample aspect ratio.
 .S xstack            N->V       Stack video inputs into custom layout.
 .. testsrc2          |->V       Generate another test pattern.
'''


class FakeMedia:
    """Seven-function frozen analyzer API; commands remain synthetic Driver data."""

    helper_sha256 = "444efc203c60b31baa9896ab96d7aa0568a09f5b6591524f1b9c8fff4e9e7e64"

    def __init__(self, attempt):
        self.attempt = attempt
        self.calls = []
        self.inputs_root = self.analysis_root = None
        self.audio_commands = self.video_commands = ()

    def self_test(self):
        self.calls.append("self_test")
        return {"pass": True, "pure_positive": True,
                "reject_100ms_hole_despite_global_pass": True,
                "reject_20ms_phase_jump": True, "reject_wrong_owner": True,
                "reject_449_frame_48k_hole": True, "reject_898_interleaved_counter": True,
                "ported_original_rule_agreement": True, "reject_later_onset_trim": True,
                "reject_event_restart_regression_wrong_owner": True,
                "safety_cap_above_acceptance": True,
                "reject_wrong_video_and_frozen_marker": True, "exact_tail_coverage": True,
                "tools_started": False, "long_media_generated": False}

    @staticmethod
    def command(name, tool, output, seconds=40, stdout=False):
        return {"name": name, "argv": [tool["path"] if isinstance(tool, dict) else tool,
                                       "-n", str(output)],
                "timeout_seconds": seconds,
                "stdout_file": str(output) if stdout else None}

    def prepare_inputs(self, work_root, tools):
        self.calls.append("prepare_inputs")
        self.inputs_root = Path(work_root)
        self.inputs_root.mkdir(mode=0o700, exist_ok=True)
        self.tools = tools
        return [self.command(f"stream-source-{number}-{phase}", tools["ffmpeg"],
                             self.inputs_root / f"source-{number}.{suffix}", seconds)
                for number in (1, 2)
                for phase, suffix, seconds in (("encode", "mp4", 30), ("transport", "ts", 15))]

    def seal_inputs(self, work_root):
        self.calls.append("seal_inputs")
        self.inputs_root = Path(work_root)
        rows = []
        for number in (1, 2):
            path = self.inputs_root / f"source-{number}.ts"
            raw = path.read_bytes()
            rows.append({"id": number, "path": str(path), "bytes": len(raw),
                         "sha256": hashlib.sha256(raw).hexdigest()})
        self.input_manifest = self.inputs_root / "INPUTS.json"
        self.input_manifest.write_text(json.dumps({
            "schema": "ottplay.multiview.stream-inputs.v1", "seconds": 90,
            "fps": 10, "width": 96, "height": 64, "inputs": rows,
        }) + "\n")
        return self.input_manifest

    def prepare_audio(self, case_root, work_root, tools):
        self.calls.append("prepare_audio")
        self.analysis_root = Path(work_root)
        self.analysis_root.mkdir(mode=0o700, exist_ok=True)
        probe = self.command("stream-video-probe", tools["ffprobe"],
                             Path(case_root) / "archive/index.m3u8", 20)
        probe["stdout_file"] = str(self.analysis_root / "video-probe.json")
        self.audio_commands = (
            probe,
            self.command("stream-b-prefix-audio", tools["ffmpeg"], self.analysis_root / "B-prefix.s16"),
            self.command("stream-a-prefix-audio", tools["ffmpeg"], self.analysis_root / "A-prefix.s16"),
        )
        return list(self.audio_commands)

    def prepare_video(self, case_root, work_root, tools):
        self.calls.append("prepare_video")
        completed = {row["name"] for row in self.attempt.driver.commands}
        if not {row["name"] for row in self.audio_commands} <= completed:
            raise ValueError("Synthetic audio commands were not completed before video planning")
        self.analysis_root = Path(work_root)
        self.video_commands = (
            self.command("stream-video-window-00", tools["ffmpeg"], self.analysis_root / "video-00.rgb"),
            self.command("stream-a-return-audio", tools["ffmpeg"], self.analysis_root / "A-return.s16"),
        )
        return list(self.video_commands)

    def finish(self, case_root, work_root):
        self.calls.append("finish")
        completed = {row["name"] for row in self.attempt.driver.commands}
        if not {row["name"] for row in self.video_commands} <= completed:
            raise ValueError("Synthetic video commands were not completed before finish")
        result = {"schema": "ottplay.multiview.stream-media.v1", "pass": True,
                  "helper_sha256": self.helper_sha256,
                  "scope": "Synthetic mocked CI orchestration only; no media qualification"}
        path = Path(work_root) / "qualification.json"
        for row in self.video_commands:
            if row["name"].startswith("stream-video-window-"):
                Path(row["argv"][-1]).unlink()
        case, work = Path(case_root), Path(work_root)
        segment = case / "archive/segment-000000.ts"
        segment.write_bytes(b"\x47" + b"\0" * 187)
        archive = {"qualified": True, "complete_capture": True, "contiguous_from_zero": True,
                   "failure_reason": None, "unique_manifests": 1, "segment_count": 1,
                   "segments": [{"sequence": 0, "name": segment.name, "bytes": segment.stat().st_size,
                                 "sha256": hashlib.sha256(segment.read_bytes()).hexdigest(), "extinf_seconds": 1.0}]}
        (case / "archive/ARCHIVE.json").write_text(json.dumps(archive) + "\n")
        playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\nsegment-000000.ts\n#EXT-X-ENDLIST\n"
        (case / "EVENTS.jsonl").write_text('{"phase":"synthetic","snapshot":{}}\n')
        (case / "archive/CAPTURE.jsonl").write_text('{"stage":"synthetic","outcome":"accepted"}\n')
        for name in ("A-END-LIVE.m3u8", "B-END-LIVE.m3u8", "archive/index.m3u8",
                     "archive/A-selected-prefix.m3u8", "archive/B-selected-prefix.m3u8"):
            (case / name).write_text(playlist)
        observation = case / "archive/observations/000001.m3u8"
        observation.parent.mkdir(mode=0o700)
        observation.write_text(playlist)
        for name in ("audio-B.json", "audio-B-original-rules.json", "audio-A-initial.json", "video.json"):
            (work / name).write_text('{"pass":true}\n')
        (work / "video-plan.json").write_text("[]\n")
        result["case_sha256"] = {name: hashlib.sha256((case / name).read_bytes()).hexdigest()
                                 for name in ("CONTROL.json", "EVENTS.jsonl", "A-END-LIVE.m3u8",
                                              "B-END-LIVE.m3u8", "archive/index.m3u8", "archive/ARCHIVE.json",
                                              "archive/A-selected-prefix.m3u8", "archive/B-selected-prefix.m3u8")}
        result["work_pcm_sha256"] = {name: hashlib.sha256((work / name).read_bytes()).hexdigest()
                                     for name in ("B-prefix.s16", "A-prefix.s16", "A-return.s16")}
        path.write_text(json.dumps(result) + "\n")
        case_files = [("CONTROL.json", 1024**2), ("EVENTS.jsonl", 8 * 1024**2),
                      ("A-END-LIVE.m3u8", 65536), ("B-END-LIVE.m3u8", 65536),
                      ("archive/index.m3u8", 65536), ("archive/ARCHIVE.json", 1024**2),
                      ("archive/CAPTURE.jsonl", 8 * 1024**2),
                      ("archive/A-selected-prefix.m3u8", 65536), ("archive/B-selected-prefix.m3u8", 65536),
                      ("archive/segment-000000.ts", 2 * 1024**2), ("archive/observations/000001.m3u8", 65536)]
        analysis_files = [(name, 1024**2) for name in ("audio-B.json", "audio-B-original-rules.json",
                          "audio-A-initial.json", "video.json", "qualification.json")]
        analysis_files += [("B-prefix.s16", 4 * 1024**2), ("A-prefix.s16", 4 * 1024**2),
                           ("A-return.s16", 128000), ("video-probe.json", 2 * 1024**2), ("video-plan.json", 65536)]
        evidence = [{"path": str(parent / name), "relative_name": prefix + name, "max_bytes": maximum}
                    for parent, prefix, rows in ((case, "stream-media/case/", case_files),
                                                (work, "stream-media/analysis/", analysis_files))
                    for name, maximum in rows]
        return {"result": result, "evidence": evidence}

    def failure_evidence(self, case_root, work_root):
        self.calls.append("failure_evidence")
        path = Path(case_root) / "CONTROL.json"
        evidence = ([{"path": str(path), "relative_name": "stream-media-forensic/case/CONTROL.json",
                     "max_bytes": 1024 * 1024}] if path.is_file() else [])
        return {"schema": "ottplay.multiview.stream-forensic.v1", "qualified": False,
                "forensic_only": True, "incomplete": True, "errors": ["MISSING_REQUIRED"],
                "omitted_files": 0, "evidence_bytes": path.stat().st_size if evidence else 0,
                "evidence": evidence, "preserves_original_error": True,
                "cleanup_must_run_unconditionally": True}


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
        self.home = self.directory / 'home'
        self.home.mkdir(mode=0o700)
        self.preexisting_home_fixture = self.home / '.ottplay-multiview-activation-preexisting'
        if self.case in ('preexisting-home-fixture', 'changed-preexisting-home-fixture'):
            self.preexisting_home_fixture.mkdir(mode=0o700)
        self.output = self.parent / 'ottplay-multiview-unix-123-2'
        self.media = FakeMedia(self)
        for name in ('Cargo.toml', 'Cargo.lock', 'src-rs/core/Cargo.toml',
                     'src-rs/core/src/multiview/broker/registry.rs',
                     'src-rs/server/Cargo.toml', 'src-rs/server/tests/multiview_fixtures.rs',
                     'src-rs/server/tests/multiview_activation.rs', 'src-rs/server/src/main.rs',
                     'src-rs/server/src/multiview_broker.rs',
                     'src-rs/server/src/multiview_broker_live.rs',
                     'src-rs/server/src/multiview_broker_live_output_tests.rs',
                     'src-rs/server/src/media_connection.rs',
                     'src-rs/server/tests/multiview_broker_boundary.rs',
                     'src-rs/server/tests/support/streamed_session.rs',
                     'src-rs/server/tests/support/streamed_transport.rs',
                     'src-rs/server/tests/support/streamed_archive.rs',
                     'scripts/ci-multiview-unix-media.py',
                     'scripts/ci-native-favorites.py', 'scripts/ci-multiview-unix.py',
                     'scripts/ci-apt-mirror.py'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic bounded source: ' + name)
        self.supplied = {}
        for name in ('ffmpeg', 'ffprobe', 'mkfifo', 'openssl'):
            path = self.directory / name
            path.write_text('synthetic executable bytes; never executed')
            path.chmod(0o700)
            self.supplied[name] = str(path)
        if self.case == 'retargeted-system-tool':
            alias = Path(self.supplied['mkfifo'])
            target = self.directory / 'mkfifo-original'
            alias.rename(target)
            alias.symlink_to(target)
        attempt = self

        class MockDriver(guard.Driver):
            def __init__(self, root, output, budget):
                super().__init__(root, output, budget)
                attempt.driver = self

            def run(self, name, argv, limit=1500):
                # Deliberately no subprocess, shell or native-runtime access.
                self.commands.append({'name': name, 'argv': argv, 'limit': limit,
                                      'cleanup_confirmed': attempt.case != 'unknown-cleanup'
                                      and not (name == 'broker-ordinary' and attempt.case == 'broker-cleanup-unknown')
                                      and not (name == 'listener-ordinary' and attempt.case == 'listener-cleanup-unknown')})
                text = attempt.response(name, argv)
                self.budget.atomic(self.evidence / 'logs' / (name + '.log'),
                                   text.encode(), evidence=True)
                if name == 'broker-ordinary' and attempt.case == 'broker-nonzero-exit':
                    raise RuntimeError('Synthetic broker command exited nonzero after successful stdout')
                if name == 'listener-ordinary' and attempt.case == 'listener-nonzero-exit':
                    raise RuntimeError('Synthetic listener command exited nonzero after successful stdout')

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
        self.stack.enter_context(mock.patch.object(ci, 'MKFIFO', Path(self.supplied['mkfifo'])))
        self.stack.enter_context(mock.patch.object(ci.shutil, 'which',
            side_effect=lambda name, **kwargs: self.supplied.get(name)))
        self.stack.enter_context(mock.patch.object(ci, 'load_guard', return_value=fake_guard))
        self.stack.enter_context(mock.patch.object(ci, 'load_stream_media', return_value=self.media))
        self.stack.enter_context(mock.patch.object(ci, 'BROKER_TESTS', frozenset(BROKER_NAMES)))
        self.stack.enter_context(mock.patch.object(ci, 'provision_tools', return_value=(self.supplied, 'synthetic mock supplier')))
        self.stack.enter_context(mock.patch.object(ci, 'activation_home_preflight',
            return_value={'parent': str(self.home), 'ancestors': [],
                          'fixture_directory_mode': '0o700', 'production_loader_unchanged': True}))
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
        if name == 'openssl-version':
            return ('SyntheticSSL 1.0 unsupported\n' if self.case == 'unsupported-openssl'
                    else 'LibreSSL 3.3.6 synthetic fixture; never executed\n' if self.case == 'libressl-version'
                    else 'OpenSSL 3.0.99 synthetic fixture; never executed\n')
        if name == 'ffmpeg-encoders':
            return ' V....D libx264 synthetic\n A..... aac synthetic\n'
        if name == 'ffmpeg-filters':
            if self.case == 'two-flag-filter-output':
                return CAPTURED_FILTER_ROWS
            return ''.join(' ... ' + value + ' synthetic\n' for value in ci.FILTERS)
        if name == 'ffmpeg-muxers':
            return ' E hls synthetic\n'
        if name == 'stream-stats-mux-pre':
            return ' -stats_mux_pre[:stream_specifier] synthetic mux statistics output\n'
        if name.startswith('stream-source-'):
            path = Path(argv[-1])
            path.write_bytes(b'\x47' + b'\0' * 187 if path.suffix == '.ts' else b'synthetic encoded work')
            return 'synthetic finite source output; no media process\n'
        if name == 'stream-video-probe':
            return '{"streams":[],"frames":[]}\n'
        if name in ('stream-b-prefix-audio', 'stream-a-prefix-audio', 'stream-a-return-audio') \
                or name.startswith('stream-video-window-'):
            Path(argv[-1]).write_bytes(b'synthetic analysis work; never decoded')
            return 'synthetic analysis output; no media process\n'
        if name == 'mkfifo-smoke':
            for path in argv[1:]:
                if self.case == 'missing-smoke-fifo' and path == argv[2]:
                    continue
                if self.case == 'nonfifo-smoke':
                    Path(path).write_text('synthetic unexpected non-FIFO output')
                else:
                    os.mkfifo(path)
            return 'synthetic FIFO creation via stdlib only\n'
        if name == 'listener-test-build':
            self.listener_executable = self.output / 'target/debug/deps/ottplay_server-listener-tests-synthetic'
            self.listener_executable.parent.mkdir(parents=True, exist_ok=True)
            self.listener_executable.write_text('synthetic listener test executable; never executed')
            self.listener_executable.chmod(0o700)
            manifest = self.root / 'src-rs/server/Cargo.toml'
            listener = artifact(self.listener_executable, manifest, name='ottplay-server', kind='bin')
            if self.case == 'listener-cargo-wrong-manifest':
                listener = artifact(self.listener_executable, self.root / 'src-rs/core/Cargo.toml',
                                    name='ottplay-server', kind='bin')
            elif self.case == 'listener-cargo-wrong-target':
                listener = artifact(self.listener_executable, manifest, name='synthetic_other_bin', kind='bin')
            elif self.case == 'listener-cargo-wrong-kind':
                listener = artifact(self.listener_executable, manifest, name='ottplay-server', kind='test')
            elif self.case == 'listener-cargo-wrong-profile':
                listener = artifact(self.listener_executable, manifest, name='ottplay-server', kind='bin', test_profile=False)
            elif self.case == 'listener-cargo-escaped':
                listener = artifact(Path(self.supplied['ffmpeg']), manifest, name='ottplay-server', kind='bin')
            elif self.case == 'listener-cargo-relative':
                listener = artifact(Path('target/debug/deps/synthetic_listener'), manifest, name='ottplay-server', kind='bin')
            elif self.case == 'listener-cargo-symlink':
                alias = self.listener_executable.with_name('synthetic_listener_alias')
                alias.symlink_to(self.listener_executable)
                listener = artifact(alias, manifest, name='ottplay-server', kind='bin')
            elif self.case == 'listener-cargo-duplicate':
                listener += listener
            elif self.case == 'listener-cargo-missing':
                listener = ''
            return listener
        if name == 'listener-inventory':
            names = list(LISTENER_NAMES)
            if self.case == 'listener-inventory-empty':
                names = []
            elif self.case == 'listener-inventory-missing':
                names.pop(0)
            elif self.case == 'listener-inventory-wrong-prefix':
                names[-1] = 'synthetic_other_namespace::unselected_regression'
            elif self.case == 'listener-inventory-duplicate':
                names.append(names[0])
            return ''.join(value + ': test\n' for value in names)
        if name == 'listener-ignored-inventory':
            return LISTENER_NAMES[0] + ': test\n' if self.case == 'listener-inventory-ignored' else ''
        if name == 'listener-ordinary':
            if self.case == 'listener-budget-exhausted':
                self.driver.budget.work_deadline = self.driver.budget.clock() - 1
            names = () if self.case == 'listener-zero-executed' else LISTENER_NAMES
            text = suite_passed(names)
            if self.case == 'listener-final-test-failed':
                text = text.replace(LISTENER_NAMES[-1] + ' ... ok', LISTENER_NAMES[-1] + ' ... FAILED')
            elif self.case == 'listener-conflicting-summary':
                text += 'test result: FAILED. 0 passed; 1 failed; 0 ignored;\n'
            return text
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
            self.activation = self.output / 'target/debug/deps/multiview_activation-synthetic'
            self.broker_executable = self.output / 'target/debug/deps/multiview_broker_boundary-synthetic'
            self.normal_server = self.output / 'target/debug/ottplay-server'
            for executable in (self.activation, self.broker_executable, self.normal_server):
                executable.write_text('synthetic executable bytes; never executed')
                executable.chmod(0o700)
            if self.case == 'hardlinked-normal-server':
                os.link(self.normal_server, self.output / 'target/debug/deps/ottplay_server-normal')
            activation = artifact(self.activation, manifest, name='multiview_activation')
            normal = artifact(self.normal_server, manifest, name='ottplay-server', kind='bin',
                              test_profile=self.case == 'normal-server-test-profile')
            broker = artifact(self.broker_executable, manifest, name='multiview_broker_boundary')
            if self.case == 'broker-cargo-wrong-manifest':
                broker = artifact(self.broker_executable, self.root / 'src-rs/core/Cargo.toml',
                                  name='multiview_broker_boundary')
            elif self.case == 'broker-cargo-wrong-kind':
                broker = artifact(self.broker_executable, manifest, name='multiview_broker_boundary', kind='lib')
            elif self.case == 'broker-cargo-wrong-target':
                broker = artifact(self.broker_executable, manifest, name='synthetic_other_boundary')
            elif self.case == 'broker-cargo-wrong-profile':
                broker = artifact(self.broker_executable, manifest, name='multiview_broker_boundary', test_profile=False)
            elif self.case == 'broker-cargo-escaped':
                broker = artifact(Path(self.supplied['ffmpeg']), manifest, name='multiview_broker_boundary')
            elif self.case == 'broker-cargo-relative':
                broker = artifact(Path('target/debug/deps/synthetic_broker'), manifest, name='multiview_broker_boundary')
            elif self.case == 'broker-cargo-symlink':
                alias = self.broker_executable.with_name('synthetic_broker_alias')
                alias.symlink_to(self.broker_executable)
                broker = artifact(alias, manifest, name='multiview_broker_boundary')
            elif self.case == 'broker-cargo-duplicate':
                broker += broker
            elif self.case == 'broker-cargo-missing':
                broker = ''
            if self.case == 'missing-normal-server':
                normal = ''
            if self.case == 'duplicate-activation-target':
                activation += activation
            if self.case == 'escaped-activation-target':
                activation = artifact(Path(self.supplied['ffmpeg']), manifest, name='multiview_activation')
            return 'synthetic cargo diagnostic\n' + text + activation + broker + normal
        if name == 'broker-inventory':
            names = list(BROKER_NAMES)
            if self.case == 'broker-inventory-empty':
                names = []
            elif self.case == 'broker-inventory-missing':
                names.pop()
            elif self.case == 'broker-inventory-extra':
                names.append('synthetic_unreviewed_broker_boundary_test')
            elif self.case == 'broker-inventory-duplicate':
                names.append(names[0])
            return ''.join(value + ': test\n' for value in names)
        if name == 'broker-ignored-inventory':
            return BROKER_NAMES[0] + ': test\n' if self.case == 'broker-inventory-ignored' else ''
        if name == 'broker-ordinary':
            if self.case == 'broker-budget-exhausted':
                self.driver.budget.work_deadline = self.driver.budget.clock() - 1
            names = () if self.case == 'broker-zero-executed' else BROKER_NAMES
            text = suite_passed(names)
            if self.case == 'broker-final-test-failed':
                text = text.replace(BROKER_NAMES[-1] + ' ... ok', BROKER_NAMES[-1] + ' ... FAILED')
            elif self.case == 'broker-conflicting-summary':
                text += 'test result: FAILED. 0 passed; 1 failed; 0 ignored;\n'
            return text
        if name == 'activation-inventory':
            names = list(ACTIVATION_NAMES)
            if self.case == 'zero-activation-inventory':
                names = []
            elif self.case == 'missing-activation-test':
                names.pop()
            elif self.case == 'extra-activation-test':
                names.append('unreviewed_activation_test')
            return ''.join(value + ': test\n' for value in names)
        if name == 'activation-ignored-inventory':
            return ACTIVATION_NAMES[0] + ': test\n' if self.case == 'ignored-activation-test' else ''
        if name == 'activation-ordinary':
            if self.case in ('leaked-home-fixture', 'leaked-home-fixture-and-failed-test'):
                (self.home / '.ottplay-multiview-activation-new-owned').mkdir(mode=0o700)
            if self.case == 'changed-preexisting-home-fixture':
                self.preexisting_home_fixture.chmod(0o750)
            names = () if self.case == 'zero-activation-executed' else ACTIVATION_NAMES
            text = suite_passed(names)
            if self.case in ('failed-activation-test', 'leaked-home-fixture-and-failed-test'):
                text = text.replace(ACTIVATION_NAMES[0] + ' ... ok', ACTIVATION_NAMES[0] + ' ... FAILED')
            return text
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
            if name == 'fixture-4':
                case = Path(self.driver.env['OTTPLAY_MULTIVIEW_STREAM_CASE_DIR'])
                case.mkdir(mode=0o700)
                (case / 'archive').mkdir(mode=0o700)
                sealed = Path(self.driver.env['OTTPLAY_MULTIVIEW_STREAM_INPUTS'])
                manifest = json.loads(sealed.read_text())
                (case / 'CONTROL.json').write_text(json.dumps({
                    'pass': True, 'input_manifest_sha256': hashlib.sha256(sealed.read_bytes()).hexdigest(),
                    'inputs': manifest['inputs'],
                }) + '\n')
            if self.case == 'zero-tests':
                return 'running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 3 filtered out\n'
            text = passed(argv[1])
            if self.case == 'contradictory-status':
                text += 'test result: FAILED. 0 passed; 1 failed; 0 ignored;\n'
            if name == 'fixture-3' and self.case == 'changed-lock':
                (self.root / 'Cargo.lock').write_text('synthetic changed lock')
            if name == 'fixture-3' and self.case == 'changed-binary':
                self.executable.write_text('synthetic changed executable')
            if name == 'fixture-3' and self.case == 'changed-activation-binary':
                self.activation.write_text('synthetic changed activation executable')
            if name == 'fixture-3' and self.case == 'changed-normal-server':
                self.normal_server.write_text('synthetic changed normal server executable')
            if name == 'fixture-3' and self.case == 'changed-core-binary':
                self.core_executable.write_text('synthetic changed core executable')
            if name == 'fixture-3' and self.case == 'broker-late-binary-change':
                self.broker_executable.write_text('synthetic broker changed after its passing suite')
            if name == 'fixture-3' and self.case == 'broker-late-source-change':
                (self.root / 'src-rs/server/tests/multiview_broker_boundary.rs').write_text('synthetic changed broker source')
            if name == 'fixture-3' and self.case == 'listener-late-binary-change':
                self.listener_executable.write_text('synthetic listener changed after its passing suite')
            if name == 'fixture-3' and self.case == 'listener-late-source-change':
                (self.root / 'src-rs/server/src/main.rs').write_text('synthetic changed listener source')
            if name == 'fixture-3' and self.case == 'changed-system-tool':
                Path(self.supplied['mkfifo']).write_text('synthetic changed tool executable')
            if name == 'fixture-3' and self.case == 'retargeted-system-tool':
                replacement = self.directory / 'mkfifo-replacement'
                replacement.write_text('synthetic executable bytes; never executed')
                replacement.chmod(0o700)
                alias = Path(self.supplied['mkfifo'])
                alias.unlink()
                alias.symlink_to(replacement)
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


class BoundaryContracts(unittest.TestCase):
    def failed(self, attempt, reason):
        with self.assertRaises(RuntimeError):
            attempt.run()
        result = attempt.terminal()
        self.assertEqual(result['status'], 'fail')
        self.assertIn(reason, result['error'])
        self.assertFalse(result['production_admission'])
        self.assertFalse(result['sustained_media_e2e'])
        return result

    def test_broker_and_listener_gates_execute_exact_targets_and_preserve_existing_gates(self):
        for system in ('Linux', 'Darwin'):
            with self.subTest(system=system), Attempt(system=system) as attempt:
                attempt.run()
                result = attempt.terminal()
                names = [row['name'] for row in attempt.driver.commands]
                executed = next(row for row in attempt.driver.commands if row['name'] == 'broker-ordinary')
                self.assertEqual(executed['argv'], [str(attempt.broker_executable), '--test-threads=1', '--color=never'])
                self.assertEqual(executed['limit'], 180)
                self.assertLess(names.index('broker-ordinary'), names.index('fixture-1'))
                build = next(row for row in attempt.driver.commands if row['name'] == 'fixture-build')
                self.assertEqual(build['argv'].count('multiview_broker_boundary'), 1)
                self.assertIn('--test', build['argv'])
                self.assertEqual(build['limit'], 900)
                expected = hashlib.sha256(attempt.broker_executable.read_bytes()).hexdigest()
                self.assertEqual(result['broker_binary_sha256'], expected)
                self.assertEqual(result['ordinary_broker_tests'], sorted(BROKER_NAMES))
                receipt = json.loads((attempt.output / 'evidence/fixture-binary.json').read_text())
                self.assertEqual(receipt['broker_path'], str(attempt.broker_executable.relative_to(attempt.output)))
                self.assertEqual(receipt['broker_sha256'], expected)
                listener = next(row for row in attempt.driver.commands if row['name'] == 'listener-ordinary')
                self.assertEqual(listener['argv'], [str(attempt.listener_executable), 'listener_tests::',
                                                   '--test-threads=1', '--color=never'])
                self.assertEqual(listener['limit'], 180)
                self.assertLess(names.index('listener-ordinary'), names.index('fixture-1'))
                for label in ('listener-inventory', 'listener-ignored-inventory'):
                    command = next(row for row in attempt.driver.commands if row['name'] == label)
                    self.assertEqual(command['argv'][:2], [str(attempt.listener_executable), 'listener_tests::'])
                listener_build = next(row for row in attempt.driver.commands if row['name'] == 'listener-test-build')
                self.assertEqual(listener_build['limit'], 900)
                self.assertEqual(listener_build['argv'][listener_build['argv'].index('--bin') + 1], 'ottplay-server')
                self.assertNotIn('--test', listener_build['argv'])
                listener_sha = hashlib.sha256(attempt.listener_executable.read_bytes()).hexdigest()
                self.assertEqual(result['listener_binary_sha256'], listener_sha)
                self.assertEqual(result['ordinary_listener_tests'], sorted(LISTENER_NAMES))
                self.assertEqual(receipt['listener_path'], str(attempt.listener_executable.relative_to(attempt.output)))
                self.assertEqual(receipt['listener_sha256'], listener_sha)
                self.assertTrue(ci.LISTENER_REQUIRED_TESTS <= set(LISTENER_NAMES))
                self.assertNotEqual(attempt.listener_executable, attempt.normal_server)
                self.assertEqual(result['ordinary_activation_tests'], sorted(ACTIVATION_NAMES))
                self.assertEqual(result['tests'], list(EXPECTED_TESTS))
                self.assertTrue(result['streamed_media']['pass'])
                self.assertEqual(attempt.driver.budget.deadline, attempt.driver.budget.started + 1800)
                self.assertEqual(attempt.driver.budget.work_deadline, attempt.driver.budget.started + 1680)

    def test_broker_and_listener_cargo_targets_cannot_be_missing_ambiguous_foreign_or_unowned(self):
        cases = {'broker-cargo-wrong-manifest': 'Fixture manifest differs',
                 'broker-cargo-wrong-target': 'exactly one fixture executable',
                 'broker-cargo-wrong-kind': 'exactly one fixture executable',
                 'broker-cargo-wrong-profile': 'Expected actual test executable profile',
                 'broker-cargo-escaped': 'Fixture executable escaped owned target',
                 'broker-cargo-relative': 'Fixture executable escaped owned target',
                 'broker-cargo-symlink': 'Fixture executable escaped owned target',
                 'broker-cargo-duplicate': 'exactly one fixture executable',
                 'broker-cargo-missing': 'exactly one fixture executable',
                 'listener-cargo-wrong-manifest': 'Fixture manifest differs',
                 'listener-cargo-wrong-target': 'exactly one fixture executable',
                 'listener-cargo-wrong-kind': 'exactly one fixture executable',
                 'listener-cargo-wrong-profile': 'Expected actual test executable profile',
                 'listener-cargo-escaped': 'Fixture executable escaped owned target',
                 'listener-cargo-relative': 'Fixture executable escaped owned target',
                 'listener-cargo-symlink': 'Fixture executable escaped owned target',
                 'listener-cargo-duplicate': 'exactly one fixture executable',
                 'listener-cargo-missing': 'exactly one fixture executable'}
        for case, reason in cases.items():
            with self.subTest(case=case), Attempt(case) as attempt:
                self.failed(attempt, reason)
                names = [row['name'] for row in attempt.driver.commands]
                self.assertIn('fixture-build', names)
                if case.startswith('listener-'):
                    self.assertIn('listener-test-build', names)
                self.assertNotIn('broker-ordinary', names)

    def test_broker_and_listener_inventories_and_results_cannot_false_green(self):
        cases = {'default-empty': 'Frozen nonempty ordinary broker inventory required',
                 'broker-inventory-empty': 'Exact ordinary broker inventory differs or contains ignored tests',
                 'broker-inventory-missing': 'Exact ordinary broker inventory differs or contains ignored tests',
                 'broker-inventory-extra': 'Exact ordinary broker inventory differs or contains ignored tests',
                 'broker-inventory-duplicate': 'Duplicate ignored fixture inventory',
                 'broker-inventory-ignored': 'Exact ordinary broker inventory differs or contains ignored tests',
                 'broker-zero-executed': 'Ordinary suite count differs',
                 'broker-final-test-failed': 'Ordinary suite execution/status differs',
                 'broker-conflicting-summary': 'Ordinary suite summary differs',
                 'listener-inventory-empty': 'Ordinary listener namespace inventory differs or contains ignored tests',
                 'listener-inventory-missing': 'Ordinary listener namespace inventory differs or contains ignored tests',
                 'listener-inventory-wrong-prefix': 'Ordinary listener namespace inventory differs or contains ignored tests',
                 'listener-inventory-duplicate': 'Duplicate ignored fixture inventory',
                 'listener-inventory-ignored': 'Ordinary listener namespace inventory differs or contains ignored tests',
                 'listener-zero-executed': 'Ordinary suite count differs',
                 'listener-final-test-failed': 'Ordinary suite execution/status differs',
                 'listener-conflicting-summary': 'Ordinary suite summary differs'}
        for case, reason in cases.items():
            with self.subTest(case=case), Attempt(case) as attempt:
                patch = (mock.patch.object(ci, 'BROKER_TESTS', frozenset())
                         if case == 'default-empty' else contextlib.nullcontext())
                with patch:
                    self.failed(attempt, reason)
                names = [row['name'] for row in attempt.driver.commands]
                self.assertNotIn('fixture-1', names)
                if case == 'default-empty':
                    self.assertEqual(names, [])
                else:
                    stage = 'listener' if case.startswith('listener-') else 'broker'
                    self.assertIn(stage + '-inventory', names)
                    if case.endswith(('zero-executed', 'final-test-failed', 'conflicting-summary')):
                        self.assertIn(stage + '-ordinary', names)

    def test_broker_and_listener_late_failures_mutation_budget_and_cleanup_remain_terminal(self):
        cases = {'broker-nonzero-exit': 'Synthetic broker command exited nonzero after successful stdout',
                 'broker-late-binary-change': 'Broker test executable changed',
                 'broker-late-source-change': 'Source or root lock changed',
                 'broker-budget-exhausted': 'Original CI deadline exhausted',
                 'broker-cleanup-unknown': 'Owned process cleanup unknown',
                 'listener-nonzero-exit': 'Synthetic listener command exited nonzero after successful stdout',
                 'listener-late-binary-change': 'Listener test executable changed',
                 'listener-late-source-change': 'Source or root lock changed',
                 'listener-budget-exhausted': 'Original CI deadline exhausted',
                 'listener-cleanup-unknown': 'Owned process cleanup unknown'}
        for case, reason in cases.items():
            with self.subTest(case=case), Attempt(case) as attempt:
                self.failed(attempt, reason)
                names = [row['name'] for row in attempt.driver.commands]
                stage = 'listener' if case.startswith('listener-') else 'broker'
                self.assertIn(stage + '-ordinary', names)
                if case.endswith(('late-binary-change', 'late-source-change', 'cleanup-unknown')):
                    self.assertIn('fixture-4', names)
                if case.endswith('nonzero-exit'):
                    transcript = (attempt.output / f'evidence/logs/{stage}-ordinary.log').read_text()
                    self.assertIn('test result: ok.', transcript)
                    entry = next(row for row in attempt.driver.commands if row['name'] == stage + '-ordinary')
                    self.assertTrue(entry['cleanup_confirmed'])


class CoreRequiredContracts(unittest.TestCase):
    def test_each_frozen_authority_regression_is_mandatory_and_cannot_be_ignored(self):
        self.assertEqual(ci.CORE_REQUIRED_TESTS, frozenset(CORE_REQUIRED_NAMES))
        self.assertEqual(len(CORE_REQUIRED_NAMES), 3)
        for required in CORE_REQUIRED_NAMES:
            for state in ('missing', 'ignored'):
                with self.subTest(required=required, state=state), Attempt() as attempt:
                    original = attempt.response
                    def response(name, argv):
                        text = original(name, argv)
                        if name == 'core-multiview-inventory' and state == 'missing':
                            return '\n'.join(line for line in text.splitlines() if line != required + ': test') + '\n'
                        if name == 'core-multiview-ignored-inventory' and state == 'ignored':
                            return text + required + ': test\n'
                        return text
                    with mock.patch.object(attempt, 'response', side_effect=response):
                        with self.assertRaises(RuntimeError):
                            attempt.run()
                    result = attempt.terminal()
                    self.assertEqual(result['status'], 'fail')
                    self.assertIn('Required ordinary core regression is absent or ignored', result['error'])
                    names = [row['name'] for row in attempt.driver.commands]
                    self.assertIn('core-multiview-inventory', names)
                    self.assertIn('core-multiview-ignored-inventory', names)
                    self.assertNotIn('core-multiview-ordinary', names)
                    self.assertNotIn('fixture-1', names)


class StreamedContracts(unittest.TestCase):
    def test_original_deadlines_preserve_exact_absolute_fractional_clock(self):
        for started in (1234.56789, 298.56789, 522538.56789):
            with self.subTest(started=started):
                self.assertNotEqual((started + 1800) - started, 1800)
                with mock.patch.object(ci.time, "monotonic", return_value=started), Attempt() as attempt:
                    attempt.run()
                    self.assertEqual(attempt.driver.budget.started, started)
                    self.assertEqual(attempt.driver.budget.deadline, started + 1800)
                    self.assertEqual(attempt.driver.budget.work_deadline, started + 1680)
                    self.assertEqual(attempt.terminal()["status"], "pass")

    def test_changed_or_oversized_media_source_is_refused_before_import(self):
        with tempfile.TemporaryDirectory(prefix="stream-source-guard-offline-") as raw:
            root = Path(raw).resolve()
            (root / "scripts").mkdir()
            path = root / "scripts/ci-multiview-unix-media.py"
            path.write_text('raise AssertionError("Changed analyzer must never execute")\n')
            with self.assertRaisesRegex(RuntimeError, "Reviewed stream analyzer changed"):
                ci.load_stream_media(root, guard.Budget())
            path.write_bytes(b"#" * (256 * 1024 + 1))
            with self.assertRaisesRegex(RuntimeError, "Nonregular/linked/oversized input"):
                ci.load_stream_media(root, guard.Budget())

    def failed(self, attempt, reason):
        with self.assertRaisesRegex(RuntimeError, "Unix fixture qualification failed"):
            attempt.run()
        result = attempt.terminal()
        self.assertEqual(result["status"], "fail")
        self.assertIn(reason, result["error"])
        self.assertFalse(result["production_admission"])
        self.assertFalse(result["sustained_media_e2e"])
        return result

    def test_fourth_fixture_requires_full_ordered_analyzer_and_owned_receipts(self):
        with Attempt() as attempt:
            attempt.run()
            result = attempt.terminal()
            self.assertIs(result["streamed_media"]["pass"], True)
            self.assertEqual(attempt.media.calls, ["self_test", "prepare_inputs", "seal_inputs",
                             "prepare_audio", "prepare_video", "finish"])
            commands = {row["name"]: row for row in attempt.driver.commands}
            fourth = commands["fixture-4"]
            self.assertEqual(fourth["limit"], 110)
            self.assertEqual(fourth["argv"][1:], ["streamed_session_two_owner_continuity",
                             "--ignored", "--exact", "--test-threads=1", "--color=never"])
            names = [row["name"] for row in attempt.driver.commands]
            self.assertLess(names.index("activation-ordinary"), names.index("fixture-4"))
            self.assertLess(names.index("stream-source-2-transport"), names.index("fixture-4"))
            self.assertLess(names.index("fixture-4"), names.index("stream-video-probe"))
            self.assertEqual(result["ordinary_activation_tests"], sorted(ACTIVATION_NAMES))
            self.assertEqual(len(result["streamed_input_evidence"]), 3)
            self.assertEqual(attempt.driver.budget.deadline, attempt.driver.budget.started + 1800)
            self.assertEqual(attempt.driver.budget.work_deadline, attempt.driver.budget.started + 1680)
            self.assertTrue(result["streamed_media_evidence"])
            for row in result["streamed_media_evidence"]:
                self.assertFalse(row["relative_name"].endswith(".rgb"))
            for path in (attempt.media.input_manifest,
                         *(attempt.media.inputs_root / f"source-{number}.ts" for number in (1, 2))):
                self.assertFalse(path.stat().st_mode & 0o222)
            self.assertNotIn("OTTPLAY_MULTIVIEW_STREAM_INPUTS", attempt.driver.env)
            self.assertNotIn("OTTPLAY_MULTIVIEW_STREAM_CASE_DIR", attempt.driver.env)

    def test_passed_libtest_cannot_replace_failed_or_absent_analyzer_result(self):
        for fault in ("false-pass", "truthy-pass", "missing-pass", "absent-packet",
                      "wrong-schema", "wrong-helper", "structural"):
            with self.subTest(fault=fault), Attempt() as attempt:
                original = attempt.media.finish
                def finish(case, work):
                    if fault == "structural":
                        raise ValueError("Synthetic analyzer structural refusal")
                    packet = original(case, work)
                    if fault == "absent-packet":
                        return None
                    if fault == "false-pass":
                        packet["result"]["pass"] = False
                    elif fault == "truthy-pass":
                        packet["result"]["pass"] = 1
                    elif fault == "missing-pass":
                        del packet["result"]["pass"]
                    elif fault == "wrong-schema":
                        packet["result"]["schema"] = "wrong.schema"
                    else:
                        packet["result"]["helper_sha256"] = "0" * 64
                    return packet
                with mock.patch.object(attempt.media, "finish", side_effect=finish):
                    result = self.failed(attempt, "Synthetic analyzer structural refusal" if fault == "structural"
                                         else "Stream media analyzer did not qualify")
                self.assertNotIn("streamed_media", result)
                self.assertIn("fixture-4", [row["name"] for row in attempt.driver.commands])
                self.assertIs(result["streamed_forensic"]["qualified"], False)

    def test_success_packet_requires_complete_evidence_and_matching_hash_bindings(self):
        faults = ("empty", "missing-archive", "missing-pcm", "missing-observation",
                  "qualification-mismatch", "bad-sequence", "bad-count", "bad-case-hash", "bad-pcm-hash")
        for fault in faults:
            with self.subTest(fault=fault), Attempt() as attempt:
                original = attempt.media.finish
                def finish(case, work):
                    packet = original(case, work)
                    if fault == "empty":
                        packet["evidence"] = []
                    elif fault in ("missing-archive", "missing-pcm", "missing-observation"):
                        def keep(row):
                            name = row["relative_name"]
                            return not (fault == "missing-archive" and name.startswith("stream-media/case/archive/")
                                        or fault == "missing-pcm" and name.endswith("B-prefix.s16")
                                        or fault == "missing-observation" and "/observations/" in name)
                        packet["evidence"] = list(filter(keep, packet["evidence"]))
                    elif fault == "qualification-mismatch":
                        (Path(work) / "qualification.json").write_text('{"pass":false}\n')
                    elif fault in ("bad-sequence", "bad-count"):
                        path = Path(case) / "archive/ARCHIVE.json"
                        archive = json.loads(path.read_text())
                        if fault == "bad-sequence":
                            archive["segments"][0]["sequence"] = 1
                        else:
                            archive["segment_count"] = 2
                        path.write_text(json.dumps(archive))
                    else:
                        key = "case_sha256" if fault == "bad-case-hash" else "work_pcm_sha256"
                        name = "CONTROL.json" if fault == "bad-case-hash" else "B-prefix.s16"
                        packet["result"][key][name] = "0" * 64
                        (Path(work) / "qualification.json").write_text(json.dumps(packet["result"]))
                    return packet
                reason = ("Incomplete stream media evidence inventory" if fault.startswith("missing-") or fault == "empty"
                          else "Stream analyzer result/evidence differ" if fault == "qualification-mismatch"
                          else "Stream archive sequence inventory differs" if fault == "bad-sequence"
                          else "Invalid stream archive evidence inventory" if fault == "bad-count"
                          else "Stream analyzer hashes do not bind adopted evidence")
                with mock.patch.object(attempt.media, "finish", side_effect=finish):
                    result = self.failed(attempt, reason)
                self.assertIn("finish", attempt.media.calls)
                self.assertNotIn("streamed_media", result)

    def test_selftest_and_required_mux_capability_refuse_before_input_commands(self):
        for fault in ("missing-negative", "tools-started", "long-media", "missing-mux", "description-only-mux"):
            with self.subTest(fault=fault), Attempt() as attempt:
                if "mux" in fault:
                    original = attempt.response
                    def response(name, argv):
                        if name == "stream-stats-mux-pre":
                            return "Description mentions -stats_mux_pre but no option row" if fault == "description-only-mux" else ""
                        return original(name, argv)
                    patch = mock.patch.object(attempt, "response", side_effect=response)
                    reason = "FFmpeg stats_mux_pre is required"
                else:
                    report = attempt.media.self_test()
                    if fault == "missing-negative":
                        del report["reject_898_interleaved_counter"]
                    else:
                        report["tools_started" if fault == "tools-started" else "long_media_generated"] = True
                    patch = mock.patch.object(attempt.media, "self_test", return_value=report)
                    reason = "Stream analyzer negative controls failed"
                with patch:
                    self.failed(attempt, reason)
                self.assertFalse(any(row["name"].startswith("stream-source-") for row in attempt.driver.commands))

    def test_fourth_zero_ignored_or_wrong_execution_never_reaches_analysis(self):
        for fault in ("zero", "ignored", "wrong", "duplicate"):
            with self.subTest(fault=fault), Attempt() as attempt:
                original = attempt.response
                def response(name, argv):
                    text = original(name, argv)
                    if name != "fixture-4":
                        return text
                    if fault == "zero":
                        return "running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;\n"
                    if fault == "ignored":
                        return text.replace(" ... ok", " ... ignored").replace("1 passed; 0 failed; 0 ignored", "0 passed; 0 failed; 1 ignored")
                    if fault == "wrong":
                        return passed("wrong_streamed_fixture")
                    return text + text
                with mock.patch.object(attempt, "response", side_effect=response):
                    self.failed(attempt, "Expected exactly one executed test" if fault in ("zero", "duplicate")
                                else "Exact fixture did not pass")
                self.assertNotIn("prepare_audio", attempt.media.calls)
                self.assertNotIn("finish", attempt.media.calls)

    def test_command_deadline_argv_and_probe_output_boundaries(self):
        for fault in ("wrong-count", "wrong-deadline", "unattested-tool", "network", "escaped-probe"):
            with self.subTest(fault=fault), Attempt() as attempt:
                method = "prepare_audio" if fault == "escaped-probe" else "prepare_inputs"
                original = getattr(attempt.media, method)
                def prepare(*args):
                    specs = original(*args)
                    if fault == "wrong-count":
                        return specs[:-1]
                    if fault == "wrong-deadline":
                        specs[0]["timeout_seconds"] += 1
                    elif fault == "unattested-tool":
                        specs[0]["argv"][0] = "/synthetic/unattested"
                    elif fault == "network":
                        specs[0]["argv"].insert(1, "https://synthetic.invalid/input")
                    elif fault == "escaped-probe":
                        specs[0]["stdout_file"] = str(attempt.directory / "escape.json")
                    return specs
                reason = {"wrong-count": "Stream command inventory differs",
                          "wrong-deadline": "Stream command identity or deadline differs",
                          "unattested-tool": "Unattested, external or redirected stream command",
                          "network": "Unattested, external or redirected stream command",
                          "escaped-probe": "Unexpected stream stdout"}[fault]
                with mock.patch.object(attempt.media, method, side_effect=prepare):
                    self.failed(attempt, reason)

    def test_sealed_input_and_control_binding_refuse_tampering(self):
        for fault in ("manifest-geometry", "manifest-duration-old", "manifest-duration-long",
                      "manifest-id", "payload", "control-hash", "control-inputs"):
            with self.subTest(fault=fault), Attempt() as attempt:
                if fault.startswith("control-"):
                    original = attempt.response
                    def response(name, argv):
                        text = original(name, argv)
                        if name == "fixture-4":
                            path = Path(attempt.driver.env["OTTPLAY_MULTIVIEW_STREAM_CASE_DIR"]) / "CONTROL.json"
                            value = json.loads(path.read_text())
                            if fault == "control-hash":
                                value["input_manifest_sha256"] = "0" * 64
                            else:
                                value["inputs"][0]["id"] = 9
                            path.write_text(json.dumps(value))
                        return text
                    patch = mock.patch.object(attempt, "response", side_effect=response)
                    reason = "Stream CONTROL is not bound"
                else:
                    original = attempt.media.seal_inputs
                    def seal(root):
                        path = original(root)
                        value = json.loads(path.read_text())
                        if fault == "manifest-geometry":
                            value["width"] = 97
                        elif fault in ("manifest-duration-old", "manifest-duration-long"):
                            value["seconds"] = 80 if fault == "manifest-duration-old" else 91
                        elif fault == "manifest-id":
                            value["inputs"][0]["id"] = 2
                        else:
                            Path(value["inputs"][0]["path"]).write_bytes(b"changed payload")
                        path.write_text(json.dumps(value))
                        return path
                    patch = mock.patch.object(attempt.media, "seal_inputs", side_effect=seal)
                    reason = {"manifest-geometry": "Sealed stream input schema differs",
                              "manifest-duration-old": "Sealed stream input schema differs",
                              "manifest-duration-long": "Sealed stream input schema differs",
                              "manifest-id": "Sealed stream input row differs",
                              "payload": "Sealed stream input payload differs"}[fault]
                with patch:
                    self.failed(attempt, reason)
                self.assertNotIn("prepare_audio", attempt.media.calls)

    def test_forensics_cannot_mask_primary_failure_or_skip_owned_cleanup(self):
        primary = "Synthetic fourth fixture failed after owned process cleanup"
        for fault in ("valid", "collector-fails", "wrong-qualified", "adoption-fails", "partial-malformed"):
            with self.subTest(fault=fault), Attempt() as attempt:
                original_response = attempt.response
                def response(name, argv):
                    text = original_response(name, argv)
                    if name == "fixture-4":
                        if fault == "partial-malformed":
                            path = Path(attempt.driver.env["OTTPLAY_MULTIVIEW_STREAM_CASE_DIR"]) / "CONTROL.json"
                            path.write_text("{")
                        raise RuntimeError(primary)
                    return text
                original_forensic = attempt.media.failure_evidence
                def forensic(case, work):
                    if fault == "collector-fails":
                        raise ValueError("Synthetic forensic collector failed")
                    report = original_forensic(case, work)
                    if fault == "wrong-qualified":
                        report["qualified"] = True
                    elif fault == "adoption-fails":
                        report["evidence"][0]["relative_name"] = "stream-media-forensic/analysis/video-00.rgb"
                    elif fault == "partial-malformed":
                        report["errors"] = ["MALFORMED_STRUCTURE"]
                    return report
                with mock.patch.object(attempt, "response", side_effect=response), \
                     mock.patch.object(attempt.media, "failure_evidence", side_effect=forensic):
                    result = self.failed(attempt, primary)
                self.assertEqual(result["error"], primary)
                self.assertTrue(all(row["cleanup_confirmed"] for row in attempt.driver.commands))
                self.assertTrue(result["activation_fixture_cleanup_confirmed"])
                self.assertNotIn("OTTPLAY_MULTIVIEW_STREAM_CASE_DIR", attempt.driver.env)
                if fault in ("valid", "partial-malformed"):
                    self.assertIs(result["streamed_forensic"]["qualified"], False)
                    self.assertTrue(result["streamed_forensic"]["incomplete"])
                    if fault == "partial-malformed":
                        adopted = attempt.output / "evidence/stream-media-forensic/case/CONTROL.json"
                        self.assertEqual(adopted.read_text(), "{")
                else:
                    self.assertIn("streamed_forensic_error", result)

    def test_large_jsonl_bound_and_cumulative_cap_are_not_weakened(self):
        with tempfile.TemporaryDirectory(prefix="stream-evidence-offline-") as raw:
            root = Path(raw).resolve()
            roots = tuple(root / name for name in ("inputs", "case", "analysis"))
            for path in roots:
                path.mkdir()
            evidence = root / "evidence"
            evidence.mkdir()
            driver = types.SimpleNamespace(evidence=evidence)
            path = roots[1] / "EVENTS.jsonl"
            payload = b'{"phase":"synthetic","snapshot":{}}\n' * 130000
            self.assertGreater(len(payload), 4 * 1024**2)
            self.assertLess(len(payload), 8 * 1024**2)
            path.write_bytes(payload)
            spec = {"path": str(path), "relative_name": "stream-media/case/EVENTS.jsonl",
                    "max_bytes": 8 * 1024**2}
            receipts = ci.adopt_stream_evidence(driver, guard.Budget(), [spec], roots)
            self.assertEqual(receipts[0]["sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual((evidence / spec["relative_name"]).read_bytes(), payload)
            other = roots[1] / "CONTROL.json"
            other.write_bytes(b"{}")
            budget = guard.Budget()
            budget.evidence_total = guard.EVIDENCE_CAP - 1
            with self.assertRaisesRegex(RuntimeError, "Incremental evidence cap exceeded"):
                ci.adopt_stream_evidence(driver, budget, [{"path": str(other),
                    "relative_name": "stream-media/case/CONTROL.json", "max_bytes": 1024**2}], roots)
            with path.open("wb") as stream:
                stream.truncate(8 * 1024**2 + 1)
            with self.assertRaisesRegex(RuntimeError, "Nonregular/linked/oversized input"):
                ci.stream_read(path, roots[1], 8 * 1024**2, guard.Budget())

    def test_evidence_allowlist_and_single_link_custody_are_unchanged(self):
        for fault in ("symlink", "hardlink", "fifo", "escape", "rgb", "duplicate", "oversized-spec"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix="stream-custody-offline-") as raw:
                root = Path(raw).resolve()
                roots = tuple(root / name for name in ("inputs", "case", "analysis"))
                for path in roots:
                    path.mkdir()
                evidence = root / "evidence"
                evidence.mkdir()
                source = roots[1] / "CONTROL.json"
                source.write_bytes(b"{}")
                spec = {"path": str(source), "relative_name": "stream-media/case/CONTROL.json",
                        "max_bytes": 1024**2}
                if fault in ("symlink", "hardlink"):
                    actual = roots[1] / "actual.json"
                    source.rename(actual)
                    if fault == "symlink":
                        source.symlink_to(actual)
                    else:
                        os.link(actual, source)
                elif fault == "fifo":
                    source.unlink()
                    os.mkfifo(source)
                elif fault == "escape":
                    spec["path"] = str(root / "outside.json")
                elif fault == "rgb":
                    spec["relative_name"] = "stream-media/analysis/video-00.rgb"
                elif fault == "oversized-spec":
                    spec["max_bytes"] += 1
                specs = [spec, spec] if fault == "duplicate" else [spec]
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    ci.adopt_stream_evidence(types.SimpleNamespace(evidence=evidence), guard.Budget(), specs, roots)

    def test_terminal_cap_preserves_primary_error_and_restores_previous_env(self):
        primary = "Synthetic original failure with exhausted remaining evidence budget"
        with Attempt() as attempt:
            original = attempt.response
            def response(name, argv):
                text = original(name, argv)
                if name == "fixture-4":
                    attempt.driver.budget.evidence_total = guard.EVIDENCE_CAP
                    raise RuntimeError(primary)
                return text
            previous = {"OTTPLAY_MULTIVIEW_STREAM_INPUTS": "/synthetic/old-inputs.json",
                        "OTTPLAY_MULTIVIEW_STREAM_CASE_DIR": "/synthetic/old-case"}
            with mock.patch.dict(os.environ, previous), \
                 mock.patch.object(attempt, "response", side_effect=response):
                with self.assertRaisesRegex(RuntimeError, primary):
                    attempt.run()
            self.assertFalse((attempt.output / "evidence/terminal.json").exists())
            self.assertTrue(all(row["cleanup_confirmed"] for row in attempt.driver.commands))
            for key, value in previous.items():
                self.assertEqual(attempt.driver.env[key], value)


class ParsingTests(unittest.TestCase):
    def test_captured_filter_rows_and_legacy_three_flags_are_supported(self):
        self.assertEqual(ci.filter_names(CAPTURED_FILTER_ROWS), ci.FILTERS)
        legacy = '\n'.join(line.replace(line.split()[0], line.split()[0] + '.', 1)
                           for line in CAPTURED_FILTER_ROWS.splitlines())
        self.assertEqual(ci.filter_names(legacy), ci.FILTERS)
        # Both actual tables retain three-character legends above two-flag rows.
        legend = 'Filters:\n T.. = Timeline support\n .S. = Slice threading\n'
        self.assertTrue(ci.FILTERS <= ci.filter_names(legend + CAPTURED_FILTER_ROWS))

    def test_missing_filters_and_description_only_mentions_cannot_qualify(self):
        for missing in ci.FILTERS:
            with self.subTest(missing=missing):
                rows = '\n'.join(line for line in CAPTURED_FILTER_ROWS.splitlines()
                                 if line.split()[1] != missing)
                rows += '\n .. unrelated V->V Description mentions ' + missing + '\n'
                self.assertFalse(ci.FILTERS <= ci.filter_names(rows))
        self.assertFalse(ci.FILTERS <= ci.filter_names('\n'.join(
            'Available filter ' + name for name in ci.FILTERS)))

    def test_pinned_guard_and_exact_existing_fixture_inventory(self):
        self.assertEqual(hashlib.sha256(REFERENCE.read_bytes()).hexdigest(), ci.GUARD_SHA256)
        self.assertEqual(tuple(name for name, _ in ci.TESTS), EXPECTED_TESTS)
        self.assertEqual(len(ci.BROKER_TESTS), 55)
        self.assertEqual(hashlib.sha256("\n".join(sorted(ci.BROKER_TESTS)).encode("utf8")).hexdigest(),
                         "6e92eb3d53b6de4ae38ec7bdfdef92883e87f4a2e887efe2c4539b20a1fc4f9f")

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


class SystemToolIdentityTests(unittest.TestCase):
    def executable(self, root, name='tool', data=b'synthetic executable bytes; never run'):
        path = root / name
        path.write_bytes(data)
        path.chmod(0o700)
        return path

    def test_regular_symlink_and_hardlink_receipts_hash_actual_bytes(self):
        with tempfile.TemporaryDirectory(prefix='multiview-system-tool-offline-') as raw:
            root = Path(raw).resolve()
            tool = self.executable(root)
            hardlink = root / 'hardlink'
            os.link(tool, hardlink)
            alias = root / 'alias'
            alias.symlink_to(tool)
            for requested in (tool, hardlink, alias):
                with self.subTest(requested=requested):
                    result = ci.system_tool_identity(requested, guard.Budget())
                    self.assertEqual(result['requested_path'], str(requested))
                    self.assertEqual(result['path'], str(requested.resolve()))
                    self.assertEqual(result['sha256'], hashlib.sha256(tool.read_bytes()).hexdigest())
                    info = requested.resolve().stat()
                    for key, value in {'bytes': info.st_size, 'device': info.st_dev,
                            'inode': info.st_ino, 'mode': info.st_mode, 'nlink': info.st_nlink,
                            'mtime_ns': info.st_mtime_ns, 'ctime_ns': info.st_ctime_ns}.items():
                        self.assertEqual(result[key], value)
            # The new role-specific reader must not weaken source/evidence guards.
            for path in (tool, hardlink, alias):
                with self.assertRaisesRegex(RuntimeError, 'Hash input not bounded regular file'):
                    guard.Budget().digest(path)

    def test_nonregular_nonexecutable_empty_and_oversized_are_refused_before_open(self):
        with tempfile.TemporaryDirectory(prefix='multiview-system-refusal-offline-') as raw:
            root = Path(raw).resolve()
            plain = self.executable(root, 'plain')
            plain.chmod(0o600)
            empty = self.executable(root, 'empty', b'')
            oversized = self.executable(root, 'oversized', b'0123456789')
            fifo = root / 'fifo'
            os.mkfifo(fifo)
            for path, cap in ((root, 1024), (fifo, 1024), (plain, 1024), (empty, 1024), (oversized, 4)):
                with self.subTest(path=path), mock.patch.object(ci.os, 'open',
                        side_effect=AssertionError('Rejected input must not be opened')):
                    with self.assertRaisesRegex(RuntimeError, 'bounded regular executable'):
                        ci.system_tool_identity(path, guard.Budget(), cap=cap)

    def test_deadline_expires_during_bounded_identity_read(self):
        with tempfile.TemporaryDirectory(prefix='multiview-system-deadline-offline-') as raw:
            path = self.executable(Path(raw).resolve())
            now = [0]
            def clock():
                now[0] += 1
                return now[0]
            budget = guard.Budget(clock=clock)
            budget.work_deadline = now[0] + 3
            with self.assertRaises(guard.DeadlineError):
                ci.system_tool_identity(path, budget)

    def test_midread_mutation_and_alias_retarget_are_refused(self):
        for case in ('same-size-bytes-change', 'file-growth', 'alias-retarget'):
            with self.subTest(case=case), tempfile.TemporaryDirectory(prefix='multiview-system-race-offline-') as raw:
                root = Path(raw).resolve()
                tool = self.executable(root, data=b'original bytes')
                replacement = self.executable(root, 'replacement', b'other bytes')
                alias = root / 'alias'
                alias.symlink_to(tool)
                original_fdopen = ci.os.fdopen
                changed = [False]
                class MutatingReader:
                    def __init__(self, stream):
                        self.stream = stream
                    def __enter__(self):
                        self.stream.__enter__()
                        return self
                    def __exit__(self, *args):
                        return self.stream.__exit__(*args)
                    def fileno(self):
                        return self.stream.fileno()
                    def read(self, count):
                        if not changed[0]:
                            changed[0] = True
                            if case == 'alias-retarget':
                                alias.unlink()
                                alias.symlink_to(replacement)
                            else:
                                tool.write_bytes(b'changed! bytes' if case == 'same-size-bytes-change'
                                                 else b'original bytes plus unexpected growth')
                        return self.stream.read(count)
                def fdopen(*args, **kwargs):
                    return MutatingReader(original_fdopen(*args, **kwargs))
                with mock.patch.object(ci.os, 'fdopen', side_effect=fdopen):
                    with self.assertRaisesRegex(RuntimeError, 'System tool (changed|grew|path identity changed)'):
                        ci.system_tool_identity(alias, guard.Budget())
                self.assertTrue(changed[0])


class ActivationHomeTests(unittest.TestCase):
    def test_actual_home_ancestry_is_attested_and_unsafe_owners_or_modes_are_denied(self):
        home = Path('/synthetic/ci-home')
        driver = types.SimpleNamespace(env={'HOME': str(home)})
        budget = types.SimpleNamespace(tick=lambda: None)
        for case in ('good', 'writable-parent', 'foreign-owner', 'symlink-parent', 'foreign-home'):
            seen = []
            def info(path, case=case, seen=seen):
                path = Path(path)
                seen.append(path)
                mode, owner = stat.S_IFDIR | 0o755, os.geteuid()
                if path == home.parent:
                    if case == 'writable-parent':
                        mode |= 0o020
                    if case == 'foreign-owner':
                        owner = max(os.geteuid(), 0) + 10000
                    if case == 'symlink-parent':
                        mode = stat.S_IFLNK | 0o755
                if path == home and case == 'foreign-home':
                    owner = max(os.geteuid(), 0) + 10000
                return types.SimpleNamespace(st_mode=mode, st_uid=owner, st_dev=1, st_ino=1)
            with self.subTest(case=case), mock.patch.object(Path, 'resolve', return_value=home), \
                 mock.patch.object(Path, 'lstat', info):
                if case == 'good':
                    result = ci.activation_home_preflight(driver, budget)
                    self.assertEqual(result['parent'], str(home))
                    self.assertEqual(seen, [home, *home.parents])
                    self.assertTrue(result['production_loader_unchanged'])
                else:
                    with self.assertRaisesRegex(RuntimeError, 'activation fixture HOME'):
                        ci.activation_home_preflight(driver, budget)


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
    def test_home_fixtures_are_never_deleted_and_new_leaks_fail_even_when_tests_fail(self):
        with Attempt('preexisting-home-fixture') as attempt:
            attempt.run()
            self.assertTrue(attempt.preexisting_home_fixture.is_dir())
            self.assertTrue(attempt.terminal()['activation_fixture_cleanup_confirmed'])
        for case in ('leaked-home-fixture', 'leaked-home-fixture-and-failed-test',
                     'changed-preexisting-home-fixture'):
            with self.subTest(case=case), Attempt(case) as attempt:
                with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                    attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['status'], 'fail')
                self.assertFalse(result['activation_fixture_cleanup_confirmed'])
                self.assertIn('activation fixture HOME', result['activation_fixture_cleanup_error'].replace('Activation', 'activation'))
                if case == 'changed-preexisting-home-fixture':
                    self.assertTrue(attempt.preexisting_home_fixture.exists())
                else:
                    self.assertTrue((attempt.home / '.ottplay-multiview-activation-new-owned').is_dir())
                if case == 'leaked-home-fixture-and-failed-test':
                    self.assertIn('Ordinary suite execution/status differs', result['error'])

    def test_activation_runs_exact_reviewed_tests_with_normal_binary_and_existing_suites(self):
        self.assertEqual(set(ACTIVATION_NAMES), ci.ACTIVATION_TESTS)
        self.assertEqual(len(ACTIVATION_NAMES), 8)
        for system, case in (('Linux', None), ('Darwin', None), ('Linux', 'hardlinked-normal-server'),
                             ('Darwin', 'libressl-version')):
            with self.subTest(system=system, case=case), Attempt(case, system=system) as attempt:
                attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['ordinary_activation_tests'], sorted(ACTIVATION_NAMES))
                self.assertEqual(result['activation_fixture_parent']['parent'], str(attempt.home))
                build = next(c for c in attempt.driver.commands if c['name'] == 'fixture-build')
                self.assertIn('multiview_activation', build['argv'])
                self.assertIn('multiview_fixtures', build['argv'])
                self.assertEqual(build['limit'], 900)
                executed = next(c for c in attempt.driver.commands if c['name'] == 'activation-ordinary')
                self.assertEqual(executed['limit'], 180)
                self.assertNotIn('--ignored', executed['argv'])
                self.assertEqual(executed['argv'][0], str(attempt.activation))
                self.assertEqual(result['normal_server_binary_sha256'], hashlib.sha256(attempt.normal_server.read_bytes()).hexdigest())
                if case == 'hardlinked-normal-server':
                    with self.assertRaisesRegex(RuntimeError, 'Hash input not bounded regular file'):
                        guard.Budget().digest(attempt.normal_server)
                self.assertEqual(result['tests'], list(EXPECTED_TESTS))
                self.assertFalse(result['production_admission'])
                self.assertFalse(result['sustained_media_e2e'])

    def test_activation_zero_missing_extra_ignored_failed_or_unbound_cannot_pass(self):
        cases = {'unsupported-openssl': 'Expected installed OpenSSL or LibreSSL version identity',
                 'zero-activation-inventory': 'Exact ordinary activation inventory',
                 'missing-activation-test': 'Exact ordinary activation inventory',
                 'extra-activation-test': 'Exact ordinary activation inventory',
                 'ignored-activation-test': 'Exact ordinary activation inventory',
                 'zero-activation-executed': 'Ordinary suite count differs',
                 'failed-activation-test': 'Ordinary suite execution/status differs',
                 'missing-normal-server': 'exactly one fixture executable',
                 'normal-server-test-profile': 'Expected actual test executable profile',
                 'duplicate-activation-target': 'exactly one fixture executable',
                 'escaped-activation-target': 'Fixture executable escaped owned target',
                 'changed-activation-binary': 'Activation test executable changed',
                 'changed-normal-server': 'Normal server executable changed'}
        for case, reason in cases.items():
            with self.subTest(case=case), Attempt(case) as attempt:
                with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                    attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['status'], 'fail')
                self.assertIn(reason, result['error'])
                self.assertFalse(result['production_admission'])

    def test_actual_two_flag_filter_rows_pass_mocked_main_preflight(self):
        with Attempt('two-flag-filter-output') as attempt:
            attempt.run()
            self.assertEqual(attempt.terminal()['status'], 'pass')
            self.assertTrue(any(row['name'] == 'core-fixture-build' for row in attempt.driver.commands))

    def test_mock_main_never_touches_host_mkfifo_identity(self):
        forbidden = Path('/usr/bin/mkfifo')
        def deny_host(original):
            def wrapped(path, *args, **kwargs):
                self.assertNotEqual(Path(path), forbidden, 'Offline test touched real host mkfifo')
                return original(path, *args, **kwargs)
            return wrapped
        with mock.patch.object(Path, 'stat', deny_host(Path.stat)), \
             mock.patch.object(Path, 'lstat', deny_host(Path.lstat)), \
             mock.patch.object(Path, 'open', deny_host(Path.open)), \
             mock.patch.object(os, 'open', deny_host(os.open)), \
             mock.patch.object(os, 'access', deny_host(os.access)), Attempt() as attempt:
            attempt.run()
            self.assertEqual(attempt.terminal()['status'], 'pass')
            tool = json.loads((attempt.output / 'evidence/tools.json').read_text())['mkfifo']
            self.assertEqual(tool['requested_path'], attempt.supplied['mkfifo'])
            self.assertEqual(tool['path'], attempt.supplied['mkfifo'])
            smoke = next(entry for entry in attempt.driver.commands if entry['name'] == 'mkfifo-smoke')
            self.assertEqual(smoke['argv'][0], tool['path'])
            self.assertEqual(len(smoke['argv']), 3)
            self.assertEqual(smoke['limit'], 2)
            self.assertFalse((attempt.output / 'tmp/mkfifo-smoke').exists())

    def test_incomplete_or_nonfifo_smoke_fails_before_compilation(self):
        for case in ('missing-smoke-fifo', 'nonfifo-smoke'):
            with self.subTest(case=case), Attempt(case) as attempt:
                with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                    attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['status'], 'fail')
                if case == 'missing-smoke-fifo':
                    self.assertEqual(result['error_type'], 'FileNotFoundError')
                else:
                    self.assertIn('Unexpected mkfifo smoke output retained', result['error'])
                self.assertFalse(any(entry['name'] == 'core-fixture-build' for entry in attempt.driver.commands))

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
                self.assertEqual(len(fixtures), 4)
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
                 'changed-system-tool': 'Tool executable identity changed',
                 'retargeted-system-tool': 'Tool executable identity changed',
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
