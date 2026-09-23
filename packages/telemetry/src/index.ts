const sdkVersion = "0.0.0";

export type TelemetryEndReason = "ended" | "destroyed" | "source_changed" | "page_exit";
export type TelemetryErrorCategory = "aborted" | "network" | "decode" | "unsupported" | "unknown";
export interface ViewMetrics {
  media_duration_seconds: number | null;
  startup_time_ms: number | null;
  playing_time_ms: number;
  rebuffer_count: number;
  rebuffer_duration_ms: number;
  rebuffer_ratio: number | null;
  seek_count: number;
  seek_duration_ms: number;
  maximum_playhead_seconds: number;
  completion_ratio: number | null;
  dropped_video_frames: number | null;
  total_video_frames: number | null;
  selected_rendition_width: number | null;
  selected_rendition_height: number | null;
  selected_rendition_codec: string | null;
  selected_rendition_bitrate_bps: number | null;
  rendition_switch_count: number | null;
  delivery_request_count: number | null;
  delivery_transferred_bytes: number | null;
  delivery_throughput_bps: number | null;
}
export interface ChunkifyPlayerTelemetryEvent {
  schema_version: 1;
  event_name: "chunkify.video.view_started" | "chunkify.video.view_snapshot" | "chunkify.video.playback_error" | "chunkify.video.view_ended";
  event_id: string;
  sequence: number;
  occurred_at: string;
  view_id: string;
  asset_id: string;
  sdk_name: "@chunkify/telemetry";
  sdk_version: string;
  connector_name: string;
  connector_version: string | null;
  player_name: string | null;
  player_version: string | null;
  delivery_hostname: string | null;
  environment: string | null;
  viewer_id: string | null;
  metrics: ViewMetrics;
  reason: TelemetryEndReason | null;
  error_category: TelemetryErrorCategory | null;
  error_code: string | number | null;
  error_fatal: boolean | null;
  error_playhead_seconds: number | null;
}
export interface CallbackTelemetryConfig {
  provider: "callback";
  send: (event: ChunkifyPlayerTelemetryEvent) => void | Promise<void>;
  environment?: string | undefined;
  viewerId?: string | undefined;
  sampleRate?: number | undefined;
}
export interface TelemetryOptions extends CallbackTelemetryConfig {
  assetId: string;
}
export interface TelemetryConnectorSnapshot {
  renditionWidth: number | null;
  renditionHeight: number | null;
  renditionCodec: string | null;
  renditionBitrate: number | null;
  renditionSwitchCount: number;
  deliveryRequestCount: number;
  deliveryTransferredBytes: number;
  deliveryDurationMs: number;
}
export interface TelemetryConnectorError {
  category: TelemetryErrorCategory;
  code: string | number | null;
  fatal: boolean;
}
export interface TelemetryConnector {
  name: string;
  version: string | null;
  playerName: string | null;
  playerVersion: string | null;
  snapshot(): TelemetryConnectorSnapshot;
  subscribeToErrors(listener: (error: TelemetryConnectorError) => void): () => void;
}
export interface TelemetrySession {
  /** Call immediately before play() to include attempts that reject before a play event. */
  startAttempt(): void;
  /** Finish the current view before its media source or playback engine is replaced. */
  sourceChanged(): void;
  /** Add or replace optional engine-specific measurements for subsequent records. */
  setConnector(connector: TelemetryConnector | null): void;
  /** End the current view, if any, and remove all telemetry listeners. Idempotent. */
  destroy(): void;
}

interface View {
  id: string;
  sequence: number;
  startedAt: number;
  startup: number | null;
  playing: number;
  playingSince: number | null;
  rebufferCount: number;
  rebufferDuration: number;
  rebufferSince: number | null;
  seekCount: number;
  seekDuration: number;
  seekSince: number | null;
  maximumPlayhead: number;
  nextSnapshotAt: number;
  duration: number | null;
  hostname: string | null;
  source: string;
  resourceStarted: boolean;
  errorEmitted: boolean;
  frameBaseline: FrameCounts | null;
  framePrevious: FrameCounts | null;
  frameMetricsValid: boolean;
  sampled: boolean;
  connectorBaseline: TelemetryConnectorSnapshot | null;
}

