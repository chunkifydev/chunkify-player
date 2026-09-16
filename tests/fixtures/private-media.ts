import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test as base } from "@playwright/test";

interface MediaRequest {
  target: string;
  path: string;
  cookie: string;
  range: string | undefined;
  status: number;
}

// A real second origin exercises browser CORS/cookie behavior and HTTP ranges.
// Every route maps to a fixed synthetic fixture, never an arbitrary disk path.
async function startMediaServer() {
  const files = new Map<string, { body: Buffer; type: string }>();
  for (const [name, type] of [
    ["master.m3u8", "application/vnd.apple.mpegurl"],
    ["stream.m3u8", "application/vnd.apple.mpegurl"],
    ["init.mp4", "video/mp4"], ["video.mp4", "video/mp4"],
    ["segment00.m4s", "video/mp4"], ["segment01.m4s", "video/mp4"], ["segment02.m4s", "video/mp4"],
    ["poster.jpg", "image/jpeg"], ["thumbnails/images.vtt", "text/vtt"],
    ["thumbnails/sprite01.jpg", "image/jpeg"], ["thumbnails/sprite02.jpg", "image/jpeg"],
  ]) {
    files.set(name!, { body: await readFile(new URL(`./media/${name}`, import.meta.url)), type: type! });
  }
  const master = files.get("master.m3u8")!;
  master.body = Buffer.from(master.body.toString().replace("stream.m3u8", "rendition/stream.m3u8"));
  const parts = ["init.mp4", "segment00.m4s", "segment01.m4s", "segment02.m4s"].map((name) => files.get(name)!.body);
  let offset = parts[0]!.length;
  const segments = parts.slice(1).map((part) => {
    const cue = `#EXTINF:2.000000,\n#EXT-X-BYTERANGE:${part.length}@${offset}\nvideo-ranges.mp4\n`;
    offset += part.length;
    return cue;
  }).join("");
  files.set("video-ranges.mp4", { type: "video/mp4", body: Buffer.concat(parts) });
  files.set("ranges.m3u8", { type: "application/vnd.apple.mpegurl", body: Buffer.from(
    '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n' +
    `#EXT-X-MAP:URI="video-ranges.mp4",BYTERANGE="${parts[0]!.length}@0"\n${segments}#EXT-X-ENDLIST\n`,
  ) });
  const requests: MediaRequest[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url!, "http://fixture").pathname;
    const cookie = request.headers.cookie ?? "";
    const record: MediaRequest = { target: request.url!, path, cookie, range: request.headers.range, status: 200 };
    requests.push(record);
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4173");
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Range");
    response.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    const finish = (status: number, body?: Buffer | string) => {
      record.status = status;
      response.writeHead(status).end(body);
    };
    if (path.startsWith("/cookies/") && !cookie.split("; ").includes("media_access=fixture")) {
      finish(403, "Fixture authorization required");
      return;
    }
    const prefix = path.startsWith("/cookies/") ? "/cookies/"
      : path.startsWith("/token/fixture-signature/") ? "/token/fixture-signature/"
      : path.startsWith("/public/") ? "/public/" : null;
    if (!prefix) { finish(403); return; }
    const name = path.slice(prefix.length).replace(/^rendition\//, "");
    const file = files.get(name);
    if (!file) { finish(404); return; }
    response.setHeader("Content-Type", file.type);
    response.setHeader("Accept-Ranges", "bytes");
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : file.body.length - 1, file.body.length - 1);
      if (start > end) { finish(416); return; }
      response.setHeader("Content-Range", `bytes ${start}-${end}/${file.body.length}`);
      response.setHeader("Content-Length", end - start + 1);
      finish(206, file.body.subarray(start, end + 1));
    } else {
      response.setHeader("Content-Length", file.body.length);
      finish(200, file.body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture server address");
  return {
    origin: `http://127.0.0.1:${address.port}`, requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

export const test = base.extend<{ mediaServer: Awaited<ReturnType<typeof startMediaServer>> }>({
  mediaServer: async ({}, use) => {
    const server = await startMediaServer();
    try { await use(server); } finally { await server.close(); }
  },
});
