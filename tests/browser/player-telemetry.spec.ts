import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";
import type { ChunkifyPlayerTelemetryEvent } from "../../packages/player-telemetry/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get("chunkify-player")))).toBe(true);
});

test("the telemetry property replaces and cleans up callback sessions without becoming an attribute", async ({ page }) => {
  const result = await page.evaluate(() => {
    const first: ChunkifyPlayerTelemetryEvent[] = [];
    const second: ChunkifyPlayerTelemetryEvent[] = [];
    const player = document.createElement("chunkify-player");
    player.assetId = "asset-component";
    player.telemetry = { provider: "callback", send: (event) => { first.push(event); } };
    document.body.append(player);

    player.media.dispatchEvent(new Event("play"));
    player.telemetry = { provider: "callback", send: (event) => { second.push(event); } };
    player.media.dispatchEvent(new Event("play"));
    player.remove();
    player.media.dispatchEvent(new Event("play"));

    return {
      first, second,
      telemetryAttribute: player.getAttribute("telemetry"),
      configuredAfterDisconnect: player.telemetry?.provider ?? null,
    };
  });

  expect(result.first.map((event) => [event.event_name, event.reason])).toEqual([
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "destroyed"],
  ]);
  expect(result.second.map((event) => [event.event_name, event.reason])).toEqual([
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "destroyed"],
  ]);
  expect(result.first.concat(result.second).map((event) => event.asset_id)).toEqual([
    "asset-component", "asset-component", "asset-component", "asset-component",
  ]);
  expect(result.telemetryAttribute).toBeNull();
  expect(result.configuredAfterDisconnect).toBe("callback");
});

test("asset IDs activate and replace telemetry context without restarting media", async ({ page }) => {
  const result = await page.evaluate(() => {
    const events: ChunkifyPlayerTelemetryEvent[] = [];
    const player = document.createElement("chunkify-player");
    player.telemetry = { provider: "callback", send: (event) => { events.push(event); } };
    document.body.append(player);

    player.media.dispatchEvent(new Event("play"));
    player.assetId = "asset-first";
    player.media.dispatchEvent(new Event("play"));
    player.assetId = "asset-second";
    player.media.dispatchEvent(new Event("play"));
    player.assetId = null;
    player.media.dispatchEvent(new Event("play"));

    return {
      events,
      hasMediaSource: player.media.hasAttribute("src"),
      telemetry: player.telemetry?.provider ?? null,
    };
  });

  expect(result.events.map((event) => [event.event_name, event.asset_id, event.reason])).toEqual([
    ["chunkify.video.view_started", "asset-first", null],
    ["chunkify.video.view_ended", "asset-first", "destroyed"],
    ["chunkify.video.view_started", "asset-second", null],
    ["chunkify.video.view_ended", "asset-second", "destroyed"],
  ]);
  expect(result.hasMediaSource).toBe(false);
  expect(result.telemetry).toBe("callback");
});

test("a view-ended callback can replace telemetry without leaking a duplicate attachment", async ({ page }) => {
  const result = await page.evaluate(() => {
    const first: ChunkifyPlayerTelemetryEvent[] = [];
    const replacement: ChunkifyPlayerTelemetryEvent[] = [];
    const player = document.createElement("chunkify-player");
    const replacementConfig = {
      provider: "callback" as const,
      send: (event: ChunkifyPlayerTelemetryEvent) => { replacement.push(event); },
    };
    player.assetId = "asset-first";
    player.telemetry = {
      provider: "callback",
      send(event) {
        first.push(event);
        if (event.event_name === "chunkify.video.view_ended") player.telemetry = replacementConfig;
      },
    };
    document.body.append(player);
    player.media.dispatchEvent(new Event("play"));

    player.assetId = "asset-replacement";
    player.media.dispatchEvent(new Event("play"));
    player.telemetry = null;
    player.media.dispatchEvent(new Event("play"));
    return { first, replacement };
  });

  expect(result.first.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.view_ended",
  ]);
  expect(result.replacement.map((event) => event.event_name)).toEqual([
    "chunkify.video.view_started", "chunkify.video.view_ended",
  ]);
  expect(result.replacement.every((event) => event.asset_id === "asset-replacement")).toBe(true);
});

test("source clearing ends a real component view and the same attachment observes replay", async ({ page }) => {
  await page.evaluate(() => {
    const state = window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.playerTelemetryEvents = [];
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      assetId: "asset-real-component",
      player: "native",
      src: "/tests/fixtures/media/video.mp4",
      muted: true,
      playsInline: true,
      telemetry: {
        provider: "callback",
        send: (event: ChunkifyPlayerTelemetryEvent) => { state.playerTelemetryEvents.push(event); },
      },
    });
    document.body.append(player);
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.length)).toBe(1);

  await player.evaluate((element: ChunkifyPlayer) => { element.src = null; });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.length)).toBe(2);
  await player.evaluate((element: ChunkifyPlayer) => { element.src = "/tests/fixtures/media/video.mp4?replay"; });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.length)).toBe(3);
  const events = await page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents);

  expect(events.map((event) => [event.event_name, event.reason])).toEqual([
    ["chunkify.video.view_started", null],
    ["chunkify.video.view_ended", "source_changed"],
    ["chunkify.video.view_started", null],
  ]);
  expect(events.every((event) => event.asset_id === "asset-real-component")).toBe(true);
  expect(events.every((event) => event.delivery_hostname === "127.0.0.1")).toBe(true);
});

