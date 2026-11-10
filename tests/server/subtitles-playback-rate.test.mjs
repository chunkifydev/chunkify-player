import assert from "node:assert/strict";
import test from "node:test";

// HTML media is the external boundary: EventTargets stand in for the media element,
// its TextTrackList and its document, and a mocked performance.now() controls playing time.
function setup(t, { tracks = [], playbackRate = 1, includeEvents } = {}) {
  let clock = 1000;
  t.mock.method(performance, "now", () => clock);
  const textTracks = Object.assign(new EventTarget(), { length: 0 });
  const document = Object.assign(new EventTarget(), { defaultView: null, visibilityState: "visible" });
  const media = Object.assign(new EventTarget(), { duration: 100, currentTime: 0, seeking: false, paused: true,
    ended: false, playbackRate, src: "video.mp4", currentSrc: "video.mp4", textTracks, ownerDocument: document });
  const addTrack = (track) => {
    textTracks[textTracks.length] = track;
    textTracks.length++;
    textTracks.dispatchEvent(new Event("addtrack"));
    return track;
  };
  for (const track of tracks) addTrack(track);
  const events = [];
  return {
    media, events, addTrack,
    async attach() {
      const { attachAnalytics } = await import("@chunkify/player-analytics");
      return attachAnalytics(media, { videoId: "selections", snapshotIntervalMs: 2_147_483_647, includeEvents,
        destinations: [{ send(event) { events.push(event); } }] });
    },
    advance(ms) { clock += ms; media.currentTime += ms / 1000; },
    dispatch(name) { media.dispatchEvent(new Event(name)); },
    setMode(track, mode) { track.mode = mode; textTracks.dispatchEvent(new Event("change")); },
    setRate(rate) { media.playbackRate = rate; media.dispatchEvent(new Event("ratechange")); },
    snapshot() {
      document.dispatchEvent(new Event("visibilitychange"));
      return events.at(-1);
    },
    named(name) { return events.filter((event) => event.event_name === `chunkify.video.${name}`); },
  };
}

const track = (kind, language, mode = "disabled") => ({ kind, language, mode });

test("the first showing subtitle or caption track gives the normalized subtitle language", async (t) => {
  const cases = [
    [[], null],
    [[track("subtitles", "fr")], null],
    [[track("metadata", "en", "showing"), track("chapters", "en", "showing")], null],
    [[track("subtitles", "de", "hidden"), track("captions", " fr-CA ", "showing")], "fr-CA"],
    [[track("subtitles", "", "showing")], "und"],
    [[track("captions", "   ", "showing")], "und"],
    [[track("subtitles", "es", "showing"), track("captions", "it", "showing")], "es"],
    [[track("subtitles", "x".repeat(40), "showing")], "x".repeat(35)],
    [[track("subtitles", `${"a".repeat(34)}😀😀`, "showing")], `${"a".repeat(34)}😀`],
    [[track("subtitles", `${"b".repeat(34)}-cd`, "showing")], "b".repeat(34)],
  ];
  for (const [tracks, expected] of cases) {
    const fixture = setup(t, { tracks });
    const session = await fixture.attach();
    session.startAttempt();
    assert.equal(fixture.events[0].subtitle_language, expected, JSON.stringify(tracks));
    session.destroy();
  }
});

test("playback rate is rounded to 2 decimals and null outside the supported range", async (t) => {
  const cases = [[1, 1], [1.5, 1.5], [1.234, 1.23], [0.756, 0.76], [16, 16], [16.004, 16], [0.25, 0.25],
    [0.004, null], [0, null], [-1, null], [16.5, null], [Infinity, null], [NaN, null], ["2", null]];
  for (const [rate, expected] of cases) {
    const fixture = setup(t, { playbackRate: rate });
    const session = await fixture.attach();
    session.startAttempt();
    assert.equal(fixture.events[0].playback_rate, expected, String(rate));
    session.destroy();
  }
});

