"""Capture the real, visible client pixels of one owned Windows video window.

This helper never starts, activates, moves-to-front, or terminates an app. An
optional one-shot client resize is intended for deterministic pre-playback test
setup. Captures use desktop GDI BitBlt; PrintWindow is deliberately not used.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import struct
import time
from ctypes import wintypes
from pathlib import Path

MAX_WIDTH = 3840
MAX_HEIGHT = 2160
MAX_CAPTURE_BYTES = 32 * 1024 * 1024
WINDOW_WAIT_SECONDS = 12
CAPTURE_WAIT_SECONDS = 3
PROCESS_DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = ctypes.c_void_p(-4)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def rects_intersect(first, second) -> bool:
    """Use half-open desktop rectangles so adjacent edges are not occlusions."""
    return first[0] < second[2] and second[0] < first[2] \
        and first[1] < second[3] and second[1] < first[3]


def bmp_bytes(width: int, height: int, bgra: bytes) -> bytes:
    """Encode top-down 32-bit BGRA pixels as a standards-compliant BMP."""
    require(type(width) is int and 0 < width <= MAX_WIDTH, "Invalid capture width")
    require(type(height) is int and 0 < height <= MAX_HEIGHT, "Invalid capture height")
    expected = width * height * 4
    require(expected <= MAX_CAPTURE_BYTES, "Capture pixel buffer exceeds byte budget")
    require(len(bgra) == expected, "Capture pixel buffer has an invalid size")
    # Negative biHeight marks top-down rows, matching the GDI buffer layout.
    info = struct.pack("<IiiHHIIiiII", 40, width, -height, 1, 32, 0,
                       expected, 0, 0, 0, 0)
    offset = 14 + len(info)
    header = struct.pack("<2sIHHI", b"BM", offset + expected, 0, 0, offset)
    return header + info + bgra


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inspect-only", action="store_true",
                        help="report owned visible client geometry without capture or resize")
    parser.add_argument("--width", type=int, help="one-shot client width resize")
    parser.add_argument("--height", type=int, help="one-shot client height resize")
    parser.add_argument("--resize-only", action="store_true",
                        help="resize/report without taking a screenshot")
    args = parser.parse_args(argv)
    require(args.pid > 0, "PID must be a positive integer")
    if args.inspect_only:
        require(args.output is None and args.width is None and args.height is None and not args.resize_only,
                "--inspect-only cannot be combined with output or resize options")
        return args
    require(args.output is not None, "Capture or resize requires --output")
    require((args.width is None) == (args.height is None),
            "--width and --height must be supplied together")
    require(not args.resize_only or args.width is not None,
            "--resize-only requires --width and --height")
    if args.width is not None:
        require(0 < args.width <= MAX_WIDTH and 0 < args.height <= MAX_HEIGHT,
                "Requested client dimensions are outside the supported bounds")
    require(args.output.suffix.lower() == ".bmp", "Output must use the .bmp extension")
    return args


class Win32:
    """Narrow Win32 bindings; initialized only on Windows."""
    def __init__(self):
        require(os.name == "nt", "This helper only runs on Windows")
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
        self.dwmapi = ctypes.WinDLL("dwmapi", use_last_error=True)
        self._bind()

    def _bind(self):
        u, g, d = self.user32, self.gdi32, self.dwmapi
        self.EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        u.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        u.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
        u.EnumWindows.argtypes = [self.EnumWindowsProc, wintypes.LPARAM]
        u.EnumWindows.restype = wintypes.BOOL
        u.IsWindowVisible.argtypes = [wintypes.HWND]
        u.IsWindowVisible.restype = wintypes.BOOL
        u.IsIconic.argtypes = [wintypes.HWND]
        u.IsIconic.restype = wintypes.BOOL
        u.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
        u.GetWindow.restype = wintypes.HWND
        u.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        u.GetAncestor.restype = wintypes.HWND
        u.GetForegroundWindow.argtypes = []
        u.GetForegroundWindow.restype = wintypes.HWND
        u.WindowFromPoint.argtypes = [wintypes.POINT]
        u.WindowFromPoint.restype = wintypes.HWND
        u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        u.GetWindowThreadProcessId.restype = wintypes.DWORD
        u.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
        u.GetWindowLongPtrW.restype = ctypes.c_ssize_t
        u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        u.GetWindowRect.restype = wintypes.BOOL
        u.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        u.GetClientRect.restype = wintypes.BOOL
        u.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
        u.ClientToScreen.restype = wintypes.BOOL
        u.GetDpiForWindow.argtypes = [wintypes.HWND]
        u.GetDpiForWindow.restype = wintypes.UINT
        u.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
        u.MonitorFromWindow.restype = wintypes.HANDLE
        u.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
        u.GetMonitorInfoW.restype = wintypes.BOOL
        u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wintypes.UINT]
        u.SetWindowPos.restype = wintypes.BOOL
        u.AdjustWindowRectExForDpi.argtypes = [ctypes.POINTER(wintypes.RECT), wintypes.DWORD,
                                               wintypes.BOOL, wintypes.DWORD, wintypes.UINT]
        u.AdjustWindowRectExForDpi.restype = wintypes.BOOL
        u.GetWindowTextLengthW.argtypes = [wintypes.HWND]
        u.GetWindowTextLengthW.restype = ctypes.c_int
        u.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        u.GetWindowTextW.restype = ctypes.c_int
        u.GetWindowDC.argtypes = [wintypes.HWND]
        u.GetWindowDC.restype = wintypes.HDC
        u.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
        u.ReleaseDC.restype = ctypes.c_int
        g.CreateCompatibleDC.argtypes = [wintypes.HDC]
        g.CreateCompatibleDC.restype = wintypes.HDC
        g.DeleteDC.argtypes = [wintypes.HDC]
        g.DeleteDC.restype = wintypes.BOOL
        g.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
        g.CreateCompatibleBitmap.restype = wintypes.HBITMAP
        g.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
        g.SelectObject.restype = wintypes.HGDIOBJ
        g.DeleteObject.argtypes = [wintypes.HGDIOBJ]
        g.DeleteObject.restype = wintypes.BOOL
        g.BitBlt.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                             ctypes.c_int, wintypes.HDC, ctypes.c_int, ctypes.c_int,
                             wintypes.DWORD]
        g.BitBlt.restype = wintypes.BOOL
        g.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT,
                                wintypes.UINT, ctypes.c_void_p,
                                ctypes.c_void_p, wintypes.UINT]
        g.GetDIBits.restype = ctypes.c_int
        d.DwmFlush.argtypes = []
        d.DwmFlush.restype = ctypes.c_long
        d.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD,
                                            ctypes.c_void_p, wintypes.DWORD]
        d.DwmGetWindowAttribute.restype = ctypes.c_long

    def set_dpi_context(self):
        # Thread-local only; do not change the spawned application's policy.
        return self.user32.SetThreadDpiAwarenessContext(
            PROCESS_DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)

    def owned_window(self, pid: int):
        windows = []

        @self.EnumWindowsProc
        def visit(hwnd, _):
            if not self.user32.IsWindowVisible(hwnd):
                return True
            owner = wintypes.DWORD()
            self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value != pid or self.user32.GetWindow(hwnd, 4):  # GW_OWNER
                return True
            ex_style = self.user32.GetWindowLongPtrW(hwnd, -20)  # GWL_EXSTYLE
            if ex_style & 0x80:  # WS_EX_TOOLWINDOW
                return True
            rect = wintypes.RECT()
            client = wintypes.RECT()
            if not self.user32.GetWindowRect(hwnd, ctypes.byref(rect)) or not self.user32.GetClientRect(hwnd, ctypes.byref(client)):
                return True
            width, height = client.right - client.left, client.bottom - client.top
            if width <= 0 or height <= 0:
                return True
            n = max(0, self.user32.GetWindowTextLengthW(hwnd))
            title = ctypes.create_unicode_buffer(min(n + 1, 1024))
            self.user32.GetWindowTextW(hwnd, title, len(title))
            windows.append((hwnd, title.value))
            return True

        if not self.user32.EnumWindows(visit, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        require(len(windows) <= 1,
                f"Expected one visible unowned top-level window for PID {pid}; found {len(windows)}")
        return windows

    def _geometry(self, hwnd):
        outer, client = wintypes.RECT(), wintypes.RECT()
        require(self.user32.GetWindowRect(hwnd, ctypes.byref(outer)), "GetWindowRect failed")
        require(self.user32.GetClientRect(hwnd, ctypes.byref(client)), "GetClientRect failed")
        origin = wintypes.POINT(client.left, client.top)
        require(self.user32.ClientToScreen(hwnd, ctypes.byref(origin)), "ClientToScreen failed")
        monitor = self.user32.MonitorFromWindow(hwnd, 2)  # MONITOR_DEFAULTTONEAREST
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(info)
        require(self.user32.GetMonitorInfoW(monitor, ctypes.byref(info)), "GetMonitorInfoW failed")
        return {
            "window_rect": [outer.left, outer.top, outer.right, outer.bottom],
            "client_origin": [origin.x, origin.y],
            "client_size": [client.right - client.left, client.bottom - client.top],
            "dpi": int(self.user32.GetDpiForWindow(hwnd)),
            "monitor_rect": [info.rcMonitor.left, info.rcMonitor.top,
                             info.rcMonitor.right, info.rcMonitor.bottom],
            "monitor_work_area": [info.rcWork.left, info.rcWork.top,
                                  info.rcWork.right, info.rcWork.bottom],
        }

    @staticmethod
    def _handle_value(hwnd):
        return hwnd if isinstance(hwnd, int) else ctypes.cast(hwnd, ctypes.c_void_p).value

    def _assert_owned_visible_window(self, hwnd, pid):
        require(bool(self.user32.IsWindowVisible(hwnd)), "Owned window became hidden")
        require(not self.user32.IsIconic(hwnd), "Owned window is minimized")
        actual_pid = wintypes.DWORD()
        require(bool(self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(actual_pid)))
                and actual_pid.value == pid,
                "HWND no longer belongs to the requested process")
        root = self.user32.GetAncestor(hwnd, 2)  # GA_ROOT
        require(self._handle_value(root) == self._handle_value(hwnd),
                "Selected HWND is no longer the root application window")
        require(self._window_is_cloaked(hwnd) is False,
                "Could not prove the owned application window is uncloaked")

    def _window_is_cloaked(self, hwnd):
        # DWMWA_CLOAKED is 14. A failed DWM query is unknown, never evidence
        # that an intersecting window is harmless.
        cloaked = wintypes.DWORD()
        result = self.dwmapi.DwmGetWindowAttribute(
            hwnd, 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
        if result < 0:
            return None
        return bool(cloaked.value)

    def _assert_foreground_and_unoccluded(self, hwnd, geometry):
        expected_root = self._handle_value(hwnd)
        foreground = self.user32.GetForegroundWindow()
        foreground_root = self.user32.GetAncestor(foreground, 2) if foreground else None
        require(foreground_root is not None
                and self._handle_value(foreground_root) == expected_root,
                "Owned video window is not the foreground window; refusing ambiguous desktop pixels")
        x, y = geometry["client_origin"]
        width, height = geometry["client_size"]
        inset_x, inset_y = min(2, max(0, (width - 1) // 4)), min(2, max(0, (height - 1) // 4))
        corners = [(x + inset_x, y + inset_y),
                   (x + width - 1 - inset_x, y + inset_y),
                   (x + inset_x, y + height - 1 - inset_y),
                   (x + width - 1 - inset_x, y + height - 1 - inset_y)]
        observations = []
        for px, py in corners:
            under = self.user32.WindowFromPoint(wintypes.POINT(px, py))
            root = self.user32.GetAncestor(under, 2) if under else None
            under_root = self._handle_value(root) if root else None
            observations.append({"point": [px, py],
                                 "window": hex(self._handle_value(under)) if under else None,
                                 "root": hex(under_root) if under_root is not None else None})
            require(under_root == expected_root,
                    f"Desktop pixel at {px},{py} is occluded or outside the owned window")
        return {"foreground_window": hex(self._handle_value(foreground)),
                "foreground_root": hex(expected_root), "corner_hits": observations}

    def _assert_z_order_unoccluded(self, hwnd, geometry):
        x, y = geometry["client_origin"]
        width, height = geometry["client_size"]
        client = [x, y, x + width, y + height]
        target = self._handle_value(hwnd)
        seen = {target}
        windows_checked = 0
        cloaked_windows_ignored = 0
        current = self.user32.GetWindow(hwnd, 3)  # GW_HWNDPREV: windows above target
        while current:
            value = self._handle_value(current)
            require(value not in seen, "Cycle while enumerating windows above the capture target")
            seen.add(value)
            windows_checked += 1
            require(windows_checked <= 512,
                    "Could not prove the capture target unobscured within the 512-window bound")
            if self.user32.IsWindowVisible(current):
                rect = wintypes.RECT()
                require(self.user32.GetWindowRect(current, ctypes.byref(rect)),
                        "Could not read a visible window's bounds during occlusion audit")
                candidate = [rect.left, rect.top, rect.right, rect.bottom]
                if rects_intersect(candidate, client):
                    cloaked = self._window_is_cloaked(current)
                    if cloaked is True:
                        cloaked_windows_ignored += 1
                        current = self.user32.GetWindow(current, 3)
                        continue
                    owner = wintypes.DWORD()
                    self.user32.GetWindowThreadProcessId(current, ctypes.byref(owner))
                    raise RuntimeError(
                        f"Visible window above the video client intersects capture bounds "
                        f"(DWM cloaked state: {'unknown' if cloaked is None else 'uncloaked'}) "
                        f"(hwnd={hex(value)}, pid={owner.value}, rect={candidate})")
            current = self.user32.GetWindow(current, 3)
        return {"windows_above_checked": windows_checked, "intersecting_windows": 0,
                "cloaked_windows_ignored": cloaked_windows_ignored}

    @staticmethod
    def _assert_client_on_monitor(geometry):
        x, y = geometry["client_origin"]
        width, height = geometry["client_size"]
        left, top, right, bottom = geometry["monitor_rect"]
        require(x >= left and y >= top and x + width <= right and y + height <= bottom,
                "The complete client area is not on-screen inside its monitor bounds")

    def resize_client_once(self, hwnd, width, height):
        dpi = int(self.user32.GetDpiForWindow(hwnd)) or 96
        style = self.user32.GetWindowLongPtrW(hwnd, -16)  # GWL_STYLE
        ex_style = self.user32.GetWindowLongPtrW(hwnd, -20)  # GWL_EXSTYLE
        rect = wintypes.RECT(0, 0, width, height)
        require(self.user32.AdjustWindowRectExForDpi(ctypes.byref(rect), style, False, ex_style, dpi),
                "AdjustWindowRectExForDpi failed")
        outer_width, outer_height = rect.right - rect.left, rect.bottom - rect.top
        before = self._geometry(hwnd)
        # Keep the original top-left. Fail instead of silently relocating or
        # changing display settings if the requested test size will not fit.
        monitor = self.user32.MonitorFromWindow(hwnd, 2)  # MONITOR_DEFAULTTONEAREST
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(info)
        require(self.user32.GetMonitorInfoW(monitor, ctypes.byref(info)), "GetMonitorInfoW failed")
        left, top = before["window_rect"][:2]
        work = info.rcWork
        require(outer_width <= work.right - work.left and outer_height <= work.bottom - work.top,
                "Requested test client size does not fit the monitor work area")
        require(left >= work.left and top >= work.top and left + outer_width <= work.right
                and top + outer_height <= work.bottom,
                "Requested resize would move the owned window outside its monitor work area")
        flags = 0x0004 | 0x0010 | 0x0200 | 0x0400  # NOZORDER|NOACTIVATE|NOOWNERZORDER|NOSENDCHANGING
        require(self.user32.SetWindowPos(hwnd, None, left, top, outer_width, outer_height, flags),
                "SetWindowPos failed for the owned window")
        after = self._geometry(hwnd)
        require(after["client_size"] == [width, height],
                f"Windows applied client size {after['client_size']}, expected {[width, height]}")
        return {"before": before, "after": after, "requested_client_size": [width, height]}

    def capture_bmp(self, hwnd, pid: int, output: Path):
        self._assert_owned_visible_window(hwnd, pid)
        geometry = self._geometry(hwnd)
        self._assert_client_on_monitor(geometry)
        ownership = self._assert_foreground_and_unoccluded(hwnd, geometry)
        z_order_before = self._assert_z_order_unoccluded(hwnd, geometry)
        x, y = geometry["client_origin"]
        width, height = geometry["client_size"]
        require(0 < width <= MAX_WIDTH and 0 < height <= MAX_HEIGHT,
                "Visible client dimensions exceed capture limits")
        require(width * height * 4 <= MAX_CAPTURE_BYTES, "Capture exceeds pixel-buffer budget")
        require(self.user32.IsWindowVisible(hwnd), "Owned window became hidden before capture")
        self.dwmapi.DwmFlush()
        screen = self.user32.GetWindowDC(None)
        require(bool(screen), "GetWindowDC failed")
        memory = bitmap = old = None
        try:
            memory = self.gdi32.CreateCompatibleDC(screen)
            require(bool(memory), "CreateCompatibleDC failed")
            bitmap = self.gdi32.CreateCompatibleBitmap(screen, width, height)
            require(bool(bitmap), "CreateCompatibleBitmap failed")
            old = self.gdi32.SelectObject(memory, bitmap)
            require(bool(old) and old != ctypes.c_void_p(-1).value, "SelectObject failed")
            # Capture the actual desktop-composited pixels in client coordinates.
            require(self.gdi32.BitBlt(memory, 0, 0, width, height, screen, x, y,
                                      0x00CC0020 | 0x40000000), "Desktop BitBlt failed")  # SRCCOPY|CAPTUREBLT
            self.gdi32.SelectObject(memory, old)
            old = None
            header = BITMAPINFOHEADER()
            header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            header.biWidth = width
            header.biHeight = -height
            header.biPlanes = 1
            header.biBitCount = 32
            header.biCompression = 0  # BI_RGB
            header.biSizeImage = width * height * 4
            pixels = (ctypes.c_ubyte * header.biSizeImage)()
            info = BITMAPINFO(header, (wintypes.DWORD * 3)())
            lines = self.gdi32.GetDIBits(screen, bitmap, 0, height, pixels,
                                         ctypes.byref(info), 0)
            require(lines == height, f"GetDIBits returned {lines} rows, expected {height}")
            data = bmp_bytes(width, height, bytes(pixels))
        finally:
            if old:
                self.gdi32.SelectObject(memory, old)
            if bitmap:
                self.gdi32.DeleteObject(bitmap)
            if memory:
                self.gdi32.DeleteDC(memory)
            self.user32.ReleaseDC(None, screen)
        self._assert_owned_visible_window(hwnd, pid)
        after_geometry = self._geometry(hwnd)
        require(after_geometry == geometry,
                "Window or monitor geometry changed while the screenshot was captured")
        after_ownership = self._assert_foreground_and_unoccluded(hwnd, after_geometry)
        require(after_ownership["foreground_root"] == ownership["foreground_root"],
                "Foreground ownership changed while the screenshot was captured")
        z_order_after = self._assert_z_order_unoccluded(hwnd, after_geometry)
        require(output.parent.is_dir(), "Capture output directory does not exist")
        stream = output.open("xb")
        try:
            with stream:
                stream.write(data)
        except Exception:
            try:
                output.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        return {"path": str(output), "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data), "dimensions": [width, height],
                "method": "desktop-gdi-bitblt", "client_origin": [x, y],
                "window": geometry, "ownership": ownership,
                "z_order_before": z_order_before, "z_order_after": z_order_after}


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
                ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD)]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]


def run(args):
    api = Win32()
    old_context = api.set_dpi_context()
    require(bool(old_context), "Could not set thread DPI awareness for physical-pixel capture")
    deadline = time.monotonic() + WINDOW_WAIT_SECONDS
    hwnd = None
    title = ""
    while time.monotonic() < deadline:
        windows = api.owned_window(args.pid)
        if windows:
            hwnd, title = windows[0]
            break
        time.sleep(0.1)
    require(hwnd is not None, f"No visible main window found for PID {args.pid} before deadline")
    if args.inspect_only:
        api._assert_owned_visible_window(hwnd, args.pid)
        geometry = api._geometry(hwnd)
        api._assert_client_on_monitor(geometry)
        api._assert_foreground_and_unoccluded(hwnd, geometry)
        api._assert_owned_visible_window(hwnd, args.pid)
        require(api._geometry(hwnd) == geometry, "Window geometry changed during inspection")
        return {"schema": 1, "status": "pass", "action": "inspect-only", "pid": args.pid,
                "hwnd": hex(api._handle_value(hwnd)), "window": geometry}
    resize = None
    if args.width is not None:
        resize = api.resize_client_once(hwnd, args.width, args.height)
    hwnd_value = api._handle_value(hwnd)
    result = {"schema": 1, "status": "pass", "pid": args.pid,
              "hwnd": hex(hwnd_value), "title": title,
              "window": api._geometry(hwnd), "resize": resize}
    if args.resize_only:
        result["action"] = "resize-only"
        return result
    # Allow the compositor one short bounded interval after any requested resize.
    deadline = time.monotonic() + CAPTURE_WAIT_SECONDS
    last_error = None
    while time.monotonic() < deadline:
        try:
            result["capture"] = api.capture_bmp(hwnd, args.pid, args.output)
            result["action"] = "capture"
            result["window_after_capture"] = api._geometry(hwnd)
            return result
        except RuntimeError as error:
            last_error = str(error)
            time.sleep(0.1)
    raise RuntimeError(last_error or "Capture did not complete before deadline")


def main(argv=None):
    try:
        args = parse_args(argv)
        result = run(args)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (RuntimeError, OSError, ValueError, ctypes.ArgumentError, AttributeError) as error:
        print(json.dumps({"schema": 1, "status": "failed", "error": str(error)},
                         ensure_ascii=False, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
