import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/react.html");
  await expect.poll(() => page.evaluate(() => Boolean(window.reactFixture))).toBe(true);
});

test("React props configure playback and expose the player through a ref", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
    poster: "/tests/fixtures/media/poster.jpg",
    preload: "auto",
    crossOrigin: "anonymous",
    controls: true,
    muted: true,
    playsInline: true,
    className: "customer-player",
    children: window.reactFixture.createElement("track", {
      default: true,
      kind: "metadata",
      label: "thumbnails",
      src: "/tests/fixtures/media/thumbnails.vtt",
    }),
  }));

  const player = page.locator("chunkify-player");
  await expect(player).toHaveClass("customer-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => {
    const element = window.reactFixture.ref.current;
    return {
      sameElement: element === document.querySelector("chunkify-player"),
      mediaTag: element?.media.localName,
      poster: element?.poster,
      crossOrigin: element?.crossOrigin,
      controls: element?.controls,
      tracks: element?.media.querySelectorAll(":scope > track").length,
    };
  })).toEqual({
    sameElement: true,
    mediaTag: "hls-video",
    poster: "/tests/fixtures/media/poster.jpg",
    crossOrigin: "anonymous",
    controls: true,
    tracks: 1,
  });
});

test("React updates callbacks and switches between HLS and MP4", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
    muted: true,
    onPlay() { document.body.dataset.firstPlays = "1"; },
  }));
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.reactFixture.ref.current!.media.play());
  await expect(page.locator("body")).toHaveAttribute("data-first-plays", "1");

  await page.evaluate(() => {
    window.reactFixture.ref.current!.media.pause();
    window.reactFixture.render({
      src: "/tests/fixtures/media/video.mp4",
      muted: true,
      onPlay(event) {
        document.body.dataset.nextPlays = "1";
        document.body.dataset.eventTarget = String(event.currentTarget === window.reactFixture.ref.current);
      },
    });
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.localName)).toBe("video");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => window.reactFixture.ref.current!.media.play());
  await expect(page.locator("body")).toHaveAttribute("data-next-plays", "1");
  await expect(page.locator("body")).toHaveAttribute("data-event-target", "true");
});

test("React unmount clears the ref and stops playback", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    src: "/tests/fixtures/media/master.m3u8",
    muted: true,
  }));
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);
  const oldPlayer = await player.elementHandle();
  await page.evaluate(() => window.reactFixture.render(null));
  expect(await page.evaluate(() => window.reactFixture.ref.current)).toBeNull();
  expect(await oldPlayer!.evaluate((element: ChunkifyPlayer) => ({
    connected: element.isConnected,
    source: element.media.getAttribute("src"),
    paused: element.media.paused,
  }))).toEqual({ connected: false, source: null, paused: true });
});

test("React callback refs clean up in Strict Mode", async ({ page }) => {
  await page.evaluate(() => {
    let setups = 0;
    let cleanups = 0;
    window.reactFixture.render({
      ref(element) {
        if (!element) return;
        document.body.dataset.refSetups = String(++setups);
        return () => { document.body.dataset.refCleanups = String(++cleanups); };
      },
    });
  });
  await expect(page.locator("body")).toHaveAttribute("data-ref-setups", "2");
  await expect(page.locator("body")).toHaveAttribute("data-ref-cleanups", "1");
  await page.evaluate(() => window.reactFixture.render(null));
  await expect(page.locator("body")).toHaveAttribute("data-ref-cleanups", "2");
});

test("React forwards private-playback options and errors", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    credentials: "include",
    onPlaybackError(event) {
      document.body.dataset.playbackError = JSON.stringify(event.detail);
    },
  }));
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("credentials", "include");
  await player.evaluate((element: ChunkifyPlayer) => {
    element.dispatchEvent(new CustomEvent("playback-error", {
      detail: {
        code: "network-error",
        message: "The video could not load. Check the source URL and access permissions.",
        engine: "hlsjs",
      },
    }));
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-playback-error",
    /"code":"network-error".*"engine":"hlsjs"/,
  );
});

test("React forwards the live auto-seek preference", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({}));
  const player = page.locator("chunkify-player");
  await expect(player).not.toHaveAttribute("autoseektolive");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    return theme?.shadowRoot?.querySelector("media-controller")?.hasAttribute("noautoseektolive");
  })).toBe(true);

  await page.evaluate(() => window.reactFixture.render({ autoSeekToLive: true }));
  await expect(player).toHaveAttribute("autoseektolive");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    return {
      property: element.autoSeekToLive,
      controller: theme?.shadowRoot?.querySelector("media-controller")
        ?.hasAttribute("noautoseektolive"),
    };
  })).toEqual({ property: true, controller: false });

  await page.evaluate(() => window.reactFixture.render({}));
  await expect(player).not.toHaveAttribute("autoseektolive");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    return {
      property: element.autoSeekToLive,
      controller: theme?.shadowRoot?.querySelector("media-controller")
        ?.hasAttribute("noautoseektolive"),
    };
  })).toEqual({ property: false, controller: true });
});

test("React forwards the selected theme", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({ theme: "demuxed" }));
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("theme", "demuxed");
  expect(await player.evaluate((element: ChunkifyPlayer) => element.theme)).toBe("demuxed");
});

test("React forwards and removes player colors", async ({ page }) => {
  await page.evaluate(() => window.reactFixture.render({
    primaryColor: "#700cd4",
    secondaryColor: "#bb1111",
    accentColor: "#cf2626",
  }));
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("primary-color", "#700cd4");
  await expect(player).toHaveAttribute("secondary-color", "#bb1111");
  await expect(player).toHaveAttribute("accent-color", "#cf2626");
  expect(await player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector<HTMLElement>("[part=theme]");
    return {
      primary: theme?.style.getPropertyValue("--media-primary-color"),
      secondary: theme?.style.getPropertyValue("--media-secondary-color"),
      accent: theme?.style.getPropertyValue("--media-accent-color"),
    };
  })).toEqual({ primary: "#700cd4", secondary: "#bb1111", accent: "#cf2626" });

  await page.evaluate(() => window.reactFixture.render({}));
  await expect(player).not.toHaveAttribute("primary-color");
  await expect(player).not.toHaveAttribute("secondary-color");
  await expect(player).not.toHaveAttribute("accent-color");
});
