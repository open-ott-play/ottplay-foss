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
    def test_z_order_audit_catches_an_interior_overlay_missed_by_corner_samples(self):
        class FakeUser32:
            def __init__(self):
                self.above = {10: 20, 20: 0}
                self.rects = {20: [450, 350, 550, 450]}

            def GetWindow(self, hwnd, command):
                self.assert_command(command)
                return self.above.get(hwnd, 0)

            @staticmethod
            def assert_command(command):
                if command != 3:  # GW_HWNDPREV
                    raise AssertionError("Expected bounded top-to-bottom Z-order walk")

            def IsWindowVisible(self, hwnd):
                return True

            def GetWindowRect(self, hwnd, pointer):
                rect = ctypes.cast(pointer, ctypes.POINTER(MODULE.wintypes.RECT)).contents
                rect.left, rect.top, rect.right, rect.bottom = self.rects[hwnd]
                return True

            def GetWindowThreadProcessId(self, hwnd, pointer):
                ctypes.cast(pointer, ctypes.POINTER(MODULE.wintypes.DWORD)).contents.value = 987
                return 1

        class FakeDwmapi:
            @staticmethod
            def DwmGetWindowAttribute(_hwnd, _attribute, _pointer, _size):
                return -2147467259  # E_FAIL: absence of cloak proof is conservative.

        api = MODULE.Win32.__new__(MODULE.Win32)
        api.user32 = FakeUser32()
        api.dwmapi = FakeDwmapi()
        geometry = {"client_origin": [100, 100], "client_size": [800, 600]}
        # The overlay is centered, so all four corner samples can still be the app.
        with self.assertRaisesRegex(RuntimeError, "intersects capture bounds"):
            api._assert_z_order_unoccluded(10, geometry)

    def test_z_order_audit_runs_again_after_capture_and_detects_new_overlay(self):
        class FakeUser32:
            def __init__(self):
                self.above = {10: 0}
                self.rects = {}

            def GetWindow(self, hwnd, command):
                self.assert_command(command)
                return self.above.get(hwnd, 0)

            @staticmethod
            def assert_command(command):
                if command != 3:
                    raise AssertionError("Expected GW_HWNDPREV")

            def IsWindowVisible(self, hwnd):
                return True

            def GetWindowRect(self, hwnd, pointer):
                rect = ctypes.cast(pointer, ctypes.POINTER(MODULE.wintypes.RECT)).contents
                rect.left, rect.top, rect.right, rect.bottom = self.rects[hwnd]
                return True

            def GetWindowThreadProcessId(self, hwnd, pointer):
                ctypes.cast(pointer, ctypes.POINTER(MODULE.wintypes.DWORD)).contents.value = 987
                return 1

        class FakeDwmapi:
            @staticmethod
            def DwmGetWindowAttribute(_hwnd, _attribute, _pointer, _size):
                return -2147467259

        api = MODULE.Win32.__new__(MODULE.Win32)
        api.user32 = FakeUser32()
        api.dwmapi = FakeDwmapi()
        geometry = {"client_origin": [100, 100], "client_size": [800, 600]}
        self.assertEqual(api._assert_z_order_unoccluded(10, geometry)["intersecting_windows"], 0)
        # Simulate a desktop overlay arriving between the pre- and post-capture audits.
        api.user32.above = {10: 20, 20: 0}
        api.user32.rects[20] = [300, 300, 400, 400]
        with self.assertRaisesRegex(RuntimeError, "intersects capture bounds"):
            api._assert_z_order_unoccluded(10, geometry)

    def test_z_order_ignores_only_dwm_proven_cloaked_foreign_windows(self):
        class FakeUser32:
            def GetWindow(self, hwnd, command):
                if command != 3:  # GW_HWNDPREV
                    raise AssertionError("Expected GW_HWNDPREV")
                return {10: 20, 20: 0}.get(hwnd, 0)

            @staticmethod
            def IsWindowVisible(_hwnd):
                return True

            @staticmethod
            def GetWindowRect(_hwnd, pointer):
                rect = ctypes.cast(pointer, ctypes.POINTER(MODULE.wintypes.RECT)).contents
                rect.left, rect.top, rect.right, rect.bottom = 300, 300, 400, 400
                return True

            @staticmethod
            def GetWindowThreadProcessId(_hwnd, pointer):
                ctypes.cast(pointer, ctypes.POINTER(MODULE.wintypes.DWORD)).contents.value = 987
                return 1

        class FakeDwmapi:
            def __init__(self, result, mask):
                self.result = result
                self.mask = mask
                self.calls = []

            def DwmGetWindowAttribute(self, hwnd, attribute, pointer, size):
                self.calls.append((hwnd, attribute, size))
                if attribute != 14:  # DWMWA_CLOAKED
                    raise AssertionError("Expected DWMWA_CLOAKED")
                if self.result >= 0:
                    ctypes.cast(pointer, ctypes.POINTER(MODULE.wintypes.DWORD)).contents.value = self.mask
                return self.result

        geometry = {"client_origin": [100, 100], "client_size": [800, 600]}
        for mask in (1, 2, 4, 7):
            with self.subTest(cloaked_mask=mask):
                api = MODULE.Win32.__new__(MODULE.Win32)
                api.user32 = FakeUser32()
                api.dwmapi = FakeDwmapi(0, mask)
                result = api._assert_z_order_unoccluded(10, geometry)
                self.assertEqual(result["intersecting_windows"], 0)
                self.assertEqual(result["cloaked_windows_ignored"], 1)
                self.assertEqual(api.dwmapi.calls, [(20, 14, ctypes.sizeof(MODULE.wintypes.DWORD))])

        for result, message in ((0, "uncloaked"), (-2147467259, "unknown")):
            with self.subTest(dwm_result=result):
                api = MODULE.Win32.__new__(MODULE.Win32)
                api.user32 = FakeUser32()
                api.dwmapi = FakeDwmapi(result, 0)
                with self.assertRaisesRegex(RuntimeError, message):
                    api._assert_z_order_unoccluded(10, geometry)

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
        dwmapi_names = {"DwmFlush", "DwmGetWindowAttribute"}
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
        self.assertEqual(api.dwmapi.exports["DwmGetWindowAttribute"].argtypes,
                         [MODULE.wintypes.HWND, MODULE.wintypes.DWORD,
                          ctypes.c_void_p, MODULE.wintypes.DWORD])
        self.assertEqual(api.dwmapi.exports["DwmGetWindowAttribute"].restype, ctypes.c_long)

    def test_real_win32_dll_exports_bind_on_windows(self):
        if __import__("os").name != "nt":
            self.skipTest("Real Win32 export resolution runs on the Windows CI runner")
        api = MODULE.Win32()
        self.assertTrue(api.user32.GetWindowDC)
        self.assertTrue(api.user32.ReleaseDC)
        self.assertTrue(api.gdi32.BitBlt)
        self.assertTrue(api.dwmapi.DwmGetWindowAttribute)

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

    def test_inspect_cli_requires_no_output_or_resize_arguments(self):
        args = MODULE.parse_args(["--pid", "12", "--inspect-only"])
        self.assertTrue(args.inspect_only)
        self.assertIsNone(args.output)
        for extra in (["--output", "capture.bmp"], ["--width", "800"],
                      ["--height", "450"], ["--resize-only"],
                      ["--width", "800", "--height", "450"]):
            with self.subTest(extra=extra), self.assertRaisesRegex(RuntimeError, "cannot be combined"):
                MODULE.parse_args(["--pid", "12", "--inspect-only", *extra])
        with self.assertRaisesRegex(RuntimeError, "requires --output"):
            MODULE.parse_args(["--pid", "12"])
        resized = MODULE.parse_args(["--pid", "12", "--output", "capture.bmp",
                                     "--width", "800", "--height", "450", "--resize-only"])
        self.assertTrue(resized.resize_only)
        self.assertFalse(resized.inspect_only)

    def test_inspection_reads_owned_geometry_without_pixels_or_mutation(self):
        class ForbiddenAPI:
            def __getattr__(self, name):
                raise AssertionError(f"Inspection must not call {name}")

        class FakeWin32(MODULE.Win32):
            def __init__(self):
                self.dwmapi = ForbiddenAPI()
                self.gdi32 = ForbiddenAPI()
                self.user32 = ForbiddenAPI()
                self.checked = []
                self.geometry = {"client_origin": [24, 17], "client_size": [1281, 721],
                                 "monitor_rect": [0, 0, 1920, 1080], "monitor_primary": True, "dpi": 96}

            def set_dpi_context(self):
                return 1

            def owned_window(self, pid):
                self.checked.append(("enumerate", pid))
                return [(10, "private title must not be returned")]

            def _assert_owned_visible_window(self, hwnd, pid):
                self.checked.append(("owned-visible-uncloaked", hwnd, pid))

            def _geometry(self, hwnd):
                self.checked.append(("geometry", hwnd))
                return self.geometry

            def _assert_foreground_and_unoccluded(self, hwnd, geometry):
                self.checked.append(("foreground", hwnd))

            def capture_bmp(self, *args):
                raise AssertionError("Inspection must not capture")

            def resize_client_once(self, *args):
                raise AssertionError("Inspection must not resize")

        api = FakeWin32()
        args = MODULE.parse_args(["--pid", "12", "--inspect-only"])
        with patch.object(MODULE, "Win32", return_value=api):
            result = MODULE.run(args)
        self.assertEqual(result, {"schema": 1, "status": "pass", "action": "inspect-only",
                                  "pid": 12, "hwnd": "0xa", "window": api.geometry})
        self.assertEqual(api.checked.count(("owned-visible-uncloaked", 10, 12)), 2)
        self.assertEqual(api.checked.count(("geometry", 10)), 2)
        self.assertIn(("foreground", 10), api.checked)
        api.geometry["client_origin"] = [1000, 800]
        with patch.object(MODULE, "Win32", return_value=api), \
                self.assertRaisesRegex(RuntimeError, "monitor bounds"):
            MODULE.run(args)
        api.geometry["client_origin"] = [24, 17]
        with patch.object(MODULE, "Win32", return_value=api), \
                patch.object(api, "_assert_owned_visible_window", side_effect=RuntimeError("cloaked")), \
                self.assertRaisesRegex(RuntimeError, "cloaked"):
            MODULE.run(args)
        with patch.object(MODULE, "Win32", return_value=api), \
                patch.object(api, "_assert_foreground_and_unoccluded", side_effect=RuntimeError("foreground")), \
                self.assertRaisesRegex(RuntimeError, "foreground"):
            MODULE.run(args)
        with patch.object(MODULE, "Win32", return_value=api), \
                patch.object(api, "_geometry", side_effect=[api.geometry, dict(api.geometry, dpi=120)]), \
                self.assertRaisesRegex(RuntimeError, "changed during inspection"):
            MODULE.run(args)

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
                    "monitor_rect": [0, 0, 1920, 1080], "monitor_primary": True}
        MODULE.Win32._assert_client_on_monitor(geometry)
        for origin in ([-1, 0], [1200, 700]):
            with self.subTest(origin=origin), self.assertRaisesRegex(RuntimeError, "monitor bounds"):
                MODULE.Win32._assert_client_on_monitor(dict(geometry, client_origin=origin))

    def test_secondary_or_unknown_monitor_is_rejected_before_capture(self):
        geometry = {"client_origin": [2020, 100], "client_size": [800, 450],
                    "monitor_rect": [1920, 0, 3840, 1080]}
        for primary in (False, None, 1):
            with self.subTest(primary=primary), self.assertRaisesRegex(RuntimeError, "primary monitor"):
                MODULE.Win32._assert_client_on_monitor(dict(geometry, monitor_primary=primary))
        with self.assertRaisesRegex(RuntimeError, "primary monitor"):
            MODULE.Win32._assert_client_on_monitor(geometry)

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
