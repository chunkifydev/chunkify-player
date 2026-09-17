import type Hls from "hls.js";
import { connectPlayerTheme, createPlayerTheme, refreshThumbnailPreview, setThumbnailCredentials } from "./theme.js";
import { loadThumbnails } from "./thumbnails.js";

export type PlayerStatus = "preparing" | "ready" | "failed" | "expired";
export type PlayerEngine = "auto" | "native" | "hlsjs";

const errorMessages = {
  "missing-source": "A ready video requires a source URL.",
  "invalid-source": "Provide a valid HTTP or HTTPS video URL.",
  "invalid-status": "Use preparing, ready, failed, or expired for status.",
  "invalid-player": "Use auto, native, or hlsjs for player.",
  "invalid-credentials": "Use include for credentials, or omit the attribute.",
  "unsupported-engine": "The selected playback engine is not supported by this browser.",
  "unsupported-source": "The selected engine cannot play this media format.",
  "engine-load-failed": "The playback engine could not load. Check your module configuration and connection.",
  "network-error": "The video could not load. Check the source URL and access permissions.",
  "decode-error": "The browser could not decode this video.",
  "playback-failed": "Video playback failed.",
};

export type PlaybackErrorCode = keyof typeof errorMessages;
export interface PlaybackErrorDetail {
  code: PlaybackErrorCode;
  message: string;
  engine: Exclude<PlayerEngine, "auto"> | null;
}

const fallbacks = {
  preparing: "Your video is being prepared.",
  failed: "This video could not be prepared.",
  expired: "This video has expired.",
};

const mediaAttributes = ["autoplay", "muted", "loop", "playsinline", "controls"];
const mediaEvents = [
  "abort", "canplay", "canplaythrough", "durationchange", "emptied", "ended",
  "error", "loadeddata", "loadedmetadata", "loadstart", "pause", "play", "playing",
  "progress", "ratechange", "resize", "seeked", "seeking", "stalled", "suspend",
  "timeupdate", "volumechange", "waiting",
];

export class ChunkifyPlayer extends HTMLElement {
  static observedAttributes = ["status", "src", "poster", "thumbnails", "player", "credentials", ...mediaAttributes];

  // Add payload inference without changing the browser's listener implementation.
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

