import assert from "node:assert/strict";
import test from "node:test";
import { monitorVideoJs } from "@chunkify/player-analytics/videojs";

class FakeMedia extends EventTarget {
  constructor(localName = "hlsjs-video") {
    super();
    this.localName = localName;
    this.src = "https://cdn.example.com/first.m3u8";
    this.currentSrc = this.src;
    this.currentTime = 0;
    this.duration = 60;
    this.readyState = 0;
    this.networkState = 0;
    this.error = null;
    this.engine = null;
    this.adapter = {};
    this.ownerDocument = { defaultView: null };
  }

  play() { return Promise.resolve(); }
  changeSource(src, engine) {
    this.src = src;
    this.currentSrc = src;
    this.dispatchEvent(new Event("sourcechange"));
    this.engine = engine;
    this.dispatchEvent(new Event("loadstart"));
  }
}

class FakeHls {
  static version = "1.7.3";
  static Events = {
    MANIFEST_LOADED: "manifest", LEVEL_LOADED: "level", AUDIO_TRACK_LOADED: "audio",
    SUBTITLE_TRACK_LOADED: "subtitle", FRAG_LOADED: "fragment",
    LEVEL_SWITCHED: "switched", ERROR: "error",
  };
  static ErrorTypes = {
    NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError",
    MUX_ERROR: "muxError", KEY_SYSTEM_ERROR: "keySystemError",
  };

  currentLevel = -1;
  levels = [
    { width: 640, height: 360, videoCodec: "avc1.4d401e", bitrate: 800_000, frameRate: 30 },
    { width: 1280, height: 720, videoCodec: "avc1.64001f", bitrate: 2_500_000, frameRate: 30 },
  ];
  listeners = new Map();

  on(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  off(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, data) { for (const listener of this.listeners.get(type) ?? []) listener(type, data); }
  listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}

test("Video.js 10 hlsjs-video adds engine metrics and resets on a new source", () => {
  const media = new FakeMedia();
  const events = [];
  const firstEngine = new FakeHls();
  media.engine = firstEngine;
  const session = monitorVideoJs(media, {
    videoId: "video-123", destinations: [{ send(event) { events.push(event); } }],
  });

  media.dispatchEvent(new Event("play"));
  media.dispatchEvent(new Event("playing"));
  firstEngine.emit(FakeHls.Events.FRAG_LOADED, {
    frag: { stats: { loaded: 4096, loading: { start: 10, end: 20 } } },
  });
  firstEngine.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 0 });
  firstEngine.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 1 });
  media.changeSource("https://cdn.example.com/second.m3u8", new FakeHls());

  const firstViewEnd = events.find((event) => event.event_name === "chunkify.video.view_ended");
  assert.equal(firstViewEnd.reason, "source_changed");
  assert.equal(firstViewEnd.connector_name, "video.js/hls.js");
  assert.equal(firstViewEnd.player_name, "video.js");
  assert.equal(firstViewEnd.selected_rendition_height, 720);
  assert.equal(firstViewEnd.rendition_switch_count, 1);
  assert.equal(firstViewEnd.delivery_request_count, 1);
  assert.equal(firstViewEnd.delivery_transferred_bytes, 4096);
  assert.equal(firstEngine.listenerCount(), 0);

  media.dispatchEvent(new Event("play"));
  media.dispatchEvent(new Event("playing"));
  media.dispatchEvent(new Event("ended"));
  const viewStarts = events.filter((event) => event.event_name === "chunkify.video.view_started");
  const viewEnds = events.filter((event) => event.event_name === "chunkify.video.view_ended");
  assert.notEqual(viewStarts[0].view_id, viewStarts[1].view_id);
  assert.equal(viewEnds[1].delivery_request_count, 0);
  assert.equal(viewEnds[1].rendition_switch_count, 0);
  session.destroy();
  assert.equal(media.engine.listenerCount(), 0);
});

test("Video.js 10 native and lightweight HLS media retain core metrics without engine guesses", () => {
  for (const localName of ["hls-video", "native-hls-video"]) {
    const media = new FakeMedia(localName);
    media.engine = { state: {}, context: {} };
    const events = [];
    const session = monitorVideoJs(media, {
      videoId: "video-456", destinations: [{ send(event) { events.push(event); } }],
    });
    media.dispatchEvent(new Event("play"));
    media.dispatchEvent(new Event("playing"));
    media.dispatchEvent(new Event("ended"));
    session.destroy();
    const viewEnd = events.find((event) => event.event_name === "chunkify.video.view_ended");
    assert.equal(viewEnd.player_name, "video.js");
    assert.equal(viewEnd.selected_rendition_height, null);
    assert.equal(viewEnd.delivery_request_count, null);
  }
});

test("Video.js 8 player objects and the Video.js 10 container are not media targets", () => {
  const options = { videoId: "video-789", destinations: [{ send() {} }] };
  assert.throws(() => monitorVideoJs({ tech() {} }, options), /Video.js 10 analytics requires/);
  assert.throws(() => monitorVideoJs(new FakeMedia("video-player"), options), /Video.js 10 analytics requires/);
  const muxHlsVideo = new FakeMedia("hls-video");
  delete muxHlsVideo.adapter;
  muxHlsVideo.api = new FakeHls();
  assert.throws(() => monitorVideoJs(muxHlsVideo, options), /Video.js 10 analytics requires/);
});
