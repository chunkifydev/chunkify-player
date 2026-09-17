const sdkVersion = "0.0.0";

export type TelemetryEndReason = "ended" | "destroyed" | "source_changed" | "page_exit";
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
}
export interface ChunkifyPlayerTelemetryEvent {
  schema_version: 1;
  event_name: "chunkify.video.view_started" | "chunkify.video.view_snapshot" | "chunkify.video.view_ended";
  event_id: string;
  sequence: number;
  occurred_at: string;
  view_id: string;
  asset_id: string;
  sdk_name: "@chunkify/player-telemetry";
  sdk_version: string;
  connector_name: "html-media";
  connector_version: string;
  player_name: null;
  player_version: null;
  delivery_hostname: string | null;
  environment: string | null;
  viewer_id: string | null;
  metrics: ViewMetrics;
  reason: TelemetryEndReason | null;
}
export interface CallbackTelemetryConfig {
  provider: "callback";
  send: (event: ChunkifyPlayerTelemetryEvent) => void | Promise<void>;
  environment?: string | undefined;
  viewerId?: string | undefined;
}
export interface TelemetryOptions extends CallbackTelemetryConfig {
  assetId: string;
}
export interface TelemetrySession {
  /** Call immediately before play() to include attempts that reject before a play event. */
  startAttempt(): void;
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
  const { assetId, send, environment = null, viewerId = null } = options;
  let view: View | null = null;
  let destroyed = false;
  let wantsPlay = false;
  let seeking = false;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  function emit(current: View, event_name: ChunkifyPlayerTelemetryEvent["event_name"], reason: TelemetryEndReason | null = null) {
    const now = performance.now();
    const playingTime = current.playing + (current.playingSince === null ? 0 : now - current.playingSince);
    const rebufferDuration = current.rebufferDuration + (current.rebufferSince === null ? 0 : now - current.rebufferSince);
    const seekDuration = current.seekDuration + (current.seekSince === null ? 0 : now - current.seekSince);
    const rebufferDenominator = playingTime + rebufferDuration;
    const event: ChunkifyPlayerTelemetryEvent = {
      schema_version: 1, event_name, event_id: crypto.randomUUID(), sequence: ++current.sequence,
      occurred_at: new Date().toISOString(), view_id: current.id, asset_id: assetId,
      sdk_name: "@chunkify/player-telemetry", sdk_version: sdkVersion,
      connector_name: "html-media", connector_version: sdkVersion,
      player_name: null, player_version: null, delivery_hostname: current.hostname,
      environment, viewer_id: viewerId, reason,
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
    view = { id: crypto.randomUUID(), sequence: 0, startedAt: performance.now(), startup: null,
      playing: 0, playingSince: null,
      rebufferCount: 0, rebufferDuration: 0, rebufferSince: null,
      seekCount: 0, seekDuration: 0, seekSince: null,
      maximumPlayhead: Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0,
      nextSnapshotAt: 30000,
      duration: duration(media), hostname: deliveryHostname(media), source: media.src || media.currentSrc,
      // NETWORK_IDLE (1) and NETWORK_LOADING (2) already have a selected resource.
      resourceStarted: media.readyState > 0 || media.networkState === 1 || media.networkState === 2 };
    emit(view, "chunkify.video.view_started");
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
  function scheduleSnapshot() {
    if (!view || snapshotTimer !== null) return;
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
    error() { stopPlaying(); stopRebuffering(); stopSeeking(); seeking = false; },
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
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [name, listener] of Object.entries(listeners)) media.removeEventListener(name, listener);
      page?.removeEventListener("pagehide", pagehide);
      finish("destroyed");
    },
  };
}
