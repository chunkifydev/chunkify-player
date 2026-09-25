import type { ChunkifyPlayerAnalyticsEvent } from "./core.js";

type EventField = keyof ChunkifyPlayerAnalyticsEvent;
type FieldSelector = EventField | ((event: ChunkifyPlayerAnalyticsEvent) => unknown);
type SelectedValue<Selector> = Selector extends EventField
  ? ChunkifyPlayerAnalyticsEvent[Selector]
  : Selector extends (event: ChunkifyPlayerAnalyticsEvent) => infer Value ? Value : never;

/** Select, rename, or calculate fields for a destination without changing the source event. */
export function createEventMapper<const Fields extends Record<string, FieldSelector>>(fields: Fields):
  (event: ChunkifyPlayerAnalyticsEvent) => { [Name in keyof Fields]: SelectedValue<Fields[Name]> } {
  const entries = Object.entries(fields);
  return (event) => Object.fromEntries(entries.map(([name, source]) => [
    name,
    typeof source === "function" ? source(event) : event[source],
  ])) as { [Name in keyof Fields]: SelectedValue<Fields[Name]> };
}
