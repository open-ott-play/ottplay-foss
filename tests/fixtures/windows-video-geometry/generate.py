"""Regenerate the tiny, synthetic decoder fixtures; ffmpeg is not needed in CI."""
import subprocess
from pathlib import Path

PALETTE = ['0xdc2828', '0x28dc28', '0x2828dc', '0xdcdc28']
ROOT = Path(__file__).resolve().parent
for name, width, height in [('wide', 640, 360), ('standard', 480, 360)]:
    filters = []
    for phase in (0, 1):
        for quadrant in range(4):
            filters.append(
                f"drawbox=x={(quadrant % 2) * width // 2}:y={(quadrant // 2) * height // 2}:"
                f"w={width // 2}:h={height // 2}:color={PALETTE[(quadrant + phase) % 4]}:"
                f"t=fill:enable='eq(mod(floor(t/1.5),2),{phase})'")
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                    f'color=black:s={width}x{height}:r=12:d=12', '-vf', ','.join(filters),
                    '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
                    '-g', '18', '-bf', '0', '-movflags', '+faststart', '-y', str(ROOT / (name + '.mp4'))],
                   check=True)
