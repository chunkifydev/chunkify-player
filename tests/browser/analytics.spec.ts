import { expect, test } from "@playwright/test";
import type { attachAnalytics, ChunkifyPlayerAnalyticsEvent, AnalyticsRendition, AnalyticsSession } from "../../packages/analytics/src/index.js";

declare global {
  interface Window {
    analyticsFixture: {
      attachAnalytics: typeof attachAnalytics;
      video: HTMLVideoElement;
      events: ChunkifyPlayerAnalyticsEvent[];
      session: AnalyticsSession | null;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/analytics.html");
  await page.waitForFunction(() => Boolean(window.analyticsFixture));
});

test("attachment stays idle and one playback attempt emits ordered start and end records", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, { videoId: "asset-test", destinations: [{ send: (event) => { f.events.push(event); } }] });
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

test("records intrinsic video size when it becomes available", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, { videoId: "asset-size", destinations: [{ send(event) { f.events.push(event); } }] });
    f.video.dispatchEvent(new Event("play"));
    Object.defineProperties(f.video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    f.video.dispatchEvent(new Event("ended"));
    f.session.destroy();
    return f.events;
  });
  expect(events[0]).toMatchObject({
    schema_version: 1,
    video_intrinsic_width_css_px: null, video_intrinsic_height_css_px: null,
  });
  expect(events[1]).toMatchObject({
    video_intrinsic_width_css_px: 1920, video_intrinsic_height_css_px: 1080,
  });
  expect(events[1]).not.toHaveProperty("metrics");
  expect(events[1]).not.toHaveProperty("player_width_css_px");
  expect(events[1]).not.toHaveProperty("player_height_css_px");
});

