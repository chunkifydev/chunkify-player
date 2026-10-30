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

test("played ranges exclude seeks and pauses, merge replays, and reset per attempt", async () => {
  const { attachAnalytics } = await import("@chunkify/analytics");
  const media = Object.assign(new EventTarget(), { duration: 100, currentTime: 0,
    seeking: false, src: "video.mp4", currentSrc: "video.mp4", ownerDocument: { defaultView: null } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "ranges", destinations: [{ send(event) { events.push(event); } }] });
  const emit = (name, position = media.currentTime) => { media.currentTime = position; media.dispatchEvent(new Event(name)); };
  emit("play"); emit("playing"); emit("timeupdate", 10); emit("pause", 12);
  emit("timeupdate", 15); // A paused position must not become watched coverage.
  emit("play"); emit("playing"); emit("timeupdate", 20);
  media.seeking = true;
  emit("timeupdate", 40); // The browser may update currentTime before dispatching seeking.
  emit("seeking"); media.seeking = false; emit("seeked"); emit("playing");
  emit("timeupdate", 50); emit("waiting", 52); emit("timeupdate", 54); emit("playing");
  emit("timeupdate", 55);
  emit("seeking", 5); emit("seeked"); emit("playing"); emit("timeupdate", 18); emit("ended");
  const end = events.at(-1);
  assert.deepEqual(end.played_ranges, [
    { start_seconds: 0, end_seconds: 20 },
    { start_seconds: 40, end_seconds: 52 },
    { start_seconds: 54, end_seconds: 55 },
  ]);
  assert.equal(end.playhead_seconds, 18);
  emit("play", 0); emit("playing"); emit("timeupdate", 3); emit("ended");
  assert.deepEqual(events.at(-1).played_ranges, [{ start_seconds: 0, end_seconds: 3 }]);
  assert.deepEqual(end.played_ranges[0], { start_seconds: 0, end_seconds: 20 });
  session.destroy();
});

test("initial rendition is emitted for each attempt at its actual media position", async () => {
  const { attachAnalytics } = await import("@chunkify/analytics");
  const media = Object.assign(new EventTarget(), { duration: 100, currentTime: 12,
    src: "video.mp4", currentSrc: "video.mp4", ownerDocument: { defaultView: null } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "initial-rendition", destinations: [{ send(event) { events.push(event); } }] });
  session.setConnector({ name: "test", version: null, playerName: null, playerVersion: null,
    snapshot: () => null, subscribeToErrors: () => () => {},
    subscribeToRenditions(listener) { listener({ width: 1280, height: 720, codec: "avc1", bitrate_bps: 2000000, frame_rate: 30 }); return () => {}; } });
  for (let i = 0; i < 2; i++) { session.startAttempt(); media.dispatchEvent(new Event("ended")); }
  const changes = events.filter((e) => e.event_name === "chunkify.video.rendition_changed");
  assert.equal(changes.length, 2);
  assert.notEqual(changes[0].view_id, changes[1].view_id);
  for (const event of changes) {
    assert.equal(event.previous_rendition_width, null);
    assert.equal(event.selected_rendition_width, 1280);
    assert.equal(event.playhead_seconds, 12);
  }
  session.destroy();
});

test("a source change clears its rendition even between attempts", async () => {
  const { attachAnalytics } = await import("@chunkify/analytics");
  const media = Object.assign(new EventTarget(), { duration: 100, currentTime: 0,
    src: "one.mp4", currentSrc: "one.mp4", ownerDocument: { defaultView: null } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "source-reset", destinations: [{ send(event) { events.push(event); } }] });
  let select;
  session.setConnector({ name: "test", version: null, playerName: null, playerVersion: null,
    snapshot: () => null, subscribeToErrors: () => () => {},
    subscribeToRenditions(listener) { select = listener; return () => {}; } });
  const low = { width: 1280, height: 720, codec: "avc1", bitrate_bps: 2000000, frame_rate: 30 };
  select(low); session.startAttempt(); session.sourceChanged(); session.startAttempt();
  const second = events.at(-1);
  assert.equal(second.event_name, "chunkify.video.view_started");
  select(low);
  assert.equal(events.at(-1).view_id, second.view_id);
  assert.equal(events.at(-1).previous_rendition_width, null);
  media.dispatchEvent(new Event("ended")); session.sourceChanged(); session.startAttempt();
  assert.equal(events.at(-1).event_name, "chunkify.video.view_started");
  session.destroy();
});

test("played range limit leaves room for final JSON and OTLP delivery", async (t) => {
  const { attachAnalytics } = await import("@chunkify/analytics");
  const { createOtlpAdapter } = await import("@chunkify/analytics/otlp");
  const media = Object.assign(new EventTarget(), { duration: 1000, currentTime: 0,
    src: "video.mp4", currentSrc: "video.mp4", ownerDocument: { defaultView: null } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "range-limit", destinations: [{ send(event) { events.push(event); } }] });
  session.startAttempt();
  const playRange = (i) => {
    media.currentTime = i * 3 + 0.123456789012345; media.dispatchEvent(new Event("seeking"));
    media.dispatchEvent(new Event("seeked")); media.dispatchEvent(new Event("playing"));
    media.currentTime += 0.987654321098765; media.dispatchEvent(new Event("timeupdate"));
    media.dispatchEvent(new Event("pause"));
    // A paused seek needs a new play intent before the next range.
    media.dispatchEvent(new Event("play"));
  };
  for (let i = 0; i < 128; i++) playRange(i);
  media.dispatchEvent(new Event("ended"));
  const end = events.at(-1);
  assert.equal(end.played_ranges.length, 128);
  assert.ok(Buffer.byteLength(JSON.stringify(end)) < 48 * 1024);
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.keepalive, true);
    assert.ok(Buffer.byteLength(init.body) < 48 * 1024);
    return new Response(null, { status: 204 });
  });
  await createOtlpAdapter("https://collector.example/v1/logs").send(end);
  session.startAttempt();
  for (let i = 0; i < 129; i++) playRange(i);
  media.dispatchEvent(new Event("ended"));
  assert.equal(events.at(-1).played_ranges, null);
  session.destroy();
});
