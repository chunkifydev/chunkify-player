import type Hls from "hls.js";
import type {
  AudioTrackLoadedData, ErrorData, FragLoadedData, LevelLoadedData,
  LevelSwitchedData, LoaderStats, ManifestLoadedData, SubtitleTrackLoadedData,
} from "hls.js";
import { attachTelemetry, type TelemetryConnector, type TelemetryConnectorError,
  type TelemetryConnectorSnapshot, type TelemetryOptions, type TelemetrySession } from "./core.js";
import { assertTelemetryOptions } from "./options.js";

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

/** Follow an hls.js instance as it attaches to or detaches from media. */
export function monitorHlsJs(hls: Hls, options: TelemetryOptions):
  Pick<TelemetrySession, "startAttempt" | "sourceChanged" | "destroy"> {
  assertTelemetryOptions(options);
  const HlsClass = hls.constructor as typeof Hls;
  let media: HTMLMediaElement | null = null;
  let session: TelemetrySession | null = null;
  let connector: HlsJsTelemetryConnector | null = null;
  let pendingAttempt = false;
  let destroyed = false;

  const releaseMedia = (sourceChanged: boolean) => {
    const previousSession = session;
    const previousConnector = connector;
    media = null;
    session = null;
    connector = null;
    if (sourceChanged) previousSession?.sourceChanged();
    previousSession?.destroy();
    previousConnector?.destroy();
  };
  const attachMedia = () => {
    const nextMedia = hls.media;
    if (destroyed || !nextMedia || nextMedia === media) return;
    if (media) releaseMedia(true);
    const nextSession = attachTelemetry(nextMedia, options);
    media = nextMedia;
    session = nextSession;
    try {
      connector = createHlsJsConnector(hls);
      nextSession.setConnector(connector);
    } catch {
      // An engine measurement failure must not prevent media playback telemetry.
    }
    if (pendingAttempt) {
      pendingAttempt = false;
      nextSession.startAttempt();
    }
  };
  const onMediaAttaching = () => attachMedia();
  const onMediaDetaching = () => releaseMedia(true);
  const onDestroying = () => destroy();
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    hls.off(HlsClass.Events.MEDIA_ATTACHING, onMediaAttaching);
    hls.off(HlsClass.Events.MEDIA_DETACHING, onMediaDetaching);
    hls.off(HlsClass.Events.DESTROYING, onDestroying);
    releaseMedia(false);
    pendingAttempt = false;
  }

  hls.on(HlsClass.Events.MEDIA_ATTACHING, onMediaAttaching);
  hls.on(HlsClass.Events.MEDIA_DETACHING, onMediaDetaching);
  hls.on(HlsClass.Events.DESTROYING, onDestroying);
  attachMedia();
  return {
    startAttempt() {
      if (destroyed) return;
      if (session) session.startAttempt();
      else pendingAttempt = true;
    },
    sourceChanged() {
      if (destroyed) return;
      pendingAttempt = false;
      session?.sourceChanged();
    },
    destroy,
  };
}
