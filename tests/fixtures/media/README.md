# Local media fixture

This six-second clip contains an FFmpeg-generated test pattern and sine wave.
It has H.264 baseline video at 256 x 144, 12 frames per second, and AAC audio.
No customer media or external service is used. The generated fixtures are
covered by this repository's MIT license.

`video.mp4` is a fast-start MP4. `master.m3u8` points to the muxed audio/video
rendition `stream.m3u8`, which uses three fMP4 segments and `init.mp4`.
`thumbnails/images.vtt` maps six one-second cues onto two 320 x 180 JPEG sprites,
each containing a 2 x 2 grid of 160 x 90 frames. The final sprite has two frames.

To regenerate the binary fixtures from the repository root with FFmpeg installed:

```sh
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i testsrc2=size=256x144:rate=12 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 6 -c:v libx264 -profile:v baseline -pix_fmt yuv420p \
  -g 24 -keyint_min 24 -sc_threshold 0 -c:a aac -b:a 32k \
  -movflags +faststart tests/fixtures/media/video.mp4

ffmpeg -y -hide_banner -loglevel error -i tests/fixtures/media/video.mp4 \
  -c copy -hls_time 2 -hls_segment_type fmp4 -hls_playlist_type vod \
  -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename 'tests/fixtures/media/segment%02d.m4s' \
  tests/fixtures/media/stream.m3u8

ffmpeg -y -hide_banner -loglevel error -i tests/fixtures/media/video.mp4 \
  -frames:v 1 -update 1 tests/fixtures/media/poster.jpg

ffmpeg -y -hide_banner -loglevel error -i tests/fixtures/media/video.mp4 \
  -vf 'fps=1,scale=160:90,tile=2x2' -frames:v 2 \
  tests/fixtures/media/thumbnails/sprite%02d.jpg
```

CI uses the checked-in fixtures and does not need FFmpeg.

`../private-media.ts` serves these same files on an ephemeral loopback port for
private-playback tests. The page and media server share a site but have different
origins. `/cookies/` requires the synthetic HttpOnly `media_access=fixture` cookie;
`/token/fixture-signature/` represents an already authorized path; `/public/` needs
neither. The server returns credentialed CORS headers and real HTTP 206 ranges.
It builds a nested master/rendition layout and a byte-range HLS playlist in memory
from the existing init/segment files. No extra binary fixtures or real CDN
credentials are needed. This fixture tests forwarding and URL resolution, not
cryptographic signing or cross-site browser cookie policy.
