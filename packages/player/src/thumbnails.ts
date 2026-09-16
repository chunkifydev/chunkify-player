export function loadThumbnails(media: HTMLVideoElement, source: string, credentials: RequestCredentials, onReady: () => void): () => void {
  const controller = new AbortController();
  const track = document.createElement("track");
  track.kind = "metadata";
  // Keep cues private until their image URLs have been resolved and checked.
  track.label = "chunkify-thumbnails-loading";
  track.default = true;
  let objectUrl: string | undefined;
  void (async () => {
    try {
      const url = new URL(source, media.baseURI);
      if (!/^https?:$/.test(url.protocol)) return;
      const response = await fetch(url, { signal: controller.signal, credentials });
      if (!response.ok) return;
      const text = await response.text();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      track.addEventListener("load", () => {
        if (controller.signal.aborted) return;
        for (const cue of Array.from(track.track.cues ?? [])) {
          if (!(cue instanceof VTTCue)) continue;
          try {
            const image = new URL(cue.text.trim(), response.url);
            if (!/^https?:$/.test(image.protocol) || !/^#xywh=\d+,\d+,[1-9]\d*,[1-9]\d*$/.test(image.hash)) {
              track.track.removeCue(cue);
              continue;
            }
            cue.text = image.href;
          } catch {
            track.track.removeCue(cue);
          }
        }
        track.label = "thumbnails";
        onReady();
      }, { once: true, signal: controller.signal });
      track.src = objectUrl;
      media.append(track);
      track.track.mode = "hidden";
    } catch {
      // Optional previews must not interrupt playback, including on CORS failures.
    }
  })();
  return () => {
    controller.abort();
    track.track.mode = "disabled";
    track.removeAttribute("src");
    track.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}
