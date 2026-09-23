import { attachTelemetry, type TelemetryOptions, type TelemetrySession } from "./core.js";
import { attachPlayerTelemetry, type MediaPlayerHost } from "./player.js";

export type MonitorSession = Pick<TelemetrySession, "startAttempt" | "sourceChanged" | "destroy">;

/** Start telemetry for a video element or a Chunkify Player. */
export function monitor(target: HTMLVideoElement | MediaPlayerHost, options: TelemetryOptions): MonitorSession {
  const view = target?.ownerDocument?.defaultView;
  if (view && target instanceof view.HTMLVideoElement) return attachTelemetry(target, options);
  if (view && target instanceof view.HTMLElement
    && target.localName === "chunkify-player" && "media" in target) {
    return attachPlayerTelemetry(target as MediaPlayerHost, options);
  }
  throw new TypeError("Telemetry supports a <video> or <chunkify-player> element.");
}
