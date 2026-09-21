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
  }
  :host(:not([controls])) media-control-bar,
  :host(:not([controls])) [slot="centered-chrome"],
  :host(:not([controls])) .demuxed-gradient-bottom {
    display: none;
  }
  .small-button {
    padding: 0;
  }
  .small-button svg {
    left: 0;
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
