import type { AnalyticsOptions } from "./core.js";

/** Validate options before installing any media or engine listeners. */
export function assertAnalyticsOptions(options: AnalyticsOptions): void {
  if (typeof options.videoId !== "string" || !options.videoId.trim()) {
    throw new TypeError("Analytics requires a non-empty videoId.");
  }
  if (typeof options.send !== "function") {
    throw new TypeError("Analytics requires a send function.");
  }
  if ((options.environment !== undefined && typeof options.environment !== "string") ||
      (options.viewerId !== undefined && typeof options.viewerId !== "string")) {
    throw new TypeError("Analytics environment and viewerId must be strings when provided.");
  }
  if (options.sampleRate !== undefined &&
      (!Number.isFinite(options.sampleRate) || options.sampleRate < 0 || options.sampleRate > 1)) {
    throw new TypeError("Analytics sampleRate must be a finite number from 0 to 1.");
  }
}
