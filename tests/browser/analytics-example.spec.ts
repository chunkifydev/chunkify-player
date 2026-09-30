import { expect, test } from "@playwright/test";

test("Video.js example keeps its controls separate from Chunkify Player", async ({ page }) => {
  await page.goto("/examples/analytics/");
  await page.getByLabel("Playback analytics destination").selectOption("local");
  await page.getByLabel("Playback setup").selectOption("videojs");
  await page.getByRole("button", { name: "Load and monitor" }).click();

  const videoJs = page.frameLocator("#player-container iframe");
  const media = videoJs.locator("hlsjs-video");
  const play = videoJs.locator("media-play-button").first();
  await expect(media).toBeVisible();
  await expect(play).toHaveAttribute("aria-label", "Play");
  await expect(play).toHaveAttribute("data-paused", "");

  await videoJs.locator(".video-controls-settings-button").click();
  await expect(videoJs.locator("media-menu[popover]").first()).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  await expect(play).toHaveAttribute("aria-label", "Pause");
  await expect.poll(async () => Number(await page.locator("#event-count").textContent())).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#events pre").first()).toContainText('"event_id"');
  const start = page.locator("#events details")
    .filter({ has: page.locator("summary", { hasText: "chunkify.video.view_started" }) }).first();
  await expect.poll(async () => JSON.parse(await start.locator("pre").textContent() ?? "{}").player_width_px)
    .toBeGreaterThan(0);
});
