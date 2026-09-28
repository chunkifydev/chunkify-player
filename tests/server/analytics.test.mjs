import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("analytics imports without a DOM and reports its package version", async () => {
  const { attachAnalytics } = await import("@chunkify/analytics");
  const pkg = JSON.parse(await readFile(new URL("../../packages/analytics/package.json", import.meta.url)));
  // HTML media is the external boundary. EventTarget suffices to inspect an
  // explicitly started attempt without constructing a browser DOM in Node.
  const media = Object.assign(new EventTarget(), { duration: NaN, src: "", currentSrc: "", ownerDocument: { defaultView: null } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "asset-node", destinations: [{ send: (event) => { events.push(event); } }] });
  assert.equal(events.length, 0);
  session.startAttempt();
  session.destroy();
  assert.equal(events.length, 3);
  assert.equal(events[0].sdk_version, pkg.version);
  assert.equal(events[0].connector_version, pkg.version);
});

test("event mapper selects, renames, and calculates fields without changing the source event", async () => {
  const { attachAnalytics, createEventMapper } = await import("@chunkify/analytics");
  const media = Object.assign(new EventTarget(), { duration: NaN, src: "", currentSrc: "", ownerDocument: { defaultView: null } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "asset-map", destinations: [{ send: (event) => { events.push(event); } }] });
  session.startAttempt();
  session.destroy();

  const mapEvent = createEventMapper({
    videoId: "video_id",
    eventName: "event_name",
    playtimeSeconds: (event) => event.playing_time_ms === undefined ? undefined : event.playing_time_ms / 1000,
    unavailable: "media_duration_seconds",
  });
  const event = events.find((record) => record.event_name === "chunkify.video.view_ended");
  const mapped = mapEvent(event);
  assert.deepEqual(mapped, {
    videoId: "asset-map",
    eventName: "chunkify.video.view_ended",
    playtimeSeconds: 0,
    unavailable: null,
  });
  assert.equal(event.video_id, "asset-map");
  assert.equal(Object.hasOwn(event, "videoId"), false);
  assert.notEqual(mapped, event);

  const stateSession = attachAnalytics(media, { videoId: "asset-map",
    destinations: [{ send(record) { events.push(record); } }] });
  media.dispatchEvent(new Event("play"));
  media.dispatchEvent(new Event("playing"));
  const stateChange = events.find((record) => record.event_name === "chunkify.video.playback_state_changed");
  assert.deepEqual(mapEvent(stateChange), {
    videoId: "asset-map",
    eventName: "chunkify.video.playback_state_changed",
  });
  stateSession.destroy();
});

test("one failing destination does not prevent other destinations receiving the view", async () => {
  const { attachAnalytics } = await import("@chunkify/analytics");
  const media = Object.assign(new EventTarget(), { duration: NaN, src: "", currentSrc: "", ownerDocument: { defaultView: null } });
  const delivered = [];
  const session = attachAnalytics(media, {
    videoId: "asset-fanout",
    destinations: [
      { send() { throw new Error("first destination failed"); } },
      { send(event) { delivered.push(event.event_name); } },
      { send() { return Promise.reject(new Error("third destination failed")); } },
    ],
  });
  session.startAttempt();
  session.destroy();
  assert.deepEqual(delivered, ["chunkify.video.view_started", "chunkify.video.playback_state_changed",
    "chunkify.video.view_ended"]);
});
