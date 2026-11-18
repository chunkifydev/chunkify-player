import { defaultAnalyticsEndpoint, registerPlayerTheme } from "@chunkify/player";

const player = document.createElement("chunkify-player");

player.src = "/master.m3u8";
player.src = null;
player.src = undefined;
const retried: boolean = player.retry();
void retried;
player.type = "application/vnd.apple.mpegurl";
player.type = null;
player.poster = "/poster.jpg";
player.poster = null;
player.thumbnails = "/thumbnails.vtt";
player.thumbnails = null;
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
player.theme = "default";
player.primaryColor = "#700cd4";
player.primaryColor = null;
player.secondaryColor = "#bb1111";
player.accentColor = "#cf2626";

player.analytics = true;
player.analyticsIngestKey = "public-key";
player.analyticsIngestKey = null;
player.analyticsVideoId = "video_123";
player.analyticsEndpoint = "https://analytics.example.com/v1/events";
player.analyticsEndpoint = undefined;
player.analyticsVideoTitle = "Keynote";
player.analyticsUserId = "user_42";
player.analyticsEnvironment = "production";
player.analyticsPersistViewerId = false;
player.analyticsCustom = { plan: "premium", seats: 5, trial: true };
player.analyticsCustom = null;
const custom: Record<string, string> = player.analyticsCustom;
void custom;
const endpoint: string = defaultAnalyticsEndpoint;
void endpoint;

const media: HTMLVideoElement = player.media;
void media;

registerPlayerTheme("customer", document.createElement("template"));

player.addEventListener("play", (event) => console.log(event.currentTarget));
player.addEventListener("playback-error", (event) => console.log(event.detail.code));
player.addEventListener("click", (event) => console.log(event.clientX));
