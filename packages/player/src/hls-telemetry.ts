import type Hls from "hls.js";
import type {
  AudioTrackLoadedData,
  ErrorData,
  FragLoadedData,
  LevelLoadedData,
  LevelSwitchingData,
  LoaderStats,
  ManifestLoadedData,
  SubtitleTrackLoadedData,
} from "hls.js";
import type {
  TelemetryConnector,
  TelemetryConnectorError,
  TelemetryConnectorSnapshot,
} from "@chunkify/player-telemetry";

export interface HlsTelemetryConnector extends TelemetryConnector {
  destroy(): void;
}

export function createHlsTelemetryConnector(hls: Hls, HlsClass: typeof Hls): HlsTelemetryConnector {
  const snapshot: TelemetryConnectorSnapshot = {
    renditionWidth: null,
    renditionHeight: null,
    renditionCodec: null,
    renditionBitrate: null,
    renditionSwitchCount: 0,
    deliveryRequestCount: 0,
    deliveryTransferredBytes: 0,
    deliveryDurationMs: 0,
  };
  const seenStats = new WeakSet<object>();
  const errorListeners = new Set<(error: TelemetryConnectorError) => void>();
  let selectedLevel: number | null = null;

  const selectLevel = (level: number, data: {
    width: number;
    height: number;
    videoCodec?: string | undefined;
    codecSet: string;
    bitrate: number;
  }) => {
    if (selectedLevel !== null && selectedLevel !== level) snapshot.renditionSwitchCount++;
    selectedLevel = level;
    snapshot.renditionWidth = data.width || null;
    snapshot.renditionHeight = data.height || null;
    snapshot.renditionCodec = data.videoCodec || data.codecSet || null;
    snapshot.renditionBitrate = data.bitrate || null;
  };
  const initialLevel = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
  const initialRendition = hls.levels[initialLevel];
  if (initialRendition) selectLevel(initialLevel, initialRendition);

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
  const onLevelSwitching = (_event: unknown, data: LevelSwitchingData) => {
    selectLevel(data.level, data);
  };
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
  hls.on(HlsClass.Events.LEVEL_SWITCHING, onLevelSwitching);
  hls.on(HlsClass.Events.ERROR, onError);

  return {
    name: "hls.js",
    version: HlsClass.version,
    playerName: "hls.js",
    playerVersion: HlsClass.version,
    snapshot: () => ({ ...snapshot }),
    subscribeToErrors(listener) {
      errorListeners.add(listener);
      return () => { errorListeners.delete(listener); };
    },
    destroy() {
      hls.off(HlsClass.Events.MANIFEST_LOADED, onManifestLoaded);
      hls.off(HlsClass.Events.LEVEL_LOADED, onLevelLoaded);
      hls.off(HlsClass.Events.AUDIO_TRACK_LOADED, onAudioTrackLoaded);
      hls.off(HlsClass.Events.SUBTITLE_TRACK_LOADED, onSubtitleTrackLoaded);
      hls.off(HlsClass.Events.FRAG_LOADED, onFragLoaded);
      hls.off(HlsClass.Events.LEVEL_SWITCHING, onLevelSwitching);
      hls.off(HlsClass.Events.ERROR, onError);
      errorListeners.clear();
    },
  };
}
