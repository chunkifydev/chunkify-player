import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
});

test("uses hls-video for HLS and video for ordinary media", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player
      src="/tests/fixtures/media/master.m3u8" controls muted playsinline></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    tag: element.media.localName,
    nativeControls: element.media.controls,
    themedControls: element.shadowRoot?.querySelector("media-theme-demuxed-2022")?.hasAttribute("controls"),
    muted: element.media.muted,
    playsInline: element.media.hasAttribute("playsinline"),
  }))).toEqual({ tag: "hls-video", nativeControls: false, themedControls: true, muted: true, playsInline: true });
  await player.evaluate((element: ChunkifyPlayer) => { element.muted = false; });
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.muted)).toBe(false);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);

  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/video.mp4";
  });
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    tag: element.media.localName,
    source: new URL(element.media.currentSrc || element.media.src).pathname,
  }))).toEqual({ tag: "video", source: "/tests/fixtures/media/video.mp4" });
});

test("reflects standard video options and forwards media events", async ({ page }) => {
  await page.evaluate(() => {
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      src: "/tests/fixtures/media/video.mp4",
      poster: "/tests/fixtures/media/poster.jpg",
      preload: "auto",
      crossOrigin: "anonymous",
      controls: true,
      muted: true,
    });
    player.addEventListener("loadedmetadata", () => { player.dataset.loaded = "true"; });
    document.body.append(player);
  });
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("data-loaded", "true");
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    src: new URL(element.media.currentSrc || element.media.src).pathname,
    poster: new URL(element.media.poster).pathname,
    preload: element.media.preload,
    crossOrigin: element.media.crossOrigin,
    nativeControls: element.media.controls,
    themedControls: element.shadowRoot?.querySelector("media-theme-demuxed-2022")?.hasAttribute("controls"),
    muted: element.media.muted,
  }))).toEqual({
    src: "/tests/fixtures/media/video.mp4",
    poster: "/tests/fixtures/media/poster.jpg",
    preload: "auto",
    crossOrigin: "anonymous",
    nativeControls: false,
    themedControls: true,
    muted: true,
  });
  await player.evaluate((element: ChunkifyPlayer) => { element.muted = false; });
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    hostMuted: element.muted,
    mediaMuted: element.media.muted,
  }))).toEqual({ hostMuted: false, mediaMuted: false });
});

test("exposes stable theme variables and CSS parts", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player controls style="
      --chunkify-player-accent-color: rgb(167, 139, 250);
      --chunkify-player-border-radius: 18px;
    "></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  expect(await player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("media-theme-demuxed-2022");
    return {
      radius: getComputedStyle(element).borderRadius,
      accent: theme ? getComputedStyle(theme).getPropertyValue("--media-accent-color").trim() : null,
      mediaPart: element.media.getAttribute("part"),
      themePart: theme?.getAttribute("part"),
    };
  })).toEqual({ radius: "18px", accent: "rgb(167, 139, 250)", mediaPart: "media", themePart: "theme" });
});

for (const source of ["/tests/fixtures/media/master.m3u8", "/tests/fixtures/media/video.mp4"]) {
  test(`clearing ${source.endsWith("m3u8") ? "HLS" : "MP4"} stops playback and leaves an idle video`, async ({ page }) => {
    await page.evaluate((source) => {
      document.body.innerHTML = `<chunkify-player src="${source}" muted></chunkify-player>`;
    }, source);
    const player = page.locator("chunkify-player");
    const minimumReadyState = source.endsWith(".m3u8") ? 2 : 1;
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(minimumReadyState);
    await player.evaluate((element: ChunkifyPlayer) => { element.src = null; });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBe(0);
    expect(await player.evaluate((element: ChunkifyPlayer) => ({
      tag: element.media.localName,
      src: element.media.getAttribute("src"),
      paused: element.media.paused,
    }))).toEqual({ tag: "video", src: null, paused: true });
  });
}

test("option changes preserve native playback state", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = '<chunkify-player src="/tests/fixtures/media/video.mp4" muted></chunkify-player>';
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(1);
  await player.evaluate(async (element: ChunkifyPlayer) => {
    await element.media.play();
    element.media.muted = false;
    element.media.addEventListener("loadstart", () => { element.dataset.reloaded = "true"; });
    element.controls = true;
    element.poster = "/tests/fixtures/media/poster.jpg";
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    muted: element.media.muted,
    paused: element.media.paused,
    reloaded: element.dataset.reloaded ?? null,
  }))).toEqual({ muted: false, paused: false, reloaded: null });
});

test("removing a newly connected HLS player cannot start a late engine", async ({ page }) => {
  expect(await page.evaluate(async () => {
    const player = document.createElement("chunkify-player");
    player.src = "/tests/fixtures/media/master.m3u8";
    document.body.append(player);
    const media = player.media as HTMLVideoElement & { api?: unknown };
    player.remove();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { source: media.getAttribute("src"), hasEngine: Boolean(media.api) };
  })).toEqual({ source: null, hasEngine: false });
});
