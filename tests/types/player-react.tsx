import { createRef } from "react";
import { ChunkifyPlayer, type ChunkifyPlayerRef } from "@chunkify/player-react";

const ref = createRef<ChunkifyPlayerRef>();
<ChunkifyPlayer ref={ref} src="/master.m3u8" poster={null} preload="metadata"
  crossOrigin="anonymous" autoPlay muted loop playsInline controls
  className="video" style={{ width: "100%" }} aria-label="Product video" />;
<ChunkifyPlayer src={null} />;
<ChunkifyPlayer />;

const media: HTMLVideoElement | undefined = ref.current?.media;
void media;

<ChunkifyPlayer onPlay={(event) => {
  const video: HTMLVideoElement = event.currentTarget.media;
  void video;
}} />;
