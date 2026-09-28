import type { AnalyticsOptions } from "./core.js";
import { analyticsEventTypes } from "./event-types.js";

const eventTypes = new Set<string>(analyticsEventTypes);

/** Validate options before installing any media or engine listeners. */
export function assertAnalyticsOptions(options: AnalyticsOptions): void {
  if (typeof options.videoId !== "string" || !options.videoId.trim()) {
    throw new TypeError("Analytics requires a non-empty videoId.");
  }
  if (!Array.isArray(options.destinations) || options.destinations.length === 0 ||
      !Array.from(options.destinations).every((destination) => destination && typeof destination.send === "function")) {
    throw new TypeError("Analytics requires a non-empty destinations array with send functions.");
  }
  if ((options.environment !== undefined && typeof options.environment !== "string") ||
      (options.viewerId !== undefined && typeof options.viewerId !== "string")) {
    throw new TypeError("Analytics environment and viewerId must be strings when provided.");
  }
  if (options.snapshotIntervalMs !== undefined &&
      (!Number.isSafeInteger(options.snapshotIntervalMs) || options.snapshotIntervalMs < 1000 ||
       options.snapshotIntervalMs > 2_147_483_647)) {
    throw new TypeError("Analytics snapshotIntervalMs must be an integer from 1000 to 2147483647 ms.");
  }
  if (options.includeEvents !== undefined &&
      (!Array.isArray(options.includeEvents) || !options.includeEvents.every((event) => eventTypes.has(event)))) {
    throw new TypeError("Analytics includeEvents must be an array of supported event types.");
  }
}
