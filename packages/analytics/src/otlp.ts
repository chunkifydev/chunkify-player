import type { AnalyticsDestination, ChunkifyPlayerAnalyticsEvent } from "./core.js";
import { createHttpAdapter, type HttpAdapterOptions } from "./http.js";

type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpValue[] } }
  | { kvlistValue: { values: OtlpAttribute[] } }
  // An empty AnyValue: OTLP's null, used inside arrays and key-value lists.
  | Record<string, never>;

interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

/**
 * Event fields measured in fractions (rates, ratios, seconds) are always doubles: encoding 1 as an integer
 * and 1.5 as a double would split one field across two attribute types. Counts, bytes, pixels and
 * milliseconds stay integers when whole. Values inside `custom` keep their natural type.
 */
const fractionalField = /(?:^|_)(?:rate|ratio|seconds)$/;

function isFractionalField(path: readonly string[]): boolean {
  return path[0] !== "custom" && fractionalField.test(path.at(-1) ?? "");
}

function toOtlpValue(value: unknown, path: readonly string[], nested: boolean): OtlpValue | null {
  // Top-level unavailable values are omitted; nested ones stay as empty values so their key is kept,
  // for example `language` on a subtitles-off entry.
  if (value == null) return nested ? {} : null;
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return nested ? {} : null;
    if (isFractionalField(path)) return { doubleValue: value };
    return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    // Array items keep their field's path: `start_seconds` inside `played_ranges` is still a field name.
    return { arrayValue: { values: value.map((item) => toOtlpValue(item, path, true))
      .filter((item): item is OtlpValue => item !== null) } };
  }
  if (typeof value === "object") return { kvlistValue: { values: toOtlpAttributes(value, path) } };
  return null;
}

function toOtlpAttributes(record: object, parent: readonly string[] = []): OtlpAttribute[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const encoded = toOtlpValue(value, [...parent, key], parent.length > 0);
    return encoded === null ? [] : [{ key, value: encoded }];
  });
}

function toOtlpLogRequest(event: ChunkifyPlayerAnalyticsEvent, attributes: object) {
  const occurredAtMs = Date.parse(event.occurred_at);
  if (!Number.isFinite(occurredAtMs)) throw new TypeError("OTLP adapter requires a valid occurred_at timestamp.");

  return {
    resourceLogs: [{
      scopeLogs: [{
        scope: { name: "@chunkify/player-analytics", version: event.sdk_version },
        logRecords: [{
          timeUnixNano: String(BigInt(occurredAtMs) * 1_000_000n),
          eventName: event.event_name,
          attributes: toOtlpAttributes(attributes),
        }],
      }],
    }],
  };
}

export interface OtlpAdapterOptions extends Pick<HttpAdapterOptions, "headers" | "retry"> {
  mapAttributes?: (event: ChunkifyPlayerAnalyticsEvent) => object;
}

/** Send each analytics event as an OTLP/HTTP JSON log record to a customer gateway. */
export function createOtlpAdapter(
  endpoint: string,
  options: OtlpAdapterOptions = {},
): AnalyticsDestination {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("OTLP adapter options must be an object.");
  }
  const mapAttributes = options.mapAttributes === undefined ? (event: ChunkifyPlayerAnalyticsEvent) => event : options.mapAttributes;
  if (typeof mapAttributes !== "function") throw new TypeError("OTLP attribute mapper must be a function.");
  return createHttpAdapter(endpoint, {
    headers: options.headers,
    retry: options.retry,
    mapEvent(event) {
      const attributes = mapAttributes(event);
      if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
        throw new TypeError("OTLP attribute mapper must return an object.");
      }
      return toOtlpLogRequest(event, attributes);
    },
  });
}
