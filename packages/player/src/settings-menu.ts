import { MediaSettingsMenu } from "media-chrome/dist/menu/media-settings-menu.js";

class SettingsMenu extends MediaSettingsMenu {
  #layoutObserver = new ResizeObserver((entries) => {
    const bounds = entries.find((entry) => entry.target.localName === "media-controller");
    // A pixel limit also applies inside the absolutely positioned submenus.
    if (bounds) this.style.setProperty("--settings-menu-bounds-height", `${bounds.contentRect.height}px`);
    // Keep Media Chrome's expanded height in sync after bounds or breakpoint changes.
    const submenu = this.querySelector<HTMLElement>('[slot="submenu"]:not([hidden])');
    if (submenu) {
      this.style.minHeight = getComputedStyle(submenu).height;
    }
  });

  connectedCallback(): void {
    super.connectedCallback();
    const controller = this.closest("media-controller");
    if (controller) this.#layoutObserver.observe(controller);
    this.querySelectorAll('[slot="submenu"]').forEach((submenu) => this.#layoutObserver.observe(submenu));
  }

  disconnectedCallback(): void {
    this.#layoutObserver.disconnect();
    super.disconnectedCallback();
  }

  // Unavailable settings are hidden by the theme. Skip them during keyboard navigation.
  get items() {
    return super.items.filter((item) => getComputedStyle(item).display !== "none");
  }
}

if (!customElements.get("chunkify-settings-menu")) {
  customElements.define("chunkify-settings-menu", SettingsMenu);
}
