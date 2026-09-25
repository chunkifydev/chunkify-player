import assert from "node:assert/strict";
import test from "node:test";
import { createDatadogAdapter } from "@chunkify/analytics/datadog";
import { createHttpAdapter } from "@chunkify/analytics/http";
import { createPostHogAdapter } from "@chunkify/analytics/posthog";

test("Datadog adapter sends one action per event with optional context mapping", () => {
  const actions = [];
  const adapter = createDatadogAdapter({ addAction(name, context) { actions.push({ name, context }); } });
  const event = {
    event_name: "chunkify.video.view_snapshot", video_id: "asset-1", view_id: "view-1",
    rendition_playing_time: [
      { width: 640, height: 360, playing_time_ms: 12000 },
      { width: null, height: 720, playing_time_ms: 4000 },
    ],
  };
  adapter.send(event);
  adapter.send({ ...event, event_name: "chunkify.video.view_ended" });
  assert.deepEqual(actions, [
    { name: "chunkify.video.view_snapshot", context: { chunkify: event } },
    { name: "chunkify.video.view_ended", context: { chunkify: { ...event, event_name: "chunkify.video.view_ended" } } },
  ]);

  const mapped = createDatadogAdapter({ addAction(name, context) { actions.push({ name, context }); } },
    (record) => ({ video_id: record.video_id, rendition_count: record.rendition_playing_time?.length ?? 0 }));
  mapped.send(event);
  assert.deepEqual(actions.at(-1), {
    name: "chunkify.video.view_snapshot", context: { video_id: "asset-1", rendition_count: 2 },
  });
  assert.throws(() => createDatadogAdapter({ addAction() {} }, null), TypeError);
});

test("PostHog adapter captures one event with flat or mapped properties", () => {
  const captured = [];
  const client = { capture(name, properties) { captured.push({ name, properties }); } };
  const event = { event_name: "chunkify.video.view_ended", video_id: "asset-1", playing_time_ms: 12000 };
  createPostHogAdapter(client).send(event);
  createPostHogAdapter(client, (record) => ({ video_id: record.video_id, playtime_seconds: record.playing_time_ms / 1000 })).send(event);
  assert.deepEqual(captured, [
    { name: event.event_name, properties: event },
    { name: event.event_name, properties: { video_id: "asset-1", playtime_seconds: 12 } },
  ]);
  assert.throws(() => createPostHogAdapter(null), TypeError);
  assert.throws(() => createPostHogAdapter(client, null), TypeError);
});

test("HTTP adapter posts JSON without browser credentials and checks delivery status", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return { ok: requests.length === 1, status: requests.length === 1 ? 202 : 503 };
    };
    const adapter = createHttpAdapter("/api/video-analytics");
    const event = { event_name: "chunkify.video.view_ended", video_id: "asset-1" };
    await adapter.send(event);
    assert.equal(requests[0].url, "/api/video-analytics");
    assert.deepEqual(requests[0].init, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      keepalive: true,
    });
    const mappedAdapter = createHttpAdapter("/api/video-analytics", (record) => ({ videoId: record.video_id }));
    await assert.rejects(mappedAdapter.send(event), /HTTP 503/);
    assert.equal(requests[1].init.body, JSON.stringify({ videoId: "asset-1" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP adapter rejects secret-bearing and nonlocal insecure endpoints", () => {
  for (const endpoint of ["https://example.com/collect?token=secret", "https://user:pass@example.com/collect",
    "http://example.com/collect", "//example.com/collect", "/\\example.com/collect", "collect", "/collect#secret"]) {
    assert.throws(() => createHttpAdapter(endpoint), TypeError);
  }
  assert.doesNotThrow(() => createHttpAdapter("http://127.0.0.1:8888/collect"));
  assert.throws(() => createHttpAdapter("/collect", null), TypeError);
});
