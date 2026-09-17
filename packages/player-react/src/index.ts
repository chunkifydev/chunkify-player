"use client";

import { createElement, useEffect, useState, type DOMAttributes, type HTMLAttributes, type Ref } from "react";
import type { ChunkifyPlayer as PlayerElement, PlayerEngine, PlayerStatus } from "@chunkify/player";

export type ChunkifyPlayerRef = PlayerElement;
type HostProps = Omit<HTMLAttributes<PlayerElement>, keyof DOMAttributes<PlayerElement>>;
type SourceProps =
  | { status: "ready"; src: string }
  | { status?: Exclude<PlayerStatus, "ready"> | null | undefined; src?: string | null | undefined };

export type ChunkifyPlayerProps = HostProps & SourceProps & {
  ref?: Ref<ChunkifyPlayerRef> | undefined;
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

export function ChunkifyPlayer(props: ChunkifyPlayerProps) {
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
  if (failure) throw failure.error;
  return registered ? createElement("chunkify-player", {
    ...props,
    player: props.player ?? "auto",
    autoPlay: props.autoPlay ?? false,
    muted: props.muted ?? false,
    loop: props.loop ?? false,
    playsInline: props.playsInline ?? false,
    controls: props.controls ?? false,
  }) : null;
}
