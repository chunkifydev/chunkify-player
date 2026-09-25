export { attachAnalytics } from "./core.js";
export type { AnalyticsEventType, AnalyticsEndReason, AnalyticsErrorCategory, AnalyticsStartupOutcome,
  RenditionPlayingTime, AnalyticsRendition, ViewMetrics, ChunkifyPlayerAnalyticsEvent,
  AnalyticsDestination, AnalyticsConfig, AnalyticsOptions, AnalyticsConnectorSnapshot,
  AnalyticsConnectorError, AnalyticsConnector, AnalyticsSession } from "./core.js";
export { createEventMapper } from "./mapper.js";
export { monitor, type MonitorSession } from "./monitor.js";
