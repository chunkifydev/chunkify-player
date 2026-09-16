import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

const thumbnails = "/tests/fixtures/media/thumbnails/images.vtt";

async function openPlayer(page: Page, attributes = "") {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate((attributes) => {
    document.body.innerHTML = `<chunkify-player controls muted playsinline
      src="/tests/fixtures/media/video.mp4" ${attributes}></chunkify-player>`;
  }, attributes);
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  return player;
}

async function hoverTime(page: Page, time: number) {
  const slider = page.getByRole("slider", { name: "seek", exact: true });
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box) throw new Error("Seek bar is not visible");
  await page.mouse.move(box.x + box.width * time / 6, box.y + box.height / 2);
}

test("seek previews select the right image and crop across multiple relative sprites", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openPlayer(page, `thumbnails="${thumbnails}"`);
  await expect.poll(() => requests.some((url) => url.endsWith("images.vtt"))).toBe(true);
  const preview = page.locator("media-preview-thumbnail").first();
  for (const [time, sprite, crop] of [
    [0.5, "sprite01.jpg", "0 0 160 90"],
    [3.5, "sprite01.jpg", "160 90 160 90"],
    [4.5, "sprite02.jpg", "0 0 160 90"],
    [5.5, "sprite02.jpg", "160 0 160 90"],
  ] as const) {
    await expect(async () => {
      await hoverTime(page, time);
      await expect(preview).toBeVisible();
      await expect(preview.locator("img")).toHaveAttribute("src", new RegExp(`/thumbnails/${sprite}$`));
      await expect(preview).toHaveAttribute("mediapreviewcoords", crop);
      await expect.poll(() => preview.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
      await expect.poll(() => preview.locator("img").evaluate((image: HTMLImageElement) => image.getBoundingClientRect().width)).toBeCloseTo(320, 0);
    }).toPass({ timeout: 5000 });
    await preview.screenshot({ path: testInfo.outputPath(`preview-${time}.png`), animations: "disabled" });
    if (time === 0.5) await page.screenshot({ path: testInfo.outputPath("page-preview.png"), animations: "disabled" });
  }
  expect(requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== "http://127.0.0.1:4173")).toEqual([]);
});

