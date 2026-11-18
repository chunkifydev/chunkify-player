# @chunkify/player

The Chunkify Player Web Component for HLS and ordinary video sources such as
MP4. It includes a customizable control theme.

## Installation

```sh
npm install @chunkify/player
```

## Usage

Import the package once to register `<chunkify-player>`:

```js
import "@chunkify/player";
```

```html
<chunkify-player
  src="https://media.example.com/master.m3u8"
  poster="https://media.example.com/poster.jpg"
  thumbnails="https://media.example.com/thumbnails/images.vtt"
  controls
  playsinline
></chunkify-player>
```

To send playback analytics to a Chunkify collector, add `analytics` with
`analytics-ingest-key` and `analytics-video-id`.

React integration, customization, private playback, themes, analytics, and the complete
API are documented in the
[Chunkify Player repository](https://github.com/chunkifydev/chunkify-player#readme).
