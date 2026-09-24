import { attachTelemetry, type CallbackTelemetryConfig, type ChunkifyPlayerTelemetryEvent, type TelemetryErrorCategory } from "@chunkify/telemetry";

const video = document.createElement("video");
const destination: CallbackTelemetryConfig = {
  sampleRate: 1,
  async send(event) {
    const record: ChunkifyPlayerTelemetryEvent = event;
    const startup: number | null = record.metrics.startup_time_ms;
    const buffering: number = record.metrics.rebuffer_duration_ms;
    const completion: number | null = record.metrics.completion_ratio;
    const snapshot: boolean = record.event_name === "chunkify.video.view_snapshot";
    const frames: number | null = record.metrics.total_video_frames;
    const category: TelemetryErrorCategory | null = record.error_category;
    void startup; void buffering; void completion; void snapshot; void frames; void category;
    // @ts-expect-error Payloads do not contain raw URLs.
    record.src;
  },
};
const session = attachTelemetry(video, { ...destination, videoId: "asset-types" });
session.startAttempt();
session.destroy();
// @ts-expect-error A video identity is required.
attachTelemetry(video, destination);
// @ts-expect-error A send function is required.
attachTelemetry(video, { videoId: "asset-types" });
// @ts-expect-error Transport secrets are not accepted.
attachTelemetry(video, { ...destination, videoId: "asset-types", authorization: "secret" });
// @ts-expect-error Sample rates are numeric.
attachTelemetry(video, { ...destination, videoId: "asset-types", sampleRate: "0.5" });
