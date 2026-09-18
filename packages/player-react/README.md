# @chunkify/player-react

This package provides a typed React 19 wrapper for `@chunkify/player`.

```tsx
import { useRef } from "react";
import { ChunkifyPlayer, type ChunkifyPlayerRef } from "@chunkify/player-react";

function Video({ src }: { src: string }) {
  const ref = useRef<ChunkifyPlayerRef>(null);
  return (
    <ChunkifyPlayer
      ref={ref}
      src={src}
      controls
      playsInline
      onPlaying={(event) => console.log(event.currentTarget.media.currentTime)}
    />
  );
}
```

## Props and refs

Playback props are `src`, `poster`, `preload`, `crossOrigin`, `autoPlay`, `muted`,
`loop`, `playsInline`, and `controls`. Standard host props such as `className`,
`style`, `id`, and ARIA attributes apply to the custom element.

The ref points to the Web Component. `ref.current.media` returns its current
media element. Read it again after changing between HLS and MP4 because that
change replaces the internal element.

Media callbacks receive native events whose `currentTarget` is the player. The
supported callbacks match the standard media events forwarded by the Web
Component, including `onLoadedMetadata`, `onPlay`, `onPlaying`, `onPause`,
`onTimeUpdate`, `onEnded`, and `onError`.

## Server rendering

The entry has a `use client` directive and does not import the Web Component at
module evaluation time. It renders nothing on the server and loads the component
after mounting in the browser. React is a peer dependency and is not bundled.

Version `0.0.0` is an unreleased development version.
