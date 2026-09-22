# @chunkify/player

`@chunkify/player` registers `<chunkify-player>`, a Web Component that plays HLS
and ordinary video sources with one interface and selectable control themes.

```js
import "@chunkify/player";
```

```html
<chunkify-player
  src="https://media.example.com/manifest.m3u8"
  poster="https://media.example.com/poster.jpg"
  controls
  muted
  playsinline
></chunkify-player>
```

The package requires a browser DOM. The React package loads it only in the
browser, so React server rendering remains safe.

## Playback behavior

The component creates `<hls-video>` when the source URL path ends in `.m3u8` and
uses `<video>` for other sources such as `.mp4`. This choice is automatic and has
no public setting. `hls-video-element` uses hls.js where Media Source Extensions
are available and native HLS where the browser provides it.

Changing between HLS and an ordinary source replaces the internal media element.
Clearing `src` stops playback and leaves an idle native video element. Removing
the player from the document stops playback and releases the active source.

The read-only `media` property returns the current media element. Use its standard
media API for actions such as `play()`, `pause()`, seeking, volume, and playback
rate. When a source change replaces the element, read `player.media` again instead
of keeping an old reference.

## Attributes and properties

| Attribute | JavaScript property | Description |
| --- | --- | --- |
| `src` | `src` | HLS manifest or ordinary video URL. |
| `poster` | `poster` | Poster image URL. |
| `preload` | `preload` | Standard media preload value. Defaults to `metadata`. |
| `crossorigin` | `crossOrigin` | Standard media CORS setting. |
| `credentials` | `credentials` | Set to `include` to send cookies during playback. |
| `theme` | `theme` | Registered control theme. Defaults to `default`. |
| `aspect-ratio` | `aspectRatio` | `portrait` maps to `9 / 16`; `landscape` maps to `16 / 9`. |
| `primary-color` | `primaryColor` | Primary Media Chrome color for control foregrounds. |
| `secondary-color` | `secondaryColor` | Secondary Media Chrome color for control backgrounds. |
| `accent-color` | `accentColor` | Media Chrome accent color for active and highlighted controls. |
| `autoplay` | `autoplay` | Standard boolean autoplay setting. |
| `muted` | `muted` | Standard boolean muted setting. |
| `loop` | `loop` | Standard boolean loop setting. |
| `playsinline` | `playsInline` | Standard boolean inline playback setting. |
| `controls` | `controls` | Shows the selected Media Chrome theme controls. |
| `autoseektolive` | `autoSeekToLive` | Seeks to the live edge when live playback starts. Defaults to `false`. |

Properties reflect to attributes. Setting a string property to `null` or
`undefined` removes its attribute. Boolean attributes follow HTML rules, so
`controls="false"` still enables controls.

The component forwards standard media events such as `loadedmetadata`, `play`,
`pause`, `timeupdate`, `ended`, and `error` from the current media element.

The player preserves the media element's current position when live playback
starts. Add `autoseektolive`, or set `autoSeekToLive` to `true`, to opt into
Media Chrome's automatic seek to the live edge.

## Private playback

For a path-token CDN, pass the complete authorized manifest URL through `src`.
The player does not rewrite the URL, including its query string.

For signed-cookie playback, the application backend must set the cookie before
creating the player. Set `credentials="include"` so the native media element and
hls.js send cookies with manifests and media requests:

```html
<chunkify-player
  src="https://media.example.com/private/master.m3u8"
  credentials="include"
  controls
></chunkify-player>
```

The media origin must return `Access-Control-Allow-Credentials: true` and an
explicit `Access-Control-Allow-Origin` value matching the page origin. A wildcard
origin cannot be used with credentialed requests. Browser cookie rules still
apply, so cross-site cookies may be blocked.

The player dispatches a `playback-error` event for authorization, network,
format, and decoding failures. Its `detail` contains `code`, `message`, and
`engine`. It never includes the source URL or token.

```js
player.addEventListener("playback-error", (event) => {
  console.log(event.detail.code, event.detail.engine);
});
```

The application remains responsible for creating, refreshing, and revoking
tokens and cookies. The player does not provide DRM or bypass browser cookie
restrictions.

To run the private-playback browser tests locally, stop any existing server on
port `4173`, build the packages, and run the focused Playwright suite:

```sh
npm run build
npx playwright test tests/browser/private-playback.spec.ts
```

Add `--project=chromium` to test only Chromium. The full suite tests Chromium,
Firefox, and WebKit. It covers cookie forwarding through native playback and
hls.js, HLS child manifests and byte ranges, unchanged path-token URLs, denied
access, and recovery with a replacement source.

## Tracks

Add direct-child `<track>` elements for captions, subtitles, chapters, or
thumbnail metadata. The player mirrors them into the active media element and
keeps them synchronized when their attributes change or playback switches
between HLS and ordinary video.

```html
<chunkify-player src="/master.m3u8" controls>
  <track default kind="captions" srclang="en" label="English" src="/captions/en.vtt" />
  <track kind="captions" srclang="fr" label="Français" src="/captions/fr.vtt" />
  <track default kind="metadata" label="thumbnails" src="/thumbnails/images.vtt" />
</chunkify-player>
```

