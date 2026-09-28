# @chunkify/analytics

Standalone playback analytics for Chunkify Player, a native `<video>`, and supported third-party players. The package is not published yet. It has no runtime dependency on `@chunkify/player` and does not send data to Chunkify. Each event goes to the destinations supplied by the application.

## Monitor a video element or Chunkify Player

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

## Monitor third-party players

Use the connector for the player's public media API. All connectors take the same analytics options and return a session with `destroy()`.

### hls.js

For a separate player that gives you its `Hls` instance, use the optional hls.js adapter. This example assumes the page has a `<video controls>` element. The adapter follows that element once hls.js attaches it:

```ts
import Hls from "hls.js";
import { monitorHlsJs } from "@chunkify/analytics";

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

### Video.js 10

For Video.js 10 HLS media (`<hls-video>`, `<hlsjs-video>`, or `<native-hls-video>`), pass the media element to `monitorVideoJs()`, not the outer `<video-player>`. The collector reads standard playback events from the element. With `<hlsjs-video>` using MSE, it also reads rendition and request metrics from the element's public hls.js `engine`. Native HLS and the lightweight `<hls-video>` expose fewer engine metrics, so those values remain null. For a plain `<video>` inside Video.js 10, use `monitor(video, options)`:

```html
<video-player>
  <video-skin style="display: block; width: 100%; aspect-ratio: 16 / 9">
    <hlsjs-video src="/video.m3u8"></hlsjs-video>
  </video-skin>
</video-player>
```

```ts
import "@videojs/html/video/player";
import "@videojs/html/video/skin";
import "@videojs/html/media/hlsjs-video";
import { monitorVideoJs } from "@chunkify/analytics";

const media = document.querySelector("hlsjs-video")!;
const session = monitorVideoJs(media, {
  videoId: "video_123",
  destinations: [{ send: (event) => console.log(event) }],
});
// Call session.destroy() when the media element is removed.
```

This integration targets the [Video.js 10 HTML API](https://videojs.org/docs/framework/html/guides/architecture), which is currently a release candidate. It does not target Video.js 8. Video.js also defines an `<hls-video>` tag; that is different from the `hls-video-element` used by Chunkify Player. Use `monitor()` for `<chunkify-player>`.

### Shaka Player

For Shaka Player, use a page with `<video controls>`, attach Shaka to it, then call `monitorShaka()` before `load()`. The connector starts each view on Shaka's `loading` event and enables Shaka's quality observer so it can measure playing time by video rendition at the playhead. It also counts completed network downloads, response bytes, download time, and critical error codes. It discards request URLs and response bodies. Cached responses are excluded from the delivery totals:

```ts
import shaka from "shaka-player";
import { monitorShaka } from "@chunkify/analytics";

shaka.polyfill.installAll();
const video = document.querySelector("video")!;
const player = new shaka.Player();
await player.attach(video);
const session = monitorShaka(player, {
  videoId: "video_123",
  destinations: [{ send: (event) => console.log(event) }],
});
await player.load("https://example.com/video.m3u8");
// The viewer can now use the video's controls.

// Call session.destroy() before player.destroy().
```

Shaka's `unloading` event ends the current view on a source change; its next `loading` event starts a fresh view. Call `session.sourceChanged()` yourself if you replace the source outside Shaka. The quality observer must be enabled before Shaka loads content; creating the session after `load()` may leave rendition playing time unavailable until the next load. `session.destroy()` restores the prior quality-observer setting if monitoring enabled it.
Shaka may reject `player.load()` without dispatching an `error` event. Handle that promise rejection in your application; only Shaka's emitted critical errors become `playback_error` records.
See [Shaka's setup guide](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/basic-usage.md) for browser support, polyfills, and player setup.

### Check Video.js and Shaka locally

Run `npm run build` and `npm run serve` in this repository, then use `http://127.0.0.1:4173/tests/fixtures/media/master.m3u8` as the HLS source in either example above. Serve your test page from the same `127.0.0.1:4173` origin, or configure CORS if it runs on another origin. Do not open it as a `file://` URL. The test page also needs Video.js 10 with its hls.js media package, or `shaka-player`, installed and loaded.

Keep the console destination in the examples, play the video, seek, then stop or destroy the session. Look for `chunkify.video.view_started` and `chunkify.video.view_ended` with the same `view_id` and increasing `sequence`. Set `snapshotIntervalMs: 1000` to see snapshots after one second of active playback. For Video.js `<hlsjs-video>` and Shaka, inspect `selected_rendition_height`, `rendition_playing_time`, and `delivery_request_count` in a later snapshot or final event. The fixture has only one rendition, so test rendition switches with a multi-rendition manifest. An unavailable engine measurement is `null`.

