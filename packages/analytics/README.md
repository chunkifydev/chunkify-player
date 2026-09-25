# @chunkify/analytics

Standalone playback analytics for a `<video>` element or Chunkify Player. The package is not published yet. It has no runtime dependency on `@chunkify/player` and does not store viewer data. Each event goes to the destinations supplied by the application.

```ts
import { monitor } from "@chunkify/analytics";

const video = document.querySelector("video")!;
const session = monitor(video, {
  videoId: "video_123",
  destinations: [{ send: (event) => console.log(event) }],
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
  destinations: [{ send: (event) => console.log(event) }],
});

// Call when the application removes the player or disables analytics.
session.destroy();
```

`monitor()` selects the direct video collector for `<video>` or the Chunkify adapter for `<chunkify-player>`. The adapter follows the player's active media element when switching between ordinary video and HLS. Other player types are not supported by this function. The lower-level `attachAnalytics()` and `attachPlayerAnalytics()` functions remain available for explicit use.

When Chunkify Player uses hls.js, the adapter also records the selected rendition, rendition switches, playing time by rendition, HLS manifest and segment request totals, transferred bytes, aggregate throughput, and fatal hls.js errors. These measurements are unavailable when playback uses native HLS or ordinary video; the media-level measurements still work.

For a separate player that gives you its `Hls` instance, use the optional hls.js adapter. This example assumes the page has a `<video controls>` element. The adapter follows that element once hls.js attaches it:

```ts
import Hls from "hls.js";
import { monitorHlsJs } from "@chunkify/analytics/hlsjs";

const video = document.querySelector("video")!;
const hls = new Hls();
const session = monitorHlsJs(hls, {
  videoId: "video_123",
  destinations: [{ send: (event) => console.log(event) }],
});
hls.attachMedia(video);
hls.loadSource("https://example.com/video.m3u8");

// Call session.sourceChanged() before replacing the source.
// When finished, call session.destroy() and hls.destroy().
```

For Video.js, call `monitorVideoJs()` after the player is ready. It supports Video.js's HTML5 video Tech and cleans up when Video.js disposes the player. If the optional quality-levels API is present, the adapter records the selected quality and switch count. It does not infer rendition playing time from ABR selections or report network totals that Video.js does not expose through this API:

```ts
import videojs from "video.js";
import { monitorVideoJs } from "@chunkify/analytics/videojs";

const player = videojs("my-video");
player.ready(() => {
  const session = monitorVideoJs(player, {
    videoId: "video_123",
    destinations: [{ send: (event) => console.log(event) }],
  });
  // Call session.destroy() if analytics stops before player.dispose().
});
```

For Shaka Player, attach the media element first, then call `monitorShaka()` before `load()`. The connector enables Shaka's quality observer so it can measure playing time by video rendition at the playhead. It also counts completed network downloads, response bytes, download time, and critical error codes. It discards request URLs and response bodies. Cached responses are excluded from the delivery totals:

```ts
import shaka from "shaka-player";
import { monitorShaka } from "@chunkify/analytics/shaka";

const video = document.querySelector("video")!;
const player = new shaka.Player();
await player.attach(video);
const session = monitorShaka(player, {
  videoId: "video_123",
  destinations: [{ send: (event) => console.log(event) }],
});
session.startAttempt();
await player.load("https://example.com/video.m3u8");
await video.play();

// Call session.destroy() before player.destroy().
```

Shaka's `unloading` event ends the current view on a source change. The next view starts when the new media plays. For that view, downloads completed before playback begins are not included in delivery totals. Call `session.sourceChanged()` yourself if you replace the source outside Shaka. The quality observer must be enabled before Shaka loads content; creating the session after `load()` may leave rendition playing time unavailable until the next load.

Attach before playback begins. The collector listens for media events and emits `view_started`, cumulative `view_snapshot` records after each 30 seconds of playing time, `playback_error`, and `view_ended`. Records include startup time, playing and buffering time, seeks, furthest playhead progress, and browser frame counters when available. `sampleRate` can select a fraction of complete views. `environment` and a customer-supplied pseudonymous `viewerId` are optional.

The final `view_ended` record has `startup_outcome`: `started` after a `playing` event, `failed_before_start` after a fatal error before playback, or `ended_before_start` if the attempt ended without either. Other records have `startup_outcome: null`. Ending before start does not imply that the viewer chose to leave.

`startup_time_ms` measures from the attempt to the first `playing` event. `first_video_frame_time_ms` measures from the attempt until `requestVideoFrameCallback()` reports a video frame sent for composition. A preloaded frame can make this earlier than `startup_time_ms`. It is `null` if the API is unavailable or no frame is observed before the view ends. The callback may run after composition, so this is not the exact display time or proof the viewer saw the frame.

Schema version 4 puts measurements directly on each event, alongside `video_id`, `view_id`, and the other event fields. For example, read `event.startup_time_ms` and `event.rebuffer_count`; there is no `event.metrics` object. The former `completion_ratio` field is now `furthest_progress_ratio`: the highest playhead position divided by media duration, capped at 1. Seeking near the end raises this value even without watching that part of the video, so it is not a percentage watched.

`video_intrinsic_width_css_px` and `video_intrinsic_height_css_px` come from the underlying video's `videoWidth` and `videoHeight`, including for ordinary MP4 and native HLS when available. They are intrinsic display dimensions, not necessarily the raw encoded frame size. They remain `null` until available; the collector retains the latest valid size in a view if the browser clears it while the source is replaced. Selected rendition dimensions remain separate and require an engine connector such as hls.js or Shaka.

