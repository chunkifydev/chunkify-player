import { attachTelemetry, type CallbackTelemetryConfig, type ChunkifyPlayerTelemetryEvent } from "@chunkify/player-telemetry";

const video = document.createElement("video");
const destination: CallbackTelemetryConfig = {
  provider: "callback",
  async send(event) {
    const record: ChunkifyPlayerTelemetryEvent = event;
    const startup: number | null = record.metrics.startup_time_ms;
    void startup;
    // @ts-expect-error Payloads do not contain raw URLs.
    record.src;
  },
};
const session = attachTelemetry(video, { ...destination, assetId: "asset-types" });
session.startAttempt();
session.destroy();
// @ts-expect-error An asset identity is required.
attachTelemetry(video, destination);
// @ts-expect-error This slice only implements the callback destination.
attachTelemetry(video, { assetId: "asset-types", provider: "datadog", client: {} });
// @ts-expect-error Transport secrets are not accepted.
attachTelemetry(video, { ...destination, assetId: "asset-types", authorization: "secret" });
