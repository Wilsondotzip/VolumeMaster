"""The app in the foreground window, for the 'Focused' category."""
import ctypes
from ctypes import wintypes

import psutil

_user32 = ctypes.windll.user32
_user32.GetForegroundWindow.restype = wintypes.HWND
_user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]

_EnumChildProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

# Store/UWP apps run inside this host's window; the real app owns a child window.
_UWP_HOST = 'applicationframehost.exe'


def _window_pid(hwnd):
    pid = wintypes.DWORD()
    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def _uwp_app_pid(hwnd, host_pid):
    found = []

    def callback(child, _):
        pid = _window_pid(child)
        if pid and pid != host_pid:
            found.append(pid)
            return False
        return True

    _user32.EnumChildWindows(hwnd, _EnumChildProc(callback), 0)
    return found[0] if found else None


def foreground_exe_name():
    """Lowercase exe name of the foreground window's app, or None. Matched by
    name rather than pid since apps like browsers and Discord play audio from a
    different process than the one that owns the window."""
    try:
        hwnd = _user32.GetForegroundWindow()
        if not hwnd:
            return None
        pid = _window_pid(hwnd)
        name = psutil.Process(pid).name().lower()
        if name == _UWP_HOST:
            app_pid = _uwp_app_pid(hwnd, pid)
            if app_pid:
                name = psutil.Process(app_pid).name().lower()
        return name
    except Exception:
        return None
