import { analyticsEventTypes, type AnalyticsEventType } from "./event-types.js";
import { assertAnalyticsOptions } from "./options.js";

export type { AnalyticsEventType } from "./event-types.js";

const sdkVersion = "0.0.0";

export type AnalyticsEndReason = "ended" | "destroyed" | "source_changed" | "page_exit";
export type AnalyticsErrorCategory = "aborted" | "network" | "decode" | "unsupported" | "unknown";
export type AnalyticsStartupOutcome = "started" | "failed_before_start" | "ended_before_start";
export interface RenditionPlayingTime {
  width: number | null;
  height: number | null;
  codec: string | null;
  bitrate_bps: number | null;
  frame_rate: number | null;
  playing_time_ms: number;
}
export type AnalyticsRendition = Omit<RenditionPlayingTime, "playing_time_ms">;
export interface ViewMetrics {
  media_duration_seconds: number | null;
  startup_time_ms: number | null;
  first_video_frame_time_ms: number | null;
  playing_time_ms: number;
  rebuffer_count: number;
  rebuffer_duration_ms: number;
  rebuffer_ratio: number | null;
  seek_count: number;
  seek_duration_ms: number;
  maximum_playhead_seconds: number;
  furthest_progress_ratio: number | null;
  video_intrinsic_width_css_px: number | null;
  video_intrinsic_height_css_px: number | null;
  dropped_video_frames: number | null;
  total_video_frames: number | null;
  selected_rendition_width: number | null;
  selected_rendition_height: number | null;
  selected_rendition_codec: string | null;
  selected_rendition_bitrate_bps: number | null;
  rendition_switch_count: number | null;
  rendition_playing_time: RenditionPlayingTime[] | null;
  delivery_request_count: number | null;
  delivery_transferred_bytes: number | null;
  delivery_throughput_bps: number | null;
}
export interface ChunkifyPlayerAnalyticsEvent extends ViewMetrics {
  schema_version: 4;
  event_name: `chunkify.video.${AnalyticsEventType}`;
  event_id: string;
  sequence: number;
  occurred_at: string;
  view_id: string;
  video_id: string;
  sdk_name: "@chunkify/analytics";
  sdk_version: string;
  connector_name: string;
  connector_version: string | null;
  player_name: string | null;
  player_version: string | null;
  delivery_hostname: string | null;
  environment: string | null;
  viewer_id: string | null;
  reason: AnalyticsEndReason | null;
  startup_outcome: AnalyticsStartupOutcome | null;
  error_category: AnalyticsErrorCategory | null;
  error_code: string | number | null;
  error_fatal: boolean | null;
  error_playhead_seconds: number | null;
}
export interface AnalyticsDestination {
  send(event: ChunkifyPlayerAnalyticsEvent): void | Promise<void>;
}
export interface AnalyticsConfig {
  destinations: readonly AnalyticsDestination[];
  environment?: string | undefined;
  viewerId?: string | undefined;
  sampleRate?: number | undefined;
  /** Active playing time between cumulative snapshots. Defaults to 30,000 ms. */
  snapshotIntervalMs?: number | undefined;
  /** Event types passed to destinations. Defaults to all four types. */
  includeEvents?: readonly AnalyticsEventType[] | undefined;
}
export interface AnalyticsOptions extends AnalyticsConfig {
  videoId: string;
}
export interface AnalyticsConnectorSnapshot {
  renditionWidth: number | null;
  renditionHeight: number | null;
  renditionCodec: string | null;
  renditionBitrate: number | null;
  renditionSwitchCount: number | null;
  deliveryRequestCount: number | null;
  deliveryTransferredBytes: number | null;
  deliveryDurationMs: number | null;
}
export interface AnalyticsConnectorError {
  category: AnalyticsErrorCategory;
  code: string | number | null;
  fatal: boolean;
}
export interface AnalyticsConnector {
  name: string;
  version: string | null;
  playerName: string | null;
  playerVersion: string | null;
  snapshot(): AnalyticsConnectorSnapshot;
  subscribeToErrors(listener: (error: AnalyticsConnectorError) => void): () => void;
  /** Fires with the rendition currently reaching playback, including the initial selection. */
  subscribeToRenditions?(listener: (rendition: AnalyticsRendition | null) => void): () => void;
}
export interface AnalyticsSession {
  /** Call immediately before play() to include attempts that reject before a play event. */
  startAttempt(): void;
  /** Finish the current view before its media source or playback engine is replaced. */
  sourceChanged(): void;
  /** Add or replace optional engine-specific measurements for subsequent records. */
  setConnector(connector: AnalyticsConnector | null): void;
  /** End the current view, if any, and remove all analytics listeners. Idempotent. */
  destroy(): void;
}

