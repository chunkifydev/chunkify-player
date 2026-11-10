import { attachAnalytics, type AnalyticsCustomDimensions, type AnalyticsCustomValues, type AnalyticsOptions,
  type AnalyticsSession } from "./core.js";
import { attachPlayerAnalytics, type MediaPlayerHost } from "./player.js";

export type MonitorSession = Pick<AnalyticsSession, "startAttempt" | "sourceChanged" | "destroy">;

/** Start analytics for a video element or a Chunkify Player. */
export function monitor<Custom extends AnalyticsCustomValues<Custom> = AnalyticsCustomDimensions>(
  target: HTMLVideoElement | MediaPlayerHost, options: AnalyticsOptions<Custom>): MonitorSession {
  const view = target?.ownerDocument?.defaultView;
  if (view && target instanceof view.HTMLVideoElement) return attachAnalytics(target, options);
  if (view && target instanceof view.HTMLElement
    && target.localName === "chunkify-player" && "media" in target) {
    return attachPlayerAnalytics(target as MediaPlayerHost, options);
  }
  throw new TypeError("Analytics supports a <video> or <chunkify-player> element.");
}
