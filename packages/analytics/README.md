# @chunkify/player-analytics

Standalone playback analytics for Chunkify Player, a native `<video>`, and supported third-party players. It has no runtime dependency on `@chunkify/player` and no built-in analytics endpoint. Each event goes to the destinations supplied by the application.

```sh
npm install @chunkify/player-analytics
```

## Monitor Chunkify Player or a video element

Add the player to your page:

```html
<chunkify-player id="player" controls src="https://example.com/video.m3u8"></chunkify-player>
```

Replace the example URL with your playback URL. In your application JavaScript, register the component and start monitoring it:

```js
import "@chunkify/player";
import { monitor } from "@chunkify/player-analytics";

const player = document.querySelector("#player");
const session = monitor(player, {
  videoId: "video_123",
  destinations: [{ send: (event) => console.log(event) }],
});
```

Call `session.destroy()` when the application removes the player or stops monitoring it.

The same function also accepts a native video element without importing `@chunkify/player`:

```html
<video id="video" controls src="https://example.com/video.mp4"></video>
```

```js
import { monitor } from "@chunkify/player-analytics";

const video = document.querySelector("#video");
const session = monitor(video, {
  videoId: "video_123",
  destinations: [{ send: (event) => console.log(event) }],
});
```

Call `session.startAttempt()` before an application-initiated `video.play()` to count attempts that reject without a play event. Call `session.destroy()` when removing the video or disabling analytics.

`monitor()` selects the direct video collector for `<video>` or the Chunkify adapter for `<chunkify-player>`. The adapter follows the player's active media element when switching between ordinary video and HLS. Other player types are not supported by this function. The lower-level `attachAnalytics()` and `attachPlayerAnalytics()` functions remain available for explicit use.

When Chunkify Player uses hls.js, the adapter also records the selected rendition, rendition switches, playing time by rendition, HLS manifest and segment request totals, transferred bytes, aggregate throughput, and fatal hls.js errors. These measurements are unavailable when playback uses native HLS or ordinary video; the media-level measurements still work. Subtitle language and playback speed are media-level: they are read from the media element's text tracks and `playbackRate` with every engine, including the subtitle and speed choices in Chunkify Player's settings menu.

## Monitor options

The second argument to `monitor()` has the same options as `monitorHlsJs()`, `monitorVideoJs()`, and `monitorShaka()` below.

| Option | Required or default | Meaning |
| --- | --- | --- |
| `videoId` | Required | Your video ID or Chunkify asset ID. Every event includes it as `video_id`. |
| `destinations` | Required, non-empty array | Adapters or objects with `send(event)`. Each included event goes to every destination. |
| `snapshotIntervalMs` | `30000` | Active playing time between cumulative snapshots, in milliseconds. Must be an integer from `1000` to `2147483647`. |
| `includeEvents` | All nine event types | Exact list of event types sent to destinations: `view_started`, `view_snapshot`, `playback_error`, `view_ended`, `playback_state_changed`, `rendition_changed`, `seek_completed`, `subtitle_changed`, and `playback_rate_changed`. |
| `environment` | `null` | Optional application environment string included in events. `null` is the same as omitting it. |
| `videoTitle` | `null` | Optional human-readable title included in events as `video_title`. Longer titles are truncated to 256 Unicode characters. `null` is the same as omitting it, and an empty string is sent as `null`. |
| `userId` | `null` | Optional ID of the signed-in user in your application, included in events as `user_id`. Use a pseudonymous ID, not an email address. Must be 1 to 256 Unicode characters; an empty or longer string throws. Pass `null` (or omit it) for viewers who are not signed in. |
| `persistViewerId` | `true` | Keep the generated `viewer_id` in page `localStorage` so it is reused on later page loads. Set `false` until the viewer consents to storage; each page load then gets a new ID and storage is never read or written. |

Once monitoring is attached, each destination receives all event types that occur by default. An empty `includeEvents` array sends nothing. Excluding `view_snapshot` stops its timer but still collects the final view metrics. Rapid seeks within 400 ms of the last `seeked` are grouped into one `seek_completed` record; seek-related state changes are withheld while that record is enabled.

For playback-attempt counts and final view measurements, send only the start and final records. This configuration sends no interim snapshots or separate state, rendition, seek, or error events:

```js
monitor(player, {
  videoId: "video_123",
  includeEvents: ["view_started", "view_ended"],
  destinations: [{ send: (event) => console.log(event) }],
});
```

