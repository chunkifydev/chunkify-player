/** Page localStorage key holding the generated viewer ID. */
export const viewerIdStorageKey = "chunkify_analytics_viewer_id";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared by every session for this page load: used when persistence is off or storage fails.
let pageViewerId: string | null = null;

function pageId(): string {
  return pageViewerId ??= crypto.randomUUID();
}

/**
 * Return the anonymous viewer ID for this browser. With persistence, it is read from and
 * written to page localStorage; storage errors fall back to an ID kept for this page load.
 */
export function resolveViewerId(persist: boolean): string {
  if (!persist) return pageId();
  try {
    const stored = globalThis.localStorage.getItem(viewerIdStorageKey);
    if (stored && uuidPattern.test(stored)) return stored;
  } catch {
    // Storage can be missing or blocked (private mode, disabled site data).
  }
  const id = pageId();
  try {
    globalThis.localStorage.setItem(viewerIdStorageKey, id);
  } catch {
    // Keep tracking with the in-memory ID when storage cannot be written.
  }
  return id;
}
