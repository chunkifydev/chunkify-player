# Chunkify Player

Chunkify Player provides a Web Component and a typed React 19 wrapper for HLS
and ordinary video. It selects `<hls-video>` for `.m3u8` sources and native
`<video>` for files such as MP4. Media Chrome supplies the controls through one
bundled default theme.

| Package | Directory |
| --- | --- |
| `@chunkify/player` | `packages/player` |
| `@chunkify/player-react` | `packages/player-react` |

The packages are currently unreleased at version `0.0.0`.

## Web component

Import the package once, then use `<chunkify-player>`:

```js
import "@chunkify/player";
```

```html
<chunkify-player
  src="https://media.example.com/master.m3u8"
  poster="https://media.example.com/poster.jpg"
  controls
  playsinline
>
  <track default kind="captions" srclang="en" label="English"
    src="https://media.example.com/captions/en.vtt" />
  <track default kind="metadata" label="thumbnails"
    src="https://media.example.com/thumbnails/images.vtt" />
</chunkify-player>
```

The component requires a browser DOM. Its main attributes and matching
JavaScript properties are:

| Attribute | Property | Purpose |
| --- | --- | --- |
| `src` | `src` | HLS manifest or ordinary video URL. |
| `poster` | `poster` | Poster image URL. |
| `preload` | `preload` | Standard preload value. Defaults to `metadata`. |
| `crossorigin` | `crossOrigin` | Standard media CORS setting. |
| `credentials` | `credentials` | Use `include` for signed-cookie playback. |
| `theme` | `theme` | Registered theme name. Defaults to `default`. |
| `aspect-ratio` | `aspectRatio` | `portrait` for `9 / 16` or `landscape` for `16 / 9`. |
| `primary-color` | `primaryColor` | Control foreground color. |
| `secondary-color` | `secondaryColor` | Control background color. |
| `accent-color` | `accentColor` | Active control color. |
| `autoplay` | `autoplay` | Standard boolean autoplay setting. |
| `muted` | `muted` | Standard boolean muted setting. |
| `loop` | `loop` | Standard boolean loop setting. |
| `playsinline` | `playsInline` | Standard boolean inline playback setting. |
| `controls` | `controls` | Shows the themed controls. |
| `autoseektolive` | `autoSeekToLive` | Opts into seeking to the live edge. |

Boolean attributes follow HTML rules, so `controls="false"` still enables
controls. String properties accept `null` or `undefined` to remove their
attribute.

The read-only `media` property returns the active media element. Read it again
after switching between HLS and MP4 because that change replaces the element.
The player forwards standard media events such as `play`, `pause`, `timeupdate`,
`ended`, and `error`.

## Playback access

For a path-token CDN, pass the complete authorized URL as `src`. For signed
cookies, set the cookie in the application backend before creating the player,
then enable credentials:

```html
<chunkify-player
  src="https://media.example.com/private/master.m3u8"
  credentials="include"
  controls
></chunkify-player>
```

The media origin must return `Access-Control-Allow-Credentials: true` and an
explicit `Access-Control-Allow-Origin` matching the page origin. Browser cookie
rules still apply.

For authorization, network, format, and decoding failures, the component
dispatches a sanitized `playback-error` event. Its detail contains `code`,
`message`, and `engine`, but never the source URL or token:

```js
player.addEventListener("playback-error", (event) => {
  console.log(event.detail.code, event.detail.engine);
});
```

The application remains responsible for creating, refreshing, and revoking
tokens and cookies. The player does not provide DRM.

## Tracks and thumbnails

Direct-child `<track>` elements are mirrored into the active media element.
This supports captions, subtitles, chapters, and Media Chrome thumbnail
previews. Thumbnail previews use `kind="metadata"` and `label="thumbnails"`.

Same-origin tracks need no CORS attribute. Public cross-origin tracks require
`crossorigin="anonymous"` and an `Access-Control-Allow-Origin` response header.
Cookie-protected cross-origin tracks use `credentials="include"`; the player
sets `use-credentials` internally.

## Appearance

The bundled `default` theme is a local adaptation of Player.style's Demuxed
2022 theme. The `theme="default"` attribute is optional.

Set its main colors directly on the player:

```html
<chunkify-player
  primary-color="#2563EB"
  secondary-color="#16A34A"
  accent-color="#DC2626"
  src="/master.m3u8"
  controls
></chunkify-player>
```

Button visibility uses CSS variables set to `none`:

```html
<chunkify-player
  style="--pip-button: none; --captions-button: none"
  src="/master.m3u8"
  controls
></chunkify-player>
```

Supported variables are `--play-button`, `--mute-button`,
`--captions-button`, `--pip-button`, `--fullscreen-button`,
`--airplay-button`, and `--cast-button`.

The media defaults to `object-fit: contain`, so its ratio is preserved. Common
player ratios have attribute shortcuts:

```html
<chunkify-player aspect-ratio="portrait" src="/portrait.mp4" controls>
</chunkify-player>

<chunkify-player aspect-ratio="landscape" src="/master.m3u8" controls>
</chunkify-player>
```

Ordinary CSS can override the preset or set another ratio:

```css
.customer-player {
  aspect-ratio: 4 / 5;
  --media-object-fit: cover;
  --media-object-position: 25% 50%;
}

.customer-player::part(theme) {
  --media-range-bar-color: #c4b5fd;
}
```

The component exposes `theme` and `media` CSS parts. Other Media Chrome
variables can depend on the selected theme and are not part of Chunkify's
stable interface.

Applications can register a custom Media Chrome template with
`registerPlayerTheme(name, template)`. The template must provide a `media` slot
for the active video element. Unknown theme names fall back to `default`.

## React

`@chunkify/player-react` provides typed props, event callbacks, and refs:

```tsx
import { useRef } from "react";
import {
  ChunkifyPlayer,
  type ChunkifyPlayerRef,
} from "@chunkify/player-react";

function Video({ src }: { src: string }) {
  const ref = useRef<ChunkifyPlayerRef>(null);

  return (
    <ChunkifyPlayer
      ref={ref}
      src={src}
      aspectRatio="landscape"
      controls
      playsInline
      onPlaying={(event) => {
        console.log(event.currentTarget.media.currentTime);
      }}
    />
  );
}
```

Web Component attributes use React-style names such as `crossOrigin`,
`aspectRatio`, `primaryColor`, `autoPlay`, `playsInline`, and `autoSeekToLive`.
Standard host props, `<track>` children, and the documented CSS variables are
also typed. The ref exposes the Web Component and its current `media` element.

The React entry is safe to import during server rendering. It renders nothing
on the server and loads the Web Component after mounting in the browser.

## Development

Use Node.js 24 and npm 11:

```sh
npm ci
npx playwright install --with-deps --only-shell chromium firefox webkit
npm run check
```

To run the local examples:

```sh
npm run build
npm run build:react-fixtures
npm run serve
```

- `http://127.0.0.1:4173/examples/basic/`
- `http://127.0.0.1:4173/examples/theming/`
- `http://127.0.0.1:4173/examples/vertical/`
- `http://127.0.0.1:4173/examples/react/`

The repository uses TypeScript without Vite. Plain HTML examples use import
maps, and esbuild only prepares the React example and test fixture.

Asset readiness stays in the application. The player does not fetch asset
state, construct playback URLs, or show processing screens.

## License

Chunkify-authored code is licensed under [MIT](LICENSE). The adapted
Player.style theme retains its MIT notice in
[`packages/player/THIRD_PARTY_NOTICES.md`](packages/player/THIRD_PARTY_NOTICES.md).
Runtime dependencies retain their own licenses.
