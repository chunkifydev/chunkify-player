import type Hls from "hls.js";
import { attachAnalyticsWithManagedSource, type AnalyticsConnector, type AnalyticsConnectorSnapshot,
  type AnalyticsOptions, type AnalyticsSession } from "./core.js";
import { createHlsJsConnector, type HlsJsAnalyticsConnector } from "./hlsjs.js";
import { fixedAnalyticsOptions } from "./options.js";

/** Video.js 10 HTML media components expose the media API on the custom element. */
export type VideoJsMediaElement = HTMLElement & {
  readonly src: string;
  readonly engine?: Hls | object | null;
  readonly adapter?: object;
};

const videoJsMediaTags = new Set(["hls-video", "hlsjs-video", "native-hls-video"]);

function emptySnapshot(): AnalyticsConnectorSnapshot {
  return {
    renditionWidth: null, renditionHeight: null, renditionCodec: null, renditionBitrate: null,
    renditionSwitchCount: null, deliveryRequestCount: null,
    deliveryTransferredBytes: null, deliveryDurationMs: null,
  };
}

function videoJsConnector(engine: Hls | null): AnalyticsConnector & { destroy(): void } {
  if (engine) {
    const hls: HlsJsAnalyticsConnector = createHlsJsConnector(engine);
    return { ...hls, name: "video.js/hls.js", playerName: "video.js", playerVersion: null };
  }
  return {
    name: "video.js", version: null, playerName: "video.js", playerVersion: null,
    snapshot: emptySnapshot,
    subscribeToErrors: () => () => {},
    destroy() {},
  };
}

/** Monitor a Video.js 10 HTML media component, including its hls.js engine when active. */
export function monitorVideoJs(media: VideoJsMediaElement, initialOptions: AnalyticsOptions):
  Pick<AnalyticsSession, "startAttempt" | "sourceChanged" | "destroy"> {
  const options = fixedAnalyticsOptions(initialOptions);
  if (!media || !videoJsMediaTags.has(media.localName)
    || typeof (media as { play?: unknown }).play !== "function"
    || typeof media.adapter !== "object" || media.adapter === null) {
    throw new TypeError("Video.js 10 analytics requires a registered hls-video, hlsjs-video, or native-hls-video element from @videojs/html.");
  }

  const session = attachAnalyticsWithManagedSource(media as unknown as HTMLMediaElement, options);
  let currentSource = media.src;
  let currentEngine: Hls | null = null;
  let connector: (AnalyticsConnector & { destroy(): void }) | null = null;
  let destroyed = false;

  const syncConnector = () => {
    const engine = media.localName === "hlsjs-video" ? (media.engine as Hls | null | undefined) ?? null : null;
    if (connector && engine === currentEngine) return;
    connector?.destroy();
    currentEngine = engine;
    connector = videoJsConnector(engine);
    session.setConnector(connector);
  };
  const onSourceChange = () => {
    if (media.src === currentSource) return;
    currentSource = media.src;
    session.sourceChanged();
    connector?.destroy();
    connector = null;
    currentEngine = null;
    session.setConnector(null);
  };
  const onLoadStart = () => syncConnector();

  media.addEventListener("sourcechange", onSourceChange);
  media.addEventListener("loadstart", onLoadStart);
  syncConnector();

  return {
    startAttempt() { if (!destroyed) session.startAttempt(); },
    sourceChanged() { if (!destroyed) session.sourceChanged(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      media.removeEventListener("sourcechange", onSourceChange);
      media.removeEventListener("loadstart", onLoadStart);
      session.destroy();
      connector?.destroy();
      connector = null;
    },
  };
}
