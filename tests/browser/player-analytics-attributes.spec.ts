import { expect, test, type Page } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

type Delivery = { key: string | undefined; body: Record<string, unknown> };

async function collect(page: Page, url: string): Promise<Delivery[]> {
  const deliveries: Delivery[] = [];
  await page.route(url, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-chunkify-ingest-key", "Access-Control-Allow-Methods": "POST" } });
      return;
    }
    deliveries.push({ key: route.request().headers()["x-chunkify-ingest-key"], body: route.request().postDataJSON() });
    await route.fulfill({ status: 201, headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
  });
  return deliveries;
}

const names = (deliveries: Delivery[]) => deliveries.map(({ body }) => [body.event_name, body.reason, body.video_id]);

async function playUntilStarted(page: Page) {
  const player = page.locator("chunkify-player");
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
});

test("analytics attributes send events to the configured collector", async ({ page }) => {
  const deliveries = await collect(page, "**/player-events");
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player src="/tests/fixtures/media/video.mp4" muted
      analytics analytics-endpoint="/player-events" analytics-ingest-key="public-key"
      analytics-video-id="video_123" analytics-video-title="Keynote" analytics-user-id="user_42"
      analytics-environment="test" analytics-persist-viewer-id="false"></chunkify-player>`;
  });
  await playUntilStarted(page);
  await expect.poll(() => deliveries.length).toBeGreaterThan(0);
  expect(deliveries[0]).toMatchObject({ key: "public-key", body: {
    event_name: "chunkify.video.view_started", video_id: "video_123", video_title: "Keynote",
    user_id: "user_42", environment: "test", browser_context: expect.objectContaining({ schema_version: 1 }),
  } });
  expect(await page.evaluate(() => localStorage.length)).toBe(0);

  await page.evaluate(() => document.querySelector("chunkify-player")!.remove());
  await expect.poll(() => deliveries.some(({ body }) => body.event_name === "chunkify.video.view_ended")).toBe(true);
  expect(deliveries.find(({ body }) => body.event_name === "chunkify.video.view_ended")!.body.reason).toBe("destroyed");
});

test("analytics uses the hosted collector when no endpoint is set", async ({ page }) => {
  const deliveries = await collect(page, "https://analytics.chunkify.dev/v1/events");
  expect(await page.evaluate(async () => (await import("@chunkify/player")).defaultAnalyticsEndpoint))
    .toBe("https://analytics.chunkify.dev/v1/events");
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player src="/tests/fixtures/media/video.mp4" muted
      analytics analytics-ingest-key="hosted-key" analytics-video-id="video_hosted"></chunkify-player>`;
  });
  await playUntilStarted(page);
  await expect.poll(() => deliveries.length).toBeGreaterThan(0);
  expect(deliveries[0]).toMatchObject({ key: "hosted-key", body: { video_id: "video_hosted" } });
});

test("nothing is sent until the analytics switch is on", async ({ page }) => {
  const deliveries = await collect(page, "**/player-events");
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player src="/tests/fixtures/media/video.mp4" muted
      analytics-endpoint="/player-events" analytics-ingest-key="public-key"
      analytics-video-id="video_123"></chunkify-player>`;
  });
  await playUntilStarted(page);
  await page.locator("chunkify-player").evaluate((element: ChunkifyPlayer) => element.media.pause());
  expect(deliveries).toEqual([]);

  // For example once the viewer accepts analytics: tracking starts with the next play.
  await page.locator("chunkify-player").evaluate((element: ChunkifyPlayer) => { element.analytics = true; });
  await playUntilStarted(page);
  await expect.poll(() => deliveries.length).toBeGreaterThan(0);
  expect(names(deliveries)[0]).toEqual(["chunkify.video.view_started", null, "video_123"]);

  // Turning it off ends the view.
  await page.locator("chunkify-player").evaluate((element: ChunkifyPlayer) => { element.analytics = false; });
  await expect.poll(() => names(deliveries).at(-1)).toEqual(["chunkify.video.view_ended", "destroyed", "video_123"]);
});

test("missing or invalid analytics settings warn without affecting playback", async ({ page }) => {
  const deliveries = await collect(page, "**/player-events");
  const warnings: string[] = [];
  page.on("console", (message) => { if (message.type() === "warning") warnings.push(message.text()); });
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player src="/tests/fixtures/media/video.mp4" muted
      analytics analytics-endpoint="/player-events" analytics-ingest-key="public-key"></chunkify-player>`;
  });
  await playUntilStarted(page);
  await expect.poll(() => warnings).toEqual([
    "Chunkify Player analytics is off: set both analytics-ingest-key and analytics-video-id.",
  ]);

  await page.locator("chunkify-player").evaluate((element: ChunkifyPlayer) => {
    element.analyticsVideoId = "video_123";
    element.analyticsEndpoint = "http://analytics.example.com/v1/events";
  });
  await expect.poll(() => warnings.length).toBe(2);
  expect(warnings[1]).toContain("Chunkify Player analytics is off: HTTP adapter requires");
  await playUntilStarted(page);
  expect(deliveries).toEqual([]);
});

test("changing the video ID with the source starts a new view", async ({ page }) => {
  const deliveries = await collect(page, "**/player-events");
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player src="/tests/fixtures/media/video.mp4" muted
      analytics analytics-endpoint="/player-events" analytics-ingest-key="public-key"
      analytics-video-id="first"></chunkify-player>`;
  });
  await playUntilStarted(page);
  await page.locator("chunkify-player").evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/background/video.mp4";
    element.analyticsVideoId = "second";
  });
  await playUntilStarted(page);
  await expect.poll(() => names(deliveries).filter(([name]) => name !== "chunkify.video.playback_state_changed"))
    .toEqual([
      ["chunkify.video.view_started", null, "first"],
      ["chunkify.video.view_ended", "source_changed", "first"],
      ["chunkify.video.view_started", null, "second"],
    ]);
});
