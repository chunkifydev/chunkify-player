import type { AnalyticsPlaybackStateEvent, AnalyticsRenditionEvent, AnalyticsSeekEvent, AnalyticsViewEvent,
  ChunkifyPlayerAnalyticsEvent } from "./core.js";

type EventField = keyof AnalyticsViewEvent | keyof AnalyticsPlaybackStateEvent | keyof AnalyticsRenditionEvent |
  keyof AnalyticsSeekEvent;
type FieldSelector = EventField | ((event: ChunkifyPlayerAnalyticsEvent) => unknown);
type EventFieldValue<Key extends EventField> = ChunkifyPlayerAnalyticsEvent extends infer Event
  ? Event extends unknown ? Key extends keyof Event ? Event[Key] : undefined : never
  : never;
type SelectedValue<Selector> = Selector extends EventField
  ? EventFieldValue<Selector>
  : Selector extends (event: ChunkifyPlayerAnalyticsEvent) => infer Value ? Value : never;

/** Select, rename, or calculate fields for a destination without changing the source event. */
export function createEventMapper<const Fields extends Record<string, FieldSelector>>(fields: Fields):
  (event: ChunkifyPlayerAnalyticsEvent) => { [Name in keyof Fields]: SelectedValue<Fields[Name]> } {
  const entries = Object.entries(fields);
  return (event) => Object.fromEntries(entries.flatMap(([name, source]) => {
    if (typeof source !== "function" && !(source in event)) return [];
    const value = typeof source === "function" ? source(event) : event[source as keyof typeof event];
    return value === undefined ? [] : [[name, value]];
  })) as { [Name in keyof Fields]: SelectedValue<Fields[Name]> };
}