interface FrameCounts {
  dropped: number;
  total: number;
}

interface NormalizedError {
  category: TelemetryErrorCategory;
  code: string | number | null;
  fatal: boolean;
  playhead: number | null;
}

function finiteNonNegative(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

const emptyConnectorMetrics = {
  selected_rendition_width: null,
  selected_rendition_height: null,
  selected_rendition_codec: null,
  selected_rendition_bitrate_bps: null,
  rendition_switch_count: null,
  delivery_request_count: null,
  delivery_transferred_bytes: null,
  delivery_throughput_bps: null,
};

function connectorMetrics(connector: TelemetryConnector | null, baseline: TelemetryConnectorSnapshot | null): Pick<ViewMetrics,
  "selected_rendition_width" | "selected_rendition_height" | "selected_rendition_codec" |
  "selected_rendition_bitrate_bps" | "rendition_switch_count" | "delivery_request_count" |
  "delivery_transferred_bytes" | "delivery_throughput_bps"> {
  if (!connector || !baseline) return { ...emptyConnectorMetrics };
  let current: TelemetryConnectorSnapshot;
  try {
    current = connector.snapshot();
  } catch {
    return { ...emptyConnectorMetrics };
  }
  const switches = finiteNonNegative(current.renditionSwitchCount - baseline.renditionSwitchCount);
  const requests = finiteNonNegative(current.deliveryRequestCount - baseline.deliveryRequestCount);
  const bytes = finiteNonNegative(current.deliveryTransferredBytes - baseline.deliveryTransferredBytes);
  const deliveryDuration = finiteNonNegative(current.deliveryDurationMs - baseline.deliveryDurationMs);
  return {
    selected_rendition_width: finiteNonNegative(current.renditionWidth),
    selected_rendition_height: finiteNonNegative(current.renditionHeight),
    selected_rendition_codec: typeof current.renditionCodec === "string" && current.renditionCodec ? current.renditionCodec : null,
    selected_rendition_bitrate_bps: finiteNonNegative(current.renditionBitrate),
    rendition_switch_count: switches,
    delivery_request_count: requests,
    delivery_transferred_bytes: bytes,
    delivery_throughput_bps: bytes !== null && deliveryDuration !== null && deliveryDuration > 0
      ? bytes * 8 * 1000 / deliveryDuration : null,
  };
}

function deliveryHostname(media: HTMLMediaElement): string | null {
  try {
    const url = new URL(media.currentSrc || media.src);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}
function duration(media: HTMLMediaElement): number | null {
  return Number.isFinite(media.duration) && media.duration >= 0 ? media.duration : null;
}
function mediaErrorCategory(code: number | null): TelemetryErrorCategory {
  return code === 1 ? "aborted" : code === 2 ? "network" : code === 3 ? "decode"
    : code === 4 ? "unsupported" : "unknown";
}
function frameCounts(media: HTMLMediaElement): FrameCounts | null {
  const video = media as HTMLMediaElement & Partial<Pick<HTMLVideoElement, "getVideoPlaybackQuality">>;
  if (typeof video.getVideoPlaybackQuality === "function") {
    try {
      const quality = video.getVideoPlaybackQuality();
      if (Number.isInteger(quality.droppedVideoFrames) && quality.droppedVideoFrames >= 0 &&
          Number.isInteger(quality.totalVideoFrames) && quality.totalVideoFrames >= 0) {
        return { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames };
      }
    } catch {
      // Treat an inaccessible browser counter like an unavailable measurement.
    }
  }
  const webkit = media as HTMLMediaElement & {
    webkitDecodedFrameCount?: number;
    webkitDroppedFrameCount?: number;
  };
  if (!Number.isInteger(webkit.webkitDecodedFrameCount) || (webkit.webkitDecodedFrameCount ?? -1) < 0 ||
      !Number.isInteger(webkit.webkitDroppedFrameCount) || (webkit.webkitDroppedFrameCount ?? -1) < 0) return null;
  return { dropped: webkit.webkitDroppedFrameCount!, total: webkit.webkitDecodedFrameCount! };
}

export function attachTelemetry(media: HTMLMediaElement, options: TelemetryOptions): TelemetrySession {
  if (typeof options.assetId !== "string" || !options.assetId.trim()) {
    throw new TypeError("Telemetry requires a non-empty assetId.");
  }
  if (options.provider !== "callback" || typeof options.send !== "function") {
    throw new TypeError("Telemetry requires a callback destination with a send function.");
  }
  if ((options.environment !== undefined && typeof options.environment !== "string") ||
      (options.viewerId !== undefined && typeof options.viewerId !== "string")) {
    throw new TypeError("Telemetry environment and viewerId must be strings when provided.");
  }
  if (options.sampleRate !== undefined &&
      (!Number.isFinite(options.sampleRate) || options.sampleRate < 0 || options.sampleRate > 1)) {
    throw new TypeError("Telemetry sampleRate must be a finite number from 0 to 1.");
  }
  const { assetId, send, environment = null, viewerId = null, sampleRate = 1 } = options;
  let view: View | null = null;
  let destroyed = false;
  let wantsPlay = false;
  let seeking = false;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let connector: TelemetryConnector | null = null;
  let unsubscribeConnector: (() => void) | null = null;

  function emit(current: View, event_name: ChunkifyPlayerTelemetryEvent["event_name"], reason: TelemetryEndReason | null = null,
    error: NormalizedError | null = null) {
    if (!current.sampled) return;
    const now = performance.now();
    const playingTime = current.playing + (current.playingSince === null ? 0 : now - current.playingSince);
    const rebufferDuration = current.rebufferDuration + (current.rebufferSince === null ? 0 : now - current.rebufferSince);
    const seekDuration = current.seekDuration + (current.seekSince === null ? 0 : now - current.seekSince);
    const rebufferDenominator = playingTime + rebufferDuration;
    const frames = frameCounts(media);
    let viewFrames: FrameCounts | null = null;
    if (frames && current.frameBaseline && current.framePrevious && current.frameMetricsValid) {
      if (frames.dropped < current.framePrevious.dropped || frames.total < current.framePrevious.total) {
        current.frameMetricsValid = false;
      } else {
        viewFrames = {
          dropped: frames.dropped - current.frameBaseline.dropped,
          total: frames.total - current.frameBaseline.total,
        };
      }
    }
    if (frames) current.framePrevious = frames;
    const engineMetrics = connectorMetrics(connector, current.connectorBaseline);
    const event: ChunkifyPlayerTelemetryEvent = {
      schema_version: 1, event_name, event_id: crypto.randomUUID(), sequence: ++current.sequence,
      occurred_at: new Date().toISOString(), view_id: current.id, asset_id: assetId,
      sdk_name: "@chunkify/telemetry", sdk_version: sdkVersion,
      connector_name: connector?.name ?? "html-media", connector_version: connector?.version ?? sdkVersion,
      player_name: connector?.playerName ?? null, player_version: connector?.playerVersion ?? null,
      delivery_hostname: current.hostname,
      environment, viewer_id: viewerId, reason,
      error_category: error?.category ?? null,
      error_code: error?.code ?? null,
      error_fatal: error?.fatal ?? null,
      error_playhead_seconds: error?.playhead ?? null,
      metrics: {
        media_duration_seconds: current.duration,
        startup_time_ms: current.startup,
        playing_time_ms: playingTime,
        rebuffer_count: current.rebufferCount,
        rebuffer_duration_ms: rebufferDuration,
        rebuffer_ratio: rebufferDenominator > 0 ? rebufferDuration / rebufferDenominator : null,
        seek_count: current.seekCount,
        seek_duration_ms: seekDuration,
        maximum_playhead_seconds: current.maximumPlayhead,
        completion_ratio: current.duration === null || current.duration === 0 ? null : Math.min(1, current.maximumPlayhead / current.duration),
        dropped_video_frames: viewFrames?.dropped ?? null,
        total_video_frames: viewFrames?.total ?? null,
        ...engineMetrics,
      },
    };
    try {
      // A customer destination must not interrupt playback or telemetry cleanup.
      void Promise.resolve(send(event)).catch(() => {});
    } catch {
      // Synchronous callback failures are isolated for the same reason.
    }
  }
  function startAttempt() {
    if (destroyed) return;
    wantsPlay = true;
    if (view) return;
    const initialFrames = frameCounts(media);
    const sampled = sampleRate === 1 || (sampleRate > 0 && Math.random() < sampleRate);
    view = { id: crypto.randomUUID(), sequence: 0, startedAt: performance.now(), startup: null,
      playing: 0, playingSince: null,
      rebufferCount: 0, rebufferDuration: 0, rebufferSince: null,
      seekCount: 0, seekDuration: 0, seekSince: null,
      maximumPlayhead: Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0,
      nextSnapshotAt: 30000,
      duration: duration(media), hostname: deliveryHostname(media), source: media.src || media.currentSrc,
      // NETWORK_IDLE (1) and NETWORK_LOADING (2) already have a selected resource.
      resourceStarted: media.readyState > 0 || media.networkState === 1 || media.networkState === 2,
      errorEmitted: false, frameBaseline: initialFrames, framePrevious: initialFrames,
      frameMetricsValid: initialFrames !== null, sampled,
      connectorBaseline: connector ? safeConnectorSnapshot(connector) : null };
    emit(view, "chunkify.video.view_started");
    if (media.error) reportMediaError();
  }
  function stopPlaying() {
    if (snapshotTimer !== null) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    if (!view || view.playingSince === null) return;
    view.playing += performance.now() - view.playingSince;
    view.playingSince = null;
  }
  function stopRebuffering() {
    if (!view || view.rebufferSince === null) return;
    view.rebufferDuration += performance.now() - view.rebufferSince;
    view.rebufferSince = null;
  }
  function stopSeeking() {
    if (!view || view.seekSince === null) return;
    view.seekDuration += performance.now() - view.seekSince;
    view.seekSince = null;
  }
  function updatePlaybackPosition() {
    if (!view || !Number.isFinite(media.currentTime)) return;
    view.maximumPlayhead = Math.max(view.maximumPlayhead, media.currentTime);
  }
  function reportMediaError() {
    if (!view || view.errorEmitted) return;
    updatePlaybackPosition();
    view.errorEmitted = true;
    const code = media.error && Number.isFinite(media.error.code) ? media.error.code : null;
    emit(view, "chunkify.video.playback_error", null, {
      category: mediaErrorCategory(code), code, fatal: true,
      playhead: Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : null,
    });
  }
  function reportConnectorError(error: TelemetryConnectorError) {
    if (!view || view.errorEmitted) return;
    if (error.fatal) {
      stopPlaying();
      stopRebuffering();
      stopSeeking();
      seeking = false;
      wantsPlay = false;
    }
    updatePlaybackPosition();
    view.errorEmitted = true;
    emit(view, "chunkify.video.playback_error", null, {
      category: error.category,
      code: typeof error.code === "string" || typeof error.code === "number" ? error.code : null,
      fatal: Boolean(error.fatal),
      playhead: Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : null,
    });
  }
  function setConnector(next: TelemetryConnector | null) {
    if (destroyed) return;
    const previousUnsubscribe = unsubscribeConnector;
    unsubscribeConnector = null;
    try { previousUnsubscribe?.(); } catch {}
    if (destroyed) return;
    connector = next;
    if (view) view.connectorBaseline = connector ? safeConnectorSnapshot(connector) : null;
    if (connector) {
      let unsubscribe: (() => void) | null = null;
      try { unsubscribe = connector.subscribeToErrors(reportConnectorError); } catch {}
      if (destroyed) {
        try { unsubscribe?.(); } catch {}
        return;
      }
      unsubscribeConnector = unsubscribe;
    }
  }
  function scheduleSnapshot() {
    if (!view || !view.sampled || snapshotTimer !== null) return;
    const playingSince = view.playingSince;
    if (playingSince === null) return;
    const current = view;
    const playingTime = current.playing + performance.now() - playingSince;
    snapshotTimer = globalThis.setTimeout(() => {
      snapshotTimer = null;
      if (view !== current || current.playingSince === null) return;
      updatePlaybackPosition();
      metadata();
      emit(current, "chunkify.video.view_snapshot");
      const currentPlayingTime = current.playing + performance.now() - current.playingSince;
      const nextFutureInterval = (Math.floor(currentPlayingTime / 30000) + 1) * 30000;
      current.nextSnapshotAt = Math.max(current.nextSnapshotAt + 30000, nextFutureInterval);
      if (view === current) scheduleSnapshot();
    }, Math.max(0, current.nextSnapshotAt - playingTime));
  }
  function playing() {
    if (!view || !wantsPlay || seeking) return;
    const now = performance.now();
    view.resourceStarted = true;
    view.startup ??= now - view.startedAt;
    stopRebuffering();
    view.playingSince ??= now;
    scheduleSnapshot();
  }
  function finish(reason: TelemetryEndReason) {
    if (!view) return;
    const current = view;
    stopPlaying();
    stopRebuffering();
    stopSeeking();
    updatePlaybackPosition();
    view = null;
    wantsPlay = false;
    seeking = false;
    emit(current, "chunkify.video.view_ended", reason);
  }
  function metadata() {
    if (!view) return;
    view.duration = duration(media);
    view.hostname = deliveryHostname(media);
  }
  const listeners: Record<string, () => void> = {
    play: startAttempt, playing,
    waiting() {
      stopPlaying();
      if (view && view.startup !== null && wantsPlay && !seeking && view.rebufferSince === null) {
        view.rebufferCount++;
        view.rebufferSince = performance.now();
      }
    },
    error() {
      stopPlaying(); stopRebuffering(); stopSeeking(); seeking = false; wantsPlay = false;
      reportMediaError();
    },
    ended() { finish("ended"); },
    emptied() {
      if (!view) return;
      // A new attempt can begin after src changes but before the old resource's
      // queued emptied event arrives. That reset does not belong to the new view.
      if (view.resourceStarted || (view.source && view.source !== (media.src || media.currentSrc))) finish("source_changed");
    },
    loadstart() {
      if (!view) return;
      const source = media.src || media.currentSrc;
      if (view.source && view.source !== source) { finish("source_changed"); return; }
      // <source> selection can first expose the URL after the initial attempt.
      view.source = source;
      view.resourceStarted = true;
    },
    pause() { stopPlaying(); stopRebuffering(); wantsPlay = false; },
    seeking() {
      stopPlaying();
      stopRebuffering();
      updatePlaybackPosition();
      if (view && !seeking) { view.seekCount++; view.seekSince = performance.now(); }
      seeking = true;
    },
    seeked() { updatePlaybackPosition(); stopSeeking(); seeking = false; },
    timeupdate: updatePlaybackPosition,
    loadedmetadata: metadata, durationchange: metadata,
  };
  for (const [name, listener] of Object.entries(listeners)) media.addEventListener(name, listener);
  const page = media.ownerDocument.defaultView;
  const pagehide = () => finish("page_exit");
  page?.addEventListener("pagehide", pagehide);
  return {
    startAttempt,
    sourceChanged() { finish("source_changed"); },
    setConnector,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [name, listener] of Object.entries(listeners)) media.removeEventListener(name, listener);
      page?.removeEventListener("pagehide", pagehide);
      finish("destroyed");
      try { unsubscribeConnector?.(); } catch {}
      unsubscribeConnector = null;
      connector = null;
    },
  };
}

function safeConnectorSnapshot(connector: TelemetryConnector): TelemetryConnectorSnapshot | null {
  try { return connector.snapshot(); } catch { return null; }
}
