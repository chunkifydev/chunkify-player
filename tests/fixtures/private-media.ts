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

async function startMediaServer() {
  const files = new Map<string, { body: Buffer; type: string }>();
  for (const [name, type] of [
    ["master.m3u8", "application/vnd.apple.mpegurl"],
    ["init.mp4", "video/mp4"],
    ["video.mp4", "video/mp4"],
    ["segment00.m4s", "video/mp4"],
    ["segment01.m4s", "video/mp4"],
    ["segment02.m4s", "video/mp4"],
  ] as const) {
    files.set(name, {
      body: await readFile(new URL(`./media/${name}`, import.meta.url)),
      type,
    });
  }

  const parts = ["init.mp4", "segment00.m4s", "segment01.m4s", "segment02.m4s"]
    .map((name) => files.get(name)!.body);
  let offset = parts[0]!.length;
  const segments = parts.slice(1).map((part) => {
    const cue = `#EXTINF:2.000000,\n#EXT-X-BYTERANGE:${part.length}@${offset}\nvideo-ranges.mp4\n`;
    offset += part.length;
    return cue;
  }).join("");
  files.set("video-ranges.mp4", { type: "video/mp4", body: Buffer.concat(parts) });
  files.set("ranges.m3u8", {
    type: "application/vnd.apple.mpegurl",
    body: Buffer.from(
      "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n"
      + `#EXT-X-MAP:URI="video-ranges.mp4",BYTERANGE="${parts[0]!.length}@0"\n${segments}#EXT-X-ENDLIST\n`,
    ),
  });
  files.set("master.m3u8", {
    type: "application/vnd.apple.mpegurl",
    body: Buffer.from(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=256x144\n"
      + "rendition/ranges.m3u8\n",
    ),
  });

  const requests: MediaRequest[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture");
    const path = url.pathname;
    const cookie = request.headers.cookie ?? "";
    const record: MediaRequest = {
      target: request.url!,
      path,
      cookie,
      range: request.headers.range,
      status: 200,
    };
    requests.push(record);
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4173");
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Range");
    response.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const finish = (status: number, body?: Buffer | string) => {
      record.status = status;
      response.writeHead(status);
      response.end(body);
    };
    if (path.startsWith("/cookies/")
      && !cookie.split("; ").includes("media_access=fixture")) {
      if (url.searchParams.has("delay")) {
        const delay = Math.min(Number(url.searchParams.get("delay")) || 100, 2_000);
        setTimeout(() => finish(403, "Fixture authorization required"), delay);
      } else {
        finish(403, "Fixture authorization required");
      }
      return;
    }
    const prefix = path.startsWith("/cookies/") ? "/cookies/"
      : path.startsWith("/token/fixture-signature/") ? "/token/fixture-signature/"
      : null;
    if (!prefix) {
      finish(403);
      return;
    }
    const name = path.slice(prefix.length).replace(/^rendition\//, "");
    const file = files.get(name);
    if (!file) {
      finish(404);
      return;
    }

    response.setHeader("Content-Type", file.type);
    response.setHeader("Accept-Ranges", "bytes");
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    if (!range) {
      response.setHeader("Content-Length", file.body.length);
      finish(200, file.body);
      return;
    }

    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : file.body.length - 1, file.body.length - 1);
    if (start > end) {
      finish(416);
      return;
    }
    response.setHeader("Content-Range", `bytes ${start}-${end}/${file.body.length}`);
    response.setHeader("Content-Length", end - start + 1);
    finish(206, file.body.subarray(start, end + 1));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture server address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

export const test = base.extend<{ mediaServer: Awaited<ReturnType<typeof startMediaServer>> }>({
  mediaServer: async ({}, use) => {
    const server = await startMediaServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
});
