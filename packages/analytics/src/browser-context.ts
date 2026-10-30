import type { BrowserContext } from "./chunkify.js";

// Browser APIs can be absent or throw under privacy controls. A failed measurement
// must not prevent the remaining context or playback event from being delivered.
function read<T>(get: () => T): T | null {
  try { return get(); } catch { return null; }
}

function text(value: unknown, limit = 64): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, limit) : null;
}

function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : null;
}

function browser(ua: string): Pick<BrowserContext, "browser_name" | "browser_version"> {
  const patterns: [string, RegExp][] = [
    ["Edge", /(?:Edg|EdgA|EdgiOS|Edge)\/([\d.]+)/],
    ["Opera", /(?:OPR|OPiOS)\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS|HeadlessChrome)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari\//],
  ];
  for (const [name, pattern] of patterns) {
    const version = ua.match(pattern)?.[1];
    if (version) return { browser_name: name, browser_version: text(version) };
  }
  return { browser_name: null, browser_version: null };
}

function operatingSystem(ua: string): Pick<BrowserContext, "os_name" | "os_version"> {
  const patterns: [string, RegExp][] = [
    ["iOS", /(?:iPhone OS|CPU OS) ([\d_]+)/],
    ["Android", /Android ([\d.]+)/],
    ["Windows", /Windows NT ([\d.]+)/],
    ["macOS", /Mac OS X ([\d_.]+)/],
    ["ChromeOS", /CrOS \S+ ([\d.]+)/],
  ];
  for (const [name, pattern] of patterns) {
    const version = ua.match(pattern)?.[1];
    if (version) return { os_name: name, os_version: text(version.replaceAll("_", ".")) };
  }
  return { os_name: /Linux/.test(ua) ? "Linux" : null, os_version: null };
}

interface ClientHints {
  brands?: { brand?: string; version?: string }[];
  mobile?: boolean;
  platform?: string;
}

function stableContext(browserWindow: Window & typeof globalThis): StableContext {
  const nav = read(() => browserWindow.navigator as Navigator & { userAgentData?: ClientHints });
  const userAgent = text(read(() => nav?.userAgent), 512);
  const ua = userAgent ?? "";
  const hints = read(() => nav?.userAgentData);
  const brands = read(() => hints?.brands);
  let detectedBrowser = browser(ua);
  // Prefer a named browser over its Chromium engine brand. Keep the fuller UA
  // version when it identifies the same browser as the low-entropy hint.
  if (Array.isArray(brands)) {
    for (const [brand, name] of [["Microsoft Edge", "Edge"], ["Opera", "Opera"],
      ["Samsung Internet", "Samsung Internet"], ["Google Chrome", "Chrome"], ["Chromium", "Chromium"]]) {
      const match = read(() => brands.slice(0, 8).find((entry) => entry?.brand === brand));
      if (match) {
        if (detectedBrowser.browser_name !== name && (name !== "Chromium" || !detectedBrowser.browser_name)) {
          detectedBrowser = { browser_name: name!, browser_version: text(read(() => match.version)) };
        }
        break;
      }
    }
  }
  let os = operatingSystem(ua);
  const platform = read(() => hints?.platform);
  const hintedOS = platform === "Chrome OS" ? "ChromeOS" : platform;
  if (["Android", "Windows", "macOS", "Linux", "ChromeOS", "iOS"].includes(hintedOS ?? "") && hintedOS !== os.os_name) {
    // Desktop-site mode can hide Android behind a Linux UA. Hints identify the
    // platform but do not provide an OS version at this entropy level.
    os = { os_name: hintedOS!, os_version: null };
  }
  const desktopIpad = /Macintosh/.test(ua) && (read(() => nav?.maxTouchPoints) ?? 0) > 1;
  if (desktopIpad) os = { os_name: "iPadOS", os_version: null };
  const deviceType = /SmartTV|Smart-TV|HbbTV|GoogleTV|Android TV|TV;|Xbox|PlayStation/i.test(ua) ? "unknown" :
    /iPad/.test(ua) || desktopIpad ? "tablet" :
    /Mobile|iPhone|iPod/.test(ua) || read(() => hints?.mobile) === true ? "mobile" :
    os.os_name === "Android" ? "tablet" :
    ["Windows", "macOS", "Linux", "ChromeOS"].includes(os.os_name ?? "") ? "desktop" : "unknown";
  const deviceFamily = /iPad/.test(ua) || desktopIpad ? "iPad" : /iPhone/.test(ua) ? "iPhone" :
    /iPod/.test(ua) ? "iPod Touch" : os.os_name === "Android" && deviceType !== "unknown" ?
      (deviceType === "tablet" ? "Android Tablet" : "Android") : null;
  const language = text(read(() => nav?.language));
  return {
    schema_version: 1, user_agent: userAgent, ...detectedBrowser, ...os, device_type: deviceType,
    device_family: deviceFamily, language, language_prefix: language?.split(/[-_]/)[0] || null,
    timezone: text(read(() => browserWindow.Intl.DateTimeFormat().resolvedOptions().timeZone), 128),
  };
}

type StableContext = Omit<BrowserContext, "screen_width_px" | "screen_height_px" |
  "viewport_width_px" | "viewport_height_px" | "pixel_ratio" | "timezone_offset_minutes" |
  "page_origin" | "page_path">;

function pageContext(browserWindow: Window & typeof globalThis): Pick<BrowserContext, "page_origin" | "page_path"> {
  const url = read(() => new URL(browserWindow.location.href));
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return { page_origin: null, page_path: null };
  }
  return {
    page_origin: url.origin.length <= 2048 ? url.origin : null,
    page_path: url.pathname.length <= 2048 ? url.pathname : null,
  };
}

/** Each adapter caches stable context on its first browser send, without browser listeners or storage. */
export function createBrowserContextReader(): () => BrowserContext | undefined {
  let stable: StableContext | undefined;
  return () => {
    const browserWindow = read(() => typeof window === "undefined" ? null : window);
    if (!browserWindow) return undefined;
    stable ??= stableContext(browserWindow);
    const ratio = read(() => browserWindow.devicePixelRatio);
    const offset = read(() => new browserWindow.Date().getTimezoneOffset());
    return {
      ...stable,
      ...pageContext(browserWindow),
      timezone_offset_minutes: typeof offset === "number" && Number.isInteger(offset) && Math.abs(offset) <= 1440 ? offset : null,
      screen_width_px: dimension(read(() => browserWindow.screen.width)),
      screen_height_px: dimension(read(() => browserWindow.screen.height)),
      viewport_width_px: dimension(read(() => browserWindow.innerWidth)),
      viewport_height_px: dimension(read(() => browserWindow.innerHeight)),
      pixel_ratio: typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 && ratio <= 100 ? ratio : null,
    };
  };
}
