"""Portable contracts for the bounded Windows compositor capture helper."""
import ctypes
import importlib.util
import io
import json
import struct
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "windows_video_capture", ROOT / "scripts/windows-video-capture.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class WindowsVideoCaptureContracts(unittest.TestCase):
    def test_win32_bindings_use_the_declaring_system_dll_and_pointer_widths(self):
        class Export:
            def __init__(self, name):
                self.name = name
                self.argtypes = None
                self.restype = None

            def __call__(self, *args):
                raise AssertionError("Binding contract must not invoke Win32 exports")

        class ExportTable:
            def __init__(self, label, names):
                self.label = label
                self.names = set(names)
                self.exports = {}

            def __getattr__(self, name):
                if name not in self.names:
                    raise AssertionError(f"{self.label}.dll has no {name} export")
                return self.exports.setdefault(name, Export(name))

        user32_names = {
            "SetThreadDpiAwarenessContext", "EnumWindows", "IsWindowVisible", "IsIconic",
            "GetWindow", "GetAncestor", "GetForegroundWindow", "WindowFromPoint",
            "GetWindowThreadProcessId", "GetWindowLongPtrW", "GetWindowRect", "GetClientRect",
            "ClientToScreen", "GetDpiForWindow", "MonitorFromWindow", "GetMonitorInfoW",
            "SetWindowPos", "AdjustWindowRectExForDpi", "GetWindowTextLengthW", "GetWindowTextW",
            "GetWindowDC", "ReleaseDC",
        }
        gdi32_names = {"CreateCompatibleDC", "DeleteDC", "CreateCompatibleBitmap", "SelectObject",
                       "DeleteObject", "BitBlt", "GetDIBits"}
        dwmapi_names = {"DwmFlush"}
        api = MODULE.Win32.__new__(MODULE.Win32)
        api.user32 = ExportTable("user32", user32_names)
        api.gdi32 = ExportTable("gdi32", gdi32_names)
        api.dwmapi = ExportTable("dwmapi", dwmapi_names)
        with patch.object(MODULE.ctypes, "WINFUNCTYPE", MODULE.ctypes.CFUNCTYPE, create=True):
            api._bind()

        self.assertIn("GetWindowDC", api.user32.exports)
        self.assertIn("ReleaseDC", api.user32.exports)
        self.assertNotIn("GetWindowDC", api.gdi32.exports)
        self.assertNotIn("ReleaseDC", api.gdi32.exports)
        self.assertEqual(api.user32.exports["GetWindowDC"].argtypes, [MODULE.wintypes.HWND])
        self.assertEqual(api.user32.exports["GetWindowDC"].restype, MODULE.wintypes.HDC)
        self.assertEqual(api.user32.exports["ReleaseDC"].argtypes,
                         [MODULE.wintypes.HWND, MODULE.wintypes.HDC])
        self.assertEqual(api.user32.exports["ReleaseDC"].restype, ctypes.c_int)
        self.assertEqual(ctypes.sizeof(MODULE.wintypes.HWND), ctypes.sizeof(ctypes.c_void_p))
        self.assertEqual(api.user32.exports["GetWindowLongPtrW"].restype, ctypes.c_ssize_t)

    def test_real_win32_dll_exports_bind_on_windows(self):
        if __import__("os").name != "nt":
            self.skipTest("Real Win32 export resolution runs on the Windows CI runner")
        api = MODULE.Win32()
        self.assertTrue(api.user32.GetWindowDC)
        self.assertTrue(api.user32.ReleaseDC)
        self.assertTrue(api.gdi32.BitBlt)

    def test_bmp_is_top_down_32_bit_and_hashable(self):
        pixels = bytes(range(16))
        encoded = MODULE.bmp_bytes(2, 2, pixels)
        self.assertEqual(encoded[:2], b"BM")
        file_size, _, _, offset = struct.unpack("<IHHI", encoded[2:14])
        self.assertEqual(file_size, len(encoded))
        self.assertEqual(offset, 54)
        header = struct.unpack("<IiiHHIIiiII", encoded[14:54])
        self.assertEqual(header[:6], (40, 2, -2, 1, 32, 0))
        self.assertEqual(encoded[offset:], pixels)

    def test_cli_requires_owned_pid_bmp_and_paired_resize(self):
        args = MODULE.parse_args(["--pid", "12", "--output", "capture.bmp"])
        self.assertEqual(args.pid, 12)
        self.assertIsNone(args.width)
        with self.assertRaisesRegex(RuntimeError, "supplied together"):
            MODULE.parse_args(["--pid", "12", "--output", "capture.bmp", "--width", "800"])
        with self.assertRaisesRegex(RuntimeError, "requires"):
            MODULE.parse_args(["--pid", "12", "--output", "capture.bmp", "--resize-only"])
        with self.assertRaisesRegex(RuntimeError, "positive"):
            MODULE.parse_args(["--pid", "0", "--output", "capture.bmp"])
        with self.assertRaisesRegex(RuntimeError, "extension"):
            MODULE.parse_args(["--pid", "12", "--output", "capture.png"])

    def test_resize_bounds_and_pixel_budget_are_enforced(self):
        with self.assertRaisesRegex(RuntimeError, "bounds"):
            MODULE.parse_args(["--pid", "12", "--output", "capture.bmp",
                               "--width", "5000", "--height", "720"])
        with self.assertRaisesRegex(RuntimeError, "invalid size"):
            MODULE.bmp_bytes(2, 2, b"too short")
        with patch.object(MODULE, "MAX_CAPTURE_BYTES", 15), \
                self.assertRaisesRegex(RuntimeError, "budget"):
            MODULE.bmp_bytes(2, 2, bytes(16))

    def test_client_capture_bounds_must_fit_entire_monitor(self):
        geometry = {"client_origin": [100, 100], "client_size": [800, 450],
                    "monitor_rect": [0, 0, 1920, 1080]}
        MODULE.Win32._assert_client_on_monitor(geometry)
        for origin in ([-1, 0], [1200, 700]):
            with self.subTest(origin=origin), self.assertRaisesRegex(RuntimeError, "monitor bounds"):
                MODULE.Win32._assert_client_on_monitor(dict(geometry, client_origin=origin))

    def test_non_windows_failure_is_machine_readable_and_not_a_pass(self):
        if __import__("os").name == "nt":
            self.skipTest("This contract exercises the non-Windows refusal")
        stream = io.StringIO()
        with redirect_stdout(stream):
            result = MODULE.main(["--pid", "12", "--output", "capture.bmp"])
        self.assertEqual(result, 1)
        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["schema"], 1)
        self.assertEqual(payload["status"], "failed")
        self.assertIn("only runs on Windows", payload["error"])


if __name__ == "__main__":
    unittest.main()
