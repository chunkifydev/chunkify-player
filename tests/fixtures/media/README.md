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

## Multiple quality renditions

`adaptive/master.m3u8` describes two synchronized 20-second versions of an
FFmpeg test pattern and sine wave. The lower rendition is 128 x 72 at a target
64 kbit/s video bitrate; the higher rendition is 256 x 144 at 256 kbit/s. Both
use H.264 baseline at 12 frames per second and 16 kbit/s AAC. Each rendition
contains one-second independently decodable fragments in a single fMP4 file,
referenced with HLS byte ranges. Master bandwidth values include actual media
container/audio bytes and are calculated from the generated fragments. The AVC
codec identifiers are read from each file's initialization metadata.

Regenerate these fixtures with Node and an FFmpeg build containing libx264:

```sh
node tests/fixtures/generate-adaptive.mjs
# Optionally pass the path to a specific FFmpeg binary as the first argument.
```

The files add approximately 950 KB of checked-in media and are excluded from
the npm package. CI serves them directly and does not run FFmpeg.

The local media server paces these fMP4 responses in chunks. The adaptive test
starts with fast delivery, observes the decoded higher resolution, slows
delivery, and requires a decoded switch to the lower resolution. It uses
cookie-protected URLs and requires successful completion without a fatal error.
Restoring delivery need not cause an immediate upgrade if the remaining VOD is
already buffered. Public native/auto tests also verify playback, seeking and
completion; they leave native rendition selection to the browser. No engine
internals or rendition-selection overrides are used by these tests.
