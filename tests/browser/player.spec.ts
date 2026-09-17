import { expect, test, type Page } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

async function openFixture(page: Page) {
  await page.goto("/tests/fixtures/player.html");
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get("chunkify-player")))).toBe(true);
}

test("playback depends on the supplied URL, not an asset status attribute", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player status="preparing" player="hlsjs"
      src="/tests/fixtures/media/master.m3u8" muted></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  expect(await player.evaluate((element) => "status" in element)).toBe(false);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
});

test("absent and empty sources stay idle without media, optional images or engine requests", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openFixture(page);
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player player="hlsjs" poster="/must-not-load.jpg"
      thumbnails="/must-not-load.vtt" autoplay muted></chunkify-player>`;
    document.querySelector("chunkify-player")!.addEventListener("playback-error", () => {
      document.body.dataset.error = "unexpected";
    });
  });
  const player = page.locator("chunkify-player");
  for (const src of [undefined, null, "", "   "]) {
    await player.evaluate((element: ChunkifyPlayer, src) => { element.src = src; }, src);
    await expect(page.getByRole("status")).toHaveText("No video source provided.");
    await expect(page.locator("video")).toBeHidden();
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.getAttribute("src"))).toBeNull();
  }
  await expect(page.locator("body")).not.toHaveAttribute("data-error");
  expect(requests.filter((url) => /\/media\/|must-not-load|hls\.mjs/.test(url))).toEqual([]);
});

test("invalid startup reports a safe playback error without requesting media", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/media\/|hls\.mjs/.test(request.url())) mediaRequests.push(request.url());
  });
  await openFixture(page);
  for (const [attributes, code] of [
    [{ src: "javascript:secret-token" }, "invalid-source"],
    [{ player: "unknown", src: "/tests/fixtures/media/master.m3u8" }, "invalid-player"],
  ] as const) {
    await page.evaluate((attributes) => {
      const player = document.createElement("chunkify-player");
      player.addEventListener("playback-error", (event) => {
        player.dataset.error = JSON.stringify(event.detail);
      });
      for (const [name, value] of Object.entries(attributes)) player.setAttribute(name, value);
      document.body.replaceChildren(player);
    }, attributes);
    await expect(page.locator("chunkify-player")).toHaveAttribute("data-error", new RegExp(code));
    await expect(page.getByRole("status")).toBeVisible();
    const error = await page.locator("chunkify-player").getAttribute("data-error");
    expect(error).not.toContain("secret-token");
    expect(error).not.toContain("/tests/");
  }
  expect(mediaRequests).toEqual([]);
});

test("hlsjs loads on demand and plays a muxed fMP4 HLS master", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openFixture(page);
  expect(requests.some((url) => url.includes("hls.mjs"))).toBe(false);
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player player="hlsjs" controls muted playsinline
      src="/tests/fixtures/media/master.m3u8"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  expect(requests.filter((url) => url.endsWith("/hls.mjs"))).toHaveLength(1);
  expect(requests.some((url) => url.endsWith("/stream.m3u8"))).toBe(true);
  expect(requests.some((url) => url.endsWith("/init.mp4"))).toBe(true);
  expect(requests.some((url) => url.endsWith(".m4s"))).toBe(true);
  expect(requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== "http://127.0.0.1:4173")).toEqual([]);
});

test("native video plays and forwards events without loading hls.js", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openFixture(page);
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player player="native" controls muted playsinline
      src="/tests/fixtures/media/video.mp4"></chunkify-player>`;
    const player = document.querySelector("chunkify-player")!;
    for (const event of ["playing", "pause", "seeked", "ended"]) {
      player.addEventListener(event, () => player.dataset[event] = "received");
    }
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect(player).toHaveAttribute("data-playing", "received");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0);
  await player.evaluate((element: ChunkifyPlayer) => element.media.pause());
  await expect(player).toHaveAttribute("data-pause", "received");
  await player.evaluate((element: ChunkifyPlayer) => { element.media.currentTime = 3; });
  await expect(player).toHaveAttribute("data-seeked", "received");
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    controls: element.media.controls,
    muted: element.media.muted,
    playsInline: element.media.hasAttribute("playsinline"),
  }))).toEqual({ controls: false, muted: true, playsInline: true });
  await player.evaluate(async (element: ChunkifyPlayer) => {
    element.media.currentTime = 5;
    element.media.playbackRate = 4;
    await element.media.play();
  });
  await expect(player).toHaveAttribute("data-ended", "received");
  expect(requests.some((url) => url.includes("hls.mjs"))).toBe(false);
});

