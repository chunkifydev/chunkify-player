import { createChunkifyAdapter } from "@chunkify/player-analytics/chunkify";
import { attachPlayerAnalytics, type MediaPlayerHost } from "@chunkify/player-analytics/player";

/** Chunkify's hosted collector, used when `analytics-endpoint` is not set. Events go to its `/v1/events`. */
export const defaultAnalyticsEndpoint = "https://analytics.chunkify.dev";

export const analyticsAttributes = [
  "analytics", "analytics-ingest-key", "analytics-video-id", "analytics-endpoint",
  "analytics-video-title", "analytics-user-id", "analytics-environment", "analytics-persist-viewer-id",
] as const;

export type AnalyticsAttribute = typeof analyticsAttributes[number];

export function isAnalyticsAttribute(name: string): name is AnalyticsAttribute {
  return (analyticsAttributes as readonly string[]).includes(name);
}

/** Prefix of the attributes that set custom dimensions, such as `analytics-custom-plan="premium"`. */
export const analyticsCustomPrefix = "analytics-custom-";

/** Custom dimensions as the `analyticsCustom` property accepts them. Numbers and booleans are sent as text. */
export type PlayerAnalyticsCustom = Readonly<Record<string, string | number | boolean>>;

const customKeyPattern = /^[a-z0-9_]{1,40}$/;

/** Read the `analytics-custom-*` attributes; an empty attribute is not set. */
export function readCustom(player: HTMLElement): Record<string, string> {
  const custom: Record<string, string> = {};
  for (const name of player.getAttributeNames()) {
    const value = player.getAttribute(name);
    if (name.startsWith(analyticsCustomPrefix) && value) custom[name.slice(analyticsCustomPrefix.length)] = value;
  }
  return custom;
}

/** Replace the `analytics-custom-*` attributes, changing only those that differ. */
export function writeCustom(player: HTMLElement, custom: PlayerAnalyticsCustom | null | undefined) {
  const next = new Map<string, string>();
  for (const [key, value] of Object.entries(custom ?? {})) {
    if (value == null) continue;
    if (!customKeyPattern.test(key)) {
      // Attribute names are lowercase, so other keys could not be read back as given.
      console.warn(`Chunkify Player analytics ignores the custom key "${key}": use 1 to 40 lowercase letters, ` +
        "digits or underscores.");
      continue;
    }
    next.set(`${analyticsCustomPrefix}${key}`, String(value));
  }
  for (const name of player.getAttributeNames()) {
    if (name.startsWith(analyticsCustomPrefix) && !next.has(name)) player.removeAttribute(name);
  }
  for (const [name, value] of next) {
    if (player.getAttribute(name) !== value) player.setAttribute(name, value);
  }
}

interface AnalyticsConfig {
  /** A new source starts a new session, which reads the custom dimensions again. */
  src: string;
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
    src: player.getAttribute("src") ?? "",
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
    // A new source, video ID or destination while analytics stays on ends the current view as a source change.
    // Custom dimensions are not part of the key: a change applies from the next session, without splitting a view.
    this.#end(this.#config !== null && key !== null);
    this.#config = key;
    if (!config) return;
    if (!config.ingestKey || !config.videoId) {
      warn("set both analytics-ingest-key and analytics-video-id.");
      return;
    }
    const custom = readCustom(player);
    const attach = (withCustom: boolean) => attachPlayerAnalytics(player, {
      videoId: config.videoId!,
      videoTitle: config.videoTitle,
      userId: config.userId,
      environment: config.environment,
      persistViewerId: config.persistViewerId,
      custom: withCustom ? custom : null,
      destinations: [createChunkifyAdapter(config.endpoint, { ingestKey: config.ingestKey! })],
    });
    try {
      try {
        this.#session = attach(true);
      } catch (error) {
        if (Object.keys(custom).length === 0) throw error;
        // Invalid custom dimensions must not stop tracking: retry without them.
        this.#session = attach(false);
        console.warn("Chunkify Player analytics ignores the analytics-custom-* attributes: " +
          (error instanceof Error ? error.message : String(error)));
      }
    } catch (error) {
      warn(error instanceof Error ? error.message : String(error));
    }
  }
}
