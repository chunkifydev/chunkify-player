import { attachAnalytics, type AnalyticsConnector, type AnalyticsConnectorError,
  type AnalyticsConnectorSnapshot, type AnalyticsOptions, type AnalyticsRendition,
  type AnalyticsSession } from "./core.js";
import { assertAnalyticsOptions } from "./options.js";

interface ShakaMediaQuality {
  contentType?: string;
  width?: number | null;
  height?: number | null;
  codecs?: string | null;
  bandwidth?: number | null;
  frameRate?: number | null;
}

interface ShakaEvent extends Event {
  mediaQuality?: ShakaMediaQuality;
  detail?: { severity?: number; category?: number; code?: number };
  response?: { data?: ArrayBuffer | ArrayBufferView; timeMs?: number; fromCache?: boolean };
}

/** The public Shaka Player APIs used by analytics. */
export interface ShakaPlayer {
  getMediaElement(): HTMLMediaElement | null;
  getConfiguration(): { streaming: { observeQualityChanges: boolean } };
  configure(config: { streaming: { observeQualityChanges: boolean } }): boolean;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface ShakaAnalyticsConnector extends AnalyticsConnector {
  reset(): void;
  destroy(): void;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Observe Shaka's quality at the playhead, completed downloads, and critical errors. */
export function createShakaConnector(player: ShakaPlayer): ShakaAnalyticsConnector {
  const errorListeners = new Set<(error: AnalyticsConnectorError) => void>();
  const renditionListeners = new Set<(rendition: AnalyticsRendition | null) => void>();
  let rendition: AnalyticsRendition | null = null;
  let switches = 0;
  let requests = 0;
  let bytes = 0;
  let durationMs = 0;
  let bytesKnown = true;
  let durationKnown = true;
  let destroyed = false;
  const version = (player.constructor as { version?: unknown }).version;
  const playerVersion = typeof version === "string" ? version : null;

  const onQuality = (event: Event) => {
    const quality = (event as ShakaEvent).mediaQuality;
    if (quality?.contentType !== "video") return;
    const next: AnalyticsRendition = {
      width: positive(quality.width), height: positive(quality.height),
      codec: quality.codecs || null, bitrate_bps: positive(quality.bandwidth),
      frame_rate: positive(quality.frameRate),
    };
    if (rendition && (next.width !== rendition.width || next.height !== rendition.height ||
      next.codec !== rendition.codec || next.bitrate_bps !== rendition.bitrate_bps ||
      next.frame_rate !== rendition.frame_rate)) switches++;
    rendition = next;
    for (const listener of renditionListeners) listener(rendition);
  };
  const onError = (event: Event) => {
    const detail = (event as ShakaEvent).detail;
    if (detail?.severity !== 2) return;
    const category = detail.category === 1 ? "network"
      : detail.category === 2 || detail.category === 3 ? "decode"
      : detail.category === 4 || detail.category === 6 ? "unsupported" : "unknown";
    for (const listener of errorListeners) listener({
      category, code: Number.isFinite(detail.code) ? detail.code! : null, fatal: true,
    });
  };
  const onDownload = (event: Event) => {
    const response = (event as ShakaEvent).response;
    if (response?.fromCache) return;
    requests++;
    const size = response?.data?.byteLength;
    if (typeof size === "number" && Number.isFinite(size) && size >= 0) bytes += size;
    else bytesKnown = false;
    const duration = response?.timeMs;
    if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) durationMs += duration;
    else durationKnown = false;
  };
  player.addEventListener("mediaqualitychanged", onQuality);
  player.addEventListener("error", onError);
  player.addEventListener("downloadcompleted", onDownload);

  return {
    name: "shaka-player", version: playerVersion,
    playerName: "shaka-player", playerVersion,
    snapshot(): AnalyticsConnectorSnapshot {
      return {
        renditionWidth: rendition?.width ?? null,
        renditionHeight: rendition?.height ?? null,
        renditionCodec: rendition?.codec ?? null,
        renditionBitrate: rendition?.bitrate_bps ?? null,
        renditionSwitchCount: switches,
        deliveryRequestCount: requests,
        deliveryTransferredBytes: bytesKnown ? bytes : null,
        deliveryDurationMs: durationKnown ? durationMs : null,
      };
    },
    subscribeToErrors(listener) {
      errorListeners.add(listener);
      return () => { errorListeners.delete(listener); };
    },
    subscribeToRenditions(listener) {
      renditionListeners.add(listener);
      listener(rendition);
      return () => { renditionListeners.delete(listener); };
    },
    reset() {
      rendition = null;
      switches = 0;
      requests = 0;
      bytes = 0;
      durationMs = 0;
      bytesKnown = true;
      durationKnown = true;
      for (const listener of renditionListeners) listener(null);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      player.removeEventListener("mediaqualitychanged", onQuality);
      player.removeEventListener("error", onError);
      player.removeEventListener("downloadcompleted", onDownload);
      errorListeners.clear();
      renditionListeners.clear();
    },
  };
}

/** Monitor an attached Shaka Player before loading and playing content. */
export function monitorShaka(player: ShakaPlayer, options: AnalyticsOptions):
  Pick<AnalyticsSession, "startAttempt" | "sourceChanged" | "destroy"> {
  assertAnalyticsOptions(options);
  const media = player.getMediaElement();
  const Media = media?.ownerDocument?.defaultView?.HTMLMediaElement;
  if (!Media || !(media instanceof Media)) {
    throw new TypeError("Shaka analytics requires a player attached to an HTML media element.");
  }
  // Shaka only emits quality changes at the playhead when this observer is enabled.
  if (!player.getConfiguration().streaming.observeQualityChanges) {
    player.configure({ streaming: { observeQualityChanges: true } });
  }
  const session = attachAnalytics(media, options);
  const connector = createShakaConnector(player);
  session.setConnector(connector);
  let destroyed = false;
  const sourceChanged = () => {
    if (destroyed) return;
    session.sourceChanged();
    connector.reset();
  };
  const onUnloading = () => sourceChanged();
  player.addEventListener("unloading", onUnloading);
  return {
    startAttempt() { if (!destroyed) session.startAttempt(); },
    sourceChanged,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      player.removeEventListener("unloading", onUnloading);
      session.destroy();
      connector.destroy();
    },
  };
}
