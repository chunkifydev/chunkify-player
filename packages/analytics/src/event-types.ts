export const analyticsEventTypes = [
  "view_started", "view_snapshot", "playback_error", "view_ended",
  "playback_state_changed", "rendition_changed",
] as const;

export type AnalyticsEventType = (typeof analyticsEventTypes)[number];
