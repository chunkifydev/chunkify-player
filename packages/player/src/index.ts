import "hls-video-element";
import { createPlayerTheme, syncPlayerTheme } from "./theme.js";

export type ChunkifyMediaElement = HTMLVideoElement;

const mediaAttributes = [
  "autoplay", "crossorigin", "loop", "muted", "playsinline", "poster", "preload", "src",
] as const;

const playerAttributes = [...mediaAttributes, "controls"] as const;

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

export class ChunkifyPlayer extends HTMLElement {
  static observedAttributes = [...playerAttributes];

  #media: ChunkifyMediaElement;
  #theme: ReturnType<typeof createPlayerTheme>;
  #pendingHlsSource: number | undefined;
  #forwardMediaEvent = (event: Event) => {
    this.dispatchEvent(new Event(event.type));
  };

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host {
          display: block;
          overflow: hidden;
          border-radius: var(--chunkify-player-border-radius, 0);
        }
        video, hls-video { display: block; width: 100%; height: 100%; }
      </style>
    `;
    this.#theme = createPlayerTheme();
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

  get autoplay(): boolean { return this.hasAttribute("autoplay"); }
  set autoplay(value: boolean) { this.toggleAttribute("autoplay", value); }

  get controls(): boolean { return this.hasAttribute("controls"); }
  set controls(value: boolean) { this.toggleAttribute("controls", value); }

  get loop(): boolean { return this.hasAttribute("loop"); }
  set loop(value: boolean) { this.toggleAttribute("loop", value); }

  get muted(): boolean { return this.hasAttribute("muted"); }
  set muted(value: boolean) { this.toggleAttribute("muted", value); }

  get playsInline(): boolean { return this.hasAttribute("playsinline"); }
  set playsInline(value: boolean) { this.toggleAttribute("playsinline", value); }

  connectedCallback() {
    for (const name of [
      "src", "poster", "preload", "crossOrigin", "autoplay", "controls", "loop", "muted", "playsInline",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value: unknown = Reflect.get(this, name);
      Reflect.deleteProperty(this, name);
      Reflect.set(this, name, value);
    }
    this.#syncMedia();
  }

  disconnectedCallback() {
    this.#cancelPendingHlsSource();
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

  #syncMediaAttribute(attribute: typeof mediaAttributes[number]) {
    const value = this.getAttribute(attribute);
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

  #syncMedia(changedAttribute?: typeof playerAttributes[number]) {
    const tagName = isHlsSource(this.src) ? "hls-video" : "video";
    let replaced = false;
    if (this.#media.localName !== tagName) {
      this.#cancelPendingHlsSource();
      for (const event of mediaEvents) this.#media.removeEventListener(event, this.#forwardMediaEvent);
      const previous = this.#media;
      this.#clearMedia(previous);
      this.#media = this.#createMedia(tagName);
      previous.replaceWith(this.#media);
      replaced = true;
    }

    if (replaced || changedAttribute === undefined) {
      for (const attribute of mediaAttributes) this.#syncMediaAttribute(attribute);
      this.#media.muted = this.muted;
    } else if (changedAttribute !== "controls") {
      this.#syncMediaAttribute(changedAttribute);
    }
    if (!this.hasAttribute("preload")) this.#media.preload = "metadata";
    if (replaced || changedAttribute === undefined || changedAttribute === "controls") {
      syncPlayerTheme(this.#theme, this.controls);
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
