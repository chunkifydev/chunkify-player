import type { PlaybackErrorDetail } from "../../packages/player/src/index.js";

const player = document.createElement("chunkify-player");
player.poster = "/poster.jpg";
player.poster = null;
player.poster = undefined;
const poster: string = player.poster;
console.log(poster);
player.thumbnails = "/thumbnails/images.vtt";
player.thumbnails = null;
player.thumbnails = undefined;
const thumbnails: string = player.thumbnails;
console.log(thumbnails);
player.credentials = "include";
player.credentials = null;
player.credentials = undefined;
const credentials: "include" | null = player.credentials;
console.log(credentials);
// @ts-expect-error The component accepts only include or an omitted credential setting.
player.credentials = "omit";

player.addEventListener("playback-error", (event) => {
  const detail: PlaybackErrorDetail = event.detail;
  console.log(detail.code, detail.engine);
  // @ts-expect-error The public error contract must not expose source URLs.
  event.detail.url;
});

const onPlaybackError = (event: CustomEvent<PlaybackErrorDetail>) => {
  console.log(event.detail.message);
};
player.addEventListener("playback-error", onPlaybackError);
player.removeEventListener("playback-error", onPlaybackError);

// Native event overloads must remain available.
player.addEventListener("click", (event) => console.log(event.clientX));
