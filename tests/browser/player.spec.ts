import { expect, test } from "@playwright/test";
import type { ChunkifyPlayer } from "../../packages/player/src/index.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/player.html");
  await page.evaluate(() => customElements.whenDefined("chunkify-player"));
});

test("selects a registered theme by name without replacing the media element", async ({ page }) => {
  await page.evaluate(async () => {
    const { registerPlayerTheme } = await import("@chunkify/player");
    const template = document.createElement("template");
    template.innerHTML = `<media-controller data-theme="fixture">
      <slot name="media" slot="media"></slot>
    </media-controller>`;
    registerPlayerTheme("fixture", template);
    document.body.innerHTML = `<chunkify-player
      src="/tests/fixtures/media/video.mp4" controls></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    property: element.theme,
    hasControls: Boolean(element.shadowRoot?.querySelector("[part=theme]")
      ?.shadowRoot?.querySelector("media-control-bar")),
  }))).toEqual({ property: "default", hasControls: true });

  expect(await player.evaluate((element: ChunkifyPlayer) => {
    const media = element.media;
    element.theme = "fixture";
    return {
      preservedMedia: element.media === media,
      property: element.theme,
      rendered: element.shadowRoot?.querySelector("[part=theme]")
        ?.shadowRoot?.querySelector("media-controller")?.getAttribute("data-theme"),
    };
  })).toEqual({ preservedMedia: true, property: "fixture", rendered: "fixture" });
  await expect(player).toHaveAttribute("theme", "fixture");
});

test("uses hls-video for HLS and video for ordinary media", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player
      src="/tests/fixtures/media/master.m3u8" controls muted playsinline></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    tag: element.media.localName,
    nativeControls: element.media.controls,
    themedControls: element.shadowRoot?.querySelector("[part=theme]")?.hasAttribute("controls"),
    muted: element.media.muted,
    playsInline: element.media.hasAttribute("playsinline"),
  }))).toEqual({ tag: "hls-video", nativeControls: false, themedControls: true, muted: true, playsInline: true });
  await player.evaluate((element: ChunkifyPlayer) => { element.muted = false; });
  expect(await player.evaluate((element: ChunkifyPlayer) => element.media.muted)).toBe(false);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(2);

  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/video.mp4";
  });
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    tag: element.media.localName,
    source: new URL(element.media.currentSrc || element.media.src).pathname,
  }))).toEqual({ tag: "video", source: "/tests/fixtures/media/video.mp4" });
});

test("caps hls.js auto quality to the player size", async ({ page }) => {
  const hlsJsSupported = await page.evaluate(async () => (await import("hls-video-element")).Hls.isSupported());
  test.skip(!hlsJsSupported, "This browser uses native HLS playback");

  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player
      src="/tests/fixtures/media/master.m3u8"
      style="display:block;width:160px;height:90px"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  const capEnabled = () => player.evaluate((element: ChunkifyPlayer) => {
    const media = element.media as HTMLVideoElement & { api?: { capLevelToPlayerSize: boolean } };
    return media.api?.capLevelToPlayerSize ?? false;
  });
  await expect.poll(capEnabled).toBe(true);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState))
    .toBeGreaterThanOrEqual(2);

  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/video.mp4";
    element.src = "/tests/fixtures/media/master.m3u8";
  });
  await expect.poll(capEnabled).toBe(true);
});

test("contains HLS and MP4 media by default and supports fit overrides", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player
      src="/tests/fixtures/media/master.m3u8"
      style="display:block;width:320px;height:180px"
    ></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  const mediaSizing = () => player.evaluate((element: ChunkifyPlayer) => ({
    tag: element.media.localName,
    fit: getComputedStyle(element.media).objectFit,
    position: getComputedStyle(element.media).objectPosition,
  }));

  await expect.poll(mediaSizing).toEqual({ tag: "hls-video", fit: "contain", position: "50% 50%" });
  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/video.mp4";
  });
  await expect.poll(mediaSizing).toEqual({ tag: "video", fit: "contain", position: "50% 50%" });

  await player.evaluate((element: ChunkifyPlayer) => {
    element.style.setProperty("--media-object-fit", "cover");
    element.style.setProperty("--media-object-position", "25% 75%");
  });
  await expect.poll(mediaSizing).toEqual({ tag: "video", fit: "cover", position: "25% 75%" });
  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/master.m3u8";
  });
  await expect.poll(mediaSizing).toEqual({ tag: "hls-video", fit: "cover", position: "25% 75%" });
});

test("provides portrait and landscape aspect-ratio presets", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player aspect-ratio="portrait"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  const sizing = () => player.evaluate((element: ChunkifyPlayer) => ({
    attribute: element.getAttribute("aspect-ratio"),
    property: element.aspectRatio,
    computed: getComputedStyle(element).aspectRatio,
  }));

  await expect.poll(sizing).toEqual({
    attribute: "portrait",
    property: "portrait",
    computed: "9 / 16",
  });
  await player.evaluate((element: ChunkifyPlayer) => {
    element.aspectRatio = "landscape";
  });
  await expect.poll(sizing).toEqual({
    attribute: "landscape",
    property: "landscape",
    computed: "16 / 9",
  });
  await player.evaluate((element: ChunkifyPlayer) => {
    element.setAttribute("aspect-ratio", "square");
  });
  await expect.poll(sizing).toEqual({ attribute: "square", property: null, computed: "auto" });
  await player.evaluate((element: ChunkifyPlayer) => {
    element.removeAttribute("aspect-ratio");
    element.style.aspectRatio = "4 / 5";
    element.setAttribute("aspect-ratio", "portrait");
  });
  await expect.poll(sizing).toEqual({
    attribute: "portrait",
    property: "portrait",
    computed: "4 / 5",
  });
});

test("reflects standard video options and forwards media events", async ({ page }) => {
  await page.evaluate(() => {
    const player = document.createElement("chunkify-player");
    Object.assign(player, {
      src: "/tests/fixtures/media/video.mp4",
      poster: "/tests/fixtures/media/poster.jpg",
      preload: "auto",
      crossOrigin: "anonymous",
      controls: true,
      muted: true,
    });
    player.addEventListener("loadedmetadata", () => { player.dataset.loaded = "true"; });
    document.body.append(player);
  });
  const player = page.locator("chunkify-player");
  await expect(player).toHaveAttribute("data-loaded", "true");
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    src: new URL(element.media.currentSrc || element.media.src).pathname,
    poster: new URL(element.media.poster).pathname,
    preload: element.media.preload,
    crossOrigin: element.media.crossOrigin,
    nativeControls: element.media.controls,
    themedControls: element.shadowRoot?.querySelector("[part=theme]")?.hasAttribute("controls"),
    muted: element.media.muted,
  }))).toEqual({
    src: "/tests/fixtures/media/video.mp4",
    poster: "/tests/fixtures/media/poster.jpg",
    preload: "auto",
    crossOrigin: "anonymous",
    nativeControls: false,
    themedControls: true,
    muted: true,
  });
  await player.evaluate((element: ChunkifyPlayer) => { element.muted = false; });
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    hostMuted: element.muted,
    mediaMuted: element.media.muted,
  }))).toEqual({ hostMuted: false, mediaMuted: false });
});

test("maps public colors to Media Chrome and exposes CSS parts", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<style>
      chunkify-player { border-radius: 18px; }
      chunkify-player::part(theme) {
        --media-primary-color: rgb(1, 2, 3);
        --media-range-bar-color: rgb(196, 181, 253);
      }
    </style><chunkify-player controls
      primary-color="rgb(112, 12, 212)"
      secondary-color="rgb(187, 17, 17)"
      accent-color="rgb(207, 38, 38)"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  expect(await player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    const themeStyle = theme ? getComputedStyle(theme) : null;
    return {
      radius: getComputedStyle(element).borderRadius,
      primary: themeStyle?.getPropertyValue("--media-primary-color").trim(),
      secondary: themeStyle?.getPropertyValue("--media-secondary-color").trim(),
      accent: themeStyle?.getPropertyValue("--media-accent-color").trim(),
      rangeBar: themeStyle?.getPropertyValue("--media-range-bar-color").trim(),
      mediaPart: element.media.getAttribute("part"),
      themePart: theme?.getAttribute("part"),
    };
  })).toEqual({
    radius: "18px",
    primary: "rgb(1, 2, 3)",
    secondary: "rgb(187, 17, 17)",
    accent: "rgb(207, 38, 38)",
    rangeBar: "rgb(196, 181, 253)",
    mediaPart: "media",
    themePart: "theme",
  });

  await player.evaluate((element: ChunkifyPlayer) => { element.primaryColor = null; });
  await expect(player).not.toHaveAttribute("primary-color");
  expect(await player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector<HTMLElement>("[part=theme]");
    return theme?.style.getPropertyValue("--media-primary-color");
  })).toBe("");
});

test("the bundled theme supports player-level control visibility variables", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player controls
      style="display:block;width:800px;height:450px"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    return theme?.shadowRoot?.querySelector("media-controller")?.hasAttribute("breakpointsm");
  })).toBe(true);

  const displayedControls = async () => player.evaluate((element: ChunkifyPlayer) => {
    const root = element.shadowRoot?.querySelector("[part=theme]")?.shadowRoot;
    const displays = (selector: string) => Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? [])
      .map((control) => getComputedStyle(control).display);
    return {
      play: displays("media-play-button"),
      mute: displays("media-mute-button"),
      captions: displays("media-captions-button"),
      pip: displays("media-pip-button"),
      fullscreen: displays("media-fullscreen-button"),
      airplay: displays("media-airplay-button"),
      cast: displays("media-cast-button"),
    };
  });

  await player.evaluate((element) => {
    for (const name of ["play", "mute", "captions", "pip", "fullscreen", "airplay", "cast"] as const) {
      element.style.setProperty(`--${name}-button`, "none");
    }
  });
  await expect.poll(displayedControls).toEqual({
    play: ["none", "none"],
    mute: ["none"],
    captions: ["none"],
    pip: ["none"],
    fullscreen: ["none"],
    airplay: ["none"],
    cast: ["none"],
  });

  await player.evaluate((element) => { element.style.width = "400px"; });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    return theme?.shadowRoot?.querySelector("media-controller")?.hasAttribute("breakpointsm");
  })).toBe(false);
  await expect.poll(displayedControls).toEqual({
    play: ["none", "none"],
    mute: ["none"],
    captions: ["none"],
    pip: ["none"],
    fullscreen: ["none"],
    airplay: ["none"],
    cast: ["none"],
  });
});

test("disables automatic live seeking by default and supports an explicit opt-in", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = "<chunkify-player></chunkify-player>";
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => ({
    property: element.autoSeekToLive,
    controller: element.shadowRoot?.querySelector("[part=theme]")
      ?.shadowRoot?.querySelector("media-controller")?.hasAttribute("noautoseektolive"),
  }))).toEqual({ property: false, controller: true });

  await player.evaluate((element: ChunkifyPlayer) => { element.autoSeekToLive = true; });
  await expect(player).toHaveAttribute("autoseektolive");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => {
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    return {
      property: element.autoSeekToLive,
      controller: theme?.shadowRoot?.querySelector("media-controller")
        ?.hasAttribute("noautoseektolive"),
    };
  })).toEqual({ property: true, controller: false });
});

test("keeps the theme and controls inside a fixed player box", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player controls
      style="display:block;width:400px;height:225px"></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => {
    const playerBounds = element.getBoundingClientRect();
    const theme = element.shadowRoot?.querySelector("[part=theme]");
    const controlBar = theme?.shadowRoot?.querySelector("media-control-bar");
    const themeBounds = theme?.getBoundingClientRect();
    const controlBounds = controlBar?.getBoundingClientRect();
    const iconCenterOffsets = Array.from(theme?.shadowRoot?.querySelectorAll<HTMLElement>(".small-button") ?? [])
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => {
        const buttonBounds = button.getBoundingClientRect();
        const icon = Array.from(button.children)
          .find((child) => child.getBoundingClientRect().width > 0);
        const iconBounds = icon?.getBoundingClientRect();
        return iconBounds
          ? Math.round(((iconBounds.left + iconBounds.width / 2)
            - (buttonBounds.left + buttonBounds.width / 2)) * 100) / 100
          : null;
      });
    return {
      themeHeight: themeBounds?.height,
      playerHeight: playerBounds.height,
      controlsInside: Boolean(controlBounds
        && controlBounds.top >= playerBounds.top
        && controlBounds.bottom <= playerBounds.bottom),
      iconsCentered: iconCenterOffsets.length > 0
        && iconCenterOffsets.every((offset) => offset === 0),
    };
  })).toEqual({
    themeHeight: 225,
    playerHeight: 225,
    controlsInside: true,
    iconsCentered: true,
  });
});

for (const source of ["/tests/fixtures/media/master.m3u8", "/tests/fixtures/media/video.mp4"]) {
  test(`clearing ${source.endsWith("m3u8") ? "HLS" : "MP4"} stops playback and leaves an idle video`, async ({ page }) => {
    await page.evaluate((source) => {
      document.body.innerHTML = `<chunkify-player src="${source}" muted></chunkify-player>`;
    }, source);
    const player = page.locator("chunkify-player");
    const minimumReadyState = source.endsWith(".m3u8") ? 2 : 1;
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(minimumReadyState);
    await player.evaluate((element: ChunkifyPlayer) => { element.src = null; });
    await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBe(0);
    expect(await player.evaluate((element: ChunkifyPlayer) => ({
      tag: element.media.localName,
      src: element.media.getAttribute("src"),
      paused: element.media.paused,
    }))).toEqual({ tag: "video", src: null, paused: true });
  });
}

test("option changes preserve native playback state", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = '<chunkify-player src="/tests/fixtures/media/video.mp4" muted></chunkify-player>';
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.readyState)).toBeGreaterThanOrEqual(1);
  await player.evaluate(async (element: ChunkifyPlayer) => {
    await element.media.play();
    element.media.muted = false;
    element.media.addEventListener("loadstart", () => { element.dataset.reloaded = "true"; });
    element.controls = true;
    element.poster = "/tests/fixtures/media/poster.jpg";
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => element.media.currentTime)).toBeGreaterThan(0.1);
  expect(await player.evaluate((element: ChunkifyPlayer) => ({
    muted: element.media.muted,
    paused: element.media.paused,
    reloaded: element.dataset.reloaded ?? null,
  }))).toEqual({ muted: false, paused: false, reloaded: null });
});

test("removing a newly connected HLS player cannot start a late engine", async ({ page }) => {
  expect(await page.evaluate(async () => {
    const player = document.createElement("chunkify-player");
    player.src = "/tests/fixtures/media/master.m3u8";
    document.body.append(player);
    const media = player.media as HTMLVideoElement & { api?: unknown };
    player.remove();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { source: media.getAttribute("src"), hasEngine: Boolean(media.api) };
  })).toEqual({ source: null, hasEngine: false });
});

test("mirrors standard tracks into HLS and MP4 media", async ({ page }) => {
  await page.route("**/captions.vtt", (route) => route.fulfill({
    contentType: "text/vtt",
    body: "WEBVTT\n\n00:00.000 --> 00:06.000\nHello from Chunkify\n",
  }));
  await page.route("**/captions-fr.vtt", (route) => route.fulfill({
    contentType: "text/vtt",
    body: "WEBVTT\n\n00:00.000 --> 00:06.000\nBonjour de Chunkify\n",
  }));
  await page.route("**/thumbnails.vtt", (route) => route.fulfill({
    contentType: "text/vtt",
    body: "WEBVTT\n\n00:00.000 --> 00:06.000\n/tests/fixtures/media/poster.jpg#xywh=0,0,256,144\n",
  }));
  await page.evaluate(() => {
    document.body.innerHTML = `
      <chunkify-player src="/tests/fixtures/media/master.m3u8" controls muted>
        <track default kind="captions" srclang="en" label="English" src="/captions.vtt">
        <track kind="captions" srclang="fr" label="Français" src="/captions-fr.vtt">
        <track default kind="metadata" label="thumbnails" src="/thumbnails.vtt">
      </chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) =>
    Array.from(element.media.querySelectorAll<HTMLTrackElement>(":scope > track"), (track) => ({
      kind: track.kind,
      label: track.label,
      source: track.getAttribute("src"),
    })),
  )).toEqual([
    { kind: "captions", label: "English", source: "/captions.vtt" },
    { kind: "captions", label: "Français", source: "/captions-fr.vtt" },
    { kind: "metadata", label: "thumbnails", source: "/thumbnails.vtt" },
  ]);
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) =>
    Array.from(element.media.textTracks, (track) => track.label),
  )).toEqual(expect.arrayContaining(["English", "Français", "thumbnails"]));

  await player.evaluate((element: ChunkifyPlayer) => {
    element.querySelector("track[srclang=fr]")?.setAttribute("label", "French");
    element.querySelector("track[srclang=fr]")?.setAttribute("default", "");
    element.querySelector("track[kind=metadata]")?.setAttribute("src", "/thumbnails.vtt?updated");
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => ({
    french: element.media.querySelector("track[srclang=fr]")?.getAttribute("label"),
    frenchDefault: element.media.querySelector("track[srclang=fr]")?.hasAttribute("default"),
    thumbnailSource: element.media.querySelector("track[kind=metadata]")?.getAttribute("src"),
  }))).toEqual({
    french: "French",
    frenchDefault: true,
    thumbnailSource: "/thumbnails.vtt?updated",
  });

  await player.evaluate((element: ChunkifyPlayer) => {
    element.src = "/tests/fixtures/media/video.mp4";
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) => ({
    media: element.media.localName,
    tracks: element.media.querySelectorAll(":scope > track").length,
  }))).toEqual({ media: "video", tracks: 3 });

  await player.evaluate((element: ChunkifyPlayer) => {
    const captions = element.querySelector("track[kind=captions]");
    captions?.setAttribute("label", "English captions");
    element.querySelector("track[kind=metadata]")?.remove();
  });
  await expect.poll(() => player.evaluate((element: ChunkifyPlayer) =>
    Array.from(element.media.querySelectorAll<HTMLTrackElement>(":scope > track"), (track) => track.label),
  )).toEqual(["English captions", "French"]);
});