test("auto selects native HLS when available and otherwise loads hls.js", async ({ page }) => {
  const engines: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/hls.mjs")) engines.push(request.url());
  });
  await openFixture(page);
  const nativeHls = await page.evaluate(() => Boolean(document.createElement("video").canPlayType("application/vnd.apple.mpegurl")));
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player muted playsinline src="/tests/fixtures/media/master.m3u8"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  expect(engines).toHaveLength(nativeHls ? 0 : 1);
});

test("auto falls back to hls.js for a rendition when native HLS is unavailable", async ({ page }) => {
  await disableNativeHls(page);
  await openFixture(page);
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player muted src="/tests/fixtures/media/stream.m3u8"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
});

async function disableNativeHls(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return type.includes("mpegurl") ? "" : original.call(this, type);
    };
  });
}

test("forced native reports unsupported HLS without loading another engine", async ({ page }) => {
  await disableNativeHls(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openFixture(page);
  await page.evaluate(() => {
    const player = document.createElement("chunkify-player");
    player.player = "native";
    player.src = "/tests/fixtures/media/master.m3u8";
    player.addEventListener("playback-error", (event) => {
      player.dataset.error = JSON.stringify(event.detail);
    });
    document.body.append(player);
  });
  await expect(page.locator("chunkify-player")).toHaveAttribute("data-error", /unsupported-engine/);
  expect(requests.filter((url) => /\/media\/|hls\.mjs/.test(url))).toEqual([]);
});

for (const engine of ["native", "hlsjs"] as const) {
  test(`${engine} replaces sources, stops when the source clears, and reconnects cleanly`, async ({ page }) => {
    const source = engine === "native" ? "video.mp4" : "master.m3u8";
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(source)) requests.push(request.url());
    });
    await openFixture(page);
    await page.evaluate(({ engine, source }) => {
      const player = document.createElement("chunkify-player");
      Object.assign(player, { player: engine, src: `/tests/fixtures/media/${source}`, muted: true });
      document.body.append(player);
    }, { engine, source });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate((element: ChunkifyPlayer) => { element.src += "?replacement"; });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate((element: ChunkifyPlayer) => element.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
    await player.evaluate((element: ChunkifyPlayer) => { element.src = null; });
    await expect(page.getByRole("status")).toHaveText("No video source provided.");
    expect(await player.evaluate((element: ChunkifyPlayer) => ({ paused: element.media.paused, src: element.media.getAttribute("src") })))
      .toEqual({ paused: true, src: null });
    await player.evaluate((element: ChunkifyPlayer, source) => { element.src = `/tests/fixtures/media/${source}`; }, source);
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    expect(await player.evaluate((element: ChunkifyPlayer) => {
      element.remove();
      const stopped = element.media.paused && !element.media.hasAttribute("src");
      document.body.append(element);
      return stopped;
    })).toBe(true);
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    if (engine === "hlsjs") expect(requests).toHaveLength(4);
  });
}

