import { registerPlayerTheme } from "@chunkify/player";

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
player.autoSeekToLive = true;
player.theme = "demuxed";
player.primaryColor = "#700cd4";
player.primaryColor = null;
player.secondaryColor = "#bb1111";
player.accentColor = "#cf2626";

const media: HTMLVideoElement = player.media;
void media;

registerPlayerTheme("customer", document.createElement("template"));

player.addEventListener("play", (event) => console.log(event.currentTarget));
player.addEventListener("playback-error", (event) => console.log(event.detail.code));
player.addEventListener("click", (event) => console.log(event.clientX));
