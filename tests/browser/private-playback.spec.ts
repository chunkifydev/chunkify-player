import { expect } from "@playwright/test";
import { test } from "../fixtures/private-media.js";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

for (const engine of ["native", "hlsjs"] as const) {
  test(`${engine} reports denied access without exposing the authorized URL`, async ({ page, mediaServer }) => {
    await page.goto("/tests/fixtures/player.html");
    await page.evaluate(() => customElements.whenDefined("chunkify-player"));
    await page.evaluate(({ origin, engine }) => {
      const player = document.createElement("chunkify-player");
      Object.assign(player, { player: engine, credentials: "include", muted: true,
        src: `${origin}/cookies/${engine === "native" ? "video.mp4" : "master.m3u8"}?signature=private-fixture-value` });
      player.addEventListener("playback-error", (event) => { player.dataset.error = JSON.stringify(event.detail); });
      document.body.append(player);
    }, { origin: mediaServer.origin, engine });
    const player = page.locator("chunkify-player");
    await expect(player).toHaveAttribute("data-error", /"code":/);
    const detail = JSON.parse((await player.getAttribute("data-error"))!);
    expect(Object.keys(detail).sort()).toEqual(["code", "engine", "message"]);
    expect(detail.engine).toBe(engine);
    expect(["network-error", "unsupported-source"]).toContain(detail.code);
    expect(JSON.stringify(detail)).not.toMatch(/private-fixture-value|signature|127\.0\.0\.1|cookies|\.m3u8|\.mp4/);
    await expect(page.getByRole("status")).toHaveText(detail.message);
    expect(mediaServer.requests.some((request) => request.status === 403)).toBe(true);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.getAttribute("src"))).toBeNull();
  });

  test(`${engine} loads cookie-protected posters and sprite previews`, async ({ page, context, mediaServer }) => {
    await context.addCookies([{ name: "media_access", value: "fixture", url: mediaServer.origin, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/tests/fixtures/player.html");
    await page.evaluate(() => customElements.whenDefined("chunkify-player"));
    await page.evaluate(({ origin, engine }) => {
      document.body.innerHTML = `<chunkify-player player="${engine}" credentials="include" controls muted
        src="${origin}/cookies/${engine === "native" ? "video.mp4" : "master.m3u8"}"
        poster="${origin}/cookies/poster.jpg" thumbnails="${origin}/cookies/thumbnails/images.vtt"></chunkify-player>`;
    }, { origin: mediaServer.origin, engine });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    const seek = await page.getByRole("slider", { name: "seek", exact: true }).boundingBox();
    if (!seek) throw new Error("Seek bar is missing");
    await page.mouse.move(seek.x + seek.width * 0.75, seek.y + seek.height / 2);
    const preview = page.locator("media-preview-thumbnail").first();
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.crossOrigin)).toBe("use-credentials");
    expect(mediaServer.requests.map((request) => request.path)).toEqual(expect.arrayContaining([
      "/cookies/poster.jpg", "/cookies/thumbnails/images.vtt", "/cookies/thumbnails/sprite02.jpg",
    ]));
    expect(mediaServer.requests.filter((request) => !request.cookie.includes("media_access=fixture") || request.status >= 400)).toEqual([]);
  });
}

test("invalid credentials fail before any protected media request", async ({ page, mediaServer }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate((origin) => {
    const player = document.createElement("chunkify-player");
    player.setAttribute("credentials", "secret-value");
    player.src = `${origin}/cookies/master.m3u8`;
    player.poster = `${origin}/cookies/poster.jpg`;
    player.thumbnails = `${origin}/cookies/thumbnails/images.vtt`;
    player.addEventListener("playback-error", (event) => { player.dataset.error = JSON.stringify(event.detail); });
    document.body.append(player);
  }, mediaServer.origin);
  await expect(page.locator("chunkify-player")).toHaveAttribute("data-error", /"code":"invalid-credentials"/);
  await expect(page.locator("chunkify-player")).not.toHaveAttribute("data-error", /secret-value/);
  expect(mediaServer.requests).toEqual([]);
});