interface View {
  id: string;
  sequence: number;
  startedAt: number;
  startup: number | null;
  firstVideoFrame: number | null;
  frameCallbackId: number | null;
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
  intrinsicVideoWidth: number | null;
  intrinsicVideoHeight: number | null;
  hostname: string | null;
  source: string;
  resourceStarted: boolean;
  errorEmitted: boolean;
  fatalErrorBeforeStart: boolean;
  frameBaseline: FrameCounts | null;
  framePrevious: FrameCounts | null;
  frameMetricsValid: boolean;
  sampled: boolean;
  connectorBaseline: AnalyticsConnectorSnapshot | null;
  renditionTrackingAvailable: boolean;
  renditionTimes: Map<string, RenditionPlayingTime>;
  activeRendition: AnalyticsRendition | null;
  activeRenditionSince: number | null;
}

interface FrameCounts {
  dropped: number;
  total: number;
}

interface NormalizedError {
  category: AnalyticsErrorCategory;
  code: string | number | null;
  fatal: boolean;
  playhead: number | null;
}

function finiteNonNegative(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeDelta(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null ? null : finiteNonNegative(current - baseline);
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function intrinsicVideoSize(media: HTMLMediaElement): { width: number | null; height: number | null } {
  try {
    const customMedia = media as HTMLMediaElement & { nativeEl?: Element | null };
    const video = (customMedia.nativeEl?.localName === "video" ? customMedia.nativeEl : media) as
      HTMLMediaElement & Partial<Pick<HTMLVideoElement, "videoWidth" | "videoHeight">>;
    const width = finitePositive(video.videoWidth);
    const height = finitePositive(video.videoHeight);
    return width !== null && height !== null ? { width, height } : { width: null, height: null };
  } catch {
    return { width: null, height: null };
  }
}

function normalizedRendition(rendition: AnalyticsRendition | null): AnalyticsRendition | null {
  if (!rendition) return null;
  const result = {
    width: finiteNonNegative(rendition.width),
    height: finiteNonNegative(rendition.height),
    codec: typeof rendition.codec === "string" && rendition.codec ? rendition.codec : null,
    bitrate_bps: finiteNonNegative(rendition.bitrate_bps),
    frame_rate: finiteNonNegative(rendition.frame_rate),
  };
  return Object.values(result).every((value) => value === null) ? null : result;
}

function renditionKey(rendition: AnalyticsRendition): string {
  return JSON.stringify([rendition.width, rendition.height, rendition.codec, rendition.bitrate_bps, rendition.frame_rate]);
}

function renditionPlayingTime(current: View, now: number): RenditionPlayingTime[] | null {
  if (!current.renditionTrackingAvailable) return null;
  const times = new Map([...current.renditionTimes].map(([key, value]) => [key, { ...value }]));
  if (current.activeRendition && current.activeRenditionSince !== null) {
    const key = renditionKey(current.activeRendition);
    const entry = times.get(key) ?? { ...current.activeRendition, playing_time_ms: 0 };
    entry.playing_time_ms += Math.max(0, now - current.activeRenditionSince);
    times.set(key, entry);
  }
  return [...times.values()];
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

function connectorMetrics(connector: AnalyticsConnector | null, baseline: AnalyticsConnectorSnapshot | null): Pick<ViewMetrics,
  "selected_rendition_width" | "selected_rendition_height" | "selected_rendition_codec" |
  "selected_rendition_bitrate_bps" | "rendition_switch_count" | "delivery_request_count" |
  "delivery_transferred_bytes" | "delivery_throughput_bps"> {
  if (!connector || !baseline) return { ...emptyConnectorMetrics };
  let current: AnalyticsConnectorSnapshot;
  try {
    current = connector.snapshot();
  } catch {
    return { ...emptyConnectorMetrics };
  }
  const switches = nonNegativeDelta(current.renditionSwitchCount, baseline.renditionSwitchCount);
  const requests = nonNegativeDelta(current.deliveryRequestCount, baseline.deliveryRequestCount);
  const bytes = nonNegativeDelta(current.deliveryTransferredBytes, baseline.deliveryTransferredBytes);
  const deliveryDuration = nonNegativeDelta(current.deliveryDurationMs, baseline.deliveryDurationMs);
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
function mediaErrorCategory(code: number | null): AnalyticsErrorCategory {
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

export function attachAnalytics(media: HTMLMediaElement, options: AnalyticsOptions): AnalyticsSession {
  assertAnalyticsOptions(options);
  const frameVideo = media as HTMLMediaElement & Partial<Pick<HTMLVideoElement,
    "requestVideoFrameCallback" | "cancelVideoFrameCallback">>;
  const { videoId, environment = null, viewerId = null, sampleRate = 1, snapshotIntervalMs = 30000 } = options;
  const destinations = [...options.destinations];
  const includedEvents = new Set((options.includeEvents ?? analyticsEventTypes)
    .map((event) => `chunkify.video.${event}`));
  let view: View | null = null;
  let destroyed = false;
  let wantsPlay = false;
  let seeking = false;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let connector: AnalyticsConnector | null = null;
  let unsubscribeConnector: (() => void) | null = null;
  let unsubscribeRenditions: (() => void) | null = null;
  let selectedRendition: AnalyticsRendition | null = null;

  function refreshIntrinsicVideoSize(current: View) {
    const size = intrinsicVideoSize(media);
    if (size.width === null || size.height === null) return;
    current.intrinsicVideoWidth = size.width;
    current.intrinsicVideoHeight = size.height;
  }

  function cancelFirstVideoFrame(current: View) {
    if (current.frameCallbackId === null) return;
    const callbackId = current.frameCallbackId;
    current.frameCallbackId = null;
    try { frameVideo.cancelVideoFrameCallback?.(callbackId); } catch {}
  }

  function observeFirstVideoFrame(current: View) {
    if (typeof frameVideo.requestVideoFrameCallback !== "function" ||
        typeof frameVideo.cancelVideoFrameCallback !== "function") return;
    try {
      current.frameCallbackId = frameVideo.requestVideoFrameCallback((observedAt) => {
        if (current.frameCallbackId === null) return;
        current.frameCallbackId = null;
        if (view !== current) return;
        // WebKit can report a presentationTime outside performance.now()'s clock.
        if (!Number.isFinite(observedAt) || observedAt < current.startedAt) return;
        current.firstVideoFrame = observedAt - current.startedAt;
      });
    } catch {
      // Frame timing is optional; an inaccessible browser API leaves it unavailable.
    }
  }

  function closeActiveRendition(now: number) {
    if (!view || !view.activeRendition || view.activeRenditionSince === null) return;
    const key = renditionKey(view.activeRendition);
    const entry = view.renditionTimes.get(key) ?? { ...view.activeRendition, playing_time_ms: 0 };
    entry.playing_time_ms += Math.max(0, now - view.activeRenditionSince);
    view.renditionTimes.set(key, entry);
    view.activeRendition = null;
    view.activeRenditionSince = null;
  }

  function onRenditionChanged(rendition: AnalyticsRendition | null) {
    const now = performance.now();
    closeActiveRendition(now);
    selectedRendition = normalizedRendition(rendition);
    if (view && view.playingSince !== null && selectedRendition) {
      view.activeRendition = selectedRendition;
      view.activeRenditionSince = now;
    }
  }

  function emit(current: View, event_name: ChunkifyPlayerAnalyticsEvent["event_name"], reason: AnalyticsEndReason | null = null,
    error: NormalizedError | null = null) {
    if (!current.sampled || !includedEvents.has(event_name)) return;
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
    let startupOutcome: AnalyticsStartupOutcome | null = null;
    if (event_name === "chunkify.video.view_ended") {
      if (current.startup !== null) startupOutcome = "started";
      else if (current.fatalErrorBeforeStart) startupOutcome = "failed_before_start";
      else startupOutcome = "ended_before_start";
    }
    refreshIntrinsicVideoSize(current);
    const event: ChunkifyPlayerAnalyticsEvent = {
      schema_version: 4, event_name, event_id: crypto.randomUUID(), sequence: ++current.sequence,
      occurred_at: new Date().toISOString(), view_id: current.id, video_id: videoId,
      sdk_name: "@chunkify/analytics", sdk_version: sdkVersion,
      connector_name: connector?.name ?? "html-media", connector_version: connector?.version ?? sdkVersion,
      player_name: connector?.playerName ?? null, player_version: connector?.playerVersion ?? null,
      delivery_hostname: current.hostname,
      environment, viewer_id: viewerId, reason,
      startup_outcome: startupOutcome,
      error_category: error?.category ?? null,
      error_code: error?.code ?? null,
      error_fatal: error?.fatal ?? null,
      error_playhead_seconds: error?.playhead ?? null,
      media_duration_seconds: current.duration,
      startup_time_ms: current.startup,
      first_video_frame_time_ms: current.firstVideoFrame,
      playing_time_ms: playingTime,
      rebuffer_count: current.rebufferCount,
      rebuffer_duration_ms: rebufferDuration,
      rebuffer_ratio: rebufferDenominator > 0 ? rebufferDuration / rebufferDenominator : null,
      seek_count: current.seekCount,
      seek_duration_ms: seekDuration,
      maximum_playhead_seconds: current.maximumPlayhead,
      furthest_progress_ratio: current.duration === null || current.duration === 0 ? null : Math.min(1, current.maximumPlayhead / current.duration),
      video_intrinsic_width_css_px: current.intrinsicVideoWidth,
      video_intrinsic_height_css_px: current.intrinsicVideoHeight,
      dropped_video_frames: viewFrames?.dropped ?? null,
      total_video_frames: viewFrames?.total ?? null,
      ...engineMetrics,
      rendition_playing_time: renditionPlayingTime(current, now),
    };
    for (const destination of destinations) {
      try {
        // A failing destination must not interrupt playback or another destination.
        void Promise.resolve(destination.send(event)).catch(() => {});
      } catch {
        // Synchronous delivery failures are isolated for the same reason.
      }
    }
  }
  function startAttempt() {
    if (destroyed) return;
    wantsPlay = true;
    if (view) return;
    const initialFrames = frameCounts(media);
    const initialVideoSize = intrinsicVideoSize(media);
    const sampled = sampleRate === 1 || (sampleRate > 0 && Math.random() < sampleRate);
    const current: View = { id: crypto.randomUUID(), sequence: 0, startedAt: performance.now(),
      startup: null, firstVideoFrame: null, frameCallbackId: null,
      playing: 0, playingSince: null,
      rebufferCount: 0, rebufferDuration: 0, rebufferSince: null,
      seekCount: 0, seekDuration: 0, seekSince: null,
      maximumPlayhead: Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0,
      nextSnapshotAt: snapshotIntervalMs,
      duration: duration(media),
      intrinsicVideoWidth: initialVideoSize.width, intrinsicVideoHeight: initialVideoSize.height,
      hostname: deliveryHostname(media), source: media.src || media.currentSrc,
      // NETWORK_IDLE (1) and NETWORK_LOADING (2) already have a selected resource.
      resourceStarted: media.readyState > 0 || media.networkState === 1 || media.networkState === 2,
      errorEmitted: false, fatalErrorBeforeStart: false,
      frameBaseline: initialFrames, framePrevious: initialFrames,
      frameMetricsValid: initialFrames !== null, sampled,
      connectorBaseline: connector ? safeConnectorSnapshot(connector) : null,
      renditionTrackingAvailable: Boolean(connector?.subscribeToRenditions),
      renditionTimes: new Map(), activeRendition: null, activeRenditionSince: null };
    view = current;
    if (sampled && includedEvents.size > 0) observeFirstVideoFrame(current);
    emit(current, "chunkify.video.view_started");
    if (view !== current) return;
    if (media.error) reportMediaError();
  }
  function stopPlaying() {
    if (snapshotTimer !== null) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    if (!view || view.playingSince === null) return;
    const now = performance.now();
    closeActiveRendition(now);
    view.playing += now - view.playingSince;
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
    if (!view) return;
    refreshIntrinsicVideoSize(view);
    if (!Number.isFinite(media.currentTime)) return;
    view.maximumPlayhead = Math.max(view.maximumPlayhead, media.currentTime);
  }
  function reportMediaError() {
    if (!view) return;
    cancelFirstVideoFrame(view);
    if (view.startup === null) view.fatalErrorBeforeStart = true;
    if (view.errorEmitted) return;
    updatePlaybackPosition();
    view.errorEmitted = true;
    const code = media.error && Number.isFinite(media.error.code) ? media.error.code : null;
    emit(view, "chunkify.video.playback_error", null, {
      category: mediaErrorCategory(code), code, fatal: true,
      playhead: Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : null,
    });
  }
  function reportConnectorError(error: AnalyticsConnectorError) {
    if (!view) return;
    if (error.fatal) cancelFirstVideoFrame(view);
    if (error.fatal && view.startup === null) view.fatalErrorBeforeStart = true;
    if (view.errorEmitted) return;
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
  function setConnector(next: AnalyticsConnector | null) {
    if (destroyed) return;
    const previousUnsubscribe = unsubscribeConnector;
    const previousRenditionUnsubscribe = unsubscribeRenditions;
    unsubscribeConnector = null;
    unsubscribeRenditions = null;
    try { previousUnsubscribe?.(); } catch {}
    try { previousRenditionUnsubscribe?.(); } catch {}
    if (destroyed) return;
    onRenditionChanged(null);
    connector = next;
    if (view) view.connectorBaseline = connector ? safeConnectorSnapshot(connector) : null;
    if (view && connector?.subscribeToRenditions) view.renditionTrackingAvailable = true;
    if (connector) {
      let unsubscribe: (() => void) | null = null;
      try { unsubscribe = connector.subscribeToErrors(reportConnectorError); } catch {}
      let unsubscribeRendition: (() => void) | null = null;
      try { unsubscribeRendition = connector.subscribeToRenditions?.(onRenditionChanged) ?? null; } catch {}
      if (destroyed) {
        try { unsubscribe?.(); } catch {}
        try { unsubscribeRendition?.(); } catch {}
        return;
      }
      unsubscribeConnector = unsubscribe;
      unsubscribeRenditions = unsubscribeRendition;
    }
  }
  function scheduleSnapshot() {
    if (!view || !view.sampled || !includedEvents.has("chunkify.video.view_snapshot") || snapshotTimer !== null) return;
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
      const nextFutureInterval = (Math.floor(currentPlayingTime / snapshotIntervalMs) + 1) * snapshotIntervalMs;
      current.nextSnapshotAt = Math.max(current.nextSnapshotAt + snapshotIntervalMs, nextFutureInterval);
      if (view === current) scheduleSnapshot();
    }, Math.max(0, current.nextSnapshotAt - playingTime));
  }
  function playing() {
    if (!view || !wantsPlay || seeking) return;
    refreshIntrinsicVideoSize(view);
    const now = performance.now();
    view.resourceStarted = true;
    view.startup ??= now - view.startedAt;
    stopRebuffering();
    view.playingSince ??= now;
    if (view.activeRenditionSince === null && selectedRendition) {
      view.activeRendition = selectedRendition;
      view.activeRenditionSince = now;
    }
    scheduleSnapshot();
  }
  function finish(reason: AnalyticsEndReason) {
    if (!view) return;
    const current = view;
    cancelFirstVideoFrame(current);
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
    refreshIntrinsicVideoSize(view);
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
      try { unsubscribeRenditions?.(); } catch {}
      unsubscribeConnector = null;
      unsubscribeRenditions = null;
      connector = null;
    },
  };
}

function safeConnectorSnapshot(connector: AnalyticsConnector): AnalyticsConnectorSnapshot | null {
  try { return connector.snapshot(); } catch { return null; }
}
