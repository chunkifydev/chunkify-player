import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/react.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.reactFixture))).toBe(true);
});

for (const [engine, source] of [
  ["native", "/tests/fixtures/media/video.mp4"],
  ["hlsjs", "/tests/fixtures/media/master.m3u8"],
] as const) {
  test(`React ${engine} respects readiness, replaces sources and cleans up on unmount`, async ({ page }) => {
    const sources: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === source) sources.push(request.url());
    });
    await page.evaluate(({ engine, source }) => window.reactFixture.render({
      status: "preparing", src: source, player: engine, muted: true, controls: true,
      poster: "/tests/fixtures/media/poster.jpg", thumbnails: "/tests/fixtures/media/thumbnails/images.vtt",
    }), { engine, source });
    await expect(page.getByRole("status")).toHaveText("Your video is being prepared.");
    expect(sources).toEqual([]);
    await page.evaluate(({ engine, source }) => window.reactFixture.render({
      status: "ready", src: source, player: engine, muted: true, playsInline: true,
    }), { engine, source });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.reactFixture.ref.current!.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
    await page.evaluate(({ engine, source }) => window.reactFixture.render({
      status: "ready", src: `${source}?replacement`, player: engine, muted: true, playsInline: true,
    }), { engine, source });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(true);
    expect(sources.some((url) => url.endsWith("?replacement"))).toBe(true);
    await page.evaluate(() => window.reactFixture.render({ status: "expired" }));
    await expect(page.getByRole("status")).toHaveText("This video has expired.");
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.getAttribute("src"))).toBeNull();
    await page.evaluate(({ engine, source }) => window.reactFixture.render({ src: source, player: engine, muted: true }), { engine, source });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    const oldPlayer = await player.elementHandle();
    await page.evaluate(() => window.reactFixture.render(null));
    expect(await page.evaluate(() => window.reactFixture.ref.current)).toBeNull();
    expect(await oldPlayer!.evaluate((element: ChunkifyPlayer) => ({
      connected: element.isConnected, src: element.media.getAttribute("src"), paused: element.media.paused,
    }))).toEqual({ connected: false, src: null, paused: true });
    await page.evaluate(({ engine, source }) => window.reactFixture.render({ src: source, player: engine, muted: true }), { engine, source });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    if (engine === "hlsjs") expect(sources).toHaveLength(4);
  });
}

test("unmounting while registration loads cannot initialize stale media", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (/\/media\/|hls\.mjs/.test(request.url())) requests.push(request.url()); });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let imported!: () => void;
  const loading = new Promise<void>((resolve) => { imported = resolve; });
  await page.route("**/packages/player/dist/index.js", async (route) => {
    imported();
    await gate;
    await route.continue();
  });
  await page.evaluate(() => window.reactFixture.render({ src: "/tests/fixtures/media/master.m3u8", player: "hlsjs" }));
  await loading;
  await page.evaluate(() => window.reactFixture.render(null));
  release();
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await expect(page.locator("chunkify-player")).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.reactFixture.ref.current)).toBeNull();
});

test("React callback refs replay safely in Strict Mode and clean up on removal", async ({ page }) => {
  await page.evaluate(() => {
    let setups = 0;
    let cleanups = 0;
    window.reactFixture.render({
      status: "preparing",
      ref(element) {
        if (!element) return;
        document.body.dataset.refSetups = String(++setups);
        document.body.dataset.refHasMedia = String(element.media instanceof HTMLVideoElement);
        return () => { document.body.dataset.refCleanups = String(++cleanups); };
      },
    });
  });
  await expect(page.locator("body")).toHaveAttribute("data-ref-setups", "2");
  await expect(page.locator("body")).toHaveAttribute("data-ref-cleanups", "1");
  await expect(page.locator("body")).toHaveAttribute("data-ref-has-media", "true");
  await page.evaluate(() => window.reactFixture.render(null));
  await expect(page.locator("body")).toHaveAttribute("data-ref-cleanups", "2");
});

test("React props start HLS playback and expose the component and video through a ref", async ({ page }) => {
  const manifests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("master.m3u8")) manifests.push(request.url());
  });
  await page.evaluate(() => window.reactFixture.render({
    status: "ready", src: "/tests/fixtures/media/master.m3u8", player: "hlsjs",
    controls: true, muted: true, playsInline: true,
  }));
  const player = page.locator("chunkify-player");
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => {
    const element = window.reactFixture.ref.current;
    return element === document.querySelector("chunkify-player") && element?.media instanceof HTMLVideoElement;
  })).toBe(true);
  await page.evaluate(() => window.reactFixture.ref.current!.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  expect(manifests).toHaveLength(1);
});

test("React media options update and clear without restarting the source", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/video.mp4", player: "native", muted: true, controls: true,
    autoPlay: true, loop: true, playsInline: true, assetId: "asset-react",
    poster: "/tests/fixtures/media/poster.jpg", thumbnails: "/tests/fixtures/media/thumbnails/images.vtt",
    credentials: "include", id: "react-player", className: "styled-player", "aria-label": "Training video",
  }));
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  await expect(player).toHaveAttribute("class", "styled-player");
  await expect(player).toHaveAttribute("aria-label", "Training video");
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    assetId: element.assetId, poster: element.poster, thumbnails: element.thumbnails,
    autoplay: element.autoplay, loop: element.loop, playsInline: element.playsInline, credentials: element.credentials,
  }))).toEqual({
    assetId: "asset-react", poster: "/tests/fixtures/media/poster.jpg",
    thumbnails: "/tests/fixtures/media/thumbnails/images.vtt", autoplay: true, loop: true, playsInline: true, credentials: "include",
  });
  await player.evaluate((element: ChunkifyPlayer) => {
    element.media.pause();
    element.addEventListener("loadstart", () => { element.dataset.reloaded = "true"; });
  });
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/video.mp4", player: "native", credentials: "include",
    assetId: "updated", autoPlay: false, loop: false, muted: false, controls: false, playsInline: false,
  }));
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    assetId: element.assetId, poster: element.poster, thumbnails: element.thumbnails,
    autoplay: element.autoplay, loop: element.loop, muted: element.media.muted,
    controls: element.controls, playsInline: element.media.hasAttribute("playsinline"),
  }))).toEqual({ assetId: "updated", poster: "", thumbnails: "", autoplay: false, loop: false,
    muted: false, controls: false, playsInline: false });
  await expect(player).not.toHaveAttribute("data-reloaded");
});

test("removing optional engine and boolean props restores their defaults", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/video.mp4", player: "native", autoPlay: false, controls: false,
    muted: false, loop: false, playsInline: false,
  }));
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.reactFixture.render({ src: "/tests/fixtures/media/video.mp4" }));
  await expect(page.getByRole("status")).toBeHidden();
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    engine: element.player, engineAttribute: element.getAttribute("player"),
    autoplay: element.autoplay, muted: element.muted, loop: element.loop,
    playsInline: element.playsInline, controls: element.controls,
  }))).toEqual({ engine: "auto", engineAttribute: "auto", autoplay: false, muted: false,
    loop: false, playsInline: false, controls: false });
});
