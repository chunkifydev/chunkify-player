import assert from "node:assert/strict";
import test from "node:test";
import { monitorHlsJs, createHlsJsConnector } from "@chunkify/analytics/hlsjs";

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
    { width: 256, height: 144, videoCodec: "avc1.42E01E", codecSet: "", bitrate: 250_000, frameRate: 24 },
    { width: 640, height: 360, videoCodec: "avc1.4D401E", codecSet: "", bitrate: 750_000, frameRate: 30 },
  ];
  listeners = new Map();

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  off(event, listener) { this.listeners.get(event)?.delete(listener); }
  emit(event, data) {
    for (const listener of this.listeners.get(event) ?? []) listener(event, data);
  }
}

test("hls.js connector records selected renditions, delivery and fatal errors, then detaches", () => {
  const hls = new FakeHls();
  const connector = createHlsJsConnector(hls);
  const errors = [];
  const renditions = [];
  const unsubscribe = connector.subscribeToErrors((error) => errors.push(error));
  const unsubscribeRenditions = connector.subscribeToRenditions((rendition) => renditions.push(rendition));
  const manifestStats = { loaded: 1000, loading: { start: 10, end: 30 } };
  const fragmentStats = { loaded: 500, loading: { start: 50, end: 60 } };

  hls.emit(FakeHls.Events.MANIFEST_LOADED, { stats: manifestStats });
  hls.emit(FakeHls.Events.LEVEL_LOADED, { stats: manifestStats });
  hls.emit(FakeHls.Events.FRAG_LOADED, { frag: { stats: fragmentStats } });
  hls.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 0 });
  hls.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 1 });
  hls.emit(FakeHls.Events.ERROR, { fatal: false, type: "networkError", details: "retry" });
  hls.emit(FakeHls.Events.ERROR, { fatal: true, type: "networkError", details: "manifestLoadError" });

  assert.deepEqual(connector.snapshot(), {
    renditionWidth: 640, renditionHeight: 360, renditionCodec: "avc1.4D401E",
    renditionBitrate: 750_000, renditionSwitchCount: 1,
    deliveryRequestCount: 2, deliveryTransferredBytes: 1500, deliveryDurationMs: 30,
  });
  assert.deepEqual(errors, [{ category: "network", code: "manifestLoadError", fatal: true }]);
  assert.deepEqual(renditions, [
    null,
    { width: 256, height: 144, codec: "avc1.42E01E", bitrate_bps: 250_000, frame_rate: 24 },
    { width: 640, height: 360, codec: "avc1.4D401E", bitrate_bps: 750_000, frame_rate: 30 },
  ]);
  assert.equal(connector.version, "1.7.3");

  unsubscribe();
  unsubscribeRenditions();
  connector.destroy();
  connector.destroy();
  hls.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 0 });
  assert.equal(connector.snapshot().renditionSwitchCount, 1);
  assert.equal([...hls.listeners.values()].every((listeners) => listeners.size === 0), true);
});

test("hls.js analytics validates options before an engine attaches media", () => {
  const hls = new FakeHls();
  assert.throws(() => monitorHlsJs(hls, {
    videoId: "", send() {},
  }), /non-empty videoId/);
  assert.equal(hls.listeners.size, 0);
});