  #media: HTMLVideoElement;
  #theme: ReturnType<typeof createPlayerTheme>;
  #fallback: HTMLDivElement;
  #active = false;
  #updatePending = false;
  #generation = 0;
  #hls: Hls | null = null;
  #engine: Exclude<PlayerEngine, "auto"> | null = null;
  #thumbnailCleanup: (() => void) | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: block; }
        video { display: block; width: 100%; }
        [hidden] { display: none !important; }
      </style>
      <video part="media" aria-label="Video player" hidden></video>
      <div part="fallback" role="status"></div>
    `;
    this.#media = root.querySelector("video")!;
    this.#fallback = root.querySelector("div")!;
    this.#theme = createPlayerTheme();
    root.insertBefore(this.#theme, this.#media);
    this.#media.slot = "media";
    this.#theme.append(this.#media);
    for (const event of mediaEvents) {
      this.#media.addEventListener(event, () => {
        if (!this.#active) return;
        this.dispatchEvent(new Event(event));
        if (event === "error" && this.#media.error) {
          const code = this.#media.error.code;
          this.#fail(code === 2 ? "network-error" : code === 3 ? "decode-error"
            : code === 4 ? "unsupported-source" : "playback-failed");
        }
      });
    }
  }

  get media(): HTMLVideoElement {
    return this.#media;
  }

  get src(): string {
    return this.getAttribute("src") ?? "";
  }
  set src(value: string | null | undefined) {
    this.#setStringAttribute("src", value);
  }

  get poster(): string {
    return this.getAttribute("poster") ?? "";
  }
  set poster(value: string | null | undefined) {
    this.#setStringAttribute("poster", value);
  }

  get thumbnails(): string {
    return this.getAttribute("thumbnails") ?? "";
  }
  set thumbnails(value: string | null | undefined) {
    this.#setStringAttribute("thumbnails", value);
  }

  get credentials(): "include" | null {
    return this.getAttribute("credentials") === "include" ? "include" : null;
  }
  set credentials(value: "include" | null | undefined) {
    this.#setStringAttribute("credentials", value);
  }

  get status(): PlayerStatus | null {
    const value = this.getAttribute("status");
    return value === "preparing" || value === "ready" || value === "failed" || value === "expired"
      ? value : null;
  }
  set status(value: PlayerStatus | null | undefined) {
    this.#setStringAttribute("status", value);
  }

  get player(): PlayerEngine {
    const value = this.getAttribute("player");
    return value === "native" || value === "hlsjs" ? value : "auto";
  }
  set player(value: PlayerEngine) {
    this.setAttribute("player", value);
  }

  get autoplay(): boolean { return this.hasAttribute("autoplay"); }
  set autoplay(value: boolean) { this.toggleAttribute("autoplay", value); }
  get muted(): boolean { return this.hasAttribute("muted"); }
  set muted(value: boolean) { this.toggleAttribute("muted", value); }
  get loop(): boolean { return this.hasAttribute("loop"); }
  set loop(value: boolean) { this.toggleAttribute("loop", value); }
  get playsInline(): boolean { return this.hasAttribute("playsinline"); }
  set playsInline(value: boolean) { this.toggleAttribute("playsinline", value); }
  get controls(): boolean { return this.hasAttribute("controls"); }
  set controls(value: boolean) { this.toggleAttribute("controls", value); }

  #setStringAttribute(name: string, value: string | null | undefined) {
    if (value == null) this.removeAttribute(name);
    else this.setAttribute(name, value);
  }

  connectedCallback() {
    // Preserve properties assigned before the custom element was registered.
    for (const name of ["src", "poster", "thumbnails", "status", "player", "credentials", "autoplay", "muted", "loop", "playsInline", "controls"]) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value: unknown = Reflect.get(this, name);
        Reflect.deleteProperty(this, name);
        Reflect.set(this, name, value);
      }
    }
    for (const attribute of mediaAttributes) this.#syncMediaAttribute(attribute);
    connectPlayerTheme(this.#theme);
    this.#scheduleUpdate();
  }

  disconnectedCallback() {
    this.#stop();
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null) {
    if (oldValue === value) return;
    if (name === "poster") {
      this.#syncPoster();
    } else if (name === "thumbnails") {
      this.#syncThumbnails();
    } else if (mediaAttributes.includes(name)) {
      this.#syncMediaAttribute(name);
    } else if (this.isConnected) {
      this.#stop();
      this.#scheduleUpdate();
    }
  }

  #syncMediaAttribute(name: string) {
    if (name === "controls") {
      this.#theme.toggleAttribute("controls", this.controls);
      this.#theme.toggleAttribute("disabled", !this.controls);
      this.#theme.toggleAttribute("nohotkeys", !this.controls);
      this.#theme.render();
      return;
    }
    this.#media.toggleAttribute(name, this.hasAttribute(name));
    if (name === "muted") this.#media.muted = this.hasAttribute(name);
  }

  #syncPoster() {
    const poster = this.poster.trim();
    if (this.#active && this.isConnected && poster) this.#media.setAttribute("poster", poster);
    else this.#media.removeAttribute("poster");
  }

  #syncThumbnails() {
    this.#thumbnailCleanup?.();
    this.#thumbnailCleanup = null;
    refreshThumbnailPreview(this.#theme);
    const source = this.thumbnails.trim();
    if (this.#active && this.isConnected && source) {
      this.#thumbnailCleanup = loadThumbnails(this.#media, source, this.credentials ?? "same-origin",
        () => refreshThumbnailPreview(this.#theme));
    }
  }

  #scheduleUpdate() {
    if (this.#updatePending) return;
    this.#updatePending = true;
    queueMicrotask(() => {
      this.#updatePending = false;
      if (this.isConnected) void this.#render();
    });
  }

  #stop() {
    this.#generation++;
    this.#active = false;
    this.#theme.hidden = true;
    this.#syncPoster();
    this.#syncThumbnails();
    this.#hls?.destroy();
    this.#hls = null;
    this.#engine = null;
    if (this.#media.hasAttribute("src")) {
      this.#media.pause();
      this.#media.removeAttribute("src");
      this.#media.load();
    }
  }

  async #render() {
    const generation = this.#generation;
    this.#media.hidden = true;
    this.#theme.hidden = true;
    this.#fallback.hidden = false;
    const status = this.getAttribute("status");
    if (status === "preparing" || status === "failed" || status === "expired") {
      const slot = document.createElement("slot");
      slot.name = status;
      slot.textContent = fallbacks[status];
      this.#fallback.replaceChildren(slot);
      return;
    }
    if (status !== null && status !== "ready") {
      this.#fail("invalid-status");
      return;
    }
    const src = this.getAttribute("src")?.trim();
    if (!src) {
      if (status === "ready") {
        this.#fail("missing-source");
        return;
      }
      this.#fallback.textContent = "No video source provided.";
      return;
    }
    let url: URL;
    try {
      url = new URL(src, this.baseURI);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      this.#fail("invalid-source");
      return;
    }
    const player = this.getAttribute("player") ?? "auto";
    if (player !== "auto" && player !== "native" && player !== "hlsjs") {
      this.#fail("invalid-player");
      return;
    }
    if (this.hasAttribute("credentials") && this.credentials === null) {
      this.#fail("invalid-credentials");
      return;
    }
    const isMp4 = url.pathname.toLowerCase().endsWith(".mp4");
    const nativeHls = Boolean(this.#media.canPlayType("application/vnd.apple.mpegurl"));
    const useNative = player === "native" || (player === "auto" && (isMp4 || nativeHls));
    if (this.credentials === "include") this.#media.crossOrigin = "use-credentials";
    // Chromium's native HLS byte-range reads require CORS for cross-origin media.
    else if (useNative && !isMp4) this.#media.crossOrigin = "anonymous";
    else this.#media.removeAttribute("crossorigin");
    setThumbnailCredentials(this.#theme, this.credentials === "include");
    this.#fallback.hidden = true;
    this.#media.hidden = false;
    this.#theme.hidden = false;
    this.#active = true;
    this.#syncPoster();
    if (useNative) {
      this.#engine = "native";
      if (!isMp4 && !nativeHls) {
        this.#fail("unsupported-engine");
        return;
      }
      this.#media.src = url.href;
      this.#syncThumbnails();
      return;
    }
    this.#engine = "hlsjs";
    if (isMp4) {
      this.#fail("unsupported-source");
      return;
    }
    try {
      const { default: Hls } = await import("hls.js");
      if (generation !== this.#generation || !this.isConnected) return;
      if (!Hls.isSupported()) {
        this.#fail("unsupported-engine");
        return;
      }
      const includeCredentials = this.credentials === "include";
      const hls = new Hls({
        xhrSetup: (xhr) => { xhr.withCredentials = includeCredentials; },
      });
      this.#hls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || generation !== this.#generation) return;
        this.#fail(data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR ? "unsupported-source"
          : data.type === Hls.ErrorTypes.NETWORK_ERROR ? "network-error"
          : data.type === Hls.ErrorTypes.MEDIA_ERROR ? "decode-error" : "playback-failed");
      });
      hls.attachMedia(this.#media);
      hls.loadSource(url.href);
      this.#syncThumbnails();
    } catch {
      if (generation !== this.#generation || !this.isConnected) return;
      this.#fail("engine-load-failed");
    }
  }

  #fail(code: PlaybackErrorCode) {
    const detail: PlaybackErrorDetail = { code, message: errorMessages[code], engine: this.#engine };
    this.#stop();
    this.#media.hidden = true;
    this.#fallback.hidden = false;
    this.#fallback.textContent = detail.message;
    this.dispatchEvent(new CustomEvent<PlaybackErrorDetail>("playback-error", { detail }));
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
