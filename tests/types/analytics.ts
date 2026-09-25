import { attachAnalytics, type CallbackAnalyticsConfig, type ChunkifyPlayerAnalyticsEvent, type AnalyticsErrorCategory, type AnalyticsStartupOutcome } from "@chunkify/analytics";

const video = document.createElement("video");
const destination: CallbackAnalyticsConfig = {
  sampleRate: 1,
  snapshotIntervalMs: 10000,
  includeEvents: ["view_started", "view_ended"],
  async send(event) {
    const record: ChunkifyPlayerAnalyticsEvent = event;
    const startup: number | null = record.metrics.startup_time_ms;
    const firstFrame: number | null = record.metrics.first_video_frame_time_ms;
    const buffering: number = record.metrics.rebuffer_duration_ms;
    const completion: number | null = record.metrics.completion_ratio;
    const snapshot: boolean = record.event_name === "chunkify.video.view_snapshot";
    const frames: number | null = record.metrics.total_video_frames;
    const category: AnalyticsErrorCategory | null = record.error_category;
    const outcome: AnalyticsStartupOutcome | null = record.startup_outcome;
    void startup; void firstFrame; void buffering; void completion; void snapshot; void frames; void category; void outcome;
    // @ts-expect-error Payloads do not contain raw URLs.
    record.src;
  },
};
const session = attachAnalytics(video, { ...destination, videoId: "asset-types" });
session.startAttempt();
session.destroy();
// @ts-expect-error A video identity is required.
attachAnalytics(video, destination);
// @ts-expect-error A send function is required.
attachAnalytics(video, { videoId: "asset-types" });
// @ts-expect-error Transport secrets are not accepted.
attachAnalytics(video, { ...destination, videoId: "asset-types", authorization: "secret" });
// @ts-expect-error Sample rates are numeric.
attachAnalytics(video, { ...destination, videoId: "asset-types", sampleRate: "0.5" });
// @ts-expect-error Snapshot intervals are numeric.
attachAnalytics(video, { ...destination, videoId: "asset-types", snapshotIntervalMs: "10000" });
// @ts-expect-error Event names are from the supported set.
attachAnalytics(video, { ...destination, videoId: "asset-types", includeEvents: ["unknown"] });
