#!/usr/bin/env python3
import json
import os
import queue
import shlex
import sys
import threading
import time
from typing import Dict, List, Optional

import pulsectl
import serial
from serial.tools import list_ports
from PySide6.QtCore import QObject, QSettings, Qt, Signal
from PySide6.QtGui import QColor, QFont, QIcon
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

BAUD_RATE = 9600
NUM_POTS = 4
AUTO_SERIAL_PORT = "__AUTO__"
ICON_CACHE_KEY = "ui/icon_cache"
AUTOSTART_DESKTOP_FILENAME = "volumemaster.desktop"
AUTOSTART_ENTRY_NAME = "VolumeMaster"
POT_HYSTERESIS = 2
POT_SMALL_STEP_CONFIRMATIONS = 2

ACCENT = {
    "master": "#89b4fa",
    "mic": "#a6e3a1",
    "app": "#cba6f7",
    "none": "#45475a",
}

SERIAL_HINTS = (
    "VolumeMaster",
    "CH340",
    "CH341",
    "USB Serial",
    "USB2.0-Serial",
    "Arduino",
    "ttyUSB",
    "ttyACM",
)


def _progress_style(color: str) -> str:
    return f"""
        QProgressBar {{
            background: #181825;
            border-radius: 2px;
            border: none;
        }}
        QProgressBar::chunk {{
            background: {color};
            border-radius: 2px;
        }}
    """


def normalize_text(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def get_stream_props(si) -> Dict[str, str]:
    prop = si.proplist
    return {
        "application_name": prop.get("application.name") or "",
        "binary": prop.get("application.process.binary") or prop.get("application.process.exec") or "",
        "media_name": prop.get("media.name") or "",
        "media_role": prop.get("media.role") or "",
    }


def stream_label(props: Dict[str, str]) -> str:
    name = props.get("application_name") or props.get("media_name") or "Unknown stream"
    bits = []
    if props.get("binary"):
        bits.append(props["binary"])
    if props.get("media_role"):
        bits.append(props["media_role"])
    return f"{name} ({', '.join(bits)})" if bits else name


def assignment_display(rule: Dict[str, str]) -> str:
    label = rule.get("label") or rule.get("application_name") or "Unnamed app"
    extras = []
    if rule.get("binary"):
        extras.append(rule["binary"])
    if rule.get("media_role"):
        extras.append(rule["media_role"])
    return f"{label} [{', '.join(extras)}]" if extras else label


def rule_matches_stream(rule: Dict[str, str], props: Dict[str, str]) -> bool:
    if not rule:
        return False

    exact_fields = ["application_name", "binary", "media_role"]
    for field in exact_fields:
        expected = normalize_text(rule.get(field))
        if expected and normalize_text(props.get(field)) != expected:
            return False

    media_name_contains = normalize_text(rule.get("media_name_contains"))
    if media_name_contains and media_name_contains not in normalize_text(props.get("media_name")):
        return False

    matched = any(normalize_text(rule.get(field)) for field in exact_fields) or bool(media_name_contains)
    if matched:
        return True

    fallback = normalize_text(rule.get("label"))
    return bool(fallback) and fallback == normalize_text(props.get("application_name"))


def stream_signature(props: Dict[str, str]) -> str:
    return "|".join(
        [
            normalize_text(props.get("application_name")),
            normalize_text(os.path.basename(props.get("binary") or "")),
            normalize_text(props.get("media_role")),
            normalize_text(props.get("media_name")),
        ]
    )


class AppIconCache:
    def __init__(self, settings: QSettings):
        self.settings = settings
        self._cache = self._load_cache()
        self._desktop_index = None

    def _load_cache(self) -> Dict[str, str]:
        raw = self.settings.value(ICON_CACHE_KEY, "{}")
        if isinstance(raw, dict):
            return {str(k): str(v) for k, v in raw.items() if v}
        try:
            data = json.loads(raw or "{}")
        except Exception:
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(k): str(v) for k, v in data.items() if v}

    def _save_cache(self):
        self.settings.setValue(ICON_CACHE_KEY, json.dumps(self._cache, sort_keys=True))

    def _desktop_paths(self) -> List[str]:
        home = os.path.expanduser("~")
        return [
            os.path.join(home, ".local/share/applications"),
            "/usr/local/share/applications",
            "/usr/share/applications",
            "/var/lib/flatpak/exports/share/applications",
            os.path.join(home, ".local/share/flatpak/exports/share/applications"),
        ]

    def _build_desktop_index(self):
        index = {}
        for root in self._desktop_paths():
            if not os.path.isdir(root):
                continue
            try:
                names = sorted(name for name in os.listdir(root) if name.endswith(".desktop"))
            except Exception:
                continue
            for name in names:
                path = os.path.join(root, name)
                fields = {
                    "icon": "",
                    "name": "",
                    "startupwmclass": "",
                    "exec": "",
                    "desktop_id": os.path.splitext(name)[0],
                }
                try:
                    with open(path, encoding="utf-8", errors="ignore") as handle:
                        for line in handle:
                            line = line.strip()
                            if not line or line.startswith("#") or "=" not in line:
                                continue
                            key, value = line.split("=", 1)
                            key = key.strip().lower()
                            if key in fields and not fields[key]:
                                fields[key] = value.strip()
                except Exception:
                    continue
                icon_name = fields["icon"]
                if not icon_name:
                    continue
                candidates = {
                    normalize_text(fields["desktop_id"]),
                    normalize_text(fields["name"]),
                    normalize_text(fields["startupwmclass"]),
                    normalize_text(os.path.basename(fields["exec"].split()[0])) if fields["exec"] else "",
                }
                for candidate in candidates:
                    if candidate and candidate not in index:
                        index[candidate] = icon_name
        self._desktop_index = index

    def _desktop_icon_name(self, props: Dict[str, str]) -> str:
        if self._desktop_index is None:
            self._build_desktop_index()
        candidates = [
            normalize_text(props.get("application_name")),
            normalize_text(os.path.basename(props.get("binary") or "")),
            normalize_text(props.get("media_name")),
        ]
        for candidate in candidates:
            if candidate and candidate in self._desktop_index:
                return self._desktop_index[candidate]
        return ""

    def _theme_candidates(self, props: Dict[str, str]) -> List[str]:
        candidates = []
        desktop_icon = self._desktop_icon_name(props)
        if desktop_icon:
            candidates.append(desktop_icon)
        for value in [props.get("application_name", ""), os.path.basename(props.get("binary") or "")]:
            text = normalize_text(value)
            if text:
                candidates.extend([text, text.replace(" ", "-"), text.replace(" ", "_")])
        return [candidate for i, candidate in enumerate(candidates) if candidate and candidate not in candidates[:i]]

    def icon_for(self, props: Dict[str, str]) -> QIcon:
        signature = stream_signature(props)
        cached_name = self._cache.get(signature, "")
        if cached_name:
            icon = QIcon.fromTheme(cached_name)
            if not icon.isNull():
                return icon

        for candidate in self._theme_candidates(props):
            icon = QIcon.fromTheme(candidate)
            if not icon.isNull():
                self._cache[signature] = candidate
                self._save_cache()
                return icon

        if cached_name and os.path.exists(cached_name):
            icon = QIcon(cached_name)
            if not icon.isNull():
                return icon
        return QIcon()