test("media without text tracks or a playback rate reports subtitles off and an unknown rate", async () => {
  const { attachAnalytics } = await import("@chunkify/player-analytics");
  const media = Object.assign(new EventTarget(), { duration: NaN, src: "", currentSrc: "", ownerDocument: { defaultView: null } });
  Object.defineProperty(media, "textTracks", { get() { throw new Error("unavailable"); } });
  const events = [];
  const session = attachAnalytics(media, { videoId: "bare", destinations: [{ send(event) { events.push(event); } }] });
  session.startAttempt();
  session.destroy();
  assert.deepEqual(events.filter((event) => event.event_name !== "chunkify.video.playback_state_changed")
    .map(({ subtitle_language, playback_rate, subtitle_playing_time, playback_rate_playing_time }) =>
      ({ subtitle_language, playback_rate, subtitle_playing_time, playback_rate_playing_time })), [
    { subtitle_language: null, playback_rate: null, subtitle_playing_time: undefined, playback_rate_playing_time: undefined },
    { subtitle_language: null, playback_rate: null, subtitle_playing_time: [], playback_rate_playing_time: [] },
  ]);
});

test("playing time by subtitle language and rate counts only actual playing time", async (t) => {
  const french = track("subtitles", "fr");
  const fixture = setup(t, { tracks: [french] });
  const session = await fixture.attach();
  fixture.dispatch("play");
  fixture.advance(500); // Startup is not playing time.
  fixture.dispatch("playing");
  fixture.advance(1000);
  fixture.setMode(french, "showing");
  fixture.advance(2000);
  fixture.dispatch("pause");
  fixture.setRate(1.5); // A change while paused adds no time to either value.
  fixture.advance(5000);
  fixture.dispatch("play");
  fixture.dispatch("playing");
  fixture.advance(3000);
  const snapshot = fixture.snapshot();
  assert.equal(snapshot.event_name, "chunkify.video.view_snapshot");
  assert.equal(snapshot.playing_time_ms, 6000);
  assert.equal(snapshot.subtitle_language, "fr");
  assert.equal(snapshot.playback_rate, 1.5);
  assert.deepEqual(snapshot.subtitle_playing_time, [
    { language: null, playing_time_ms: 1000 }, { language: "fr", playing_time_ms: 5000 },
  ]);
  assert.deepEqual(snapshot.playback_rate_playing_time, [
    { rate: 1, playing_time_ms: 3000 }, { rate: 1.5, playing_time_ms: 3000 },
  ]);

  fixture.dispatch("waiting");
  fixture.advance(4000); // Buffering is not playing time.
  fixture.dispatch("playing");
  fixture.dispatch("seeking");
  fixture.advance(1000); // Seeking is not playing time.
  fixture.dispatch("seeked");
  fixture.dispatch("playing");
  fixture.setMode(french, "disabled");
  fixture.advance(1000.4);
  fixture.setRate(0); // Time at an unsupported rate is not attributed to a rate.
  fixture.advance(2000);
  fixture.setRate(1.5);
  fixture.advance(500.3);
  fixture.dispatch("ended");
  const end = fixture.events.at(-1);
  assert.equal(end.event_name, "chunkify.video.view_ended");
  assert.equal(end.subtitle_language, null);
  assert.equal(end.playback_rate, 1.5);
  assert.deepEqual(end.subtitle_playing_time, [
    { language: null, playing_time_ms: 4500 }, { language: "fr", playing_time_ms: 5000 },
  ]);
  assert.deepEqual(end.playback_rate_playing_time, [
    { rate: 1, playing_time_ms: 3000 }, { rate: 1.5, playing_time_ms: 4500 },
  ]);
  for (const entry of [...end.subtitle_playing_time, ...end.playback_rate_playing_time]) {
    assert.ok(Number.isInteger(entry.playing_time_ms) && entry.playing_time_ms >= 0);
  }
  // Snapshots carry cumulative totals; the earlier one is unchanged.
  assert.deepEqual(snapshot.subtitle_playing_time.map((entry) => entry.playing_time_ms), [1000, 5000]);

  // Each view starts its own totals from the current selection.
  fixture.dispatch("play");
  fixture.dispatch("playing");
  fixture.advance(700);
  fixture.dispatch("ended");
  assert.deepEqual(fixture.events.at(-1).subtitle_playing_time, [{ language: null, playing_time_ms: 700 }]);
  assert.deepEqual(fixture.events.at(-1).playback_rate_playing_time, [{ rate: 1.5, playing_time_ms: 700 }]);
  session.destroy();
});

