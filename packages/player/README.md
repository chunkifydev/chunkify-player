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
  thumbnails="https://media.example.com/thumbnails/images.vtt"
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
| `thumbnails` | `thumbnails` | Optional HTTP/HTTPS WebVTT URL for seek previews. Relative URLs resolve against the page. Setting `null`, `undefined`, or an empty string clears previews. |
| `player` | `player` | `auto`, `native`, or `hlsjs`; defaults to `auto`. |
| `credentials` | `credentials` | Optional `include` for customer-set cookies. Setting `null` or `undefined` removes it and restores the engine/browser defaults. Changing it restarts playback. Other attribute values produce `invalid-credentials`. |
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

## Timeline previews

Provide `thumbnails` to show sprite previews when hovering or dragging the seek
bar. The browser parses the WebVTT file. Each cue must contain an image URL with
integer pixel coordinates in `#xywh=x,y,width,height` form. Width and height must
be positive. Multiple cues can share a sprite, and a file can reference multiple
sprites:

```vtt
WEBVTT

00:00:00.000 --> 00:00:03.000
sprite01.jpg#xywh=0,0,160,90

00:00:03.000 --> 00:00:06.000
sprite02.jpg#xywh=160,0,160,90
```

Image URLs resolve relative to the VTT response URL, including after redirects.
Absolute HTTP/HTTPS image URLs also work. Cross-origin VTT files and sprite
images must allow CORS. Loading thumbnails does not change the video's CORS mode.
Set `credentials="include"` to include customer cookies for both VTT and sprite
requests, subject to the private-playback requirements below.

The VTT loads only during active playback initialization. Non-ready states and
disconnected players request neither VTT nor sprites. Sprites load when requested
by the seek preview. Replacing `thumbnails` leaves video playback intact; changing
the source, leaving ready, or disconnecting cancels the VTT load and clears the old
track and preview image. A missing VTT, invalid cue, or failed sprite image hides
the affected preview without stopping playback.

The loader uses `fetch` and a temporary blob-backed metadata track for browser
WebVTT parsing. Sites using Content Security Policy must permit the VTT host in
`connect-src`, `blob:` in `media-src`, and sprite hosts in `img-src`.

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

## Private playback

Authorization belongs to the customer application and CDN. The player accepts
an already authorized URL, or forwards cookies that the customer backend has
already set. It never signs, refreshes, stores, or revokes tokens.

For a path-token CDN, pass the authorized manifest URL as `src`. The player
preserves the supplied path and query parameters. Child playlists and media
resolve according to the manifest URLs; it does not copy a manifest's query
token onto child URLs. The CDN's authorized path must cover those resources,
or the manifest must supply individually authorized URLs. Supply authorized
poster and thumbnail URLs separately when those resources are protected.

For customer-managed cookies, such as CloudFront signed cookies:

```html
<!-- The customer backend sets the CDN cookies before rendering this player. -->
<chunkify-player
  src="https://media.example.com/asset/manifest.m3u8"
  poster="https://media.example.com/asset/poster.jpg"
  thumbnails="https://media.example.com/asset/thumbnails/images.vtt"
  credentials="include"
  controls
></chunkify-player>
```

The same option is available as `player.credentials = "include"`. It configures
the native video's `crossorigin="use-credentials"`, hls.js requests through its
XHR loader, VTT fetches, and sprite images before those resources load. This
covers master/child playlists, initialization segments, media segments and byte
ranges, plus posters and previews. Setting the property to `null` or `undefined`
removes the option. Changing it stops the old attempt and initializes a new one;
non-ready or disconnected players still make no media requests.

Without this option, the existing engine/browser defaults apply. In particular,
it is not a guarantee that the browser sends no cookies. Cross-origin hls.js and
VTT requests do not opt into cookies, and sprite images use anonymous CORS.

For cross-origin cookie requests, the CDN must return the exact allowed page
origin in `Access-Control-Allow-Origin`, not `*`, and
`Access-Control-Allow-Credentials: true`. Configure those responses consistently
for playlists, media, images and errors. Cookies must also match the media host
and path and satisfy the browser's SameSite, Secure and third-party-cookie rules.
See [credentialed CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS#requests_with_credentials)
and [native media CORS settings](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/crossOrigin).

Automated tests exercise a cookie-gated, cross-origin but same-site local server,
including hls.js HLS byte ranges, native MP4 seeking, and native HLS when the
browser reports support. Path-token tests verify URL handling using a synthetic
authorized path; they do not certify a CDN's signing implementation. Real Safari,
iOS, cross-site cookies and customer CDN configurations require deployment tests.
No universal native/cross-site cookie compatibility or DRM is claimed.

Denied media requests emit the normalized `playback-error` event without URLs,
cookies or raw errors. Native browsers may report a denied resource as an
unsupported source rather than expose its HTTP status. Optional poster/preview
failures do not stop video playback. When authorization expires, the customer
application must obtain fresh authorization and restart playback, for example by
replacing `src`; the player does not contact an authorization service.

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

Codes are `missing-source`, `invalid-source`, `invalid-status`, `invalid-player`, `invalid-credentials`,
`unsupported-engine`, `unsupported-source`, `engine-load-failed`, `network-error`,
`decode-error`, and `playback-failed`. Startup failures, fatal hls.js errors, and
native media errors stop the current attempt. Change the source/status or
disconnect and reconnect to start a new attempt. hls.js handles its own
recoverable errors before a fatal error reaches this interface.

## Current scope

This wrapper includes playback, posters, sprite VTT previews, themed controls,
cookie credentials, and lifecycle handling. The React wrapper and telemetry
are not implemented yet. No telemetry listeners or destinations are
installed. No DRM or universal private-CDN compatibility is claimed.

The package emits ES modules, TypeScript declarations, and source maps. Sources
are included so source and declaration maps remain usable. Chunkify-authored
code is licensed under [MIT](LICENSE); hls.js has its own Apache-2.0 license.
Media Chrome and the Demuxed 2022 theme are MIT-licensed dependencies.
