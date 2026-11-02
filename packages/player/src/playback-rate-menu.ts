import { constants } from "media-chrome";
import { MediaChromeMenu } from "media-chrome/dist/menu/media-chrome-menu.js";

const { MediaUIAttributes, MediaUIEvents } = constants;

class PlaybackRateMenu extends MediaChromeMenu {
  static get observedAttributes(): string[] {
    return [...super.observedAttributes, MediaUIAttributes.MEDIA_PLAYBACK_RATE];
  }

  static getTemplateHTML(attributes: Record<string, string>): string {
    return `${super.getTemplateHTML(attributes)}
      <style>
        :host { --media-menu-max-height: none; }
        .speed-control { padding: 4px 16px 10px; }
        .speed-value, .speed-limits { display: flex; justify-content: space-between; align-items: center; }
        output { font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .speed-limits { font-size: 12px; opacity: .7; line-height: 16px; }
        .reset { padding: 2px 8px; border-radius: 6px; cursor: pointer; background: rgb(255 255 255 / .1); }
        .reset:active { background: rgb(255 255 255 / .2); }
        .reset:focus-visible { outline: 2px solid var(--media-accent-color, #7596CC); outline-offset: 2px; }
        input { display: block; width: 100%; height: 28px; margin: 0; accent-color: var(--media-accent-color, #7596CC); cursor: pointer; }
        button, input { touch-action: manipulation; }
        @media (hover: hover) and (pointer: fine) {
          .reset:hover { background: rgb(255 255 255 / .2); }
        }
      </style>`;
  }

  #range: HTMLInputElement;
  #output: HTMLOutputElement;

  constructor() {
    super();
    this.defaultSlot.innerHTML = `
      <div class="speed-control">
        <div class="speed-value">
          <output>1×</output>
          <button type="button" class="reset" aria-label="Reset playback speed">Reset</button>
        </div>
        <input type="range" min="0.5" max="2" step="0.05" value="1"
          aria-label="Playback speed" aria-valuetext="1×">
        <div class="speed-limits" aria-hidden="true"><span>0.5×</span><span>2×</span></div>
      </div>`;
    this.#range = this.defaultSlot.querySelector("input")!;
    this.#output = this.defaultSlot.querySelector("output")!;
    this.#range.addEventListener("input", () => this.#requestRate(this.#range.valueAsNumber));
    this.defaultSlot.querySelector("button")!.addEventListener("click", () => this.#requestRate(1));
    // Keep native range/button keys out of the menu navigation and player shortcuts.
    this.shadowRoot!.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Escape") event.stopPropagation();
    });
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.#syncRate();
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    super.attributeChangedCallback(name, oldValue, value);
    if (name === MediaUIAttributes.MEDIA_PLAYBACK_RATE) this.#syncRate();
  }

  focus(): void {
    super.focus();
    this.#range.focus();
  }

  #requestRate(rate: number): void {
    this.dispatchEvent(new CustomEvent(MediaUIEvents.MEDIA_PLAYBACK_RATE_REQUEST, {
      bubbles: true, composed: true, detail: rate,
    }));
  }

  #syncRate(): void {
    const rate = Number(this.getAttribute(MediaUIAttributes.MEDIA_PLAYBACK_RATE) ?? 1);
    const label = `${Math.round(rate * 100) / 100}×`;
    this.#range.value = String(rate);
    this.#range.setAttribute("aria-valuetext", label);
    this.#output.value = label;
    const description = this.parentElement?.querySelector(":scope > [slot=description]");
    if (description) description.textContent = rate === 1 ? "Normal" : label;
  }
}

if (!customElements.get("chunkify-playback-rate-menu")) {
  customElements.define("chunkify-playback-rate-menu", PlaybackRateMenu);
}
