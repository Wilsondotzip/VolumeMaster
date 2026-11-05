# Backend for the standard VolumeMaster (potentiometers). Built into
# VolumeMaster-Headless.exe; Electron runs it in the device's config folder.
# The shared logic lives in the volumemaster package — see its __init__.py.
from volumemaster.backend import Backend

if __name__ == "__main__":
    Backend().run()
