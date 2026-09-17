const sdkVersion = "0.0.0";

export type TelemetryEndReason = "ended" | "destroyed" | "source_changed" | "page_exit";
export interface ViewMetrics {
  media_duration_seconds: number | null;
  startup_time_ms: number | null;
  playing_time_ms: number;
}
export interface ChunkifyPlayerTelemetryEvent {
  schema_version: 1;
  event_name: "chunkify.video.view_started" | "chunkify.video.view_ended";
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

  function emit(current: View, event_name: ChunkifyPlayerTelemetryEvent["event_name"], reason: TelemetryEndReason | null = null) {
    const event: ChunkifyPlayerTelemetryEvent = {
      schema_version: 1, event_name, event_id: crypto.randomUUID(), sequence: ++current.sequence,
      occurred_at: new Date().toISOString(), view_id: current.id, asset_id: assetId,
      sdk_name: "@chunkify/player-telemetry", sdk_version: sdkVersion,
      connector_name: "html-media", connector_version: sdkVersion,
      player_name: null, player_version: null, delivery_hostname: current.hostname,
      environment, viewer_id: viewerId, reason,
      metrics: { media_duration_seconds: current.duration, startup_time_ms: current.startup, playing_time_ms: current.playing },
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
      playing: 0, playingSince: null, duration: duration(media), hostname: deliveryHostname(media), source: media.src || media.currentSrc,
      // NETWORK_IDLE (1) and NETWORK_LOADING (2) already have a selected resource.
      resourceStarted: media.readyState > 0 || media.networkState === 1 || media.networkState === 2 };
    emit(view, "chunkify.video.view_started");
  }
  function stopPlaying() {
    if (!view || view.playingSince === null) return;
    view.playing += performance.now() - view.playingSince;
    view.playingSince = null;
  }
  function playing() {
    if (!view || !wantsPlay || seeking) return;
    const now = performance.now();
    view.resourceStarted = true;
    view.startup ??= now - view.startedAt;
    view.playingSince ??= now;
  }
  function finish(reason: TelemetryEndReason) {
    if (!view) return;
    const current = view;
    stopPlaying();
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
    play: startAttempt, playing, waiting: stopPlaying, error: stopPlaying,
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
    pause() { stopPlaying(); wantsPlay = false; },
    seeking() { stopPlaying(); seeking = true; },
    seeked() { seeking = false; },
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