test("view_started reports the current selection without playing-time totals", async (t) => {
  const english = track("captions", "en");
  const fixture = setup(t, { tracks: [english], playbackRate: 2 });
  const session = await fixture.attach();
  fixture.setMode(english, "showing"); // Before the attempt: no view, so no change event.
  fixture.setRate(1.25);
  assert.equal(fixture.events.length, 0);
  session.startAttempt();
  assert.deepEqual(fixture.events.map((event) => event.event_name), ["chunkify.video.view_started"]);
  assert.equal(fixture.events[0].subtitle_language, "en");
  assert.equal(fixture.events[0].playback_rate, 1.25);
  // The breakdowns are only on snapshots and the final record, per the event contract.
  assert.equal(Object.hasOwn(fixture.events[0], "subtitle_playing_time"), false);
  assert.equal(Object.hasOwn(fixture.events[0], "playback_rate_playing_time"), false);
  session.destroy();
  assert.deepEqual(fixture.events.at(-1).subtitle_playing_time, []);
});

test("playing-time totals keep at most 32 distinct values", async (t) => {
  const fixture = setup(t);
  const session = await fixture.attach();
  fixture.dispatch("play");
  fixture.dispatch("playing");
  const rates = Array.from({ length: 34 }, (_, i) => Math.round((1 + i / 100) * 100) / 100);
  for (const rate of rates) {
    fixture.setRate(rate);
    fixture.advance(100);
  }
  const snapshot = fixture.snapshot();
  assert.equal(snapshot.playback_rate_playing_time.length, 32);
  assert.deepEqual(snapshot.playback_rate_playing_time.map((entry) => entry.rate), rates.slice(0, 32));
  assert.ok(snapshot.playback_rate_playing_time.every((entry) => entry.playing_time_ms === 100));
  // An existing value keeps accumulating after the limit is reached.
  fixture.setRate(1);
  fixture.advance(250);
  fixture.dispatch("ended");
  const end = fixture.events.at(-1);
  assert.equal(end.playback_rate_playing_time.length, 32);
  assert.deepEqual(end.playback_rate_playing_time[0], { rate: 1, playing_time_ms: 350 });
  assert.equal(end.playback_rate_playing_time.reduce((sum, entry) => sum + entry.playing_time_ms, 0), 3450);
  assert.equal(end.playing_time_ms, 3650);
  session.destroy();
});

test("subtitle languages are capped at 32 distinct values", async (t) => {
  const fixture = setup(t);
  const tracks = Array.from({ length: 33 }, (_, i) => fixture.addTrack(track("subtitles", `l${i}`)));
  const session = await fixture.attach();
  fixture.dispatch("play");
  fixture.dispatch("playing");
  fixture.advance(100); // Subtitles off is the first value.
  for (const [index, current] of tracks.entries()) {
    if (index > 0) tracks[index - 1].mode = "disabled";
    fixture.setMode(current, "showing");
    fixture.advance(100);
  }
  fixture.dispatch("ended");
  const totals = fixture.events.at(-1).subtitle_playing_time;
  assert.equal(totals.length, 32);
  assert.deepEqual(totals.map((entry) => entry.language), [null, ...tracks.slice(0, 31).map((entry) => entry.language)]);
  session.destroy();
});

