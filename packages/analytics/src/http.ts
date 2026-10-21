import type { AnalyticsDestination, ChunkifyPlayerAnalyticsEvent } from "./core.js";

export interface HttpAdapterOptions {
  /** Public ingest keys or other endpoint headers. Never embed private server tokens in browser code. */
  headers?: Readonly<Record<string, string>> | undefined;
  mapEvent?: (event: ChunkifyPlayerAnalyticsEvent) => unknown;
  /** Retry temporary failures at most twice. Defaults to false; the receiver must handle duplicates. */
  retry?: boolean | undefined;
}

const MAX_PENDING_SENDS = 32;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRY_DELAY_MS = 10_000;

async function postEvent(endpoint: string, init: RequestInit, retry: boolean): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await fetch(endpoint, { ...init, signal: controller.signal });
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timeout);
    }
    // No adapter uses the response body. Release it before returning or retrying.
    void response?.body?.cancel().catch(() => {});
    if (response?.ok) return;
    if (response) failure = new Error(`Analytics endpoint returned HTTP ${response.status}.`);
    // These retryable statuses also follow the OTLP/HTTP specification.
    if (!retry || attempt === 2 || (response && ![429, 502, 503, 504].includes(response.status))) throw failure;

    const retryAfter = response?.headers.get("Retry-After");
    const serverDelay = retryAfter == null ? 0 : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now();
    const delay = Math.max(500 * 2 ** attempt + Math.random() * 250, Number.isNaN(serverDelay) ? 0 : serverDelay);
    // Give up instead of retrying earlier than the server permits or retaining events indefinitely.
    if (delay > MAX_RETRY_DELAY_MS) throw failure;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

/** POST each event as JSON to a customer endpoint, omitting browser credentials. */
export function createHttpAdapter(
  endpoint: string,
  options: HttpAdapterOptions = {},
): AnalyticsDestination {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("HTTP adapter options must be an object.");
  }
  if (options.retry !== undefined && typeof options.retry !== "boolean") {
    throw new TypeError("HTTP adapter retry option must be a boolean.");
  }
  const retry = options.retry === true;
  const mapEvent = options.mapEvent === undefined ? (event: ChunkifyPlayerAnalyticsEvent) => event : options.mapEvent;
  if (typeof mapEvent !== "function") throw new TypeError("HTTP adapter mapper must be a function.");
  const headers = new Headers(options.headers);
  if (headers.has("cookie") || headers.has("cookie2")) throw new TypeError("HTTP adapter cannot send cookie headers.");
  headers.set("Content-Type", "application/json");
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
  let pendingSends = 0;
  return {
    async send(event: ChunkifyPlayerAnalyticsEvent) {
      if (pendingSends >= MAX_PENDING_SENDS) throw new Error("Analytics adapter has too many pending sends.");
      pendingSends++;
      try {
        // Serialize once so retries keep the same ID, timestamp, mapping and browser context.
        const body = JSON.stringify(mapEvent(event));
        if (body === undefined) throw new TypeError("HTTP adapter mapper must return a JSON value.");
        await postEvent(endpoint, {
          method: "POST",
          headers,
          body,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          keepalive: event.event_name === "chunkify.video.view_ended",
        }, retry);
      } finally {
        pendingSends--;
      }
    },
  };
}
