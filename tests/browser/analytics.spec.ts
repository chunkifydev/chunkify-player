import { expect, test } from "@playwright/test";
import analyticsPackage from "../../packages/analytics/package.json" with { type: "json" };
import type { attachAnalytics, ChunkifyPlayerAnalyticsEvent, AnalyticsRendition, AnalyticsSession } from "../../packages/analytics/src/index.js";

declare global {
  interface Window {
    analyticsFixture: {
      attachAnalytics: typeof attachAnalytics;
      attachSummaryAnalytics: typeof attachAnalytics;
      video: HTMLVideoElement;
      events: ChunkifyPlayerAnalyticsEvent[];
      session: AnalyticsSession | null;
    };
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const viewerIdKey = "chunkify_analytics_viewer_id";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/analytics.html");
  await page.waitForFunction(() => Boolean(window.analyticsFixture));
});

test("visibility describes background pauses without pausing background playback", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    f.session = f.attachAnalytics(f.video, {
      videoId: "background", snapshotIntervalMs: 1000,
      destinations: [{ send(event) { f.events.push(event); } }],
    });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
    Object.defineProperty(f.video, "paused", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await page.evaluate(() => window.analyticsFixture.events.at(-1))).toMatchObject({
    event_name: "chunkify.video.view_snapshot", visibility_state: "hidden", playing_time_ms: 0,
  });
  await page.clock.runFor(2000);
  const playing = await page.evaluate(() => window.analyticsFixture.events);
  expect(playing.filter((event) => event.event_name === "chunkify.video.playback_state_changed")
    .map((event) => event.to_state)).toEqual(["playing"]);
  expect(playing.at(-1)).toMatchObject({
    event_name: "chunkify.video.view_snapshot", visibility_state: "hidden", playing_time_ms: 2000,
  });
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("pause")));
  expect(await page.evaluate(() => window.analyticsFixture.events.at(-1)?.event_name)).toBe("chunkify.video.view_snapshot");
  await page.evaluate(() => {
    Object.defineProperty(window.analyticsFixture.video, "paused", { configurable: true, value: true });
    window.analyticsFixture.video.dispatchEvent(new Event("pause"));
  });
  await page.clock.runFor(3000);
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(1000);
  await page.evaluate(() => {
    window.analyticsFixture.video.dispatchEvent(new Event("pause"));
    window.analyticsFixture.session!.destroy();
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.filter((event) => event.event_name === "chunkify.video.playback_state_changed" && event.to_state === "paused")
    .map((event) => event.visibility_state)).toEqual(["hidden", "visible"]);
  expect(events.at(-1)).toMatchObject({ visibility_state: "visible", playing_time_ms: 3000 });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(await page.evaluate(() => window.analyticsFixture.events.length)).toBe(events.length);
});

test("attachment stays idle and one playback attempt emits ordered start and end records", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-test", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.dispatchEvent(new Event("loadedmetadata"));
  });
  expect(await page.evaluate(() => window.analyticsFixture.events)).toEqual([]);
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
    f.video.dispatchEvent(new Event("ended"));
    f.session!.destroy();
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_started", "chunkify.video.view_ended"]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(events[0]!.view_id).toBe(events[1]!.view_id);
  expect(events[0]!.event_id).not.toBe(events[1]!.event_id);
  expect(events.map((event) => event.startup_outcome)).toEqual([null, "started"]);
});

test("default events describe playback state durations and rendition switches", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    const state = window as typeof window & { changeRendition: (rendition: AnalyticsRendition | null) => void };
    f.video.style.width = "480px";
    f.video.style.height = "270px";
    Object.defineProperty(f.video, "currentTime", { configurable: true, writable: true, value: 42 });
    f.session = f.attachAnalytics(f.video, {
      videoId: "video-timeline", destinations: [{ send(event) { f.events.push(event); } }],
    });
    f.session.setConnector({
      name: "hls.js", version: "1", playerName: "hls.js", playerVersion: "1",
      snapshot: () => ({ renditionWidth: null, renditionHeight: null, renditionCodec: null,
        renditionBitrate: null, renditionSwitchCount: 0, deliveryRequestCount: 0,
        deliveryTransferredBytes: 0, deliveryDurationMs: 0 }),
      subscribeToErrors: () => () => {},
      subscribeToRenditions(listener) {
        state.changeRendition = listener;
        listener(null);
        return () => {};
      },
    });
    f.session.startAttempt();
  });
  const dispatch = (name: string) => page.evaluate((name) => window.analyticsFixture.video.dispatchEvent(new Event(name)), name);
  await page.clock.runFor(2000);
  await dispatch("playing");
  await page.clock.runFor(3000);
  await dispatch("pause");
  await page.clock.runFor(4000);
  await dispatch("play");
  await page.clock.runFor(500);
  await dispatch("playing");
  const low = { width: 1280, height: 720, codec: "avc1", bitrate_bps: 2_000_000, frame_rate: 30 };
  const high = { width: 1920, height: 1080, codec: "avc1", bitrate_bps: 4_000_000, frame_rate: 30 };
  await page.evaluate((rendition) => (
    window as typeof window & { changeRendition: (rendition: AnalyticsRendition) => void }
  ).changeRendition(rendition), low);
  await page.evaluate((rendition) => (
    window as typeof window & { changeRendition: (rendition: AnalyticsRendition) => void }
  ).changeRendition(rendition), low);
  await page.evaluate((rendition) => (
    window as typeof window & { changeRendition: (rendition: AnalyticsRendition) => void }
  ).changeRendition(rendition), high);
  await page.clock.runFor(1000);
  await dispatch("ended");
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started",
    "chunkify.video.playback_state_changed",
    "chunkify.video.playback_state_changed",
    "chunkify.video.playback_state_changed",
    "chunkify.video.playback_state_changed",
    "chunkify.video.rendition_changed",
    "chunkify.video.rendition_changed",
    "chunkify.video.playback_state_changed",
    "chunkify.video.view_ended",
  ]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(events[1]).toMatchObject({ from_state: "startup", to_state: "playing",
    previous_state_duration_ms: 2000, playhead_seconds: 42 });
  expect(events[2]).toMatchObject({ from_state: "playing", to_state: "paused", previous_state_duration_ms: 3000 });
  expect(events[3]).toMatchObject({ from_state: "paused", to_state: "resuming", previous_state_duration_ms: 4000 });
  expect(events[5]).toMatchObject({ previous_rendition_width: null, selected_rendition_width: 1280 });
  expect(events[6]).toMatchObject({ previous_rendition_width: 1280, previous_rendition_height: 720,
    selected_rendition_width: 1920, selected_rendition_height: 1080, playhead_seconds: 42,
    player_width_px: 480, player_height_px: 270 });
  expect(events[5]).not.toHaveProperty("playing_time_ms");
  expect(events[1]).not.toHaveProperty("player_width_px");
  expect(events.at(-1)).toMatchObject({ playing_time_ms: 4000 });
});

