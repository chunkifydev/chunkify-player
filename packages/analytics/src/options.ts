import type { AnalyticsCustomDimensions, AnalyticsOptions } from "./core.js";
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

/** Limits of the `custom` option, matching the collector. */
export const maxCustomKeys = 10;
const customKeyPattern = /^[a-z0-9_]{1,40}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  // A null prototype's parent check also accepts plain objects from another realm, such as an iframe.
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function isCustomValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string") return value.length > 0 && codePointLength(value) <= maxIdentityLength;
  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Validate the `custom` option and return a frozen copy, or null when it is absent, null or empty. The copy
 * is built from the same property reads that were validated.
 */
export function customDimensions(custom: unknown): AnalyticsCustomDimensions | null {
  // Like the other optional fields, null means "not specified".
  if (custom == null) return null;
  if (!isPlainObject(custom)) throw new TypeError("Analytics custom must be a plain object.");
  const keys = Reflect.ownKeys(custom);
  const copy: Record<string, string | number | boolean> = {};
  if (keys.length > maxCustomKeys) throw new TypeError(`Analytics custom must have at most ${maxCustomKeys} keys.`);
  for (const key of keys) {
    if (typeof key !== "string" || !customKeyPattern.test(key)) {
      // The key itself is not echoed: errors are often forwarded to error trackers.
      throw new TypeError(`Analytics custom keys must match ${customKeyPattern.source}.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(custom, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || !isCustomValue(descriptor.value)) {
      throw new TypeError(`Analytics custom.${key} must be a string of 1 to ${maxIdentityLength} characters, ` +
        "a finite number, or a boolean.");
    }
    copy[key] = descriptor.value;
  }
  return keys.length === 0 ? null : Object.freeze(copy);
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
  customDimensions(options.custom);
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
