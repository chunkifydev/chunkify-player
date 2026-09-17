import { expect, test, type Page } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

async function openPlayer(page: Page, attributes = "") {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate((attributes) => {
    document.body.innerHTML = `<chunkify-player muted playsinline ${attributes}></chunkify-player>`;
  }, attributes);
  return page.locator("chunkify-player");
}

test("poster loads only with a source and can change without restarting playback", async ({ page }) => {
  const posters: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("poster.jpg")) posters.push(request.url());
  });
  const player = await openPlayer(page, `
    poster="/tests/fixtures/media/poster.jpg"`);
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  expect(posters).toEqual([]);
  const loaded = page.waitForResponse((response) => response.url().endsWith("/poster.jpg") && response.ok());
  await player.evaluate((element: ChunkifyPlayer) => { element.src = "/tests/fixtures/media/video.mp4"; });
  await loaded;
  await expect(page.locator("video")).toHaveAttribute("poster", "/tests/fixtures/media/poster.jpg");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => {
    element.media.currentTime = 3;
    element.addEventListener("loadstart", () => { element.dataset.restarted = "true"; });
    element.poster = "/tests/fixtures/media/poster.jpg?replacement";
  });
  await expect(page.locator("video")).toHaveAttribute("poster", /replacement$/);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeCloseTo(3, 0);
  await expect(player).not.toHaveAttribute("data-restarted");
  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = null;
    element.setAttribute("poster", "/tests/fixtures/media/poster.jpg?idle");
  });
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  await expect(page.locator("video")).not.toHaveAttribute("poster");
  expect(posters.some((url) => url.endsWith("?idle"))).toBe(false);
});

test("controls can be toggled without restarting media and remain inactive without a source", async ({ page }) => {
  const player = await openPlayer(page, `controls src="/tests/fixtures/media/video.mp4"`);
  await expect(page.getByRole("button", { name: "play", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "play", exact: true }).first().focus();
  await page.keyboard.press("k");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(false);
  await player.evaluate((element: ChunkifyPlayer) => {
    element.media.pause();
    element.media.currentTime = 2;
    element.addEventListener("loadstart", () => { element.dataset.restarted = "true"; });
    element.controls = false;
  });
  await expect(page.getByRole("button")).toHaveCount(0);
  await player.click();
  await page.keyboard.press("k");
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(true);
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeCloseTo(2, 0);
  await player.evaluate((element: ChunkifyPlayer) => { element.controls = true; });
  await expect(page.getByRole("button", { name: "play", exact: true }).first()).toBeVisible();
  await expect(player).not.toHaveAttribute("data-restarted");
  await player.evaluate((element: ChunkifyPlayer) => { element.src = undefined; });
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("controls stay within the player at narrow and wide sizes", async ({ page }, testInfo) => {
  const player = await openPlayer(page, `controls src="/tests/fixtures/media/video.mp4" poster="/tests/fixtures/media/poster.jpg"`);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("slider", { name: "seek", exact: true })).toBeVisible();
    await expect.poll(async () => {
      const bounds = await player.boundingBox();
      if (!bounds) return false;
      for (const control of await page.getByRole("button").all()) {
        const box = await control.boundingBox();
        if (box && (box.x < bounds.x || box.x + box.width > bounds.x + bounds.width + 1
          || box.y < bounds.y || box.y + box.height > bounds.y + bounds.height + 1)) return false;
        for (const icon of await control.locator("svg").all()) {
          const iconBox = await icon.boundingBox();
          if (box && iconBox && (iconBox.x < box.x - 1 || iconBox.x + iconBox.width > box.x + box.width + 1)) return false;
        }
      }
      return true;
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`controls-${width}.png`) });
  }
});

test("unsupported fullscreen and picture-in-picture actions are hidden at every size", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
    Object.defineProperty(HTMLVideoElement.prototype, "requestPictureInPicture", { configurable: true, value: undefined });
    Reflect.deleteProperty(HTMLVideoElement.prototype, "webkitSupportsFullscreen");
  });
  await openPlayer(page, `controls src="/tests/fixtures/media/video.mp4"`);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "play", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /fullscreen|picture in picture/i })).toHaveCount(0);
  }
});

test("available fullscreen and picture-in-picture controls call browser APIs at every size", async ({ page }) => {
  // OS windows are outside headless browser tests. Substitute only the browser API boundary.
  await page.addInitScript(() => {
    let fullscreen: Element | null = null;
    let pip: HTMLVideoElement | null = null;
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
    Element.prototype.requestFullscreen = async function () {
      fullscreen = this;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    document.exitFullscreen = async () => {
      fullscreen = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => pip });
    Object.defineProperty(HTMLVideoElement.prototype, "requestPictureInPicture", {
      configurable: true,
      value: async function (this: HTMLVideoElement) {
        pip = this;
        this.dispatchEvent(new Event("enterpictureinpicture"));
      },
    });
    document.exitPictureInPicture = async () => {
      const previous = pip;
      pip = null;
      previous?.dispatchEvent(new Event("leavepictureinpicture"));
    };
  });
  const player = await openPlayer(page, `controls src="/tests/fixtures/media/video.mp4"`);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const enterPip = page.getByRole("button", { name: "enter picture in picture mode", exact: true });
    await expect(enterPip).toBeVisible();
    await enterPip.click();
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement === document.querySelector("chunkify-player")!.media)).toBe(true);
    await page.getByRole("button", { name: "exit picture in picture mode", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement)).toBeNull();
    await page.getByRole("button", { name: "enter fullscreen mode", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.getByRole("button", { name: "exit fullscreen mode", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  }
});

test("themed controls play, pause, seek and mute through accessible controls", async ({ page }) => {
  const player = await openPlayer(page, `controls src="/tests/fixtures/media/video.mp4"`);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "play", exact: true }).first().click();
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(false);
  await page.getByRole("button", { name: "pause", exact: true }).last().click();
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(true);
  await page.getByRole("button", { name: "unmute", exact: true }).click();
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.muted)).toBe(false);
  const seek = page.getByRole("slider", { name: /seek/i });
  await seek.focus();
  await seek.press("End");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeCloseTo(6, 0);
  await seek.press("Home");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBe(0);
  await expect(page.getByRole("button", { name: /caption|cast|airplay/i })).toHaveCount(0);
});
