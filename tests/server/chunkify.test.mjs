import assert from "node:assert/strict";
import test from "node:test";
import { createChunkifyAdapter } from "@chunkify/analytics/chunkify";

test("Chunkify imports and sends unchanged events without a browser, and reports delivery failures", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response("{}", { status: requests.length === 1 ? 201 : 503 });
  });
  const event = Object.freeze({ event_name: "chunkify.video.view_ended", video_id: "video-a" });
  const destination = createChunkifyAdapter("/v1/events", { ingestKey: "public-key" });
  await destination.send(event);
  assert.deepEqual(JSON.parse(requests[0].options.body), event);
  assert.equal(requests[0].options.headers.get("x-chunkify-ingest-key"), "public-key");
  assert.equal(requests[0].options.keepalive, true);
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.referrerPolicy, "no-referrer");
  await assert.rejects(destination.send(event), /HTTP 503/);
});

test("Chunkify requires a valid configuration and retains HTTP endpoint restrictions", () => {
  for (const options of [undefined, null, [], {}, { ingestKey: " " }, { ingestKey: 123 },
    { ingestKey: "key", collectBrowserContext: "yes" }, { ingestKey: "key\r\nInjected: value" }]) {
    assert.throws(() => createChunkifyAdapter("/v1/events", options), TypeError);
  }
  assert.throws(() => createChunkifyAdapter("https://example.com/v1/events?key=secret", { ingestKey: "key" }), TypeError);
});