Set `snapshotIntervalMs` to change the active playing time between snapshots (integer from 1000 to 2147483647 ms). Set `includeEvents` to choose which event types reach destinations. Both options work with `monitor()`, `monitorHlsJs()`, `monitorVideoJs()`, `monitorShaka()`, and the explicit attach functions. By default, all four event types are sent. For example:

```ts
monitor(video, {
  videoId: "video_123",
  snapshotIntervalMs: 10000,
  includeEvents: ["view_snapshot", "view_ended"],
  destinations: [{ send: (event) => console.log(event) }],
});
```

Event selection does not change collection of the final view's metrics. Excluding `view_snapshot` also skips the snapshot timer. An empty `includeEvents` array sends no records. `destinations` must contain at least one object with a `send(event)` method. The collector delivers each sampled event to every destination and isolates delivery failures.

For hls.js or Shaka playback, `rendition_playing_time` contains cumulative wall-clock milliseconds for each rendition played in the view, grouped by width, height, codec, bitrate, and frame rate. It excludes pauses, buffering, and seeks; playback speed does not change the elapsed time counted. Time before the first known rendition is omitted, so the sum can be less than `playing_time_ms`. The field is `null` without a rendition-aware connector and an empty array when the connector has not identified a rendition yet. Snapshots repeat cumulative totals; consumers should use the final view record or differences between snapshots rather than summing entire snapshots. The package does not aggregate results across viewers.

`videoId` identifies the video in your application. You can pass a Chunkify asset ID or your own ID. Events expose this value as `video_id`.

Destinations keep collection separate from delivery. You can provide a custom destination, or use the included Datadog, PostHog, HTTP, and OTLP adapters. The package does not retry, queue, or guarantee delivery on page exit. Do not put personal information, tokens, or URLs in supplied metadata. The event payload omits raw URLs and error messages.

Use `createEventMapper()` when a destination needs different field names or values. Each output field names a source event field or calculates a value from the event. The mapper returns a new object and leaves the original event unchanged:

```ts
import { createEventMapper, monitor } from "@chunkify/analytics";

const mapForEndpoint = createEventMapper({
  videoId: "video_id",
  viewId: "view_id",
  eventName: "event_name",
  playtimeSeconds: (event) => event.playing_time_ms / 1000,
});

monitor(video, {
  videoId: "video_123",
  destinations: [{ send: (event) => myClient.send(mapForEndpoint(event)) }],
});
```

The mapping runs for each event passed to the destination. For destinations that accept the Chunkify event directly, pass `event` without a mapper. Mapping does not alter collection, event selection, or snapshot timing.

An initialized Datadog RUM client can be passed to the Datadog adapter. It adds one custom action per analytics event, with the full event in its `chunkify` context by default. Pass a mapper as the second argument to choose the action's context; it runs once for each event. For example, this puts two fields directly in the Datadog context:

```ts
import { createDatadogAdapter } from "@chunkify/analytics/datadog";
import { createEventMapper } from "@chunkify/analytics";

monitor(video, {
  videoId: "video_123",
  destinations: [createDatadogAdapter(datadogRum, createEventMapper({
    video_id: "video_id",
    playing_time_ms: "playing_time_ms",
  }))],
});
```

Without a mapper, use `createDatadogAdapter(datadogRum)`. The mapper creates the payload for each action from the current event; it is not a fixed payload supplied at setup time. Datadog setup and sampling remain the application's responsibility. If a dashboard needs derived actions, such as one action per rendition, add a separate custom destination to create them from `view_ended`.

The PostHog adapter accepts an initialized `posthog-js` client. It captures one event per analytics record, with the event's fields as flat PostHog properties. As with Datadog, its optional second argument maps the properties for each event:

```ts
import { createPostHogAdapter } from "@chunkify/analytics/posthog";

monitor(video, {
  videoId: "video_123",
  destinations: [createPostHogAdapter(posthog)],
});
```

The application initializes PostHog and controls its automatic collection and persistence settings. PostHog may add its own event properties, including page context, beyond the fields sent by this adapter; configure the PostHog SDK separately to meet your privacy requirements.

The HTTP adapter posts each event as JSON to a customer-owned endpoint using `fetch`. Pass a mapper as its second argument when the endpoint needs a different payload; otherwise it sends the complete Chunkify event. It accepts an HTTPS URL or root-relative path; loopback HTTP is allowed for local tests. It rejects credentials and query parameters in the endpoint, sends no cookies, and sends no page referrer. The endpoint must support browser CORS when cross-origin and perform its own aggregation. Non-2xx responses reject the adapter's `send()` promise; the collector isolates delivery failures and does not retry them. The final event uses `fetch` keepalive as a best-effort page-exit delivery, subject to browser limits:

```ts
import { createDatadogAdapter } from "@chunkify/analytics/datadog";
import { createHttpAdapter } from "@chunkify/analytics/http";

monitor(video, {
  videoId: "video_123",
  destinations: [
    createDatadogAdapter(datadogRum),
    createHttpAdapter("/api/video-analytics", mapForEndpoint),
  ],
});
```

The application should call `destroy()` when it no longer needs the session. The hls.js adapter removes its listeners but does not destroy the application's HLS engine.

The OTLP adapter sends each event as an OTLP/HTTP JSON log record. Pass the full URL of a customer-owned `/v1/logs` gateway, or a root-relative path to one. The gateway must allow browser CORS when cross-origin and handle any private provider credentials. The adapter sends no cookies or authorization headers. Event fields become typed log attributes; unavailable values are omitted, and `rendition_playing_time` remains a structured array. Snapshots contain cumulative values, so aggregate the final record or differences between snapshots rather than summing all records:

```ts
import { createOtlpAdapter } from "@chunkify/analytics/otlp";

monitor(video, {
  videoId: "video_123",
  destinations: [createOtlpAdapter("https://analytics.example.com/v1/logs")],
});
```
