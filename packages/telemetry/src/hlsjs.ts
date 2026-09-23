import type Hls from "hls.js";
import type {
  AudioTrackLoadedData, ErrorData, FragLoadedData, LevelLoadedData,
  LevelSwitchedData, LoaderStats, ManifestLoadedData, SubtitleTrackLoadedData,
} from "hls.js";
import { attachTelemetry, type TelemetryConnector, type TelemetryConnectorError,
  type TelemetryConnectorSnapshot, type TelemetryOptions, type TelemetrySession } from "./core.js";

export interface HlsJsTelemetryConnector extends TelemetryConnector {
  destroy(): void;
}

/** Observe an hls.js instance without changing its playback configuration. */
export function createHlsJsConnector(hls: Hls): HlsJsTelemetryConnector {
  const HlsClass = hls.constructor as typeof Hls;
  const snapshot: TelemetryConnectorSnapshot = {
    renditionWidth: null, renditionHeight: null, renditionCodec: null, renditionBitrate: null,
    renditionSwitchCount: 0, deliveryRequestCount: 0, deliveryTransferredBytes: 0,
    deliveryDurationMs: 0,
  };
  const seenStats = new WeakSet<object>();
  const errorListeners = new Set<(error: TelemetryConnectorError) => void>();
  let selectedLevel: number | null = null;
  let destroyed = false;

  const selectLevel = (level: number) => {
    const rendition = hls.levels[level];
    if (!rendition) return;
    if (selectedLevel !== null && selectedLevel !== level) snapshot.renditionSwitchCount++;
    selectedLevel = level;
    snapshot.renditionWidth = rendition.width || null;
    snapshot.renditionHeight = rendition.height || null;
    snapshot.renditionCodec = rendition.videoCodec || rendition.codecSet || null;
    snapshot.renditionBitrate = rendition.bitrate || null;
  };
  if (hls.currentLevel >= 0) selectLevel(hls.currentLevel);

  const recordStats = (stats: LoaderStats | null | undefined) => {
    if (!stats || seenStats.has(stats)) return;
    seenStats.add(stats);
    const bytes = Number.isFinite(stats.loaded) && stats.loaded >= 0 ? stats.loaded : 0;
    const elapsed = stats.loading.end - stats.loading.start;
    snapshot.deliveryRequestCount++;
    snapshot.deliveryTransferredBytes += bytes;
    if (Number.isFinite(elapsed) && elapsed > 0) snapshot.deliveryDurationMs += elapsed;
  };
  const onManifestLoaded = (_event: unknown, data: ManifestLoadedData) => recordStats(data.stats);
  const onLevelLoaded = (_event: unknown, data: LevelLoadedData) => recordStats(data.stats);
  const onAudioTrackLoaded = (_event: unknown, data: AudioTrackLoadedData) => recordStats(data.stats);
  const onSubtitleTrackLoaded = (_event: unknown, data: SubtitleTrackLoadedData) => recordStats(data.stats);
  const onFragLoaded = (_event: unknown, data: FragLoadedData) => recordStats(data.part?.stats ?? data.frag.stats);
  const onLevelSwitched = (_event: unknown, data: LevelSwitchedData) => selectLevel(data.level);
  const onError = (_event: unknown, data: ErrorData) => {
    if (!data.fatal) return;
    const category = data.type === HlsClass.ErrorTypes.NETWORK_ERROR ? "network"
      : data.type === HlsClass.ErrorTypes.MEDIA_ERROR || data.type === HlsClass.ErrorTypes.MUX_ERROR ? "decode"
      : data.type === HlsClass.ErrorTypes.KEY_SYSTEM_ERROR ? "unsupported" : "unknown";
    for (const listener of errorListeners) listener({ category, code: data.details, fatal: true });
  };

  hls.on(HlsClass.Events.MANIFEST_LOADED, onManifestLoaded);
  hls.on(HlsClass.Events.LEVEL_LOADED, onLevelLoaded);
  hls.on(HlsClass.Events.AUDIO_TRACK_LOADED, onAudioTrackLoaded);
  hls.on(HlsClass.Events.SUBTITLE_TRACK_LOADED, onSubtitleTrackLoaded);
  hls.on(HlsClass.Events.FRAG_LOADED, onFragLoaded);
  hls.on(HlsClass.Events.LEVEL_SWITCHED, onLevelSwitched);
  hls.on(HlsClass.Events.ERROR, onError);

  return {
    name: "hls.js", version: HlsClass.version,
    playerName: "hls.js", playerVersion: HlsClass.version,
    snapshot: () => ({ ...snapshot }),
    subscribeToErrors(listener) {
      errorListeners.add(listener);
      return () => { errorListeners.delete(listener); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hls.off(HlsClass.Events.MANIFEST_LOADED, onManifestLoaded);
      hls.off(HlsClass.Events.LEVEL_LOADED, onLevelLoaded);
      hls.off(HlsClass.Events.AUDIO_TRACK_LOADED, onAudioTrackLoaded);
      hls.off(HlsClass.Events.SUBTITLE_TRACK_LOADED, onSubtitleTrackLoaded);
      hls.off(HlsClass.Events.FRAG_LOADED, onFragLoaded);
      hls.off(HlsClass.Events.LEVEL_SWITCHED, onLevelSwitched);
      hls.off(HlsClass.Events.ERROR, onError);
      errorListeners.clear();
    },
  };
}

/** Attach media telemetry and hls.js measurements to an externally managed player. */
export function attachHlsJsTelemetry(video: HTMLVideoElement, hls: Hls, options: TelemetryOptions):
  Pick<TelemetrySession, "startAttempt" | "sourceChanged" | "destroy"> {
  const session = attachTelemetry(video, options);
  let connector: HlsJsTelemetryConnector;
  try {
    connector = createHlsJsConnector(hls);
    session.setConnector(connector);
  } catch (error) {
    session.destroy();
    throw error;
  }
  let destroyed = false;
  return {
    startAttempt: () => session.startAttempt(),
    sourceChanged: () => session.sourceChanged(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      session.destroy();
      connector.destroy();
    },
  };
}
