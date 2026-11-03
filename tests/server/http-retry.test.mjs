import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createHttpAdapter } from "@chunkify/player-analytics/http";
import { createOtlpAdapter } from "@chunkify/player-analytics/otlp";
import { createChunkifyAdapter } from "@chunkify/player-analytics/chunkify";

const event = Object.freeze({
  event_name: "chunkify.video.view_ended", event_id: "event-1", view_id: "view-1",
  occurred_at: "2026-10-21T12:00:00.000Z", sdk_version: "test", sequence: 3,
});

function clock(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse(event.occurred_at) });
  t.mock.method(Math, "random", () => 0);
}

async function advance(t, ms) {
  t.mock.timers.tick(ms);
  await setImmediate();
}

test("retries preserve the serialized event and run the mapper only once", async (t) => {
  clock(t);
  const requests = [];
  let mappings = 0;
  let canceledBodies = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    return new Response(new ReadableStream({ cancel() { canceledBodies++; } }), {
      status: requests.length === 1 ? 503 : 201,
    });
  });
  const mutableEvent = { ...event };
  const adapter = createHttpAdapter("/events", {
    retry: true, headers: { "X-Ingest-Key": "key" },
    mapEvent(record) { mappings++; return { ...record, mapped: mappings }; },
  });
  const sent = adapter.send(mutableEvent);
  await setImmediate();
  mutableEvent.event_id = "changed-after-send";
  await advance(t, 499);
  assert.equal(requests.length, 1);
  await advance(t, 1);
  await sent;
  assert.equal(mappings, 1);
  assert.equal(requests.length, 2);
  assert.equal(canceledBodies, 2);
  assert.equal(requests[0].init.body, requests[1].init.body);
  assert.deepEqual(JSON.parse(requests[1].init.body), { ...event, mapped: 1 });
  for (const { init } of requests) {
    assert.equal(init.keepalive, true);
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.get("x-ingest-key"), "key");
  }
});

test("temporary HTTP and network failures stop after two retries", async (t) => {
  for (const status of [429, 502, 503, 504, "network"]) {
    await t.test(String(status), async (t) => {
      clock(t);
      const fetch = t.mock.method(globalThis, "fetch", async () => {
        if (status === "network") throw new TypeError("Network unavailable");
        return new Response(null, { status });
      });
      const failed = assert.rejects(createHttpAdapter("/events", { retry: true }).send(event),
        status === "network" ? /Network unavailable/ : new RegExp(`HTTP ${status}`));
      await setImmediate();
      await advance(t, 500);
      assert.equal(fetch.mock.callCount(), 2);
      await advance(t, 999);
      assert.equal(fetch.mock.callCount(), 2);
      await advance(t, 1);
      await failed;
      assert.equal(fetch.mock.callCount(), 3);
      await advance(t, 60_000);
      assert.equal(fetch.mock.callCount(), 3);
    });
  }
});

test("permanent responses and disabled retries fail after one attempt", async (t) => {
  const statuses = [400, 401, 403, 404, 413, 500, 501, 505];
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: statuses.shift() ?? 503 }));
  for (const status of [...statuses]) {
    await assert.rejects(createHttpAdapter("/events", { retry: true }).send(event), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(createHttpAdapter("/events").send(event), /HTTP 503/);
  await assert.rejects(createOtlpAdapter("/v1/logs").send(event), /HTTP 503/);
  await assert.rejects(createChunkifyAdapter("/events", { ingestKey: "key", retry: false }).send(event), /HTTP 503/);
  assert.equal(fetch.mock.callCount(), 11);
});

test("Chunkify defaults to retries and OTLP can opt in", async (t) => {
  for (const adapter of [
    createChunkifyAdapter("/events", { ingestKey: "key" }),
    createOtlpAdapter("/v1/logs", { retry: true }),
  ]) {
    await t.test("adapter recovers", async (t) => {
      clock(t);
      const bodies = [];
      t.mock.method(globalThis, "fetch", async (_, init) => {
        bodies.push(init.body);
        return new Response(null, { status: bodies.length === 1 ? 503 : 200 });
      });
      const sent = adapter.send(event);
      await setImmediate();
      await advance(t, 500);
      await sent;
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0], bodies[1]);
    });
  }
});

test("Retry-After accepts seconds and dates, with backoff for missing or invalid headers", async (t) => {
  for (const [header, delay] of [["2", 2000], ["Wed, 21 Oct 2026 12:00:02 GMT", 2000],
    [null, 625], ["invalid", 625], ["0", 625], ["Wed, 21 Oct 2026 11:00:00 GMT", 625]]) {
    await t.test(String(header), async (t) => {
      clock(t);
      t.mock.method(Math, "random", () => 0.5);
      let calls = 0;
      t.mock.method(globalThis, "fetch", async () => new Response(null, {
        status: ++calls === 1 ? 429 : 202, headers: header ? { "Retry-After": header } : {},
      }));
      const sent = createHttpAdapter("/events", { retry: true }).send(event);
      await setImmediate();
      await advance(t, delay - 1);
      assert.equal(calls, 1);
      await advance(t, 1);
      await sent;
      assert.equal(calls, 2);
    });
  }
});

test("long Retry-After stops delivery instead of retrying early", async (t) => {
  clock(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 503, headers: { "Retry-After": "60" },
  }));
  await assert.rejects(createHttpAdapter("/events", { retry: true }).send(event), /HTTP 503/);
  await advance(t, 60_000);
  assert.equal(fetch.mock.callCount(), 1);
});

test("each timed-out request is aborted and retries remain bounded", async (t) => {
  clock(t);
  const signals = [];
  t.mock.method(globalThis, "fetch", (_, { signal }) => new Promise((_, reject) => {
    signals.push(signal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const adapter = createHttpAdapter("/events", { retry: true });
  const failed = assert.rejects(adapter.send(event), { name: "AbortError" });
  for (const delay of [500, 1000, 0]) {
    await advance(t, 5000);
    assert.ok(signals.at(-1).aborted);
    if (delay) await advance(t, delay);
  }
  await failed;
  assert.equal(signals.length, 3);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 201 }));
  await adapter.send(event);
});

test("pending-send limit includes backoff and releases capacity after failure", async (t) => {
  clock(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  const adapter = createHttpAdapter("/events", { retry: true });
  const pending = Promise.all(Array.from({ length: 32 }, () => assert.rejects(adapter.send(event), /HTTP 503/)));
  await setImmediate();
  await assert.rejects(adapter.send(event), /too many pending sends/);
  assert.equal(fetch.mock.callCount(), 32);
  // Another adapter has its own limit.
  await assert.rejects(createHttpAdapter("/events").send(event), /HTTP 503/);
  await advance(t, 500);
  await advance(t, 1000);
  await pending;
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 201 }));
  await adapter.send(event);
});

test("invalid options and mapping failures never retry or consume pending capacity", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response());
  for (const retry of [null, 1, "true", {}]) {
    assert.throws(() => createHttpAdapter("/events", { retry }), TypeError);
    assert.throws(() => createOtlpAdapter("/v1/logs", { retry }), TypeError);
    assert.throws(() => createChunkifyAdapter("/events", { ingestKey: "key", retry }), TypeError);
  }
  for (const mapEvent of [() => undefined, () => { throw new TypeError("Invalid mapping"); }, () => {
    const circular = {}; circular.self = circular; return circular;
  }]) {
    const adapter = createHttpAdapter("/events", { retry: true, mapEvent });
    for (let i = 0; i < 33; i++) await assert.rejects(adapter.send(event), TypeError);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
