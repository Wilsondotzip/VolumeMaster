# Generic knob-driven selector: a button press opens a list, turning that knob
# moves the highlight, a second press on the same knob confirms. Used by any
# action that needs "pick one of N" (output device, preset, ...).
#
# The backend owns the state machine (it sees ticks/presses first, with no IPC
# round trip); Electron only renders the popup from the events emitted here:
#
#   SELECTOR_OPEN:{"session", "knob", "title", "items": [{"id", "label", "detail"?, "icon"?}], "index"}
#   SELECTOR_MOVE:{"session", "index"}
#   SELECTOR_CLOSE:{"session", "reason": "selected"|"cancelled"|"timeout"|"replaced",
#                   "source", "key", "item"?}
#
# A selector is opened either from Python (open() with an on_select callback,
# source 'backend') or from Electron via the OPEN_SELECTOR:<json> stdin command
# (source 'electron'; Electron matches the result back up by 'key').
import json
import time

# Lifetime: an untouched selector goes stale and cancels after STALE_TIMEOUT.
# Once the knob has been turned it's in use and stays open until a press
# (same knob confirms, other knob cancels) — it never times out from under
# someone who's mid-choice.
STALE_TIMEOUT = 5.0

# Presses this soon after opening are ignored rather than confirming: guards
# against switch bounce / a doubled BTN_DOWN instantly selecting the item the
# list opened on.
CONFIRM_GUARD = 0.3


def _emit(event, payload):
    print(f'SELECTOR_{event}:{json.dumps(payload)}', flush=True)


class _Session:
    def __init__(self, session_id, knob, title, items, index, on_select, source, key, timeout):
        self.id = session_id
        self.knob = knob
        self.title = title
        self.items = items
        self.index = index
        self.on_select = on_select
        self.source = source
        self.key = key
        self.opened_at = time.monotonic()
        self.deadline = self.opened_at + timeout  # None once the knob has been turned

    def mark_in_use(self):
        self.deadline = None


class SelectorManager:
    """At most one selector is open at a time — opening another replaces it."""

    def __init__(self, emit=_emit):
        self._emit = emit
        self._active = None
        self._next_id = 1

    @property
    def active(self):
        return self._active

    def is_open_for(self, knob):
        return self._active is not None and self._active.knob == knob

    def open(self, knob, title, items, index=0, on_select=None, source='backend', key=None,
             timeout=STALE_TIMEOUT):
        """items: [{'id': str, 'label': str, 'detail'?: str, 'icon'?: str}].
        on_select(item) runs on confirm (backend-sourced selectors only).
        timeout: seconds before an untouched selector goes stale (see STALE_TIMEOUT).
        Returns False (and opens nothing) if there's nothing to choose from."""
        items = [i for i in (items or []) if isinstance(i, dict) and i.get('id') is not None]
        if not items:
            return False
        if self._active is not None:
            self._close('replaced')

        index = max(0, min(len(items) - 1, int(index or 0)))
        self._active = _Session(self._next_id, knob, title or '', items, index, on_select, source, key,
                                timeout if timeout and timeout > 0 else STALE_TIMEOUT)
        self._next_id += 1
        self._emit('OPEN', {
            'session': self._active.id,
            'knob': knob,
            'title': self._active.title,
            'items': items,
            'index': index,
        })
        return True

    def move(self, step):
        s = self._active
        if s is None:
            return
        # Any tick counts as use, even one that's clamped at the end of the list.
        s.mark_in_use()
        # Clamp rather than wrap: hitting the end of the list is a useful cue
        # when you can't see how far you've turned.
        new_index = max(0, min(len(s.items) - 1, s.index + step))
        if new_index == s.index:
            return
        s.index = new_index
        self._emit('MOVE', {'session': s.id, 'index': new_index})

    def confirm(self):
        s = self._active
        if s is None or time.monotonic() - s.opened_at < CONFIRM_GUARD:
            return
        item = s.items[s.index]
        self._close('selected', item)
        if s.on_select:
            try:
                s.on_select(item)
            except Exception as e:
                print(f'Selector "{s.title}" action failed: {e}', flush=True)

    def cancel(self, reason='cancelled'):
        if self._active is not None:
            self._close(reason)

    def check_timeout(self):
        s = self._active
        if s is not None and s.deadline is not None and time.monotonic() > s.deadline:
            self._close('timeout')

    def open_from_command(self, raw_json):
        """OPEN_SELECTOR:<json> from Electron: {key, knob, title, items, index?, timeoutMs?}."""
        try:
            spec = json.loads(raw_json)
            knob = int(spec['knob'])
        except (ValueError, KeyError, TypeError):
            print(f'Malformed OPEN_SELECTOR: {raw_json}', flush=True)
            return
        timeout_ms = spec.get('timeoutMs')
        opened = self.open(
            knob, spec.get('title'), spec.get('items'), spec.get('index', 0),
            source='electron', key=spec.get('key'),
            timeout=(timeout_ms / 1000) if isinstance(timeout_ms, (int, float)) else STALE_TIMEOUT,
        )
        if not opened:
            # Still answer, so Electron can drop its pending callback.
            self._emit('CLOSE', {'session': None, 'reason': 'cancelled', 'source': 'electron',
                                 'key': spec.get('key')})

    def _close(self, reason, item=None):
        s = self._active
        self._active = None
        payload = {'session': s.id, 'reason': reason, 'source': s.source, 'key': s.key}
        if item is not None:
            payload['item'] = item
        self._emit('CLOSE', payload)
