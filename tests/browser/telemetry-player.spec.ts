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
      assetId: "asset-video", provider: "callback", send(event) { videoEvents.push(event); },
    });
    const playerSession = monitor(player, {
      assetId: "asset-player", provider: "callback", send(event) { playerEvents.push(event); },
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
      video: videoEvents.map((event) => [event.event_name, event.reason, event.asset_id]),
      player: playerEvents.map((event) => [event.event_name, event.reason, event.asset_id]),
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
      assetId: "asset-adapter",
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
      events: events.map((event) => ({ name: event.event_name, reason: event.reason, asset: event.asset_id })),
    };
  });

  expect(result.mediaKinds).toEqual(["video", "hls-video", "video"]);
  expect(result.events).toEqual([
    { name: "chunkify.video.view_started", reason: null, asset: "asset-adapter" },
    { name: "chunkify.video.view_ended", reason: "source_changed", asset: "asset-adapter" },
    { name: "chunkify.video.view_started", reason: null, asset: "asset-adapter" },
    { name: "chunkify.video.view_ended", reason: "source_changed", asset: "asset-adapter" },
    { name: "chunkify.video.view_started", reason: null, asset: "asset-adapter" },
    { name: "chunkify.video.view_ended", reason: "destroyed", asset: "asset-adapter" },
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
      assetId: "asset-real-playback",
      provider: "callback",
      send(event) { state.telemetryEvents.push(event); },
    });
  });

  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
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
});
