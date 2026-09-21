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

Playback props are `src`, `poster`, `preload`, `crossOrigin`, `credentials`,
`autoPlay`, `muted`, `loop`, `playsInline`, `controls`, and `noAutoSeekToLive`.
Set `noAutoSeekToLive` to preserve the current position when live playback
starts. Set `credentials` to `"include"` after the application backend has set a
signed playback cookie.
Standard host props such as `className`, `style`, `id`, and ARIA attributes apply
to the custom element.

Pass standard `<track>` children for captions, subtitles, chapters, and thumbnail
metadata:

```tsx
<ChunkifyPlayer src="/master.m3u8" controls>
  <track default kind="captions" src="/captions/en.vtt" srcLang="en" label="English" />
  <track default kind="metadata" src="/thumbnails/images.vtt" label="thumbnails" />
</ChunkifyPlayer>
```

The ref points to the Web Component. `ref.current.media` returns its current
media element. Read it again after changing between HLS and MP4 because that
change replaces the internal element.

Media callbacks receive native events whose `currentTarget` is the player. The
supported callbacks match the standard media events forwarded by the Web
Component, including `onLoadedMetadata`, `onPlay`, `onPlaying`, `onPause`,
`onTimeUpdate`, `onEnded`, and `onError`.

Use `onPlaybackError` for the player's normalized authorization, network, format,
and decoding failures:

```tsx
<ChunkifyPlayer
  src="https://media.example.com/private/master.m3u8"
  credentials="include"
  onPlaybackError={(event) => console.log(event.detail.code)}
/>
```

The error detail contains `code`, `message`, and `engine`, without the source URL
or token. See the `@chunkify/player` private-playback documentation for the CORS
and cookie requirements.

## Server rendering

The entry has a `use client` directive and does not import the Web Component at
module evaluation time. It renders nothing on the server and loads the component
after mounting in the browser. React is a peer dependency and is not bundled.

Version `0.0.0` is an unreleased development version.
