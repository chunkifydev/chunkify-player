import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChunkifyPlayer, type ChunkifyPlayerRef } from "@chunkify/player-react";
import type { PlayerEngine } from "@chunkify/player";

type AssetStatus = "ready" | "preparing" | "failed" | "expired";
const assetMessages = {
  preparing: "Your video is processing. Playback will appear when it is ready.",
  failed: "Processing failed. Try another upload.",
  expired: "This preview has expired.",
};

function App() {
  const ref = useRef<ChunkifyPlayerRef>(null);
  const [status, setStatus] = useState<AssetStatus>("ready");
  const [engine, setEngine] = useState<PlayerEngine>("auto");
  const [mounted, setMounted] = useState(true);
  const [lastEvent, setLastEvent] = useState("Waiting for media");
  const [error, setError] = useState("");

  return <>
    <h1>Chunkify Player with React</h1>
    <p>The same local clip, controlled by React props. The application checks asset status and renders processing messages before mounting the player.</p>
    <label>Playback engine <select value={engine} onChange={(event) => {
      const value = event.target.value;
      if (value === "auto" || value === "native" || value === "hlsjs") setEngine(value);
      setError("");
    }}>
      <option value="auto">Auto</option><option value="native">Native</option><option value="hlsjs">hls.js</option>
    </select></label>
    <label>Asset status <select value={status} onChange={(event) => {
      const value = event.target.value;
      if (value === "ready" || value === "preparing" || value === "failed" || value === "expired") setStatus(value);
      setError("");
    }}>
      <option value="ready">Ready</option><option value="preparing">Preparing</option>
      <option value="failed">Failed</option><option value="expired">Expired</option>
    </select></label>
    {mounted && (status === "ready" ? <ChunkifyPlayer src="/tests/fixtures/media/master.m3u8" ref={ref} player={engine}
      assetId="local-react-example" poster="/tests/fixtures/media/poster.jpg"
      thumbnails="/tests/fixtures/media/thumbnails/images.vtt" controls muted playsInline
      onLoadedMetadata={() => setLastEvent("Media ready")}
      onPlaying={() => setLastEvent("Playing")}
      onPause={() => setLastEvent("Paused")}
      onEnded={() => setLastEvent("Ended")}
      onPlaybackError={(event) => setError(event.detail.message)} /> : <p role="status">{assetMessages[status]}</p>)}
    <button disabled={!mounted || status !== "ready"} onClick={() => ref.current?.media.pause()}>Pause through ref</button>
    <button onClick={() => { setMounted(!mounted); setLastEvent(mounted ? "Player removed" : "Waiting for media"); setError(""); }}>
      {mounted ? "Unmount player" : "Mount player"}
    </button>
    <p aria-live="polite">Last event: {lastEvent}</p>
    {error && <p role="alert">{error}</p>}
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
