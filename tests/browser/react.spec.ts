import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/react.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.reactFixture))).toBe(true);
});

test("React props configure playback and expose the player through a ref", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
    poster: "/tests/fixtures/media/poster.jpg",
    preload: "auto",
    crossOrigin: "anonymous",
    controls: true,
    muted: true,
    playsInline: true,
    className: "customer-player",
  }));

  const player = page.locator("chunkify-player");
  await expect(player).toHaveClass("customer-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => {
    const element = window.reactFixture.ref.current;
    return {
      sameElement: element === document.querySelector("chunkify-player"),
      mediaTag: element?.media.localName,
      poster: element?.poster,
      crossOrigin: element?.crossOrigin,
      controls: element?.controls,
    };
  })).toEqual({
    sameElement: true,
    mediaTag: "hls-video",
    poster: "/tests/fixtures/media/poster.jpg",
    crossOrigin: "anonymous",
    controls: true,
  });
});

test("React updates callbacks and switches between HLS and MP4", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
    muted: true,
    onPlay() { document.body.dataset.firstPlays = "1"; },
  }));
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.reactFixture.ref.current!.media.play());
  await expect(page.locator("body")).toHaveAttribute("data-first-plays", "1");

  await page.evaluate(() => {
    window.reactFixture.ref.current!.media.pause();
    window.reactFixture.render({
      src: "/tests/fixtures/media/video.mp4",
      muted: true,
      onPlay(event) {
        document.body.dataset.nextPlays = "1";
        document.body.dataset.eventTarget = String(event.currentTarget === window.reactFixture.ref.current);
      },
    });
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.localName)).toBe("video");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => window.reactFixture.ref.current!.media.play());
  await expect(page.locator("body")).toHaveAttribute("data-next-plays", "1");
  await expect(page.locator("body")).toHaveAttribute("data-event-target", "true");
});

test("React unmount clears the ref and stops playback", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
    muted: true,
  }));
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const oldPlayer = await player.elementHandle();
  await page.evaluate(() => window.reactFixture.render(null));
  expect(await page.evaluate(() => window.reactFixture.ref.current)).toBeNull();
  expect(await oldPlayer!.evaluate((element: ChunkifyPlayer) => ({
    connected: element.isConnected,
    source: element.media.getAttribute("src"),
    paused: element.media.paused,
  }))).toEqual({ connected: false, source: null, paused: true });
});

test("React callback refs clean up in Strict Mode", async ({ page }) => {
  await page.evaluate(() => {
    let setups = 0;
    let cleanups = 0;
    window.reactFixture.render({
      ref(element) {
        if (!element) return;
        document.body.dataset.refSetups = String(++setups);
        return () => { document.body.dataset.refCleanups = String(++cleanups); };
      },
    });
  });
  await expect(page.locator("body")).toHaveAttribute("data-ref-setups", "2");
  await expect(page.locator("body")).toHaveAttribute("data-ref-cleanups", "1");
  await page.evaluate(() => window.reactFixture.render(null));
  await expect(page.locator("body")).toHaveAttribute("data-ref-cleanups", "2");
});
