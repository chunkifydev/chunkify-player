import { Hls, type HlsVideoElement } from "hls-video-element";
import {
  createPlayerTheme,
  defaultPlayerTheme,
  resolvePlayerTheme,
  syncPlayerTheme,
} from "./theme.js";

export { registerPlayerTheme } from "./theme.js";

export type ChunkifyMediaElement = HTMLVideoElement;
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
  "controls", "noautoseektolive", "primary-color", "secondary-color", "accent-color",
] as const;

const playerAttributes = [...mediaAttributes, ...themeAttributes, "credentials", "theme"] as const;

const mediaEvents = [
  "abort", "canplay", "canplaythrough", "durationchange", "emptied", "ended",
  "error", "loadeddata", "loadedmetadata", "loadstart", "pause", "play", "playing",
  "progress", "ratechange", "resize", "seeked", "seeking", "stalled", "suspend",
  "timeupdate", "volumechange", "waiting",
] as const;

function isHlsSource(source: string): boolean {
  if (!source) return false;
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
  static observedAttributes = [...playerAttributes];

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
  #pendingHlsSource: number | undefined;
  #hlsErrorCleanup: (() => void) | null = null;
  #failedMedia: ChunkifyMediaElement | null = null;
  #playbackGeneration = 0;
  #mirroredTracks = new Map<HTMLTrackElement, HTMLTrackElement>();
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
        media-theme,
        video,
        hls-video {
          display: block;
          width: 100%;
          height: 100%;
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

  get src(): string { return this.getAttribute("src") ?? ""; }
  set src(value: string | null | undefined) { this.#setStringAttribute("src", value); }

  get poster(): string { return this.getAttribute("poster") ?? ""; }
  set poster(value: string | null | undefined) { this.#setStringAttribute("poster", value); }

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

  get theme(): string { return resolvePlayerTheme(this.getAttribute("theme")); }
  set theme(value: string | null | undefined) { this.#setStringAttribute("theme", value); }

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

  get noAutoSeekToLive(): boolean { return this.hasAttribute("noautoseektolive"); }
  set noAutoSeekToLive(value: boolean) { this.toggleAttribute("noautoseektolive", value); }

  get playsInline(): boolean { return this.hasAttribute("playsinline"); }
  set playsInline(value: boolean) { this.toggleAttribute("playsinline", value); }

  connectedCallback() {
    for (const name of [
      "src", "poster", "preload", "crossOrigin", "credentials", "autoplay", "controls", "loop", "muted",
      "noAutoSeekToLive", "playsInline", "theme", "primaryColor", "secondaryColor", "accentColor",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value: unknown = Reflect.get(this, name);
      Reflect.deleteProperty(this, name);
      Reflect.set(this, name, value);
    }
    this.#trackObserver.observe(this, { attributes: true, childList: true, subtree: true });
    this.#syncMedia();
  }

  disconnectedCallback() {
    this.#playbackGeneration++;
    this.#trackObserver.disconnect();
    this.#cancelPendingHlsSource();
    this.#detachHlsErrors();
    this.#clearMirroredTracks();
    this.#clearMedia(this.#media);
  }

  attributeChangedCallback(name: typeof playerAttributes[number], oldValue: string | null, value: string | null) {
    if (this.isConnected && oldValue !== value) this.#syncMedia(name);
  }

  #setStringAttribute(name: string, value: string | null | undefined) {
    if (value == null) this.removeAttribute(name);
    else this.setAttribute(name, value);
  }

  #createMedia(tagName: "video" | "hls-video"): ChunkifyMediaElement {
    const media = document.createElement(tagName) as ChunkifyMediaElement;
    media.setAttribute("part", "media");
    media.setAttribute("slot", "media");
    media.setAttribute("aria-label", "Video player");
    for (const event of mediaEvents) media.addEventListener(event, this.#forwardMediaEvent);
    return media;
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

  #detachHlsErrors() {
    this.#hlsErrorCleanup?.();
    this.#hlsErrorCleanup = null;
  }

  #engineFor(media: ChunkifyMediaElement): PlaybackEngine {
    const hlsMedia = media as ChunkifyMediaElement & Pick<HlsVideoElement, "api">;
    return media.localName === "hls-video" && hlsMedia.api ? "hlsjs" : "native";
  }

  #configureHlsCredentials(media: ChunkifyMediaElement) {
    if (media.localName !== "hls-video") return;
    const hlsMedia = media as ChunkifyMediaElement & Pick<HlsVideoElement, "config">;
    hlsMedia.config = this.credentials === "include"
      ? { xhrSetup: (xhr) => { xhr.withCredentials = true; } }
      : null;
  }

  #attachHlsErrors(media: ChunkifyMediaElement) {
    const generation = this.#playbackGeneration;
    queueMicrotask(() => {
      if (!this.isConnected || this.#playbackGeneration !== generation
        || this.#media !== media || media.localName !== "hls-video") return;
      const hls = (media as ChunkifyMediaElement & Pick<HlsVideoElement, "api">).api;
      if (!hls) return;
      this.#detachHlsErrors();
      const onError = (_event: string, data: { fatal: boolean; type: string; details: string }) => {
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
      hls.on(Hls.Events.ERROR, onError);
      this.#hlsErrorCleanup = () => hls.off(Hls.Events.ERROR, onError);
    });
  }

  #fail(code: PlaybackErrorCode, engine: PlaybackEngine | null) {
    const media = this.#media;
    if (this.#failedMedia === media) return;
    this.#failedMedia = media;
    this.#cancelPendingHlsSource();
    this.#detachHlsErrors();
    this.#clearMedia(media);
    const detail: PlaybackErrorDetail = { code, message: errorMessages[code], engine };
    this.dispatchEvent(new CustomEvent<PlaybackErrorDetail>("playback-error", { detail }));
  }

  #clearMirroredTracks() {
    for (const track of this.#mirroredTracks.values()) track.remove();
    this.#mirroredTracks.clear();
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
          this.#attachHlsErrors(media);
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
    if (themeName === this.#themeName) return;
    const theme = createPlayerTheme(themeName);
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
    if (this.hasAttribute("credentials") && this.credentials === null) {
      this.#fail("invalid-credentials", null);
      return;
    }

    if (changedAttribute === undefined || changedAttribute === "theme") {
      this.#syncThemeSelection();
    }

    const tagName = isHlsSource(this.src) ? "hls-video" : "video";
    let replaced = false;
    if (this.#media.localName !== tagName || changedAttribute === "credentials") {
      this.#cancelPendingHlsSource();
      this.#detachHlsErrors();
      for (const event of mediaEvents) this.#media.removeEventListener(event, this.#forwardMediaEvent);
      const previous = this.#media;
      this.#clearMedia(previous);
      this.#media = this.#createMedia(tagName);
      previous.replaceWith(this.#media);
      replaced = true;
    }

    this.#configureHlsCredentials(this.#media);

    if (replaced || changedAttribute === undefined) {
      for (const attribute of mediaAttributes) this.#syncMediaAttribute(attribute);
      this.#media.muted = this.muted;
    } else if (isMediaAttribute(changedAttribute)) {
      this.#syncMediaAttribute(changedAttribute);
    }
    if (!this.hasAttribute("preload")) this.#media.preload = "metadata";
    if (replaced || changedAttribute === undefined || changedAttribute === "theme"
      || isThemeAttribute(changedAttribute)) {
      syncPlayerTheme(this.#theme, this.controls, this.noAutoSeekToLive, {
        primary: this.getAttribute("primary-color"),
        secondary: this.getAttribute("secondary-color"),
        accent: this.getAttribute("accent-color"),
      });
    }
    if (replaced || changedAttribute === undefined || changedAttribute === "src") this.#syncTracks();
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
