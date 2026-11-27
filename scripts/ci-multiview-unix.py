"""Bounded Unix synthetic qualification of the selected multiview profile and adapters."""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import struct
import sys
import time
import uuid

sys.dont_write_bytecode = True
GUARD_SHA256 = '6f623bb7234b3619ff859dec0afe9c1ad938f29d606f0836b69434312867e020'
STREAM_MEDIA_SHA256 = 'dd9238119c10150d549501b086c59598ae8c991e282885ce2d5717367e1c863c'
STREAM_TEST = 'streamed_session_two_owner_continuity'
STREAMED_MACOS_FLAKY_MAX_RETRIES = 2
STREAMED_MACOS_FLAKY_SIGNATURE = 'output_state Failed / archive unqualified before sustained evidence'
PRODUCTION_MACOS_FLAKY_MAX_RETRIES = 2
# The 185-second sustained encoder can lose its session on a shared macOS
# runner: the status sample then reports a closed sibling slot or the HLS
# snapshot before replacement cannot be seeded. Neither signature can come
# from a passing run, and Ubuntu keeps its single strict attempt.
PRODUCTION_MACOS_FLAKY_SIGNATURES = (
    'sibling source authority disappeared for 3 consecutive samples',
    'pre-replacement HLS playlist snapshot:',
)
# The production fixtures run last, so a recorded retry needs its own headroom
# inside the reviewed 28-minute work deadline. The extension is one-shot and
# only applies to a signature-matched Darwin retry.
PRODUCTION_MACOS_FLAKY_RETRY_EXTENSION_SECONDS = 660
HLS_BATCH_SHA256 = '967ceaa7e7478c2488c3a984d4a4a15f968226ef82a7cd065b4a93b84aa161e7'
PRODUCTION_TEST = 'normal_server_private_http_mpegts_renew_replace_and_cleanup'
HLS_PRODUCTION_TEST = 'normal_server_private_http_hls_renew_replace_and_cleanup'
PRODUCTION_ORDINARY_TESTS = frozenset({
    'unwind_stderr_capture_preserves_original_panic_and_clears_registration',
    'owned_stderr_drops_incomplete_secret_line_before_bounded_redaction',
    'playlist_failure_evidence_preserves_http_parse_and_fatal_origin_contracts',
    'segment_video_proof_checks_count_timing_and_sampling_domain',
    'two_slot_fixture_geometry_passes_actual_core_validation',
    'nine_slot_fixture_geometry_passes_actual_core_and_old_odd_grid_is_rejected',
    'api_failure_diagnostics_bind_request_hash_and_closed_redacted_response',
    'production_tls::leaf_request_has_explicit_distinguished_name_for_openssl_1_1_and_3',
    'startup_diagnostic_tail_is_bounded_and_redacts_fixture_secrets_and_urls',
    'hls_production::tests::starts_with_three_complete_and_slides_six_without_exposing_future',
    'hls_production::tests::never_loops_or_serves_fifty_first_segment_and_keeps_original_duration',
    'hls_production::tests::exact_path_fence_and_master_child_are_self_contained',
})
PENDING_TEST = 'streamed_decoder_short_track_pending_and_failure'
MKFIFO = Path('/usr/bin/mkfifo')
TESTS = (
    ('real_four_nine_and_perimeter_frames_and_selected_audio', 600),
    ('owned_worker_cancellation_deadlines_busy_and_cleanup', 60),
    ('fixture_http_source_cas_dedupe_media_custody_and_retirement', 120),
    (PENDING_TEST, 120),
    (STREAM_TEST, 110),
)
ACTIVATION_TESTS = frozenset({
    'no_flag_keeps_private_paths_absent_and_health_available',
    'valid_loopback_activation_is_authenticated_zero_capacity_and_cannot_play',
    'selected_tls_listener_isolated_from_http_and_other_tls_ports',
    'explicit_loopback_http_selects_only_one_port',
    'unsafe_configuration_rejected_before_reserved_port_bind',
    'invalid_listener_selection_rejected_before_bind',
    'incompatible_dedicated_modes_reject_opt_in_before_binding',
    'restart_issues_fresh_epoch_without_promoting_capacity',
})
# Source-derived Unix inventory from the reviewed broker/connection freeze.
BROKER_TESTS = frozenset({
    'broker::live::close_diagnostic_tests::diagnostic_queue_preserves_order_and_reports_bounded_overflow_after_completion',
    'broker::live::close_diagnostic_tests::empty_diagnostic_queue_completes_without_entering_writer',
    'broker::live::close_diagnostic_tests::watchdog_success_releases_owners_and_failed_cleanup_emits_nothing',
    'broker::live::close_diagnostic_tests::operation_receipts_and_sink_release_precede_a_blocked_diagnostic_writer',
    'broker::live::close_diagnostic_tests::first_close_record_preserves_initiator_and_output_across_retirement',
    'broker::live::close_diagnostic_tests::close_observation_distinguishes_live_authority_failure_and_preserves_closed_trace',
    'broker::live::play_diagnostic_tests::play_failure_record_preserves_numeric_producer_evidence_without_identity',
    'broker::live::play_diagnostic_tests::play_closed_classes_distinguish_retirement_decode_and_commit_failures',

    'broker::live::tests::shutdown_does_not_claim_unconfirmed_create_custody_is_clean',
    'broker::live::tests::shutdown_waits_for_owned_operation_after_http_waiter_drops',

    'broker::live::tests::production_adapter_set_is_unique_explicit_and_keeps_other_guards',
    'body_lifetime_checks_expiry_credential_session_and_replacement',
    'broker::live::tests::configuration_rejects_lifetime_and_profile_without_launching_media',
    'broker::live::tests::native_changes_are_operation_specific_before_any_effect',
    'broker::live::tests::operation_identity_is_scoped_to_owner_installation_credential_route_and_session',
    'broker::live::tests::operation_survives_waiter_cancellation_and_never_reexecutes_same_body',
    'broker::live::tests::output_custody_requires_shutdown_proof_and_released_http_body',
    'broker::live::tests::replacement_within_one_source_never_reports_the_previous_item',
    'broker::live::tests::source_refs_follow_redemption_and_exact_promoted_revision_only',
    'broker::live_output::tests::abandoned_blocking_read_keeps_admission_until_worker_really_finishes',
    'broker::live_output::tests::actual_files_are_rewritten_and_segments_return_their_real_bytes',
    'broker::live_output::tests::closed_playlist_grammar_rejects_unsupported_authority_and_ambiguous_windows',
    'broker::live_output::tests::file_and_directory_symlinks_hardlinks_fifo_and_traversal_fail_closed',
    'broker::live_output::tests::missing_non_ts_oversized_and_mutably_shared_files_are_rejected',
    'broker::live_output::tests::only_exact_signed_prefix_and_owned_absolute_directory_are_accepted',
    'broker::live_output::tests::opened_directory_inode_survives_a_path_replacement',
    'broker::live_output::tests::raised_watermark_refreshes_same_signed_path_without_exposing_old_window',
    'broker::live_output::tests::retained_slice_keeps_exact_allocation_budget_after_output_drop',
    'broker::live_output::tests::segment_and_index_allocations_need_shared_byte_capacity',
    'broker::live_output::tests::watermark_withholds_whole_window_and_refresh_never_serves_old_tail',
    'broker_mutex_contention_denies_media_without_blocking_executor_and_recovers',
    'cached_grants_are_not_returned_after_redemption_credential_revoke_or_expiry',
    'catalog_cursor_expiration_is_distinct_from_stale_revisions',
    'credential_revocation_cancels_active_source_authority_before_cleanup',
    'eight_stalled_hyper_connections_hold_permits_until_transport_drop',
    'exact_loopback_origins_support_ipv4_and_ipv6_without_relaxing_policy',
    'fixture_injection_is_explicit_loopback_only_and_keeps_ordinary_caps_zero',
    'generated_output_rejects_external_child_key_uri_and_unlisted_resource',
    'healthy_hyper_progress_and_unchanged_focus_keep_media_authorized',
    'input_grant_replay_is_scoped_exact_and_reauthorizes_the_source',
    'media_connection::tests::authority_revocation_ends_a_connection_without_body_or_io_progress',
    'media_connection::tests::final_flush_and_shutdown_keep_custody_after_body_drop_until_timeout',
    'media_connection::tests::h2_media_drops_only_its_lease_without_arming_the_connection',
    'media_connection::tests::late_admission_wakes_dormant_supervision_and_cannot_be_retargeted',
    'media_connection::tests::media_marker_cannot_arm_a_different_or_replacement_connection',
    'media_connection::tests::positive_normal_and_vectored_writes_extend_only_the_idle_budget',
    'media_connection::tests::public_and_failed_responses_leave_pending_io_unbounded_by_media_policy',
    'media_connection::tests::reads_flushes_pending_and_zero_byte_writes_do_not_refresh_idle',
    'media_connection::tests::supervisor_abort_and_normal_completion_release_lease_without_detached_task',
    'media_missing_connection_and_http2_fail_before_stream_admission',
    'media_reads_do_not_renew_and_custody_requires_separate_reaping',
    'native_auth_does_not_trust_origin_host_forwarding_or_loopback',
    'native_transition_rejects_occupied_target_before_revoking_existing_work',
    'native_transition_replays_committed_grant_without_reapplying_prior_cas',
    'pairing_requires_separate_native_authority_and_explicit_lan_tls',
    'private_media_revocation_and_timeout_do_not_arm_or_cancel_public_connection',
    'registry_mutex_contention_denies_media_without_blocking_executor_and_recovers',
    'removing_and_readding_an_active_source_blocks_output_before_worker_reaping',
    'revoked_body_custody_is_not_removed_from_the_global_output_budget',
    'session_and_installation_boundaries_do_not_share_idempotency_or_authority',
    'signed_manifest_and_every_segment_require_same_private_prefix',
    'stalled_media_write_deadline_drops_real_connection_and_releases_admission',
    'streaming_permits_remain_owned_until_body_drop',
    'strict_json_limits_and_unqualified_control_never_report_accepted_play',
    'unchanged_output_survives_focus_cas_but_new_publication_requires_fresh_binding',
    'unpolled_media_connections_end_on_current_authority_without_fake_reaping',
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
})
BROKER_PRODUCTION_TESTS = frozenset(name for name in BROKER_TESTS
                                    if name.startswith('broker::production_tests::'))