class AutostartManager:
    def __init__(self, settings: QSettings):
        self.settings = settings

    def is_enabled(self) -> bool:
        return os.path.exists(self.desktop_file_path())

    def start_minimized(self) -> bool:
        return self.settings.value("ui/start_minimized_on_autostart", False, type=bool)

    def set_start_minimized(self, enabled: bool):
        self.settings.setValue("ui/start_minimized_on_autostart", bool(enabled))

    def desktop_file_path(self) -> str:
        return os.path.join(os.path.expanduser("~/.config/autostart"), AUTOSTART_DESKTOP_FILENAME)

    def launch_parts(self, minimized: bool = False) -> Optional[List[str]]:
        if os.environ.get("APPIMAGE"):
            parts = [os.environ["APPIMAGE"]]
        else:
            main_path = os.path.abspath(__file__)
            if not os.path.exists(main_path):
                return None
            parts = [sys.executable, main_path]
        if minimized:
            parts.append("--minimized")
        return parts

    def launch_command(self, minimized: bool = False) -> Optional[str]:
        parts = self.launch_parts(minimized=minimized)
        if not parts:
            return None
        return " ".join(shlex.quote(part) for part in parts)

    def write_desktop_entry(self, minimized: bool):
        parts = self.launch_parts(minimized=minimized)
        command = self.launch_command(minimized=minimized)
        if not command or not parts:
            raise RuntimeError("Could not determine a launch command for autostart.")

        path = self.desktop_file_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")
        icon_value = icon_path if os.path.exists(icon_path) else "audio-volume-high"
        desktop_entry = "\n".join(
            [
                "[Desktop Entry]",
                "Type=Application",
                f"Name={AUTOSTART_ENTRY_NAME}",
                "Comment=USB volume controller mixer",
                f"Exec={command}",
                f"TryExec={shlex.quote(parts[0])}",
                f"Icon={icon_value}",
                "Terminal=false",
                "Categories=AudioVideo;Audio;Utility;",
                "StartupNotify=false",
                "X-GNOME-Autostart-enabled=true",
                "",
            ]
        )
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(desktop_entry)

    def set_enabled(self, enabled: bool, minimized: Optional[bool] = None):
        if minimized is None:
            minimized = self.start_minimized()
        if enabled:
            self.write_desktop_entry(bool(minimized))
        else:
            try:
                os.remove(self.desktop_file_path())
            except FileNotFoundError:
                pass


class SerialConfig:
    def __init__(self, settings: QSettings):
        self.settings = settings
        self._lock = threading.Lock()

    def selected_port(self) -> str:
        with self._lock:
            return self.settings.value("serial/selected_port", AUTO_SERIAL_PORT)

    def set_selected_port(self, port: str):
        with self._lock:
            self.settings.setValue("serial/selected_port", port or AUTO_SERIAL_PORT)

    def list_ports(self) -> List[Dict[str, str]]:
        ports = []
        try:
            for port in list_ports.comports():
                desc = port.description or "Unknown device"
                hwid = port.hwid or ""
                score = 0
                text = f"{port.device} {desc} {port.manufacturer or ''} {hwid}".lower()
                for hint in SERIAL_HINTS:
                    if hint.lower() in text:
                        score += 2
                if "vid:pid=1a86:7523" in text or "vid:pid=2341" in text:
                    score += 4
                ports.append(
                    {
                        "device": port.device,
                        "description": desc,
                        "manufacturer": port.manufacturer or "",
                        "hwid": hwid,
                        "score": score,
                    }
                )
        except Exception:
            pass
        return sorted(ports, key=lambda p: (-p["score"], p["device"]))

    def resolve_port(self) -> Optional[str]:
        selected = self.selected_port()
        ports = self.list_ports()
        if selected and selected != AUTO_SERIAL_PORT:
            for port in ports:
                if port["device"] == selected:
                    return selected
            return selected
        return ports[0]["device"] if ports else None


