import assert from "node:assert/strict";
import test from "node:test";
import { createVideoJsConnector } from "@chunkify/analytics/videojs";

function emitter() {
  const listeners = new Map();
  return {
    on(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    off(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(type) ?? []) listener(); },
    listenerCount() { return [...listeners.values()].reduce((count, set) => count + set.size, 0); },
  };
}

test("Video.js connector reads optional quality levels and player errors without guessing delivery data", () => {
  const playerEvents = emitter();
  const levelEvents = emitter();
  const levels = Object.assign(levelEvents, {
    selectedIndex: -1,
    0: { width: 640, height: 360, bitrate: 700_000 },
    1: { width: 1280, height: 720, bitrate: 2_000_000 },
  });
  let playerError = null;
  const player = { ...playerEvents, error: () => playerError, qualityLevels: () => levels };
  const connector = createVideoJsConnector(player);
  const errors = [];
  const unsubscribe = connector.subscribeToErrors((error) => errors.push(error));
  levels.selectedIndex = 0;
  levels.emit("change");
  levels.selectedIndex = 1;
  levels.emit("change");
  playerError = { code: 2, message: "private URL must never appear in analytics" };
  player.emit("error");

  assert.deepEqual(connector.snapshot(), {
    renditionWidth: 1280, renditionHeight: 720, renditionCodec: null, renditionBitrate: 2_000_000,
    renditionSwitchCount: 1,
    deliveryRequestCount: null, deliveryTransferredBytes: null, deliveryDurationMs: null,
  });
  levels.selectedIndex = -1;
  levels.emit("removequalitylevel");
  assert.equal(connector.snapshot().renditionWidth, null);
  assert.equal(connector.snapshot().renditionSwitchCount, 1);
  levels.selectedIndex = 0;
  levels.emit("change");
  player.emit("loadstart");
  assert.equal(connector.snapshot().renditionWidth, null);
  assert.equal(connector.snapshot().renditionSwitchCount, 0);
  assert.deepEqual(errors, [{ category: "network", code: 2, fatal: true }]);
  assert.equal(connector.subscribeToRenditions, undefined);
  unsubscribe();
  connector.destroy();
  connector.destroy();
  assert.equal(player.listenerCount(), 0);
  assert.equal(levels.listenerCount(), 0);
});

test("Video.js connector leaves quality measurements unavailable without a quality-levels API", () => {
  const player = { ...emitter(), error: () => null };
  const connector = createVideoJsConnector(player);
  assert.deepEqual(connector.snapshot(), {
    renditionWidth: null, renditionHeight: null, renditionCodec: null, renditionBitrate: null,
    renditionSwitchCount: null,
    deliveryRequestCount: null, deliveryTransferredBytes: null, deliveryDurationMs: null,
  });
  connector.destroy();
});
