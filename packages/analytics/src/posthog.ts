import type { AnalyticsDestination, ChunkifyPlayerAnalyticsEvent } from "./core.js";

/** The small part of an initialized PostHog browser client needed by this adapter. */
export interface PostHogCompatibleClient {
  capture(name: string, properties: Record<string, unknown>): unknown;
}

/** Send one PostHog event for each analytics event. */
export function createPostHogAdapter(
  client: PostHogCompatibleClient,
  mapEvent: (event: ChunkifyPlayerAnalyticsEvent) => Record<string, unknown> = (event) => ({ ...event }),
): AnalyticsDestination {
  if (!client || typeof client.capture !== "function") {
    throw new TypeError("PostHog adapter requires an initialized client with capture().");
  }
  if (typeof mapEvent !== "function") {
    throw new TypeError("PostHog event mapper must be a function.");
  }
  return {
    send(event: ChunkifyPlayerAnalyticsEvent) {
      client.capture(event.event_name, mapEvent(event));
    },
  };
}