test("cross-origin VTT and sprites work without changing the video's CORS mode", async ({ page }) => {
  const origin = "http://localhost:4173";
  await page.route(`${origin}/previews/**`, async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    await route.fulfill({
      body: await readFile(`tests/fixtures/media/thumbnails/${file}`),
      contentType: file.endsWith(".vtt") ? "text/vtt" : "image/jpeg",
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  const player = await openPlayer(page, `thumbnails="${origin}/previews/images.vtt"`);
  const preview = page.locator("media-preview-thumbnail").first();
  await expect(async () => {
    await hoverTime(page, 4.5);
    await expect(preview.locator("img")).toHaveAttribute("src", `${origin}/previews/sprite02.jpg`);
    await expect.poll(() => preview.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
  }).toPass({ timeout: 5000 });
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.crossOrigin)).toBeNull();
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0);
});

test("replacing and clearing thumbnails removes stale previews without restarting video", async ({ page }) => {
  await page.route("**/replacement.vtt", (route) => route.fulfill({
    contentType: "text/vtt",
    body: "WEBVTT\n\n00:00.000 --> 00:06.000\n/tests/fixtures/media/thumbnails/sprite02.jpg#xywh=160,0,160,90\n",
  }));
  const player = await openPlayer(page, `thumbnails="${thumbnails}"`);
  const preview = page.locator("media-preview-thumbnail").first();
  await expect(async () => {
    await hoverTime(page, 0.5);
    await expect(preview).toHaveAttribute("mediapreviewimage", /sprite01/);
  }).toPass({ timeout: 5000 });
  await player.evaluate((element: ChunkifyPlayer) => {
    element.media.currentTime = 2;
    element.addEventListener("loadstart", () => { element.dataset.restarted = "true"; });
    element.thumbnails = "/replacement.vtt";
  });
  await expect(async () => {
    await hoverTime(page, 0.6);
    await expect(preview).toHaveAttribute("mediapreviewimage", /sprite02/);
    await expect(preview).toHaveAttribute("mediapreviewcoords", "160 0 160 90");
  }).toPass({ timeout: 5000 });
  await expect(player).not.toHaveAttribute("data-restarted");
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeCloseTo(2, 0);
  await player.evaluate((element: ChunkifyPlayer) => { element.thumbnails = null; });
  await hoverTime(page, 0.7);
  await expect(preview).toBeHidden();
  await expect(preview).not.toHaveAttribute("mediapreviewimage");
  await expect(preview.locator("img")).not.toHaveAttribute("src");
  await expect(player).not.toHaveAttribute("thumbnails");
});

test("a missing sprite hides the image without breaking video and recovers with valid thumbnails", async ({ page }) => {
  await page.route("**/broken.vtt", (route) => route.fulfill({ contentType: "text/vtt",
    body: "WEBVTT\n\n00:00.000 --> 00:06.000\n/missing-sprite.jpg#xywh=0,0,160,90\n" }));
  await page.route("**/missing-sprite.jpg", (route) => route.fulfill({ status: 404 }));
  const failedImage = page.waitForResponse((response) => response.url().endsWith("/missing-sprite.jpg"));
  const player = await openPlayer(page, 'thumbnails="/broken.vtt"');
  await hoverTime(page, 0.5);
  await failedImage;
  const preview = page.locator("media-preview-thumbnail").first();
  await expect(preview).toBeHidden();
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  await player.evaluate((element: ChunkifyPlayer, thumbnails) => {
    element.media.pause();
    element.thumbnails = thumbnails;
  }, thumbnails);
  await hoverTime(page, 4.5);
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toHaveAttribute("src", /sprite02.jpg$/);
  await expect.poll(() => preview.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
});

test("thumbnail previews remain within a narrow player while seeking", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const player = await openPlayer(page, `thumbnails="${thumbnails}"`);
  const preview = page.locator("media-preview-thumbnail").first();
  for (const time of [0.5, 5.5]) {
    await hoverTime(page, time);
    await expect(preview).toBeVisible();
    const bounds = await player.boundingBox();
    const box = await preview.boundingBox();
    expect(bounds).not.toBeNull();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    await page.screenshot({ path: testInfo.outputPath(`narrow-preview-${time}.png`), animations: "disabled" });
  }
  const slider = page.getByRole("slider", { name: "seek", exact: true });
  await page.mouse.down();
  await hoverTime(page, 3.5);
  await expect(preview).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(3);
  await expect(slider).toBeEnabled();
});

test("HLS previews respect readiness and reset on source replacement and disconnection", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/images\.vtt|sprite\d+\.jpg/.test(request.url())) requests.push(request.url());
  });
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate((thumbnails) => {
    const player = document.createElement("chunkify-player");
    Object.assign(player, { status: "preparing", player: "hlsjs", controls: true, muted: true,
      src: "/tests/fixtures/media/master.m3u8", thumbnails });
    document.body.append(player);
  }, thumbnails);
  const player = page.locator("chunkify-player");
  for (const status of ["preparing", "failed", "expired"] as const) {
    await player.evaluate((element: ChunkifyPlayer, status) => { element.status = status; }, status);
    await expect(page.getByRole("status")).toBeVisible();
    expect(requests).toEqual([]);
  }
  await player.evaluate((element: ChunkifyPlayer) => { element.status = "ready"; });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const preview = page.locator("media-preview-thumbnail").first();
  await hoverTime(page, 4.5);
  await expect(preview).toHaveAttribute("mediapreviewimage", /sprite02/);
  await player.evaluate((element: ChunkifyPlayer) => { element.src = "/tests/fixtures/media/stream.m3u8"; });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await hoverTime(page, 0.5);
  await expect(preview).toHaveAttribute("mediapreviewimage", /sprite01/);
  const handle = await player.elementHandle();
  if (!handle) throw new Error("Player is missing");
  await handle.evaluate((element: ChunkifyPlayer) => {
    element.remove();
    element.thumbnails = "/tests/fixtures/media/thumbnails/images.vtt?reconnected";
  });
  expect(requests.some((url) => url.endsWith("?reconnected"))).toBe(false);
  await handle.evaluate((element) => document.body.append(element));
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await hoverTime(page, 5.5);
  await expect(preview).toHaveAttribute("mediapreviewimage", /sprite02/);
  expect(requests.some((url) => url.endsWith("?reconnected"))).toBe(true);
});

