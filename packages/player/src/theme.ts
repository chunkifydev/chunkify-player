import DemuxedTheme from "@player.style/demuxed-2022";

// Keep the upstream design in one place so it can be replaced independently of playback.
const template = document.createElement("template");
template.content.append(DemuxedTheme.template.content.cloneNode(true));
for (const element of template.content.querySelectorAll(
  "media-cast-button, media-airplay-button, media-captions-button, media-error-dialog",
)) element.remove();

const style = document.createElement("style");
style.textContent = `
  :host { display: block; width: 100%; }
  .small-button { --media-button-padding: 0; }
  .small-button svg { position: static; width: 20px; min-width: 0; }
  media-controller:not([breakpointsm]) media-pip-button.small-button { display: flex; }
  media-fullscreen-button[mediafullscreenunavailable],
  media-pip-button[mediapipunavailable] { display: none !important; }
  :host(:not([controls])) media-control-bar,
  :host(:not([controls])) [slot="centered-chrome"],
  :host(:not([controls])) .demuxed-gradient-bottom { display: none; }
`;
template.content.append(style);

export function createPlayerTheme() {
  const theme = new DemuxedTheme();
  theme.template = template;
  theme.setAttribute("part", "theme");
  theme.hidden = true;
  return theme;
}
