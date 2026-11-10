import { attachAnalytics, type AnalyticsOptions, type AnalyticsSession } from "./core.js";
import { fixedAnalyticsOptions } from "./options.js";
import { createHlsJsConnector, type HlsJsAnalyticsConnector } from "./hlsjs.js";
import type Hls from "hls.js";

/** The public surface needed from a player that can replace its media element. */
export interface MediaPlayerHost extends HTMLElement {
  readonly media: HTMLMediaElement;
}

/** Attach the standalone media collector to a Chunkify Player. */
export function attachPlayerAnalytics(
  player: MediaPlayerHost,
  initialOptions: AnalyticsOptions,
): Pick<AnalyticsSession, "startAttempt" | "sourceChanged" | "destroy"> {
  // Sessions for later media elements reuse the options as they were at startup.
  const options = fixedAnalyticsOptions(initialOptions);
  let media = player.media;
  let session = attachAnalytics(media, options);
  let destroyed = false;
  let activeHls: Hls | null = null;
  let connector: HlsJsAnalyticsConnector | null = null;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;

  const clearCheckTimer = () => {
    if (checkTimer === null) return;
    clearTimeout(checkTimer);
    checkTimer = null;
  };
  const detachConnector = () => {
    session.setConnector(null);
    connector?.destroy();
    connector = null;
    activeHls = null;
  };
  const syncConnector = () => {
    if (destroyed) return;
    const hls = media.localName === "hls-video"
      ? (media as HTMLMediaElement & { api?: Hls | null }).api ?? null : null;
    if (hls === activeHls) return;
    detachConnector();
    if (!hls) return;
    try {
      const next = createHlsJsConnector(hls);
      session.setConnector(next);
      connector = next;
      activeHls = hls;
    } catch {
      // Analytics must not interrupt playback if an engine is unavailable.
    }
  };
  const scheduleConnectorCheck = () => {
    clearCheckTimer();
    checkTimer = globalThis.setTimeout(() => {
      checkTimer = null;
      syncConnector();
    }, 0);
  };
  const observer = new MutationObserver(scheduleConnectorCheck);
  const bindMedia = () => {
    media.addEventListener("loadstart", syncConnector);
    observer.observe(media, { attributes: true, attributeFilter: ["src"] });
    syncConnector();
    // hls-video-element creates its hls.js instance after setting src.
    scheduleConnectorCheck();
  };
  const unbindMedia = () => {
    clearCheckTimer();
    observer.disconnect();
    media.removeEventListener("loadstart", syncConnector);
  };
  bindMedia();

  const onMediaChange = () => {
    const next = player.media;
    if (destroyed || next === media) return;
    session.sourceChanged();
    unbindMedia();
    session.destroy();
    detachConnector();
    media = next;
    session = attachAnalytics(media, options);
    bindMedia();
  };
  player.addEventListener("mediachange", onMediaChange);

  return {
    startAttempt() { if (!destroyed) session.startAttempt(); },
    sourceChanged() { if (!destroyed) session.sourceChanged(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      player.removeEventListener("mediachange", onMediaChange);
      unbindMedia();
      session.destroy();
      detachConnector();
    },
  };
}