class PulseCore:
    def __init__(self):
        self.pulse = pulsectl.Pulse("VolumeMaster-Core")
        self._lock = threading.Lock()

    def apply_all(self, knob_rules, pot_values, master_knob, mic_knob):
        with self._lock:
            try:
                if master_knob is not None:
                    try:
                        sink = self.pulse.get_sink_by_name(self.pulse.server_info().default_sink_name)
                        self.pulse.volume_set_all_chans(sink, pot_values[master_knob] / 100.0)
                    except Exception:
                        pass

                if mic_knob is not None:
                    try:
                        src = self.pulse.get_source_by_name(self.pulse.server_info().default_source_name)
                        self.pulse.volume_set_all_chans(src, pot_values[mic_knob] / 100.0)
                    except Exception:
                        pass

                for si in self.pulse.sink_input_list():
                    props = get_stream_props(si)
                    for k, rules in enumerate(knob_rules):
                        if k in (master_knob, mic_knob):
                            continue
                        if any(rule_matches_stream(rule, props) for rule in rules):
                            self.pulse.volume_set_all_chans(si, pot_values[k] / 100.0)
                            break
            except Exception:
                pass

    def get_streams(self) -> List[Dict[str, str]]:
        with self._lock:
            try:
                seen = {}
                for si in self.pulse.sink_input_list():
                    props = get_stream_props(si)
                    key = (
                        normalize_text(props["application_name"]),
                        normalize_text(props["binary"]),
                        normalize_text(props["media_role"]),
                        normalize_text(props["media_name"]),
                    )
                    if key not in seen:
                        seen[key] = {
                            **props,
                            "label": stream_label(props),
                        }
                return sorted(seen.values(), key=lambda item: item["label"].lower())
            except Exception:
                return []


class VolumeWorker:
    def __init__(self, pc: PulseCore):
        self.pc = pc
        self._pending = None
        self._lock = threading.Lock()
        self._event = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def schedule(self, knob_rules, pot_values, master_knob, mic_knob):
        with self._lock:
            self._pending = (
                [[dict(rule) for rule in rules] for rules in knob_rules],
                list(pot_values),
                master_knob,
                mic_knob,
            )
        self._event.set()

    def _run(self):
        while True:
            self._event.wait()
            self._event.clear()
            with self._lock:
                args, self._pending = self._pending, None
            if args:
                self.pc.apply_all(*args)


class FastMonitor(QObject):
    def __init__(self, state):
        super().__init__()
        self.state = state
        self._queue = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    def run(self):
        try:
            with pulsectl.Pulse("VolumeMaster-Monitor") as pulse:
                pulse.event_mask_set("sink_input")
                pulse.event_callback_set(lambda ev: self._queue.put(ev.index))
                while True:
                    pulse.event_listen()
        except Exception:
            pass

    def _clamp(self, pulse, index):
        for delay in [0, 0.02, 0.05, 0.1]:
            if delay:
                time.sleep(delay)
            try:
                si = pulse.sink_input_info(index)
                props = get_stream_props(si)
                for k, rules in enumerate(self.state["knob_rules"]):
                    if any(rule_matches_stream(rule, props) for rule in rules):
                        target = self.state["pot_values"][k] / 100.0
                        if abs(si.volume.value_flat - target) > 0.01:
                            pulse.volume_set_all_chans(si, target)
                        return
            except Exception:
                return

    def _worker(self):
        with pulsectl.Pulse("VolumeMaster-Worker") as pulse:
            while True:
                self._clamp(pulse, self._queue.get())
                self._queue.task_done()


class ClickableLabel(QLabel):
    doubleClicked = Signal()

    def mouseDoubleClickEvent(self, _):
        self.doubleClicked.emit()


