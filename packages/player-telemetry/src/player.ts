import { attachTelemetry, type TelemetryOptions, type TelemetrySession } from "./index.js";

/** The public surface needed from a player that can replace its media element. */
export interface MediaPlayerHost extends HTMLElement {
  readonly media: HTMLMediaElement;
}

/** Attach the standalone media collector to a Chunkify Player. */
export function attachPlayerTelemetry(player: MediaPlayerHost, options: TelemetryOptions): TelemetrySession {
  let media = player.media;
  let session = attachTelemetry(media, options);
  let destroyed = false;

  const onMediaChange = () => {
    const next = player.media;
    if (destroyed || next === media) return;
    session.sourceChanged();
    session.destroy();
    media = next;
    session = attachTelemetry(media, options);
  };
  player.addEventListener("mediachange", onMediaChange);

  return {
    startAttempt() { if (!destroyed) session.startAttempt(); },
    sourceChanged() { if (!destroyed) session.sourceChanged(); },
    setConnector(connector) { if (!destroyed) session.setConnector(connector); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      player.removeEventListener("mediachange", onMediaChange);
      session.destroy();
    },
  };
}
