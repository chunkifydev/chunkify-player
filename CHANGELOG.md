# Changelog

## Unreleased

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
