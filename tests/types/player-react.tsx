import { createRef } from "react";
import { ChunkifyPlayer, type ChunkifyPlayerRef } from "@chunkify/player-react";

const ref = createRef<ChunkifyPlayerRef>();
<ChunkifyPlayer ref={ref} src="/master.m3u8" poster={null} preload="metadata"
  crossOrigin="anonymous" credentials="include" autoPlay muted loop playsInline controls
  noAutoSeekToLive
  primaryColor="#700cd4" secondaryColor="#bb1111" accentColor="#cf2626"
  className="video" style={{ width: "100%" }} aria-label="Product video" />;
<ChunkifyPlayer src={null} />;
<ChunkifyPlayer />;
<ChunkifyPlayer src="/master.m3u8" controls>
  <track default kind="captions" src="/captions.vtt" srcLang="en" label="English" />
</ChunkifyPlayer>;

const media: HTMLVideoElement | undefined = ref.current?.media;
void media;

<ChunkifyPlayer onPlay={(event) => {
  const video: HTMLVideoElement = event.currentTarget.media;
  void video;
}} />;

<ChunkifyPlayer onPlaybackError={(event) => {
  console.log(event.detail.code, event.detail.engine);
}} />;