test("state and seek events distinguish buffering and seeking from playing time", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperty(f.video, "currentTime", { configurable: true, writable: true, value: 10 });
    f.session = f.attachAnalytics(f.video, {
      videoId: "video-state-timing", destinations: [{ send(event) { f.events.push(event); } }],
    });
    f.session.startAttempt();
    f.video.dispatchEvent(new Event("playing"));
  });
  const dispatch = (name: string) => page.evaluate((name) => window.analyticsFixture.video.dispatchEvent(new Event(name)), name);
  await page.clock.runFor(1000);
  await dispatch("waiting");
  await page.clock.runFor(2000);
  await dispatch("playing");
  await page.clock.runFor(1000);
  await dispatch("seeking");
  await page.clock.runFor(500);
  await page.evaluate(() => { window.analyticsFixture.video.currentTime = 65; });
  await dispatch("seeked");
  await page.clock.runFor(200);
  await dispatch("playing");
  await dispatch("ended");
  const events = await page.evaluate(() => window.analyticsFixture.events);
  const changes = events.filter((event) => event.event_name === "chunkify.video.playback_state_changed");
  expect(changes.map((event) => [event.from_state, event.to_state, event.previous_state_duration_ms])).toEqual([
    ["startup", "playing", 0], ["playing", "buffering", 1000], ["buffering", "playing", 2000],
  ]);
  expect(events.find((event) => event.event_name === "chunkify.video.seek_completed")).toMatchObject({
    to_playhead_seconds: 65, seek_interaction_duration_ms: 500, seek_resume_wait_ms: 200,
    seek_outcome: "resumed",
  });
  expect(events.at(-1)).toMatchObject({ playing_time_ms: 2000, rebuffer_duration_ms: 2000,
    seek_duration_ms: 500 });
});

test("rapid seek cycles emit one completed interaction without seek state records", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperty(f.video, "currentTime", { configurable: true, writable: true, value: 10 });
    f.session = f.attachAnalytics(f.video, {
      videoId: "video-scrubbing", destinations: [{ send(event) { f.events.push(event); } }],
    });
    f.session.startAttempt();
    f.video.dispatchEvent(new Event("playing"));
  });
  const seek = (time: number) => page.evaluate((time) => {
    const video = window.analyticsFixture.video;
    video.currentTime = time;
    video.dispatchEvent(new Event("seeking"));
    video.dispatchEvent(new Event("seeked"));
    video.dispatchEvent(new Event("playing"));
  }, time);
  await seek(25);
  await page.clock.runFor(200);
  await seek(45);
  await page.clock.runFor(200);
  await seek(60);
  await page.clock.runFor(399);
  expect(await page.evaluate(() => window.analyticsFixture.events.filter((event) =>
    event.event_name === "chunkify.video.seek_completed"))).toHaveLength(0);
  await page.clock.runFor(1);
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.filter((event) => event.event_name === "chunkify.video.seek_completed")).toHaveLength(1);
  expect(events.find((event) => event.event_name === "chunkify.video.seek_completed")).toMatchObject({
    from_playhead_seconds: 10, to_playhead_seconds: 60, seek_outcome: "resumed",
    seek_started_at: "2026-01-01T00:00:01.000Z",
    last_seeked_at: "2026-01-01T00:00:01.400Z",
    playback_resumed_at: "2026-01-01T00:00:01.400Z",
    state_before_seek: "playing", state_after_seek: "playing",
  });
  expect(events.filter((event) => event.event_name === "chunkify.video.playback_state_changed")).toHaveLength(1);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("ended")));
  expect((await page.evaluate(() => window.analyticsFixture.events)).at(-1)).toMatchObject({ seek_count: 1 });
});

test("paused and interrupted seeks close without waiting for playback", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperty(f.video, "currentTime", { configurable: true, writable: true, value: 10 });
    f.session = f.attachAnalytics(f.video, {
      videoId: "video-paused-seek", destinations: [{ send(event) { f.events.push(event); } }],
    });
    f.session.startAttempt();
    f.video.dispatchEvent(new Event("playing"));
    f.video.dispatchEvent(new Event("pause"));
    f.video.currentTime = 20;
    f.video.dispatchEvent(new Event("seeking"));
    f.video.dispatchEvent(new Event("seeked"));
  });
  await page.clock.runFor(400);
  expect((await page.evaluate(() => window.analyticsFixture.events)).find((event) =>
    event.event_name === "chunkify.video.seek_completed")).toMatchObject({
    seek_outcome: "paused", state_before_seek: "paused", state_after_seek: "paused",
    seek_started_at: "2026-01-01T00:00:01.000Z", last_seeked_at: "2026-01-01T00:00:01.000Z",
    playback_resumed_at: null,
  });
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.currentTime = 30;
    f.video.dispatchEvent(new Event("seeking"));
    f.session!.destroy();
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.filter((event) => event.event_name === "chunkify.video.seek_completed")).toHaveLength(2);
  expect(events.at(-2)).toMatchObject({ event_name: "chunkify.video.seek_completed", seek_outcome: "interrupted",
    state_before_seek: "paused", state_after_seek: "stopped", last_seeked_at: null,
    playback_resumed_at: null });
  expect(events.at(-1)).toMatchObject({ event_name: "chunkify.video.view_ended", seek_count: 2 });
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.analyticsFixture.events)).toHaveLength(events.length);
});

test("a seek waits for playback to resume after its final seeked event", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, {
      videoId: "video-seek-resume", destinations: [{ send(event) { f.events.push(event); } }],
    });
    f.session.startAttempt();
    f.video.dispatchEvent(new Event("playing"));
    f.video.dispatchEvent(new Event("seeking"));
    f.video.dispatchEvent(new Event("seeked"));
  });
  await page.clock.runFor(600);
  expect((await page.evaluate(() => window.analyticsFixture.events)).filter((event) =>
    event.event_name === "chunkify.video.seek_completed")).toHaveLength(0);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("playing")));
  expect((await page.evaluate(() => window.analyticsFixture.events)).find((event) =>
    event.event_name === "chunkify.video.seek_completed")).toMatchObject({
    seek_outcome: "resumed", seek_resume_wait_ms: 600,
    seek_started_at: "2026-01-01T00:00:01.000Z", last_seeked_at: "2026-01-01T00:00:01.000Z",
    playback_resumed_at: "2026-01-01T00:00:01.600Z",
  });
});

