import { expect, test, type Page } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

async function startVideo(page: Page, source: string) {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate((source) => {
    const player = document.createElement("chunkify-player");
    player.muted = true;
    player.src = source;
    document.body.append(player);
  }, source);
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((player: ChunkifyPlayer) => player.media.readyState))
    .toBeGreaterThanOrEqual(1);
  await player.evaluate((player: ChunkifyPlayer) => player.media.play());
  await expect.poll(() => player.evaluate((player: ChunkifyPlayer) => player.media.readyState))
    .toBeGreaterThanOrEqual(2);
  return player;
}

for (const source of ["video.mp4", "master.m3u8"]) {
  test(`${source}: keeps playing after the browser pauses on a tab switch`, async ({ page }) => {
    const player = await startVideo(page, `/tests/fixtures/media/${source}`);
    const before = await player.evaluate((player: ChunkifyPlayer) => {
      const media = player.media as HTMLVideoElement & { nativeEl?: HTMLVideoElement };
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      // Simulate a browser pause without calling the public application API.
      HTMLMediaElement.prototype.pause.call(media.nativeEl ?? media);
      return media.currentTime;
    });
    await expect.poll(() => player.evaluate((player: ChunkifyPlayer) => player.media.currentTime))
      .toBeGreaterThan(before + 0.1);
    expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(false);

    await player.evaluate((player: ChunkifyPlayer) => { player.media.pause(); });
    await page.waitForTimeout(300);
    expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);
  });

  test(`${source}: respects application pauses during and before a tab switch`, async ({ page }) => {
    const player = await startVideo(page, `/tests/fixtures/media/${source}`);
    await player.evaluate((player: ChunkifyPlayer) => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      player.media.pause();
    });
    await page.waitForTimeout(300);
    expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);

    await player.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);
  });
}

test("leaves later background pauses to the browser", async ({ page }) => {
  const player = await startVideo(page, "/tests/fixtures/media/video.mp4");
  await player.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(350);
  await player.evaluate((player: ChunkifyPlayer) => {
    HTMLMediaElement.prototype.pause.call(player.media);
  });
  await page.waitForTimeout(100);
  expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);
});

test("does not retry when the browser refuses background playback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const player = await startVideo(page, "/tests/fixtures/media/video.mp4");
  await player.evaluate((player: ChunkifyPlayer) => {
    player.media.play = () => {
      player.dataset.attempts = String(Number(player.dataset.attempts ?? 0) + 1);
      return Promise.reject(new DOMException("Background playback denied", "NotAllowedError"));
    };
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    HTMLMediaElement.prototype.pause.call(player.media);
  });
  await expect(player).toHaveAttribute("data-attempts", "1");
  await page.waitForTimeout(300);
  expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);
  expect(errors).toEqual([]);
});

for (const action of ["change source", "remove player"]) {
  test(`does not restart playback when hiding the tab and then ${action}`, async ({ page }) => {
    const player = await startVideo(page, "/tests/fixtures/media/video.mp4");
    const attempts = await player.evaluate(async (player: ChunkifyPlayer, action) => {
      let attempts = 0;
      const play = player.media.play;
      player.media.play = () => { attempts++; return play.call(player.media); };
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      if (action === "change source") player.src = "/tests/fixtures/media/video.mp4?changed";
      else player.remove();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return attempts;
    }, action);
    expect(attempts).toBe(0);
  });
}
