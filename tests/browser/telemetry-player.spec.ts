import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";
import type { ChunkifyPlayerTelemetryEvent } from "../../packages/telemetry/src/index.js";

test("monitor selects the video collector or Chunkify adapter from its target", async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.waitForFunction(() => Boolean(customElements.get("chunkify-player")));

  const result = await page.evaluate(async () => {
    const { monitor } = await import("@chunkify/telemetry");
    const videoEvents: ChunkifyPlayerTelemetryEvent[] = [];
    const playerEvents: ChunkifyPlayerTelemetryEvent[] = [];
    const video = document.createElement("video");
    const player: ChunkifyPlayer = document.createElement("chunkify-player");
    player.preload = "none";
    document.body.append(video, player);

    const videoSession = monitor(video, {
      videoId: "asset-video", provider: "callback", send(event) { videoEvents.push(event); },
    });
    const playerSession = monitor(player, {
      videoId: "asset-player", provider: "callback", send(event) { playerEvents.push(event); },
    });
    video.dispatchEvent(new Event("play"));
    player.media.dispatchEvent(new Event("play"));
    player.src = "/video.m3u8";
    player.media.dispatchEvent(new Event("play"));
    videoSession.destroy();
    playerSession.destroy();
    player.remove();
    video.remove();

    return {
      video: videoEvents.map((event) => [event.event_name, event.reason, event.video_id]),
      player: playerEvents.map((event) => [event.event_name, event.reason, event.video_id]),
    };
  });

  expect(result.video).toEqual([
    ["chunkify.video.view_started", null, "asset-video"],
    ["chunkify.video.view_ended", "destroyed", "asset-video"],
  ]);
  expect(result.player).toEqual([
    ["chunkify.video.view_started", null, "asset-player"],
    ["chunkify.video.view_ended", "source_changed", "asset-player"],
    ["chunkify.video.view_started", null, "asset-player"],
    ["chunkify.video.view_ended", "destroyed", "asset-player"],
  ]);
});

test("the standalone adapter follows Chunkify Player media replacements", async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.waitForFunction(() => Boolean(customElements.get("chunkify-player")));

  const result = await page.evaluate(async () => {
    const { attachPlayerTelemetry } = await import("@chunkify/telemetry/player");
    const events: ChunkifyPlayerTelemetryEvent[] = [];
    const player: ChunkifyPlayer = document.createElement("chunkify-player");
    player.preload = "none";
    document.body.append(player);
    const session = attachPlayerTelemetry(player, {
      videoId: "asset-adapter",
      provider: "callback",
      send(event) { events.push(event); },
    });

    const first = player.media;
    first.dispatchEvent(new Event("play"));
    player.src = "/video.m3u8";
    const second = player.media;
    second.dispatchEvent(new Event("play"));
    player.src = "/video.mp4";
    const third = player.media;
    third.dispatchEvent(new Event("play"));
    session.destroy();
    third.dispatchEvent(new Event("play"));
    player.remove();

    return {
      mediaKinds: [first.localName, second.localName, third.localName],
      events: events.map((event) => ({ name: event.event_name, reason: event.reason, video: event.video_id })),
    };
  });

  expect(result.mediaKinds).toEqual(["video", "hls-video", "video"]);
  expect(result.events).toEqual([
    { name: "chunkify.video.view_started", reason: null, video: "asset-adapter" },
    { name: "chunkify.video.view_ended", reason: "source_changed", video: "asset-adapter" },
    { name: "chunkify.video.view_started", reason: null, video: "asset-adapter" },
    { name: "chunkify.video.view_ended", reason: "source_changed", video: "asset-adapter" },
    { name: "chunkify.video.view_started", reason: null, video: "asset-adapter" },
    { name: "chunkify.video.view_ended", reason: "destroyed", video: "asset-adapter" },
  ]);
});