test("excluding the grouped seek event keeps raw state changes available", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, {
      videoId: "video-raw-seek", includeEvents: ["playback_state_changed", "view_ended"],
      destinations: [{ send(event) { f.events.push(event); } }],
    });
    f.session.startAttempt();
    for (const name of ["playing", "seeking", "seeked", "playing", "ended"]) {
      f.video.dispatchEvent(new Event(name));
    }
    return f.events;
  });
  expect(events.filter((event) => event.event_name === "chunkify.video.seek_completed")).toHaveLength(0);
  expect(events.filter((event) => event.event_name === "chunkify.video.playback_state_changed")
    .map((event) => event.event_name === "chunkify.video.playback_state_changed" && event.to_state)).toEqual([
    "playing", "seeking", "resuming", "playing", "ended",
  ]);
  expect(events.at(-1)).toMatchObject({ seek_count: 1 });
});

test("destroying from a seek destination ends the view once", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, {
      videoId: "video-seek-destroy", destinations: [{ send(event) {
        f.events.push(event);
        if (event.event_name === "chunkify.video.seek_completed") f.session?.destroy();
      } }],
    });
    f.session.startAttempt();
    for (const name of ["playing", "seeking", "seeked", "playing"]) {
      f.video.dispatchEvent(new Event(name));
    }
  });
  await page.clock.runFor(400);
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.filter((event) => event.event_name === "chunkify.video.seek_completed")).toHaveLength(1);
  expect(events.filter((event) => event.event_name === "chunkify.video.view_ended")).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({ event_name: "chunkify.video.view_ended", reason: "destroyed" });
});

test("records intrinsic and displayed video size when available", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.style.width = "320px";
    f.video.style.height = "180px";
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-size", destinations: [{ send(event) { f.events.push(event); } }] });
    f.video.dispatchEvent(new Event("play"));
    Object.defineProperties(f.video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    f.video.style.width = "640px";
    f.video.style.height = "360px";
    f.video.dispatchEvent(new Event("ended"));
    f.video.style.display = "none";
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("ended"));
    f.session.destroy();
    return f.events;
  });
  expect(events[0]).toMatchObject({
    schema_version: 1,
    media_width_px: null, media_height_px: null,
    player_width_px: 320, player_height_px: 180,
  });
  expect(events[1]).toMatchObject({
    media_width_px: 1920, media_height_px: 1080,
    player_width_px: 640, player_height_px: 360,
  });
  expect(events[1]).not.toHaveProperty("metrics");
  expect(events[1]).not.toHaveProperty("player_width_css_px");
  expect(events[1]).not.toHaveProperty("player_height_css_px");
  expect(events[2]).toMatchObject({ player_width_px: null, player_height_px: null });
  expect(events[3]).toMatchObject({ player_width_px: null, player_height_px: null });
});

test("startup and playing time exclude loading, buffering, pauses and seeks", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-timing", destinations: [{ send: (event) => { f.events.push(event); } }] });
  });
  const dispatch = (event: string) => page.evaluate((event) => window.analyticsFixture.video.dispatchEvent(new Event(event)), event);
  await dispatch("play");
  await page.clock.runFor(2000);
  await dispatch("playing");
  await page.clock.runFor(3000);
  await dispatch("waiting");
  await page.clock.runFor(4000);
  await dispatch("playing");
  await page.clock.runFor(1000);
  await dispatch("pause");
  await dispatch("waiting");
  await page.clock.runFor(5000);
  await dispatch("play");
  await page.clock.runFor(1000);
  await dispatch("playing");
  await page.clock.runFor(2000);
  await dispatch("seeking");
  await dispatch("waiting");
  await page.clock.runFor(3000);
  await dispatch("seeked");
  await page.clock.runFor(1000);
  await dispatch("playing");
  await page.clock.runFor(2000);
  await dispatch("error");
  await page.clock.runFor(5000);
  await dispatch("ended");
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.playback_error", "chunkify.video.view_ended",
  ]);
  for (const event of events.slice(1)) {
    expect(event).toMatchObject({
      startup_time_ms: 2000,
      playing_time_ms: 8000,
      rebuffer_count: 1,
      rebuffer_duration_ms: 4000,
      seek_count: 1,
      seek_duration_ms: 3000,
    });
  }
});

test("first video frame timing uses the callback clock without changing startup time", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    const callbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(f.video, "requestVideoFrameCallback", {
      configurable: true,
      value(callback: VideoFrameRequestCallback) { callbacks.push(callback); return callbacks.length; },
    });
    (window as typeof window & { fireTestFrame: () => void }).fireTestFrame = () => {
      callbacks[0]?.(performance.now(), {} as VideoFrameCallbackMetadata);
    };
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-frame", destinations: [{ send(event) { f.events.push(event); } }] });
    f.session.startAttempt();
  });
  await page.clock.runFor(1000);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("playing")));
  await page.clock.runFor(400);
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    (window as typeof window & { fireTestFrame: () => void }).fireTestFrame();
    f.video.dispatchEvent(new Event("ended"));
    f.session!.destroy();
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events[0]!.first_video_frame_time_ms).toBeNull();
  expect(events[1]!).toMatchObject({ startup_time_ms: 1000, first_video_frame_time_ms: 1400 });
});

test("frame timing stays unavailable after source change or without the browser API", async ({ page }) => {
  const result = await page.evaluate(() => {
    const f = window.analyticsFixture;
    const callbacks: VideoFrameRequestCallback[] = [];
    let canceledId: number | null = null;
    Object.defineProperties(f.video, {
      requestVideoFrameCallback: {
        configurable: true,
        value(callback: VideoFrameRequestCallback) { callbacks.push(callback); return callbacks.length; },
      },
      cancelVideoFrameCallback: { configurable: true, value(id: number) { canceledId = id; } },
    });
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-frame-cancel", destinations: [{ send(event) { f.events.push(event); } }] });
    f.session.startAttempt();
    f.session.sourceChanged();
    callbacks[0]?.(performance.now(), {} as VideoFrameCallbackMetadata);
    Object.defineProperty(f.video, "requestVideoFrameCallback", { configurable: true, value: undefined });
    f.session.startAttempt();
    f.session.destroy();
    return {
      canceledId,
      frameTimes: f.events.filter((event) => event.event_name === "chunkify.video.view_ended")
        .map((event) => event.first_video_frame_time_ms),
    };
  });
  expect(result).toEqual({ canceledId: 1, frameTimes: [null, null] });
});

test("a fatal error during view_started cancels frame timing", async ({ page }) => {
  const result = await page.evaluate(() => {
    const f = window.analyticsFixture;
    const callbacks: VideoFrameRequestCallback[] = [];
    let canceledId: number | null = null;
    Object.defineProperties(f.video, {
      requestVideoFrameCallback: {
        configurable: true,
        value(callback: VideoFrameRequestCallback) { callbacks.push(callback); return callbacks.length; },
      },
      cancelVideoFrameCallback: { configurable: true, value(id: number) { canceledId = id; } },
    });
    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-frame-error",
      destinations: [{ send(event) {
        f.events.push(event);
        if (event.event_name === "chunkify.video.view_started") f.video.dispatchEvent(new Event("error"));
      } }],
    });
    f.session.startAttempt();
    callbacks[0]?.(performance.now(), {} as VideoFrameCallbackMetadata);
    f.session.destroy();
    return { canceledId, frameTime: f.events.at(-1)?.first_video_frame_time_ms };
  });
  expect(result).toEqual({ canceledId: 1, frameTime: null });
});

