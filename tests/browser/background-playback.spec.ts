import { expect, test, type Page } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

async function startVideo(page: Page, source: string, analytics = false, playbackRate = 1) {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate(async ({ source, analytics }) => {
    const player = document.createElement("chunkify-player");
    player.muted = true;
    player.controls = true;
    player.src = source;
    document.body.append(player);
    if (analytics) {
      const { monitor } = await import("@chunkify/analytics");
      monitor(player, {
        videoId: "background-test",
        snapshotIntervalMs: 1000,
        destinations: [{ send(event) {
          if (event.event_name === "chunkify.video.playback_state_changed") {
            player.dataset.states = (player.dataset.states ?? "") + event.to_state + ",";
          }
          if (event.event_name === "chunkify.video.view_snapshot") {
            player.dataset.playingTime = String(event.playing_time_ms);
          }
        } }],
      });
    }
  }, { source, analytics });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((player: ChunkifyPlayer) => player.media.readyState))
    .toBeGreaterThanOrEqual(1);
  await player.evaluate((player: ChunkifyPlayer, rate) => {
    player.media.playbackRate = rate;
    return player.media.play();
  }, playbackRate);
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

  test(`${source}: recovers delayed and repeated browser pauses without reporting an analytics pause`, async ({ page }) => {
    const player = await startVideo(page, `/tests/fixtures/media/${source}`, true, 0.25);
    await player.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Keep the short fixture playing beyond the delayed pause seen in Chrome.
    await page.waitForTimeout(11_000);
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await player.evaluate((player: ChunkifyPlayer) => {
        const media = player.media as HTMLVideoElement & { nativeEl?: HTMLVideoElement };
        HTMLMediaElement.prototype.pause.call(media.nativeEl ?? media);
        return media.currentTime;
      });
      await expect.poll(() => player.evaluate((player: ChunkifyPlayer) => player.media.currentTime))
        .toBeGreaterThan(before + 0.3);
    }
    // Returning to the tab flushes a current snapshot even if background timers
    // were throttled by the browser.
    await player.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await player.getAttribute("data-states") ?? "").not.toContain("paused");
    expect(Number(await player.getAttribute("data-playing-time"))).toBeGreaterThan(11_000);

    await player.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await player.locator("media-control-bar media-play-button").first().click();
    await expect.poll(async () => (await player.getAttribute("data-states") ?? "")
      .split(",").filter((state) => state === "paused").length).toBe(1);
    await page.waitForTimeout(300);
    expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);
    await player.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(100);
    expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);
  });
}

test("recovers after a short advance but stops if playback stays suspended", async ({ page }) => {
  const player = await startVideo(page, "/tests/fixtures/media/video.mp4");
  await player.evaluate((player: ChunkifyPlayer) => {
    const media = player.media;
    const play = media.play;
    media.play = () => {
      player.dataset.attempts = String(Number(player.dataset.attempts ?? 0) + 1);
      return play.call(media);
    };
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(media, "currentTime", { configurable: true, writable: true, value: media.currentTime });
    HTMLMediaElement.prototype.pause.call(media);
  });
  await expect(player).toHaveAttribute("data-attempts", "1");
  await expect.poll(() => player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(false);
  await player.evaluate((player: ChunkifyPlayer) => {
    player.media.currentTime += 0.01;
    HTMLMediaElement.prototype.pause.call(player.media);
  });
  await expect(player).toHaveAttribute("data-attempts", "2");
  await expect.poll(() => player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(false);
  await player.evaluate((player: ChunkifyPlayer) => {
    HTMLMediaElement.prototype.pause.call(player.media);
  });
  await page.waitForTimeout(100);
  expect(await player.evaluate((player: ChunkifyPlayer) => player.media.paused)).toBe(true);
  await expect(player).toHaveAttribute("data-attempts", "2");
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
