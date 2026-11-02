import { MediaSettingsMenu } from "media-chrome/dist/menu/media-settings-menu.js";

class SettingsMenu extends MediaSettingsMenu {
  // Unavailable settings are hidden by the theme. Skip them during keyboard navigation.
  get items() {
    return super.items.filter((item) => getComputedStyle(item).display !== "none");
  }
}

if (!customElements.get("chunkify-settings-menu")) {
  customElements.define("chunkify-settings-menu", SettingsMenu);
}
