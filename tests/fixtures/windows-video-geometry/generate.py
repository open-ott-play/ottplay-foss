"""Regenerate tiny MP4 and byte-preserving fMP4 HLS fixtures.

Generation is pinned to FFmpeg 9.0.2. HLS is a remux of the checked-in
synthetic MP4s: video samples are not re-encoded. CI needs no FFmpeg because it
validates the checked-in manifests and media payloads with the Node test.
"""
import hashlib
import json
import re
import subprocess
from pathlib import Path

PALETTE = ['0xdc2828', '0x28dc28', '0x2828dc', '0xdcdc28']
ROOT = Path(__file__).resolve().parent
FFMPEG_VERSION = '9.0.2'


def run(args, *, capture=False):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE if capture else None)


def pinned_tool_version(tool):
    result = subprocess.run([tool, '-version'], check=True, capture_output=True, text=True)
    first_line = result.stdout.splitlines()[0]
    match = re.match(r'ff(?:mpeg|probe) version (\d+\.\d+\.\d+)', first_line)
    if not match or match.group(1) != FFMPEG_VERSION:
        raise SystemExit(f'{tool} {FFMPEG_VERSION} required, got: {first_line}')


def mdat_payload(path):
    data = Path(path).read_bytes()
    payload = bytearray()
    offset = 0
    while offset + 8 <= len(data):
        size = int.from_bytes(data[offset:offset + 4], 'big')
        kind = data[offset + 4:offset + 8]
        header = 8
        if size == 1:
            if offset + 16 > len(data):
                raise SystemExit(f'incomplete extended ISO BMFF box: {path}')
            size = int.from_bytes(data[offset + 8:offset + 16], 'big')
            header = 16
        elif size == 0:
            size = len(data) - offset
        if size < header or offset + size > len(data):
            raise SystemExit(f'invalid ISO BMFF box: {path}')
        if kind == b'mdat':
            payload.extend(data[offset + header:offset + size])
        offset += size
    if offset != len(data):
        raise SystemExit(f'trailing bytes outside ISO BMFF boxes: {path}')
    return bytes(payload)


def sample_frames(path, width, height):
    result = run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path),
        '-vf', "select='eq(n,6)+eq(n,24)'", '-fps_mode', 'passthrough',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture=True)
    frame_bytes = width * height * 3
    if len(result.stdout) != frame_bytes * 2:
        raise SystemExit(f'expected two decoded phase samples from {path}')
    samples = []
    for frame in range(2):
        pixels = result.stdout[frame * frame_bytes:(frame + 1) * frame_bytes]
        samples.append([
            tuple(pixels[(y * width + x) * 3:(y * width + x) * 3 + 3])
            for x, y in ((width // 4, height // 4), (width * 3 // 4, height // 4),
                         (width // 4, height * 3 // 4), (width * 3 // 4, height * 3 // 4))
        ])
    return samples


def sha256(data):
    return hashlib.sha256(data).hexdigest()


pinned_tool_version('ffmpeg')
pinned_tool_version('ffprobe')
fixture_manifest = {'ffmpeg_version': FFMPEG_VERSION, 'sources': {}}
for name, width, height in [('wide', 640, 360), ('standard', 480, 360)]:
    filters = []
    for phase in (0, 1):
        for quadrant in range(4):
            filters.append(
                f"drawbox=x={(quadrant % 2) * width // 2}:y={(quadrant // 2) * height // 2}:"
                f"w={width // 2}:h={height // 2}:color={PALETTE[(quadrant + phase) % 4]}:"
                f"t=fill:enable='eq(mod(floor(t/1.5),2),{phase})'")
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                    f'color=black:s={width}x{height}:r=12:d=12', '-vf', ','.join(filters),
                    '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
                    '-g', '18', '-bf', '0', '-movflags', '+faststart', '-y', str(ROOT / (name + '.mp4'))],
                   )

    source_path = ROOT / (name + '.mp4')
    source_payload = mdat_payload(source_path)
    source_samples = sample_frames(source_path, width, height)
    expected = [
        [(220, 40, 40), (40, 220, 40), (40, 40, 220), (220, 220, 40)],
        [(40, 220, 40), (40, 40, 220), (220, 220, 40), (220, 40, 40)],
    ]
    for phase, (actual_row, expected_row) in enumerate(zip(source_samples, expected)):
        for quadrant, (actual, target) in enumerate(zip(actual_row, expected_row)):
            if any(abs(a - b) > 4 for a, b in zip(actual, target)):
                raise SystemExit(
                    f'{name} phase {phase} quadrant {quadrant} decoded {actual}, expected {target}')

    hls_dir = ROOT / 'hls' / name
    hls_dir.mkdir(parents=True, exist_ok=True)
    playlist = hls_dir / 'index.m3u8'
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source_path),
         '-map', '0:v:0', '-c', 'copy', '-an', '-f', 'hls',
         '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
         '-hls_segment_filename', str(hls_dir / 'segment%03d.m4s'),
         '-hls_time', '1.5', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
         '-hls_flags', 'independent_segments+temp_file', '-y', str(playlist)])
    text = playlist.read_text(encoding='utf-8')
    segment_names = [line for line in text.splitlines() if line.endswith('.m4s')]
    hls_payload = mdat_payload(hls_dir / 'init.mp4') + b''.join(
        mdat_payload(hls_dir / segment) for segment in segment_names)
    if hls_payload != source_payload:
        raise SystemExit(f'{name}: HLS remux changed encoded video sample bytes')
    hls_samples = sample_frames(playlist, width, height)
    if hls_samples != source_samples:
        raise SystemExit(f'{name}: HLS remux changed decoded phase samples')
    fixture_manifest['sources'][name] = {
        'height': height,
        'hls': {
            'init_sha256': sha256((hls_dir / 'init.mp4').read_bytes()),
            'playlist_sha256': sha256(playlist.read_bytes()),
            'segments': [
                {'name': segment, 'sha256': sha256((hls_dir / segment).read_bytes())}
                for segment in segment_names
            ],
        },
        'mdat_sha256': sha256(source_payload),
        'phase_samples_rgb': source_samples,
        'source_sha256': sha256(source_path.read_bytes()),
        'width': width,
    }

(ROOT / 'hls' / 'manifest.json').write_text(
    json.dumps(fixture_manifest, indent=2, sort_keys=True) + '\n', encoding='utf-8')