test("creates thumbnail previews from the thumbnails attribute", async ({ page }) => {
  await page.evaluate(() => {
    document.body.innerHTML = `<chunkify-player
      src="/tests/fixtures/media/master.m3u8"
      thumbnails="/tests/fixtures/media/thumbnails.vtt"
      controls muted
    ></chunkify-player>`;
  });
  const player = page.locator("chunkify-player");
  const thumbnailTracks = () => player.evaluate((element: ChunkifyPlayer) => ({
    property: element.thumbnails,
    tracks: Array.from(element.media.querySelectorAll<HTMLTrackElement>(":scope > track"), (track) => ({
      default: track.default,
      kind: track.kind,
      label: track.label,
      source: track.getAttribute("src"),
    })),
  }));

  await expect.poll(thumbnailTracks).toEqual({
    property: "/tests/fixtures/media/thumbnails.vtt",
    tracks: [{
      default: true,
      kind: "metadata",
      label: "thumbnails",
      source: "/tests/fixtures/media/thumbnails.vtt",
    }],
  });

  await player.evaluate((element: ChunkifyPlayer) => {
    element.thumbnails = "/thumbnails-updated.vtt";
    const track = document.createElement("track");
    track.kind = "metadata";
    track.label = "thumbnails";
    track.src = "/thumbnails-explicit.vtt";
    element.append(track);
  });
  await expect.poll(thumbnailTracks).toEqual({
    property: "/thumbnails-updated.vtt",
    tracks: [{
      default: false,
      kind: "metadata",
      label: "thumbnails",
      source: "/thumbnails-explicit.vtt",
    }],
  });

  await player.evaluate((element: ChunkifyPlayer) => {
    element.querySelector("track")?.remove();
  });
  await expect.poll(thumbnailTracks).toEqual({
    property: "/thumbnails-updated.vtt",
    tracks: [{
      default: true,
      kind: "metadata",
      label: "thumbnails",
      source: "/thumbnails-updated.vtt",
    }],
  });

  await player.evaluate((element: ChunkifyPlayer) => { element.thumbnails = null; });
  await expect.poll(thumbnailTracks).toEqual({ property: "", tracks: [] });
});