test("clearing the source during a delayed engine import never starts media requests", async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const engineRequest = new Promise<void>((resolve) => { requested = resolve; });
  await page.route("**/hls.mjs", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/media/")) mediaRequests.push(request.url());
  });
  await openFixture(page);
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player player="hlsjs"
      src="/tests/fixtures/media/master.m3u8"></chunkify-player>`;
  });
  await engineRequest;
  await page.locator("chunkify-player").evaluate((element: ChunkifyPlayer) => { element.src = null; });
  release();
  await page.evaluate(async () => { const engine = "hls.js"; await import(engine); });
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  expect(mediaRequests).toEqual([]);
});

test("properties set before registration survive upgrade and initialize the supplied source once", async ({ page }) => {
  const manifests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/master.m3u8")) manifests.push(request.url());
  });
  await page.goto("/tests/fixtures/player.html?defer");
  await page.evaluate(async () => {
    const state = window as typeof window & { upgradeTelemetryEvents: unknown[] };
    state.upgradeTelemetryEvents = [];
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      src: "/tests/fixtures/media/master.m3u8", player: "hlsjs",
      muted: true, controls: true, playsInline: true, poster: "/tests/fixtures/media/poster.jpg",
      thumbnails: "/tests/fixtures/media/thumbnails/images.vtt",
      assetId: "asset-before-registration",
      credentials: "include",
      telemetry: {
        provider: "callback",
        send: (event: unknown) => { state.upgradeTelemetryEvents.push(event); },
      },
    });
    document.body.append(player);
    const entry = "/packages/player/dist/index.js";
    await import(entry);
  });
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("asset-id", "asset-before-registration");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => { element.media.dispatchEvent(new Event("play")); });
  expect(await page.evaluate(() => (
    window as typeof window & { upgradeTelemetryEvents: unknown[] }
  ).upgradeTelemetryEvents)).toHaveLength(1);
  await player.evaluate((element: ChunkifyPlayer) => { element.src = "/tests/fixtures/media/master.m3u8"; });
  expect(manifests).toHaveLength(1);
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    src: element.src, player: element.player, controls: element.controls, poster: element.poster,
    thumbnails: element.thumbnails, credentials: element.credentials,
    muted: element.media.muted, playsInline: element.media.hasAttribute("playsinline"),
  }))).toEqual({
    src: "/tests/fixtures/media/master.m3u8", player: "hlsjs",
    controls: true, muted: true, playsInline: true, poster: "/tests/fixtures/media/poster.jpg",
    thumbnails: "/tests/fixtures/media/thumbnails/images.vtt",
    credentials: "include",
  });
});

test("a supplied source starts playback and clearing it returns to idle", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/media\/|hls\.mjs/.test(request.url())) mediaRequests.push(request.url());
  });
  await openFixture(page);
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player muted thumbnails="/tests/fixtures/media/thumbnails/images.vtt"></chunkify-player>`;
  });
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  const player = page.locator("chunkify-player");
  expect(mediaRequests).toEqual([]);
  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/video.mp4";
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => { element.src = null; });
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.hasAttribute("src"))).toBe(false);
});

for (const failure of ["engine", "manifest"] as const) {
  test(`${failure} failures emit a normalized error without source URLs or raw messages`, async ({ page }) => {
    if (failure === "engine") {
      await page.route("**/hls.mjs", (route) => route.abort());
    } else {
      await page.route("**/master.m3u8**", (route) => route.fulfill({
        contentType: "application/vnd.apple.mpegurl",
        body: "Invalid playlist with sensitive upstream text",
      }));
    }
    await openFixture(page);
    await page.evaluate(() => {
      const player = document.createElement("chunkify-player");
      player.player = "hlsjs";
      player.src = "/tests/fixtures/media/master.m3u8?token=secret";
      player.addEventListener("playback-error", (event) => {
        player.dataset.error = JSON.stringify(event.detail);
      });
      document.body.append(player);
    });
    const player = page.locator("chunkify-player");
    await expect(player).toHaveAttribute("data-error", new RegExp(failure === "engine" ? "engine-load-failed" : "unsupported-source"));
    const error = JSON.parse((await player.getAttribute("data-error"))!);
    expect(Object.keys(error).sort()).toEqual(["code", "engine", "message"]);
    expect(error.engine).toBe("hlsjs");
    expect(JSON.stringify(error)).not.toMatch(/secret|sensitive|\/tests\/|https?:/);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.hasAttribute("src"))).toBe(false);
  });
}
