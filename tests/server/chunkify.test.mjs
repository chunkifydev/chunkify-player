import assert from "node:assert/strict";
import test from "node:test";
import { createChunkifyAdapter } from "@chunkify/player-analytics/chunkify";

test("Chunkify imports and sends unchanged events without a browser, and reports delivery failures", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return new Response("{}", { status: requests.length === 1 ? 201 : 503 });
  });
  const event = Object.freeze({ event_name: "chunkify.video.view_ended", video_id: "video-a" });
  const destination = createChunkifyAdapter("/v1/events", { ingestKey: "public-key", retry: false });
  await destination.send(event);
  assert.deepEqual(JSON.parse(requests[0].options.body), event);
  assert.equal(requests[0].options.headers.get("x-chunkify-ingest-key"), "public-key");
  assert.equal(requests[0].options.keepalive, true);
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.referrerPolicy, "no-referrer");
  await assert.rejects(destination.send(event), /HTTP 503/);
});

test("Chunkify sends a collector address without a path to its /v1/events endpoint", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return new Response("{}", { status: 201 });
  });
  const cases = [
    // A collector or proxy address without a path.
    ["https://analytics.example.com", "https://analytics.example.com/v1/events"],
    ["https://analytics.example.com/", "https://analytics.example.com/v1/events"],
    ["https://analytics.example.com:8443", "https://analytics.example.com:8443/v1/events"],
    ["HTTPS://Analytics.Example.com", "https://analytics.example.com/v1/events"],
    ["http://127.0.0.1:4174", "http://127.0.0.1:4174/v1/events"],
    ["/", "/v1/events"],
    // Any URL with a path is used as given: full URLs and proxies on a path.
    ["https://analytics.example.com/v1/events", "https://analytics.example.com/v1/events"],
    ["https://example.com/collector/v1/events", "https://example.com/collector/v1/events"],
    ["https://example.com/api/video-events", "https://example.com/api/video-events"],
    ["/v1/events", "/v1/events"],
  ];
  for (const [endpoint] of cases) {
    await createChunkifyAdapter(endpoint, { ingestKey: "public-key", collectBrowserContext: false })
      .send({ event_name: "chunkify.video.view_started" });
  }
  assert.deepEqual(urls, cases.map(([, expected]) => expected));
});

test("Chunkify still rejects collector addresses the HTTP adapter refuses", () => {
  for (const endpoint of ["https://user:secret@analytics.example.com", "https://analytics.example.com/?key=secret",
    "https://analytics.example.com?key=secret", "https://analytics.example.com#fragment",
    "http://analytics.example.com", "//analytics.example.com", "ftp://analytics.example.com", ""]) {
    assert.throws(() => createChunkifyAdapter(endpoint, { ingestKey: "key" }), TypeError, endpoint);
  }
});

test("Chunkify requires a valid configuration and retains HTTP endpoint restrictions", () => {
  for (const options of [undefined, null, [], {}, { ingestKey: " " }, { ingestKey: 123 },
    { ingestKey: "key", collectBrowserContext: "yes" }, { ingestKey: "key\r\nInjected: value" }]) {
    assert.throws(() => createChunkifyAdapter("/v1/events", options), TypeError);
  }
  assert.throws(() => createChunkifyAdapter("https://example.com/v1/events?key=secret", { ingestKey: "key" }), TypeError);
});

test("page context strips URL credentials, query and fragment, and handles unavailable locations", async (t) => {
  const requests = [];
  const browserWindow = { location: { href: "https://username:secret@example.com:8443/watch/episode?token=private#secret" } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  t.after(() => { delete globalThis.window; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response("{}", { status: 201 });
  });
  const adapter = createChunkifyAdapter("/v1/events", { ingestKey: "public-key" });
  const event = { event_name: "chunkify.video.view_started" };
  await adapter.send(event);
  assert.equal(requests[0].browser_context.page_origin, "https://example.com:8443");
  assert.equal(requests[0].browser_context.page_path, "/watch/episode");
  for (const value of ["username", "secret", "token", "private"]) assert.ok(!JSON.stringify(requests).includes(value));
  for (const href of ["data:text/html,private", "file:///private/video.html", "about:blank", "invalid"]) {
    browserWindow.location.href = href;
    await adapter.send(event);
    assert.equal(requests.at(-1).browser_context.page_origin, null);
    assert.equal(requests.at(-1).browser_context.page_path, null);
  }
  browserWindow.location.href = `https://example.com/${"a".repeat(2048)}`;
  await adapter.send(event);
  assert.equal(requests.at(-1).browser_context.page_origin, "https://example.com");
  assert.equal(requests.at(-1).browser_context.page_path, null);
  Object.defineProperty(browserWindow, "location", { get() { throw new Error("Unavailable"); } });
  await adapter.send(event);
  assert.equal(requests.at(-1).browser_context.page_origin, null);
  assert.equal(requests.at(-1).browser_context.page_path, null);
});
