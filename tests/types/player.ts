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
player.credentials = "include";
player.credentials = null;
player.autoplay = true;
player.controls = true;
player.loop = true;
player.muted = true;
player.playsInline = true;

const media: HTMLVideoElement = player.media;
void media;

player.addEventListener("play", (event) => console.log(event.currentTarget));
player.addEventListener("playback-error", (event) => console.log(event.detail.code));
player.addEventListener("click", (event) => console.log(event.clientX));
