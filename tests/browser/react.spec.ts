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
  test(`React ${engine} waits for a source, replaces sources and cleans up on unmount`, async ({ page }) => {
    const sources: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === source) sources.push(request.url());
    });
    await page.evaluate(({ engine, source }) => window.reactFixture.render({
      src: null, player: engine, muted: true, controls: true,
      poster: "/tests/fixtures/media/poster.jpg", thumbnails: "/tests/fixtures/media/thumbnails/images.vtt",
    }), { engine, source });
    await expect(page.getByRole("status")).toHaveText("No video source provided.");
    expect(sources).toEqual([]);
    await page.evaluate(({ engine, source }) => window.reactFixture.render({
      src: source, player: engine, muted: true, playsInline: true,
    }), { engine, source });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.reactFixture.ref.current!.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
    await page.evaluate(({ engine, source }) => window.reactFixture.render({
      src: `${source}?replacement`, player: engine, muted: true, playsInline: true,
    }), { engine, source });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(true);
    expect(sources.some((url) => url.endsWith("?replacement"))).toBe(true);
    await page.evaluate(() => window.reactFixture.render({ src: null }));
    await expect(page.getByRole("status")).toHaveText("No video source provided.");
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
    src: "/tests/fixtures/media/master.m3u8", player: "hlsjs",
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

for (const [engine, source] of [
  ["native", "/tests/fixtures/media/video.mp4"],
  ["hlsjs", "/tests/fixtures/media/master.m3u8"],
] as const) {
  test(`React ${engine} event callbacks deliver native media events and update without duplicates`, async ({ page }) => {
    await page.evaluate(({ engine, source }) => {
      window.reactFixture.render({
        src: source, player: engine, muted: true,
        onLoadedMetadata(event) {
          document.body.dataset.metadata = String(event.currentTarget.media.duration > 0);
        },
        onPlay(event) {
          document.body.dataset.firstPlays = String(Number(document.body.dataset.firstPlays ?? 0) + 1);
          document.body.dataset.nativeEvent = String(event instanceof Event);
        },
      });
    }, { engine, source });
    const player = page.locator("chunkify-player");
    await expect(page.locator("body")).toHaveAttribute("data-metadata", "true");
    await page.evaluate(() => window.reactFixture.ref.current!.media.play());
    await expect(page.locator("body")).toHaveAttribute("data-first-plays", "1");
    await expect(page.locator("body")).toHaveAttribute("data-native-event", "true");
    await page.evaluate(({ engine, source }) => {
      window.reactFixture.ref.current!.media.pause();
      window.reactFixture.render({
        src: source, player: engine, muted: true,
        onPlay() { document.body.dataset.nextPlays = String(Number(document.body.dataset.nextPlays ?? 0) + 1); },
      });
    }, { engine, source });
    await page.evaluate(() => window.reactFixture.ref.current!.media.play());
    await expect(page.locator("body")).toHaveAttribute("data-next-plays", "1");
    await expect(page.locator("body")).toHaveAttribute("data-first-plays", "1");
    const oldPlayer = await player.elementHandle();
    await page.evaluate(() => window.reactFixture.render(null));
    await oldPlayer!.evaluate((element) => element.dispatchEvent(new Event("play")));
    await expect(page.locator("body")).toHaveAttribute("data-next-plays", "1");
  });
}

test("React receives safe startup errors and removes callbacks when omitted", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "javascript:secret-token",
    onPlaybackError(event) {
      document.body.dataset.error = JSON.stringify(event.detail);
      document.body.dataset.errors = String(Number(document.body.dataset.errors ?? 0) + 1);
      document.body.dataset.errorHost = String(event.currentTarget === window.reactFixture.ref.current);
    },
  }));
  await expect(page.locator("body")).toHaveAttribute("data-errors", "1");
  await expect(page.locator("body")).toHaveAttribute("data-error-host", "true");
  const error = await page.locator("body").getAttribute("data-error");
  expect(JSON.parse(error!)).toEqual({ code: "invalid-source", message: "Provide a valid HTTP or HTTPS video URL.", engine: null });
  expect(error).not.toContain("secret-token");
  await page.evaluate(() => window.reactFixture.render({ src: "javascript:different-secret" }));
  await expect(page.getByRole("status")).toHaveText("Provide a valid HTTP or HTTPS video URL.");
  await expect(page.locator("body")).toHaveAttribute("data-errors", "1");
});


test("the React example owns asset messages and mounts playback only when ready", async ({ page }) => {
  await page.goto("/examples/react/");
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const oldPlayer = await player.elementHandle();
  await page.getByLabel("Asset status").selectOption("preparing");
  await expect(player).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Your video is processing. Playback will appear when it is ready.");
  expect(await oldPlayer!.evaluate((element: ChunkifyPlayer) => ({
    connected: element.isConnected, src: element.media.getAttribute("src"), paused: element.media.paused,
  }))).toEqual({ connected: false, src: null, paused: true });
  await page.getByLabel("Asset status").selectOption("failed");
  await expect(page.getByRole("status")).toHaveText("Processing failed. Try another upload.");
  await expect(player).toHaveCount(0);
  await page.getByLabel("Asset status").selectOption("expired");
  await expect(page.getByRole("status")).toHaveText("This preview has expired.");
  await expect(player).toHaveCount(0);
  await page.getByLabel("Asset status").selectOption("ready");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
});