Add `playback_error` for immediate error reports, or `view_snapshot` for interim measurements during long views. See [choose events for reporting](#choose-events-for-reporting) for counting and timeline guidance. Use [event mapping](#map-event-fields) to choose which fields each destination receives; `includeEvents` chooses which event types it receives.

### Viewer identity

Every event carries a `viewer_id`: a random UUID the SDK generates for the browser, unrelated to your own user IDs. By default it is stored in page `localStorage` under `chunkify_analytics_viewer_id` and reused across page loads, so distinct `viewer_id` values approximate unique viewers per browser. No cookie is set. When storage is unavailable or blocked, or `persistViewerId` is `false`, the ID lasts only for the current page load. `userId` is separate: it identifies your signed-in user, if you choose to send it.

```js
monitor(player, {
  videoId: "video_123",
  videoTitle: "Launch keynote",
  userId: currentUser?.analyticsId ?? null,
  persistViewerId: hasStorageConsent(),
  destinations: [{ send: (event) => console.log(event) }],
});
```

> **Upgrading from 0.9.x:** the `viewerId` option is now `userId` and is sent as `user_id`. `viewer_id` is always generated by the SDK and can no longer be set.

## Monitor third-party players

Use the connector for the player's public media API. All connectors take the same analytics options and return a session with `destroy()`.

### hls.js

For a separate player that gives you its `Hls` instance, use the optional hls.js adapter. This example assumes the page has a `<video controls>` element. The adapter follows that element once hls.js attaches it:

```ts
import Hls from "hls.js";
import { monitorHlsJs } from "@chunkify/player-analytics";

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
import { monitorVideoJs } from "@chunkify/player-analytics";

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
import { monitorShaka } from "@chunkify/player-analytics";

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

## Events and metrics

The nine event names are `chunkify.video.view_started`, `chunkify.video.view_snapshot`, `chunkify.video.playback_error`, `chunkify.video.view_ended`, `chunkify.video.playback_state_changed`, `chunkify.video.rendition_changed`, `chunkify.video.seek_completed`, `chunkify.video.subtitle_changed`, and `chunkify.video.playback_rate_changed`. All records share identifiers, a timestamp, and a sequence number within the `view_id`. The first four contain cumulative view measurements. Snapshots arrive after each 30 seconds of active playing time and when the tab visibility changes during an attempt. State, rendition, seek, subtitle, and playback-rate records have smaller, event-specific payloads. A value is `null` when it is unavailable or does not apply; the collector does not guess it.

### Choose events for reporting

| Goal | Events to include | How to use them |
| --- | --- | --- |
| Count playback attempts | `view_started` | Count distinct `view_id` values. An attempt can fail before any video plays. |
| Count confirmed starts | `playback_state_changed` | Count each view's first transition to `playing`. If you collect only final records, count `view_ended` where `startup_outcome` is `started`, but that count depends on receiving the final record. |
| Report view totals and playback quality | `view_started`, `view_ended`; add `view_snapshot` and `playback_error` when needed | Use each view's final cumulative measurements for playing time, buffering, seeks, and rendition use. Snapshots give interim measurements if the view is long or its final record is lost. Errors are sent immediately. |
| Reconstruct a high-level playback timeline | All nine event types (the default) | Group by `view_id` and order by `sequence`. State changes show pauses and buffering; `seek_completed` summarizes rapid seeking; `rendition_changed` shows exposed quality switches; `subtitle_changed` and `playback_rate_changed` show subtitle and speed changes; errors show failures. |

`view_ended` means the monitored attempt closed, not necessarily that the video played to completion. Use `reason: "ended"` to identify playback that reached the media end. Distinct `view_id` values count attempts, not unique people; count distinct `viewer_id` values for approximate unique viewers per browser, or `user_id` for signed-in users. Deduplicate received records by `event_id`, and never sum cumulative snapshots together. Delivery of the final record on page exit is best effort, so an endpoint should not assume every start has an end.

The default events describe a **high-level** timeline, not every user gesture or intermediate seek position. Grouped seeks replace their intermediate state changes, and a rendition switch is available only when the connector exposes it. The collector cannot reconstruct details it does not observe.

### Complete Chunkify Player event example

This complete `view_ended` event is based on `<chunkify-player>` playing a local HLS stream, with timing values rounded for readability. The component used hls.js for this stream, so `connector_name` and `player_name` report `hls.js`. It is the **raw Chunkify event** passed to `send(event)`; an adapter or mapper can reshape it for a destination.

```json
{
  "schema_version": 1,
  "event_name": "chunkify.video.view_ended",
  "event_id": "06581e06-96d7-421c-b77b-22a6e615c97e",
  "sequence": 4,
  "occurred_at": "2026-09-28T07:35:10.879Z",
  "view_id": "8267fd81-ecf6-4fb1-83d9-4d1fba46b1b6",
  "video_id": "video_123",
  "sdk_name": "@chunkify/player-analytics",
  "sdk_version": "0.2.0",
  "connector_name": "hls.js",
  "connector_version": "1.7.3",
  "player_name": "hls.js",
  "player_version": "1.7.3",
  "delivery_hostname": null,
  "environment": null,
  "viewer_id": "3f0c6a1e-2b7d-4c59-9e1a-7d4b2f8c6e10",
  "user_id": null,
  "video_title": null,
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
  "media_width_px": 256,
  "media_height_px": 144,
  "player_width_px": 640,
  "player_height_px": 360,
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
  ],
  "subtitle_language": null,
  "playback_rate": 1,
  "subtitle_playing_time": [
    {
      "language": null,
      "playing_time_ms": 6085
    }
  ],
  "playback_rate_playing_time": [
    {
      "rate": 1,
      "playing_time_ms": 6085
    }
  ]
}
```

### Playback timeline events

Every event includes `visibility_state`, either `"visible"`, `"hidden"`, or `null` when unavailable. The collector reads the media element's owning document at event time. A hidden tab can keep playing; visibility alone never changes the playback state or stops watch-time measurement. With `view_snapshot` enabled, visibility changes emit an immediate snapshot so a timeline can distinguish "Playing in background" without waiting for the next timed snapshot. Chrome may pause muted background playback and resume it when the tab becomes visible. Report a transition to `paused` with `visibility_state: "hidden"` as "Paused in background" to distinguish it from a pause that began while visible. This describes the observed context, not who caused the pause. Browser pause events do not identify user, application, or browser intent. Older events omit the field and cannot be classified retrospectively.

`playback_state_changed` reports the state entered and the wall-clock time spent in the previous state. Possible states are `startup` (the first attempt before playback), `resuming` (waiting after a pause or seek), `playing`, `paused`, `buffering`, `seeking`, `error`, `ended`, and `stopped`. With `seek_completed` enabled, state changes during a seek interaction are withheld; the seek record replaces them. Otherwise, raw seek state changes remain available. The final transition to `ended` or `stopped` closes the last state before `view_ended` unless a seek interaction is still pending. A fatal error enters `error`; `view_ended` still reports why the view ended. For example, pausing after 20 seconds of playback produces these event-specific fields:

```json
{
  "event_name": "chunkify.video.playback_state_changed",
  "from_state": "playing",
  "to_state": "paused",
  "previous_state_duration_ms": 20000,
  "playhead_seconds": 42,
  "visibility_state": "visible"
}
```

`rendition_changed` reports a change between two known video renditions. It does not fire for the initial selection, repeated reports of the same rendition, or engines that do not expose rendition changes. The event includes the displayed media size and has `previous_rendition_` and `selected_rendition_` fields for width, height, codec, bitrate in bits per second, and frame rate. Unknown properties are `null`:

```json
{
  "event_name": "chunkify.video.rendition_changed",
  "playhead_seconds": 42,
  "player_width_px": 640,
  "player_height_px": 360,
  "previous_rendition_width": 1280,
  "previous_rendition_height": 720,
  "selected_rendition_width": 854,
  "selected_rendition_height": 480
}
```

`seek_completed` reports one logical seek interaction. Each new `seeking` resets a 400 ms quiet period after the last `seeked`. A playing view also waits for playback to resume; a paused view does not. An end, source change, fatal error, or destroy flushes a pending interaction as `interrupted` if it did not resume or settle. The quiet period is a heuristic because an HTML media element does not expose the user's pointer gesture. `seek_started_at`, `last_seeked_at`, and `playback_resumed_at` mark the first seek, final `seeked`, and playback resume in UTC. The last two are `null` if those stages never occurred. `state_before_seek` and `state_after_seek` describe the surrounding playback states, including a `playing`-to-`playing` seek. The event's `seek_interaction_duration_ms` sums time spent in the media element's seeking state, while `seek_resume_wait_ms` measures from the final `seeked` to `playing` when available:

```json
{
  "event_name": "chunkify.video.seek_completed",
  "seek_started_at": "2026-09-29T13:05:26.300Z",
  "last_seeked_at": "2026-09-29T13:05:26.395Z",
  "playback_resumed_at": "2026-09-29T13:05:26.515Z",
  "state_before_seek": "playing",
  "state_after_seek": "playing",
  "from_playhead_seconds": 10,
  "to_playhead_seconds": 60,
  "seek_interaction_duration_ms": 350,
  "seek_resume_wait_ms": 120,
  "seek_outcome": "resumed"
}
```

`subtitle_changed` reports a change of the showing subtitle or caption track, read from the media element's `textTracks` when a track's mode changes or a track is added or removed. `subtitle_language` is the track's `language` (see the [field guide](#field-guide)); `null` means subtitles are off. `playback_rate_changed` reports a change of `playbackRate` from the media element's `ratechange` event. Both fire only while a view is open and only when the normalized value changes, so a mode change on another track or a rate change that rounds to the same value sends nothing. The current values at the start of a view are in `view_started`, not in a change event. For example, turning on French subtitles and then switching to 1.5x speed produces these event-specific fields:

```json
{
  "event_name": "chunkify.video.subtitle_changed",
  "playhead_seconds": 42,
  "previous_subtitle_language": null,
  "subtitle_language": "fr"
}
```

```json
{
  "event_name": "chunkify.video.playback_rate_changed",
  "playhead_seconds": 57.5,
  "previous_playback_rate": 1,
  "playback_rate": 1.5
}
```

`seek_count` in snapshots and `view_ended` counts these logical interactions. The collector still uses each media seek to measure playing and seeking time, even when it sends only one seek record.

These are excerpts; actual timeline records also have the shared identifiers and timestamp. Playhead fields are media positions, not elapsed viewing time or universal timestamps for live video, and can be `null` when unavailable. `occurred_at` is when a record is sent to destinations; for a grouped seek, use its seek timestamps to place the interaction in the viewing timeline. `sequence` orders records within the view. Cumulative playing time by rendition, subtitle language, and playback rate remains in snapshots and `view_ended`.

### Field guide

| Fields | Meaning |
| --- | --- |
| `schema_version`, `event_name`, `event_id`, `sequence`, `occurred_at` | Contract version, event type, unique event ID, sequence within this view, and UTC event time. |
| `view_id`, `video_id` | Ephemeral playback-attempt ID and the `videoId` supplied by your application. A new attempt gets a new `view_id`. |
| `sdk_name`, `sdk_version`, `connector_name`, `connector_version`, `player_name`, `player_version` | The collector, connector, and player that produced the record. Player fields can be `null`. |
| `delivery_hostname`, `environment` | Delivery host when available and optional application environment. No complete URL is included. |
| `viewer_id`, `user_id`, `video_title` | Generated anonymous browser ID (see [viewer identity](#viewer-identity)), your optional `userId` (1 to 256 Unicode characters), and your optional `videoTitle` (truncated to 256 Unicode characters; empty becomes `null`). |
| `reason`, `startup_outcome` | End reason and startup result on `view_ended`; `null` on other events. Ending before startup does not establish why the viewer left. |
| `error_category`, `error_code`, `error_fatal`, `error_playhead_seconds` | Normalized error details on `playback_error`; otherwise `null`. Raw error messages and URLs are not included. |
| `media_duration_seconds`, `startup_time_ms`, `first_video_frame_time_ms`, `playing_time_ms` | Media duration; time from attempt to first `playing`; time to the first frame callback; cumulative actual playing time. The two startup measurements can differ. |
| `rebuffer_count`, `rebuffer_duration_ms`, `rebuffer_ratio`, `seek_count`, `seek_duration_ms` | Counts, cumulative durations, and rebuffer time divided by playing plus rebuffer time. The ratio is `null` until its denominator is positive. |
| `played_ranges` | Cumulative media ranges actually played in this attempt, as `start_seconds` / `end_seconds`. Overlaps and replays are merged. Pauses, buffering and skipped sections are excluded. `[]` means no section played; `null` means coverage is unavailable after more than 128 disjoint ranges. |
| `playhead_seconds` | Current media position at the snapshot or event. |
| `maximum_playhead_seconds`, `furthest_progress_ratio` | Furthest playhead reached and that position divided by duration, capped at 1. Seeking near the end raises the ratio without watching the intervening video. |
| `media_width_px`, `media_height_px`, `dropped_video_frames`, `total_video_frames` | The video element's intrinsic width and height (`videoWidth` and `videoHeight`) in CSS pixels, plus browser frame counters when exposed. These are not the player box dimensions or necessarily the encoded frame dimensions. |
| `player_width_px`, `player_height_px` | The monitored media element's displayed box in CSS pixels. Present on view and rendition-change events; `null` when it has no measurable size. A final event retains the last measured size if the media element was removed first. |
| `selected_rendition_width`, `selected_rendition_height`, `selected_rendition_codec`, `selected_rendition_bitrate_bps`, `rendition_switch_count` | Current video rendition and switches when an engine connector exposes them. Width and height are in pixels; bitrate is in bits per second. |
| `rendition_playing_time` | Cumulative wall-clock milliseconds by rendition. Each entry has `width`, `height`, `codec`, `bitrate_bps`, `frame_rate`, and `playing_time_ms`. It is `null` without a rendition-aware connector and `[]` before one identifies a rendition. |
| `subtitle_language` | Language of the showing subtitle or caption track (`kind` is `subtitles` or `captions`), read from the media element's `textTracks`. The track's `language` is trimmed and truncated to 35 characters; a showing track without a language is `"und"` (BCP 47 "undetermined"), so "on without a language" stays distinct from `null` (off). If several such tracks are showing, the first in the list is used. Subtitles rendered without a showing text track, such as a player's own overlay, are not detected. |
| `playback_rate` | The media element's `playbackRate`, rounded to 2 decimals. `null` when the rounded value is not above 0 and up to 16. |
| `subtitle_playing_time`, `playback_rate_playing_time` | Cumulative wall-clock milliseconds by subtitle language (entries have `language` and `playing_time_ms`; `language: null` is time with subtitles off) and by playback rate (entries have `rate` and `playing_time_ms`). `playing_time_ms` is a whole number. `[]` before any playing time. Each list keeps at most 32 distinct values; once full, playing time in a new value is not added. Time at a `null` playback rate is not attributed to a rate. |
| `delivery_request_count`, `delivery_transferred_bytes`, `delivery_throughput_bps` | Aggregate requests, response bytes, and throughput where the engine exposes them. Throughput is in bits per second. |

`reason` can be `ended`, `destroyed`, `source_changed`, or `page_exit`. `startup_outcome` can be `started`, `failed_before_start`, or `ended_before_start`. Error categories are `aborted`, `network`, `decode`, `unsupported`, or `unknown`.

`first_video_frame_time_ms` uses `requestVideoFrameCallback()` and may remain `null` or precede `startup_time_ms` for a preloaded frame. It is not proof that the viewer saw the frame. `rendition_playing_time` excludes pauses, buffering, seeks, and playback before a rendition is known, so its sum can be lower than `playing_time_ms`. `subtitle_playing_time` and `playback_rate_playing_time` use the same accounting; their sums can also be lower after the 32-value limit or, for the rate, while the rate is unsupported. Snapshots repeat cumulative totals: use the final record or differences between snapshots, not the sum of whole snapshots. This package does not aggregate across viewers.

Player size is sampled when these events are emitted; the collector does not record every resize. For Chunkify Player, this is the internal media box, not the outer control theme. Other supported monitors measure the media element passed to them.

## Map event fields

Use `createEventMapper()` when a destination needs fewer fields, different field names, or calculated values. Each output key is a field in the destination payload. A string selector such as `videoId: "video_id"` copies the raw event's `video_id` value under the new `videoId` key. Only fields listed in the mapping are sent; the mapper returns a new object and leaves the original event unchanged:

```ts
import { createEventMapper, monitor } from "@chunkify/player-analytics";
import { createHttpAdapter } from "@chunkify/player-analytics/http";

