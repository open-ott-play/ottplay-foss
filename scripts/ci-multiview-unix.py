"""Explicit Unix fixture CI; never a production or sustained-playback oracle."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import sys
import time

sys.dont_write_bytecode = True
GUARD_SHA256 = '6f623bb7234b3619ff859dec0afe9c1ad938f29d606f0836b69434312867e020'
STREAM_MEDIA_SHA256 = '97703a705a2c33a1536893eeca2d11e65022d44fa1189ff59f300e2040cdf4e9'
STREAM_TEST = 'streamed_session_two_owner_continuity'
MKFIFO = Path('/usr/bin/mkfifo')
TESTS = (
    ('real_four_nine_and_perimeter_frames_and_selected_audio', 600),
    ('owned_worker_cancellation_deadlines_busy_and_cleanup', 60),
    ('fixture_http_source_cas_dedupe_media_custody_and_retirement', 120),
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
})
CORE_REQUIRED_TESTS = frozenset({
    'multiview::broker::registry::try_authority_tests::try_session_authority_returns_busy_without_callback_then_recovers',
    'multiview::broker::registry::try_authority_tests::try_session_authority_maps_poison_to_unavailable_without_callback',
    'multiview::broker::registry::try_authority_tests::try_session_authority_preserves_authorization_and_output_block',
})
LISTENER_TEST_PREFIX = 'listener_tests::'
LISTENER_REQUIRED_TESTS = frozenset({
    'listener_tests::selected_media_dispatch_preserves_public_request_context_and_response',
    'listener_tests::media_transport_failure_response_is_fixed_and_private',
})
FILTERS = {'testsrc2', 'drawbox', 'sine', 'scale', 'format', 'crop', 'pad',
           'setsar', 'setpts', 'fps', 'xstack', 'overlay'}


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
        destination = driver.evidence / name
        require(not destination.exists() and not destination.is_symlink(), 'Stream evidence output already exists')
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        budget.atomic(destination, raw, evidence=True, cleanup=forensic)
        adopted.append({'relative_name': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    return adopted


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
        require(not case.exists() and not case.is_symlink(), 'Fresh streamed case required')
        driver.env.update(OTTPLAY_MULTIVIEW_STREAM_INPUTS=seal['path'], OTTPLAY_MULTIVIEW_STREAM_CASE_DIR=str(case))
        text = command('fixture-4', [str(executable), STREAM_TEST, '--ignored', '--exact',
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
        budget.tick()
    except BaseException as error:
        primary = error
        raise
    finally:
        try:
            if primary is not None and media is not None:
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
                    result['streamed_forensic_evidence'] = adopt_stream_evidence(driver, budget, specs, roots, forensic=True)
                    require(sum(row['bytes'] for row in result['streamed_forensic_evidence']) == report['evidence_bytes'],
                            'Stream forensic byte inventory differs')
                    result['streamed_forensic'] = {key: value for key, value in report.items() if key != 'evidence'}
                    budget.json_evidence(driver.evidence / 'streamed-forensic.json', result['streamed_forensic'], cleanup=True)
                except BaseException as forensic_error:
                    result['streamed_forensic_error'] = str(forensic_error)
        finally:
            # Every Driver.run has already executed its unconditional process
            # cleanup before it returns/raises. Forensics never owns that duty.
            for key, value in old_env.items():
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
    result = {'status': 'fail', 'qualification': 'four isolated Unix fixtures, mandatory stream analyzer, broker boundary and zero-capacity activation',
              'sustained_media_e2e': False, 'production_admission': False,
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
                 'src-rs/core/src/multiview/broker/registry.rs',
                 'src-rs/server/tests/multiview_fixtures.rs', 'src-rs/server/tests/multiview_activation.rs',
                 'src-rs/server/tests/multiview_broker_boundary.rs',
                 'src-rs/server/src/multiview_broker.rs', 'src-rs/server/src/multiview_broker_live.rs',
                 'src-rs/server/src/multiview_broker_live_output_tests.rs', 'src-rs/server/src/media_connection.rs',
                 'src-rs/server/tests/support/streamed_session.rs', 'src-rs/server/tests/support/streamed_transport.rs',
                 'src-rs/server/tests/support/streamed_archive.rs', 'scripts/ci-multiview-unix-media.py',
                 'src-rs/server/src/main.rs', 'scripts/ci-native-favorites.py',
                 'scripts/ci-multiview-unix.py', 'scripts/ci-apt-mirror.py')
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
        budget.json_evidence(driver.evidence / 'fixture-binary.json', {
            'path': str(executable.relative_to(output)), 'sha256': binary_before,
            'core_path': str(core_executable.relative_to(output)), 'core_sha256': core_sha256,
            'activation_path': str(activation.relative_to(output)), 'activation_sha256': activation_sha256,
            'broker_path': str(broker.relative_to(output)), 'broker_sha256': broker_sha256,
            'listener_path': str(listener.relative_to(output)), 'listener_sha256': listener_sha256,
            'normal_server_path': str(normal_server.relative_to(output)), 'normal_server_sha256': server_sha256,
            'normal_server_identity': normal_server_identity,
            'source_commit': before['commit'], 'root_lock_sha256': before['sha256']['Cargo.lock']})
        core_all = listed_names(command('core-multiview-inventory',
            [str(core_executable), 'multiview::', '--list', '--format', 'terse']))
        core_ignored = listed_names(command('core-multiview-ignored-inventory',
            [str(core_executable), 'multiview::', '--list', '--ignored', '--format', 'terse']))
        require(core_all and all(name.startswith('multiview::') for name in core_all)
                and core_ignored <= core_all, 'Core multiview test inventory differs')
        ordinary_core = core_all - core_ignored
        require(all(name.startswith('multiview::') and name in ordinary_core for name in (*CORE_REQUIRED_TESTS, *args.required_core_test)),
                'Required ordinary core regression is absent or ignored')
        core_text = command('core-multiview-ordinary', [str(core_executable), 'multiview::',
                            '--test-threads=1', '--color=never'], 300)
        require_suite_pass(core_text, ordinary_core, core_ignored)
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
        for index, (name, limit) in enumerate(TESTS):
            if name == STREAM_TEST:
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
        require(activation_home_preflight(driver, budget) == activation_home,
                'Activation fixture HOME ancestor identity changed')
        activation_home_after = activation_home_snapshot(Path(activation_home['parent']), budget)
        budget.json_evidence(driver.evidence / 'activation-home-after.json', activation_home_after)
        require(activation_home_before == activation_home_after, 'Activation fixture HOME cleanup incomplete or identity changed')
        activation_home_checked = True
        require(budget.digest(activation) == activation_sha256, 'Activation test executable changed')
        require(budget.digest(broker) == broker_sha256, 'Broker test executable changed')
        require(budget.digest(listener) == listener_sha256, 'Listener test executable changed')
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
                      ordinary_server_tests=sorted(ordinary_server),
                      tests=[name for name, _ in TESTS], owned_process_cleanup_confirmed=True)
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
        result['hls_scope'] = 'Actual HLS playlist/custody/revocation; no TS GET/decode or sustained pixel/audio claim'
    try:
        accepted = driver.terminal(result, success)
    except BaseException as finalization_error:
        if work_error is not None:
            raise work_error from finalization_error
        raise
    require(accepted, 'Unix fixture qualification failed; inspect terminal.json')


if __name__ == '__main__':
    main()
