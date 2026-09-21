# Chunkify Player

This repository contains a small video player Web Component and its React 19
wrapper. The player uses the browser's `<video>` element for ordinary media and
`hls-video-element` for HLS manifests. Media Chrome renders a locally maintained
Demuxed 2022 theme for both paths. Standard `<track>` children provide captions,
subtitles, chapters, and thumbnail metadata.

## Packages

| Directory | npm package |
| --- | --- |
| `packages/player` | `@chunkify/player` |
| `packages/player-react` | `@chunkify/player-react` |

The root npm package is private. Each package directory contains a publishable
package.

## Development

Use Node.js 24 and npm 11.

```sh
npm ci
npx playwright install --with-deps --only-shell chromium firefox webkit
npm run check
```

`npm run check` builds and typechecks both packages, tests server rendering and
browser behavior, and checks the package contents. It does not publish anything.

To open the examples:

```sh
npm run build
npm run build:react-fixtures
npm run serve
```

Then open:

- `http://127.0.0.1:4173/examples/basic/`
- `http://127.0.0.1:4173/examples/theming/`
- `http://127.0.0.1:4173/examples/react/`

The examples use a checked-in six-second media fixture and make no Chunkify API
calls. Rebuild after changing package source files.

See [the player package README](packages/player/README.md) and
[the React package README](packages/player-react/README.md) for their public APIs.

## Project choices

The player has no public engine selector. A `.m3u8` URL creates an `<hls-video>`;
other URLs create a native `<video>`. `hls-video-element` owns hls.js setup and
cleanup. The wrapper owns element selection, a consistent API, the controls, and
Chunkify theme variables.

Asset readiness stays in the application. The player does not fetch asset state,
construct playback URLs, or show processing and failure screens. Telemetry work
continues separately on the `codex/player-telemetry` branch.

Private playback accepts authorized path-token URLs and signed cookies through
`credentials="include"`. The application owns authorization and token lifecycle.
The player forwards credentials through native playback and hls.js and reports
failures through a sanitized `playback-error` event.

The repository uses TypeScript without Vite. Plain HTML examples use import maps,
and esbuild only prepares the React test fixture and example.

Chunkify-authored code is licensed under [MIT](LICENSE). The copied Demuxed theme
retains its Player.style MIT notice in
[`packages/player/THIRD_PARTY_NOTICES.md`](packages/player/THIRD_PARTY_NOTICES.md).
Runtime dependencies retain their own licenses.
