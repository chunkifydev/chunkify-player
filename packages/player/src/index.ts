import { Hls, type HlsVideoElement } from "hls-video-element";
import {
  createPlayerTheme,
  defaultPlayerTheme,
  resolvePlayerTheme,
  syncPlayerTheme,
} from "./theme.js";
import { PlayerAnalytics, analyticsAttributes, isAnalyticsAttribute, readCustom, writeCustom,
  type AnalyticsAttribute, type PlayerAnalyticsCustom } from "./analytics.js";

export { registerPlayerTheme } from "./theme.js";
export { defaultAnalyticsEndpoint, type PlayerAnalyticsCustom } from "./analytics.js";

export type ChunkifyMediaElement = HTMLVideoElement;
export type PlayerAspectRatio = "portrait" | "landscape";
export type PlayerCredentials = "include";
export type PlaybackEngine = "native" | "hlsjs";

const errorMessages = {
  "invalid-credentials": "Use include for credentials, or omit the attribute.",
  "network-error": "The video could not load. Check the source URL and access permissions.",
  "decode-error": "The browser could not decode this video.",
  "unsupported-source": "The browser could not play this video source.",
  "playback-failed": "Video playback failed.",
} as const;

export type PlaybackErrorCode = keyof typeof errorMessages;
export interface PlaybackErrorDetail {
  code: PlaybackErrorCode;
  message: string;
  engine: PlaybackEngine | null;
}

const mediaAttributes = [
  "autoplay", "crossorigin", "loop", "muted", "playsinline", "poster", "preload", "src",
] as const;

const themeAttributes = [
  "controls", "autoseektolive", "primary-color", "secondary-color", "accent-color",
] as const;

const playerAttributes = [
  ...mediaAttributes, ...themeAttributes, "credentials", "theme", "thumbnails", "type",
  "cap-rendition-to-player-size",
] as const;

const mediaEvents = [
  "abort", "canplay", "canplaythrough", "durationchange", "emptied", "ended",
  "error", "loadeddata", "loadedmetadata", "loadstart", "pause", "play", "playing",
  "progress", "ratechange", "resize", "seeked", "seeking", "stalled", "suspend",
  "timeupdate", "volumechange", "waiting",
] as const;