test("rendition playing time follows playback, switches and view boundaries", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    const state = window as typeof window & { changeRendition: (rendition: AnalyticsRendition | null) => void };
    f.video.style.width = "400px";
    f.video.style.height = "225px";
    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-rendition-time", destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.session.setConnector({
      name: "hls.js", version: "1", playerName: "hls.js", playerVersion: "1",
      snapshot: () => ({
        renditionWidth: null, renditionHeight: null, renditionCodec: null, renditionBitrate: null,
        renditionSwitchCount: 0, deliveryRequestCount: 0, deliveryTransferredBytes: 0, deliveryDurationMs: 0,
      }),
      subscribeToErrors: () => () => {},
      subscribeToRenditions(listener) {
        state.changeRendition = listener;
        listener(null);
        return () => {};
      },
    });
    f.session.startAttempt();
    f.video.playbackRate = 2;
    f.video.dispatchEvent(new Event("playing"));
  });
  const low = { width: 256, height: 144, codec: "avc1", bitrate_bps: 250_000, frame_rate: 24 };
  const high = { width: 640, height: 360, codec: "avc1", bitrate_bps: 750_000, frame_rate: 30 };
  const dispatch = (event: string) => page.evaluate((event) => window.analyticsFixture.video.dispatchEvent(new Event(event)), event);
  const select = (rendition: AnalyticsRendition) => page.evaluate((rendition) => (
    window as typeof window & { changeRendition: (rendition: AnalyticsRendition | null) => void }
  ).changeRendition(rendition), rendition);

  await page.clock.runFor(2000); // An unknown rendition is not attributed to a quality level.
  await select(low);
  await page.clock.runFor(20000);
  await select(high);
  await page.clock.runFor(8000);
  const snapshot = (await page.evaluate(() => window.analyticsFixture.events))[1]!;
  expect(snapshot.event_name).toBe("chunkify.video.view_snapshot");
  expect(snapshot.playing_time_ms).toBe(30000);
  expect(snapshot).toMatchObject({ player_width_px: 400, player_height_px: 225 });
  expect(snapshot.rendition_playing_time).toEqual([
    { ...low, playing_time_ms: 20000 }, { ...high, playing_time_ms: 8000 },
  ]);

  await dispatch("waiting");
  await page.clock.runFor(5000);
  await dispatch("playing");
  await page.clock.runFor(5000);
  await dispatch("seeking");
  await page.clock.runFor(4000);
  await dispatch("seeked");
  await dispatch("playing");
  await page.clock.runFor(3000);
  await dispatch("pause");
  await page.clock.runFor(2000);
  await dispatch("play");
  await dispatch("playing");
  await select(low);
  await page.clock.runFor(2000);
  await dispatch("ended");
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events[0]!.rendition_playing_time).toEqual([]);
  expect(events.at(-1)!.playing_time_ms).toBe(40000);
  expect(events.at(-1)!.rendition_playing_time).toEqual([
    { ...low, playing_time_ms: 22000 }, { ...high, playing_time_ms: 16000 },
  ]);
  expect(snapshot.rendition_playing_time).toEqual([
    { ...low, playing_time_ms: 20000 }, { ...high, playing_time_ms: 8000 },
  ]);

  await dispatch("play");
  await dispatch("playing");
  await page.clock.runFor(1000);
  await dispatch("ended");
  const replay = (await page.evaluate(() => window.analyticsFixture.events)).at(-1)!;
  expect(replay.rendition_playing_time).toEqual([{ ...low, playing_time_ms: 1000 }]);
});

test("final records contain cumulative buffering, seeking and furthest progress measurements", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperties(f.video, {
      duration: { configurable: true, value: 100 },
      currentTime: { configurable: true, writable: true, value: 0 },
    });
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-metrics", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  const dispatch = (event: string) => page.evaluate((event) => window.analyticsFixture.video.dispatchEvent(new Event(event)), event);
  await page.clock.runFor(10000);
  await page.evaluate(() => { window.analyticsFixture.video.currentTime = 10; });
  await dispatch("timeupdate");
  await dispatch("waiting");
  await page.clock.runFor(4000);
  await dispatch("playing");
  await page.clock.runFor(5000);
  await page.evaluate(() => { window.analyticsFixture.video.currentTime = 15; });
  await dispatch("timeupdate");
  await dispatch("seeking");
  await page.evaluate(() => { window.analyticsFixture.video.currentTime = 80; });
  await page.clock.runFor(3000);
  await dispatch("seeked");
  await dispatch("playing");
  await page.clock.runFor(5000);
  await page.evaluate(() => { window.analyticsFixture.video.currentTime = 85; });
  await dispatch("timeupdate");
  await dispatch("ended");
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({
    playing_time_ms: 20000,
    rebuffer_count: 1,
    rebuffer_duration_ms: 4000,
    rebuffer_ratio: 1 / 6,
    seek_count: 1,
    seek_duration_ms: 3000,
    maximum_playhead_seconds: 85,
    furthest_progress_ratio: 0.85,
  });
  expect(events[1]!).not.toHaveProperty("completion_ratio");
});

test("snapshots report cumulative metrics every 30 seconds of active playing time", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-snapshot", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(29999);
  expect(await page.evaluate(() => window.analyticsFixture.events.length)).toBe(1);
  await page.clock.runFor(1);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("waiting")));
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => window.analyticsFixture.events.length)).toBe(2);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("playing")));
  await page.clock.runFor(30000);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("ended")));
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started",
    "chunkify.video.view_snapshot",
    "chunkify.video.view_snapshot",
    "chunkify.video.view_ended",
  ]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  expect(events.slice(1).map((event) => event.playing_time_ms)).toEqual([30000, 60000, 60000]);
  expect(events[1]).toMatchObject({ reason: null, rebuffer_count: 0 });
  expect(events[2]).toMatchObject({ reason: null, rebuffer_count: 1, rebuffer_duration_ms: 60000 });
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => window.analyticsFixture.events.length)).toBe(4);
});

