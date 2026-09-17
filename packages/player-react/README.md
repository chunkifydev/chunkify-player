# @chunkify/player-react

Typed React 19 wrapper over `@chunkify/player`. The Web Component owns playback,
controls and cleanup. This package adds no playback engine.

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
      src={src}
      controls
      playsInline
    />
  );
}
```

## Props and refs

Props include `src`, `poster`, `thumbnails`, `assetId`, `player`, `telemetry`,
`credentials`, `autoPlay`, `muted`, `loop`, `playsInline`, and `controls`.
They follow the [Web Component's behavior](../player/README.md). Use React's
`autoPlay` spelling. `className`, `style`, `id`, ARIA attributes and other standard
host attributes apply to the custom element. There is no extra container.

`src` is optional. Omitting it or passing `null`, `undefined`, an empty string or
whitespace leaves the player idle. Supplying a valid URL initializes playback;
clearing it stops playback and releases the engine. Runtime URL validation remains
in the Web Component. Removing a prop clears the corresponding setting.

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

Development Strict Mode, source replacement, source clearing and real
unmount/remount are covered by browser tests. Unmounting while registration is
pending cannot start playback for the removed component. The Web Component
releases playback and telemetry resources when removed from the DOM; the wrapper
does not manually invoke custom-element lifecycle callbacks.

React 19 is required. Automated tests currently use React and React DOM 19.3
in Chromium, Firefox and WebKit. React 18 and earlier are not supported.

Real preview/CDN/device validation remains pending. Asset IDs are passive metadata
and do not trigger asset lookup or enable telemetry by themselves.

## Optional telemetry

Pass the same typed configuration accepted by the Web Component. `assetId` supplies
the normalized telemetry asset identity and is required for telemetry to become
active:

```tsx
import { ChunkifyPlayer, type TelemetryConfig } from "@chunkify/player-react";

const telemetry: TelemetryConfig = {
  provider: "callback",
  environment: "production",
  sampleRate: 0.1,
  send(event) {
    // Send to a destination owned by your application.
    console.log(event);
  },
};

<ChunkifyPlayer
  assetId="asset_123"
  src="https://media.example.com/manifest.m3u8"
  telemetry={telemetry}
  controls
/>
```

The current integration supports the callback provider. Omitting `telemetry`, or
passing `null` or `undefined`, disables it. React 19 forwards the object through
the custom element's JavaScript property; it is never serialized as an HTML
attribute. Replacing the configuration ends its active telemetry session, source
replacement remains part of the same attachment, and unmount cleanup ends any open
view. Sampling, privacy and callback delivery follow `@chunkify/player-telemetry`.

## Events

Media callbacks receive native browser events. During the callback,
`event.currentTarget` is typed as the player Web Component. `onPlaybackError`
receives a `CustomEvent` with the Web Component's normalized `detail`, containing
`code`, `message` and `engine`. It does not expose source URLs or raw errors.

```tsx
<ChunkifyPlayer
  src="https://media.example.com/manifest.m3u8"
  controls
  onPlaying={(event) => console.log(event.currentTarget.media.currentTime)}
  onPlaybackError={(event) => console.log(event.detail.code, event.detail.message)}
/>

```

The callback props are `onAbort`, `onCanPlay`, `onCanPlayThrough`,
`onDurationChange`, `onEmptied`, `onEnded`, `onError`, `onLoadedData`,
`onLoadedMetadata`, `onLoadStart`, `onPause`, `onPlay`, `onPlaying`, `onProgress`,
`onRateChange`, `onResize`, `onSeeked`, `onSeeking`, `onStalled`, `onSuspend`,
`onTimeUpdate`, `onVolumeChange`, `onWaiting`, and `onPlaybackError`.
Use `onPlaybackError` for actionable playback failures; `onError` forwards the
native media error event. Callbacks are not React SyntheticEvents. Listener
updates and unmount cleanup do not restart playback. Other host event callbacks
are not part of this wrapper's API; use the component ref for additional native
listeners and clean them up in your application.

## Application-owned asset readiness

The application checks asset progression and decides what to display. The player
has no `status`, `preparingFallback`, `failedFallback` or `expiredFallback` props.
Render your own messages and mount the player when a usable URL is available:

```tsx
function AssetVideo({ src, processing }: { src?: string; processing: boolean }) {
  if (processing) return <p role="status">Your video is processing.</p>;
  if (!src) return <p>This video is unavailable.</p>;
  return <ChunkifyPlayer src={src} controls playsInline />;
}
```

You can also keep the player mounted and omit or clear `src` until playback is
wanted. `assetId` never triggers an asset lookup.

The local [React example](../../examples/react/main.tsx) demonstrates application-owned readiness,
event callbacks, ref access and unmount/remount. Build it with
`npm run build && npm run build:react-fixtures`, run `npm run serve`, then open
[the React example](http://127.0.0.1:4173/examples/react/).

## Package contents

TypeScript emits ES modules, declarations and source maps. Source files and the
MIT license are included. The repository uses esbuild only to bundle the local
React browser fixtures; it is not part of the published runtime.