BROKER_SHUTDOWN_TESTS = frozenset({
    'broker::live::tests::shutdown_does_not_claim_unconfirmed_create_custody_is_clean',
    'broker::live::tests::shutdown_waits_for_owned_operation_after_http_waiter_drops',
})
BROKER_HLS_TESTS = frozenset({'broker::live::tests::production_adapter_set_is_unique_explicit_and_keeps_other_guards'})
PLAYLIST_DROP_PREFIX = 'offline_media::drop_playlist::tests::'
PLAYLIST_DROP_REQUIRED_TESTS = frozenset(PLAYLIST_DROP_PREFIX + name for name in (
    'playlist_relative_members_keep_verified_canonical_parent_after_alias_rebind',
    'playlist_and_referenced_file_symlinks_are_rejected_without_retained_grants',
))
CORE_REQUIRED_TESTS = frozenset({
    'multiview::broker::registry::pending_grant_retention_tests::attachment_promotion_keeps_only_exact_unchanged_sibling_binding_grants',
    'multiview::broker::registry::pending_grant_retention_tests::binding_updates_retain_exact_siblings_but_global_source_and_session_revokes_fail_closed',
    'multiview::broker::registry::try_authority_tests::try_session_authority_returns_busy_without_callback_then_recovers',
    'multiview::broker::registry::try_authority_tests::try_session_authority_maps_poison_to_unavailable_without_callback',
    'multiview::broker::registry::try_authority_tests::try_session_authority_preserves_authorization_and_output_block',
})
CORE_REQUIRED_CLOCK_RETIREMENT_TESTS = frozenset({
    'multiview::persistent::tests::session_clock_keeps_waiting_decoder_live_through_output_gap_longer_than_five_seconds',
    'multiview::decoder::tests::confirmed_decoder_retirement_retains_pending_reader_and_sticky_join_failure',
    'multiview::decoder::tests::failed_stream_startup_returns_partial_decoder_without_dropping_its_reader',
    'multiview::encoder::runtime::transport_tests::session_constructor_returns_same_capacity_before_and_after_ticket_transfer',
    'multiview::encoder::runtime::transport_tests::uncertain_child_ticket_cannot_return_capacity_to_a_constructor',
    'multiview::encoder::runtime::transport_tests::uncertain_constructor_cleanup_quarantine_keeps_the_actual_capacity_owner',
    'multiview::persistent::tests::audio_callback_never_competes_with_the_session_clock_publisher',
    'multiview::persistent::tests::failed_retirement_retains_real_owner_and_feed_until_cleanup_retry',
    'multiview::persistent::tests::compositor_panic_overrides_planned_retirement_and_releases_inner_guards_first',
    'multiview::broker::registry::tests::expired_renew_commit_never_calls_host_or_revives_session',
    'multiview::broker::registry::tests::refused_renew_commit_does_not_extend_registry_lease',
    'multiview::broker::registry::tests::successful_renew_commit_advances_both_under_one_barrier',
})
CORE_REQUIRED_REMAINING_BUDGET_TESTS = frozenset({
    'multiview::persistent::tests::output_encoder_config_shortens_both_timeouts_near_hard_end',
    'multiview::persistent::tests::output_encoder_config_shortens_equal_startup_after_setup',
    'multiview::persistent::tests::output_encoder_config_stops_at_or_after_hard_end',
    'multiview::persistent::tests::session_rejects_invalid_original_timeouts_before_encoder_projection',
})
CORE_ROTATION_TEST = 'multiview::persistent::tests::real_stream_output_rotation_preserves_sibling_decoders'
CORE_IGNORED_TESTS = frozenset({CORE_ROTATION_TEST})
HLS_ITEM_ADAPTER_TEST = 'multiview_operator::media_config::tests::item_adapter_is_explicit_closed_and_defaults_to_direct_ts'
PUBLIC_HTTP_POLICY_TESTS = tuple('multiview_operator::media_config::tests::' + name for name in (
    'public_http_is_protected_exact_origin_opt_in_and_keeps_bearer_consent',
    'public_http_rejects_https_and_any_private_rule_even_when_unused',
    'public_http_network_flag_is_closed_boolean_and_defaults_false',
))
CORE_REQUIRED_HLS_TESTS = frozenset({
    'multiview::broker::stream::hls_factory_tests::actual_factory_finish_is_busy_while_hls_chunk_keeps_authorized_source',
    'multiview::broker::stream::hls_factory_tests::hls_probe_join_precedes_fresh_decode_and_final_cleanup',
})
CORE_REQUIRED_PRIVATE_HTTP_TESTS = frozenset('multiview::broker::network::tests::' + name for name in (
    'private_only_constructor_is_closed_and_existing_scope_is_unchanged',
    'private_only_policy_rejects_all_unlisted_answers_including_clones_and_literals',
    'private_only_rebinding_and_bound_peer_checks_do_not_send_network_io',
))
PRIVATE_HTTP_POLICY_TESTS = tuple('multiview_operator::media_config::tests::' + name for name in (
    'private_http_requires_exact_protected_consent_and_keeps_bearer_consent',
    'private_http_scope_is_closed_and_rejects_public_or_conflicting_rules',
    'media_paths_require_private_output_and_trusted_absolute_tools',
)) + ('multiview_operator::tests::actual_production_fixture_documents_validate_for_both_adapters_and_reject_false_consent',)
LISTENER_TEST_PREFIX = 'listener_tests::'
LISTENER_REQUIRED_TESTS = frozenset({
    'listener_tests::selected_media_dispatch_preserves_public_request_context_and_response',
    'listener_tests::media_transport_failure_response_is_fixed_and_private',
})
FILTERS = {'testsrc2', 'drawbox', 'sine', 'scale', 'format', 'crop', 'pad',
           'setsar', 'setpts', 'fps', 'xstack', 'overlay', 'select'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def load_guard():
    path = Path(__file__).with_name('ci-native-favorites.py')
    require(path.is_file() and not path.is_symlink(), 'Expected checked-out process guard')
    with path.open('rb') as source:
        raw = source.read(65537)
    require(len(raw) <= 65536, 'Process guard exceeds reviewed size bound')
    require(hashlib.sha256(raw).hexdigest() == GUARD_SHA256, 'Reviewed process guard changed')
    spec = importlib.util.spec_from_file_location('multiview_ci_guard', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def has_input_fd(text):
    inside = False
    for line in text.splitlines():
        value = line.strip()
        if value == 'Input:':
            inside = True
        elif value == 'Output:':
            inside = False
        elif inside and value == 'fd':
            return True
    return False


def listed_names(text):
    names = [line[:-6] for line in text.splitlines() if line.endswith(': test')]
    require(len(names) == len(set(names)), 'Duplicate ignored fixture inventory')
    return set(names)


def require_one_pass(text, name):
    require(len(re.findall(r'^running 1 test$', text, re.M)) == 1, 'Expected exactly one executed test')
    require(re.findall(r'^test (?!result:)(.+)$', text, re.M) == [name + ' ... ok'], 'Exact fixture did not pass')
    summaries = re.findall(r'^test result: (.+)$', text, re.M)
    require(len(summaries) == 1 and re.match(r'^ok\. 1 passed; 0 failed; 0 ignored;', summaries[0]),
            'Fixture count/status differs; zero-test success is forbidden')


def require_suite_pass(text, names, ignored):
    require(names and not names.intersection(ignored), 'Ordinary suite must execute nonzero disjoint tests')
    total = len(names) + len(ignored)
    require(re.findall(r'^running ([0-9]+) tests?$', text, re.M) == [str(total)], 'Ordinary suite count differs')
    actual = re.findall(r'^test (?!result:)(.+)$', text, re.M)
    expected = {name + ' ... ok' for name in names}
    ordinary = {line for line in actual if line.endswith(' ... ok')}
    skipped = [line.split(' ... ignored', 1)[0] for line in actual if ' ... ignored' in line]
    require(len(actual) == total and ordinary == expected and len(ordinary) == len(names)
            and len(skipped) == len(ignored) and set(skipped) == ignored,
            'Ordinary suite execution/status differs')
    summary = re.findall(r'^test result: (.+)$', text, re.M)
    prefix = f'ok. {len(names)} passed; 0 failed; {len(ignored)} ignored;'
    require(len(summary) == 1 and summary[0].startswith(prefix), 'Ordinary suite summary differs')


def table_names(text, flags):
    result = set()
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and re.fullmatch(flags, parts[0]):
            result.add(parts[1])
    return result


def filter_names(text):
    return table_names(text, r'[A-Z.]{2,3}')


def system_tool_identity(path, budget, cap=1024**3):
    """Hash an OS tool or target-bound Cargo binary with stable hardlinks.

    This role-specific reader never replaces the single-link source/evidence
    guards. Keep the invoked utility path distinct from its canonical target.
    """
    budget.tick()
    requested = Path(path)
    require(requested.is_absolute(), 'System tool path must be absolute')
    resolved = requested.resolve(strict=True)
    budget.tick()
    before = resolved.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink >= 1
            and 0 < before.st_size <= cap and before.st_mode & 0o111,
            'System tool is not a bounded regular executable')

    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
                info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    expected = identity(before)
    require(hasattr(os, 'O_NOFOLLOW') and hasattr(os, 'O_NONBLOCK'), 'Unix no-follow/nonblocking open required')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    digest, count = hashlib.sha256(), 0
    with os.fdopen(os.open(resolved, flags), 'rb') as stream:
        require(identity(os.fstat(stream.fileno())) == expected, 'System tool identity changed before read')
        while True:
            budget.tick()
            block = stream.read(min(65536, cap + 1 - count))
            budget.tick()
            if not block:
                break
            count += len(block)
            require(count <= cap and count <= before.st_size, 'System tool grew while hashing')
            digest.update(block)
        require(count == before.st_size and identity(os.fstat(stream.fileno())) == expected,
                'System tool changed while hashing')
    budget.tick()
    require(requested.resolve(strict=True) == resolved and identity(resolved.lstat()) == expected,
            'System tool path identity changed')
    budget.tick()
    return dict(zip(('device', 'inode', 'mode', 'nlink', 'bytes', 'mtime_ns', 'ctime_ns'), expected),
                requested_path=str(requested), path=str(resolved), sha256=digest.hexdigest())


def smoke_mkfifo(driver, budget, command, tool):
    """Use Encoder.start's canonical executable and two-path argv on CI only."""
    root = driver.output / 'tmp/mkfifo-smoke'
    root.mkdir(mode=0o700)
    paths = [root / 'audio.pcm', root / 'progress.pipe']
    try:
        command('mkfifo-smoke', [tool['path'], *(str(path) for path in paths)], 2)
        for path in paths:
            budget.tick()
            require(stat.S_ISFIFO(path.lstat().st_mode), 'Canonical mkfifo did not create both owned FIFOs')
    finally:
        for path in paths:
            budget.tick(cleanup=True)
            if path.exists() or path.is_symlink():
                require(stat.S_ISFIFO(path.lstat().st_mode), 'Unexpected mkfifo smoke output retained')
                path.unlink()
        root.rmdir()
        budget.tick(cleanup=True)


def test_executable(text, target, manifest, *, name='multiview_fixtures', kind='test', test_profile=True):
    matches = []
    for line in text.splitlines():
        if not line.startswith('{'):
            continue  # Cargo diagnostics share this bounded log with JSON.
        value = json.loads(line)
        item = value.get('target', {})
        if (value.get('reason') == 'compiler-artifact' and item.get('name') == name
                and kind in item.get('kind', []) and value.get('executable')):
            require(value.get('manifest_path') == str(manifest), 'Fixture manifest differs')
            require(value.get('profile', {}).get('test') is test_profile, 'Expected actual test executable profile')
            path = Path(value['executable'])
            require(path.is_absolute() and path.resolve() == path and path.is_relative_to(target),
                    'Fixture executable escaped owned target')
            require(path.is_file() and os.access(path, os.X_OK), 'Fixture executable absent')
            matches.append(path)
    require(len(matches) == 1, 'Cargo must emit exactly one fixture executable')
    return matches[0]


def provision_tools(driver, budget, command):
    """Signed Ubuntu APT or official Homebrew; new installs request bottles."""
    until = min(budget.clock() + 300, budget.work_deadline)

    def provision(name, args):
        left = until - budget.clock()
        require(left > 0, 'Original five-minute provisioning allowance exhausted')
        return command(name, args, left)

    if platform.system() == 'Linux':
        release = budget.read(Path('/etc/os-release').resolve(), 65536).decode()
        require(re.search(r'^ID=ubuntu$', release, re.M)
                and re.search(r'^VERSION_ID="?26\.04"?$', release, re.M), 'Expected Ubuntu26.04 image')
        provision('apt-mirror', ['sudo', '-n', 'env', 'CI=true', sys.executable,
                                str(driver.root / 'scripts/ci-apt-mirror.py')])
        options = ['-o', 'Acquire::Retries=0', '-o', 'Acquire::http::Timeout=30',
                   '-o', 'Acquire::https::Timeout=30', '-o', 'DPkg::Lock::Timeout=30']
        provision('apt-update', ['sudo', '-n', 'apt-get', *options, 'update'])
        provision('apt-ffmpeg', ['sudo', '-n', 'env', 'DEBIAN_FRONTEND=noninteractive',
                                'apt-get', *options, 'install', '-y', '--no-install-recommends', 'ffmpeg'])
        provision('ffmpeg-package-version', ['dpkg-query', '-W',
                '-f=${binary:Package}\t${Version}\t${Architecture}\n', 'ffmpeg'])
        owner = provision('ffmpeg-package-owner', ['dpkg-query', '-S', '/usr/bin/ffmpeg', '/usr/bin/ffprobe'])
        require('ffmpeg: /usr/bin/ffmpeg' in owner and 'ffmpeg: /usr/bin/ffprobe' in owner,
                'Expected official package executable ownership')
        provision('ffmpeg-package-policy', ['apt-cache', 'policy', 'ffmpeg'])
        return {'ffmpeg': '/usr/bin/ffmpeg', 'ffprobe': '/usr/bin/ffprobe'}, 'Ubuntu signed APT repository'
    brew = shutil.which('brew', path=driver.env.get('PATH'))
    require(brew and Path(brew).is_absolute(), 'Official Homebrew unavailable')
    driver.env.update(HOMEBREW_NO_AUTO_UPDATE='1', HOMEBREW_NO_INSTALL_CLEANUP='1',
                      HOMEBREW_NO_ENV_HINTS='1', HOMEBREW_NO_ANALYTICS='1', HOMEBREW_CURL_RETRIES='0')
    # Formula-qualified name prevents accidental selection of an unrelated tap.
    info = json.loads(provision('brew-ffmpeg-info-before', [brew, 'info', '--json=v2', 'homebrew/core/ffmpeg']))
    formulae = info.get('formulae', [])
    require(len(formulae) == 1 and formulae[0].get('tap') == 'homebrew/core'
            and formulae[0].get('name') == 'ffmpeg', 'Expected official Homebrew core formula')
    if not formulae[0].get('installed'):
        os_tag = {15: 'sequoia'}.get(int(platform.mac_ver()[0].split('.')[0]))
        require(os_tag and platform.machine() in ('arm64', 'x86_64'), 'Unreviewed Homebrew image architecture')
        tag = ('arm64_' if platform.machine() == 'arm64' else '') + os_tag
        bottle = formulae[0].get('bottle', {}).get('stable', {}).get('files', {}).get(tag, {})
        require(re.fullmatch(r'[0-9a-f]{64}', bottle.get('sha256', ''))
                and bottle.get('url', '').startswith('https://ghcr.io/v2/homebrew/core/'),
                'Official bottle for this image is unavailable; no source-build fallback')
        provision('brew-ffmpeg-install', [brew, 'install', '--force-bottle', 'homebrew/core/ffmpeg'])
    prefix = provision('brew-ffmpeg-prefix', [brew, '--prefix', 'homebrew/core/ffmpeg']).strip()
    require(Path(prefix).is_absolute() and '\n' not in prefix, 'Expected Homebrew formula prefix')
    tools = {name: str(Path(prefix) / 'bin' / name) for name in ('ffmpeg', 'ffprobe')}
    require(all(Path(path).is_file() for path in tools.values()), 'Homebrew FFmpeg pair unavailable')
    provision('brew-version', [brew, '--version'])
    provision('brew-ffmpeg-info', [brew, 'info', '--json=v2', 'homebrew/core/ffmpeg'])
    return tools, 'Observed official Homebrew core installation; new installs request a verified bottle'


def activation_home_preflight(driver, budget):
    """Attest the actual private fixture parent; never relax the operator loader."""
    raw = driver.env.get('HOME', '')
    require(raw and Path(raw).is_absolute(), 'Activation fixture HOME must be an absolute directory')
    home = Path(raw).resolve(strict=True)
    chain = []
    for directory in (home, *home.parents):
        budget.tick()
        info = directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022
                and info.st_uid in (0, os.geteuid()),
                'Unsafe activation fixture HOME ancestor: ' + str(directory))
        chain.append({'path': str(directory), 'uid': info.st_uid,
                      'device': info.st_dev, 'inode': info.st_ino,
                      'mode': oct(stat.S_IMODE(info.st_mode))})
    return {'parent': str(home), 'ancestors': chain,
            'fixture_directory_mode': '0o700', 'production_loader_unchanged': True}


def activation_home_snapshot(home, budget, *, cleanup=False):
    """Read only the exact owned fixture prefix; never delete HOME entries."""
    budget.tick(cleanup=cleanup)
    parent_info = home.lstat()
    require(stat.S_ISDIR(parent_info.st_mode) and not parent_info.st_mode & 0o022
            and parent_info.st_uid in (0, os.geteuid()), 'Uncertain activation fixture HOME parent')
    entries = []
    for count, path in enumerate(home.iterdir(), 1):
        budget.tick(cleanup=cleanup)
        require(count <= 10000, 'Activation HOME entry bound exceeded')
        if not path.name.startswith('.ottplay-multiview-activation-'):
            continue
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o700,
                'Uncertain activation fixture HOME entry: ' + path.name)
        entries.append({'name': path.name, 'device': info.st_dev, 'inode': info.st_ino,
                        'mode': oct(stat.S_IMODE(info.st_mode)), 'uid': info.st_uid})
    return sorted(entries, key=lambda item: item['name'])


def load_stream_media(root, budget):
    path = root / 'scripts/ci-multiview-unix-media.py'
    raw = budget.read(path, 256 * 1024)
    require(hashlib.sha256(raw).hexdigest() == STREAM_MEDIA_SHA256, 'Reviewed stream analyzer changed')
    spec = importlib.util.spec_from_file_location('ci_multiview_stream_media', path)
    module = importlib.util.module_from_spec(spec)
    # Execute exactly the bounded, hashed source bytes, never an old pyc cache.
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    require(all(callable(getattr(module, name, None)) for name in (
        'self_test', 'prepare_inputs', 'seal_inputs', 'prepare_audio', 'prepare_video',
        'finish', 'failure_evidence')), 'Stream analyzer API differs')
    budget.tick()
    return module


def stream_read(path, parent, maximum, budget, *, cleanup=False):
    path, parent = Path(path), Path(parent)
    budget.tick(cleanup=cleanup)
    require(path.is_absolute() and path.is_relative_to(parent) and path != parent
            and '..' not in path.parts and path.resolve(strict=True) == path,
            'Stream file escaped its owned root or contains a symlink')
    before = path.lstat()
    raw = budget.read(path, maximum, cleanup=cleanup)
    after = path.lstat()
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    require(all(getattr(before, key) == getattr(after, key) for key in fields)
            and path.resolve(strict=True) == path, 'Stream file identity changed')
    return raw


