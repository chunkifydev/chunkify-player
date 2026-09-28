import type { AnalyticsDestination, ChunkifyPlayerAnalyticsEvent } from "./core.js";

/** POST each event as JSON to a customer endpoint. No credentials or custom headers are accepted. */
export function createHttpAdapter(
  endpoint: string,
  mapEvent: (event: ChunkifyPlayerAnalyticsEvent) => unknown = (event) => event,
): AnalyticsDestination {
  if (typeof mapEvent !== "function") throw new TypeError("HTTP adapter mapper must be a function.");
  if (typeof endpoint !== "string" || !endpoint || endpoint.startsWith("//")) {
    throw new TypeError("HTTP adapter requires an HTTPS URL or a root-relative path.");
  }
  const rootRelative = endpoint.startsWith("/");
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(endpoint);
  let url: URL;
  try {
    url = new URL(endpoint, "https://chunkify.invalid");
  } catch {
    throw new TypeError("HTTP adapter requires a valid endpoint URL.");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!rootRelative && !absolute) ||
      (rootRelative && url.origin !== "https://chunkify.invalid") ||
      (!rootRelative && url.protocol !== "https:" && !localHttp) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError("HTTP adapter requires a root-relative path or HTTPS URL without credentials or query parameters (HTTP is allowed on loopback).");
  }
  return {
    async send(event: ChunkifyPlayerAnalyticsEvent) {
      const body = JSON.stringify(mapEvent(event));
      if (body === undefined) throw new TypeError("HTTP adapter mapper must return a JSON value.");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        keepalive: event.event_name === "chunkify.video.view_ended",
      });
      if (!response.ok) throw new Error(`Analytics endpoint returned HTTP ${response.status}.`);
    },
  };
}
