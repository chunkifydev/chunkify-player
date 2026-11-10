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

// In a `u` regex, a paired surrogate is one code point, so this matches only unpaired (lone) surrogates.
const loneSurrogate = /\p{Surrogate}/u;
const loneSurrogates = /\p{Surrogate}/gu;

/** True when the string has a lone surrogate, which JSON parsers such as the collector's reject. */
export function hasLoneSurrogate(value: string): boolean {
  return loneSurrogate.test(value);
}

/** Replace lone surrogates with U+FFFD, like `String.prototype.toWellFormed()`. */
export function toWellFormed(value: string): string {
  return value.replace(loneSurrogates, "\uFFFD");
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

/** Limits of the `custom` option, from the collector's event contract. */
export const maxCustomKeys = 10;
const customKeyPattern = /^[a-z0-9_]{1,40}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  // A null prototype's parent check also accepts plain objects from another realm, such as an iframe.
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function isCustomValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string") {
    return value.length > 0 && codePointLength(value) <= maxIdentityLength && !hasLoneSurrogate(value);
  }
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
      throw new TypeError(`Analytics custom.${key} must be a string of 1 to ${maxIdentityLength} characters ` +
        "(without lone surrogates), a finite number, or a boolean.");
    }
    // defineProperty keeps a "__proto__" key, which an assignment would treat as the prototype.
    Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true });
  }
  return keys.length === 0 ? null : Object.freeze(copy);
}

/** Options as monitors receive them: `custom` is checked at runtime, so any value is accepted here. */
export type AnalyticsOptionsInput = Omit<AnalyticsOptions, "custom"> & { custom?: unknown };

/** Options after validation: a frozen copy with `custom` validated, copied, and null when unset or empty. */
export type FixedAnalyticsOptions = Readonly<Omit<AnalyticsOptions, "custom">> &
  { readonly custom: AnalyticsCustomDimensions | null };

const fixedOptions = new WeakSet<object>();

/**
 * Validate options and return a frozen copy, before installing any media or engine listeners. Each field
 * is read once. Monitors that start a new session on a media change reuse the copy, so every session uses
 * the values given at startup even if the caller later changes its objects. A copy is returned as is.
 */
export function fixedAnalyticsOptions(options: AnalyticsOptionsInput): FixedAnalyticsOptions {
  if (fixedOptions.has(options)) return options as FixedAnalyticsOptions;
  // Listing every option key is required here, so adding an option without copying it fails to compile.
  const { custom, ...copy }: { [Key in keyof Required<AnalyticsOptionsInput>]: AnalyticsOptionsInput[Key] } = {
    videoId: options.videoId, videoTitle: options.videoTitle, destinations: options.destinations,
    environment: options.environment, userId: options.userId, persistViewerId: options.persistViewerId,
    custom: options.custom, snapshotIntervalMs: options.snapshotIntervalMs, includeEvents: options.includeEvents,
  };
  assertAnalyticsOptions(copy);
  const fixed: FixedAnalyticsOptions = Object.freeze({
    ...copy,
    destinations: Object.freeze([...copy.destinations]),
    includeEvents: copy.includeEvents && Object.freeze([...copy.includeEvents]),
    custom: customDimensions(custom),
  });
  fixedOptions.add(fixed);
  return fixed;
}

function assertAnalyticsOptions(options: Omit<AnalyticsOptions, "custom">): void {
  if (typeof options.videoId !== "string" || !options.videoId.trim()) {
    throw new TypeError("Analytics requires a non-empty videoId.");
  }
  // The collector's JSON parser rejects a whole event that contains a lone surrogate.
  for (const [name, value] of [["videoId", options.videoId], ["environment", options.environment],
    ["userId", options.userId]] as const) {
    if (typeof value === "string" && hasLoneSurrogate(value)) {
      throw new TypeError(`Analytics ${name} must not contain lone surrogates.`);
    }
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
