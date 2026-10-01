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
    thumbnails: "/tests/fixtures/media/thumbnails.vtt",
    preload: "auto",
    crossOrigin: "anonymous",
    controls: true,
    muted: true,
    playsInline: true,
    autoSeekToLive: true,
    theme: "default",
    aspectRatio: "portrait",
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
      thumbnails: element?.thumbnails,
      crossOrigin: element?.crossOrigin,
      controls: element?.controls,
      autoSeekToLive: element?.autoSeekToLive,
      theme: element?.theme,
      aspectRatio: element?.aspectRatio,
      computedAspectRatio: element ? getComputedStyle(element).aspectRatio : null,
      tracks: element?.media.querySelectorAll(":scope > track").length,
    };
  })).toEqual({
    sameElement: true,
    mediaTag: "hls-video",
    poster: "/tests/fixtures/media/poster.jpg",
    thumbnails: "/tests/fixtures/media/thumbnails.vtt",
    crossOrigin: "anonymous",
    controls: true,
    autoSeekToLive: true,
    theme: "default",
    aspectRatio: "portrait",
    computedAspectRatio: "9 / 16",
    tracks: 1,
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

test("React forwards and removes an explicit source type", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    type: "application/vnd.apple.mpegurl",
  }));
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("type", "application/vnd.apple.mpegurl");
  expect(await player.evaluate((element: ChunkifyPlayer) => element.type)).toBe("application/vnd.apple.mpegurl");

  await page.evaluate(() => window.reactFixture.render({}));
  await expect(player).not.toHaveAttribute("type");
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

test("React forwards private-playback options and errors", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    credentials: "include",
    onPlaybackError(event) {
      document.body.dataset.playbackError = JSON.stringify(event.detail);
    },
  }));
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("credentials", "include");
  await player.evaluate((element: ChunkifyPlayer) => {
    element.dispatchEvent(new CustomEvent("playback-error", {
      detail: {
        code: "network-error",
        message: "The video could not load. Check the source URL and access permissions.",
        engine: "hlsjs",
      },
    }));
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-playback-error",
    /"code":"network-error".*"engine":"hlsjs"/,
  );
});

test("React can disable and restore the HLS rendition size cap", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
    capRenditionToPlayerSize: false,
  }));
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("cap-rendition-to-player-size", "false");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.capRenditionToPlayerSize))
    .toBe(false);

  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
  }));
  await expect(player).not.toHaveAttribute("cap-rendition-to-player-size");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.capRenditionToPlayerSize))
    .toBe(true);
});

test("React forwards and removes player colors", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    primaryColor: "#700cd4",
    secondaryColor: "#bb1111",
    accentColor: "#cf2626",
  }));
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("primary-color", "#700cd4");
  await expect(player).toHaveAttribute("secondary-color", "#bb1111");
  await expect(player).toHaveAttribute("accent-color", "#cf2626");
  expect(await player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector<HTMLElement>("[part=theme]");
    return {
      primary: theme?.style.getPropertyValue("--media-primary-color"),
      secondary: theme?.style.getPropertyValue("--media-secondary-color"),
      accent: theme?.style.getPropertyValue("--media-accent-color"),
    };
  })).toEqual({ primary: "#700cd4", secondary: "#bb1111", accent: "#cf2626" });

  await page.evaluate(() => window.reactFixture.render({}));
  await expect(player).not.toHaveAttribute("primary-color");
  await expect(player).not.toHaveAttribute("secondary-color");
  await expect(player).not.toHaveAttribute("accent-color");
});
