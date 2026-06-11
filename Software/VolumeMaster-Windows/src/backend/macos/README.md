# VolumeMaster macOS Backend

Swift port of the Windows backend (`src/backend/main.pyw`). Electron spawns it
per device with the device directory as cwd, reads the same stdout protocol
(`STATUS:SERIAL_OK`, `ERROR:COM_PORT:...`, `VOLUME:<index>:<value>`, ...), and
it reads the same `config.yaml`, reloading it live when settings change.

## Building

```sh
swift build -c release        # or: npm run prebuild:mac (from the app root)
```

The binary lands at `.build/release/VolumeMaster-Headless`. In development the
Electron app picks it up from there automatically; `npm run build:mac` copies
it into the app's Resources directory.

## Feature mapping vs Windows

| Feature | Windows (main.pyw) | macOS |
| --- | --- | --- |
| Serial input (`value@index`) | pyserial | POSIX termios on `/dev/cu.*` |
| Master volume (`master`) | WASAPI endpoint | CoreAudio default output device |
| Mic volume (`MicNames`) | WASAPI capture endpoints | CoreAudio input devices (substring match) |
| Per-app volume (`ProcessNames`) | WASAPI audio sessions | AppleScript `sound volume` |
| Voicemeeter | voicemeeter-remote | Not available — warned and ignored |
| config.yaml live reload | watchdog | mtime polling (0.5s) |

### Per-app volume caveat

macOS has no public per-application audio API (the equivalent of WASAPI
sessions). The backend uses AppleScript's `sound volume`, which works for
scriptable media apps — Spotify, Music, VLC, QuickTime Player — and reports a
one-time notice for apps that don't support it. The first time a given app is
controlled, macOS shows an Automation permission prompt that must be accepted.

`master` and microphone mappings work for everything system-wide.

## Extras

`VolumeMaster-Headless --list-inputs` prints CoreAudio input device names one
per line; the Electron settings UI uses this for the mic picker so names match
exactly what the backend matches against.

`VolumeMaster-Headless --app-icon <path>` writes the file's Finder icon as a
64×64 PNG to stdout. The Electron app uses this for process icons because
`app.getFileIcon` crashes Electron's main process on recent macOS versions.