test("leaving ready aborts a pending VTT request and cannot restore its old previews", async ({ page }) => {
  let requested!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { requested = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/delayed.vtt", async (route) => {
    requested();
    await gate;
    await route.fulfill({ contentType: "text/vtt", body: "WEBVTT\n\n00:00.000 --> 00:06.000\n/stale.jpg#xywh=0,0,160,90\n" }).catch(() => {});
  });
  const images: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("stale.jpg")) images.push(request.url()); });
  const player = await openPlayer(page, 'thumbnails="/delayed.vtt"');
  await started;
  await hoverTime(page, 0.5);
  const aborted = page.waitForEvent("requestfailed", (request) => request.url().endsWith("delayed.vtt"));
  await player.evaluate((element: ChunkifyPlayer) => { element.status = "preparing"; });
  await aborted;
  release();
  await expect(page.getByRole("status")).toHaveText("Your video is being prepared.");
  await player.evaluate((element: ChunkifyPlayer) => {
    element.thumbnails = null;
    element.status = "ready";
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await hoverTime(page, 4.5);
  await expect(page.locator("media-preview-thumbnail").first()).toBeHidden();
  expect(images).toEqual([]);
});

test("invalid cues and uncovered intervals hide previews without losing valid cues", async ({ page }) => {
  await page.route("**/gaps.vtt", (route) => route.fulfill({ contentType: "text/vtt", body:
    "WEBVTT\n\n00:00.000 --> 00:01.000\n/invalid.jpg\n\n" +
    "00:01.000 --> 00:02.000\n/tests/fixtures/media/thumbnails/sprite01.jpg#xywh=0,0,160,90\n\n" +
    "00:03.000 --> 00:04.000\n/tests/fixtures/media/thumbnails/sprite02.jpg#xywh=0,0,160,90\n\n" +
    "00:04.000 --> 00:05.000\n/invalid.jpg#xywh=0,0,0,90\n" }));
  const player = await openPlayer(page, 'thumbnails="/gaps.vtt"');
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) =>
    Array.from(element.media.textTracks).find((track) => track.label === "thumbnails")?.cues?.length,
  )).toBe(2);
  const preview = page.locator("media-preview-thumbnail").first();
  for (const time of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
    await hoverTime(page, time);
    if (time === 1.5 || time === 3.5) {
      await expect(preview).toBeVisible();
    } else {
      await expect(preview).toBeHidden();
    }
  }
});

test("failed files and malformed sprite cues do not interrupt playback or throw on hover", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cases = [
    { status: 404, body: "Missing" },
    { status: 200, body: "Not a WebVTT file" },
    { status: 200, body: "WEBVTT\n\n00:00.000 --> 00:06.000\n/sprite.jpg\n" },
    { status: 200, body: "WEBVTT\n\n00:00.000 --> 00:06.000\n/sprite.jpg#xywh=0,0,0,90\n" },
    { status: 200, body: "WEBVTT\n\n00:00.000 --> 00:06.000\njavascript:secret#xywh=0,0,160,90\n" },
  ];
  for (const [index, fixture] of cases.entries()) {
    await page.route(`**/invalid-${index}.vtt`, (route) => route.fulfill({ ...fixture, contentType: "text/vtt" }));
    const player = await openPlayer(page, `thumbnails="/invalid-${index}.vtt"`);
    await player.evaluate((element: ChunkifyPlayer) => {
      element.addEventListener("playback-error", () => { element.dataset.failed = "true"; });
    });
    await hoverTime(page, 0.5);
    await player.evaluate((element: ChunkifyPlayer) => element.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.25);
    await hoverTime(page, 3.5);
    await expect(page.locator("media-preview-thumbnail").first()).toBeHidden();
    await expect(player).not.toHaveAttribute("data-failed");
  }
  expect(errors).toEqual([]);
});