test("credential changes wait for a source, recover from denial and restore public requests", async ({ page, context, mediaServer }) => {
  await context.addCookies([{ name: "media_access", value: "fixture", url: mediaServer.origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
  await page.evaluate((origin) => {
    const player = document.createElement("chunkify-player");
    Object.assign(player, { player: "hlsjs", credentials: "include", muted: true,
      poster: `${origin}/cookies/poster.jpg`, thumbnails: `${origin}/cookies/thumbnails/images.vtt` });
    player.addEventListener("playback-error", (event) => { player.dataset.error = JSON.stringify(event.detail); });
    document.body.append(player);
  }, mediaServer.origin);
  const player = page.locator("chunkify-player");
  await expect(page.getByRole("status")).toHaveText("No video source provided.");
  expect(mediaServer.requests).toEqual([]);
  await player.evaluate((element: ChunkifyPlayer, origin) => { element.src = `${origin}/cookies/master.m3u8`; }, mediaServer.origin);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await player.evaluate((element: ChunkifyPlayer) => { element.credentials = null; });
  await expect(player).not.toHaveAttribute("credentials");
  await expect(player).toHaveAttribute("data-error", /"code":"network-error"/);
  const error = JSON.parse((await player.getAttribute("data-error"))!);
  expect(error).toEqual({ code: "network-error", message: "The video could not load. Check the source URL and access permissions.", engine: "hlsjs" });
  expect(mediaServer.requests).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/cookies/master.m3u8", cookie: "", status: 403 })]));
  await player.evaluate((element: ChunkifyPlayer) => { element.credentials = "include"; });
  await expect(player).toHaveAttribute("credentials", "include");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const handle = await player.elementHandle();
  if (!handle) throw new Error("Player is missing");
  await handle.evaluate((element: ChunkifyPlayer, origin) => {
    element.remove();
    element.credentials = undefined;
    element.src = `${origin}/public/master.m3u8`;
    element.poster = null;
    element.thumbnails = `${origin}/public/thumbnails/images.vtt`;
  }, mediaServer.origin);
  expect(mediaServer.requests.filter((request) => request.path.startsWith("/public/"))).toEqual([]);
  await handle.evaluate((element) => document.body.append(element));
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  expect(await player.evaluate((element: ChunkifyPlayer) => element.credentials)).toBeNull();
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.crossOrigin)).toBeNull();
  await expect.poll(() => mediaServer.requests.some((request) => request.path === "/public/thumbnails/images.vtt")).toBe(true);
  expect(mediaServer.requests.filter((request) => request.path.startsWith("/public/")).every((request) => request.cookie === "" && request.status < 400)).toBe(true);
});

for (const engine of ["hlsjs", "native"] as const) {
  for (const access of ["cookies", "token/fixture-signature"] as const) {
    test(`${engine} plays ${access} HLS without rewriting authorized paths or queries`, async ({ page, context, mediaServer }) => {
      await page.goto("/tests/fixtures/player.html");
      await page.evaluate(() => customElements.whenDefined("chunkify-player"));
      test.skip(engine === "native" && !await page.evaluate(() => Boolean(document.createElement("video").canPlayType("application/vnd.apple.mpegurl"))), "Browser has no native HLS");
      if (access === "cookies") await context.addCookies([{ name: "media_access", value: "fixture", url: mediaServer.origin, httpOnly: true, sameSite: "Lax" }]);
      const target = `/${access}/master.m3u8?expires=1234567890&signature=a%2Bb%2F%3D`;
      await page.evaluate(({ origin, target, engine, access }) => {
        document.body.innerHTML = `<chunkify-player player="${engine}" ${access === "cookies" ? 'credentials="include"' : ""}
          muted src="${origin}${target}"></chunkify-player>`;
      }, { origin: mediaServer.origin, target, engine, access });
      const player = page.locator("chunkify-player");
      await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
      await player.evaluate((element: ChunkifyPlayer) => element.media.play());
      await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.2);
      expect(mediaServer.requests).toEqual(expect.arrayContaining([expect.objectContaining({ target })]));
      expect(mediaServer.requests.map((request) => request.path)).toEqual(expect.arrayContaining([
        `/${access}/rendition/stream.m3u8`, `/${access}/rendition/init.mp4`, `/${access}/rendition/segment00.m4s`,
      ]));
      expect(mediaServer.requests.filter((request) => request.status >= 400 || !request.path.startsWith(`/${access}/`))).toEqual([]);
      if (access === "cookies") expect(mediaServer.requests.every((request) => request.cookie.includes("media_access=fixture"))).toBe(true);
      expect(await player.evaluate((element: ChunkifyPlayer) => element.src)).toBe(`${mediaServer.origin}${target}`);
    });
  }
}

for (const engine of ["native", "hlsjs"] as const) {
  test(`${engine} forwards cookies during playback and seeking`, async ({ page, context, mediaServer }) => {
    await context.addCookies([{ name: "media_access", value: "fixture", url: mediaServer.origin, httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/tests/fixtures/player.html");
    await page.evaluate(() => customElements.whenDefined("chunkify-player"));
    await page.evaluate(({ origin, engine }) => {
      document.body.innerHTML = `<chunkify-player player="${engine}" credentials="include" muted
        src="${origin}/cookies/${engine === "native" ? "video.mp4" : "ranges.m3u8"}"></chunkify-player>`;
    }, { origin: mediaServer.origin, engine });
    const player = page.locator("chunkify-player");
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate((element: ChunkifyPlayer) => { element.media.currentTime = 4; });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.seeking)).toBe(false);
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeCloseTo(4, 0);
    await player.evaluate((element: ChunkifyPlayer) => element.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(4.2);
    await player.evaluate((element: ChunkifyPlayer) => element.media.pause());
    expect(await player.evaluate((element: ChunkifyPlayer) => element.media.paused)).toBe(true);
    await player.evaluate((element: ChunkifyPlayer) => element.media.play());
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.ended)).toBe(true);
    const requests = mediaServer.requests.filter((request) => request.path.startsWith("/cookies/"));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.cookie.includes("media_access=fixture") && request.status < 400)).toBe(true);
    const ranges = requests.filter((request) => request.range);
    // A native browser may buffer the small MP4 in one request. The hls.js fixture declares byte ranges explicitly.
    if (engine === "hlsjs") expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((request) => request.status === 206)).toBe(true);
  });
}
