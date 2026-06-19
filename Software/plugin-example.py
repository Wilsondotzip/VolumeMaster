"""
VolumeMaster Plugin Example
---------------------------
Run this while VolumeMaster is open. It registers two test actions and prints
every knob event it receives to the terminal.

Requirements:
    pip install websockets

Usage:
    python plugin-example.py
"""

import asyncio
import json
import websockets

VOLUMEMASTER_WS = "ws://localhost:59284"

PLUGIN_ID = "test-plugin"
PLUGIN_NAME = "Test Plugin"
ACTIONS = [
    {"id": "print-value",   "label": "Test: Print Value"},
    {"id": "loud-or-quiet", "label": "Test: Loud or Quiet"},
]

async def run():
    print(f"Connecting to VOLUMEMASTER at {VOLUMEMASTER_WS} ...")

    async with websockets.connect(VOLUMEMASTER_WS) as ws:
        # Wait for the welcome message
        welcome = json.loads(await ws.recv())
        print(f"Connected — VolumeMaster v{welcome.get('version', '?')}")

        # Register this plugin and its actions
        await ws.send(json.dumps({
            "type":     "register",
            "pluginId": PLUGIN_ID,
            "name":     PLUGIN_NAME,
            "actions":  ACTIONS,
        }))
        print(f"Registered '{PLUGIN_NAME}' with {len(ACTIONS)} actions.")
        print("Drag a test action onto a knob in VolumeMaster, then turn the knob.\n")

        # Listen for knob events
        async for raw in ws:
            msg = json.loads(raw)
            if msg.get("type") != "knob":
                continue

            action_id = msg["actionId"]
            value     = msg["value"]      # 0–100
            knob      = msg["index"]

            if action_id == "print-value":
                print(f"[Knob {knob}] value = {value}%")

            elif action_id == "loud-or-quiet":
                label = "LOUD" if value >= 50 else "quiet"
                print(f"[Knob {knob}] {label}  ({value}%)")

if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nDisconnected.")
    except ConnectionRefusedError:
        print("Could not connect — make sure VolumeMaster is running.")
