import "media-chrome";
import "media-chrome/dist/menu/index.js";
import { MediaTheme } from "media-chrome/dist/media-theme.js";
import { defaultThemeMarkup } from "./themes/default.js";
import "./playback-rate-menu.js";

export const defaultPlayerTheme = "default";

const themeTemplates = new Map<string, HTMLTemplateElement>();

function createTemplate(markup: string): HTMLTemplateElement {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template;
}

themeTemplates.set(defaultPlayerTheme, createTemplate(defaultThemeMarkup));

export function registerPlayerTheme(name: string, template: HTMLTemplateElement): void {
  const normalizedName = name.trim();
  if (!normalizedName) throw new TypeError("A player theme needs a name.");
  if (template.localName !== "template") {
    throw new TypeError("A player theme must be an HTML template element.");
  }
  themeTemplates.set(normalizedName, template);
}

export function resolvePlayerTheme(name: string | null): string {
  return name && themeTemplates.has(name) ? name : defaultPlayerTheme;
}

export function createPlayerTheme(name: string, noAutoSeekToLive = true) {
  const theme = new MediaTheme();
  // The controller reads this when its store is created, before later syncs run.
  theme.toggleAttribute("noautoseektolive", noAutoSeekToLive);
  const template = themeTemplates.get(resolvePlayerTheme(name))!.cloneNode(true) as HTMLTemplateElement;
  const controller = template.content.querySelector("media-controller");
  controller?.setAttribute("noautoseektolive", "{{noautoseektolive}}");
  theme.template = template;
  theme.setAttribute("part", "theme");
  return theme;
}

export function syncPlayerTheme(
  theme: ReturnType<typeof createPlayerTheme>,
  controls: boolean,
  noAutoSeekToLive: boolean,
  colors: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
  },
) {
  theme.toggleAttribute("controls", controls);
  theme.toggleAttribute("disabled", !controls);
  theme.toggleAttribute("nohotkeys", !controls);
  theme.toggleAttribute("noautoseektolive", noAutoSeekToLive);
  for (const [name, value] of Object.entries(colors)) {
    const property = `--media-${name}-color`;
    if (value === null) theme.style.removeProperty(property);
    else theme.style.setProperty(property, value);
  }
  theme.render();
}