const mapForEndpoint = createEventMapper({
  videoId: "video_id",
  viewId: "view_id",
  eventName: "event_name",
  playtimeSeconds: (event) => event.playing_time_ms === undefined ? undefined : event.playing_time_ms / 1000,
});

monitor(video, {
  videoId: "video_123",
  destinations: [createHttpAdapter("/api/video-analytics", { mapEvent: mapForEndpoint })],
});
```

The mapping runs for each event passed to the destination. A field absent from an event-specific payload is omitted from the mapped result, including when a selector returns `undefined`. For example, `playtimeSeconds` above is omitted from a rendition-change event. For destinations that accept the Chunkify event directly, omit the mapper. Mapping does not alter collection, event selection, or snapshot timing. See [Monitor options](#monitor-options) for `includeEvents` and `snapshotIntervalMs`.

### Map event types differently

Select a mapper based on the event name when different event types need different payloads. This HTTP example keeps all other events unchanged:

```js
import { createEventMapper, monitor } from "@chunkify/player-analytics";
import { createHttpAdapter } from "@chunkify/player-analytics/http";

const mapStateChange = createEventMapper({
  videoId: "video_id",
  from: "from_state",
  to: "to_state",
  durationMs: "previous_state_duration_ms",
});
const mapRenditionChange = createEventMapper({
  videoId: "video_id",
  width: "selected_rendition_width",
  height: "selected_rendition_height",
});

