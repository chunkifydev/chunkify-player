# Chunkify Player

One repository for the Chunkify player packages described in
[issue #279](https://github.com/chunkifydev/chunkify/issues/279).

The initial `<chunkify-player>` implementation wraps a native video element and
loads hls.js only when selected. It supports readiness fallbacks, posters,
Demuxed 2022 controls, sprite WebVTT previews, media events, source replacement,
cookie credentials, and cleanup. React and telemetry remain later steps.

## Packages

| Directory | npm package | Status |
| --- | --- | --- |
| `packages/player` | `@chunkify/player` | Initial playback wrapper |
| `packages/player-react` | `@chunkify/player-react` | Planned after the Web Component |
| `packages/player-telemetry` | `@chunkify/player-telemetry` | Planned last |

Only the player directory exists for now. The root package is private so it
cannot be published. Each package will have its own publishable contents.

## Development

Use Node.js 24 and npm 11. `.nvmrc` selects Node.js 24 if you use nvm.

```sh
npm ci
npx playwright install --with-deps --only-shell chromium firefox webkit
npm run check
```

`npm run check` typechecks the tools and package, builds the package, runs the
browser tests, and checks the package contents with `npm pack --dry-run`.
It does not publish anything. Tests run headlessly, so Chromium only needs its
smaller headless shell. The browser installation command also installs system
dependencies on supported Linux hosts.

To open the plain HTML example:

```sh
npm run build
npm run serve
```

Visit [the local example](http://127.0.0.1:4173/examples/basic/) and press Play.
Use the engine and status selectors to try playback and readiness fallbacks.
Hover or drag the seek bar to preview frames from the two local sprite images.
The clip is a local synthetic fixture; playback makes no Chunkify API calls.
Rebuild after editing the source, then reload the page. The local static server
binds to `127.0.0.1` and disables caching.

See the [player package README](packages/player/README.md) for its interface.

Other useful commands:

```sh
npm run typecheck
npm run build --workspace @chunkify/player
npm test -- --project=chromium
npx playwright show-report
```

## Build and verification

TypeScript emits ES modules, declarations, JavaScript source maps, and declaration
maps into `packages/player/dist`. Source files are included in the package so
the published maps can resolve their sources. There is no bundler in this setup.

The local example uses an import map to resolve the package, hls.js, Media Chrome,
and the Demuxed 2022 theme. The wrapper's `import("hls.js")` runs only when the
hls.js engine is selected. The controls do not add another playback engine.

Playwright tests run in Chromium, Firefox, and WebKit. They cover local HLS/fMP4
playback through hls.js, automatic engine selection, native MP4 playback, media
events, readiness gating, property upgrades, errors, and teardown. Controls tests
cover poster requests, keyboard operation, accessible control names, controls
visibility, and layouts at 320, 768, and 1280 pixels. Fullscreen/PiP tests substitute
the browser API boundary to verify supported and unsupported behavior without OS
windows. Actual OS fullscreen/PiP remains part of release browser/device QA. Native HLS
uses the browser's reported support; unsupported native playback fails explicitly.
Capability tests also simulate a browser without native HLS to verify fallback.
Thumbnail tests cover multiple sprites and crops, cross-origin files, readiness,
source/thumbnail replacement, cancellation, reconnection, and non-fatal failures.
Private-playback tests use a second local origin with real cookie checks and
CORS responses. They cover credentialed playlists, segments, posters, previews,
HTTP byte ranges, authorized path URLs, denial, and credential changes. Native
HLS cases run where supported; all three browsers test hls.js and native MP4.

Fixtures are checked in under `tests/fixtures/media`. FFmpeg is only needed to
regenerate them. These browser-engine checks do not certify every Safari/iOS,
Android, codec, or private-CDN configuration. The full release support matrix
will be established with the remaining ticket requirements.

GitHub Actions runs the same checks on pushes and pull requests, and retains
the Playwright report for seven days. Failed tests retain traces.

## Dependencies and releases

Dependencies use `~` ranges to stay within a selected major/minor
line. The committed `package-lock.json` fixes the full dependency tree, and CI
uses `npm ci`. Dependency updates must pass the checks before adoption.

The current `0.0.0` package is an unreleased development version. Public
releases will use semantic versioning. Changelog and upgrade instructions must
accompany the first release and subsequent public API changes. Publishing is a
separate step; this repository does not configure automatic publication.

Chunkify-authored code is licensed under [MIT](LICENSE). hls.js is a separate
npm dependency under its own Apache-2.0 license. Media Chrome and the Demuxed 2022
theme are separate MIT-licensed dependencies.
