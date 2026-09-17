# @chunkify/player-telemetry

Optional telemetry for a standard HTML media element, with no runtime dependencies,
playback engine, provider SDK or network transport. Records go only to the callback
you provide. The package does not contact Chunkify or store a viewer identity.

Version `0.0.0` is unpublished. This is the first telemetry slice from
[issue #279](https://github.com/chunkifydev/chunkify/issues/279), following the
[shared contract](https://github.com/chunkifydev/chunkify/issues/272#issuecomment-5426511219).
It provides start/end records, startup time and playing time. The Web Component
and React wrapper do not enable or import it yet.

## Use

```ts
import { attachTelemetry } from "@chunkify/player-telemetry";

const video = document.querySelector("video")!;
const session = attachTelemetry(video, {
  assetId: "asset_123",
  provider: "callback",
  environment: "development",
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

`assetId` must be a non-empty string. `provider` must be `callback`, with a `send`
function. Invalid configuration throws a fixed `TypeError` before installing
listeners. `environment` and `viewerId` are optional strings. A viewer ID must be
customer-supplied and pseudonymous. Do not put names, emails, credentials or URLs
in these metadata fields. The SDK does not generate or persist a viewer ID.

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

Each record has a `metrics` object:

| Field | Unit and meaning |
| --- | --- |
| `media_duration_seconds` | Finite media duration when known; otherwise `null`. |
| `startup_time_ms` | Monotonic elapsed time from the first attempt to the first `playing` event; `null` until then. |
| `playing_time_ms` | Cumulative elapsed time in the playing state, excluding loading, waiting, pauses and seeks. Starts at zero. |

Playing time counts elapsed time, not distance along the timeline. Seeking forward
and higher playback rates do not increase it artificially. A seek or waiting state
stops its clock; a subsequent `playing` event resumes it. A media error also stops
the clock, without emitting a separate error record in this slice. Startup includes time
between the first attempt and first playing state, including any intervening pause.

## Record contract and delivery

The initial schema version is `1`. Each record includes:

- `event_name`, a random `event_id`, `occurred_at` as an ISO timestamp, and `sequence`
  increasing from 1 within each view;
- ephemeral `view_id`, caller-supplied `asset_id`, and SDK name/version;
- `connector_name: "html-media"` and connector version;
- `player_name` and `player_version`, currently `null` because an HTML element does
  not reliably identify the playback library attached to it;
- `delivery_hostname` only, plus optional `environment` and `viewer_id`, or `null`;
- `metrics` and `reason`, which is `null` on a start record.

Hostname comes from the current media URL, or `src` before the source is selected.
Blob and other non-HTTP URLs have no delivery hostname in this core. A future engine
connector can supply information unavailable through the media element.

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

This is not the complete MVP telemetry package. Later steps will add cumulative
30-second snapshots, normalized playback-error records, buffering/seek/completion
and frame metrics, sampling, engine enrichment, Datadog/Grafana/OTLP destinations,
and the player/React property integration. None of those options are exposed yet.
Measurements not exposed by a future connector will remain nullable.

## Local verification

Run `npm run build`, then `npm run serve`, and open
[the standalone example](http://127.0.0.1:4173/examples/telemetry/). It plays the
local fixture with native controls and prints callback records on the page.

Browser tests exercise the public attachment/callback API with controlled media
events and a clock, plus actual video playback in Chromium, Firefox and WebKit.
They cover lifecycle, timing, privacy, destination failures and cleanup. Node checks
verify server-safe imports and agreement between package and payload SDK versions.

The package includes ES modules, declarations, source maps, source and the MIT license.
