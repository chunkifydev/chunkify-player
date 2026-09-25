import { attachAnalytics, createEventMapper, type AnalyticsConfig, type ChunkifyPlayerAnalyticsEvent, type AnalyticsErrorCategory, type AnalyticsStartupOutcome } from "@chunkify/analytics";
import { createDatadogAdapter } from "@chunkify/analytics/datadog";
import { createHttpAdapter } from "@chunkify/analytics/http";

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
const datadog = createDatadogAdapter({ addAction(name, context) { void name; void context; } });
const http = createHttpAdapter("/api/analytics", mapEvent);
const session = attachAnalytics(video, { ...config, videoId: "asset-types", destinations: [datadog, http] });
session.startAttempt();
session.destroy();
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
