import { createRef } from "react";
import { ChunkifyPlayer, type ChunkifyPlayerRef, type TelemetryConfig } from "@chunkify/player-react";

const ref = createRef<ChunkifyPlayerRef>();
<ChunkifyPlayer ref={ref} src="/master.m3u8" assetId="asset-123"
  poster={null} thumbnails={undefined} credentials="include" autoPlay muted loop playsInline controls
  className="video" style={{ width: "100%" }} aria-label="Product video" />;
<ChunkifyPlayer src={null} />;
<ChunkifyPlayer />;
<ChunkifyPlayer src="" />;
<ChunkifyPlayer src={undefined} />;
const media: HTMLVideoElement | undefined = ref.current?.media;
void media;
// @ts-expect-error Asset status belongs to the application.
<ChunkifyPlayer status="ready" />;
// @ts-expect-error The Web Component has no asset status property.
ref.current?.status;
// @ts-expect-error Unsupported engine.
<ChunkifyPlayer player="videojs" />;
// @ts-expect-error Only include or an omitted credentials option is supported.
<ChunkifyPlayer credentials="omit" />;

const telemetry: TelemetryConfig = {
  provider: "callback",
  sampleRate: 0.5,
  send(event) { console.log(event.event_name); },
};
<ChunkifyPlayer assetId="asset-telemetry" telemetry={telemetry} />;
<ChunkifyPlayer telemetry={null} />;
<ChunkifyPlayer telemetry={undefined} />;
// @ts-expect-error Telemetry configuration is an object, not an HTML attribute string.
<ChunkifyPlayer telemetry="callback" />;

<ChunkifyPlayer
  onPlay={(event) => { const video: HTMLVideoElement = event.currentTarget.media; void video; }}
  onPlaybackError={(event) => {
    const code: import("@chunkify/player").PlaybackErrorCode = event.detail.code;
    void code;
    // @ts-expect-error Normalized errors do not expose media URLs.
    event.detail.url;
  }} />;
// @ts-expect-error Media callbacks receive native events, not React SyntheticEvents.
<ChunkifyPlayer onPlay={(event) => event.nativeEvent} />;

// @ts-expect-error The application renders processing UI outside the player.
<ChunkifyPlayer preparingFallback={<button>Check progress</button>} />;
// @ts-expect-error The application renders failure UI outside the player.
<ChunkifyPlayer failedFallback="Unavailable" />;
// @ts-expect-error The application renders expiration UI outside the player.
<ChunkifyPlayer expiredFallback={null} />;
