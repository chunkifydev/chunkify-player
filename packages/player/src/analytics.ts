import { createChunkifyAdapter } from "@chunkify/player-analytics/chunkify";
import { attachPlayerAnalytics, type MediaPlayerHost } from "@chunkify/player-analytics/player";

/** Chunkify's hosted collector, used when `analytics-endpoint` is not set. */
export const defaultAnalyticsEndpoint = "https://analytics.chunkify.dev/v1/events";

export const analyticsAttributes = [
  "analytics", "analytics-ingest-key", "analytics-video-id", "analytics-endpoint",
  "analytics-video-title", "analytics-user-id", "analytics-environment", "analytics-persist-viewer-id",
] as const;

export type AnalyticsAttribute = typeof analyticsAttributes[number];

export function isAnalyticsAttribute(name: string): name is AnalyticsAttribute {
  return (analyticsAttributes as readonly string[]).includes(name);
}

interface AnalyticsConfig {
  ingestKey: string | null;
  videoId: string | null;
  endpoint: string;
  videoTitle: string | null;
  userId: string | null;
  environment: string | null;
  persistViewerId: boolean;
}

function readConfig(player: HTMLElement): AnalyticsConfig {
  // An empty attribute means "not set", as React and templates often render one.
  const text = (name: AnalyticsAttribute) => player.getAttribute(name) || null;
  return {
    ingestKey: text("analytics-ingest-key"),
    videoId: text("analytics-video-id"),
    endpoint: text("analytics-endpoint") ?? defaultAnalyticsEndpoint,
    videoTitle: text("analytics-video-title"),
    userId: text("analytics-user-id"),
    environment: text("analytics-environment"),
    persistViewerId: player.getAttribute("analytics-persist-viewer-id") !== "false",
  };
}

function warn(reason: string) {
  console.warn(`Chunkify Player analytics is off: ${reason}`);
}

/**
 * Built-in Chunkify analytics, configured by the player's `analytics-*` attributes. Analytics problems
 * are reported with console warnings and never interrupt playback.
 */
export class PlayerAnalytics {
  #player: MediaPlayerHost;
  #session: ReturnType<typeof attachPlayerAnalytics> | null = null;
  /** The configuration of the current session, or null when analytics is off. */
  #config: string | null = null;
  #scheduled = false;

  constructor(player: MediaPlayerHost) {
    this.#player = player;
  }

  /** Apply changes after the current task, so attributes set together start a single session. */
  schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#sync();
    });
  }

  /** End the session now, before the player clears its media. */
  stop() {
    this.#config = null;
    this.#end(false);
  }

  #end(sourceChanged: boolean) {
    const session = this.#session;
    this.#session = null;
    if (!session) return;
    if (sourceChanged) session.sourceChanged();
    session.destroy();
  }

  #sync() {
    const player = this.#player;
    const config = player.isConnected && player.hasAttribute("analytics") ? readConfig(player) : null;
    const key = config && JSON.stringify(config);
    if (key === this.#config) return;
    // A new video ID or destination while analytics stays on ends the current view as a source change.
    this.#end(this.#config !== null && key !== null);
    this.#config = key;
    if (!config) return;
    if (!config.ingestKey || !config.videoId) {
      warn("set both analytics-ingest-key and analytics-video-id.");
      return;
    }
    try {
      this.#session = attachPlayerAnalytics(player, {
        videoId: config.videoId,
        videoTitle: config.videoTitle,
        userId: config.userId,
        environment: config.environment,
        persistViewerId: config.persistViewerId,
        destinations: [createChunkifyAdapter(config.endpoint, { ingestKey: config.ingestKey })],
      });
    } catch (error) {
      warn(error instanceof Error ? error.message : String(error));
    }
  }
}
