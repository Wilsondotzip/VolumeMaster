# VolumeMaster Plugin API

Plugins connect to VolumeMaster over a local WebSocket and receive knob events in real time. You can write a plugin in any language that supports WebSockets.
This API is subject to change and should not be considered final yet.

---

## Connecting

When VolumeMaster is running, a WebSocket server is available at:

```
ws://localhost:59284
```

On connect, VolumeMaster immediately sends a welcome message:

```json
{ "type": "connected", "version": "1.4.0" }
```

`version` is the VolumeMaster app version (from its `package.json`).

> **Browsers can't connect.** Connections that send an `Origin` header are refused (HTTP 401). Browsers always send one, so web pages can't reach the API. Native WebSocket clients (Python `websockets`, Node `ws`, .NET `ClientWebSocket`) don't send one by default — don't set it yourself.

---

## Protocol

All messages are JSON, sent in both directions as text frames.

### Plugin → VolumeMaster

#### `register`

Register your plugin and its actions. Send this right after connecting.

```json
{
  "type": "register",
  "pluginId": "my-plugin",
  "name": "My Plugin",
  "actions": [
    { "id": "action-one", "label": "My Plugin: Action One" },
    { "id": "action-two", "label": "My Plugin: Action Two", "kind": "button" },
    { "id": "scene-a", "label": "Scene A", "group": "Scenes" },
    { "id": "scene-b", "label": "Scene B", "group": "Scenes" }
  ]
}
```