test("startup and playing time exclude loading, buffering, pauses and seeks", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, { videoId: "asset-timing", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-frame", destinations: [{ send(event) { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-frame-cancel", destinations: [{ send(event) { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, {
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
    f.session = f.attachAnalytics(f.video, {
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-metrics", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-snapshot", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, {
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
    f.session = f.attachAnalytics(f.video, {
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

test("sampling keeps a complete selected view and makes a fresh decision for replay", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    const state = window as typeof window & { restoreRandom: () => void };
    const decisions = [0.25, 0.75];
    const originalRandom = Math.random;
    state.restoreRandom = () => { Math.random = originalRandom; };
    Math.random = () => decisions.shift() ?? 1;
    f.session = f.attachAnalytics(f.video, {
      videoId: "asset-sampled", sampleRate: 0.5,
      destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(30000);
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.dispatchEvent(new Event("error"));
    f.video.dispatchEvent(new Event("ended"));
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(60000);
  const events = await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.dispatchEvent(new Event("error"));
    f.video.dispatchEvent(new Event("ended"));
    f.session!.destroy();
    (window as typeof window & { restoreRandom: () => void }).restoreRandom();
    return f.events;
  });
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started",
    "chunkify.video.view_snapshot",
    "chunkify.video.playback_error",
    "chunkify.video.view_ended",
  ]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  expect(new Set(events.map((event) => event.view_id)).size).toBe(1);
});

test("sample rates zero and one do not require a random decision", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    const state = window as typeof window & { restoreRandom: () => void };
    const originalRandom = Math.random;
    state.restoreRandom = () => { Math.random = originalRandom; };
    Math.random = () => { throw new Error("sampling should not need randomness"); };
    f.session = f.attachAnalytics(f.video, {
      videoId: "asset-none", sampleRate: 0,
      destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(60000);
  const result = await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.video.dispatchEvent(new Event("error"));
    f.video.dispatchEvent(new Event("ended"));
    f.session!.destroy();
    const excludedCount = f.events.length;
    f.session = f.attachAnalytics(f.video, {
      videoId: "asset-all", sampleRate: 1,
      destinations: [{ send: (event) => { f.events.push(event); } }],
    });
    f.session.startAttempt();
    f.session.destroy();
    (window as typeof window & { restoreRandom: () => void }).restoreRandom();
    return { excludedCount, events: f.events };
  });
  expect(result.excludedCount).toBe(0);
  expect(result.events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.view_ended",
  ]);
});

test("a media error stops an unfinished seek measurement", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, { videoId: "asset-seek-error", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
      f.session = f.attachAnalytics(f.video, { videoId: "asset-error", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-frames", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, {
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
    f.session = f.attachAnalytics(f.video, {
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
    f.session = f.attachAnalytics(f.video, {
      videoId: "asset-destroyed-connector", destinations: [{ send() {} }],
    });
    f.session.destroy();
    f.session.setConnector(connector);
    const afterDestroyed = { subscribed, cleaned };

    f.session = f.attachAnalytics(f.video, {
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-webkit-frames", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-no-frames", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-frame-failure", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-frame-reset", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-preload-error", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-delayed", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
      environment: "test", viewerId: "viewer-pseudonym",
      authorization: "must-not-leak", rawError: "must-not-leak",
      destinations: [{ send: (event: import("../../packages/analytics/src/index.js").ChunkifyPlayerAnalyticsEvent) => { f.events.push(event); } }],
    };
    f.session = f.attachAnalytics(f.video, options);
    f.session.startAttempt();
    f.session.destroy();
    return f.events;
  });
  expect(events).toHaveLength(2);
  for (const event of events) {
    expect(event).toMatchObject({
      schema_version: 1, video_id: "asset-private", delivery_hostname: "media.example.test",
      sdk_name: "@chunkify/analytics", sdk_version: "0.0.0",
      connector_name: "html-media", connector_version: "0.0.0",
      player_name: null, player_version: null, environment: "test", viewer_id: "viewer-pseudonym",
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-reset", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
      f.session = f.attachAnalytics(f.video, {
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
      { environment: { authorization: "secret" } }, { viewerId: { email: "private@example.test" } },
      { sampleRate: -0.1 }, { sampleRate: 1.1 }, { sampleRate: NaN }, { sampleRate: "1" }, { sampleRate: Infinity },
      { snapshotIntervalMs: 0 }, { snapshotIntervalMs: 999 }, { snapshotIntervalMs: 1500.5 },
      { snapshotIntervalMs: Infinity }, { snapshotIntervalMs: Number.MAX_SAFE_INTEGER },
      { snapshotIntervalMs: "10000" },
      { includeEvents: "view_started" }, { includeEvents: ["view_started", "unknown"] }]) {
      try {
        Reflect.apply(f.attachAnalytics, null, [f.video, {
          videoId: "asset-valid", destinations: [{ send: (event: ChunkifyPlayerAnalyticsEvent) => { f.events.push(event); } }], ...invalid,
        }]);
        failures.push(false);
      } catch (error) { failures.push(error instanceof TypeError); }
    }
    f.video.dispatchEvent(new Event("play"));
    return { failures, events: f.events };
  });
  expect(result).toEqual({ failures: Array(21).fill(true), events: [] });
});

test("real video playback records source replacement, replay and cleanup without loading an engine or transport", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.evaluate(() => {
    const f = window.analyticsFixture;
    f.session = f.attachAnalytics(f.video, { videoId: "asset-real", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-source", destinations: [{ send: (event) => { f.events.push(event); } }] });
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
    f.session = f.attachAnalytics(f.video, { videoId: "asset-replacement", destinations: [{ send: (event) => { f.events.push(event); } }] });
    f.video.src = "/tests/fixtures/media/video.mp4?immediate";
    f.session.startAttempt();
    await f.video.play();
    f.session.destroy();
  });
  const events = await page.evaluate(() => window.analyticsFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_started", "chunkify.video.view_ended"]);
  expect(events[1]).toMatchObject({ reason: "destroyed", startup_time_ms: expect.any(Number) });
});
