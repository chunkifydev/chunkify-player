import { attachAnalytics, createEventMapper, monitorVideoJs, monitorShaka, type AnalyticsConfig, type ChunkifyPlayerAnalyticsEvent, type AnalyticsErrorCategory, type AnalyticsStartupOutcome } from "@chunkify/analytics";
import { createDatadogAdapter } from "@chunkify/analytics/datadog";
import { createHttpAdapter } from "@chunkify/analytics/http";
import { createOtlpAdapter } from "@chunkify/analytics/otlp";
import { createPostHogAdapter } from "@chunkify/analytics/posthog";
import { createChunkifyAdapter, type ChunkifyCollectorEvent } from "@chunkify/analytics/chunkify";

const mapEvent = createEventMapper({
  videoId: "video_id",
  playtimeSeconds: (event) => event.playing_time_ms === undefined ? undefined : event.playing_time_ms / 1000,
});
const mapped = mapEvent({} as ChunkifyPlayerAnalyticsEvent);
const mappedVideoId: string = mapped.videoId;
const mappedPlaytime: number | undefined = mapped.playtimeSeconds;
void mappedVideoId; void mappedPlaytime;

const video = document.createElement("video");
const config: AnalyticsConfig = {
  snapshotIntervalMs: 10000,
  includeEvents: ["view_started", "view_ended"],
  destinations: [{ async send(event) {
    const record: ChunkifyPlayerAnalyticsEvent = event;
    if (record.event_name === "chunkify.video.playback_state_changed") {
      const state: string = record.to_state;
      void state;
      return;
    }
    if (record.event_name === "chunkify.video.rendition_changed") {
      const height: number | null = record.selected_rendition_height;
      void height;
      return;
    }
    if (record.event_name === "chunkify.video.seek_completed") {
      const outcome: "resumed" | "paused" | "interrupted" = record.seek_outcome;
      const startedAt: string = record.seek_started_at;
      const lastSeekedAt: string | null = record.last_seeked_at;
      const resumedAt: string | null = record.playback_resumed_at;
      const state: string = record.state_after_seek;
      void outcome; void startedAt; void lastSeekedAt; void resumedAt; void state;
      return;
    }
    const startup: number | null = record.startup_time_ms;
    const firstFrame: number | null = record.first_video_frame_time_ms;
    const buffering: number = record.rebuffer_duration_ms;
    const progress: number | null = record.furthest_progress_ratio;
    const videoWidth: number | null = record.media_width_px;
    const snapshot: boolean = record.event_name === "chunkify.video.view_snapshot";
    const frames: number | null = record.total_video_frames;
    const category: AnalyticsErrorCategory | null = record.error_category;
    const outcome: AnalyticsStartupOutcome | null = record.startup_outcome;
    void startup; void firstFrame; void buffering; void progress; void videoWidth;
    void snapshot; void frames; void category; void outcome;
    // @ts-expect-error Measurements are top-level in the event contract.
    record.metrics;
    // @ts-expect-error Payloads do not contain raw URLs.
    record.src;
  } }],
};
const datadog = createDatadogAdapter({ addAction(name, context) { void name; void context; } }, mapEvent);
const posthog = createPostHogAdapter({ capture(name, properties) { void name; void properties; } }, mapEvent);
const http = createHttpAdapter("/api/analytics", { mapEvent, headers: { "X-Chunkify-Ingest-Key": "public-key" } });
const otlp = createOtlpAdapter("https://collector.example.com/v1/logs");
const chunkify = createChunkifyAdapter("https://collector.example.com/v1/events", { ingestKey: "public-key" });
createChunkifyAdapter("/v1/events", { ingestKey: "public-key", collectBrowserContext: false });
function readCollectorContext(event: ChunkifyCollectorEvent) {
  const device: "desktop" | "mobile" | "tablet" | "unknown" | undefined = event.browser_context?.device_type;
  void device;
}
void readCollectorContext;
// @ts-expect-error A public ingest key is required.
createChunkifyAdapter("/v1/events", {});
// @ts-expect-error Browser collection is a boolean option.
createChunkifyAdapter("/v1/events", { ingestKey: "key", collectBrowserContext: "yes" });
const mappedOtlp = createOtlpAdapter("https://collector.example.com/v1/logs", { mapAttributes: mapEvent, headers: { "X-Chunkify-Ingest-Key": "public-key" } });
const session = attachAnalytics(video, { ...config, videoId: "asset-types", destinations: [datadog, posthog, http, otlp, chunkify] });
void mappedOtlp;
session.startAttempt();
session.destroy();
const videoJsMedia = document.createElement("hlsjs-video") as HTMLElement & { readonly src: string };
const videoJsSession = monitorVideoJs(videoJsMedia, { videoId: "videojs-types", destinations: [http] });
videoJsSession.destroy();
const shakaPlayer = {
  getMediaElement: () => video,
  getConfiguration: () => ({ streaming: { observeQualityChanges: true } }),
  configure: (_config: { streaming: { observeQualityChanges: boolean } }) => true,
  addEventListener(_type: string, _listener: (event: Event) => void) {},
  removeEventListener(_type: string, _listener: (event: Event) => void) {},
};
const shakaSession = monitorShaka(shakaPlayer, { videoId: "shaka-types", destinations: [http] });
shakaSession.destroy();
// @ts-expect-error A video identity is required.
attachAnalytics(video, config);
// @ts-expect-error At least one destination is required.
attachAnalytics(video, { videoId: "asset-types" });
// @ts-expect-error Transport secrets are not accepted.
attachAnalytics(video, { ...config, videoId: "asset-types", authorization: "secret" });
// @ts-expect-error Snapshot intervals are numeric.
attachAnalytics(video, { ...config, videoId: "asset-types", snapshotIntervalMs: "10000" });
// @ts-expect-error Event names are from the supported set.
attachAnalytics(video, { ...config, videoId: "asset-types", includeEvents: ["unknown"] });