| Field      | Description                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pluginId` | Unique string identifier for your plugin. Use something specific to avoid clashes (e.g. `obs-controller`, not `plugin`). Can't contain `:`. |
| `name`     | Display name shown in VolumeMaster's UI.                                                                                 |
| `actions`  | List of actions users can assign to knobs. Each needs a unique `id` and a short `label`.                                 |
| `config`   | Optional. Settings fields for your plugin, shown under **Settings → Managed Plugins**. See [Plugin settings](#plugin-settings). |

VolumeMaster replies with [`registered`](#registered), or [`error`](#error) if the registration was rejected.

Sending `register` again on the same connection replaces your plugin's actions, so a plugin whose actions change (e.g. a new OBS scene was added) can just re-register.

Each action may optionally set `kind` to `"knob"` or `"button"` to restrict where users can assign it — a `"knob"` action can only be dragged onto a knob's turn (volume) targets, a `"button"` action only onto a knob's button-press target (VolumeMaster Pro devices only, whose knobs are push-button rotary encoders). Omit `kind` (or leave it unset) for an action that should be assignable to both. See [`knob-button-down`](#knob-button-down) below for the event a button-assigned action receives.

Each action may also optionally set `group` to a free-text label. Actions sharing the same `group` are clustered together under that heading in VolumeMaster's UI, so a plugin with many actions (e.g. a smart-home or streaming controller) can organize them instead of dumping everything in one flat list. Actions with no `group` are shown ungrouped, above any named groups. This is purely cosmetic — it has no effect on how actions are matched or dispatched.

After registering, your actions appear as draggable cards in the **Plugins** tab inside VolumeMaster, organized under a collapsible section for your plugin (and sub-grouped if you used `group`). Users drag them onto knobs just like apps.

#### Plugin settings

Pass a `config` array in `register` to give your plugin a settings form (host, port, password, ...). VolumeMaster stores the values and sends them to your plugin in a [`config`](#config) message.

```json
{
  "type": "register",
  "pluginId": "obs-controller",
  "name": "OBS Controller",
  "actions": [ ... ],
  "config": [
    { "key": "host",        "type": "text",     "label": "Host", "default": "localhost" },
    { "key": "port",        "type": "number",   "label": "Port", "default": 4455 },
    { "key": "password",    "type": "password", "label": "Password" },
    { "key": "autoConnect", "type": "boolean",  "label": "Connect on startup", "default": true },
    { "key": "mode",        "type": "select",   "label": "Mode", "options": ["scenes", { "value": "audio", "label": "Audio only" }] }
  ]
}
```

| Field         | Description                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `key`         | Required. Name of the value in the `config` message.                                                       |
| `type`        | Required. `text`, `number`, `password`, `boolean` or `select`. Use `password` for anything secret (passwords, API keys, tokens): those values are stored encrypted. |
| `label`       | Shown next to the field.                                                                                   |
| `default`     | Shown in the form until the user saves a value. It isn't sent to your plugin — apply your own default when a key is missing. |
| `placeholder` | Optional hint text for `text`, `number` and `password` fields.                                             |
| `options`     | `select` only. Strings, or `{ "value", "label" }` objects.                                                 |

Users open the form with the **Configure** button next to your plugin in **Settings → Managed Plugins**. That button only appears when your plugin was added there and your `pluginId` matches its executable's filename — `obs-controller.exe` should register as `obs-controller`.

---

### VolumeMaster → Plugin

#### `registered`

Reply to a successful `register`.

```json
{ "type": "registered", "pluginId": "my-plugin", "actions": ["action-one", "action-two"] }
```

`actions` lists the action ids that were accepted. If some were dropped (each needs an `id` and a `label`), the reply also has `skipped` (how many) and a `message`.

#### `error`

Sent when a message is rejected — invalid JSON, an unknown `type`, or a `register` with a missing or invalid `pluginId`.

```json
{ "type": "error", "message": "register: pluginId can't contain ':'." }
```

#### `config`

Your plugin's saved settings. Sent after `register` if you included a `config` schema, and again whenever the user saves the settings form.

```json
{ "type": "config", "values": { "host": "localhost", "port": 4455, "password": "hunter2", "autoConnect": true } }
```

`values` only contains keys the user has saved. `number` fields arrive as numbers, `boolean` fields as `true`/`false`, and everything else as strings.

#### `knob`

Sent whenever a knob moves **and** your plugin has an action assigned to that knob.

```json
{
  "type": "knob",
  "index": 1,
  "value": 75,
  "actionId": "action-one",
  "deviceId": "abc12345"
}
```

| Field      | Description                                                                         |
| ---------- | ----------------------------------------------------------------------------------- |
| `index`    | Which knob moved (matches the knob number shown in VolumeMaster).                   |
| `value`    | Knob position, `0`–`100`.                                                           |
| `actionId` | The `id` of whichever action the user assigned to this knob.                        |
| `deviceId` | Which VolumeMaster device sent the event (useful if the user has multiple devices). |
| `sync`     | Present (`true`) when this isn't a movement but the knob's current value, sent so you can match it — see below. |

> You only receive events for knobs that have one of your actions assigned. If no knob has your action assigned, you receive nothing.

**Current values.** Right after you register, you're sent a `knob` event with `"sync": true` for each knob that has one of your actions assigned, so you can start in step with the knob instead of waiting for it to move. The same happens when the user assigns one of your actions to a knob. Only knobs that have reported a position since VolumeMaster started are included.

#### `knob-button-down`

Sent when a knob's button is pressed (VolumeMaster Pro devices only, whose knobs are push-button rotary encoders) **and** your plugin has an action assigned to that knob's button.

```json
{
  "type": "knob-button-down",
  "index": 3,
  "actionId": "press-thing",
  "deviceId": "abc12345"
}
```

| Field      | Description                                                                         |
| ---------- | ------------------------------------------------------------------------------------ |
| `index`    | Which knob's button was pressed.                                                    |
| `actionId` | The `id` of whichever `kind: "button"` (or unrestricted) action the user assigned.   |
| `deviceId` | Which VolumeMaster device sent the event (useful if the user has multiple devices). |

There's no `value` — a button press is a discrete event, not a level. It fires as soon as the button goes down; see [`knob-button-up`](#knob-button-up) for the release.

#### `knob-button-up`

Sent when the button is released, to the same actions as `knob-button-down`.

```json
{
  "type": "knob-button-up",
  "index": 3,
  "holdMs": 650,
  "actionId": "press-thing",
  "deviceId": "abc12345"
}
```

`holdMs` is how long the button was held, in milliseconds, so you can tell a tap from a hold. To act only on one or the other, ignore `knob-button-down` and decide on release (e.g. `holdMs < 500` is a tap).

---

## Installing a Plugin

1. Open VolumeMaster → **Settings** → **Managed Plugins**
2. Click **+ Add Plugin...**
3. Select your plugin's executable (`.exe`)
4. VolumeMaster copies it into its plugins folder and starts it automatically

From then on the plugin launches with VolumeMaster and shuts down when VolumeMaster closes.

> **Non-exe plugins:** If your plugin is a script (`.py`, `.js`, etc.), wrap it in a small launcher executable or a `.bat` file that runs it, then add that to VolumeMaster.

---

## Examples

### Python

Requires: `pip install websockets`

```python
import asyncio
import json
import websockets

