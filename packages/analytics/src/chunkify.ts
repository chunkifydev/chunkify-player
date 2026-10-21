import type { AnalyticsDestination, ChunkifyPlayerAnalyticsEvent } from "./core.js";
import { createHttpAdapter } from "./http.js";
import { createBrowserContextReader } from "./browser-context.js";

/** Reported browser environment, separate from the core playback event schema. */
export interface BrowserContext {
  schema_version: 1;
  user_agent: string | null;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  os_version: string | null;
  device_type: "desktop" | "mobile" | "tablet" | "unknown";
  device_family: string | null;
  language: string | null;
  language_prefix: string | null;
  timezone: string | null;
  /** UTC minus local time, matching Date.getTimezoneOffset(). */
  timezone_offset_minutes: number | null;
  screen_width_px: number | null;
  screen_height_px: number | null;
  viewport_width_px: number | null;
  viewport_height_px: number | null;
  pixel_ratio: number | null;
}

export type ChunkifyCollectorEvent = ChunkifyPlayerAnalyticsEvent & { browser_context?: BrowserContext };

export interface ChunkifyAdapterOptions {
  /** The collector's public write-only ingest key. */
  ingestKey: string;
  /** Collect browser context for this destination. Defaults to true. */
  collectBrowserContext?: boolean;
  /** Retry temporary failures at most twice. Defaults to true. */
  retry?: boolean;
}

/** Send complete analytics events to the full native collector endpoint, normally /v1/events. */
export function createChunkifyAdapter(endpoint: string, options: ChunkifyAdapterOptions): AnalyticsDestination {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      typeof options.ingestKey !== "string" || !options.ingestKey.trim()) {
    throw new TypeError("Chunkify adapter requires a public ingest key.");
  }
  if (options.collectBrowserContext !== undefined && typeof options.collectBrowserContext !== "boolean") {
    throw new TypeError("Chunkify browser-context option must be a boolean.");
  }
  const readContext = options.collectBrowserContext === false ? () => undefined : createBrowserContextReader();
  return createHttpAdapter(endpoint, {
    retry: options.retry === undefined ? true : options.retry,
    headers: { "X-Chunkify-Ingest-Key": options.ingestKey },
    mapEvent(event): ChunkifyCollectorEvent {
      const context = readContext();
      return context ? { ...event, browser_context: context } : event;
    },
  });
}
