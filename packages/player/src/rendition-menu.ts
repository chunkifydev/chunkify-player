import { MediaRenditionMenu } from "media-chrome/dist/menu/media-rendition-menu.js";
import type { MediaChromeMenuItem } from "media-chrome/dist/menu/media-chrome-menu-item.js";

class RenditionMenu extends MediaRenditionMenu {
  static getTemplateHTML(attributes: Record<string, string>): string {
    return `${super.getTemplateHTML(attributes)}
      <style>
        .quality-badge { margin-left: 4px; font-size: 10px; font-weight: 600; opacity: .7; }
      </style>`;
  }

  constructor() {
    super();
    // Add badges before the settings row reads the selected item's description.
    this.addEventListener("addmenuitem", (event) => {
      const item = (event as CustomEvent<MediaChromeMenuItem>).detail;
      const rendition = this.mediaRenditionList.find((entry) => entry.id === item.value);
      const resolution = rendition
        ? Math.min(rendition.width ?? 0, rendition.height ?? 0)
        : Math.min(this.mediaWidth, this.mediaHeight);
      const badge = resolution >= 2160 ? "4K" : resolution >= 720 ? "HD" : "";
      if (!badge) return;
      const label = item.querySelector("span");
      if (!label) return;
      const suffix = document.createElement("sup");
      suffix.className = "quality-badge";
      suffix.textContent = ` ${badge}`;
      label.append(suffix);
      item.dataset.description = item.text;
    }, { capture: true });
  }
}

if (!customElements.get("chunkify-rendition-menu")) {
  customElements.define("chunkify-rendition-menu", RenditionMenu);
}
