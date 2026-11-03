import assert from "node:assert/strict";
import test from "node:test";
import { createShakaConnector } from "@chunkify/player-analytics/shaka";

function player() {
  const listeners = new Map();
  return {
    getMediaElement: () => null,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, values) { for (const listener of listeners.get(type) ?? []) listener(values); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

test("Shaka connector tracks video quality at the playhead and only critical errors", () => {
  const shaka = player();
  const connector = createShakaConnector(shaka);
  const renditions = [];
  const errors = [];
  connector.subscribeToRenditions((rendition) => renditions.push(rendition));
  connector.subscribeToErrors((error) => errors.push(error));
  shaka.emit("mediaqualitychanged", { mediaQuality: { contentType: "audio", bandwidth: 128000 } });
  shaka.emit("mediaqualitychanged", { mediaQuality: {
    contentType: "video", width: 640, height: 360, codecs: "avc1.42e01e", bandwidth: 800000, frameRate: 30,
  } });
  shaka.emit("downloadcompleted", { response: { data: new Uint8Array(1200), timeMs: 12 } });
  shaka.emit("downloadcompleted", { response: { data: new Uint8Array(300), timeMs: 1, fromCache: true } });
  shaka.emit("mediaqualitychanged", { mediaQuality: {
    contentType: "video", width: 1280, height: 720, codecs: "avc1.4d401f", bandwidth: 2400000, frameRate: 30,
  } });
  shaka.emit("error", { detail: { severity: 1, category: 1, code: 1001 } });
  shaka.emit("error", { detail: { severity: 2, category: 1, code: 1002, message: "secret URL" } });
  shaka.emit("error", { detail: { severity: 2, category: 6, code: 6001 } });

  assert.deepEqual(renditions, [null,
    { width: 640, height: 360, codec: "avc1.42e01e", bitrate_bps: 800000, frame_rate: 30 },
    { width: 1280, height: 720, codec: "avc1.4d401f", bitrate_bps: 2400000, frame_rate: 30 },
  ]);
  assert.deepEqual(errors, [
    { category: "network", code: 1002, fatal: true },
    { category: "unknown", code: 6001, fatal: true },
  ]);
  assert.deepEqual(connector.snapshot(), {
    renditionWidth: 1280, renditionHeight: 720, renditionCodec: "avc1.4d401f",
    renditionBitrate: 2400000, renditionSwitchCount: 1,
    deliveryRequestCount: 1, deliveryTransferredBytes: 1200, deliveryDurationMs: 12,
  });
  connector.reset();
  assert.equal(connector.snapshot().renditionSwitchCount, 0);
  assert.equal(connector.snapshot().deliveryTransferredBytes, 0);
  assert.equal(connector.snapshot().deliveryRequestCount, 0);
  connector.destroy();
  connector.destroy();
  assert.equal(shaka.listenerCount(), 0);
});

test("Shaka connector leaves transfer metrics unavailable if a download omits size or duration", () => {
  const shaka = player();
  const connector = createShakaConnector(shaka);
  shaka.emit("downloadcompleted", { response: {} });
  assert.deepEqual({
    requests: connector.snapshot().deliveryRequestCount,
    bytes: connector.snapshot().deliveryTransferredBytes,
    duration: connector.snapshot().deliveryDurationMs,
  }, { requests: 1, bytes: null, duration: null });
  connector.destroy();
});
