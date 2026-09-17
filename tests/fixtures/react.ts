import { createElement, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ChunkifyPlayer, type ChunkifyPlayerProps, type ChunkifyPlayerRef } from "@chunkify/player-react";

const root = createRoot(document.getElementById("root")!);
const ref = createRef<ChunkifyPlayerRef>();
const fixture = {
  ref,
  createElement,
  render(props: ChunkifyPlayerProps | null) {
    flushSync(() => root.render(createElement(StrictMode, null,
      props ? createElement(ChunkifyPlayer, { ...props, ref: props.ref ?? ref }) : null)));
  },
};

declare global {
  interface Window { reactFixture: typeof fixture; }
}
window.reactFixture = fixture;
