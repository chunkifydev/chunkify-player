import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ChunkifyPlayer } from "@chunkify/player-react";

test("React package imports and renders on the server without a browser DOM", () => {
  assert.equal(typeof HTMLElement, "undefined");
  assert.equal(renderToString(createElement(ChunkifyPlayer, {
    status: "ready", src: "https://media.example.com/master.m3u8",
  })), "");
});