async def run():
    async with websockets.connect("ws://localhost:59284") as ws:
        await ws.recv()  # welcome message

        await ws.send(json.dumps({
            "type":     "register",
            "pluginId": "my-plugin",
            "name":     "My Plugin",
            "actions":  [
                { "id": "do-thing", "label": "My Plugin: Do Thing" }
            ]
        }))

        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "knob" and msg["actionId"] == "do-thing":
                print(f"Knob {msg['index']} → {msg['value']}%")

asyncio.run(run())
```

### Node.js

Requires: `npm install ws`

```js
const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:59284");

ws.on("open", () => {
  ws.once("message", () => {
    // discard welcome
    ws.send(
      JSON.stringify({
        type: "register",
        pluginId: "my-plugin",
        name: "My Plugin",
        actions: [{ id: "do-thing", label: "My Plugin: Do Thing" }],
      }),
    );
  });
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === "knob" && msg.actionId === "do-thing") {
    console.log(`Knob ${msg.index} → ${msg.value}%`);
  }
});
```

### C#

```csharp
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

var ws = new ClientWebSocket();
await ws.ConnectAsync(new Uri("ws://localhost:59284"), CancellationToken.None);

// Read welcome
var buf = new byte[1024];
await ws.ReceiveAsync(buf, CancellationToken.None);

// Register
var reg = JsonSerializer.Serialize(new {
    type     = "register",
    pluginId = "my-plugin",
    name     = "My Plugin",
    actions  = new[] {
        new { id = "do-thing", label = "My Plugin: Do Thing" }
    }
});
await ws.SendAsync(Encoding.UTF8.GetBytes(reg), WebSocketMessageType.Text, true, CancellationToken.None);

// Listen
while (ws.State == WebSocketState.Open) {
    var result = await ws.ReceiveAsync(buf, CancellationToken.None);
    var msg = JsonDocument.Parse(buf.AsMemory(0, result.Count));
    if (msg.RootElement.GetProperty("type").GetString() == "knob") {
        var value = msg.RootElement.GetProperty("value").GetInt32();
        Console.WriteLine($"Knob value: {value}%");
    }
}
```

---

## Tips

- **Reconnect automatically.** VolumeMaster may restart. Your plugin should retry the WebSocket connection on failure with a short delay (1–2 seconds).
- **`pluginId` must be unique.** If two plugins register the same `pluginId`, they'll share actions in the UI. Use a specific name like `obs-scene-switcher`, not `plugin`.
- **Handle partial values.** Knobs send continuous values as they're turned — you'll receive many events per second while a knob is moving. Debounce or throttle if your action is expensive.
- **Value range is always 0–100.** Map this to whatever range your target needs (e.g. multiply by 2.55 for 0–255 RGB, or use it as a percentage directly).
