import "media-chrome";
import { MediaTheme } from "media-chrome/dist/media-theme.js";
import { defaultThemeMarkup } from "./themes/default.js";

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

export function createPlayerTheme(name: string) {
  const theme = new MediaTheme();
  theme.template = themeTemplates.get(resolvePlayerTheme(name))!;
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