test("browser-generated native failures reach telemetry before player teardown", async ({ page }) => {
  let releaseRequest!: () => void;
  let requestStarted!: () => void;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/native-error.mp4", async (route) => {
    requestStarted();
    await requestGate;
    await route.fulfill({ status: 500, contentType: "video/mp4", body: "media unavailable" });
  });
  await page.evaluate(() => {
    const state = window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.playerTelemetryEvents = [];
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      assetId: "asset-native-error",
      player: "native",
      src: "/native-error.mp4",
      telemetry: {
        provider: "callback",
        send: (event: ChunkifyPlayerTelemetryEvent) => { state.playerTelemetryEvents.push(event); },
      },
    });
    player.addEventListener("playback-error", (event) => {
      player.dataset.playbackError = JSON.stringify(event.detail);
    });
    document.body.append(player);
  });
  const player = page.locator("chunkify-player");
  await requestSeen;
  await player.evaluate((element: ChunkifyPlayer) => { void element.media.play().catch(() => {}); });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.some((event) => event.event_name === "chunkify.video.view_started"))).toBe(true);
  releaseRequest();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.some((event) => event.event_name === "chunkify.video.playback_error"))).toBe(true);
  await expect(player).toHaveAttribute("data-playback-error");
  const error = (await page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents)).find((event) => event.event_name === "chunkify.video.playback_error");
  expect(error?.error_category).not.toBe("unknown");
  expect(error?.error_code).not.toBeNull();
  expect(error?.error_fatal).toBe(true);
  expect(error?.error_playhead_seconds).toBe(0);
  expect(JSON.stringify(error)).not.toContain("media unavailable");
});

test("fatal hls.js failures emit a sanitized engine error before teardown", async ({ page }) => {
  test.setTimeout(30_000);
  let releaseRequest!: () => void;
  let requestStarted!: () => void;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/private-token/broken.m3u8?signature=secret", async (route) => {
    requestStarted();
    await requestGate;
    await route.fulfill({ status: 404, contentType: "application/vnd.apple.mpegurl", body: "private manifest missing" });
  });
  await page.evaluate(() => {
    const state = window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.playerTelemetryEvents = [];
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      assetId: "asset-hls-error",
      player: "hlsjs",
      src: "/private-token/broken.m3u8?signature=secret",
      telemetry: {
        provider: "callback",
        send: (event: ChunkifyPlayerTelemetryEvent) => { state.playerTelemetryEvents.push(event); },
      },
    });
    document.body.append(player);
  });
  await requestSeen;
  const player = page.locator("chunkify-player");
  await player.evaluate((element: ChunkifyPlayer) => { void element.media.play().catch(() => {}); });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.some((event) => event.event_name === "chunkify.video.view_started"))).toBe(true);
  releaseRequest();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.find((event) => event.event_name === "chunkify.video.playback_error")), { timeout: 15_000 }).toMatchObject({
    connector_name: "hls.js",
    player_name: "hls.js",
    error_category: "network",
    error_code: "manifestLoadError",
    error_fatal: true,
  });
  const events = await page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents);
  expect(JSON.stringify(events)).not.toMatch(/private-token|signature|secret|private manifest missing/);
});

test("telemetry enabled after hls.js creation observes fatal errors before teardown", async ({ page }) => {
  let releaseRequest!: () => void;
  let requestStarted!: () => void;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/late-failure.m3u8", async (route) => {
    requestStarted();
    await requestGate;
    await route.fulfill({ status: 500, contentType: "application/vnd.apple.mpegurl", body: "unavailable" });
  });
  await page.evaluate(() => {
    const player = document.createElement("chunkify-player");
    Object.assign(player, { player: "hlsjs", src: "/late-failure.m3u8" });
    document.body.append(player);
  });
  await requestSeen;
  await page.locator("chunkify-player").evaluate((player: ChunkifyPlayer) => {
    const state = window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.playerTelemetryEvents = [];
    player.assetId = "asset-late-error";
    player.telemetry = {
      provider: "callback",
      send: (event: ChunkifyPlayerTelemetryEvent) => { state.playerTelemetryEvents.push(event); },
    };
    player.media.dispatchEvent(new Event("play"));
  });
  releaseRequest();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.find((event) => event.event_name === "chunkify.video.playback_error"))).toMatchObject({
    connector_name: "hls.js",
    error_category: "network",
    error_code: "manifestLoadError",
    error_fatal: true,
  });
});