## Events and metrics

Every raw event has the same fields. The four event names are `chunkify.video.view_started`, `chunkify.video.view_snapshot`, `chunkify.video.playback_error`, and `chunkify.video.view_ended`. Snapshots contain cumulative measurements for one `view_id`, normally after each 30 seconds of active playing time. A value is `null` when it is unavailable or does not apply; the collector does not guess it.

### Complete Chunkify Player event example

This complete `view_ended` event is based on `<chunkify-player>` playing a local HLS stream, with timing values rounded for readability. The component used hls.js for this stream, so `connector_name` and `player_name` report `hls.js`. It is the **raw Chunkify event** passed to `send(event)`; an adapter or mapper can reshape it for a destination.

```json
{
  "schema_version": 4,
  "event_name": "chunkify.video.view_ended",
  "event_id": "06581e06-96d7-421c-b77b-22a6e615c97e",
  "sequence": 2,
  "occurred_at": "2026-09-28T07:35:10.879Z",
  "view_id": "8267fd81-ecf6-4fb1-83d9-4d1fba46b1b6",
  "video_id": "video_123",
  "sdk_name": "@chunkify/analytics",
  "sdk_version": "0.0.0",
  "connector_name": "hls.js",
  "connector_version": "1.7.3",
  "player_name": "hls.js",
  "player_version": "1.7.3",
  "delivery_hostname": null,
  "environment": null,
  "viewer_id": null,
  "reason": "ended",
  "startup_outcome": "started",
  "error_category": null,
  "error_code": null,
  "error_fatal": null,
  "error_playhead_seconds": null,
  "media_duration_seconds": 6.021333,
  "startup_time_ms": 2,
  "first_video_frame_time_ms": 114,
  "playing_time_ms": 6086,
  "rebuffer_count": 0,
  "rebuffer_duration_ms": 0,
  "rebuffer_ratio": 0,
  "seek_count": 0,
  "seek_duration_ms": 0,
  "maximum_playhead_seconds": 6.021333,
  "furthest_progress_ratio": 1,
  "video_intrinsic_width_css_px": 256,
  "video_intrinsic_height_css_px": 144,
  "dropped_video_frames": 0,
  "total_video_frames": 68,
  "selected_rendition_width": 256,
  "selected_rendition_height": 144,
  "selected_rendition_codec": null,
  "selected_rendition_bitrate_bps": 250000,
  "rendition_switch_count": 0,
  "delivery_request_count": 2,
  "delivery_transferred_bytes": 96329,
  "delivery_throughput_bps": 175143637,
  "rendition_playing_time": [
    {
      "width": 256,
      "height": 144,
      "codec": null,
      "bitrate_bps": 250000,
      "frame_rate": null,
      "playing_time_ms": 6085
    }
  ]
}
```

### Field guide

| Fields | Meaning |
| --- | --- |
| `schema_version`, `event_name`, `event_id`, `sequence`, `occurred_at` | Contract version, event type, unique event ID, sequence within this view, and UTC event time. |
| `view_id`, `video_id` | Ephemeral playback-attempt ID and the `videoId` supplied by your application. A new attempt gets a new `view_id`. |
| `sdk_name`, `sdk_version`, `connector_name`, `connector_version`, `player_name`, `player_version` | The collector, connector, and player that produced the record. Player fields can be `null`. |
| `delivery_hostname`, `environment`, `viewer_id` | Delivery host when available, optional application environment, and optional pseudonymous `viewerId` supplied by the application. No complete URL or viewer identity is generated. |
| `reason`, `startup_outcome` | End reason and startup result on `view_ended`; `null` on other events. Ending before startup does not establish why the viewer left. |
| `error_category`, `error_code`, `error_fatal`, `error_playhead_seconds` | Normalized error details on `playback_error`; otherwise `null`. Raw error messages and URLs are not included. |
| `media_duration_seconds`, `startup_time_ms`, `first_video_frame_time_ms`, `playing_time_ms` | Media duration; time from attempt to first `playing`; time to the first frame callback; cumulative actual playing time. The two startup measurements can differ. |
| `rebuffer_count`, `rebuffer_duration_ms`, `rebuffer_ratio`, `seek_count`, `seek_duration_ms` | Counts, cumulative durations, and rebuffer time divided by playing plus rebuffer time. The ratio is `null` until its denominator is positive. |
| `maximum_playhead_seconds`, `furthest_progress_ratio` | Furthest playhead reached and that position divided by duration, capped at 1. Seeking near the end raises the ratio without watching the intervening video. |
| `video_intrinsic_width_css_px`, `video_intrinsic_height_css_px`, `dropped_video_frames`, `total_video_frames` | Intrinsic display dimensions and browser frame counters when exposed. The dimensions are not necessarily encoded frame dimensions. |
| `selected_rendition_width`, `selected_rendition_height`, `selected_rendition_codec`, `selected_rendition_bitrate_bps`, `rendition_switch_count` | Current video rendition and switches when an engine connector exposes them. Width and height are in pixels; bitrate is in bits per second. |
| `rendition_playing_time` | Cumulative wall-clock milliseconds by rendition. Each entry has `width`, `height`, `codec`, `bitrate_bps`, `frame_rate`, and `playing_time_ms`. It is `null` without a rendition-aware connector and `[]` before one identifies a rendition. |
| `delivery_request_count`, `delivery_transferred_bytes`, `delivery_throughput_bps` | Aggregate requests, response bytes, and throughput where the engine exposes them. Throughput is in bits per second. |