test("subtitle and rate changes emit change events only when the normalized value changes", async (t) => {
  const french = track("subtitles", "fr");
  const english = track("captions", "en");
  const fixture = setup(t, { tracks: [french, english] });
  const session = await fixture.attach();
  fixture.dispatch("play");
  fixture.dispatch("playing");
  fixture.media.currentTime = 12;
  fixture.setMode(french, "showing");
  fixture.setMode(french, "showing");
  french.language = " fr ";
  fixture.setMode(french, "showing"); // Same language after trimming.
  french.mode = "disabled";
  fixture.setMode(english, "showing");
  fixture.setMode(english, "disabled");
  fixture.setRate(1.001); // Rounds to the current rate.
  fixture.setRate(2);
  fixture.setRate(2.004);
  fixture.setRate(0);
  fixture.setRate(-1); // Still unsupported, so unchanged.
  fixture.setRate(1);

  const subtitles = fixture.named("subtitle_changed");
  assert.deepEqual(subtitles.map(({ previous_subtitle_language, subtitle_language }) =>
    [previous_subtitle_language, subtitle_language]), [[null, "fr"], ["fr", "en"], ["en", null]]);
  const rates = fixture.named("playback_rate_changed");
  assert.deepEqual(rates.map(({ previous_playback_rate, playback_rate }) =>
    [previous_playback_rate, playback_rate]), [[1, 2], [2, null], [null, 1]]);

  const start = fixture.events[0];
  for (const event of [...subtitles, ...rates]) {
    assert.equal(event.playhead_seconds, 12);
    assert.equal(event.view_id, start.view_id);
    assert.equal(event.video_id, "selections");
    assert.equal(event.viewer_id, start.viewer_id);
    assert.equal(event.sdk_name, "@chunkify/player-analytics");
    assert.equal(event.schema_version, 1);
    assert.equal(event.reason, null);
    assert.equal(Object.hasOwn(event, "playing_time_ms"), false);
    assert.equal(Object.hasOwn(event, "subtitle_playing_time"), false);
  }
  assert.deepEqual(fixture.events.map((event) => event.sequence), fixture.events.map((_, i) => i + 1));
  session.destroy();
});

test("removing the showing track turns subtitles off", async (t) => {
  const french = track("subtitles", "fr", "showing");
  const fixture = setup(t, { tracks: [french] });
  const session = await fixture.attach();
  session.startAttempt();
  assert.equal(fixture.events[0].subtitle_language, "fr");
  delete fixture.media.textTracks[0];
  fixture.media.textTracks.length = 0;
  fixture.media.textTracks.dispatchEvent(new Event("removetrack"));
  assert.deepEqual(fixture.named("subtitle_changed").map((event) => event.subtitle_language), [null]);
  session.destroy();
});

test("excluded change events still update the selection and its playing time", async (t) => {
  const french = track("subtitles", "fr");
  const fixture = setup(t, { tracks: [french], includeEvents: ["view_started", "view_ended"] });
  const session = await fixture.attach();
  fixture.dispatch("play");
  fixture.dispatch("playing");
  fixture.setMode(french, "showing");
  fixture.setRate(2);
  fixture.advance(1000);
  session.destroy();
  assert.deepEqual(fixture.events.map((event) => event.event_name),
    ["chunkify.video.view_started", "chunkify.video.view_ended"]);
  assert.deepEqual(fixture.events[1].subtitle_playing_time, [{ language: "fr", playing_time_ms: 1000 }]);
  assert.deepEqual(fixture.events[1].playback_rate_playing_time, [{ rate: 2, playing_time_ms: 1000 }]);
});

test("destroy removes the subtitle and rate listeners", async (t) => {
  const french = track("subtitles", "fr");
  const fixture = setup(t, { tracks: [french] });
  const session = await fixture.attach();
  session.startAttempt();
  session.destroy();
  const count = fixture.events.length;
  fixture.setMode(french, "showing");
  fixture.setRate(2);
  session.startAttempt();
  assert.equal(fixture.events.length, count);
});

test("media exposing text tracks after attach is observed from the next attempt", async (t) => {
  const fixture = setup(t);
  const { textTracks } = fixture.media;
  fixture.media.textTracks = undefined; // A custom element before it upgrades.
  const session = await fixture.attach();
  fixture.media.textTracks = textTracks;
  const french = fixture.addTrack(track("subtitles", "fr"));
  session.startAttempt();
  fixture.setMode(french, "showing");
  assert.deepEqual(fixture.named("subtitle_changed").map((event) => event.subtitle_language), ["fr"]);
  session.destroy();
});

