import type { AnalyticsDestination, ChunkifyPlayerAnalyticsEvent } from "./core.js";

/** The small part of an initialized Datadog RUM client needed by this adapter. */
export interface DatadogRumCompatibleClient {
  addAction(name: string, context: Record<string, unknown>): void;
}

/** Send one action per event, optionally mapping its Datadog context. */
export function createDatadogAdapter(
  client: DatadogRumCompatibleClient,
  mapEvent: (event: ChunkifyPlayerAnalyticsEvent) => Record<string, unknown> = (event) => ({ ...event }),
): AnalyticsDestination {
  if (!client || typeof client.addAction !== "function") {
    throw new TypeError("Datadog adapter requires an initialized client with addAction().");
  }
  if (typeof mapEvent !== "function") {
    throw new TypeError("Datadog event mapper must be a function.");
  }
  return {
    send(event: ChunkifyPlayerAnalyticsEvent) {
      client.addAction(event.event_name, mapEvent(event));
    },
  };
}
