import { expect, test } from "@playwright/test";
import type { BrowserContext } from "@chunkify/analytics/chunkify";

test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 960, height: 540 },
  contextOptions: { screen: { width: 1920, height: 1080 } }, deviceScaleFactor: 2 });

test("Chunkify sends browser context with each event without changing the shared event", async ({ page, browserName }) => {
  const requests: { body: Record<string, unknown>; key: string | undefined }[] = [];
  await page.route("**/chunkify-events", async (route) => {
    requests.push({ body: route.request().postDataJSON(), key: route.request().headers()["x-chunkify-ingest-key"] });
    await route.fulfill({ status: 201, body: "{}" });
  });
  await page.goto("/tests/fixtures/analytics.html");
  await page.waitForFunction(() => Boolean(window.analyticsFixture));
  const original = await page.evaluate(async () => {
    const path = "/packages/analytics/dist/chunkify.js";
    const { createChunkifyAdapter } = await import(path);
    const destination = createChunkifyAdapter("/chunkify-events", { ingestKey: "public-demo-key" });
    const deliveries: Promise<void>[] = [];
    const f = window.analyticsFixture;
    const session = f.attachSummaryAnalytics(f.video, { videoId: "browser-context", destinations: [
      { send(event) { deliveries.push(destination.send(event)); } },
      { send(event) { f.events.push(event); } },
    ] });
    session.startAttempt();
    session.destroy();
    await Promise.all(deliveries);
    return f.events;
  });
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.key).toBe("public-demo-key");
    expect(request.body.browser_context).toMatchObject({
      schema_version: 1, browser_name: { chromium: "Chrome", firefox: "Firefox", webkit: "Safari" }[browserName],
      device_type: "desktop", device_family: null, language: "fr-FR", language_prefix: "fr", timezone: "Europe/Paris",
      screen_width_px: 1920, screen_height_px: 1080, viewport_width_px: 960, viewport_height_px: 540,
      pixel_ratio: 2,
    });
  }
  const delivered = requests.map(({ body: { browser_context, ...event } }) => event)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  expect(delivered).toEqual(original);
  expect(original.every((event) => !("browser_context" in event))).toBe(true);
});

