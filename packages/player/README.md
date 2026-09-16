# @chunkify/player

`<chunkify-player>` wraps a native video element and loads hls.js on demand.
Version `0.0.0` is an unreleased development version.

## Basic use

In a browser application with npm module resolution:

```js
import "@chunkify/player";
```

```html
<chunkify-player
  status="ready"
  player="auto"
  src="https://media.example.com/manifest.m3u8"
  poster="https://media.example.com/poster.jpg"
  controls
  muted
  playsinline
></chunkify-player>
```

Importing the package registers the element. It requires a browser DOM; do not
import it during server rendering. The React wrapper is a later step.

For plain HTML without a bundler, provide an import map for `@chunkify/player`
and its dependencies: `hls.js`, `@player.style/demuxed-2022`, `media-chrome`, and the
`media-chrome/` path prefix. The repository's `examples/basic/index.html`
demonstrates this with local files. Bare npm imports cannot resolve without a module
resolver or import map. No published CDN import is available for this version.

## Attributes and properties

| Attribute | JavaScript property | Behavior |
| --- | --- | --- |
| `src` | `src` | HTTP/HTTPS HLS URL, or a `.mp4` URL with native/auto playback. Relative URLs resolve against the page. Setting `null` or `undefined` removes it. |
| `poster` | `poster` | Optional image URL. Relative URLs resolve against the page. Setting `null`, `undefined`, or an empty string clears the media poster. |
| `player` | `player` | `auto`, `native`, or `hlsjs`; defaults to `auto`. |
| `status` | `status` | `preparing`, `ready`, `failed`, `expired`, or omitted. Setting `null` or `undefined` removes it. |
| `autoplay` | `autoplay` | Boolean attribute. Subject to browser autoplay policies. |
| `muted` | `muted` | Boolean attribute; updates the video's muted state when changed. |
| `loop` | `loop` | Boolean attribute. |
| `playsinline` | `playsInline` | Boolean attribute; forwarded where supported by the browser. |
| `controls` | `controls` | Boolean attribute enabling the Demuxed 2022 controls and keyboard shortcuts. |

Boolean attributes follow HTML rules: omit `controls` to disable it;
`controls="false"` still enables it. Properties reflect to attributes. Properties
assigned before registration are preserved when the element connects. `media`
is a read-only reference to the underlying `HTMLVideoElement`. Its native
`controls` property stays false to avoid displaying two sets of controls.

## Posters and controls

The poster appears before playback using the browser's video poster behavior.
Changing or clearing it does not restart playback. The component does not request
the poster while preparing, failed, expired, disconnected, or waiting for a source.
A failed poster request does not prevent video playback.

With `controls`, the component uses Media Chrome and the Demuxed 2022 theme.
It provides play/pause, mute, a seek bar, and a desktop volume slider and time
display. Fullscreen and picture-in-picture controls appear when the browser
reports support. Browser permissions and embedding policies can still restrict
those actions. Casting and captions are outside this release's scope.

Use Tab to focus controls, Enter/Space to activate buttons, and Home/End or arrow
keys on the seek slider. Media Chrome also provides focused-player shortcuts
such as `k` for play/pause, `m` for mute, and `f` for fullscreen. Removing
`controls` hides the controls and disables their gestures and shortcuts without
restarting playback. Playback remains available through `.media`.

The controls adapt to the player's width. The theme integration is isolated in
`src/theme.ts` so the design can be replaced independently of playback. There is
no public runtime theme selector in this version.

```js
const player = document.querySelector("chunkify-player");
const canPlay = new Promise((resolve) => {
  player.addEventListener("canplay", resolve, { once: true });
});
player.src = "/videos/another/manifest.m3u8";
player.status = "ready";
await canPlay;
await player.media.play();
player.media.pause();
```

Readiness and source changes are applied together in a microtask. Wait for
`loadedmetadata` or `canplay` before operations that need a loaded source, such
as seeking. Handle `playback-error` when waiting for readiness, and handle the
promise returned by `play()`: browser autoplay restrictions still apply.

## Engines and readiness

`auto` uses native playback for `.mp4` URLs and for HLS when the browser reports
native HLS support. Otherwise it imports hls.js. `hlsjs` forces hls.js for HLS;
it does not silently switch to native. `native` never imports hls.js and reports
an error when the browser lacks native HLS support. Other non-`.mp4` URLs are
treated as HLS. The selected engine is replaced when `src` or `player` changes.

| Status | Behavior |
| --- | --- |
| `preparing`, `failed`, `expired` | Show a fallback and make no media requests. |
| `ready` | Require a valid source, then initialize the selected engine. |
| Omitted | Wait for a non-empty source, then initialize playback. |

Native playback does not download hls.js. Non-ready states do not start an
engine. A pending engine import may finish after a status change, but it cannot
initialize playback for the old source. Removing the element or leaving ready
destroys the active engine and clears the media source. Reconnecting starts
playback initialization again using the current attributes.

Built-in fallbacks use `role="status"`. Customize them with named slots:

```html
<chunkify-player status="preparing">
  <p slot="preparing">Your video is processing.</p>
  <p slot="failed">This video is unavailable.</p>
  <p slot="expired">This preview has expired.</p>
</chunkify-player>
```

The wrapper does not fetch asset metadata, poll readiness, construct URLs from
asset IDs, or contact a Chunkify API. The caller supplies status and source URLs.

## Events and errors

Standard media events are forwarded to the host during active playback,
including `loadedmetadata`, `canplay`, `play`, `playing`, `pause`, `timeupdate`,
`waiting`, `seeking`, `seeked`, `ended`, `volumechange`, and `error`. These are
non-bubbling events. The original media element also remains available through
`media` for native event listeners and methods.

`playback-error` is a `CustomEvent<PlaybackErrorDetail>` with a stable `code`, a
fixed user-facing `message`, and the selected `engine`, or `null` before selection.
It never includes the source URL or a raw engine error.

```js
player.addEventListener("playback-error", (event) => {
  console.log(event.detail.code, event.detail.message);
});
```

Codes are `missing-source`, `invalid-source`, `invalid-status`, `invalid-player`,
`unsupported-engine`, `unsupported-source`, `engine-load-failed`, `network-error`,
`decode-error`, and `playback-failed`. Startup failures, fatal hls.js errors, and
native media errors stop the current attempt. Change the source/status or
disconnect and reconnect to start a new attempt. hls.js handles its own
recoverable errors before a fatal error reaches this interface.

## Current scope

This wrapper includes playback, posters, themed controls, and lifecycle handling.
VTT previews, private-cookie credential configuration, the React wrapper, and
telemetry are not implemented yet. No telemetry listeners or destinations are
installed. No DRM or universal private-CDN compatibility is claimed.

The package emits ES modules, TypeScript declarations, and source maps. Sources
are included so source and declaration maps remain usable. Chunkify-authored
code is licensed under [MIT](LICENSE); hls.js has its own Apache-2.0 license.
Media Chrome and the Demuxed 2022 theme are MIT-licensed dependencies.
