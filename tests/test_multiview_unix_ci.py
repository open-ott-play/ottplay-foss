"""Offline contracts only: no native, Rust, FFmpeg, media or device execution."""
import contextlib
import hashlib
import importlib.util
import json
import os
import re
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
    'streamed_decoder_short_track_pending_and_failure',
    'streamed_session_two_owner_continuity',
)
EXPECTED_PRODUCTION_TEST = 'normal_server_private_http_mpegts_renew_replace_and_cleanup'
EXPECTED_HLS_PRODUCTION_TEST = 'normal_server_private_http_hls_renew_replace_and_cleanup'

EXPECTED_BROKER_CLOSE_DIAGNOSTIC_TESTS = frozenset({
    'broker::live::close_diagnostic_tests::diagnostic_queue_preserves_order_and_reports_bounded_overflow_after_completion',
    'broker::live::close_diagnostic_tests::empty_diagnostic_queue_completes_without_entering_writer',
    'broker::live::close_diagnostic_tests::watchdog_success_releases_owners_and_failed_cleanup_emits_nothing',
    'broker::live::close_diagnostic_tests::operation_receipts_and_sink_release_precede_a_blocked_diagnostic_writer',
    'broker::live::close_diagnostic_tests::first_close_record_preserves_initiator_and_output_across_retirement',
    'broker::live::close_diagnostic_tests::close_observation_distinguishes_live_authority_failure_and_preserves_closed_trace',
})

EXPECTED_BROKER_PLAY_DIAGNOSTIC_TESTS = frozenset({
    'broker::live::play_diagnostic_tests::play_failure_record_preserves_numeric_producer_evidence_without_identity',
    'broker::live::play_diagnostic_tests::play_closed_classes_distinguish_retirement_decode_and_commit_failures',
})


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ci = load('multiview_ci_offline_under_test', HELPER)
batch = load('multiview_hls_batch_under_test', ROOT / 'scripts/ci-multiview-hls-probe-batch.py')
guard = load('multiview_ci_reviewed_guard', REFERENCE)
media = load('multiview_unix_media_forensic_under_test', ROOT / 'scripts/ci-multiview-unix-media.py')


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


PLAYLIST_DROP_REQUIRED_NAMES = (
    'offline_media::drop_playlist::tests::playlist_relative_members_keep_verified_canonical_parent_after_alias_rebind',
    'offline_media::drop_playlist::tests::playlist_and_referenced_file_symlinks_are_rejected_without_retained_grants',
)
PLAYLIST_DROP_NAMES = (*PLAYLIST_DROP_REQUIRED_NAMES,
                       'offline_media::drop_playlist::tests::synthetic_future_playlist_regression')
CORE_REQUIRED_NAMES = (
    'multiview::broker::registry::pending_grant_retention_tests::attachment_promotion_keeps_only_exact_unchanged_sibling_binding_grants',
    'multiview::broker::registry::pending_grant_retention_tests::binding_updates_retain_exact_siblings_but_global_source_and_session_revokes_fail_closed',
    'multiview::broker::registry::try_authority_tests::try_session_authority_returns_busy_without_callback_then_recovers',
    'multiview::broker::registry::try_authority_tests::try_session_authority_maps_poison_to_unavailable_without_callback',
    'multiview::broker::registry::try_authority_tests::try_session_authority_preserves_authorization_and_output_block',
)
CORE_REMAINING_BUDGET_NAMES = (
    'multiview::persistent::tests::output_encoder_config_shortens_both_timeouts_near_hard_end',
    'multiview::persistent::tests::output_encoder_config_shortens_equal_startup_after_setup',
    'multiview::persistent::tests::output_encoder_config_stops_at_or_after_hard_end',
    'multiview::persistent::tests::session_rejects_invalid_original_timeouts_before_encoder_projection',
)
CORE_CLOCK_RETIREMENT_NAMES = tuple(sorted(ci.CORE_REQUIRED_CLOCK_RETIREMENT_TESTS))
CORE_NAMES = ('multiview::frames::synthetic_contract', 'multiview::encoder::synthetic_stop_contract',
              *CORE_REQUIRED_NAMES, *CORE_CLOCK_RETIREMENT_NAMES, *sorted(ci.CORE_REQUIRED_HLS_TESTS), *sorted(ci.CORE_REQUIRED_PRIVATE_HTTP_TESTS), *CORE_REMAINING_BUDGET_NAMES)
CORE_IGNORED = tuple(ci.CORE_IGNORED_TESTS)
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
 .. select            V->N       Select video frames to pass in output.
 .. setpts            V->V       Set PTS for the output video frame.
 .. setsar            V->V       Set the pixel sample aspect ratio.
 .S xstack            N->V       Stack video inputs into custom layout.
 .. testsrc2          |->V       Generate another test pattern.