test("reported browser identities, mobile devices, and low-entropy hints have explicit fallbacks", async ({ page }) => {
  const received: BrowserContext[] = [];
  await page.route("**/chunkify-events", async (route) => {
    received.push(route.request().postDataJSON().browser_context);
    await route.fulfill({ status: 201, body: "{}" });
  });
  await page.goto("/tests/fixtures/analytics.html");
  const cases = [
    { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68",
      expected: ["Edge", "130.0.2849.68", "Windows", "10.0", "desktop"] },
    { ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
      expected: ["Chrome", "130.0.0.0", "Android", "14", "mobile"] },
    { ua: "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      expected: ["Chrome", "130.0.0.0", "Android", "13", "tablet"] },
    { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      expected: ["Safari", "18.0", "iOS", "18.0", "mobile"] },
    { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      touchPoints: 5, expected: ["Safari", "18.0", "iPadOS", null, "tablet"] },
    { ua: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      expected: ["Chrome", "130.0.0.0", "ChromeOS", "14541.0.0", "desktop"] },
    { ua: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SamsungBrowser/27.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      expected: ["Samsung Internet", "27.0", "Android", "14", "mobile"] },
    { ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 OPR/115.0",
      expected: ["Opera", "115.0", "Linux", null, "desktop"] },
    { ua: "Mozilla/5.0 (Linux; Android 10; SmartTV) AppleWebKit/537.36",
      expected: [null, null, "Android", "10", "unknown"] },
    { ua: "unrecognized", expected: [null, null, null, null, "unknown"] },
    { ua: "", hints: { brands: [{ brand: "Not A Brand", version: "99" }, { brand: "Chromium", version: "130" },
      { brand: "Microsoft Edge", version: "130" }], mobile: false, platform: "Windows" },
      expected: ["Edge", "130", "Windows", null, "desktop"] },
  ];
  await page.evaluate(async (cases) => {
    const path = "/packages/analytics/dist/chunkify.js";
    const { createChunkifyAdapter } = await import(path);
    for (const fixture of cases) {
      Object.defineProperties(navigator, {
        userAgent: { configurable: true, value: fixture.ua },
        maxTouchPoints: { configurable: true, value: fixture.touchPoints ?? 0 },
        userAgentData: { configurable: true, value: fixture.hints ? { ...fixture.hints,
          getHighEntropyValues() { throw new Error("Must not request high-entropy hints"); } } : undefined },
      });
      await createChunkifyAdapter("/chunkify-events", { ingestKey: "public-demo-key" })
        .send({ event_name: "chunkify.video.view_started" });
    }
  }, cases);
  expect(received.map((c) => [c.browser_name, c.browser_version, c.os_name, c.os_version, c.device_type]))
    .toEqual(cases.map((c) => c.expected));
});

test("PostHog-style device families, language prefix, and timezone offset describe the viewing environment", async ({ page }) => {
  const received: BrowserContext[] = [];
  await page.route("**/chunkify-events", async (route) => {
    received.push(route.request().postDataJSON().browser_context);
    await route.fulfill({ status: 201, body: "{}" });
  });
  await page.goto("/tests/fixtures/analytics.html");
  await page.clock.install({ time: new Date("2026-01-15T12:00:00Z") });
  await page.evaluate(async () => {
    const path = "/packages/analytics/dist/chunkify.js";
    const { createChunkifyAdapter } = await import(path);
    Object.defineProperties(navigator, {
      userAgent: { configurable: true, value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1" },
      userAgentData: { configurable: true, value: undefined },
    });
    await createChunkifyAdapter("/chunkify-events", { ingestKey: "key" }).send({ event_name: "chunkify.video.view_started" });
    // Android tablets can request desktop pages and report a Linux user agent.
    Object.defineProperties(navigator, {
      userAgent: { configurable: true, value: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36" },
      userAgentData: { configurable: true, value: { platform: "Android", mobile: false } },
    });
    await createChunkifyAdapter("/chunkify-events", { ingestKey: "key" }).send({ event_name: "chunkify.video.view_started" });
  });
  expect(received[0]).toMatchObject({ device_family: "iPhone", language_prefix: "fr", timezone_offset_minutes: -60 });
  expect(received[1]).toMatchObject({ device_family: "Android Tablet", os_name: "Android", os_version: null, device_type: "tablet" });
});

test("context tolerates unavailable APIs, stays bounded, and samples changing viewport sizes", async ({ page }) => {
  const received: BrowserContext[] = [];
  await page.route("**/chunkify-events", async (route) => {
    received.push(route.request().postDataJSON().browser_context);
    await route.fulfill({ status: 201, body: "{}" });
  });
  await page.goto("/tests/fixtures/analytics.html");
  await page.evaluate(async () => {
    const path = "/packages/analytics/dist/chunkify.js";
    const { createChunkifyAdapter } = await import(path);
    Object.defineProperties(navigator, {
      userAgent: { configurable: true, value: "\u0000".repeat(10000) },
      language: { configurable: true, value: "\u0000".repeat(10000) },
      userAgentData: { configurable: true, get() { throw new Error("Unavailable"); } },
    });
    Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value() { throw new Error("Unavailable"); } });
    Object.defineProperty(window, "screen", { configurable: true, get() { throw new Error("Unavailable"); } });
    const destination = createChunkifyAdapter("/chunkify-events", { ingestKey: "public-demo-key" });
    const event = { event_name: "chunkify.video.view_started" };
    await destination.send(event);
    Object.defineProperty(navigator, "userAgent", { configurable: true, get() { throw new Error("Changed"); } });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: Infinity });
    await destination.send(event);
    // A new adapter sees inaccessible values rather than the prior adapter's cache.
    await createChunkifyAdapter("/chunkify-events", { ingestKey: "public-demo-key" }).send(event);
  });
  expect(received).toHaveLength(3);
  expect(received[0]).toMatchObject({ user_agent: "\u0000".repeat(512), language: "\u0000".repeat(64),
    browser_name: null, browser_version: null, os_name: null, os_version: null, device_type: "unknown",
    screen_width_px: null, screen_height_px: null, timezone: null, viewport_width_px: 960 });
  expect(received[1]).toMatchObject({ user_agent: received[0]!.user_agent, viewport_width_px: 640, pixel_ratio: null });
  expect(received[2]).toMatchObject({ user_agent: null, browser_name: null, viewport_width_px: 640 });
  for (const context of received) expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(8192);
});

test("disabled collection and generic destinations leave browser collection to the application", async ({ page }) => {
  const requests: { path: string; body: Record<string, unknown>; key: string | undefined }[] = [];
  await page.route("**/adapter-test/*", async (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON(),
      key: route.request().headers()["x-customer-key"] });
    await route.fulfill({ status: 200, body: "{}" });
  });
  await page.goto("/tests/fixtures/analytics.html");
  const result = await page.evaluate(async () => {
    const modules = await Promise.all(["chunkify", "http", "otlp", "posthog", "datadog"].map(
      (name) => import(`/packages/analytics/dist/${name}.js`)));
    let browserReads = 0;
    Object.defineProperty(window, "navigator", { get() { browserReads++; throw new Error("Unavailable"); } });
    const event = { event_name: "chunkify.video.view_ended", occurred_at: "2026-10-16T12:00:00Z", sdk_version: "test" };
    const providerEvents: unknown[] = [];
    const headers = { "X-Customer-Key": "custom-public-key" };
    await modules[0]!.createChunkifyAdapter("/adapter-test/chunkify", {
      ingestKey: "public-demo-key", collectBrowserContext: false,
    }).send(event);
    await modules[1]!.createHttpAdapter("/adapter-test/http", { headers }).send(event);
    await modules[2]!.createOtlpAdapter("/adapter-test/otlp", { headers }).send(event);
    modules[3]!.createPostHogAdapter({ capture(_name: string, properties: unknown) { providerEvents.push(properties); } }).send(event);
    modules[4]!.createDatadogAdapter({ addAction(_name: string, properties: unknown) { providerEvents.push(properties); } }).send(event);
    return { browserReads, event, providerEvents };
  });
  expect(result.browserReads).toBe(0);
  expect(result.providerEvents).toEqual([result.event, result.event]);
  expect(requests[0]!.body).toEqual(result.event);
  expect(requests[1]).toMatchObject({ body: result.event, key: "custom-public-key" });
  expect(requests[2]!.key).toBe("custom-public-key");
  expect(JSON.stringify(requests[2]!.body)).not.toContain("browser_context");
});
