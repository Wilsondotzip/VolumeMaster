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
| Per-app volume (`ProcessNames`) | WASAPI audio sessions | FineTune URL scheme, AppleScript fallback |
| Voicemeeter | voicemeeter-remote | Not available — warned and ignored |
| config.yaml live reload | watchdog | mtime polling (0.5s) |

### Per-app volume

macOS has no public per-application audio API (the equivalent of WASAPI
sessions), so the backend supports two strategies:

**FineTune (recommended)** — [FineTune](https://github.com/ronitsingh10/FineTune)
is an open-source (GPL-3.0) per-app volume mixer built on Core Audio process
taps. When it is installed, the backend automatically drives it through its
[documented URL scheme](https://github.com/ronitsingh10/FineTune/blob/main/guide/url-schemes.md)
(`finetune://set-volumes?app=<bundle-id>&volume=<0-100>`), giving true per-app
mixing for **any** app — browsers, games, Discord, everything. Knob events for
a whole knob group are batched into a single URL. The integration is
arm's-length: FineTune is a separately installed app controlled via its public
URL API; no FineTune code is linked into or copied from this project, so the
licenses remain independent.

**AppleScript fallback** — without FineTune, the backend falls back to
AppleScript's `sound volume`, which only works for scriptable media apps
(Spotify, Music, VLC, QuickTime Player). The first time a given app is
controlled, macOS shows an Automation permission prompt that must be accepted.

`master` and microphone mappings work for everything system-wide either way.

## Extras

`VolumeMaster-Headless --list-inputs` prints CoreAudio input device names one
per line; the Electron settings UI uses this for the mic picker so names match
exactly what the backend matches against.

`VolumeMaster-Headless --app-icon <path>` writes the file's Finder icon as a
64×64 PNG to stdout. The Electron app uses this for process icons because
`app.getFileIcon` crashes Electron's main process on recent macOS versions.
