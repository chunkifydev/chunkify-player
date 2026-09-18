import { expect } from "@playwright/test";
import { test } from "../fixtures/private-media.js";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";
import type { ChunkifyPlayerTelemetryEvent } from "../../packages/player-telemetry/src/index.js";

test("hls.js switches to a lower resolution when delivery slows while preserving cookies", async ({ page, context, mediaServer }) => {
  test.setTimeout(60_000);
  await context.addCookies([{ name: "media_access", value: "fixture", url: mediaServer.origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate((origin) => {
    const state = window as typeof window & { adaptiveTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.adaptiveTelemetryEvents = [];
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      assetId: "asset-adaptive",
      player: "hlsjs",
      credentials: "include",
      muted: true,
      src: `${origin}/cookies/adaptive/master.m3u8`,
      telemetry: {
        provider: "callback",
        send: (event: ChunkifyPlayerTelemetryEvent) => { state.adaptiveTelemetryEvents.push(event); },
      },
    });
    player.addEventListener("playback-error", (event) => { player.dataset.error = event.detail.code; });
    document.body.append(player);
  }, mediaServer.origin);
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.videoWidth), { timeout: 15_000 }).toBe(256);
  mediaServer.bandwidthBytesPerSecond = 14_000;
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.videoWidth), { timeout: 25_000 }).toBe(128);
  // Restore delivery and finish the clip. The engine may retain the lower
  // rendition if it has already buffered the remaining short VOD.
  mediaServer.bandwidthBytesPerSecond = 128_000;
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.ended), { timeout: 25_000 }).toBe(true);
  await expect(player).not.toHaveAttribute("data-error");
  const telemetry = await page.evaluate(() => (
    window as typeof window & { adaptiveTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).adaptiveTelemetryEvents);
  const finalEvent = telemetry.find((event) => event.event_name === "chunkify.video.view_ended");
  expect(finalEvent).toMatchObject({
    connector_name: "hls.js",
    player_name: "hls.js",
    reason: "ended",
  });
  expect([
    [128, 72],
    [256, 144],
  ]).toContainEqual([
    finalEvent?.metrics.selected_rendition_width,
    finalEvent?.metrics.selected_rendition_height,
  ]);
  expect(finalEvent?.connector_version).toMatch(/^1\.7\./);
  expect(finalEvent?.player_version).toBe(finalEvent?.connector_version);
  expect(finalEvent?.metrics.rendition_switch_count).toBeGreaterThanOrEqual(1);
  expect(finalEvent?.metrics.delivery_request_count).toBeGreaterThan(0);
  expect(finalEvent?.metrics.delivery_transferred_bytes).toBeGreaterThan(0);
  expect(finalEvent?.metrics.delivery_throughput_bps).toBeGreaterThan(0);
  expect(mediaServer.requests.map((request) => request.path)).toEqual(expect.arrayContaining([
    "/cookies/adaptive/low/stream.m3u8", "/cookies/adaptive/high/stream.m3u8",
    "/cookies/adaptive/low/video.mp4", "/cookies/adaptive/high/video.mp4",
  ]));
  expect(mediaServer.requests.filter((request) => request.status >= 400 || !request.cookie.includes("media_access=fixture"))).toEqual([]);
});

for (const engine of ["native", "auto"] as const) {
  test(`${engine} plays and seeks a public multi-rendition master`, async ({ page, mediaServer }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/tests/fixtures/player.html");
    await page.evaluate(() => customElements.whenDefined("chunkify-player"));
    const nativeHls = await page.evaluate(() => Boolean(document.createElement("video").canPlayType("application/vnd.apple.mpegurl")));
    test.skip(engine === "native" && !nativeHls, "Browser has no native HLS");
    await page.evaluate(({ origin, engine }) => {
      const player = document.createElement("chunkify-player");
      Object.assign(player, { player: engine, muted: true, src: `${origin}/public/adaptive/master.m3u8` });
      player.addEventListener("playback-error", (event) => { player.dataset.error = event.detail.code; });
      document.body.append(player);
    }, { origin: mediaServer.origin, engine });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    expect([128, 256]).toContain(await player.evaluate((element: ChunkifyPlayer) => element.media.videoWidth));
    await player.evaluate((element: ChunkifyPlayer) => element.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
    await player.evaluate((element: ChunkifyPlayer) => { element.media.currentTime = 17; });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(17.1);
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.ended), { timeout: 10_000 }).toBe(true);
    await expect(player).not.toHaveAttribute("data-error");
    expect(requests.some((url) => url.endsWith("/hls.mjs"))).toBe(engine === "auto" && !nativeHls);
    expect(mediaServer.requests.some((request) => /\/(low|high)\/video\.mp4$/.test(request.path) && request.status === 206)).toBe(true);
    expect(mediaServer.requests.filter((request) => request.status >= 400)).toEqual([]);
    expect(requests.filter((url) => /^https?:/.test(url) && !["http://127.0.0.1:4173", mediaServer.origin].includes(new URL(url).origin))).toEqual([]);
  });
}
