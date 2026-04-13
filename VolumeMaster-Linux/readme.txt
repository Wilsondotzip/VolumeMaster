====================================================================
                              VolumeMaster
====================================================================

OVERVIEW
====================================================================

VolumeMaster is a Linux desktop app for the VolumeMaster USB controller.
It lets each physical knob control master output, mic input, or one or
more app/audio streams on a PulseAudio or PipeWire-Pulse system.

The Linux build is packaged as an AppImage and uses PySide6 for the UI.


WHAT'S NEW IN THIS LINUX BUILD
====================================================================

1) Serial port discovery and configuration
--------------------------------------------------------------------
- Auto-detects likely controller ports such as CH340/CH341, ttyUSB,
  ttyACM, Arduino-style serial devices
- Lets you override auto mode and pin a specific serial device
- Shows the current serial target directly in the app header

2) Better app assignment
--------------------------------------------------------------------
- Assignment dialog now supports search/filter
- Running streams can show desktop/theme icons when they are discoverable
- Previously seen app icons are cached, so pinned matches can keep their
  icon later even when the app is not running
- Running streams are matched with stronger metadata where available,
  including app name, binary, and media role
- You can also add a custom app name for software that is not currently
  producing audio

3) First-run setup
--------------------------------------------------------------------
- New onboarding dialog explains the common Linux setup issues
- Helps users check serial detection and open serial settings quickly
- Keeps setup guidance inside the app instead of relying only on text

4) Login autostart
--------------------------------------------------------------------
- New STARTUP button writes an XDG autostart desktop entry in
  ~/.config/autostart/volumemaster.desktop
- Works cleanly for AppImage launches and also for running from source
- Optional autostart-minimized mode launches with --minimized so manual
  launches can still open normally


COMMON LINUX REQUIREMENTS
====================================================================

Some controllers use CH340/CH341 USB serial adapters. If your distro
does not already support the device correctly, install the matching
serial driver package for your system.

Some systems also require your user account to be in the "dialout"
group to access serial devices. On some Arch-based distros, the serial
port may instead be owned by the "uucp" group.

To add your user to the relevant group, run one of:

    sudo usermod -aG dialout <username>
    sudo usermod -aG uucp <username>

You must log out and log back in for the group change to take effect.


INSTALLATION / BUILDING
====================================================================

1) Clone the repo

2) Change into the Linux app directory

    cd VolumeMaster-Linux

3) Install Python dependencies if you want to run from source

    pip install -r requirements.txt

4) Build the AppImage if desired

    ./build-app-image.sh

5) Make the AppImage executable

    chmod +x VolumeMaster-*.AppImage

6) Run it

    ./VolumeMaster-*.AppImage


RUN FROM SOURCE
====================================================================

For local development:

    cd VolumeMaster-Linux
    pip install -r requirements.txt
    python3 main.py


USAGE
====================================================================

1) Launch the app
2) On first run, complete the setup dialog or skip it
3) Use the SERIAL button if you need to refresh or pin a device
4) Assign each knob to master, mic, or specific apps/streams
5) Use STARTUP if you want the app to launch on login
6) Save profiles for different workflows if needed


GNOME COMPATIBILITY
====================================================================

This Linux app should generally work on GNOME-based distros, including
systems using PipeWire with the PulseAudio compatibility layer.

Known caveats:
- App icons depend on desktop/theme metadata, so some apps may still
  appear without an icon
- Serial access still depends on the right group membership and udev
  permissions for your distro
- If an app does not expose stable Pulse stream metadata, assignment may
  fall back to the visible app name only
- For AppImage autostart, the desktop entry points at the current
  AppImage path. If you move or rename the AppImage later, re-save the
  STARTUP setting so the autostart file is refreshed


DEVELOPMENT NOTES
====================================================================

Main app entry point:

    main.py

Rebuild the AppImage after UI or logic changes:

    ./build-app-image.sh


====================================================================
