# @chunkify/player-react

The typed React wrapper for Chunkify Player, with HLS and ordinary video
support.

## Installation

```sh
npm install @chunkify/player-react
```

## Usage

```tsx
import { ChunkifyPlayer } from "@chunkify/player-react";

export function VideoPlayer() {
  return (
    <ChunkifyPlayer
      src="https://media.example.com/master.m3u8"
      poster="https://media.example.com/poster.jpg"
      thumbnails="https://media.example.com/thumbnails/images.vtt"
      controls
      playsInline
    />
  );
}
```

Customization, private playback, refs, events, themes, and the complete API are
documented in the
[Chunkify Player repository](https://github.com/chunkifydev/chunkify-player#readme).