'''


class FakeMedia:
    """Seven-function frozen analyzer API; commands remain synthetic Driver data."""

    helper_sha256 = ci.STREAM_MEDIA_SHA256

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
                "a_return_duration_before_crop": True,
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


def synthetic_hls_batch(args, all_rows, corrupt=False):
    """Explicit synthetic command result, never a process/media qualification."""
    plan_path=Path(args[args.index('--plan')+1]); receipt_path=Path(args[args.index('--receipt')+1])
    raw=plan_path.read_bytes();plan=json.loads(raw)
    assert len(plan['rows'])==153
    assert len({row['input'] for row in plan['rows']})==153
    assert len({row['output'] for row in plan['rows']})==153
    rows=[]
    for row in plan['rows']:
        source=Path(row['input'])
        if source.name.startswith('source-'):
            packets=all_rows[0]+all_rows[1]
        else:
            index=int(source.stem.split('-')[-1])
            packets=json.loads(json.dumps(all_rows[0][index*120:(index+1)*120]+all_rows[1][index:index+1]))
            if corrupt is True and index==1:packets[1]['pts']+=1
        output=Path(row['output']);assert not output.exists()
        output.write_text(json.dumps({'streams':[{'index':0,'codec_name':'h264','time_base':'1/90000'},
            {'index':1,'codec_name':'aac','time_base':'1/90000'}],'packets':packets}))
        rows.append(dict(row,output_sha256=hashlib.sha256(output.read_bytes()).hexdigest(),bytes=output.stat().st_size,exit=0,reaped=True))
    receipt={'schema':'ottplay.multiview.hls-probe-receipt.v1','status':'passed','rows':rows,
        'worker_sha256':plan['worker_sha256'],'tool_sha256':plan['ffprobe']['sha256'],
        'plan_sha256':hashlib.sha256(raw).hexdigest(),'outer_pgid_guard_required':True,'output_bytes':sum(row['bytes'] for row in rows)}
    receipt_path.write_text(json.dumps(receipt,separators=(',',':')));receipt_path.chmod(0o600)
    return 'unexpected packet stdout' if corrupt=='stdout' else ''


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
                     'src-rs/core/src/offline_media.rs', 'src-rs/core/src/offline_media/drop_playlist.rs',
                     'src-rs/core/src/multiview/broker/registry.rs',
                     'src-rs/core/src/multiview/broker/network.rs',
                     'src-rs/core/src/multiview/broker/network_tests.rs',
                     'src-rs/core/src/multiview/broker/hls_timeline.rs',
                     'src-rs/core/src/multiview/broker/hls_timeline_tests.rs',
                     'src-rs/core/src/multiview/broker/stream_hls.rs',
                     'src-rs/core/src/multiview/broker/stream_hls_tests.rs',
                     'src-rs/core/src/multiview/broker/stream_hls_factory_tests.rs',
                     'src-rs/server/src/multiview_media_config.rs',
                     'src-rs/server/src/multiview_operator.rs', 'src-rs/server/src/multiview_service.rs',
                     'src-rs/server/Cargo.toml', 'src-rs/server/tests/multiview_fixtures.rs',
                     'src-rs/server/tests/multiview_production.rs',
                     'src-rs/server/tests/multiview_activation.rs', 'src-rs/server/src/main.rs',
                     'src-rs/server/src/multiview_broker.rs',
                     'src-rs/server/src/multiview_broker_live.rs',
                     'src-rs/server/src/multiview_broker_live_output_tests.rs',
                     'src-rs/server/src/media_connection.rs',
                     'src-rs/server/src/private_media_attempt.rs',
                     'src-rs/server/tests/multiview_broker_boundary.rs',
                     'src-rs/server/tests/support/streamed_session.rs',
                     'src-rs/server/tests/support/streamed_transport.rs',
                     'src-rs/server/tests/support/streamed_archive.rs',
                     'src-rs/server/tests/support/streamed_decoder.rs',
                     'src-rs/server/tests/support/multiview_production_tls.rs',
                     'src-rs/server/tests/support/multiview_production_config.rs',
                     'src-rs/server/tests/support/hls_production.rs',
                     'src-rs/core/src/multiview/decoder.rs', 'src-rs/core/src/multiview/frames.rs',
                     'src-rs/core/src/multiview/geometry.rs', 'src-rs/core/src/multiview/timing.rs',
                     'scripts/ci-multiview-unix-media.py',
                     'scripts/ci-native-favorites.py', 'scripts/ci-multiview-unix.py',
                     'scripts/ci-multiview-hls-probe-batch.py',
                     'tests/test_multiview_unix_ci.py',
                     'scripts/ci-apt-mirror.py'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            if name == 'scripts/ci-multiview-hls-probe-batch.py':
                path.write_bytes((ROOT / name).read_bytes())
            else:
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
                attempt.initial_env = dict(self.env)

            def run(self, name, argv, limit=1500):
                # Deliberately no subprocess, shell or native-runtime access.
                log_path = self.evidence / 'logs' / (name + '.log')
                if log_path.exists() or log_path.is_symlink() or any(row['name'] == name for row in self.commands):
                    raise FileExistsError('Duplicate owned command log label: ' + name)
                self.commands.append({'name': name, 'argv': argv, 'limit': limit,
                                      'cleanup_confirmed': attempt.case != 'unknown-cleanup'
                                      and not (name == 'broker-ordinary' and attempt.case == 'broker-cleanup-unknown')
                                      and not (name == 'listener-ordinary' and attempt.case == 'listener-cleanup-unknown')})
                if name.startswith('production-custody-'):
                    attempt.tool_probe_contexts=getattr(attempt,'tool_probe_contexts',[])+[(dict(self.env),self.root)]
                if name in ('production-normal-server','production-live-hls-server'):
                    attempt.production_tool_envs=getattr(attempt,'production_tool_envs',[])+[dict(self.env)]
                if name == 'fixture-pending-clock':
                    attempt.pending_env = dict(self.env)
                rotation_command = 'core-ignored-' + hashlib.sha256(ci.CORE_ROTATION_TEST.encode()).hexdigest()[:12]
                if name == rotation_command:
                    attempt.rotation_env = dict(self.env)
                    attempt.rotation_case_was_fresh = not Path(
                        self.env['OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR']).exists()
                text = attempt.response(re.sub(r'-retry-\d+$', '', name), argv)
                raw = text.encode()
                with log_path.open('xb') as stream:
                    self.budget.allocate(len(raw), log=True)
                    stream.write(raw)
                    self.budget.evidence_files[str(log_path)] = len(raw)
                if name.startswith('production-normal-server') and attempt.case in (
                        'production-signature-once', 'production-signature-always'):
                    attempt.signature_failures = getattr(attempt, 'signature_failures', 0) + 1
                    if attempt.case == 'production-signature-always' or attempt.signature_failures == 1:
                        raise RuntimeError('Synthetic production command exited nonzero')
                if name == rotation_command and attempt.case == 'core-rotation-nonzero-exit':
                    raise RuntimeError('Synthetic Core rotation command exited nonzero')
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
        self.stack.enter_context(mock.patch.object(ci, 'CORE_IGNORED_TESTS', frozenset(CORE_IGNORED)))
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
        if name.startswith('production-custody-'):
            if name.endswith('-version'):
                tool='ffprobe' if 'ffprobe' in name else 'ffmpeg'
                if self.case=='staged-version-unusable':return 'loader could not resolve supplier library\n'
                return tool+' version synthetic-owned-copy-never-executed\n'
            if name.startswith('production-custody-mkfifo-'):
                if self.case=='staged-mkfifo-not-fifo':Path(argv[-1]).write_bytes(b'not a FIFO')
                else:os.mkfifo(argv[-1],0o600 if '-m' in argv else 0o644)
                return ''
        if name.startswith('pending-generate-'):
            if self.case != 'pending-missing-input':
                Path(argv[-1]).write_bytes(b'synthetic pending TS payload: ' + name.encode())
            return ''
        if name.startswith(('production-source-', 'production-hls-source-')):
            Path(argv[-1]).write_bytes((b'\x47' + b'\0' * 187) * 3)
            return 'synthetic MPEG-TS payload; no media process\n'
        if name == 'fixture-pending-clock':
            case = Path(self.driver.env['OTTPLAY_MULTIVIEW_PENDING_CASE_DIR'])
            case.mkdir(mode=0o700)
            manifest_path = Path(self.driver.env['OTTPLAY_MULTIVIEW_PENDING_INPUTS'])
            manifest = json.loads(manifest_path.read_text())
            rows = manifest['inputs']
            scenarios = [('AudioTail', 'a1-v3'), ('VideoTail', 'a3-v1'), ('LateFailure', 'a1-v3'),
                         ('Revoke', 'a1-v3'), ('Cancel', 'a1-v3')]
            control = {'schema': 'ottplay.multiview.pending-clock-fixture.v1', 'pass': True,
                       'input_manifest_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                       'case_count': 5, 'error': None, 'external_process_group_supervisor_required': True,
                       'clean_eof_from_pending_claimed': False,
                       'cases': [{'scenario': name, 'input': identity, 'pass': True, 'metadata_clean': True,
                                  'error': None, 'input_sha256': next(row['sha256'] for row in rows if row['id'] == identity)}
                                 for name, identity in scenarios]}
            if self.case == 'pending-bad-control':
                control['pass'] = False
            if self.case == 'pending-wrong-manifest':
                control['input_manifest_sha256'] = '0' * 64
            if self.case == 'pending-wrong-scenario':
                control['cases'][2]['scenario'] = 'Cancel'
            if self.case == 'pending-wrong-input':
                control['cases'][0]['input_sha256'] = '0' * 64
            if self.case == 'pending-unclean-control':
                control['cases'][0]['metadata_clean'] = False
            if self.case == 'pending-leaked-temp':
                (Path(self.driver.env['TMPDIR']) / 'owned-residue').write_text('must fail')
            if self.case == 'pending-changed-input':
                path = Path(rows[0]['path']); path.chmod(0o600); path.write_bytes(b'changed')
            if self.case != 'pending-missing-control':
                (case / 'CONTROL.json').write_text(json.dumps(control))
            if self.case == 'pending-nonzero-exit':
                raise RuntimeError('Synthetic pending command exited nonzero')
            return passed(argv[1]) if self.case != 'pending-zero-tests' else 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;\n'
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
        if name.startswith(('public-http-policy-','private-http-policy-')):
            policy_name=argv[1]
            index=int(name.split('-')[3])
            kind='private' if name.startswith('private') else 'public'
            faulty=(self.case or '').startswith(f'{kind}-http-{index}-')
            if name.endswith('-inventory'):
                return '' if faulty and self.case.endswith('-missing') else policy_name+': test\n'
            if name.endswith('-ignored'):
                return policy_name+': test\n' if faulty and self.case.endswith('-ignored') else ''
            if faulty and self.case.endswith('-zero'):
                return 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n'
            return passed(policy_name)
        if name == 'hls-item-policy-inventory':
            return '' if self.case == 'hls-policy-missing' else ci.HLS_ITEM_ADAPTER_TEST + ': test\n'
        if name == 'hls-item-policy-ignored':
            return ci.HLS_ITEM_ADAPTER_TEST + ': test\n' if self.case == 'hls-policy-ignored' else ''
        if name == 'hls-item-policy':
            return 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n' if self.case == 'hls-policy-zero' else passed(ci.HLS_ITEM_ADAPTER_TEST)
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
        if name in ('production-inventory', 'production-ignored-inventory', 'production-hls-inventory', 'production-hls-ignored-inventory'):
            name = name.replace('production-hls-', 'production-')
            if self.case == 'production-missing-inventory' and name == 'production-inventory':
                return ''
            if self.case == 'production-extra-inventory' and name == 'production-inventory':
                return EXPECTED_PRODUCTION_TEST + ': test\nunreviewed_test: test\n'
            if self.case == 'production-not-ignored' and name == 'production-ignored-inventory':
                return ''
            values = {EXPECTED_PRODUCTION_TEST, EXPECTED_HLS_PRODUCTION_TEST}
            if name == 'production-inventory':
                values |= ci.PRODUCTION_ORDINARY_TESTS
            return ''.join(value + ': test\n' for value in sorted(values))
        if name == 'production-ordinary':
            if self.case == 'hls-support-not-executed':
                return 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n'
            return suite_passed(sorted(ci.PRODUCTION_ORDINARY_TESTS), sorted({EXPECTED_PRODUCTION_TEST, EXPECTED_HLS_PRODUCTION_TEST}))
        if name in ('production-normal-server', 'production-live-hls-server'):
            manifest_path = Path(self.driver.env['OTTPLAY_MULTIVIEW_PRODUCTION_INPUTS'])
            manifest = json.loads(manifest_path.read_text())
            hls = name == 'production-live-hls-server'
            if hls:
                input_rows = [{'id':row['id'],'sha256':row['original_sha256'],'bytes':row['original_bytes']} for row in manifest['sources']]
            else:
                input_rows = manifest['inputs']
            receipt = {'schema': 'ottplay.multiview.production-binary.v1', 'pass': True,
                       'input_adapter':'http-hls-ts-v1' if hls else 'http-mpegts-v1',
                       'output_segment_video_proofs':[{'sha256':'a'*64,'bytes':1880,'decoded_video_frames':10,'sample_index':9,'duration_ticks':90000,'time_base':'1/90000','source_identity_unchanged':True}],
                       'sequential_contexts':17,'sequential_output_generations':17,'active_sigterm':True,
                       'credential_clock':{'startup_sample_ms':1000,'observation_elapsed_ms':1000,
                           'probe_elapsed_ms':60000,'lower_bound_ms':61000,'short_expires_ms':61000},
                       'seed_refusal_summaries':[{'seed':seed,'body_first_count':0,'body_later_count':0,
                           'supervisor_count':0,'last':None,'completed':True} for seed in ('grid','main','replacement')],
                       'scope': 'Normal production HTTPS control/HLS with a private RFC1918 HTTP MPEG-TS adapter, all nine advertised slots and private HLS output; no native-player or physical-television qualification',
                       'tls': {'configured_api_transport':'https','trust':'synthetic_ca_only',
                               'untrusted_ca_rejected':True,'wrong_hostname_rejected':True,
                               'ca_sha256':'a'*64,'leaf_sha256':'b'*64,'openssl_sha256':'c'*64},
                       'https_control_requests':20,'https_media_requests':30,
                       'elapsed_seconds': 240, 'credential_expiry_rejected': True,
                       'sustained_seconds': 220,
                       'expiry_output_was_active': True, 'expired_source_connections_closed': True,
                       'expired_output_cleanup': True, 'owned_fixture_root_removed': True, 'graceful_shutdown': True,
                       'shutdown_signal': 'SIGTERM',
                       'output_directory_empty': True, 'source_replacement': True,
                       'nine_slot_grid_rgb': True, 'selected_audio_tone': True,
                       'replacement_audio_tone': True,
                       'replacement_late_segment': True, 'sibling_frames_recent_at_end': True,
                       'sibling_frames_before_replace': 100, 'sibling_frames_after_replace': 200,
                       'hls_segment_audio_video': True,
                       'upstream_request_counts': {f"source-{row['id']}.ts": 2 for row in input_rows},
                       'inputs': [{'id': row['id'], 'sha256': row['sha256'], 'bytes': row['bytes']}
                                  for row in input_rows]}
            if hls:
                receipt['scope'] = 'Normal production HTTPS control/HLS with a private RFC1918 live HLS MPEG-TS adapter, one master level and sliding media windows; no native-player or physical-television qualification'
                receipt['upstream_request_counts'] = {}
                receipt['hls_source'] = {'stable_retirement_interval_seconds':12,
                    'audit':{'master':[2]*3,'media':[20]*3,'future_denied':0,'segments':[[2]*8+[0]*42 for _ in range(3)]},
                    'inputs':[{'id':row['id'],'original_sha256':row['original_sha256'],
                        'packet_timeline_sha256':row['original_packet_timeline_sha256'],
                        'segments':[{key:item[key] for key in ('index','sha256','bytes','duration_ns')} for item in row['segments']]}
                        for row in manifest['sources']]}
                if self.case == 'hls-no-active-sigterm': receipt['active_sigterm'] = False
                if self.case == 'production-no-segment-proof': receipt.pop('output_segment_video_proofs')
                if self.case == 'hls-sixteen-contexts': receipt['sequential_contexts'] = 16
                if self.case == 'hls-no-segment-binding': receipt['hls_source']['inputs'][0]['segments'][0]['sha256'] = '0'*64
                if self.case == 'hls-future-fetch': receipt['hls_source']['audit']['future_denied'] = 1
                if self.case == 'hls-incomplete-master': receipt['hls_source']['audit']['master'][0] = 1
                if self.case == 'hls-changed-segment':
                    changed = Path(manifest['sources'][0]['segments'][0]['path']); changed.chmod(0o600)
                    changed.write_bytes(b'changed immutable segment'); changed.chmod(0o400)
                if self.case == 'hls-nonzero': raise RuntimeError('Synthetic HLS command exited nonzero')
                if self.case == 'hls-zero-tests': return 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n'

            if self.case == 'production-no-credential-clock': receipt.pop('credential_clock')
            if self.case == 'production-no-seed-summaries': receipt.pop('seed_refusal_summaries')
            if self.case == 'production-incomplete-seed-summary': receipt['seed_refusal_summaries'][1]['completed'] = False
            if self.case == 'production-bad-receipt':
                receipt['pass'] = False
            elif self.case == 'production-missing-source':
                receipt['inputs'].pop()
            elif self.case == 'production-no-hls-av':
                receipt['hls_segment_audio_video'] = False
            elif self.case == 'production-no-tls':
                receipt['tls']['wrong_hostname_rejected'] = False
            elif self.case == 'production-incomplete-probe':
                receipt['upstream_request_counts']['source-1.ts'] = 1
            if self.case != 'production-missing-receipt':
                Path(self.driver.env['OTTPLAY_MULTIVIEW_PRODUCTION_RECEIPT']).write_text(json.dumps(receipt))
            if self.case == 'production-nonzero-exit':
                raise RuntimeError('Synthetic production command exited nonzero')
            if self.case == 'production-zero-tests':
                return 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;\n'
            text = passed(EXPECTED_HLS_PRODUCTION_TEST if hls else EXPECTED_PRODUCTION_TEST)
            if self.case in ('production-signature-once', 'production-signature-always') and not hls:
                text += ('thread panicked at multiview_production.rs: '
                         'sibling source authority disappeared for 3 consecutive samples\n')
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
            self.production_executable = self.output / 'target/debug/deps/multiview_production-synthetic'
            for executable in (self.activation, self.broker_executable, self.normal_server, self.production_executable):
                executable.write_text('synthetic executable bytes; never executed')
                executable.chmod(0o700)
            if self.case == 'hardlinked-normal-server':
                os.link(self.normal_server, self.output / 'target/debug/deps/ottplay_server-normal')
            activation = artifact(self.activation, manifest, name='multiview_activation')
            normal = artifact(self.normal_server, manifest, name='ottplay-server', kind='bin',
                              test_profile=self.case == 'normal-server-test-profile')
            broker = artifact(self.broker_executable, manifest, name='multiview_broker_boundary')
            production = artifact(self.production_executable, manifest, name='multiview_production')
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
            return 'synthetic cargo diagnostic\n' + text + activation + broker + normal + production
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
        if name == 'core-playlist-inventory':
            return ''.join(value + ': test\n' for value in PLAYLIST_DROP_NAMES)
        if name == 'core-playlist-ignored-inventory':
            return ''
        if name == 'core-playlist-ordinary':
            return suite_passed(PLAYLIST_DROP_NAMES)
        if name == 'core-multiview-inventory':
            if self.case == 'core-zero-inventory':
                return ''
            names = list(CORE_NAMES) + list(CORE_IGNORED)
            if self.case == 'core-wrong-prefix':
                names[0] = 'other::synthetic_contract'
            return ''.join(value + ': test\n' for value in names)
        if name == 'core-multiview-ignored-inventory':
            if self.case == 'core-ignored-missing':
                return ''
            if self.case == 'core-ignored-extra':
                return ''.join(value + ': test\n' for value in (*CORE_IGNORED, 'multiview::unexpected_ignored'))
            return ''.join(value + ': test\n' for value in CORE_IGNORED)
        if name == 'core-multiview-ordinary':
            text = suite_passed(CORE_NAMES, CORE_IGNORED)
            if self.case == 'core-zero-executed':
                return suite_passed((), CORE_IGNORED)
            if self.case == 'core-failed-ordinary':
                return text.replace(CORE_NAMES[0] + ' ... ok', CORE_NAMES[0] + ' ... FAILED')
            return text
        if name.startswith('core-ignored-'):
            Path(self.driver.env['OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR']).mkdir(mode=0o700)
            return passed(CORE_IGNORED[0])
        if name == 'ignored-fixtures':
            names = list(EXPECTED_TESTS)
            if self.case == 'changed-inventory':
                names[-1] = 'unexpected_new_ignored_fixture'
            if self.case == 'missing-pending-fixture':
                names.remove('streamed_decoder_short_track_pending_and_failure')
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

    def prepare_hls_inputs(self, driver, budget, command, tools, directory):
        directory = Path(directory); directory.mkdir(mode=0o700)
        rows=[]
        for identity in range(1,4):
            original=directory/f'original-{identity}.ts'; original.write_bytes((b'\x47'+bytes([identity])*187)*3); original.chmod(0o400)
            segments=[]
            for index in range(50):
                path=directory/f'part-{identity}-{index}.ts';path.write_bytes((b'\x47'+bytes([index])*187)*3);path.chmod(0o400)
                segments.append({'index':index,'path':str(path),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'duration_ns':12_000_000_000})
            rows.append({'id':identity,'original_path':str(original),'original_bytes':original.stat().st_size,
                'original_sha256':hashlib.sha256(original.read_bytes()).hexdigest(),
                'original_packet_timeline_sha256':'a'*64,'segmented_packet_timeline_sha256':'a'*64,'segments':segments})
        manifest={'schema':'ottplay.multiview.production-hls-inputs.v1','seconds':600,'target_seconds':12,'sources':rows}
        path=directory/'HLS-INPUTS.json';path.write_text(json.dumps(manifest,sort_keys=True)+'\n');path.chmod(0o400)
        return path,manifest

    def run(self, path=None, required_core=(), required_server=()):
        argv = ['--work-root', str(path or self.output)]
        for name in required_core:
            argv.extend(['--required-core-test', name])
        for name in required_server:
            argv.extend(['--required-server-test', name])
        with mock.patch.object(ci, 'prepare_hls_production_inputs', side_effect=self.prepare_hls_inputs):
            ci.main(argv)

    def terminal(self):
        return json.loads((self.output / 'evidence/terminal.json').read_text())


class HlsBatchWorkerContracts(unittest.TestCase):
    def setUp(self):
        self.cancel=mock.patch.object(batch,'CANCELLED',False);self.cancel.start();self.addCleanup(self.cancel.stop)

    def fixture(self, root):
        root=root.resolve();root.chmod(0o700)
        for name in ('inputs','proof','tools'):(root/name).mkdir(mode=0o700)
        tool=root/'tools/ffprobe';tool.write_bytes(b'synthetic tool never executed');tool.chmod(0o700)
        rows=[]
        for index in range(153):
            path=root/f'inputs/{index:03d}.ts';path.write_bytes((b'\x47'+b'\0'*187)*3);path.chmod(0o400)
            rows.append({'input':str(path),'input_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'output':str(root/f'proof/p{index:03d}.json')})
        return {'schema':'ottplay.multiview.hls-probes.v1','root':str(root),'worker_sha256':hashlib.sha256(Path(batch.__file__).read_bytes()).hexdigest(),
            'ffprobe':{'path':str(tool),'bytes':tool.stat().st_size,'sha256':hashlib.sha256(tool.read_bytes()).hexdigest()},'rows':rows}

    def test_closed_153_plan_and_final_identity_readback_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();plan=self.fixture(root)
            def probe(_binary,_source,output,_root,_end,_completed):output.write_bytes(b'{"packets":[]}')
            with mock.patch.object(batch,'probe',side_effect=probe) as calls:
                result=batch.execute(plan,Path(batch.__file__),batch.time.monotonic()+20)
            self.assertEqual(calls.call_count,153);self.assertEqual(len(result['rows']),153)
            self.assertTrue(all(row['exit']==0 and row['reaped'] is True for row in result['rows']))
            self.assertTrue(result['outer_pgid_guard_required'])
            self.assertEqual(result['output_bytes'],sum(Path(row['output']).stat().st_size for row in result['rows']))

    def test_plan_rejects_duplicates_escape_unknowns_and_nonprivate_ancestors_before_launch(self):
        for corruption in ('count','input','output','reserved','escape','argv','ancestor'):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as directory:
                root=Path(directory).resolve();plan=self.fixture(root);reserved=root/'RESERVED.json'
                if corruption=='count':plan['rows'].pop()
                elif corruption=='input':plan['rows'][1]['input']=plan['rows'][0]['input']
                elif corruption=='output':plan['rows'][1]['output']=plan['rows'][0]['output']
                elif corruption=='reserved':plan['rows'][1]['output']=str(reserved)
                elif corruption=='escape':plan['rows'][1]['input']='https://not-a-file.invalid/secret'
                elif corruption=='argv':plan['rows'][0]['argv']=['untrusted']
                else:(root/'inputs').chmod(0o755)
                with mock.patch.object(batch.subprocess,'Popen',side_effect=AssertionError('invalid plan launched process')), self.assertRaises((batch.BatchError,OSError)):
                    batch.execute(plan,Path(batch.__file__),batch.time.monotonic()+20,reserved=(reserved,))

    def fake_probe(self, root, failure=None):
        output=root/'out.json';registered={};streams={3:[b''],4:[b'']}
        child=types.SimpleNamespace(returncode=None,stdout=types.SimpleNamespace(fileno=lambda:3,close=mock.Mock()),
            stderr=types.SimpleNamespace(fileno=lambda:4,close=mock.Mock()),kill=mock.Mock())
        def wait(timeout):
            if failure=='cleanup-wait' and child.wait.call_count==1:
                raise batch.subprocess.TimeoutExpired('owned',timeout)
            child.returncode=-9 if child.kill.called else 0;return child.returncode
        child.wait=mock.Mock(side_effect=wait)
        def poll():
            if failure=='closed-pipes-growth':
                with output.open('wb') as stream:stream.truncate(batch.OUTPUT_CAP+1)
                return None
            child.returncode=0;return 0
        child.poll=mock.Mock(side_effect=poll)
        selector=mock.Mock()
        selector.register.side_effect=lambda file,_,name:registered.update({file.fileno():types.SimpleNamespace(fileobj=file,data=name)})
        selector.unregister.side_effect=lambda file:registered.pop(file.fileno())
        selector.get_map.side_effect=lambda:registered
        selector.select.side_effect=lambda _:[(key,1) for key in list(registered.values())]
        def launch(*_args,**_kwargs):
            if failure=='cancel-in-constructor':batch.request_cancel()
            if failure=='oversized':
                with output.open('wb') as stream:stream.truncate(batch.OUTPUT_CAP+1)
            return child
        with mock.patch.object(batch.subprocess,'Popen',side_effect=launch) as popen, \
             mock.patch.object(batch.selectors,'DefaultSelector',side_effect=OSError('selector fault') if failure in ('selector','cleanup-wait') else lambda:selector), \
             mock.patch.object(batch.os,'read',side_effect=OSError('pipe fault') if failure=='pipe' else lambda fd,_:streams[fd].pop(0)):
            if failure is None:
                batch.probe(root/'ffprobe',root/'input.ts',output,root,batch.time.monotonic()+3,0)
            else:
                with self.assertRaises((batch.BatchError,OSError)):
                    batch.probe(root/'ffprobe',root/'input.ts',output,root,batch.time.monotonic()+3,0)
        return child,popen

    def test_child_inherits_owned_group_and_closed_environment_fixed_file_only_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            child,popen=self.fake_probe(Path(directory))
            self.assertFalse(popen.call_args.kwargs['start_new_session'])
            self.assertEqual(set(popen.call_args.kwargs['env']),{'PATH','HOME','TMPDIR','LANG','LC_ALL'})
            args=popen.call_args.args[0]
            self.assertEqual(args[args.index('-protocol_whitelist')+1],'file')
            self.assertEqual(args[args.index('-format_whitelist')+1],'mpegts')
            self.assertIn('-o',args);self.assertEqual(child.returncode,0)
            child.stdout.close.assert_called_once();child.stderr.close.assert_called_once()

    def test_selector_pipe_cancellation_and_closed_pipe_growth_always_retire_actual_child(self):
        for failure in ('selector','pipe','cancel-in-constructor','oversized','closed-pipes-growth','cleanup-wait'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                batch.CANCELLED=False
                child,_=self.fake_probe(Path(directory),failure)
                child.kill.assert_called_once();self.assertIsNotNone(child.returncode)
                child.wait.assert_called();child.stdout.close.assert_called_once();child.stderr.close.assert_called_once()
        batch.CANCELLED=True
        with mock.patch.object(batch.subprocess,'Popen',side_effect=AssertionError('cancelled batch launched child')), self.assertRaises(batch.BatchError):
            batch.probe(Path('/not-executed/ffprobe'),Path('/not-read/input.ts'),Path('/not-created/output'),Path('/owned'),batch.time.monotonic()+1,0)

    def test_receipt_write_failure_cannot_return_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();plan=self.fixture(root);plan_path=root/'PLAN.json';receipt=root/'RECEIPT.json'
            plan_path.write_text(json.dumps(plan));plan_path.chmod(0o400)
            with mock.patch.object(batch.sys,'argv',['worker','--plan',str(plan_path),'--receipt',str(receipt)]), \
                 mock.patch.object(batch.signal,'signal'),mock.patch.object(batch,'execute',return_value={'status':'passed'}), \
                 mock.patch.object(Path,'open',side_effect=OSError('receipt write fault')), contextlib.redirect_stderr(__import__('io').StringIO()):
                self.assertEqual(batch.main(),1)
            self.assertFalse(receipt.exists())

    def test_cancellation_during_receipt_fsync_cannot_return_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();plan=self.fixture(root);plan_path=root/'PLAN.json';receipt=root/'RECEIPT.json'
            plan_path.write_text(json.dumps(plan));plan_path.chmod(0o400)
            with mock.patch.object(batch.sys,'argv',['worker','--plan',str(plan_path),'--receipt',str(receipt)]), \
                 mock.patch.object(batch.signal,'signal'),mock.patch.object(batch,'execute',return_value={'status':'passed'}), \
                 mock.patch.object(batch.os,'fsync',side_effect=batch.request_cancel), contextlib.redirect_stderr(__import__('io').StringIO()):
                self.assertEqual(batch.main(),1)

    def test_actual_158_character_hosted_prefix_keeps_closed_plan_and_receipt_under128k(self):
        prefix='/home/runner/work/_temp/'+'w'*(158-len('/home/runner/work/_temp/'))
        self.assertEqual(len(prefix),158)
        jobs=[{'input':prefix+f'/production-hls/inputs/segments-{index//51}/segment-{index:03d}.ts',
               'input_sha256':'a'*64,'output':prefix+f'/production-hls/inputs/packet-proof/p{index:03d}.json'} for index in range(153)]
        plan={'schema':'ottplay.multiview.hls-probes.v1','root':prefix+'/production-hls/inputs','worker_sha256':'a'*64,
              'ffprobe':{'path':'/usr/bin/ffprobe','sha256':'b'*64,'bytes':1},'rows':jobs}
        receipt={'schema':'ottplay.multiview.hls-probe-receipt.v1','status':'passed','plan_sha256':'a'*64,
                 'worker_sha256':'a'*64,'tool_sha256':'b'*64,'output_bytes':1,'outer_pgid_guard_required':True,
                 'rows':[dict(row,output_sha256='c'*64,bytes=1,exit=0,reaped=True) for row in jobs]}
        self.assertLessEqual(len(json.dumps(plan,separators=(',',':')).encode()),131072)
        self.assertLessEqual(len(json.dumps(receipt,separators=(',',':')).encode()),131072)
        self.assertEqual(ci.HLS_BATCH_SHA256,hashlib.sha256(Path(batch.__file__).read_bytes()).hexdigest())


class BoundaryContracts(unittest.TestCase):
    def test_both_closed_play_diagnostics_are_mandatory_and_nonignored(self):
        required = EXPECTED_BROKER_PLAY_DIAGNOSTIC_TESTS
        frozen = ci.BROKER_TESTS
        self.assertEqual(len(required), 2)
        self.assertTrue(required <= frozen)
        # Exercise the real exact-inventory equality, not a smaller synthetic set.
        variants = [(frozenset(), frozenset())]
        variants += [(frozenset({name}), frozenset()) for name in sorted(required)]
        variants += [(required, frozenset())]
        variants += [(frozenset(), frozenset({name})) for name in sorted(required)]
        for missing, ignored in variants:
            with self.subTest(missing=missing, ignored=ignored), Attempt() as attempt:
                original = attempt.response
                def response(name, args, original=original, missing=missing, ignored=ignored):
                    if name == 'broker-inventory':
                        return ''.join(value + ': test\n' for value in sorted(frozen - missing))
                    if name == 'broker-ignored-inventory':
                        return ''.join(value + ': test\n' for value in sorted(ignored))
                    if name == 'broker-ordinary':
                        return suite_passed(sorted(frozen))
                    return original(name, args)
                with mock.patch.object(ci, 'BROKER_TESTS', frozen), mock.patch.object(attempt, 'response', side_effect=response):
                    if missing or ignored:
                        with self.assertRaises(RuntimeError):
                            attempt.run()
                        self.assertIn('Exact ordinary broker inventory', attempt.terminal()['error'])
                        self.assertFalse(any(row['name'] == 'broker-ordinary' for row in attempt.driver.commands))
                    else:
                        attempt.run()
                        self.assertTrue(any(row['name'] == 'broker-ordinary' for row in attempt.driver.commands))

    def test_play_and_probe_diagnostics_have_no_precompletion_writer(self):
        source = (ROOT / 'src-rs/server/src/multiview_broker_live.rs').read_text()
        play = source.split('    async fn play(', 1)[1].split('    fn finish_reservation(', 1)[0]
        for forbidden in ('write_play_failure(', 'write_close_diagnostic(',
                          'write_operation_diagnostic(', 'emit_probe_diagnostic(', 'eprintln!('):
            self.assertNotIn(forbidden, play)
        self.assertNotRegex(play, r'(?<!record_)\bplay_failure\(')
        self.assertNotIn('decoder::probe_stream(', play)
        self.assertIn('decoder::probe_stream_with_diagnostic(', play)
        self.assertRegex(play, r'record_diagnostic\(\s*diagnostic,\s*OperationDiagnostic::Probe\(\*record\)')
        task = source.split('    async fn operation_with_diagnostic<F>(', 1)[1].split('    pub async fn create(', 1)[0]
        self.assertLess(task.index('.catch_unwind()'), task.index('complete_then_emit_diagnostics('))
        self.assertLess(task.index('completed.send_replace(Some(result))'), task.index('drop(completed)'))
        completion = source.split('fn complete_then_emit_diagnostics(', 1)[1].split('fn write_operation_diagnostic(', 1)[0]
        self.assertLess(completion.index('complete();'), completion.index('pending = sink.lock()'))
        self.assertLess(completion.index('drop(sink);'), completion.index('emit(record);'))

    def test_first_close_diagnostics_are_mandatory_and_nonignored(self):
        required = EXPECTED_BROKER_CLOSE_DIAGNOSTIC_TESTS
        frozen = ci.BROKER_TESTS
        self.assertEqual(len(required), 6)
        self.assertTrue(required <= frozen)
        # Exercise the real exact-inventory equality, not a smaller synthetic set.
        variants = [(frozenset(), frozenset())]
        variants += [(frozenset({name}), frozenset()) for name in sorted(required)]
        variants += [(required, frozenset())]
        variants += [(frozenset(), frozenset({name})) for name in sorted(required)]
        for missing, ignored in variants:
            with self.subTest(missing=missing, ignored=ignored), Attempt() as attempt:
                original = attempt.response
                def response(name, args, original=original, missing=missing, ignored=ignored):
                    if name == 'broker-inventory':
                        return ''.join(value + ': test\n' for value in sorted(frozen - missing))
                    if name == 'broker-ignored-inventory':
                        return ''.join(value + ': test\n' for value in sorted(ignored))
                    if name == 'broker-ordinary':
                        return suite_passed(sorted(frozen))
                    return original(name, args)
                with mock.patch.object(ci, 'BROKER_TESTS', frozen), mock.patch.object(attempt, 'response', side_effect=response):
                    if missing or ignored:
                        with self.assertRaises(RuntimeError):
                            attempt.run()
                        self.assertIn('Exact ordinary broker inventory', attempt.terminal()['error'])
                        self.assertFalse(any(row['name'] == 'broker-ordinary' for row in attempt.driver.commands))
                    else:
                        attempt.run()
                        self.assertTrue(any(row['name'] == 'broker-ordinary' for row in attempt.driver.commands))

    def test_both_existing_shutdown_regressions_must_be_present_and_nonignored(self):
        expected = frozenset({
            'broker::live::tests::shutdown_does_not_claim_unconfirmed_create_custody_is_clean',
            'broker::live::tests::shutdown_waits_for_owned_operation_after_http_waiter_drops',
        })
        self.assertEqual(ci.BROKER_SHUTDOWN_TESTS, expected)
        self.assertTrue(expected <= ci.BROKER_TESTS)
        frozen = ci.BROKER_TESTS
        for required in sorted(expected):
            for ignored in (False, True):
                with self.subTest(required=required,ignored=ignored), Attempt() as attempt:
                    original=attempt.response
                    def response(name,args,required=required,ignored=ignored,original=original):
                        text=original(name,args)
                        if ignored and name=='broker-ignored-inventory':return required+': test\n'
                        if name=='broker-inventory':
                            return ''.join(value+': test\n' for value in sorted(frozen) if ignored or value != required)
                        return text
                    with mock.patch.object(ci,'BROKER_TESTS',frozen), mock.patch.object(attempt,'response',side_effect=response), self.assertRaises(RuntimeError):
                        attempt.run()
                    result=attempt.terminal()
                    self.assertIn('broker',result['error'].lower())
                    self.assertFalse(result['normal_server_hls_to_hls'])
                    self.assertFalse(result['normal_server_mpegts_to_hls'])

    def test_pending_fixture_is_mandatory_exact_and_runs_before_expensive_stream(self):
        for system in ('Linux', 'Darwin'):
            with self.subTest(system=system), Attempt(system=system) as attempt:
                attempt.run()
                names = [row['name'] for row in attempt.driver.commands]
                row = next(row for row in attempt.driver.commands if row['name'] == 'fixture-pending-clock')
                self.assertEqual(row['argv'], [str(attempt.executable), ci.PENDING_TEST, '--ignored', '--exact',
                                               '--test-threads=1', '--color=never'])
                self.assertEqual(row['limit'], 120)
                self.assertLess(names.index('fixture-pending-clock'), names.index('fixture-4'))
                self.assertEqual(len([name for name in names if name == 'fixture-pending-clock']), 1)
                self.assertTrue(all(name in names for name in ('fixture-1', 'fixture-2', 'fixture-3', 'fixture-4')))
                self.assertNotIn('OTTPLAY_MULTIVIEW_PENDING_INPUTS', attempt.driver.env)
                self.assertNotIn('OTTPLAY_MULTIVIEW_PENDING_CASE_DIR', attempt.driver.env)
                self.assertEqual(attempt.driver.env['TMPDIR'], str(attempt.output / 'tmp'))
                scratch = Path(attempt.pending_env['TMPDIR'])
                self.assertTrue(all(char in str(scratch) for char in (" ", "'", ':', chr(92))))
                self.assertEqual(scratch.stat().st_mode & 0o777, 0o700)
                self.assertFalse(list(scratch.iterdir()))
                result = attempt.terminal()
                self.assertTrue(result['pending_clock']['pass'])
                self.assertFalse(result['pending_clock']['production_admission'])
                self.assertTrue((attempt.output / 'evidence/pending-clock-control.json').is_file())
                self.assertEqual(attempt.driver.budget.deadline, attempt.driver.budget.started + 1800)
                self.assertEqual(attempt.driver.budget.work_deadline, attempt.driver.budget.started + 1680)

    def test_pending_fixture_refuses_missing_zero_nonzero_or_incorrect_receipts(self):
        for case in ('missing-pending-fixture', 'pending-missing-input', 'pending-zero-tests',
                     'pending-nonzero-exit', 'pending-missing-control', 'pending-bad-control',
                     'pending-wrong-manifest', 'pending-wrong-scenario', 'pending-wrong-input',
                     'pending-unclean-control', 'pending-leaked-temp', 'pending-changed-input'):
            with self.subTest(case=case), Attempt(case=case) as attempt:
                with self.assertRaises((RuntimeError, OSError)):
                    attempt.run()
                self.assertEqual(attempt.terminal()['status'], 'fail')
                self.assertNotIn('OTTPLAY_MULTIVIEW_PENDING_INPUTS', attempt.driver.env)
                self.assertNotIn('OTTPLAY_MULTIVIEW_PENDING_CASE_DIR', attempt.driver.env)
                self.assertTrue(all(row['cleanup_confirmed'] for row in attempt.driver.commands))
                self.assertNotIn('fixture-4', [row['name'] for row in attempt.driver.commands])

    def test_pending_failures_deliver_bounded_control_and_preserve_original_error(self):
        for case in ('pending-nonzero-exit', 'pending-bad-control', 'pending-wrong-scenario', 'pending-leaked-temp'):
            with self.subTest(case=case), Attempt(case=case) as attempt:
                with self.assertRaises(RuntimeError):
                    attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['status'], 'fail')
                forensic = result['pending_clock_forensic']
                self.assertFalse(forensic['qualified'])
                self.assertTrue(forensic['forensic_only'])
                self.assertEqual(len(forensic['evidence']), 2)
                for row in forensic['evidence']:
                    payload = (attempt.output / 'evidence' / row['path']).read_bytes()
                    self.assertEqual(len(payload), row['bytes'])
                    self.assertEqual(hashlib.sha256(payload).hexdigest(), row['sha256'])
                if case == 'pending-nonzero-exit':
                    self.assertIn('Synthetic pending command exited nonzero', result['error'])
                self.assertEqual(attempt.driver.env['TMPDIR'], str(attempt.output / 'tmp'))
                self.assertTrue(all(row['cleanup_confirmed'] for row in attempt.driver.commands))

    def test_pending_forensic_copy_failure_cannot_mask_rust_failure_or_environment_restore(self):
        atomic = guard.Budget.atomic
        def refuse_forensic(budget, path, data, **kwargs):
            if 'pending-clock-forensic-' in Path(path).name:
                raise RuntimeError('synthetic forensic write refusal')
            return atomic(budget, path, data, **kwargs)
        with Attempt(case='pending-nonzero-exit') as attempt, mock.patch.object(guard.Budget, 'atomic', refuse_forensic):
            with self.assertRaises(RuntimeError):
                attempt.run()
            result = attempt.terminal()
            self.assertIn('Synthetic pending command exited nonzero', result['error'])
            self.assertIn('synthetic forensic write refusal', result['pending_clock_forensic_error'])
            self.assertEqual(result['status'], 'fail')
            self.assertEqual(attempt.driver.env['TMPDIR'], str(attempt.output / 'tmp'))
            self.assertNotIn('OTTPLAY_MULTIVIEW_PENDING_INPUTS', attempt.driver.env)
            self.assertTrue(all(row['cleanup_confirmed'] for row in attempt.driver.commands))

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
                self.assertEqual(result['tests'], list(EXPECTED_TESTS) + [EXPECTED_PRODUCTION_TEST, EXPECTED_HLS_PRODUCTION_TEST])
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


class PlaylistDropContracts(unittest.TestCase):
    def test_required_unix_cases_bind_to_actual_playlist_source(self):
        self.assertEqual(ci.PLAYLIST_DROP_REQUIRED_TESTS, frozenset(PLAYLIST_DROP_REQUIRED_NAMES))
        source = (ROOT / 'src-rs/core/src/offline_media/drop_playlist.rs').read_text()
        for name in PLAYLIST_DROP_REQUIRED_NAMES:
            self.assertIn('async fn ' + name.rsplit('::', 1)[1] + '()', source)

    def test_all_discovered_tests_reuse_the_compiled_core_on_both_unix_hosts(self):
        for system in ('Linux', 'Darwin'):
            with self.subTest(system=system), Attempt(system=system) as attempt:
                attempt.run()
                result = attempt.terminal()
                self.assertEqual(result['status'], 'pass')
                self.assertEqual(result['ordinary_playlist_drop_tests'], sorted(PLAYLIST_DROP_NAMES))
                rows = {row['name']: row for row in attempt.driver.commands}
                for name in ('core-playlist-inventory', 'core-playlist-ignored-inventory', 'core-playlist-ordinary'):
                    self.assertEqual(rows[name]['argv'][:2], [str(attempt.core_executable), ci.PLAYLIST_DROP_PREFIX])
                    self.assertTrue(rows[name]['cleanup_confirmed'])
                self.assertEqual(rows['core-playlist-ordinary']['argv'][2:], ['--test-threads=1', '--color=never'])
                self.assertEqual(rows['core-playlist-ordinary']['limit'], 60)
                self.assertEqual(sum(row['name'] == 'core-fixture-build' for row in attempt.driver.commands), 1)
                names = [row['name'] for row in attempt.driver.commands]
                self.assertLess(names.index('core-playlist-ordinary'), names.index('core-multiview-ordinary'))
                before = json.loads((attempt.output / 'evidence/source-before.json').read_text())
                after = json.loads((attempt.output / 'evidence/source-after.json').read_text())
                self.assertEqual(before, after)
                for path in ('src-rs/core/src/offline_media.rs', 'src-rs/core/src/offline_media/drop_playlist.rs'):
                    self.assertEqual(before['sha256'][path], hashlib.sha256((attempt.root / path).read_bytes()).hexdigest())

    def test_missing_ignored_empty_foreign_and_duplicate_inventory_fail_before_execution(self):
        cases = [('missing', name) for name in PLAYLIST_DROP_REQUIRED_NAMES]
        cases += [('ignored', name) for name in PLAYLIST_DROP_NAMES]
        cases += [(name, '') for name in ('empty', 'foreign', 'duplicate')]
        for case, target in cases:
            with self.subTest(case=case, target=target), Attempt() as attempt:
                original = attempt.response
                def response(name, argv, original=original, case=case, target=target):
                    text = original(name, argv)
                    if name == 'core-playlist-inventory':
                        if case == 'missing':
                            return text.replace(target + ': test\n', '')
                        if case == 'empty':
                            return ''
                        if case == 'foreign':
                            return text + 'other::test: test\n'
                        if case == 'duplicate':
                            return text + PLAYLIST_DROP_NAMES[0] + ': test\n'
                    if name == 'core-playlist-ignored-inventory' and case == 'ignored':
                        return target + ': test\n'
                    return text
                with mock.patch.object(attempt, 'response', side_effect=response), self.assertRaises(RuntimeError):
                    attempt.run()
                self.assertEqual(attempt.terminal()['status'], 'fail')
                self.assertNotIn('core-playlist-ordinary', [row['name'] for row in attempt.driver.commands])

    def test_incomplete_failed_zero_and_nonzero_execution_cannot_claim_success(self):
        for case in ('missing-discovered', 'failed', 'zero', 'ignored', 'wrong-summary', 'nonzero'):
            with self.subTest(case=case), Attempt() as attempt:
                original = attempt.response
                def response(name, argv, original=original, case=case):
                    if name != 'core-playlist-ordinary':
                        return original(name, argv)
                    if case == 'nonzero':
                        raise RuntimeError('Synthetic playlist command exited nonzero')
                    if case == 'zero':
                        return suite_passed(())
                    if case == 'missing-discovered':
                        return suite_passed(PLAYLIST_DROP_REQUIRED_NAMES)
                    if case == 'ignored':
                        return suite_passed(PLAYLIST_DROP_NAMES[:-1], PLAYLIST_DROP_NAMES[-1:])
                    text = suite_passed(PLAYLIST_DROP_NAMES)
                    if case == 'failed':
                        return text.replace(PLAYLIST_DROP_NAMES[-1] + ' ... ok', PLAYLIST_DROP_NAMES[-1] + ' ... FAILED')
                    return text.replace('0 failed;', '1 failed;')
                with mock.patch.object(attempt, 'response', side_effect=response), self.assertRaises(RuntimeError):
                    attempt.run()
                self.assertEqual(attempt.terminal()['status'], 'fail')
                self.assertNotIn('core-multiview-ordinary', [row['name'] for row in attempt.driver.commands])

    def test_both_playlist_inputs_remain_bound_through_the_final_source_check(self):
        for path in ('src-rs/core/src/offline_media.rs', 'src-rs/core/src/offline_media/drop_playlist.rs'):
            with self.subTest(path=path), Attempt() as attempt:
                original = attempt.response
                def response(name, argv, original=original, path=path, attempt=attempt):
                    if name == 'fixture-3':
                        (attempt.root / path).write_text('synthetic changed playlist source')
                    return original(name, argv)
                with mock.patch.object(attempt, 'response', side_effect=response), self.assertRaises(RuntimeError):
                    attempt.run()
                self.assertIn('Source or root lock changed', attempt.terminal()['error'])


class CoreRequiredContracts(unittest.TestCase):
    def test_clock_gap_inventory_uses_real_session_driver_test_context(self):
        suffix = '::tests::session_clock_keeps_waiting_decoder_live_through_output_gap_longer_than_five_seconds'
        self.assertIn('multiview::persistent' + suffix, ci.CORE_REQUIRED_CLOCK_RETIREMENT_TESTS)
        self.assertNotIn('multiview::decoder' + suffix, ci.CORE_REQUIRED_CLOCK_RETIREMENT_TESTS)

    def test_remaining_budget_inventory_binds_all_four_actual_regressions(self):
        self.assertEqual(len(CORE_REMAINING_BUDGET_NAMES),4)
        self.assertEqual(ci.CORE_REQUIRED_REMAINING_BUDGET_TESTS,frozenset(CORE_REMAINING_BUDGET_NAMES))

    def test_each_frozen_authority_regression_is_mandatory_and_cannot_be_ignored(self):
        self.assertEqual(ci.CORE_REQUIRED_TESTS, frozenset(CORE_REQUIRED_NAMES))
        self.assertEqual(len(CORE_REQUIRED_NAMES), 5)
        for required in (*CORE_REQUIRED_NAMES, *sorted(ci.CORE_REQUIRED_HLS_TESTS), *sorted(ci.CORE_REQUIRED_PRIVATE_HTTP_TESTS), *CORE_REMAINING_BUDGET_NAMES):
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
                    expected_error = ('Core multiview ignored test inventory differs from the one reviewed media test'
                                      if state == 'ignored' else 'Required ordinary core regression is absent or ignored')
                    self.assertIn(expected_error, result['error'])
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

    def test_reviewed_analyzer_pin_matches_source_and_loader_accepts_it(self):
        media_path = ROOT / 'scripts/ci-multiview-unix-media.py'
        actual = hashlib.sha256(media_path.read_bytes()).hexdigest()
        self.assertEqual(ci.STREAM_MEDIA_SHA256, actual)
        loaded = ci.load_stream_media(ROOT, guard.Budget())
        self.assertTrue(callable(loaded.finish))

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

    def test_bounded_rgb_failure_observation_is_forensic_only_and_exactly_named(self):
        with tempfile.TemporaryDirectory(prefix="stream-rgb-forensic-") as raw:
            root = Path(raw).resolve()
            roots = tuple(root / name for name in ("inputs", "case", "analysis"))
            for path in roots:
                path.mkdir()
            evidence = root / "evidence"
            evidence.mkdir()
            failure = {"window_index": 2, "planned_frames": 80, "decoded_frames": 65,
                       "raw_bytes": 65 * 384 * 288 * 3, "partial_frame_bytes": 0,
                       "reason": "RGB_FRAME_COUNT_MISMATCH", "qualification": False}
            source = roots[2] / "video-window-failure.json"
            payload = json.dumps(failure, sort_keys=True, separators=(",", ":")).encode()
            source.write_bytes(payload)
            report = media.failure_evidence(roots[1], roots[2])
            self.assertFalse(report["qualified"])
            self.assertTrue(report["forensic_only"])
            selected = [row for row in report["evidence"]
                        if row["relative_name"].endswith("video-window-failure.json")]
            self.assertEqual(len(selected), 1)
            self.assertEqual(selected[0]["max_bytes"], 16 * 1024)
            self.assertEqual(selected[0]["relative_name"],
                             "stream-media-forensic/analysis/video-window-failure.json")
            driver = types.SimpleNamespace(evidence=evidence)
            adopted = ci.adopt_stream_evidence(driver, guard.Budget(), selected, roots, forensic=True)
            destination = evidence / selected[0]["relative_name"]
            self.assertEqual(destination.read_bytes(), payload)
            self.assertEqual(adopted[0]["bytes"], len(payload))
            for spec in (
                    {**selected[0], "relative_name": "stream-media-forensic/analysis/unexpected.json"},
                    {**selected[0], "max_bytes": 16 * 1024 + 1},
                    {**selected[0], "relative_name": "stream-media/analysis/video-window-failure.json"}):
                with self.subTest(spec=spec), self.assertRaises(RuntimeError):
                    ci.adopt_stream_evidence(driver, guard.Budget(), [spec], roots, forensic=True)
            malformed_payloads = (
                json.dumps({**failure, "reason": "raw exception text"}).encode(),
                json.dumps({**failure, "unexpected_url": "https://fixture.invalid/private"}).encode(),
                b'{"window_index":2,"window_index":3}',
            )
            for malformed in malformed_payloads:
                with self.subTest(malformed=malformed[:80]):
                    source.write_bytes(malformed)
                    malformed_report = media.failure_evidence(roots[1], roots[2])
                    self.assertIn("MALFORMED_STRUCTURE", malformed_report["errors"])
                    self.assertFalse(any(row["relative_name"].endswith("video-window-failure.json")
                                         for row in malformed_report["evidence"]))
                    with self.assertRaisesRegex(RuntimeError, "RGB failure"):
                        ci.adopt_stream_evidence(
                            types.SimpleNamespace(evidence=root / "reject-evidence"),
                            guard.Budget(), selected, roots, forensic=True)
            source.write_bytes(payload)
            source.write_bytes(b" " * (16 * 1024 + 1))
            oversized = media.failure_evidence(roots[1], roots[2])
            self.assertIn("CUSTODY_OR_BOUND", oversized["errors"])
            self.assertFalse(any(row["relative_name"].endswith("video-window-failure.json")
                                 for row in oversized["evidence"]))

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


class ProductionRetryContracts(unittest.TestCase):
    """The macOS production retry stays Darwin-only and signature-exact."""

    class LogBudget:
        """Only the bounded log read the eligibility gate performs."""

        def __init__(self):
            self.reads = []

        def read(self, path, cap):
            self.reads.append((path, cap))
            return path.read_bytes()

    def eligibility(self, system, log, error=None):
        with tempfile.TemporaryDirectory(prefix='production-retry-offline-') as raw:
            path = Path(raw).resolve() / 'production-normal-server.log'
            if log is not None:
                path.write_text(log)
            with mock.patch.object(ci.platform, 'system', return_value=system):
                return ci.production_fixture_retry_eligible(
                    error if error is not None else RuntimeError('Synthetic production command exited nonzero'),
                    path, self.LogBudget())

    def assert_reviewed_budget_unchanged(self, attempt):
        # Fractional monotonic clocks make deadline subtraction inexact; compare
        # absolute deadlines instead, as StreamedContracts already documents.
        budget = attempt.driver.budget
        self.assertEqual(budget.deadline, budget.started + 1800)
        self.assertEqual(budget.work_deadline, budget.started + 1680)

    def test_retry_constants_stay_narrow(self):
        self.assertEqual(ci.PRODUCTION_MACOS_FLAKY_MAX_RETRIES, 2)
        self.assertEqual(ci.PRODUCTION_MACOS_FLAKY_SIGNATURES, (
            'sibling source authority disappeared for 3 consecutive samples',
            'pre-replacement HLS playlist snapshot:',
        ))

    def test_only_the_exact_macos_signature_is_eligible(self):
        for signature in ci.PRODUCTION_MACOS_FLAKY_SIGNATURES:
            with self.subTest(signature=signature):
                self.assertEqual(self.eligibility('Darwin', 'noise\n' + signature + '\nnoise\n'),
                                 (True, signature))
                self.assertEqual(self.eligibility('Linux', signature), (False, 'non-macos'))

    def test_unrelated_failures_are_never_retried(self):
        self.assertEqual(self.eligibility('Darwin', 'EncoderFailureDetail { error: Stalled, limit_ns: 200000000 }'),
                         (False, 'signature-absent'))
        self.assertEqual(self.eligibility('Darwin', 'sibling'), (False, 'signature-absent'))
        self.assertEqual(self.eligibility('Darwin', ci.PRODUCTION_MACOS_FLAKY_SIGNATURES[0],
                                          error=ValueError('not ours')),
                         (False, 'unexpected-error-type'))
        self.assertEqual(self.eligibility('Darwin', None), (False, 'missing-log'))

    def test_symlinked_log_is_refused(self):
        with tempfile.TemporaryDirectory(prefix='production-retry-link-') as raw:
            root = Path(raw).resolve()
            target = root / 'real.log'
            target.write_text(ci.PRODUCTION_MACOS_FLAKY_SIGNATURES[0])
            link = root / 'production-normal-server.log'
            link.symlink_to(target)
            with mock.patch.object(ci.platform, 'system', return_value='Darwin'):
                self.assertEqual(ci.production_fixture_retry_eligible(
                    RuntimeError('Synthetic production command exited nonzero'), link, self.LogBudget()),
                    (False, 'missing-log'))

    def production_commands(self, attempt):
        return [row['name'] for row in attempt.driver.commands
                if row['name'].startswith('production-normal-server')]

    def test_macos_signature_failure_qualifies_after_one_recorded_retry(self):
        with Attempt('production-signature-once', system='Darwin') as attempt:
            attempt.run()
            result = attempt.terminal()
            self.assertEqual(result['status'], 'pass')
            self.assertEqual(self.production_commands(attempt),
                             ['production-normal-server', 'production-normal-server-retry-1'])
            retry = result['production_flaky_retry']
            self.assertIs(retry['qualified_after_retry'], True)
            self.assertEqual((retry['test'], retry['platform'], retry['max_retries'], retry['final_attempt']),
                             (EXPECTED_PRODUCTION_TEST, 'Darwin', 2, 2))
            self.assertEqual(len(retry['attempts']), 1)
            first = retry['attempts'][0]
            self.assertEqual({key: first[key] for key in
                              ('attempt', 'command', 'error', 'error_type', 'retry_eligible', 'reason')}, {
                'attempt': 1, 'command': 'production-normal-server',
                'error': 'Synthetic production command exited nonzero',
                'error_type': 'RuntimeError', 'retry_eligible': True,
                'reason': 'sibling source authority disappeared for 3 consecutive samples'})
            self.assertGreaterEqual(first['remaining_seconds_before_retry'],
                                    ci.PRODUCTION_MACOS_FLAKY_RETRY_MIN_REMAINING_SECONDS)
            self.assertNotIn('retry_skipped', first)
            # The reviewed work deadline is never extended for a retry.
            self.assert_reviewed_budget_unchanged(attempt)

    def test_retry_is_skipped_and_recorded_when_budget_cannot_fit(self):
        self.assertEqual(ci.PRODUCTION_MACOS_FLAKY_RETRY_MIN_REMAINING_SECONDS, 300)
        budget_view = types.SimpleNamespace(work_deadline=1000.0, clock=lambda: 958.5)
        self.assertEqual(ci.production_retry_remaining_seconds(budget_view), 41.5)
        with Attempt('production-signature-once', system='Darwin') as attempt:
            with mock.patch.object(ci, 'production_retry_remaining_seconds', return_value=41.5), \
                    self.assertRaises(RuntimeError):
                attempt.run()
            result = attempt.terminal()
            self.assertEqual(result['status'], 'fail')
            self.assertEqual(self.production_commands(attempt), ['production-normal-server'])
            retry = result['production_flaky_retry']
            self.assertIs(retry['qualified_after_retry'], False)
            self.assertEqual(retry['retry_skipped'], 'insufficient_remaining_budget')
            first = retry['attempts'][0]
            self.assertEqual(first['retry_skipped'], 'insufficient_remaining_budget')
            self.assertEqual(first['remaining_seconds_before_retry'], 41.5)
            self.assertLess(first['remaining_seconds_before_retry'],
                            ci.PRODUCTION_MACOS_FLAKY_RETRY_MIN_REMAINING_SECONDS)
            self.assertTrue(first['retry_eligible'])
            # A skipped retry never moves the reviewed deadline.
            self.assert_reviewed_budget_unchanged(attempt)

    def test_linux_keeps_one_strict_attempt(self):
        with Attempt('production-signature-once', system='Linux') as attempt:
            with self.assertRaises(RuntimeError):
                attempt.run()
            result = attempt.terminal()
            self.assertEqual(result['status'], 'fail')
            self.assertEqual(self.production_commands(attempt), ['production-normal-server'])
            retry = result['production_flaky_retry']
            self.assertIs(retry['qualified_after_retry'], False)
            self.assertEqual((retry['max_retries'], retry['final_attempt']), (0, 1))
            self.assertEqual(retry['attempts'][0]['retry_eligible'], False)
            self.assertEqual(retry['attempts'][0]['reason'], 'non-macos')

    def test_macos_failure_outside_the_signature_keeps_one_attempt(self):
        with Attempt(system='Darwin') as attempt:
            original = ci.require_one_pass
            fired = []

            def strict(text, name):
                if name == EXPECTED_PRODUCTION_TEST and not fired:
                    fired.append(name)
                    raise RuntimeError('Synthetic production command exited nonzero')
                return original(text, name)

            with mock.patch.object(ci, 'require_one_pass', side_effect=strict), \
                    self.assertRaises(RuntimeError):
                attempt.run()
            self.assertEqual(fired, [EXPECTED_PRODUCTION_TEST])
            self.assertEqual(self.production_commands(attempt), ['production-normal-server'])
            retry = attempt.terminal()['production_flaky_retry']
            self.assertIs(retry['qualified_after_retry'], False)
            self.assertEqual(retry['attempts'][0]['reason'], 'signature-absent')

    def test_two_signature_failures_still_fail_the_qualification(self):
        with Attempt('production-signature-always', system='Darwin') as attempt:
            with self.assertRaises(RuntimeError):
                attempt.run()
            self.assertEqual(self.production_commands(attempt),
                             ['production-normal-server', 'production-normal-server-retry-1',
                              'production-normal-server-retry-2'])
            retry = attempt.terminal()['production_flaky_retry']
            self.assertIs(retry['qualified_after_retry'], False)
            self.assertEqual((retry['max_retries'], retry['final_attempt']), (2, 3))
            self.assertTrue(all(row['retry_eligible'] for row in retry['attempts']))
            # A retried attempt records the remaining budget; the last one does not retry.
            self.assertTrue(all('remaining_seconds_before_retry' in row
                                for row in retry['attempts'][:-1]))
            self.assertNotIn('remaining_seconds_before_retry', retry['attempts'][-1])
            self.assertNotIn('retry_skipped', retry)


class ParsingTests(unittest.TestCase):
    def test_captured_filter_rows_and_legacy_three_flags_are_supported(self):
        self.assertEqual(ci.filter_names(CAPTURED_FILTER_ROWS), ci.FILTERS)
        self.assertIn('select', ci.filter_names(' .. select            V->N       Select video frames to pass in output.'))
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
        self.assertEqual(len(ci.BROKER_TESTS - ci.BROKER_PRODUCTION_TESTS - ci.BROKER_HLS_TESTS - ci.BROKER_SHUTDOWN_TESTS - EXPECTED_BROKER_PLAY_DIAGNOSTIC_TESTS - EXPECTED_BROKER_CLOSE_DIAGNOSTIC_TESTS), 55)
        self.assertEqual(hashlib.sha256("\n".join(sorted(ci.BROKER_TESTS - ci.BROKER_PRODUCTION_TESTS - ci.BROKER_HLS_TESTS - ci.BROKER_SHUTDOWN_TESTS - EXPECTED_BROKER_PLAY_DIAGNOSTIC_TESTS - EXPECTED_BROKER_CLOSE_DIAGNOSTIC_TESTS)).encode("utf8")).hexdigest(),
                         "6e92eb3d53b6de4ae38ec7bdfdef92883e87f4a2e887efe2c4539b20a1fc4f9f")

    def test_exact_mandatory_production_broker_inventory(self):
        self.assertEqual(len(ci.BROKER_TESTS), 79)
        self.assertEqual(len(ci.BROKER_PRODUCTION_TESTS), 13)
        self.assertEqual(ci.BROKER_HLS_TESTS, frozenset({'broker::live::tests::production_adapter_set_is_unique_explicit_and_keeps_other_guards'}))
        self.assertEqual(ci.BROKER_PRODUCTION_TESTS, frozenset({
            'broker::production_tests::busy_host_state_refuses_renew_without_waiting_or_mutating_lease',
            'broker::production_tests::busy_monotonic_deadline_refuses_renew_without_waiting_or_mutating_lease',
            'broker::production_tests::credential_expiring_between_admission_and_commit_cannot_renew',
            'broker::production_tests::expired_monotonic_owner_lease_rejects_renew_even_if_wall_clock_moves_back',
            'broker::production_tests::expired_soft_lease_cannot_be_resurrected_by_registry_renewal',
            'broker::production_tests::media_checks_and_reporting_never_renew_and_held_body_loses_authority',
            'broker::production_tests::monotonic_expiry_revokes_body_even_when_test_wall_clock_moves_back',
            'broker::production_tests::ordinary_constructor_remains_zero_capacity',
            'broker::production_tests::production_opt_in_preserves_fixture_limit_and_shutdown_is_terminal',
            'broker::production_tests::production_rejects_unknown_adapters_and_overlong_custody',
            'broker::production_tests::renew_keeps_signed_path_and_hard_ceiling_but_advances_only_live_deadline',
            'broker::production_tests::revoked_output_and_credential_cannot_extend_lease',
            'broker::production_tests::stale_binding_or_credential_revision_cannot_renew',
        }))
        self.assertEqual(hashlib.sha256("\n".join(sorted(ci.BROKER_TESTS - ci.BROKER_PRODUCTION_TESTS - ci.BROKER_HLS_TESTS - ci.BROKER_SHUTDOWN_TESTS - EXPECTED_BROKER_PLAY_DIAGNOSTIC_TESTS - EXPECTED_BROKER_CLOSE_DIAGNOSTIC_TESTS)).encode("utf8")).hexdigest(),
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
    def failed(self, attempt, reason):
        with self.assertRaises(RuntimeError):
            attempt.run()
        result = attempt.terminal()
        self.assertEqual(result['status'], 'fail')
        self.assertIn(reason, result['error'])
        self.assertFalse(result['production_admission'])
        self.assertFalse(result['sustained_media_e2e'])
        return result

    def test_hls_item_adapter_policy_has_exact_nonzero_execution_and_cannot_be_ignored(self):
        with Attempt() as attempt:
            attempt.run()
            row=next(row for row in attempt.driver.commands if row['name']=='hls-item-policy')
            self.assertEqual(row['argv'][1:], [ci.HLS_ITEM_ADAPTER_TEST,'--exact','--test-threads=1','--color=never'])
            self.assertEqual(row['limit'],30)
        for case in ('hls-policy-missing','hls-policy-ignored','hls-policy-zero'):
            with self.subTest(case=case), Attempt(case) as attempt:
                with self.assertRaises(RuntimeError):attempt.run()
                self.assertFalse(attempt.terminal()['normal_server_hls_to_hls'])
                self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])

    def test_public_http_policy_requires_each_exact_nonignored_nonzero_unit(self):
        self.assertEqual(len(ci.PUBLIC_HTTP_POLICY_TESTS),3)
        with Attempt() as attempt:
            attempt.run()
            for index,name in enumerate(ci.PUBLIC_HTTP_POLICY_TESTS):
                row=next(row for row in attempt.driver.commands if row['name']==f'public-http-policy-{index}')
                self.assertEqual(row['argv'][1:],[name,'--exact','--test-threads=1','--color=never'])
                self.assertEqual(row['limit'],30)
        for index in range(3):
            for failure in ('missing','ignored','zero'):
                with self.subTest(index=index,failure=failure), Attempt(f'public-http-{index}-{failure}') as attempt:
                    with self.assertRaises(RuntimeError):attempt.run()
                    self.assertFalse(attempt.terminal()['normal_server_hls_to_hls'])
                    self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])

    def test_private_http_policy_requires_actual_config_units_and_core_destination_guards(self):
        self.assertEqual(len(ci.PRIVATE_HTTP_POLICY_TESTS),4)
        self.assertEqual(len(ci.CORE_REQUIRED_PRIVATE_HTTP_TESTS),3)
        with Attempt() as attempt:
            attempt.run()
            for index,name in enumerate(ci.PRIVATE_HTTP_POLICY_TESTS):
                row=next(row for row in attempt.driver.commands if row['name']==f'private-http-policy-{index}')
                self.assertEqual(row['argv'][1:],[name,'--exact','--test-threads=1','--color=never'])
                self.assertEqual(row['limit'],30)
        for index in range(4):
            for failure in ('missing','ignored','zero'):
                with self.subTest(index=index,failure=failure), Attempt(f'private-http-{index}-{failure}') as attempt:
                    with self.assertRaises(RuntimeError):attempt.run()
                    self.assertFalse(attempt.terminal()['normal_server_hls_to_hls'])
                    self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])

    def test_output_segment_proof_requires_closed_measured_sampling_evidence(self):
        row={'sha256':'a'*64,'bytes':1880,'decoded_video_frames':10,'sample_index':9,
             'duration_ticks':90000,'time_base':'1/90000','source_identity_unchanged':True}
        ci.require_segment_video_proofs([row])
        ci.require_segment_video_proofs([dict(row,decoded_video_frames=11,sample_index=10)])
        invalid=[None,[],[row]*65,[{}]]
        for key,value in [('sha256','not-a-hash'),('sha256',7),('bytes',True),('bytes',187),
                          ('decoded_video_frames',0),('decoded_video_frames',301),
                          ('sample_index',10),('sample_index',False),('duration_ticks',0),
                          ('duration_ticks',2**63),('time_base','0/90000'),('time_base','1/0'),
                          ('time_base','1/90000/private'),('time_base',None),
                          ('time_base',str(2**64)+'/1'),('duration_ticks',31*90000),
                          ('source_identity_unchanged',False),('source_identity_unchanged',1)]:
            invalid.append([dict(row,**{key:value})])
        invalid.append([dict(row,unexpected='value')])
        for rows in invalid:
            with self.subTest(rows=rows),self.assertRaises(RuntimeError):
                ci.require_segment_video_proofs(rows)
        with Attempt('production-no-segment-proof') as attempt:
            self.failed(attempt, 'Normal output segment proof collection')
            self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])
            self.assertFalse(attempt.terminal()['normal_server_hls_to_hls'])

    def test_normal_fixture_credential_and_startup_diagnostic_units_are_mandatory(self):
        required={'unwind_stderr_capture_preserves_original_panic_and_clears_registration',
                  'owned_stderr_drops_incomplete_secret_line_before_bounded_redaction',
                  'playlist_failure_evidence_preserves_http_parse_and_fatal_origin_contracts',
                  'segment_video_proof_checks_count_timing_and_sampling_domain',
                  'two_slot_fixture_geometry_passes_actual_core_validation',
                  'nine_slot_fixture_geometry_passes_actual_core_and_old_odd_grid_is_rejected',
                  'api_failure_diagnostics_bind_request_hash_and_closed_redacted_response',
                  'startup_diagnostic_tail_is_bounded_and_redacts_fixture_secrets_and_urls',
                  'production_tls::leaf_request_has_explicit_distinguished_name_for_openssl_1_1_and_3',
                  'hls_production::tests::starts_with_three_complete_and_slides_six_without_exposing_future',
                  'hls_production::tests::never_loops_or_serves_fifty_first_segment_and_keeps_original_duration',
                  'hls_production::tests::exact_path_fence_and_master_child_are_self_contained'}
        self.assertEqual(required, ci.PRODUCTION_ORDINARY_TESTS)
        for missing in sorted(required):
            for failure in ('missing', 'ignored'):
                with self.subTest(missing=missing, failure=failure), Attempt() as attempt:
                    original=attempt.response
                    def response(name,argv,original=original,missing=missing,failure=failure):
                        text=original(name,argv)
                        if failure == 'missing' and name=='production-inventory':
                            return '\n'.join(line for line in text.splitlines() if line != missing+': test')+'\n'
                        if failure == 'ignored' and name=='production-ignored-inventory':
                            return text + missing + ': test\n'
                        return text
                    with mock.patch.object(attempt,'response',side_effect=response), self.assertRaises(RuntimeError):attempt.run()
                    self.assertFalse(attempt.terminal()['normal_server_hls_to_hls'])
                    self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])

    def test_normal_inventory_matches_current_rust_fixture_and_support_sources(self):
        # Check the actual closed fixture modules, independently of Attempt's synthetic --list.
        sources = (
            ('src-rs/server/tests/multiview_production.rs', ''),
            ('src-rs/server/src/private_media_attempt.rs', 'media_attempt::'),
            ('src-rs/server/tests/support/hls_production.rs', 'hls_production::tests::'),
            ('src-rs/server/tests/support/multiview_production_tls.rs', 'production_tls::'),
        )
        ordinary, ignored = set(), set()
        for path, prefix in sources:
            text = (ROOT / path).read_text()
            rows = re.findall(r'(?m)^\s*#\[test\]\s*((?:#\[[^\n]+\]\s*)*)fn\s+(\w+)\s*\(', text)
            self.assertEqual(len(rows), text.count('#[test]'), path)
            for attributes, name in rows:
                target = ignored if re.search(r'#\[ignore(?:\s*=|\])', attributes) else ordinary
                self.assertNotIn(prefix + name, ordinary | ignored)
                target.add(prefix + name)
        self.assertEqual(ordinary, ci.PRODUCTION_ORDINARY_TESTS)
        self.assertEqual(ignored, {EXPECTED_PRODUCTION_TEST, EXPECTED_HLS_PRODUCTION_TEST})

    def test_private_tool_custody_preserves_selected_bytes_without_uploading_binaries(self):
        with Attempt() as attempt:
            attempt.run()
            receipt=json.loads((attempt.output/'evidence/production-tool-custody.json').read_text())
            cleanup=json.loads((attempt.output/'evidence/production-tool-custody-cleanup.json').read_text())
            self.assertFalse(receipt['transitive_shared_library_custody_qualified'])
            self.assertTrue(cleanup['cleanup_confirmed'])
            self.assertFalse(Path(receipt['root']).exists())
            self.assertFalse((attempt.output/'production-tool-custody-reservation').exists())
            self.assertEqual(receipt['copied_bytes'],sum(Path(attempt.supplied[n]).stat().st_size for n in ('ffmpeg','ffprobe','mkfifo')))
            self.assertEqual(receipt['reserved_bytes'],receipt['copied_bytes']+65536)
            for name,row in receipt['tools'].items():
                self.assertEqual(row['staged']['sha256'],row['original']['sha256'])
                self.assertEqual(stat.S_IMODE(row['staged']['mode']),0o500)
                self.assertEqual(row['staged']['nlink'],1)
                self.assertNotEqual(row['staged']['path'],row['original']['path'])
                key={'ffmpeg':'OTTPLAY_MULTIVIEW_FFMPEG','ffprobe':'OTTPLAY_MULTIVIEW_FFPROBE','mkfifo':'OTTPLAY_MULTIVIEW_MKFIFO'}[name]
                self.assertTrue(all(env[key]==row['staged']['path'] for env in attempt.production_tool_envs))
            self.assertEqual(len(receipt['fifo_probes']),2)
            self.assertEqual(receipt['fifo_probes'][0]['mode'],'0o600')
            names=[row['name'] for row in attempt.driver.commands]
            self.assertTrue({'production-custody-ffmpeg-version','production-custody-ffprobe-version',
                'production-custody-mkfifo-0','production-custody-mkfifo-1'}<=set(names))
            self.assertLess(names.index('production-custody-ffprobe-version'),names.index('production-normal-server'))

    def test_unrunnable_staged_supplier_and_nonfifo_probe_fail_closed_without_fallback(self):
        for case in ('staged-version-unusable','staged-mkfifo-not-fifo'):
            with self.subTest(case=case), Attempt(case) as attempt:
                with self.assertRaises(RuntimeError):attempt.run()
                self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])
                self.assertFalse(any(row['name']=='production-normal-server' for row in attempt.driver.commands))
                cleanup=json.loads((attempt.output/'evidence/production-tool-custody-cleanup.json').read_text())
                # A non-FIFO at an owned FIFO name is retained as uncertain, never swept.
                self.assertEqual(cleanup['cleanup_confirmed'],case!='staged-mkfifo-not-fifo')

    def test_uncertain_process_cleanup_retains_owned_tools_and_growth_charge(self):
        with Attempt() as attempt:
            original=attempt.response
            def response(name,argv):
                text=original(name,argv)
                if name=='production-normal-server':attempt.driver.commands[-1]['cleanup_confirmed']=False
                return text
            with mock.patch.object(attempt,'response',side_effect=response), self.assertRaises(RuntimeError):attempt.run()
            cleanup=json.loads((attempt.output/'evidence/production-tool-custody-cleanup.json').read_text())
            self.assertFalse(cleanup['cleanup_confirmed'])
            self.assertTrue(Path(cleanup['root']).is_dir())
            self.assertEqual((attempt.output/'production-tool-custody-reservation').stat().st_size,cleanup['reserved_bytes'])
            self.assertFalse(any(row['name']=='production-live-hls-server' for row in attempt.driver.commands))
            self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])

    def test_selected_source_mutation_and_changed_reservation_deny_before_native_qualification(self):
        for fault in ('source','reservation'):
            with self.subTest(fault=fault), Attempt() as attempt:
                original_chmod=Path.chmod
                fired=False
                def chmod(path,mode,*args,fault=fault,original_chmod=original_chmod,**kwargs):
                    nonlocal fired
                    result=original_chmod(path,mode,*args,**kwargs)
                    if not fired and mode==0o500 and path.name=='ffmpeg' and path.parent.name.startswith('.ottplay-multiview-tools-'):
                        fired=True
                        if fault=='source':Path(attempt.supplied['ffmpeg']).write_bytes(b'changed selected source')
                        else:
                            reservation=attempt.output/'production-tool-custody-reservation'
                            original_chmod(reservation,0o600)
                            with reservation.open('r+b') as stream:stream.truncate(0)
                    return result
                with mock.patch.object(Path,'chmod',chmod), self.assertRaises(RuntimeError):attempt.run()
                self.assertTrue(fired)
                self.assertFalse(any(row['name']=='production-normal-server' for row in attempt.driver.commands))
                self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])
                cleanup=json.loads((attempt.output/'evidence/production-tool-custody-cleanup.json').read_text())
                self.assertEqual(cleanup['cleanup_confirmed'],fault=='source')

    def test_staged_probes_use_normal_cleared_environment_and_empty_private_cwd(self):
        with Attempt() as attempt:
            original=attempt.response
            def response(name,argv):
                text=original(name,argv)
                if name=='fixture-3':
                    attempt.driver.env.update(LD_PRELOAD='poison',DYLD_LIBRARY_PATH='poison',
                        DYLD_INSERT_LIBRARIES='poison',HTTPS_PROXY='poison',FFREPORT='poison')
                return text
            with mock.patch.object(attempt,'response',side_effect=response):attempt.run()
            self.assertEqual(len(attempt.tool_probe_contexts),4)
            for env,cwd in attempt.tool_probe_contexts:
                self.assertEqual(set(env),{'HOME','EPG_URLS'})
                self.assertEqual(env['HOME'],str(attempt.home))
                self.assertEqual(env['EPG_URLS'],'http://127.0.0.1:1/fixture-unavailable')
                self.assertEqual(cwd.name,'probe-cwd')
                self.assertNotEqual(cwd,attempt.root)
            self.assertEqual(attempt.driver.env['LD_PRELOAD'],'poison')
            self.assertEqual(attempt.driver.root,attempt.root)
            receipt=json.loads((attempt.output/'evidence/production-tool-custody-cleanup.json').read_text())
            self.assertTrue(receipt['runtime_probe_matches_normal_server_env_clear'])
            self.assertLessEqual(receipt['observed_copy_metadata_bytes'],65536)

    def test_probe_env_contract_matches_actual_normal_binary_launch_source(self):
        source=(ROOT/'src-rs/server/tests/multiview_production.rs').read_text()
        launch_marker='let mut server = NormalServerGuard('
        self.assertEqual(source.count(launch_marker),1)
        launch=source.split(launch_marker,1)[1].split('.spawn()',1)[0]
        self.assertIn('.env_clear()',launch)
        self.assertIn('.current_dir(&public)',launch)
        self.assertEqual(set(re.findall(r'\.env\(\s*"([^"\n]+)"',launch)),{'HOME','EPG_URLS'})
        self.assertRegex(launch,r'\.env\("HOME",\s*secure_home\(\)\)')
        value=re.search(r'\.env\("EPG_URLS",\s*"([^"]+)"\)',launch).group(1)
        self.assertEqual(value,'http://127.0.0.1:1/fixture-unavailable')

    def test_positive_home_parent_growth_is_included_in_metadata_reservation(self):
        with Attempt() as attempt:
            original_lstat=Path.lstat
            def lstat(path,*args,**kwargs):
                value=original_lstat(path,*args,**kwargs)
                if path==attempt.home and list(attempt.home.glob('.ottplay-multiview-tools-*')):
                    fields={key:getattr(value,key) for key in ('st_mode','st_uid','st_dev','st_ino','st_nlink','st_mtime_ns','st_ctime_ns')}
                    fields['st_size']=value.st_size+65536
                    return types.SimpleNamespace(**fields)
                return value
            with mock.patch.object(Path,'lstat',lstat), self.assertRaises(RuntimeError):attempt.run()
            self.assertFalse(any(row['name']=='production-normal-server' for row in attempt.driver.commands))
            self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])

    def test_selected_hardlinked_source_produces_single_link_same_hash_private_copy(self):
        with Attempt() as attempt:
            source=Path(attempt.supplied['mkfifo'])
            os.link(source,attempt.directory/'mkfifo-package-hardlink')
            self.assertEqual(source.stat().st_nlink,2)
            attempt.run()
            receipt=json.loads((attempt.output/'evidence/production-tool-custody.json').read_text())
            tool=receipt['tools']['mkfifo']
            self.assertEqual(tool['original']['nlink'],2)
            self.assertEqual(tool['staged']['nlink'],1)
            self.assertEqual(tool['original']['sha256'],tool['staged']['sha256'])
            self.assertEqual(stat.S_IMODE(tool['staged']['mode']),0o500)
            self.assertEqual(source.stat().st_nlink,2)

    def test_hardlinked_source_link_count_or_content_mutation_during_copy_fails_closed(self):
        for fault in ('link-count','content'):
            with self.subTest(fault=fault), Attempt() as attempt:
                source=Path(attempt.supplied['mkfifo'])
                os.link(source,attempt.directory/'mkfifo-package-hardlink')
                original_chmod=Path.chmod
                fired=False
                def chmod(path,mode,*args,fault=fault,original_chmod=original_chmod,source=source,attempt=attempt,**kwargs):
                    nonlocal fired
                    result=original_chmod(path,mode,*args,**kwargs)
                    if not fired and mode==0o500 and path.name=='mkfifo' and path.parent.name.startswith('.ottplay-multiview-tools-'):
                        fired=True
                        if fault=='link-count':os.link(source,attempt.directory/'mkfifo-new-unapproved-hardlink')
                        else:source.write_bytes(b'changed trusted supplier bytes')
                    return result
                with mock.patch.object(Path,'chmod',chmod), self.assertRaises(RuntimeError):attempt.run()
                self.assertTrue(fired)
                self.assertFalse(any(row['name']=='production-custody-ffmpeg-version' for row in attempt.driver.commands))
                self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])
                cleanup=json.loads((attempt.output/'evidence/production-tool-custody-cleanup.json').read_text())
                self.assertTrue(cleanup['cleanup_confirmed'])

    def test_selected_source_unlinked_after_open_has_zero_links_and_is_denied(self):
        with Attempt() as attempt:
            source=Path(attempt.supplied['ffmpeg'])
            inode=source.stat().st_ino
            original_enter=ci.contextlib.ExitStack.enter_context
            fired=False
            def enter(stack,context):
                nonlocal fired
                value=original_enter(stack,context)
                if hasattr(value,'fileno') and os.fstat(value.fileno()).st_ino==inode:
                    source.unlink()
                    self.assertEqual(os.fstat(value.fileno()).st_nlink,0)
                    fired=True
                return value
            with mock.patch.object(ci.contextlib.ExitStack,'enter_context',enter), self.assertRaises(RuntimeError):attempt.run()
            self.assertTrue(fired)
            self.assertFalse(any(row['name']=='production-normal-server' for row in attempt.driver.commands))
            self.assertFalse(attempt.terminal()['normal_server_mpegts_to_hls'])

    def test_mock_driver_log_names_are_exclusive_before_any_response_or_overwrite(self):
        with Attempt() as attempt:
            attempt.run()
            self.assertEqual(len(attempt.driver.commands),len({row['name'] for row in attempt.driver.commands}))
            original=attempt.driver.commands[0]['name']
            paths=[(original,attempt.driver.evidence/'logs'/(original+'.log')),
                   ('preexisting-owned-label',attempt.driver.evidence/'logs/preexisting-owned-label.log')]
            paths[1][1].write_bytes(b'owned sentinel')
            for name,path in paths:
                before=path.read_bytes();count=len(attempt.driver.commands)
                with mock.patch.object(attempt,'response',side_effect=AssertionError('duplicate reached response')), self.assertRaisesRegex(FileExistsError,'Duplicate owned command log'):
                    attempt.driver.run(name,['not-executed'])
                self.assertEqual(path.read_bytes(),before)
                self.assertEqual(len(attempt.driver.commands),count)

    def test_real_ledger_accounting_with_full_hosted_prefix_fits_existing_caps_only_with_batch(self):
        with Attempt() as attempt:
            real_prepare=ci.prepare_hls_production_inputs
            original=attempt.response
            in_hls=False
            packets={stream:[{'stream_index':stream,'pts':126000+n*step,'dts':126000+n*step,'duration':step,
                     'data_hash':'SHA256:'+f'{stream*10000+n:064x}'} for n in range(count)]
                     for stream,step,count in ((0,9000,6000),(1,1080000,50))}
            def response(name,args):
                if not in_hls:return original(name,args)
                if name.startswith('production-hls-source-'):
                    Path(args[-1]).write_bytes((b'\x47'+b'\0'*187)*3);return ''
                if name.startswith('production-hls-split-'):
                    for index in range(50):Path(args[-1].replace('%02d',f'{index:02d}')).write_bytes((b'\x47'+bytes([index])*187)*3)
                    return ''
                self.assertEqual(name,'production-hls-probe-batch')
                return synthetic_hls_batch(args,packets)
            def prepare(*args):
                nonlocal in_hls
                in_hls=True
                try:return real_prepare(*args)
                finally:in_hls=False
            attempt.response=response;attempt.prepare_hls_inputs=prepare
            attempt.run()
            prefix='/home/runner/work/_temp/'+'w'*(158-len('/home/runner/work/_temp/'))
            def substitute(value):
                return value.replace(str(attempt.output),prefix).replace(str(attempt.root),'/home/runner/work/ottplay-foss/ottplay-foss')
            commands=[{'name':row['name'],'argv':[substitute(arg) for arg in row['argv']]} for row in attempt.driver.commands]
            self.assertEqual(sum(row['name']=='production-hls-probe-batch' for row in commands),1)
            self.assertEqual(len(commands),len({row['name'] for row in commands}))
            def account(rows, destination):
                budget=guard.Budget();budget.allocate(guard.LOG_CAP,log=True)
                budget.allocate(8*1024**2)  # Additional conservative nonlog evidence reserve.
                entries=[]
                for row in rows:
                    current=dict(row,pid=999999,pgid=999999,sid=999999,exit_code=None,reaped=False,
                                 group_gone=False,ownership_verified=True,cleanup_errors=[])
                    entries.append(current);budget.json_evidence(destination,entries)
                    current.update(exit_code=0,reaped=True,group_gone=True,cleanup_confirmed=True)
                    budget.json_evidence(destination,entries)
                return budget.evidence_total
            actual=account(commands,attempt.directory/'budget-batch-ledger.json')
            self.assertLess(actual,guard.EVIDENCE_CAP)
            with self.assertRaisesRegex(RuntimeError,'evidence cap'):
                old=commands+[{'name':f'old-probe-{i}','argv':['/usr/bin/ffprobe',prefix+f'/production-hls/inputs/segments-3/segment-{i}.ts']} for i in range(153)]
                account(old,attempt.directory/'budget-old-ledger.json')
            self.assertEqual((guard.LOG_CAP,guard.EVIDENCE_CAP),(16*1024**2,32*1024**2))

    def test_both_production_modes_and_actual_support_units_are_mandatory(self):
        with Attempt() as attempt:
            attempt.run()
            names=[row['name'] for row in attempt.driver.commands]
            self.assertLess(names.index('production-normal-server'), names.index('production-live-hls-server'))
            self.assertIn('production-ordinary', names)
            hls=next(row for row in attempt.driver.commands if row['name']=='production-live-hls-server')
            self.assertEqual(hls['argv'],[str(attempt.production_executable),EXPECTED_HLS_PRODUCTION_TEST,'--ignored','--exact','--test-threads=1','--color=never'])
            self.assertEqual(hls['limit'],600)
            self.assertTrue(attempt.terminal()['normal_server_hls_to_hls'])
            self.assertNotIn('OTTPLAY_MULTIVIEW_PRODUCTION_HLS_INPUTS',attempt.driver.env)

    def test_live_hls_failure_never_publishes_partial_production_pass(self):
        for case in ('hls-no-active-sigterm','hls-sixteen-contexts','hls-no-segment-binding','hls-future-fetch',
                     'hls-incomplete-master','hls-changed-segment','hls-nonzero','hls-zero-tests','hls-support-not-executed'):
            with self.subTest(case=case), Attempt(case) as attempt:
                with self.assertRaises(RuntimeError): attempt.run()
                result=attempt.terminal()
                self.assertFalse(result['normal_server_hls_to_hls'])
                self.assertFalse(result['normal_server_mpegts_to_hls'])
                self.assertFalse(result['sustained_media_e2e'])
                self.assertFalse(result['production_admission'])
                self.assertNotIn('OTTPLAY_MULTIVIEW_PRODUCTION_HLS_INPUTS',attempt.driver.env)

    def test_original_packet_timeline_rejects_repetition_missing_pts_and_non_ts_stream_identity(self):
        streams=[{'index':0,'codec_name':'h264','time_base':'1/90000'},{'index':1,'codec_name':'aac','time_base':'1/90000'}]
        packets=[{'stream_index':index,'pts':100,'dts':100,'duration':9000,'data_hash':'SHA256:'+'a'*64} for index in (0,1)]
        good={'streams':streams,'packets':packets}
        observed=ci.packet_timeline(json.dumps(good));self.assertEqual(len(observed[0]),1)
        for mutation in ('repeat','no-pts','wrong-stream','hash','string-time','empty'):
            data=json.loads(json.dumps(good))
            if mutation=='repeat':data['packets'].append(data['packets'][0])
            elif mutation=='no-pts':del data['packets'][0]['pts']
            elif mutation=='wrong-stream':data['streams'][0]['codec_name']='hevc'
            elif mutation=='hash':data['packets'][0]['data_hash']='absent'
            elif mutation=='string-time':data['packets'][0]['pts']='100'
            else:data['packets']=[]
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):ci.packet_timeline(json.dumps(data))

    def test_packet_proof_metadata_fence_rejects_unsafe_files_before_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for shape in ('missing','symlink','hardlink','directory','oversized','foreign-owner'):
                with self.subTest(shape=shape):
                    path=root/shape
                    if shape=='symlink':
                        target=root/'symlink-target';target.write_text('{}');path.symlink_to(target)
                    elif shape=='hardlink':
                        target=root/'hardlink-target';target.write_text('{}');os.link(target,path)
                    elif shape=='directory':path.mkdir()
                    elif shape=='oversized':
                        with path.open('wb') as stream:stream.truncate(16*1024**2+1)
                    elif shape=='foreign-owner':path.write_text('{}')
                    budget=types.SimpleNamespace(read=mock.Mock(side_effect=AssertionError('unsafe packet file reached read')))
                    owner=mock.patch.object(ci.os,'geteuid',return_value=os.geteuid()+1) if shape=='foreign-owner' else contextlib.nullcontext()
                    with owner, self.assertRaises((RuntimeError,OSError)):
                        ci.read_packet_proof(path,budget)
                    budget.read.assert_not_called()

    def test_finite_hls_preparation_uses_copyts_and_rejects_packet_rewrite_without_media_processes(self):
        for corrupt in (False, True, 'stdout'):
            with self.subTest(corrupt=corrupt), Attempt() as attempt:
                budget=guard.Budget()
                tools={name:ci.system_tool_identity(Path(attempt.supplied[name]),budget) for name in ('ffmpeg','ffprobe')}
                calls=[(f'production-source-{identity}',[],0) for identity in (1,2,3)]
                def packet(stream,index):
                    step=9000 if stream==0 else 1080000
                    return {'stream_index':stream,'pts':126000+index*step,'dts':126000+index*step,
                            'duration':step,'data_hash':'SHA256:'+f'{stream*10000+index:064x}'}
                all_rows={0:[packet(0,n) for n in range(6000)],1:[packet(1,n) for n in range(50)]}
                def command(name,args,seconds=15,*,calls=calls,all_rows=all_rows,corrupt=corrupt):
                    self.assertNotIn(name,[row[0] for row in calls], 'command name reused across Raw/HLS preparation')
                    calls.append((name,args,seconds))
                    if name.startswith(('production-source-', 'production-hls-source-')):
                        Path(args[-1]).write_bytes((b'\x47'+b'\0'*187)*3)
                        return ''
                    if name.startswith('production-hls-split-'):
                        for index in range(50):
                            Path(args[-1].replace('%02d',f'{index:02d}')).write_bytes((b'\x47'+bytes([index])*187)*3)
                        return ''
                    self.assertEqual(name,'production-hls-probe-batch')
                    self.assertEqual(seconds,240)
                    return synthetic_hls_batch(args,all_rows,corrupt)
                directory=attempt.directory/'actual-helper-synthetic-command-fixture'
                evidence=attempt.directory/'batch-proof-evidence';evidence.mkdir(mode=0o700)
                proof_driver=types.SimpleNamespace(evidence=evidence)
                if corrupt:
                    reason = 'Packet batch must not enter' if corrupt == 'stdout' else 'changed, omitted, duplicated or reset'
                    with self.assertRaisesRegex(RuntimeError,reason):
                        ci.prepare_hls_production_inputs(proof_driver,budget,command,tools,directory)
                else:
                    path,manifest=ci.prepare_hls_production_inputs(proof_driver,budget,command,tools,directory)
                    self.assertEqual(manifest['seconds'],600)
                    self.assertEqual([len(row['segments']) for row in manifest['sources']],[50,50,50])
                    self.assertEqual(path.stat().st_mode&0o222,0)
                    self.assertTrue(all(row['original_packet_timeline_sha256']==row['segmented_packet_timeline_sha256'] for row in manifest['sources']))
                    self.assertEqual(list((directory/'packet-proof').iterdir()), [], 'large packet JSON never retained as evidence/logs')
                    probes=[args for name,args,_ in calls if name=='production-hls-probe-batch']
                    self.assertEqual(len(probes),1)
                    retained_plan=(evidence/'production-hls-probe-plan.json').read_bytes()
                    retained_receipt=(evidence/'production-hls-probe-receipt.json').read_bytes()
                    self.assertEqual(retained_plan,(directory/'HLS-PROBE-PLAN.json').read_bytes())
                    self.assertEqual(retained_receipt,(directory/'HLS-PROBE-RECEIPT.json').read_bytes())
                    summary=json.loads((evidence/'production-hls-probe-batch.json').read_bytes())
                    self.assertEqual(hashlib.sha256(retained_plan).hexdigest(),summary['plan_sha256'])
                    self.assertEqual(hashlib.sha256(retained_receipt).hexdigest(),summary['receipt_sha256'])
                    self.assertEqual(len(json.loads(retained_receipt)['rows']),153)
                    self.assertEqual(guard.LOG_CAP,16*1024**2)
                    self.assertEqual(guard.EVIDENCE_CAP,32*1024**2)
                split=next(args for name,args,_ in calls if name.startswith('production-hls-split-'))
                self.assertIn('-copyts',split)
                self.assertEqual(split[split.index('-reset_timestamps')+1],'0')
                self.assertEqual(split[split.index('-c')+1],'copy')
                self.assertNotIn('-stream_loop',split)
                self.assertNotIn('-start_at_zero',split)
                generated=next(args for name,args,_ in calls if name.startswith('production-hls-source-'))
                self.assertEqual(generated[generated.index('-t')+1],'600')

    def test_normal_server_mpegts_fixture_is_exact_bounded_and_receipt_backed(self):
        clock = {'startup_sample_ms':1000,'observation_elapsed_ms':1000,
                 'probe_elapsed_ms':60000,'lower_bound_ms':61000,'short_expires_ms':61000}
        ci.require_credential_clock(clock)
        for key, value in [('startup_sample_ms',0),('startup_sample_ms',True),
                           ('startup_sample_ms',2**64),('short_expires_ms',61001),
                           ('short_expires_ms',0),('lower_bound_ms',61001),
                           ('probe_elapsed_ms',-1),('probe_elapsed_ms',True),
                           ('observation_elapsed_ms',540000),('extra','secret-canary')]:
            broken = dict(clock); broken[key] = value
            with self.subTest(credential_clock=broken), self.assertRaisesRegex(Exception,
                    'Production credential clock evidence malformed or out of bound'):
                ci.require_credential_clock(broken)
        for broken in [None, {}, {key:value for key,value in clock.items() if key != 'probe_elapsed_ms'}]:
            with self.assertRaisesRegex(Exception, 'Production credential clock evidence malformed or out of bound'):
                ci.require_credential_clock(broken)
        zero = [{'seed':seed,'body_first_count':0,'body_later_count':0,
                 'supervisor_count':0,'last':None,'completed':True} for seed in ('grid','main','replacement')]
        ci.require_seed_refusal_summaries(zero)
        positive = json.loads(json.dumps(zero))
        positive[1].update(body_first_count=1, body_later_count=2, supervisor_count=1,
            last={'site':'body_later','marker':41,'stderr_bytes':123,'stderr_sha256':'a'*64,
                  'status':None,'response_bytes':None})
        ci.require_seed_refusal_summaries(positive)
        negatives = [None, [], zero[:2], zero + zero[:1], list(reversed(zero))]
        for key, value in [('completed',False),('completed',1),('extra','secret-canary'),
                           ('body_first_count',True),('body_first_count',-1),
                           ('body_first_count',2**64),('last',None)]:
            broken = json.loads(json.dumps(positive)); broken[1][key] = value; negatives.append(broken)
        for key, value in [('site','unknown'),('marker',0),('marker',True),('marker',2**64),
                           ('stderr_bytes',0),('stderr_bytes',65537),('stderr_bytes',True),
                           ('stderr_sha256','A'*64),('stderr_sha256','secret-canary'),
                           ('status',503),('response_bytes',0),('extra','secret-canary')]:
            broken = json.loads(json.dumps(positive)); broken[1]['last'][key] = value; negatives.append(broken)
        broken = json.loads(json.dumps(positive)); broken[1]['body_later_count'] = 0; negatives.append(broken)
        broken = json.loads(json.dumps(zero)); broken[1]['last'] = positive[1]['last']; negatives.append(broken)
        for broken in negatives:
            with self.subTest(seed_summary=broken), self.assertRaisesRegex(Exception,
                    'Production seed refusal summaries malformed or incomplete') as caught:
                ci.require_seed_refusal_summaries(broken)
            self.assertNotIn('secret-canary', str(caught.exception))
        with Attempt() as attempt:
            attempt.run()
            result = attempt.terminal()
            build = next(row for row in attempt.driver.commands if row['name'] == 'fixture-build')
            self.assertEqual(build['argv'].count('multiview_production'), 1)
            run = next(row for row in attempt.driver.commands if row['name'] == 'production-normal-server')
            self.assertEqual(run['argv'], [str(attempt.production_executable), EXPECTED_PRODUCTION_TEST,
                '--ignored', '--exact', '--test-threads=1', '--color=never'])
            self.assertEqual(run['limit'], 600)
            self.assertEqual([row['name'] for row in attempt.driver.commands if row['name'].startswith('production-source-')],
                             ['production-source-1', 'production-source-2', 'production-source-3'])
            self.assertTrue(result['normal_server_mpegts_to_hls'])
            self.assertTrue(result['sustained_media_e2e'])
            self.assertFalse(result['native_player_or_physical_television_qualified'])
            self.assertFalse(result['production_admission'])
            self.assertNotIn('OTTPLAY_MULTIVIEW_PRODUCTION_INPUTS', attempt.driver.env)
            self.assertNotIn('OTTPLAY_MULTIVIEW_PRODUCTION_RECEIPT', attempt.driver.env)
            for key, tool in (('OTTPLAY_MULTIVIEW_FFMPEG', 'ffmpeg'),
                              ('OTTPLAY_MULTIVIEW_FFPROBE', 'ffprobe')):
                self.assertEqual(attempt.driver.env.get(key), attempt.supplied[tool],
                                 f'production fixture changed provisioned {key}')
            self.assertNotIn('OTTPLAY_MULTIVIEW_MKFIFO', attempt.driver.env)
            self.assertNotIn('OTTPLAY_MULTIVIEW_OPENSSL', attempt.driver.env)
            manifest = json.loads((attempt.output / 'production/inputs/INPUTS.json').read_text())
            self.assertEqual([(row['color'], row['audio_frequency_hz']) for row in manifest['inputs']],
                             [('red', 330), ('lime', 440), ('blue', 550)])
            self.assertTrue(all(Path(row['path']).stat().st_mode & 0o222 == 0 for row in manifest['inputs']))
            rotation_env = attempt.rotation_env
            rotation_names = (
                'OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR', 'OTTPLAY_MULTIVIEW_ROTATE_INPUT_A',
                'OTTPLAY_MULTIVIEW_ROTATE_INPUT_B', 'OTTPLAY_MULTIVIEW_ROTATE_INPUT_C',
                'OTTPLAY_MULTIVIEW_FFMPEG', 'OTTPLAY_MULTIVIEW_FFPROBE')
            rotation_case = Path(rotation_env['OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR'])
            self.assertEqual(rotation_case, attempt.output / 'core-rotation/case')
            self.assertTrue(attempt.rotation_case_was_fresh)
            self.assertTrue(rotation_case.is_dir() and not rotation_case.is_symlink())
            self.assertEqual([rotation_env[f'OTTPLAY_MULTIVIEW_ROTATE_INPUT_{name}']
                              for name in 'ABC'], [row['path'] for row in manifest['inputs']])
            self.assertEqual(rotation_env['OTTPLAY_MULTIVIEW_FFMPEG'], attempt.supplied['ffmpeg'])
            self.assertEqual(rotation_env['OTTPLAY_MULTIVIEW_FFPROBE'], attempt.supplied['ffprobe'])
            self.assertEqual([row['name'] for row in attempt.driver.commands
                              if row['name'].startswith('production-source-')],
                             ['production-source-1', 'production-source-2', 'production-source-3'])
            self.assertEqual([row['argv'][1] for row in attempt.driver.commands
                              if row['name'] == 'core-ignored-' + hashlib.sha256(
                                  ci.CORE_ROTATION_TEST.encode()).hexdigest()[:12]],
                             [ci.CORE_ROTATION_TEST])
            self.assertTrue(all(key not in attempt.driver.env for key in rotation_names[:4]))
            self.assertEqual(attempt.driver.env['OTTPLAY_MULTIVIEW_FFMPEG'], attempt.supplied['ffmpeg'])
            self.assertEqual(attempt.driver.env['OTTPLAY_MULTIVIEW_FFPROBE'], attempt.supplied['ffprobe'])
            receipt = json.loads((attempt.output / 'evidence/production-control.json').read_text())
            self.assertEqual(receipt['schema'], 'ottplay.multiview.production-binary.v1')
            self.assertTrue(receipt['nine_slot_grid_rgb'] and receipt['selected_audio_tone'])

    def test_core_rotation_environment_is_restored_after_command_failure(self):
        with Attempt('core-rotation-nonzero-exit') as attempt:
            with self.assertRaisesRegex(RuntimeError, 'Unix fixture qualification failed'):
                attempt.run()
            terminal = attempt.terminal()
            self.assertEqual(terminal['status'], 'fail')
            self.assertIn('Synthetic Core rotation command exited nonzero', terminal['error'])
            self.assertIsNotNone(attempt.rotation_env)
            self.assertNotIn('OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR', attempt.driver.env)
            for key in ('OTTPLAY_MULTIVIEW_ROTATE_INPUT_A', 'OTTPLAY_MULTIVIEW_ROTATE_INPUT_B',
                        'OTTPLAY_MULTIVIEW_ROTATE_INPUT_C'):
                self.assertNotIn(key, attempt.driver.env)
            self.assertEqual(attempt.driver.env['OTTPLAY_MULTIVIEW_FFMPEG'], attempt.supplied['ffmpeg'])
            self.assertEqual(attempt.driver.env['OTTPLAY_MULTIVIEW_FFPROBE'], attempt.supplied['ffprobe'])
            self.assertFalse(any(row['name'] == 'production-normal-server'
                                 for row in attempt.driver.commands))

    def test_production_target_inventory_and_receipt_fail_closed(self):
        cases = {
            'production-missing-inventory': 'Production normal-binary fixture must have both exact ignored modes and frozen ordinary support',
            'production-extra-inventory': 'Production normal-binary fixture must have both exact ignored modes and frozen ordinary support',
            'production-not-ignored': 'Production normal-binary fixture must have both exact ignored modes and frozen ordinary support',
            'production-bad-receipt': 'Normal production-server adapter receipt did not qualify its bounded contract',
            'production-no-credential-clock': 'Production credential clock evidence malformed or out of bound',
            'production-no-seed-summaries': 'Production seed refusal summaries malformed or incomplete',
            'production-incomplete-seed-summary': 'Production seed refusal summaries malformed or incomplete',
            'production-missing-source': 'Actual test receipt does not bind the three sealed transport sources',
            'production-no-hls-av': 'Normal production-server adapter receipt did not qualify its bounded contract',
            'production-no-tls': 'Normal production-server adapter receipt did not qualify its bounded contract',
            'production-incomplete-probe': 'Every source must have distinct Probe and Decode subscriptions',
            'production-missing-receipt': 'No such file or directory',
            'production-nonzero-exit': 'Synthetic production command exited nonzero',
            'production-zero-tests': 'Expected exactly one executed test',
        }
        for case, reason in cases.items():
            with self.subTest(case=case), Attempt(case) as attempt:
                result = self.failed(attempt, reason)
                self.assertFalse(result['normal_server_mpegts_to_hls'])
                self.assertFalse(result['sustained_media_e2e'])
                self.assertFalse(result['production_admission'])

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
                self.assertEqual(result['tests'], list(EXPECTED_TESTS) + [EXPECTED_PRODUCTION_TEST, EXPECTED_HLS_PRODUCTION_TEST])
                self.assertFalse(result['production_admission'])
                self.assertTrue(result['sustained_media_e2e'])

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
                self.assertTrue(result['sustained_media_e2e'])
                self.assertTrue(result['generated_media_hashes_available'])
                self.assertTrue(result['normal_server_mpegts_to_hls'])
                self.assertEqual(result['tests'], list(EXPECTED_TESTS) + [EXPECTED_PRODUCTION_TEST, EXPECTED_HLS_PRODUCTION_TEST])
                self.assertTrue(result['production_adapter']['passed'])
                self.assertEqual(result['production_adapter']['scope'],
                    'Actual production binary with protected HTTP-MPEGTS enrollment, all nine advertised slots, decoded grid RGB and selected audio tones, A/V HLS ffprobe, active-credential expiry, source replacement and cleanup; no native-player or physical-television proof')
                self.assertEqual(result['ordinary_core_tests'], sorted(CORE_NAMES))
                self.assertEqual(result['executed_core_ignored_tests'], list(CORE_IGNORED))
                self.assertEqual(result['ordinary_server_tests'], sorted(SERVER_NAMES))
                for key in ('RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS'):
                    self.assertNotIn(key, attempt.driver.env)
                self.assertEqual(attempt.driver.env['CARGO_HOME'], str(attempt.output / 'cargo-home'))
                fixtures = [entry for entry in attempt.driver.commands if entry['name'].startswith('fixture-')
                            and entry['name'] != 'fixture-build']
                self.assertEqual(len(fixtures), 5)
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
                 'core-ignored-missing': 'Core multiview ignored test inventory differs',
                 'core-ignored-extra': 'Core multiview ignored test inventory differs',
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