test("snapshot interval and event selection apply without losing final metrics", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-custom-snapshots", snapshotIntervalMs: 10000,
      includeEvents: ["view_snapshot", "view_ended"],
      destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(10000);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("waiting")));
  await page.clock.runFor(20000);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("playing")));
  await page.clock.runFor(10000);
  await page.evaluate(() => {
    window.analyticsFixture.video.dispatchEvent(new Event("error"));
    window.analyticsFixture.video.dispatchEvent(new Event("ended"));
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_snapshot", "chunkify.video.view_snapshot", "chunkify.video.view_ended",
  ]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  expect(events.map((event) => event.playing_time_ms)).toEqual([10000, 20000, 20000]);
  expect(events[2]!.rebuffer_duration_ms).toBe(20000);
});

test("excluding snapshots retains a final view", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-final-only", snapshotIntervalMs: 1000, includeEvents: ["view_ended"],
      destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(3000);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("ended")));
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_ended"]);
  expect(events[0]).toMatchObject({ sequence: 1, playing_time_ms: 3000 });
});

test("a media error stops an unfinished seek measurement", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-seek-error", destinations: [{ send: (event) => { f.events.push(event); } }] });
    for (const event of ["play", "playing", "seeking"]) f.video.dispatchEvent(new Event(event));
  });
  await page.clock.runFor(2000);
  await page.evaluate(() => window.analyticsFixture.video.dispatchEvent(new Event("error")));
  await page.clock.runFor(5000);
  await page.evaluate(() => window.analyticsFixture.session!.destroy());
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events[1]).toMatchObject({ seek_count: 1, seek_duration_ms: 2000 });
});

test("media failures emit one normalized error record without raw error text", async ({ page }) => {
  const results = await page.evaluate(() => {
    const f = window.analyticsFixture;
    const results: ChunkifyPlayerAnalyticsEvent[][] = [];
    for (const [code, category] of [[1, "aborted"], [2, "network"], [3, "decode"], [4, "unsupported"], [99, "unknown"]] as const) {
      f.events = [];
      Object.defineProperties(f.video, {
        currentTime: { configurable: true, writable: true, value: 12.5 },
        error: { configurable: true, value: { code, message: "https://private.example/video.m3u8?token=secret" } },
      });
      f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-error", destinations: [{ send: (event) => { f.events.push(event); } }] });
      f.session.startAttempt();
      f.video.dispatchEvent(new Event("error"));
      f.video.dispatchEvent(new Event("error"));
      f.session.destroy();
      const events = structuredClone(f.events);
      if (events[1]?.error_category !== category) throw new Error("unexpected normalized category");
      results.push(events);
    }
    return results;
  });
  for (const [index, events] of results.entries()) {
    expect(events.map((event) => event.event_name)).toEqual([
      "chunkify.video.view_started", "chunkify.video.playback_error", "chunkify.video.view_ended",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.startup_outcome)).toEqual([null, null, "failed_before_start"]);
    expect(events[2]!.first_video_frame_time_ms).toBeNull();
    expect(events[1]).toMatchObject({
      error_code: [1, 2, 3, 4, 99][index],
      error_fatal: true,
      error_playhead_seconds: 12.5,
      reason: null,
    });
    expect(JSON.stringify(events)).not.toMatch(/private\.example|token|secret|m3u8/);
  }
});

test("browser playback quality reports frame totals for the current view", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    const quality = { totalVideoFrames: 100, droppedVideoFrames: 5 };
    Object.defineProperty(f.video, "getVideoPlaybackQuality", {
      configurable: true,
      value: () => quality,
    });
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-frames", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.session.startAttempt();
    quality.totalVideoFrames = 220;
    quality.droppedVideoFrames = 11;
    f.session.destroy();
    return f.events;
  });
  expect(events[0]).toMatchObject({ total_video_frames: 0, dropped_video_frames: 0 });
  expect(events[1]).toMatchObject({ total_video_frames: 120, dropped_video_frames: 6 });
});

test("an engine connector enriches a view with normalized rendition and delivery aggregates", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    type ConnectorError = {
      category: "network";
      code: string;
      fatal: boolean;
    };
    let emitError = (_error: ConnectorError) => {};
    const snapshot = {
      renditionWidth: 1920,
      renditionHeight: 1080,
      renditionCodec: "avc1.640028",
      renditionBitrate: 4_500_000,
      renditionSwitchCount: 2,
      deliveryRequestCount: 10,
      deliveryTransferredBytes: 1_000_000,
      deliveryDurationMs: 4_000,
    };
    const connector = {
      name: "hls.js",
      version: "1.7.3",
      playerName: "hls.js",
      playerVersion: "1.7.3",
      snapshot: () => ({ ...snapshot }),
      subscribeToErrors(listener: (error: ConnectorError) => void) {
        emitError = listener;
        return () => { emitError = () => {}; };
      },
    };
    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-engine", destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.session.setConnector(connector);
    f.session.startAttempt();
    snapshot.renditionWidth = 1280;
    snapshot.renditionHeight = 720;
    snapshot.renditionBitrate = 2_000_000;
    snapshot.renditionSwitchCount = 4;
    snapshot.deliveryRequestCount = 15;
    snapshot.deliveryTransferredBytes = 2_500_000;
    snapshot.deliveryDurationMs = 10_000;
    emitError({ category: "network", code: "fragLoadError", fatal: true });
    f.session.destroy();
    return f.events;
  });

  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.playback_error", "chunkify.video.view_ended",
  ]);
  expect(events[0]).toMatchObject({
    connector_name: "hls.js",
    connector_version: "1.7.3",
    player_name: "hls.js",
    player_version: "1.7.3",
    selected_rendition_width: 1920,
    selected_rendition_height: 1080,
    selected_rendition_codec: "avc1.640028",
    selected_rendition_bitrate_bps: 4_500_000,
    rendition_switch_count: 0,
    delivery_request_count: 0,
    delivery_transferred_bytes: 0,
    delivery_throughput_bps: null,
  });
  expect(events[1]).toMatchObject({
    error_category: "network",
    error_code: "fragLoadError",
    error_fatal: true,
    selected_rendition_width: 1280,
    selected_rendition_height: 720,
    selected_rendition_bitrate_bps: 2_000_000,
    rendition_switch_count: 2,
    delivery_request_count: 5,
    delivery_transferred_bytes: 1_500_000,
    delivery_throughput_bps: 2_000_000,
  });
  expect(events[2]).toMatchObject({ startup_outcome: "failed_before_start" });
  expect(JSON.stringify(events)).not.toMatch(/url|secret|stack|message/i);
});