class SerialConfigDialog(QDialog):
    def __init__(self, serial_config: SerialConfig, parent=None):
        super().__init__(parent)
        self.serial_config = serial_config
        self.setWindowTitle("Serial Connection")
        self.setFixedSize(560, 360)

        layout = QVBoxLayout(self)
        intro = QLabel(
            "Pick the serial device used by your VolumeMaster controller. Auto mode will prefer likely USB serial adapters."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #bac2de;")
        layout.addWidget(intro)

        row = QHBoxLayout()
        self.port_combo = QComboBox()
        row.addWidget(self.port_combo, 1)
        refresh = QPushButton("REFRESH")
        refresh.clicked.connect(self.refresh_ports)
        row.addWidget(refresh)
        layout.addLayout(row)

        self.detail_label = QLabel()
        self.detail_label.setWordWrap(True)
        self.detail_label.setStyleSheet("color: #9399b2; font-size: 11px;")
        layout.addWidget(self.detail_label)

        tips = QLabel(
            "Quick checks:\n• Install CH340/CH341 drivers if your board needs them\n• Add your user to the dialout group, or uucp on some Arch-based systems, if the port opens with permission errors\n• Replug the device, then refresh"
        )
        tips.setStyleSheet("color: #9399b2;")
        layout.addWidget(tips)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addStretch()
        layout.addWidget(buttons)

        self.port_combo.currentIndexChanged.connect(self.update_details)
        self.refresh_ports()

    def refresh_ports(self):
        current = self.serial_config.selected_port()
        ports = self.serial_config.list_ports()
        self.port_combo.clear()
        self.port_combo.addItem("Auto-detect recommended port", AUTO_SERIAL_PORT)
        for port in ports:
            label = f"{port['device']}  •  {port['description']}"
            if port["score"] >= 4:
                label += "  •  recommended"
            self.port_combo.addItem(label, port)

        index = 0
        if current and current != AUTO_SERIAL_PORT:
            for i in range(1, self.port_combo.count()):
                port = self.port_combo.itemData(i)
                if port and port.get("device") == current:
                    index = i
                    break
        self.port_combo.setCurrentIndex(index)
        self.update_details()

    def update_details(self):
        data = self.port_combo.currentData()
        if data == AUTO_SERIAL_PORT:
            resolved = self.serial_config.resolve_port()
            msg = f"Auto mode will use {resolved}." if resolved else "Auto mode cannot see a likely device right now."
            self.detail_label.setText(msg)
            return
        if not data:
            self.detail_label.setText("No serial devices detected.")
            return
        pieces = [data.get("description") or "Unknown device"]
        if data.get("manufacturer"):
            pieces.append(data["manufacturer"])
        if data.get("hwid"):
            pieces.append(data["hwid"])
        self.detail_label.setText("\n".join(pieces))

    def selected_port(self) -> str:
        data = self.port_combo.currentData()
        if data == AUTO_SERIAL_PORT:
            return AUTO_SERIAL_PORT
        return data.get("device") if data else AUTO_SERIAL_PORT


class AutostartDialog(QDialog):
    def __init__(self, autostart_manager: AutostartManager, parent=None):
        super().__init__(parent)
        self.autostart_manager = autostart_manager
        self.setWindowTitle("Startup Options")
        self.setFixedSize(560, 300)

        layout = QVBoxLayout(self)
        intro = QLabel(
            "Use your desktop environment's autostart folder so VolumeMaster launches cleanly on login. AppImage builds use the current AppImage path, while source runs use the current Python command."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #bac2de;")
        layout.addWidget(intro)

        self.enable_box = QCheckBox("Launch VolumeMaster when I log in")
        self.enable_box.setChecked(self.autostart_manager.is_enabled())
        layout.addWidget(self.enable_box)

        self.minimized_box = QCheckBox("Start minimized when launched from autostart")
        self.minimized_box.setChecked(self.autostart_manager.start_minimized())
        layout.addWidget(self.minimized_box)

        self.path_label = QLabel()
        self.path_label.setWordWrap(True)
        self.path_label.setStyleSheet("color: #9399b2; font-size: 11px;")
        layout.addWidget(self.path_label)

        self.launch_label = QLabel()
        self.launch_label.setWordWrap(True)
        self.launch_label.setStyleSheet("color: #9399b2; font-size: 11px; background: #11111b; border-radius: 8px; padding: 10px;")
        layout.addWidget(self.launch_label)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addStretch()
        layout.addWidget(buttons)

        self.enable_box.toggled.connect(self.refresh_preview)
        self.minimized_box.toggled.connect(self.refresh_preview)
        self.refresh_preview()

    def refresh_preview(self):
        self.minimized_box.setEnabled(self.enable_box.isChecked())
        self.path_label.setText(f"Autostart file: {self.autostart_manager.desktop_file_path()}")
        command = self.autostart_manager.launch_command(minimized=self.minimized_box.isChecked()) or "Unavailable"
        self.launch_label.setText(f"Launch command:\n{command}")

    def apply(self):
        self.autostart_manager.set_start_minimized(self.minimized_box.isChecked())
        self.autostart_manager.set_enabled(self.enable_box.isChecked(), self.minimized_box.isChecked())


class AppAssignmentDialog(QDialog):
    def __init__(self, pc: PulseCore, icon_cache: AppIconCache, assigned_rules: List[Dict[str, str]], title: str, parent=None):
        super().__init__(parent)
        self.pc = pc
        self.icon_cache = icon_cache
        self.assigned_rules = [dict(rule) for rule in assigned_rules]
        self.setWindowTitle(title)
        self.setFixedSize(620, 620)

        layout = QVBoxLayout(self)
        intro = QLabel(
            "Assign running streams to this knob. Matching uses app name plus binary and role where available, so it survives duplicate titles more reliably."
        )
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #bac2de;")
        layout.addWidget(intro)

        filter_row = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("Filter running streams")
        self.search.textChanged.connect(self.apply_filter)
        filter_row.addWidget(self.search, 1)
        refresh = QPushButton("REFRESH")
        refresh.clicked.connect(self.reload_streams)
        filter_row.addWidget(refresh)
        layout.addLayout(filter_row)

        self.stream_list = QListWidget()
        layout.addWidget(self.stream_list, 1)

        assigned_title = QLabel("Pinned matches")
        assigned_title.setStyleSheet("color: #cdd6f4; font-weight: bold;")
        layout.addWidget(assigned_title)

        self.assigned_list = QListWidget()
        layout.addWidget(self.assigned_list, 1)

        action_row = QHBoxLayout()
        add_custom = QPushButton("ADD CUSTOM NAME")
        add_custom.clicked.connect(self.add_custom_rule)
        remove = QPushButton("REMOVE SELECTED")
        remove.clicked.connect(self.remove_selected_assignment)
        action_row.addWidget(add_custom)
        action_row.addStretch()
        action_row.addWidget(remove)
        layout.addLayout(action_row)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.stream_list.itemChanged.connect(self.sync_from_stream_list)
        self.reload_streams()
        self.refresh_assigned_list()

    def reload_streams(self):
        self.stream_list.blockSignals(True)
        self.stream_list.clear()
        for stream in self.pc.get_streams():
            item = QListWidgetItem(stream["label"])
            item.setData(Qt.UserRole, stream)
            icon = self.icon_cache.icon_for(stream)
            if not icon.isNull():
                item.setIcon(icon)
            if any(rule_matches_stream(rule, stream) for rule in self.assigned_rules):
                item.setCheckState(Qt.Checked)
            else:
                item.setCheckState(Qt.Unchecked)
            self.stream_list.addItem(item)
        self.stream_list.blockSignals(False)
        self.apply_filter()

    def apply_filter(self):
        query = normalize_text(self.search.text())
        for i in range(self.stream_list.count()):
            item = self.stream_list.item(i)
            stream = item.data(Qt.UserRole)
            haystack = " ".join(str(stream.get(k, "")) for k in ["label", "application_name", "binary", "media_role", "media_name"]).lower()
            item.setHidden(bool(query) and query not in haystack)

    def sync_from_stream_list(self, *_args):
        selected = []
        current_streams = self.pc.get_streams()
        for i in range(self.stream_list.count()):
            item = self.stream_list.item(i)
            if item.checkState() == Qt.Checked:
                stream = item.data(Qt.UserRole)
                selected.append(
                    {
                        "label": stream["label"],
                        "application_name": stream.get("application_name", ""),
                        "binary": stream.get("binary", ""),
                        "media_role": stream.get("media_role", ""),
                        "media_name_contains": "",
                    }
                )

        custom_only = [
            rule for rule in self.assigned_rules
            if not any(rule_matches_stream(rule, stream) for stream in current_streams)
        ]
        self.assigned_rules = selected + custom_only
        self.refresh_assigned_list()

    def refresh_assigned_list(self):
        self.assigned_list.clear()
        if not self.assigned_rules:
            item = QListWidgetItem("No pinned matches")
            item.setFlags(Qt.NoItemFlags)
            item.setForeground(QColor("#6c7086"))
            self.assigned_list.addItem(item)
            return
        for rule in self.assigned_rules:
            item = QListWidgetItem(assignment_display(rule))
            item.setData(Qt.UserRole, rule)
            icon = self.icon_cache.icon_for(rule)
            if not icon.isNull():
                item.setIcon(icon)
            self.assigned_list.addItem(item)

    def add_custom_rule(self):
        name, ok = QInputDialog.getText(
            self,
            "Add Custom App Name",
            "Application name to match exactly:\nUse this for apps that are not currently playing audio.",
        )
        if ok and name.strip():
            rule = {
                "label": name.strip(),
                "application_name": name.strip(),
                "binary": "",
                "media_role": "",
                "media_name_contains": "",
            }
            if not any(rule_matches_stream(rule, existing) and rule_matches_stream(existing, rule) for existing in self.assigned_rules):
                self.assigned_rules.append(rule)
                self.refresh_assigned_list()
                self.reload_streams()

    def remove_selected_assignment(self):
        row = self.assigned_list.currentRow()
        if row < 0 or row >= len(self.assigned_rules):
            return
        rule = self.assigned_list.item(row).data(Qt.UserRole)
        self.assigned_rules = [r for r in self.assigned_rules if r != rule]
        self.refresh_assigned_list()
        self.reload_streams()

    def result_rules(self) -> List[Dict[str, str]]:
        cleaned = []
        for rule in self.assigned_rules:
            cleaned.append(
                {
                    "label": rule.get("label", "").strip(),
                    "application_name": rule.get("application_name", "").strip(),
                    "binary": rule.get("binary", "").strip(),
                    "media_role": rule.get("media_role", "").strip(),
                    "media_name_contains": rule.get("media_name_contains", "").strip(),
                }
            )
        return [rule for rule in cleaned if any(rule.values())]


class OnboardingDialog(QDialog):
    def __init__(self, serial_config: SerialConfig, parent=None):
        super().__init__(parent)
        self.serial_config = serial_config
        self.setWindowTitle("Welcome to VolumeMaster")
        self.setFixedSize(620, 420)

        layout = QVBoxLayout(self)
        title = QLabel("First-run setup")
        title.setFont(QFont("Sans Serif", 14, QFont.Bold))
        layout.addWidget(title)

        body = QLabel(
            "VolumeMaster can auto-detect the controller, but Linux permission issues are common on a fresh setup. Pick a serial mode now, then you can finish mapping knobs once audio is playing."
        )
        body.setWordWrap(True)
        body.setStyleSheet("color: #bac2de;")
        layout.addWidget(body)

        self.port_summary = QLabel()
        self.port_summary.setWordWrap(True)
        self.port_summary.setStyleSheet("color: #cdd6f4; background: #11111b; border-radius: 8px; padding: 10px;")
        layout.addWidget(self.port_summary)

        self.remember_box = QCheckBox("Don't show this again")
        self.remember_box.setChecked(True)
        layout.addWidget(self.remember_box)

        help_text = QLabel(
            "Recommended order:\n1. Connect the controller via USB\n2. If nothing appears, install CH340/CH341 drivers\n3. If it still fails, add your user to dialout, or uucp on some Arch-based systems\n4. Log out and back in after changing groups"
        )
        help_text.setStyleSheet("color: #9399b2;")
        layout.addWidget(help_text)

        action_row = QHBoxLayout()
        choose_port = QPushButton("SERIAL SETTINGS")
        choose_port.clicked.connect(self.open_serial_settings)
        action_row.addWidget(choose_port)
        action_row.addStretch()
        layout.addLayout(action_row)

        buttons = QDialogButtonBox()
        self.skip_button = buttons.addButton("Skip for now", QDialogButtonBox.RejectRole)
        self.done_button = buttons.addButton("Finish setup", QDialogButtonBox.AcceptRole)
        self.skip_button.clicked.connect(self.reject)
        self.done_button.clicked.connect(self.accept)
        layout.addStretch()
        layout.addWidget(buttons)

        self.refresh_summary()

    def refresh_summary(self):
        ports = self.serial_config.list_ports()
        resolved = self.serial_config.resolve_port()
        if not ports:
            self.port_summary.setText("No serial devices detected yet. You can keep auto mode and plug the controller in later.")
            return
        lines = [f"Detected {len(ports)} serial device(s)."]
        if resolved:
            lines.append(f"Current connection target: {resolved}")
        best = ports[0]
        lines.append(f"Best match right now: {best['device']} • {best['description']}")
        self.port_summary.setText("\n".join(lines))

    def open_serial_settings(self):
        dlg = SerialConfigDialog(self.serial_config, self)
        if dlg.exec():
            self.serial_config.set_selected_port(dlg.selected_port())
            self.refresh_summary()


class MainWindow(QWidget):
    def __init__(self, pc: PulseCore, vol_worker: VolumeWorker, serial_config: SerialConfig, autostart_manager: AutostartManager):
        super().__init__()
        self.pc = pc
        self.vol_worker = vol_worker
        self.serial_config = serial_config
        self.autostart_manager = autostart_manager
        self.settings = QSettings("VolumeMaster", "VolumeMaster")
        self.icon_cache = AppIconCache(self.settings)
        self.setWindowTitle("VolumeMaster")
        self.setMinimumSize(700, 640)

        icon_path = os.path.join(os.path.dirname(__file__), "icon.png")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        self.state = {
            "knob_rules": [[] for _ in range(NUM_POTS)],
            "knob_names": [f"KNOB {i + 1}" for i in range(NUM_POTS)],
            "pot_values": [0] * NUM_POTS,
            "master_knob": None,
            "mic_knob": None,
        }

        self.pct_labels = []
        self.progress_bars = []
        self.app_labels = []
        self.title_labels = []
        self.mode_badges = []
        self.assign_btns = []

        self.init_ui()
        self.load_settings()

    def init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(18, 14, 18, 14)
        root.setSpacing(10)

        hdr_row = QHBoxLayout()
        title = QLabel("VOLUMEMASTER")
        title.setFont(QFont("Sans Serif", 13, QFont.Bold))
        title.setStyleSheet("color: #a6adc8; letter-spacing: 5px;")
        self.status_label = QLabel("● DISCONNECTED")
        self.status_label.setStyleSheet("color: #f38ba8; font-size: 10px;")
        self.port_label = QLabel("PORT: auto")
        self.port_label.setStyleSheet("color: #9399b2; font-size: 10px;")
        serial_btn = QPushButton("SERIAL")
        serial_btn.clicked.connect(self.open_serial_settings)
        hdr_row.addWidget(title)
        hdr_row.addStretch()
        hdr_row.addWidget(self.port_label)
        hdr_row.addWidget(self.status_label)
        hdr_row.addWidget(serial_btn)
        root.addLayout(hdr_row)

        ctrl = QFrame()
        ctrl.setStyleSheet("background: #313244; border-radius: 10px;")
        cl = QHBoxLayout(ctrl)
        cl.setContentsMargins(14, 8, 14, 8)
        cl.setSpacing(10)

        for attr, text, slot in [
            ("master_combo", "GLOBAL MASTER", self.save_master_config),
            ("mic_combo", "MIC INPUT", self.save_mic_config),
        ]:
            lbl = QLabel(text)
            lbl.setStyleSheet("color: #bac2de; font-weight: bold; font-size: 11px;")
            cb = QComboBox()
            cb.addItem("Disabled", None)
            for i in range(NUM_POTS):
                cb.addItem(f"Knob {i + 1}", i)
            cb.currentIndexChanged.connect(slot)
            setattr(self, attr, cb)
            cl.addWidget(lbl)
            cl.addWidget(cb)
            cl.addStretch()

        root.addWidget(ctrl)

        grid = QGridLayout()
        grid.setSpacing(10)
        for i in range(NUM_POTS):
            card = QFrame()
            card.setStyleSheet("background: #313244; border-radius: 12px;")
            card_layout = QVBoxLayout(card)
            card_layout.setContentsMargins(12, 10, 12, 10)
            card_layout.setSpacing(6)

            top = QHBoxLayout()
            t = ClickableLabel(self.state["knob_names"][i])
            t.setStyleSheet("color: #9399b2; font-weight: bold; font-size: 11px;")
            t.setToolTip("Double-click to rename")
            t.doubleClicked.connect(lambda k=i: self.rename_knob(k))
            self.title_labels.append(t)

            badge = QLabel("—")
            badge.setAlignment(Qt.AlignCenter)
            badge.setFixedHeight(20)
            badge.setStyleSheet(
                "background: #45475a; color: #9399b2; border-radius: 10px; font-size: 9px; font-weight: bold; padding: 0 8px;"
            )
            self.mode_badges.append(badge)

            top.addWidget(t)
            top.addStretch()
            top.addWidget(badge)
            card_layout.addLayout(top)

            pct = QLabel("0%")
            pct.setAlignment(Qt.AlignCenter)
            pct.setFont(QFont("Sans Serif", 17, QFont.Bold))
            pct.setStyleSheet("color: #cdd6f4;")
            self.pct_labels.append(pct)
            card_layout.addWidget(pct)

            pb = QProgressBar()
            pb.setRange(0, 100)
            pb.setValue(0)
            pb.setTextVisible(False)
            pb.setFixedHeight(5)
            pb.setStyleSheet(_progress_style(ACCENT["none"]))
            self.progress_bars.append(pb)
            card_layout.addWidget(pb)

            al = QLabel("None assigned")
            al.setStyleSheet("color: #6c7086; font-size: 11px;")
            al.setWordWrap(True)
            al.setMinimumHeight(32)
            self.app_labels.append(al)
            card_layout.addWidget(al)

            btn = QPushButton("ASSIGN APPS")
            btn.clicked.connect(lambda _, k=i: self.open_app_selector(k))
            self.assign_btns.append(btn)
            card_layout.addWidget(btn)

            grid.addWidget(card, i // 2, i % 2)

        root.addLayout(grid)

        p_card = QFrame()
        p_card.setStyleSheet("background: #181825; border-radius: 10px;")
        pl = QHBoxLayout(p_card)
        pl.setContentsMargins(10, 6, 10, 6)
        for label, slot, color in [
            ("SAVE", self.save_profile, "#a6e3a1"),
            ("LOAD", self.load_profile, "#89b4fa"),
            ("DELETE", self.delete_profile, "#f38ba8"),
            ("STARTUP", self.open_startup_settings, "#fab387"),
            ("SETUP", self.open_onboarding, "#f9e2af"),
        ]:
            b = QPushButton(label)
            b.setStyleSheet(f"color: {color}; font-weight: bold; background: transparent; border: none;")
            b.clicked.connect(slot)
            pl.addWidget(b)

        root.addStretch()
        root.addWidget(p_card)
        self.refresh_serial_port_label()

    def _get_mode(self, i: int) -> str:
        if i == self.state["master_knob"]:
            return "master"
        if i == self.state["mic_knob"]:
            return "mic"
        if self.state["knob_rules"][i]:
            return "app"
        return "none"

    def _update_badge(self, i: int):
        mode = self._get_mode(i)
        color = ACCENT[mode]
        n = len(self.state["knob_rules"][i])
        text = {"master": "MASTER", "mic": "MIC", "none": "—"}.get(mode, f"{n} APP{'S' if n != 1 else ''}")
        self.mode_badges[i].setText(text)
        self.mode_badges[i].setStyleSheet(
            f"background: #45475a; color: {color}; border-radius: 10px; font-size: 9px; font-weight: bold; padding: 0 8px;"
        )
        self.progress_bars[i].setStyleSheet(_progress_style(color))
        self.assign_btns[i].setEnabled(mode not in ("master", "mic"))

    def _update_all_badges(self):
        for i in range(NUM_POTS):
            self._update_badge(i)

    def _normalize_rules(self, raw) -> List[Dict[str, str]]:
        if not raw:
            return []
        if isinstance(raw, str):
            return [{"label": raw, "application_name": raw, "binary": "", "media_role": "", "media_name_contains": ""}]
        rules = []
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, str):
                    rules.append({"label": item, "application_name": item, "binary": "", "media_role": "", "media_name_contains": ""})
                elif isinstance(item, dict):
                    rules.append(
                        {
                            "label": str(item.get("label", item.get("application_name", ""))),
                            "application_name": str(item.get("application_name", "")),
                            "binary": str(item.get("binary", "")),
                            "media_role": str(item.get("media_role", "")),
                            "media_name_contains": str(item.get("media_name_contains", "")),
                        }
                    )
        return [rule for rule in rules if any(rule.values())]

    def load_settings(self):
        for i in range(NUM_POTS):
            raw = self.settings.value(f"knob/{i}/rules")
            if raw is None:
                raw = self.settings.value(f"knob/{i}/apps") or self.settings.value(f"knob_{i}_apps")
            self.state["knob_rules"][i] = self._normalize_rules(raw)
            name = self.settings.value(f"knob/{i}/name", f"KNOB {i + 1}")
            self.state["knob_names"][i] = name
            self.title_labels[i].setText(name)
            self.update_ui_labels(i)

        m = self.settings.value("master_knob")
        if m not in [None, "None"]:
            self.master_combo.setCurrentIndex(int(m) + 1)
        mic = self.settings.value("mic_knob")
        if mic not in [None, "None"]:
            self.mic_combo.setCurrentIndex(int(mic) + 1)
        self._update_all_badges()

    def update_ui_labels(self, i: int):
        rules = self.state["knob_rules"][i]
        if not rules:
            self.app_labels[i].setText("None assigned")
            return
        preview = ", ".join(assignment_display(rule) for rule in rules[:2])
        if len(rules) > 2:
            preview += f" +{len(rules) - 2} more"
        self.app_labels[i].setText(preview)

    def rename_knob(self, k: int):
        name, ok = QInputDialog.getText(self, "Rename Knob", "Enter name:", text=self.state["knob_names"][k])
        if ok and name.strip():
            self.state["knob_names"][k] = name.strip()
            self.title_labels[k].setText(name.strip())
            self.settings.setValue(f"knob/{k}/name", name.strip())

    def save_master_config(self, idx: int):
        data = self.master_combo.itemData(idx)
        self.state["master_knob"] = data
        self.settings.setValue("master_knob", str(data) if data is not None else "None")
        self._update_all_badges()

    def save_mic_config(self, idx: int):
        data = self.mic_combo.itemData(idx)
        self.state["mic_knob"] = data
        self.settings.setValue("mic_knob", str(data) if data is not None else "None")
        self._update_all_badges()

    def open_app_selector(self, k: int):
        dlg = AppAssignmentDialog(self.pc, self.icon_cache, self.state["knob_rules"][k], f"Assign Apps  •  {self.state['knob_names'][k]}", self)
        if dlg.exec():
            self.state["knob_rules"][k] = dlg.result_rules()
            self.settings.setValue(f"knob/{k}/rules", self.state["knob_rules"][k])
            self.update_ui_labels(k)
            self._update_badge(k)

    def save_profile(self):
        name, ok = QInputDialog.getText(self, "Save Profile", "Enter profile name:")
        if not ok:
            return
        name = name.strip()
        if not name or "/" in name:
            QMessageBox.warning(self, "VolumeMaster", "Invalid profile name.")
            return
        for i in range(NUM_POTS):
            self.settings.setValue(f"profile/{name}/knob/{i}/rules", self.state["knob_rules"][i])
            self.settings.setValue(f"profile/{name}/knob/{i}/name", self.state["knob_names"][i])
        self.settings.setValue(f"profile/{name}/master", self.state["master_knob"])
        self.settings.setValue(f"profile/{name}/mic", self.state["mic_knob"])

    def load_profile(self):
        keys = self.settings.allKeys()
        profiles = sorted({k.split("/")[1] for k in keys if k.startswith("profile/")})
        if not profiles:
            QMessageBox.information(self, "VolumeMaster", "No saved profiles found.")
            return
        name, ok = QInputDialog.getItem(self, "Load Profile", "Select profile:", profiles, 0, False)
        if not ok:
            return
        for i in range(NUM_POTS):
            raw = self.settings.value(f"profile/{name}/knob/{i}/rules")
            if raw is None:
                raw = self.settings.value(f"profile/{name}/knob/{i}/apps", [])
            self.state["knob_rules"][i] = self._normalize_rules(raw)
            kname = self.settings.value(f"profile/{name}/knob/{i}/name", f"KNOB {i + 1}")
            self.state["knob_names"][i] = kname
            self.title_labels[i].setText(kname)
            self.update_ui_labels(i)
        m = self.settings.value(f"profile/{name}/master")
        self.master_combo.setCurrentIndex(0 if m in [None, "None"] else int(m) + 1)
        mic = self.settings.value(f"profile/{name}/mic")
        self.mic_combo.setCurrentIndex(0 if mic in [None, "None"] else int(mic) + 1)
        self._update_all_badges()

    def delete_profile(self):
        keys = self.settings.allKeys()
        profiles = sorted({k.split("/")[1] for k in keys if k.startswith("profile/")})
        if not profiles:
            return
        name, ok = QInputDialog.getItem(self, "Delete Profile", "Select profile:", profiles, 0, False)
        if ok:
            for key in [k for k in keys if k.startswith(f"profile/{name}/")]:
                self.settings.remove(key)

    def update_pots(self, values: list):
        self.state["pot_values"] = values
        for i, v in enumerate(values):
            self.pct_labels[i].setText(f"{v}%")
            self.progress_bars[i].setValue(v)
        self.vol_worker.schedule(
            self.state["knob_rules"],
            values,
            self.state["master_knob"],
            self.state["mic_knob"],
        )

    def set_serial_status(self, connected: bool, port_name: str = ""):
        if connected:
            self.status_label.setText("● CONNECTED")
            self.status_label.setStyleSheet("color: #a6e3a1; font-size: 10px;")
        else:
            self.status_label.setText("● DISCONNECTED")
            self.status_label.setStyleSheet("color: #f38ba8; font-size: 10px;")
        self.refresh_serial_port_label(port_name)

    def refresh_serial_port_label(self, active_port: str = ""):
        selected = self.serial_config.selected_port()
        resolved = active_port or self.serial_config.resolve_port() or "not found"
        mode = "auto" if selected == AUTO_SERIAL_PORT else selected
        self.port_label.setText(f"PORT: {mode} → {resolved}")

    def open_serial_settings(self):
        dlg = SerialConfigDialog(self.serial_config, self)
        if dlg.exec():
            self.serial_config.set_selected_port(dlg.selected_port())
            self.refresh_serial_port_label()

    def open_startup_settings(self):
        dlg = AutostartDialog(self.autostart_manager, self)
        if dlg.exec():
            try:
                dlg.apply()
            except Exception as exc:
                QMessageBox.warning(self, "VolumeMaster", f"Could not update autostart settings.\n\n{exc}")

    def open_onboarding(self):
        dlg = OnboardingDialog(self.serial_config, self)
        accepted = dlg.exec()
        if accepted and dlg.remember_box.isChecked():
            self.settings.setValue("ui/first_run_complete", True)
        elif accepted:
            self.settings.setValue("ui/first_run_complete", False)
        self.refresh_serial_port_label()


class SerialWorker(QObject):
    updated = Signal(list)
    connection_changed = Signal(bool, str)

    def __init__(self, serial_config: SerialConfig):
        super().__init__()
        self.serial_config = serial_config

    def run(self):
        vals = [0] * NUM_POTS
        small_step_direction = [0] * NUM_POTS
        small_step_count = [0] * NUM_POTS
        connected = False
        current_port = ""
        while True:
            port_name = self.serial_config.resolve_port()
            if not port_name:
                if connected:
                    connected = False
                    current_port = ""
                    self.connection_changed.emit(False, "")
                time.sleep(1)
                continue
            try:
                with serial.Serial(port_name, BAUD_RATE, timeout=0.1) as ser:
                    if not connected or current_port != port_name:
                        connected = True
                        current_port = port_name
                        self.connection_changed.emit(True, port_name)
                    while True:
                        if self.serial_config.resolve_port() != port_name:
                            raise serial.SerialException("Serial port selection changed")
                        line = ser.readline().decode(errors="ignore").strip()
                        if "@" in line:
                            try:
                                v, k = map(int, line.split("@"))
                                if 0 < k <= NUM_POTS:
                                    idx = k - 1
                                    raw = max(0, min(100, v))
                                    delta = raw - vals[idx]
                                    abs_delta = abs(delta)
                                    direction = 1 if delta > 0 else -1 if delta < 0 else 0

                                    should_emit = False
                                    if abs_delta >= POT_HYSTERESIS or raw in (0, 100):
                                        should_emit = True
                                    elif direction == 0:
                                        small_step_direction[idx] = 0
                                        small_step_count[idx] = 0
                                    else:
                                        if small_step_direction[idx] == direction:
                                            small_step_count[idx] += 1
                                        else:
                                            small_step_direction[idx] = direction
                                            small_step_count[idx] = 1
                                        if small_step_count[idx] >= POT_SMALL_STEP_CONFIRMATIONS:
                                            should_emit = True

                                    if should_emit:
                                        vals[idx] = raw
                                        small_step_direction[idx] = 0
                                        small_step_count[idx] = 0
                                        self.updated.emit(vals.copy())
                            except Exception:
                                continue
            except Exception:
                if connected:
                    connected = False
                    current_port = ""
                    self.connection_changed.emit(False, port_name)
                time.sleep(1)


def main():
    start_minimized = "--minimized" in sys.argv[1:]
    qt_args = [sys.argv[0]] + [arg for arg in sys.argv[1:] if arg != "--minimized"]

    app = QApplication(qt_args)
    app.setStyleSheet(
        """
        QWidget {
            background: #1e1e2e;
            color: #cdd6f4;
            font-family: 'Segoe UI', Sans-Serif;
        }
        QPushButton {
            background: #313244;
            border-radius: 8px;
            padding: 8px 12px;
            font-weight: bold;
            border: none;
        }
        QPushButton:hover { background: #45475a; }
        QPushButton:disabled { background: #313244; color: #45475a; }
        QComboBox, QLineEdit {
            background: #313244;
            border: none;
            border-radius: 6px;
            padding: 6px 10px;
            min-width: 110px;
        }
        QComboBox::drop-down { border: none; }
        QComboBox QAbstractItemView, QListWidget {
            background: #11111b;
            selection-background-color: #45475a;
            border: 1px solid #45475a;
            border-radius: 8px;
            outline: none;
            padding: 4px;
        }
        QListWidget::item { padding: 4px 6px; border-radius: 4px; }
        QListWidget::item:hover { background: #313244; }
        QDialog { background: #1e1e2e; }
        """
    )

    settings = QSettings("VolumeMaster", "VolumeMaster")
    serial_config = SerialConfig(settings)
    autostart_manager = AutostartManager(settings)
    pc = PulseCore()
    vol_worker = VolumeWorker(pc)
    win = MainWindow(pc, vol_worker, serial_config, autostart_manager)
    if start_minimized:
        win.showMinimized()
    else:
        win.show()

    if not start_minimized and not settings.value("ui/first_run_complete", False, type=bool):
        dlg = OnboardingDialog(serial_config, win)
        accepted = dlg.exec()
        if accepted and dlg.remember_box.isChecked():
            settings.setValue("ui/first_run_complete", True)
        elif accepted:
            settings.setValue("ui/first_run_complete", False)
        win.refresh_serial_port_label()

    s_worker = SerialWorker(serial_config)
    threading.Thread(target=s_worker.run, daemon=True).start()
    s_worker.updated.connect(win.update_pots)
    s_worker.connection_changed.connect(win.set_serial_status)

    m_worker = FastMonitor(win.state)
    threading.Thread(target=m_worker.run, daemon=True).start()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