function isHlsSource(source: string, type: string | null): boolean {
  if (!source) return false;
  const mimeType = type?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType) return mimeType === "application/vnd.apple.mpegurl" || mimeType === "application/x-mpegurl";
  try {
    return new URL(source, document.baseURI).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

function isMediaAttribute(
  attribute: typeof playerAttributes[number],
): attribute is typeof mediaAttributes[number] {
  return (mediaAttributes as readonly string[]).includes(attribute);
}

function isThemeAttribute(
  attribute: typeof playerAttributes[number],
): attribute is typeof themeAttributes[number] {
  return (themeAttributes as readonly string[]).includes(attribute);
}

export class ChunkifyPlayer extends HTMLElement {
  static observedAttributes = [...playerAttributes, ...analyticsAttributes];

  declare addEventListener: ((
    type: "playback-error",
    listener: ((this: ChunkifyPlayer, event: CustomEvent<PlaybackErrorDetail>) => void) | null,
    options?: boolean | AddEventListenerOptions,
  ) => void) & HTMLElement["addEventListener"];

  declare removeEventListener: ((
    type: "playback-error",
    listener: ((this: ChunkifyPlayer, event: CustomEvent<PlaybackErrorDetail>) => void) | null,
    options?: boolean | EventListenerOptions,
  ) => void) & HTMLElement["removeEventListener"];

  #media: ChunkifyMediaElement;
  #theme: ReturnType<typeof createPlayerTheme>;
  #themeName = defaultPlayerTheme;
  #analytics = new PlayerAnalytics(this);
  #pendingHlsSource: number | undefined;
  #hlsCleanup: (() => void) | null = null;
  #failedMedia: ChunkifyMediaElement | null = null;
  #playbackGeneration = 0;
  #firstHlsPlayPending = false;
  #soughtBeforeFirstHlsPlay = false;
  #backgroundPlayback = false;
  #backgroundResumePosition: number | null = null;
  #backgroundResumeAttempt = 0;
  #visibilityDocument: Document | null = null;
  #onVisibilityChange = () => {
    this.#cancelBackgroundPlayback();
    this.#backgroundPlayback = this.ownerDocument.hidden && !this.#media.paused
      && !this.#media.ended && !this.#media.error;
  };
  #mirroredTracks = new Map<HTMLTrackElement, HTMLTrackElement>();
  #thumbnailTrack = document.createElement("track");
  #trackObserver = new MutationObserver((records) => {
    let tracksChanged = false;
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLTrackElement
        && record.target.parentElement === this) {
        const mirroredTrack = this.#mirroredTracks.get(record.target);
        if (!mirroredTrack) {
          tracksChanged = true;
        } else if (record.attributeName && !record.target.hasAttribute(record.attributeName)
          && this.#media.localName === "hls-video") {
          this.#syncTrackAttributes(record.target, mirroredTrack);
          this.#removeHlsNativeTrackAttribute(record.target, record.attributeName);
        } else {
          this.#syncTrackAttributes(record.target, mirroredTrack);
        }
        if (record.attributeName === "kind" || record.attributeName === "label") {
          tracksChanged = true;
        }
      }
      if (record.type === "childList" && record.target === this
        && [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof HTMLTrackElement)) {
        tracksChanged = true;
      }
    }
    if (tracksChanged) this.#syncTracks();
  });
  #forwardMediaEvent = (event: Event) => {
    const media = event.currentTarget as ChunkifyMediaElement;
    if (media !== this.#media) return;
    if (event.type === "play" && !media.paused && this.ownerDocument.hidden) {
      this.#backgroundPlayback = true;
    }
    if (event.type === "pause") this.#resumeBackgroundPlayback(media);
    if (event.type === "emptied" || event.type === "loadstart"
      || event.type === "ended" || event.type === "error") {
      this.#cancelBackgroundPlayback();
    }
    if (event.type === "seeking" && this.#firstHlsPlayPending && media.paused) {
      this.#soughtBeforeFirstHlsPlay = true;
    }
    if ((event.type === "play" || event.type === "playing")
      && this.#firstHlsPlayPending && media.seekable.length) {
      this.#firstHlsPlayPending = false;
      const start = media.seekable.start(0);
      if (!this.autoSeekToLive && !this.#soughtBeforeFirstHlsPlay
        && this.#engineFor(media) === "native" && media.currentTime > start + 1) {
        media.currentTime = start;
      }
    }
    const generation = this.#playbackGeneration;
    const mediaError = event.type === "error" ? media.error : null;
    this.dispatchEvent(new Event(event.type));
    if (!mediaError) return;
    const errorCode = mediaError.code;
    globalThis.setTimeout(() => {
      if (!this.isConnected || this.#playbackGeneration !== generation
        || this.#media !== media || this.#failedMedia === media) return;
      this.#fail(errorCode === 2 ? "network-error"
        : errorCode === 3 ? "decode-error"
        : errorCode === 4 ? "unsupported-source"
        : "playback-failed", this.#engineFor(media));
    }, 0);
  };

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host {
          display: block;
          overflow: hidden;
        }
        :host([aspect-ratio="portrait"]) {
          aspect-ratio: 9 / 16;
        }
        :host([aspect-ratio="landscape"]) {
          aspect-ratio: 16 / 9;
        }
        media-theme,
        video,
        hls-video {
          display: block;
          width: 100%;
          height: 100%;
        }
        video,
        hls-video {
          object-fit: var(--media-object-fit, contain);
          object-position: var(--media-object-position, 50% 50%);
        }
      </style>
    `;
    this.#theme = createPlayerTheme(this.#themeName);
    this.#media = this.#createMedia("video");
    this.#theme.append(this.#media);
    root.append(this.#theme);
  }

  get media(): ChunkifyMediaElement {
    return this.#media;
  }

  /** Reload the current source after a playback failure. */
  retry(): boolean {
    if (!this.isConnected || !this.src || this.#failedMedia !== this.#media
      || (this.hasAttribute("credentials") && this.credentials === null)) return false;
    this.#syncMedia("src");
    return true;
  }

  get src(): string { return this.getAttribute("src") ?? ""; }
  set src(value: string | null | undefined) { this.#setStringAttribute("src", value); }

  get type(): string { return this.getAttribute("type") ?? ""; }
  set type(value: string | null | undefined) { this.#setStringAttribute("type", value); }

  get poster(): string { return this.getAttribute("poster") ?? ""; }
  set poster(value: string | null | undefined) { this.#setStringAttribute("poster", value); }

  get thumbnails(): string { return this.getAttribute("thumbnails") ?? ""; }
  set thumbnails(value: string | null | undefined) { this.#setStringAttribute("thumbnails", value); }

  get preload(): string { return this.getAttribute("preload") ?? "metadata"; }
  set preload(value: string | null | undefined) { this.#setStringAttribute("preload", value); }

  get crossOrigin(): string | null { return this.getAttribute("crossorigin"); }
  set crossOrigin(value: string | null | undefined) { this.#setStringAttribute("crossorigin", value); }

  get credentials(): PlayerCredentials | null {
    return this.getAttribute("credentials") === "include" ? "include" : null;
  }
  set credentials(value: PlayerCredentials | null | undefined) {
    this.#setStringAttribute("credentials", value);
  }

  get capRenditionToPlayerSize(): boolean {
    return this.getAttribute("cap-rendition-to-player-size") !== "false";
  }
  set capRenditionToPlayerSize(value: boolean) {
    if (value) this.removeAttribute("cap-rendition-to-player-size");
    else this.setAttribute("cap-rendition-to-player-size", "false");
  }

  get theme(): string { return resolvePlayerTheme(this.getAttribute("theme")); }
  set theme(value: string | null | undefined) { this.#setStringAttribute("theme", value); }

  get aspectRatio(): PlayerAspectRatio | null {
    const value = this.getAttribute("aspect-ratio");
    return value === "portrait" || value === "landscape" ? value : null;
  }
  set aspectRatio(value: PlayerAspectRatio | null | undefined) {
    this.#setStringAttribute("aspect-ratio", value);
  }

  get primaryColor(): string { return this.getAttribute("primary-color") ?? ""; }
  set primaryColor(value: string | null | undefined) { this.#setStringAttribute("primary-color", value); }

  get secondaryColor(): string { return this.getAttribute("secondary-color") ?? ""; }
  set secondaryColor(value: string | null | undefined) { this.#setStringAttribute("secondary-color", value); }

  get accentColor(): string { return this.getAttribute("accent-color") ?? ""; }
  set accentColor(value: string | null | undefined) { this.#setStringAttribute("accent-color", value); }

  get autoplay(): boolean { return this.hasAttribute("autoplay"); }
  set autoplay(value: boolean) { this.toggleAttribute("autoplay", value); }

  get controls(): boolean { return this.hasAttribute("controls"); }
  set controls(value: boolean) { this.toggleAttribute("controls", value); }

  get loop(): boolean { return this.hasAttribute("loop"); }
  set loop(value: boolean) { this.toggleAttribute("loop", value); }

  get muted(): boolean { return this.hasAttribute("muted"); }
  set muted(value: boolean) { this.toggleAttribute("muted", value); }

  get autoSeekToLive(): boolean { return this.hasAttribute("autoseektolive"); }
  set autoSeekToLive(value: boolean) { this.toggleAttribute("autoseektolive", value); }

  get playsInline(): boolean { return this.hasAttribute("playsinline"); }
  set playsInline(value: boolean) { this.toggleAttribute("playsinline", value); }

  /** Send playback analytics to a Chunkify collector. Requires `analyticsIngestKey` and `analyticsVideoId`. */
  get analytics(): boolean { return this.hasAttribute("analytics"); }
  set analytics(value: boolean) { this.toggleAttribute("analytics", value); }

  /** The collector's public write-only ingest key. */
  get analyticsIngestKey(): string { return this.getAttribute("analytics-ingest-key") ?? ""; }
  set analyticsIngestKey(value: string | null | undefined) {
    this.#setStringAttribute("analytics-ingest-key", value);
  }

  /** Your video ID or Chunkify asset ID, sent as `video_id`. */
  get analyticsVideoId(): string { return this.getAttribute("analytics-video-id") ?? ""; }
  set analyticsVideoId(value: string | null | undefined) { this.#setStringAttribute("analytics-video-id", value); }

  /**
   * The analytics server's URL; `/v1/events` is added when it has no path. A URL with a path is used as
   * given. Empty means Chunkify's hosted collector, `defaultAnalyticsEndpoint`.
   */
  get analyticsEndpoint(): string { return this.getAttribute("analytics-endpoint") ?? ""; }
  set analyticsEndpoint(value: string | null | undefined) { this.#setStringAttribute("analytics-endpoint", value); }

  get analyticsVideoTitle(): string { return this.getAttribute("analytics-video-title") ?? ""; }
  set analyticsVideoTitle(value: string | null | undefined) {
    this.#setStringAttribute("analytics-video-title", value);
  }

  /** A pseudonymous ID of the signed-in user, never an email address. */
  get analyticsUserId(): string { return this.getAttribute("analytics-user-id") ?? ""; }
  set analyticsUserId(value: string | null | undefined) { this.#setStringAttribute("analytics-user-id", value); }

  get analyticsEnvironment(): string { return this.getAttribute("analytics-environment") ?? ""; }
  set analyticsEnvironment(value: string | null | undefined) {
    this.#setStringAttribute("analytics-environment", value);
  }

  /**
   * Custom dimensions, stored as `analytics-custom-<key>` attributes and sent as text on `view_started`.
   * At most 10 keys of 1 to 40 lowercase letters, digits or underscores. A change applies from the next video.
   */
  get analyticsCustom(): Record<string, string> { return readCustom(this); }
  set analyticsCustom(value: PlayerAnalyticsCustom | null | undefined) { writeCustom(this, value); }

  /** Keep the anonymous viewer ID in localStorage across page loads. Defaults to true. */
  get analyticsPersistViewerId(): boolean { return this.getAttribute("analytics-persist-viewer-id") !== "false"; }
  set analyticsPersistViewerId(value: boolean) {
    if (value) this.removeAttribute("analytics-persist-viewer-id");
    else this.setAttribute("analytics-persist-viewer-id", "false");
  }

  connectedCallback() {
    for (const name of [
      "src", "type", "poster", "preload", "crossOrigin", "credentials", "autoplay", "controls", "loop", "muted",
      "autoSeekToLive", "playsInline", "theme", "aspectRatio", "thumbnails", "primaryColor",
      "secondaryColor", "accentColor", "capRenditionToPlayerSize", "analytics", "analyticsIngestKey",
      "analyticsVideoId", "analyticsEndpoint", "analyticsVideoTitle", "analyticsUserId", "analyticsEnvironment",
      "analyticsPersistViewerId", "analyticsCustom",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value: unknown = Reflect.get(this, name);
      Reflect.deleteProperty(this, name);
      Reflect.set(this, name, value);
    }
    this.#trackObserver.observe(this, { attributes: true, childList: true, subtree: true });
    this.#visibilityDocument = this.ownerDocument;
    this.#visibilityDocument.addEventListener("visibilitychange", this.#onVisibilityChange);
    this.#syncMedia();
    this.#analytics.schedule();
  }

  disconnectedCallback() {
    // End the view before the media is cleared, so clearing it is not recorded.
    this.#analytics.stop();
    this.#playbackGeneration++;
    this.#cancelBackgroundPlayback();
    this.#visibilityDocument?.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.#visibilityDocument = null;
    this.#trackObserver.disconnect();
    this.#cancelPendingHlsSource();
    this.#detachHlsEvents();
    this.#clearMirroredTracks();
    this.#clearMedia(this.#media);
  }

  attributeChangedCallback(name: typeof playerAttributes[number] | AnalyticsAttribute,
    oldValue: string | null, value: string | null) {
    if (!this.isConnected || oldValue === value) return;
    if (isAnalyticsAttribute(name)) {
      this.#analytics.schedule();
      return;
    }
    this.#syncMedia(name);
    // A new video starts a new analytics session.
    if (name === "src") this.#analytics.schedule();
  }

  #setStringAttribute(name: string, value: string | null | undefined) {
    if (value == null) this.removeAttribute(name);
    else this.setAttribute(name, value);
  }

  #createMedia(tagName: "video" | "hls-video"): ChunkifyMediaElement {
    const media = document.createElement(tagName) as ChunkifyMediaElement;
    const pause = media.pause;
    media.pause = () => {
      // Controls and application calls must always override background recovery.
      if (media === this.#media) this.#cancelBackgroundPlayback();
      pause.call(media);
    };
    media.setAttribute("part", "media");
    media.setAttribute("slot", "media");
    media.setAttribute("aria-label", "Video player");
    for (const event of mediaEvents) media.addEventListener(event, this.#forwardMediaEvent);
    return media;
  }

  #cancelBackgroundPlayback() {
    this.#backgroundPlayback = false;
    this.#backgroundResumePosition = null;
    this.#backgroundResumeAttempt++;
  }

  #resumeBackgroundPlayback(media: ChunkifyMediaElement) {
    if (!this.#backgroundPlayback || !this.isConnected
      || !this.ownerDocument.hidden || !media.paused || media.ended || media.error) return;
    // Browsers can pause again well after hiding the tab. Require playback
    // progress between attempts to avoid a loop if playback stays suspended.
    if (this.#backgroundResumePosition !== null
      && media.currentTime === this.#backgroundResumePosition) {
      this.#cancelBackgroundPlayback();
      return;
    }
    this.#backgroundResumePosition = media.currentTime;
    const attempt = ++this.#backgroundResumeAttempt;
    void media.play().catch(() => {
      if (this.#backgroundResumeAttempt === attempt) this.#cancelBackgroundPlayback();
    });
  }

  #clearMedia(media: ChunkifyMediaElement) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }

  #cancelPendingHlsSource() {
    if (this.#pendingHlsSource === undefined) return;
    clearTimeout(this.#pendingHlsSource);
    this.#pendingHlsSource = undefined;
  }

  #detachHlsEvents() {
    this.#hlsCleanup?.();
    this.#hlsCleanup = null;
  }

  #engineFor(media: ChunkifyMediaElement): PlaybackEngine {
    const hlsMedia = media as ChunkifyMediaElement & Pick<HlsVideoElement, "api">;
    return media.localName === "hls-video" && hlsMedia.api ? "hlsjs" : "native";
  }

  #configureHlsPlayback(media: ChunkifyMediaElement) {
    if (media.localName !== "hls-video") return;
    const hlsMedia = media as ChunkifyMediaElement & Pick<HlsVideoElement, "config" | "api">;
    const credentials = this.credentials === "include"
      ? { xhrSetup: (xhr: XMLHttpRequest) => { xhr.withCredentials = true; } }
      : {};
    hlsMedia.config = {
      capLevelToPlayerSize: this.capRenditionToPlayerSize,
      startPosition: this.autoSeekToLive ? -1 : 0,
      ...credentials,
    };
    if (hlsMedia.api) hlsMedia.api.capLevelToPlayerSize = this.capRenditionToPlayerSize;
  }

  // hls.js only nudges a stalled playhead across buffer holes. WebKit can also stop advancing
  // inside a buffered range after an early seek (for example hls.js skipping a small gap at the
  // start), while it reports playing with enough data. Seeking to the same position restarts it.
  #restartStalledPlayback(media: ChunkifyMediaElement) {
    if (media.paused || media.seeking || media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    const position = media.currentTime;
    const { buffered } = media;
    for (let index = 0; index < buffered.length; index++) {
      if (buffered.start(index) <= position && position + 0.1 < buffered.end(index)) {
        media.currentTime = position;
        return;
      }
    }
  }

  #attachHlsEvents(media: ChunkifyMediaElement) {
    const generation = this.#playbackGeneration;
    queueMicrotask(() => {
      if (!this.isConnected || this.#playbackGeneration !== generation
        || this.#media !== media || media.localName !== "hls-video") return;
      const hlsMedia = media as ChunkifyMediaElement & Pick<HlsVideoElement, "api"> & {
        videoRenditions?: EventTarget & { selectedIndex?: number };
      };
      const hls = hlsMedia.api;
      if (!hls) return;
      this.#detachHlsEvents();
      const onError = (_event: string, data: { fatal: boolean; type: string; details: string }) => {
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          if (this.#playbackGeneration === generation && this.#media === media) this.#restartStalledPlayback(media);
          return;
        }
        if (!data.fatal || this.#playbackGeneration !== generation
          || this.#media !== media || this.#failedMedia === media) return;
        const code: PlaybackErrorCode = data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR
          ? "unsupported-source"
          : data.type === Hls.ErrorTypes.NETWORK_ERROR
            ? "network-error"
            : data.type === Hls.ErrorTypes.MEDIA_ERROR ? "decode-error" : "playback-failed";
        globalThis.setTimeout(() => {
          if (this.isConnected && this.#playbackGeneration === generation
            && this.#media === media && this.#failedMedia !== media) this.#fail(code, "hlsjs");
        }, 0);
      };
      const renditions = hlsMedia.videoRenditions;
      const onRenditionChange = () => {
        if (this.#playbackGeneration !== generation || this.#media !== media || hlsMedia.api !== hls) return;
        const index = renditions?.selectedIndex;
        // hls-video-element skips nextLevel assignments when the buffered level matches.
        // An explicit choice must still update the requested level, including Auto (-1).
        if (typeof index === "number" && hls.manualLevel !== index) hls.nextLevel = index;
      };
      // With preload="none", hls-video-element starts loading on the first Play by
      // calling startLoad() without a position. hls.js then already knows the
      // playlist and starts a live or growing EVENT playlist at the live edge,
      // ignoring the configured startPosition. Start that first load where the
      // viewer is instead: the beginning, unless they chose a time.
      const startLoad = hls.startLoad;
      const startFirstLoad: typeof startLoad = (startPosition = -1, skipSeekToStartPosition) => {
        hls.startLoad = startLoad;
        startLoad.call(hls, startPosition === -1 ? media.currentTime : startPosition,
          skipSeekToStartPosition);
      };
      if (!this.autoSeekToLive && !hls.loadingEnabled) hls.startLoad = startFirstLoad;
      hls.on(Hls.Events.ERROR, onError);
      renditions?.addEventListener("change", onRenditionChange);
      this.#hlsCleanup = () => {
        if (hls.startLoad === startFirstLoad) hls.startLoad = startLoad;
        hls.off(Hls.Events.ERROR, onError);
        renditions?.removeEventListener("change", onRenditionChange);
      };
    });
  }

  #fail(code: PlaybackErrorCode, engine: PlaybackEngine | null) {
    const media = this.#media;
    if (this.#failedMedia === media) return;
    this.#failedMedia = media;
    this.#cancelPendingHlsSource();
    this.#detachHlsEvents();
    this.#clearMedia(media);
    const detail: PlaybackErrorDetail = { code, message: errorMessages[code], engine };
    this.dispatchEvent(new CustomEvent<PlaybackErrorDetail>("playback-error", { detail }));
  }

  #clearMirroredTracks() {
    for (const track of this.#mirroredTracks.values()) track.remove();
    this.#mirroredTracks.clear();
    this.#thumbnailTrack.remove();
  }

  #removeHlsNativeTrackAttribute(track: HTMLTrackElement, attribute: string) {
    // custom-media-element converts removed child attributes to empty attributes;
    // correct its native clone after its observer has finished without replacing the track.
    globalThis.setTimeout(() => {
      if (track.hasAttribute(attribute) || this.#media.localName !== "hls-video") return;
      const mirroredTrack = this.#mirroredTracks.get(track);
      if (!mirroredTrack) return;
      const trackIndex = Array.from(this.#media.children)
        .filter((child): child is HTMLTrackElement => child instanceof HTMLTrackElement)
        .indexOf(mirroredTrack);
      const nativeMedia = (this.#media as ChunkifyMediaElement & { nativeEl?: HTMLVideoElement }).nativeEl;
      const nativeTrack = Array.from(nativeMedia?.children ?? [])
        .filter((child): child is HTMLTrackElement => child instanceof HTMLTrackElement)[trackIndex];
      nativeTrack?.removeAttribute(attribute);
    }, 0);
  }

  #syncTrackAttributes(track: HTMLTrackElement, mirroredTrack: HTMLTrackElement) {
    for (const attribute of Array.from(mirroredTrack.attributes)) {
      if (attribute.name === "slot" || !track.hasAttribute(attribute.name)) {
        mirroredTrack.removeAttribute(attribute.name);
      }
    }
    for (const attribute of Array.from(track.attributes)) {
      if (attribute.name !== "slot" && mirroredTrack.getAttribute(attribute.name) !== attribute.value) {
        mirroredTrack.setAttribute(attribute.name, attribute.value);
      }
    }
  }

  #syncTracks() {
    if (!this.isConnected || !this.src) {
      this.#clearMirroredTracks();
      return;
    }

    const tracks = Array.from(this.children)
      .filter((child): child is HTMLTrackElement => child instanceof HTMLTrackElement);
    const currentTracks = new Set(tracks);
    for (const [track, mirroredTrack] of this.#mirroredTracks) {
      if (!currentTracks.has(track) || mirroredTrack.parentElement !== this.#media) {
        mirroredTrack.remove();
        this.#mirroredTracks.delete(track);
      }
    }

    const mirroredTracks = tracks.map((track) => {
      let mirroredTrack = this.#mirroredTracks.get(track);
      if (!mirroredTrack) {
        mirroredTrack = document.createElement("track");
        this.#mirroredTracks.set(track, mirroredTrack);
      }
      this.#syncTrackAttributes(track, mirroredTrack);
      return mirroredTrack;
    });
    const hasExplicitThumbnails = tracks.some((track) =>
      track.kind === "metadata" && track.label === "thumbnails");
    if (this.thumbnails && !hasExplicitThumbnails) {
      this.#thumbnailTrack.default = true;
      this.#thumbnailTrack.kind = "metadata";
      this.#thumbnailTrack.label = "thumbnails";
      this.#thumbnailTrack.setAttribute("src", this.thumbnails);
      mirroredTracks.push(this.#thumbnailTrack);
    } else {
      this.#thumbnailTrack.remove();
    }
    const activeTracks = Array.from(this.#media.children)
      .filter((child): child is HTMLTrackElement => child instanceof HTMLTrackElement);
    if (activeTracks.some((track, index) => track !== mirroredTracks[index])
      || activeTracks.length !== mirroredTracks.length) {
      this.#media.append(...mirroredTracks);
    }
  }

  #syncMediaAttribute(attribute: typeof mediaAttributes[number]) {
    const value = attribute === "crossorigin" && this.credentials === "include"
      ? "use-credentials"
      : this.getAttribute(attribute);
    const currentValue = this.#media.getAttribute(attribute);

    if (attribute === "src" && this.#media.localName === "hls-video") {
      this.#cancelPendingHlsSource();
      if (currentValue !== null) this.#media.removeAttribute("src");
      if (value === null) return;
      const media = this.#media;
      this.#pendingHlsSource = window.setTimeout(() => {
        this.#pendingHlsSource = undefined;
        if (this.isConnected && this.#media === media && this.src === value) {
          media.setAttribute("src", value);
          this.#attachHlsEvents(media);
        }
      });
      return;
    }

    if (value === null) {
      if (currentValue === null) return;
      if (attribute === "src") this.#clearMedia(this.#media);
      else {
        this.#media.removeAttribute(attribute);
        if (attribute === "muted") this.#media.muted = false;
      }
      return;
    }
    if (currentValue !== value) this.#media.setAttribute(attribute, value);
    if (attribute === "muted") this.#media.muted = this.muted;
  }

  #syncThemeSelection() {
    const themeName = this.theme;
    const noAutoSeekToLive = !this.autoSeekToLive;
    if (themeName === this.#themeName
      && this.#theme.hasAttribute("noautoseektolive") === noAutoSeekToLive) return;
    const theme = createPlayerTheme(themeName, noAutoSeekToLive);
    this.#theme.replaceWith(theme);
    theme.append(this.#media);
    this.#theme = theme;
    this.#themeName = themeName;
  }

  #syncMedia(changedAttribute?: typeof playerAttributes[number]) {
    if (changedAttribute === undefined || changedAttribute === "src" || changedAttribute === "credentials") {
      this.#playbackGeneration++;
      this.#failedMedia = null;
    }
    if (changedAttribute === undefined || changedAttribute === "src"
      || changedAttribute === "type" || changedAttribute === "credentials") {
      this.#cancelBackgroundPlayback();
    }
    if (this.hasAttribute("credentials") && this.credentials === null) {
      this.#fail("invalid-credentials", null);
      return;
    }

    if (changedAttribute === undefined || changedAttribute === "theme") {
      this.#syncThemeSelection();
    }

    const isHls = isHlsSource(this.src, this.getAttribute("type"));
    const tagName = isHls ? "hls-video" : "video";
    if (changedAttribute === undefined || changedAttribute === "src"
      || changedAttribute === "type" || changedAttribute === "credentials") {
      this.#firstHlsPlayPending = isHls;
      this.#soughtBeforeFirstHlsPlay = false;
    }
    let previous: ChunkifyMediaElement | null = null;
    if (this.#media.localName !== tagName || changedAttribute === "credentials") {
      this.#cancelPendingHlsSource();
      this.#detachHlsEvents();
      for (const event of mediaEvents) this.#media.removeEventListener(event, this.#forwardMediaEvent);
      previous = this.#media;
      // Pause now; the resource is released after mediachange so listeners can still read its position.
      previous.pause();
      this.#media = this.#createMedia(tagName);
      previous.replaceWith(this.#media);
    }
    const replaced = previous !== null;

    this.#configureHlsPlayback(this.#media);

    if (replaced || changedAttribute === undefined) {
      for (const attribute of mediaAttributes) this.#syncMediaAttribute(attribute);
      this.#media.muted = this.muted;
    } else if (isMediaAttribute(changedAttribute)) {
      this.#syncMediaAttribute(changedAttribute);
    }
    if (!this.hasAttribute("preload")) this.#media.preload = "metadata";
    if (replaced || changedAttribute === undefined || changedAttribute === "theme"
      || isThemeAttribute(changedAttribute)) {
      syncPlayerTheme(this.#theme, this.controls, !this.autoSeekToLive, {
        primary: this.getAttribute("primary-color"),
        secondary: this.getAttribute("secondary-color"),
        accent: this.getAttribute("accent-color"),
      });
    }
    if (replaced || changedAttribute === undefined || changedAttribute === "src"
      || changedAttribute === "thumbnails") this.#syncTracks();
    if (previous) {
      this.dispatchEvent(new Event("mediachange"));
      this.#clearMedia(previous);
    }
  }
}

if (!customElements.get("chunkify-player")) {
  customElements.define("chunkify-player", ChunkifyPlayer);
}

declare global {
  interface HTMLElementTagNameMap {
    "chunkify-player": ChunkifyPlayer;
  }
}
