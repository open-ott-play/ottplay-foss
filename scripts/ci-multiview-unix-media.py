"""Pure synthetic-media CI planning and measurement; the caller owns processes.

No command in this module is executed here. Complete encoded HLS, mono PCM and
JSON measurements are evidence; only RGB is disposable work-only scratch.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
from contextlib import contextmanager

RATE = 16000
FPS = 10
WIDTH, HEIGHT, SECONDS = 96, 64, 80
WINDOW = 800  # 50 ms, including an overlapping exact-end window.
COLORS = ((180, 35, 35), (30, 160, 40), (35, 55, 185), (170, 145, 25),
          (145, 35, 160), (25, 150, 160), (180, 90, 30), (85, 40, 165),
          (40, 105, 105), (165, 85, 125))
ROWS = ({'slot': 0, 'source': 1, 'rect': [0, 0, 384, 288], 'z': 0},
        {'slot': 1, 'source': 2, 'rect': [256, 0, 128, 96], 'z': 1})
AUDIO_CAP = 4 * 1024 * 1024
AUDIO_FS = AUDIO_CAP + 65536  # A triggered safety cap must exceed accepted bytes.


def require(value, message):
    if not value:
        raise ValueError(message)


def _parts(path):
    path = Path(path)
    require(path.is_absolute() and path.anchor == '/' and '..' not in path.parts,
            'Expected absolute non-traversing owned path')
    return path


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _dir_fd(path, create_leaf=False):
    """Walk each directory through an anchored no-follow descriptor."""
    path = _parts(path)
    require(hasattr(os, 'O_NOFOLLOW') and hasattr(os, 'O_DIRECTORY') and hasattr(os, 'O_NONBLOCK'),
            'Unix no-follow/nonblocking file custody required')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK
    current = os.open('/', flags)
    try:
        components = path.parts[1:]
        for number, name in enumerate(components):
            if create_leaf and number == len(components) - 1:
                try:
                    os.mkdir(name, 0o700, dir_fd=current)
                except FileExistsError:
                    pass
            before = os.stat(name, dir_fd=current, follow_symlinks=False)
            require(stat.S_ISDIR(before.st_mode), 'Directory component is not an owned real directory')
            following = os.open(name, flags, dir_fd=current)
            try:
                opened = os.fstat(following)
                require(stat.S_ISDIR(opened.st_mode) and (opened.st_dev, opened.st_ino) ==
                        (before.st_dev, before.st_ino), 'Directory changed during admission')
            except BaseException:
                os.close(following)
                raise
            os.close(current)
            current = following
        return current
    except BaseException:
        os.close(current)
        raise


def _read(path, limit):
    path = _parts(path)
    require(type(limit) is int and 0 <= limit <= 384 * 1024 * 1024, 'Invalid admitted read budget')
    parent = _dir_fd(path.parent)
    descriptor = None
    try:
        before = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= limit,
                'Expected bounded single-link regular file')
        descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        require(_identity(os.fstat(descriptor)) == _identity(before), 'File changed before admitted read')
        blocks, count = [], 0
        while True:
            block = os.read(descriptor, min(65536, limit + 1 - count))
            if not block:
                break
            blocks.append(block)
            count += len(block)
            require(count <= limit and count <= before.st_size, 'File grew during admitted read')
        require(count == before.st_size and _identity(os.fstat(descriptor)) == _identity(before)
                and _identity(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) == _identity(before),
                'File identity changed during admitted read')
        return b''.join(blocks)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)


def _sha(path, limit=16 * 1024 * 1024):
    return hashlib.sha256(_read(path, limit)).hexdigest()


def _absent(path):
    path = _parts(path)
    parent = _dir_fd(path.parent)
    try:
        try:
            os.stat(path.name, dir_fd=parent, follow_symlinks=False)
            return False
        except FileNotFoundError:
            return True
    finally:
        os.close(parent)


@contextmanager
def _new_file(path):
    path = _parts(path)
    parent = _dir_fd(path.parent)
    descriptor = None
    try:
        descriptor = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                             os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size == 0,
                'New work output is not an empty owned regular file')
        with os.fdopen(descriptor, 'wb') as stream:
            descriptor = None
            yield stream
            stream.flush()
            after = os.fstat(stream.fileno())
            require(stat.S_ISREG(after.st_mode) and after.st_nlink == 1
                    and (after.st_dev, after.st_ino) == (info.st_dev, info.st_ino)
                    and after.st_size <= 384 * 1024 * 1024
                    and _identity(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) == _identity(after),
                    'Owned output changed during write')
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent)


def _unlink_owned(path):
    path = _parts(path)
    parent = _dir_fd(path.parent)
    try:
        info = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Refusing foreign scratch removal')
        os.unlink(path.name, dir_fd=parent)
    finally:
        os.close(parent)


def _json(path, limit=1024 * 1024):
    return json.loads(_read(path, limit))


def _write_json(path, value):
    raw = (json.dumps(value, indent=2, allow_nan=False) + '\n').encode('utf8')
    require(len(raw) <= 4 * 1024 * 1024, 'JSON work output exceeds bound')
    with _new_file(path) as stream:
        stream.write(raw)


def _pcm(raw):
    require(len(raw) % 2 == 0, 'PCM is not aligned signed-16')
    return struct.unpack('<' + 'h' * (len(raw) // 2), raw)


def _ownership(values, source):
    """Original full-interval Goertzel ownership/leakage gate (>=0.5 s)."""
    require(len(values) >= RATE // 2, 'Ownership interval shorter than 0.5 seconds')
    require(type(source) is int and 1 <= source <= 10, 'Unknown fixture source')
    energy = sum(float(v) * v for v in values)
    rms = math.sqrt(energy / len(values))
    powers = []
    for index in range(10):
        coefficient = 2 * math.cos(2 * math.pi * (330 + 110 * index) / RATE)
        a = b = 0.
        for value in values:
            a, b = value + coefficient * a - b, a
        powers.append(max(0., a * a + b * b - coefficient * a * b))
    fractions = [min(1., 2 * power / (len(values) * energy)) if energy else 0.
                 for power in powers]
    observed = max(range(10), key=powers.__getitem__) + 1 if energy else None
    own = fractions[source - 1]
    leak = max(v for i, v in enumerate(fractions) if i != source - 1)
    return {'expected_source': source, 'observed_source': observed,
            'rms_s16': round(rms, 3), 'owner_explained_energy': round(own, 8),
            'largest_other_fixture_tone_energy': round(leak, 10),
            'owner_energy_min': .97, 'other_fixture_tone_energy_max': 3e-5,
            'pass': observed == source and rms >= 20 and own >= .97 and leak <= 3e-5}


def _windows(values, source):
    starts = list(range(0, len(values) - WINDOW + 1, WINDOW))
    if starts and starts[-1] + WINDOW < len(values):
        starts.append(len(values) - WINDOW)
    hz = 330 + 110 * (source - 1)
    rows = []
    for start in starts:
        block = values[start:start + WINDOW]
        energy = sum(v * v for v in block)
        z = sum(v * complex(math.cos(-2 * math.pi * hz * (start + i) / RATE),
                            math.sin(-2 * math.pi * hz * (start + i) / RATE))
                for i, v in enumerate(block))
        rows.append({'start_seconds': start / RATE,
                     'rms': math.sqrt(energy / WINDOW),
                     'coherence': 2 * abs(z) ** 2 / (WINDOW * energy) if energy else 0.,
                     'phase': math.atan2(z.imag, z.real)})
    return rows


def _audio(raw, source, minimum):
    """Keep FIRST pure owner bin and every later 50 ms bin through exact end."""
    values = _pcm(raw)
    rows = _windows(values, source)
    pure = [row for row in rows if row['coherence'] > .99]
    if not pure:
        return {'pass': False, 'reason': 'No first pure owner bin', 'windows_50ms': rows}
    first = pure[0]['start_seconds']
    selected = [row for row in rows if row['start_seconds'] >= first]
    begin = round(first * RATE)
    full = _ownership(values[begin:], source)
    bad = [row for row in selected if row['rms'] < 20 or row['coherence'] < .97]
    steps = []
    for before, after in zip(pure, pure[1:]):
        delta = math.remainder(after['phase'] - before['phase'], 2 * math.pi)
        if abs(delta) > .1:
            steps.append({'before_seconds': before['start_seconds'],
                          'after_seconds': after['start_seconds'], 'delta': delta})
    duration = (len(values) - begin) / RATE
    exact_end = bool(rows) and round(rows[-1]['start_seconds'] * RATE) + WINDOW == len(values)
    return {'source': source, 'first_pure_bin': first, 'selected_seconds': duration,
            'required_selected_seconds': minimum, 'capture_seconds': len(values) / RATE,
            'full_selected_audio': full, 'bad_windows': bad, 'phase_steps': steps,
            'windows_50ms': rows, 'exact_end_covered': exact_end,
            'pass': duration >= minimum and full['pass'] and not bad and not steps and exact_end}


def _original_b_diagnostic(raw):
    """Port of the qualified original440Hz diagnostic's control projection.

    Low-level PCM/window math is shared, but onset/selection/tail decisions are
    retained separately so a later adapter-only trim cannot silently diverge.
    This is rule equivalence, not a claim of an independent CI implementation.
    """
    values = _pcm(raw)
    windows = _windows(values, 2)
    pure = [row for row in windows if row['coherence'] > .99]
    if not pure:
        return {'pass': False, 'reason': 'No first pure owner bin', 'windows_50ms': windows}
    start = round(pure[0]['start_seconds'] * RATE)
    full = _ownership(values[start:], 2)
    steps = []
    for before, after in zip(pure, pure[1:]):
        delta = math.remainder(after['phase'] - before['phase'], 2 * math.pi)
        if abs(delta) > .1:
            steps.append({'before_seconds': before['start_seconds'],
                          'after_seconds': after['start_seconds'], 'delta': delta})
    selected = [row for row in windows if row['start_seconds'] >= start / RATE]
    bad = [row['start_seconds'] for row in selected if row['rms'] < 20 or row['coherence'] < .97]
    duration = (len(values) - start) / RATE
    end = bool(windows) and round(windows[-1]['start_seconds'] * RATE) + WINDOW == len(values)
    return {'selected_start_capture_seconds': start / RATE, 'settled_selected_seconds': duration,
            'full_selected_audio': full, 'bad_bin_positions': bad, 'phase_steps': steps,
            'final_window_ends_at_capture_end': end, 'windows_50ms': windows,
            'pass': duration >= 60 and full['pass'] and not bad and not steps and end}


def _agreement(adapter, original):
    same = adapter['pass'] == original['pass'] and adapter['windows_50ms'] == original['windows_50ms']
    if 'first_pure_bin' not in adapter:
        return same and 'selected_start_capture_seconds' not in original
    return (same and adapter['first_pure_bin'] == original['selected_start_capture_seconds']
            and adapter['selected_seconds'] == original['settled_selected_seconds']
            and adapter['full_selected_audio'] == original['full_selected_audio']
            and [row['start_seconds'] for row in adapter['bad_windows']] == original['bad_bin_positions']
            and adapter['phase_steps'] == original['phase_steps']
            and adapter['exact_end_covered'] == original['final_window_ends_at_capture_end'])


def _frame(index, number):
    pixels = bytearray(bytes(COLORS[index]) * (WIDTH * HEIGHT))
    x = 8 + (number * 3 + index * 7) % (WIDTH - 24)
    for y in range(20, 28):
        start = (y * WIDTH + x) * 3
        pixels[start:start + 24] = b'\xff' * 24
    return bytes(pixels)


def _video(raw, rows, size, duration):
    """Original per-visible-tile color identity and moving-marker oracle."""
    width, height = size
    stride = width * height * 3
    require(len(raw) % stride == 0, 'RGB frame is incomplete')
    count = len(raw) // stride
    require(count >= max(10, math.ceil(round(FPS * duration) * .9)), 'Too few RGB frames')
    tests = []
    for row_index, row in enumerate(rows):
        x, y, w, h = row['rect']
        z = row.get('z', row_index)
        occluders = [other['rect'] for i, other in enumerate(rows)
                     if (other.get('z', i), i) > (z, row_index)]

        def visible(xx, yy):
            return not any(ox <= xx < ox + ow and oy <= yy < oy + oh
                           for ox, oy, ow, oh in occluders)

        means, centers, phases = [], [], []
        for number in range(count):
            frame = memoryview(raw)[number * stride:(number + 1) * stride]
            samples = [tuple(frame[(yy * width + xx) * 3:(yy * width + xx) * 3 + 3])
                       for yy in (y + h // 8, y + h * 3 // 4)
                       for xx in (x + w // 4, x + w // 2, x + w * 3 // 4) if visible(xx, yy)]
            require(samples, 'Fully occluded identity is unobservable')
            means.append(tuple(sum(p[c] for p in samples) / len(samples) for c in range(3)))
            points = []
            for yy in range(y + h // 4, y + h // 2):
                for xx in range(x + w // 16, x + w * 15 // 16):
                    at = (yy * width + xx) * 3
                    if visible(xx, yy) and min(frame[at:at + 3]) > 220:
                        points.append(xx)
            phase = round(sum(points) / len(points), 1) if points else None
            phases.append(phase)
            if phase is not None:
                centers.append(phase)
        mean = tuple(sum(v[c] for v in means) / len(means) for c in range(3))
        distances = [math.sqrt(sum((mean[c] - color[c]) ** 2 for c in range(3)))
                     for color in COLORS]
        observed = min(range(len(COLORS)), key=distances.__getitem__) + 1
        span = max(centers) - min(centers) if centers else 0
        maximum = streak = 1
        for previous, current in zip(phases, phases[1:]):
            streak = streak + 1 if previous == current else 1
            maximum = max(maximum, streak)
        distinct = [len(set(v for v in phases[i:i + FPS] if v is not None))
                    for i in range(max(0, count - FPS + 1))]
        motion = (len(set(centers)) >= 8 and span > w * .25 and maximum <= 3
                  and bool(distinct) and min(distinct) >= 4)
        identities = []
        for frame_mean in means:
            errors = [sum((frame_mean[c] - color[c]) ** 2 for c in range(3)) ** .5
                      for color in COLORS]
            best = min(range(len(COLORS)), key=errors.__getitem__)
            identities.append(best + 1 if errors[best] < 35 else -1)
        tests.append({'slot': row['slot'], 'expected_source': row['source'],
                      'observed_source': observed, 'color_error': round(distances[observed - 1], 2),
                      'motion_positions': len(set(centers)), 'motion_span_px': round(span, 1),
                      'identity_mismatch_frames': sum(v != row['source'] for v in identities),
                      'max_same_marker_frames': maximum,
                      'min_motion_positions_per_second': min(distinct),
                      'identity_pass': all(v == row['source'] for v in identities),
                      'motion_pass': motion})
    return {'decoded_frames': count, 'size': list(size), 'tiles': tests,
            'pass': all(t['identity_pass'] and t['motion_pass'] for t in tests)}


def _playlist(text):
    headers, blocks, tags, ended = {}, [], [], False
    for line in text.splitlines():
        if not line:
            continue
        require(not ended, 'Data follows HLS ENDLIST')
        if line.startswith('#EXTINF:'):
            require(not tags, 'Duplicate segment duration')
            duration = float(line.split(':', 1)[1].split(',')[0])
            require(math.isfinite(duration) and 0 < duration <= 10, 'Invalid segment duration')
            tags.append(line)
        elif line.startswith('#'):
            if line == '#EXT-X-ENDLIST':
                ended = True
                continue
            key = line.split(':', 1)[0]
            require(key in {'#EXTM3U', '#EXT-X-VERSION', '#EXT-X-TARGETDURATION',
                            '#EXT-X-MEDIA-SEQUENCE', '#EXT-X-INDEPENDENT-SEGMENTS'}
                    and key not in headers, 'Unsupported or duplicate HLS tag')
            headers[key] = line
        else:
            require(re.fullmatch(r'segment-\d{6}\.ts', line) and len(tags) == 1,
                    'Expected one local closed segment')
            blocks.append((line, tuple(tags)))
            tags = []
    require(not tags and blocks and headers.get('#EXTM3U') == '#EXTM3U', 'Incomplete playlist')
    sequence = int(headers['#EXT-X-MEDIA-SEQUENCE'].split(':')[1])
    target = int(headers['#EXT-X-TARGETDURATION'].split(':')[1])
    require(1 <= target <= 10, 'Invalid target duration; no repair allowed')
    for i, (name, segment_tags) in enumerate(blocks):
        require(int(name[8:14]) == sequence + i, 'Playlist sequence gap')
        require(math.ceil(float(segment_tags[0].split(':', 1)[1].split(',')[0])) <= target,
                'Target duration below EXTINF')
    return headers, blocks


def _work(path):
    path = _parts(path)
    descriptor = _dir_fd(path, create_leaf=True)
    os.close(descriptor)
    return path


def _tool(tools, name):
    value = tools[name]
    value = value['path'] if isinstance(value, dict) else value
    require(isinstance(value, str) and Path(value).is_absolute(), 'Expected pinned absolute tool path')
    return value


def _command(name, argv, timeout=40, stdout=None):
    require(all(isinstance(v, str) for v in argv), 'Command argv must be plain strings')
    return {'name': name, 'argv': argv, 'timeout_seconds': timeout,
            'stdout_file': str(stdout) if stdout is not None else None}


def _input_commands(work_root, tools):
    root = _work(work_root)
    ffmpeg = _tool(tools, 'ffmpeg')
    commands = []
    for index in range(2):
        raw = root / f'source-{index + 1}.rgb'
        mp4 = root / f'source-{index + 1}.mp4'
        ts = root / f'source-{index + 1}.ts'
        require(_absent(mp4) and _absent(ts), 'Input generation requires fresh outputs')
        with _new_file(raw) as stream:
            for number in range(FPS * SECONDS):
                stream.write(_frame(index, number))
        require(len(_read(raw, 16 * 1024 * 1024)) == WIDTH * HEIGHT * 3 * FPS * SECONDS,
                'Raw fixture size differs')
        commands.append(_command(f'stream-source-{index + 1}-encode', [
            ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
            '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{WIDTH}x{HEIGHT}',
            '-framerate', str(FPS), '-i', str(raw), '-f', 'lavfi', '-i',
            f'sine=frequency={330 + 110 * index}:sample_rate={RATE}:duration={SECONDS}',
            '-map', '0:v', '-map', '1:a', '-t', str(SECONDS), '-c:v', 'libx264',
            '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
            '-threads', '1', str(mp4)], 30))
        commands.append(_command(f'stream-source-{index + 1}-transport', [
            ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', str(mp4),
            '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-f', 'mpegts', str(ts)], 15))
    return commands


def _seal_inputs(work_root):
    root = _work(work_root)
    inputs = []
    for source in (1, 2):
        path = root / f'source-{source}.ts'
        raw = _read(path, 16 * 1024 * 1024)
        require(raw and len(raw) % 188 == 0 and all(raw[i] == 0x47 for i in range(0, len(raw), 188)),
                'Generated transport is not finite MPEG-TS')
        inputs.append({'id': source, 'path': str(path),
                       'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
    manifest = root / 'INPUTS.json'
    _write_json(manifest, {'schema': 'ottplay.multiview.stream-inputs.v1', 'seconds': SECONDS,
                           'fps': FPS, 'width': WIDTH, 'height': HEIGHT, 'inputs': inputs})
    for source in (1, 2):
        for suffix in ('rgb', 'mp4'):
            path = root / f'source-{source}.{suffix}'
            _read(path, 16 * 1024 * 1024)
            _unlink_owned(path)
    return manifest


def _case(case):
    case = _parts(case)
    os.close(_dir_fd(case))
    control = _json(case / 'CONTROL.json')
    require(control['pass'] is True, 'Control fixture failed')
    require(control['producers_joined'] and control['metadata_fifo_guard']['clean']
            and control['metadata_fifo_guard']['before'] == control['metadata_fifo_guard']['after']
            and control['shutdown']['output_removed'] and control['shutdown']['all_owned_pids_absent'],
            'Fixture normal cleanup did not pass')
    intervals = control['selected_intervals']
    require(len(intervals) == 3, 'Expected A/B/A selection intervals')
    for value, label, seconds, slot in zip(intervals, ('A_initial', 'B_selected', 'A_return'),
                                          (2, 65, 4), (0, 1, 0)):
        require(value['phase'] == label and value['slot'] == slot
                and value['planned_seconds'] == seconds and value['actual_host_millis'] >= seconds * 1000,
                'Selected host interval differs')
        require(_counter_gate(value), 'Selected host audio has missing/dropped samples')
    archive = case / 'archive'
    os.close(_dir_fd(archive))
    proof = _json(archive / 'ARCHIVE.json')
    require(proof['qualified'] and proof['contiguous_from_zero'] and proof['complete_capture']
            and proof['failure_reason'] is None, 'Closed HLS archive is incomplete')
    text = _read(archive / 'index.m3u8', 65536).decode('utf8')
    headers, blocks = _playlist(text)
    require(len(blocks) == proof['segment_count'] and 60 <= len(blocks) <= 110,
            'Archive segment count exceeds finite qualification')
    require(len(proof['segments']) == len(blocks), 'Archive identity inventory differs')
    total_duration = 0.
    for number, ((name, tags), entry) in enumerate(zip(blocks, proof['segments'])):
        require(entry['sequence'] == number and entry['name'] == name and int(name[8:14]) == number,
                'Archive is not contiguous from sequence zero')
        value = _read(archive / name, 2 * 1024 * 1024)
        require(len(value) == entry['bytes'] and hashlib.sha256(value).hexdigest() == entry['sha256'],
                'Archived segment identity differs')
        duration = float(tags[0].split(':', 1)[1].split(',')[0])
        require(math.isclose(duration, entry['extinf_seconds'], abs_tol=1e-9), 'EXTINF identity differs')
        total_duration += duration
    require(math.isfinite(total_duration) and 60 <= total_duration <= 110,
            'Aggregate EXTINF exceeds finite audio-planning bound')
    _validate_events([json.loads(line) for line in _read(case / 'EVENTS.jsonl', 8 * 1024 * 1024)
                      .decode('utf8').splitlines()], control)
    return case, control, proof, text, headers, blocks


def _validate_events(rows, control):
    require(1 <= len(rows) <= 4096, 'Event row count exceeds finite bound')
    baseline_positions = [i for i, row in enumerate(rows) if row['phase'] == 'stable_identity_baseline']
    require(len(baseline_positions) == 1, 'Expected one stable source identity baseline')
    rows = rows[baseline_positions[0]:]
    baseline = rows[0]['snapshot']

    def slots(snapshot):
        values = snapshot['slots']
        mapped = {value['slot_id']: value for value in values}
        require(len(mapped) == len(values) and 0 in mapped and 1 in mapped, 'Duplicate or absent source slot')
        return mapped

    initial = slots(baseline)
    pids = [baseline['encoder_pid'], initial[0]['decoder_pid'], initial[1]['decoder_pid']]
    require(all(type(pid) is int and pid > 0 for pid in pids) and len(set(pids)) == 3,
            'Expected three distinct owned source/output identities')
    require(set(control['shutdown']['owned_pids']) == set(pids)
            and len(control['shutdown']['owned_pids']) == 3, 'Shutdown owned PID set differs')
    invariant = ('runtime', 'encoder_pid', 'output_generation', 'geometry_revision')
    counters = ('monotonic_millis', 'output_frames', 'audio_samples_written', 'video_frames_written')
    previous = baseline
    owner, revision = 0, baseline['audio_revision']
    begins, ends, monitors = {}, {}, {'A_initial': 0, 'B_selected': 0, 'A_return': 0}
    previous_elapsed = rows[0]['driver_elapsed_ms']
    for row in rows:
        snapshot = row['snapshot']
        source = slots(snapshot)
        phase = row['phase']
        require(all(snapshot[key] == baseline[key] for key in invariant), 'Output/source identity changed')
        require(row['driver_elapsed_ms'] >= previous_elapsed
                and all(snapshot[key] >= previous[key] for key in counters), 'Event counter regressed')
        for index in (0, 1):
            require(source[index]['decoder_pid'] == pids[index + 1]
                    and source[index]['source_revision'] == 1
                    and source[index]['frames'] >= slots(previous)[index]['frames'],
                    'Source PID/revision/frame count changed')
        for label, expected_owner in (('A_initial', 0), ('B_selected', 1), ('A_return', 0)):
            if phase == label + '_begin':
                require(label not in begins, 'Duplicate owner phase begin')
                if label != 'A_initial':
                    revision += 1
                owner = expected_owner
                begins[label] = snapshot
            if phase == label + '_end':
                require(label not in ends, 'Duplicate owner phase end')
                ends[label] = snapshot
            if phase == label + '_monitor':
                monitors[label] += 1
                require(snapshot['output_state'] == 'Playing'
                        and all(source[index]['state'] == 'Playing' for index in (0, 1)),
                        'Monitor observed a non-playing source/output')
        require(snapshot['audio_slot'] == owner and snapshot['audio_revision'] == revision
                and row['audio_policy'] == f'Slot({owner})', 'Owner/revision changed outside phase boundary')
        previous, previous_elapsed = snapshot, row['driver_elapsed_ms']
    require(set(begins) == set(ends) == set(monitors), 'Owner phase inventory differs')
    for label in monitors:
        require(monitors[label] > 0 and all(slots(ends[label])[index]['frames'] >
                slots(begins[label])[index]['frames'] for index in (0, 1))
                and ends[label]['output_frames'] > begins[label]['output_frames'],
                'Source/output did not progress through selected phase')
    require(begins['B_selected'] == control['B_selected_begin']
            and ends['B_selected'] == control['B_selected_end']
            and begins['A_return'] == control['A_return_begin']
            and ends['A_return'] == control['A_return_end'], 'CONTROL and exact event snapshots differ')
    return {'pass': True, 'owned_pids': pids, 'monitor_rows': monitors}


def _prefix(case, label, control, text, archive_headers, archive_blocks):
    live = case / f'{label}-END-LIVE.m3u8'
    live_bytes = _read(live, 65536)
    require(hashlib.sha256(live_bytes).hexdigest() == control[f'{label}_end_live_playlist_sha256'],
            'Pre-switch playlist changed')
    headers, blocks = _playlist(live_bytes.decode('utf8'))
    require(set(headers) == set(archive_headers), 'Live/archive headers differ')
    require(all(value == archive_headers[key] for key, value in headers.items()
                if key != '#EXT-X-MEDIA-SEQUENCE'), 'Live/archive global tags differ')
    positions = {name: i for i, (name, _) in enumerate(archive_blocks)}
    expected = dict(archive_blocks)
    require(all(expected.get(name) == tags for name, tags in blocks), 'Pre-switch segment tags differ')
    observed = [positions[name] for name, _ in blocks]
    require(observed == list(range(observed[0], observed[0] + len(observed))), 'Live order differs')
    last = blocks[-1][0]
    lines = text.splitlines()
    content = '\n'.join(lines[:lines.index(last) + 1]) + '\n#EXT-X-ENDLIST\n'
    destination = case / 'archive' / f'{label}-selected-prefix.m3u8'
    with _new_file(destination) as stream:
        stream.write(content.encode('utf8'))
    return destination


def _audio_commands(case, work, tools):
    case, control, _, text, headers, blocks = _case(case)
    work = _work(work)
    ffmpeg, ffprobe = _tool(tools, 'ffmpeg'), _tool(tools, 'ffprobe')
    commands = [_command('stream-video-probe', [ffprobe, '-v', 'error', '-protocol_whitelist',
                 'file,pipe', '-select_streams', 'v:0', '-show_entries',
                 'frame=best_effort_timestamp_time:stream=width,height,avg_frame_rate', '-of', 'json',
                 str(case / 'archive/index.m3u8')], 20, work / 'video-probe.json')]
    for label in ('B', 'A'):
        prefix = _prefix(case, label, control, text, headers, blocks)
        commands.append(_command(f'stream-{label.lower()}-prefix-audio', [
            ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
            '-protocol_whitelist', 'file,pipe', '-i', str(prefix), '-vn', '-ac', '1',
            '-ar', str(RATE), '-f', 's16le', '-fs', str(AUDIO_FS), str(work / f'{label}-prefix.s16')]))
    return commands


def _probe(work):
    probe = _json(Path(work) / 'video-probe.json', 2 * 1024 * 1024)
    require(len(probe['streams']) == 1, 'Expected exactly one output video stream')
    stream = probe['streams'][0]
    require((stream['width'], stream['height']) == (384, 288), 'Output geometry differs')
    numerator, denominator = (int(v) for v in stream['avg_frame_rate'].split('/'))
    require(denominator > 0 and numerator == FPS * denominator, 'Output FPS differs')
    times = [float(v['best_effort_timestamp_time']) for v in probe['frames']]
    require(600 <= len(times) <= 1100 and all(math.isfinite(t) for t in times), 'Invalid finite video PTS')
    require(all(0 < b - a <= .201 for a, b in zip(times, times[1:])), 'Video PTS gap or regression')
    span = times[-1] - times[0] + 1 / FPS
    require(60 <= span <= 110, 'Video archive duration differs')
    return times, span


def _audio_reports(work):
    work = Path(work)
    return (_audio(_read(work / 'B-prefix.s16', AUDIO_CAP - 1), 2, 60),
            _audio(_read(work / 'A-prefix.s16', AUDIO_CAP - 1), 1, .5))


def _video_commands(case, work, tools):
    case = _parts(case)
    os.close(_dir_fd(case))
    work = _work(work)
    _, span = _probe(work)
    audio, _ = _audio_reports(work)
    start = audio.get('first_pure_bin', 0.)
    require(0 <= start < span, 'Selected onset exceeds archive')
    plan = _video_plan(start, span)
    _write_json(work / 'video-plan.json', plan)
    ffmpeg = _tool(tools, 'ffmpeg')
    commands = []
    for number, row in enumerate(plan):
        commands.append(_command(f'stream-video-window-{number:02d}', [
            ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
            '-protocol_whitelist', 'file,pipe', '-i', str(case / 'archive/index.m3u8'),
            '-ss', str(row['start']), '-map', '0:v:0', '-an', '-t', str(row['duration']),
            '-frames:v', str(round(FPS * row['duration'])), '-fps_mode', 'passthrough',
            '-f', 'rawvideo', '-pix_fmt', 'rgb24', str(work / f'video-{number:02d}.rgb')]))
    commands.append(_command('stream-a-return-audio', [
        ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
        '-protocol_whitelist', 'file,pipe', '-i', str(case / 'archive/index.m3u8'),
        '-ss', str(span - 2), '-vn', '-t', '2', '-ac', '1', '-ar', str(RATE),
        '-f', 's16le', '-fs', str(128000 + 65536), str(work / 'A-return.s16')]))
    return commands


def _video_plan(start, span):
    require(0 <= start < span and span - start >= 60, 'Selected video shorter than60seconds')
    windows, at = [], start
    while at < span - .11:
        duration = min(8., span - at)
        if duration < 8:
            at = max(start, span - 8)
            duration = span - at
        windows.append({'start': at, 'duration': duration})
        if at + duration >= span - .11:
            break
        at += duration
    require(len(windows) + 1 <= 14, 'Too many bounded RGB windows')
    plan = windows + [{'start': span - 2, 'duration': 2, 'a_return': True}]
    require(sum(round(FPS * row['duration']) * 384 * 288 * 3 for row in plan) <= 384 * 1024 * 1024,
            'RGB work budget exceeded')
    return plan


def _finish(case, work):
    case, control, proof, _, _, _ = _case(case)
    work = _work(work)
    times, span = _probe(work)
    audio_b, audio_a = _audio_reports(work)
    original_b = _original_b_diagnostic(_read(work / 'B-prefix.s16', AUDIO_CAP - 1))
    agreement = _agreement(audio_b, original_b)
    require(agreement, 'Ported original/adapter onset, every bin, phase or tail differs')
    plan = _json(work / 'video-plan.json')
    require(plan == _video_plan(audio_b.get('first_pure_bin', 0.), span), 'Video coverage plan changed')
    measurements = []
    for number, row in enumerate(plan):
        path = work / f'video-{number:02d}.rgb'
        maximum = round(FPS * row['duration']) * 384 * 288 * 3
        raw = _read(path, maximum)
        identity = hashlib.sha256(raw).hexdigest()
        try:
            measured = _video(raw, ROWS, (384, 288), row['duration'])
            count = measured['decoded_frames']
            stamps = [t for t in times if times[0] + row['start'] - .001 <= t
                      < times[0] + row['start'] + row['duration'] - .001][:count]
            require(len(stamps) == count and all(0 < b - a <= .201 for a, b in zip(stamps, stamps[1:])),
                    'Decoded RGB window PTS differs')
            measured['timestamps_monotonic_bounded_201ms'] = True
        finally:
            # The parent owns scratch custody. Only this exact owned RGB output
            # is removed, immediately after its bounded analysis, never adopted.
            _unlink_owned(path)
        measurements.append(dict(row, raw_sha256=identity, measurement=measured))
    returned_pcm = _read(work / 'A-return.s16', 128000)
    # Preserve the existing separate2s check exactly: this fixed byte crop skips
    # 250ms; it is not a newly chosen first-pure search or healthy-tail trim.
    returned_audio = _ownership(_pcm(returned_pcm[8000:72000]), 1)
    returned_video = measurements[-1]
    passed = (audio_a['pass'] and audio_b['pass'] and returned_audio['pass']
              and all(row['measurement']['pass'] for row in measurements))
    bindings = {str(path.relative_to(case)): _sha(path) for path in (
        case / 'CONTROL.json', case / 'EVENTS.jsonl', case / 'A-END-LIVE.m3u8',
        case / 'B-END-LIVE.m3u8', case / 'archive/index.m3u8', case / 'archive/ARCHIVE.json',
        case / 'archive/A-selected-prefix.m3u8', case / 'archive/B-selected-prefix.m3u8')}
    result = {'schema': 'ottplay.multiview.stream-media.v1', 'pass': bool(passed),
              'scope': 'Finite core Session; synthetic trusted FD transport and closed HLS',
              'host_selected_intervals': control['selected_intervals'],
              'decoded_B_selected_seconds': audio_b.get('selected_seconds', 0.),
              'archive_segments': proof['segment_count'], 'archive_video_frames': len(times),
              'archive_span_seconds': span, 'selected_video_start': audio_b.get('first_pure_bin'),
              'all_archive_pts_monotonic_bounded_201ms': True, 'case_sha256': bindings,
              'ported_original_rule_equivalence': agreement,
              'helper_sha256': _sha(Path(__file__)),
              'work_pcm_sha256': {name: _sha(work / name) for name in
                                  ('B-prefix.s16', 'A-prefix.s16', 'A-return.s16')},
              'A_return_audio': returned_audio, 'A_return_video': returned_video,
              'limits': ['First-pure onset excludes the preceding switch transient.',
                         'Not actual broker, native-v1, TV, production admission or crash qualification.',
                         'Bounded201ms PTS and marker gates are not literal zero-gap playback.',
                         'A-return audio preserves the existing fixed first250ms exclusion.',
                         '160ms FIFO plus one pending20ms is not total decoder/OS latency.']}
    reports = {'audio-B.json': audio_b, 'audio-B-original-rules.json': original_b,
               'audio-A-initial.json': audio_a,
               'video.json': {'windows': measurements, 'pass': all(v['measurement']['pass'] for v in measurements)},
               'qualification.json': result}
    evidence = []
    for name, value in reports.items():
        path = work / name
        _write_json(path, value)
        require(len(_read(path, 1024 * 1024)) <= 1024 * 1024, 'Media JSON exceeds evidence bound')
        evidence.append({'path': str(path), 'relative_name': 'stream-media/analysis/' + name,
                         'max_bytes': 1024 * 1024})
    # Exact bounded inventories, never recursive globs or a directory copy.
    # Preserve the relative tree so adopted HLS references still resolve without
    # rewriting any manifest or changing its identity.
    fixed = [('CONTROL.json', 1024 * 1024), ('EVENTS.jsonl', 8 * 1024 * 1024),
             ('A-END-LIVE.m3u8', 65536), ('B-END-LIVE.m3u8', 65536),
             ('archive/index.m3u8', 65536), ('archive/ARCHIVE.json', 1024 * 1024),
             ('archive/CAPTURE.jsonl', 8 * 1024 * 1024),
             ('archive/A-selected-prefix.m3u8', 65536), ('archive/B-selected-prefix.m3u8', 65536)]
    for name, maximum in fixed:
        _read(case / name, maximum)
        evidence.append({'path': str(case / name), 'relative_name': 'stream-media/case/' + name,
                         'max_bytes': maximum})
    for row in proof['segments']:
        name = 'archive/' + row['name']
        evidence.append({'path': str(case / name), 'relative_name': 'stream-media/case/' + name,
                         'max_bytes': 2 * 1024 * 1024})
    observations = proof['unique_manifests']
    require(type(observations) is int and 1 <= observations <= 256, 'Observation inventory exceeds bound')
    for number in range(1, observations + 1):
        name = f'archive/observations/{number:06d}.m3u8'
        _read(case / name, 65536)
        evidence.append({'path': str(case / name), 'relative_name': 'stream-media/case/' + name,
                         'max_bytes': 65536})
    for name, maximum in [('B-prefix.s16', 4 * 1024 * 1024), ('A-prefix.s16', 4 * 1024 * 1024),
                          ('A-return.s16', 128000), ('video-probe.json', 2 * 1024 * 1024),
                          ('video-plan.json', 65536)]:
        _read(work / name, maximum)
        evidence.append({'path': str(work / name), 'relative_name': 'stream-media/analysis/' + name,
                         'max_bytes': maximum})
    require(len({row['relative_name'] for row in evidence}) == len(evidence), 'Duplicate evidence name')
    require(sum(len(_read(row['path'], row['max_bytes'])) for row in evidence) <= 32 * 1024 * 1024,
            'Complete stream media evidence exceeds32MiB; never trim it to pass')
    return {'result': result, 'evidence': evidence}


def self_test():
    """Small pure arrays only; never prepares80s inputs or starts any tool."""
    def tone(source, seconds=5, shift=0):
        hz = 330 + 110 * (source - 1)
        return [round(2000 * math.sin(2 * math.pi * hz * (i + shift) / RATE))
                for i in range(round(seconds * RATE))]

    def raw(values):
        return struct.pack('<' + 'h' * len(values), *values)

    positive = tone(2)
    require(_audio(raw(positive), 2, 4)['pass'], 'Pure-tone positive control failed')
    original = _original_b_diagnostic(raw(positive))
    adapter = _audio(raw(positive), 2, 60)
    require(_agreement(adapter, original), 'Ported original projection diverged')
    require(not _agreement(dict(adapter, first_pure_bin=.05), original),
            'Later healthy-tail onset trim escaped rule agreement')
    hole = positive[:]
    hole[RATE:RATE + RATE // 10] = [0] * (RATE // 10)
    hole_result = _audio(raw(hole), 2, 4)
    require(_ownership(hole, 2)['pass'] and not hole_result['pass'] and hole_result['bad_windows'],
            '100ms hole was hidden by interval averaging')
    shifted = positive[:RATE] + tone(2, 4, shift=RATE + RATE // 50)
    shifted_result = _audio(raw(shifted), 2, 4)
    require(not shifted_result['pass'] and shifted_result['phase_steps'], '20ms phase jump was accepted')
    require(not _audio(raw(tone(1)), 2, 4)['pass'], 'Wrong owner was accepted')
    rate48 = 48000
    block48 = [round(2000 * math.sin(2 * math.pi * 440 * i / rate48)) for i in range(2400)]
    block48[500:949] = [0] * 449
    energy = sum(v * v for v in block48)
    z = sum(v * complex(math.cos(-2 * math.pi * 440 * i / rate48),
                        math.sin(-2 * math.pi * 440 * i / rate48)) for i, v in enumerate(block48))
    require(2 * abs(z) ** 2 / (2400 * energy) < .97, '449-frame48k hole was accepted')
    require(449 * 2 == 898 and 898 / 96000 * 1000 > 9.35, 'Stereo sample units differ')
    require(not _counter_gate({'selected_underflow_samples_delta': 898,
                               'selected_dropped_samples_delta': 0, 'audio_callback_miss_delta': 0}),
            '898-interleaved-sample host underflow was accepted')
    rgb = b''.join(_frame(0, i) for i in range(20))
    row = [{'slot': 0, 'source': 1, 'rect': [0, 0, WIDTH, HEIGHT]}]
    require(_video(rgb, row, (WIDTH, HEIGHT), 2)['pass'], 'Moving RGB positive control failed')
    wrong = [dict(row[0], source=2)]
    require(not _video(rgb, wrong, (WIDTH, HEIGHT), 2)['pass'], 'Wrong visible source was accepted')
    require(not _video(_frame(0, 0) * 20, row, (WIDTH, HEIGHT), 2)['pass'], 'Frozen marker was accepted')
    tail = _audio(raw(tone(2, seconds=1.2004375)), 2, .5)
    require(tail['pass'] and tail['exact_end_covered'], 'Overlapping exact-tail coverage failed')
    require(AUDIO_FS >= AUDIO_CAP + 65536, 'Safety output cap could mimic accepted complete PCM')
    events, current = [], (0, 1)
    phases = ['stable_identity_baseline', 'A_initial_begin', 'A_initial_monitor', 'A_initial_end',
              'B_selected_policy_before', 'B_selected_begin', 'B_selected_monitor', 'B_selected_end',
              'A_return_policy_before', 'A_return_begin', 'A_return_monitor', 'A_return_end']
    for number, phase in enumerate(phases):
        if phase == 'B_selected_begin':
            current = (1, 2)
        if phase == 'A_return_begin':
            current = (0, 3)
        owner, revision = current
        snapshot = {'runtime': 1, 'encoder_pid': 55, 'output_generation': 1, 'geometry_revision': 0,
                    'audio_slot': owner, 'audio_revision': revision, 'output_state': 'Playing',
                    'monotonic_millis': number * 50, 'output_frames': number + 10,
                    'audio_samples_written': number * 1920, 'video_frames_written': number + 10,
                    'slots': [{'slot_id': index, 'decoder_pid': pid, 'source_revision': 1,
                               'frames': number + 10, 'state': 'Playing'}
                              for index, pid in enumerate((77, 88))]}
        events.append({'phase': phase, 'driver_elapsed_ms': number * 50,
                       'audio_policy': f'Slot({owner})', 'snapshot': snapshot})
    snapshots = {row['phase']: row['snapshot'] for row in events}
    control = {'shutdown': {'owned_pids': [55, 77, 88]},
               'B_selected_begin': snapshots['B_selected_begin'],
               'B_selected_end': snapshots['B_selected_end'],
               'A_return_begin': snapshots['A_return_begin'],
               'A_return_end': snapshots['A_return_end']}
    require(_validate_events(events, control)['pass'], 'Stable identity positive failed')
    for field, value in (('decoder_pid', 99), ('frames', 0)):
        invalid = json.loads(json.dumps(events))
        invalid[6]['snapshot']['slots'][0][field] = value
        try:
            _validate_events(invalid, control)
        except ValueError:
            pass
        else:
            raise ValueError('Restart/regressing source identity was accepted')
    invalid = json.loads(json.dumps(events))
    invalid[6]['snapshot']['audio_slot'] = 0
    try:
        _validate_events(invalid, control)
    except ValueError:
        pass
    else:
        raise ValueError('Uncommanded phase owner was accepted')
    return {'pass': True, 'pure_positive': True, 'reject_100ms_hole_despite_global_pass': True,
            'reject_20ms_phase_jump': True, 'reject_wrong_owner': True,
            'reject_449_frame_48k_hole': True, 'reject_898_interleaved_counter': True,
            'ported_original_rule_agreement': True, 'reject_later_onset_trim': True,
            'reject_event_restart_regression_wrong_owner': True, 'safety_cap_above_acceptance': True,
            'reject_wrong_video_and_frozen_marker': True, 'exact_tail_coverage': True,
            'tools_started': False, 'long_media_generated': False}


def _counter_gate(value):
    return all(value[key] == 0 for key in ('selected_dropped_samples_delta',
                'selected_underflow_samples_delta', 'audio_callback_miss_delta'))


def prepare_inputs(work_root, tools):
    """Write finite work-only RGB sources; return encode/copy command specs."""
    return _input_commands(work_root, tools)


def seal_inputs(work_root):
    """After successful commands, seal canonical TS paths and remove input scratch.

    The caller retains/adopts the returned manifest and its two TS inputs. They
    are caller-owned evidence, separate from finish(case, analysis_work).
    """
    return _seal_inputs(work_root)


def prepare_audio(case, work, tools):
    """Plan probe and complete A/B prefix PCM decodes; execute before video planning."""
    return _audio_commands(case, work, tools)


def prepare_video(case, work, tools):
    """After audio commands complete, plan bounded RGB and exact A-return PCM."""
    return _video_commands(case, work, tools)


def finish(case, work):
    """Pure measurements plus exact allowlisted evidence; never launch a tool."""
    return _finish(case, work)


def _forensic_structure(name, raw):
    if name.endswith('.json'):
        value = json.loads(raw)
        if name == 'video-plan.json':
            require(isinstance(value, list) and len(value) <= 14, 'Invalid forensic video plan')
        else:
            require(isinstance(value, dict), 'Expected forensic JSON object')
            if name == 'video-probe.json':
                require(isinstance(value.get('streams'), list) and len(value['streams']) == 1
                        and isinstance(value.get('frames'), list), 'Invalid forensic probe shape')
            elif name == 'archive/ARCHIVE.json':
                require(type(value.get('qualified')) is bool and isinstance(value.get('segments'), list)
                        and len(value['segments']) <= 256, 'Invalid forensic archive identity shape')
            else:
                require(type(value.get('pass')) is bool, 'Invalid forensic result shape')
    elif name.endswith('.jsonl'):
        lines = raw.splitlines()
        require(len(lines) <= 65536, 'Too many forensic JSONL rows')
        for line in lines:
            value = json.loads(line)
            require(isinstance(value, dict), 'Expected forensic JSONL object')
            if name == 'EVENTS.jsonl':
                require(isinstance(value.get('phase'), str) and isinstance(value.get('snapshot'), dict),
                        'Invalid forensic event shape')
            else:
                require(isinstance(value.get('stage'), str) and isinstance(value.get('outcome'), str),
                        'Invalid forensic capture shape')
    elif name.endswith('.m3u8'):
        _playlist(raw.decode('utf8'))


def failure_evidence(case_root, work_root):
    """Read-only, bounded forensic custody; never qualifies a failed attempt.

    The caller preserves its original error and adopts within its *remaining*
    evidence allowance. Collection/adoption failure never waives actor cleanup.
    Missing optional files are normal after an early failure. No directory glob,
    RGB adoption, tool invocation, foreign deletion or qualification occurs.
    """
    errors, evidence, roots = set(), [], {}
    for label, root in (('case', case_root), ('analysis', work_root)):
        try:
            root = _parts(root)
            os.close(_dir_fd(root))
            roots[label] = root
        except (OSError, ValueError, TypeError):
            errors.add('ROOT_UNAVAILABLE')
    fixed_case = [('CONTROL.json', 1024 * 1024, True), ('EVENTS.jsonl', 8 * 1024 * 1024, True),
                  ('A-END-LIVE.m3u8', 65536, False), ('B-END-LIVE.m3u8', 65536, False),
                  ('archive/index.m3u8', 65536, False), ('archive/partial-prefix.m3u8', 65536, False),
                  ('archive/ARCHIVE.json', 1024 * 1024, False),
                  ('archive/CAPTURE.jsonl', 8 * 1024 * 1024, False),
                  ('archive/A-selected-prefix.m3u8', 65536, False),
                  ('archive/B-selected-prefix.m3u8', 65536, False)]
    fixed_work = [(name, 1024 * 1024, False) for name in (
        'audio-B.json', 'audio-B-original-rules.json', 'audio-A-initial.json',
        'video.json', 'qualification.json')]
    fixed_work += [('video-probe.json', 2 * 1024 * 1024, False),
                   ('video-plan.json', 65536, False), ('B-prefix.s16', AUDIO_CAP - 1, False),
                   ('A-prefix.s16', AUDIO_CAP - 1, False), ('A-return.s16', 128000, False)]
    candidates = [('case', *row) for row in fixed_case] + [('analysis', *row) for row in fixed_work]
    candidates += [('case', f'archive/segment-{number:06d}.ts', 2 * 1024 * 1024, False)
                   for number in range(256)]
    candidates += [('case', f'archive/observations/{number:06d}.m3u8', 65536, False)
                   for number in range(1, 257)]
    total, omitted = 0, 0
    for label, name, maximum, required in candidates:
        if label not in roots:
            continue
        path = roots[label] / name
        try:
            raw = _read(path, maximum)
        except FileNotFoundError:
            if required:
                errors.add('MISSING_REQUIRED')
            continue
        except (OSError, ValueError):
            errors.add('CUSTODY_OR_BOUND')
            omitted += 1
            continue
        try:
            _forensic_structure(name, raw)
        except (ValueError, KeyError, TypeError, UnicodeError, RecursionError, OverflowError):
            errors.add('MALFORMED_STRUCTURE')
        if total + len(raw) > 32 * 1024 * 1024:
            errors.add('EVIDENCE_BUDGET')
            omitted += 1
            continue
        evidence.append({'path': str(path), 'relative_name': f'stream-media-forensic/{label}/{name}',
                         'max_bytes': maximum})
        total += len(raw)
    require(len({row['relative_name'] for row in evidence}) == len(evidence),
            'Duplicate fixed forensic evidence name')
    return {'schema': 'ottplay.multiview.stream-forensic.v1', 'qualified': False,
            'forensic_only': True, 'incomplete': bool(errors), 'errors': sorted(errors),
            'omitted_files': omitted, 'evidence_bytes': total, 'evidence': evidence,
            'preserves_original_error': True, 'cleanup_must_run_unconditionally': True}
