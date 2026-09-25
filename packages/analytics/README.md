# @chunkify/analytics

Standalone playback analytics for a `<video>` element or Chunkify Player. The package is not published yet. It has no runtime dependency on `@chunkify/player`, does not send network requests, and does not store viewer data. Each event goes to the callback supplied by the application.

```ts
import { monitor } from "@chunkify/analytics";

const video = document.querySelector("video")!;
const session = monitor(video, {
  videoId: "video_123",
  send: (event) => console.log(event),
});

// Call before programmatic play() to count attempts that reject without a play event.
session.startAttempt();
await video.play();

// Call when removing the video or disabling analytics.
session.destroy();
```

The same function accepts Chunkify Player. Import the player first so its custom element is registered:

```ts
import "@chunkify/player";
import { monitor } from "@chunkify/analytics";

const player = document.querySelector("chunkify-player")!;
const session = monitor(player, {
  videoId: "video_123",
  send: (event) => console.log(event),
});

// Call when the application removes the player or disables analytics.
session.destroy();
```

`monitor()` selects the direct video collector for `<video>` or the Chunkify adapter for `<chunkify-player>`. The adapter follows the player's active media element when switching between ordinary video and HLS. Other player types are not supported by this function. The lower-level `attachAnalytics()` and `attachPlayerAnalytics()` functions remain available for explicit use. `attachAnalytics(media, options, playerElement)` can optionally measure a separate visible player element; without it, the media element is measured.

When Chunkify Player uses hls.js, the adapter also records the selected rendition, rendition switches, playing time by rendition, HLS manifest and segment request totals, transferred bytes, aggregate throughput, and fatal hls.js errors. These measurements are unavailable when playback uses native HLS or ordinary video; the media-level measurements still work.

For a separate player that gives you its `Hls` instance, use the optional hls.js adapter. This example assumes the page has a `<video controls>` element. The adapter follows that element once hls.js attaches it:

```ts
import Hls from "hls.js";
import { monitorHlsJs } from "@chunkify/analytics/hlsjs";

const video = document.querySelector("video")!;
const hls = new Hls();
const session = monitorHlsJs(hls, {
  videoId: "video_123",
  send: (event) => console.log(event),
});
hls.attachMedia(video);
hls.loadSource("https://example.com/video.m3u8");

// Call session.sourceChanged() before replacing the source.
// When finished, call session.destroy() and hls.destroy().
```

Attach before playback begins. The collector listens for media events and emits `view_started`, cumulative `view_snapshot` records after each 30 seconds of playing time, `playback_error`, and `view_ended`. Records include startup time, playing and buffering time, seeks, furthest playhead progress, and browser frame counters when available. `sampleRate` can select a fraction of complete views. `environment` and a customer-supplied pseudonymous `viewerId` are optional.

The final `view_ended` record has `startup_outcome`: `started` after a `playing` event, `failed_before_start` after a fatal error before playback, or `ended_before_start` if the attempt ended without either. Other records have `startup_outcome: null`. Ending before start does not imply that the viewer chose to leave.

`startup_time_ms` measures from the attempt to the first `playing` event. `first_video_frame_time_ms` measures from the attempt until `requestVideoFrameCallback()` reports a video frame sent for composition. A preloaded frame can make this earlier than `startup_time_ms`. It is `null` if the API is unavailable or no frame is observed before the view ends. The callback may run after composition, so this is not the exact display time or proof the viewer saw the frame.

Schema version 3 names the former `completion_ratio` field `metrics.furthest_progress_ratio`. It is the highest playhead position divided by media duration, capped at 1. Seeking near the end raises this value even without watching that part of the video, so it is not a percentage watched.

Each emitted record samples `player_width_css_px` and `player_height_css_px` from the displayed element's bounding box. For Chunkify Player this is the outer `<chunkify-player>`; for direct video and hls.js monitoring it is the media element. These fields are `null` when the player has no laid-out area and can change after resizing or fullscreen. `metrics.video_intrinsic_width_css_px` and `metrics.video_intrinsic_height_css_px` come from the underlying video's `videoWidth` and `videoHeight`, including for ordinary MP4 and native HLS when available. They are intrinsic display dimensions, not necessarily the raw encoded frame size. They remain `null` until available; the collector retains the latest valid size in a view if the browser clears it while the source is replaced. The selected HLS rendition dimensions remain separate and require the hls.js connector.

Set `snapshotIntervalMs` to change the active playing time between snapshots (integer from 1000 to 2147483647 ms). Set `includeEvents` to choose which event types reach `send`. Both options work with `monitor()`, `monitorHlsJs()`, and the explicit attach functions. By default, all four event types are sent. For example:

```ts
monitor(video, {
  videoId: "video_123",
  snapshotIntervalMs: 10000,
  includeEvents: ["view_snapshot", "view_ended"],
  send: (event) => console.log(event),
});
```

Event selection does not change collection of the final view's metrics. Excluding `view_snapshot` also skips the snapshot timer. An empty `includeEvents` array sends no records.

For hls.js playback, `metrics.rendition_playing_time` contains cumulative wall-clock milliseconds for each rendition played in the view, grouped by width, height, codec, manifest bitrate, and frame rate. It excludes pauses, buffering, and seeks; playback speed does not change the elapsed time counted. Time before the first known rendition is omitted, so the sum can be less than `playing_time_ms`. The field is `null` without a rendition-aware connector and an empty array when hls.js has not identified a rendition yet. Snapshots repeat cumulative totals; consumers should use the final view record or differences between snapshots rather than summing entire snapshots. The package does not aggregate results across viewers.

`videoId` identifies the video in your application. You can pass a Chunkify asset ID or your own ID. Events expose this value as `video_id`.

The callback keeps collection separate from delivery. It can inspect or store events now; a future destination adapter can consume the same versioned events without changing the player integration. The package does not retry, queue, or guarantee delivery of asynchronous callbacks on page exit. Do not put personal information, tokens, or URLs in supplied metadata. The event payload omits raw URLs and error messages.

The application should call `destroy()` when it no longer needs the session. The hls.js adapter removes its listeners but does not destroy the application's HLS engine.
