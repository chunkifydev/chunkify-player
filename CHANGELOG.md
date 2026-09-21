# Changelog

## Unreleased

- Replaced the custom playback-engine layer with automatic `<video>` and
  `<hls-video>` selection.
- Kept the Demuxed 2022 Media Chrome controls and documented Chunkify CSS theme
  variables.
- Reduced the Web Component and React APIs to standard media options.
- Added standard `<track>` mirroring for captions, subtitles, chapters, and
  thumbnail metadata.
- Fixed vertical media overflowing the player and pushing controls outside the
  visible area.
- Corrected Demuxed control-icon alignment with the current Media Chrome
  button layout.
- Added credentialed native and HLS playback for signed-cookie media, including
  sanitized `playback-error` events.
- Added `noautoseektolive` / `noAutoSeekToLive` to control Media Chrome's live
  playback positioning.
- Removed asset metadata, manual engine selection, and custom thumbnail loading
  from this branch.

Telemetry development remains preserved on `codex/player-telemetry`.