const destination = createHttpAdapter("/api/video-analytics", { mapEvent: (event) => {
  if (event.event_name === "chunkify.video.playback_state_changed") return mapStateChange(event);
  if (event.event_name === "chunkify.video.rendition_changed") return mapRenditionChange(event);
  return { ...event };
} });

monitor(video, {
  videoId: "video_123",
  destinations: [destination],
});
```

The same mapper selection works with other adapters.

## Send events to a destination

Provide at least one adapter or object with `send(event)`. Every included event goes to every destination. The Chunkify destination can add browser context to its own payload; other destinations receive the original playback event. The HTTP transport supports [bounded retries](#retries-and-delivery-limits), enabled by default for Chunkify. Delivery on page exit remains best effort. Do not put personal information, tokens, or URLs in supplied metadata. The core event payload omits raw URLs and error messages. The Chunkify adapter adds the page origin and path, excluding query parameters and fragments. The Datadog and PostHog examples use [the player markup](#monitor-chunkify-player-or-a-video-element) shown above.

### Chunkify collector

Use the dedicated adapter for the self-hosted Chunkify collector. The server is
maintained separately in `chunkifydev/chunkify-analytics`, currently a private
repository. The client adapter is part of this SDK.
Pass its full native ingestion URL and public ingest key:

```js
import { monitor } from "@chunkify/player-analytics";
import { createChunkifyAdapter } from "@chunkify/player-analytics/chunkify";

