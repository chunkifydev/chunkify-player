import type { AnalyticsOptions } from "./core.js";
import { analyticsEventTypes } from "./event-types.js";

const eventTypes = new Set<string>(analyticsEventTypes);

/** Maximum length of `userId` and `videoTitle`, in Unicode characters (code points). */
export const maxIdentityLength = 256;

function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length++;
  return length;
}

/** Keep at most `max` code points without splitting a surrogate pair. */
export function truncateCodePoints(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = 0;
  let count = 0;
  for (const char of value) {
    if (count === max) return value.slice(0, end);
    end += char.length;
    count++;
  }
  return value;
}

/** Validate options before installing any media or engine listeners. */
export function assertAnalyticsOptions(options: AnalyticsOptions): void {
  if (typeof options.videoId !== "string" || !options.videoId.trim()) {
    throw new TypeError("Analytics requires a non-empty videoId.");
  }
  if (!Array.isArray(options.destinations) || options.destinations.length === 0 ||
      !Array.from(options.destinations).every((destination) => destination && typeof destination.send === "function")) {
    throw new TypeError("Analytics requires a non-empty destinations array with send functions.");
  }
  // Options copied into nullable string event fields accept null as "not specified".
  if ((options.environment != null && typeof options.environment !== "string") ||
      (options.userId != null && typeof options.userId !== "string") ||
      (options.videoTitle != null && typeof options.videoTitle !== "string")) {
    throw new TypeError("Analytics environment, userId and videoTitle must be strings or null when provided.");
  }
  // The collector rejects empty identity strings; whitespace counts as characters, as on the server.
  if (typeof options.userId === "string" &&
      (options.userId.length === 0 || codePointLength(options.userId) > maxIdentityLength)) {
    throw new TypeError(`Analytics userId must be 1 to ${maxIdentityLength} characters.`);
  }
  if (options.persistViewerId !== undefined && typeof options.persistViewerId !== "boolean") {
    throw new TypeError("Analytics persistViewerId must be a boolean when provided.");
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
