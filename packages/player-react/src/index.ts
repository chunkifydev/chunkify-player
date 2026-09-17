"use client";

import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type DOMAttributes, type HTMLAttributes, type ReactElement, type Ref } from "react";
import type { ChunkifyPlayer as PlayerElement, PlaybackErrorDetail, PlayerEngine } from "@chunkify/player";

const mediaEvents = {
  onAbort: "abort", onCanPlay: "canplay", onCanPlayThrough: "canplaythrough",
  onDurationChange: "durationchange", onEmptied: "emptied", onEnded: "ended",
  onError: "error", onLoadedData: "loadeddata", onLoadedMetadata: "loadedmetadata",
  onLoadStart: "loadstart", onPause: "pause", onPlay: "play", onPlaying: "playing",
  onProgress: "progress", onRateChange: "ratechange", onResize: "resize",
  onSeeked: "seeked", onSeeking: "seeking", onStalled: "stalled", onSuspend: "suspend",
  onTimeUpdate: "timeupdate", onVolumeChange: "volumechange", onWaiting: "waiting",
  onPlaybackError: "playback-error",
} as const;
const callbackNames = Object.keys(mediaEvents) as Array<keyof typeof mediaEvents>;

export type ChunkifyPlayerRef = PlayerElement;
export type PlayerMediaEvent = Event & { readonly currentTarget: PlayerElement };
export type PlayerPlaybackErrorEvent = CustomEvent<PlaybackErrorDetail> & { readonly currentTarget: PlayerElement };
type MediaCallbacks = {
  [K in keyof typeof mediaEvents]?: ((event: K extends "onPlaybackError"
    ? PlayerPlaybackErrorEvent : PlayerMediaEvent) => void) | undefined;
};
type HostProps = Omit<HTMLAttributes<PlayerElement>, keyof DOMAttributes<PlayerElement>>;
export type ChunkifyPlayerProps = HostProps & MediaCallbacks & {
  ref?: Ref<ChunkifyPlayerRef> | undefined;
  src?: string | null | undefined;
  assetId?: string | null | undefined;
  poster?: string | null | undefined;
  thumbnails?: string | null | undefined;
  player?: PlayerEngine | undefined;
  credentials?: "include" | null | undefined;
  autoPlay?: boolean | undefined;
  loop?: boolean | undefined;
  muted?: boolean | undefined;
  controls?: boolean | undefined;
  playsInline?: boolean | undefined;
};

export function ChunkifyPlayer(props: ChunkifyPlayerProps): ReactElement | null {
  const { ref, ...hostProps } = props;
  const elementRef = useRef<PlayerElement | null>(null);
  const attachRef = useCallback((element: PlayerElement | null) => {
    elementRef.current = element;
    const cleanup = typeof ref === "function" ? ref(element) : undefined;
    if (ref && typeof ref !== "function") ref.current = element;
    return () => {
      elementRef.current = null;
      if (typeof cleanup === "function") cleanup();
      else if (typeof ref === "function") ref(null);
      else if (ref) ref.current = null;
    };
  }, [ref]);
  const [registered, setRegistered] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  useEffect(() => {
    let active = true;
    // The Web Component requires a DOM. Keep server imports and rendering safe.
    void import("@chunkify/player").then(
      () => { if (active) setRegistered(true); },
      (error: unknown) => { if (active) setFailure({ error }); },
    );
    return () => { active = false; };
  }, []);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const removeListeners: Array<() => void> = [];
    for (const name of callbackNames) {
      if (!props[name]) continue;
      const listener = (event: Event) => {
        // These listeners run on the host, so currentTarget is the player.
        if (name === "onPlaybackError") props[name]?.(event as PlayerPlaybackErrorEvent);
        else props[name]?.(event as PlayerMediaEvent);
      };
      element.addEventListener(mediaEvents[name], listener);
      removeListeners.push(() => element.removeEventListener(mediaEvents[name], listener));
    }
    return () => { for (const remove of removeListeners) remove(); };
  }, [registered, props]);
  if (failure) throw failure.error;
  const elementProps: Record<string, unknown> = {
    ...hostProps,
    ref: attachRef,
    player: props.player ?? "auto",
    autoPlay: props.autoPlay ?? false,
    muted: props.muted ?? false,
    loop: props.loop ?? false,
    playsInline: props.playsInline ?? false,
    controls: props.controls ?? false,
  };
  for (const name of callbackNames) delete elementProps[name];
  return registered ? createElement("chunkify-player", elementProps) : null;
}
