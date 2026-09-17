import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ffmpeg = process.argv[2] ?? "ffmpeg";
const root = new URL("./media/adaptive/", import.meta.url);
const variants = [
  { name: "low", resolution: "128x72", bitrate: "64k", buffer: "128k" },
  { name: "high", resolution: "256x144", bitrate: "256k", buffer: "512k" },
];
let master = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n";
for (const { name, resolution, bitrate, buffer } of variants) {
  const directory = new URL(`${name}/`, root);
  await mkdir(directory, { recursive: true });
  const result = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${resolution}:rate=12`,
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "20", "-c:v", "libx264", "-profile:v", "baseline", "-pix_fmt", "yuv420p",
    "-b:v", bitrate, "-minrate", bitrate, "-maxrate", bitrate, "-bufsize", buffer,
    "-x264-params", "nal-hrd=cbr:force-cfr=1", "-g", "12", "-keyint_min", "12", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "16k", "-hls_time", "1", "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4", "-hls_flags", "single_file",
    "-hls_segment_filename", "video.mp4", "stream.m3u8",
  ], { cwd: fileURLToPath(directory), stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg failed for ${name}`);
  const playlist = await readFile(new URL("stream.m3u8", directory), "utf8");
  const segments = [...playlist.matchAll(/#EXTINF:([\d.]+),\n#EXT-X-BYTERANGE:(\d+)@\d+/g)];
  const peak = Math.ceil(Math.max(...segments.map(([, duration, bytes]) => Number(bytes) * 8 / Number(duration))));
  const average = Math.ceil(segments.reduce((sum, [, , bytes]) => sum + Number(bytes) * 8, 0)
    / segments.reduce((sum, [, duration]) => sum + Number(duration), 0));
  const media = await readFile(new URL("video.mp4", directory));
  const avcConfig = media.indexOf(Buffer.from("avcC"));
  if (avcConfig < 0) throw new Error(`Missing AVC configuration in ${name}`);
  const codec = `avc1.${media.subarray(avcConfig + 5, avcConfig + 8).toString("hex")}`;
  master += `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${average},RESOLUTION=${resolution},CODECS="${codec},mp4a.40.2"\n${name}/stream.m3u8\n`;
}
await writeFile(new URL("master.m3u8", root), master);
