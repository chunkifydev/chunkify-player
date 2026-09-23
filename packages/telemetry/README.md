# @chunkify/telemetry

Standalone playback telemetry for a `<video>` element or Chunkify Player. The package is not published yet. It has no runtime dependency on `@chunkify/player`, does not send network requests, and does not store viewer data. Each event goes to the callback supplied by the application.

```ts
import { monitor } from "@chunkify/telemetry";

const video = document.querySelector("video")!;
const session = monitor(video, {
  assetId: "asset_123",
  provider: "callback",
  send: (event) => console.log(event),
});

// Call before programmatic play() to count attempts that reject without a play event.
session.startAttempt();
await video.play();

// Call when removing the video or disabling telemetry.
session.destroy();
```

The same function accepts Chunkify Player. Import the player first so its custom element is registered:

```ts
import "@chunkify/player";
import { monitor } from "@chunkify/telemetry";

const player = document.querySelector("chunkify-player")!;
const session = monitor(player, {
  assetId: "asset_123",
  provider: "callback",
  send: (event) => console.log(event),
});

// Call when the application removes the player or disables telemetry.
session.destroy();
```

`monitor()` selects the direct video collector for `<video>` or the Chunkify adapter for `<chunkify-player>`. The adapter follows the player's active media element when switching between ordinary video and HLS. Other player types are not supported by this function. The lower-level `attachTelemetry()` and `attachPlayerTelemetry()` functions remain available for explicit use.

Attach before playback begins. The collector listens for media events and emits `view_started`, cumulative `view_snapshot` records after each 30 seconds of playing time, `playback_error`, and `view_ended`. Records include startup time, playing and buffering time, seeks, completion, and browser frame counters when available. `sampleRate` can select a fraction of complete views. `environment` and a customer-supplied pseudonymous `viewerId` are optional.

The callback keeps collection separate from delivery. It can inspect or store events now; a future destination adapter can consume the same versioned events without changing the player integration. The package does not retry, queue, or guarantee delivery of asynchronous callbacks on page exit. Do not put personal information, tokens, or URLs in supplied metadata. The event payload omits raw URLs and error messages.

The Chunkify adapter currently collects the same media-level measurements as the plain video integration. Extra hls.js rendition and delivery measurements are a separate possible step. The application should call `destroy()` when it no longer needs the session.
