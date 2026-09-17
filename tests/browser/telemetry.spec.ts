import { expect, test } from "@playwright/test";
import type { attachTelemetry, ChunkifyPlayerTelemetryEvent, TelemetrySession } from "../../packages/player-telemetry/src/index.js";

declare global {
  interface Window {
    telemetryFixture: {
      attachTelemetry: typeof attachTelemetry;
      video: HTMLVideoElement;
      events: ChunkifyPlayerTelemetryEvent[];
      session: TelemetrySession | null;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/telemetry.html");
  await page.waitForFunction(() => Boolean(window.telemetryFixture));
});

test("attachment stays idle and one playback attempt emits ordered start and end records", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.session = f.attachTelemetry(f.video, { assetId: "asset-test", provider: "callback", send: (event) => { f.events.push(event); } });
    f.video.dispatchEvent(new Event("loadedmetadata"));
  });
  expect(await page.evaluate(() => window.telemetryFixture.events)).toEqual([]);
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
    f.video.dispatchEvent(new Event("ended"));
    f.session!.destroy();
  });
  const events = await page.evaluate(() => window.telemetryFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_started", "chunkify.video.view_ended"]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  expect(events[0]!.view_id).toBe(events[1]!.view_id);
  expect(events[0]!.event_id).not.toBe(events[1]!.event_id);
});

test("startup and playing time exclude loading, buffering, pauses and seeks", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.session = f.attachTelemetry(f.video, { assetId: "asset-timing", provider: "callback", send: (event) => { f.events.push(event); } });
  });
  const dispatch = (event: string) => page.evaluate((event) => window.telemetryFixture.video.dispatchEvent(new Event(event)), event);
  await dispatch("play");
  await page.clock.runFor(2000);
  await dispatch("playing");
  await page.clock.runFor(3000);
  await dispatch("waiting");
  await page.clock.runFor(4000);
  await dispatch("playing");
  await page.clock.runFor(1000);
  await dispatch("pause");
  await page.clock.runFor(5000);
  await dispatch("play");
  await page.clock.runFor(1000);
  await dispatch("playing");
  await page.clock.runFor(2000);
  await dispatch("seeking");
  await page.clock.runFor(3000);
  await dispatch("seeked");
  await page.clock.runFor(1000);
  await dispatch("playing");
  await page.clock.runFor(2000);
  await dispatch("error");
  await page.clock.runFor(5000);
  await dispatch("ended");
  const events = await page.evaluate(() => window.telemetryFixture.events);
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ metrics: { startup_time_ms: 2000, playing_time_ms: 8000 } });
});

test("records use the versioned contract and exclude URLs and unrelated configuration", async ({ page }) => {
  const events = await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.video.preload = "none";
    f.video.src = "https://media.example.test/private/path/master.m3u8?token=must-not-leak";
    const options = {
      assetId: "asset-private", provider: "callback" as const,
      environment: "test", viewerId: "viewer-pseudonym",
      authorization: "must-not-leak", rawError: "must-not-leak",
      send: (event: import("../../packages/player-telemetry/src/index.js").ChunkifyPlayerTelemetryEvent) => { f.events.push(event); },
    };
    f.session = f.attachTelemetry(f.video, options);
    f.session.startAttempt();
    f.session.destroy();
    return f.events;
  });
  expect(events).toHaveLength(2);
  for (const event of events) {
    expect(event).toMatchObject({
      schema_version: 1, asset_id: "asset-private", delivery_hostname: "media.example.test",
      sdk_name: "@chunkify/player-telemetry", sdk_version: "0.0.0",
      connector_name: "html-media", connector_version: "0.0.0",
      player_name: null, player_version: null, environment: "test", viewer_id: "viewer-pseudonym",
      metrics: { media_duration_seconds: null, startup_time_ms: null, playing_time_ms: 0 },
    });
    expect(event).toHaveProperty("occurred_at", expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  }
  expect(events[1]).toMatchObject({ reason: "destroyed" });
  const serialized = JSON.stringify(events);
  for (const excluded of ["https://", "/private/path", "must-not-leak", "authorization", "rawError"]) {
    expect(serialized).not.toContain(excluded);
  }
});

test("source resets and page exit end separate views, and destroy removes observation", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.session = f.attachTelemetry(f.video, { assetId: "asset-reset", provider: "callback", send: (event) => { f.events.push(event); } });
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(1000);
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.video.dispatchEvent(new Event("emptied"));
    f.video.dispatchEvent(new Event("loadstart"));
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("playing"));
  });
  await page.clock.runFor(500);
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    f.session!.destroy();
    f.session!.destroy();
    f.session!.startAttempt();
    for (const event of ["play", "playing", "ended"]) f.video.dispatchEvent(new Event(event));
  });
  const events = await page.evaluate(() => window.telemetryFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.view_ended", "chunkify.video.view_started", "chunkify.video.view_ended",
  ]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 1, 2]);
  expect(events[1]).toMatchObject({ reason: "source_changed", metrics: { playing_time_ms: 1000 } });
  expect(events[3]).toMatchObject({ reason: "page_exit", metrics: { playing_time_ms: 500 } });
  expect(events[0]!.view_id).not.toBe(events[2]!.view_id);
  expect(new Set(events.map((event) => event.event_id)).size).toBe(4);
});

