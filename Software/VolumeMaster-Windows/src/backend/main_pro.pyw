# Backend for VolumeMaster Pro (push-button rotary encoders). Built into
# VolumeMaster-Pro-Headless.exe; Electron runs it in the device's config folder.
# The Pro-specific logic lives in volumemaster/pro — see pro/backend.py.
from volumemaster.pro.backend import ProBackend

if __name__ == "__main__":
    ProBackend().run()
