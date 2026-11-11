"""Encoder acceleration: fast spins move the volume further per click.

Turning slowly keeps the knob's normal EncoderStep for fine control; spinning
quickly scales it up (to ACCEL_MAX x) so sweeping across the range takes a
fraction of a turn. Speed is the time between clicks, smoothed over a few
clicks so one pair of ticks read back-to-back (e.g. queued behind a slow audio
refresh) can't cause a jump. Changing direction or pausing starts over slow.
"""
import time

ACCEL_SLOW = 0.100   # s between clicks at/above which there's no acceleration
ACCEL_FAST = 0.030   # s between clicks at/below which it's at full strength
ACCEL_MAX = 4.0      # step multiplier at full strength
ACCEL_RESET = 0.250  # a gap this long (or a direction change) resets to slow
SMOOTHING = 0.5      # weight of the newest interval in the running average


class EncoderAccelerator:
    def __init__(self, clock=time.perf_counter):
        self._clock = clock
        self._knobs = {}  # knob index -> (last tick time, direction, smoothed interval)

    def step(self, index, direction, base_step, max_step):
        """Volume change for one click: base_step, scaled up when spinning fast."""
        now = self._clock()
        last = self._knobs.get(index)
        if last is None or last[1] != direction or now - last[0] > ACCEL_RESET:
            interval = ACCEL_RESET
        else:
            interval = SMOOTHING * (now - last[0]) + (1 - SMOOTHING) * last[2]
        self._knobs[index] = (now, direction, interval)

        # 0 = slow .. 1 = fast; squared so moderate speeds stay close to the base step
        speed = (ACCEL_SLOW - interval) / (ACCEL_SLOW - ACCEL_FAST)
        speed = max(0.0, min(1.0, speed)) ** 2
        scaled = round(base_step * (1 + (ACCEL_MAX - 1) * speed))
        return max(base_step, min(max_step, scaled))

    def reset(self):
        self._knobs.clear()