test("callback failures and reentrant cleanup cannot escape or duplicate final records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const counts = await page.evaluate(async () => {
    const f = window.telemetryFixture;
    const counts: number[] = [];
    for (const mode of ["throw", "reject", "destroy"]) {
      f.events = [];
      f.session = f.attachTelemetry(f.video, {
        assetId: "asset-callback", provider: "callback",
        send(event) {
          f.events.push(event);
          if (mode === "throw") throw new Error("destination unavailable");
          if (mode === "reject") return Promise.reject(new Error("destination unavailable"));
          if (event.event_name === "chunkify.video.view_ended") f.session!.destroy();
        },
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
    const f = window.telemetryFixture;
    const failures: boolean[] = [];
    for (const invalid of [{ assetId: "" }, { assetId: "  " }, { provider: "unknown" }, { send: null },
      { environment: { authorization: "secret" } }, { viewerId: { email: "private@example.test" } }]) {
      try {
        Reflect.apply(f.attachTelemetry, null, [f.video, {
          assetId: "asset-valid", provider: "callback", send: (event: ChunkifyPlayerTelemetryEvent) => { f.events.push(event); }, ...invalid,
        }]);
        failures.push(false);
      } catch (error) { failures.push(error instanceof TypeError); }
    }
    f.video.dispatchEvent(new Event("play"));
    return { failures, events: f.events };
  });
  expect(result).toEqual({ failures: [true, true, true, true, true, true], events: [] });
});

test("real video playback records source replacement, replay and cleanup without loading an engine or transport", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.session = f.attachTelemetry(f.video, { assetId: "asset-real", provider: "callback", send: (event) => { f.events.push(event); } });
    f.video.src = "/tests/fixtures/media/video.mp4";
  });
  await expect.poll(() => page.evaluate(() => window.telemetryFixture.video.readyState)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.telemetryFixture.events)).toEqual([]);
  await page.evaluate(() => window.telemetryFixture.video.play());
  await expect.poll(() => page.evaluate(() => window.telemetryFixture.video.currentTime)).toBeGreaterThan(0.2);
  await page.evaluate(() => { window.telemetryFixture.video.src = "/tests/fixtures/media/video.mp4?replacement"; });
  await expect.poll(() => page.evaluate(() => window.telemetryFixture.video.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.telemetryFixture.video.play());
  await expect.poll(() => page.evaluate(() => window.telemetryFixture.video.currentTime)).toBeGreaterThan(0.2);
  await page.evaluate(() => {
    const video = window.telemetryFixture.video;
    video.currentTime = video.duration - 0.2;
  });
  await expect.poll(() => page.evaluate(() => window.telemetryFixture.video.ended)).toBe(true);
  let events = await page.evaluate(() => window.telemetryFixture.events);
  expect(events.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.view_ended", "chunkify.video.view_started", "chunkify.video.view_ended",
  ]);
  expect(events[1]!.reason).toBe("source_changed");
  expect(events[3]!.reason).toBe("ended");
  for (const event of [events[1]!, events[3]!]) {
    expect(event.metrics.media_duration_seconds).toBeGreaterThan(5);
    expect(event.metrics.startup_time_ms).toBeGreaterThanOrEqual(0);
    expect(event.metrics.playing_time_ms).toBeGreaterThan(0);
  }
  await page.evaluate(() => window.telemetryFixture.video.play());
  await expect.poll(() => page.evaluate(() => window.telemetryFixture.events.length)).toBe(5);
  await page.evaluate(() => window.telemetryFixture.session!.destroy());
  events = await page.evaluate(() => window.telemetryFixture.events);
  expect(events[5]!.reason).toBe("destroyed");
  expect(new Set(events.filter((event) => event.sequence === 1).map((event) => event.view_id)).size).toBe(3);
  await page.evaluate(() => {
    const f = window.telemetryFixture;
    f.video.pause();
    f.video.dispatchEvent(new Event("play"));
    f.video.dispatchEvent(new Event("ended"));
  });
  expect(await page.evaluate(() => window.telemetryFixture.events.length)).toBe(6);
  expect(requests.every((path) => path === "/tests/fixtures/media/video.mp4")).toBe(true);
});

test("an immediate attempt with a source child remains one view while its URL is selected", async ({ page }) => {
  await page.evaluate(async () => {
    const f = window.telemetryFixture;
    f.video.preload = "none";
    const source = document.createElement("source");
    source.src = "/tests/fixtures/media/video.mp4";
    f.video.append(source);
    f.session = f.attachTelemetry(f.video, { assetId: "asset-source", provider: "callback", send: (event) => { f.events.push(event); } });
    f.session.startAttempt();
    await f.video.play();
    f.session.destroy();
  });
  const events = await page.evaluate(() => window.telemetryFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_started", "chunkify.video.view_ended"]);
  expect(events[1]).toMatchObject({ reason: "destroyed", metrics: { startup_time_ms: expect.any(Number) } });
});

test("an immediate attempt after replacing an idle source ignores the previous source's queued reset", async ({ page }) => {
  await page.evaluate(() => { window.telemetryFixture.video.src = "/tests/fixtures/media/video.mp4"; });
  await expect.poll(() => page.evaluate(() => window.telemetryFixture.video.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(async () => {
    const f = window.telemetryFixture;
    f.session = f.attachTelemetry(f.video, { assetId: "asset-replacement", provider: "callback", send: (event) => { f.events.push(event); } });
    f.video.src = "/tests/fixtures/media/video.mp4?immediate";
    f.session.startAttempt();
    await f.video.play();
    f.session.destroy();
  });
  const events = await page.evaluate(() => window.telemetryFixture.events);
  expect(events.map((event) => event.event_name)).toEqual(["chunkify.video.view_started", "chunkify.video.view_ended"]);
  expect(events[1]).toMatchObject({ reason: "destroyed", metrics: { startup_time_ms: expect.any(Number) } });
});
