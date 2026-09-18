# Changelog

## Unreleased

- Replaced the custom playback-engine layer with automatic `<video>` and
  `<hls-video>` selection.
- Kept the Demuxed 2022 Media Chrome controls and documented Chunkify CSS theme
  variables.
- Reduced the Web Component and React APIs to standard media options.
- Added standard `<track>` mirroring for captions, subtitles, chapters, and
  thumbnail metadata.
- Removed asset metadata, manual engine selection, thumbnail loading, custom
  credential handling, and normalized playback errors from this branch.

Telemetry development remains preserved on `codex/player-telemetry`.