`videoId` can be a Chunkify asset ID or your own video ID. It appears as `video_id` in every event.

`reason` can be `ended`, `destroyed`, `source_changed`, or `page_exit`. `startup_outcome` can be `started`, `failed_before_start`, or `ended_before_start`. Error categories are `aborted`, `network`, `decode`, `unsupported`, or `unknown`.

`first_video_frame_time_ms` uses `requestVideoFrameCallback()` and may remain `null` or precede `startup_time_ms` for a preloaded frame. It is not proof that the viewer saw the frame. `rendition_playing_time` excludes pauses, buffering, seeks, and playback before a rendition is known, so its sum can be lower than `playing_time_ms`. Snapshots repeat cumulative totals: use the final record or differences between snapshots, not the sum of whole snapshots. This package does not aggregate across viewers.

### Collection options

All monitor functions accept `snapshotIntervalMs` to change the active playing time between snapshots (integer from 1,000 to 2,147,483,647 ms) and `includeEvents` to select which records reach destinations. All four event types are included by default:

```ts
monitor(video, {
  videoId: "video_123",
  snapshotIntervalMs: 10000,
  includeEvents: ["view_snapshot", "view_ended"],
  destinations: [{ send: (event) => console.log(event) }],
});
```

Excluding `view_snapshot` stops its timer but does not stop collection of the final view's metrics. An empty `includeEvents` array sends no records.

`sampleRate` is a probability from 0 to 1, checked once when each playback attempt starts; it defaults to 1. A value of `0` samples no attempts, and `1` samples every attempt. For example:

```ts
monitor(player, {
  videoId: "video_123",
  sampleRate: 0.1,
  destinations: [{ send: (event) => console.log(event) }],
});
```

This selects roughly 10% of playback attempts. A selected attempt sends the events that occur and are allowed by `includeEvents`; an unselected attempt sends none. Each new attempt is sampled independently, so this is not an exact count or a per-viewer decision. Counts from a sampled destination are not total view counts.

`environment` and a customer-supplied pseudonymous `viewerId` are optional; if omitted, their event fields are `null`. No persistent viewer identity is created by default.

## Map event fields

Use `createEventMapper()` when a destination needs different field names or values. Each output field names a source event field or calculates a value from the event. The mapper returns a new object and leaves the original event unchanged:

```ts
import { createEventMapper, monitor } from "@chunkify/analytics";
import { createHttpAdapter } from "@chunkify/analytics/http";

const mapForEndpoint = createEventMapper({
  videoId: "video_id",
  viewId: "view_id",
  eventName: "event_name",
  playtimeSeconds: (event) => event.playing_time_ms / 1000,
});

monitor(video, {
  videoId: "video_123",
  destinations: [createHttpAdapter("/api/video-analytics", mapForEndpoint)],
});
```

The mapping runs for each event passed to the destination. For destinations that accept the Chunkify event directly, omit the mapper. Mapping does not alter collection, event selection, or snapshot timing. Use `includeEvents` to select event types and `snapshotIntervalMs` to set snapshot cadence.

## Send events to a destination

