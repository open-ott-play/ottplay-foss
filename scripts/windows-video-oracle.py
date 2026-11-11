"""Check captured client pixels, independently of DOM video bounds or decoded canvases.

The owned fixture video has four solid quadrants. Phase 1 rotates phase 0's
colors by one quadrant. The caller must bind captures to its HWND/process and
check advancing media time/frames; a passing still image alone is not playback
or physical-GPU qualification. This module never captures or launches anything.
"""

import argparse
import hashlib
import json
import math
import statistics
import struct
import sys
from pathlib import Path

PALETTE = ((220, 40, 40), (40, 220, 40), (40, 40, 220), (220, 220, 40))
MAX_BYTES = 64 * 1024 * 1024
MAX_DIMENSION = 4096
COLOR_TOLERANCE = 48
BLACK_TOLERANCE = 24
PATCH_RADIUS = 2


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Bitmap:
    """Bounded uncompressed Windows BMP, including padded rows and top-down DIBs."""

    def __init__(self, data):
        require(54 <= len(data) <= MAX_BYTES, "BMP byte size outside bounds")
        require(data[:2] == b"BM", "not a BMP")
        size, reserved, offset = struct.unpack_from("<III", data, 2)
        require(size == len(data) and reserved == 0, "invalid BMP file header")
        dib, width, height, planes, depth, compression, image_size = struct.unpack_from("<IiiHHII", data, 14)
        require(dib in (40, 108, 124) and 14 + dib <= offset <= len(data), "unsupported BMP header or pixel offset")
        require(64 <= width <= MAX_DIMENSION and 64 <= abs(height) <= MAX_DIMENSION, "BMP dimensions outside bounds")
        require(planes == 1 and depth in (24, 32) and compression == 0, "BMP must be uncompressed RGB24/RGB32")
        self.width, self.height = width, abs(height)
        self.top_down = height < 0
        self.bytes_per_pixel = depth // 8
        self.stride = (width * self.bytes_per_pixel + 3) & ~3
        require(image_size in (0, self.stride * self.height), "invalid BMP pixel size")
        require(offset + self.stride * self.height == len(data), "truncated or trailing BMP pixels")
        self.data, self.offset = data, offset

    def rgb(self, x, y):
        require(0 <= x < self.width and 0 <= y < self.height, "pixel outside client capture")
        row = y if self.top_down else self.height - 1 - y
        start = self.offset + row * self.stride + x * self.bytes_per_pixel
        blue, green, red = self.data[start:start + 3]
        return red, green, blue


def video_rect(width, height, video_width, video_height, mode):
    require(mode in ("fit", "fill"), "mode must be fit or fill")
    require(all(type(v) is int and 1 <= v <= 8192 for v in (video_width, video_height)), "invalid video dimensions")
    scale = (min if mode == "fit" else max)(width / video_width, height / video_height)
    # Independent reference for the centered aspect, not the observed DOMRect.
    fitted_width, fitted_height = video_width * scale, video_height * scale
    return (width - fitted_width) / 2, (height - fitted_height) / 2, fitted_width, fitted_height


def patch(bitmap, x, y, expected, tolerance, label):
    x, y = math.floor(x), math.floor(y)
    colors = [bitmap.rgb(px, py)
              for py in range(y - PATCH_RADIUS, y + PATCH_RADIUS + 1)
              for px in range(x - PATCH_RADIUS, x + PATCH_RADIUS + 1)]
    matches = sum(all(abs(actual - wanted) <= tolerance for actual, wanted in zip(rgb, expected)) for rgb in colors)
    median = tuple(statistics.median(rgb[channel] for rgb in colors) for channel in range(3))
    require(matches / len(colors) >= .9, f"{label}: wrong captured pixels at ({x}, {y}); RGB median {median}")
    return {"label": label, "x": x, "y": y, "median": median, "matches": matches, "pixels": len(colors)}


def analyze_bmp(data, *, phase, mode="fit", video_width=640, video_height=360,
                client_width=None, client_height=None):
    require(type(phase) is int and phase in (0, 1), "phase must be 0 or 1")
    bitmap = Bitmap(data)
    if client_width is not None or client_height is not None:
        require(type(client_width) is int and type(client_height) is int
                and (client_width, client_height) == (bitmap.width, bitmap.height), "client capture dimensions mismatch")
    left, top, width, height = video_rect(bitmap.width, bitmap.height, video_width, video_height, mode)
    samples = []
    for quadrant in range(4):
        qx, qy = quadrant % 2, quadrant // 2
        x0, y0 = max(0, left + qx * width / 2), max(0, top + qy * height / 2)
        x1 = min(bitmap.width, left + (qx + 1) * width / 2)
        y1 = min(bitmap.height, top + (qy + 1) * height / 2)
        require(x1 - x0 >= 16 and y1 - y0 >= 16, "visible video quadrant is too small to qualify")
        # Probe both near the outer edges and in the interior. Center-only
        # samples could miss an undersized, centered compositor surface.
        inset = max(PATCH_RADIUS + 2, min(x1 - x0, y1 - y0) * .02)
        for y in (y0 + inset, (y0 + y1) / 2, y1 - inset):
            for x in (x0 + inset, (x0 + x1) / 2, x1 - inset):
                samples.append(patch(bitmap, x, y, PALETTE[(quadrant + phase) % 4],
                                     COLOR_TOLERANCE, f"quadrant-{quadrant}"))
    # Ignore only sub-patch-width bars caused by one-pixel viewport rounding.
    if mode == "fit":
        bars = []
        if left >= 2 * PATCH_RADIUS + 4:
            bars.extend((x, bitmap.height * fraction) for x in (left / 2, bitmap.width - left / 2)
                        for fraction in (.25, .5, .75))
        if top >= 2 * PATCH_RADIUS + 4:
            bars.extend((bitmap.width * fraction, y) for y in (top / 2, bitmap.height - top / 2)
                        for fraction in (.25, .5, .75))
        samples.extend(patch(bitmap, x, y, (0, 0, 0), BLACK_TOLERANCE, "letterbox") for x, y in bars)
    return {"status": "pass", "capture_sha256": hashlib.sha256(data).hexdigest(),
            "client": {"width": bitmap.width, "height": bitmap.height},
            "video": {"width": video_width, "height": video_height}, "mode": mode, "phase": phase,
            "expected_rect": {"x": left, "y": top, "width": width, "height": height},
            "color_tolerance": COLOR_TOLERANCE, "samples": samples,
            "scope": "Captured fixture pixels only; caller must prove capture ownership and advancing playback"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bmp", required=True, type=Path)
    parser.add_argument("--phase", required=True, type=int, choices=(0, 1))
    parser.add_argument("--mode", choices=("fit", "fill"), default="fit")
    parser.add_argument("--video-width", type=int, default=640)
    parser.add_argument("--video-height", type=int, default=360)
    parser.add_argument("--client-width", type=int, required=True)
    parser.add_argument("--client-height", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        with args.bmp.open("rb") as source:
            data = source.read(MAX_BYTES + 1)
        result = analyze_bmp(data, phase=args.phase, mode=args.mode, video_width=args.video_width,
                             video_height=args.video_height, client_width=args.client_width,
                             client_height=args.client_height)
    except (OSError, ValueError, struct.error) as error:
        print(json.dumps({"status": "fail", "error": str(error)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
