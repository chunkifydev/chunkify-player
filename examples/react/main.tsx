import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChunkifyPlayer, type ChunkifyPlayerRef } from "@chunkify/player-react";

function App() {
  const ref = useRef<ChunkifyPlayerRef>(null);
  const [source, setSource] = useState<"hls" | "mp4">("hls");
  const [lastEvent, setLastEvent] = useState("Waiting for media");

  return <>
    <h1>Chunkify Player with React</h1>
    <p>The wrapper exposes the same player through typed React props and a ref.</p>
    <label>Video source <select value={source} onChange={(event) => {
      setSource(event.target.value === "mp4" ? "mp4" : "hls");
      setLastEvent("Loading media");
    }}>
      <option value="hls">HLS</option>
      <option value="mp4">MP4</option>
    </select></label>
    <ChunkifyPlayer
      ref={ref}
      src={source === "hls" ? "/tests/fixtures/media/master.m3u8" : "/tests/fixtures/media/video.mp4"}
      poster="/tests/fixtures/media/poster.jpg"
      controls muted playsInline
      onLoadedMetadata={() => setLastEvent("Media ready")}
      onPlaying={() => setLastEvent("Playing")}
      onPause={() => setLastEvent("Paused")}
      onEnded={() => setLastEvent("Ended")}
    />
    <button onClick={() => { void ref.current?.media.play(); }}>Play through ref</button>
    <button onClick={() => ref.current?.media.pause()}>Pause through ref</button>
    <p aria-live="polite">Last event: {lastEvent}</p>
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
