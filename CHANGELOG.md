# Changelog

## Unreleased

Added the initial standalone `@chunkify/player-telemetry` package with a callback
destination, start/end records, cumulative 30-second snapshots, ephemeral view IDs,
startup/playing/buffering/seek timing, completion, and cleanup. React integration,
engine metrics, and provider destinations remain pending.
HTML media errors now emit an immediate normalized, privacy-safe record, and browser
frame counters report per-view dropped and total frames when available.
Optional per-view sampling now keeps or excludes each complete event sequence and
supports rates from `0` to `1` without storing a persistent sampling decision.
The Web Component now exposes optional callback telemetry through its JavaScript-only
`telemetry` property and owns attachment cleanup across asset changes and disconnects.

Asset readiness now belongs to the application. The player initializes playback
when given a valid source URL and stays idle without one.

- Removed the Web Component's `status` property/attribute, `PlayerStatus` type and
  `preparing`, `failed` and `expired` slots.
- Removed React's `status`, `preparingFallback`, `failedFallback` and
  `expiredFallback` props. `src` is optional for all players.
- Removed the `missing-source` and `invalid-status` playback error codes.

To migrate, render processing/failure/expiration UI in your application. Only
supply `src` or mount the player when playback is wanted. Clear `src` or unmount
to stop. An old HTML `status` attribute is ignored and no longer prevents loading
an accompanying source URL. Playback errors still use `playback-error`.