test("the adapter records real HLS playback and then MP4 playback", async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.waitForFunction(() => Boolean(customElements.get("chunkify-player")));
  await page.evaluate(async () => {
    const { attachPlayerTelemetry } = await import("@chunkify/telemetry/player");
    const state = window as typeof window & {
      telemetryEvents: ChunkifyPlayerTelemetryEvent[];
      telemetrySession: ReturnType<typeof attachPlayerTelemetry>;
    };
    state.telemetryEvents = [];
    const player = document.createElement("chunkify-player");
    player.muted = true;
    player.src = "/tests/fixtures/media/master.m3u8";
    document.body.append(player);
    state.telemetrySession = attachPlayerTelemetry(player, {
      videoId: "asset-real-playback",
      provider: "callback",
      send(event) { state.telemetryEvents.push(event); },
    });
  });

  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const hlsJsActive = await player.evaluate((element: ChunkifyPlayer) =>
    Boolean((element.media as ChunkifyPlayer["media"] & { api?: unknown }).api));
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { telemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).telemetryEvents.some((event) => event.event_name === "chunkify.video.view_started"))).toBe(true);

  await player.evaluate((element: ChunkifyPlayer) => { element.src = "/tests/fixtures/media/video.mp4"; });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.localName)).toBe("video");
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { telemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).telemetryEvents.filter((event) => event.event_name === "chunkify.video.view_started").length)).toBe(2);

  const events = await page.evaluate(() => {
    const state = window as typeof window & {
      telemetryEvents: ChunkifyPlayerTelemetryEvent[];
      telemetrySession: { destroy(): void };
    };
    state.telemetrySession.destroy();
    return state.telemetryEvents;
  });
  expect(events.map((event) => [event.event_name, event.reason])).toEqual([
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "source_changed"],
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "destroyed"],
  ]);
  if (hlsJsActive) {
    expect(events[1]).toMatchObject({
      connector_name: "hls.js",
      metrics: { selected_rendition_width: 256, selected_rendition_height: 144 },
    });
    expect(events[1]!.metrics.delivery_request_count).toBeGreaterThan(0);
    expect(events[1]!.metrics.delivery_transferred_bytes).toBeGreaterThan(0);
    expect(events[3]!.connector_name).toBe("html-media");
  }
});

test("an external hls.js instance enriches an ordinary video", async ({ page, browserName }) => {
  await page.goto("/tests/fixtures/player.html");
  const supported = await page.evaluate(async () => {
    const { Hls } = await import("hls-video-element");
    return Hls.isSupported();
  });
  test.skip(!supported, `hls.js MediaSource playback is unavailable in ${browserName}`);

  await page.evaluate(async () => {
    const { Hls } = await import("hls-video-element");
    const { attachHlsJsTelemetry } = await import("@chunkify/telemetry/hlsjs");
    const state = window as typeof window & {
      externalVideo: HTMLVideoElement;
      externalHls: InstanceType<typeof Hls>;
      externalEvents: ChunkifyPlayerTelemetryEvent[];
      externalSession: ReturnType<typeof attachHlsJsTelemetry>;
    };
    state.externalVideo = document.createElement("video");
    state.externalVideo.muted = true;
    document.body.append(state.externalVideo);
    state.externalHls = new Hls();
    state.externalEvents = [];
    state.externalSession = attachHlsJsTelemetry(state.externalHls, {
      videoId: "asset-external", provider: "callback",
      send(event) { state.externalEvents.push(event); },
    });
    state.externalSession.startAttempt();
    state.externalHls.attachMedia(state.externalVideo);
    state.externalHls.loadSource("/tests/fixtures/media/master.m3u8");
  });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { externalVideo: HTMLVideoElement }
  ).externalVideo.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (
    window as typeof window & { externalVideo: HTMLVideoElement }
  ).externalVideo.play());
  const events = await page.evaluate(() => {
    const state = window as typeof window & {
      externalEvents: ChunkifyPlayerTelemetryEvent[];
      externalSession: { destroy(): void };
      externalHls: { destroy(): void };
    };
    state.externalSession.destroy();
    state.externalHls.destroy();
    return state.externalEvents;
  });
  expect(events.map((event) => [event.event_name, event.reason])).toEqual([
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "destroyed"],
  ]);
  expect(events[1]).toMatchObject({
    connector_name: "hls.js",
    metrics: { selected_rendition_width: 256, selected_rendition_height: 144 },
  });
  expect(events[1]!.metrics.delivery_request_count).toBeGreaterThan(0);
});

test("the hls.js adapter follows media that was attached earlier or changes later", async ({ page, browserName }) => {
  await page.goto("/tests/fixtures/player.html");
  const supported = await page.evaluate(async () => {
    const { Hls } = await import("hls-video-element");
    return Hls.isSupported();
  });
  test.skip(!supported, `hls.js MediaSource playback is unavailable in ${browserName}`);

  const events = await page.evaluate(async () => {
    const { Hls } = await import("hls-video-element");
    const { attachHlsJsTelemetry } = await import("@chunkify/telemetry/hlsjs");
    const first = document.createElement("video");
    const second = document.createElement("video");
    document.body.append(first, second);
    const hls = new Hls();
    hls.attachMedia(first);
    const records: ChunkifyPlayerTelemetryEvent[] = [];
    const session = attachHlsJsTelemetry(hls, {
      videoId: "asset-reattach", provider: "callback", send(event) { records.push(event); },
    });
    first.dispatchEvent(new Event("play"));
    hls.detachMedia();
    hls.attachMedia(second);
    second.dispatchEvent(new Event("play"));
    hls.destroy();
    session.destroy();
    second.dispatchEvent(new Event("play"));
    return records;
  });
  expect(events.map((event) => [event.event_name, event.reason])).toEqual([
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "source_changed"],
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "destroyed"],
  ]);
});
