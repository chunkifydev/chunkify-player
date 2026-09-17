# @chunkify/player-react

Typed React 19 wrapper over `@chunkify/player`. The Web Component owns playback,
controls, readiness and cleanup. This package adds no playback engine.

Version `0.0.0` is an unpublished development package. Both packages are linked
locally through the repository's npm workspaces. React is a peer dependency;
the package does not bundle React, React DOM or the Web Component.

```tsx
import { useRef } from "react";
import { ChunkifyPlayer, type ChunkifyPlayerRef } from "@chunkify/player-react";

function Video({ src }: { src: string }) {
  const ref = useRef<ChunkifyPlayerRef>(null);
  return (
    <ChunkifyPlayer
      ref={ref}
      status="ready"
      src={src}
      controls
      playsInline
    />
  );
}
```

## Props and refs

Props include `src`, `poster`, `thumbnails`, `assetId`, `status`, `player`,
`credentials`, `autoPlay`, `muted`, `loop`, `playsInline`, and `controls`.
They follow the [Web Component's behavior](../player/README.md). Use React's
`autoPlay` spelling. `className`, `style`, `id`, ARIA attributes and other standard
host attributes apply to the custom element. There is no extra container.

`status="ready"` requires a string `src` in TypeScript. Preparing, failed and
expired states accept an omitted or null source. With status omitted, the player
waits for a source. Runtime validation remains in the Web Component, including
empty or invalid URLs. Removing a prop clears the corresponding setting.

The ref points directly to the `ChunkifyPlayer` Web Component. `ref.current.media`
is the underlying `HTMLVideoElement`; use its `play()`, `pause()` and `currentTime`
API. Wait for media readiness before seeking and handle rejected `play()` promises.
Object refs and React 19 callback refs with cleanup functions are supported.

## Rendering and lifecycle

The entry has a `use client` directive and is safe to import and render on the
server. It renders nothing on the server or during initial client registration.
After the browser loads the Web Component, React renders it and assigns the ref.
Reserve space with a parent layout if needed. Registration failures reach the
nearest React error boundary. Browser-only Web Component imports must not be
added separately to server code.

Development Strict Mode, source replacement, status changes and real
unmount/remount are covered by browser tests. Unmounting while registration is
pending cannot start playback for the removed component. The Web Component
releases playback resources when removed from the DOM; the wrapper does not
manually invoke custom-element lifecycle callbacks.

React 19 is required. Automated tests currently use React and React DOM 19.3
in Chromium, Firefox and WebKit. React 18 and earlier are not supported.

React event callbacks and custom readiness fallback props are the next slice.
Telemetry and real preview/CDN/device validation remain pending. Asset IDs are
passive metadata and do not trigger asset lookup or enable telemetry.

## Package contents

TypeScript emits ES modules, declarations and source maps. Source files and the
MIT license are included. The repository uses esbuild only to bundle the local
React browser fixtures; it is not part of the published runtime.
