import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get("chunkify-player")))).toBe(true);
});

for (const [engine, source] of [
  ["native", "/tests/fixtures/media/video.mp4"],
  ["hlsjs", "/tests/fixtures/media/master.m3u8"],
] as const) {
  test(`${engine}: changing asset metadata preserves loaded playback`, async ({ page }) => {
    await page.evaluate(({ engine, source }) => {
      document.body.innerHTML = `<chunkify-player player="${engine}" src="${source}" muted playsinline></chunkify-player>`;
    }, { engine, source });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate(async (element: ChunkifyPlayer) => {
      const seeked = new Promise<void>((resolve) => element.addEventListener("seeked", () => resolve(), { once: true }));
      element.media.currentTime = 2;
      await seeked;
      element.addEventListener("emptied", () => { element.dataset.emptied = "true"; });
      element.addEventListener("loadstart", () => { element.dataset.reloaded = "true"; });
    });
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    for (const value of ["asset-first", "asset-second", ""]) {
      await player.evaluate((element: ChunkifyPlayer, value) => { element.assetId = value; }, value);
      await expect(player).toHaveAttribute("asset-id", value);
      expect(await player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeCloseTo(2, 1);
    }
    await player.evaluate((element: ChunkifyPlayer) => { element.setAttribute("asset-id", "asset-from-html"); });
    expect(await player.evaluate((element: ChunkifyPlayer) => element.assetId)).toBe("asset-from-html");
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeCloseTo(2, 1);
    await expect(player).not.toHaveAttribute("data-emptied");
    await expect(player).not.toHaveAttribute("data-reloaded");
    expect(requests.filter((url) => !url.includes("/tests/fixtures/media/"))).toEqual([]);
    await player.evaluate((element: ChunkifyPlayer) => element.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(2.2);
  });

  test(`${engine}: muted autoplay waits for a source and stops when it clears`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (/\/media\/|hls\.mjs/.test(request.url())) requests.push(request.url());
    });
    await page.evaluate(({ engine, source }) => {
      document.body.innerHTML = `<chunkify-player player="${engine}" autoplay muted playsinline></chunkify-player>`;
      const player = document.querySelector("chunkify-player")!;
      player.addEventListener("playing", () => { player.dataset.playing = "true"; });
    }, { engine, source });
    const player = page.locator("chunkify-player");
    await expect(page.getByRole("status")).toHaveText("No video source provided.");
    expect(requests).toEqual([]);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(true);
    await player.evaluate((element: ChunkifyPlayer, source) => { element.src = source; }, source);
    // No play() call or user gesture: the browser must honor muted autoplay itself.
    await expect(player).toHaveAttribute("data-playing", "true");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
    await player.evaluate((element: ChunkifyPlayer) => { element.src = null; });
    await expect(page.getByRole("status")).toHaveText("No video source provided.");
    expect(await player.evaluate((element: ChunkifyPlayer) => ({
      paused: element.media.paused, src: element.media.getAttribute("src"),
    }))).toEqual({ paused: true, src: null });
    await player.evaluate((element: ChunkifyPlayer, source) => { element.autoplay = false; element.src = source; }, source);
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(3);
    expect(await player.evaluate((element: ChunkifyPlayer) => ({
      paused: element.media.paused, currentTime: element.media.currentTime,
    }))).toEqual({ paused: true, currentTime: 0 });
  });

  test(`${engine}: looping restarts playback and can be disabled`, async ({ page }) => {
    await page.evaluate(({ engine, source }) => {
      const player = document.createElement("chunkify-player");
      Object.assign(player, { player: engine, src: source, muted: true, playsInline: true, loop: true });
      player.addEventListener("ended", () => { player.dataset.ended = "true"; });
      document.body.replaceChildren(player);
    }, { engine, source });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate(async (element: ChunkifyPlayer) => {
      const seeked = new Promise<void>((resolve) => element.addEventListener("seeked", () => resolve(), { once: true }));
      element.media.currentTime = element.media.duration - 0.4;
      await seeked;
      await element.media.play();
    });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeLessThan(1.5);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(false);
    await expect(player).not.toHaveAttribute("data-ended");
    await player.evaluate((element: ChunkifyPlayer) => {
      element.loop = false;
      element.media.currentTime = element.media.duration - 0.4;
    });
    await expect(player).not.toHaveAttribute("loop");
    await expect(player).toHaveAttribute("data-ended", "true");
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.ended)).toBe(true);
  });
}

test("asset IDs reflect between HTML and JavaScript without resolving a source", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.evaluate(() => {
    document.body.innerHTML = '<chunkify-player asset-id="asset-from-html"></chunkify-player>';
  });
  const player = page.locator("chunkify-player");
  expect(await player.evaluate((element: ChunkifyPlayer) => element.assetId)).toBe("asset-from-html");
  await player.evaluate((element: ChunkifyPlayer) => { element.assetId = "asset-from-js"; });
  await expect(player).toHaveAttribute("asset-id", "asset-from-js");
  for (const value of [null, undefined]) {
    await player.evaluate((element: ChunkifyPlayer) => { element.assetId = "temporary"; });
    await player.evaluate((element: ChunkifyPlayer, value) => { element.assetId = value; }, value);
    await expect(player).not.toHaveAttribute("asset-id");
    expect(await player.evaluate((element: ChunkifyPlayer) => element.assetId)).toBe("");
  }
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.getAttribute("src"))).toBeNull();
  expect(requests).toEqual([]);
});
