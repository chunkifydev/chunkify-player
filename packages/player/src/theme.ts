import DemuxedTheme from "@player.style/demuxed-2022";

const template = document.createElement("template");
template.content.append(DemuxedTheme.template.content.cloneNode(true));
template.content.querySelector("media-controller")
  ?.setAttribute("noautoseektolive", "{{noautoseektolive}}");

const style = document.createElement("style");
style.textContent = `
  :host {
    display: block;
    width: 100%;
    --media-accent-color: var(--chunkify-player-accent-color, #7596cc);
    --media-tertiary-color: var(--chunkify-player-accent-color, #7596cc);
    --media-primary-color: var(--chunkify-player-control-color, black);
    --media-secondary-color: var(--chunkify-player-control-background, white);
    --media-font-family: var(--chunkify-player-font-family, system-ui, sans-serif);
    --media-range-bar-color: var(--chunkify-player-progress-color, white);
    --media-range-thumb-background: var(--chunkify-player-accent-color, #7596cc);
  }
  :host(:not([controls])) media-control-bar,
  :host(:not([controls])) [slot="centered-chrome"],
  :host(:not([controls])) .demuxed-gradient-bottom {
    display: none;
  }
  .small-button {
    background: var(--chunkify-player-control-background, white);
    padding: 0;
  }
  .small-button svg {
    left: 0;
  }
  div[slot="centered-chrome"] media-play-button {
    background: var(--chunkify-player-control-background, rgb(0 0 0 / 0.8));
  }
  div[slot="centered-chrome"] media-play-button svg {
    fill: var(--chunkify-player-control-color, white);
  }
  media-time-display,
  media-preview-time-display {
    font-family: var(--chunkify-player-font-family, system-ui, sans-serif);
  }
`;
template.content.append(style);

export function createPlayerTheme() {
  const theme = new DemuxedTheme();
  theme.template = template;
  theme.setAttribute("part", "theme");
  return theme;
}

export function syncPlayerTheme(
  theme: ReturnType<typeof createPlayerTheme>,
  controls: boolean,
  noAutoSeekToLive: boolean,
) {
  theme.toggleAttribute("controls", controls);
  theme.toggleAttribute("disabled", !controls);
  theme.toggleAttribute("nohotkeys", !controls);
  theme.toggleAttribute("noautoseektolive", noAutoSeekToLive);
  theme.render();
}
