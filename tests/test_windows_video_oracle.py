"""Pure screenshot-oracle controls; no Windows, browser, player or decoder launch."""

import importlib.util
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("video_oracle", ROOT / "scripts/windows-video-oracle.py")
ORACLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ORACLE)


def bmp(width, height, pixel, *, depth=24, top_down=False):
    """Independent BMP writer with padding deliberately set to non-black bytes."""
    stride = (width * (depth // 8) + 3) & ~3
    image = bytearray()
    for y in (range(height) if top_down else reversed(range(height))):
        row = bytearray()
        for x in range(width):
            red, green, blue = pixel(x, y)
            row.extend((blue, green, red))
            if depth == 32:
                row.append(0)  # BI_RGB's unused alpha byte must not blank RGB.
        row.extend(b"\x91" * (stride - len(row)))
        image.extend(row)
    return (b"BM" + struct.pack("<III", 54 + len(image), 0, 54)
            + struct.pack("<IiiHHIIiiII", 40, width, -height if top_down else height,
                          1, depth, 0, len(image), 0, 0, 0, 0) + image)


def frame(width=320, height=180, *, phase=0, rect=None, depth=24, top_down=False,
          occlude=False, background=(0, 0, 0), noise=0):
    # Rectangles are explicit test expectations, not computed with the oracle.
    left, top, fw, fh = rect or (0, 0, width, height)
    colors = ((220, 40, 40), (40, 220, 40), (40, 40, 220), (220, 220, 40))

    def pixel(x, y):
        if not (left <= x < left + fw and top <= y < top + fh):
            return background
        q = (2 if y >= top + fh / 2 else 0) + (1 if x >= left + fw / 2 else 0)
        if occlude and q == 3:
            return 0, 0, 0
        return tuple(value + (noise if (x + y) % 2 else -noise) for value in colors[(q + phase) % 4])

    return bmp(width, height, pixel, depth=depth, top_down=top_down)


class WindowsVideoOracle(unittest.TestCase):
    def check(self, data, **kwargs):
        return ORACLE.analyze_bmp(data, phase=kwargs.pop("phase", 0), **kwargs)

    def test_full_plane_rgb24_rgb32_and_both_row_orders(self):
        for depth in (24, 32):
            for top_down in (False, True):
                with self.subTest(depth=depth, top_down=top_down):
                    result = self.check(frame(depth=depth, top_down=top_down), client_width=320, client_height=180)
                    self.assertEqual(result["status"], "pass")
                    self.assertEqual(len(result["samples"]), 36)

    def test_padded_rows_and_one_pixel_letterbox_rounding(self):
        for width, height, rect in ((321, 180, (0, 0, 321, 180)), (320, 181, (0, 0, 320, 181))):
            with self.subTest(width=width, height=height):
                self.check(frame(width, height, rect=rect))

    def test_fit_letterbox_and_pillarbox(self):
        cases = ((320, 240, (0, 30, 320, 180), 640, 360), (320, 180, (40, 0, 240, 180), 480, 360))
        for width, height, rect, vw, vh in cases:
            with self.subTest(size=(width, height), source=(vw, vh)):
                result = self.check(frame(width, height, rect=rect), video_width=vw, video_height=vh)
                self.assertEqual(sum(sample["label"] == "letterbox" for sample in result["samples"]), 6)

    def test_fill_center_crop_for_both_aspects(self):
        for width, height, rect, vw, vh in ((320, 240, (-53.333, 0, 426.666, 240), 640, 360),
                                          (320, 180, (0, -30, 320, 240), 480, 360)):
            with self.subTest(size=(width, height), source=(vw, vh)):
                self.check(frame(width, height, rect=rect), mode="fill", video_width=vw, video_height=vh)

    def test_codec_variation_passes_without_accepting_wrong_colors(self):
        self.check(frame(noise=20))
        with self.assertRaisesRegex(ValueError, "wrong captured pixels"):
            self.check(bmp(320, 180, lambda x, y: (120, 120, 120)))

    def test_small_top_left_video_fails_despite_full_dom_record_and_decoded_frames(self):
        misleading_record = {"rect": {"x": 0, "y": 0, "width": 320, "height": 180},
                             "decodedPixels": 144, "frames": 120}
        self.assertEqual(misleading_record["rect"]["width"], 320)
        self.assertGreater(misleading_record["frames"], 0)
        with self.assertRaisesRegex(ValueError, "wrong captured pixels"):
            self.check(frame(rect=(0, 0, 80, 45)))

    def test_near_edge_samples_reject_centered_underfill(self):
        with self.assertRaisesRegex(ValueError, "wrong captured pixels"):
            self.check(frame(rect=(16, 9, 288, 162)))

    def test_blank_occlusion_wrong_alignment_and_wrong_fit_mode_fail(self):
        cases = (bmp(320, 180, lambda x, y: (0, 0, 0)), frame(occlude=True),
                 frame(320, 240, rect=(0, 0, 320, 180)), frame(320, 240))
        for index, data in enumerate(cases):
            with self.subTest(case=index), self.assertRaisesRegex(ValueError, "wrong captured pixels"):
                self.check(data)

    def test_bad_letterbox_is_not_accepted_as_valid_fit(self):
        with self.assertRaisesRegex(ValueError, "letterbox: wrong captured pixels"):
            self.check(frame(320, 240, rect=(0, 30, 320, 180), background=(100, 100, 100)))

    def test_two_video_phases_reject_stale_image_or_static_ui_mosaic(self):
        old = frame(phase=0)
        current = frame(phase=1)
        self.check(old, phase=0)
        self.check(current, phase=1)
        with self.assertRaisesRegex(ValueError, "wrong captured pixels"):
            self.check(old, phase=1)
        # Pixel evidence alone cannot prove time advancement: the driver must
        # additionally reject unchanged currentTime/totalVideoFrames and owner.
        self.assertNotEqual(self.check(old)["capture_sha256"], self.check(current, phase=1)["capture_sha256"])

    def test_client_dimensions_are_bound_to_captured_bmp(self):
        with self.assertRaisesRegex(ValueError, "client capture dimensions mismatch"):
            self.check(frame(), client_width=1280, client_height=720)

    def test_malformed_or_unbounded_bmp_fails_closed(self):
        valid = frame()
        cases = [b"", valid[:-1], valid + b"\0", b"ZZ" + valid[2:]]
        for offset, fmt, value in ((10, "I", 10), (14, "I", 12), (18, "i", 100000),
                                   (22, "i", 0), (26, "H", 2), (28, "H", 8), (30, "I", 1), (34, "I", 1)):
            altered = bytearray(valid)
            struct.pack_into("<" + fmt, altered, offset, value)
            cases.append(bytes(altered))
        for index, data in enumerate(cases):
            with self.subTest(case=index), self.assertRaises(ValueError):
                self.check(data)

    def test_invalid_expected_inputs_fail_closed(self):
        for kwargs in ({"phase": True}, {"phase": 2}, {"mode": "stretch"}, {"video_width": 0},
                       {"video_height": float("nan")}, {"client_width": True, "client_height": 180}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.check(frame(), **kwargs)

    def test_cli_reports_pixel_success_and_failure_without_launching_native_code(self):
        with tempfile.TemporaryDirectory(prefix="video-oracle-") as directory:
            path = Path(directory) / "capture.bmp"
            path.write_bytes(frame())
            command = [sys.executable, str(ROOT / "scripts/windows-video-oracle.py"), "--bmp", str(path),
                       "--client-width", "320", "--client-height", "180", "--phase"]
            for phase, status, code in (("0", "pass", 0), ("1", "fail", 1)):
                result = subprocess.run(command + [phase], capture_output=True, text=True, timeout=10, check=False)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual(json.loads(result.stdout)["status"], status)


if __name__ == "__main__":
    unittest.main()
