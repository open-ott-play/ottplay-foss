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
MKFIFO = Path('/usr/bin/mkfifo')
TESTS = (
    ('real_four_nine_and_perimeter_frames_and_selected_audio', 600),
    ('owned_worker_cancellation_deadlines_busy_and_cleanup', 60),
    ('fixture_http_source_cas_dedupe_media_custody_and_retirement', 120),
)
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
    """Hash a public OS executable, allowing stable package-manager hardlinks.

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


def test_executable(text, target, manifest, *, name='multiview_fixtures', kind='test'):
    matches = []
    for line in text.splitlines():
        if not line.startswith('{'):
            continue  # Cargo diagnostics share this bounded log with JSON.
        value = json.loads(line)
        item = value.get('target', {})
        if (value.get('reason') == 'compiler-artifact' and item.get('name') == name
                and kind in item.get('kind', []) and value.get('executable')):
            require(value.get('manifest_path') == str(manifest), 'Fixture manifest differs')
            require(value.get('profile', {}).get('test') is True, 'Expected actual test executable profile')
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
    result = {'status': 'fail', 'qualification': 'three existing isolated Unix fixtures',
              'sustained_media_e2e': False, 'production_admission': False,
              'generated_media_hashes_available': False, 'new_dependencies': False}
    success = False

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
                 'src-rs/server/tests/multiview_fixtures.rs', 'scripts/ci-native-favorites.py',
                 'scripts/ci-multiview-unix.py', 'scripts/ci-apt-mirror.py')
        return {'commit': head, 'tree': tree, 'sha256': {p: budget.digest(root / p) for p in paths}}

    try:
        before = snapshot('before')
        budget.json_evidence(driver.evidence / 'source-before.json', before)
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
        core_compiled = command('core-fixture-build', ['cargo', 'test', '--manifest-path', str(root / 'Cargo.toml'),
                               '--locked', '-p', 'ottplay-core', '--lib', '--no-run', '--message-format=json'], 900)
        core_executable = test_executable(core_compiled, output / 'target', root / 'src-rs/core/Cargo.toml',
                                          name='ottplay_core', kind='lib')
        core_sha256 = budget.digest(core_executable)
        compiled = command('fixture-build', ['cargo', 'test', '--manifest-path', str(root / 'Cargo.toml'),
                          '--locked', '-p', 'ottplay-server', '--test', 'multiview_fixtures',
                          '--no-run', '--message-format=json'], 900)
        executable = test_executable(compiled, output / 'target', root / 'src-rs/server/Cargo.toml')
        binary_before = budget.digest(executable)
        budget.json_evidence(driver.evidence / 'fixture-binary.json', {
            'path': str(executable.relative_to(output)), 'sha256': binary_before,
            'core_path': str(core_executable.relative_to(output)), 'core_sha256': core_sha256,
            'source_commit': before['commit'], 'root_lock_sha256': before['sha256']['Cargo.lock']})
        core_all = listed_names(command('core-multiview-inventory',
            [str(core_executable), 'multiview::', '--list', '--format', 'terse']))
        core_ignored = listed_names(command('core-multiview-ignored-inventory',
            [str(core_executable), 'multiview::', '--list', '--ignored', '--format', 'terse']))
        require(core_all and all(name.startswith('multiview::') for name in core_all)
                and core_ignored <= core_all, 'Core multiview test inventory differs')
        ordinary_core = core_all - core_ignored
        require(all(name.startswith('multiview::') and name in ordinary_core for name in args.required_core_test),
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
        for index, (name, limit) in enumerate(TESTS):
            text = command('fixture-' + str(index + 1), [str(executable), name, '--ignored', '--exact',
                           '--test-threads=1', '--color=never'], limit)
            require_one_pass(text, name)
            budget.tick()
            for count, entry in enumerate((output / 'tmp').iterdir(), 1):
                budget.tick()
                require(count <= 10000, 'Temporary-entry bound exceeded')
                require(not entry.name.startswith('ottplay-multiview-fixture-'),
                        'Fixture scratch cleanup incomplete')
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
                      core_binary_sha256=core_sha256, ordinary_core_tests=sorted(ordinary_core),
                      ordinary_server_tests=sorted(ordinary_server),
                      tests=[name for name, _ in TESTS], owned_process_cleanup_confirmed=True)
        success = True
    except BaseException as error:
        result['error'] = str(error)
        result['error_type'] = type(error).__name__
    finally:
        result['elapsed_seconds'] = budget.clock() - budget.started
        result['commands'] = driver.commands
        result['hls_scope'] = 'Actual HLS playlist/custody/revocation; no TS GET/decode or sustained pixel/audio claim'
    require(driver.terminal(result, success), 'Unix fixture qualification failed; inspect terminal.json')


if __name__ == '__main__':
    main()
