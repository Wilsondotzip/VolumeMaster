"""Commands from Electron, one per line on stdin (LIST_SESSIONS, ...)."""
import queue
import sys
import threading


class StdinCommands:
    """Reads stdin on a daemon thread so the main loop never blocks on it;
    the main loop drains queued commands once per pass."""

    def __init__(self):
        self._queue = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in sys.stdin:
                cmd = line.strip()
                if cmd:
                    self._queue.put(cmd)
        except Exception:
            pass

    def drain(self):
        while not self._queue.empty():
            yield self._queue.get_nowait()
