import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";
import type { ChunkifyPlayerAnalyticsEvent } from "../../packages/analytics/src/index.js";

test("monitor selects the video collector or Chunkify adapter from its target", async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.waitForFunction(() => Boolean(customElements.get("chunkify-player")));

  const result = await page.evaluate(async () => {
    const { monitor } = await import("@chunkify/analytics");
    const videoEvents: ChunkifyPlayerAnalyticsEvent[] = [];
    const playerEvents: ChunkifyPlayerAnalyticsEvent[] = [];
    const video = document.createElement("video");
    const player: ChunkifyPlayer = document.createElement("chunkify-player");
    player.preload = "none";
    document.body.append(video, player);

    const videoSession = monitor(video, {
      videoId: "asset-video", send(event) { videoEvents.push(event); },
    });
    const playerSession = monitor(player, {
      videoId: "asset-player", send(event) { playerEvents.push(event); },
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

test("Chunkify Player analytics measure the host instead of its media element", async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.waitForFunction(() => Boolean(customElements.get("chunkify-player")));

  const result = await page.evaluate(async () => {
    const { monitor } = await import("@chunkify/analytics");
    const player: ChunkifyPlayer = document.createElement("chunkify-player");
    player.preload = "none";
    player.style.cssText = "width: 320px; height: 180px";
    document.body.append(player);
    const records: ChunkifyPlayerAnalyticsEvent[] = [];
    const session = monitor(player, { videoId: "asset-host-size", send(event) { records.push(event); } });
    player.media.style.width = "40px";
    player.media.dispatchEvent(new Event("play"));
    const mediaWidth = player.media.getBoundingClientRect().width;
    session.destroy();
    player.remove();
    return {
      hostWidth: records[0]?.player_width_css_px,
      mediaWidth,
      hostHeight: records[0]?.player_height_css_px,
    };
  });

  expect(result).toEqual({ hostWidth: 320, mediaWidth: 40, hostHeight: 180 });
});

test("the standalone adapter follows Chunkify Player media replacements", async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.waitForFunction(() => Boolean(customElements.get("chunkify-player")));

  const result = await page.evaluate(async () => {
    const { attachPlayerAnalytics } = await import("@chunkify/analytics/player");
    const events: ChunkifyPlayerAnalyticsEvent[] = [];
    const player: ChunkifyPlayer = document.createElement("chunkify-player");
    player.preload = "none";
    document.body.append(player);
    const session = attachPlayerAnalytics(player, {
      videoId: "asset-adapter",
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
    const { attachPlayerAnalytics } = await import("@chunkify/analytics/player");
    const state = window as typeof window & {
      analyticsEvents: ChunkifyPlayerAnalyticsEvent[];
      analyticsSession: ReturnType<typeof attachPlayerAnalytics>;
    };
    state.analyticsEvents = [];
    const player = document.createElement("chunkify-player");
    player.muted = true;
    player.src = "/tests/fixtures/media/master.m3u8";
    document.body.append(player);
    state.analyticsSession = attachPlayerAnalytics(player, {
      videoId: "asset-real-playback",
      send(event) { state.analyticsEvents.push(event); },
    });
  });

  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const hlsJsActive = await player.evaluate((element: ChunkifyPlayer) =>
    Boolean((element.media as ChunkifyPlayer["media"] & { api?: unknown }).api));
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { analyticsEvents: ChunkifyPlayerAnalyticsEvent[] }
  ).analyticsEvents.some((event) => event.event_name === "chunkify.video.view_started"))).toBe(true);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  const hlsFrameCallbacksAvailable = await player.evaluate((element: ChunkifyPlayer) =>
    typeof (element.media as HTMLVideoElement).requestVideoFrameCallback === "function");
  if (hlsFrameCallbacksAvailable) {
    await player.evaluate((element: ChunkifyPlayer) => new Promise<void>((resolve) => {
      (element.media as HTMLVideoElement).requestVideoFrameCallback(() => resolve());
    }));
  }

  await player.evaluate((element: ChunkifyPlayer) => { element.src = "/tests/fixtures/media/video.mp4"; });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.localName)).toBe("video");
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { analyticsEvents: ChunkifyPlayerAnalyticsEvent[] }
  ).analyticsEvents.filter((event) => event.event_name === "chunkify.video.view_started").length)).toBe(2);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  const mp4FrameCallbacksAvailable = await player.evaluate((element: ChunkifyPlayer) =>
    typeof (element.media as HTMLVideoElement).requestVideoFrameCallback === "function");
  if (mp4FrameCallbacksAvailable) {
    await player.evaluate((element: ChunkifyPlayer) => new Promise<void>((resolve) => {
      (element.media as HTMLVideoElement).requestVideoFrameCallback(() => resolve());
    }));
  }

  const events = await page.evaluate(() => {
    const state = window as typeof window & {
      analyticsEvents: ChunkifyPlayerAnalyticsEvent[];
      analyticsSession: { destroy(): void };
    };
    state.analyticsSession.destroy();
    return state.analyticsEvents;
  });
  expect(events.map((event) => [event.event_name, event.reason])).toEqual([
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "source_changed"],
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "destroyed"],
  ]);
  if (hlsFrameCallbacksAvailable) {
    expect(events[1]!.metrics.first_video_frame_time_ms).toBeGreaterThanOrEqual(0);
  }
  if (mp4FrameCallbacksAvailable) {
    expect(events[3]!.metrics.first_video_frame_time_ms).toBeGreaterThanOrEqual(0);
  }
  if (hlsJsActive) {
    expect(events[1]).toMatchObject({
      connector_name: "hls.js",
      metrics: { selected_rendition_width: 256, selected_rendition_height: 144 },
    });
    expect(events[1]!.metrics.delivery_request_count).toBeGreaterThan(0);
    expect(events[1]!.metrics.delivery_transferred_bytes).toBeGreaterThan(0);
    expect(events[1]!.metrics.rendition_playing_time).toEqual([
      expect.objectContaining({ width: 256, height: 144, playing_time_ms: expect.any(Number) }),
    ]);
    expect(events[1]!.metrics.rendition_playing_time![0]!.playing_time_ms).toBeGreaterThan(0);
    expect(events[3]!.connector_name).toBe("html-media");
  }
  expect(events[1]!.metrics.video_intrinsic_width_css_px).toBeGreaterThan(0);
  expect(events[1]!.metrics.video_intrinsic_height_css_px).toBeGreaterThan(0);
  expect(events[3]!.metrics.video_intrinsic_width_css_px).toBeGreaterThan(0);
  expect(events[3]!.metrics.video_intrinsic_height_css_px).toBeGreaterThan(0);
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
    const { monitorHlsJs } = await import("@chunkify/analytics/hlsjs");
    const state = window as typeof window & {
      externalVideo: HTMLVideoElement;
      externalHls: InstanceType<typeof Hls>;
      externalEvents: ChunkifyPlayerAnalyticsEvent[];
      externalSession: ReturnType<typeof monitorHlsJs>;
    };
    state.externalVideo = document.createElement("video");
    state.externalVideo.muted = true;
    document.body.append(state.externalVideo);
    state.externalHls = new Hls();
    state.externalEvents = [];
    state.externalSession = monitorHlsJs(state.externalHls, {
      videoId: "asset-external",
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
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { externalVideo: HTMLVideoElement }
  ).externalVideo.currentTime)).toBeGreaterThan(0.1);
  const events = await page.evaluate(() => {
    const state = window as typeof window & {
      externalEvents: ChunkifyPlayerAnalyticsEvent[];
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
  expect(events[1]!.metrics.rendition_playing_time).toEqual([
    expect.objectContaining({ width: 256, height: 144, playing_time_ms: expect.any(Number) }),
  ]);
  expect(events[1]!.metrics.rendition_playing_time![0]!.playing_time_ms).toBeGreaterThan(0);
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
    const { monitorHlsJs } = await import("@chunkify/analytics/hlsjs");
    const first = document.createElement("video");
    const second = document.createElement("video");
    document.body.append(first, second);
    const hls = new Hls();
    hls.attachMedia(first);
    const records: ChunkifyPlayerAnalyticsEvent[] = [];
    const session = monitorHlsJs(hls, {
      videoId: "asset-reattach", send(event) { records.push(event); },
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