test("a final record with full breakdowns and played ranges stays within the delivery limit", async (t) => {
  const { createOtlpAdapter } = await import("@chunkify/player-analytics/otlp");
  const fixture = setup(t);
  const tracks = Array.from({ length: 32 }, (_, i) =>
    fixture.addTrack(track("subtitles", `${String(i).padStart(2, "0")}-${"x".repeat(40)}`)));
  fixture.media.duration = 1000;
  const session = await fixture.attach();
  session.startAttempt();
  for (let i = 0; i < 128; i++) {
    fixture.media.currentTime = i * 3 + 0.123456789012345;
    fixture.dispatch("seeking"); fixture.dispatch("seeked");
    fixture.setRate(Math.round((0.5 + i * 0.37) * 100) / 100 % 16 || 1);
    if (i > 0) tracks[(i - 1) % 32].mode = "disabled";
    fixture.setMode(tracks[i % 32], "showing");
    fixture.dispatch("playing");
    fixture.advance(987.654321098765);
    fixture.dispatch("timeupdate");
    fixture.dispatch("pause");
    fixture.dispatch("play");
  }
  fixture.dispatch("ended");
  const end = fixture.events.at(-1);
  assert.equal(end.played_ranges.length, 128);
  assert.equal(end.subtitle_playing_time.length, 32);
  assert.equal(end.playback_rate_playing_time.length, 32);
  assert.ok(Buffer.byteLength(JSON.stringify(end)) < 48 * 1024);
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.ok(Buffer.byteLength(init.body) < 48 * 1024, `OTLP body is ${Buffer.byteLength(init.body)} bytes`);
    return new Response(null, { status: 204 });
  });
  await createOtlpAdapter("https://collector.example/v1/logs").send(end);
  session.destroy();
});

test("language tags are trimmed like the collector and repaired when ill-formed", async (t) => {
  const cases = [
    [[track("subtitles", "\u0085", "showing")], "und"], // White_Space that JavaScript's trim() keeps.
    [[track("subtitles", "\u0085fr　", "showing")], "fr"],
    [[track("subtitles", "fr\uD800", "showing")], "fr�"],
  ];
  for (const [tracks, expected] of cases) {
    const fixture = setup(t, { tracks });
    const session = await fixture.attach();
    session.startAttempt();
    assert.equal(fixture.events[0].subtitle_language, expected, JSON.stringify(tracks));
    session.destroy();
  }
});

test("playing time under 1 ms is not reported and does not hold a slot", async (t) => {
  const fixture = setup(t);
  const session = await fixture.attach();
  fixture.dispatch("play");
  fixture.dispatch("playing");
  fixture.advance(0.4);
  // 32 distinct rates: the first one has only 0.4 ms.
  for (let i = 1; i < 32; i++) {
    fixture.setRate(1 + i / 100);
    fixture.advance(10);
  }
  fixture.setRate(3); // A 33rd value replaces the negligible one instead of being dropped.
  fixture.advance(10);
  fixture.dispatch("ended");
  const totals = fixture.events.at(-1).playback_rate_playing_time;
  assert.equal(totals.length, 32);
  assert.equal(totals.some((entry) => entry.rate === 1), false);
  assert.deepEqual(totals.at(-1), { rate: 3, playing_time_ms: 10 });
  assert.ok(totals.every((entry) => entry.playing_time_ms > 0));
  session.destroy();
});

test("a source load re-reads the playback rate it resets without a ratechange event", async (t) => {
  const fixture = setup(t, { playbackRate: 1.5 });
  const { attachAnalyticsWithManagedSource } = await import("../../packages/analytics/dist/core.js");
  const session = attachAnalyticsWithManagedSource(fixture.media, { videoId: "reload",
    destinations: [{ send(event) { fixture.events.push(event); } }] });
  session.startAttempt();
  fixture.media.playbackRate = 1; // load() resets to defaultPlaybackRate silently.
  fixture.dispatch("loadstart");
  assert.deepEqual(fixture.named("playback_rate_changed").map((event) =>
    [event.previous_playback_rate, event.playback_rate]), [[1.5, 1]]);
  session.destroy();
  assert.equal(fixture.events.at(-1).playback_rate, 1);
});
