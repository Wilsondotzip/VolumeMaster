"""config.yaml loading, knob-mapping parsing and change watching."""
import os
import threading

import yaml
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

CONFIG_FILE = 'config.yaml'  # relative: Electron starts the backend in the device's folder


def load_config(path=CONFIG_FILE):
    with open(path, 'r', encoding='UTF-8') as file:
        return yaml.safe_load(file) or {}


def is_enabled(value):
    """Strict on/off for config flags: only a real True or the text 'true'.
    Must match Electron's reading of the same flag (ipc-handlers.js) — plain
    Python truthiness would treat a leftover string like 'false' as enabled."""
    return value is True or (isinstance(value, str) and value.strip().lower() == 'true')


def mapping_items(config, report_invalid=False):
    """(knob index, raw mapping) pairs from config['Mappings'], skipping non-numeric keys."""
    for key, val in config.get('Mappings', {}).items():
        try:
            index = int(key)
        except ValueError:
            if report_invalid:
                print(f"Invalid mapping key: {key}")
            continue
        yield index, val


def build_mappings(config):
    """Per-knob volume targets: {index: {'apps', 'vm', 'mics', 'categories'}}.
    Names are normalised (stripped, and lowercased except categories)."""
    mappings = {}
    for index, val in mapping_items(config, report_invalid=True):
        entry = {}

        apps = val.get('ProcessNames')
        if isinstance(apps, list):
            entry['apps'] = [a.strip().lower() for a in apps if isinstance(a, str) and a.strip()]

        vm = val.get('VoiceMeeter')
        if vm:
            if isinstance(vm, list):
                entry['vm'] = [v.strip().lower() for v in vm if isinstance(v, str) and v.strip()]
            elif isinstance(vm, str):
                entry['vm'] = [vm.strip().lower()]

        mics = val.get('MicNames')
        if isinstance(mics, list):
            entry['mics'] = [m.strip().lower() for m in mics if isinstance(m, str) and m.strip()]

        cats = val.get('Categories')
        if isinstance(cats, list):
            entry['categories'] = [c.strip() for c in cats if isinstance(c, str) and c.strip()]

        mappings[index] = entry
    return mappings


class _ConfigFileHandler(FileSystemEventHandler):
    def __init__(self, on_change, debounce_seconds):
        self.on_change = on_change
        self.debounce_seconds = debounce_seconds
        self._timer = None

    def on_modified(self, event):
        if not event.src_path or not event.src_path.endswith('config.yaml'):
            return
        # Debounce (reset on every write), not throttle: a throttle with no
        # trailing-edge retry can drop the write that matters and leave the
        # backend permanently out of sync with the file until some unrelated
        # future write happens to land outside the window.
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(self.debounce_seconds, self._fire)
        self._timer.daemon = True
        self._timer.start()

    def _fire(self):
        print('[Watcher] Config changed, reloading...')
        self.on_change()


class ConfigWatcher:
    """Flags config.yaml changes for the main loop to pick up.

    Only sets a flag from the watcher thread: the reload itself must run on the
    main loop's thread, since it replaces state the loop is reading and creates
    COM audio objects that the loop then uses.
    """

    def __init__(self, path=CONFIG_FILE, debounce_seconds=0.5):
        self._path = os.path.abspath(path)
        self._changed = threading.Event()
        self._observer = Observer()
        self._observer.schedule(
            _ConfigFileHandler(self._changed.set, debounce_seconds),
            path=os.path.dirname(self._path), recursive=False,
        )

    def start(self):
        self._observer.start()

    def stop(self):
        self._observer.stop()
        self._observer.join()

    def consume_change(self):
        """True (once) if the file changed since the last call."""
        if self._changed.is_set():
            self._changed.clear()
            return True
        return False