monitor(video, {
  videoId: "video_123",
  destinations: [createChunkifyAdapter("https://analytics.example.com/v1/events", {
    ingestKey: "YOUR_PUBLIC_INGEST_KEY",
  })],
});
```

The adapter sets `X-Chunkify-Ingest-Key` and posts the complete event with an additional
`browser_context` object. It reuses the HTTP adapter's endpoint validation, omitted
cookies/referrer, delivery errors, and best-effort keepalive for final events.
It does not change the event delivered to other destinations or generate extra events.
The collector returns this object under `events[].event.browser_context` in authenticated
raw-event reads and preserves it on restart. Duplicate delivery keeps the first payload.
Temporary failures are retried at most twice using the same event ID and serialized
payload, including browser context. The collector deduplicates by project and event ID.
Set `retry: false` alongside `ingestKey` to disable retries.

Set `collectBrowserContext: false` alongside `ingestKey` to disable browser collection.
The adapter then sends the original event without reading browser APIs. Importing and
constructing the adapter is safe outside a browser; sends without a browser window also
use the original event. Inaccessible APIs produce null fields instead of failing delivery.

#### Browser context fields

`BrowserContext` and `ChunkifyCollectorEvent` are exported types from
`@chunkify/player-analytics/chunkify`. Context has its own `schema_version: 1` and does not
change the core playback event type.

| Fields | Source and meaning |
| --- | --- |
| `user_agent` | `navigator.userAgent`, limited to 512 characters. |
| `browser_name`, `browser_version` | Best-effort parsing of the reported user agent and low-entropy Client Hints. |
| `os_name`, `os_version` | Reported OS and version from the user agent, with Client Hints platform fallback/correction. |
| `device_type` | Inferred `desktop`, `mobile`, `tablet`, or `unknown`. |
| `device_family` | Broad family when identifiable: `iPhone`, `iPad`, `iPod Touch`, `Android`, or `Android Tablet`. Null for other devices. This is not a hardware model. |
| `language`, `language_prefix` | `navigator.language`, such as `fr-FR`, and its primary language, such as `fr`. |
| `timezone` | Browser timezone from `Intl.DateTimeFormat`, such as `Europe/Paris`. |
| `timezone_offset_minutes` | `Date.getTimezoneOffset()`: UTC minus local time in minutes. Paris is `-60` in winter and `-120` in summer. |
| `screen_width_px`, `screen_height_px` | Browser-reported screen dimensions in CSS pixels. |
| `viewport_width_px`, `viewport_height_px` | `window.innerWidth` and `window.innerHeight`, in CSS pixels. |
| `pixel_ratio` | `window.devicePixelRatio`. |
| `page_origin`, `page_path` | Current document HTTP(S) origin and pathname, without credentials, query parameters, or fragments. Each field is null if unavailable or longer than 2048 characters. |

Stable fields are collected at the first browser send and cached for that adapter
instance. Page origin/path, screen/viewport dimensions, pixel ratio, and timezone offset are sampled on
every send. Create a new adapter to refresh cached language, timezone, or browser identity.
Each event includes its context so delivery does not depend on an earlier metadata request.
Page context follows single-page navigation on subsequent events; retries keep the
original serialized context. In an iframe, it describes the iframe document, not
the parent page. Referrer and campaign parameters are not collected. Paths can
still contain application-defined identifiers; disable browser context if those
paths should not be collected.

Browser recognition covers Chrome/Chromium, Edge, Firefox, Safari, Opera, and Samsung
Internet, including their recognized iOS/Android variants. OS recognition covers Windows,
macOS, iOS, iPadOS, Android, ChromeOS, and Linux. Reduced or spoofed user agents can limit
accuracy. For example, Windows `10.0` is the reported NT version and does not distinguish
Windows 10 from Windows 11. Desktop-mode iPads are inferred from Macintosh and touch
signals, with no invented OS version. A recognized Android Client Hints platform can
correct a desktop-mode Linux user agent. Unsupported device families and versions stay
null; recognized TV/console markers use device type `unknown` in this initial schema.

Other strings are limited to 64 characters, or 128 for timezone. Dimensions must be
positive integers up to 1,000,000; pixel ratio must be finite and in `(0, 100]`. The fixed
schema and string limits keep context below 8 KiB even with JSON escaping. The collector's
request-body limit still applies to the complete event. Context is reported or inferred
data and does not identify or authenticate a viewer.

The local Chromium collector test on 2026-10-16 measured 537 additional uncompressed
JSON bytes per event. This is one browser fixture, not a universal size; the collector
integration test reports the measured overhead when rerun. Browser-side batching and
compression are not implemented by this adapter.

#### Comparison with PostHog

This selection follows PostHog's [browser event properties](https://github.com/PostHog/posthog-js/blob/main/packages/browser-common/src/utils/event-utils.ts)
and [device classification](https://github.com/PostHog/posthog-js/blob/main/packages/core/src/utils/user-agent-utils.ts).

| PostHog fields | Chunkify choice |
| --- | --- |
| `$browser`, `$browser_version`, `$os`, `$os_version`, `$raw_user_agent` | Equivalent reported environment fields, with bounded strings and null for unavailable values. |
| `$device`, `$device_type` | Broad device family and category. Initial recognition focuses on desktop, phone, and tablet playback. |
| `$browser_language`, `$browser_language_prefix`, `$timezone`, `$timezone_offset` | Included with explicit names and offset units. |
| `$screen_width`, `$screen_height`, `$viewport_width`, `$viewport_height` | Included; Chunkify also reports pixel ratio. |
| `$current_url`, `$host`, `$pathname` | `page_origin` and `page_path` identify the current page, excluding credentials, query parameters, and fragments. |
| Referrer and campaign properties | Not collected. |
| `$webview_app`, `$webview_app_version`, precise hardware model | Deferred; specialized in-app parsing and high-entropy hardware queries are outside this initial schema. |
| SDK name/version, event ID/time, session identity | Existing Chunkify fields cover SDK and event identity. The core event's `viewer_id` identifies the browser; the adapter creates no additional session, cookie, or device identity. |

The Chunkify adapter does not request high-entropy hints, enumerate installed software,
or request location permission. The adapter does not obtain or send a client IP.
The collector derives continent, country and city locally from the request address, then
discards that address. See the separate collector repository for geolocation and
trusted-proxy configuration.

Generic HTTP/OTLP adapters and custom callbacks continue to receive playback events.
Their mapping functions can add application-selected fields. PostHog and Datadog clients
collect their own context. A future browser batch format could share context within one
request; it is separate from collector database write batching.

### Datadog RUM

Install `@datadog/browser-rum` in your application. Initialize it with your RUM application ID and **client token** (not a Datadog API key), then pass the client to the adapter. The adapter adds one custom action per analytics event, with the event fields directly in the action context by default:

```js
import "@chunkify/player";
import { datadogRum } from "@datadog/browser-rum";
import { monitor } from "@chunkify/player-analytics";
import { createDatadogAdapter } from "@chunkify/player-analytics/datadog";

