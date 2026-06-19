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
{ "type": "connected", "version": "1.3.3" }
```

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
    { "id": "action-two", "label": "My Plugin: Action Two" }
  ]
}
```

| Field      | Description                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pluginId` | Unique string identifier for your plugin. Use something specific to avoid clashes (e.g. `obs-controller`, not `plugin`). |
| `name`     | Display name shown in VolumeMaster's UI.                                                                                 |
| `actions`  | List of actions users can assign to knobs. Each needs a unique `id` and a short `label`.                                 |

After registering, your actions appear as draggable cards in the **Plugins** tab inside VolumeMaster. Users drag them onto knobs just like apps.

---

### VolumeMaster → Plugin

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

> You only receive events for knobs that have one of your actions assigned. If no knob has your action assigned, you receive nothing.

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
