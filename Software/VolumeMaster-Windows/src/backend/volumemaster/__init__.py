"""Shared core of the VolumeMaster Windows backends.

Layout:
    backend.py           Backend: the serial read loop, with hooks per device model
    audio.py             AudioController: app sessions, master volume, mics
    categories.py        App categories (Games / Browser / Chat / Media)
    config.py            config.yaml loading, mapping parsing, file watcher
    serial_link.py       Opening the device's COM port
    voicemeeter_link.py  VoiceMeeter gain / mute / button control
    commands.py          Commands from Electron over stdin
    pro/                 VolumeMaster Pro only (encoders, buttons, selector)

The two entry points (../main.pyw, ../main_pro.pyw) import only what their
device model needs, so the standard backend never loads or bundles pro/.

Stdout lines are the protocol Electron parses (src/main/backend-process.js):
keep their prefixes and formats stable.
"""