datadogRum.init({
  applicationId: "YOUR_DATADOG_APPLICATION_ID",
  clientToken: "YOUR_DATADOG_RUM_CLIENT_TOKEN",
  site: "datadoghq.com", // Use your organization's Datadog site.
});

monitor(document.querySelector("#player"), {
  videoId: "video_123",
  destinations: [createDatadogAdapter(datadogRum)],
});
```

Pass a mapper as the second argument to choose or rename context fields; it runs for each event. If a dashboard needs derived actions, such as one action per rendition, add a separate custom destination to create them from `view_ended`.

### PostHog

Install `posthog-js` in your application. Initialize it with your project token and ingestion host, then pass it to the adapter. The adapter captures one event per analytics record, with the event's fields as flat PostHog properties. Its optional second argument maps the properties for each event:

```js
import "@chunkify/player";
import posthog from "posthog-js";
import { monitor } from "@chunkify/player-analytics";
import { createPostHogAdapter } from "@chunkify/player-analytics/posthog";

posthog.init("YOUR_POSTHOG_PROJECT_TOKEN", {
  api_host: "https://us.i.posthog.com", // Use your project's ingestion host.
});

monitor(document.querySelector("#player"), {
  videoId: "video_123",
  destinations: [createPostHogAdapter(posthog)],
});
```

The application controls PostHog's automatic collection and persistence settings. PostHog may add its own event properties, including page context, beyond the fields sent by this adapter; configure the PostHog SDK separately to meet your privacy requirements.

### OTLP/HTTP logs

The OTLP adapter sends each event as an OTLP/HTTP JSON log record. Pass the full URL of a customer-owned `/v1/logs` gateway, or a root-relative path to one. The gateway must allow browser CORS when cross-origin and handle any private provider credentials. The adapter omits browser credentials and cookies. Use `headers` in the options object for a public ingest key. By default, all event fields become typed log attributes; unavailable values are omitted, and `rendition_playing_time`, `subtitle_playing_time`, and `playback_rate_playing_time` remain structured arrays. Use `mapAttributes` in the options object to choose or rename log attributes. The OTLP event name, timestamp, and scope still come from the original event. Snapshots contain cumulative values, so aggregate the final record or differences between snapshots rather than summing all records:

```ts
import { createEventMapper } from "@chunkify/player-analytics";
import { createOtlpAdapter } from "@chunkify/player-analytics/otlp";