test("a fatal connector error stops active timing before its error and final records", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    let emitError = (_error: { category: "decode"; code: string; fatal: boolean }) => {};
    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-fatal-engine", destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.session.setConnector({
      name: "test-engine", version: "1", playerName: "test-engine", playerVersion: "1",
      snapshot: () => ({
        renditionWidth: null, renditionHeight: null, renditionCodec: null, renditionBitrate: null,
        renditionSwitchCount: 0, deliveryRequestCount: 0, deliveryTransferredBytes: 0, deliveryDurationMs: 0,
      }),
      subscribeToErrors(listener) { emitError = listener; return () => {}; },
    });
    f.session.startAttempt();
    f.video.dispatchEvent(new Event("playing"));
    (window as typeof window & { emitFatalConnectorError: () => void }).emitFatalConnectorError = () => {
      emitError({ category: "decode", code: "mediaError", fatal: true });
    };
  });
  await page.clock.runFor(1000);
  await page.evaluate(() => (
    window as typeof window & { emitFatalConnectorError: () => void }
  ).emitFatalConnectorError());
  await page.clock.runFor(5000);
  await page.evaluate(() => window.analyticsFixture.session!.destroy());
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.playback_error", "chunkify.video.view_ended",
  ]);
  expect(events[1]).toMatchObject({ playing_time_ms: 1000 });
  expect(events[2]).toMatchObject({ startup_outcome: "started", playing_time_ms: 1000 });
});

test("connector subscriptions cannot outlive a destroyed or reentrantly destroyed session", async ({ page }) => {
  const result = await page.evaluate(() => {
    const f = window.analyticsFixture;
    let subscribed = 0;
    let cleaned = 0;
    const connector = {
      name: "test-engine", version: "1", playerName: "test-engine", playerVersion: "1",
      snapshot: () => ({
        renditionWidth: null, renditionHeight: null, renditionCodec: null, renditionBitrate: null,
        renditionSwitchCount: 0, deliveryRequestCount: 0, deliveryTransferredBytes: 0, deliveryDurationMs: 0,
      }),
      subscribeToErrors() { subscribed++; return () => { cleaned++; }; },
    };
    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-destroyed-connector", destinations: [{ send() {} }],
    });
    f.session.destroy();
    f.session.setConnector(connector);
    const afterDestroyed = { subscribed, cleaned };

    f.session = f.attachSummaryAnalytics(f.video, {
      videoId: "asset-reentrant-connector", destinations: [{ send() {} }],
    });
    f.session.setConnector({
      ...connector,
      subscribeToErrors() {
        subscribed++;
        f.session!.destroy();
        return () => { cleaned++; };
      },
    });
    return { afterDestroyed, final: { subscribed, cleaned } };
  });
  expect(result.afterDestroyed).toEqual({ subscribed: 0, cleaned: 0 });
  expect(result.final).toEqual({ subscribed: 1, cleaned: 1 });
});

test("WebKit frame counters are supported and unavailable counters remain null", async ({ page }) => {
  const results = await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperties(f.video, {
      getVideoPlaybackQuality: { configurable: true, value: undefined },
      webkitDecodedFrameCount: { configurable: true, writable: true, value: 40 },
      webkitDroppedFrameCount: { configurable: true, writable: true, value: 2 },
    });
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-webkit-frames", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.session.startAttempt();
    Reflect.set(f.video, "webkitDecodedFrameCount", 70);
    Reflect.set(f.video, "webkitDroppedFrameCount", 5);
    f.session.destroy();
    const supported = structuredClone(f.events);
    f.events = [];
    Object.defineProperties(f.video, {
      webkitDecodedFrameCount: { configurable: true, value: undefined },
      webkitDroppedFrameCount: { configurable: true, value: undefined },
    });
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-no-frames", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.session.startAttempt();
    f.session.destroy();
    return { supported, unavailable: f.events };
  });
  expect(results.supported[1]).toMatchObject({ total_video_frames: 30, dropped_video_frames: 3 });
  expect(results.unavailable[1]).toMatchObject({ total_video_frames: null, dropped_video_frames: null });
});

test("a failing browser frame API does not interrupt analytics or expose its error", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    Object.defineProperties(f.video, {
      getVideoPlaybackQuality: { configurable: true, value: () => { throw new Error("private frame failure"); } },
      webkitDecodedFrameCount: { configurable: true, value: undefined },
      webkitDroppedFrameCount: { configurable: true, value: undefined },
    });
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-frame-failure", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.session.startAttempt();
    f.session.destroy();
    return f.events;
  });
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ total_video_frames: null, dropped_video_frames: null });
  expect(JSON.stringify(events)).not.toContain("private frame failure");
});

test("frame metrics remain unavailable after counters reset above their baseline", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    const quality = { totalVideoFrames: 100, droppedVideoFrames: 5 };
    Object.defineProperty(f.video, "getVideoPlaybackQuality", { configurable: true, value: () => quality });
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-frame-reset", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.session.startAttempt();
    quality.totalVideoFrames = 300;
    quality.droppedVideoFrames = 10;
    f.video.dispatchEvent(new Event("error"));
    quality.totalVideoFrames = 150;
    quality.droppedVideoFrames = 7;
    f.session.destroy();
    quality.totalVideoFrames = 400;
    quality.droppedVideoFrames = 12;
    return f.events;
  });
  expect(events[1]).toMatchObject({ total_video_frames: 200, dropped_video_frames: 5 });
  expect(events[2]).toMatchObject({ total_video_frames: null, dropped_video_frames: null });
});

test("the first attempt reports a media error that happened during preload", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-preload-error", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.preload = "metadata";
    f.video.src = "/tests/fixtures/media/does-not-exist.mp4?private=secret";
  });
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.video.error?.code ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.analyticsFixture.events)).toEqual([]);
  const rejected = await page.evaluate(async () => {
    const f = window.analyticsFixture;
    f.session!.startAttempt();
    try { await f.video.play(); return false; } catch { return true; }
  });
  expect(rejected).toBe(true);
  let events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.playback_error",
  ]);
  expect(events[1]).toMatchObject({ error_fatal: true, error_playhead_seconds: 0 });
  expect(JSON.stringify(events)).not.toMatch(/does-not-exist|private|secret|\.mp4/);
  await page.evaluate(() => window.analyticsFixture.session!.destroy());
  events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
});

test("a delayed snapshot timer emits once and schedules the next future interval", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    const state = window as typeof window & {
      snapshotCallback?: () => void;
      snapshotDelays: number[];
      restoreSetTimeout: () => void;
    };
    const originalSetTimeout = window.setTimeout;
    state.snapshotDelays = [];
    state.restoreSetTimeout = () => { window.setTimeout = originalSetTimeout; };
    window.setTimeout = ((handler: TimerHandler, timeout?: number) => {
      state.snapshotDelays.push(timeout ?? 0);
      state.snapshotCallback = () => { if (typeof handler === "function") handler(); };
      return 1;
    }) as typeof window.setTimeout;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-delayed", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(120000);
  const result = await page.evaluate(() => {
    const state = window as typeof window & {
      snapshotCallback?: () => void;
      snapshotDelays: number[];
      restoreSetTimeout: () => void;
    };
    state.snapshotCallback!();
    const result = { delays: state.snapshotDelays, events: window.analyticsFixture.events };
    window.analyticsFixture.session!.destroy();
    state.restoreSetTimeout();
    return result;
  });
  expect(result.events.filter((event) => event.event_name === "chunkify.video.view_snapshot")).toHaveLength(1);
  expect(result.delays).toEqual([30000, 30000]);
});

