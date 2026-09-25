export const analyticsEventTypes = ["view_started", "view_snapshot", "playback_error", "view_ended"] as const;

export type AnalyticsEventType = (typeof analyticsEventTypes)[number];
