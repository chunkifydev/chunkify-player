import type { AnalyticsDestination, ChunkifyPlayerAnalyticsEvent } from "./core.js";

/** The small part of an initialized Datadog RUM client needed by this adapter. */
export interface DatadogRumCompatibleClient {
  addAction(name: string, context: Record<string, unknown>): void;
}

export function createDatadogAdapter(client: DatadogRumCompatibleClient): AnalyticsDestination {
  if (!client || typeof client.addAction !== "function") {
    throw new TypeError("Datadog adapter requires an initialized client with addAction().");
  }
  return {
    send(event: ChunkifyPlayerAnalyticsEvent) {
      client.addAction(event.event_name, { chunkify: event });
      if (event.event_name !== "chunkify.video.view_ended") return;
      for (const rendition of event.rendition_playing_time ?? []) {
        if (!rendition.width || !rendition.height || rendition.playing_time_ms <= 0) continue;
        client.addAction("chunkify.video.rendition_playing_time", {
          chunkify: {
            video_id: event.video_id,
            view_id: event.view_id,
            resolution: `${rendition.width}x${rendition.height}`,
            playing_time_ms: rendition.playing_time_ms,
          },
        });
      }
    },
  };
}