test("records use the versioned contract and exclude URLs and unrelated configuration", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.preload = "none";
    f.video.src = "https://media.example.test/private/path/master.m3u8?token=must-not-leak";
    const options = {
      videoId: "asset-private",
      environment: "test", userId: "user-pseudonym", videoTitle: "Private title",
      authorization: "must-not-leak", rawError: "must-not-leak",
      destinations: [{ send: (event: import("../../packages/analytics/src/index.js").ChunkifyPlayerAnalyticsEvent) => { f.events.push(event); } }],
    };
    f.session = f.attachSummaryAnalytics(f.video, options);
    f.session.startAttempt();
    f.session.destroy();
    return f.events;
  });
  expect(events).toHaveLength(2);
  for (const event of events) {
    expect(event).toMatchObject({
      schema_version: 1, video_id: "asset-private", delivery_hostname: "media.example.test",
      sdk_name: "@chunkify/player-analytics", sdk_version: analyticsPackage.version,
      connector_name: "html-media", connector_version: analyticsPackage.version,
      player_name: null, player_version: null, environment: "test", viewer_id: expect.stringMatching(uuidPattern),
      user_id: "user-pseudonym", video_title: "Private title",
      media_duration_seconds: null, startup_time_ms: null, playing_time_ms: 0,
    });
    expect(event).toHaveProperty("occurred_at", expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  }
  expect(events[1]).toMatchObject({ reason: "destroyed", startup_outcome: "ended_before_start" });
  const serialized = JSON.stringify(events);
  for (const excluded of ["https://", "/private/path", "must-not-leak", "authorization", "rawError"]) {
    expect(serialized).not.toContain(excluded);
  }
});

test("source resets and page exit end separate views, and destroy removes observation", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-reset", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(1000);
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.dispatchEvent(new Event("emptied"));
    f.video.dispatchEvent(new Event("loadstart"));
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(500);
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    f.session!.destroy();
    f.session!.destroy();
    f.session!.startAttempt();
    for (const event of ["play", "playing", "ended"]) f.video.dispatchEvent(new Event(event));
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.view_ended", "chunkify.video.view_started", "chunkify.video.view_ended",
  ]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 1, 2]);
  expect(events[1]).toMatchObject({ reason: "source_changed", playing_time_ms: 1000 });
  expect(events[3]).toMatchObject({ reason: "page_exit", playing_time_ms: 500 });
  expect(events[0]!.view_id).not.toBe(events[2]!.view_id);
  expect(new Set(events.map((event) => event.event_id)).size).toBe(4);
});

test("callback failures and reentrant cleanup cannot escape or duplicate final records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const counts = await page.evaluate(async () => {
    const f = window.analyticsFixture;
    const counts: number[] = [];
    for (const mode of ["throw", "reject", "destroy"]) {
      f.events = [];
      f.session = f.attachSummaryAnalytics(f.video, {
        videoId: "asset-callback",
        destinations: [{ send(event) {
          f.events.push(event);
          if (mode === "throw") throw new Error("destination unavailable");
          if (mode === "reject") return Promise.reject(new Error("destination unavailable"));
          if (event.event_name === "chunkify.video.view_ended") f.session!.destroy();
        } }],
      });
      f.session.startAttempt();
      f.video.dispatchEvent(new Event("ended"));
      f.session.destroy();
      counts.push(f.events.length);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    return counts;
  });
  expect(counts).toEqual([2, 2, 2]);
  expect(errors).toEqual([]);
});

test("invalid configuration fails before installing listeners or calling a destination", async ({ page }) => {
  const result = await page.evaluate(() => {
    const f = window.analyticsFixture;
    const failures: boolean[] = [];
    for (const invalid of [{ videoId: "" }, { videoId: "  " }, { destinations: null },
      { destinations: [] }, { destinations: [null] }, { destinations: [{ send: null }] },
      { environment: { authorization: "secret" } }, { userId: { email: "private@example.test" } },
      { userId: 42 }, { userId: "a".repeat(257) }, { userId: "\u{1F600}".repeat(257) },
      { videoTitle: 42 }, { persistViewerId: "false" }, { persistViewerId: 0 },
      { snapshotIntervalMs: 0 }, { snapshotIntervalMs: 999 }, { snapshotIntervalMs: 1500.5 },
      { snapshotIntervalMs: Infinity }, { snapshotIntervalMs: Number.MAX_SAFE_INTEGER },
      { snapshotIntervalMs: "10000" },
      { includeEvents: "view_started" }, { includeEvents: ["view_started", "unknown"] }]) {
      try {
        Reflect.apply(f.attachSummaryAnalytics, null, [f.video, {
          videoId: "asset-valid", destinations: [{ send: (event: ChunkifyPlayerAnalyticsEvent) => { f.events.push(event); } }], ...invalid,
        }]);
        failures.push(false);
      } catch (error) { failures.push(error instanceof TypeError); }
    }
    f.video.dispatchEvent(new Event("play"));
    return { failures, events: f.events };
  });
  expect(result).toEqual({ failures: Array(22).fill(true), events: [] });
});

/** Start and end one view in the page; return its first event. */
function recordView(options: Record<string, unknown>) {
  const f = window.analyticsFixture;
  const events: ChunkifyPlayerAnalyticsEvent[] = [];
  const session = f.attachSummaryAnalytics(f.video, {
    videoId: "asset-identity", destinations: [{ send: (event) => { events.push(event); } }], ...options,
  });
  session.startAttempt();
  session.destroy();
  return events[0]!;
}

test("generated viewer ID persists in localStorage across page loads", async ({ page }) => {
  const first = await page.evaluate(recordView, {});
  expect(first.viewer_id).toMatch(uuidPattern);
  expect(first).toMatchObject({ user_id: null, video_title: null });
  expect(await page.evaluate((key) => localStorage.getItem(key), viewerIdKey)).toBe(first.viewer_id);
  const sameLoad = await page.evaluate(recordView, {});
  expect(sameLoad.viewer_id).toBe(first.viewer_id);
  expect(sameLoad.view_id).not.toBe(first.view_id);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.analyticsFixture));
  const reloaded = await page.evaluate(recordView, {});
  expect(reloaded.viewer_id).toBe(first.viewer_id);
});

test("an invalid stored viewer ID is replaced with a generated one", async ({ page }) => {
  await page.evaluate((key) => localStorage.setItem(key, "not-a-uuid"), viewerIdKey);
  const event = await page.evaluate(recordView, {});
  expect(event.viewer_id).toMatch(uuidPattern);
  expect(await page.evaluate((key) => localStorage.getItem(key), viewerIdKey)).toBe(event.viewer_id);
});