const attributes = createEventMapper({
  video_id: "video_id",
  view_id: "view_id",
  event_id: "event_id",
  playing_time_ms: "playing_time_ms",
});

monitor(video, {
  videoId: "video_123",
  destinations: [createOtlpAdapter("https://analytics.example.com/v1/logs", { mapAttributes: attributes })],
});
```

This adapter emits OTLP **logs**, not OTLP metrics. Your gateway or provider handles storage and aggregation.

Both HTTP and OTLP adapters accept `headers` in their options object. Headers are
copied when the adapter is created, and `Content-Type` remains `application/json`.
Cookie headers are rejected. Keep private provider credentials and the collector's
read token on your server; browser configuration may contain only public client
or ingest keys.

#### Updating HTTP and OTLP mappers from 0.3.x

The second argument is now an options object. Calls without a second argument
continue to work. Update existing mapper arguments as follows:

```js
// Before
createHttpAdapter(endpoint, mapper);
createOtlpAdapter(endpoint, mapper);

// Now
createHttpAdapter(endpoint, { mapEvent: mapper });
createOtlpAdapter(endpoint, { mapAttributes: mapper });
```

Passing the old function argument throws a `TypeError`.

### HTTP endpoint

The HTTP adapter posts each event as JSON to a customer-owned endpoint using `fetch`. Its optional second argument accepts `mapEvent` for a different payload, `headers` for a public ingest key, and `retry` to enable bounded retries. Without a mapper it sends the complete Chunkify event. It accepts an HTTPS URL or root-relative path; loopback HTTP is allowed for local tests. It rejects credentials and query parameters in the endpoint, sends no cookies, and sends no page referrer. The endpoint must support browser CORS when cross-origin and perform its own aggregation. Failed delivery rejects the adapter's `send()` promise after any enabled retries; the analytics session isolates that rejection from playback and other destinations. The final event uses `fetch` keepalive as a best-effort page-exit delivery, subject to browser limits:

```ts
import { createHttpAdapter } from "@chunkify/player-analytics/http";

