import { attachAnalytics, createEventMapper, monitorVideoJs, monitorShaka, type AnalyticsConfig, type ChunkifyPlayerAnalyticsEvent, type AnalyticsErrorCategory, type AnalyticsStartupOutcome } from "@chunkify/analytics";
import { createDatadogAdapter } from "@chunkify/analytics/datadog";
import { createHttpAdapter } from "@chunkify/analytics/http";
import { createOtlpAdapter } from "@chunkify/analytics/otlp";
import { createPostHogAdapter } from "@chunkify/analytics/posthog";

const mapEvent = createEventMapper({
  videoId: "video_id",
  playtimeSeconds: (event) => event.playing_time_ms / 1000,
});
const mapped = mapEvent({} as ChunkifyPlayerAnalyticsEvent);
const mappedVideoId: string = mapped.videoId;
const mappedPlaytime: number = mapped.playtimeSeconds;
void mappedVideoId; void mappedPlaytime;

const video = document.createElement("video");
const config: AnalyticsConfig = {
  sampleRate: 1,
  snapshotIntervalMs: 10000,
  includeEvents: ["view_started", "view_ended"],
  destinations: [{ async send(event) {
    const record: ChunkifyPlayerAnalyticsEvent = event;
    const startup: number | null = record.startup_time_ms;
    const firstFrame: number | null = record.first_video_frame_time_ms;
    const buffering: number = record.rebuffer_duration_ms;
    const progress: number | null = record.furthest_progress_ratio;
    const videoWidth: number | null = record.video_intrinsic_width_css_px;
    const snapshot: boolean = record.event_name === "chunkify.video.view_snapshot";
    const frames: number | null = record.total_video_frames;
    const category: AnalyticsErrorCategory | null = record.error_category;
    const outcome: AnalyticsStartupOutcome | null = record.startup_outcome;
    void startup; void firstFrame; void buffering; void progress; void videoWidth;
    void snapshot; void frames; void category; void outcome;
    // @ts-expect-error Measurements are top-level in schema version 4.
    record.metrics;
    // @ts-expect-error Payloads do not contain raw URLs.
    record.src;
  } }],
};
const datadog = createDatadogAdapter({ addAction(name, context) { void name; void context; } }, mapEvent);
const posthog = createPostHogAdapter({ capture(name, properties) { void name; void properties; } }, mapEvent);
const http = createHttpAdapter("/api/analytics", mapEvent);
const otlp = createOtlpAdapter("https://collector.example.com/v1/logs");
const mappedOtlp = createOtlpAdapter("https://collector.example.com/v1/logs", mapEvent);
const session = attachAnalytics(video, { ...config, videoId: "asset-types", destinations: [datadog, posthog, http, otlp] });
void mappedOtlp;
session.startAttempt();
session.destroy();
const videoJsPlayer = {
  tech(_safety: true) { return { el: () => video }; },
  on(_type: string, _listener: () => void) {},
  off(_type: string, _listener: () => void) {},
  error() { return null; },
};
const videoJsSession = monitorVideoJs(videoJsPlayer, { videoId: "videojs-types", destinations: [http] });
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
// @ts-expect-error Sample rates are numeric.
attachAnalytics(video, { ...config, videoId: "asset-types", sampleRate: "0.5" });
// @ts-expect-error Snapshot intervals are numeric.
attachAnalytics(video, { ...config, videoId: "asset-types", snapshotIntervalMs: "10000" });
// @ts-expect-error Event names are from the supported set.
attachAnalytics(video, { ...config, videoId: "asset-types", includeEvents: ["unknown"] });
