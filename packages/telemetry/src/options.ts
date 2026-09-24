import type { TelemetryOptions } from "./core.js";

/** Validate options before installing any media or engine listeners. */
export function assertTelemetryOptions(options: TelemetryOptions): void {
  if (typeof options.videoId !== "string" || !options.videoId.trim()) {
    throw new TypeError("Telemetry requires a non-empty videoId.");
  }
  if (typeof options.send !== "function") {
    throw new TypeError("Telemetry requires a send function.");
  }
  if ((options.environment !== undefined && typeof options.environment !== "string") ||
      (options.viewerId !== undefined && typeof options.viewerId !== "string")) {
    throw new TypeError("Telemetry environment and viewerId must be strings when provided.");
  }
  if (options.sampleRate !== undefined &&
      (!Number.isFinite(options.sampleRate) || options.sampleRate < 0 || options.sampleRate > 1)) {
    throw new TypeError("Telemetry sampleRate must be a finite number from 0 to 1.");
  }
}