Destinations keep collection separate from delivery. Provide at least one included adapter or object with `send(event)`. Every sampled event goes to every destination. The package does not retry, queue, or guarantee delivery on page exit. Do not put personal information, tokens, or URLs in supplied metadata. The event payload omits raw URLs and error messages.

### Datadog RUM

Install `@datadog/browser-rum` in your application. Initialize it with your RUM application ID and **client token** (not a Datadog API key), then pass the client to the adapter. The adapter adds one custom action per analytics event, with the event fields directly in the action context by default:

```ts
import { datadogRum } from "@datadog/browser-rum";
import { monitor } from "@chunkify/analytics";
import { createDatadogAdapter } from "@chunkify/analytics/datadog";

datadogRum.init({
  applicationId: "YOUR_DATADOG_APPLICATION_ID",
  clientToken: "YOUR_DATADOG_RUM_CLIENT_TOKEN",
  site: "datadoghq.com", // Use your organization's Datadog site.
});

monitor(document.querySelector("video")!, {
  videoId: "video_123",
  destinations: [createDatadogAdapter(datadogRum)],
});
```

Pass a mapper as the second argument to choose or rename context fields; it runs for each event. Datadog sampling remains the application's responsibility. If a dashboard needs derived actions, such as one action per rendition, add a separate custom destination to create them from `view_ended`.

### PostHog

Install `posthog-js` in your application. Initialize it with your project token and ingestion host, then pass it to the adapter. The adapter captures one event per analytics record, with the event's fields as flat PostHog properties. Its optional second argument maps the properties for each event:

```ts
import posthog from "posthog-js";
import { monitor } from "@chunkify/analytics";
import { createPostHogAdapter } from "@chunkify/analytics/posthog";

posthog.init("YOUR_POSTHOG_PROJECT_TOKEN", {
  api_host: "https://us.i.posthog.com", // Use your project's ingestion host.
});

monitor(document.querySelector("video")!, {
  videoId: "video_123",
  destinations: [createPostHogAdapter(posthog)],
});
```

The application controls PostHog's automatic collection and persistence settings. PostHog may add its own event properties, including page context, beyond the fields sent by this adapter; configure the PostHog SDK separately to meet your privacy requirements.

### OTLP/HTTP logs

The OTLP adapter sends each event as an OTLP/HTTP JSON log record. Pass the full URL of a customer-owned `/v1/logs` gateway, or a root-relative path to one. The gateway must allow browser CORS when cross-origin and handle any private provider credentials. The adapter sends no cookies or authorization headers. By default, all event fields become typed log attributes; unavailable values are omitted, and `rendition_playing_time` remains a structured array. Pass a mapper as the second argument to choose or rename log attributes. The OTLP event name, timestamp, and scope still come from the original event. Snapshots contain cumulative values, so aggregate the final record or differences between snapshots rather than summing all records:

```ts
import { createEventMapper } from "@chunkify/analytics";
import { createOtlpAdapter } from "@chunkify/analytics/otlp";

const attributes = createEventMapper({
  video_id: "video_id",
  view_id: "view_id",
  event_id: "event_id",
  playing_time_ms: "playing_time_ms",
});

monitor(video, {
  videoId: "video_123",
  destinations: [createOtlpAdapter("https://analytics.example.com/v1/logs", attributes)],
});
```

This adapter emits OTLP **logs**, not OTLP metrics. Your gateway or provider handles storage and aggregation.

### HTTP endpoint

The HTTP adapter posts each event as JSON to a customer-owned endpoint using `fetch`. Pass a mapper as its second argument when the endpoint needs a different payload; otherwise it sends the complete Chunkify event. It accepts an HTTPS URL or root-relative path; loopback HTTP is allowed for local tests. It rejects credentials and query parameters in the endpoint, sends no cookies, and sends no page referrer. The endpoint must support browser CORS when cross-origin and perform its own aggregation. Non-2xx responses reject the adapter's `send()` promise; the collector isolates delivery failures and does not retry them. The final event uses `fetch` keepalive as a best-effort page-exit delivery, subject to browser limits:

```ts
import { createHttpAdapter } from "@chunkify/analytics/http";

monitor(video, {
  videoId: "video_123",
  destinations: [createHttpAdapter("/api/video-analytics")],
});
```

### Custom destination

No adapter is needed when you want the normalized event as-is. A destination can inspect it, map it, or pass it to your own client:

```ts
monitor(video, {
  videoId: "video_123",
  destinations: [{ send(event) { console.log(event); } }],
});
```
