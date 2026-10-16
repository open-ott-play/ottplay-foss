"""Temporary real null-sink comparison; no system service or product changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time


def stop_owned(process):
    if process is not None and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
    return process.returncode if process is not None else None


def main():
    # Let the outer diagnostic deadline trigger this helper's existing finally cleanup.
    def interrupted(signum, frame):
        raise RuntimeError('Outer diagnostic interrupted audio control')
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['absent', 'null-sink'])
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    assert command and os.getuid() != 0
    output = Path(os.environ['CI_BROWSER_DIAGNOSTICS']).parent / 'audio'
    output.mkdir(mode=0o700)
    report = {'diagnosticOnly': True, 'mode': args.mode, 'uid': os.getuid(),
              'physical_audio': False, 'status': 'failed', 'lifecycle': [],
              'driver_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'observed_sink_inputs': []}
    daemon = child = None
    code = None
    checks_passed = False
    with tempfile.TemporaryDirectory(prefix='foss-audio-') as directory:
        work = Path(directory)
        assert work.stat().st_uid == os.getuid() and work.stat().st_mode & 0o077 == 0
        server = 'unix:' + str(work / 'native')
        runtime = work / 'runtime'
        runtime.mkdir(mode=0o700)
        client = work / 'client.conf'
        client.write_text('autospawn = no\n')
        env = dict(os.environ, PULSE_SERVER=server, PULSE_CLIENTCONFIG=str(client),
                   PULSE_SINK='foss_diagnostic', XDG_RUNTIME_DIR=str(runtime))
        report['server'] = server
        report['private_directory_mode'] = oct(work.stat().st_mode & 0o777)

        def pactl(*arguments):
            return subprocess.run(['pactl', '--server=' + server, *arguments],
                                  env=env, text=True, capture_output=True, timeout=5)

        log = (output / 'daemon.log').open('w')
        try:
            before = pactl('info')
            assert before.returncode != 0, 'Private endpoint unexpectedly already exists'
            report['initial_endpoint_absent'] = True
            sink_index = None
            if args.mode == 'null-sink':
                config = work / 'daemon.pa'
                config.write_text('load-module module-native-protocol-unix socket=' + str(work / 'native') + ' auth-anonymous=1\n'
                                  'load-module module-null-sink sink_name=foss_diagnostic format=s16le rate=48000 channels=2\n'
                                  'set-default-sink foss_diagnostic\n')
                daemon = subprocess.Popen(['pulseaudio', '--daemonize=no', '--use-pid-file=no',
                                           '--exit-idle-time=-1', '--disable-shm=yes', '--fail=yes',
                                           '--log-target=stderr', '-n', '--file=' + str(config)],
                                          env=env, stdout=log, stderr=subprocess.STDOUT,
                                          start_new_session=True)
                report['lifecycle'].append({'event': 'daemon-started', 'pid': daemon.pid})
                deadline = time.monotonic() + 15
                while True:
                    assert daemon.poll() is None, 'Owned PulseAudio daemon exited during startup'
                    info = pactl('info')
                    if info.returncode == 0:
                        break
                    assert time.monotonic() < deadline, 'Private PulseAudio endpoint did not become ready'
                    time.sleep(0.1)
                report['server_info'] = info.stdout
                sinks = pactl('--format=json', 'list', 'sinks')
                sinks.check_returncode()
                sink, = json.loads(sinks.stdout)
                assert sink['name'] == 'foss_diagnostic'
                assert sink['sample_specification'] == 's16le 2ch 48000Hz'
                assert sink['driver'] == 'module-null-sink.c'
                sink_index = sink['index']
                report['sink'] = sink
                default = pactl('get-default-sink')
                default.check_returncode()
                assert default.stdout.strip() == 'foss_diagnostic'
                report['endpoint_connected'] = True
            else:
                report['endpoint_connected'] = False

            child = subprocess.Popen(command, env=env, start_new_session=True)
            report['lifecycle'].append({'event': 'browser-command-started', 'pid': child.pid})
            deadline = time.monotonic() + 9 * 60
            seen = set()
            while child.poll() is None:
                assert time.monotonic() < deadline, 'Browser command exceeded diagnostic bound'
                if daemon is not None:
                    assert daemon.poll() is None, 'Owned audio daemon exited during browser scenarios'
                    inputs = pactl('--format=json', 'list', 'sink-inputs')
                    inputs.check_returncode()
                    for item in json.loads(inputs.stdout):
                        assert item['sink'] == sink_index, 'Stream routed to unexpected sink'
                        if item['index'] not in seen:
                            seen.add(item['index'])
                            assert len(seen) <= 100
                            report['observed_sink_inputs'].append(item)
                time.sleep(0.2)
            code = child.returncode
            report['child_exit_code'] = code
            if daemon is not None:
                assert daemon.poll() is None
                assert report['observed_sink_inputs'], 'No browser audio stream reached the real null sink'
            else:
                assert pactl('info').returncode != 0, 'Absent endpoint unexpectedly activated'
            checks_passed = True
        finally:
            cleanup_errors = []
            daemon_exit = None
            for process, name in [(child, 'browser-command'), (daemon, 'daemon')]:
                try:
                    exit_code = stop_owned(process)
                    if name == 'daemon':
                        daemon_exit = exit_code
                    report['lifecycle'].append({'event': name + '-stopped', 'exit_code': exit_code})
                except Exception as error:
                    cleanup_errors.append(name + ': ' + type(error).__name__)
            log.close()
            report['cleanup_errors'] = cleanup_errors
            report['status'] = 'passed' if not cleanup_errors and checks_passed and code == 0 and (daemon is None or daemon_exit == 0) else 'failed'
            (output / 'receipt.json').write_text(json.dumps(report, indent=2) + '\n')
            assert not cleanup_errors, 'Owned process cleanup failed'
        assert daemon is None or daemon_exit == 0, 'Owned daemon cleanup failed'
        return code


if __name__ == '__main__':
    raise SystemExit(main())
