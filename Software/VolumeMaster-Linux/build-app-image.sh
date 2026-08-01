#!/bin/bash
set -e  # Exit on any error

# App metadata (customize these)
APP_NAME="VolumeMaster"          # Change to your app name
APP_VERSION="1.04"          # Optional version
EXEC_NAME="main"           # Name of the PyInstaller executable (from main.py)
DESKTOP_EXEC="main"        # Exec line in .desktop file

# Clean previous builds
rm -rf dist build AppDir *.AppImage *.spec venv *.desktop

# Step 1: Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

pip install -r requirements.txt

# Step 3: Build onefile executable
pyinstaller --onefile --name=$EXEC_NAME --add-data "icon.png:." main.py


# Deactivate venv
deactivate

# Step 4: Download linuxdeploy, appimagetool, and AppImage runtime
wget -c https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage
chmod +x linuxdeploy-x86_64.AppImage
wget -c https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x appimagetool-x86_64.AppImage
wget -c https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64

# Step 5: Create a custom .desktop file with Icon matching the base name of your icon file
cat > ${APP_NAME}.desktop <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Exec=$DESKTOP_EXEC %U
Icon=icon
Categories=Utility;
EOF

mkdir -p AppDir/usr/bin && cp icon.png AppDir/usr/bin/

# Step 6: Populate AppDir with linuxdeploy (no appimage output)
./linuxdeploy-x86_64.AppImage \
  --appdir AppDir \
  --executable dist/$EXEC_NAME \
  --icon-file icon.png \
  --desktop-file ${APP_NAME}.desktop

# Step 7: Package AppImage using appimagetool with local runtime
ARCH=x86_64 ./appimagetool-x86_64.AppImage \
  --runtime-file ./runtime-x86_64 \
  AppDir ${APP_NAME}-${APP_VERSION}-x86_64.AppImage

#Cleanup Build Directories
rm -rf dist build AppDir linuxdeploy-x86_64.AppImage appimagetool-x86_64.AppImage runtime-x86_64 *.spec venv *.desktop

echo "AppImage created: $(ls *.AppImage)"
