import { expect } from "@playwright/test";
import { test } from "../fixtures/private-media.js";
import type { ChunkifyPlayer, PlaybackErrorDetail } from "../../packages/player/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
});

test("credentials include reaches HLS manifests and byte-range requests", async ({ page, context, mediaServer }) => {
  await context.addCookies([{
    name: "media_access",
    value: "fixture",
    url: mediaServer.origin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const target = "/cookies/master.m3u8?expires=1234567890&signature=a%2Bb%2F%3D";
  await page.evaluate(({ origin, target }) => {
    document.body.innerHTML = `<chunkify-player credentials="include" muted
      src="${origin}${target}"></chunkify-player>`;
  }, { origin: mediaServer.origin, target });

  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState))
    .toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => element.media.play());
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime))
    .toBeGreaterThan(0.2);

  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    source: element.src,
    crossOrigin: element.media.crossOrigin,
  }))).toEqual({ source: `${mediaServer.origin}${target}`, crossOrigin: "use-credentials" });
  expect(mediaServer.requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ target }),
    expect.objectContaining({ path: "/cookies/rendition/ranges.m3u8" }),
    expect.objectContaining({ path: "/cookies/rendition/video-ranges.mp4", status: 206 }),
  ]));
  expect(mediaServer.requests.every((request) =>
    request.cookie.includes("media_access=fixture") && request.status < 400)).toBe(true);
  expect(mediaServer.requests.filter((request) => request.range).length).toBeGreaterThan(0);
});

test("credentials include reaches native video requests", async ({ page, context, mediaServer }) => {
  await context.addCookies([{
    name: "media_access",
    value: "fixture",
    url: mediaServer.origin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.evaluate((origin) => {
    document.body.innerHTML = `<chunkify-player credentials="include" muted
      src="${origin}/cookies/video.mp4"></chunkify-player>`;
  }, mediaServer.origin);

  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    tag: element.media.localName,
    crossOrigin: element.media.crossOrigin,
  }))).toEqual({ tag: "video", crossOrigin: "use-credentials" });
  const requests = mediaServer.requests.filter((request) => request.path === "/cookies/video.mp4");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) =>
    request.cookie.includes("media_access=fixture") && request.status < 400)).toBe(true);
  expect(requests.filter((request) => request.range)
    .every((request) => request.status === 206)).toBe(true);
});

test("authorized path URLs play unchanged without cookie credentials", async ({ page, mediaServer }) => {
  const target = "/token/fixture-signature/master.m3u8?expires=1234567890&signature=a%2Bb%2F%3D";
  await page.evaluate(({ origin, target }) => {
    document.body.innerHTML = `<chunkify-player muted src="${origin}${target}"></chunkify-player>`;
  }, { origin: mediaServer.origin, target });

  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await player.evaluate((element: ChunkifyPlayer) => element.src))
    .toBe(`${mediaServer.origin}${target}`);
  expect(mediaServer.requests).toEqual(expect.arrayContaining([expect.objectContaining({ target })]));
  expect(mediaServer.requests.every((request) =>
    request.path.startsWith("/token/fixture-signature/")
    && request.cookie === ""
    && request.status < 400)).toBe(true);
});

for (const source of ["video.mp4", "master.m3u8"] as const) {
  test(`${source} reports denied access without exposing its URL`, async ({ page, mediaServer }) => {
    await page.evaluate(({ origin, source }) => {
      const player = document.createElement("chunkify-player");
      player.credentials = "include";
      player.src = `${origin}/cookies/${source}?signature=private-fixture-value`;
      player.addEventListener("playback-error", (event) => {
        player.dataset.error = JSON.stringify(event.detail);
      });
      document.body.append(player);
    }, { origin: mediaServer.origin, source });

    const player = page.locator("chunkify-player");
    await expect(player).toHaveAttribute("data-error", /"code":/);
    const detail = JSON.parse((await player.getAttribute("data-error"))!) as PlaybackErrorDetail;
    expect(Object.keys(detail).sort()).toEqual(["code", "engine", "message"]);
    expect(detail.engine).toBe(source === "video.mp4" ? "native" : "hlsjs");
    expect(["network-error", "unsupported-source"]).toContain(detail.code);
    expect(JSON.stringify(detail)).not.toMatch(
      /private-fixture-value|signature|127\.0\.0\.1|cookies|\.m3u8|\.mp4/,
    );
    expect(mediaServer.requests.some((request) => request.status === 403)).toBe(true);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.getAttribute("src")))
      .toBeNull();
  });
}

test("invalid credentials fail before the player sends a request", async ({ page, mediaServer }) => {
  await page.evaluate((origin) => {
    const player = document.createElement("chunkify-player");
    player.setAttribute("credentials", "secret-value");
    player.src = `${origin}/cookies/master.m3u8`;
    player.addEventListener("playback-error", (event) => {
      player.dataset.error = JSON.stringify(event.detail);
    });
    document.body.append(player);
  }, mediaServer.origin);

  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("data-error", /"code":"invalid-credentials"/);
  await expect(player).not.toHaveAttribute("data-error", /secret-value/);
  expect(mediaServer.requests).toEqual([]);
});

for (const source of ["video.mp4", "master.m3u8"] as const) {
  test(`${source} does not let a stale failure stop a replacement source`, async ({ page, mediaServer }) => {
    const denied = `${mediaServer.origin}/cookies/${source}?delay=1000`;
    const replacement = `${mediaServer.origin}/token/fixture-signature/${source}`;
    await page.evaluate(({ denied, replacement, source }) => {
      const player = document.createElement("chunkify-player");
      player.credentials = "include";
      player.src = denied;
      player.addEventListener("playback-error", () => {
        player.dataset.playbackErrors = String(Number(player.dataset.playbackErrors ?? 0) + 1);
      });
      if (source === "video.mp4") {
        player.addEventListener("error", () => {
          queueMicrotask(() => { player.src = replacement; });
        }, { once: true });
      }
      document.body.append(player);
    }, { denied, replacement, source });

    const player = page.locator("chunkify-player");
    if (source === "master.m3u8") {
      await expect.poll(() => player.evaluate((element: ChunkifyPlayer) =>
        Boolean((element.media as ChunkifyPlayer["media"] & { api?: unknown }).api)))
        .toBe(true);
      await player.evaluate((element: ChunkifyPlayer, replacement) => {
        const hls = (element.media as ChunkifyPlayer["media"] & {
          api: { on(event: string, listener: (_event: string, data: { fatal: boolean }) => void): void };
        }).api;
        hls.on("hlsError", (_event, data) => {
          if (data.fatal) queueMicrotask(() => { element.src = replacement; });
        });
      }, replacement);
    }

    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.src))
      .toBe(replacement);
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState))
      .toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(50);
    expect(await player.evaluate((element: ChunkifyPlayer) => ({
      errors: element.dataset.playbackErrors ?? "0",
      source: element.media.getAttribute("src"),
    }))).toEqual({ errors: "0", source: replacement });
  });
}