test("storage errors fall back to an in-memory viewer ID for the page load", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    for (const method of ["getItem", "setItem"] as const) {
      Storage.prototype[method] = () => { throw new DOMException("blocked", "SecurityError"); };
    }
  });
  const first = await page.evaluate(recordView, {});
  const second = await page.evaluate(recordView, {});
  expect(first.event_name).toBe("chunkify.video.view_started");
  expect(first.viewer_id).toMatch(uuidPattern);
  expect(second.viewer_id).toBe(first.viewer_id);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.analyticsFixture));
  await page.evaluate(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true, get() { throw new DOMException("blocked", "SecurityError"); },
    });
  });
  const blocked = await page.evaluate(recordView, {});
  expect(blocked.viewer_id).toMatch(uuidPattern);
  expect(blocked.viewer_id).not.toBe(first.viewer_id);
  expect(errors).toEqual([]);
});

test("persistViewerId false never reads or writes storage", async ({ page }) => {
  const stored = "00000000-0000-4000-8000-000000000000";
  await page.evaluate(([key, value]) => {
    localStorage.setItem(key!, value!);
    const state = window as typeof window & { storageCalls: string[] };
    state.storageCalls = [];
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      const original = Storage.prototype[method] as (...args: unknown[]) => unknown;
      Storage.prototype[method] = function (this: Storage, ...args: unknown[]) {
        state.storageCalls.push(method);
        return original.apply(this, args);
      } as never;
    }
  }, [viewerIdKey, stored]);
  const first = await page.evaluate(recordView, { persistViewerId: false });
  const second = await page.evaluate(recordView, { persistViewerId: false });
  expect(first.viewer_id).toMatch(uuidPattern);
  expect(first.viewer_id).not.toBe(stored);
  expect(second.viewer_id).toBe(first.viewer_id);
  expect(await page.evaluate(() => (window as typeof window & { storageCalls: string[] }).storageCalls)).toEqual([]);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.analyticsFixture));
  const reloaded = await page.evaluate(recordView, { persistViewerId: false });
  expect(reloaded.viewer_id).toMatch(uuidPattern);
  expect(reloaded.viewer_id).not.toBe(first.viewer_id);
  expect(await page.evaluate((key) => localStorage.getItem(key), viewerIdKey)).toBe(stored);
});

test("userId is sent as user_id, accepts 256 Unicode characters, and accepts null", async ({ page }) => {
  for (const userId of ["a".repeat(256), "\u{1F600}".repeat(256)]) {
    expect((await page.evaluate(recordView, { userId })).user_id).toBe(userId);
  }
  expect((await page.evaluate(recordView, { userId: null })).user_id).toBeNull();
});

test("environment accepts null as not specified", async ({ page }) => {
  expect((await page.evaluate(recordView, { environment: null })).environment).toBeNull();
  expect((await page.evaluate(recordView, { environment: "staging" })).environment).toBe("staging");
});

test("videoTitle is truncated to 256 Unicode characters without splitting surrogate pairs", async ({ page }) => {
  const cases = [
    ["Short title", "Short title"],
    ["a".repeat(300), "a".repeat(256)],
    ["\u{1F600}".repeat(300), "\u{1F600}".repeat(256)],
    ["a".repeat(255) + "\u{1F600}\u{1F600}", "a".repeat(255) + "\u{1F600}"],
    [null, null],
  ];
  for (const [videoTitle, expected] of cases) {
    expect((await page.evaluate(recordView, { videoTitle })).video_title).toBe(expected);
  }
});

test("real video playback records source replacement, replay and cleanup without loading an engine or transport", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-real", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.src = "/tests/fixtures/media/video.mp4";
  });
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.video.readyState)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.analyticsFixture.events)).toEqual([]);
  await page.evaluate(() => window.analyticsFixture.video.play());
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.video.currentTime)).toBeGreaterThan(0.2);
  await page.evaluate(() => { window.analyticsFixture.video.src = "/tests/fixtures/media/video.mp4?replacement"; });
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.video.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.analyticsFixture.video.play());
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.video.currentTime)).toBeGreaterThan(0.2);
  await page.evaluate(() => {
    const video = window.analyticsFixture.video;
    video.currentTime = video.duration - 0.2;
  });
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.video.ended)).toBe(true);
  let events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.view_ended", "chunkify.video.view_started", "chunkify.video.view_ended",
  ]);
  expect(events[1]!.reason).toBe("source_changed");
  expect(events[3]!.reason).toBe("ended");
  for (const event of [events[1]!, events[3]!]) {
    expect(event.media_duration_seconds).toBeGreaterThan(5);
    expect(event.startup_time_ms).toBeGreaterThanOrEqual(0);
    expect(event.playing_time_ms).toBeGreaterThan(0);
  }
  await page.evaluate(() => window.analyticsFixture.video.play());
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.events.length)).toBe(5);
  await page.evaluate(() => window.analyticsFixture.session!.destroy());
  events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events[5]!.reason).toBe("destroyed");
  expect(new Set(events.filter((event) => event.sequence === 1).map((event) => event.view_id)).size).toBe(3);
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.pause();
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("ended"));
  });
  expect(await page.evaluate(() => window.analyticsFixture.events.length)).toBe(6);
  expect(requests.every((path) => path === "/tests/fixtures/media/video.mp4")).toBe(true);
});

test("an immediate attempt with a source child remains one view while its URL is selected", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.preload = "none";
    const source = document.createElement("source");
    source.src = "/tests/fixtures/media/video.mp4";
    f.video.append(source);
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-source", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.session.startAttempt();
    // Select the child source without waiting for browser-specific media decoding.
    Object.defineProperty(f.video, "currentSrc", { configurable: true, value: source.src });
    f.video.dispatchEvent(new Event("loadstart"));
    f.video.dispatchEvent(new Event("playing"));
    f.session.destroy();
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_started", "chunkify.video.view_ended"]);
  expect(events[1]).toMatchObject({ reason: "destroyed", startup_time_ms: expect.any(Number) });
});

test("an immediate attempt after replacing an idle source ignores the previous source's queued reset", async ({ page }) => {
  await page.evaluate(() => { window.analyticsFixture.video.src = "/tests/fixtures/media/video.mp4"; });
  await expect.poll(() => page.evaluate(() => window.analyticsFixture.video.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(async () => {
    const f = window.analyticsFixture;
    f.session = f.attachSummaryAnalytics(f.video, { videoId: "asset-replacement", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.src = "/tests/fixtures/media/video.mp4?immediate";
    f.session.startAttempt();
    await f.video.play();
    f.session.destroy();
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_started", "chunkify.video.view_ended"]);
  expect(events[1]).toMatchObject({ reason: "destroyed", startup_time_ms: expect.any(Number) });
});
