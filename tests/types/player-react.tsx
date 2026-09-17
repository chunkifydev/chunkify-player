import { createRef } from "react";
import { ChunkifyPlayer, type ChunkifyPlayerRef } from "@chunkify/player-react";

const ref = createRef<ChunkifyPlayerRef>();
<ChunkifyPlayer ref={ref} status="ready" src="/master.m3u8" assetId="asset-123"
  poster={null} thumbnails={undefined} credentials="include" autoPlay muted loop playsInline controls
  className="video" style={{ width: "100%" }} aria-label="Product video" />;
<ChunkifyPlayer status="preparing" src={null} />;
<ChunkifyPlayer status="failed" />;
<ChunkifyPlayer status="expired" />;
<ChunkifyPlayer src={undefined} />;
const media: HTMLVideoElement | undefined = ref.current?.media;
void media;
// @ts-expect-error A ready player must have a source.
<ChunkifyPlayer status="ready" />;
// @ts-expect-error A ready player cannot have a null source.
<ChunkifyPlayer status="ready" src={null} />;
// @ts-expect-error Unsupported engine.
<ChunkifyPlayer player="videojs" />;
// @ts-expect-error Only include or an omitted credentials option is supported.
<ChunkifyPlayer credentials="omit" />;