test("hls.js enrichment listeners exist only while telemetry is enabled", async ({ page }) => {
  await page.goto("/tests/fixtures/player.html?defer");
  await page.evaluate(async () => {
    const { default: Hls } = await import("hls.js");
    const calls = { on: [] as string[], off: [] as string[] };
    const originalOn = Hls.prototype.on;
    const originalOff = Hls.prototype.off;
    Reflect.set(Hls.prototype, "on", function(this: object, event: string, ...args: unknown[]) {
      calls.on.push(event);
      return Reflect.apply(originalOn, this, [event, ...args]);
    });
    Reflect.set(Hls.prototype, "off", function(this: object, event: string, ...args: unknown[]) {
      calls.off.push(event);
      return Reflect.apply(originalOff, this, [event, ...args]);
    });
    (window as typeof window & { hlsTelemetryListenerCalls: typeof calls }).hlsTelemetryListenerCalls = calls;
    await import("@chunkify/player");
    const player = document.createElement("chunkify-player");
    Object.assign(player, { player: "hlsjs", muted: true, src: "/tests/fixtures/media/master.m3u8" });
    document.body.append(player);
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const before = await page.evaluate(() => {
    const calls = (window as typeof window & {
      hlsTelemetryListenerCalls: { on: string[]; off: string[] };
    }).hlsTelemetryListenerCalls;
    return { on: calls.on.length, off: calls.off.length };
  });
  await player.evaluate((element: ChunkifyPlayer) => {
    const state = window as typeof window & { lateTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.lateTelemetryEvents = [];
    element.assetId = "asset-listeners";
    element.telemetry = {
      provider: "callback",
      send: (event: ChunkifyPlayerTelemetryEvent) => { state.lateTelemetryEvents.push(event); },
    };
    element.media.dispatchEvent(new Event("play"));
  });
  const enabled = await page.evaluate((before) => {
    const calls = (window as typeof window & {
      hlsTelemetryListenerCalls: { on: string[]; off: string[] };
    }).hlsTelemetryListenerCalls;
    return calls.on.slice(before.on);
  }, before);
  expect(enabled).toHaveLength(7);
  const startEvent = await page.evaluate(() => (
    window as typeof window & { lateTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).lateTelemetryEvents[0]);
  expect(startEvent).toMatchObject({
    connector_name: "hls.js",
    metrics: {
      selected_rendition_width: 256,
      selected_rendition_height: 144,
      rendition_switch_count: 0,
      delivery_request_count: 0,
    },
  });
  await player.evaluate((element: ChunkifyPlayer) => { element.telemetry = null; });
  const disabled = await page.evaluate((before) => {
    const calls = (window as typeof window & {
      hlsTelemetryListenerCalls: { on: string[]; off: string[] };
    }).hlsTelemetryListenerCalls;
    return calls.off.slice(before.off);
  }, before);
  expect(disabled).toHaveLength(7);
});

test("source replacement finalizes the old hls.js view before changing connectors", async ({ page }) => {
  await page.evaluate(() => {
    const state = window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.playerTelemetryEvents = [];
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      assetId: "asset-source-replacement",
      player: "hlsjs",
      muted: true,
      src: "/tests/fixtures/media/master.m3u8",
      telemetry: {
        provider: "callback",
        send: (event: ChunkifyPlayerTelemetryEvent) => { state.playerTelemetryEvents.push(event); },
      },
    });
    document.body.append(player);
    player.media.dispatchEvent(new Event("play"));
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => { element.src = "/tests/fixtures/media/video.mp4"; });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.find((event) => event.event_name === "chunkify.video.view_ended"))).toMatchObject({
    connector_name: "hls.js",
    player_name: "hls.js",
    reason: "source_changed",
  });
  const finalEvent = (await page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents)).find((event) => event.event_name === "chunkify.video.view_ended");
  expect(finalEvent?.metrics.selected_rendition_width).toBeGreaterThan(0);
  expect(finalEvent?.metrics.delivery_request_count).toBeGreaterThan(0);
  expect(finalEvent?.metrics.delivery_transferred_bytes).toBeGreaterThan(0);
});

test("hls.js source replacement preserves the outgoing connector totals", async ({ page }) => {
  await page.evaluate(() => {
    const state = window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] };
    state.playerTelemetryEvents = [];
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      assetId: "asset-hls-replacement",
      player: "hlsjs",
      muted: true,
      src: "/tests/fixtures/media/master.m3u8",
      telemetry: {
        provider: "callback",
        send: (event: ChunkifyPlayerTelemetryEvent) => { state.playerTelemetryEvents.push(event); },
      },
    });
    document.body.append(player);
    player.media.dispatchEvent(new Event("play"));
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/master.m3u8?replacement=1";
  });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents.find((event) => event.event_name === "chunkify.video.view_ended"))).toMatchObject({
    connector_name: "hls.js",
    player_name: "hls.js",
    reason: "source_changed",
  });
  const finalEvent = (await page.evaluate(() => (
    window as typeof window & { playerTelemetryEvents: ChunkifyPlayerTelemetryEvent[] }
  ).playerTelemetryEvents)).find((event) => event.event_name === "chunkify.video.view_ended");
  expect(finalEvent?.metrics.selected_rendition_width).toBeGreaterThan(0);
  expect(finalEvent?.metrics.delivery_request_count).toBeGreaterThan(0);
  expect(finalEvent?.metrics.delivery_transferred_bytes).toBeGreaterThan(0);
});
