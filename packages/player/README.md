# @chunkify/player

`@chunkify/player` registers `<chunkify-player>`, a Web Component that plays HLS
and ordinary video sources with one interface and one control theme.

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
| `autoplay` | `autoplay` | Standard boolean autoplay setting. |
| `muted` | `muted` | Standard boolean muted setting. |
| `loop` | `loop` | Standard boolean loop setting. |
| `playsinline` | `playsInline` | Standard boolean inline playback setting. |
| `controls` | `controls` | Shows the Demuxed Media Chrome controls. |

Properties reflect to attributes. Setting a string property to `null` or
`undefined` removes its attribute. Boolean attributes follow HTML rules, so
`controls="false"` still enables controls.

The component forwards standard media events such as `loadedmetadata`, `play`,
`pause`, `timeupdate`, `ended`, and `error` from the current media element.

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
Remote WebVTT files must allow CORS, and cross-origin tracks may require a matching
`crossorigin` setting on the player. Read active tracks through
`player.media.textTracks`.

## Controls and customization

Media Chrome renders the Demuxed 2022 theme. The internal media element keeps its
native controls disabled so the page never shows two control interfaces.

Set these supported CSS custom properties on `chunkify-player`:

| Property | Default | Effect |
| --- | --- | --- |
| `--chunkify-player-accent-color` | `#7596cc` | Accent and range thumb color. |
| `--chunkify-player-control-color` | `black` | Control icon color. |
| `--chunkify-player-control-background` | `white` | Control background color. |
| `--chunkify-player-font-family` | `system-ui, sans-serif` | Control font. |
| `--chunkify-player-progress-color` | `white` | Filled range color. |
| `--chunkify-player-border-radius` | `0` | Player corner radius. |

```css
.brand-player {
  --chunkify-player-accent-color: #a78bfa;
  --chunkify-player-control-color: #2e1065;
  --chunkify-player-control-background: #f5f3ff;
  --chunkify-player-border-radius: 18px;
}

.brand-player::part(media) {
  object-fit: cover;
}
```

The component exposes `theme` and `media` CSS parts. The documented
`--chunkify-player-*` variables and these parts form its supported styling API.
Media Chrome's internal variables may change with that dependency.

## Plain HTML without a bundler

A bundler resolves package dependencies after `import "@chunkify/player"`. Plain
HTML needs an import map for the package and its browser dependencies. See
`examples/basic/index.html` for a complete local map.

Version `0.0.0` is an unreleased development version.
