import assert from "node:assert/strict";
import test from "node:test";
import { createEventMapper } from "@chunkify/analytics";
import { createDatadogAdapter } from "@chunkify/analytics/datadog";
import { createHttpAdapter } from "@chunkify/analytics/http";
import { createOtlpAdapter } from "@chunkify/analytics/otlp";
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
    { name: "chunkify.video.view_snapshot", context: event },
    { name: "chunkify.video.view_ended", context: { ...event, event_name: "chunkify.video.view_ended" } },
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
    const { signal, ...init } = requests[0].init;
    assert.ok(signal instanceof AbortSignal);
    assert.deepEqual(init, {
      method: "POST",
      headers: new Headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(event),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      keepalive: true,
    });
    const headers = { "X-Chunkify-Ingest-Key": "public-key", "content-type": "text/plain" };
    const mappedAdapter = createHttpAdapter("/api/video-analytics", { mapEvent: (record) => ({ videoId: record.video_id }), headers });
    headers["X-Chunkify-Ingest-Key"] = "changed-after-creation";
    await assert.rejects(mappedAdapter.send(event), /HTTP 503/);
    assert.equal(requests[1].init.body, JSON.stringify({ videoId: "asset-1" }));
    assert.equal(requests[1].init.headers.get("x-chunkify-ingest-key"), "public-key");
    assert.equal(requests[1].init.headers.get("content-type"), "application/json");
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
  assert.throws(() => createHttpAdapter("/collect", { mapEvent: null }), TypeError);
  assert.throws(() => createHttpAdapter("/collect", { headers: { Cookie: "session=secret" } }), TypeError);
});

test("OTLP adapter sends typed log attributes without unavailable values", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    };
    const event = {
      event_name: "chunkify.video.view_ended",
      event_id: "event-1",
      occurred_at: "2026-09-25T12:34:56.789Z",
      sdk_version: "0.0.0",
      video_id: "video-1",
      view_id: "view-1",
      sequence: 3,
      playing_time_ms: 12500,
      rebuffer_ratio: 0.125,
      error_fatal: false,
      selected_rendition_width: null,
      rendition_playing_time: [
        { width: 640, height: 360, playing_time_ms: 10000 },
        { width: null, height: 720, playing_time_ms: 2500 },
      ],
    };
    await createOtlpAdapter("https://collector.example.com/v1/logs").send(event);
    assert.equal(requests[0].url, "https://collector.example.com/v1/logs");
    assert.equal(requests[0].init.headers.get("Content-Type"), "application/json");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.referrerPolicy, "no-referrer");
    assert.equal(requests[0].init.keepalive, true);

    const request = JSON.parse(requests[0].init.body);
    const scopeLogs = request.resourceLogs[0].scopeLogs[0];
    assert.deepEqual(scopeLogs.scope, { name: "@chunkify/analytics", version: "0.0.0" });
    const log = scopeLogs.logRecords[0];
    assert.equal(log.timeUnixNano, String(BigInt(Date.parse(event.occurred_at)) * 1_000_000n));
    assert.equal(log.eventName, event.event_name);
    const attributes = Object.fromEntries(log.attributes.map(({ key, value }) => [key, value]));
    assert.deepEqual(attributes.video_id, { stringValue: "video-1" });
    assert.deepEqual(attributes.sequence, { intValue: "3" });
    assert.deepEqual(attributes.rebuffer_ratio, { doubleValue: 0.125 });
    assert.deepEqual(attributes.error_fatal, { boolValue: false });
    assert.equal("selected_rendition_width" in attributes, false);
    assert.deepEqual(attributes.rendition_playing_time, { arrayValue: { values: [
      { kvlistValue: { values: [
        { key: "width", value: { intValue: "640" } },
        { key: "height", value: { intValue: "360" } },
        { key: "playing_time_ms", value: { intValue: "10000" } },
      ] } },
      { kvlistValue: { values: [
        { key: "height", value: { intValue: "720" } },
        { key: "playing_time_ms", value: { intValue: "2500" } },
      ] } },
    ] } });
    const mapAttributes = createEventMapper({
      video_id: "video_id",
      view_id: "view_id",
      event_id: "event_id",
      playtime_seconds: (record) => record.playing_time_ms / 1000,
      unavailable: () => null,
    });
    await createOtlpAdapter("https://collector.example.com/v1/logs", { mapAttributes,
      headers: { "X-Chunkify-Ingest-Key": "public-key" } }).send(event);
    assert.equal(requests[1].init.headers.get("x-chunkify-ingest-key"), "public-key");
    const mappedLog = JSON.parse(requests[1].init.body).resourceLogs[0].scopeLogs[0].logRecords[0];
    assert.equal(mappedLog.timeUnixNano, log.timeUnixNano);
    assert.equal(mappedLog.eventName, log.eventName);
    assert.deepEqual(mappedLog.attributes, [
      { key: "video_id", value: { stringValue: "video-1" } },
      { key: "view_id", value: { stringValue: "view-1" } },
      { key: "event_id", value: { stringValue: "event-1" } },
      { key: "playtime_seconds", value: { doubleValue: 12.5 } },
    ]);
    assert.equal(event.playing_time_ms, 12500);
    assert.throws(() => createOtlpAdapter("https://collector.example.com/v1/logs?api_key=secret"), TypeError);
    assert.throws(() => createOtlpAdapter("/v1/logs", null), TypeError);
    assert.throws(() => createOtlpAdapter("/v1/logs", { mapAttributes: null }), TypeError);
    await assert.rejects(createOtlpAdapter("/v1/logs", { mapAttributes: () => null }).send(event), TypeError);
    await assert.rejects(createOtlpAdapter("/v1/logs").send({ ...event, occurred_at: "invalid" }), TypeError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
