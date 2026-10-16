"""Diagnostic-only comparison of official Playwright Linux runtime generations."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

ITERATIONS = 4


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def packages():
    text = subprocess.check_output(
        ['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'],
        text=True, timeout=30)
    return {row[0]: row[1] for line in text.splitlines()
            if len(row := line.split('\t')) == 3 and row[2] == 'installed'}


def group_members(group):
    members = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / 'stat').read_text()
            fields = stat[stat.rfind(')') + 2:].split()
            if int(fields[2]) == group and fields[0] != 'Z':
                assert entry.stat().st_uid == os.getuid()
                members.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError):
            continue
    return members


def stop_owned(child):
    for sig, delay in [(signal.SIGTERM, 10), (signal.SIGKILL, 5)]:
        if group_members(child.pid):
            try:
                os.killpg(child.pid, sig)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + delay
        while group_members(child.pid) and time.monotonic() < deadline:
            time.sleep(0.1)
    assert not group_members(child.pid), 'Owned process group survived cleanup'
    child.wait(timeout=5)


def observe(processes):
    # Public file paths only: never read process environments or command arguments.
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            executable = str((entry / 'exe').resolve(strict=True))
            if '/ms-playwright/webkit-' not in executable:
                continue
            assert entry.stat().st_uid == os.getuid()
            record = processes.setdefault(entry.name, {'executable': executable, 'libraries': []})
            assert record['executable'] == executable, 'PID reused during observation'
            files = set(record['libraries'])
            for line in (entry / 'maps').read_text().splitlines():
                fields = line.split(None, 5)
                if len(fields) == 6 and fields[5].startswith('/') and not fields[5].endswith(' (deleted)'):
                    files.add(fields[5])
            record['libraries'] = sorted(files)
        except (FileNotFoundError, ProcessLookupError):
            continue


def parse_result(folder, runtime, code):
    report_path, result_path = folder / 'playwright.json', folder / 'result.json'
    if not report_path.exists():
        return {'passed': False, 'reason': 'no Playwright report', 'exit_code': code}
    report = json.loads(report_path.read_text())
    cases = []
    def collect(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec.get('tests', []):
                    cases.append({'title': spec['title'], 'status': test['status'],
                                  'expectedStatus': test['expectedStatus'],
                                  'results': [{'status': r['status'], 'retry': r['retry']}
                                              for r in test['results']]})
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
                  and all(result[key] == runtime[key] for key in runtime))
    return {'passed': passed, 'exit_code': code, 'cases': cases, 'stats': report.get('stats')}


def iteration(index, root, runtime, identities):
    folder = root / 'iterations' / str(index) / 'results'
    folder.mkdir(parents=True)
    runtime = dict(runtime, iteration=index)
    save(folder / 'runtime.json', runtime)
    shutil.copyfile(root / 'results/candidate.json', folder / 'candidate.json')
    env = dict(os.environ, CI_BROWSER_DIAGNOSTICS=str(folder),
               CI_BROWSER_EVIDENCE=str(folder / 'result.json'), DEBUG='pw:browser', GST_DEBUG='3',
               GST_REGISTRY=str(folder.parent / 'gst-registry.bin'))
    receipt = {'iteration': index, 'passed': False}
    processes, child = {}, None
    logfile = folder.parent / 'run.log'
    try:
        with logfile.open('w') as log:
            child = subprocess.Popen(['node', 'scripts/browser-acceptance.cjs'], env=env,
                                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + 10 * 60
            while child.poll() is None:
                observe(processes)
                assert time.monotonic() < deadline, 'Outer diagnostic deadline exceeded'
                time.sleep(0.1)
        receipt.update(parse_result(folder, runtime, child.returncode))
    except Exception as error:
        receipt['error'] = f'{type(error).__name__}: {error}'
    finally:
        try:
            if child:
                stop_owned(child)
            for record in processes.values():
                for name in [record['executable'], *record['libraries']]:
                    if name not in identities:
                        path = Path(name)
                        with path.open('rb') as mapped:
                            native_elf = mapped.read(4) == b'\x7fELF'
                        identities[name] = {'size': path.stat().st_size, 'sha256': sha(path),
                                            'native_elf': native_elf}
            playback = sorted({p for r in processes.values() for p in r['libraries']
                               if Path(p).name == 'libgstplayback.so'})
            assert playback, 'Actual loaded playback library was not observed'
            assert all(identities[p]['native_elf'] for p in playback)
            assert all(identities[r['executable']]['native_elf'] for r in processes.values())
            receipt['loaded_playback'] = playback
            receipt['native_signals'] = re.findall(r'signal=(SIG(?:SEGV|ABRT|TRAP|BUS|ILL|FPE))', logfile.read_text())
            if receipt['native_signals']:
                receipt['passed'] = False
        except Exception as error:
            receipt.update(passed=False, observation_error=f'{type(error).__name__}: {error}')
        save(folder.parent / 'processes.json', processes)
        save(folder.parent / 'iteration.json', receipt)
    return receipt


def compare_mapped_files(identities):
    changes = []
    native_count = sum(record['native_elf'] for record in identities.values())
    for name, before in identities.items():
        try:
            after = sha(name)
        except FileNotFoundError:
            after = None
        if after != before['sha256']:
            changes.append({'path': name, 'native_elf': before['native_elf'],
                            'before_sha256': before['sha256'], 'after_sha256': after})
    return {'native_elf_count': native_count, 'mapped_file_changes': changes,
            'native_elf_unchanged': native_count > 0 and not any(c['native_elf'] for c in changes)}


def main():
    assert sys.platform == 'linux' and os.getuid() != 0
    assert os.uname().machine == 'x86_64'
    generation = os.environ['RUNTIME_GENERATION']
    assert generation in ('noble', 'resolute')
    release = Path('/etc/os-release').read_text()
    assert f'VERSION_CODENAME={generation}' in release
    Path(os.environ['HOME']).mkdir(mode=0o700, exist_ok=False)
    root = Path('.compatibility').resolve()
    module = Path('tools/browser-compatibility', os.environ['TOOLCHAIN'], 'node_modules/playwright').resolve()
    assert json.loads((module / 'package.json').read_text())['version'] == '1.64.0'
    os.environ['CI_PLAYWRIGHT_MODULE'] = str(module)
    before = packages()
    runtime = dict(schema=1, diagnosticOnly=True, scope='official-linux-runtime-comparison',
                   runtimeGeneration=generation, runtimeImage=os.environ['RUNTIME_IMAGE'],
                   actualArch='x64', platform='linux', target='ubuntu-latest-webkit-1-64-0',
                   engine='webkit', channel='', playwrightVersion=os.environ['PLAYWRIGHT_VERSION'],
                   browserVersion=os.environ['BROWSER_VERSION'], sourceSha=os.environ['SOURCE_SHA'],
                   fixtureSourceSha=os.environ['FIXTURE_SHA'], workflowSha=os.environ['GITHUB_SHA'],
                   runId=os.environ['GITHUB_RUN_ID'], runAttempt=os.environ['GITHUB_RUN_ATTEMPT'],
                   releaseChannel='', candidateArtifactId='12033189997', candidateRunId='38870073578')
    summary = dict(diagnosticOnly=True, passed=False, runtime=runtime, os_release=release,
                   driver_sha256=sha(__file__), iterations_requested=ITERATIONS, iterations=[],
                   raw_cores_uploaded=False, packages=before, library_identities={})
    try:
        for index in range(1, ITERATIONS + 1):
            receipt = iteration(index, root, runtime, summary['library_identities'])
            summary['iterations'].append(receipt)
            save(root / 'runtime-summary.json', summary)
            print(f'{generation}: iteration={index} passed={receipt["passed"]}', flush=True)
    finally:
        summary['packages_unchanged'] = packages() == before
        summary.update(compare_mapped_files(summary['library_identities']))
        summary['passed'] = (len(summary['iterations']) == ITERATIONS
                             and all(r['passed'] for r in summary['iterations'])
                             and summary['packages_unchanged'] and summary['native_elf_unchanged'])
        save(root / 'runtime-summary.json', summary)
    return 0 if summary['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