Use `kind="metadata"` and `label="thumbnails"` for Media Chrome seek previews.
The VTT file and every sprite image referenced by it must be accessible from the
page:

- Same-origin thumbnail files need no `crossorigin` attribute.
- Public cross-origin thumbnail files require `crossorigin="anonymous"` and an
  `Access-Control-Allow-Origin` response header from the media server.
- Cookie-protected cross-origin thumbnail files require `credentials="include"`,
  `Access-Control-Allow-Credentials: true`, and an explicit
  `Access-Control-Allow-Origin` value matching the page origin. Do not also set
  `crossorigin="anonymous"`; the player uses `use-credentials` internally.

A different scheme, hostname, or port makes a URL cross-origin. Read active
tracks through `player.media.textTracks`.

## Controls and customization

Media Chrome renders Chunkify's local default theme, adapted from Demuxed 2022.
The internal media element keeps its native controls disabled so the page never
shows two control interfaces. `theme="default"` is optional.

Set the same three colors exposed by Mux Player:

```html
<chunkify-player
  primary-color="#700cd4"
  secondary-color="#bb1111"
  accent-color="#cf2626"
  src="/master.m3u8"
  controls
></chunkify-player>
```

The attributes set `--media-primary-color`, `--media-secondary-color`, and
`--media-accent-color` on the selected theme. Remove an attribute to restore
that theme's default for the color.

The bundled default theme exposes Mux-style player variables for selectively
hiding its buttons. Set a variable to `none` on the player:

```html
<chunkify-player
  style="--pip-button: none; --captions-button: none"
  src="/master.m3u8"
  controls
></chunkify-player>
```

| Variable | Control |
| --- | --- |
| `--play-button` | Center and control-bar play buttons |
| `--mute-button` | Mute button |
| `--captions-button` | Captions button |
| `--pip-button` | Picture-in-Picture button |
| `--fullscreen-button` | Fullscreen button |
| `--airplay-button` | AirPlay button |
| `--cast-button` | Cast button |

These variables are part of Chunkify's bundled-theme contract. A custom theme
must map them to its own controls if it wants to support the same interface.

### Media sizing

The player fills the size set by the application. Its media defaults to
`object-fit: contain`, so MP4 and HLS video preserve their source ratio without
stretching. Use a preset to set a common player ratio:

```html
<chunkify-player aspect-ratio="portrait" src="/portrait.mp4" controls>
</chunkify-player>

<chunkify-player aspect-ratio="landscape" src="/master.m3u8" controls>
</chunkify-player>
```

`portrait` maps to `9 / 16` and `landscape` maps to `16 / 9`. When the attribute
is omitted or invalid, the component does not impose a ratio. Set an exact or
uncommon ratio with ordinary CSS:

```css
chunkify-player {
  width: 100%;
  aspect-ratio: 4 / 5;
}
```

Explicit CSS overrides the attribute preset.

Use the shared sizing variables when the video should crop to fill that area or
when its focal point should move:

```css
.cropped-player {
  --media-object-fit: cover;
  --media-object-position: 25% 50%;
}
```

The player does not change its outer aspect ratio when a source changes. The
application controls that layout; `contain` controls how the media fits inside
it.

For advanced styling, use ordinary CSS on the player and Media Chrome variables
through the `theme` part:

```css
.brand-player {
  border-radius: 18px;
  --media-object-fit: cover;
}

.brand-player::part(theme) {
  --media-range-bar-color: #c4b5fd;
  --media-range-track-background: rgb(46 16 101 / 0.35);
}
```

The bundled theme supports the range variables shown above. Other Media Chrome
variables may be overridden by a theme's layout and are not part of Chunkify's
public contract. Use either the color attributes or the corresponding
`--media-*` colors on the `theme` part. Following the shadow-DOM cascade, a color
set through the part overrides the matching attribute. The component exposes
`theme` and `media` as its supported CSS parts. Removing the `controls`
attribute hides the complete control interface.

### Custom themes

Register a custom Media Chrome template once before creating players, then
select it by name:

```js
import { registerPlayerTheme } from "@chunkify/player";

const template = document.createElement("template");
template.innerHTML = `
  <media-controller>
    <slot name="media" slot="media"></slot>
    <media-control-bar>
      <media-play-button></media-play-button>
      <media-time-range></media-time-range>
      <media-mute-button></media-mute-button>
      <media-fullscreen-button></media-fullscreen-button>
    </media-control-bar>
  </media-controller>
`;

registerPlayerTheme("customer", template);
```

```html
<chunkify-player theme="customer" src="/master.m3u8" controls></chunkify-player>
```

Registration belongs in the theme module or application setup, not on each
player. The template must provide a `media` slot so the selected video element
can connect to its `media-controller`. An unknown theme name uses `default`.

The default theme adaptation and its license notice are included in this
package. It does not depend on Player.style packages at runtime.

## Plain HTML without a bundler

A bundler resolves package dependencies after `import "@chunkify/player"`. Plain
HTML needs an import map for the package and its browser dependencies. See
`examples/basic/index.html` for a complete local map.

Version `0.0.0` is an unreleased development version.
