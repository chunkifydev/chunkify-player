import { attachAnalytics, type AnalyticsConnector, type AnalyticsConnectorError,
  type AnalyticsConnectorSnapshot, type AnalyticsOptions, type AnalyticsSession } from "./core.js";
import { assertAnalyticsOptions } from "./options.js";

interface VideoJsQualityLevel {
  width?: number;
  height?: number;
  bitrate?: number;
  codecs?: string;
}

interface VideoJsQualityLevels {
  readonly selectedIndex: number;
  readonly [index: number]: VideoJsQualityLevel;
  on(type: "change", listener: () => void): void;
  off(type: "change", listener: () => void): void;
}

/** The Video.js APIs used by analytics. Quality levels are optional. */
export interface VideoJsPlayer {
  tech(safety: true): { el(): Element } | undefined;
  on(type: string, listener: () => void): void;
  off(type: string, listener: () => void): void;
  error(): { code?: number } | null | undefined;
  qualityLevels?(): VideoJsQualityLevels;
}

export interface VideoJsAnalyticsConnector extends AnalyticsConnector {
  destroy(): void;
}

/** Read Video.js errors and, when present, its quality-levels plugin. */
export function createVideoJsConnector(player: VideoJsPlayer): VideoJsAnalyticsConnector {
  const qualityLevels = player.qualityLevels?.() ?? null;
  const snapshot: AnalyticsConnectorSnapshot = {
    renditionWidth: null, renditionHeight: null, renditionCodec: null, renditionBitrate: null,
    renditionSwitchCount: qualityLevels ? 0 : null,
    deliveryRequestCount: null, deliveryTransferredBytes: null, deliveryDurationMs: null,
  };
  const errorListeners = new Set<(error: AnalyticsConnectorError) => void>();
  let selectedIndex: number | null = null;
  let destroyed = false;

  const onQualityChange = () => {
    const index = qualityLevels?.selectedIndex ?? -1;
    const level = index >= 0 ? qualityLevels?.[index] : null;
    if (!level) {
      selectedIndex = null;
      snapshot.renditionWidth = null;
      snapshot.renditionHeight = null;
      snapshot.renditionCodec = null;
      snapshot.renditionBitrate = null;
      return;
    }
    if (selectedIndex !== null && selectedIndex !== index) {
      snapshot.renditionSwitchCount = (snapshot.renditionSwitchCount ?? 0) + 1;
    }
    selectedIndex = index;
    snapshot.renditionWidth = Number.isFinite(level.width) && (level.width ?? 0) > 0 ? level.width! : null;
    snapshot.renditionHeight = Number.isFinite(level.height) && (level.height ?? 0) > 0 ? level.height! : null;
    snapshot.renditionCodec = level.codecs || null;
    snapshot.renditionBitrate = Number.isFinite(level.bitrate) && (level.bitrate ?? 0) > 0 ? level.bitrate! : null;
  };
  const onError = () => {
    const code = player.error()?.code;
    const category = code === 1 ? "aborted" : code === 2 ? "network"
      : code === 3 ? "decode" : code === 4 ? "unsupported" : "unknown";
    for (const listener of errorListeners) listener({ category, code: Number.isFinite(code) ? code! : null, fatal: true });
  };
  onQualityChange();
  qualityLevels?.on("change", onQualityChange);
  player.on("error", onError);

  return {
    name: "video.js", version: null,
    playerName: "video.js", playerVersion: null,
    snapshot: () => ({ ...snapshot }),
    subscribeToErrors(listener) {
      errorListeners.add(listener);
      return () => { errorListeners.delete(listener); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      qualityLevels?.off("change", onQualityChange);
      player.off("error", onError);
      errorListeners.clear();
    },
  };
}

function html5Video(player: VideoJsPlayer): HTMLVideoElement {
  const element = player.tech(true)?.el();
  const Video = element?.ownerDocument?.defaultView?.HTMLVideoElement;
  if (!Video || !(element instanceof Video)) {
    throw new TypeError("Video.js analytics requires a ready player using its HTML5 video Tech.");
  }
  return element as HTMLVideoElement;
}

/** Monitor a ready Video.js player using its HTML5 video Tech. */
export function monitorVideoJs(player: VideoJsPlayer, options: AnalyticsOptions):
  Pick<AnalyticsSession, "startAttempt" | "sourceChanged" | "destroy"> {
  assertAnalyticsOptions(options);
  const media = html5Video(player);
  const session = attachAnalytics(media, options);
  const connector = createVideoJsConnector(player);
  session.setConnector(connector);
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    player.off("dispose", destroy);
    session.destroy();
    connector.destroy();
  };
  player.on("dispose", destroy);
  return {
    startAttempt() { if (!destroyed) session.startAttempt(); },
    sourceChanged() { if (!destroyed) session.sourceChanged(); },
    destroy,
  };
}
