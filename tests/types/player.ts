import "@chunkify/player";

const player = document.createElement("chunkify-player");

player.src = "/master.m3u8";
player.src = null;
player.src = undefined;
player.poster = "/poster.jpg";
player.poster = null;
player.preload = "metadata";
player.crossOrigin = "anonymous";
player.crossOrigin = null;
player.autoplay = true;
player.controls = true;
player.loop = true;
player.muted = true;
player.playsInline = true;

const media: HTMLVideoElement = player.media;
void media;

player.addEventListener("play", (event) => console.log(event.currentTarget));
player.addEventListener("click", (event) => console.log(event.clientX));

// @ts-expect-error Engine selection is internal.
player.player = "hlsjs";
// @ts-expect-error Asset metadata belongs to the application.
player.assetId = "asset-123";
// @ts-expect-error Thumbnail loading is outside the thin wrapper.
player.thumbnails = "/images.vtt";