monitor(video, {
  videoId: "video_123",
  destinations: [createHttpAdapter("/api/video-analytics", {
    headers: { "X-Chunkify-Ingest-Key": "YOUR_PUBLIC_INGEST_KEY" },
  })],
});
```

### Retries and delivery limits

Chunkify retries are enabled by default. Generic HTTP and OTLP retries are opt-in:

```js
createChunkifyAdapter(endpoint, { ingestKey: "PUBLIC_KEY", retry: false });
createHttpAdapter(endpoint, { retry: true });
createOtlpAdapter(endpoint, { retry: true });
```

When enabled, the transport retries network failures, request timeouts, and HTTP
`429`, `502`, `503`, and `504` at most twice, for three attempts total. Other HTTP
statuses are not retried. Backoff starts at 500 ms, then 1 second, with up to 250 ms
of random delay added each time. A readable `Retry-After` header, in seconds or as
an HTTP date, can increase that delay. If it requires waiting more than 10 seconds,
delivery fails instead of retrying early. Cross-origin servers must expose this
header with `Access-Control-Expose-Headers: Retry-After` for browsers to read it.

All three adapters abort each request after 5 seconds and allow up to 32 pending
sends per adapter instance, including sends waiting to retry. Further sends reject
immediately until capacity becomes available. There is no waiting queue or offline
storage. Successful delivery means an HTTP 2xx response; the adapter does not read
the response body. Final failures reject `send()`; when using `monitor()`, delivery
failures are swallowed so playback and other destinations can continue.

Every retry reuses the serialized payload. A server may have stored an event even
when its response was lost, so generic HTTP/OTLP receivers must tolerate duplicate
delivery before enabling retries. Preserve `event_id` in custom mappings when the
receiver uses it for deduplication. Retries can arrive after later events; use the
event's `sequence` and `occurred_at` to order them.

PostHog and Datadog retain their clients' delivery behavior. Custom destinations
receive no automatic retry wrapper. Browser shutdown can prevent retries and
keepalive requests from completing; this is not guaranteed delivery.

### Custom destination

No adapter is needed when you want the normalized event as-is. A destination can inspect it, map it, or pass it to your own client:

```ts
monitor(video, {
  videoId: "video_123",
  destinations: [{ send(event) { console.log(event); } }],
});
```

Rendition events include the initial selection for each attempt, with null previous-rendition fields. Subsequent events identify the change at its media position. Seeking backward can revisit the same position with another rendition.
