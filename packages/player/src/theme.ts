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
  media-preview-thumbnail:not([mediapreviewimage]),
  media-preview-thumbnail[data-cue-missing],
  media-preview-thumbnail[hidden] { display: none; }
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
  theme.renderRoot.addEventListener("mediapreviewrequest", (event) => {
    if (!(event instanceof CustomEvent)) return;
    const media = theme.querySelector("video");
    const track = Array.from(media?.textTracks ?? []).find((track) => track.label === "thumbnails");
    // Media Chrome extends the first/last cue beyond its boundaries. Preserve
    // gaps, including intervals whose malformed cues were rejected by the loader.
    const hasCue = typeof event.detail === "number" && Array.from(track?.cues ?? []).some(
      (cue) => cue.startTime <= event.detail && event.detail < cue.endTime,
    );
    for (const preview of theme.renderRoot.querySelectorAll("media-preview-thumbnail")) {
      preview.toggleAttribute("data-cue-missing", !hasCue);
    }
  }, { capture: true });
  for (const preview of theme.renderRoot.querySelectorAll<HTMLElement>("media-preview-thumbnail")) {
    // Keep the controller's upgrade deferred until its media slot is populated.
    customElements.upgrade(preview);
    const image = preview.shadowRoot?.querySelector("img");
    preview.hidden = true;
    image?.addEventListener("error", () => { preview.hidden = true; });
    image?.addEventListener("load", () => { preview.hidden = false; });
  }
  return theme;
}

export function refreshThumbnailPreview(theme: ReturnType<typeof createPlayerTheme>) {
  const time = theme.renderRoot.querySelector("media-time-range")?.getAttribute("mediapreviewtime");
  for (const preview of theme.renderRoot.querySelectorAll("media-preview-thumbnail")) {
    const image = preview.shadowRoot?.querySelector("img");
    if (image) {
      image.onload = null;
      image.removeAttribute("src");
    }
  }
  theme.mediaController.dispatchEvent(new CustomEvent("mediapreviewrequest", {
    detail: time == null ? undefined : Number(time),
  }));
}

function restoreMouseTracking(event: Event) {
  if (!(event instanceof PointerEvent) || event.pointerType !== "mouse") return;
  const range = event.currentTarget;
  if (range instanceof HTMLElement && !range.hasAttribute("disabled")) {
    range.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
  }
}

export function connectPlayerTheme(theme: ReturnType<typeof createPlayerTheme>) {
  // WebKit can retain the pointer target across a detach/reattach without sending
  // pointerenter again. Media Chrome removes its window tracking on disconnect.
  theme.renderRoot.querySelector("media-time-range")?.addEventListener("pointermove", restoreMouseTracking, { once: true });
}
