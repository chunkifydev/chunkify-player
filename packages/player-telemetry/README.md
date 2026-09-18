# @chunkify/player-telemetry

Optional telemetry for a standard HTML media element, with no runtime dependencies,
playback engine, provider SDK or network transport. Records go only to the callback
you provide. The package does not contact Chunkify or store a viewer identity.

Version `0.0.0` is unpublished. This package implements the first telemetry steps from
[issue #279](https://github.com/chunkifydev/chunkify/issues/279), following the
[shared contract](https://github.com/chunkifydev/chunkify/issues/272#issuecomment-5426511219).
It provides start/end/error records, cumulative snapshots, startup/playing/buffering/
seek timing, completion, browser frame counts, and an optional engine connector seam.
The Web Component and React
wrapper expose this package through their optional callback telemetry property/prop.

## Use

```ts
import { attachTelemetry } from "@chunkify/player-telemetry";

const video = document.querySelector("video")!;
const session = attachTelemetry(video, {
  assetId: "asset_123",
  provider: "callback",
  environment: "development",
  sampleRate: 1,
  send(event) {
    console.log(event); // Replace with your application's destination.
  },
});

// Native controls are observed automatically through the media's play event.
// For programmatic playback, call this before play() so an attempt that rejects
// before the browser emits play is also counted.
session.startAttempt();
try {
  await video.play();
} catch {
  // The application decides whether to offer another attempt or remove the video.
}

// Call when removing the player, changing its asset identity or disabling telemetry.
session.destroy();
```

Attach once, before the first attempt. Attaching does not start playback or count a
view. The package does not patch `play()` and cannot observe a rejected call that
emits no `play` event unless you call `startAttempt()`. It does not reconstruct time
that passed before attachment. Keep the returned session and call `destroy()` when
removing the media element; removing a raw element alone is not a cleanup signal.
Reattach with a new `assetId` when changing to a different asset.
Wrappers that tear down or replace a playback engine should call
`session.sourceChanged()` before removing that engine so its final aggregate metrics
are emitted synchronously. Direct HTML media source changes remain observable through
the element's standard `emptied` and `loadstart` events.

`assetId` must be a non-empty string. `provider` must be `callback`, with a `send`
function. Invalid configuration throws a fixed `TypeError` before installing
listeners. `environment` and `viewerId` are optional strings. A viewer ID must be
customer-supplied and pseudonymous. Do not put names, emails, credentials or URLs
in these metadata fields. The SDK does not generate or persist a viewer ID.
`sampleRate` is optional and must be a finite number from `0` to `1`.

## View lifecycle and measurements

A first `play` event or explicit `startAttempt()` creates an ephemeral view ID and
emits `chunkify.video.view_started`. Repeated attempts and pause/resume belong to
the same open view. Playback after the previous view ended creates a new ID.

`chunkify.video.view_ended` is sent once per view with one of these reasons:

- `ended`: the media ended.
- `source_changed`: the media was emptied or a different source began loading.
- `destroyed`: the application called `destroy()`.
- `page_exit`: the media document emitted `pagehide`.

`destroy()` is idempotent and removes all installed media/page listeners. It ends
an open view but does not pause, remove or otherwise control the media element.
Destroying a session that never started a view sends nothing.

While media is playing, `chunkify.video.view_snapshot` reports the cumulative
view state after each 30 seconds of actual playing time. Pauses, buffering, and
seeks pause that clock. Ending the view cancels its pending snapshot.

Each record has a `metrics` object:

| Field | Unit and meaning |
| --- | --- |
| `media_duration_seconds` | Finite media duration when known; otherwise `null`. |
| `startup_time_ms` | Monotonic elapsed time from the first attempt to the first `playing` event; `null` until then. |
| `playing_time_ms` | Cumulative elapsed time in the playing state, excluding loading, waiting, pauses and seeks. Starts at zero. |
| `rebuffer_count` | Number of `waiting` intervals after playback starts, excluding paused and seeking states. |
| `rebuffer_duration_ms` | Cumulative rebuffer time. |
| `rebuffer_ratio` | Rebuffer time divided by playing plus rebuffer time; `null` while both are zero. |
| `seek_count` | Number of seek intervals. |
| `seek_duration_ms` | Cumulative elapsed seek time. |
| `maximum_playhead_seconds` | Furthest finite playhead observed in the view. |
| `completion_ratio` | Maximum playhead divided by known duration, bounded to 0–1; otherwise `null`. |
| `dropped_video_frames` | Frames dropped during this view when the browser exposes reliable counters; otherwise `null`. |
| `total_video_frames` | Total frames during this view when exposed; otherwise `null`. |
| `selected_rendition_width` / `selected_rendition_height` | Current rendition dimensions when an engine connector exposes them; otherwise `null`. |
| `selected_rendition_codec` | Current rendition video codec when exposed; otherwise `null`. |
| `selected_rendition_bitrate_bps` | Current nominal rendition bitrate when exposed; otherwise `null`. |
| `rendition_switch_count` | Level changes during the view when exposed; otherwise `null`. |
| `delivery_request_count` | Completed delivery requests observed during the view when exposed; otherwise `null`. |
| `delivery_transferred_bytes` | Bytes transferred by those completed requests when exposed; otherwise `null`. |
| `delivery_throughput_bps` | Aggregate transferred bits divided by aggregate request duration when exposed; otherwise `null`. |

Playing time counts elapsed time, not distance along the timeline. Seeking forward
and higher playback rates do not increase it artificially. A seek or waiting state
stops its clock; a subsequent `playing` event resumes it. A media error also stops
the clock and emits the normalized record described below. Startup includes time
between the first attempt and first playing state, including any intervening pause.
The package observes `timeupdate` locally to maintain the maximum playhead, but it
does not forward those high-frequency events.

An HTML media `error` during an open view immediately emits one
`chunkify.video.playback_error` record. It has the current cumulative metrics plus:

| Field | Meaning |
| --- | --- |
| `error_category` | `aborted`, `network`, `decode`, `unsupported`, or `unknown`. |
| `error_code` | The browser's numeric `MediaError.code`, or `null` when unavailable. |
| `error_fatal` | `true` for an HTML media error, or the engine connector's normalized fatal flag. |
| `error_playhead_seconds` | Finite playhead at failure, or `null`. |

Other record types set these four fields to `null`. Only the first media error in a
view is emitted because the HTML media error state is fatal. Raw browser messages,
error objects, URLs, and stack traces are never copied into the record. The view
remains open for the final end record when the application cleans up or changes source.
An error that occurs during preload sends nothing by itself. If the first playback
attempt finds that existing error, it emits `view_started` and then `playback_error`.

Frame totals are deltas from the counters observed at the first playback attempt,
so frames decoded before telemetry attached are excluded. The standard
`getVideoPlaybackQuality()` API is preferred, with WebKit frame counters as a
fallback. Missing, invalid, or reset counters produce `null` instead of an estimate.

## Sampling

Sampling limits the number of complete views sent to the destination. It defaults
to `1`, which includes every view. `0.1` includes approximately ten percent, while
`0` excludes every view.

The package makes one independent random decision when each view begins. An included
view sends its complete start, snapshot, error, and end sequence. An excluded view
sends nothing and schedules no snapshots. Replay after an ended view makes a fresh
decision. Sampling choices are kept only in memory and are not tied to a viewer ID,
cookie, or persistent storage.

## Record contract and delivery

The initial schema version is `1`. Each record includes:

- `event_name`, a random `event_id`, `occurred_at` as an ISO timestamp, and `sequence`
  increasing from 1 within each view;
- ephemeral `view_id`, caller-supplied `asset_id`, and SDK name/version;
- connector and player name/version (`html-media` and null player fields without an engine connector);
- `delivery_hostname` only, plus optional `environment` and `viewer_id`, or `null`;
- `metrics` and `reason`, which is `null` on a start record.

Hostname comes from the current media URL, or `src` before the source is selected.
Blob and other non-HTTP URLs have no delivery hostname in this core. The Chunkify
Web Component installs its hls.js connector automatically. That connector supplies
the selected rendition, switch count, aggregate completed manifest/playlist/media
requests, transferred bytes, throughput, and normalized fatal engine errors. It
does not expose raw request records, URLs, byte ranges, error messages, or stacks.

Records are constructed from an explicit field list. Full page/media URLs, signed
query parameters, cookies, headers, arbitrary options, raw errors and stacks are
not copied into records. No identity, events or counters are written to storage.
No high-frequency media events are forwarded.

The callback is called synchronously in event order and may return a promise.
Synchronous exceptions and rejected promises are swallowed so destination failures
cannot interrupt playback or cleanup. This package does not retry, queue or await
network delivery. Async callbacks may complete out of order; consumers can use
sequence and event IDs. Page-exit delivery is best effort: the callback is invoked,
but the browser may terminate asynchronous work. The customer owns its transport.

Importing the package in server code is safe. Attaching requires a browser media
element and `crypto.randomUUID()`, available on HTTPS sites and localhost. Without
an attachment there are no telemetry listeners or records.

## Remaining telemetry work

This is not the complete MVP telemetry package. Datadog, Grafana Faro, and OTLP
destinations are not exposed yet. Measurements unavailable from the selected
engine remain nullable.

## Local verification

Run `npm run build`, then `npm run serve`, and open
[the standalone example](http://127.0.0.1:4173/examples/telemetry/). It plays the
local fixture with native controls and prints callback records on the page.

Browser tests exercise the public attachment/callback API with controlled media
events and a clock, plus actual video playback in Chromium, Firefox and WebKit.
They cover lifecycle, snapshots, cumulative metrics, normalized errors, browser
frame APIs, privacy, destination failures and cleanup. Node checks
verify server-safe imports and agreement between package and payload SDK versions.

The package includes ES modules, declarations, source maps, source and the MIT license.
