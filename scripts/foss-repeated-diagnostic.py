"""Temporary, bounded native-crash diagnosis; no product or test changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time

CORE_BYTES = 512 * 1024 * 1024
CORE_COUNT = 2
ITERATIONS = 4
OWNER = Path('.compatibility/core-owner.json')
PATTERN = Path('/proc/sys/kernel/core_pattern')
AUDIO_KEYS = ('PULSE_SERVER', 'PULSE_CLIENTCONFIG', 'PULSE_SINK', 'XDG_RUNTIME_DIR')
SECRET_KEYS = ('GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def package_snapshot():
    result = subprocess.run(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'],
                            text=True, capture_output=True, check=True, timeout=30)
    return {row[0]: row[1] for line in result.stdout.splitlines()
            if len(row := line.split('\t')) == 3 and row[2] == 'installed'}


def relevant(packages):
    return {key: value for key, value in packages.items()
            if re.search(r'gstreamer|pulse|pipewire|alsa|libasound|jack|openal|libc6|libstdc|libgcc|libwebkit|libavcodec|libavformat', key)}


def restore_pattern():
    if not OWNER.exists():
        return
    owner = json.loads(OWNER.read_text())
    assert owner['uid'] == os.getuid()
    current = PATTERN.read_text().rstrip('\n')
    assert current in (owner['pattern'], owner['original']), 'Unexpected external core_pattern change'
    if current == owner['pattern']:
        subprocess.run(['sudo', '-n', 'sysctl', '-w', 'kernel.core_pattern=' + owner['original']],
                       check=True, timeout=15, capture_output=True, text=True)
    assert PATTERN.read_text().rstrip('\n') == owner['original']
    owner['restored'] = True
    save(OWNER, owner)


def install_pattern(directory):
    assert os.getuid() != 0 and not OWNER.exists()
    assert directory.stat().st_uid == os.getuid() and directory.stat().st_mode & 0o077 == 0
    original = PATTERN.read_text().rstrip('\n')
    pattern = str(directory / 'core.%P.%t.%e')
    save(OWNER, {'uid': os.getuid(), 'directory': str(directory), 'original': original,
                 'pattern': pattern, 'restored': False})
    subprocess.run(['sudo', '-n', 'sysctl', '-w', 'kernel.core_pattern=' + pattern],
                   check=True, timeout=15, capture_output=True, text=True)
    assert PATTERN.read_text().rstrip('\n') == pattern


def child_limits():
    resource.setrlimit(resource.RLIMIT_CORE, (CORE_BYTES, CORE_BYTES))


def stop_owned(child):
    if child is None or child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=20)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)


def observe_processes(processes):
    # Only public executable/library paths, never argv, environment, memory or credentials.
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit() or entry.name in processes:
            continue
        try:
            executable = (entry / 'exe').resolve(strict=True)
            if '/.cache/ms-playwright/webkit-' not in str(executable):
                continue
            assert entry.stat().st_uid == os.getuid()
            libraries = set()
            for line in (entry / 'maps').read_text().splitlines():
                fields = line.split(None, 5)
                if len(fields) == 6 and fields[5].startswith('/') and not fields[5].endswith(' (deleted)'):
                    libraries.add(fields[5])
            processes[entry.name] = {'executable': str(executable), 'libraries': sorted(libraries)}
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue


def observe_cores(directory, kept, discarded, iteration):
    for item in sorted(directory.iterdir()):
        assert item.is_file() and not item.is_symlink() and item.stat().st_uid == os.getuid()
        assert re.fullmatch(r'core\.[0-9]+\.[0-9]+\.[^/]+', item.name)
        if item.name in kept:
            assert item.stat().st_size <= CORE_BYTES, 'RLIMIT_CORE exceeded'
            continue
        if len(kept) < CORE_COUNT:
            kept[item.name] = {'iteration': iteration, 'pid': item.name.split('.')[1]}
        else:
            discarded['count'] += 1
            if len(discarded['examples']) < 20:
                discarded['examples'].append({'name': item.name, 'size_at_removal': item.stat().st_size})
            # Our private directory, bounded retained cores. No foreign paths or raw core uploads.
            item.unlink()


def parse_result(folder, runtime, code):
    report_path = folder / 'playwright.json'
    result_path = folder / 'result.json'
    if not report_path.exists():
        return {'passed': False, 'reason': 'no Playwright report', 'exit_code': code}
    report = json.loads(report_path.read_text())
    cases = []
    def collect(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec.get('tests', []):
                    cases.append({'title': spec['title'], 'status': test['status'],
                                  'expectedStatus': test['expectedStatus'], 'results':
                                  [{'status': r['status'], 'retry': r['retry']} for r in test['results']]})
            collect(suite.get('suites', []))
    collect(report.get('suites', []))
    passed = (code == 0 and len(cases) == 5 and len({c['title'] for c in cases}) == 5
              and not report.get('errors') and result_path.exists()
              and all(c['status'] == 'expected' and c['expectedStatus'] == 'passed'
                      and c['results'] == [{'status': 'passed', 'retry': 0}] for c in cases))
    if passed:
        result = json.loads(result_path.read_text())
        passed = (result['testsPassed'] == 5 and result['testsFailed'] == 0
                  and set(result['scenarios']) == {c['title'] for c in cases}
                  and all(result[key] == runtime[key] for key in
                          ('sourceSha', 'workflowSha', 'runId', 'runAttempt', 'iteration', 'audioMode')))
    return {'passed': passed, 'exit_code': code, 'cases': cases, 'stats': report.get('stats')}


def run_iteration(index, mode, output, original, cores, kept, discarded, processes):
    folder = output / 'iterations' / str(index) / 'results'
    folder.mkdir(parents=True)
    runtime = dict(original, iteration=index)
    save(folder / 'runtime.json', runtime)
    shutil.copyfile(output / 'results/candidate.json', folder / 'candidate.json')
    env = dict(os.environ, CI_BROWSER_DIAGNOSTICS=str(folder.resolve()),
               CI_BROWSER_EVIDENCE=str((folder / 'result.json').resolve()))
    for key in SECRET_KEYS:
        env.pop(key, None)
    command = ['node', 'scripts/browser-acceptance.cjs']
    if mode != 'original':
        command = [sys.executable, 'scripts/foss-audio-diagnostic.py', mode, '--', *command]
    else:
        assert {key: env.get(key) for key in AUDIO_KEYS} == {key: os.environ.get(key) for key in AUDIO_KEYS}
    child = None
    receipt = {'iteration': index, 'audioMode': mode, 'passed': False, 'command': command}
    try:
        with (folder.parent / 'run.log').open('w') as log:
            child = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT,
                                     start_new_session=True, preexec_fn=child_limits)
            deadline = time.monotonic() + 10 * 60
            while child.poll() is None:
                observe_processes(processes)
                observe_cores(cores, kept, discarded, index)
                assert time.monotonic() < deadline, 'Outer diagnostic deadline exceeded'
                time.sleep(0.5)
            receipt.update(parse_result(folder, runtime, child.returncode))
            if mode != 'original':
                audio = json.loads((folder.parent / 'audio/receipt.json').read_text())
                receipt['audio_receipt_sha256'] = sha(folder.parent / 'audio/receipt.json')
                receipt['passed'] = receipt['passed'] and audio['status'] == 'passed'
    except Exception as error:
        receipt['error'] = f'{type(error).__name__}: {error}'
    finally:
        try:
            stop_owned(child)
            observe_cores(cores, kept, discarded, index)
        except Exception as error:
            receipt['passed'] = False
            receipt['cleanup_error'] = f'{type(error).__name__}: {error}'
        save(folder.parent / 'iteration.json', receipt)
    return receipt


def gdb_limits():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))


def analyze_cores(directory, kept, processes, output):
    entries = []
    if not kept:
        return {'cores': [], 'status': 'no native core captured; no stack claim'}
    before = package_snapshot()
    if shutil.which('gdb') is None:
        result = subprocess.run(['sudo', '-n', 'apt-get', 'install', '-y', '--no-install-recommends',
                                 '--no-upgrade', 'gdb'], text=True, capture_output=True, timeout=180)
        (output / 'gdb-install.log').write_text(result.stdout + result.stderr)
        result.check_returncode()
    after = package_snapshot()
    changes = {key: [value, after.get(key)] for key, value in before.items() if after.get(key) != value}
    save(output / 'postmortem-package-audit.json', {'before': before, 'after': after, 'existing_changes': changes})
    assert not changes, 'Postmortem tools changed existing runtime packages'
    for name, metadata in kept.items():
        core = directory / name
        entry = dict(metadata, name=name, size=core.stat().st_size, sha256=sha(core),
                     may_be_truncated=core.stat().st_size >= CORE_BYTES)
        entries.append(entry)
        process = processes.get(metadata['pid'])
        if not process:
            entry['status'] = 'process identity unavailable; core hash retained, no stack claim'
            continue
        executable = Path(process['executable'])
        identities = []
        for path in process['libraries']:
            file = Path(path)
            if file.is_file():
                identities.append({'path': path, 'size': file.stat().st_size, 'sha256': sha(file)})
        entry['executable'] = str(executable)
        entry['executable_sha256'] = sha(executable)
        entry['mapped_file_identities'] = identities
        log_path = output / (name + '.backtrace.txt')
        command = ['gdb', '-nx', '-nh', '-batch', '-iex', 'set auto-load off', '-iex',
                   'set debuginfod enabled off', '-ex', 'set pagination off', '-ex',
                   'set print frame-arguments none', '-ex', 'thread apply all bt 40',
                   '-ex', 'info sharedlibrary', str(executable), str(core)]
        try:
            with log_path.open('w') as log:
                result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT,
                                        timeout=60, preexec_fn=gdb_limits)
            entry.update(status='postmortem command completed', gdb_exit_code=result.returncode,
                         backtrace_sha256=sha(log_path))
        except subprocess.TimeoutExpired:
            entry['status'] = 'postmortem timed out; partial bounded log retained'
    return {'status': 'postmortem attempted; inspect stacks before causal conclusions', 'cores': entries}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', nargs='?', choices=['original', 'absent', 'null-sink'])
    parser.add_argument('--restore-only', action='store_true')
    args = parser.parse_args()
    if args.restore_only:
        restore_pattern()
        return 0
    assert args.mode and sys.platform == 'linux' and os.getuid() != 0
    output = Path('.compatibility').resolve()
    original = json.loads((output / 'results/runtime.json').read_text())
    assert original['audioMode'] == args.mode
    packages = package_snapshot()
    save(output / 'runtime-packages.json', {'all': packages, 'relevant': relevant(packages),
         'ImageOS': os.environ.get('ImageOS'), 'ImageVersion': os.environ.get('ImageVersion'),
         'audio_environment': {key: os.environ.get(key) for key in AUDIO_KEYS}})
    summary = {'diagnosticOnly': True, 'mode': args.mode, 'iterations_requested': ITERATIONS,
               'driver_sha256': sha(__file__), 'audio_driver_sha256': sha('scripts/foss-audio-diagnostic.py'),
               'core_limit_per_file': CORE_BYTES, 'maximum_retained_cores': CORE_COUNT,
               'raw_cores_uploaded': False, 'passed': False, 'iterations': []}
    kept, discarded, processes = {}, {'count': 0, 'examples': []}, {}
    try:
        with tempfile.TemporaryDirectory(prefix='foss-cores-') as temp:
            directory = Path(temp)
            try:
                install_pattern(directory)
                for index in range(1, ITERATIONS + 1):
                    receipt = run_iteration(index, args.mode, output, original, directory, kept, discarded, processes)
                    summary['iterations'].append(receipt)
                    save(output / 'repeated-summary.json', summary)
                    print(f"iteration={index} passed={receipt['passed']}", flush=True)
            finally:
                restore_pattern()
                summary['core_pattern_restored'] = json.loads(OWNER.read_text())['restored']
            # Postmortem installation is deliberately AFTER all four unchanged browser runs.
            try:
                summary['native'] = analyze_cores(directory, kept, processes, output)
            except Exception as error:
                summary['native_error'] = f'{type(error).__name__}: {error}'
            summary['discarded_cores'] = discarded
    finally:
        summary['passed'] = (len(summary['iterations']) == ITERATIONS
                             and all(item['passed'] for item in summary['iterations'])
                             and summary.get('core_pattern_restored') is True
                             and 'native_error' not in summary)
        save(output / 'repeated-summary.json', summary)
    return 0 if summary['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