def seal_stream_inputs(path, parent, budget, *, make_readonly=True):
    path, parent = Path(path), Path(parent)
    require(path == parent / 'INPUTS.json', 'Unexpected sealed input manifest path')
    raw = stream_read(path, parent, 65536, budget)
    if not make_readonly:
        require(not path.lstat().st_mode & 0o222, 'Stream input manifest is no longer read-only')
    value = json.loads(raw)
    require(type(value) is dict and set(value) == {'schema', 'seconds', 'fps', 'width', 'height', 'inputs'}
            and value['schema'] == 'ottplay.multiview.stream-inputs.v1'
            and all(type(value[key]) is int and value[key] == expected for key, expected in
                    (('seconds', 90), ('fps', 10), ('width', 96), ('height', 64)))
            and type(value['inputs']) is list and len(value['inputs']) == 2,
            'Sealed stream input schema differs')
    for source, row in enumerate(value['inputs'], 1):
        require(type(row) is dict and set(row) == {'id', 'path', 'bytes', 'sha256'}
                and type(row['id']) is int and row['id'] == source
                and row['path'] == str(parent / f'source-{source}.ts')
                and type(row['bytes']) is int and 0 < row['bytes'] <= 16 * 1024**2
                and type(row['sha256']) is str and re.fullmatch('[0-9a-f]{64}', row['sha256']),
                'Sealed stream input row differs')
        payload = stream_read(Path(row['path']), parent, 16 * 1024**2, budget)
        require(len(payload) == row['bytes'] and hashlib.sha256(payload).hexdigest() == row['sha256'],
                'Sealed stream input payload differs')
        if make_readonly:
            Path(row['path']).chmod(0o400)
        else:
            require(not Path(row['path']).lstat().st_mode & 0o222, 'Stream input payload is no longer read-only')
    if make_readonly:
        path.chmod(0o400)
    return {'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest(), 'inputs': value['inputs']}


def bind_stream_control(case, seal, budget):
    control = json.loads(stream_read(case / 'CONTROL.json', case, 1024**2, budget))
    require(type(control) is dict and control.get('pass') is True
            and control.get('input_manifest_sha256') == seal['sha256']
            and json.dumps(control.get('inputs'), sort_keys=True) == json.dumps(seal['inputs'], sort_keys=True),
            'Stream CONTROL is not bound to the sealed inputs')
    current = seal_stream_inputs(Path(seal['path']), Path(seal['path']).parent, budget, make_readonly=False)
    require(current == seal, 'Sealed stream inputs changed')
    require(all(not Path(path).lstat().st_mode & 0o222 for path in
                [seal['path'], *(row['path'] for row in seal['inputs'])]), 'Stream inputs are not read-only')


def execute_stream_specs(driver, budget, command, stage, specs, roots, tools):
    inputs, case, analysis = roots
    expected = {
        'inputs': [('stream-source-1-encode', 30, 'ffmpeg', inputs / 'source-1.mp4'),
                   ('stream-source-1-transport', 15, 'ffmpeg', inputs / 'source-1.ts'),
                   ('stream-source-2-encode', 30, 'ffmpeg', inputs / 'source-2.mp4'),
                   ('stream-source-2-transport', 15, 'ffmpeg', inputs / 'source-2.ts')],
        'audio': [('stream-video-probe', 20, 'ffprobe', case / 'archive/index.m3u8'),
                  ('stream-b-prefix-audio', 40, 'ffmpeg', analysis / 'B-prefix.s16'),
                  ('stream-a-prefix-audio', 40, 'ffmpeg', analysis / 'A-prefix.s16')],
    }
    require(type(specs) is list and 1 <= len(specs) <= 15, 'Invalid stream command inventory')
    if stage == 'video':
        expected[stage] = [(f'stream-video-window-{number:02d}', 40, 'ffmpeg', analysis / f'video-{number:02d}.rgb')
                           for number in range(len(specs) - 1)]
        expected[stage].append(('stream-a-return-audio', 40, 'ffmpeg', analysis / 'A-return.s16'))
        require(len(specs) >= 2, 'Missing stream video commands')
    require(stage in expected and len(specs) == len(expected[stage]), 'Stream command inventory differs')
    for spec, (name, seconds, tool_name, output) in zip(specs, expected[stage]):
        require(type(spec) is dict and set(spec) == {'name', 'argv', 'timeout_seconds', 'stdout_file'}
                and spec['name'] == name and type(spec['timeout_seconds']) is int
                and spec['timeout_seconds'] == seconds, 'Stream command identity or deadline differs')
        argv = spec['argv']
        require(type(argv) is list and 2 <= len(argv) <= 96
                and all(type(arg) is str and 0 < len(arg) <= 8192 for arg in argv)
                and argv[0] == tools[tool_name]['path'] and argv[-1] == str(output)
                and not any(re.search(r'(?i)(?:[a-z][a-z0-9+.-]*://|(?:https?|tcp|udp|rtsp|rtp|srt|ftp|unix|pipe|fd):)', arg)
                            for arg in argv), 'Unattested, external or redirected stream command')
        probe = analysis / 'video-probe.json' if name == 'stream-video-probe' else None
        require(spec['stdout_file'] == (str(probe) if probe else None)
                and not any(row['name'] == name for row in driver.commands), 'Unexpected stream stdout or repeated command')
        if probe:
            require(not probe.exists() and not probe.is_symlink(), 'Fresh stream probe output required')
        observed = system_tool_identity(Path(tools[tool_name]['requested_path']), budget)
        require(all(tools[tool_name][key] == item for key, item in observed.items()), 'Tool executable identity changed')
        text = command(name, argv, seconds)
        if probe:
            raw = text.encode('utf8')
            require(len(raw) <= 2 * 1024**2 and type(json.loads(raw)) is dict, 'Invalid bounded stream probe JSON')
            require(not probe.exists() and not probe.is_symlink(), 'Stream probe output appeared during command')
            budget.atomic(probe, raw)


def adopt_stream_evidence(driver, budget, specs, roots, *, forensic=False):
    inputs, case, analysis = roots
    case_files = {'CONTROL.json': 1024**2, 'EVENTS.jsonl': 8 * 1024**2,
                  'A-END-LIVE.m3u8': 65536, 'B-END-LIVE.m3u8': 65536,
                  'archive/index.m3u8': 65536, 'archive/ARCHIVE.json': 1024**2,
                  'archive/CAPTURE.jsonl': 8 * 1024**2,
                  'archive/A-selected-prefix.m3u8': 65536, 'archive/B-selected-prefix.m3u8': 65536}
    if forensic:
        case_files['archive/partial-prefix.m3u8'] = 65536
    analysis_files = {name: 1024**2 for name in ('audio-B.json', 'audio-B-original-rules.json',
                       'audio-A-initial.json', 'video.json', 'qualification.json')}
    analysis_files.update({'B-prefix.s16': 4 * 1024**2, 'A-prefix.s16': 4 * 1024**2,
                          'A-return.s16': 128000, 'video-probe.json': 2 * 1024**2, 'video-plan.json': 65536})
    if forensic:
        analysis_files['video-window-failure.json'] = 16 * 1024
    require(type(specs) is list and len(specs) <= 600, 'Invalid stream evidence inventory')
    seen, adopted = set(), []
    prefix = 'stream-media-forensic' if forensic else 'stream-media'
    for spec in specs:
        budget.tick(cleanup=forensic)
        require(type(spec) is dict and set(spec) == {'path', 'relative_name', 'max_bytes'}, 'Invalid stream evidence spec')
        name, maximum = spec['relative_name'], spec['max_bytes']
        require(type(name) is str and name not in seen and type(maximum) is int and maximum > 0,
                'Duplicate or invalid stream evidence name/bound')
        seen.add(name)
        pieces = Path(name).parts
        require(len(pieces) >= 3 and pieces[0] == prefix and '..' not in pieces
                and not Path(name).is_absolute() and str(Path(name)) == name,
                'Stream evidence path escaped its fixed tree')
        label, leaf = pieces[1], '/'.join(pieces[2:])
        allowed, parent = 0, None
        if label == 'inputs' and not forensic:
            parent = inputs
            allowed = 65536 if leaf == 'INPUTS.json' else 16 * 1024**2 if leaf in ('source-1.ts', 'source-2.ts') else 0
        elif label == 'analysis':
            parent, allowed = analysis, analysis_files.get(leaf, 0)
        elif label == 'case':
            parent, allowed = case, case_files.get(leaf, 0)
            if re.fullmatch(r'archive/segment-[0-9]{6}\.ts', leaf) and int(leaf[16:22]) <= 255:
                allowed = 2 * 1024**2
            if re.fullmatch(r'archive/observations/[0-9]{6}\.m3u8', leaf) and 1 <= int(Path(leaf).stem) <= 256:
                allowed = 65536
        require(parent is not None and allowed and maximum <= allowed
                and spec['path'] == str(parent / leaf), 'Stream evidence is not in the reviewed allowlist')
        raw = stream_read(Path(spec['path']), parent, maximum, budget, cleanup=forensic)
        if forensic and label == 'analysis' and leaf == 'video-window-failure.json':
            _validate_stream_rgb_failure(raw)
        destination = driver.evidence / name
        require(not destination.exists() and not destination.is_symlink(), 'Stream evidence output already exists')
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        budget.atomic(destination, raw, evidence=True, cleanup=forensic)
        adopted.append({'relative_name': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    return adopted


def _validate_stream_rgb_failure(raw):
    stride = 384 * 288 * 3

    def unique_object(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'Duplicate RGB failure JSON key')
            value[key] = item
        return value

    try:
        value = json.loads(raw, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, TypeError) as error:
        raise RuntimeError('Malformed RGB failure evidence') from error
    require(type(value) is dict
            and set(value) == {'window_index', 'planned_frames', 'decoded_frames',
                               'raw_bytes', 'partial_frame_bytes', 'reason', 'qualification'}
            and type(value['window_index']) is int and 0 <= value['window_index'] < 14
            and type(value['planned_frames']) is int and 1 <= value['planned_frames'] <= 1100
            and (value['decoded_frames'] is None or
                 (type(value['decoded_frames']) is int
                  and 0 <= value['decoded_frames'] <= 384 * 1024 * 1024 // stride))
            and (value['raw_bytes'] is None or
                 (type(value['raw_bytes']) is int and 0 <= value['raw_bytes'] <= 384 * 1024 * 1024))
            and (value['partial_frame_bytes'] is None or
                 (type(value['partial_frame_bytes']) is int and 0 <= value['partial_frame_bytes'] < stride))
            and (value['raw_bytes'] is None or
                 (value['decoded_frames'] is not None and value['partial_frame_bytes'] is not None
                  and value['raw_bytes'] == value['decoded_frames'] * stride + value['partial_frame_bytes']))
            and value['reason'] in {'MISSING_RGB_OUTPUT', 'RGB_OUTPUT_IO_FAILED',
                                    'RGB_FRAME_COUNT_MISMATCH', 'RGB_PARTIAL_FRAME',
                                    'RGB_VALIDATION_FAILED'}
            and value['qualification'] is False,
            'Invalid RGB failure evidence schema')


def require_complete_stream_evidence(packet, roots, budget):
    _, case, analysis = roots
    specs = packet['evidence']
    require(type(specs) is list and 0 < len(specs) <= 600, 'Incomplete stream media evidence inventory')
    proof = json.loads(stream_read(case / 'archive/ARCHIVE.json', case, 1024**2, budget))
    require(type(proof) is dict and type(proof.get('segments')) is list
            and 1 <= len(proof['segments']) <= 256
            and type(proof.get('segment_count')) is int and proof['segment_count'] == len(proof['segments'])
            and type(proof.get('unique_manifests')) is int and 1 <= proof['unique_manifests'] <= 256,
            'Invalid stream archive evidence inventory')
    case_names = {'CONTROL.json', 'EVENTS.jsonl', 'A-END-LIVE.m3u8', 'B-END-LIVE.m3u8',
                  'archive/index.m3u8', 'archive/ARCHIVE.json', 'archive/CAPTURE.jsonl',
                  'archive/A-selected-prefix.m3u8', 'archive/B-selected-prefix.m3u8'}
    for number, row in enumerate(proof['segments']):
        require(type(row) is dict and type(row.get('sequence')) is int and row['sequence'] == number
                and row.get('name') == f'segment-{number:06d}.ts', 'Stream archive sequence inventory differs')
        case_names.add('archive/' + row['name'])
    case_names.update(f'archive/observations/{number:06d}.m3u8' for number in range(1, proof['unique_manifests'] + 1))
    analysis_names = {'audio-B.json', 'audio-B-original-rules.json', 'audio-A-initial.json', 'video.json',
                      'qualification.json', 'B-prefix.s16', 'A-prefix.s16', 'A-return.s16',
                      'video-probe.json', 'video-plan.json'}
    expected = {'stream-media/case/' + name for name in case_names}
    expected.update('stream-media/analysis/' + name for name in analysis_names)
    names = [spec.get('relative_name') if type(spec) is dict else None for spec in specs]
    require(all(type(name) is str for name in names) and len(names) == len(expected) and set(names) == expected,
            'Incomplete stream media evidence inventory')
    report = json.loads(stream_read(analysis / 'qualification.json', analysis, 1024**2, budget))
    require(json.dumps(report, sort_keys=True, allow_nan=False)
            == json.dumps(packet['result'], sort_keys=True, allow_nan=False), 'Stream analyzer result/evidence differ')


def bind_stream_evidence_hashes(report, adopted):
    hashes = {row['relative_name']: row['sha256'] for row in adopted}
    case_names = {'CONTROL.json', 'EVENTS.jsonl', 'A-END-LIVE.m3u8', 'B-END-LIVE.m3u8',
                  'archive/index.m3u8', 'archive/ARCHIVE.json',
                  'archive/A-selected-prefix.m3u8', 'archive/B-selected-prefix.m3u8'}
    pcm_names = {'B-prefix.s16', 'A-prefix.s16', 'A-return.s16'}
    for key, names, prefix in (('case_sha256', case_names, 'stream-media/case/'),
                               ('work_pcm_sha256', pcm_names, 'stream-media/analysis/')):
        values = report.get(key)
        require(type(values) is dict and set(values) == names
                and all(type(value) is str and re.fullmatch('[0-9a-f]{64}', value)
                        and hashes.get(prefix + name) == value for name, value in values.items()),
                'Stream analyzer hashes do not bind adopted evidence')


def streamed_fixture_retry_eligible(error, case, budget):
    if platform.system() != 'Darwin':
        return False, 'non-macos'
    if not isinstance(error, (RuntimeError, AssertionError)):
        return False, 'unexpected-error-type'
    control_path = case / 'CONTROL.json'
    if control_path.is_symlink() or not control_path.is_file():
        return False, 'missing-control'
    try:
        control = json.loads(budget.read(control_path, 1024**2, cleanup=True).decode('utf-8', 'strict'))
    except Exception:
        return False, 'unreadable-control'
    if not isinstance(control, dict) or control.get('pass') is not False:
        return False, 'control-not-failed'
    archive = control.get('archive')
    if not isinstance(archive, dict):
        return False, 'missing-archive'
    if archive.get('qualified') is not False:
        return False, 'archive-qualified'
    if archive.get('at_least_60s_EXTINF') is not False:
        return False, 'sustained-evidence-present'
    # Exact flaky signature: output transitioned to Failed before sustained evidence.
    failed_seen = False
    events_path = case / 'EVENTS.jsonl'
    if events_path.is_file() and not events_path.is_symlink():
        try:
            for line in budget.read(events_path, 8 * 1024**2, cleanup=True).decode('utf-8', 'strict').splitlines():
                if not line.strip():
                    continue
                event = json.loads(line)
                if not isinstance(event, dict):
                    continue
                output_state = event.get('output_state')
                snapshot = event.get('snapshot')
                if snapshot is None:
                    snapshot = event.get('output')
                if snapshot is None and isinstance(event.get('event'), dict):
                    snapshot = event['event'].get('snapshot')
                if isinstance(snapshot, dict):
                    output_state = snapshot.get('output_state', output_state)
                if output_state == 'Failed':
                    failed_seen = True
                    break
        except Exception:
            return False, 'unreadable-events'
    if not failed_seen:
        output = control.get('output')
        if isinstance(output, dict) and output.get('output_state') == 'Failed':
            failed_seen = True
    if not failed_seen:
        return False, 'output-not-failed'
    return True, STREAMED_MACOS_FLAKY_SIGNATURE


def extend_budget_for_production_retry(budget):
    """Grant one bounded deadline extension so a recorded macOS retry can run."""
    if platform.system() != 'Darwin' or getattr(budget, 'macos_retry_extension_seconds', 0):
        return 0
    budget.deadline += PRODUCTION_MACOS_FLAKY_RETRY_EXTENSION_SECONDS
    budget.work_deadline += PRODUCTION_MACOS_FLAKY_RETRY_EXTENSION_SECONDS
    budget.macos_retry_extension_seconds = PRODUCTION_MACOS_FLAKY_RETRY_EXTENSION_SECONDS
    return PRODUCTION_MACOS_FLAKY_RETRY_EXTENSION_SECONDS


def production_fixture_retry_eligible(error, log_path, budget):
    """Retry the sustained production fixture only on the known macOS signature."""
    if platform.system() != 'Darwin':
        return False, 'non-macos'
    if not isinstance(error, RuntimeError):
        return False, 'unexpected-error-type'
    if log_path.is_symlink() or not log_path.is_file():
        return False, 'missing-log'
    try:
        text = budget.read(log_path, 8 * 1024**2).decode('utf-8', 'strict')
    except Exception:
        return False, 'unreadable-log'
    for signature in PRODUCTION_MACOS_FLAKY_SIGNATURES:
        if signature in text:
            return True, signature
    return False, 'signature-absent'


def preserve_streamed_forensic(driver, budget, media, case, analysis, roots, result, label):
    try:
        report = media.failure_evidence(case, analysis)
        require(type(report) is dict and set(report) == {'schema', 'qualified', 'forensic_only',
                'incomplete', 'errors', 'omitted_files', 'evidence_bytes', 'evidence',
                'preserves_original_error', 'cleanup_must_run_unconditionally'}
                and report.get('schema') == 'ottplay.multiview.stream-forensic.v1'
                and report.get('qualified') is False and report.get('forensic_only') is True
                and type(report.get('incomplete')) is bool and type(report.get('errors')) is list
                and all(type(value) is str for value in report['errors'])
                and len(set(report['errors'])) == len(report['errors'])
                and set(report['errors']) <= {'ROOT_UNAVAILABLE', 'MISSING_REQUIRED', 'CUSTODY_OR_BOUND',
                                            'MALFORMED_STRUCTURE', 'EVIDENCE_BUDGET'}
                and report['incomplete'] is bool(report['errors'])
                and type(report['omitted_files']) is int and 0 <= report['omitted_files'] <= 600
                and (report['omitted_files'] == 0 or report['incomplete'])
                and type(report['evidence_bytes']) is int and 0 <= report['evidence_bytes'] <= 32 * 1024**2
                and report.get('preserves_original_error') is True
                and report.get('cleanup_must_run_unconditionally') is True,
                'Malformed stream forensic receipt')
        specs = report['evidence']
        adopted = adopt_stream_evidence(driver, budget, specs, roots, forensic=True)
        require(sum(row['bytes'] for row in adopted) == report['evidence_bytes'],
                'Stream forensic byte inventory differs')
        forensic = {key: value for key, value in report.items() if key != 'evidence'}
        result[label + '_evidence'] = adopted
        result[label] = forensic
        budget.json_evidence(driver.evidence / (label.replace('_', '-') + '.json'), forensic, cleanup=True)
        return forensic
    except BaseException as forensic_error:
        result[label + '_error'] = str(forensic_error)
        return None


def reset_streamed_attempt_dirs(roots):
    _inputs, case, analysis = roots
    for path in (case, analysis):
        if path.exists() or path.is_symlink():
            shutil.rmtree(path)
    # The streamed fixture creates `case`; keep it absent before each attempt.
    analysis.mkdir(mode=0o700)


def run_streamed_fixture(driver, budget, command, executable, tools, result):
    parent = driver.output / 'streamed'
    parent.mkdir(mode=0o700)
    roots = (parent / 'inputs', parent / 'case', parent / 'analysis')
    inputs, case, analysis = roots
    media = primary = None
    old_env = {key: driver.env.get(key) for key in ('OTTPLAY_MULTIVIEW_STREAM_INPUTS', 'OTTPLAY_MULTIVIEW_STREAM_CASE_DIR')}
    try:
        media = load_stream_media(driver.root, budget)
        controls = media.self_test()
        true_keys = {'pass', 'pure_positive', 'reject_100ms_hole_despite_global_pass', 'reject_20ms_phase_jump',
                     'reject_wrong_owner', 'reject_449_frame_48k_hole', 'reject_898_interleaved_counter',
                     'ported_original_rule_agreement', 'reject_later_onset_trim',
                     'reject_event_restart_regression_wrong_owner', 'safety_cap_above_acceptance',
                     'reject_wrong_video_and_frozen_marker', 'exact_tail_coverage', 'a_return_duration_before_crop'}
        require(type(controls) is dict and set(controls) == true_keys | {'tools_started', 'long_media_generated'}
                and all(controls[key] is True for key in true_keys)
                and controls['tools_started'] is False and controls['long_media_generated'] is False,
                'Stream analyzer negative controls failed')
        budget.json_evidence(driver.evidence / 'streamed-self-test.json', controls)
        help_text = command('stream-stats-mux-pre', [tools['ffmpeg']['path'], '-hide_banner', '-h', 'full'])
        require(re.search(r'(?m)^\s*-stats_mux_pre(?:\[|:|\s)', help_text), 'FFmpeg stats_mux_pre is required')
        execute_stream_specs(driver, budget, command, 'inputs', media.prepare_inputs(inputs, tools), roots, tools)
        seal = seal_stream_inputs(media.seal_inputs(inputs), inputs, budget)
        input_specs = [{'path': seal['path'], 'relative_name': 'stream-media/inputs/INPUTS.json', 'max_bytes': 65536}]
        input_specs += [{'path': row['path'], 'relative_name': 'stream-media/inputs/' + Path(row['path']).name,
                         'max_bytes': 16 * 1024**2} for row in seal['inputs']]
        result['streamed_input_evidence'] = adopt_stream_evidence(driver, budget, input_specs, roots)

        retry_budget = STREAMED_MACOS_FLAKY_MAX_RETRIES if platform.system() == 'Darwin' else 0
        attempts = []
        for attempt in range(retry_budget + 1):
            reset_streamed_attempt_dirs(roots)
            driver.env.update(OTTPLAY_MULTIVIEW_STREAM_INPUTS=seal['path'], OTTPLAY_MULTIVIEW_STREAM_CASE_DIR=str(case))
            label = 'fixture-4' if attempt == 0 else f'fixture-4-retry-{attempt}'
            try:
                text = command(label, [str(executable), STREAM_TEST, '--ignored', '--exact',
                               '--test-threads=1', '--color=never'], 110)
                require_one_pass(text, STREAM_TEST)
                bind_stream_control(case, seal, budget)
                execute_stream_specs(driver, budget, command, 'audio', media.prepare_audio(case, analysis, tools), roots, tools)
                execute_stream_specs(driver, budget, command, 'video', media.prepare_video(case, analysis, tools), roots, tools)
                packet = media.finish(case, analysis)
                require(type(packet) is dict and set(packet) == {'result', 'evidence'}
                        and type(packet['result']) is dict and packet['result'].get('pass') is True
                        and packet['result'].get('schema') == 'ottplay.multiview.stream-media.v1'
                        and packet['result'].get('helper_sha256') == STREAM_MEDIA_SHA256,
                        'Stream media analyzer did not qualify this case')
                bind_stream_control(case, seal, budget)
                require_complete_stream_evidence(packet, roots, budget)
                result['streamed_media_evidence'] = adopt_stream_evidence(driver, budget, packet['evidence'], roots)
                bind_stream_evidence_hashes(packet['result'], result['streamed_media_evidence'])
                result['streamed_media'] = packet['result']
                if attempts:
                    result['streamed_flaky_retry'] = {
                        'qualified_after_retry': True,
                        'test': STREAM_TEST,
                        'platform': platform.system(),
                        'max_retries': retry_budget,
                        'attempts': attempts,
                        'final_attempt': attempt + 1,
                        'signature': STREAMED_MACOS_FLAKY_SIGNATURE,
                    }
                budget.tick()
                return
            except BaseException as error:
                eligible, reason = streamed_fixture_retry_eligible(error, case, budget)
                attempts.append({'attempt': attempt + 1, 'command': label, 'error': str(error),
                                 'error_type': type(error).__name__, 'retry_eligible': eligible,
                                 'reason': reason})
                if eligible and attempt < retry_budget:
                    preserved = preserve_streamed_forensic(driver, budget, media, case, analysis, roots, result,
                                                           f'streamed_forensic_attempt_{attempt + 1}')
                    if preserved is not None:
                        continue
                    attempts[-1]['retry_eligible'] = False
                    attempts[-1]['reason'] = 'forensic-preservation-failed'
                if attempts:
                    result['streamed_flaky_retry'] = {
                        'qualified_after_retry': False,
                        'test': STREAM_TEST,
                        'platform': platform.system(),
                        'max_retries': retry_budget,
                        'attempts': attempts,
                        'final_attempt': attempt + 1,
                        'signature': STREAMED_MACOS_FLAKY_SIGNATURE,
                    }
                primary = error
                raise
    except BaseException as error:
        if primary is None:
            primary = error
        raise
    finally:
        try:
            if primary is not None and media is not None:
                preserve_streamed_forensic(driver, budget, media, case, analysis, roots, result, 'streamed_forensic')
        finally:
            # Every Driver.run has already executed its unconditional process
            # cleanup before it returns/raises. Forensics never owns that duty.
            for key, value in old_env.items():
                if value is None:
                    driver.env.pop(key, None)
                else:
                    driver.env[key] = value



def run_pending_fixture(driver, budget, command, executable, tools, result):
    """Exercise the genuine Decoder using two short, locally generated TS inputs."""
    parent = driver.output / 'pending-clock'
    parent.mkdir(mode=0o700)
    inputs = parent / 'inputs'
    inputs.mkdir(mode=0o700)
    scratch = parent / "tmp space'colon:back\\slash"
    scratch.mkdir(mode=0o700)
    case = parent / 'case'
    manifest_path = inputs / 'INPUTS.json'
    rows = []
    # Raw samples define exact 1s/3s track lengths. AAC padding is checked by
    # the Rust fixture (49152/145408 decoded stereo frames), never guessed here.
    for identity, video_frames, audio_seconds in (('a1-v3', 30, 1), ('a3-v1', 10, 3)):
        video, audio = inputs / (identity + '.rgb'), inputs / (identity + '.s16')
        rgb = bytearray()
        for frame in range(video_frames):
            budget.tick()
            rgb.extend(bytes(((frame * 7) % 256, 80, 180)) * (96 * 64))
        pcm = bytearray()
        for frame in range(48000 * audio_seconds):
            if frame % 4096 == 0:
                budget.tick()
            sample = round(10000 * math.sin(2 * math.pi * 320 * frame / 48000))
            pcm.extend(struct.pack('<hh', sample, sample))
        budget.atomic(video, rgb)
        budget.atomic(audio, pcm)
        output = inputs / (identity + '.ts')
        observed = system_tool_identity(Path(tools['ffmpeg']['requested_path']), budget)
        require(all(tools['ffmpeg'][key] == value for key, value in observed.items()),
                'Pending generator executable identity changed')
        command('pending-generate-' + identity, [tools['ffmpeg']['path'], '-nostdin', '-hide_banner',
                '-loglevel', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-f', 'rawvideo',
                '-pixel_format', 'rgb24', '-video_size', '96x64', '-framerate', '10', '-i', str(video),
                '-protocol_whitelist', 'file,pipe', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', str(audio),
                '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads:v', '1', '-preset', 'ultrafast',
                '-tune', 'zerolatency', '-crf', '18', '-g', '10', '-keyint_min', '10', '-sc_threshold', '0',
                '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads:a', '1', '-ar', '48000', '-ac', '2',
                '-b:a', '96k', '-f', 'mpegts', str(output)], 30)
        raw = stream_read(output, inputs, 1024**2, budget)
        require(raw, 'Empty pending fixture transport input')
        output.chmod(0o400)
        rows.append({'id': identity, 'path': str(output), 'bytes': len(raw),
                     'sha256': hashlib.sha256(raw).hexdigest()})
    manifest = {'schema': 'ottplay.multiview.pending-inputs.v1', 'width': 96, 'height': 64,
                'fps': 10, 'inputs': rows}
    budget.atomic(manifest_path, (json.dumps(manifest, sort_keys=True) + '\n').encode())
    manifest_path.chmod(0o400)
    manifest_raw = stream_read(manifest_path, inputs, 16384, budget)
    manifest_hash = hashlib.sha256(manifest_raw).hexdigest()
    keys = ('OTTPLAY_MULTIVIEW_PENDING_INPUTS', 'OTTPLAY_MULTIVIEW_PENDING_CASE_DIR', 'TMPDIR')
    old_env = {key: driver.env.get(key) for key in keys}
    primary = None
    try:
        driver.env.update(OTTPLAY_MULTIVIEW_PENDING_INPUTS=str(manifest_path),
                          OTTPLAY_MULTIVIEW_PENDING_CASE_DIR=str(case), TMPDIR=str(scratch))
        text = command('fixture-pending-clock', [str(executable), PENDING_TEST, '--ignored', '--exact',
                       '--test-threads=1', '--color=never'], 120)
        require_one_pass(text, PENDING_TEST)
        raw = stream_read(case / 'CONTROL.json', case, 131072, budget)
        control = json.loads(raw)
        expected = [('AudioTail', 'a1-v3'), ('VideoTail', 'a3-v1'), ('LateFailure', 'a1-v3'),
                    ('Revoke', 'a1-v3'), ('Cancel', 'a1-v3')]
        require(type(control) is dict and control.get('schema') == 'ottplay.multiview.pending-clock-fixture.v1'
                and control.get('pass') is True and type(control.get('case_count')) is int
                and control['case_count'] == 5 and control.get('error') is None
                and control.get('input_manifest_sha256') == manifest_hash
                and control.get('external_process_group_supervisor_required') is True
                and control.get('clean_eof_from_pending_claimed') is False
                and type(control.get('cases')) is list and len(control['cases']) == 5,
                'Pending fixture CONTROL did not qualify all five scenarios')
        for observed, (scenario, identity) in zip(control['cases'], expected):
            require(type(observed) is dict and observed.get('scenario') == scenario
                    and observed.get('input') == identity and observed.get('pass') is True
                    and observed.get('metadata_clean') is True and observed.get('error') is None
                    and observed.get('input_sha256') == next(row['sha256'] for row in rows if row['id'] == identity),
                    'Pending fixture scenario identity, input or cleanup differs')
        require(stream_read(manifest_path, inputs, 16384, budget) == manifest_raw
                and not manifest_path.lstat().st_mode & 0o222, 'Pending input manifest changed')
        for row in rows:
            path = Path(row['path'])
            require(not path.lstat().st_mode & 0o222
                    and hashlib.sha256(stream_read(path, inputs, 1024**2, budget)).hexdigest() == row['sha256'],
                    'Pending fixture input changed')
        require(not any(scratch.iterdir()), 'Pending fixture temporary cleanup incomplete')
        budget.json_evidence(driver.evidence / 'pending-clock-inputs.json', manifest)
        budget.atomic(driver.evidence / 'pending-clock-control.json', raw, evidence=True)
        result['pending_clock'] = {'pass': True, 'scenarios': [name for name, _ in expected],
                                   'input_manifest_sha256': manifest_hash,
                                   'control_sha256': hashlib.sha256(raw).hexdigest(),
                                   'production_admission': False}
    except BaseException as error:
        primary = error
        raise
    finally:
        if primary is not None:
            # Driver.run already retired its process group before returning or
            # raising. Preserve bounded diagnostics without masking that error.
            try:
                forensic = []
                for source, owned, destination, cap in (
                    (manifest_path, inputs, 'pending-clock-forensic-inputs.json', 16384),
                    (case / 'CONTROL.json', case, 'pending-clock-forensic-control.json', 131072),
                ):
                    if source.exists() or source.is_symlink():
                        payload = stream_read(source, owned, cap, budget, cleanup=True)
                        budget.atomic(driver.evidence / destination, payload, evidence=True, cleanup=True)
                        forensic.append({'path': destination, 'bytes': len(payload),
                                         'sha256': hashlib.sha256(payload).hexdigest()})
                result['pending_clock_forensic'] = {'qualified': False, 'forensic_only': True,
                                                    'evidence': forensic}
            except BaseException as error:
                result['pending_clock_forensic_error'] = str(error)
        for key, value in old_env.items():
            if value is None:
                driver.env.pop(key, None)
            else:
                driver.env[key] = value


def prepare_production_inputs(driver, budget, command, tools, directory, seconds=210, label_prefix='production'):
    """Create three sealed 210-second MPEG-TS sources for the normal binary test."""
    require((seconds, label_prefix) in ((210, 'production'), (600, 'production-hls')),
            'Only finite reviewed production duration/command namespaces are allowed')
    inputs = Path(directory)
    require(not inputs.exists() and not inputs.is_symlink(), 'Fresh production-input directory required')
    inputs.mkdir(mode=0o700)
    rows = []
    for identity, color, frequency in ((1, 'red', 330), (2, 'lime', 440), (3, 'blue', 550)):
        budget.tick()
        observed = system_tool_identity(Path(tools['ffmpeg']['requested_path']), budget)
        require(all(tools['ffmpeg'][key] == value for key, value in observed.items()),
                'Production fixture generator identity changed')
        path = inputs / f'source-{identity}.ts'
        command(label_prefix + '-source-' + str(identity), [tools['ffmpeg']['path'], '-nostdin', '-hide_banner',
                '-loglevel', 'error', '-n', '-f', 'lavfi', '-i',
                f'color=c={color}:s=96x64:r=10:d={seconds}', '-f', 'lavfi', '-i',
                f'sine=frequency={frequency}:sample_rate=48000:duration={seconds}',
                '-map', '0:v:0', '-map', '1:a:0', '-t', str(seconds),
                '-c:v', 'libx264', '-threads:v', '1', '-preset', 'ultrafast', '-tune', 'zerolatency',
                '-b:v', '160k', '-g', '10', '-keyint_min', '10', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-threads:a', '1', '-ar', '48000', '-ac', '2', '-b:a', '64k',
                '-f', 'mpegts', str(path)], 120)
        metadata = path.lstat()
        require(stat.S_ISREG(metadata.st_mode) and not path.is_symlink()
                and 188 <= metadata.st_size <= 16 * 1024**2,
                'Production source is not a bounded regular MPEG-TS-sized file')
        raw = budget.read(path, 16 * 1024**2)
        require(raw and len(raw) == metadata.st_size and len(raw) % 188 == 0
                and all(raw[offset] == 0x47 for offset in (0, 188, 376)),
                'Production source failed MPEG-TS sync/size checks')
        path.chmod(0o400)
        rows.append({'id': identity, 'path': str(path), 'bytes': len(raw),
                     'sha256': hashlib.sha256(raw).hexdigest(),
                     'color': color, 'audio_frequency_hz': frequency})
    manifest = {'schema': 'ottplay.multiview.production-inputs.v1', 'seconds': seconds,
                'fps': 10, 'width': 96, 'height': 64, 'inputs': rows}
    manifest_path = inputs / 'INPUTS.json'
    budget.atomic(manifest_path, (json.dumps(manifest, sort_keys=True) + '\n').encode())
    manifest_path.chmod(0o400)
    observed = system_tool_identity(Path(tools['ffmpeg']['requested_path']), budget)
    require(all(tools['ffmpeg'][key] == value for key, value in observed.items()),
            'Production fixture generator changed after generation')
    return manifest_path, manifest


def read_packet_proof(output, budget, expected_sha256=None, expected_bytes=None):
    metadata = output.lstat()
    require(stat.S_ISREG(metadata.st_mode) and not output.is_symlink()
            and metadata.st_nlink == 1 and metadata.st_uid == os.geteuid()
            and 0 < metadata.st_size <= 16 * 1024**2,
            'Packet proof is not a bounded owned regular file')
    raw = budget.read(output, 16 * 1024**2)
    after = output.lstat()
    require((metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_nlink, metadata.st_size,
             metadata.st_mtime_ns, metadata.st_ctime_ns)
            == (after.st_dev, after.st_ino, after.st_mode, after.st_nlink, after.st_size,
                after.st_mtime_ns, after.st_ctime_ns), 'Packet proof changed during bounded read')
    require(expected_sha256 is None or hashlib.sha256(raw).hexdigest() == expected_sha256,
            'Batch packet output hash changed')
    require(expected_bytes is None or len(raw) == expected_bytes, 'Batch packet output size changed')
    result = packet_timeline(raw)
    output.unlink()
    return result


def packet_timeline(text):
    data = json.loads(text)
    require(type(data) is dict and type(data.get('streams')) is list and type(data.get('packets')) is list,
            'Bounded packet timeline must have actual streams and packets')
    streams = sorted(data['streams'], key=lambda row: row['index'])
    require(len(streams) == 2 and [(row['index'], row['codec_name'], row['time_base']) for row in streams]
            == [(0, 'h264', '1/90000'), (1, 'aac', '1/90000')], 'Segment stream identity changed')
    rows = {0: [], 1: []}
    for packet in data['packets']:
        require(type(packet) is dict and type(packet.get('stream_index')) is int
                and packet['stream_index'] in rows, 'Unknown packet stream')
        values = []
        for key in ('pts', 'dts', 'duration'):
            value = packet.get(key)
            require(type(value) is int and -(1 << 62) <= value < (1 << 62), 'Missing or invalid original packet timestamp')
            values.append(value)
        require(values[2] > 0 and re.fullmatch(r'SHA256:[0-9a-f]{64}', packet.get('data_hash', '')),
                'Packet duration or payload digest absent')
        row = (*values, packet['data_hash'])
        previous = rows[packet['stream_index']]
        require(not previous or previous[-1][0] < row[0], 'Packet timeline repeats or rolls back')
        previous.append(row)
    require(all(rows.values()) and sum(map(len, rows.values())) <= 65536, 'Packet timeline empty or excessive')
    return rows


def prepare_hls_production_inputs(driver, budget, command, tools, directory):
    inputs = Path(directory).resolve()
    require(not inputs.exists(), 'Fresh live HLS input root required')
    inputs.mkdir(mode=0o700)
    _, originals = prepare_production_inputs(driver, budget, command, tools, inputs / 'originals', seconds=600, label_prefix='production-hls')
    sources = []
    packet_dir = inputs / 'packet-proof'
    packet_dir.mkdir(mode=0o700)
    jobs = []
    source_rows = []
    for original in originals['inputs']:
        identity = original['id']
        folder = inputs / f'segments-{identity}'
        folder.mkdir(mode=0o700)
        command(f'production-hls-split-{identity}', [tools['ffmpeg']['path'], '-nostdin', '-hide_banner',
                '-loglevel', 'error', '-n', '-copyts', '-i', original['path'], '-map', '0:v:0', '-map', '0:a:0',
                '-c', 'copy', '-f', 'segment', '-segment_time', '12', '-reset_timestamps', '0',
                '-segment_format', 'mpegts', '-segment_format_options', 'mpegts_copyts=1',
                str(folder / 'segment-%02d.ts')], 120)
        paths = [folder / f'segment-{index:02d}.ts' for index in range(50)]
        require(set(folder.iterdir()) == set(paths), 'Expected exactly50 finite HLS segments')
        segments = []
        for index, path in enumerate(paths):
            raw = budget.read(path, 8 * 1024**2)
            require(len(raw) >= 188 * 3 and len(raw) % 188 == 0
                    and all(raw[offset] == 0x47 for offset in (0, 188, 376)), 'Segment failed MPEG-TS sniff')
            path.chmod(0o400)
            segments.append({'index': index, 'path': str(path), 'bytes': len(raw),
                             'sha256': hashlib.sha256(raw).hexdigest(), 'duration_ns': 12_000_000_000})
        first = len(jobs)
        jobs.append({'input': str(Path(original['path']).resolve()), 'input_sha256': original['sha256'],
                     'output': str((packet_dir / f'p{len(jobs):03d}.json').resolve())})
        for segment in segments:
            jobs.append({'input': str(Path(segment['path']).resolve()), 'input_sha256': segment['sha256'],
                         'output': str((packet_dir / f'p{len(jobs):03d}.json').resolve())})
        source_rows.append((original, segments, first))
    require(len(jobs) == 153, 'Closed HLS proof batch requires exactly153 unique inputs')
    worker = Path(__file__).resolve().with_name('ci-multiview-hls-probe-batch.py')
    worker_before = budget.digest(worker)
    require(worker_before == HLS_BATCH_SHA256, 'HLS packet worker source changed')
    plan = {'schema': 'ottplay.multiview.hls-probes.v1', 'root': str(inputs.resolve()),
            'worker_sha256': worker_before, 'ffprobe': {key: tools['ffprobe'][key] for key in ('path', 'sha256', 'bytes')},
            'rows': jobs}
    plan_raw = json.dumps(plan, separators=(',', ':')).encode()
    require(len(plan_raw) <= 131072, 'Bounded HLS probe plan exceeded128KiB')
    plan_path = inputs / 'HLS-PROBE-PLAN.json'
    receipt_path = inputs / 'HLS-PROBE-RECEIPT.json'
    require(not plan_path.exists() and not receipt_path.exists(), 'Fresh batch plan/receipt required')
    budget.atomic(plan_path, plan_raw)
    plan_path.chmod(0o400)
    text = command('production-hls-probe-batch', [sys.executable, str(worker), '--plan', str(plan_path.resolve()),
                   '--receipt', str(receipt_path.resolve())], 240)
    require(not text.strip(), 'Packet batch must not enter the combined command log')
    require(budget.digest(worker) == worker_before
            and budget.read(plan_path, 131072) == plan_raw, 'Worker or closed batch plan changed')
    observed_tool = system_tool_identity(Path(tools['ffprobe']['requested_path']), budget)
    require(all(tools['ffprobe'][key] == value for key, value in observed_tool.items()), 'Packet batch tool changed')
    receipt_raw = budget.read(receipt_path, 131072)
    receipt = json.loads(receipt_raw)
    require(type(receipt) is dict and set(receipt) == {'schema', 'status', 'worker_sha256', 'tool_sha256',
            'rows', 'output_bytes', 'outer_pgid_guard_required', 'plan_sha256'}
            and receipt['schema'] == 'ottplay.multiview.hls-probe-receipt.v1' and receipt['status'] == 'passed'
            and receipt['worker_sha256'] == worker_before and receipt['tool_sha256'] == tools['ffprobe']['sha256']
            and receipt['plan_sha256'] == hashlib.sha256(plan_raw).hexdigest()
            and receipt['outer_pgid_guard_required'] is True and type(receipt['rows']) is list
            and len(receipt['rows']) == len(jobs), 'Packet batch receipt binding failed')
    output_total = 0
    for expected, actual in zip(jobs, receipt['rows'], strict=True):
        require(type(actual) is dict and set(actual) == {'input', 'output', 'input_sha256', 'output_sha256', 'bytes', 'exit', 'reaped'}
                and all(actual[key] == expected[key] for key in ('input', 'output', 'input_sha256'))
                and type(actual['exit']) is int and actual['exit'] == 0 and actual['reaped'] is True
                and type(actual['bytes']) is int and 0 < actual['bytes'] <= 16 * 1024**2
                and re.fullmatch(r'[0-9a-f]{64}', actual['output_sha256']), 'Packet batch row failed')
        metadata = Path(actual['output']).lstat()
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and metadata.st_uid == os.geteuid()
                and metadata.st_size == actual['bytes'], 'Packet batch output shape changed')
        output_total += metadata.st_size
    require(type(receipt['output_bytes']) is int and output_total == receipt['output_bytes'] <= 128 * 1024**2,
            'Aggregate packet proof exceeded128MiB')
    for original, segments, first in source_rows:
        def proof(index):
            row = receipt['rows'][index]
            require(hashlib.sha256(budget.read(Path(row['input']), 16 * 1024**2)).hexdigest() == row['input_sha256'],
                    'Sealed packet input changed')
            return read_packet_proof(Path(row['output']), budget, row['output_sha256'], row['bytes'])
        original_packets = proof(first)
        require(len(original_packets[0]) == 6000
                and original_packets[0][-1][0] + original_packets[0][-1][2] - original_packets[0][0][0] == 600 * 90000,
                'Original finite HLS source is not exactly600s at10fps')
        joined = {0: [], 1: []}
        for index in range(50):
            packet_rows = proof(first + index + 1)
            require(packet_rows[0][-1][0] + packet_rows[0][-1][2] - packet_rows[0][0][0] == 12 * 90000,
                    'Copy-only segment is not exactly12 original video seconds')
            for stream, collected in joined.items():
                collected.extend(packet_rows[stream])
        require(joined == original_packets, 'Copy-only HLS segmentation changed, omitted, duplicated or reset packet timestamps/payloads')
        timeline_sha = hashlib.sha256(json.dumps(original_packets, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        sources.append({'id': original['id'], 'original_path': original['path'], 'original_bytes': original['bytes'],
                        'original_sha256': original['sha256'], 'original_packet_timeline_sha256': timeline_sha,
                        'segmented_packet_timeline_sha256': timeline_sha, 'segments': segments})
    budget.atomic(driver.evidence / 'production-hls-probe-plan.json', plan_raw, evidence=True)
    budget.atomic(driver.evidence / 'production-hls-probe-receipt.json', receipt_raw, evidence=True)
    budget.json_evidence(driver.evidence / 'production-hls-probe-batch.json', {
        'probes': 153, 'plan_sha256': hashlib.sha256(plan_raw).hexdigest(),
        'receipt_sha256': hashlib.sha256(receipt_raw).hexdigest(), 'worker_sha256': worker_before,
        'output_bytes': output_total, 'all_children_reaped': True, 'outer_driver_group_guard_passed': True})
    manifest = {'schema': 'ottplay.multiview.production-hls-inputs.v1', 'seconds': 600,
                'target_seconds': 12, 'sources': sources}
    raw = (json.dumps(manifest, sort_keys=True) + '\n').encode()
    require(len(raw) <= 131072, 'Bounded live HLS manifest exceeded128KiB')
    path = inputs / 'HLS-INPUTS.json'
    budget.atomic(path, raw)
    path.chmod(0o400)
    return path, manifest


def run_core_rotation_fixture(driver, command, executable, tools, prepared_inputs, output):
    """Run the exact ignored Core rotation test with only owned synthetic inputs."""
    manifest_path, manifest = prepared_inputs
    require(manifest.get('schema') == 'ottplay.multiview.production-inputs.v1'
            and manifest.get('seconds') == 210 and len(manifest.get('inputs', [])) == 3,
            'Core rotation fixture inputs differ from the sealed production fixture')
    inputs = output / 'production' / 'inputs'
    require(manifest_path == inputs / 'INPUTS.json' and manifest_path.is_file()
            and not manifest_path.is_symlink(), 'Core rotation manifest is outside its owned input directory')
    rows = {row.get('id'): row for row in manifest['inputs']}
    require(set(rows) == {1, 2, 3}, 'Core rotation fixture requires exactly three sealed sources')
    require(all(Path(row['path']).parent == inputs and Path(row['path']).is_absolute()
                for row in rows.values()), 'Core rotation source path escaped its owned input directory')
    root = output / 'core-rotation'
    root.mkdir(mode=0o700)
    case = root / 'case'
    require(not case.exists() and not case.is_symlink(),
            'Core rotation case directory must be fresh for the test to create')
    env_keys = ('OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR', 'OTTPLAY_MULTIVIEW_ROTATE_INPUT_A',
                'OTTPLAY_MULTIVIEW_ROTATE_INPUT_B', 'OTTPLAY_MULTIVIEW_ROTATE_INPUT_C',
                'OTTPLAY_MULTIVIEW_FFMPEG', 'OTTPLAY_MULTIVIEW_FFPROBE')
    previous = {key: driver.env.get(key) for key in env_keys}
    try:
        driver.env.update({
            'OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR': str(case),
            'OTTPLAY_MULTIVIEW_ROTATE_INPUT_A': rows[1]['path'],
            'OTTPLAY_MULTIVIEW_ROTATE_INPUT_B': rows[2]['path'],
            'OTTPLAY_MULTIVIEW_ROTATE_INPUT_C': rows[3]['path'],
            'OTTPLAY_MULTIVIEW_FFMPEG': tools['ffmpeg']['path'],
            'OTTPLAY_MULTIVIEW_FFPROBE': tools['ffprobe']['path'],
        })
        text = command('core-ignored-' + hashlib.sha256(CORE_ROTATION_TEST.encode()).hexdigest()[:12],
                       [str(executable), CORE_ROTATION_TEST, '--ignored', '--exact',
                        '--test-threads=1', '--color=never'], 600)
        require_one_pass(text, CORE_ROTATION_TEST)
    finally:
        for key, value in previous.items():
            if value is None:
                driver.env.pop(key, None)
            else:
                driver.env[key] = value


def custody_identity(path):
    info = path.lstat()
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def custody_directory_identity(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
            and info.st_uid == os.geteuid(), 'Owned tool directory shape changed')
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid


@contextlib.contextmanager
def production_tool_custody(driver, budget, command, tools, output):
    """Copy only selected fingerprinted bytes; never relax the normal loader."""
    home_proof = activation_home_preflight(driver, budget)
    home = Path(home_proof['parent'])
    home_size_before = home.lstat().st_size
    root = home / ('.ottplay-multiview-tools-' + uuid.uuid4().hex)
    probe_cwd = root / 'probe-cwd'
    probe_cwd_before = None
    root_created = False
    root_before = None
    reservation = output / 'production-tool-custody-reservation'
    reservation_before = None
    reservation_owner = None
    command_start = len(driver.commands)
    staged, originals = {}, {}
    fifo_names = ('explicit-mode.fifo', 'default-mode.fifo')
    receipt = {'schema': 'ottplay.multiview.tool-custody.v1', 'root': str(root),
               'home': home_proof, 'home_size_before': home_size_before,
               'tools': {}, 'cleanup_confirmed': False,
               'transitive_shared_library_custody_qualified': False,
               'original_tools_provenance_preserved': True,
               'optional_otool_not_run': True}
    try:
        root.mkdir(mode=0o700)
        root_created = True
        root_before = custody_directory_identity(root)
        probe_cwd.mkdir(mode=0o700)
        probe_cwd_before = custody_directory_identity(probe_cwd)
        receipt['probe_cwd_identity'] = probe_cwd_before
        with contextlib.ExitStack() as stack:
            opened = {}
            for name in ('ffmpeg', 'ffprobe', 'mkfifo'):
                original = tools[name]
                require(type(original['bytes']) is int and 0 < original['bytes'] <= 64 * 1024**2,
                        'Selected tool exceeds private copy bound')
                current = system_tool_identity(Path(original['requested_path']), budget, cap=64 * 1024**2)
                require(all(original[key] == value for key, value in current.items()), 'Tool executable identity changed')
                source = Path(current['path'])
                stream = stack.enter_context(os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb'))
                info = os.fstat(stream.fileno())
                # OS package/multicall suppliers may have stable hardlinks.
                # Only our private destination role requires a single link.
                require(stat.S_ISREG(info.st_mode) and info.st_nlink >= 1 and info.st_uid in (0, os.geteuid())
                        and info.st_mode & 0o111 and not info.st_mode & 0o022
                        and 0 < info.st_size == current['bytes'] <= 64 * 1024**2
                        and (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_mtime_ns, info.st_ctime_ns) ==
                            (current['device'], current['inode'], current['mode'], current['nlink'], current['mtime_ns'], current['ctime_ns']),
                        'Selected source FD is not trusted')
                opened[name] = (stream, info)
                originals[name] = current
            total = sum(info.st_size for _, info in opened.values())
            require(total <= 192 * 1024**2 and shutil.disk_usage(home).free >= 4 * 1024**3 + total + 65536,
                    'Owned tool copy resource bound exceeded')
            # Driver.sample counts logical st_size: charge the HOME copies to
            # the unchanged attempt growth cap BEFORE writing any copied bytes.
            with reservation.open('xb') as stream:
                info = os.fstat(stream.fileno())
                reservation_owner = (info.st_dev, info.st_ino, info.st_uid)
                stream.truncate(total + 65536)
                stream.flush()
                os.fsync(stream.fileno())
            reservation.chmod(0o400)
            reservation_before = custody_identity(reservation)
            require(reservation_before[5] == total + 65536, 'Tool-copy growth reservation differs')
            driver.sample()
            for name, (source, before) in opened.items():
                destination = root / name
                digest = hashlib.sha256()
                count = 0
                with destination.open('xb') as target:
                    destination.chmod(0o600)
                    while block := source.read(65536):
                        budget.tick()
                        count += len(block)
                        require(count <= before.st_size, 'Selected tool grew during copy')
                        target.write(block)
                        digest.update(block)
                    target.flush()
                    os.fsync(target.fileno())
                destination.chmod(0o500)
                after = os.fstat(source.fileno())
                require((before.st_dev, before.st_ino, before.st_mode, before.st_nlink, before.st_uid,
                         before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                        (after.st_dev, after.st_ino, after.st_mode, after.st_nlink, after.st_uid,
                         after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Source FD changed during copy')
                require(count == before.st_size and digest.hexdigest() == originals[name]['sha256'], 'Copied supplier bytes differ')
                current = system_tool_identity(destination, budget)
                info = destination.lstat()
                require(info.st_uid == os.geteuid() and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o500
                        and current['sha256'] == originals[name]['sha256'] and current['bytes'] == before.st_size,
                        'Staged executable custody differs')
                require(system_tool_identity(Path(tools[name]['requested_path']), budget, cap=64 * 1024**2) == originals[name],
                        'Selected supplier path changed during copy')
                staged[name] = current
                receipt['tools'][name] = {'original': originals[name], 'staged': current}
            require(activation_home_preflight(driver, budget) == home_proof, 'Tool HOME ancestry changed')
            require(custody_directory_identity(root) == root_before and root.lstat().st_uid == os.geteuid()
                    and stat.S_IMODE(root.lstat().st_mode) == 0o700, 'Owned tool directory changed')
        def verify():
            budget.tick()
            require(activation_home_preflight(driver, budget) == home_proof, 'Tool HOME ancestry changed')
            require(custody_directory_identity(root) == root_before
                    and custody_directory_identity(probe_cwd) == probe_cwd_before and not list(probe_cwd.iterdir()),
                    'Owned tool directory or empty probe working directory changed')
            metadata_bytes = root.lstat().st_size + probe_cwd.lstat().st_size + max(0, home.lstat().st_size - home_size_before)
            require(metadata_bytes <= 65536, 'Owned tool HOME/root metadata reservation exceeded')
            receipt['observed_copy_metadata_bytes'] = metadata_bytes
            require(custody_identity(reservation) == reservation_before, 'Tool growth reservation changed')
            require(all(item.get('cleanup_confirmed') for item in driver.commands[command_start:]),
                    'Owned process cleanup unknown; production tools retained')
            for item in staged.values():
                require(system_tool_identity(Path(item['path']), budget) == item, 'Staged executable identity changed')

        def checked_command(name, args, seconds=15):
            verify()
            text = command(name, args, seconds)
            verify()
            return text

        def runtime_probe(name, args, seconds):
            # Core Command inherits the normal server's env/cwd. The fixture
            # starts that server with env_clear + only HOME and synthetic EPG.
            # Probe in an empty private directory, never the repo/Brew cwd.
            previous_env, previous_root = driver.env, driver.root
            try:
                driver.env = {'HOME': str(home), 'EPG_URLS': 'http://127.0.0.1:1/fixture-unavailable'}
                driver.root = probe_cwd
                return checked_command(name, args, seconds)
            finally:
                driver.env, driver.root = previous_env, previous_root

        receipt['runtime_probe_environment_keys'] = ['EPG_URLS', 'HOME']
        receipt['runtime_probe_cwd'] = str(probe_cwd)
        receipt['runtime_probe_matches_normal_server_env_clear'] = True
        verify()
        for name in ('ffmpeg', 'ffprobe'):
            text = runtime_probe('production-custody-' + name + '-version', [staged[name]['path'], '-version'], 15)
            require(len(text.encode()) <= 65536 and text.startswith(name + ' version '), 'Staged supplier cannot execute: ' + name)
        for index, name in enumerate(fifo_names):
            path = root / name
            args = [staged['mkfifo']['path']] + (['-m', '600'] if index == 0 else []) + [str(path)]
            runtime_probe('production-custody-mkfifo-' + str(index), args, 10)
            info = path.lstat()
            require(stat.S_ISFIFO(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1,
                    'Staged mkfifo did not create an owned FIFO')
            if index == 0:
                require(stat.S_IMODE(info.st_mode) == 0o600, 'Staged mkfifo ignored explicit permissions')
            receipt.setdefault('fifo_probes', []).append({'mode': oct(stat.S_IMODE(info.st_mode)), 'owned_fifo': True})
            path.unlink()
        receipt['runtime_probes_passed'] = True
        receipt['copied_bytes'] = total
        receipt['directory_metadata_reserved_bytes'] = 65536
        receipt['reserved_bytes'] = total + 65536
        budget.json_evidence(driver.evidence / 'production-tool-custody.json', receipt)
        yield staged, checked_command
        for name, item in staged.items():
            require(system_tool_identity(Path(item['path']), budget) == item, 'Staged executable identity changed')
            observed = system_tool_identity(Path(tools[name]['requested_path']), budget)
            require(observed == originals[name], 'Original supplier changed during production fixtures')
    finally:
        errors = []
        try:
            require(all(item.get('cleanup_confirmed') for item in driver.commands[command_start:]),
                    'Owned process cleanup unknown; production tools retained')
            require(root_created and root_before is not None and custody_directory_identity(root) == root_before,
                    'Owned tool directory custody changed or unconfirmed')
            entries = list(root.iterdir())
            require({path.name for path in entries} <= {'ffmpeg', 'ffprobe', 'mkfifo', 'probe-cwd', *fifo_names}, 'Unknown tool-custody entry retained')
            if probe_cwd.exists() or probe_cwd.is_symlink():
                require(probe_cwd_before is not None and custody_directory_identity(probe_cwd) == probe_cwd_before
                        and not list(probe_cwd.iterdir()), 'Uncertain probe working directory retained')
            for path in entries:
                if path == probe_cwd:
                    continue
                info = path.lstat()
                require(info.st_uid == os.geteuid() and info.st_nlink == 1
                        and (stat.S_ISREG(info.st_mode) if path.name in ('ffmpeg', 'ffprobe', 'mkfifo') else stat.S_ISFIFO(info.st_mode)),
                        'Uncertain tool-custody file retained')
            if reservation_owner is not None:
                info = reservation.lstat()
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                        and (info.st_dev, info.st_ino, info.st_uid) == reservation_owner, 'Tool growth reservation ownership changed')
            if reservation_before is not None:
                require(custody_identity(reservation) == reservation_before, 'Tool growth reservation changed')
            for path in entries:
                if path == probe_cwd:
                    path.rmdir()
                else:
                    path.unlink()
            root.rmdir()
            if reservation_owner is not None:
                reservation.unlink()
            receipt['cleanup_confirmed'] = True
        except (OSError, RuntimeError) as error:
            errors.append(str(error))
        receipt['cleanup_errors'] = errors
        budget.json_evidence(driver.evidence / 'production-tool-custody-cleanup.json', receipt, cleanup=True)
        require(not errors, 'Owned production tool cleanup uncertain: ' + '; '.join(errors))


def run_production_fixture(driver, budget, command, executable, tools, result, output, prepared_inputs=None):
    staged = {}
    try:
        with production_tool_custody(driver, budget, command, tools, output) as (runtime_tools, checked_command):
            _run_production_mode(driver, budget, checked_command, executable, tools, staged, output, hls=False,
                                 prepared_inputs=prepared_inputs, runtime_tools=runtime_tools)
            _run_production_mode(driver, budget, checked_command, executable, tools, staged, output, hls=True,
                                 runtime_tools=runtime_tools)
    except BaseException:
        # Retry audit stays visible even when a failed attempt never publishes flags.
        if 'production_flaky_retry' in staged:
            result['production_flaky_retry'] = staged['production_flaky_retry']
        raise
    # Flags publish only after BOTH modes AND actual owned tool cleanup qualify.
    result.update(staged)


def require_credential_clock(value):
    message = 'Production credential clock evidence malformed or out of bound'
    keys = {'startup_sample_ms', 'observation_elapsed_ms', 'probe_elapsed_ms',
            'lower_bound_ms', 'short_expires_ms'}
    require(type(value) is dict and set(value) == keys
            and all(type(number) is int and 0 <= number < 2**64 for number in value.values()), message)
    require(value['startup_sample_ms'] > 0 and value['short_expires_ms'] > 0
            and value['observation_elapsed_ms'] + value['probe_elapsed_ms'] < 600_000
            and value['lower_bound_ms'] == value['startup_sample_ms'] + value['probe_elapsed_ms']
            and value['lower_bound_ms'] >= value['short_expires_ms'], message)


def require_seed_refusal_summaries(value):
    message = 'Production seed refusal summaries malformed or incomplete'
    require(type(value) is list and len(value) == 3, message)
    keys = {'seed', 'body_first_count', 'body_later_count', 'supervisor_count', 'last', 'completed'}
    sites = ('body_first', 'body_later', 'supervisor')
    for seed, row in zip(('grid', 'main', 'replacement'), value, strict=True):
        require(type(row) is dict and set(row) == keys and row['seed'] == seed
                and row['completed'] is True, message)
        counts = [row[site + '_count'] for site in sites]
        require(all(type(count) is int and 0 <= count <= 2**64 - 1 for count in counts), message)
        last = row['last']
        if not any(counts):
            require(last is None, message)
            continue
        require(type(last) is dict and set(last) == {
            'site', 'marker', 'stderr_bytes', 'stderr_sha256', 'status', 'response_bytes'}, message)
        require(last['site'] in sites and counts[sites.index(last['site'])] > 0
                and type(last['marker']) is int and 1 <= last['marker'] < 2**64
                and type(last['stderr_bytes']) is int and 1 <= last['stderr_bytes'] <= 65536
                and type(last['stderr_sha256']) is str
                and re.fullmatch(r'[0-9a-f]{64}', last['stderr_sha256']) is not None
                and last['status'] is None and last['response_bytes'] is None, message)


def require_segment_video_proofs(rows):
    require(type(rows) is list and 1 <= len(rows) <= 64,
            'Normal output segment proof collection is missing or unbounded')
    fields = {'sha256', 'bytes', 'decoded_video_frames', 'sample_index',
              'duration_ticks', 'time_base', 'source_identity_unchanged'}
    for row in rows:
        require(type(row) is dict and set(row) == fields,
                'Normal output segment proof fields differ')
        require(type(row['sha256']) is str and re.fullmatch(r'[0-9a-f]{64}', row['sha256'])
                and type(row['bytes']) is int and 188 <= row['bytes'] <= 8 * 1024**2
                and type(row['decoded_video_frames']) is int and 1 <= row['decoded_video_frames'] <= 300
                and type(row['sample_index']) is int
                and row['sample_index'] == min(10, row['decoded_video_frames'] - 1)
                and type(row['duration_ticks']) is int and 1 <= row['duration_ticks'] <= 2**63 - 1
                and type(row['time_base']) is str
                and re.fullmatch(r'[0-9]{1,20}/[0-9]{1,20}', row['time_base'])
                and row['source_identity_unchanged'] is True,
                'Normal output segment proof values differ')
        numerator, denominator = map(int, row['time_base'].split('/'))
        require(1 <= numerator <= 2**64 - 1 and 1 <= denominator <= 2**64 - 1
                and row['duration_ticks'] * numerator <= 30 * denominator,
                'Normal output segment proof duration differs')


def _run_production_mode(driver, budget, command, executable, tools, result, output, *, hls, prepared_inputs=None, runtime_tools=None):
    """Run one exact normal-server mode under its unchanged600-second bound."""
    name = HLS_PRODUCTION_TEST if hls else PRODUCTION_TEST
    label = 'production-live-hls-server' if hls else 'production-normal-server'
    scope = ('Normal production HTTPS control/HLS with a private RFC1918 live HLS MPEG-TS adapter, one master level and sliding media windows; no native-player or physical-television qualification'
             if hls else 'Normal production HTTPS control/HLS with a private RFC1918 HTTP MPEG-TS adapter, all nine advertised slots and private HLS output; no native-player or physical-television qualification')
    inventory_prefix = 'production-hls' if hls else 'production'
    all_names = listed_names(command(inventory_prefix + '-inventory',
        [str(executable), '--list', '--format', 'terse']))
    ignored = listed_names(command(inventory_prefix + '-ignored-inventory',
        [str(executable), '--list', '--ignored', '--format', 'terse']))
    production_ignored = {PRODUCTION_TEST, HLS_PRODUCTION_TEST}
    require(all_names == production_ignored | PRODUCTION_ORDINARY_TESTS and ignored == production_ignored,
            'Production normal-binary fixture must have both exact ignored modes and frozen ordinary support')
    if not hls:
        ordinary = command('production-ordinary', [str(executable), '--test-threads=1', '--color=never'], 30)
        require_suite_pass(ordinary, PRODUCTION_ORDINARY_TESTS, ignored)
    parent = output / ('production-hls' if hls else 'production')
    if parent.exists():
        require(parent.is_dir() and not parent.is_symlink()
                and stat.S_IMODE(parent.lstat().st_mode) == 0o700,
                'Reused production fixture parent is not an owned private directory')
    else:
        parent.mkdir(mode=0o700)
    inputs = parent / 'inputs'
    case = parent / 'case'
    case.mkdir(mode=0o700)
    prepare = prepare_hls_production_inputs if hls else prepare_production_inputs
    if prepared_inputs is None:
        manifest_path, manifest = prepare(driver, budget, command, tools, inputs)
    else:
        require(not hls, 'Raw rotation assets cannot be reused as live HLS')
        manifest_path, manifest = prepared_inputs
        require(manifest_path == inputs / 'INPUTS.json' and inputs.is_dir() and not inputs.is_symlink(),
                'Reused production fixture inputs are outside their owned directory')
    manifest_limit = 131072 if hls else 16 * 1024
    manifest_raw = budget.read(manifest_path, manifest_limit)
    require(hashlib.sha256(manifest_raw).hexdigest() == hashlib.sha256(
        (json.dumps(manifest, sort_keys=True) + '\n').encode()).hexdigest(),
        'Production media manifest changed after sealing')
    budget.json_evidence(driver.evidence / ('production-hls-inputs.json' if hls else 'production-inputs.json'), manifest)
    receipt_path = case / 'CONTROL.json'
    env_keys = ('OTTPLAY_MULTIVIEW_PRODUCTION_INPUTS', 'OTTPLAY_MULTIVIEW_PRODUCTION_RECEIPT',
                'OTTPLAY_MULTIVIEW_FFMPEG', 'OTTPLAY_MULTIVIEW_FFPROBE', 'OTTPLAY_MULTIVIEW_MKFIFO',
                'OTTPLAY_MULTIVIEW_OPENSSL', 'OTTPLAY_MULTIVIEW_PRODUCTION_HLS_INPUTS')
    previous = {key: driver.env.get(key) for key in env_keys}
    try:
        runtime_tools = runtime_tools or tools
        driver.env.update(OTTPLAY_MULTIVIEW_PRODUCTION_INPUTS=str(manifest_path),
                          OTTPLAY_MULTIVIEW_PRODUCTION_RECEIPT=str(receipt_path),
                          OTTPLAY_MULTIVIEW_FFMPEG=runtime_tools['ffmpeg']['path'],
                          OTTPLAY_MULTIVIEW_FFPROBE=runtime_tools['ffprobe']['path'],
                          OTTPLAY_MULTIVIEW_MKFIFO=runtime_tools['mkfifo']['path'],
                          OTTPLAY_MULTIVIEW_OPENSSL=tools['openssl']['path'])
        if hls:
            driver.env['OTTPLAY_MULTIVIEW_PRODUCTION_HLS_INPUTS'] = str(manifest_path)
        retry_budget = PRODUCTION_MACOS_FLAKY_MAX_RETRIES if platform.system() == 'Darwin' else 0
        attempts = []
        for attempt in range(retry_budget + 1):
            attempt_label = label if attempt == 0 else f'{label}-retry-{attempt}'
            try:
                text = command(attempt_label, [str(executable), name, '--ignored', '--exact',
                               '--test-threads=1', '--color=never'], 600)
                require_one_pass(text, name)
                if attempts:
                    result['production_flaky_retry'] = {
                        'qualified_after_retry': True,
                        'test': name,
                        'platform': platform.system(),
                        'max_retries': retry_budget,
                        'attempts': attempts,
                        'final_attempt': attempt + 1,
                    }
                break
            except BaseException as error:
                eligible, reason = production_fixture_retry_eligible(
                    error, driver.evidence / 'logs' / (attempt_label + '.log'), budget)
                attempts.append({'attempt': attempt + 1, 'command': attempt_label,
                                 'error': str(error), 'error_type': type(error).__name__,
                                 'retry_eligible': eligible, 'reason': reason})
                if eligible and attempt < retry_budget:
                    attempts[-1]['deadline_extension_seconds'] = extend_budget_for_production_retry(budget)
                    continue
                result['production_flaky_retry'] = {
                    'qualified_after_retry': False,
                    'test': name,
                    'platform': platform.system(),
                    'max_retries': retry_budget,
                    'attempts': attempts,
                    'final_attempt': attempt + 1,
                }
                raise
        raw = budget.read(receipt_path, 131072)
        require(0 < len(raw) <= 131072 and not receipt_path.is_symlink()
                and stat.S_ISREG(receipt_path.lstat().st_mode),
                'Production test receipt is not an owned regular file')
        observed = json.loads(raw)
        require(type(observed) is dict and observed.get('schema') == 'ottplay.multiview.production-binary.v1'
                and observed.get('pass') is True
                and observed.get('scope') == scope
                and type(observed.get('tls')) is dict
                and observed['tls'].get('configured_api_transport') == 'https'
                and observed['tls'].get('trust') == 'synthetic_ca_only'
                and observed['tls'].get('untrusted_ca_rejected') is True
                and observed['tls'].get('wrong_hostname_rejected') is True
                and all(re.fullmatch(r'[0-9a-f]{64}', observed['tls'].get(key, ''))
                        for key in ('ca_sha256', 'leaf_sha256', 'openssl_sha256'))
                and type(observed.get('https_control_requests')) is int and observed['https_control_requests'] > 0
                and type(observed.get('https_media_requests')) is int and observed['https_media_requests'] > 0
                and observed.get('credential_expiry_rejected') is True
                and observed.get('expiry_output_was_active') is True
                and observed.get('expired_source_connections_closed') is True
                and observed.get('expired_output_cleanup') is True
                and observed.get('owned_fixture_root_removed') is True
                and observed.get('graceful_shutdown') is True
                and observed.get('shutdown_signal') == 'SIGTERM'
                and observed.get('active_sigterm') is True
                and type(observed.get('sequential_contexts')) is int and observed['sequential_contexts'] == 17
                and type(observed.get('sequential_output_generations')) is int and observed['sequential_output_generations'] == 17
                and observed.get('input_adapter') == ('http-hls-ts-v1' if hls else 'http-mpegts-v1')
                and observed.get('output_directory_empty') is True
                and observed.get('source_replacement') is True
                and observed.get('nine_slot_grid_rgb') is True
                and observed.get('selected_audio_tone') is True
                and observed.get('replacement_audio_tone') is True
                and observed.get('replacement_late_segment') is True
                and observed.get('sibling_frames_recent_at_end') is True
                and observed.get('hls_segment_audio_video') is True
                and type(observed.get('elapsed_seconds')) is int and 1 <= observed['elapsed_seconds'] <= 600
                and type(observed.get('sustained_seconds')) is int and 185 <= observed['sustained_seconds'] <= 600
                and type(observed.get('inputs')) is list
                and type(observed.get('upstream_request_counts')) is dict,
                'Normal production-server adapter receipt did not qualify its bounded contract')
        require_segment_video_proofs(observed.get('output_segment_video_proofs'))
        require_seed_refusal_summaries(observed.get('seed_refusal_summaries'))
        require_credential_clock(observed.get('credential_clock'))
        input_rows = ([{'id': row['id'], 'sha256': row['original_sha256'], 'bytes': row['original_bytes'], 'path': row['original_path']}
                       for row in manifest['sources']] if hls else manifest['inputs'])
        expected = {row['id']: row for row in input_rows}
        require(len(observed['inputs']) == 3 and all(type(row) is dict and row.get('id') in expected
                    and row.get('sha256') == expected[row['id']]['sha256']
                    and row.get('bytes') == expected[row['id']]['bytes']
                    for row in observed['inputs'])
                and {row['id'] for row in observed['inputs']} == set(expected),
                'Actual test receipt does not bind the three sealed transport sources')
        counts = observed['upstream_request_counts']
        if not hls:
            require(set(counts) == {f'source-{identity}.ts' for identity in (1, 2, 3)}
                    and all(type(value) is int and value >= 2 for value in counts.values()),
                    'Every source must have distinct Probe and Decode subscriptions')
        else:
            evidence = observed.get('hls_source')
            require(type(evidence) is dict and evidence.get('stable_retirement_interval_seconds') == 12,
                    'Live HLS source retirement evidence absent')
            audit = evidence.get('audit')
            require(type(audit) is dict and audit.get('future_denied') == 0
                    and all(type(audit.get(key)) is list and len(audit[key]) == 3
                            and all(type(value) is int and value >= 2 for value in audit[key]) for key in ('master', 'media'))
                    and type(audit.get('segments')) is list and len(audit['segments']) == 3
                    and all(type(row) is list and len(row) == 50 and all(type(value) is int and value >= 0 for value in row)
                            and sum(value > 0 for value in row) >= 8 for row in audit['segments']),
                    'Actual master/media/segment fetch or finite-window proof absent')
            expected_hls = [{'id': row['id'], 'original_sha256': row['original_sha256'],
                             'packet_timeline_sha256': row['original_packet_timeline_sha256'],
                             'segments': [{key: segment[key] for key in ('index', 'sha256', 'bytes', 'duration_ns')}
                                          for segment in row['segments']]} for row in manifest['sources']]
            require(evidence.get('inputs') == expected_hls, 'Actual HLS receipt does not bind immutable segment bytes/timestamps')
        require(budget.read(manifest_path, manifest_limit) == manifest_raw
                and not manifest_path.lstat().st_mode & 0o222, 'Production input manifest changed during execution')
        sealed_rows = input_rows + ([segment for row in manifest['sources'] for segment in row['segments']] if hls else [])
        for row in sealed_rows:
            path = Path(row['path'])
            require(not path.lstat().st_mode & 0o222
                    and hashlib.sha256(budget.read(path, 16 * 1024**2)).hexdigest() == row['sha256'],
                    'Actual production source bytes changed after execution')
        prefix = 'production-hls' if hls else 'production'
        budget.atomic(driver.evidence / (prefix + '-control.json'), raw, evidence=True)
        result['normal_server_hls_to_hls' if hls else 'normal_server_mpegts_to_hls'] = True
        result['production_hls_adapter' if hls else 'production_adapter'] = {
            'passed': True, 'scope': scope if hls else 'Actual production binary with protected HTTP-MPEGTS enrollment, all nine advertised slots, decoded grid RGB and selected audio tones, A/V HLS ffprobe, active-credential expiry, source replacement and cleanup; no native-player or physical-television proof', 'elapsed_seconds': observed['elapsed_seconds'],
            'input_manifest_sha256': hashlib.sha256(manifest_raw).hexdigest(),
            'control_sha256': hashlib.sha256(raw).hexdigest(),
            'input_sha256': {str(row['id']): row['sha256'] for row in input_rows},
            'upstream_request_counts': counts, 'sequential_contexts': 17, 'active_sigterm': True,
        }
    finally:
        for key, value in previous.items():
            if value is None:
                driver.env.pop(key, None)
            else:
                driver.env[key] = value


def main(argv=None):
    started = time.monotonic()
    guard = load_guard()  # Import only; its WK main is never called.
    budget = guard.Budget()
    # Include import/preflight work without extending the existing guard's bounds.
    budget.started, budget.deadline, budget.work_deadline = started, started + 1800, started + 1680
    parser = argparse.ArgumentParser()
    parser.add_argument('--work-root', type=Path, required=True)
    parser.add_argument('--required-core-test', action='append', default=[])
    parser.add_argument('--required-server-test', action='append', default=[])
    args = parser.parse_args(argv)
    budget.tick()
    require(platform.system() in ('Linux', 'Darwin') and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted', 'Disposable hosted Unix CI only')
    root = Path(os.environ['GITHUB_WORKSPACE']).resolve()
    require(root == Path.cwd().resolve() and Path(__file__).resolve().parent == root / 'scripts',
            'Run the checked-out helper in its source root')
    run_id, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    require(re.fullmatch(r'[0-9]{1,20}', run_id) and re.fullmatch(r'[0-9]{1,10}', attempt), 'Invalid attempt identity')
    parent = Path(os.environ['RUNNER_TEMP']).resolve()
    output = parent / ('ottplay-multiview-unix-' + run_id + '-' + attempt)
    require(args.work_root.is_absolute() and args.work_root == output, 'Unexpected owned output path')
    require(not output.exists() and not output.is_symlink(), 'Fresh owned CI attempt required')
    require(shutil.disk_usage(parent).free >= guard.FLOOR + guard.GROWTH_CAP, 'Need4GiB growth plus4GiB floor')
    budget.tick()
    output.mkdir(mode=0o700)
    driver = guard.Driver(root, output, budget)
    driver.env['CARGO_HOME'] = str(output / 'cargo-home')
    driver.env['CARGO_TERM_COLOR'] = 'never'
    driver.env['RUST_BACKTRACE'] = '0'
    # No rustc wrapper, external target directory, or user Cargo config overrides.
    for key in ('RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS'):
        driver.env.pop(key, None)
    result = {'status': 'fail', 'qualification': 'Unix source fixtures, broker boundary, zero-capacity activation and protected normal-server HTTP MPEG-TS adapter',
              'sustained_media_e2e': False, 'production_admission': False,
              'normal_server_mpegts_to_hls': False, 'normal_server_hls_to_hls': False, 'native_player_or_physical_television_qualified': False,
              'generated_media_hashes_available': False, 'new_dependencies': False}
    success = False
    work_error = None
    activation_home = activation_home_before = None
    activation_home_checked = False

    def command(name, args, seconds=15):
        driver.run(name, args, seconds)
        return budget.read(driver.evidence / 'logs' / (name + '.log'), guard.LOG_CAP).decode('utf-8', 'strict')

    def snapshot(label):
        head = command(label + '-head', ['git', 'rev-parse', '--verify', 'HEAD']).strip()
        require(re.fullmatch(r'[0-9a-f]{40}', head) and head == os.environ.get('GITHUB_SHA'),
                'Checkout differs from event commit')
        tree = command(label + '-tree', ['git', 'rev-parse', 'HEAD^{tree}']).strip()
        require(re.fullmatch(r'[0-9a-f]{40}', tree), 'Invalid source tree')
        require(not command(label + '-status', ['git', 'status', '--porcelain=v1', '--untracked-files=all']).strip(),
                'Source checkout is dirty')
        paths = ('Cargo.toml', 'Cargo.lock', 'src-rs/core/Cargo.toml', 'src-rs/server/Cargo.toml',
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
                 'src-rs/server/tests/multiview_fixtures.rs', 'src-rs/server/tests/multiview_activation.rs',
                 'src-rs/server/tests/multiview_production.rs',
                 'src-rs/server/tests/support/multiview_production_tls.rs',
                 'src-rs/server/tests/support/multiview_production_config.rs',
                 'src-rs/server/src/multiview_operator.rs', 'src-rs/server/src/multiview_service.rs',
                 'src-rs/server/tests/support/hls_production.rs',
                 'src-rs/server/tests/multiview_broker_boundary.rs',
                 'src-rs/server/src/multiview_broker.rs', 'src-rs/server/src/multiview_broker_live.rs',
                 'src-rs/server/src/multiview_broker_live_output_tests.rs', 'src-rs/server/src/media_connection.rs',
                 'src-rs/server/src/private_media_attempt.rs',
                 'src-rs/server/tests/support/streamed_session.rs', 'src-rs/server/tests/support/streamed_transport.rs',
                 'src-rs/server/tests/support/streamed_archive.rs',
                 'src-rs/server/tests/support/streamed_decoder.rs',
                 'src-rs/core/src/multiview/decoder.rs', 'src-rs/core/src/multiview/frames.rs',
                 'src-rs/core/src/multiview/geometry.rs', 'src-rs/core/src/multiview/timing.rs',
                 'scripts/ci-multiview-unix-media.py',
                 'src-rs/server/src/main.rs', 'scripts/ci-native-favorites.py',
                 'scripts/ci-multiview-unix.py', 'scripts/ci-multiview-hls-probe-batch.py', 'scripts/ci-apt-mirror.py',
                 'tests/test_multiview_unix_ci.py')
        return {'commit': head, 'tree': tree, 'sha256': {p: budget.digest(root / p) for p in paths}}

    try:
        require(BROKER_TESTS, 'Frozen nonempty ordinary broker inventory required')
        before = snapshot('before')
        budget.json_evidence(driver.evidence / 'source-before.json', before)
        activation_home = activation_home_preflight(driver, budget)
        budget.json_evidence(driver.evidence / 'activation-home.json', activation_home)
        activation_home_before = activation_home_snapshot(Path(activation_home['parent']), budget)
        budget.json_evidence(driver.evidence / 'activation-home-before.json', activation_home_before)
        supplied, supplier = provision_tools(driver, budget, command)
        tools = {}
        for name, variable in (('ffmpeg', 'OTTPLAY_MULTIVIEW_FFMPEG'), ('ffprobe', 'OTTPLAY_MULTIVIEW_FFPROBE')):
            raw = supplied[name]
            require(raw and Path(raw).is_absolute(), name + ' absolute executable unavailable')
            tool = system_tool_identity(Path(raw), budget)
            path = Path(tool['path'])
            tools[name] = dict(tool, source=supplier)
            budget.json_evidence(driver.evidence / 'tools.json', tools)
            driver.env[variable] = str(path)
            command(name + '-version', [str(path), '-version'])
            protocols = command(name + '-protocols', [str(path), '-v', 'quiet', '-protocols'])
            require(has_input_fd(protocols), name + ' requires Input fd; no pathname fallback')
        ffmpeg = tools['ffmpeg']['path']
        encoders = command('ffmpeg-encoders', [ffmpeg, '-hide_banner', '-encoders'])
        filters = command('ffmpeg-filters', [ffmpeg, '-hide_banner', '-filters'])
        muxers = command('ffmpeg-muxers', [ffmpeg, '-hide_banner', '-muxers'])
        require({'libx264', 'aac'} <= table_names(encoders, r'[VAS.][A-Z.]{5}'), 'Required encoders unavailable')
        require(FILTERS <= filter_names(filters), 'Required fixture filters unavailable')
        require('hls' in table_names(muxers, r'[DE.]{1,2}'), 'Required HLS muxer unavailable')
        tools['mkfifo'] = system_tool_identity(MKFIFO, budget)
        budget.json_evidence(driver.evidence / 'tools.json', tools)
        smoke_mkfifo(driver, budget, command, tools['mkfifo'])
        command('rust-version', ['rustc', '-vV'])
        command('cargo-version', ['cargo', '-V'])
        openssl = shutil.which('openssl', path=driver.env.get('PATH'))
        require(openssl and Path(openssl).is_absolute(), 'Activation TLS fixture requires installed openssl')
        tools['openssl'] = dict(system_tool_identity(Path(openssl), budget),
                                source='Hosted runner PATH after official FFmpeg provisioning; no separate installation')
        openssl_version = command('openssl-version', [tools['openssl']['path'], 'version', '-a'])
        require(re.match(r'^(OpenSSL|LibreSSL) [0-9]+\.[0-9]+\.[0-9]+', openssl_version),
                'Expected installed OpenSSL or LibreSSL version identity')
        tools['openssl']['version'] = openssl_version.splitlines()[0]
        tools['openssl']['scope'] = 'Availability/identity only; actual activation tests verify certificate commands and trust'
        budget.json_evidence(driver.evidence / 'tools.json', tools)
        core_compiled = command('core-fixture-build', ['cargo', 'test', '--manifest-path', str(root / 'Cargo.toml'),
                               '--locked', '-p', 'ottplay-core', '--lib', '--no-run', '--message-format=json'], 900)
        core_executable = test_executable(core_compiled, output / 'target', root / 'src-rs/core/Cargo.toml',
                                          name='ottplay_core', kind='lib')
        core_sha256 = budget.digest(core_executable)
        compiled = command('fixture-build', ['cargo', 'test', '--manifest-path', str(root / 'Cargo.toml'),
                          '--locked', '-p', 'ottplay-server', '--test', 'multiview_fixtures',
                          '--test', 'multiview_activation', '--test', 'multiview_broker_boundary',
                          '--test', 'multiview_production',
                          '--no-run', '--message-format=json'], 900)
        executable = test_executable(compiled, output / 'target', root / 'src-rs/server/Cargo.toml')
        binary_before = budget.digest(executable)
        activation = test_executable(compiled, output / 'target', root / 'src-rs/server/Cargo.toml',
                                     name='multiview_activation')
        broker = test_executable(compiled, output / 'target', root / 'src-rs/server/Cargo.toml',
                                name='multiview_broker_boundary')
        normal_server = test_executable(compiled, output / 'target', root / 'src-rs/server/Cargo.toml',
                                        name='ottplay-server', kind='bin', test_profile=False)
        listener_compiled = command('listener-test-build', ['cargo', 'test', '--manifest-path', str(root / 'Cargo.toml'),
                                    '--locked', '-p', 'ottplay-server', '--bin', 'ottplay-server',
                                    '--no-run', '--message-format=json'], 900)
        listener = test_executable(listener_compiled, output / 'target', root / 'src-rs/server/Cargo.toml',
                                   name='ottplay-server', kind='bin')
        activation_sha256 = budget.digest(activation)
        broker_sha256 = budget.digest(broker)
        listener_sha256 = budget.digest(listener)
        # Cargo may hardlink its normal bin to debug/deps. Bind this already
        # target-validated executable with stable identity, not an evidence-file guard.
        normal_server_identity = system_tool_identity(normal_server, budget)
        server_sha256 = normal_server_identity['sha256']
        production = test_executable(compiled, output / 'target', root / 'src-rs/server/Cargo.toml',
                                     name='multiview_production')
        production_sha256 = budget.digest(production)
        budget.json_evidence(driver.evidence / 'fixture-binary.json', {
            'path': str(executable.relative_to(output)), 'sha256': binary_before,
            'core_path': str(core_executable.relative_to(output)), 'core_sha256': core_sha256,
            'activation_path': str(activation.relative_to(output)), 'activation_sha256': activation_sha256,
            'broker_path': str(broker.relative_to(output)), 'broker_sha256': broker_sha256,
            'listener_path': str(listener.relative_to(output)), 'listener_sha256': listener_sha256,
            'normal_server_path': str(normal_server.relative_to(output)), 'normal_server_sha256': server_sha256,
            'production_test_path': str(production.relative_to(output)),
            'production_test_sha256': production_sha256,
            'normal_server_identity': normal_server_identity,
            'source_commit': before['commit'], 'root_lock_sha256': before['sha256']['Cargo.lock']})
        playlist_all = listed_names(command('core-playlist-inventory',
            [str(core_executable), PLAYLIST_DROP_PREFIX, '--list', '--format', 'terse']))
        playlist_ignored = listed_names(command('core-playlist-ignored-inventory',
            [str(core_executable), PLAYLIST_DROP_PREFIX, '--list', '--ignored', '--format', 'terse']))
        require(playlist_all and all(name.startswith(PLAYLIST_DROP_PREFIX) for name in playlist_all),
                'Core playlist test inventory is empty or outside its namespace')
        require(not playlist_ignored and PLAYLIST_DROP_REQUIRED_TESTS <= playlist_all,
                'Required Unix playlist regressions are missing or playlist tests are ignored')
        playlist_text = command('core-playlist-ordinary', [str(core_executable), PLAYLIST_DROP_PREFIX,
                                '--test-threads=1', '--color=never'], 60)
        require_suite_pass(playlist_text, playlist_all, set())
        core_all = listed_names(command('core-multiview-inventory',
            [str(core_executable), 'multiview::', '--list', '--format', 'terse']))
        core_ignored = listed_names(command('core-multiview-ignored-inventory',
            [str(core_executable), 'multiview::', '--list', '--ignored', '--format', 'terse']))
        require(core_all and all(name.startswith('multiview::') for name in core_all),
                'Core multiview test inventory differs')
        require(core_ignored == CORE_IGNORED_TESTS and core_ignored <= core_all,
                'Core multiview ignored test inventory differs from the one reviewed media test')
        ordinary_core = core_all - core_ignored
        require(all(name.startswith('multiview::') and name in ordinary_core for name in
                    (*CORE_REQUIRED_TESTS, *CORE_REQUIRED_CLOCK_RETIREMENT_TESTS, *CORE_REQUIRED_HLS_TESTS, *CORE_REQUIRED_PRIVATE_HTTP_TESTS, *CORE_REQUIRED_REMAINING_BUDGET_TESTS, *args.required_core_test)),
                'Required ordinary core regression is absent or ignored')
        core_text = command('core-multiview-ordinary', [str(core_executable), 'multiview::',
                            '--test-threads=1', '--color=never'], 300)
        require_suite_pass(core_text, ordinary_core, core_ignored)
        core_ignored_executed = []
        production_inputs = None
        for ignored_name in sorted(CORE_IGNORED_TESTS):
            if ignored_name == CORE_ROTATION_TEST:
                production_parent = output / 'production'
                production_parent.mkdir(mode=0o700)
                production_inputs = prepare_production_inputs(
                    driver, budget, command, tools, production_parent / 'inputs')
                run_core_rotation_fixture(driver, command, core_executable, tools,
                                          production_inputs, output)
            else:
                text = command('core-ignored-' + hashlib.sha256(ignored_name.encode()).hexdigest()[:12],
                    [str(core_executable), ignored_name, '--ignored', '--exact',
                     '--test-threads=1', '--color=never'], 600)
                require_one_pass(text, ignored_name)
            core_ignored_executed.append(ignored_name)
        ignored = command('ignored-fixtures', [str(executable), '--list', '--ignored', '--format', 'terse'])
        ignored_names = listed_names(ignored)
        require(ignored_names == {name for name, _ in TESTS}, 'Exact ignored fixture inventory changed')
        server_all = listed_names(command('server-fixture-inventory',
                                  [str(executable), '--list', '--format', 'terse']))
        require(ignored_names <= server_all, 'Server fixture inventory differs')
        ordinary_server = server_all - ignored_names
        require(all(name in ordinary_server for name in args.required_server_test),
                'Required ordinary server regression is absent or ignored')
        server_text = command('server-fixtures-ordinary', [str(executable), '--test-threads=1',
                              '--color=never'], 180)
        require_suite_pass(server_text, ordinary_server, ignored_names)
        activation_all = listed_names(command('activation-inventory',
            [str(activation), '--list', '--format', 'terse']))
        activation_ignored = listed_names(command('activation-ignored-inventory',
            [str(activation), '--list', '--ignored', '--format', 'terse']))
        require(activation_all == ACTIVATION_TESTS and not activation_ignored,
                'Exact ordinary activation inventory differs or contains ignored tests')
        activation_text = command('activation-ordinary',
            [str(activation), '--test-threads=1', '--color=never'], 180)
        require_suite_pass(activation_text, ACTIVATION_TESTS, set())
        broker_all = listed_names(command('broker-inventory',
            [str(broker), '--list', '--format', 'terse']))
        broker_ignored = listed_names(command('broker-ignored-inventory',
            [str(broker), '--list', '--ignored', '--format', 'terse']))
        require(broker_all == BROKER_TESTS and not broker_ignored,
                'Exact ordinary broker inventory differs or contains ignored tests')
        broker_text = command('broker-ordinary',
            [str(broker), '--test-threads=1', '--color=never'], 180)
        require_suite_pass(broker_text, BROKER_TESTS, set())
        listener_all = listed_names(command('listener-inventory',
            [str(listener), LISTENER_TEST_PREFIX, '--list', '--format', 'terse']))
        listener_ignored = listed_names(command('listener-ignored-inventory',
            [str(listener), LISTENER_TEST_PREFIX, '--list', '--ignored', '--format', 'terse']))
        require(LISTENER_REQUIRED_TESTS <= listener_all and not listener_ignored
                and all(name.startswith(LISTENER_TEST_PREFIX) for name in listener_all),
                'Ordinary listener namespace inventory differs or contains ignored tests')
        listener_text = command('listener-ordinary',
            [str(listener), LISTENER_TEST_PREFIX, '--test-threads=1', '--color=never'], 180)
        require_suite_pass(listener_text, listener_all, set())
        policy_all = listed_names(command('hls-item-policy-inventory',
            [str(listener), HLS_ITEM_ADAPTER_TEST, '--list', '--format', 'terse']))
        policy_ignored = listed_names(command('hls-item-policy-ignored',
            [str(listener), HLS_ITEM_ADAPTER_TEST, '--list', '--ignored', '--format', 'terse']))
        require(policy_all == {HLS_ITEM_ADAPTER_TEST} and not policy_ignored,
                'Exact ordinary HLS item-adapter policy regression is missing or ignored')
        policy_text = command('hls-item-policy', [str(listener), HLS_ITEM_ADAPTER_TEST,
                              '--exact', '--test-threads=1', '--color=never'], 30)
        require_one_pass(policy_text, HLS_ITEM_ADAPTER_TEST)
        for index, policy_name in enumerate(PUBLIC_HTTP_POLICY_TESTS):
            label = f'public-http-policy-{index}'
            present = listed_names(command(label + '-inventory',
                [str(listener), policy_name, '--list', '--format', 'terse']))
            ignored_policy = listed_names(command(label + '-ignored',
                [str(listener), policy_name, '--list', '--ignored', '--format', 'terse']))
            require(present == {policy_name} and not ignored_policy,
                    'Exact public HTTP policy regression is missing or ignored')
            require_one_pass(command(label, [str(listener), policy_name, '--exact',
                             '--test-threads=1', '--color=never'], 30), policy_name)
        for index, policy_name in enumerate(PRIVATE_HTTP_POLICY_TESTS):
            label = f'private-http-policy-{index}'
            present = listed_names(command(label + '-inventory',
                [str(listener), policy_name, '--list', '--format', 'terse']))
            ignored_policy = listed_names(command(label + '-ignored',
                [str(listener), policy_name, '--list', '--ignored', '--format', 'terse']))
            require(present == {policy_name} and not ignored_policy,
                    'Exact private HTTP policy regression is missing or ignored')
            require_one_pass(command(label, [str(listener), policy_name, '--exact',
                             '--test-threads=1', '--color=never'], 30), policy_name)
        for index, (name, limit) in enumerate(TESTS):
            if name == PENDING_TEST:
                run_pending_fixture(driver, budget, command, executable, tools, result)
            elif name == STREAM_TEST:
                run_streamed_fixture(driver, budget, command, executable, tools, result)
            else:
                text = command('fixture-' + str(index + 1), [str(executable), name, '--ignored', '--exact',
                               '--test-threads=1', '--color=never'], limit)
                require_one_pass(text, name)
            budget.tick()
            for count, entry in enumerate((output / 'tmp').iterdir(), 1):
                budget.tick()
                require(count <= 10000, 'Temporary-entry bound exceeded')
                require(not entry.name.startswith('ottplay-multiview-fixture-'),
                        'Fixture scratch cleanup incomplete')
        run_production_fixture(driver, budget, command, production, tools, result, output,
                               prepared_inputs=production_inputs)
        require(budget.digest(production) == production_sha256,
                'Production adapter test executable changed')
        require(activation_home_preflight(driver, budget) == activation_home,
                'Activation fixture HOME ancestor identity changed')
        activation_home_after = activation_home_snapshot(Path(activation_home['parent']), budget)
        budget.json_evidence(driver.evidence / 'activation-home-after.json', activation_home_after)
        require(activation_home_before == activation_home_after, 'Activation fixture HOME cleanup incomplete or identity changed')
        activation_home_checked = True
        require(budget.digest(activation) == activation_sha256, 'Activation test executable changed')
        require(budget.digest(broker) == broker_sha256, 'Broker test executable changed')
        require(budget.digest(listener) == listener_sha256, 'Listener test executable changed')
        require(budget.digest(production) == production_sha256, 'Production adapter test executable changed')
        require(system_tool_identity(normal_server, budget) == normal_server_identity,
                'Normal server executable changed')
        require(budget.digest(executable) == binary_before, 'Fixture executable changed')
        require(budget.digest(core_executable) == core_sha256, 'Core test executable changed')
        for item in tools.values():
            observed = system_tool_identity(Path(item['requested_path']), budget)
            require(all(item[key] == value for key, value in observed.items()), 'Tool executable identity changed')
        after = snapshot('after')
        budget.json_evidence(driver.evidence / 'source-after.json', after)
        require(before == after, 'Source or root lock changed')
        require(all(c.get('cleanup_confirmed') for c in driver.commands), 'Owned process cleanup unknown')
        receipts = {str(Path(p).relative_to(driver.evidence)): budget.digest(Path(p), guard.EVIDENCE_CAP)
                    for p in budget.evidence_files}
        budget.json_evidence(driver.evidence / 'file-sha256.json', receipts)
        result.update(source=before, fixture_binary_sha256=binary_before,
                      core_binary_sha256=core_sha256, activation_binary_sha256=activation_sha256,
                      broker_binary_sha256=broker_sha256, ordinary_broker_tests=sorted(BROKER_TESTS),
                      listener_binary_sha256=listener_sha256, ordinary_listener_tests=sorted(listener_all),
                      normal_server_binary_sha256=server_sha256, ordinary_activation_tests=sorted(ACTIVATION_TESTS),
                      activation_scope='Actual owned HTTP/TLS normal server; zero-capacity control shell only',
                      activation_fixture_parent=activation_home, activation_fixture_cleanup_confirmed=True,
                      ordinary_core_tests=sorted(ordinary_core),
                      ordinary_playlist_drop_tests=sorted(playlist_all),
                      executed_core_ignored_tests=core_ignored_executed,
                      ordinary_server_tests=sorted(ordinary_server),
                      production_test_binary_sha256=production_sha256,
                      tests=[name for name, _ in TESTS] + [PRODUCTION_TEST, HLS_PRODUCTION_TEST], owned_process_cleanup_confirmed=True)
        result['sustained_media_e2e'] = True
        result['generated_media_hashes_available'] = True
        success = True
    except BaseException as error:
        work_error = error
        result['error'] = str(error)
        result['error_type'] = type(error).__name__
    finally:
        if activation_home_before is not None and not activation_home_checked:
            try:
                activation_home_after = activation_home_snapshot(Path(activation_home['parent']), budget, cleanup=True)
                budget.json_evidence(driver.evidence / 'activation-home-after.json', activation_home_after, cleanup=True)
                require(activation_home_before == activation_home_after,
                        'Activation fixture HOME cleanup incomplete or identity changed')
                result['activation_fixture_cleanup_confirmed'] = True
            except BaseException as error:  # noqa: BLE001 - cleanup uncertainty must remain a failed receipt
                result['activation_fixture_cleanup_confirmed'] = False
                result['activation_fixture_cleanup_error'] = str(error)
                success = False
        result['elapsed_seconds'] = budget.clock() - budget.started
        result['commands'] = driver.commands
        result['hls_scope'] = 'Production normal-server HTTP MPEG-TS source decoded into private HLS; one generated output segment was probed for audio/video. No native-client, desktop compositor, physical-device, or visual-presentation qualification.'
    try:
        accepted = driver.terminal(result, success)
    except BaseException as finalization_error:
        if work_error is not None:
            raise work_error from finalization_error
        raise
    require(accepted, 'Unix fixture qualification failed; inspect terminal.json')


if __name__ == '__main__':
    main()
